<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Characters\NpcCharacter;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\FloorTracer;
use App\Qbl\Generation\Art\SortLine;
use App\Qbl\Generation\Design\BlueprintSchema;
use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Design\Cutscenes;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;

/**
 * Turns a mission blueprint and its pictures into rows of the QBL tables (the shape of
 * ScenarioStore::bundle()), which ScenarioCompiler makes into the scenario document.
 *
 * Every interaction becomes events and actions by one of the patterns in docs/src/content/docs/developers/extensions/patterns.md
 * ("Patterns"), so what the language model wrote is never trusted to be valid JSON for the runtime:
 *
 *   talk        a character's click event runs a dispatcher that picks the conversation that applies
 *   collect     a click hotspot on the thing; it goes into the player's bag and disappears from the scene
 *   inspect     a click hotspot that opens an infobox
 *   use         a thing from the bag used on something: a hotspot that takes it (tests QL_Holding), with a
 *               twin that says what is needed when clicked without it; or given to a character, through
 *               their dispatcher
 *   question    a non-dismissible infobox whose buttons run one answer event each; the first answer is
 *               recorded, every answer explained, and the student may try again until right. A prediction
 *               accepts every answer; a debrief question is asked by the guide in the final report
 *   experiment  a hands-on instrument: a big box with its controls side by side (sliders, switches, a wheel of
 *               chance), what it shows changing as they are moved, and a test button; tested with the
 *               goal's settings it is done, otherwise it says why not and the box opens again as it was left
 *   team_task   a shared (room) counter each student adds to once; shown to the whole scene
 *
 * Around them: ways between scenes (edges, and doors, holes, ladders... that students walk to and go
 * through), things placed where they belong at their real size and a little smaller at the back of the
 * floor (on the floor, at the back, on a table, on the wall), a quiet question mark over each thing to
 * click with its name shown only near it, the bag (things carried, put together in combinations), little
 * cutscenes after things are done, twists that are flashed to the whole scene and can block a way with
 * an obstacle until set right, hidden discoveries that appear as students come near, characters who
 * stroll about and mutter, creatures that land and fly off, a far view that drifts slower than the
 * scene, and a foreground that students walk behind.
 *
 * Progress is kept in variables, which the checklist, the conditions and teacher reports read:
 * done_<interaction or combination> (1 when done; for a question, when answered correctly),
 * q_<key>_first (the first answer chosen, 1-based), q_<key>_answer (its text), q_<key>_tries, score
 * (questions right first time), team_<key> (shared), has_<item> (1 while it is in the bag), twist_<key>
 * (shared), away_<character> (shared: they left, or fell, in a cutscene), saved_<rescue> (shared: they were
 * saved), arrival_<scene> (shared: what happens on arriving has happened), c_<experiment>_<control> (what
 * an instrument's control was left at).
 */
class MissionBuilder
{
    use StoryStaging;

    /** A normal scene's size; a wide one is wider (Sizes::SCENE_WIDTH). */
    public const WIDTH = 2250;

    public const HEIGHT = 1200;

    /** Walk-in radius of each edge. The top edge is a doorway at the centre back of the floor, not the whole line, so things standing along the back can be reached. */
    protected const EDGE_RADIUS = ['left' => 35, 'right' => 35, 'top' => 90, 'bottom' => 25];

    /** A hidden discovery shows from this far away, and fully from the second distance. */
    protected const REVEAL = [340, 170];

    /** How far an older-style wandering character paces either side of their spot. */
    protected const WANDER = 110;

    /** A thing's name shows while the student is this close to it (or the pointer is over it). */
    public const HINT_NEAR = 300;

    protected array $rows;

    protected array $next = [];

    protected array $files = [];

    protected array $vars = [];

    /** scene key => scene id; character key => [id, row, sheet]; item key => [media id, asset, item] */
    protected array $sceneIds = [];

    protected array $scenesByKey = [];

    protected array $characterIds = [];

    /** character key => index of its row in rows['characters'] */
    protected array $characterRows = [];

    /** character key => where they stand in their scene: [x, feet] */
    protected array $characterSpots = [];

    protected array $itemMedia = [];

    /** item key => its row id, for things carried in the bag */
    protected array $carriedIds = [];

    /** "scene|to" => [media id, asset] */
    protected array $passageMedia = [];

    /** "indoor" | "outdoor" => [media id, asset] */
    protected array $surfaceMedia = [];

    protected array $mediaByPath = [];

    /** interaction key => blueprint row */
    protected array $interactions = [];

    /** combination key => blueprint row */
    protected array $combinations = [];

    protected array $steps = [];

    /** twist key => row */
    protected array $twists = [];

    /** scene key => its ways in and out (Connections::ends) */
    protected array $ends = [];

    /** scene key => indirect event id of its refresh event */
    protected array $refresh = [];

    /** interaction key => indirect event id run to start it (questions, talks, experiments) */
    protected array $entry = [];

    /** "twist|scene" => the twist's event in that scene */
    protected array $twistEvents = [];

    protected string $guide;

    protected array $evidence = [];

    protected array $evidenceLog = [];

    protected array $pendingFollowUps = [];

    protected array $pendingTwists = [];

    protected array $blueprintCompletion = [];

    /** Text labels already placed in the scene being built: [x, y, width]. */
    protected array $labelSlots = [];

    /** How many scored questions there are. */
    protected int $graded = 0;

    /** The scene being built: its width, where its floor begins, and the spans of its floor nobody walks on. */
    protected int $width = self::WIDTH;

    protected int $ground = 800;

    /** [x0, x1, y0, y1] of each blocked patch of floor in the scene being built. */
    protected array $blocked = [];

    /** The scene being built, as its background was surveyed (SurveyStep): the floor's back edge, left to right, in scene pixels. Empty: the ground line. */
    protected array $backEdge = [];

    /** id => [x0, y0, x1, y1]: where things painted into the scene's background were found ("way:<to>", "thing:<interaction>", "detail:<i>", "light:<i>"). */
    protected array $found = [];

    /** id => [x, y]: where a painted light's light is (the brightest part of where it was found). */
    protected array $glows = [];

    /** The scene's trees and bushes, cut out of its background: [x, base, top], for the critters that climb and hide. */
    protected array $trees = [];

    protected array $bushes = [];

    /** cutscene key => its blueprint row; interaction key => the cutscene played after it; and the events that complete each such interaction. */
    protected array $cutscenes_ = [];

    protected array $cutAfter = [];

    protected array $cutEvents = [];

    /** How many cutscenes there are, for their names. */
    protected int $cutscenes = 0;

    /** scene key => [width, ground]: for what is built for a scene after it (a twist's cutscene). */
    protected array $geometry = [];

    /**
     * @param  array  $blueprint  A blueprint BlueprintValidator accepts.
     * @param  array  $alignment  StandardsAligner::align().
     * @param  array<string, array{path: string, width: int, height: int, params?: array, frame_width?: int, frame_height?: int}>  $assets
     *                                                                                                                                      "bg:<scene>", "far:<scene>", "fg:<scene>", "char:<key>", "portrait:<key>", "item:<key>", "passage:<scene>:<to>", "surface:<kind>", "ambient:<scene>:<key>", "marker", "badge".
     * @param  array{min_players?: int, max_players?: int, generation_id?: ?int, style?: string, voices?: array<string, string>}  $options
     *                                                                                                                                      voices: a catalog voice for each character, by key
     * @return array{rows: array, files: array<int, string>, evidence: array<string, array>}
     */
    public function build(array $blueprint, array $alignment, array $assets, array $options = []): array
    {
        $this->rows = array_fill_keys(['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'], []);
        $b = $blueprint;
        foreach ($b['interactions'] as $it) {
            $this->interactions[$it['key']] = $it;
        }
        foreach ($b['combinations'] ?? [] as $c) {
            $this->combinations[$c['key']] = $c;
        }
        foreach ($b['steps'] as $s) {
            $this->steps[$s['key']] = $s;
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
        foreach ($this->interactions as $key => $it) {
            if ($it['type'] === 'team_task') {
                $this->variable("team_$key", 0, 'room');
                $this->variable("helped_$key", 0);
                $this->interactions[$key]['team']['needed'] = max(1, min((int) $it['team']['needed'], $minPlayers));
            } else {
                $this->variable("done_$key", 0);
            }
            if ($it['type'] === 'question') {
                $this->variable("q_{$key}_first", 0);
                $this->variable("q_{$key}_answer", '');
                $this->variable("q_{$key}_tries", 0);
            }
            if ($it['type'] === 'experiment') {
                foreach ($it['instrument']['controls'] as $c) {
                    $this->variable("c_{$key}_{$c['key']}", self::controlStart($c));
                }
                $this->variable("menu_$key", 0, persist: false);
                $this->variable("said_$key", 0, persist: false);
            }
            if (! empty($it['rescues'])) {
                $this->variable("saved_$key", 0, 'room');
            }
        }
        foreach ($this->combinations as $key => $_) {
            $this->variable("done_$key", 0);
        }
        foreach (self::carriedItems($b) as $itemKey) {
            $this->variable("has_$itemKey", 0);
        }
        foreach ($this->leavers($b) as $charKey) {
            // Shared: a character who has left, or fallen, is away for everyone.
            $this->variable("away_$charKey", 0, 'room');
        }
        foreach ($b['scenes'] as $s) {
            if (! empty($s['arrival'])) {
                $this->variable("arrival_{$s['key']}", 0, 'room');
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
            $this->itemMedia['__marker'] = [$this->media('marker', $assets['marker'], 5), $assets['marker'], null];
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
        // Things that can be carried: an item each, in the bag while its has_ variable is set.
        $items = array_column($b['items'], null, 'key');
        foreach (self::carriedItems($b) as $itemKey) {
            $item = $items[$itemKey] ?? null;
            if (! $item) {
                continue;
            }
            $id = $this->id('items');
            $this->carriedIds[$itemKey] = $id;
            $this->rows['items'][] = [
                'id' => $id, 'name' => $item['name'], 'unique' => false, 'physical' => false, 'blocking' => false, 'wearable' => false, 'vehicle' => false,
                'media_id' => $this->itemMedia[$itemKey][0] ?? null,
                'settings' => array_filter([
                    'carried_when' => [$this->plain("has_$itemKey", '>', 0)],
                    'description' => $item['description'] ?? null,
                ]),
            ];
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
            $this->rows['characters'][] = ['id' => $id, 'name' => $c['name'], 'media_id' => $mediaId, 'settings' => array_filter(['scale' => self::characterScale($c, $sheet), 'animations' => $animations, 'tts_voice' => $voice])];
            $this->characterRows[$c['key']] = array_key_last($this->rows['characters']);
            $this->characterIds[$c['key']] = [$id, $c, $sheet];
            $this->variable("label_{$c['key']}", 'Talk to '.$c['name'], persist: false);
            if (isset($this->vars["away_{$c['key']}"])) {
                // Gone while they are away: left in a cutscene, or fallen until they are saved.
                $this->rows['conditions'][] = ['id' => $this->id('conditions'), 'event_id' => null, 'action_id' => null, 'character_id' => $id] + $this->cond("away_{$c['key']}", '=', 0);
            }
        }

        // ---------------------------------------------------------------- scenes
        $sequence = 0;
        $ordered = $b['scenes'];
        usort($ordered, fn ($a, $c) => ($c['key'] === $b['start_scene']) <=> ($a['key'] === $b['start_scene']));
        foreach ($ordered as $scene) {
            $this->sceneIds[$scene['key']] = $this->id('scenes');
        }
        // Cutscenes: their panels are scenes too, played by themselves; known before the scenes that start them.
        $panels = Cutscenes::panels($b);
        foreach ($panels as $panel) {
            $this->sceneIds[$panel['key']] = $this->id('scenes');
        }
        foreach ((array) ($b['cutscenes'] ?? []) as $cut) {
            if (! empty($cut['key']) && array_filter($panels, fn ($p) => $p['cutscene'] === $cut['key'])) {
                $this->cutscenes_[$cut['key']] = $cut;
                $this->variable("seen_cut_{$cut['key']}", 0);
                if (($cut['when'] ?? '') !== 'intro') {
                    $this->cutAfter[$cut['when']] = $cut['key'];
                }
            }
        }
        foreach ($ordered as $scene) {
            $this->scene($scene, ++$sequence, $assets, $b);
        }
        $this->cutscenePanels($panels, $assets, $b, $sequence);
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
        foreach ($b['steps'] as $s) {
            $n = count($s['done_when']);
            $objectives[] = array_filter([
                'id' => $s['key'],
                'text' => $s['text'].($this->counted($s) ? " ({{count_{$s['key']}}}/$n)" : ''),
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
            'settings' => array_filter([
                'spec_version' => 2,
                // A generated mission is a draft for a teacher to review: nobody sees it until it is assigned or made public.
                'visibility' => 'private',
                'chat_mode' => 'emotes',
                'move_speed' => 420,
                'moves' => [['animation' => 'jump'], ['animation' => 'wave']],
                'objectives' => $objectives,
                // Two things from the bag that make a third.
                'combinations' => $this->combinationRows() ?: null,
                'curriculum' => [
                    'standards' => array_map(fn ($s) => ['framework' => $s['framework'], 'code' => $s['code'], 'description' => $s['description'], 'alignment' => $s['alignment'], 'rationale' => $s['rationale']], $alignment['standards']),
                    'learning_objectives' => $alignment['learning_objectives'],
                    'vocabulary' => $alignment['vocabulary'],
                    // Which variables record evidence of each objective, for teacher reports.
                    'evidence' => $this->evidenceVariables($alignment),
                    'scored_questions' => $this->graded,
                ],
                'generated' => array_filter(['by' => 'qbl:generate', 'generation_id' => $options['generation_id'] ?? null, 'art_style' => $options['style'] ?? null, 'at' => gmdate('c')]),
            ], fn ($v) => $v !== null),
        ];

        foreach ($alignment['standards'] as $s) {
            $this->evidence[$s['code']] ??= [];
        }

        return ['rows' => $this->rows, 'files' => $this->files, 'evidence' => $this->evidence];
    }

    /** Every item that is ever in the bag: collected, given, made, or used from it. */
    public static function carriedItems(array $b): array
    {
        $out = [];
        foreach ($b['interactions'] as $it) {
            if ($it['type'] === 'collect' && ! empty($it['item'])) {
                $out[$it['item']] = true;
            }
            foreach (['gives', 'uses'] as $k) {
                if (! empty($it[$k])) {
                    $out[$it[$k]] = true;
                }
            }
        }
        foreach ($b['combinations'] ?? [] as $c) {
            foreach ([...(array) ($c['items'] ?? []), $c['makes'] ?? null] as $k) {
                if ($k) {
                    $out[$k] = true;
                }
            }
        }

        return array_keys($out);
    }

    /** Characters who leave for good, or fall, in a cutscene. */
    protected function leavers(array $b): array
    {
        $out = [];
        $rows = [...$b['interactions'], ...($b['twists'] ?? []), ['cutscene' => $b['completion']['cutscene'] ?? []]];
        foreach ($b['scenes'] as $s) {
            $rows[] = ['cutscene' => $s['arrival']['cutscene'] ?? []];
        }
        foreach ($rows as $row) {
            foreach ($row['cutscene'] ?? [] as $beat) {
                if (in_array($beat['do'] ?? '', ['leave', 'fall'], true) && ($beat['who'] ?? 'player') !== 'player') {
                    $out[$beat['who']] = true;
                }
            }
        }

        return array_keys($out);
    }

    /**
     * How much a character's sprite sheet is scaled so they stand their real height: frames hold a body
     * CELL_H - 30 pixels tall, and a child of PERSON_CM is PERSON_PX tall.
     */
    public static function characterScale(array $c, ?array $sheet = null): float
    {
        // How tall the body is on the sheet: as drawn (CELL_H - 30), or as an animator's frames came out (body_height).
        $body = max(1, (int) ($sheet['body_height'] ?? AssetDirector::CELL_H - 30));

        return round(Sizes::PERSON_PX * Sizes::characterCm($c) / Sizes::PERSON_CM / $body, 3);
    }

    /** The scenario's combinations: what putting two carried things together does. */
    protected function combinationRows(): array
    {
        $out = [];
        $items = [];
        foreach ($this->itemMedia as $k => [, , $item]) {
            if ($item) {
                $items[$k] = $item;
            }
        }
        foreach ($this->combinations as $key => $c) {
            [$a, $b] = array_values($c['items']);
            if (! isset($this->carriedIds[$a], $this->carriedIds[$b], $this->carriedIds[$c['makes']])) {
                continue;
            }
            $first = [$this->plain("done_$key", '=', 0)];
            $actions = [];
            foreach ($this->stepsWith($key) as $s) {
                if ($this->counted($this->steps[$s])) {
                    $actions[] = ['type' => 'variable', 'name' => "count_$s", 'operator' => '+', 'operand' => 1, 'conditions' => $first];
                }
            }
            $actions[] = ['type' => 'variable', 'name' => "has_$a", 'operator' => 'set', 'operand' => 0];
            $actions[] = ['type' => 'variable', 'name' => "has_$b", 'operator' => 'set', 'operand' => 0];
            $actions[] = ['type' => 'variable', 'name' => "has_{$c['makes']}", 'operator' => 'set', 'operand' => 1];
            $actions[] = ['type' => 'variable', 'name' => "done_$key", 'operator' => 'set', 'operand' => 1];
            $actions[] = ['type' => 'text_overlay', 'text' => $c['text'], 'text_font_size' => 30, 'duration' => 3500];
            $actions[] = ['type' => 'text_overlay', 'text' => 'Added to your bag: '.($items[$c['makes']]['name'] ?? $c['makes']), 'alignment' => 'bottom center', 'duration' => 2500, 'blocking' => false];
            $out[] = ['items' => [$this->carriedIds[$a], $this->carriedIds[$b]], 'actions' => $actions];
        }

        return $out;
    }

    // ======================================================================== scenes

    protected function scene(array $scene, int $sequence, array $assets, array $b): void
    {
        $key = $scene['key'];
        $sceneId = $this->sceneIds[$key];
        $W = $this->width = Sizes::sceneWidth($scene);
        $H = self::HEIGHT;
        $ground = $this->ground = (int) round($H * max(0.5, min(0.85, (float) $scene['ground_line'])));
        $this->geometry[$key] = [$W, $ground];
        $floor = $H - $ground;
        $bg = $assets["bg:$key"] ?? throw new GenerationError("There is no background for the scene $key.");
        $bgId = $this->media("background-$key", $bg, $key === $b['start_scene'] ? 1 : 10 + $sequence);
        $ends = $this->ends[$key] ?? [];
        $edges = array_column(array_filter($ends, fn ($e) => $e['via'] === 'edge'), null, 'edge');
        $passages = array_filter($ends, fn ($e) => $e['via'] !== 'edge');
        $start = $key === $b['start_scene'];
        $this->labelSlots = [];

        // The floor: where it ends left and right, what lies in it, and how far a foreground lets students come.
        [$left, $right] = $this->floorEnds($scene, $W, isset($edges['left']), isset($edges['right']));
        [$layersFront, $foreground] = $this->foregroundLayer($scene, $key, $sequence, $assets, $W, $H);
        [$top, $bottom] = $this->floorDepth($scene, $foreground, $ground, $H);
        // As the background turned out: where its floor really ends at the back, and the things people walk around in it.
        $cutouts = $this->surveyed($key, $assets, $top, $bottom);

        // Where things stand. Interactions, characters, props and obstacles share the width; spread them so
        // none overlap. Doors, holes and the doorway of a top exit stay exactly where they are, and everything
        // else keeps clear of them.
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
        foreach (array_values($scene['details'] ?? []) as $i => $d) {
            $anchors["detail:$i"] = (float) $d['x'];
        }
        foreach (array_values($scene['lights'] ?? []) as $i => $l) {
            $anchors["light:$i"] = (float) $l['x'];
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
        $xs = self::spread($anchors, 260, max(230, $left + 150), min($W - 230, $right - 150), $fixed, $W);

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
            $layoutItems[] = ['item_id' => $itemId, 'position_x' => $xs["prop:$i"], 'position_y' => $big ? $this->backAt($xs["prop:$i"], 10) : $this->clear($xs["prop:$i"], $ground + (int) ($floor * 0.3))];
        }
        // What people walk around, lifted out of the background: each exactly over itself.
        array_push($layoutItems, ...$cutouts);
        // Lights: the lantern, campfire or beacon stood in the scene, and its glow where its light is.
        $lights = [];
        foreach (array_values($scene['lights'] ?? []) as $i => $l) {
            $asset = $assets["light:$key:$i"] ?? null;
            $wall = ($l['placement'] ?? null) === 'wall';
            if ((! $asset && ! $wall) || ! isset($xs["light:$i"])) {
                continue;
            }
            [$placement, $light] = $this->light($key, $i, $l, $asset, $xs["light:$i"], $ground, $floor);
            if ($placement) {
                $layoutItems[] = $placement;
            }
            $lights[] = $light;
        }

        $spawns = [['name' => 'default', 'position_x' => (int) (($left + $right) / 2), 'position_y' => $this->clear((int) (($left + $right) / 2), min($bottom - 40, $ground + (int) ($floor * 0.55)))]];
        $placements = [];
        // The far view, drifting slower than the scene: it shows its left edge at the scene's left edge and
        // its right edge at the scene's right edge on the widest screens (a view about 2400 pixels wide).
        [$layersBack, $horizon] = $this->backLayers($scene, $key, $sequence, $assets, $bgId, $W, $H);
        $this->rows['scenes'][] = [
            'id' => $sceneId, 'shortname' => $key, 'sequence' => $sequence, 'subtitle' => $scene['title'], 'description' => $scene['description'] ?? null,
            'zoom' => 1, 'show_avatars' => true, 'is_intro_scene' => false, 'width' => $W, 'height' => $H,
            'background_media' => $layersBack,
            'foreground_media' => $layersFront,
            'layout' => null, // filled in below, once spawn points and placements are known
            // The living sky (moving on slowly if it changes: a sunset), what is in the air, the weather.
            'params' => $this->sceneParams($scene, $sequence, $horizon),
        ];
        $sceneIndex = array_key_last($this->rows['scenes']);

        // Every scene keeps the checklist's flags and the guide's label up to date (see refreshEvent).
        $this->refresh[$key] = $this->refreshEvent($sceneId);

        // ---- arriving: the scene's name; in the start scene, the guide's briefing the first time; news
        //      of a twist that happened while the student was elsewhere
        $arrive = $this->event($sceneId, 'start', 'arrive');
        $this->action($arrive, 'text_overlay', ['text' => $scene['title'], 'alignment' => 'top center', 'text_font_size' => 34, 'duration' => 2500], blocking: false);
        if ($start) {
            // The opening cutscene, once: off to its first panel; back here, the briefing follows.
            foreach ($this->cutscenes_ as $ck => $cut) {
                if (($cut['when'] ?? '') === 'intro') {
                    $unseen = [$this->cond("seen_cut_$ck", '=', 0)];
                    $this->action($arrive, 'variable', ['name' => "seen_cut_$ck", 'operator' => 'set', 'operand' => 1], conditions: $unseen);
                    $this->action($arrive, 'jump', ['scene_id' => $this->sceneIds["cut_{$ck}_1"]], conditions: $unseen);
                }
            }
            $intro = [$this->cond('intro_seen', '=', 0)];
            $this->action($arrive, 'variable', ['name' => 'intro_seen', 'operator' => 'set', 'operand' => 1], conditions: $intro);
            $this->action($arrive, 'freeze', ['frozen' => true], conditions: $intro);
            foreach ($b['intro']['dialogue'] as $line) {
                $this->dialogue($arrive, $line, $intro);
            }
            $this->action($arrive, 'freeze', ['frozen' => false], conditions: $intro);
        }
        // What happens the first time anyone arrives (shared, so it happens once): a tense moment, a surprise.
        if (! empty($scene['arrival'])) {
            $this->arrival($sceneId, $key, $scene['arrival'], $arrive, $start);
        }
        foreach ($this->twists as $tk => $t) {
            $missed = [$this->cond("twist_$tk", '=', 1), $this->cond("seen_twist_$tk", '=', 0)];
            $this->action($arrive, 'text_overlay', ['text' => $t['notice'] ?? $t['title'], 'text_font_size' => 30, 'duration' => 4000], blocking: false, conditions: $missed);
            $this->action($arrive, 'variable', ['name' => "seen_twist_$tk", 'operator' => 'set', 'operand' => 1], conditions: [$this->cond("twist_$tk", '=', 1)]);
        }
        $this->action($arrive, 'run_event', ['target_event_id' => $this->refresh[$key]]);

        // ---- ways out: edges, and passages standing in the scene
        foreach ($edges as $edge => $x) {
            $this->edgeExit($sceneId, $key, $x, $ground, $bottom);
            // Where students arrive when they come in through this edge, clear of the edge's own hotspot.
            $spawns[] = match ($edge) {
                'left' => ['name' => "from-{$x['to']}", 'position_x' => 190, 'position_y' => $this->clear(190, $ground + (int) ($floor * 0.5))],
                'right' => ['name' => "from-{$x['to']}", 'position_x' => $W - 190, 'position_y' => $this->clear($W - 190, $ground + (int) ($floor * 0.5)), 'facing' => 'left'],
                'top' => ['name' => "from-{$x['to']}", 'position_x' => (int) ($W / 2), 'position_y' => $this->clear((int) ($W / 2), $ground + max(150, (int) ($floor * 0.45)))],
                'bottom' => ['name' => "from-{$x['to']}", 'position_x' => (int) ($W / 2), 'position_y' => $this->clear((int) ($W / 2), $bottom - max(80, (int) ($floor * 0.25)))],
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

        // ---- characters: where they stand (their spots are known before their conversations and cutscenes)
        foreach ($b['characters'] as $c) {
            if ($c['scene'] === $key) {
                $this->characterSpots[$c['key']] = [$xs["char:{$c['key']}"], $ground + (int) ($floor * 0.32)];
            }
        }
        foreach ($b['characters'] as $c) {
            if ($c['scene'] !== $key) {
                continue;
            }
            [$charId, , $sheet] = $this->characterIds[$c['key']];
            [$x, $feet] = $this->characterSpots[$c['key']];
            $dispatcher = $this->talkDispatcher($sceneId, $c, $key);
            $placements[] = ['character_id' => $charId, 'position_x' => $x, 'position_y' => $feet, 'facing' => $x > $W / 2 ? 'left' : 'right', 'event_id' => $dispatcher];
            if ($routine = $this->routine($c, $x, $feet)) {
                $this->rows['characters'][$this->characterRows[$c['key']]]['settings'] += ['routine' => $routine, 'walk_speed' => 90];
            }
            // Their name over their head when students come near, also clickable: "Talk to Dr. Ren", or the
            // report label once the mission is ready. Not for one who walks about: the label would stay behind.
            if (! $this->moves($c)) {
                $height = (int) (($sheet['frame_height'] ?? $sheet['height']) * self::characterScale($c, $sheet) * Sizes::depth($feet, $ground));
                $label = $this->hotspot($sceneId, "label-{$c['key']}", [$x, $feet - (int) ($height / 2)], max(70, (int) ($height / 2)), click: true, conditions: isset($this->vars["away_{$c['key']}"]) ? [$this->cond("away_{$c['key']}", '=', 0)] : []);
                $this->text($label, $x, $feet - $height - 30, "{{label_{$c['key']}}}", 'Talk to '.$c['name'], hint: true);
                $this->action($label, 'run_event', ['target_event_id' => $dispatcher]);
            }
        }

        // ---- coming back from a cutscene played after one of this scene's interactions: beside it
        foreach ($this->cutAfter as $ik => $ck) {
            if (($this->interactions[$ik]['scene'] ?? null) === $key && isset($xs["int:$ik"])) {
                $sx = (int) max(120, min($W - 120, $xs["int:$ik"] + ($xs["int:$ik"] > $W / 2 ? -150 : 150)));
                $spawns[] = ['name' => "after-$ck", 'position_x' => $sx, 'position_y' => $this->clear($sx, $ground + (int) ($floor * 0.45))];
            }
        }

        // ---- the scene's interactions, at varied depths on the floor
        $here = array_filter($this->interactions, fn ($it) => $it['scene'] === $key && $this->placed($it));
        uksort($here, fn ($a, $c) => $xs["int:$a"] <=> $xs["int:$c"]);
        $depth = 0;
        foreach ($here as $ik => $it) {
            $this->interaction($sceneId, $key, $ik, $it, $xs["int:$ik"], $ground, $depth++);
        }

        // ---- things to look at: what students notice, no more
        foreach (array_values($scene['details'] ?? []) as $i => $d) {
            $this->detail($sceneId, $i, $d, $xs["detail:$i"], $ground);
        }

        // ---- twists' obstacles
        foreach ($obstacles as $tk => [, $feet]) {
            $this->obstacle($sceneId, $tk, $this->twists[$tk], $xs["obstacle:$tk"], $feet);
        }

        // ---- a little life: birds that land, a squirrel up a tree, a rabbit in the bushes, a cat strolling by
        $critters = [];
        foreach (array_values($scene['ambient'] ?? []) as $i => $a) {
            if ($sheet = $assets["ambient:$key:{$a['key']}"] ?? null) {
                $critters[] = $this->critter($a, $this->media("ambient-$key-{$a['key']}", array_diff_key($sheet, ['critter' => 1]), 60), $sheet, $i, $bottom);
            }
        }

        // The floor students walk on: between its ends, down to where a foreground lets them come, around
        // what lies in it. Figures are drawn a little smaller at the back of it and larger at the front.
        $blockedAreas = array_map(fn ($r) => self::ellipse(($r[0] + $r[1]) / 2, ($r[2] + $r[3]) / 2, ($r[1] - $r[0]) / 2, ($r[3] - $r[2]) / 2), $this->blocked);
        $flows = $this->flows($scene, $bg);
        $this->rows['scenes'][$sceneIndex]['layout'] = [
            'walkable_areas' => [$this->walkable($left, $right, $top, $bottom)],
            'blocked_areas' => $blockedAreas,
            'spawn_points' => $spawns,
            'scale_areas' => [['name' => 'depth', 'x' => 0, 'y' => $ground, 'width' => $W, 'height' => $H - $ground, 'scale_top' => (int) round(Sizes::DEPTH_BACK * 100), 'scale_bottom' => (int) round(Sizes::DEPTH_FRONT * 100), 'speed_effect' => 60]],
            'items' => $layoutItems,
            'characters' => $placements,
        ] + ($lights ? ['lights' => $lights] : []) + ($flows ? ['flows' => $flows] : []) + ($critters ? ['critters' => $critters] : []);
    }

    /**
     * A mission's cutscenes: each panel a scene that plays by itself (StoryStaging), one after another,
     * the last one taking the student back where it began (the start scene, or beside the interaction
     * it followed). Each plays once per student: after the interaction's last action, the student goes.
     */
    protected function cutscenePanels(array $panels, array $assets, array $b, int &$sequence): void
    {
        $ordered = array_values($panels);
        foreach ($ordered as $i => $panel) {
            $cut = $this->cutscenes_[$panel['cutscene']] ?? null;
            if (! $cut || ! isset($assets["bg:{$panel['key']}"])) {
                continue;
            }
            $next = ($ordered[$i + 1]['cutscene'] ?? null) === $panel['cutscene'] ? $ordered[$i + 1]['key'] : null;
            $when = (string) ($cut['when'] ?? 'intro');
            $back = $when === 'intro'
                ? [$this->sceneIds[$b['start_scene']], null]
                : [$this->sceneIds[$this->interactions[$when]['scene'] ?? $b['start_scene']], "after-{$cut['key']}"];
            $this->scenesByKey[$panel['key']] = $panel;
            $this->storyScene($panel, ++$sequence, $assets, $b, $next, $next ? null : $back, opening: false);
        }
        // Off to the first panel, once, at the very end of what completing the interaction does.
        foreach ($this->cutEvents as $ik => $events) {
            $ck = $this->cutAfter[$ik];
            if (! isset($this->sceneIds["cut_{$ck}_1"])) {
                continue;
            }
            foreach ($events as [$event, $when]) {
                $unseen = [...$when, $this->cond("seen_cut_$ck", '=', 0)];
                $this->action($event, 'variable', ['name' => "seen_cut_$ck", 'operator' => 'set', 'operand' => 1], conditions: $unseen);
                $this->action($event, 'jump', ['scene_id' => $this->sceneIds["cut_{$ck}_1"]], conditions: $unseen);
            }
        }
    }

    /**
     * A creature of a scene's little life as the game's critter (Scene.critters): its sheet, how it lives,
     * its spots (where birds land, the trees a squirrel climbs, the bushes a rabbit hides in, from the
     * surveyed background), how big it is drawn, which of its sheet's animations it plays for what, and
     * whether it scatters when anyone comes near. A ready-made one from the library brings its own
     * animations and scale; a drawn one has an idle and a move.
     */
    protected function critter(array $a, int $mediaId, array $sheet, int $i, int $bottom): array
    {
        $W = $this->width;
        $floor = self::HEIGHT - $this->ground;
        $motion = $a['motion'] ?? 'lands';
        $ready = $sheet['critter'] ?? null;
        $spots = match ($motion) {
            'lands' => array_map(fn ($f) => ['x' => (int) ($W * $f), 'y' => $this->clear((int) ($W * $f), min($bottom - 40, $this->backAt($W * $f, (int) ($floor * 0.22))))], [0.3, 0.5, 0.7]),
            'climbs' => array_map(fn ($t) => ['x' => $t[0], 'y' => $t[1], 'top' => $t[2]], $this->trees),
            'hides' => array_map(fn ($b) => ['x' => $b[0], 'y' => $b[1]], $this->bushes),
            'walks_by' => [['x' => (int) ($W / 2), 'y' => $this->clear((int) ($W / 2), max($this->ground + (int) ($floor * 0.14), $this->backAt($W / 2, 30)))]],
            'drives_by' => [['x' => (int) ($W / 2), 'y' => $this->backAt($W / 2, (int) ($floor * 0.04))]],
            default => [],
        };
        // A drawn creature has an idle and a move; a ready-made one its own animations (renamed: idle, walk, fly, peck...).
        $animations = $ready ? (array) ($ready['animations'] ?? []) : ['walk' => 'move', 'run' => 'move', 'fly' => 'move', 'hop' => 'move', 'climb' => 'move', 'take_off' => 'move', 'land' => 'move'];
        $animal = $motion !== 'drives_by';

        return array_filter([
            'name' => $a['key'],
            'media_id' => $mediaId,
            'behavior' => $motion,
            'animations' => $animations ?: null,
            'spots' => $spots ?: null,
            'scale' => $ready ? (float) $ready['scale'] : null,
            'faces' => $ready && ($ready['faces'] ?? 'right') === 'left' ? 'left' : null,
            'count' => $motion === 'lands' && (int) ($a['count'] ?? 1) > 1 ? min(5, (int) $a['count']) : null,
            // Animals scatter when anyone comes near, unless they are tame; vehicles never do.
            'shy' => ! $animal || ($a['shy'] ?? true) === false ? 0 : null,
            'every' => [12 + 6 * $i, 26 + 8 * $i],
            'sound' => ! empty($a['sound']) && in_array($a['sound'], BlueprintSchema::SOUNDS, true) ? $a['sound'] : null,
        ], fn ($v) => $v !== null);
    }

    /**
     * Where a scene's floor ends left and right (at the edges students leave by), and the patches of it
     * nobody walks on (this->blocked): what lies in it, and a pond or a lake.
     *
     * @return array{0: int, 1: int}
     */
    protected function floorEnds(array $scene, int $W, bool $leftEdge, bool $rightEdge): array
    {
        $fl = $scene['floor'] ?? [];
        $ground = $this->ground;
        $floor = self::HEIGHT - $ground;
        $left = $leftEdge ? 0 : (int) round($W * max(0, min(0.4, (float) ($fl['left'] ?? 0))));
        $right = $rightEdge ? $W : (int) round($W * max(0.6, min(1, (float) ($fl['right'] ?? 1))));
        $this->blocked = [];
        foreach ($fl['blocked'] ?? [] as $patch) {
            $cx = (float) $patch['x'] * $W;
            $half = (float) $patch['width'] * $W / 2;
            $cy = $ground + $floor * 0.62;
            $this->blocked[] = [(int) ($cx - $half), (int) ($cx + $half), (int) ($cy - $floor * 0.13), (int) ($cy + $floor * 0.13)];
        }
        // Nobody walks into the pond.
        if (($water = Sizes::water($scene)) && $water['where'] === 'middle') {
            $this->blocked[] = [$water['x0'] + 10, $water['x1'] - 10, $water['y0'] + 10, $water['y1'] - 10];
        }

        return [$left, $right];
    }

    /**
     * How far back and how far forward the floor goes: from the ground line (or the bank of a river along
     * the back) to the bottom (or as far as a foreground strip lets students come, or the bank of a river
     * along the front).
     *
     * @return array{0: int, 1: int} top, bottom
     */
    protected function floorDepth(array $scene, ?array $foreground, int $ground, int $H): array
    {
        $floor = $H - $ground;
        // Behind a strip along the bottom, students can walk until it hides their legs, not further.
        $bottom = ($foreground['where'] ?? null) === 'bottom'
            ? max($ground + (int) ($floor * 0.5), min($H, $H - $foreground['height'] + (int) (Sizes::PERSON_PX * 0.4)))
            : $H;
        $top = $ground;
        $water = Sizes::water($scene);
        if ($water && $water['kind'] !== 'waterfall') {
            if ($water['where'] === 'front') {
                $bottom = min($bottom, $water['y0'] - 12);
            } elseif ($water['where'] === 'back') {
                $top = max($top, $water['y1'] + 12);
            }
        }

        return [$top, max($top + 60, $bottom)];
    }

    /**
     * Something close to the viewer that students walk behind: a strip along the bottom, or a piece in a corner.
     *
     * @return array{0: array, 1: ?array} the foreground layers, and where it is
     */
    protected function foregroundLayer(array $scene, string $key, int $sequence, array $assets, int $W, int $H): array
    {
        if (empty($scene['foreground']) || ! ($fg = $assets["fg:$key"] ?? null)) {
            return [[], null];
        }
        $fgId = $this->media("foreground-$key", $fg, 12 + $sequence);
        $where = $scene['foreground']['where'];
        $fx = $where === 'right' ? $W - (int) $fg['width'] : 0;

        return [
            [['media_id' => $fgId, 'position_x' => $fx, 'position_y' => $H - (int) $fg['height'], 'display_width' => (int) $fg['width'], 'display_height' => (int) $fg['height']]],
            ['where' => $where, 'width' => (int) $fg['width'], 'height' => (int) $fg['height']],
        ];
    }

    /**
     * The layers behind a scene: clouds drifting across a living sky (slower than anything), the far view
     * (drifting slower than the scene: it shows its left edge at the scene's left edge and its right edge at
     * the scene's right edge on the widest screens, a view about 2400 pixels wide), and the scene's own
     * picture. Its water is drawn by the game between these and the picture.
     *
     * @return array{0: array, 1: float} the layers, and where the horizon is (a share of the height)
     */
    protected function backLayers(array $scene, string $key, int $sequence, array $assets, int $bgId, int $W, int $H): array
    {
        $layersBack = [];
        $sky = $scene['sky'] ?? null;
        $horizon = round(max(0.35, (float) $scene['ground_line'] - 0.12), 2);
        if ($sky && ($sky['clouds'] ?? 'few') !== 'none' && ($clouds = $assets['clouds'] ?? null)) {
            $cloudsId = $this->media('clouds', $clouds, 40);
            $ch = (int) $clouds['height'];
            $layersBack[] = ['media_id' => $cloudsId, 'position_x' => 0, 'position_y' => (int) round($H * $horizon * 0.04), 'display_width' => $W, 'display_height' => $ch, 'tile' => true, 'scroll_speed_x' => 7, 'parallax' => 0.06, 'sky' => true];
            if (($sky['clouds'] ?? 'few') === 'many') {
                // A second band, lower, further and slower, the clouds in another order.
                $layersBack[] = ['media_id' => $cloudsId, 'position_x' => -900, 'position_y' => (int) round($H * $horizon * 0.42), 'display_width' => $W + 900, 'display_height' => $ch, 'tile' => true, 'scroll_speed_x' => 3, 'parallax' => 0.03, 'sky' => true];
            }
        }
        if (($far = $assets["far:$key"] ?? null) && ! empty($scene['distance'])) {
            $farId = $this->media("far-$key", $far, 11 + $sequence);
            $farW = (int) $far['width'];
            $parallax = $W > 2400 ? round(max(0.1, min(0.6, ($farW - 2400) / ($W - 2400))), 2) : 0.5;
            // Under a living sky, the far view takes on its light too.
            $layersBack[] = ['media_id' => $farId, 'position_x' => 0, 'position_y' => 0, 'display_width' => $farW, 'display_height' => (int) $far['height'], 'parallax' => $parallax] + ($sky ? ['sky' => true] : []);
        }
        $layersBack[] = ['media_id' => $bgId, 'display_width' => $W, 'display_height' => $H];

        return [$layersBack, $horizon];
    }

    /** A scene's settings: its living sky (moving on slowly if it changes: a sunset), what is in the air, its weather. */
    protected function sceneParams(array $scene, int $sequence, float $horizon): ?array
    {
        $sky = $scene['sky'] ?? null;
        $weather = $scene['weather'] ?? null;

        return array_filter([
            'sky' => $sky ? array_filter([
                'time' => $sky['time'], 'until' => $sky['until'] ?? null, 'minutes' => ! empty($sky['until']) ? 10 : null,
                'horizon' => $horizon, 'sun_x' => $sequence % 2 ? 0.72 : 0.3, 'shade' => 60,
            ], fn ($v) => $v !== null) : null,
            'atmosphere' => $scene['atmosphere'] ?? null,
            'weather' => $weather ? ['kind' => $weather['kind'], 'intensity' => BlueprintSchema::INTENSITY[$weather['intensity'] ?? 'steady'] ?? 0.6] : null,
        ]) ?: null;
    }

    /**
     * The scene's water, flowing: drawn by the game behind the picture where it was cut out of it (the
     * see-through box the art director found), or, where the picture kept it, glints moving over it.
     */
    protected function flows(array $scene, array $bg): array
    {
        $water = Sizes::water($scene);
        if (! $water) {
            return [];
        }
        $hole = $bg['water'] ?? null;
        $box = $hole ?: ['x' => $water['x0'], 'y' => $water['y0'], 'width' => $water['x1'] - $water['x0'], 'height' => $water['y1'] - $water['y0']];
        $kind = match ($water['kind']) {
            'pond' => 'lake',
            default => $water['kind'],
        };

        return [array_filter([
            'name' => $water['kind'], 'kind' => $kind,
            'x' => (int) $box['x'], 'y' => (int) $box['y'], 'width' => (int) max(10, $box['width']), 'height' => (int) max(10, $box['height']),
            'direction' => $kind === 'waterfall' ? 'down' : (in_array($kind, ['river', 'stream'], true) ? ($scene['water']['flows'] ?? 'right') : null),
            'color' => $scene['water']['color'] ?? null,
            // Without a hole to show through, it moves over the painted water.
            'layer' => $hole ? null : 'over',
        ], fn ($v) => $v !== null)];
    }

    /**
     * A light: its picture stood in the scene as an item (a campfire is in the way; a lantern on its post
     * at the back is not), and its glow where its light is in the picture, at the size it is drawn there.
     *
     * @return array{0: array, 1: array} the item's placement, the light
     */
    protected function light(string $sceneKey, int $i, array $l, ?array $asset, int $x, int $ground, int $floor): array
    {
        $kind = BlueprintSchema::LIGHTS[$l['kind']] ?? BlueprintSchema::LIGHTS['lantern'];
        if ($asset === null) {
            // Hung on a wall, painted into the background: only its glow, where the light was found (else about where it was asked).
            $at = $this->glows["light:$i"] ?? (($f = $this->foundAt("light:$i")) ? [$f['x'], $f['y']] : [$x, $this->backAt($x, -220)]);

            return [null, array_filter([
                'name' => $l['kind'], 'x' => (int) $at[0], 'y' => (int) $at[1], 'radius' => (int) round($kind['radius'] * Sizes::DEPTH_BACK),
                'color' => $l['color'] ?? $kind['color'], 'kind' => $kind['glow'], 'strength' => 75, 'period' => $kind['period'] ?? null,
            ], fn ($v) => $v !== null)];
        }
        $mediaId = $this->media("light-$sceneKey-$i", $asset, 45);
        $blocking = in_array($l['kind'], ['campfire'], true);
        $itemId = $this->id('items');
        $this->rows['items'][] = [
            'id' => $itemId, 'name' => ucfirst($l['kind']), 'unique' => true, 'physical' => false, 'blocking' => $blocking, 'wearable' => false, 'vehicle' => false, 'media_id' => $mediaId,
            'settings' => ['scale' => 1] + ($blocking ? ['blocking_radius' => (int) max(30, min(120, $asset['width'] * 0.4))] : []),
        ];
        $y = match ($l['placement'] ?? ($blocking ? 'ground' : 'back')) {
            'ground' => $this->clear($x, $ground + (int) ($floor * 0.3)),
            'wall' => $this->backAt($x, -120),
            default => $this->backAt($x, 8),
        };
        // Drawn smaller at the back of the floor and larger at the front, as everything is.
        $s = $y >= $ground ? Sizes::depth($y, $ground) : Sizes::DEPTH_BACK;
        [$fx, $fy] = $asset['glow'] ?? $kind['at'];
        $w = (int) $asset['width'] * $s;
        $h = (int) $asset['height'] * $s;

        return [
            ['item_id' => $itemId, 'position_x' => $x, 'position_y' => $y],
            array_filter([
                'name' => $l['kind'], 'x' => (int) round($x + ($fx - 0.5) * $w), 'y' => (int) round($y - $h + $fy * $h),
                'radius' => (int) round($kind['radius'] * $s), 'color' => $l['color'] ?? $kind['color'], 'kind' => $kind['glow'], 'strength' => 75,
                'period' => $kind['period'] ?? null,
            ], fn ($v) => $v !== null),
        ];
    }

    /** A spot on the floor moved forward or back, if it would be in a patch nobody walks on. */
    protected function clear(int $x, int $y): int
    {
        // Never behind the floor's back edge (into a wall the floor meets further forward here).
        if ($this->backEdge) {
            $y = (int) max($y, min(self::HEIGHT - 40, SortLine::yAt($this->backEdge, $x) + 30));
        }
        foreach ($this->blocked as [$x0, $x1, $y0, $y1]) {
            if ($x > $x0 - 40 && $x < $x1 + 40 && $y > $y0 - 40 && $y < $y1 + 40) {
                // Behind it, unless there is no room there.
                $behind = $y0 - 50;

                return $behind > $this->backAt($x, 20) ? $behind : $y1 + 50;
            }
        }

        return $y;
    }

    /** The back of the floor at x, as surveyed (or the ground line), and $by pixels in front of it. */
    protected function backAt(int|float $x, int $by = 0): int
    {
        return ($this->backEdge ? (int) round(SortLine::yAt($this->backEdge, (float) $x)) : $this->ground) + $by;
    }

    /**
     * Take in the survey of a scene's background (SurveyStep), if it was surveyed: its floor's back edge
     * (kept behind water along the back), where painted things were found, and the things people walk
     * around, each a cut-out item placed exactly over itself in the picture (drawn at its own size
     * whatever the depth there: its scale undoes the scene's), sorted by its sort line, its base a patch
     * nobody walks through. Returns their placements.
     */
    protected function surveyed(string $key, array $assets, int $top, int $bottom): array
    {
        $survey = $assets["survey:$key"] ?? null;
        $this->backEdge = [];
        $this->found = (array) ($survey['found'] ?? []);
        $this->glows = (array) ($survey['glows'] ?? []);
        $this->trees = [];
        $this->bushes = [];
        if (! $survey) {
            return [];
        }
        if (count($survey['floor'] ?? []) >= 2) {
            // Water along the back is never walked into, wherever the edge was traced.
            $this->backEdge = array_map(fn ($p) => [(int) $p[0], (int) max($p[1], $top > $this->ground ? $top : $p[1])], $survey['floor']);
        }
        $placements = [];
        foreach (array_values($survey['standing'] ?? []) as $n => $thing) {
            $asset = $assets["cutout:$key:$n"] ?? null;
            if (! $asset || empty($asset['path'])) {
                continue;
            }
            $base = (int) $asset['y'] + (int) $asset['height'];
            $cx = (int) $asset['x'] + intdiv((int) $asset['width'], 2);
            $mediaId = $this->media("cutout-$key-$n", ['path' => $asset['path'], 'width' => $asset['width'], 'height' => $asset['height']], 46);
            $itemId = $this->id('items');
            $this->rows['items'][] = [
                'id' => $itemId, 'name' => ucfirst((string) $thing['name']), 'unique' => true, 'physical' => false, 'blocking' => false, 'wearable' => false, 'vehicle' => false, 'media_id' => $mediaId,
                'settings' => array_filter(['scale' => round(1 / $this->depthScale($base), 6), 'placement' => 'object', 'sort_line' => $asset['sort_line'] ?? null, 'params' => ['cut_from' => 'background']], fn ($v) => $v !== null),
            ];
            $placements[] = ['item_id' => $itemId, 'position_x' => $cx, 'position_y' => $base];
            // Its base: nobody walks through a trunk or a fountain's rim.
            [$fx0, $fx1] = $asset['footprint'] ?? [$cx - 20, $cx + 20];
            $depth = (int) max(14, min(70, ($fx1 - $fx0) * 0.25));
            if ($base > $top && $base < $bottom) {
                $this->blocked[] = [(int) $fx0 + 4, (int) $fx1 - 4, $base - $depth, $base + 4];
            }
            $top_ = (int) $asset['y'];
            if ($thing['kind'] === 'tree') {
                $this->trees[] = [(int) round(($fx0 + $fx1) / 2), $base, (int) round($top_ + ($base - $top_) * 0.35)];
            } elseif (in_array($thing['kind'], ['bush', 'plant', 'rock'], true)) {
                $this->bushes[] = [$cx, $base, $top_];
            }
        }

        return $placements;
    }

    /**
     * How much bigger or smaller the scene's depth draws something standing at y (its scale area, as
     * the game reads it: whole percentages from the back of the floor to the front).
     */
    protected function depthScale(int $y): float
    {
        $ground = $this->ground;
        if ($y < $ground || $y > self::HEIGHT) {
            return 1.0;
        }
        $top = (int) round(Sizes::DEPTH_BACK * 100);
        $bottom = (int) round(Sizes::DEPTH_FRONT * 100);
        $t = (self::HEIGHT - $ground) > 0 ? ($y - $ground) / (self::HEIGHT - $ground) : 1;

        return max(0.05, ($top + ($bottom - $top) * $t) / 100);
    }

    /** The walkable area: the traced floor when the background was surveyed, else the box of the plain floor. */
    protected function walkable(int $left, int $right, int $top, int $bottom): array
    {
        if ($this->backEdge) {
            return FloorTracer::polygon($this->backEdge, $left, $right, $bottom);
        }

        return [['x' => $left, 'y' => $top], ['x' => $right, 'y' => $top], ['x' => $right, 'y' => $bottom], ['x' => $left, 'y' => $bottom]];
    }

    /** The middle of where a painted thing was found, or null. */
    protected function foundAt(string $id): ?array
    {
        $b = $this->found[$id] ?? null;

        return $b ? ['x' => (int) round(($b[0] + $b[2]) / 2), 'y' => (int) round(($b[1] + $b[3]) / 2), 'top' => (int) $b[1], 'bottom' => (int) $b[3], 'width' => (int) ($b[2] - $b[0]), 'height' => (int) ($b[3] - $b[1])] : null;
    }

    /** A polygon for a flat ellipse lying on the floor. */
    protected static function ellipse(float $cx, float $cy, float $rx, float $ry): array
    {
        $out = [];
        for ($i = 0; $i < 16; $i++) {
            $a = 2 * M_PI * $i / 16;
            $out[] = ['x' => (int) round($cx + $rx * cos($a)), 'y' => (int) round($cy + $ry * sin($a))];
        }

        return $out;
    }

    /** An interaction that stands in a scene (talks are their character, gifts theirs, debrief questions the guide's). */
    protected function placed(array $it): bool
    {
        return $it['type'] !== 'talk' && empty($it['at_report']) && ! ($it['type'] === 'use' && ! empty($it['character']));
    }

    /** An edge students walk off, closed while its requirement is not met or a twist has blocked it. */
    protected function edgeExit(int $sceneId, string $key, array $x, int $ground, int $bottom): void
    {
        $edge = $x['edge'];
        $at = match ($edge) {
            'left' => [0, null], 'right' => [$this->width, null], 'top' => [(int) ($this->width / 2), $this->backAt($this->width / 2)], 'bottom' => [null, $bottom],
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
    protected function passage(int $sceneId, string $key, array $p, int $x, int $ground): array
    {
        $floor = self::HEIGHT - $ground;
        [$mediaId, $asset] = $this->passageMedia["$key|{$p['to']}"] ?? [null, null];
        $inFloor = Connections::inFloor($p['via']);
        // A door, ladder or stairs up is painted into the background: its hotspot goes where it was painted.
        $painted = ! $inFloor ? $this->foundAt("way:{$p['to']}") : null;
        if ($painted && abs($painted['x'] - $x) < $this->width * 0.2) {
            $x = $painted['x'];
        } else {
            $painted = null;
        }
        // In the floor: lying a little way in. At the back: standing on the floor line. Smaller at the back.
        $feet = $inFloor ? $ground + (int) ($floor * 0.42) : $this->backAt($x, 10);
        $k = Sizes::depth($feet, $ground);
        $w = $painted ? $painted['width'] : ($asset ? (int) round($asset['width'] * $k) : 200);
        $h = $painted ? $painted['height'] : ($asset ? (int) round($asset['height'] * $k) : 300);
        $cy = $inFloor ? $feet : ($painted ? $painted['y'] : $feet - (int) ($h / 2));
        $standY = $inFloor ? $cy : $this->clear($x, $this->backAt($x, 40));
        $radius = (int) max(90, min(190, ($inFloor ? $w : max($w, $h * 0.6)) / 2 + 10));
        $requires = ! empty($p['requires']) ? $this->requirement($p['requires']) : [];
        $twist = $this->blockingTwist($key, $p['to']);
        $looks = function (int $event) use ($mediaId, $x, $cy, $h, $p, $k) {
            if ($mediaId) {
                $this->label($event, 'image', $x, $cy, mediaId: $mediaId, scale: $k);
            }
            $this->text($event, $x, $cy - (int) max(50, $h / 2 + 30), $p['label'], hint: true);
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
            $side = $x < $this->width / 2 ? 1 : -1;

            return ['name' => "from-{$p['to']}", 'position_x' => $x + $side * ($radius + 60), 'position_y' => $cy, 'facing' => $side > 0 ? 'right' : 'left'];
        }

        return ['name' => "from-{$p['to']}", 'position_x' => $x, 'position_y' => $this->clear($x, max($ground + (int) ($floor * 0.4), $this->backAt($x, 90))), 'facing' => $x > $this->width / 2 ? 'left' : 'right'];
    }

    /**
     * A twin of a hotspot for while its requirement is not met: it says why. For a step (several
     * conditions, which cannot be negated as one), it goes by the step's flag and first brings the flags
     * up to date, so a flag that is behind never shows the message wrongly.
     */
    protected function closedTwin(int $sceneId, string $shortname, array $at, int $radius, bool $click, string $requires, ?string $message, array $extra, ?\Closure $looks = null): void
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

    protected function refreshFor(int $sceneId): int
    {
        return $this->refresh[array_search($sceneId, $this->sceneIds, true)];
    }

    /** A small thing's table or flat rock: part of the scenery, solid, staying when the thing is taken. */
    protected function surface(int $sceneId, string $key, int $x, int $base, int $mediaId, array $asset, float $k): void
    {
        $hot = $this->hotspot($sceneId, "surface-$key", [$x, $base - 2], 1, click: false);
        $this->label($hot, 'image', $x, $base - (int) ($asset['height'] * $k / 2), mediaId: $mediaId, params: ['solid' => true, 'solid_radius' => (int) max(30, $asset['width'] * $k * 0.35)], scale: $k);
    }

    // ================================================================== interactions

    protected function interaction(int $sceneId, string $sceneKey, string $key, array $it, int $x, int $ground, int $depth): void
    {
        $scene = $this->scenesByKey[$sceneKey];
        $item = isset($it['item']) ? ($this->itemMedia[$it['item']][2] ?? null) : null;
        // Its picture: the interaction's item, if it has one. Without one, what students look at is part
        // of the background, and only the question mark shows where.
        [$mediaId, $asset] = isset($it['item']) ? ($this->itemMedia[$it['item']] ?? [null, null]) : [null, null];
        $floor = self::HEIGHT - $ground;
        $placement = AssetDirector::placementOf($it, $item, $scene);
        // On a wall, and staying there: painted into the background, with only a hotspot (and its mark) over it.
        if ($placement === 'wall' && AssetDirector::paintedOnWall($it)) {
            [$mediaId, $asset] = [null, null];
        }
        // Where the background shows it, when it is painted in and was found there.
        $painted = ! $asset ? $this->foundAt("thing:$key") : null;
        if ($painted && abs($painted['x'] - $x) < $this->width * 0.2) {
            $x = $painted['x'];
        } else {
            $painted = null;
        }
        // Out on the floor where a patch nobody walks on is, things stand at the back instead.
        if ($placement === 'ground' && $this->clear($x, $ground + (int) ($floor * 0.5)) !== $ground + (int) ($floor * 0.5)) {
            $placement = 'back';
        }
        // Where it is, by where it belongs: where its base is, how much smaller it is drawn for being further
        // back, its picture's centre, and whether players can walk behind it.
        $params = [];
        $k = Sizes::DEPTH_BACK;
        switch ($placement) {
            case 'wall':
                $h = $asset ? (int) round($asset['height'] * $k) : 0;
                $cy = $ground - (int) max($h / 2 + 90, self::HEIGHT * 0.17);
                break;
            case 'surface':
                $base = $ground + 14;
                $k = Sizes::depth($base, $ground);
                $h = $asset ? (int) round($asset['height'] * $k) : 0;
                $top = $base;
                if ($surface = $this->surfaceMedia[AssetDirector::surfaceKind($scene)] ?? null) {
                    $this->surface($sceneId, $key, $x, $base, ...[...$surface, $k]);
                    $top = $base - (int) ($surface[1]['height'] * $k * 0.92);
                }
                $cy = $top - (int) ($h / 2) + 6;
                break;
            case 'ground':
                // Out on the floor, alternately nearer and further, so a scene is not a row along the back.
                $feet = $ground + (int) ($floor * ($depth % 2 ? 0.5 : 0.26));
                $k = Sizes::depth($feet, $ground);
                $h = $asset ? (int) round($asset['height'] * $k) : 0;
                $feet += (int) min($h / 2, 40);
                $cy = $feet - (int) ($h / 2);
                $params = ['placement' => 'object'];
                break;
            default: // back
                $base = $this->backAt($x, 12);
                $k = Sizes::depth($base, $ground);
                $h = $asset ? (int) round($asset['height'] * $k) : 0;
                $cy = $base - (int) ($h / 2);
        }
        $w = $asset ? (int) round($asset['width'] * $k) : 0;
        if (! $asset) {
            // Painted in: the mark floats where the thing is, at the back or on the floor (or where it was found).
            $cy = $painted ? $painted['y'] : ($placement === 'ground' ? $ground + (int) ($floor * 0.28) - 40 : $this->backAt($x, -110));
        }
        $radius = $asset ? (int) max(80, min(170, max($w, $h) / 2 + 20)) : ($painted ? (int) max(70, min(170, max($painted['width'], $painted['height']) / 2 + 10)) : 95);
        $requires = [];
        foreach ($it['requires'] ?? [] as $r) {
            array_push($requires, ...$this->requirement($r));
        }
        $notDone = $it['type'] === 'team_task' ? [] : [$this->cond("done_$key", '=', 0)];
        // A rescue is there while the one it saves is in trouble, and gone once anyone has saved them.
        if ($rescued = $this->rescued($it)) {
            array_push($requires, $this->cond("away_$rescued", '=', 1), $this->cond("saved_$key", '=', 0));
        }
        $reveal = ! empty($it['hidden']);
        // The question mark: just above the thing, or where the painted thing is (over it, when it was found).
        $markerY = $asset ? $cy - (int) ($h / 2) - 34 : ($painted ? max(60, $painted['top'] - 30) : $cy);
        $textY = $markerY - 50;

        // What it looks like: the thing, if it has one, a quiet question mark, and its name when students come near.
        $labels = function (int $event, string $suffix = '', bool $marked = true) use ($mediaId, $x, $cy, $textY, $markerY, $it, $params, $k) {
            if ($mediaId) {
                $this->label($event, 'image', $x, $cy, mediaId: $mediaId, params: $params, scale: $k);
            }
            if ($marked && empty($it['quiet']) && isset($this->itemMedia['__marker'])) {
                $this->label($event, 'image', $x, $markerY, mediaId: $this->itemMedia['__marker'][0], params: ['placement' => 'front']);
            }
            $this->text($event, $x, $textY, $it['label'].$suffix, hint: true);
        };

        switch ($it['type']) {
            case 'collect':
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true, reveal: $reveal);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->complete($hot, $key, $it);
                $this->action($hot, 'variable', ['name' => "has_{$it['item']}", 'operator' => 'set', 'operand' => 1]);
                $this->action($hot, 'infobox', $this->infobox($it['info'], '<p><em>Added to your bag: '.htmlspecialchars($item['name'] ?? $it['item']).'.</em></p>'));
                $this->cutsceneAfter($hot, $sceneKey, $key, $it['cutscene'] ?? []);
                $this->followUps($hot, $sceneKey, $key);
                break;

            case 'inspect':
                // Can be looked at again; it counts once.
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: $requires, block: true, reveal: $reveal);
                $labels($hot);
                foreach ($it['dialogue'] ?? [] as $line) {
                    $this->dialogue($hot, $line);
                }
                $this->action($hot, 'infobox', $this->infobox($it['info']));
                $this->cutsceneAfter($hot, $sceneKey, $key, $it['cutscene'] ?? [], [$this->cond("done_$key", '=', 0)]);
                $this->complete($hot, $key, $it);
                $this->followUps($hot, $sceneKey, $key);
                break;

            case 'use':
                $this->useOnScene($sceneId, $sceneKey, $key, $it, $x, $cy, $radius, $requires, $labels, $reveal, $ground);
                break;

            case 'question':
                $ask = $this->question($sceneId, $sceneKey, $key, $it);
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true, reveal: $reveal);
                $labels($hot);
                $this->action($hot, 'run_event', ['target_event_id' => $ask]);
                break;

            case 'experiment':
                $run = $this->instrument($sceneId, $sceneKey, $key, $it);
                $hot = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], block: true, reveal: $reveal);
                $labels($hot);
                $this->action($hot, 'run_event', ['target_event_id' => $run]);
                break;

            case 'team_task':
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
                $this->action($hot, 'text_overlay', ['text' => "{{QL_PlayerName}}: {$t['part']} ({{team_$key}}/$needed)", 'duration' => 3000]);
                if (! empty($it['award'])) {
                    $this->action($hot, 'award', $it['award'], blocking: false);
                }
                $this->teamDone($hot, $key, $it, $needed, $sceneKey);
                // Students who did their part see who else is needed.
                $wait = $this->hotspot($sceneId, "$key-waiting", [$x, $cy], $radius, click: true, conditions: [...$requires, $this->cond("helped_$key", '=', 1), $this->cond("team_$key", '<', $needed)]);
                $labels($wait);
                $this->action($wait, 'text_overlay', ['text' => "You did your part. {{team_$key}} of $needed have helped: ask your crewmates!", 'duration' => 3000]);
                break;
        }

        // Clicked too early: say what is missing (only when one thing is).
        if (! empty($it['locked_hint']) && ! $rescued && count($it['requires'] ?? []) === 1 && ($negated = $this->negation($it['requires'][0]))) {
            $hint = $this->hotspot($sceneId, "$key-locked", [$x, $cy], $radius, click: true, conditions: [...$negated, ...$notDone], reveal: $reveal);
            $labels($hint);
            $this->action($hint, 'text_overlay', ['text' => $it['locked_hint'], 'duration' => 3000]);
        }
    }

    /**
     * A thing from the bag used on something in the scene. Three hotspots on the one spot: clicked with
     * the thing, it is used (the student walks over, what happens happens); clicked with nothing, or
     * with the wrong thing, it says what is needed; once done, what it was used on stays to be seen.
     */
    protected function useOnScene(int $sceneId, string $sceneKey, string $key, array $it, int $x, int $cy, int $radius, array $requires, \Closure $labels, bool $reveal, int $ground): void
    {
        $holding = $this->cond('QL_Holding', '=', $this->carriedIds[$it['uses']] ?? 0);
        $notDone = [$this->cond("done_$key", '=', 0)];
        $use = $this->hotspot($sceneId, "$key-use", [$x, $cy], $radius, click: true, conditions: [$holding, ...$requires, ...$notDone], block: true, reveal: $reveal);
        $this->action($use, 'freeze', ['frozen' => true]);
        $this->action($use, 'walk', ['target' => 'player', 'to' => 'point', 'position_x' => $x + ($x > $this->width / 2 ? -110 : 110), 'position_y' => max($ground + 40, min(self::HEIGHT - 60, $cy + $radius))]);
        $this->used($use, $sceneKey, $key, $it);

        // Without the thing: what is wrong, and a nudge towards what would help.
        $look = $this->hotspot($sceneId, $key, [$x, $cy], $radius, click: true, conditions: [...$requires, ...$notDone], reveal: $reveal);
        $labels($look);
        $this->action($look, 'text_overlay', ['text' => $it['hint'] ?? 'Something from your bag might help here.', 'duration' => 4000]);
        // Afterwards it is still there to see (a chest stays open), with nothing more to do; not a rescue,
        // whose picture is of someone in trouble.
        if (! $this->rescued($it)) {
            $after = $this->hotspot($sceneId, "$key-done", [$x, $cy], 1, click: false, conditions: [$this->cond("done_$key", '=', 1)]);
            $labels($after, '', false);
        }
    }

    /**
     * What using or giving a thing does, after the student has got there: it leaves the bag (unless it is
     * kept), what is said is said, it counts, a thing given in return goes into the bag, the little scene
     * plays, and what follows it follows.
     */
    protected function used(int $event, string $sceneKey, string $key, array $it): void
    {
        if (empty($it['keeps'])) {
            $this->action($event, 'variable', ['name' => "has_{$it['uses']}", 'operator' => 'set', 'operand' => 0]);
        }
        foreach ($it['dialogue'] ?? [] as $line) {
            $this->dialogue($event, $line);
        }
        if (! empty($it['info'])) {
            $this->action($event, 'infobox', $this->infobox($it['info']));
        }
        $this->complete($event, $key, $it);
        $this->action($event, 'freeze', ['frozen' => false]);
        $this->cutsceneAfter($event, $sceneKey, $key, $it['cutscene'] ?? []);
        $this->followUps($event, $sceneKey, $key);
    }

    /** What happens for everyone when the last part of a team task is done. */
    protected function teamDone(int $event, string $key, array $it, int $needed, string $sceneKey): void
    {
        $done = [$this->cond("team_$key", '>=', $needed)];
        $this->action($event, 'text_overlay', ['text' => $it['team']['success'], 'duration' => 4000], conditions: $done);
        $this->resolve($event, $it, $done);
        $this->cutsceneAfter($event, $sceneKey, $key, $it['cutscene'] ?? [], $done);
        $this->followUps($event, $sceneKey, $key, $done);
    }

    // ===================================================================== cutscenes

    /**
     * A little scene after something is done: an event of its own, shown to everyone in the scene, run
     * from $event (only the first time, with $when). Characters walk, speak, gesture, wait or leave.
     */
    protected function cutsceneAfter(int $event, string $sceneKey, string $key, array $beats, array $when = []): void
    {
        if (! $beats) {
            return;
        }
        $scene = $this->cutscene($sceneKey, $beats, "cutscene-$key");
        $this->action($event, 'run_event', ['target_event_id' => $scene], conditions: $when);
    }

    protected function cutscene(string $sceneKey, array $beats, string $name): int
    {
        $e = $this->event($this->sceneIds[$sceneKey], 'indirect', $name.'-'.(++$this->cutscenes), ['audience' => 'scene']);
        $this->action($e, 'freeze', ['frozen' => true]);
        // A twist's cutscene is built after every scene: go by its own scene's size.
        [$width, $ground] = $this->geometry[$sceneKey] ?? [$this->width, $this->ground];
        foreach ($beats as $beat) {
            $who = $beat['who'] ?? 'player';
            $player = $who === 'player';
            if (! $player && ! isset($this->characterIds[$who])) {
                continue;
            }
            $id = $player ? null : $this->characterIds[$who][0];
            $target = $player ? ['target' => 'player'] : ['target' => 'character', 'character_id' => $id];
            $feet = $player ? $ground + (int) ((self::HEIGHT - $ground) * 0.4) : ($this->characterSpots[$who][1] ?? $ground + 100);
            switch ($beat['do'] ?? '') {
                case 'walk':
                    $this->action($e, 'walk', [...($player ? ['target' => 'player'] : ['character_id' => $id]), 'to' => 'point', 'position_x' => (int) round(max(0.08, min(0.92, (float) $beat['x'])) * $width), 'position_y' => $feet]);
                    break;
                case 'say':
                    $this->dialogue($e, ['speaker' => $who, 'text' => mb_substr((string) $beat['text'], 0, 160)], style: 'bubble');
                    break;
                case 'gesture':
                    $this->action($e, 'animate', [...$target, 'animation' => $this->gesture($who, (string) $beat['gesture'])]);
                    break;
                case 'wait':
                    $this->action($e, 'wait', ['duration' => (int) round(1000 * max(0.5, min(6, (float) ($beat['seconds'] ?? 1.5))))]);
                    break;
                case 'fall':
                    if (! $player) {
                        if (isset($beat['x'])) {
                            $this->action($e, 'walk', ['character_id' => $id, 'to' => 'point', 'position_x' => (int) round(max(0.08, min(0.92, (float) $beat['x'])) * $width), 'position_y' => $feet]);
                        }
                        $this->action($e, 'animate', [...$target, 'animation' => 'jump']);
                        $this->dialogue($e, ['speaker' => $who, 'text' => mb_substr((string) ($beat['text'] ?? 'Whoa! Help!'), 0, 160)], style: 'bubble');
                        // Out of sight (they fade away) until they are saved.
                        $this->action($e, 'variable', ['name' => "away_$who", 'operator' => 'set', 'operand' => 1]);
                    }
                    break;
                case 'leave':
                    if (! $player) {
                        $this->action($e, 'walk', ['character_id' => $id, 'to' => 'point', 'position_x' => ($beat['edge'] ?? 'right') === 'left' ? 20 : $width - 20, 'position_y' => $feet]);
                        $this->action($e, 'variable', ['name' => "away_$who", 'operator' => 'set', 'operand' => 1]);
                    }
                    break;
            }
        }
        $this->action($e, 'freeze', ['frozen' => false]);

        return $e;
    }

    /** The animation for a gesture: drawn for this character if it was, else the nearest move every figure can make. */
    protected function gesture(string $who, string $gesture): string
    {
        $drawn = [];
        if ($who !== 'player' && isset($this->characterIds[$who])) {
            $drawn = array_column((array) ($this->characterIds[$who][2]['params']['animations'] ?? []), 'name');
        }
        if (in_array($gesture, $drawn, true) || in_array($gesture, ['jump', 'spin', 'dance', 'wave'], true)) {
            return $gesture;
        }

        return match ($gesture) {
            'cheer' => 'jump',
            'point' => 'wave',
            default => 'crouch',
        };
    }

    // ===================================================================== ambient

    /**
     * A creature that brings the scene to life, now and then, on each student's own screen: a bird flies
     * in, lands, hops about and flies off; a cat strolls across; fish swim by. Its picture is a little
     * sprite sheet with an `idle` and a `move`.
     */
    protected function ambient(int $sceneId, array $a, int $mediaId, array $sheet, int $i, bool $loop = true): int
    {
        $W = $this->width;
        $ground = $this->ground;
        $floor = self::HEIGHT - $ground;
        $fh = (int) ($sheet['frame_height'] ?? $sheet['height']);
        // Now and then, over and over (a start event); or once, when a story's script says (an indirect event).
        $e = $loop ? $this->event($sceneId, 'start', "ambient-{$a['key']}") : $this->event($sceneId, 'indirect', "pass-{$a['key']}");
        // Some come from the left, some from the right; the picture faces right, so it is mirrored to go left.
        $rightward = $i % 2 === 0;
        $from = $rightward ? -90 : $W + 90;
        $to = $rightward ? $W + 90 : -90;
        $flip = $rightward ? 1 : -1;
        if ($loop) {
            $this->action($e, 'wait', ['duration' => 4000 + 5000 * $i]);
        }
        // The sound it makes as it goes by: a car, hooves, a bird's call.
        if (! empty($a['sound']) && in_array($a['sound'], BlueprintSchema::SOUNDS, true)) {
            $this->action($e, 'audio', ['sound' => $a['sound'], 'volume' => 0.7], blocking: false);
        }
        $show = function (int $x, int $y, string $layer) use ($e, $mediaId, $flip) {
            return $this->action($e, 'image_fixed', ['position_x' => $x, 'position_y' => $y, 'scale_x' => $flip, 'scale_y' => 1, 'layer' => $layer], blocking: false, media: $mediaId);
        };
        $move = fn (int $id) => $this->action($e, 'animate', ['target' => 'action', 'target_id' => $id, 'animation' => 'move'], blocking: false);
        $glide = fn (int $id, int $x, int $y, int $ms) => $this->action($e, 'translate', ['target_id' => $id, 'position_x' => $x, 'position_y' => $y, 'duration' => $ms]);
        $gone = fn (int $id) => $this->action($e, 'cancel', ['action_id' => $id]);
        switch ($a['motion'] ?? 'lands') {
            case 'lands':
                $landX = (int) round($W * ($rightward ? 0.38 : 0.62));
                $landY = $ground + (int) ($floor * 0.18) - (int) ($fh / 2);
                $flying = $show($from, (int) ($ground * 0.3), 'above');
                $move($flying);
                $glide($flying, $landX, $landY, 3200);
                $gone($flying);
                $sitting = $show($landX, $landY, 'sorted');
                $this->action($e, 'wait', ['duration' => 2200]);
                foreach ([1, 1, -1] as $n => $dir) {
                    // A few hops about, pecking between them.
                    $glide($sitting, $landX + ($n + 1) * 26 * $dir * $flip, $landY - 14, 140);
                    $glide($sitting, $landX + ($n + 1) * 30 * $dir * $flip, $landY, 140);
                    $this->action($e, 'wait', ['duration' => 1400 + 500 * $n]);
                }
                $gone($sitting);
                $off = $show($landX + 30 * $flip, $landY, 'above');
                $move($off);
                $glide($off, $to, -120, 2600);
                $gone($off);
                $loop && $this->action($e, 'wait', ['duration' => 16000 + 6000 * $i]);
                break;
            case 'flies_by':
            case 'swims_by':
                $y = ($a['motion'] === 'swims_by') ? (int) ($ground * 0.55) : (int) ($ground * 0.28);
                $by = $show($from, $y, 'above');
                $move($by);
                $glide($by, $to, $y - 60, (int) round(1000 * ($W + 180) / ($a['motion'] === 'swims_by' ? 130 : 260)));
                $gone($by);
                $loop && $this->action($e, 'wait', ['duration' => 18000 + 6000 * $i]);
                break;
            case 'drives_by':
                // Along the back of the floor, at a good speed, among the figures (they stand in front of it).
                [$top] = $this->floorDepth($this->scenesByKey[array_search($sceneId, $this->sceneIds, true)] ?? [], null, $ground, self::HEIGHT);
                $y = $top + (int) ($floor * 0.04) - (int) ($fh / 2);
                $by = $show($from, $y, 'sorted');
                $move($by);
                $glide($by, $to, $y, (int) round(1000 * ($W + 180) / 380));
                $gone($by);
                $loop && $this->action($e, 'wait', ['duration' => 22000 + 7000 * $i]);
                break;
            default: // walks_by
                $y = $this->clear((int) ($W / 2), $ground + (int) ($floor * 0.14)) - (int) ($fh / 2);
                $by = $show($from, $y, 'sorted');
                $move($by);
                $glide($by, $to, $y, (int) round(1000 * ($W + 180) / 75));
                $gone($by);
                $loop && $this->action($e, 'wait', ['duration' => 20000 + 6000 * $i]);
        }
        if ($loop) {
            $this->action($e, 'repeat', []);
        }

        return $e;
    }

    // ===================================================================== questions

    /** The question as an indirect event, with one answer event per choice. Returns the question's event id. */
    protected function question(int $sceneId, string $sceneKey, string $key, array $it): int
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
     * A hands-on instrument: a big box with its controls side by side, what it shows changing at once as
     * they are moved, a test button and a way to step away. Returns its event id.
     *
     * The setup is one event and the loop another (a repeat starts its event again from the top). Each
     * control is saved in c_<key>_<control> when a button is chosen, and the box shows them as they were
     * left when it opens again. Tested with the goal's settings, it is done; otherwise it says why not
     * (the first miss that fits, or a general nudge) and opens again.
     */
    protected function instrument(int $sceneId, string $sceneKey, string $key, array $it): int
    {
        $x = $it['instrument'];
        $menu = "menu_$key";
        $said = "said_$key";
        $run = $this->event($sceneId, 'indirect', "experiment-$key");
        $loop = $this->event($sceneId, 'indirect', "experiment-$key-loop");
        $this->entry[$key] = $run;
        foreach ($it['dialogue'] ?? [] as $line) {
            $this->dialogue($run, $line);
        }
        $this->action($run, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 1]);
        $this->action($run, 'run_event', ['target_event_id' => $loop]);
        $this->cutsceneAfter($run, $sceneKey, $key, $it['cutscene'] ?? [], [$this->cond("done_$key", '=', 1)]);
        // After the loop: questions and twists that follow it, once it is done.
        $this->followUps($run, $sceneKey, $key, [$this->cond("done_$key", '=', 1)]);

        $var = fn (string $control) => "c_{$key}_$control";
        $on = fn (array $conditions) => array_map(fn ($c) => $this->cond($var($c['control']), $c['op'], self::operand($c['value'])), $conditions);
        $this->action($loop, 'variable', ['name' => $said, 'operator' => 'set', 'operand' => 0]);
        $this->action($loop, 'infobox', [
            'content' => self::instrumentHtml($key, $it),
            'call_to_actions' => [
                ['text' => $x['test'], 'action' => ['type' => 'variable', 'name' => $menu, 'operator' => 'set', 'operand' => 2]],
                ['text' => 'Step away', 'action' => ['type' => 'variable', 'name' => $menu, 'operator' => 'set', 'operand' => 0]],
            ],
            'dismissible' => false,
            'size' => 'large',
        ]);
        $tested = [$this->cond($menu, '=', 2)];
        $reached = [...$tested, ...$on($x['goal'])];
        $this->complete($loop, $key, $it, $reached);
        $this->action($loop, 'infobox', ['content' => '<h3>It works!</h3>'.self::paragraphs($x['success'])], conditions: $reached);
        $this->action($loop, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]], conditions: $reached);
        $this->action($loop, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 0], conditions: $reached);
        // Not yet: the first miss whose settings fit, else a general nudge.
        foreach ($x['misses'] ?? [] as $miss) {
            $fits = [...$tested, $this->cond($said, '=', 0), ...$on($miss['when'])];
            $this->action($loop, 'infobox', ['content' => '<h3>Not yet</h3>'.self::paragraphs($miss['text'])], conditions: $fits);
            $this->action($loop, 'variable', ['name' => $said, 'operator' => 'set', 'operand' => 1], conditions: $fits);
        }
        $this->action($loop, 'infobox', ['content' => '<h3>Not yet</h3><p>That did not quite work. Look at what changes as you move things, change something, and test again.</p>'], conditions: [...$tested, $this->cond($said, '=', 0)]);
        $this->action($loop, 'variable', ['name' => $menu, 'operator' => 'set', 'operand' => 1], conditions: $tested);
        $this->action($loop, 'repeat', [], conditions: [$this->cond($menu, '=', 1)]);

        $this->evidenceFor($x['objective'] ?? null, [], $key, 'experiment');

        return $run;
    }

    /** What a control starts at: a slider at its start, a switch off unless it starts on, a wheel not yet spun. */
    public static function controlStart(array $c): int|float|string
    {
        return match ($c['kind']) {
            'slider' => self::operand($c['start'] ?? $c['min'] ?? 0),
            'switch' => (float) ($c['start'] ?? 0) > 0 ? 1 : 0,
            default => '',
        };
    }

    /** A value as a condition compares it: numbers as numbers. */
    protected static function operand(mixed $v): int|float|string
    {
        if (is_numeric($v)) {
            return $v + 0;
        }

        return (string) $v;
    }

    /** The instrument's box: its controls on one panel, its meters, and what it shows as they are set. */
    public static function instrumentHtml(string $key, array $it): string
    {
        $x = $it['instrument'];
        $e = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES);
        $var = fn (string $control) => "c_{$key}_$control";
        $html = '<h3>'.$e($x['title'] ?? $it['label']).'</h3>';
        if (! empty($it['info']['body'])) {
            $html .= self::paragraphs((string) $it['info']['body']);
        }
        $controls = array_column($x['controls'], null, 'key');
        $html .= '<div data-qbl="panel">';
        foreach ($x['controls'] as $c) {
            $v = $var($c['key']);
            $html .= match ($c['kind']) {
                'slider' => '<input data-qbl="slider" data-var="'.$v.'" data-min="'.$e($c['min'] ?? 0).'" data-max="'.$e($c['max'] ?? 10).'" data-step="'.$e($c['step'] ?? 1).'" data-value="{{'.$v.'}}" data-unit="'.$e($c['unit'] ?? '').'" data-label="'.$e($c['label']).'">',
                'switch' => '<input data-qbl="switch" data-var="'.$v.'" data-value="{{'.$v.'}}" data-label="'.$e($c['label']).'">',
                default => '<div data-qbl="wheel" data-var="'.$v.'" data-options="'.$e(implode('|', $c['options'] ?? [])).'" data-value="{{'.$v.'}}" data-label="'.$e($c['label']).'"></div>',
            };
        }
        foreach ($x['meters'] ?? [] as $m) {
            $c = $controls[$m['control']] ?? null;
            if ($c && $c['kind'] === 'slider') {
                $html .= '<div data-qbl="meter" data-var="'.$var($c['key']).'" data-min="'.$e($c['min'] ?? 0).'" data-max="'.$e($c['max'] ?? 10).'" data-unit="'.$e($c['unit'] ?? '').'" data-label="'.$e($m['label']).'"></div>';
            }
        }
        $html .= '</div>';
        foreach ($x['shows'] ?? [] as $show) {
            $when = implode('; ', array_map(fn ($c) => $var($c['control']).' '.$c['op'].' '.$c['value'], $show['when']));
            $html .= '<div data-qbl="when" data-when="'.$e($when).'"><p>'.$e($show['text']).'</p></div>';
        }

        return $html;
    }

    // ===================================================================== arrivals and details

    /**
     * What happens the first time anyone arrives in a scene, shown to everyone there: its title big, what
     * is said, and a little scene (a character slipping off the cliff). Shared, so it happens once.
     */
    protected function arrival(int $sceneId, string $key, array $a, int $arrive, bool $start): void
    {
        $e = $this->event($sceneId, 'indirect', 'arrival', ['audience' => 'scene']);
        $this->action($e, 'variable', ['name' => "arrival_$key", 'operator' => 'set', 'operand' => 1]);
        if (! empty($a['title'])) {
            $this->action($e, 'text_overlay', ['text' => $a['title'], 'text_font_size' => 40, 'duration' => 2600]);
        }
        $lines = $a['dialogue'] ?? [];
        if ($lines) {
            $this->action($e, 'freeze', ['frozen' => true]);
            foreach ($lines as $line) {
                $this->dialogue($e, $line);
            }
            $this->action($e, 'freeze', ['frozen' => false]);
        }
        if ($beats = $a['cutscene'] ?? []) {
            $this->action($e, 'run_event', ['target_event_id' => $this->cutscene($key, $beats, 'arrival')]);
        }
        $this->action($arrive, 'run_event', ['target_event_id' => $e], conditions: [$this->cond("arrival_$key", '=', 0)]);
    }

    /**
     * Something in the background to look at: its name when students come near or point at it, and what
     * they notice, as their own thought. Nothing to pick up or count.
     */
    protected function detail(int $sceneId, int $i, array $d, int $x, int $ground): void
    {
        $floor = self::HEIGHT - $ground;
        $y = ($d['placement'] ?? 'back') === 'ground' ? $this->clear($x, $ground + (int) ($floor * 0.3)) : $this->backAt($x, -110);
        $radius = 85;
        // Where the background shows it, when it was found there.
        if (($at = $this->foundAt("detail:$i")) && abs($at['x'] - $x) < $this->width * 0.2) {
            [$x, $y] = [$at['x'], $at['y']];
            $radius = (int) max(60, min(160, max($at['width'], $at['height']) / 2 + 10));
        }
        $hot = $this->hotspot($sceneId, "detail-$i", [$x, $y], $radius, click: true);
        $this->text($hot, $x, $y - 60, $d['label'], hint: true);
        $this->dialogue($hot, ['speaker' => 'player', 'text' => $d['text']], style: 'bubble');
    }

    /**
     * A character's click event. It brings the checklist up to date, then runs the first thing that
     * applies: a thing from the bag given to them (when they want it; otherwise they say so), the final
     * report (guide, once every required step is done), then each of the character's talks whose
     * requirements are met and which has not been had; with none left, what they still need, or a short
     * reminder.
     */
    protected function talkDispatcher(int $sceneId, array $c, string $sceneKey): int
    {
        $dispatch = $this->event($sceneId, 'indirect', "chat-{$c['key']}");
        $this->action($dispatch, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);
        $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 0]);

        // Things given to them. Only a character who wants something takes things from the bag at all.
        $gives = array_filter($this->interactions, fn ($it) => $it['type'] === 'use' && ($it['character'] ?? null) === $c['key']);
        $empty = $gives ? [$this->cond('QL_Holding', '=', 0)] : [];
        $pending = null;
        foreach ($gives as $key => $it) {
            $requires = [];
            foreach ($it['requires'] ?? [] as $r) {
                array_push($requires, ...$this->requirement($r));
            }
            $give = $this->event($sceneId, 'indirect', "give-$key");
            $this->entry[$key] = $give;
            $this->action($give, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1]);
            $this->action($give, 'freeze', ['frozen' => true]);
            $this->used($give, $sceneKey, $key, $it);
            $this->action($dispatch, 'run_event', ['target_event_id' => $give], conditions: [$this->cond('QL_Holding', '=', $this->carriedIds[$it['uses']] ?? 0), ...$requires, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)]);
            $pending ??= [$key, $it, $requires];
        }
        if ($gives) {
            // Anything else from the bag: not what they need.
            $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => 'Hmm, no thank you. That is not what I need.'], [$this->cond('QL_Holding', '!=', 0), $this->cond('talked', '=', 0)], style: 'bubble');
            $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1], conditions: [$this->cond('QL_Holding', '!=', 0)]);
        }

        if ($c['key'] === $this->guide) {
            $report = $this->reportEvent($sceneId, $c, $sceneKey);
            $this->action($dispatch, 'run_event', ['target_event_id' => $report], conditions: [...$empty, ...$this->readyConditions(), $this->cond('mission_complete', '=', 0), $this->cond('talked', '=', 0)]);
        }

        foreach ($this->interactions as $key => $it) {
            if ($it['type'] !== 'talk' || ($it['character'] ?? '') !== $c['key']) {
                continue;
            }
            $talk = $this->event($sceneId, 'indirect', "talk-$key");
            $this->entry[$key] = $talk;
            $this->action($talk, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1]);
            if ($this->gesture($c['key'], 'wave') === 'wave' && in_array('wave', array_column((array) ($this->characterIds[$c['key']][2]['params']['animations'] ?? []), 'name'), true)) {
                $this->action($talk, 'animate', ['target' => 'character', 'character_id' => $this->characterIds[$c['key']][0], 'animation' => 'wave'], blocking: false);
            }
            $this->action($talk, 'freeze', ['frozen' => true]);
            foreach ($it['dialogue'] as $line) {
                $this->dialogue($talk, $line);
            }
            $this->action($talk, 'freeze', ['frozen' => false]);
            $this->complete($talk, $key, $it);
            $this->cutsceneAfter($talk, $sceneKey, $key, $it['cutscene'] ?? []);
            $this->followUps($talk, $sceneKey, $key);
            $requires = [];
            foreach ($it['requires'] ?? [] as $r) {
                array_push($requires, ...$this->requirement($r));
            }
            $this->action($dispatch, 'run_event', ['target_event_id' => $talk], conditions: [...$empty, ...$requires, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)]);
            if (! empty($it['locked_hint']) && count($it['requires'] ?? []) === 1 && ($negated = $this->negation($it['requires'][0]))) {
                $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $it['locked_hint']], [...$empty, ...$negated, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)], style: 'bubble');
                $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1], conditions: [...$empty, ...$negated, $this->cond("done_$key", '=', 0)]);
            }
        }
        // Still wanting something: they say what.
        if ($pending) {
            [$key, $it, $requires] = $pending;
            $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $it['hint'] ?? 'If only I had the right thing...'], [...$empty, ...$requires, $this->cond("done_$key", '=', 0), $this->cond('talked', '=', 0)], style: 'bubble');
            $this->action($dispatch, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1], conditions: [...$empty, ...$requires, $this->cond("done_$key", '=', 0)]);
        }
        $reminder = $c['key'] === $this->guide ? 'Check your mission checklist, {{QL_PlayerName}}. You can do this!' : 'Good luck with the mission, {{QL_PlayerName}}!';
        $this->dialogue($dispatch, ['speaker' => $c['key'], 'text' => $reminder], [...$empty, $this->cond('talked', '=', 0)], style: 'bubble');

        return $dispatch;
    }

    /**
     * The final report. The guide asks the debrief questions not yet answered, and, once every one is
     * answered right, celebrates and completes the mission. With a question still wrong, the student is
     * sent to think again and comes back.
     */
    protected function reportEvent(int $sceneId, array $c, string $sceneKey): int
    {
        $charId = $this->characterIds[$c['key']][0];
        $debrief = array_keys(array_filter($this->interactions, fn ($it) => $it['type'] === 'question' && ! empty($it['at_report'])));
        $report = $this->event($sceneId, 'indirect', 'report');
        $this->action($report, 'variable', ['name' => 'talked', 'operator' => 'set', 'operand' => 1]);
        $this->action($report, 'freeze', ['frozen' => true]);
        if ($debrief) {
            $this->dialogue($report, ['speaker' => $c['key'], 'text' => $this->blueprintCompletion['debrief'] ?? 'Welcome back! Before we finish, tell me what you worked out.']);
            $this->action($report, 'variable', ['name' => 'report_ok', 'operator' => 'set', 'operand' => 1]);
            foreach ($debrief as $q) {
                $this->action($report, 'run_event', ['target_event_id' => $this->entry[$q]], conditions: [$this->cond("done_$q", '=', 0)]);
                $this->action($report, 'variable', ['name' => 'report_ok', 'operator' => 'set', 'operand' => 0], conditions: [$this->cond("done_$q", '=', 0)]);
            }
            $this->dialogue($report, ['speaker' => $c['key'], 'text' => 'Hmm, not everything adds up yet. Look at what you found again, then come back and tell me.'], [$this->cond('report_ok', '=', 0)]);
        }

        $finale = $this->event($sceneId, 'indirect', 'finale');
        // "cheer" when it was drawn; otherwise the built-in jump.
        $this->action($finale, 'animate', ['target' => 'character', 'character_id' => $charId, 'animation' => $this->gesture($c['key'], 'cheer')], blocking: false);
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
        if (! empty($this->blueprintCompletion['cutscene'])) {
            $this->action($finale, 'run_event', ['target_event_id' => $this->cutscene($sceneKey, $this->blueprintCompletion['cutscene'], 'cutscene-finale')]);
        }

        $this->action($report, 'run_event', ['target_event_id' => $finale], conditions: $debrief ? [$this->cond('report_ok', '=', 1)] : []);
        $this->action($report, 'freeze', ['frozen' => false]);

        return $report;
    }

    /**
     * What a character does on their own, run by the game server for everyone: stroll between their spots
     * (or, older blueprints, pace either side of theirs), and now and then say one of their lines in a bubble.
     */
    protected function routine(array $c, int $x, int $feet): ?array
    {
        $chatter = array_values(array_filter((array) ($c['chatter'] ?? []), fn ($l) => is_string($l) && trim($l) !== ''));
        $say = fn (int $i) => isset($chatter[$i]) ? [['type' => 'dialogue', 'text' => mb_substr($chatter[$i], 0, 120)]] : [];
        $min = 230;
        $max = $this->width - 230;
        if ($c['key'] !== $this->guide && ! empty($c['walks'])) {
            $steps = [];
            foreach (array_values($c['walks']) as $i => $f) {
                $steps[] = ['type' => 'walk', 'to' => 'point', 'position_x' => (int) max($min, min($max, round((float) $f * $this->width))), 'position_y' => $this->clear((int) round((float) $f * $this->width), $feet)];
                $steps[] = ['type' => 'wait', 'duration' => 3000 + 1500 * ($i % 3)];
                array_push($steps, ...$say($i));
            }

            return ['steps' => $steps, 'loop' => true];
        }
        if ($this->moves($c)) {
            return ['steps' => [
                ['type' => 'walk', 'to' => 'point', 'position_x' => max($min, $x - self::WANDER), 'position_y' => $feet],
                ['type' => 'wait', 'duration' => 2500],
                ...$say(0),
                ['type' => 'walk', 'to' => 'point', 'position_x' => min($max, $x + self::WANDER), 'position_y' => $feet],
                ['type' => 'wait', 'duration' => 3500],
                ...$say(1),
            ], 'loop' => true];
        }
        if ($chatter) {
            $steps = [];
            foreach ($chatter as $i => $_) {
                $steps[] = ['type' => 'wait', 'duration' => 9000 + 5000 * $i];
                array_push($steps, ...$say($i));
            }

            return ['steps' => $steps, 'loop' => true];
        }

        return null;
    }

    /** Whether a character walks about on their own: never the guide, whom students must be able to find. */
    protected function moves(array $c): bool
    {
        return (! empty($c['walks']) || ! empty($c['wanders'])) && $c['key'] !== $this->guide;
    }

    /**
     * Marks an interaction done: adds to the counters of its steps (once), gives its award and anything it
     * hands over into the bag, clears a twist it sets right, sets its flag. $when: further conditions on all
     * of it (an experiment's target being reached).
     */
    protected function complete(int $event, string $key, array $it, array $when = []): void
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
        if (! empty($it['gives']) && $it['type'] !== 'collect' && isset($this->carriedIds[$it['gives']])) {
            $name = $this->itemMedia[$it['gives']][2]['name'] ?? $it['gives'];
            $this->action($event, 'variable', ['name' => "has_{$it['gives']}", 'operator' => 'set', 'operand' => 1], conditions: $first);
            $this->action($event, 'text_overlay', ['text' => "Added to your bag: $name", 'alignment' => 'bottom center', 'duration' => 3000], blocking: false, conditions: $first);
        }
        $this->resolve($event, $it, $when);
        if ($rescued = $this->rescued($it)) {
            // Saved, for everyone: they are back where they stood.
            $this->action($event, 'variable', ['name' => "saved_$key", 'operator' => 'set', 'operand' => 1], conditions: $when);
            $this->action($event, 'variable', ['name' => "away_$rescued", 'operator' => 'set', 'operand' => 0], conditions: $when);
            $this->action($event, 'text_overlay', ['text' => $this->characterIds[$rescued][1]['name'].' is safe!', 'text_font_size' => 34, 'duration' => 3000], blocking: false, conditions: $when);
            // While they fade back in, before anything they say.
            $this->action($event, 'wait', ['duration' => 700], conditions: $when);
        }
        $this->action($event, 'variable', ['name' => "done_$key", 'operator' => 'set', 'operand' => 1], conditions: $when);
        if (isset($this->cutAfter[$key])) {
            $this->cutEvents[$key][] = [$event, $when];
        }
    }

    /** The character an interaction saves, if it is a rescue of someone who can be away. */
    protected function rescued(array $it): ?string
    {
        $c = $it['rescues'] ?? null;

        return $c && isset($this->vars["away_$c"], $this->characterIds[$c]) ? $c : null;
    }

    /** An interaction that sets a twist right clears the way (for everyone). */
    protected function resolve(int $event, array $it, array $when): void
    {
        $twist = $it['resolves'] ?? null;
        if (! $twist || ! isset($this->twists[$twist]) || (empty($this->twists[$twist]['blocks']) && empty($this->twists[$twist]['obstacle']))) {
            return;
        }
        $this->action($event, 'text_overlay', ['text' => 'The way is clear again!', 'text_font_size' => 34, 'duration' => 3000], blocking: false, conditions: [...$when, $this->cond("blocked_$twist", '=', 1)]);
        $this->action($event, 'variable', ['name' => "blocked_$twist", 'operator' => 'set', 'operand' => 0], conditions: $when);
    }

    /** After an interaction is done: bring the checklist up to date, then any question and any twist that follows it. */
    protected function followUps(int $event, string $sceneKey, string $key, array $when = []): void
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
    protected function twistScene(string $twist): ?string
    {
        return $this->interactions[$this->twists[$twist]['after'] ?? '']['scene'] ?? null;
    }

    /** The twist, if any, that blocks the way from this scene to that one. */
    protected function blockingTwist(string $scene, string $to): ?string
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
     * a startled hop, what the characters say and do about it; the way it blocks closes for everyone.
     */
    protected function twistEvent(string $twist, string $sceneKey): int
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
        if (! empty($t['cutscene']) && $this->twistScene($twist) === $sceneKey) {
            $this->action($e, 'run_event', ['target_event_id' => $this->cutscene($sceneKey, $t['cutscene'], "cutscene-$twist")]);
        }
        $this->action($e, 'run_event', ['target_event_id' => $this->refresh[$sceneKey]]);

        return $e;
    }

    /**
     * Where a twist's obstacle stands: [x as a fraction, or null to be spread like anything else; feet].
     * In front of the doorway, door or hole it blocks, or beside the edge it blocks.
     */
    protected function obstacleSpot(array $t, array $ends, int $ground): array
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
    protected function obstacle(int $sceneId, string $twist, array $t, int $x, int $feet): void
    {
        [$mediaId, $asset, $item] = $this->itemMedia[$t['obstacle']['item']] ?? [null, null, null];
        if (! $mediaId) {
            return;
        }
        $k = Sizes::depth($feet, $this->ground);
        $h = (int) round($asset['height'] * $k);
        $w = (int) round($asset['width'] * $k);
        $cy = $feet - (int) ($h / 2);
        $hot = $this->hotspot($sceneId, "obstacle-$twist", [$x, $cy], (int) max(90, min(200, $w / 2)), click: true, conditions: [$this->cond("blocked_$twist", '=', 1)]);
        $this->label($hot, 'image', $x, $cy, mediaId: $mediaId, params: ['placement' => 'object', 'solid' => true, 'solid_radius' => (int) max(40, $w * 0.4)], scale: $k);
        $this->text($hot, $x, $cy - (int) ($h / 2) - 30, $item['name'], hint: true);
        $this->action($hot, 'text_overlay', ['text' => $t['blocks']['message'] ?? "The {$item['name']} is in the way. You must deal with it.", 'duration' => 3000]);
    }

    /**
     * Each scene has one: sets each step's flag once its interactions are done, changes the guide's
     * label when the mission is ready to report, and tells the student so, once.
     */
    protected function refreshEvent(int $sceneId): int
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
     * What "done" means for a requirement key: an interaction's or a combination's flag, a team's count,
     * a twist having happened, or all of a step's interactions (read live, so a step a teammate finished
     * counts at once).
     */
    protected function requirement(string $key): array
    {
        if (isset($this->steps[$key])) {
            return $this->stepConditions($key);
        }
        if (isset($this->twists[$key])) {
            return [$this->cond("twist_$key", '=', 1)];
        }
        if (isset($this->combinations[$key])) {
            return [$this->cond("done_$key", '=', 1)];
        }
        $it = $this->interactions[$key] ?? throw new GenerationError("Unknown requirement $key.");

        if ($it['type'] === 'team_task') {
            return [$this->cond("team_$key", '>=', $this->teamNeeded($it))];
        }

        // Someone saved is saved for everyone: whoever did it, it counts for the whole team.
        return isset($this->vars["saved_$key"]) ? [$this->cond("saved_$key", '=', 1)] : [$this->cond("done_$key", '=', 1)];
    }

    protected function teamNeeded(array $it): int
    {
        return (int) $it['team']['needed'];
    }

    /** The opposite of requirement(), when it is a single condition. */
    protected function negation(string $key): ?array
    {
        $c = $this->requirement($key);
        $flip = ['=' => '!=', '>=' => '<'];

        return count($c) === 1 ? [$this->cond($c[0]['variable'], $flip[$c[0]['operator']], $c[0]['operand'])] : null;
    }

    /** The live conditions of a step: all its interactions done. */
    protected function stepConditions(string $key): array
    {
        $out = [];
        foreach ($this->steps[$key]['done_when'] as $k) {
            array_push($out, ...$this->requirement($k));
        }

        return $out;
    }

    /** Every required step done, read live. */
    protected function readyConditions(): array
    {
        $out = [];
        foreach ($this->steps as $key => $s) {
            if (empty($s['optional'])) {
                array_push($out, ...$this->stepConditions($key));
            }
        }

        return array_values(array_unique($out, SORT_REGULAR));
    }

    protected function stepsWith(string $interaction): array
    {
        return array_keys(array_filter($this->steps, fn ($s) => in_array($interaction, $s['done_when'], true)));
    }

    /** Whether a step shows a count: several interactions, each one every student does (not a team's, whose progress is shared). */
    protected function counted(array $step): bool
    {
        return count($step['done_when']) > 1
            && ! array_filter($step['done_when'], fn ($k) => ($this->interactions[$k]['type'] ?? '') === 'team_task' || isset($this->vars["saved_$k"]));
    }

    // ===================================================================== evidence

    protected function evidenceFor(?string $objective, array $codes, string $key, string $type): void
    {
        $this->evidenceLog[] = ['objective' => $objective, 'codes' => $codes, 'interaction' => $key, 'type' => $type];
    }

    protected function evidenceVariables(array $alignment): array
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
                        default => ['interaction' => $k, 'type' => 'experiment', 'completed' => "done_$k"],
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

    protected function id(string $table): int
    {
        return $this->next[$table] = ($this->next[$table] ?? 0) + 1;
    }

    protected function variable(string $name, mixed $default, string $scope = 'player', bool $persist = true): void
    {
        if (isset($this->vars[$name])) {
            return;
        }
        $this->vars[$name] = true;
        $this->rows['variables'][] = ['id' => $this->id('variables'), 'variable_name' => $name, 'default_value' => $default, 'scope' => $scope, 'persist' => $persist];
    }

    protected function media(string $name, array $asset, int $priority): int
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

    protected function event(int $sceneId, string $kind, string $shortname, array $extra = []): int
    {
        $id = $this->id('events');
        $this->rows['events'][] = $extra + [
            'id' => $id, 'scene_id' => $sceneId, 'kind' => $kind, 'shortname' => mb_substr($shortname, 0, 60), 'sequence' => $id,
            'overridable' => false, 'block_hotspots' => false, 'position_x' => null, 'position_y' => null, 'radius' => null, 'activate_by_trigger' => false, 'once' => false, 'audience' => 'player',
        ];

        return $id;
    }

    /** @param array{0: ?int, 1: ?int} $at */
    protected function hotspot(int $sceneId, string $shortname, array $at, int $radius, bool $click, array $conditions = [], bool $block = false, string $audience = 'player', bool $reveal = false): int
    {
        $id = $this->event($sceneId, 'hotspot', $shortname, [
            'position_x' => $at[0], 'position_y' => $at[1], 'radius' => $radius, 'activate_by_trigger' => $click, 'block_hotspots' => $block, 'audience' => $audience,
        ] + ($reveal ? ['reveal_radius' => self::REVEAL[0], 'reveal_full_radius' => self::REVEAL[1]] : []));
        foreach ($conditions as $c) {
            $this->rows['conditions'][] = ['id' => $this->id('conditions'), 'event_id' => $id, 'action_id' => null] + $c;
        }

        return $id;
    }

    protected function action(int $event, string $type, array $params, bool $blocking = true, array $conditions = [], ?int $media = null): int
    {
        $id = $this->id('actions');
        $this->rows['actions'][] = ['id' => $id, 'event_id' => $event, 'type' => $type, 'sequence' => $id, 'blocking' => $blocking, 'media_id' => $media, 'params' => $params];
        foreach ($conditions as $c) {
            $this->rows['conditions'][] = ['id' => $this->id('conditions'), 'event_id' => null, 'action_id' => $id] + $c;
        }

        return $id;
    }

    /** A label: text, or a picture drawn at $scale (smaller towards the back of the floor). */
    protected function label(int $event, string $type, int $x, int $y, ?string $text = null, ?int $mediaId = null, array $params = [], float $scale = 1.0): void
    {
        $scale = round($scale, 3);
        // Nothing in a generated scene pulses: a quiet question mark shows what can be clicked.
        $params += ['pulse' => false];
        $this->rows['labels'][] = ['id' => $this->id('labels'), 'event_id' => $event, 'type' => $type, 'position_x' => $x, 'position_y' => $y, 'scale_x' => $scale, 'scale_y' => $scale, 'text' => $text, 'media_id' => $mediaId] + ($params ? ['params' => $params] : []);
    }

    /**
     * A text label, moved up a line while it would run into one already in this scene. Twins of one
     * hotspot (the same text at the same spot) share their place. $measure: the text to measure by, when
     * $text is a placeholder. $hint: shown only while the student is near or points at it.
     */
    protected function text(int $event, int $x, int $y, string $text, ?string $measure = null, bool $hint = false): void
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
        $this->label($event, 'text', $x, $this->labelSlots[$key][1], text: $text, params: $hint ? ['show_near' => self::HINT_NEAR] : []);
    }

    protected function dialogue(int $event, array $line, array $conditions = [], string $style = 'portrait'): void
    {
        $params = ['style' => $style, 'text' => mb_substr((string) $line['text'], 0, 250)];
        if (($line['speaker'] ?? 'player') !== 'player' && isset($this->characterIds[$line['speaker']])) {
            $params += ['speaker' => 'character', 'character_id' => $this->characterIds[$line['speaker']][0]];
        }
        $this->action($event, 'dialogue', $params, conditions: $conditions);
    }

    protected function cond(string $variable, string $operator, mixed $operand): array
    {
        return ['type' => 'variable', 'variable' => $variable, 'operator' => $operator, 'operand' => $operand];
    }

    /** A condition inside an infobox button, which is written into the action's params as it is in the document. */
    protected function plain(string $variable, string $operator, mixed $operand): array
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
    public static function spread(array $wanted, int $gap, int $min, int $max, array $fixed = [], int $width = self::WIDTH): array
    {
        $wanted = array_diff_key($wanted, $fixed);
        if (! $fixed) {
            return self::spreadBetween($wanted, $gap, $min, $max, $width);
        }
        asort($fixed);
        $out = [];
        $from = $min;
        $rest = $wanted;
        foreach ($fixed as $key => $f) {
            $x = (int) round($f * $width);
            $out[$key] = $x;
            $left = array_filter($rest, fn ($v) => $v * $width < $x);
            $rest = array_diff_key($rest, $left);
            $out += self::spreadBetween($left, $gap, $from, $x - $gap, $width);
            $from = $x + $gap;
        }

        return $out + self::spreadBetween($rest, $gap, $from, $max, $width);
    }

    protected static function spreadBetween(array $wanted, int $gap, int $min, int $max, int $width = self::WIDTH): array
    {
        asort($wanted);
        $keys = array_keys($wanted);
        $xs = array_map(fn ($f) => (int) max($min, min($max, round($f * $width))), array_values($wanted));
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

    /** An infobox's params for what students observe: the rich parts make it a larger box. */
    protected function infobox(array $info, string $after = ''): array
    {
        $picture = isset($info['picture']) ? ($this->itemMedia[$info['picture']] ?? null) : null;
        $html = self::html($info, $picture[0] ?? null, $picture[2]['name'] ?? '').$after;
        $rich = $picture || ! empty($info['cards']) || ! empty($info['reveal']);

        return ['content' => $html] + ($rich ? ['size' => 'large'] : []);
    }

    /**
     * What students observe, as HTML: the heading, a picture, the text, then a coloured note, cards that
     * turn over and a card that opens.
     */
    public static function html(array $info, ?int $pictureId = null, string $alt = ''): string
    {
        $e = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES);
        $html = '<h3>'.$e($info['title']).'</h3>';
        if ($pictureId) {
            $html .= '<p><img src="{{media:'.$pictureId.'}}" alt="'.$e($alt).'"></p>';
        }
        $html .= self::paragraphs((string) $info['body']);
        if (! empty($info['callout']['text'])) {
            $tone = in_array($info['callout']['tone'] ?? '', BlueprintSchema::CALLOUT_TONES, true) ? $info['callout']['tone'] : 'fact';
            $html .= '<div data-qbl="callout" data-tone="'.$tone.'"><p>'.$e($info['callout']['text']).'</p></div>';
        }
        // Flip cards on their own (not on a panel), so the editor shows each as a card it can edit.
        foreach ($info['cards'] ?? [] as $card) {
            $html .= '<div data-qbl="flip"><div><p>'.$e($card['front']).'</p></div><div><p>'.$e($card['back']).'</p></div></div>';
        }
        if (! empty($info['reveal']['prompt'])) {
            $html .= '<details><summary>'.$e($info['reveal']['prompt']).'</summary><p>'.$e($info['reveal']['text'] ?? '').'</p></details>';
        }

        return $html;
    }

    protected static function paragraphs(string $text): string
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
