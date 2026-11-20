<?php

namespace App\Qbl\Generation;

use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Build\MissionBuilder;
use App\Qbl\Generation\Curriculum\StandardsAligner;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\ScenarioArchive;
use App\Qbl\ScenarioStore;

/**
 * Makes a whole mission from a teacher's prompt:
 *
 *   1. align    choose the curriculum standards and write learning objectives (StandardsAligner)
 *   2. design   write the blueprint: story, scenes, characters, items, interactions, checklist (MissionDesigner)
 *   3. draw     every picture, in the house art style (AssetDirector)
 *   4. build    rows of the QBL tables from the blueprint and pictures (MissionBuilder)
 *   5. package  scenario.json and assets/ as an import ZIP (ScenarioPackage)
 *   6. import   through ScenarioArchive, as a private draft; record its standards; optionally publish
 *
 * Each stage's result is saved on the run (scenario_generations) and in its work folder, so a run
 * that stops is resumed from where it stopped. What it spends on AI services is counted in the work
 * folder (spend.json, see Spend), estimated before drawing, and reported at the end.
 */
class ScenarioGenerator
{
    /** @var callable|null */
    private $log;

    /** The id of the run most recently started or resumed, so a caller can say how to resume it after a failure. */
    public ?int $lastRun = null;

    public function __construct(
        private GenerationRuns $runs,
        private StandardsStore $standards,
        private StandardsAligner $aligner,
        private MissionDesigner $designer,
        /** Makes the director for a run: fn(string $workDir): AssetDirector */
        private \Closure $director,
        private ScenarioStore $store,
        private string $workRoot,
        ?callable $log = null,
        private ?Spend $spend = null,
    ) {
        $this->log = $log;
    }

    public function onLog(callable $log): void
    {
        $this->log = $log;
    }

    /**
     * @param  array{grade?: ?string, subject?: ?string, frameworks?: string[], standards?: string[], scenes?: ?int,
     *               min_players?: int, max_players?: int, minutes?: ?int, notes?: ?string, style?: string,
     *               stop_after?: ?string, import?: bool, publish?: bool}  $options
     * @return array{run: int, status: string, scenario_id: ?int, zip: ?string, warnings: string[]}
     */
    public function generate(string $prompt, array $options, ?int $userId = null, ?int $resume = null): array
    {
        if ($resume) {
            $run = $this->runs->get($resume) ?? throw new GenerationError("There is no generation $resume.");
            $id = $resume;
            $prompt = $run['prompt'];
            // Options given now win over the saved ones, so a resumed run can, say, be published.
            // Where to stop is decided afresh: a run made with --design-only is resumed to carry on.
            $options = array_filter($options, fn ($v) => $v !== null && $v !== []) + array_diff_key($run['options'] ?? [], ['stop_after' => 1, 'import' => 1, 'publish' => 1]);
            $userId ??= $run['user_id'] !== null ? (int) $run['user_id'] : null;
        } else {
            $id = $this->runs->create($prompt, $options, $userId);
            $run = $this->runs->get($id);
        }
        $this->lastRun = $id;
        $this->runs->update($id, ['options' => $options, 'error' => null]);
        $dir = rtrim($this->workRoot, '/')."/$id";
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new GenerationError("Cannot create $dir.");
        }
        $this->say("Generation $id (work folder $dir)");
        $warnings = [];
        // What this run spends is counted into its work folder, carrying on from where a resumed run was.
        $this->spend?->attach("$dir/spend.json");

        try {
            // ------------------------------------------------------------ 1. align
            $alignment = $run['alignment'];
            if (! $alignment) {
                $this->status($id, 'aligning');
                $this->say('Aligning to curriculum standards');
                $alignment = $this->aligner->align($prompt, $options);
                $this->runs->update($id, ['alignment' => $alignment]);
            }
            $warnings = array_merge($warnings, $alignment['warnings'] ?? []);
            foreach ($alignment['standards'] as $s) {
                $this->say("  {$s['code']} ({$s['alignment']})");
            }

            // ------------------------------------------------------------ 2. design
            $blueprint = $run['blueprint'];
            if (! $blueprint || BlueprintValidator::errors($blueprint, array_column($alignment['learning_objectives'], 'id'))) {
                $this->status($id, 'designing');
                $this->say('Designing the mission');
                $blueprint = $this->designer->design($prompt, $alignment, $options, $this->log);
                $this->runs->update($id, ['blueprint' => $blueprint]);
            }
            file_put_contents("$dir/blueprint.json", json_encode($blueprint, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $this->say(sprintf('"%s": %d scenes, %d characters, %d items, %d interactions, %d crew roles, %d twists', $blueprint['title'], count($blueprint['scenes']), count($blueprint['characters']), count($blueprint['items']), count($blueprint['interactions']), count($blueprint['roles'] ?? []), count($blueprint['twists'] ?? [])));
            $director = ($this->director)($dir);
            $estimate = $director->estimate($blueprint);
            $this->say(sprintf('Drawing it will take about %d pictures, about $%.2f%s.', $estimate['pictures'], $estimate['usd'], $this->spend ? sprintf(' (spent so far: $%.2f%s)', $this->spend->total(), $this->spend->budget() > 0 ? sprintf(' of a $%.2f budget', $this->spend->budget()) : '') : ''));
            if ($this->spend && $this->spend->budget() > 0 && $this->spend->total() + $estimate['usd'] > $this->spend->budget()) {
                $warnings[] = sprintf('The estimate ($%.2f with what is spent) is over the budget of $%.2f: some pictures may be kept below the style bar or animations left out. Raise it with --budget=... if you want them all.', $this->spend->total() + $estimate['usd'], $this->spend->budget());
            }
            if (($options['stop_after'] ?? null) === 'design') {
                $this->status($id, 'designed');

                return ['run' => $id, 'status' => 'designed', 'scenario_id' => null, 'zip' => null, 'warnings' => $warnings, 'estimate' => $estimate, 'spend' => $this->spend?->summary()];
            }

            // ------------------------------------------------------------ 3. draw
            $this->status($id, 'drawing');
            $assets = $director->drawMission($blueprint, self::layouts($blueprint));
            $manifest = $director->manifest();
            $this->runs->update($id, ['manifest' => $manifest]);
            foreach ($manifest as $m) {
                if (! empty($m['below_bar'])) {
                    $warnings[] = "{$m['key']} was kept below the style bar (score ".($m['score'] ?? '?').'): look at it before publishing.';
                }
            }

            // ------------------------------------------------------------ 4, 5. build and package
            $this->status($id, 'building');
            $built = (new MissionBuilder)->build($blueprint, $alignment, $assets, $options + ['generation_id' => $id]);
            $spent = $this->spend ? 'Made for '.$this->spend->describe().'.' : null;
            $package = ScenarioPackage::write($built, $dir, $alignment, $manifest, $blueprint, $spent);
            $this->say("Packaged {$package['zip']}");
            if ($spent) {
                $this->say($spent);
            }
            if (($options['import'] ?? true) === false) {
                $this->status($id, 'packaged');

                return ['run' => $id, 'status' => 'packaged', 'scenario_id' => null, 'zip' => $package['zip'], 'warnings' => $warnings, 'spend' => $this->spend?->summary()];
            }

            // ------------------------------------------------------------ 6. import
            $scenarioId = $this->import($package['zip'], $userId, $alignment, $built['evidence'], (bool) ($options['publish'] ?? false));
            $this->runs->update($id, ['scenario_id' => $scenarioId, 'status' => 'done']);

            return ['run' => $id, 'status' => 'done', 'scenario_id' => $scenarioId, 'zip' => $package['zip'], 'warnings' => $warnings, 'spend' => $this->spend?->summary()];
        } catch (\Throwable $e) {
            if ($this->spend) {
                $this->say('Spent so far: '.$this->spend->describe().'.');
            }
            $this->runs->update($id, ['status' => 'failed', 'error' => mb_substr($e->getMessage(), 0, 4000)]);
            throw $e;
        }
    }

    /** Import a package (this run's, or one from elsewhere) as a private draft, and record its standards. */
    public function import(string $zip, ?int $userId, array $alignment = [], array $evidence = [], bool $publish = false): int
    {
        $scenarioId = (new ScenarioArchive($this->store))->import($zip, $userId);
        if (! empty($alignment['standards'])) {
            $this->standards->attach($scenarioId, array_map(fn ($s) => $s + ['evidence' => $evidence[$s['code']] ?? []], $alignment['standards']));
        }
        $scenario = $this->store->scenario($scenarioId);
        $this->say("Imported as scenario $scenarioId, a private draft at /{$scenario['code']}");
        if ($publish) {
            $this->store->publish($scenarioId);
            $this->say('Published');
        }

        return $scenarioId;
    }

    /**
     * What each background must leave room for: where its edges lead, where its doors, holes and ladders
     * stand, and where things hang on its wall. scene => [exits => [edge => "towards the Lab"],
     * passages => [[via, x, towards]], wall => [x...]].
     */
    public static function layouts(array $b): array
    {
        $titles = array_column($b['scenes'], 'title', 'key');
        $scenes = array_column($b['scenes'], null, 'key');
        $items = array_column($b['items'] ?? [], null, 'key');
        $out = [];
        foreach (Connections::ends($b) as $key => $ends) {
            foreach ($ends as $end) {
                $towards = 'towards '.($titles[$end['to']] ?? $end['to']);
                if ($end['via'] === 'edge') {
                    $out[$key]['exits'][$end['edge']] = $towards;
                } else {
                    $out[$key]['passages'][] = ['via' => $end['via'], 'x' => $end['x'], 'towards' => $towards];
                }
            }
        }
        foreach ($b['interactions'] as $it) {
            $scene = $scenes[$it['scene']] ?? null;
            if ($scene && ! empty($it['item']) && isset($items[$it['item']]) && AssetDirector::placementOf($it, $items[$it['item']], $scene) === 'wall') {
                $out[$it['scene']]['wall'][] = (float) ($it['x'] ?? 0.5);
            }
        }

        return $out;
    }

    private function status(int $id, string $status): void
    {
        $this->runs->update($id, ['status' => $status]);
    }

    private function say(string $message): void
    {
        $this->log && ($this->log)($message);
    }
}
