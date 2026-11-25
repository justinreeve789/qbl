<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Build\SceneBuilder;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * A scene's step 4: build it (SceneBuilder: plain code, no AI) into rows of the QBL tables: the scene,
 * its walkable, blocked and scale areas, the cut-outs placed over themselves with their sort lines,
 * the hotspots and what the narrator says, the variables that count clicks, lights, critters.
 *
 * In:  $run->blueprint, $run->assets (with the survey)
 * Out: $run->built
 */
final class SceneBuildStep extends Step
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
        $run->built = (new SceneBuilder)->buildScene($run->blueprint, $run->assets ?? []);
        foreach ($run->built['warnings'] as $warning) {
            $run->warn($warning);
        }
        $c = $run->built['counts'];
        $run->say("Built: {$c['cutouts']} things cut out to walk around, {$c['hotspots']} things to click, {$c['lights']} lights, {$c['critters']} critters, {$c['blocked']} patches nobody walks through.");
        $run->output('built', $run->built);
    }
}
