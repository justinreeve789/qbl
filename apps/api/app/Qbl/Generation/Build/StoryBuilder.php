<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Characters\NpcCharacter;
use App\Qbl\Generation\Design\BlueprintSchema;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;

/**
 * Turns a story blueprint (StorySchema) and its pictures into rows of the QBL tables, as MissionBuilder
 * does for a mission, and with its helpers: the scenes look and live the same way (layers, far views,
 * skies, lights, the air, weather, water, creatures and vehicles going by).
 *
 * Every scene is a story scene (`story`): no avatars, the player does not walk, the view follows whoever
 * acts. Its script becomes one start event that acts it out, beat by beat: the narrator's captions (read
 * aloud in the narrator's voice), lines in speech bubbles (in each character's voice), walks on, about and
 * off the stage, gestures, sounds, the weather changing, a car going by; then a jump to the next scene.
 * The last scene ends with "The End", the things to talk about, and a button to watch it again.
 *
 * Who stands where is followed beat by beat, so a character turns to face whoever they speak to and
 * walks from where they are. Characters not on the stage when a scene opens wait off it, beyond the edge
 * they will come on from.
 */
class StoryBuilder extends MissionBuilder
{
    /** How far beyond an edge someone waits, or walks off to. */
    private const OFFSTAGE = 220;

    /** How fast characters stroll, and hurry, in scene pixels per second. */
    private const STROLL = 150;

    private const HURRY = 300;

    /** Rows of the floor (shares of its depth) where the cast stand, in the order they appear in a scene: not all on one line. */
    private const LANES = [0.38, 0.55, 0.26, 0.66, 0.46, 0.32];

    /** character key => [x, feet, facing] while on the stage of the scene being built */
    private array $at = [];

    public function build(array $blueprint, array $alignment, array $assets, array $options = []): array
    {
        $this->rows = array_fill_keys(['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'], []);
        $b = $blueprint;
        if (count($b['scenes'] ?? []) === 0) {
            throw new GenerationError('The story has no scenes.');
        }
        foreach ($b['scenes'] as $s) {
            $this->scenesByKey[$s['key']] = $s;
        }
        $this->variable('mission_complete', 0);

        // ---------------------------------------------------------------- media
        foreach ($b['items'] ?? [] as $item) {
            if ($asset = $assets["item:{$item['key']}"] ?? null) {
                $this->itemMedia[$item['key']] = [$this->media("item-{$item['key']}", $asset, 40), $asset, $item + ['kind' => 'prop']];
            }
        }
        foreach ($b['characters'] as $c) {
            $sheet = $assets["char:{$c['key']}"] ?? throw new GenerationError("There is no picture for the character {$c['key']}.");
            $mediaId = $this->media("character-{$c['key']}", $sheet, 10);
            $portrait = isset($assets["portrait:{$c['key']}"]) ? $this->media("portrait-{$c['key']}", $assets["portrait:{$c['key']}"], 30) : null;
            $id = $this->id('characters');
            $animations = NpcCharacter::animationsFromPicture(['id' => $mediaId] + (array) ($sheet['params'] ?? []), $portrait);
            $this->rows['characters'][] = ['id' => $id, 'name' => $c['name'], 'media_id' => $mediaId, 'settings' => array_filter([
                'scale' => self::characterScale($c, $sheet), 'animations' => $animations, 'tts_voice' => $options['voices'][$c['key']] ?? null, 'walk_speed' => self::STROLL,
            ])];
            $this->characterRows[$c['key']] = array_key_last($this->rows['characters']);
            $this->characterIds[$c['key']] = [$id, $c, $sheet];
        }

        // ---------------------------------------------------------------- scenes, in the order they are told
        foreach ($b['scenes'] as $s) {
            $this->sceneIds[$s['key']] = $this->id('scenes');
        }
        $keys = array_column($b['scenes'], 'key');
        foreach ($b['scenes'] as $i => $s) {
            $this->storyScene($s, $i + 1, $assets, $b, $keys[$i + 1] ?? null);
        }

        // ---------------------------------------------------------------- the scenario
        $this->rows['scenario'] = [
            'id' => 1,
            'shortname' => self::slug($b['title']),
            'title' => $b['title'],
            'subtitle' => $b['subtitle'],
            'description' => $b['description'],
            'start_scene_id' => $this->sceneIds[$keys[0]],
            'enable_save_session' => true,
            'require_login' => true,
            'allow_groups' => true,
            'max_players' => (int) ($options['max_players'] ?? 30),
            'default_language' => 'en-us',
            'settings' => array_filter([
                'spec_version' => 2,
                'visibility' => 'private',
                'chat_mode' => 'emotes',
                'move_speed' => 420,
                // Read aloud: the narration, and every line (in the characters' voices once recorded).
                'narration' => 'on',
                'narrator_voice' => $options['voices']['__narrator'] ?? null,
                'objectives' => [['id' => 'watch', 'text' => 'Watch the story to the end', 'complete_when' => [$this->cond('mission_complete', '=', 1)]]],
                'curriculum' => [
                    'standards' => array_map(fn ($s) => ['framework' => $s['framework'], 'code' => $s['code'], 'description' => $s['description'], 'alignment' => $s['alignment'], 'rationale' => $s['rationale']], $alignment['standards']),
                    'learning_objectives' => $alignment['learning_objectives'],
                    'vocabulary' => $alignment['vocabulary'],
                    'evidence' => $this->evidenceVariables($alignment),
                    'scored_questions' => 0,
                    'discussion' => array_values($b['ending']['discussion'] ?? []),
                ],
                'generated' => array_filter(['by' => 'qbl:generate', 'format' => 'story', 'generation_id' => $options['generation_id'] ?? null, 'art_style' => $options['style'] ?? null, 'at' => gmdate('c')]),
            ], fn ($v) => $v !== null),
        ];
        foreach ($alignment['standards'] as $s) {
            $this->evidence[$s['code']] ??= [];
        }

        return ['rows' => $this->rows, 'files' => $this->files, 'evidence' => $this->evidence];
    }

    /** Characters who are ever on the stage of a scene: its cast, then those who come on. */
    public static function appearing(array $scene): array
    {
        $out = [];
        foreach ($scene['cast'] ?? [] as $c) {
            $out[$c['who']] ??= ['from' => null, 'cast' => $c];
        }
        foreach ($scene['script'] ?? [] as $beat) {
            if (($beat['do'] ?? '') === 'enter' && ! empty($beat['who'])) {
                $out[$beat['who']] ??= ['from' => $beat['from'] ?? 'left', 'cast' => null];
            }
        }

        return $out;
    }

    private function storyScene(array $scene, int $sequence, array $assets, array $b, ?string $next): void
    {
        $key = $scene['key'];
        $sceneId = $this->sceneIds[$key];
        $W = $this->width = Sizes::sceneWidth($scene);
        $H = self::HEIGHT;
        $ground = $this->ground = (int) round($H * max(0.5, min(0.85, (float) $scene['ground_line'])));
        $this->geometry[$key] = [$W, $ground];
        $floor = $H - $ground;
        $bg = $assets["bg:$key"] ?? throw new GenerationError("There is no background for the scene $key.");
        $bgId = $this->media("background-$key", $bg, $sequence === 1 ? 1 : 10 + $sequence);
        $this->labelSlots = [];
        // Characters come and go by both edges, so the floor reaches them.
        [$left, $right] = $this->floorEnds($scene, $W, true, true);
        [$layersFront, $foreground] = $this->foregroundLayer($scene, $key, $sequence, $assets, $W, $H);
        [$top, $bottom] = $this->floorDepth($scene, $foreground, $ground, $H);

        // Props and lights stand where they are asked, spread so they do not overlap.
        $anchors = [];
        foreach (array_values($scene['props'] ?? []) as $i => $p) {
            $anchors["prop:$i"] = (float) $p['x'];
        }
        foreach (array_values($scene['lights'] ?? []) as $i => $l) {
            $anchors["light:$i"] = (float) $l['x'];
        }
        $xs = self::spread($anchors, 220, 160, $W - 160, [], $W);
        $layoutItems = [];
        foreach (array_values($scene['props'] ?? []) as $i => $p) {
            [$mediaId, $asset, $item] = $this->itemMedia[$p['item']] ?? [null, null, null];
            if (! $mediaId) {
                continue;
            }
            $itemId = $this->id('items');
            $this->rows['items'][] = ['id' => $itemId, 'name' => $item['name'], 'unique' => true, 'physical' => false, 'blocking' => false, 'wearable' => false, 'vehicle' => false, 'media_id' => $mediaId, 'settings' => ['scale' => 1]];
            $layoutItems[] = ['item_id' => $itemId, 'position_x' => $xs["prop:$i"], 'position_y' => Sizes::cm($item) > 150 ? $top + 10 : $this->clear($xs["prop:$i"], $top + (int) (($bottom - $top) * 0.18))];
        }
        $lights = [];
        foreach (array_values($scene['lights'] ?? []) as $i => $l) {
            if (($asset = $assets["light:$key:$i"] ?? null) && isset($xs["light:$i"])) {
                [$item, $light] = $this->light($key, $i, $l, $asset, $xs["light:$i"], $ground, $floor);
                $layoutItems[] = $item;
                $lights[] = $light;
            }
        }
        [$layersBack, $horizon] = $this->backLayers($scene, $key, $sequence, $assets, $bgId, $W, $H);
        $this->rows['scenes'][] = [
            'id' => $sceneId, 'shortname' => $key, 'sequence' => $sequence, 'subtitle' => $scene['title'], 'description' => $scene['description'] ?? null,
            'zoom' => 1, 'show_avatars' => false, 'is_intro_scene' => $sequence === 1, 'width' => $W, 'height' => $H,
            'background_media' => $layersBack,
            'foreground_media' => $layersFront,
            'layout' => null,
            'params' => ['story' => true] + ($this->sceneParams($scene, $sequence, $horizon) ?? []),
        ];
        $sceneIndex = array_key_last($this->rows['scenes']);

        // ---- the cast: on the stage, or waiting off it beyond the edge they will come on from
        $this->at = [];
        $placements = [];
        $lane = 0;
        foreach (self::appearing($scene) as $who => $how) {
            if (! isset($this->characterIds[$who])) {
                continue;
            }
            $row = $top + (int) round(($bottom - $top) * self::LANES[$lane++ % count(self::LANES)]);
            if ($how['cast']) {
                $x = (int) round(max(0.1, min(0.9, (float) $how['cast']['x'])) * $W);
                $facing = $how['cast']['facing'] ?? ($x > $W / 2 ? 'left' : 'right');
            } else {
                $x = $how['from'] === 'right' ? $W + self::OFFSTAGE : -self::OFFSTAGE;
                $facing = $how['from'] === 'right' ? 'left' : 'right';
            }
            // Out of the pond (or whatever lies in the floor) where they stand; one coming on keeps clear of it all the way.
            $feet = $how['cast'] ? $this->clear($x, $row) : array_reduce(range(1, 9), fn ($y, $i) => $this->clear((int) round($W * $i / 10), $y), $row);
            if ($how['cast']) {
                $this->at[$who] = [$x, $feet, $facing];
            }
            $this->characterSpots[$who] = [$x, $feet];
            $placements[] = ['character_id' => $this->characterIds[$who][0], 'position_x' => $x, 'position_y' => $feet, 'facing' => $facing];
        }

        // ---- life: creatures and vehicles that come and go now and then; one the script cues passes once when it says
        $cues = [];
        $cued = [];
        foreach ($scene['script'] ?? [] as $beat) {
            if (($beat['do'] ?? '') === 'pass' && ! empty($beat['passer'])) {
                $cued[$beat['passer']] = true;
            }
        }
        foreach (array_values($scene['ambient'] ?? []) as $i => $a) {
            $sheet = $assets["ambient:$key:{$a['key']}"] ?? null;
            if (! $sheet) {
                continue;
            }
            $mediaId = $this->media("ambient-$key-{$a['key']}", $sheet, 60);
            if (empty($a['cue'])) {
                $this->ambient($sceneId, $a, $mediaId, $sheet, $i);
            }
            if (isset($cued[$a['key']])) {
                $cues[$a['key']] = $this->ambient($sceneId, $a, $mediaId, $sheet, $i, loop: false);
            }
        }

        // ---- the script, acted out
        $e = $this->event($sceneId, 'start', 'story');
        if ($sequence === 1) {
            $this->action($e, 'wait', ['duration' => 600]);
            $this->action($e, 'text_overlay', ['text' => $b['title'], 'text_font_size' => 60, 'duration' => 3200]);
        } else {
            $this->action($e, 'wait', ['duration' => 900]);
        }
        foreach ($scene['script'] ?? [] as $beat) {
            $this->beat($e, $beat, $cues, $W, $top, $bottom);
        }
        $this->action($e, 'wait', ['duration' => 1400]);
        if ($next) {
            $this->action($e, 'jump', ['scene_id' => $this->sceneIds[$next]]);
        } else {
            $this->ending($e, $b);
        }

        $blockedAreas = array_map(fn ($r) => self::ellipse(($r[0] + $r[1]) / 2, ($r[2] + $r[3]) / 2, ($r[1] - $r[0]) / 2, ($r[3] - $r[2]) / 2), $this->blocked);
        $flows = $this->flows($scene, $bg);
        $this->rows['scenes'][$sceneIndex]['layout'] = [
            'walkable_areas' => [[['x' => $left, 'y' => $top], ['x' => $right, 'y' => $top], ['x' => $right, 'y' => $bottom], ['x' => $left, 'y' => $bottom]]],
            'blocked_areas' => $blockedAreas,
            'spawn_points' => [['name' => 'default', 'position_x' => (int) ($W / 2), 'position_y' => $this->clear((int) ($W / 2), (int) (($top + $bottom) / 2))]],
            'scale_areas' => [['name' => 'depth', 'x' => 0, 'y' => $ground, 'width' => $W, 'height' => $H - $ground, 'scale_top' => (int) round(Sizes::DEPTH_BACK * 100), 'scale_bottom' => (int) round(Sizes::DEPTH_FRONT * 100), 'speed_effect' => 60]],
            'items' => $layoutItems,
            'characters' => $placements,
        ] + ($lights ? ['lights' => $lights] : []) + ($flows ? ['flows' => $flows] : []);
    }

    /** One beat of a script, as actions of the scene's story event. */
    private function beat(int $e, array $beat, array $cues, int $W, int $top, int $bottom): void
    {
        $who = (string) ($beat['who'] ?? '');
        $id = $this->characterIds[$who][0] ?? null;
        $wait = empty($beat['meanwhile']);
        $text = trim((string) ($beat['text'] ?? ''));
        $walk = function (int $x, ?string $facing = null, bool $run = false, bool $blocking = true) use ($e, $who, $id) {
            [$from, $feet] = $this->at[$who] ?? [$x, $this->characterSpots[$who][1] ?? 900, 'right'];
            $facing ??= $x < $from ? 'left' : 'right';
            $this->action($e, 'walk', array_filter(['character_id' => $id, 'to' => 'point', 'position_x' => $x, 'position_y' => $feet, 'speed' => $run ? self::HURRY : null, 'facing' => $facing]), blocking: $blocking);
            $this->at[$who] = [$x, $feet, $facing];
        };
        switch ($beat['do'] ?? '') {
            case 'narrate':
                if ($text !== '') {
                    $this->action($e, 'text_overlay', ['text' => mb_substr($text, 0, 256), 'alignment' => 'bottom center', 'text_font_size' => 30, 'text_font_style' => 'caption', 'duration' => self::readingTime($text), 'narrate' => true], blocking: $wait);
                }
                break;
            case 'say':
                if ($id === null || ! isset($this->at[$who]) || $text === '') {
                    break;
                }
                // Turned to whoever they speak to.
                $to = (string) ($beat['to'] ?? '');
                if ($to !== '' && isset($this->at[$to])) {
                    [$x, , $facing] = $this->at[$who];
                    $towards = $this->at[$to][0] < $x ? 'left' : 'right';
                    if ($towards !== $facing) {
                        $walk($x, $towards);
                    }
                }
                $this->action($e, 'dialogue', ['style' => 'bubble', 'text' => mb_substr($text, 0, 250), 'speaker' => 'character', 'character_id' => $id], blocking: $wait);
                break;
            case 'walk':
            case 'enter':
                if ($id !== null && is_numeric($beat['x'] ?? null)) {
                    if ($beat['do'] === 'enter') {
                        $this->at[$who] = [$this->characterSpots[$who][0] ?? 0, $this->characterSpots[$who][1] ?? $top + 60, 'right'];
                    }
                    $walk((int) round(max(0.08, min(0.92, (float) $beat['x'])) * $W), null, ! empty($beat['run']), $wait);
                }
                break;
            case 'leave':
                if ($id !== null && isset($this->at[$who])) {
                    $walk(($beat['edge'] ?? 'right') === 'left' ? -self::OFFSTAGE : $W + self::OFFSTAGE, null, ! empty($beat['run']), $wait);
                    unset($this->at[$who]);
                }
                break;
            case 'gesture':
                if ($id !== null) {
                    $this->action($e, 'animate', ['target' => 'character', 'character_id' => $id, 'animation' => $this->gesture($who, (string) ($beat['gesture'] ?? 'wave'))], blocking: $wait);
                }
                break;
            case 'wait':
                $this->action($e, 'wait', ['duration' => (int) round(1000 * max(0.5, min(6, (float) ($beat['seconds'] ?? 1.5))))]);
                break;
            case 'sound':
                if (in_array($beat['sound'] ?? '', BlueprintSchema::SOUNDS, true)) {
                    // A sound plays on while the story does.
                    $this->action($e, 'audio', ['sound' => $beat['sound'], 'volume' => 0.9], blocking: false);
                }
                break;
            case 'weather':
                $kind = (string) ($beat['weather'] ?? 'clear');
                // The weather turns while the story goes on; a moment for it to be seen.
                $this->action($e, 'weather', array_filter(['kind' => $kind, 'intensity' => $kind !== 'clear' ? (BlueprintSchema::INTENSITY[$beat['intensity'] ?? 'steady'] ?? 0.6) : null, 'duration' => 4000], fn ($v) => $v !== null), blocking: false);
                $wait && $this->action($e, 'wait', ['duration' => 1200]);
                break;
            case 'pass':
                if (isset($cues[$beat['passer'] ?? ''])) {
                    $this->action($e, 'run_event', ['target_event_id' => $cues[$beat['passer']]], blocking: false);
                    $wait && $this->action($e, 'wait', ['duration' => 1800]);
                }
                break;
            case 'title':
                if ($text !== '') {
                    $this->action($e, 'text_overlay', ['text' => mb_substr($text, 0, 60), 'text_font_size' => 48, 'duration' => 2800], blocking: $wait);
                }
                break;
        }
    }

    /** The end of the story: "The End", the things to talk about, and a way to watch it again. */
    private function ending(int $e, array $b): void
    {
        $this->action($e, 'text_overlay', ['text' => 'The End', 'text_font_size' => 64, 'duration' => 3000]);
        $this->action($e, 'variable', ['name' => 'mission_complete', 'operator' => 'set', 'operand' => 1]);
        $this->action($e, 'award', ['stars' => 3, 'xp' => 10, 'note' => 'Story watched']);
        $h = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES);
        $html = '<h3>'.$h($b['title']).'</h3>';
        if (! empty($b['ending']['text'])) {
            $html .= '<p>'.$h($b['ending']['text']).'</p>';
        }
        $questions = array_values($b['ending']['discussion'] ?? []);
        if ($questions) {
            $html .= '<div data-qbl="callout" data-tone="think"><p><strong>Let\'s talk about it</strong></p><ol>'.implode('', array_map(fn ($q) => '<li>'.$h($q).'</li>', $questions)).'</ol></div>';
        }
        $first = $this->sceneIds[$b['scenes'][0]['key']];
        $this->action($e, 'infobox', ['content' => $html, 'dismissible' => true, 'call_to_actions' => [['text' => '↺ Watch it again', 'action' => ['type' => 'jump', 'scene_id' => $first]]]]);
    }

    /** How long a caption stays when nobody reads it aloud: long enough to read it. */
    public static function readingTime(string $text): int
    {
        return (int) max(2600, min(12000, 1600 + 62 * mb_strlen($text)));
    }
}
