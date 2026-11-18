<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Generation\GenerationError;

/**
 * Turns a mission blueprint and its pictures into rows of the QBL tables (the shape of
 * database/seeders/data/starship.php), which ScenarioCompiler makes into the scenario document.
 *
 * Every interaction becomes events and actions by one of the patterns in docs/docs/extensions.md
 * ("Patterns"), so what the language model wrote is never trusted to be valid JSON for the runtime:
 *
 *   talk        a character's click event runs a dispatcher that picks the conversation that applies
 *   collect     a click hotspot with the item as its label; it disappears once taken
 *   inspect     a click hotspot that opens an infobox
 *   question    a non-dismissible infobox whose buttons run one answer event each; the first answer is
 *               recorded, every answer explained, and the student may try again until right
 *   experiment  the "hands-on experiment" loop: buttons move a value, reaching the target completes it
 *   team_task   a shared (room) counter each student adds to once; shown to the whole scene
 *
 * Progress is kept in variables, which the checklist, the conditions and teacher reports read:
 * done_<interaction> (1 when done; for a question, when answered correctly), q_<key>_first (the first
 * answer chosen, 1-based), q_<key>_tries, score (questions right first time), team_<key> (shared).
 */
class MissionBuilder
{
    public const WIDTH = 2250;

    public const HEIGHT = 1200;

    /** Walk-in radius of each edge. The top edge is a doorway at the centre back of the floor, not the whole line, so things standing along the back can be reached. */
    private const EDGE_RADIUS = ['left' => 35, 'right' => 35, 'top' => 90, 'bottom' => 25];

    private array $rows;

    private array $next = [];

    private array $files = [];

    private array $vars = [];

    /** scene key => scene id; character key => [id, row]; item key => [media id, asset] */
    private array $sceneIds = [];

    private array $characterIds = [];

    private array $itemMedia = [];

    /** interaction key => blueprint row */
    private array $interactions = [];

    private array $steps = [];

    /** scene key => indirect event id of its refresh event */
    private array $refresh = [];

    /** interaction key => indirect event id run to start it (questions, talks, experiments) */
    private array $entry = [];

    private string $guide;

    private array $evidence = [];

    /**
     * @param  array  $blueprint  A blueprint BlueprintValidator accepts.
     * @param  array  $alignment  StandardsAligner::align().
     * @param  array<string, array{path: string, width: int, height: int, params?: array, frame_width?: int, frame_height?: int}>  $assets
     *                                                                                                                                      "bg:<scene>", "char:<key>", "portrait:<key>", "item:<key>", "badge".
     * @param  array{min_players?: int, max_players?: int, generation_id?: ?int, style?: string}  $options
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
        $minPlayers = max(1, (int) ($options['min_players'] ?? 2));
        $this->blueprintCompletion = $b['completion'];

        // ---------------------------------------------------------------- variables
        $this->variable('score', 0);
        $this->variable('mission_complete', 0);
        $this->variable('intro_seen', 0);
        $this->variable('ready_hinted', 0);
        $this->variable('talked', 0, persist: false);
        foreach ($this->interactions as $key => $it) {
            if ($it['type'] === 'team_task') {
                $this->variable("helped_$key", 0);
                $this->variable("team_$key", 0, 'room');
                $this->interactions[$key]['team']['needed'] = max(1, min((int) $it['team']['needed'], $minPlayers));
            } else {
                $this->variable("done_$key", 0);
            }
            if ($it['type'] === 'question') {
                $this->variable("q_{$key}_first", 0);
                $this->variable("q_{$key}_tries", 0);
            }
            if ($it['type'] === 'experiment') {
                $this->variable("value_$key", (int) $it['experiment']['start']);
                $this->variable("menu_$key", 0, persist: false);
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
            $this->itemMedia['__marker'] = [$this->media('marker', $assets['marker'], 40), $assets['marker'], ['key' => '__marker', 'name' => 'marker', 'kind' => 'tool']];
        }
        $guide = null;
        foreach ($b['characters'] as $c) {
            $sheet = $assets["char:{$c['key']}"] ?? null;
            if (! $sheet) {
                throw new GenerationError("There is no picture for the character {$c['key']}.");
            }
            $mediaId = $this->media("character-{$c['key']}", $sheet, 10);
            $portrait = isset($assets["portrait:{$c['key']}"]) ? $this->media("portrait-{$c['key']}", $assets["portrait:{$c['key']}"], 30) : null;
            $id = $this->id('characters');
            $this->rows['characters'][] = ['id' => $id, 'name' => $c['name'], 'media_id' => $mediaId, 'settings' => array_filter(['scale' => 0.8, 'portrait_media_id' => $portrait])];
            $this->characterIds[$c['key']] = [$id, $c, $sheet];
            if (! empty($c['guide'])) {
                $guide = $c['key'];
            }
            $this->variable("label_{$c['key']}", 'Talk to '.$c['name'], persist: false);
        }
        $this->guide = $guide ?? $b['characters'][0]['key'];

        // ---------------------------------------------------------------- scenes
        $sequence = 0;
        $ordered = $b['scenes'];
        usort($ordered, fn ($a, $c) => ($c['key'] === $b['start_scene']) <=> ($a['key'] === $b['start_scene']));
        foreach ($ordered as $scene) {
            $this->sceneIds[$scene['key']] = $this->id('scenes');
        }
        // Exits are two-way; the blueprint lists each connection once.
        $exits = [];
        foreach ($b['scenes'] as $scene) {
            foreach ($scene['exits'] as $x) {
                $exits[$scene['key']][$x['edge']] = $x;
                $back = ['left' => 'right', 'right' => 'left', 'top' => 'bottom', 'bottom' => 'top'][$x['edge']];
                $exits[$x['to']][$back] ??= ['edge' => $back, 'to' => $scene['key'], 'requires' => $x['requires'] ?? null, 'locked_message' => $x['locked_message'] ?? null];
            }
        }
        foreach ($ordered as $scene) {
            $this->scene($scene, $exits[$scene['key']] ?? [], ++$sequence, $assets, $b);
        }
        // Questions that pop up after another interaction: their events exist now.
        foreach ($this->pendingFollowUps as [$event, $question]) {
            $this->action($event, 'run_event', ['target_event_id' => $this->entry[$question]], conditions: [$this->cond("done_$question", '=', 0)]);
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
        foreach ($b['steps'] as $s) {
            $n = count($s['done_when']);
            $objectives[] = array_filter([
                'id' => $s['key'],
                'text' => $s['text'].($this->counted($s) ? " ({{count_{$s['key']}}}/$n)" : ''),
                'show_when' => ! empty($s['after']) ? $this->stepConditions($s['after']) : null,
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
                ],
                'generated' => array_filter(['by' => 'qbl:generate', 'generation_id' => $options['generation_id'] ?? null, 'art_style' => $options['style'] ?? null, 'at' => gmdate('c')]),
            ],
        ];

        foreach ($alignment['standards'] as $s) {
            $this->evidence[$s['code']] ??= [];
        }

        return ['rows' => $this->rows, 'files' => $this->files, 'evidence' => $this->evidence];
    }

    // ======================================================================== scenes

    private function scene(array $scene, array $exits, int $sequence, array $assets, array $b): void
    {
        $key = $scene['key'];
        $sceneId = $this->sceneIds[$key];
        $ground = (int) round(self::HEIGHT * max(0.5, min(0.85, (float) $scene['ground_line'])));
        $floor = self::HEIGHT - $ground;
        $bg = $assets["bg:$key"] ?? throw new GenerationError("There is no background for the scene $key.");
        $bgId = $this->media("background-$key", $bg, $key === $b['start_scene'] ? 1 : 10 + $sequence);

        // Where things stand. Interactions, characters and props share the width; spread them so none overlap.
        $anchors = [];
        foreach ($b['characters'] as $c) {
            if ($c['scene'] === $key) {
                $anchors["char:{$c['key']}"] = (float) $c['x'];
            }
        }
        foreach ($this->interactions as $ik => $it) {
            if ($it['scene'] === $key && $it['type'] !== 'talk') {
                $anchors["int:$ik"] = (float) ($it['x'] ?? 0.5);
            }
        }
        foreach ($scene['props'] ?? [] as $i => $p) {
            $anchors["prop:$i"] = (float) $p['x'];
        }
        // The doorway of a top exit is at the centre of the back; everything else keeps clear of it.
        $xs = self::spread($anchors, 260, 230, self::WIDTH - 230, isset($exits['top']) ? ['door' => 0.5] : []);

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
            $layoutItems[] = ['item_id' => $itemId, 'position_x' => $xs["prop:$i"], 'position_y' => $ground + (int) ($floor * 0.3)];
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

        // ---- arriving: the scene's name; in the start scene, the guide's briefing the first time
        $start = $this->event($sceneId, 'start', 'arrive');
        $this->action($start, 'text_overlay', ['text' => $scene['title'], 'alignment' => 'top center', 'text_font_size' => 34, 'duration' => 2500], blocking: false);
        if ($key === $b['start_scene']) {
            $intro = $this->conds([$this->cond('intro_seen', '=', 0)]);
            $this->action($start, 'variable', ['name' => 'intro_seen', 'operator' => 'set', 'operand' => 1], conditions: $intro);
            $this->action($start, 'freeze', ['frozen' => true], conditions: $intro);
            foreach ($b['intro']['dialogue'] as $line) {
                $this->dialogue($start, $line, $intro);
            }
            $this->action($start, 'freeze', ['frozen' => false], conditions: $intro);
        }
        $this->action($start, 'run_event', ['target_event_id' => $this->refresh[$key]]);

        // ---- exits
        foreach ($exits as $edge => $x) {
            $to = $x['to'];
            $hot = $this->hotspot($sceneId, "exit-$edge", match ($edge) {
                'left' => [0, null], 'right' => [self::WIDTH, null], 'top' => [(int) (self::WIDTH / 2), $ground], 'bottom' => [null, self::HEIGHT],
            }, self::EDGE_RADIUS[$edge], click: false, conditions: ! empty($x['requires']) ? $this->requirement($x['requires']) : []);
            $this->action($hot, 'jump', ['scene_id' => $this->sceneIds[$to], 'spawn_point' => "from-$key"]);
            if (! empty($x['requires']) && ($negated = $this->negation($x['requires']))) {
                $closed = $this->hotspot($sceneId, "exit-$edge-closed", match ($edge) {
                    'left' => [0, null], 'right' => [self::WIDTH, null], 'top' => [(int) (self::WIDTH / 2), $ground], 'bottom' => [null, self::HEIGHT],
                }, self::EDGE_RADIUS[$edge], click: false, conditions: $negated);
                $this->action($closed, 'text_overlay', ['text' => $x['locked_message'] ?: 'You cannot go this way yet.', 'duration' => 2500]);
            }
            // Where students arrive when they come in through this edge, clear of the edge's own hotspot.
            $spawns[] = match ($edge) {
                'left' => ['name' => "from-$to", 'position_x' => 190, 'position_y' => $ground + (int) ($floor * 0.5)],
                'right' => ['name' => "from-$to", 'position_x' => self::WIDTH - 190, 'position_y' => $ground + (int) ($floor * 0.5), 'facing' => 'left'],
                'top' => ['name' => "from-$to", 'position_x' => (int) (self::WIDTH / 2), 'position_y' => $ground + max(150, (int) ($floor * 0.45))],
                'bottom' => ['name' => "from-$to", 'position_x' => (int) (self::WIDTH / 2), 'position_y' => self::HEIGHT - max(80, (int) ($floor * 0.25))],
            };
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
            // A label over their head, also clickable: "Talk to Dr. Ren", or the report label once the mission is ready.
            $height = (int) (($sheet['frame_height'] ?? $sheet['height']) * 0.8);
            $label = $this->hotspot($sceneId, "label-{$c['key']}", [$x, $feet - (int) ($height / 2)], max(70, (int) ($height / 2)), click: true);
            $this->label($label, 'text', $x, $feet - $height - 30, text: "{{label_{$c['key']}}}");
            $this->action($label, 'run_event', ['target_event_id' => $dispatcher]);
        }

        // ---- the scene's interactions
        foreach ($this->interactions as $ik => $it) {
            if ($it['scene'] !== $key || $it['type'] === 'talk') {
                continue;
            }
            $this->interaction($sceneId, $key, $ik, $it, $xs["int:$ik"], $ground);
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

    // ================================================================== interactions

    private function interaction(int $sceneId, string $sceneKey, string $key, array $it, int $x, int $ground): void
    {
        // Something to see and click: the interaction's item, or the style's marker for interactions without one.
        [$mediaId, $asset] = $this->itemMedia[$it['item'] ?? '__marker'] ?? $this->itemMedia['__marker'] ?? [null, null];
        $high = ! empty($it['high']);
        $h = $asset ? (int) $asset['height'] : 0;
        // On the floor line at the back of the walkable area, or up on a wall.
        $cy = $high ? (int) ($ground * 0.55) : ($asset ? $ground - (int) ($h / 2) + 30 : $ground - 40);
        $radius = $asset ? (int) max(80, min(170, max($asset['width'], $h) / 2 + 20)) : 90;
        $requires = [];
        foreach ($it['requires'] ?? [] as $r) {
            array_push($requires, ...$this->requirement($r));
        }
        $notDone = $it['type'] === 'team_task' ? [] : [$this->cond("done_$key", '=', 0)];

        // What it looks like: the item, if it has one, and its label above.
        $labels = function (int $event) use ($mediaId, $x, $cy, $h, $it) {
            if ($mediaId) {
                $this->label($event, 'image', $x, $cy, mediaId: $mediaId);
            }
            $this->label($event, 'text', $x, $cy - (int) max(50, $h / 2 + 30), text: $it['label']);
        };

        switch ($it['type']) {
            case 'collect':
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->complete($hot, $key, $it);
                $this->action($hot, 'infobox', ['content' => self::html($it['info'])]);
                $this->followUps($hot, $sceneKey, $key);
                break;

            case 'inspect':
                // Can be looked at again; it counts once.
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: $requires, block: true);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->action($hot, 'infobox', ['content' => self::html($it['info'])]);
                $this->complete($hot, $key, $it);
                $this->followUps($hot, $sceneKey, $key);
                break;

            case 'question':
                $ask = $this->question($sceneId, $sceneKey, $key, $it);
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true);
                $labels($hot);
                $this->action($hot, 'run_event', ['target_event_id' => $ask]);
                break;

            case 'experiment':
                $run = $this->experiment($sceneId, $sceneKey, $key, $it);
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true);
                $labels($hot);
                $this->action($hot, 'run_event', ['target_event_id' => $run]);
                break;

            case 'team_task':
                $t = $it['team'];
                $needed = (int) $t['needed'];
                $open = [...$requires, $this->cond("helped_$key", '=', 0), $this->cond("team_$key", '<', $needed)];
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: $open, block: true, audience: 'scene');
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
                $this->action($hot, 'text_overlay', ['text' => $t['success'], 'duration' => 4000], conditions: $this->conds([$this->cond("team_$key", '>=', $needed)]));
                $this->action($hot, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
                // Students who did their part see who else is needed.
                $wait = $this->hotspot($sceneId, "$key-waiting", [$x, $cy], $radius, click: true, conditions: [$this->cond("helped_$key", '=', 1), $this->cond("team_$key", '<', $needed)]);
                $labels($wait);
                $this->action($wait, 'text_overlay', ['text' => "You did your part. {{team_$key}} of $needed crew members have helped: ask your crewmates!", 'duration' => 3000]);
                break;
        }

        // Clicked too early: say what is missing (only when one thing is).
        if (! empty($it['locked_hint']) && count($it['requires'] ?? []) === 1 && ($negated = $this->negation($it['requires'][0]))) {
            $hint = $this->hotspot($sceneId, "$key-locked", [$x, $cy], $radius, click: true, conditions: [...$negated, ...$notDone]);
            $labels($hint);
            $this->action($hint, 'text_overlay', ['text' => $it['locked_hint'], 'duration' => 3000]);
        }
    }

    /** The question as an indirect event, with one answer event per choice. Returns the question's event id. */
    private function question(int $sceneId, string $sceneKey, string $key, array $it): int
    {
        $q = $it['question'];
        $ask = $this->event($sceneId, 'indirect', "ask-$key");
        $this->entry[$key] = $ask;
        foreach ($it['dialogue'] ?? [] as $line) {
            $this->dialogue($ask, $line);
        }
        $buttons = [];
        foreach (array_values($q['choices']) as $i => $choice) {
            $n = $i + 1;
            $answer = $this->event($sceneId, 'indirect', "answer-$key-$n");
            $this->action($answer, 'variable', ['name' => "q_{$key}_first", 'operator' => 'set', 'operand' => $n], conditions: $this->conds([$this->cond("q_{$key}_first", '=', 0)]));
            $this->action($answer, 'variable', ['name' => "q_{$key}_tries", 'operator' => '+', 'operand' => 1]);
            if (! empty($choice['correct'])) {
                $this->action($answer, 'variable', ['name' => 'score', 'operator' => '+', 'operand' => 1], conditions: $this->conds([$this->cond("q_{$key}_first", '=', $n), $this->cond("done_$key", '=', 0)]));
                $this->complete($answer, $key, $it);
                $this->action($answer, 'infobox', ['content' => '<h3>That\'s right!</h3>'.self::paragraphs($choice['feedback'])]);
                $this->followUps($answer, $sceneKey, $key);
            } else {
                $this->action($answer, 'infobox', ['content' => '<h3>Not quite</h3>'.self::paragraphs($choice['feedback']).'<p><em>Think about what you have found, then try again.</em></p>']);
            }
            $buttons[] = ['text' => $choice['text'], 'action' => ['type' => 'run_event', 'target_event_id' => $answer]];
        }
        $this->action($ask, 'infobox', ['content' => '<h3>'.htmlspecialchars($it['label']).'</h3>'.self::paragraphs($q['prompt']), 'call_to_actions' => $buttons, 'dismissible' => false]);

        $this->evidenceFor($q['objective'] ?? null, $q['standards'] ?? [], $key, 'question');

        return $ask;
    }

    /** The "hands-on experiment" loop. Returns its event id. */
    private function experiment(int $sceneId, string $sceneKey, string $key, array $it): int
    {
        $x = $it['experiment'];
        $value = "value_$key";
        $menu = "menu_$key";
        $unit = trim((string) ($x['unit'] ?? ''));
        $run = $this->event($sceneId, 'indirect', "experiment-$key");
        $this->entry[$key] = $run;
        foreach ($it['dialogue'] ?? [] as $line) {
            $this->dialogue($run, $line);
        }
        $this->action($run, 'variable', ['name' => $value, 'operator' => 'set', 'operand' => (int) $x['start']], conditions: $this->conds([$this->cond("done_$key", '=', 0)]));
        $this->action($run, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 1]);
        $intro = ! empty($it['info']) ? self::html($it['info']) : '<h3>'.htmlspecialchars($it['label']).'</h3>';
        $this->action($run, 'infobox', [
            'content' => $intro.'<p style="font-size:1.4em"><strong>'.htmlspecialchars($x['quantity']).": {{{$value}}}".($unit !== '' ? ' '.htmlspecialchars($unit) : '').'</strong></p>',
            'call_to_actions' => [
                ['text' => $x['increase'], 'action' => ['type' => 'variable', 'name' => $value, 'operator' => '+', 'operand' => 1], 'conditions' => [$this->plain($value, '<', (int) $x['max'])]],
                ['text' => $x['decrease'], 'action' => ['type' => 'variable', 'name' => $value, 'operator' => '-', 'operand' => 1], 'conditions' => [$this->plain($value, '>', (int) $x['min'])]],
                ['text' => 'Step away', 'action' => ['type' => 'variable', 'name' => $menu, 'operator' => 'set', 'operand' => 0]],
            ],
            'dismissible' => false,
        ]);
        $reached = [$this->cond($value, '=', (int) $x['target'])];
        $this->complete($run, $key, $it, $reached);
        $this->action($run, 'infobox', ['content' => '<h3>You did it!</h3>'.self::paragraphs($x['success'])], conditions: $this->conds([...$reached, $this->cond($menu, '=', 1)]));
        $this->action($run, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 0], conditions: $this->conds($reached));
        $this->action($run, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]], conditions: $this->conds($reached));
        $this->action($run, 'repeat', [], conditions: $this->conds([$this->cond($menu, '=', 1)]));

        $this->evidenceFor($x['objective'] ?? null, [], $key, 'experiment');

        return $run;
    }

    /**
     * A character's click event. It runs the first conversation that applies: the final report (guide,
     * once every required step is done), then each of the character's talks whose requirements are met
     * and which has not been had; with none left, a short reminder.
     */
    private function talkDispatcher(int $sceneId, array $c, string $sceneKey): int
    {
        $dispatch = $this->event($sceneId, 'indirect', "chat-{$c['key']}");
        $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 0]);

        if ($c['key'] === $this->guide) {
            $report = $this->event($sceneId, 'indirect', 'report');
            $this->action($report, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1]);
            // "cheer" when it was drawn; otherwise the built-in jump.
            $this->action($report, 'animate', ['target' => 'character', 'character_id' => $this->characterIds[$c['key']][0], 'animation' => in_array('cheer', $c['gestures'] ?? [], true) ? 'cheer' : 'jump'], blocking: false);
            $this->action($report, 'freeze', ['frozen' => true]);
            foreach ($this->blueprintCompletion['dialogue'] ?? [] as $line) {
                $this->dialogue($report, $line);
            }
            $this->action($report, 'freeze', ['frozen' => false]);
            $this->action($report, 'variable', ['name' => 'mission_complete', 'operator' => 'set', 'operand' => 1]);
            $this->action($report, 'award', $this->blueprintCompletion['award'], blocking: false);
            $this->action($report, 'text_overlay', ['text' => 'Mission complete!', 'text_font_size' => 48, 'duration' => 4000]);
            $this->action($report, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
            $this->action($dispatch, 'run_event', ['target_event_id' => $report], conditions: $this->conds([...$this->readyConditions(), $this->cond('mission_complete', '=', 0)]));
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
            $this->action($dispatch, 'run_event', ['target_event_id' => $talk], conditions: $this->conds([...$requires, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)]));
            if (! empty($it['locked_hint']) && count($it['requires'] ?? []) === 1 && ($negated = $this->negation($it['requires'][0]))) {
                $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $it['locked_hint']], $this->conds([...$negated, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)]), style: 'bubble');
                $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1], conditions: $this->conds([...$negated, $this->cond("done_$key", '=', 0)]));
            }
        }
        $reminder = $c['key'] === $this->guide ? 'Check your mission checklist, {{QBLPlayerName}}. Your crew is counting on you!' : 'Good luck with the mission, {{QBLPlayerName}}!';
        $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $reminder], $this->conds([$this->cond('talked', '=', 0)]), style: 'bubble');

        return $dispatch;
    }

    /**
     * Marks an interaction done: adds to the counters of its steps (once), sets its flag, gives its
     * award. $when: further conditions on all of it (an experiment's target being reached).
     */
    private function complete(int $event, string $key, array $it, array $when = []): void
    {
        $first = [...$when, $this->cond("done_$key", '=', 0)];
        foreach ($this->stepsWith($key) as $s) {
            if ($this->counted($this->steps[$s])) {
                $this->action($event, 'variable', ['name' => "count_$s", 'operator' => '+', 'operand' => 1], conditions: $this->conds($first));
            }
        }
        if (! empty($it['award'])) {
            $this->action($event, 'award', $it['award'], blocking: false, conditions: $this->conds($first));
        }
        $this->action($event, 'variable', ['name' => "done_$key", 'operator' => 'set', 'operand' => 1], conditions: $when ? $this->conds($when) : []);
    }

    /** After an interaction is done: bring the checklist up to date, and ask any question that follows it. */
    private function followUps(int $event, string $sceneKey, string $key): void
    {
        $this->action($event, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
        foreach ($this->interactions as $qk => $q) {
            if ($q['type'] === 'question' && ($q['after'] ?? null) === $key) {
                // The question's event is created when its scene's interactions are built; run it by shortname id later.
                $this->pendingFollowUps[] = [$event, $qk];
            }
        }
    }

    private array $pendingFollowUps = [];

    private array $blueprintCompletion = [];

    /**
     * Each scene has one: sets each step's flag once its interactions are done, changes the guide's
     * label when the mission is ready to report, and tells the student so, once.
     */
    private function refreshEvent(int $sceneId): int
    {
        $e = $this->event($sceneId, 'indirect', 'refresh');
        foreach ($this->steps as $key => $s) {
            $this->action($e, 'variable', ['name' => "step_$key", 'operator' => 'set', 'operand' => 1], conditions: $this->conds([...$this->stepConditions($key), $this->cond("step_$key", '=', 0)]));
        }
        $guide = $this->characterIds[$this->guide][1];
        $ready = $this->readyConditions();
        $this->action($e, 'variable', ['name' => "label_{$this->guide}", 'operator' => 'set', 'operand' => $this->blueprintCompletion['label']], conditions: $this->conds([...$ready, $this->cond('mission_complete', '=', 0)]));
        $this->action($e, 'variable', ['name' => "label_{$this->guide}", 'operator' => 'set', 'operand' => 'Talk to '.$guide['name']], conditions: $this->conds([$this->cond('mission_complete', '=', 1)]));
        $this->action($e, 'text_overlay', ['text' => 'Every task is done! '.$this->blueprintCompletion['label'].'.', 'duration' => 4000], blocking: false, conditions: $this->conds([...$ready, $this->cond('ready_hinted', '=', 0)]));
        $this->action($e, 'variable', ['name' => 'ready_hinted', 'operator' => 'set', 'operand' => 1], conditions: $this->conds($ready));

        return $e;
    }

    // ===================================================================== conditions

    /** What "done" means for a requirement key: an interaction's flag, a team's count, or a step's flag. */
    private function requirement(string $key): array
    {
        if (isset($this->steps[$key])) {
            return [$this->cond("step_$key", '=', 1)];
        }
        $it = $this->interactions[$key] ?? throw new GenerationError("Unknown requirement $key.");

        return $it['type'] === 'team_task' ? [$this->cond("team_$key", '>=', (int) $it['team']['needed'])] : [$this->cond("done_$key", '=', 1)];
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

    /** Every required step done. */
    private function readyConditions(): array
    {
        $out = [];
        foreach ($this->steps as $key => $s) {
            if (empty($s['optional'])) {
                $out[] = $this->cond("step_$key", '=', 1);
            }
        }

        return $out;
    }

    private function stepsWith(string $interaction): array
    {
        return array_keys(array_filter($this->steps, fn ($s) => in_array($interaction, $s['done_when'], true)));
    }

    /** Whether a step shows a count: several interactions, none of them a team task (whose progress is shared). */
    private function counted(array $step): bool
    {
        return count($step['done_when']) > 1
            && ! array_filter($step['done_when'], fn ($k) => ($this->interactions[$k]['type'] ?? '') === 'team_task');
    }

    // ===================================================================== evidence

    private function evidenceFor(?string $objective, array $codes, string $key, string $type): void
    {
        $this->evidenceLog[] = ['objective' => $objective, 'codes' => $codes, 'interaction' => $key, 'type' => $type];
    }

    private array $evidenceLog = [];

    private function evidenceVariables(array $alignment): array
    {
        $out = [];
        foreach ($alignment['learning_objectives'] as $lo) {
            $items = [];
            foreach ($this->evidenceLog as $e) {
                if ($e['objective'] === $lo['id']) {
                    $items[] = $e['type'] === 'question'
                        ? ['interaction' => $e['interaction'], 'type' => 'question', 'correct' => "done_{$e['interaction']}", 'first_answer' => "q_{$e['interaction']}_first", 'tries' => "q_{$e['interaction']}_tries"]
                        : ['interaction' => $e['interaction'], 'type' => 'experiment', 'completed' => "done_{$e['interaction']}"];
                }
            }
            $out[] = ['objective' => $lo['id'], 'standards' => $lo['standards'], 'evidence' => $items];
            foreach ($lo['standards'] as $code) {
                foreach ($items as $item) {
                    $this->evidence[$code][] = ['objective' => $lo['id']] + $item;
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
        $id = $this->id('media');
        $file = $name.'.'.strtolower(pathinfo($asset['path'], PATHINFO_EXTENSION) ?: 'png');
        $this->rows['media'][] = [
            'id' => $id, 'type' => 'image', 'filename' => $file, 'url' => "assets/$file", 'scale_x' => 1, 'scale_y' => 1,
            'width' => (int) $asset['width'], 'height' => (int) $asset['height'], 'priority' => $priority, 'params' => $asset['params'] ?? null,
        ];
        $this->files[$file] = $asset['path'];

        return $id;
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
    private function hotspot(int $sceneId, string $shortname, array $at, int $radius, bool $click, array $conditions = [], bool $block = false, string $audience = 'player'): int
    {
        $id = $this->event($sceneId, 'hotspot', $shortname, [
            'position_x' => $at[0], 'position_y' => $at[1], 'radius' => $radius, 'activate_by_trigger' => $click, 'block_hotspots' => $block, 'audience' => $audience,
        ]);
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

    private function label(int $event, string $type, int $x, int $y, ?string $text = null, ?int $mediaId = null): void
    {
        $this->rows['labels'][] = ['id' => $this->id('labels'), 'event_id' => $event, 'type' => $type, 'position_x' => $x, 'position_y' => $y, 'scale_x' => 1, 'scale_y' => 1, 'text' => $text, 'media_id' => $mediaId];
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

    /** Conditions for an action: the same shape, passed through. */
    private function conds(array $conditions): array
    {
        return $conditions;
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
     * (a doorway) stay exactly where they are, and the rest are spread on either side of them.
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
