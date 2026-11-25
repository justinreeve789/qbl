<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\Reference;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * A scene's step 2: draw it, exactly as a mission's scenes are drawn (DrawStep: the background, its
 * clouds, any critters not in the asset library), with one addition: a scene of the scenario it joins
 * is shown to the painter as how the scenario looks, so the new scene matches the ones beside it.
 *
 * In:  $run->blueprint, $run->options.scenario_id
 * Out: $run->assets, $run->manifest
 */
final class SceneDrawStep extends Step
{
    public function name(): string
    {
        return 'draw';
    }

    public function stage(): string
    {
        return 'drawing';
    }

    public function run(GenerationRun $run): void
    {
        EstimateStep::prepare($run);
        if ($look = self::scenarioLook($run)) {
            $run->director->lookLike($look);
            $run->say('Painting it to match the scenario\'s own scenes.');
        }
        (new DrawStep)->run($run);
    }

    /**
     * The main picture of the scenario's start scene (or of its first scene that has one), as a reference
     * for how it is painted: at most 1600 pixels wide, as a JPEG.
     */
    public static function scenarioLook(GenerationRun $run): ?Reference
    {
        $id = (int) ($run->options['scenario_id'] ?? 0);
        $scenario = $id ? $run->store->scenario($id) : null;
        if (! $scenario) {
            return null;
        }
        $bundle = $run->store->bundle($id);
        $media = array_column($bundle['media'], null, 'id');
        $scenes = $bundle['scenes'];
        $start = (int) ($scenario['start_scene_id'] ?? 0);
        usort($scenes, fn ($a, $b) => [(int) $a['id'] !== $start, (int) ($a['sequence'] ?? 0)] <=> [(int) $b['id'] !== $start, (int) ($b['sequence'] ?? 0)]);
        foreach ($scenes as $scene) {
            $layers = array_values((array) ($scene['background_media'] ?? []));
            if (! $layers) {
                continue;
            }
            $main = array_values(array_filter($layers, fn ($l) => ! empty($l['main'])))[0] ?? end($layers);
            $row = $media[(int) ($main['media_id'] ?? $main['id'] ?? 0)] ?? null;
            $file = $row ? $run->store->mediaFile($row) : null;
            if (! $file || ($row['type'] ?? 'image') !== 'image') {
                continue;
            }
            try {
                $im = ImageTools::load((string) file_get_contents($file));
            } catch (\Throwable) {
                continue;
            }
            if (imagesx($im) > 1600) {
                $im = ImageTools::resize($im, 1600, (int) round(imagesy($im) * 1600 / imagesx($im)));
            }
            ob_start();
            imagejpeg($im, null, 85);

            return new Reference((string) ob_get_clean(), 'a scene of the same game: match how it is painted (colours, line, light, level of detail) and the size of things beside people, but paint a DIFFERENT place', 'image/jpeg');
        }

        return null;
    }

    public function forget(GenerationRun $run): void
    {
        (new DrawStep)->forget($run);
    }
}
