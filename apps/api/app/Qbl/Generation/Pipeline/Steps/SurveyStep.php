<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\FloorTracer;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\ObjectCutter;
use App\Qbl\Generation\Art\SceneSurveyor;
use App\Qbl\Generation\Art\SortLine;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Step 4½: survey. Look at each finished background and find where things really are in it, since a
 * picture never matches what was asked for to the pixel (SceneSurveyor, a language model that can see):
 *
 *   1. The floor's back edge: along the base of the buildings, walls, fences and cliffs, the water's
 *      edge, as far back as anyone could walk on open ground. FloorTracer moves each point onto the
 *      line painted there, so the walkable area runs right up against what blocks a person.
 *   2. Things standing out on the floor that people walk around (trees, bushes, lamp posts, a
 *      fountain): each is lifted out of the picture pixel for pixel (ObjectCutter) as a transparent
 *      cut-out with its sort line (SortLine, as the editor finds it), to be placed exactly over itself,
 *      so figures pass in front of it and behind it. Its base is a patch nobody walks through.
 *   3. What the mission painted in (doors, ladders, things on the walls, lights on the walls, things
 *      to look at): where each ended up, for its hotspot or glow.
 *
 * Results are saved in the work folder (survey/<scene>.json, the cut-outs in assets/), and reused when
 * a run resumes; --redo=survey looks again. A scene the surveyor cannot read keeps the plain floor of
 * the blueprint: the run goes on, with a warning.
 *
 * In:  $run->art, $run->assets
 * Out: $run->assets gains "survey:<scene>" (floor edge, found boxes, standing things) and
 *      "cutout:<scene>:<n>" (each cut-out: path, size, where its top left is, sort line, footprint)
 */
final class SurveyStep extends Step
{
    public function name(): string
    {
        return 'survey';
    }

    public function stage(): string
    {
        return 'drawing';
    }

    public function run(GenerationRun $run): void
    {
        $surveyor = $run->method->surveyor();
        if (! $surveyor || ! $run->art || ! $run->assets) {
            $run->skip('no surveyor (placeholder pictures, or QBL_GEN_SURVEY=false)');

            return;
        }
        $dir = "$run->dir/survey";
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $painted = AssetDirector::painted($run->art);
        $done = 0;
        $scenes = array_values(array_filter($run->art['scenes'], fn ($s) => isset($run->assets["bg:{$s['key']}"]['path'])));
        foreach ($scenes as $i => $scene) {
            $key = $scene['key'];
            // The bar stays full from drawing (a scene's look is quick); only what is being done changes.
            $run->progress->count(PHP_INT_MAX, null, sprintf('Looking over %s for where people can walk', $scene['title'] ?? $key));
            $file = "$dir/$key.json";
            $survey = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
            if (! is_array($survey)) {
                try {
                    $survey = self::look($surveyor, $run->assets["bg:$key"]['path'], $scene, $painted[$key] ?? [], "$run->dir/assets", $key);
                } catch (\Throwable $e) {
                    $run->warn("The surveyor could not read the background of $key ({$e->getMessage()}): it keeps the blueprint's plain floor.");

                    continue;
                }
                file_put_contents($file, json_encode($survey, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            }
            $run->assets["survey:$key"] = $survey;
            foreach ($survey['standing'] as $n => $thing) {
                if (! empty($thing['path']) && is_file($thing['path'])) {
                    $run->assets["cutout:$key:$n"] = $thing;
                }
            }
            $run->note('survey', ['scene' => $key, 'floor_points' => count($survey['floor']), 'standing' => array_map(fn ($t) => $t['name'].' ('.$t['kind'].', '.($t['how'] ?? 'none').')', $survey['standing']), 'found' => array_keys($survey['found'])]);
            $done++;
        }
        $run->progress->count(PHP_INT_MAX, null, 'All the pictures are drawn');
        $run->say("Surveyed $done of ".count($scenes).' backgrounds: floors traced, things to walk around cut out.');
        $run->output('survey', array_filter($run->assets, fn ($k) => str_starts_with($k, 'survey:'), ARRAY_FILTER_USE_KEY));
    }

    /**
     * Survey one background: ask, trace, cut. Pure apart from the model's answer, so tests can drive it.
     *
     * @return array{floor: list<array{0: int, 1: int}>, found: array<string, array>, standing: list<array>}
     */
    public static function look(SceneSurveyor $surveyor, string $path, array $scene, array $find, string $assetsDir, string $key): array
    {
        $im = ImageTools::load((string) file_get_contents($path));
        $H = imagesy($im);
        $answer = $surveyor->survey($im, $scene, $find);
        $floor = count($answer['floor']) >= 2 ? FloorTracer::snap($im, $answer['floor']) : [];
        // A floor that leaves almost nothing to walk on is a misreading: better the blueprint's.
        if ($floor && array_sum(array_column($floor, 1)) / count($floor) > $H - 120) {
            $floor = [];
        }
        $standing = [];
        foreach ($answer['standing'] as $n => $thing) {
            // Only things out on the floor: one whose base is behind the floor's back edge is scenery.
            if ($floor && $thing['base'] < SortLine::yAt($floor, ($thing['box'][0] + $thing['box'][2]) / 2) - 12) {
                continue;
            }
            $cut = ObjectCutter::cut($im, $thing['box'], $thing['outline']);
            $entry = ['name' => $thing['name'], 'kind' => $thing['kind'], 'box' => $thing['box'], 'how' => $cut['how'] ?? null];
            if ($cut) {
                $file = "$assetsDir/cutout-$key-$n.png";
                file_put_contents($file, ImageTools::png($cut['image']));
                $entry += [
                    'path' => $file, 'width' => $cut['width'], 'height' => $cut['height'], 'x' => $cut['x'], 'y' => $cut['y'],
                    'sort_line' => SortLine::forCutout($cut['image'], ($cut['footprint'][1] - $cut['footprint'][0] + 1) / max(1, $cut['width'])), 'footprint' => $cut['footprint'],
                ];
            }
            $standing[] = $entry;
        }

        // A light painted on a wall glows from the brightest part of where it was found.
        $glows = [];
        foreach ($answer['found'] as $id => [$x0, $y0, $x1, $y1]) {
            if (str_starts_with($id, 'light:') && $x1 - $x0 > 4 && $y1 - $y0 > 4) {
                $spot = ImageTools::brightSpot(ImageTools::crop($im, $x0, $y0, $x1 - $x0, $y1 - $y0));
                $glows[$id] = $spot ? [(int) round($x0 + $spot[0] * ($x1 - $x0)), (int) round($y0 + $spot[1] * ($y1 - $y0))] : [(int) (($x0 + $x1) / 2), (int) (($y0 + $y1) / 2)];
            }
        }

        return ['floor' => $floor, 'found' => $answer['found'], 'glows' => $glows, 'standing' => $standing, 'height' => $H, 'ground' => (int) round(Sizes::SCENE_HEIGHT * (float) $scene['ground_line'])];
    }

    public function forget(GenerationRun $run): void
    {
        foreach (glob("$run->dir/survey/*.json") ?: [] as $f) {
            unlink($f);
        }
    }
}
