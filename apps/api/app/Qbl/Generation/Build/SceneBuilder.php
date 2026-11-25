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
        $this->shot = 1.0;
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
            $found = $this->detail($sceneId, $i, $d, (int) round($W * (float) $d['x']), $ground, 'narration', "{$varBase}_look_".(++$described));
            if (! $found && ($assets["survey:$key"] ?? null)) {
                $this->warnings[] = "“{$d['label']}” could not be found in the picture: its hotspot is about where it was asked for. Move it in the scene editor if it is not over it.";
            }
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
            $this->describe($sceneId, 'look-'.self::slug($t['label']), $x, $y, $radius, $t['label'], $y - $radius - 24, $t['texts'], $t['repeat'] ?? 'last', "{$varBase}_look_".(++$described));
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
            'blocked_areas' => $this->blockedAreas(),
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
