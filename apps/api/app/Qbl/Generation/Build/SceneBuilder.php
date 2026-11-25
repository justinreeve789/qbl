<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Generation\Art\SortLine;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;

/**
 * Builds ONE scene, planned by SceneDesigner and drawn and surveyed as a mission's scenes are, into rows
 * of the QBL tables, to be added to a scenario that already exists (ScenarioStore::mergeRows). It uses
 * the mission builder's own ways of laying out a floor, so a generated scene behaves like a generated
 * mission's:
 *
 *   - the background picture (with a living sky and drifting clouds behind it, if it has one);
 *   - the walkable area, traced right up to the base of what stops a person (the survey), the patches
 *     nobody walks through (the base of each thing standing on the floor, a pond), and the scale area
 *     that draws figures smaller at the back of the floor;
 *   - each thing standing on the floor lifted out of the picture as an item placed exactly over itself,
 *     with its sort line, so players walk behind it and in front of it;
 *   - things to click (painted details, and standing things worth a look): an invisible hotspot over
 *     where the picture shows them, its name shown when the player is near or points at it, and the
 *     narrator describing it. Several descriptions are told one per click, counted in a variable of the
 *     player's own: "last" steps through them and then keeps telling the last; "cycle" goes round again;
 *   - lights glowing on their brightest part, what is in the air, the weather, water flowing, and
 *     critters coming and going now and then (birds landing, a squirrel up a tree, a deer walking by);
 *   - a "default" spawn point in the middle of the floor.
 *
 * Variables are named <scene>_look_<n> (n counts the things described), so they cannot meet the
 * scenario's own.
 */
class SceneBuilder extends MissionBuilder
{
    /** Where the scene's scale area starts, from the top: the back of the floor as traced, or the ground line. */
    protected int $scaleTop = 0;

    /** What the teacher should know: something planned that the picture did not show. */
    protected array $warnings = [];

    /**
     * @param  array  $blueprint  SceneDesigner::tidy(): one scene
     * @param  array  $assets  "bg:<key>", "survey:<key>", "cutout:<key>:<n>", "ambient:<key>:<critter>", "clouds"
     * @return array{rows: array, files: array<string, string>, scene: string, warnings: list<string>, counts: array<string, int>}
     */
    public function buildScene(array $blueprint, array $assets): array
    {
        $this->rows = array_fill_keys(['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'], []);
        $this->warnings = [];
        $scene = $blueprint['scenes'][0] ?? throw new GenerationError('The plan has no scene.');
        $key = $scene['key'];
        $varBase = self::variableBase($key);
        $sceneId = $this->id('scenes');
        $this->sceneIds[$key] = $sceneId;
        $W = $this->width = Sizes::sceneWidth($scene);
        $H = self::HEIGHT;
        $ground = $this->ground = (int) round($H * max(0.5, min(0.85, (float) $scene['ground_line'])));
        $floor = $H - $ground;
        $bg = $assets["bg:$key"] ?? throw new GenerationError("There is no background for the scene $key.");
        $bgId = $this->media("background-$key", $bg, 1);
        $this->labelSlots = [];

        // ---- the floor: as far as it goes left and right (a scene on its own is walked edge to edge unless the
        //      plan says otherwise), how deep, and, as the picture turned out, where it ends at the back
        [$left, $right] = $this->floorEnds($scene, $W, false, false);
        [$top, $bottom] = $this->floorDepth($scene, null, $ground, $H);
        // The scale area reaches the back of the floor wherever it was traced, so nobody standing there is
        // drawn at full size (set before the cut-outs, whose own size undoes it).
        $survey = $assets["survey:$key"] ?? null;
        $traced = array_column((array) ($survey['floor'] ?? []), 1);
        $this->scaleTop = (int) max(0, min($ground, $traced ? (int) min($traced) - 10 : $ground));
        $cutouts = $this->surveyed($key, $assets, $top, $bottom);
        $cutAt = $this->cutoutBoxes($key, $assets);

        // ---- what stands on the floor: the cut-outs, named as planned where one matches
        $standing = array_values($scene['standing'] ?? []);
        $matched = $this->matchStanding($standing, $cutAt);
        foreach ($matched as $i => $n) {
            if ($n !== null && isset($cutAt[$n]['item'])) {
                foreach ($this->rows['items'] as &$item) {
                    if ($item['id'] === $cutAt[$n]['item']) {
                        $item['name'] = ucfirst($standing[$i]['label']);
                    }
                }
                unset($item);
            }
        }
        foreach ($standing as $i => $t) {
            if ($matched[$i] !== null) {
                continue;
            }
            $this->warnings[] = "“{$t['label']}” was planned to stand on the floor but could not be cut out of the picture: players walk over it. Cut it out by hand if it matters (Media → the background → a copy, or draw an item).";
            // At least nobody walks through it.
            if ($box = $this->found["standing:$i"] ?? null) {
                [$x0, , $x1, $y1] = $box;
                if ($y1 > $top && $y1 < $bottom) {
                    $this->blocked[] = [(int) $x0 + 10, (int) $x1 - 10, (int) $y1 - 40, (int) $y1 + 4];
                }
            }
        }

        // ---- lights: each glowing on the brightest part of where the picture shows it
        $lights = [];
        foreach (array_values($scene['lights'] ?? []) as $i => $l) {
            [, $light] = $this->light($key, $i, $l, null, (int) round($W * (float) $l['x']), $ground, $floor);
            $lights[] = $light;
        }

        // ---- the scene row (its layout is filled in at the end)
        [$layersBack, $horizon] = $this->backLayers($scene, $key, 1, $assets, $bgId, $W, $H);
        $this->rows['scenes'][] = [
            'id' => $sceneId, 'shortname' => $key, 'sequence' => 1, 'subtitle' => $scene['title'], 'description' => $scene['description'] ?? null,
            'zoom' => 1, 'show_avatars' => true, 'is_intro_scene' => false, 'width' => $W, 'height' => $H,
            'background_media' => $layersBack, 'foreground_media' => [], 'layout' => null,
            'params' => $this->sceneParams($scene, 1, $horizon),
        ];
        $sceneIndex = array_key_last($this->rows['scenes']);

        // ---- things to click, described by the narrator
        $described = 0;
        foreach (array_values($scene['details'] ?? []) as $i => $d) {
            $at = $this->foundAt("detail:$i");
            $x = (int) round($W * (float) $d['x']);
            if ($at && abs($at['x'] - $x) < $W * 0.25) {
                [$x, $y] = [$at['x'], $at['y']];
                $radius = (int) max(55, min(170, max($at['width'], $at['height']) / 2 + 12));
            } else {
                $y = ($d['placement'] ?? 'back') === 'ground' ? $this->clear($x, $ground + (int) ($floor * 0.25)) : $this->backAt($x, -110);
                $radius = 80;
                if ($assets["survey:$key"] ?? null) {
                    $this->warnings[] = "“{$d['label']}” could not be found in the picture: its hotspot is about where it was asked for. Move it in the scene editor if it is not over it.";
                }
            }
            $this->describe($sceneId, "look-$i", $x, $y, $radius, $d['label'], $d['texts'] ?? [$d['text']], $d['repeat'] ?? 'last', "{$varBase}_look_".(++$described));
        }
        foreach ($standing as $i => $t) {
            if (empty($t['texts'])) {
                continue;
            }
            $box = $this->found["standing:$i"] ?? ($matched[$i] !== null ? $cutAt[$matched[$i]]['box'] : null);
            if ($box) {
                [$x0, $y0, $x1, $y1] = $box;
                [$x, $y] = [(int) round(($x0 + $x1) / 2), (int) round(($y0 + $y1) / 2)];
                $radius = (int) max(60, min(200, max($x1 - $x0, $y1 - $y0) / 2));
            } else {
                $x = (int) round($W * (float) $t['x']);
                $y = $this->backAt($x, 40) - 120;
                $radius = 90;
            }
            $this->describe($sceneId, 'look-'.self::slug($t['label']), $x, $y, $radius, $t['label'], $t['texts'], $t['repeat'] ?? 'last', "{$varBase}_look_".(++$described));
        }

        // ---- a little life: birds that land, a squirrel up a tree, a deer walking by
        $critters = [];
        foreach (array_values($scene['ambient'] ?? []) as $i => $a) {
            if ($sheet = $assets["ambient:$key:{$a['key']}"] ?? null) {
                $critters[] = $this->critter($a, $this->media("ambient-$key-{$a['key']}", array_diff_key($sheet, ['critter' => 1]), 60), $sheet, $i, $bottom);
            }
        }
        // ---- where players arrive: the middle of the floor, clear of what stands in it
        $mid = (int) (($left + $right) / 2);
        $spawns = [['name' => 'default', 'position_x' => $mid, 'position_y' => $this->clear($mid, min($bottom - 40, max($this->backAt($mid, 60), $ground + (int) ($floor * 0.55))))]];

        $flows = $this->flows($scene, $bg);
        $this->rows['scenes'][$sceneIndex]['layout'] = [
            'walkable_areas' => [$this->walkable($left, $right, $top, $bottom)],
            'blocked_areas' => array_map(fn ($r) => self::ellipse(($r[0] + $r[1]) / 2, ($r[2] + $r[3]) / 2, ($r[1] - $r[0]) / 2, ($r[3] - $r[2]) / 2), $this->blocked),
            'spawn_points' => $spawns,
            'scale_areas' => [$this->scaleArea()],
            'items' => $cutouts,
            'characters' => [],
        ] + ($lights ? ['lights' => $lights] : []) + ($flows ? ['flows' => $flows] : []) + ($critters ? ['critters' => $critters] : []);

        return [
            'rows' => $this->rows, 'files' => $this->files, 'scene' => $key, 'warnings' => $this->warnings,
            'counts' => ['cutouts' => count($cutouts), 'hotspots' => $described, 'lights' => count($lights), 'critters' => count($critters), 'blocked' => count($this->blocked)],
        ];
    }

    /**
     * A thing to click: an invisible hotspot, its name shown when the player is near or points at it, and
     * the narrator saying what is there. With several passages, one per click, counted in $variable (the
     * player's own, kept between visits): "last" steps through them and then keeps saying the last one;
     * "cycle" goes round again. Conditions on each action are read as it is reached, so the count moves on
     * only after the passage for this click is said.
     */
    protected function describe(int $sceneId, string $shortname, int $x, int $y, int $radius, string $label, array $texts, string $repeat, string $variable): int
    {
        $hot = $this->hotspot($sceneId, $shortname, [$x, $y], $radius, click: true);
        $this->text($hot, $x, max(40, $y - $radius - 24), $label, hint: true);
        $texts = array_values(array_filter(array_map('strval', $texts), 'strlen')) ?: [$label];
        $n = count($texts);
        if ($n === 1) {
            $this->action($hot, 'narration', ['text' => $texts[0]]);

            return $hot;
        }
        $this->variable($variable, 0);
        foreach ($texts as $i => $text) {
            $when = $repeat !== 'cycle' && $i === $n - 1 ? $this->cond($variable, '>=', $i) : $this->cond($variable, '=', $i);
            $this->action($hot, 'narration', ['text' => $text], conditions: [$when]);
        }
        if ($repeat === 'cycle') {
            $this->action($hot, 'variable', ['name' => $variable, 'operator' => '+', 'operand' => 1]);
            $this->action($hot, 'variable', ['name' => $variable, 'operator' => 'set', 'operand' => 0], conditions: [$this->cond($variable, '>=', $n)]);
        } else {
            $this->action($hot, 'variable', ['name' => $variable, 'operator' => '+', 'operand' => 1], conditions: [$this->cond($variable, '<', $n - 1)]);
        }

        return $hot;
    }

    /** The cut-outs as surveyed (in the order surveyed() placed them): their box in the scene and their item. */
    protected function cutoutBoxes(string $key, array $assets): array
    {
        $out = [];
        $cutItems = array_values(array_filter($this->rows['items'], fn ($i) => ($i['settings']['params']['cut_from'] ?? null) === 'background'));
        foreach (array_values($assets["survey:$key"]['standing'] ?? []) as $n => $_) {
            $a = $assets["cutout:$key:$n"] ?? null;
            if (! $a || empty($a['path'])) {
                continue;
            }
            $out[] = ['box' => [(int) $a['x'], (int) $a['y'], (int) $a['x'] + (int) $a['width'], (int) $a['y'] + (int) $a['height']], 'item' => $cutItems[count($out)]['id'] ?? null];
        }

        return $out;
    }

    /**
     * Which cut-out each planned standing thing became: the one its found box overlaps most, else the
     * nearest across within a tenth of the scene. Each cut-out goes to one thing at most.
     *
     * @return array<int, ?int> planned index => cut-out index, or null
     */
    protected function matchStanding(array $standing, array $cutAt): array
    {
        $out = array_fill(0, count($standing), null);
        $used = [];
        foreach ($standing as $i => $t) {
            $best = null;
            $score = 0.0;
            $box = $this->found["standing:$i"] ?? null;
            foreach ($cutAt as $n => $c) {
                if (isset($used[$n])) {
                    continue;
                }
                [$cx0, $cy0, $cx1, $cy1] = $c['box'];
                if ($box) {
                    $ix = max(0, min($box[2], $cx1) - max($box[0], $cx0));
                    $iy = max(0, min($box[3], $cy1) - max($box[1], $cy0));
                    $s = ($ix * $iy) / max(1, min(($box[2] - $box[0]) * ($box[3] - $box[1]), ($cx1 - $cx0) * ($cy1 - $cy0)));
                } else {
                    $d = abs(($cx0 + $cx1) / 2 - $this->width * (float) $t['x']);
                    $s = $d < $this->width * 0.1 ? 1 - $d / ($this->width * 0.1) : 0;
                }
                if ($s > $score + 1e-6) {
                    [$best, $score] = [$n, $s];
                }
            }
            if ($best !== null && $score >= 0.25) {
                $out[$i] = $best;
                $used[$best] = true;
            }
        }

        return $out;
    }

    /**
     * The scale area: from the back of the floor (as traced, or the ground line) to the bottom, drawing
     * figures smaller at the back and larger at the front, at the sizes the picture was painted for
     * (Sizes::DEPTH_BACK at the ground line, Sizes::DEPTH_FRONT at the bottom), carried on past the
     * ground line where the traced floor goes further back.
     */
    protected function scaleArea(): array
    {
        [$top, $bottom] = $this->scalePercents();

        return ['name' => 'depth', 'x' => 0, 'y' => $this->scaleTop, 'width' => $this->width, 'height' => self::HEIGHT - $this->scaleTop, 'scale_top' => $top, 'scale_bottom' => $bottom, 'speed_effect' => 60];
    }

    /** @return array{0: int, 1: int} the scale area's percentages at its top and bottom */
    protected function scalePercents(): array
    {
        $per = (Sizes::DEPTH_FRONT - Sizes::DEPTH_BACK) / max(1, self::HEIGHT - $this->ground);

        return [(int) round(100 * (Sizes::DEPTH_BACK - $per * ($this->ground - $this->scaleTop))), (int) round(Sizes::DEPTH_FRONT * 100)];
    }

    /** How the scene's scale area draws something standing at y, as the game reads it (see scaleArea). */
    protected function depthScale(int $y): float
    {
        if ($y < $this->scaleTop || $y > self::HEIGHT) {
            return 1.0; // outside the scale area: drawn at its own size
        }
        [$top, $bottom] = $this->scalePercents();
        $t = ($y - $this->scaleTop) / max(1, self::HEIGHT - $this->scaleTop);

        return max(0.05, ($top + ($bottom - $top) * $t) / 100);
    }

    /** A scene's shortname as the start of variable names: lower case letters, digits and underscores. */
    public static function variableBase(string $key): string
    {
        $base = trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($key)), '_');

        return preg_match('/^[a-z]/', $base) ? $base : "scene_$base";
    }

    /** The background's floor at x, as traced: for tests and for callers that place things after building. */
    public function backEdgeAt(int $x): ?int
    {
        return $this->backEdge ? (int) round(SortLine::yAt($this->backEdge, $x)) : null;
    }
}
