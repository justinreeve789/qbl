<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Generation\Design\BlueprintSchema;
use App\Qbl\Generation\Design\Cutscenes;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;

/**
 * Scenes that play by themselves, acted out from a script (StorySchema beats): a story's scenes, and
 * the panels of a mission's cutscenes. Shared by StoryBuilder and MissionBuilder.
 *
 * Each is a story scene (`story`): no avatars, the player does not walk, the view follows whoever acts.
 * Its script becomes one start event that acts it out, beat by beat, then jumps on (the next scene or
 * panel), back (where a mission's cutscene was started), or ends the story.
 *
 * Framing (Cutscenes): a close shot draws everyone twice as big; a panel that continues an earlier one
 * starts with everyone where they were; a show beat puts a picture up full-screen as a panel (at most
 * 20 seconds, the camera moving slowly over it), a camera beat pushes in or pulls back. And whenever
 * nothing has moved on screen for a while, the camera drifts a little, so no still picture is ever up
 * for more than about 20 seconds.
 */
trait StoryStaging
{
    /** How far beyond an edge someone waits, or walks off to. */
    protected const OFFSTAGE = 220;

    /** How fast characters stroll, and hurry, in scene pixels per second. */
    protected const STROLL = 150;

    protected const HURRY = 300;

    /** Rows of the floor (shares of its depth) where the cast stand, in the order they appear in a scene: not all on one line. */
    protected const LANES = [0.38, 0.55, 0.26, 0.66, 0.46, 0.32];

    /** character key => [x, feet, facing] while on the stage of the scene being built */
    protected array $at = [];

    /** Where everyone stood when each scene (or panel) ended: for a panel that continues it. */
    protected array $stageAt = [];

    /** Milliseconds since anything last moved or changed on screen in the scene being built. */
    protected int $still = 0;

    /** Which way the next drift of the camera goes (in a little, or back out). */
    protected bool $drifted = false;

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

    /**
     * One scene that plays by itself. Afterwards it jumps to $next (a scene key), or back to where a
     * mission's cutscene began ($back: [scene id, spawn point]), or, with neither, the story ends.
     * $opening: the first scene of a story, which shows the title.
     */
    protected function storyScene(array $scene, int $sequence, array $assets, array $b, ?string $next, ?array $back = null, ?bool $opening = null): void
    {
        $opening ??= $sequence === 1;
        $close = ($scene['shot'] ?? 'wide') === 'close';
        // In a close shot everyone is drawn twice as big, as the picture is (the scale area, and the cut-outs' own size).
        $this->shot = $close ? Cutscenes::CLOSE : 1.0;
        $this->still = 0;
        $key = $scene['key'];
        $sceneId = $this->sceneIds[$key];
        $W = $this->width = Sizes::sceneWidth($scene);
        $H = self::HEIGHT;
        $ground = $this->ground = (int) round($H * max(0.5, min(0.85, (float) $scene['ground_line'])));
        $this->geometry[$key] = [$W, $ground];
        $floor = $H - $ground;
        $bg = $assets["bg:$key"] ?? throw new GenerationError("There is no background for the scene $key.");
        $bgId = $this->media("background-$key", $bg, $opening ? 1 : 10 + $sequence);
        $this->labelSlots = [];
        // Characters come and go by both edges, so the floor reaches them.
        [$left, $right] = $this->floorEnds($scene, $W, true, true);
        [$layersFront, $foreground] = $this->foregroundLayer($scene, $key, $sequence, $assets, $W, $H);
        [$top, $bottom] = $this->floorDepth($scene, $foreground, $ground, $H);
        // As the background turned out: where its floor really ends at the back, and the things to walk around in it.
        $cutouts = $this->surveyed($key, $assets, $top, $bottom);

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
            $layoutItems[] = ['item_id' => $itemId, 'position_x' => $xs["prop:$i"], 'position_y' => Sizes::cm($item) > 150 ? max($top, $this->backAt($xs["prop:$i"])) + 10 : $this->clear($xs["prop:$i"], $top + (int) (($bottom - $top) * 0.18))];
        }
        array_push($layoutItems, ...$cutouts);
        $lights = [];
        foreach (array_values($scene['lights'] ?? []) as $i => $l) {
            $asset = $assets["light:$key:$i"] ?? null;
            if (($asset || ($l['placement'] ?? null) === 'wall') && isset($xs["light:$i"])) {
                [$item, $light] = $this->light($key, $i, $l, $asset, $xs["light:$i"], $ground, $floor);
                if ($item) {
                    $layoutItems[] = $item;
                }
                $lights[] = $light;
            }
        }
        [$layersBack, $horizon] = $this->backLayers($scene, $key, $sequence, $assets, $bgId, $W, $H);
        $this->rows['scenes'][] = [
            'id' => $sceneId, 'shortname' => $key, 'sequence' => $sequence, 'subtitle' => $scene['title'], 'description' => $scene['description'] ?? null,
            'zoom' => 1, 'show_avatars' => false, 'is_intro_scene' => $opening && $back === null, 'width' => $W, 'height' => $H,
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
        // A panel that continues an earlier one: whoever it does not place stands where they ended up there.
        $carried = isset($scene['continues']) ? ($this->stageAt[$scene['continues']] ?? []) : [];
        if ($carried) {
            $listed = array_column((array) ($scene['cast'] ?? []), 'who');
            foreach ($carried as $who => [$cx, , $cfacing]) {
                if (! in_array($who, $listed, true)) {
                    $scene['cast'][] = ['who' => $who, 'x' => max(0.1, min(0.9, $cx / max(1, $W))), 'facing' => $cfacing];
                }
            }
        }
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
            // Continuing a panel: exactly where they stood (same view, same spot).
            if ($how['cast'] && isset($carried[$who]) && abs($carried[$who][0] - $x) < 4) {
                [$x, $feet] = [$carried[$who][0], $carried[$who][1]];
                $this->at[$who] = [$x, $feet, $facing];
            }
            $this->characterSpots[$who] = [$x, $feet];
            $placements[] = ['character_id' => $this->characterIds[$who][0], 'position_x' => $x, 'position_y' => $feet, 'facing' => $facing];
        }

        // ---- life: creatures and vehicles that come and go now and then; one the script cues passes once when it says
        $cues = [];
        $cued = [];
        $critters = [];
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
            $mediaId = $this->media("ambient-$key-{$a['key']}", array_diff_key($sheet, ['critter' => 1]), 60);
            if (empty($a['cue'])) {
                $critters[] = $this->critter($a, $mediaId, $sheet, $i, $bottom);
            }
            if (isset($cued[$a['key']])) {
                $cues[$a['key']] = $this->ambient($sceneId, $a, $mediaId, $sheet, $i, loop: false);
            }
        }

        // ---- the script, acted out
        $e = $this->event($sceneId, 'start', 'story');
        if ($opening && $back === null) {
            $this->action($e, 'wait', ['duration' => 600]);
            $this->action($e, 'text_overlay', ['text' => $b['title'], 'text_font_size' => 60, 'duration' => 3200]);
        } else {
            $this->action($e, 'wait', ['duration' => 900]);
        }
        foreach (array_values($scene['script'] ?? []) as $i => $beat) {
            $this->beat($e, $beat + ['_n' => $i, '_scene' => $key], $cues, $W, $top, $bottom, $assets);
        }
        $this->action($e, 'wait', ['duration' => 1400]);
        $this->stageAt[$key] = $this->at;
        if ($next) {
            $this->action($e, 'jump', ['scene_id' => $this->sceneIds[$next]]);
        } elseif ($back) {
            $this->action($e, 'jump', array_filter(['scene_id' => $back[0], 'spawn_point' => $back[1] ?? null]));
        } else {
            $this->ending($e, $b);
        }

        $flows = $this->flows($scene, $bg);
        $this->rows['scenes'][$sceneIndex]['layout'] = [
            'walkable_areas' => [$this->walkable($left, $right, $top, $bottom)],
            'blocked_areas' => $this->blockedAreas(),
            'spawn_points' => [['name' => 'default', 'position_x' => (int) ($W / 2), 'position_y' => $this->clear((int) ($W / 2), (int) (($top + $bottom) / 2))]],
            'scale_areas' => [$this->scaleArea()],
            'items' => $layoutItems,
            'characters' => $placements,
        ] + ($lights ? ['lights' => $lights] : []) + ($flows ? ['flows' => $flows] : []) + ($critters ? ['critters' => $critters] : []);
    }

    /** One beat of a script, as actions of the scene's story event. */
    protected function beat(int $e, array $beat, array $cues, int $W, int $top, int $bottom, array $assets = []): void
    {
        // Nothing has moved for a while and this beat moves nothing either: the camera drifts a little,
        // in or back out, so a still picture is never up for more than about 20 seconds.
        [$ms, $moves] = Cutscenes::beatTime($beat);
        if (! $moves && $this->still + $ms > 14000) {
            $this->drifted = ! $this->drifted;
            $this->action($e, 'camera', ['target' => 'auto', 'zoom' => $this->drifted ? 1.12 : 1.0, 'duration' => 7000], blocking: false);
            $this->still = 0;
        }
        $this->still = $moves ? 0 : $this->still + (empty($beat['meanwhile']) ? $ms : 0);
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
            case 'show':
                // A picture full-screen for a moment (never over 20 seconds), with what the narrator says over it.
                $picture = $assets["insert:{$beat['_scene']}:{$beat['_n']}"] ?? null;
                $ms = Cutscenes::showTime($beat);
                if ($text !== '') {
                    $this->action($e, 'text_overlay', ['text' => mb_substr($text, 0, 256), 'alignment' => 'bottom center', 'text_font_size' => 30, 'text_font_style' => 'caption', 'duration' => $ms, 'narrate' => true], blocking: ! $picture && $wait);
                }
                if ($picture) {
                    $this->action($e, 'image_overlay', array_filter([
                        'panel' => true, 'duration' => $ms, 'motion' => in_array($beat['motion'] ?? '', Cutscenes::MOTIONS, true) ? $beat['motion'] : 'push_in',
                        'tone' => in_array($beat['tone'] ?? '', Cutscenes::TONES, true) ? $beat['tone'] : null,
                    ]), blocking: $wait, media: $this->media('insert-'.$beat['_scene'].'-'.$beat['_n'], $picture, 55));
                }
                break;
            case 'camera':
                $secs = (int) round(1000 * max(1, min(6, (float) ($beat['seconds'] ?? 2.5))));
                switch ($beat['move'] ?? '') {
                    case 'push_in':
                        if ($id !== null) {
                            $this->action($e, 'camera', ['target' => 'character', 'character_id' => $id, 'zoom' => 1.6, 'duration' => $secs], blocking: $wait);
                        }
                        break;
                    case 'pull_back':
                        $this->action($e, 'camera', ['target' => 'auto', 'zoom' => 1.0, 'duration' => $secs], blocking: $wait);
                        break;
                    case 'pan':
                        if (is_numeric($beat['x'] ?? null)) {
                            $this->action($e, 'camera', ['target' => 'point', 'position_x' => (int) round(max(0.08, min(0.92, (float) $beat['x'])) * $W), 'position_y' => (int) (($top + $bottom) / 2) - 150, 'duration' => $secs], blocking: $wait);
                        }
                        break;
                }
                $this->drifted = false;
                break;
        }
    }

    /** How long a caption stays when nobody reads it aloud: long enough to read it. */
    public static function readingTime(string $text): int
    {
        return (int) max(2600, min(12000, 1600 + 62 * mb_strlen($text)));
    }
}
