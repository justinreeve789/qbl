<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\Generation\ScenarioPackage;

/**
 * Step 7: package. Write the built scenario as an import ZIP (scenario.json + assets/), the same
 * format the editor's export makes, with a README for the teacher (what the mission teaches, its
 * puzzles and answers, every question) and what the run spent. A run with import=false
 * (--no-import) stops here, with the ZIP to look at or import elsewhere.
 *
 * In:  $run->built, $run->alignment, $run->manifest, $run->blueprint
 * Out: $run->package (its zip path)
 */
final class PackageStep extends Step
{
    public function name(): string
    {
        return 'package';
    }

    public function stage(): string
    {
        return 'building';
    }

    public function run(GenerationRun $run): void
    {
        $spent = $run->spend ? 'Made for '.$run->spend->describe().'.' : null;
        $run->package = ScenarioPackage::write($run->built, $run->dir, $run->alignment, $run->manifest ?? [], $run->blueprint, $spent);
        $run->say("Packaged {$run->package['zip']}");
        if ($spent) {
            $run->say($spent);
        }
        $run->output('package', $run->package);
        if (($run->options['import'] ?? true) === false) {
            $run->stage('packaged');
            $run->stop('packaged');
        }
    }
}
