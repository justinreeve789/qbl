<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Curriculum\MissionStandards;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\ScenarioArchive;
use App\Qbl\ScenarioStore;

/**
 * Step 8: import. Bring the ZIP in through ScenarioArchive, exactly as a teacher's upload would be, as
 * a private draft owned by whoever asked for it; record which standards it teaches (with the evidence
 * the builder found for each); publish it if asked.
 *
 * In:  $run->package, $run->alignment, $run->built['evidence']
 * Out: $run->scenarioId
 */
final class ImportStep extends Step
{
    public function name(): string
    {
        return 'import';
    }

    public function stage(): string
    {
        return 'importing';
    }

    public function run(GenerationRun $run): void
    {
        $run->stage('importing');
        $run->scenarioId = self::importZip($run->store, $run->standards, $run->package['zip'], $run->userId, $run->alignment ?? [], $run->built['evidence'] ?? [], (bool) ($run->options['publish'] ?? false), fn (string $m) => $run->say($m));
        $run->progress->fraction(1, 'Ready');
        $run->save(['scenario_id' => $run->scenarioId, 'status' => 'done']);
    }

    /** Import a package (this run's, or one from elsewhere) as a private draft, and record its standards. */
    public static function importZip(ScenarioStore $store, MissionStandards $standards, string $zip, ?int $userId, array $alignment, array $evidence, bool $publish, callable $say): int
    {
        $scenarioId = (new ScenarioArchive($store))->import($zip, $userId);
        if (! empty($alignment['standards'])) {
            $standards->attach($scenarioId, array_map(fn ($s) => $s + ['evidence' => $evidence[$s['code']] ?? []], $alignment['standards']));
        }
        $scenario = $store->scenario($scenarioId);
        $say("Imported as scenario $scenarioId, a private draft at /{$scenario['code']}");
        if ($publish) {
            $store->publish($scenarioId);
            $say('Published');
        }

        return $scenarioId;
    }
}
