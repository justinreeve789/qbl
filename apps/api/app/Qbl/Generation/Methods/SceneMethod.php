<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Art\SceneSurveyor;
use App\Qbl\Generation\Pipeline\Steps\SceneBuildStep;
use App\Qbl\Generation\Pipeline\Steps\SceneDesignStep;
use App\Qbl\Generation\Pipeline\Steps\SceneDrawStep;
use App\Qbl\Generation\Pipeline\Steps\SceneMergeStep;
use App\Qbl\Generation\Pipeline\Steps\SurveyStep;

/**
 * ONE new scene for a scenario a teacher is making (the editor's "Generate a scene"), rather than a
 * whole mission:
 *
 *   design → draw → survey → build → merge
 *
 *   design  SceneDesigner plans the scene: the background, what stands on its floor, what can be clicked
 *           and what the narrator says about it, lights, a living sky, critters (language model "design")
 *   draw    the background (and clouds, and any critters not in the asset library), painted to match the
 *           scenario's own scenes (AssetDirector, as a mission's)
 *   survey  the floor traced, each standing thing cut out pixel for pixel with its sort line, the
 *           painted things and lights found (SceneSurveyor, language model "survey")
 *   build   SceneBuilder: the rows of one scene
 *   merge   added to the scenario (ScenarioStore::mergeRows); the editor takes it in as one undoable step
 *
 * No alignment, no characters, no voices: the teacher adds what happens there. Its options are the
 * run's: scenario_id (required) and SceneDesigner::OPTIONS.
 */
final class SceneMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'scene';
    }

    public static function summary(): string
    {
        return 'One scene for an existing scenario: a background, the things standing in it cut out to walk around, things to click that the narrator describes, lights and critters (needs --scenario).';
    }

    public function steps(): array
    {
        return [new SceneDesignStep, new SceneDrawStep, new SurveyStep, new SceneBuildStep, new SceneMergeStep];
    }

    public function stages(bool $voices): array
    {
        return ['designing', 'drawing', 'building', 'importing'];
    }

    public function wantsVoices(): ?bool
    {
        return false;
    }

    /**
     * The survey is what makes a generated scene walkable around its things, so it is made whenever the
     * pictures are real, even where missions are configured without it. Placeholder pictures (tests, a
     * free try) are surveyed only when asked (option survey), as for missions.
     */
    protected function makeSurveyor(): ?SceneSurveyor
    {
        $wanted = $this->options['survey'] ?? null;
        if ($wanted === null && $this->placeholderPictures()) {
            return null;
        }

        return ($wanted ?? true) ? new SceneSurveyor($this->model('survey')) : null;
    }
}
