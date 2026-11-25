<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * A scene's step 5: add it to the scenario it was made for (ScenarioStore::mergeRows), after the
 * scenario's last scene, its pictures copied into the scenario's media. Nothing already there changes.
 * The editor, if it has the scenario open, loads it again and can undo the whole scene in one step.
 *
 * In:  $run->built, $run->options.scenario_id
 * Out: $run->scenarioId; the run's blueprint gains scene_id (the new scene's id)
 */
final class SceneMergeStep extends Step
{
    public function name(): string
    {
        return 'merge';
    }

    public function stage(): string
    {
        return 'importing';
    }

    public function run(GenerationRun $run): void
    {
        $run->stage('importing');
        $scenarioId = (int) $run->options['scenario_id'];
        $rows = $run->built['rows'];
        $files = $run->built['files'];
        // After the scenario's last scene.
        $last = max([0, ...array_map(fn ($s) => (int) ($s['sequence'] ?? 0), $run->store->bundle($scenarioId)['scenes'])]);
        foreach ($rows['scenes'] as $i => $scene) {
            $rows['scenes'][$i]['sequence'] = $last + 1 + $i;
        }
        $map = $run->store->mergeRows($scenarioId, $rows, fn (array $media) => $files[$media['filename'] ?? ''] ?? null);
        $sceneId = (int) ($map['scenes'][(int) $rows['scenes'][0]['id']] ?? 0);
        $run->scenarioId = $scenarioId;
        $run->blueprint['scene_id'] = $sceneId;
        $run->save(['scenario_id' => $scenarioId, 'blueprint' => $run->blueprint, 'status' => 'done']);
        $run->progress->fraction(1, 'Ready');
        $run->say("Added to scenario $scenarioId as scene $sceneId ({$rows['scenes'][0]['shortname']}).");
    }
}
