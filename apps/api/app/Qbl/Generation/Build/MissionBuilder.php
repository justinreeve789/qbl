<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Characters\NpcCharacter;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;

/**
 * Turns a mission blueprint and its pictures into rows of the QBL tables (the shape of
 * ScenarioStore::bundle()), which ScenarioCompiler makes into the scenario document.
 *
 * Every interaction becomes events and actions by one of the patterns in docs/src/content/docs/developers/extensions.md
 * ("Patterns"), so what the language model wrote is never trusted to be valid JSON for the runtime:
 *
 *   talk        a character's click event runs a dispatcher that picks the conversation that applies
 *   collect     a click hotspot with the item as its label; it disappears once taken
 *   inspect     a click hotspot that opens an infobox
 *   question    a non-dismissible infobox whose buttons run one answer event each; the first answer is
 *               recorded, every answer explained, and the student may try again until right. A prediction
 *               accepts every answer; a debrief question is asked by the guide in the final report
 *   experiment  the "hands-on experiment" loop: buttons move a value, reaching the target completes it
 *   team_task   a shared (room) counter each student adds to once, or one part per crew role; shown to the
 *               whole scene
 *
 * Around them: ways between scenes (edges, and doors, holes, ladders... that students walk to and go
 * through), things placed where they belong at their real size (on the floor, at the back, on a table, on
 * the wall), crew roles chosen at a crew station with a crew log of what each role found, twists that are
 * flashed to the whole scene and can block a way with an obstacle until set right, hidden discoveries that
 * appear as students come near, and characters who pace about and mutter.
 *
 * Progress is kept in variables, which the checklist, the conditions and teacher reports read:
 * done_<interaction> (1 when done; for a question, when answered correctly; shared by the crew for a
 * role's job, with did_<interaction> for the student who did it), q_<key>_first (the first answer chosen,
 * 1-based), q_<key>_answer (its text), q_<key>_tries, score (questions right first time), team_<key>
 * (shared), my_role and role_name, found_<interaction> (the crew log, shared), twist_<key> (shared).
 */
class MissionBuilder
{
    public const WIDTH = 2250;

    public const HEIGHT = 1200;

    /** Walk-in radius of each edge. The top edge is a doorway at the centre back of the floor, not the whole line, so things standing along the back can be reached. */
    private const EDGE_RADIUS = ['left' => 35, 'right' => 35, 'top' => 90, 'bottom' => 25];

    /** A hidden discovery shows from this far away, and fully from the second distance. */
    private const REVEAL = [340, 170];

    /** How far a wandering character paces either side of their spot. */
    private const WANDER = 110;

    private array $rows;

    private array $next = [];

    private array $files = [];

    private array $vars = [];

    /** scene key => scene id; character key => [id, row, sheet]; item key => [media id, asset, item] */
    private array $sceneIds = [];

    private array $scenesByKey = [];

    private array $characterIds = [];

    /** character key => index of its row in rows['characters'] */
    private array $characterRows = [];

    private array $itemMedia = [];

    /** "scene|to" => [media id, asset] */
    private array $passageMedia = [];

    /** "indoor" | "outdoor" => [media id, asset] */
    private array $surfaceMedia = [];

    private array $mediaByPath = [];

    /** interaction key => blueprint row */
    private array $interactions = [];

    private array $steps = [];

    /** role key => [number, row] */
    private array $roles = [];

    /** twist key => row */
    private array $twists = [];

    /** scene key => its ways in and out (Connections::ends) */
    private array $ends = [];

    /** scene key => indirect event id of its refresh event */
    private array $refresh = [];

    /** interaction key => indirect event id run to start it (questions, talks, experiments) */
    private array $entry = [];

    /** "twist|scene" => the twist's event in that scene */
    private array $twistEvents = [];

    private ?int $roleMenu = null;

    private string $guide;

    private array $evidence = [];

    private array $evidenceLog = [];

    private array $pendingFollowUps = [];

    private array $pendingTwists = [];

    private array $blueprintCompletion = [];

    /** Text labels already placed in the scene being built: [x, y, width]. */
    private array $labelSlots = [];

    /** How many scored questions there are. */
    private int $graded = 0;

    /**
     * @param  array  $blueprint  A blueprint BlueprintValidator accepts.
     * @param  array  $alignment  StandardsAligner::align().
     * @param  array<string, array{path: string, width: int, height: int, params?: array, frame_width?: int, frame_height?: int}>  $assets
     *                                                                                                                                      "bg:<scene>", "char:<key>", "portrait:<key>", "item:<key>", "passage:<scene>:<to>", "surface:<kind>", "marker", "badge".
     * @param  array{min_players?: int, max_players?: int, generation_id?: ?int, style?: string, voices?: array<string, string>}  $options
     *                                                                                                                          voices: a catalog voice for each character, by key
     * @return array{rows: array, files: array<int, string>, evidence: array<string, array>}
     */
    public function build(array $blueprint, array $alignment, array $assets, array $options = []): array
    {
        $this->rows = array_fill_keys(['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'], []);
        $b = $blueprint;
        foreach ($b['interactions'] as $it) {
            $this->interactions[$it['key']] = $it;
        }
        foreach ($b['steps'] as $s) {
            $this->steps[$s['key']] = $s;
        }
        foreach (array_values($b['roles'] ?? []) as $i => $r) {
            $this->roles[$r['key']] = [$i + 1, $r];
        }
        foreach ($b['twists'] ?? [] as $t) {
            $this->twists[$t['key']] = $t;
        }
        // Scored questions (not predictions), counted now: the final score is written before every question is built.
        $this->graded = count(array_filter($this->interactions, fn ($it) => $it['type'] === 'question' && ($it['question']['purpose'] ?? 'check') !== 'predict'));
        foreach ($b['scenes'] as $s) {
            $this->scenesByKey[$s['key']] = $s;
        }
        $this->ends = Connections::ends($b);
        $minPlayers = max(1, (int) ($options['min_players'] ?? 2));
        $this->blueprintCompletion = $b['completion'];
        $guide = array_values(array_filter($b['characters'], fn ($c) => ! empty($c['guide'])))[0] ?? $b['characters'][0];
        $this->guide = $guide['key'];

        // ---------------------------------------------------------------- variables
        $this->variable('score', 0);
        $this->variable('mission_complete', 0);
        $this->variable('intro_seen', 0);
        $this->variable('ready_hinted', 0);
        $this->variable('talked', 0, persist: false);
        $this->variable('report_ok', 0, persist: false);
        if ($this->roles) {
            $this->variable('my_role', 0);
            $this->variable('role_name', 'not chosen yet');
            $this->variable('counted_role', 0, persist: false);
            foreach ($this->roles as $rk => $_) {
                // How many of the crew have each role now: counted again on every visit.
                $this->variable("crew_$rk", 0, 'room', persist: false);
            }
        }
        foreach ($this->interactions as $key => $it) {
            if ($it['type'] === 'team_task') {
                $this->variable("team_$key", 0, 'room');
                if (! empty($it['team']['roles'])) {
                    foreach ($it['team']['roles'] as $part) {
                        $this->variable("team_{$key}_{$part['role']}", 0, 'room');
                    }
                } else {
                    $this->variable("helped_$key", 0);
                    $this->interactions[$key]['team']['needed'] = max(1, min((int) $it['team']['needed'], $minPlayers));
                }
            } else {
                $this->variable("done_$key", 0, $this->shared($key) ? 'room' : 'player');
                if ($this->shared($key)) {
                    $this->variable("did_$key", 0);
                }
            }
            if (! empty($it['share'])) {
                $this->variable("found_$key", 'not found yet', 'room');
            }
            if ($it['type'] === 'question') {
                $this->variable("q_{$key}_first", 0);
                $this->variable("q_{$key}_answer", '');
                $this->variable("q_{$key}_tries", 0);
            }
            if ($it['type'] === 'experiment') {
                $this->variable("value_$key", (int) $it['experiment']['start']);
                $this->variable("menu_$key", 0, persist: false);
            }
        }
        foreach ($this->twists as $key => $t) {
            $this->variable("twist_$key", 0, 'room');
            $this->variable("seen_twist_$key", 0);
            if (! empty($t['blocks']) || ! empty($t['obstacle'])) {
                $this->variable("blocked_$key", 0, 'room');
            }
        }
        foreach ($this->steps as $key => $s) {
            $this->variable("step_$key", 0);
            if ($this->counted($s)) {
                $this->variable("count_$key", 0);
            }
        }

        // ---------------------------------------------------------------- media
        foreach ($b['items'] as $item) {
            if ($asset = $assets["item:{$item['key']}"] ?? null) {
                $this->itemMedia[$item['key']] = [$this->media("item-{$item['key']}", $asset, 40), $asset, $item];
            }
        }
        if (isset($assets['marker'])) {
            $this->itemMedia['__marker'] = [$this->media('marker', $assets['marker'], 40), $assets['marker'], null];
        }
        foreach (['indoor', 'outdoor'] as $kind) {
            if (isset($assets["surface:$kind"])) {
                $this->surfaceMedia[$kind] = [$this->media("surface-$kind", $assets["surface:$kind"], 40), $assets["surface:$kind"]];
            }
        }
        foreach ($this->ends as $sceneKey => $list) {
            foreach ($list as $end) {
                if ($end['via'] !== 'edge' && ($asset = $assets["passage:$sceneKey:{$end['to']}"] ?? null)) {
                    $this->passageMedia["$sceneKey|{$end['to']}"] = [$this->media("passage-$sceneKey-{$end['to']}", $asset, 35), $asset];
                }
            }
        }
        foreach ($b['characters'] as $c) {
            $sheet = $assets["char:{$c['key']}"] ?? null;
            if (! $sheet) {
                throw new GenerationError("There is no picture for the character {$c['key']}.");
            }
            $mediaId = $this->media("character-{$c['key']}", $sheet, 10);
            $portrait = isset($assets["portrait:{$c['key']}"]) ? $this->media("portrait-{$c['key']}", $assets["portrait:{$c['key']}"], 30) : null;
            $id = $this->id('characters');
            // Drawn from the sheet: its idle and walk are the poses, its gestures the character's own animations.
            $animations = NpcCharacter::animationsFromPicture(['id' => $mediaId] + (array) ($sheet['params'] ?? []), $portrait);
            // The voice its lines are recorded in (ScenarioGenerator picks them; App\Qbl\Speech\Voicer records them).
            $voice = $options['voices'][$c['key']] ?? null;
            $this->rows['characters'][] = ['id' => $id, 'name' => $c['name'], 'media_id' => $mediaId, 'settings' => array_filter(['scale' => 0.8, 'animations' => $animations, 'tts_voice' => $voice])];
            $this->characterRows[$c['key']] = array_key_last($this->rows['characters']);
            $this->characterIds[$c['key']] = [$id, $c, $sheet];
            $this->variable("label_{$c['key']}", 'Talk to '.$c['name'], persist: false);
        }

        // ---------------------------------------------------------------- scenes
        $sequence = 0;
        $ordered = $b['scenes'];
        usort($ordered, fn ($a, $c) => ($c['key'] === $b['start_scene']) <=> ($a['key'] === $b['start_scene']));
        foreach ($ordered as $scene) {
            $this->sceneIds[$scene['key']] = $this->id('scenes');
        }
        foreach ($ordered as $scene) {
            $this->scene($scene, ++$sequence, $assets, $b);
        }
        // Questions that pop up after another interaction, and twists: their events exist now.
        foreach ($this->pendingFollowUps as [$event, $question, $when]) {
            $this->action($event, 'run_event', ['target_event_id' => $this->entry[$question]], conditions: [...$when, $this->cond("done_$question", '=', 0)]);
        }
        foreach ($this->pendingTwists as [$event, $twist, $sceneKey, $when]) {
            $this->action($event, 'run_event', ['target_event_id' => $this->twistEvent($twist, $sceneKey)], conditions: [...$when, $this->cond("twist_$twist", '=', 0)]);
        }

        // ---------------------------------------------------------------- shop badge
        if (! empty($b['badge']) && isset($assets['badge'])) {
            $mediaId = $this->media('badge', $assets['badge'], 50);
            $this->rows['shop_items'][] = [
                'id' => $this->id('shop_items'), 'name' => $b['badge']['name'], 'description' => 'Only from the mission "'.$b['title'].'".', 'kind' => 'wearable', 'slot' => 'body',
                'price' => 15, 'media_id' => $mediaId, 'settings' => ['scale' => 0.14, 'offset_x' => 0.06, 'offset_y' => -0.08], 'active' => true, 'sequence' => 1,
            ];
        }

        // ---------------------------------------------------------------- the scenario
        $objectives = [];
        if ($this->roles) {
            $objectives[] = ['id' => 'role', 'text' => 'Choose a crew role at the crew station ({{role_name}})', 'complete_when' => [$this->cond('my_role', '>', 0)]];
        }
        foreach ($b['steps'] as $s) {
            $n = count($s['done_when']);
            $objectives[] = array_filter([
                'id' => $s['key'],
                'text' => $s['text'].($this->counted($s) ? " ({{count_{$s['key']}}}/$n)" : '').$this->roleNote($s),
                'show_when' => ! empty($s['after']) ? $this->requirement($s['after']) : null,
                'complete_when' => $this->stepConditions($s['key']),
                'optional' => ! empty($s['optional']) ? true : null,
            ], fn ($v) => $v !== null);
        }
        $objectives[] = ['id' => 'report', 'text' => $b['completion']['label'], 'show_when' => $this->readyConditions(), 'complete_when' => [$this->cond('mission_complete', '=', 1)]];

        $this->rows['scenario'] = [
            'id' => 1,
            'shortname' => self::slug($b['title']),
            'title' => $b['title'],
            'subtitle' => $b['subtitle'],
            'description' => $b['description'],
            'start_scene_id' => $this->sceneIds[$b['start_scene']],
            'enable_save_session' => true,
            'require_login' => true,
            'allow_groups' => true,
            'max_players' => (int) ($options['max_players'] ?? 30),
            'default_language' => 'en-us',
            'settings' => [
                'spec_version' => 2,
                // A generated mission is a draft for a teacher to review: nobody sees it until it is assigned or made public.
                'visibility' => 'private',
                'chat_mode' => 'emotes',
                'move_speed' => 420,
                'moves' => [['animation' => 'jump'], ['animation' => 'wave']],
                'objectives' => $objectives,
                'curriculum' => [
                    'standards' => array_map(fn ($s) => ['framework' => $s['framework'], 'code' => $s['code'], 'description' => $s['description'], 'alignment' => $s['alignment'], 'rationale' => $s['rationale']], $alignment['standards']),
                    'learning_objectives' => $alignment['learning_objectives'],
                    'vocabulary' => $alignment['vocabulary'],
                    // Which variables record evidence of each objective, for teacher reports.
                    'evidence' => $this->evidenceVariables($alignment),
                    'scored_questions' => $this->graded,
                    'roles' => array_values(array_map(fn ($r) => ['key' => $r[1]['key'], 'name' => $r[1]['name'], 'number' => $r[0]], $this->roles)) ?: null,
                ],
                'generated' => array_filter(['by' => 'qbl:generate', 'generation_id' => $options['generation_id'] ?? null, 'art_style' => $options['style'] ?? null, 'at' => gmdate('c')]),
            ],
        ];
        $this->rows['scenario']['settings']['curriculum'] = array_filter($this->rows['scenario']['settings']['curriculum'], fn ($v) => $v !== null);

        foreach ($alignment['standards'] as $s) {
            $this->evidence[$s['code']] ??= [];
        }

        return ['rows' => $this->rows, 'files' => $this->files, 'evidence' => $this->evidence];
    }

    // ======================================================================== scenes

    private function scene(array $scene, int $sequence, array $assets, array $b): void
    {
        $key = $scene['key'];
        $sceneId = $this->sceneIds[$key];
        $ground = (int) round(self::HEIGHT * max(0.5, min(0.85, (float) $scene['ground_line'])));
        $floor = self::HEIGHT - $ground;
        $bg = $assets["bg:$key"] ?? throw new GenerationError("There is no background for the scene $key.");
        $bgId = $this->media("background-$key", $bg, $key === $b['start_scene'] ? 1 : 10 + $sequence);
        $ends = $this->ends[$key] ?? [];
        $edges = array_column(array_filter($ends, fn ($e) => $e['via'] === 'edge'), null, 'edge');
        $passages = array_filter($ends, fn ($e) => $e['via'] !== 'edge');
        $start = $key === $b['start_scene'];
        $this->labelSlots = [];

        // Where things stand. Interactions, characters, props, obstacles and the crew station share the
        // width; spread them so none overlap. Doors, holes and the doorway of a top exit stay exactly where
        // they are, and everything else keeps clear of them.
        $anchors = [];
        foreach ($b['characters'] as $c) {
            if ($c['scene'] === $key) {
                $anchors["char:{$c['key']}"] = (float) $c['x'];
            }
        }
        foreach ($this->interactions as $ik => $it) {
            if ($it['scene'] === $key && $this->placed($it)) {
                $anchors["int:$ik"] = (float) ($it['x'] ?? 0.5);
            }
        }
        foreach ($scene['props'] ?? [] as $i => $p) {
            $anchors["prop:$i"] = (float) $p['x'];
        }
        if ($start && $this->roles) {
            $anchors['station'] = 0.12;
        }
        $fixed = isset($edges['top']) ? ['door' => 0.5] : [];
        foreach ($passages as $p) {
            $fixed["way:{$p['to']}"] = (float) $p['x'];
        }
        // An obstacle stands in front of the way it blocks; one that blocks nothing goes where it was asked.
        $obstacles = [];
        foreach ($this->twists as $tk => $t) {
            if (! empty($t['obstacle']) && $this->twistScene($tk) === $key) {
                $obstacles[$tk] = $this->obstacleSpot($t, $ends, $ground);
                if ($obstacles[$tk][0] !== null) {
                    $fixed["obstacle:$tk"] = $obstacles[$tk][0];
                } else {
                    $anchors["obstacle:$tk"] = (float) $t['obstacle']['x'];
                }
            }
        }
        $xs = self::spread($anchors, 260, 230, self::WIDTH - 230, $fixed);

        $layoutItems = [];
        foreach ($scene['props'] ?? [] as $i => $p) {
            [$mediaId, $asset, $item] = $this->itemMedia[$p['item']] ?? [null, null, null];
            if (! $mediaId) {
                continue;
            }
            $vehicle = $item['kind'] === 'vehicle';
            $itemId = $this->id('items');
            $this->rows['items'][] = [
                'id' => $itemId, 'name' => $item['name'], 'unique' => true, 'physical' => false, 'blocking' => ! $vehicle, 'wearable' => false, 'vehicle' => $vehicle, 'media_id' => $mediaId,
                'settings' => $vehicle
                    ? ['scale' => 1, 'art_faces' => 'right', 'attach_offset_x' => 0, 'attach_offset_y' => 4, 'attach_layer' => 'front', 'speed_multiplier' => 1.5]
                    : ['scale' => 1, 'blocking_radius' => (int) max(30, min(140, $asset['width'] * 0.35))],
            ];
            // Big things stand at the back, so the floor stays open; smaller ones a little way into the floor.
            $big = Sizes::cm($item) > 150;
            $layoutItems[] = ['item_id' => $itemId, 'position_x' => $xs["prop:$i"], 'position_y' => $big ? $ground + 10 : $ground + (int) ($floor * 0.3)];
        }

        $spawns = [['name' => 'default', 'position_x' => (int) (self::WIDTH / 2), 'position_y' => $ground + (int) ($floor * 0.55)]];
        $placements = [];
        $this->rows['scenes'][] = [
            'id' => $sceneId, 'shortname' => $key, 'sequence' => $sequence, 'subtitle' => $scene['title'], 'description' => $scene['description'] ?? null,
            'zoom' => 1, 'show_avatars' => true, 'is_intro_scene' => false, 'width' => self::WIDTH, 'height' => self::HEIGHT,
            'background_media' => [['media_id' => $bgId, 'display_width' => self::WIDTH, 'display_height' => self::HEIGHT]],
            'foreground_media' => [],
            'layout' => null, // filled in below, once spawn points and placements are known
        ];
        $sceneIndex = array_key_last($this->rows['scenes']);

        // Every scene keeps the checklist's flags and the guide's label up to date (see refreshEvent).
        $this->refresh[$key] = $this->refreshEvent($sceneId);
        if ($start && $this->roles) {
            $this->roleEvents($sceneId, $key);
        }

        // ---- arriving: the scene's name; in the start scene, the guide's briefing the first time, then
        //      choosing a role; news of a twist that happened while the student was elsewhere
        $arrive = $this->event($sceneId, 'start', 'arrive');
        $this->action($arrive, 'text_overlay', ['text' => $scene['title'], 'alignment' => 'top center', 'text_font_size' => 34, 'duration' => 2500], blocking: false);
        if ($start) {
            $intro = [$this->cond('intro_seen', '=', 0)];
            $this->action($arrive, 'variable', ['name' => 'intro_seen', 'operator' => 'set', 'operand' => 1], conditions: $intro);
            $this->action($arrive, 'freeze', ['frozen' => true], conditions: $intro);
            foreach ($b['intro']['dialogue'] as $line) {
                $this->dialogue($arrive, $line, $intro);
            }
            $this->action($arrive, 'freeze', ['frozen' => false], conditions: $intro);
            if ($this->roles) {
                // Back again with a role: count it among the crew. Without one: choose now.
                foreach ($this->roles as $rk => [$n]) {
                    $this->action($arrive, 'variable', ['name' => "crew_$rk", 'operator' => '+', 'operand' => 1], conditions: [$this->cond('my_role', '=', $n), $this->cond('counted_role', '=', 0)]);
                }
                $this->action($arrive, 'variable', ['name' => 'counted_role', 'operator' => 'set', 'operand' => 1], conditions: [$this->cond('my_role', '>', 0)]);
                $this->action($arrive, 'run_event', ['target_event_id' => $this->roleMenu], conditions: [$this->cond('my_role', '=', 0)]);
            }
        }
        foreach ($this->twists as $tk => $t) {
            $missed = [$this->cond("twist_$tk", '=', 1), $this->cond("seen_twist_$tk", '=', 0)];
            $this->action($arrive, 'text_overlay', ['text' => $t['notice'] ?? $t['title'], 'text_font_size' => 30, 'duration' => 4000], blocking: false, conditions: $missed);
            $this->action($arrive, 'variable', ['name' => "seen_twist_$tk", 'operator' => 'set', 'operand' => 1], conditions: [$this->cond("twist_$tk", '=', 1)]);
        }
        $this->action($arrive, 'run_event', ['target_event_id' => $this->refresh[$key]]);

        // ---- ways out: edges, and passages standing in the scene
        foreach ($edges as $edge => $x) {
            $this->edgeExit($sceneId, $key, $x, $ground);
            // Where students arrive when they come in through this edge, clear of the edge's own hotspot.
            $spawns[] = match ($edge) {
                'left' => ['name' => "from-{$x['to']}", 'position_x' => 190, 'position_y' => $ground + (int) ($floor * 0.5)],
                'right' => ['name' => "from-{$x['to']}", 'position_x' => self::WIDTH - 190, 'position_y' => $ground + (int) ($floor * 0.5), 'facing' => 'left'],
                'top' => ['name' => "from-{$x['to']}", 'position_x' => (int) (self::WIDTH / 2), 'position_y' => $ground + max(150, (int) ($floor * 0.45))],
                'bottom' => ['name' => "from-{$x['to']}", 'position_x' => (int) (self::WIDTH / 2), 'position_y' => self::HEIGHT - max(80, (int) ($floor * 0.25))],
            };
        }
        foreach ($passages as $p) {
            $px = $xs["way:{$p['to']}"];
            $spawns[] = $this->passage($sceneId, $key, $p, $px, $ground);
        }

        // ---- debrief questions: the guide asks them, so they exist before the guide's conversations
        foreach ($this->interactions as $ik => $it) {
            if ($it['scene'] === $key && $it['type'] === 'question' && ! empty($it['at_report'])) {
                $this->question($sceneId, $key, $ik, $it);
            }
        }

        // ---- characters, and their conversations
        foreach ($b['characters'] as $c) {
            if ($c['scene'] !== $key) {
                continue;
            }
            [$charId, , $sheet] = $this->characterIds[$c['key']];
            $x = $xs["char:{$c['key']}"];
            $feet = $ground + (int) ($floor * 0.32);
            $dispatcher = $this->talkDispatcher($sceneId, $c, $key);
            $placements[] = ['character_id' => $charId, 'position_x' => $x, 'position_y' => $feet, 'facing' => $x > self::WIDTH / 2 ? 'left' : 'right', 'event_id' => $dispatcher];
            if ($routine = $this->routine($c, $x, $feet)) {
                $this->rows['characters'][$this->characterRows[$c['key']]]['settings'] += ['routine' => $routine, 'walk_speed' => 90];
            }
            // A label over their head, also clickable: "Talk to Dr. Ren", or the report label once the mission
            // is ready. Not for one who paces about: the label would stay behind; they are clicked themselves.
            if (! $this->wanders($c)) {
                $height = (int) (($sheet['frame_height'] ?? $sheet['height']) * 0.8);
                $label = $this->hotspot($sceneId, "label-{$c['key']}", [$x, $feet - (int) ($height / 2)], max(70, (int) ($height / 2)), click: true);
                $this->text($label, $x, $feet - $height - 30, "{{label_{$c['key']}}}", 'Talk to '.$c['name']);
                $this->action($label, 'run_event', ['target_event_id' => $dispatcher]);
            }
        }

        // ---- the crew station
        if ($start && $this->roles) {
            $this->station($sceneId, $xs['station'], $ground);
        }

        // ---- the scene's interactions, at varied depths on the floor
        $here = array_filter($this->interactions, fn ($it) => $it['scene'] === $key && $this->placed($it));
        uksort($here, fn ($a, $c) => $xs["int:$a"] <=> $xs["int:$c"]);
        $depth = 0;
        foreach ($here as $ik => $it) {
            $this->interaction($sceneId, $key, $ik, $it, $xs["int:$ik"], $ground, $depth++);
        }

        // ---- twists' obstacles
        foreach ($obstacles as $tk => [, $feet]) {
            $this->obstacle($sceneId, $tk, $this->twists[$tk], $xs["obstacle:$tk"], $feet);
        }

        $this->rows['scenes'][$sceneIndex]['layout'] = [
            'walkable_areas' => [[['x' => 0, 'y' => $ground], ['x' => self::WIDTH, 'y' => $ground], ['x' => self::WIDTH, 'y' => self::HEIGHT], ['x' => 0, 'y' => self::HEIGHT]]],
            'blocked_areas' => [],
            'spawn_points' => $spawns,
            'scale_areas' => [],
            'items' => $layoutItems,
            'characters' => $placements,
        ];
    }

    /** An interaction that stands in a scene (talks are their character; debrief questions are the guide's). */
    private function placed(array $it): bool
    {
        return $it['type'] !== 'talk' && empty($it['at_report']);
    }

    /** An edge students walk off, closed while its requirement is not met or a twist has blocked it. */
    private function edgeExit(int $sceneId, string $key, array $x, int $ground): void
    {
        $edge = $x['edge'];
        $at = match ($edge) {
            'left' => [0, null], 'right' => [self::WIDTH, null], 'top' => [(int) (self::WIDTH / 2), $ground], 'bottom' => [null, self::HEIGHT],
        };
        $requires = ! empty($x['requires']) ? $this->requirement($x['requires']) : [];
        $twist = $this->blockingTwist($key, $x['to']);
        $open = [...$requires, ...($twist ? [$this->cond("blocked_$twist", '=', 0)] : [])];
        $hot = $this->hotspot($sceneId, "exit-$edge", $at, self::EDGE_RADIUS[$edge], click: false, conditions: $open);
        $this->action($hot, 'jump', ['scene_id' => $this->sceneIds[$x['to']], 'spawn_point' => "from-$key"]);
        if (! empty($x['requires'])) {
            $this->closedTwin($sceneId, "exit-$edge-closed", $at, self::EDGE_RADIUS[$edge], false, $x['requires'], $x['locked_message'] ?? null, []);
        }
        if ($twist) {
            $closed = $this->hotspot($sceneId, "exit-$edge-blocked", $at, self::EDGE_RADIUS[$edge], click: false, conditions: [...$requires, $this->cond("blocked_$twist", '=', 1)]);
            $this->action($closed, 'text_overlay', ['text' => $this->twists[$twist]['blocks']['message'] ?? 'Something blocks the way!', 'duration' => 2500]);
        }
    }

    /**
     * A door, gate, cave, portal, tunnel, ladder or stairs at the back of the floor, or a hole, hatch or
     * stairs down in it: clicked, the student walks over to it and goes through (hopping into a hole).
     * Returns the spawn point for students who arrive through it.
     */
    private function passage(int $sceneId, string $key, array $p, int $x, int $ground): array
    {
        $floor = self::HEIGHT - $ground;
        [$mediaId, $asset] = $this->passageMedia["$key|{$p['to']}"] ?? [null, null];
        $w = $asset ? (int) $asset['width'] : 200;
        $h = $asset ? (int) $asset['height'] : 300;
        $inFloor = Connections::inFloor($p['via']);
        // In the floor: lying a little way in. At the back: standing on the floor line.
        $cy = $inFloor ? $ground + (int) ($floor * 0.42) : $ground + 10 - (int) ($h / 2);
        $standY = $inFloor ? $cy : $ground + 40;
        $radius = (int) max(90, min(190, ($inFloor ? $w : max($w, $h * 0.6)) / 2 + 10));
        $requires = ! empty($p['requires']) ? $this->requirement($p['requires']) : [];
        $twist = $this->blockingTwist($key, $p['to']);
        $looks = function (int $event) use ($mediaId, $x, $cy, $h, $p) {
            if ($mediaId) {
                $this->label($event, 'image', $x, $cy, mediaId: $mediaId);
            }
            $this->text($event, $x, $cy - (int) max(50, $h / 2 + 30), $p['label']);
        };

        $hot = $this->hotspot($sceneId, $p['id'], [$x, $cy], $radius, click: true, conditions: [...$requires, ...($twist ? [$this->cond("blocked_$twist", '=', 0)] : [])], block: true);
        $looks($hot);
        $this->action($hot, 'freeze', ['frozen' => true]);
        $this->action($hot, 'walk', ['target' => 'player', 'to' => 'point', 'position_x' => $x, 'position_y' => $standY]);
        if ($inFloor && $p['via'] === 'hole') {
            $this->action($hot, 'animate', ['target' => 'player', 'animation' => 'jump']);
        }
        $this->action($hot, 'avatar', ['visible' => false, 'duration' => 350]);
        $this->action($hot, 'jump', ['scene_id' => $this->sceneIds[$p['to']], 'spawn_point' => "from-$key"]);
        if (! empty($p['requires'])) {
            $this->closedTwin($sceneId, "{$p['id']}-closed", [$x, $cy], $radius, true, $p['requires'], $p['locked_message'] ?? null, [], $looks);
        }
        if ($twist) {
            $closed = $this->hotspot($sceneId, "{$p['id']}-blocked", [$x, $cy], $radius, click: true, conditions: [...$requires, $this->cond("blocked_$twist", '=', 1)]);
            $looks($closed);
            $this->action($closed, 'text_overlay', ['text' => $this->twists[$twist]['blocks']['message'] ?? 'Something blocks the way!', 'duration' => 2500]);
        }

        // Arriving through it: beside a hole (on the side with more room), in front of a door.
        if ($inFloor) {
            $side = $x < self::WIDTH / 2 ? 1 : -1;

            return ['name' => "from-{$p['to']}", 'position_x' => $x + $side * ($radius + 60), 'position_y' => $cy, 'facing' => $side > 0 ? 'right' : 'left'];
        }

        return ['name' => "from-{$p['to']}", 'position_x' => $x, 'position_y' => $ground + (int) ($floor * 0.4), 'facing' => $x > self::WIDTH / 2 ? 'left' : 'right'];
    }

    /**
     * A twin of a hotspot for while its requirement is not met: it says why. For a step (several
     * conditions, which cannot be negated as one), it goes by the step's flag and first brings the flags
     * up to date, so a flag that is behind never shows the message wrongly.
     */
    private function closedTwin(int $sceneId, string $shortname, array $at, int $radius, bool $click, string $requires, ?string $message, array $extra, ?\Closure $looks = null): void
    {
        $message = $message ?: 'You cannot go this way yet.';
        if (isset($this->steps[$requires])) {
            $hot = $this->hotspot($sceneId, $shortname, $at, $radius, click: $click, conditions: [...$extra, $this->cond("step_$requires", '=', 0)]);
            $looks && $looks($hot);
            $this->action($hot, 'run_event', ['target_event_id' => $this->refreshFor($sceneId)]);
            $this->action($hot, 'text_overlay', ['text' => $message, 'duration' => 2500], conditions: [$this->cond("step_$requires", '=', 0)]);

            return;
        }
        if ($negated = $this->negation($requires)) {
            $hot = $this->hotspot($sceneId, $shortname, $at, $radius, click: $click, conditions: [...$extra, ...$negated]);
            $looks && $looks($hot);
            $this->action($hot, 'text_overlay', ['text' => $message, 'duration' => 2500]);
        }
    }

    private function refreshFor(int $sceneId): int
    {
        return $this->refresh[array_search($sceneId, $this->sceneIds, true)];
    }

    /** A small thing's table or flat rock: part of the scenery, solid, staying when the thing is taken. */
    private function surface(int $sceneId, string $key, int $x, int $base, int $mediaId, array $asset): void
    {
        $hot = $this->hotspot($sceneId, "surface-$key", [$x, $base - 2], 1, click: false);
        $this->label($hot, 'image', $x, $base - (int) ($asset['height'] / 2), mediaId: $mediaId, params: ['solid' => true, 'solid_radius' => (int) max(30, $asset['width'] * 0.35)]);
    }

    // ================================================================== interactions

    private function interaction(int $sceneId, string $sceneKey, string $key, array $it, int $x, int $ground, int $depth): void
    {
        $scene = $this->scenesByKey[$sceneKey];
        $item = isset($it['item']) ? ($this->itemMedia[$it['item']][2] ?? null) : null;
        // Something to see and click: the interaction's item, or the style's marker for interactions without one.
        [$mediaId, $asset] = $this->itemMedia[$it['item'] ?? '__marker'] ?? $this->itemMedia['__marker'] ?? [null, null];
        $w = $asset ? (int) $asset['width'] : 0;
        $h = $asset ? (int) $asset['height'] : 0;
        $floor = self::HEIGHT - $ground;
        $placement = AssetDirector::placementOf($it, $item, $scene);
        // Where it is, by where it belongs: its picture's centre, and whether players can walk behind it.
        $params = [];
        switch ($placement) {
            case 'wall':
                $cy = $ground - (int) max($h / 2 + 90, self::HEIGHT * 0.17);
                break;
            case 'surface':
                $base = $ground + 14;
                $top = $base;
                if ($surface = $this->surfaceMedia[AssetDirector::surfaceKind($scene)] ?? null) {
                    $this->surface($sceneId, $key, $x, $base, ...$surface);
                    $top = $base - (int) ($surface[1]['height'] * 0.92);
                }
                $cy = $top - (int) ($h / 2) + 6;
                break;
            case 'ground':
                // Out on the floor, alternately nearer and further, so a scene is not a row along the back.
                $feet = $ground + (int) ($floor * ($depth % 2 ? 0.5 : 0.26)) + (int) min($h / 2, 40);
                $cy = $feet - (int) ($h / 2);
                $params = ['placement' => 'object'];
                break;
            default: // back
                $cy = $ground + 12 - (int) ($h / 2);
        }
        if (! $asset) {
            $cy = $ground - 40;
        }
        $radius = $asset ? (int) max(80, min(170, max($w, $h) / 2 + 20)) : 90;
        $requires = [];
        foreach ($it['requires'] ?? [] as $r) {
            array_push($requires, ...$this->requirement($r));
        }
        $notDone = $it['type'] === 'team_task' ? [] : [$this->cond("done_$key", '=', 0)];
        $role = ! empty($it['role']) && isset($this->roles[$it['role']]) ? $this->roles[$it['role']] : null;
        $mine = $role ? [$this->cond('my_role', '=', $role[0])] : [];
        $reveal = ! empty($it['hidden']);
        $textY = $cy - (int) max(50, $h / 2 + 30);

        // What it looks like: the item, if it has one, and its label above.
        $labels = function (int $event, string $suffix = '') use ($mediaId, $x, $cy, $textY, $it, $params) {
            if ($mediaId) {
                $this->label($event, 'image', $x, $cy, mediaId: $mediaId, params: $params);
            }
            $this->text($event, $x, $textY, $it['label'].$suffix);
        };
        // Students in another role are told whose job it is (and, once it is done, where to read about it).
        $roleTwin = function (bool $afterwards) use ($sceneId, $key, $x, $cy, $radius, $requires, $notDone, $role, $labels, $reveal) {
            if (! $role) {
                return;
            }
            $name = $role[1]['name'];
            $twin = $this->hotspot($sceneId, "$key-role", [$x, $cy], $radius, click: true, conditions: [...$requires, ...($afterwards ? [] : $notDone), $this->cond('my_role', '!=', $role[0])], reveal: $reveal);
            $labels($twin, " ($name)");
            $this->action($twin, 'text_overlay', ['text' => "This is a job for the $name. Ask your $name to come here, or change roles at the crew station.", 'duration' => 3500], conditions: [$this->cond("done_$key", '=', 0)]);
            if ($afterwards) {
                $this->action($twin, 'text_overlay', ['text' => "Your $name has done this. Read what they found in the crew log at the crew station.", 'duration' => 3500], conditions: [$this->cond("done_$key", '=', 1)]);
            }
        };

        switch ($it['type']) {
            case 'collect':
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone, ...$mine], block: true, reveal: $reveal);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->complete($hot, $key, $it);
                $this->action($hot, 'infobox', ['content' => self::html($it['info']).$this->sharedNote($it)]);
                $this->followUps($hot, $sceneKey, $key);
                $roleTwin(false);
                break;

            case 'inspect':
                // Can be looked at again; it counts once.
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$mine], block: true, reveal: $reveal);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->action($hot, 'infobox', ['content' => self::html($it['info']).$this->sharedNote($it)]);
                $this->complete($hot, $key, $it);
                $this->followUps($hot, $sceneKey, $key);
                $roleTwin(true);
                break;

            case 'question':
                $ask = $this->question($sceneId, $sceneKey, $key, $it);
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true, reveal: $reveal);
                $labels($hot);
                $this->action($hot, 'run_event', ['target_event_id' => $ask]);
                break;

            case 'experiment':
                $run = $this->experiment($sceneId, $sceneKey, $key, $it);
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone, ...$mine], block: true, reveal: $reveal);
                $labels($hot);
                $this->action($hot, 'run_event', ['target_event_id' => $run]);
                $roleTwin(false);
                break;

            case 'team_task':
                if (! empty($it['team']['roles'])) {
                    $this->roleTeamTask($sceneId, $sceneKey, $key, $it, [$x, $cy], $radius, $requires, $labels, $reveal);
                    break;
                }
                $t = $it['team'];
                $needed = (int) $t['needed'];
                $open = [...$requires, $this->cond("helped_$key", '=', 0), $this->cond("team_$key", '<', $needed)];
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: $open, block: true, audience: 'scene', reveal: $reveal);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->action($hot, 'variable', ['name' => "helped_$key", 'operator' => 'set', 'operand' => 1]);
                $this->action($hot, 'variable', ['name' => "team_$key", 'operator' => '+', 'operand' => 1]);
                $this->action($hot, 'text_overlay', ['text' => "{{QBLPlayerName}}: {$t['part']} ({{team_$key}}/$needed)", 'duration' => 3000]);
                if (! empty($it['award'])) {
                    $this->action($hot, 'award', $it['award'], blocking: false);
                }
                $this->teamDone($hot, $key, $it, $needed, $sceneKey);
                // Students who did their part see who else is needed.
                $wait = $this->hotspot($sceneId, "$key-waiting", [$x, $cy], $radius, click: true, conditions: [...$requires, $this->cond("helped_$key", '=', 1), $this->cond("team_$key", '<', $needed)]);
                $labels($wait);
                $this->action($wait, 'text_overlay', ['text' => "You did your part. {{team_$key}} of $needed crew members have helped: ask your crewmates!", 'duration' => 3000]);
                break;
        }

        // Clicked too early: say what is missing (only when one thing is).
        if (! empty($it['locked_hint']) && count($it['requires'] ?? []) === 1 && ($negated = $this->negation($it['requires'][0]))) {
            $hint = $this->hotspot($sceneId, "$key-locked", [$x, $cy], $radius, click: true, conditions: [...$negated, ...$notDone], reveal: $reveal);
            $labels($hint);
            $this->action($hint, 'text_overlay', ['text' => $it['locked_hint'], 'duration' => 3000]);
        }
    }

    /**
     * A team task where each crew role does its own part: one hotspot per role (only a student in that
     * role sees it), a shared flag per part and a shared count. Students who have no part left to do here
     * are told what is still needed.
     */
    private function roleTeamTask(int $sceneId, string $sceneKey, string $key, array $it, array $at, int $radius, array $requires, \Closure $labels, bool $reveal): void
    {
        $parts = $it['team']['roles'];
        $needed = count($parts);
        $listed = [];
        $summary = [];
        foreach ($parts as $part) {
            [$n, $role] = $this->roles[$part['role']];
            $listed[$part['role']] = true;
            $summary[] = "the {$role['name']} {$part['part']}";
            $flag = "team_{$key}_{$part['role']}";
            $hot = $this->hotspot($sceneId, "$key-{$part['role']}", $at, $radius, click: true, conditions: [...$requires, $this->cond('my_role', '=', $n), $this->cond($flag, '=', 0)], block: true, audience: 'scene', reveal: $reveal);
            $labels($hot, " ({$role['name']})");
            foreach ($it['dialogue'] ?? [] as $line) {
                $this->dialogue($hot, $line);
            }
            $this->action($hot, 'variable', ['name' => $flag, 'operator' => 'set', 'operand' => 1]);
            $this->action($hot, 'variable', ['name' => "team_$key", 'operator' => '+', 'operand' => 1]);
            $this->action($hot, 'text_overlay', ['text' => "The {$role['name']} {$part['part']} ({{team_$key}}/$needed)", 'duration' => 3000]);
            if (! empty($it['award'])) {
                $this->action($hot, 'award', $it['award'], blocking: false);
            }
            $this->teamDone($hot, $key, $it, $needed, $sceneKey);
        }
        $still = 'Each role does its own part: '.implode('; ', $summary).". {{team_$key}} of $needed done. No one has a role you need? Change roles at the crew station.";
        $waiting = [];
        foreach ($parts as $part) {
            $waiting[$part['role']] = [$this->cond('my_role', '=', $this->roles[$part['role']][0]), $this->cond("team_{$key}_{$part['role']}", '=', 1)];
        }
        foreach ($this->roles as $rk => [$n]) {
            if (! isset($listed[$rk])) {
                $waiting[$rk] = [$this->cond('my_role', '=', $n)];
            }
        }
        $waiting['none'] = [$this->cond('my_role', '=', 0)];
        foreach ($waiting as $who => $conds) {
            $wait = $this->hotspot($sceneId, "$key-waiting-$who", $at, $radius, click: true, conditions: [...$requires, ...$conds, $this->cond("team_$key", '<', $needed)], reveal: $reveal);
            $labels($wait);
            $this->action($wait, 'text_overlay', ['text' => $still, 'duration' => 4500]);
        }
    }

    /** What happens for everyone when the last part of a team task is done. */
    private function teamDone(int $event, string $key, array $it, int $needed, string $sceneKey): void
    {
        $done = [$this->cond("team_$key", '>=', $needed)];
        $this->action($event, 'text_overlay', ['text' => $it['team']['success'], 'duration' => 4000], conditions: $done);
        if (! empty($it['share'])) {
            $this->action($event, 'variable', ['name' => "found_$key", 'operator' => 'set', 'operand' => $it['share']], conditions: $done);
        }
        $this->resolve($event, $it, $done);
        $this->followUps($event, $sceneKey, $key, $done);
    }

    /** The question as an indirect event, with one answer event per choice. Returns the question's event id. */
    private function question(int $sceneId, string $sceneKey, string $key, array $it): int
    {
        $q = $it['question'];
        $predict = ($q['purpose'] ?? 'check') === 'predict';
        $ask = $this->event($sceneId, 'indirect', "ask-$key");
        $this->entry[$key] = $ask;
        foreach ($it['dialogue'] ?? [] as $line) {
            $this->dialogue($ask, $line);
        }
        $buttons = [];
        foreach (array_values($q['choices']) as $i => $choice) {
            $n = $i + 1;
            $answer = $this->event($sceneId, 'indirect', "answer-$key-$n");
            $firstTime = [$this->cond("q_{$key}_first", '=', 0)];
            $this->action($answer, 'variable', ['name' => "q_{$key}_answer", 'operator' => 'set', 'operand' => mb_substr((string) $choice['text'], 0, 200)], conditions: $firstTime);
            $this->action($answer, 'variable', ['name' => "q_{$key}_first", 'operator' => 'set', 'operand' => $n], conditions: $firstTime);
            $this->action($answer, 'variable', ['name' => "q_{$key}_tries", 'operator' => '+', 'operand' => 1]);
            if ($predict) {
                // A prediction: nothing is wrong yet. It is recorded, and the student goes to find out.
                $this->complete($answer, $key, $it);
                $this->action($answer, 'infobox', ['content' => '<h3>Prediction noted</h3>'.self::paragraphs($choice['feedback']).'<p><em>Now find out whether you were right!</em></p>']);
                $this->followUps($answer, $sceneKey, $key);
            } elseif (! empty($choice['correct'])) {
                $this->action($answer, 'variable', ['name' => 'score', 'operator' => '+', 'operand' => 1], conditions: [$this->cond("q_{$key}_first", '=', $n), $this->cond("done_$key", '=', 0)]);
                $this->complete($answer, $key, $it);
                $this->action($answer, 'infobox', ['content' => '<h3>That\'s right!</h3>'.self::paragraphs($choice['feedback'])]);
                $this->followUps($answer, $sceneKey, $key);
            } else {
                $this->action($answer, 'infobox', ['content' => '<h3>Not quite</h3>'.self::paragraphs($choice['feedback']).'<p><em>Think about what you have found, then try again.</em></p>']);
            }
            $buttons[] = ['text' => $choice['text'], 'action' => ['type' => 'run_event', 'target_event_id' => $answer]];
        }
        $this->action($ask, 'infobox', [
            'content' => '<h3>'.htmlspecialchars($it['label']).'</h3>'.self::paragraphs($q['prompt']).($predict ? '<p><em>There is no wrong answer yet: what do you think will happen?</em></p>' : ''),
            'call_to_actions' => $buttons, 'dismissible' => false,
        ]);

        if ($predict) {
            $this->evidenceFor($q['objective'] ?? null, [], $key, 'prediction');
        } else {
            $this->evidenceFor($q['objective'] ?? null, $q['standards'] ?? [], $key, 'question');
        }

        return $ask;
    }

    /**
     * The "hands-on experiment" loop. Returns its event id. The setup (lines, the starting value) is one
     * event and the loop another: a repeat starts its event again from the top, so a value set there
     * would be put back at the start on every click.
     */
    private function experiment(int $sceneId, string $sceneKey, string $key, array $it): int
    {
        $x = $it['experiment'];
        $value = "value_$key";
        $menu = "menu_$key";
        $unit = trim((string) ($x['unit'] ?? ''));
        $run = $this->event($sceneId, 'indirect', "experiment-$key");
        $loop = $this->event($sceneId, 'indirect', "experiment-$key-loop");
        $this->entry[$key] = $run;
        foreach ($it['dialogue'] ?? [] as $line) {
            $this->dialogue($run, $line);
        }
        $this->action($run, 'variable', ['name' => $value, 'operator' => 'set', 'operand' => (int) $x['start']], conditions: [$this->cond("done_$key", '=', 0)]);
        $this->action($run, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 1]);
        $this->action($run, 'run_event', ['target_event_id' => $loop]);
        // After the loop: questions and twists that follow it, once it is done.
        $this->followUps($run, $sceneKey, $key, [$this->cond("done_$key", '=', 1)]);

        $intro = ! empty($it['info']) ? self::html($it['info']) : '<h3>'.htmlspecialchars($it['label']).'</h3>';
        $this->action($loop, 'infobox', [
            'content' => $intro.'<p style="font-size:1.4em"><strong>'.htmlspecialchars($x['quantity']).": {{{$value}}}".($unit !== '' ? ' '.htmlspecialchars($unit) : '').'</strong></p>',
            'call_to_actions' => [
                ['text' => $x['increase'], 'action' => ['type' => 'variable', 'name' => $value, 'operator' => '+', 'operand' => 1], 'conditions' => [$this->plain($value, '<', (int) $x['max'])]],
                ['text' => $x['decrease'], 'action' => ['type' => 'variable', 'name' => $value, 'operator' => '-', 'operand' => 1], 'conditions' => [$this->plain($value, '>', (int) $x['min'])]],
                ['text' => 'Step away', 'action' => ['type' => 'variable', 'name' => $menu, 'operator' => 'set', 'operand' => 0]],
            ],
            'dismissible' => false,
        ]);
        $reached = [$this->cond($value, '=', (int) $x['target'])];
        $this->complete($loop, $key, $it, $reached);
        $this->action($loop, 'infobox', ['content' => '<h3>You did it!</h3>'.self::paragraphs($x['success']).$this->sharedNote($it)], conditions: [...$reached, $this->cond($menu, '=', 1)]);
        $this->action($loop, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 0], conditions: $reached);
        $this->action($loop, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]], conditions: $reached);
        $this->action($loop, 'repeat', [], conditions: [$this->cond($menu, '=', 1)]);

        $this->evidenceFor($x['objective'] ?? null, [], $key, 'experiment');

        return $run;
    }

    /**
     * A character's click event. It brings the checklist up to date, then runs the first conversation
     * that applies: the final report (guide, once every required step is done), then each of the
     * character's talks whose requirements are met and which has not been had; with none left, a short
     * reminder.
     */
    private function talkDispatcher(int $sceneId, array $c, string $sceneKey): int
    {
        $dispatch = $this->event($sceneId, 'indirect', "chat-{$c['key']}");
        $this->action($dispatch, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
        $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 0]);

        if ($c['key'] === $this->guide) {
            $report = $this->reportEvent($sceneId, $c, $sceneKey);
            $this->action($dispatch, 'run_event', ['target_event_id' => $report], conditions: [...$this->readyConditions(), $this->cond('mission_complete', '=', 0)]);
        }

        foreach ($this->interactions as $key => $it) {
            if ($it['type'] !== 'talk' || ($it['character'] ?? '') !== $c['key']) {
                continue;
            }
            $talk = $this->event($sceneId, 'indirect', "talk-$key");
            $this->entry[$key] = $talk;
            $this->action($talk, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1]);
            if (in_array('wave', $c['gestures'] ?? [], true)) {
                $this->action($talk, 'animate', ['target' => 'character', 'character_id' => $this->characterIds[$c['key']][0], 'animation' => 'wave'], blocking: false);
            }
            $this->action($talk, 'freeze', ['frozen' => true]);
            foreach ($it['dialogue'] as $line) {
                $this->dialogue($talk, $line);
            }
            $this->action($talk, 'freeze', ['frozen' => false]);
            $this->complete($talk, $key, $it);
            $this->followUps($talk, $sceneKey, $key);
            $requires = [];
            foreach ($it['requires'] ?? [] as $r) {
                array_push($requires, ...$this->requirement($r));
            }
            $this->action($dispatch, 'run_event', ['target_event_id' => $talk], conditions: [...$requires, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)]);
            if (! empty($it['locked_hint']) && count($it['requires'] ?? []) === 1 && ($negated = $this->negation($it['requires'][0]))) {
                $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $it['locked_hint']], [...$negated, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)], style: 'bubble');
                $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1], conditions: [...$negated, $this->cond("done_$key", '=', 0)]);
            }
        }
        $reminder = $c['key'] === $this->guide ? 'Check your mission checklist, {{QBLPlayerName}}. Your crew is counting on you!' : 'Good luck with the mission, {{QBLPlayerName}}!';
        $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $reminder], [$this->cond('talked', '=', 0)], style: 'bubble');

        return $dispatch;
    }

    /**
     * The final report. The guide opens the crew log, asks the debrief questions not yet answered, and,
     * once every one is answered right, celebrates and completes the mission. With a question still
     * wrong, the student is sent to think again and comes back.
     */
    private function reportEvent(int $sceneId, array $c, string $sceneKey): int
    {
        $charId = $this->characterIds[$c['key']][0];
        $debrief = array_keys(array_filter($this->interactions, fn ($it) => $it['type'] === 'question' && ! empty($it['at_report'])));
        $report = $this->event($sceneId, 'indirect', 'report');
        $this->action($report, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1]);
        $this->action($report, 'freeze', ['frozen' => true]);
        if ($debrief) {
            $this->dialogue($report, ['speaker' => $c['key'], 'text' => $this->blueprintCompletion['debrief'] ?? 'Welcome back, crew! Before we finish, tell me what you worked out.']);
            if ($log = $this->crewLog()) {
                $this->action($report, 'infobox', ['content' => '<h3>Your crew log</h3>'.$log]);
            }
            $this->action($report, 'variable', ['name' => 'report_ok', 'operator' => 'set', 'operand' => 1]);
            foreach ($debrief as $q) {
                $this->action($report, 'run_event', ['target_event_id' => $this->entry[$q]], conditions: [$this->cond("done_$q", '=', 0)]);
                $this->action($report, 'variable', ['name' => 'report_ok', 'operator' => 'set', 'operand' => 0], conditions: [$this->cond("done_$q", '=', 0)]);
            }
            $this->dialogue($report, ['speaker' => $c['key'], 'text' => 'Hmm, not everything adds up yet. Look at what you found again, then come back and tell me.'], [$this->cond('report_ok', '=', 0)]);
        }

        $finale = $this->event($sceneId, 'indirect', 'finale');
        // "cheer" when it was drawn; otherwise the built-in jump.
        $this->action($finale, 'animate', ['target' => 'character', 'character_id' => $charId, 'animation' => in_array('cheer', $c['gestures'] ?? [], true) ? 'cheer' : 'jump'], blocking: false);
        foreach ($this->blueprintCompletion['dialogue'] ?? [] as $line) {
            $this->dialogue($finale, $line);
        }
        $this->action($finale, 'variable', ['name' => 'mission_complete', 'operator' => 'set', 'operand' => 1]);
        $this->action($finale, 'award', $this->blueprintCompletion['award'], blocking: false);
        $this->action($finale, 'text_overlay', ['text' => 'Mission complete!', 'text_font_size' => 48, 'duration' => 3500]);
        if ($this->graded) {
            $this->action($finale, 'text_overlay', ['text' => "Questions right on the first try: {{score}} of {$this->graded}", 'text_font_size' => 30, 'duration' => 4000]);
        }
        $this->action($finale, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);

        $this->action($report, 'run_event', ['target_event_id' => $finale], conditions: $debrief ? [$this->cond('report_ok', '=', 1)] : []);
        $this->action($report, 'freeze', ['frozen' => false]);

        return $report;
    }

    /**
     * What a character does on their own, run by the game server for everyone: pace either side of
     * their spot, and now and then say one of their lines in a bubble.
     */
    private function routine(array $c, int $x, int $feet): ?array
    {
        $chatter = array_values(array_filter((array) ($c['chatter'] ?? []), fn ($l) => is_string($l) && trim($l) !== ''));
        $say = fn (int $i) => isset($chatter[$i]) ? [['type' => 'dialogue', 'text' => mb_substr($chatter[$i], 0, 120)]] : [];
        if ($this->wanders($c)) {
            return ['steps' => [
                ['type' => 'walk', 'to' => 'point', 'position_x' => max(230, $x - self::WANDER), 'position_y' => $feet],
                ['type' => 'wait', 'duration' => 2500],
                ...$say(0),
                ['type' => 'walk', 'to' => 'point', 'position_x' => min(self::WIDTH - 230, $x + self::WANDER), 'position_y' => $feet],
                ['type' => 'wait', 'duration' => 3500],
                ...$say(1),
            ], 'loop' => true];
        }
        if ($chatter) {
            return ['steps' => [['type' => 'wait', 'duration' => 9000], ...$say(0), ['type' => 'wait', 'duration' => 14000], ...$say(1)], 'loop' => true];
        }

        return null;
    }

    /** Whether a character paces about: never the guide, whom students must be able to find. */
    private function wanders(array $c): bool
    {
        return ! empty($c['wanders']) && $c['key'] !== $this->guide;
    }

    /**
     * Marks an interaction done: adds to the counters of its steps (once), sets its flag, gives its
     * award, writes what it found into the crew log, clears a twist it sets right. $when: further
     * conditions on all of it (an experiment's target being reached).
     */
    private function complete(int $event, string $key, array $it, array $when = []): void
    {
        $first = [...$when, $this->cond("done_$key", '=', 0)];
        foreach ($this->stepsWith($key) as $s) {
            if ($this->counted($this->steps[$s])) {
                $this->action($event, 'variable', ['name' => "count_$s", 'operator' => '+', 'operand' => 1], conditions: $first);
            }
        }
        if (! empty($it['award'])) {
            $this->action($event, 'award', $it['award'], blocking: false, conditions: $first);
        }
        if (! empty($it['share'])) {
            $this->action($event, 'variable', ['name' => "found_$key", 'operator' => 'set', 'operand' => $it['share']], conditions: $first);
        }
        $this->resolve($event, $it, $when);
        if ($this->shared($key)) {
            $this->action($event, 'variable', ['name' => "did_$key", 'operator' => 'set', 'operand' => 1], conditions: $when);
        }
        $this->action($event, 'variable', ['name' => "done_$key", 'operator' => 'set', 'operand' => 1], conditions: $when);
    }

    /** An interaction that sets a twist right clears the way (for everyone). */
    private function resolve(int $event, array $it, array $when): void
    {
        $twist = $it['resolves'] ?? null;
        if (! $twist || ! isset($this->twists[$twist]) || (empty($this->twists[$twist]['blocks']) && empty($this->twists[$twist]['obstacle']))) {
            return;
        }
        $this->action($event, 'text_overlay', ['text' => 'The way is clear again!', 'text_font_size' => 34, 'duration' => 3000], blocking: false, conditions: [...$when, $this->cond("blocked_$twist", '=', 1)]);
        $this->action($event, 'variable', ['name' => "blocked_$twist", 'operator' => 'set', 'operand' => 0], conditions: $when);
    }

    /** After an interaction is done: bring the checklist up to date, then any question and any twist that follows it. */
    private function followUps(int $event, string $sceneKey, string $key, array $when = []): void
    {
        $this->action($event, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
        foreach ($this->interactions as $qk => $q) {
            if ($q['type'] === 'question' && ($q['after'] ?? null) === $key) {
                // The question's event is created when its scene's interactions are built; it is run from here later.
                $this->pendingFollowUps[] = [$event, $qk, $when];
            }
        }
        foreach ($this->twists as $tk => $t) {
            $after = $t['after'] ?? '';
            if ($after === $key) {
                $this->pendingTwists[] = [$event, $tk, $sceneKey, $when];
            } elseif (isset($this->steps[$after]) && in_array($key, $this->steps[$after]['done_when'], true)) {
                // After a step: whichever of its interactions is done last sets it off.
                $this->pendingTwists[] = [$event, $tk, $sceneKey, [...$when, ...$this->stepConditions($after)]];
            }
        }
    }

    // ===================================================================== twists

    /** The scene a twist happens in: where the interaction it follows is (null after a step). */
    private function twistScene(string $twist): ?string
    {
        return $this->interactions[$this->twists[$twist]['after'] ?? '']['scene'] ?? null;
    }

    /** The twist, if any, that blocks the way from this scene to that one. */
    private function blockingTwist(string $scene, string $to): ?string
    {
        foreach ($this->twists as $tk => $t) {
            if (($t['blocks']['to'] ?? null) === $to && $this->twistScene($tk) === $scene) {
                return $tk;
            }
        }

        return null;
    }

    /**
     * The twist itself, in the scene where it is set off, shown to everyone there: the big announcement,
     * a startled hop, what the characters say about it; the way it blocks closes for the whole crew.
     */
    private function twistEvent(string $twist, string $sceneKey): int
    {
        if (isset($this->twistEvents["$twist|$sceneKey"])) {
            return $this->twistEvents["$twist|$sceneKey"];
        }
        $t = $this->twists[$twist];
        $e = $this->event($this->sceneIds[$sceneKey], 'indirect', "twist-$twist", ['audience' => 'scene']);
        $this->twistEvents["$twist|$sceneKey"] = $e;
        $this->action($e, 'variable', ['name' => "twist_$twist", 'operator' => 'set', 'operand' => 1]);
        $this->action($e, 'variable', ['name' => "seen_twist_$twist", 'operator' => 'set', 'operand' => 1]);
        if (! empty($t['blocks']) || ! empty($t['obstacle'])) {
            $this->action($e, 'variable', ['name' => "blocked_$twist", 'operator' => 'set', 'operand' => 1]);
        }
        $this->action($e, 'animate', ['target' => 'player', 'animation' => 'jump'], blocking: false);
        $this->action($e, 'text_overlay', ['text' => $t['title'], 'text_font_size' => 54, 'duration' => 2600]);
        $this->action($e, 'freeze', ['frozen' => true]);
        foreach ($t['dialogue'] ?? [] as $line) {
            $this->dialogue($e, $line);
        }
        $this->action($e, 'freeze', ['frozen' => false]);
        if (! empty($t['award']) && (! empty($t['award']['stars']) || ! empty($t['award']['xp']))) {
            $this->action($e, 'award', $t['award'], blocking: false);
        }
        $this->action($e, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);

        return $e;
    }

    /**
     * Where a twist's obstacle stands: [x as a fraction, or null to be spread like anything else; feet].
     * In front of the doorway, door or hole it blocks, or beside the edge it blocks.
     */
    private function obstacleSpot(array $t, array $ends, int $ground): array
    {
        $floor = self::HEIGHT - $ground;
        foreach ($ends as $end) {
            if ($end['to'] !== ($t['blocks']['to'] ?? null)) {
                continue;
            }
            if ($end['via'] !== 'edge') {
                return [$end['x'], Connections::inFloor($end['via']) ? $ground + (int) ($floor * 0.42) + 30 : $ground + (int) ($floor * 0.2)];
            }

            return match ($end['edge']) {
                'top' => [0.5, $ground + (int) ($floor * 0.22)],
                'left' => [0.1, $ground + (int) ($floor * 0.45)],
                'right' => [0.9, $ground + (int) ($floor * 0.45)],
                default => [0.5, self::HEIGHT - 60],
            };
        }

        return [null, $ground + (int) ($floor * 0.3)];
    }

    /** The obstacle a twist leaves in its scene: solid, there until the twist is set right. */
    private function obstacle(int $sceneId, string $twist, array $t, int $x, int $feet): void
    {
        [$mediaId, $asset, $item] = $this->itemMedia[$t['obstacle']['item']] ?? [null, null, null];
        if (! $mediaId) {
            return;
        }
        $cy = $feet - (int) ($asset['height'] / 2);
        $hot = $this->hotspot($sceneId, "obstacle-$twist", [$x, $cy], (int) max(90, min(200, $asset['width'] / 2)), click: true, conditions: [$this->cond("blocked_$twist", '=', 1)]);
        $this->label($hot, 'image', $x, $cy, mediaId: $mediaId, params: ['placement' => 'object', 'solid' => true, 'solid_radius' => (int) max(40, $asset['width'] * 0.4)]);
        $this->text($hot, $x, $cy - (int) ($asset['height'] / 2) - 30, $item['name']);
        $this->action($hot, 'text_overlay', ['text' => $t['blocks']['message'] ?? "The {$item['name']} is in the way. Your crew must deal with it.", 'duration' => 3000]);
    }

    // ===================================================================== roles

    /**
     * The crew station's events: a menu with the roles, how many of the crew have each, the crew log and
     * a button per role; choosing a role says what it does and lists its jobs, with where they are.
     */
    private function roleEvents(int $sceneId, string $sceneKey): void
    {
        $menu = $this->event($sceneId, 'indirect', 'crew-menu');
        $this->roleMenu = $menu;
        $list = '';
        $buttons = [];
        foreach ($this->roles as $rk => [$n, $role]) {
            $list .= '<li><strong>'.htmlspecialchars($role['name'])."</strong> ({{crew_$rk}} in the crew): ".htmlspecialchars($role['description']).'</li>';
            $choose = $this->event($sceneId, 'indirect', "choose-$rk");
            foreach ($this->roles as $other => [$m]) {
                if ($other !== $rk) {
                    $this->action($choose, 'variable', ['name' => "crew_$other", 'operator' => '-', 'operand' => 1], conditions: [$this->cond('my_role', '=', $m), $this->cond("crew_$other", '>', 0)]);
                }
            }
            $this->action($choose, 'variable', ['name' => "crew_$rk", 'operator' => '+', 'operand' => 1], conditions: [$this->cond('my_role', '!=', $n)]);
            $this->action($choose, 'variable', ['name' => 'my_role', 'operator' => 'set', 'operand' => $n]);
            $this->action($choose, 'variable', ['name' => 'role_name', 'operator' => 'set', 'operand' => $role['name']]);
            $this->action($choose, 'variable', ['name' => 'counted_role', 'operator' => 'set', 'operand' => 1]);
            $this->action($choose, 'animate', ['target' => 'player', 'animation' => 'jump'], blocking: false);
            $this->action($choose, 'infobox', ['content' => '<h3>You are the '.htmlspecialchars($role['name']).'</h3>'.self::paragraphs($role['description']).$this->jobsOf($rk).'<p><em>What each role finds goes into the crew log here at the crew station. You can change roles here at any time.</em></p>']);
            $this->action($choose, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
            // Always offered: choosing the role one already has shows its jobs again.
            $buttons[] = ['text' => 'Be the '.$role['name'], 'action' => ['type' => 'run_event', 'target_event_id' => $choose]];
        }
        $buttons[] = ['text' => 'Done', 'action' => ['type' => 'variable', 'name' => 'talked', 'operator' => 'set', 'operand' => 0], 'conditions' => [$this->plain('my_role', '>', 0)]];
        $log = $this->crewLog();
        $this->action($menu, 'infobox', [
            'content' => '<h3>Crew station</h3><p>Every crew member has a role with jobs only they can do. Your role: <strong>{{role_name}}</strong></p><ul>'.$list.'</ul>'.($log ? '<h4>Crew log</h4>'.$log : ''),
            'call_to_actions' => $buttons, 'dismissible' => false,
        ]);
    }

    /** The crew station itself, in the start scene. */
    private function station(int $sceneId, int $x, int $ground): void
    {
        [$mediaId, $asset] = $this->itemMedia['__marker'] ?? [null, null];
        $h = $asset ? (int) $asset['height'] : 0;
        $cy = $ground + 12 - (int) ($h / 2);
        $hot = $this->hotspot($sceneId, 'crew-station', [$x, $cy], 100, click: true, block: true);
        if ($mediaId) {
            $this->label($hot, 'image', $x, $cy, mediaId: $mediaId);
        }
        $this->text($hot, $x, $cy - (int) max(50, $h / 2 + 30), 'Crew station');
        $this->action($hot, 'run_event', ['target_event_id' => $this->roleMenu]);
    }

    /** A role's jobs, each with the scene it is in, as a list for the student who chose it. */
    private function jobsOf(string $role): string
    {
        $titles = array_map(fn ($s) => $s['title'], $this->scenesByKey);
        $jobs = [];
        foreach ($this->interactions as $it) {
            if (($it['role'] ?? null) === $role) {
                $jobs[] = htmlspecialchars($it['label']).' <em>('.htmlspecialchars($titles[$it['scene']] ?? $it['scene']).')</em>';
            }
            foreach ($it['team']['roles'] ?? [] as $part) {
                if ($part['role'] === $role) {
                    $jobs[] = htmlspecialchars($it['label']).' with your crew: you '.htmlspecialchars(preg_replace('/^(\w+)s\b/', '$1', $part['part'])).' <em>('.htmlspecialchars($titles[$it['scene']] ?? $it['scene']).')</em>';
                }
            }
        }

        return $jobs ? '<p>Your jobs:</p><ul><li>'.implode('</li><li>', $jobs).'</li></ul>' : '';
    }

    /** What the crew has found so far, from the shared crew log variables; empty when nothing is logged. */
    private function crewLog(): string
    {
        $lines = [];
        foreach ($this->interactions as $key => $it) {
            if (empty($it['share'])) {
                continue;
            }
            $who = ! empty($it['role']) && isset($this->roles[$it['role']]) ? $this->roles[$it['role']][1]['name'].', ' : '';
            $lines[] = '<li><strong>'.htmlspecialchars($who.$it['label'])."</strong>: {{found_$key}}</li>";
        }

        return $lines ? '<ul>'.implode('', $lines).'</ul>' : '';
    }

    /** Under a role's finding, that it went into the crew log. */
    private function sharedNote(array $it): string
    {
        return ! empty($it['share']) ? '<p><em>Added to the crew log: '.htmlspecialchars($it['share']).'</em></p>' : '';
    }

    /** "(Botanist, Engineer)" after a checklist line whose jobs belong to roles. */
    private function roleNote(array $step): string
    {
        $names = [];
        foreach ($step['done_when'] as $k) {
            $it = $this->interactions[$k] ?? [];
            if (! empty($it['role']) && isset($this->roles[$it['role']])) {
                $names[$this->roles[$it['role']][1]['name']] = true;
            }
        }

        return $names ? ' ('.implode(', ', array_keys($names)).')' : '';
    }

    /** Whether an interaction is done once for the whole crew (a role's job) rather than by each student. */
    private function shared(string $key): bool
    {
        $it = $this->interactions[$key] ?? [];

        return ! empty($it['role']) && isset($this->roles[$it['role']]) && $it['type'] !== 'team_task';
    }

    /**
     * Each scene has one: sets each step's flag once its interactions are done, changes the guide's
     * label when the mission is ready to report, and tells the student so, once.
     */
    private function refreshEvent(int $sceneId): int
    {
        $e = $this->event($sceneId, 'indirect', 'refresh');
        foreach ($this->steps as $key => $s) {
            $this->action($e, 'variable', ['name' => "step_$key", 'operator' => 'set', 'operand' => 1], conditions: [...$this->stepConditions($key), $this->cond("step_$key", '=', 0)]);
        }
        $guide = $this->characterIds[$this->guide][1];
        $ready = $this->readyConditions();
        $this->action($e, 'variable', ['name' => "label_{$this->guide}", 'operator' => 'set', 'operand' => $this->blueprintCompletion['label']], conditions: [...$ready, $this->cond('mission_complete', '=', 0)]);
        $this->action($e, 'variable', ['name' => "label_{$this->guide}", 'operator' => 'set', 'operand' => 'Talk to '.$guide['name']], conditions: [$this->cond('mission_complete', '=', 1)]);
        $this->action($e, 'text_overlay', ['text' => 'Every task is done! '.$this->blueprintCompletion['label'].'.', 'duration' => 4000], blocking: false, conditions: [...$ready, $this->cond('ready_hinted', '=', 0)]);
        $this->action($e, 'variable', ['name' => 'ready_hinted', 'operator' => 'set', 'operand' => 1], conditions: $ready);

        return $e;
    }

    // ===================================================================== conditions

    /**
     * What "done" means for a requirement key: an interaction's flag (shared for a role's job), a team's
     * count, a twist having happened, or all of a step's interactions (read live, so a step a teammate
     * finished counts at once).
     */
    private function requirement(string $key): array
    {
        if (isset($this->steps[$key])) {
            return $this->stepConditions($key);
        }
        if (isset($this->twists[$key])) {
            return [$this->cond("twist_$key", '=', 1)];
        }
        $it = $this->interactions[$key] ?? throw new GenerationError("Unknown requirement $key.");

        return $it['type'] === 'team_task' ? [$this->cond("team_$key", '>=', $this->teamNeeded($it))] : [$this->cond("done_$key", '=', 1)];
    }

    private function teamNeeded(array $it): int
    {
        return ! empty($it['team']['roles']) ? count($it['team']['roles']) : (int) $it['team']['needed'];
    }

    /** The opposite of requirement(), when it is a single condition. */
    private function negation(string $key): ?array
    {
        $c = $this->requirement($key);
        $flip = ['=' => '!=', '>=' => '<'];

        return count($c) === 1 ? [$this->cond($c[0]['variable'], $flip[$c[0]['operator']], $c[0]['operand'])] : null;
    }

    /** The live conditions of a step: all its interactions done. */
    private function stepConditions(string $key): array
    {
        $out = [];
        foreach ($this->steps[$key]['done_when'] as $k) {
            array_push($out, ...$this->requirement($k));
        }

        return $out;
    }

    /** Every required step done, read live. */
    private function readyConditions(): array
    {
        $out = [];
        foreach ($this->steps as $key => $s) {
            if (empty($s['optional'])) {
                array_push($out, ...$this->stepConditions($key));
            }
        }

        return array_values(array_unique($out, SORT_REGULAR));
    }

    private function stepsWith(string $interaction): array
    {
        return array_keys(array_filter($this->steps, fn ($s) => in_array($interaction, $s['done_when'], true)));
    }

    /** Whether a step shows a count: several interactions, each one every student does (not a team's or a role's, whose progress is shared). */
    private function counted(array $step): bool
    {
        return count($step['done_when']) > 1
            && ! array_filter($step['done_when'], fn ($k) => ($this->interactions[$k]['type'] ?? '') === 'team_task' || ! empty($this->interactions[$k]['role']));
    }

    // ===================================================================== evidence

    private function evidenceFor(?string $objective, array $codes, string $key, string $type): void
    {
        $this->evidenceLog[] = ['objective' => $objective, 'codes' => $codes, 'interaction' => $key, 'type' => $type];
    }

    private function evidenceVariables(array $alignment): array
    {
        $out = [];
        foreach ($alignment['learning_objectives'] as $lo) {
            $items = [];
            foreach ($this->evidenceLog as $e) {
                if ($e['objective'] === $lo['id']) {
                    $k = $e['interaction'];
                    $items[] = match ($e['type']) {
                        'question' => ['interaction' => $k, 'type' => 'question', 'correct' => "done_$k", 'first_answer' => "q_{$k}_first", 'answer' => "q_{$k}_answer", 'tries' => "q_{$k}_tries"] + (! empty($this->interactions[$k]['at_report']) ? ['debrief' => true] : []),
                        'prediction' => ['interaction' => $k, 'type' => 'prediction', 'answer' => "q_{$k}_answer"],
                        default => ['interaction' => $k, 'type' => 'experiment', 'completed' => $this->shared($k) ? "did_$k" : "done_$k"],
                    };
                }
            }
            $out[] = ['objective' => $lo['id'], 'standards' => $lo['standards'], 'evidence' => $items];
            foreach ($lo['standards'] as $code) {
                foreach ($items as $item) {
                    if ($item['type'] !== 'prediction') {
                        $this->evidence[$code][] = ['objective' => $lo['id']] + $item;
                    }
                }
            }
        }
        foreach ($this->evidenceLog as $e) {
            foreach ($e['codes'] as $code) {
                if (isset($this->evidence[$code]) || in_array($code, array_column($alignment['standards'], 'code'), true)) {
                    $this->evidence[$code][] = ['interaction' => $e['interaction'], 'type' => $e['type']];
                }
            }
        }

        return $out;
    }

    // ========================================================================= rows

    private function id(string $table): int
    {
        return $this->next[$table] = ($this->next[$table] ?? 0) + 1;
    }

    private function variable(string $name, mixed $default, string $scope = 'player', bool $persist = true): void
    {
        if (isset($this->vars[$name])) {
            return;
        }
        $this->vars[$name] = true;
        $this->rows['variables'][] = ['id' => $this->id('variables'), 'variable_name' => $name, 'default_value' => $default, 'scope' => $scope, 'persist' => $persist];
    }

    private function media(string $name, array $asset, int $priority): int
    {
        // One picture used in two places (the same door drawn for two scenes) is one media entry.
        if (isset($this->mediaByPath[$asset['path']])) {
            return $this->mediaByPath[$asset['path']];
        }
        $id = $this->id('media');
        $file = $name.'.'.strtolower(pathinfo($asset['path'], PATHINFO_EXTENSION) ?: 'png');
        $this->rows['media'][] = [
            'id' => $id, 'type' => 'image', 'filename' => $file, 'url' => "assets/$file", 'scale_x' => 1, 'scale_y' => 1,
            'width' => (int) $asset['width'], 'height' => (int) $asset['height'], 'priority' => $priority, 'params' => $asset['params'] ?? null,
        ];
        $this->files[$file] = $asset['path'];

        return $this->mediaByPath[$asset['path']] = $id;
    }

    private function event(int $sceneId, string $kind, string $shortname, array $extra = []): int
    {
        $id = $this->id('events');
        $this->rows['events'][] = $extra + [
            'id' => $id, 'scene_id' => $sceneId, 'kind' => $kind, 'shortname' => mb_substr($shortname, 0, 60), 'sequence' => $id,
            'overridable' => false, 'block_hotspots' => false, 'position_x' => null, 'position_y' => null, 'radius' => null, 'activate_by_trigger' => false, 'once' => false, 'audience' => 'player',
        ];

        return $id;
    }

    /** @param array{0: ?int, 1: ?int} $at */
    private function hotspot(int $sceneId, string $shortname, array $at, int $radius, bool $click, array $conditions = [], bool $block = false, string $audience = 'player', bool $reveal = false): int
    {
        $id = $this->event($sceneId, 'hotspot', $shortname, [
            'position_x' => $at[0], 'position_y' => $at[1], 'radius' => $radius, 'activate_by_trigger' => $click, 'block_hotspots' => $block, 'audience' => $audience,
        ] + ($reveal ? ['reveal_radius' => self::REVEAL[0], 'reveal_full_radius' => self::REVEAL[1]] : []));
        foreach ($conditions as $c) {
            $this->rows['conditions'][] = ['id' => $this->id('conditions'), 'event_id' => $id, 'action_id' => null] + $c;
        }

        return $id;
    }

    private function action(int $event, string $type, array $params, bool $blocking = true, array $conditions = []): int
    {
        $id = $this->id('actions');
        $this->rows['actions'][] = ['id' => $id, 'event_id' => $event, 'type' => $type, 'sequence' => $id, 'blocking' => $blocking, 'media_id' => null, 'params' => $params];
        foreach ($conditions as $c) {
            $this->rows['conditions'][] = ['id' => $this->id('conditions'), 'event_id' => null, 'action_id' => $id] + $c;
        }

        return $id;
    }

    private function label(int $event, string $type, int $x, int $y, ?string $text = null, ?int $mediaId = null, array $params = []): void
    {
        $this->rows['labels'][] = ['id' => $this->id('labels'), 'event_id' => $event, 'type' => $type, 'position_x' => $x, 'position_y' => $y, 'scale_x' => 1, 'scale_y' => 1, 'text' => $text, 'media_id' => $mediaId] + ($params ? ['params' => $params] : []);
    }

    /**
     * A text label, moved up a line while it would run into one already in this scene. Twins of one
     * hotspot (the same text at the same spot) share their place. $measure: the text to measure by, when
     * $text is a placeholder.
     */
    private function text(int $event, int $x, int $y, string $text, ?string $measure = null): void
    {
        $width = self::labelWidth($measure ?? $text);
        $key = "$x|$y";
        if (! isset($this->labelSlots[$key])) {
            $placed = $y;
            for ($tries = 0; $tries < 6; $tries++) {
                $clash = false;
                foreach ($this->labelSlots as [$ox, $oy, $ow]) {
                    if (abs($oy - $placed) < 40 && abs($ox - $x) < ($ow + $width) / 2 + 20) {
                        $clash = true;
                        break;
                    }
                }
                if (! $clash) {
                    break;
                }
                $placed -= 50;
            }
            $this->labelSlots[$key] = [$x, $placed, $width];
        }
        $this->label($event, 'text', $x, $this->labelSlots[$key][1], text: $text);
    }

    private function dialogue(int $event, array $line, array $conditions = [], string $style = 'portrait'): void
    {
        $params = ['style' => $style, 'text' => mb_substr((string) $line['text'], 0, 250)];
        if (($line['speaker'] ?? 'player') !== 'player' && isset($this->characterIds[$line['speaker']])) {
            $params += ['speaker' => 'character', 'character_id' => $this->characterIds[$line['speaker']][0]];
        }
        $this->action($event, 'dialogue', $params, conditions: $conditions);
    }

    private function cond(string $variable, string $operator, mixed $operand): array
    {
        return ['type' => 'variable', 'variable' => $variable, 'operator' => $operator, 'operand' => $operand];
    }

    /** A condition inside an infobox button, which is written into the action's params as it is in the document. */
    private function plain(string $variable, string $operator, mixed $operand): array
    {
        return ['variable' => $variable, 'operator' => $operator, 'operand' => $operand];
    }

    // ======================================================================= helpers

    /**
     * Positions along the width for things that must not overlap: keeps their order and wished-for
     * places where it can, and spaces them at least $gap apart between $min and $max. Things in $fixed
     * (a doorway, a door, a hole) stay exactly where they are, and the rest are spread on either side of them.
     *
     * @param  array<string, float>  $wanted  fractions of the width
     * @param  array<string, float>  $fixed  fractions of the width
     * @return array<string, int>
     */
    public static function spread(array $wanted, int $gap, int $min, int $max, array $fixed = []): array
    {
        $wanted = array_diff_key($wanted, $fixed);
        if (! $fixed) {
            return self::spreadBetween($wanted, $gap, $min, $max);
        }
        asort($fixed);
        $out = [];
        $from = $min;
        $rest = $wanted;
        foreach ($fixed as $key => $f) {
            $x = (int) round($f * self::WIDTH);
            $out[$key] = $x;
            $left = array_filter($rest, fn ($v) => $v * self::WIDTH < $x);
            $rest = array_diff_key($rest, $left);
            $out += self::spreadBetween($left, $gap, $from, $x - $gap);
            $from = $x + $gap;
        }

        return $out + self::spreadBetween($rest, $gap, $from, $max);
    }

    private static function spreadBetween(array $wanted, int $gap, int $min, int $max): array
    {
        asort($wanted);
        $keys = array_keys($wanted);
        $xs = array_map(fn ($f) => (int) max($min, min($max, round($f * self::WIDTH))), array_values($wanted));
        $n = count($xs);
        if ($n === 0) {
            return [];
        }
        if ($max < $min) {
            // No room on this side: share the one spot. Rare; only with many things crowded by a doorway.
            return array_fill_keys($keys, $min);
        }
        if (($n - 1) * $gap > $max - $min) {
            $gap = (int) (($max - $min) / max(1, $n - 1));
        }
        for ($i = 1; $i < $n; $i++) {
            $xs[$i] = max($xs[$i], $xs[$i - 1] + $gap);
        }
        // Pushed past the right side: pull back from the right.
        if ($xs[$n - 1] > $max) {
            $xs[$n - 1] = $max;
            for ($i = $n - 2; $i >= 0; $i--) {
                $xs[$i] = min($xs[$i], $xs[$i + 1] - $gap);
            }
        }

        return array_combine($keys, $xs);
    }

    /** Roughly how wide a text label is drawn, in scene pixels. */
    public static function labelWidth(string $text): int
    {
        return 14 * mb_strlen($text) + 24;
    }

    private static function html(array $info): string
    {
        return '<h3>'.htmlspecialchars((string) $info['title']).'</h3>'.self::paragraphs((string) $info['body']);
    }

    private static function paragraphs(string $text): string
    {
        $out = '';
        foreach (preg_split('/\n\s*\n/', trim($text)) as $p) {
            $out .= '<p>'.nl2br(htmlspecialchars(trim($p))).'</p>';
        }

        return $out;
    }

    public static function slug(string $title): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', '-', strtolower($title)), '-') ?: 'mission';
    }
}
