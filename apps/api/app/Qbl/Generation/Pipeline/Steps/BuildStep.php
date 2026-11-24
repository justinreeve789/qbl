<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\Generation\ScenarioGenerator;

/**
 * Step 5: build. Turn the blueprint and the pictures into what the engine actually runs: rows of the
 * QBL tables (scenes, hotspots, characters, items, variables, events and their actions, conditions,
 * media), the same shape as an exported scenario.json. No AI is involved: this is plain code
 * (MissionBuilder for a mission, StoryBuilder for a story), so the same blueprint always builds the
 * same way and a bug here can be fixed once for every mission.
 *
 * Characters are also given voices here (VoicePicker, from what the blueprint says of them), so the
 * built dialogue can name them; the next step records the lines.
 *
 * In:  $run->blueprint, $run->alignment, $run->assets
 * Out: $run->built, $run->voices
 */
final class BuildStep extends Step
{
    public function name(): string
    {
        return 'build';
    }

    public function stage(): string
    {
        return 'building';
    }

    public function run(GenerationRun $run): void
    {
        $run->stage('building');
        $run->voices = $run->speech ? ScenarioGenerator::voicesFor($run->blueprint, $run->speech['picker']) : [];
        $run->built = $run->method->builder($run->isStory())->build($run->blueprint, $run->alignment, $run->assets ?? [], $run->options + ['generation_id' => $run->id, 'voices' => $run->voices]);
        $run->output('built', $run->built);
    }
}
