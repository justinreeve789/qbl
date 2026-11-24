<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\Generation\ScenarioGenerator;

/**
 * Step 4: draw. Every picture the mission needs, in the house art style (AssetDirector::drawMission):
 *
 *   1. Characters first: a character sheet each, then their animations. With an animator (AutoSprite,
 *      the primary source when AUTOSPRITE_API_KEY is set) every animation comes from ONE request per
 *      character, made from the accepted sheet and never repeated (GenerationMethod::animator()).
 *      Without one: their walk strip (6 frames, retried at 4, else a puppet walk made in code from the
 *      standing pose) and gestures, drawn. Then a portrait (cropped from the sheet by default). The
 *      first accepted sheet becomes a reference for the rest, so the cast match.
 *   2. Props: the small things several to a picture (a sheet cut apart), or one each; doors, holes,
 *      ladders; surfaces to put things on; ambient creatures.
 *   3. Backgrounds: one per scene, told what to leave room for (ScenarioGenerator::layouts: where the
 *      exits, doors and wall things are) and sent a scale guide so the scenery is the size of the
 *      people in it; the far view and foreground for scenes that have them.
 *
 * Each picture: write the prompt (ArtStyle::prompt) → ask the picture source, with the style anchors
 * as references → cut it out (chroma key) and find its frames → have the style judge score it against
 * the anchors → below the bar, draw again with the judge's notes added → keep the best.
 *
 * Who draws and who judges is the method's choice (GenerationMethod::images() and judge()). In the
 * trace, every request to the picture source is a calls/NNNN-picture-*.json with its prompt and
 * result, and every judgement a calls/NNNN-llm-judge-style_review.json. What was kept, and why, is in
 * assets/<key>.json and the run's manifest.
 *
 * Pictures already accepted in an earlier session of the run are reused, not drawn again.
 *
 * In:  $run->art, $run->director
 * Out: $run->assets, $run->manifest
 */
final class DrawStep extends Step
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
        $run->stage('drawing');
        // The director counts its pictures for the editor's progress bar (and that is where a cancel lands).
        $run->director->onProgress(fn (int $done, int $total, string $detail) => $run->progress->count($done, $total, $detail));
        $run->assets = $run->director->drawMission($run->art, ScenarioGenerator::layouts($run->art));
        $run->manifest = $run->director->manifest();
        $run->save(['manifest' => $run->manifest]);
        foreach ($run->manifest as $m) {
            if (! empty($m['below_bar'])) {
                $run->warn("{$m['key']} was kept below the style bar (score ".($m['score'] ?? '?').'): look at it before publishing.');
            }
        }
        $run->output('manifest', $run->manifest);
    }

    /**
     * `--redo=draw`: draw everything again. The accepted pictures are moved aside (assets-<time>/), not
     * deleted, so you can compare the two sets.
     */
    public function forget(GenerationRun $run): void
    {
        $run->manifest = null;
        $run->save(['manifest' => null]);
        if (is_dir("$run->dir/assets")) {
            rename("$run->dir/assets", "$run->dir/assets-".gmdate('Ymd-His'));
        }
    }
}
