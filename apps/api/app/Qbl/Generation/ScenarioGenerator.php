<?php

namespace App\Qbl\Generation;

use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Methods\GenerationMethod;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\Generation\Pipeline\Steps\ImportStep;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\VoicePicker;
use App\Qbl\Speech\Voicer;

/**
 * Makes a whole mission from a teacher's prompt, by running a generation method's steps in order.
 *
 * This class is the bookkeeping around the steps, and the same for every method:
 *
 *   - find the run (a new row in scenario_generations, or the one being resumed) and its work folder
 *   - attach the run's spend ledger, audit log, progress bar and trace
 *   - hand a GenerationRun to each step in turn (through the Tracer, which writes down what it did)
 *   - stop early when a step says so (design-only, no-import)
 *   - on failure or cancel, mark the run and keep everything it made, so it can be resumed
 *
 * WHAT the steps are, and WHO does each job (which models, which picture services), is the method's
 * business: see Methods/GenerationMethod.php. The classic method's steps are:
 *
 *   1. align    choose the curriculum standards and write learning objectives (Steps/AlignStep)
 *   2. design   write the blueprint: story, scenes, characters, items, interactions, checklist (Steps/DesignStep)
 *   3. estimate count and price the pictures; --design-only stops here (Steps/EstimateStep)
 *   4. draw     every picture, in the house art style (Steps/DrawStep)
 *   5. build    rows of the QBL tables from the blueprint and pictures (Steps/BuildStep)
 *   6. voice    record the characters' lines (Steps/VoiceStep)
 *   7. package  scenario.json and assets/ as an import ZIP (Steps/PackageStep)
 *   8. import   as a private draft; record its standards; optionally publish (Steps/ImportStep)
 *
 * How far it has got is kept on the run as it goes (GenerationProgress), for the editor's progress
 * bar; a teacher can stop it from there, between two pictures (GenerationCancelled).
 *
 * Each step's result is saved on the run (scenario_generations) and in its work folder, so a run
 * that stops is resumed from where it stopped. What it spends on AI services is counted in the work
 * folder (spend.json, see Spend), estimated before drawing, and reported at the end. What every step
 * and every AI call did is in the work folder's trace/ (see Pipeline/Tracer).
 */
class ScenarioGenerator
{
    /** @var callable|null */
    private $log;

    /** The id of the run most recently started or resumed, so a caller can say how to resume it after a failure. */
    public ?int $lastRun = null;

    /** The run being made's progress, for the editor's progress bar (null between runs). */
    private ?GenerationProgress $progress = null;

    public function __construct(
        private GenerationRuns $runs,
        private StandardsStore $standards,
        /** How scenarios are made: the steps, and who does each job. */
        private GenerationMethod $method,
        private ScenarioStore $store,
        private string $workRoot,
        ?callable $log = null,
        private ?Spend $spend = null,
        /** @var ?array{picker: VoicePicker, voicer: Voicer} gives characters voices and records their lines */
        private ?array $voices = null,
        /** Where everything the run does that takes time or money is logged (generation_events), for auditing */
        private ?GenerationEvents $events = null,
    ) {
        $this->log = $log;
    }

    public function onLog(callable $log): void
    {
        $this->log = $log;
    }

    public function method(): GenerationMethod
    {
        return $this->method;
    }

    /**
     * @param  array{grade?: ?string, subject?: ?string, frameworks?: string[], standards?: string[], scenes?: ?int,
     *               min_players?: int, max_players?: int, minutes?: ?int, notes?: ?string, style?: string,
     *               stop_after?: ?string, import?: bool, publish?: bool, redo?: ?string}  $options
     *                                                                                                  redo: with $resume, a step to do again (and every step after it)
     * @return array{run: int, status: string, scenario_id: ?int, zip: ?string, warnings: string[], method: string, trace?: string}
     */
    public function generate(string $prompt, array $options, ?int $userId = null, ?int $resume = null): array
    {
        // `redo` is for this session only: it is never saved with the run (a later resume must not redo again).
        $redo = $options['redo'] ?? null;
        unset($options['redo']);

        // ------------------------------------------------------------ the run: new, or resumed
        if ($resume) {
            $saved = $this->runs->get($resume) ?? throw new GenerationError("There is no generation $resume.");
            $id = $resume;
            $prompt = $saved['prompt'];
            // Options given now win over the saved ones, so a resumed run can, say, be published.
            // Where to stop is decided afresh: a run made with --design-only is resumed to carry on.
            $options = array_filter($options, fn ($v) => $v !== null && $v !== []) + array_diff_key($saved['options'] ?? [], ['stop_after' => 1, 'import' => 1, 'publish' => 1, 'redo' => 1]);
            $userId ??= $saved['user_id'] !== null ? (int) $saved['user_id'] : null;
        } else {
            $id = $this->runs->create($prompt, $options, $userId);
            $saved = $this->runs->get($id);
        }
        // Which method made it, so a resume (and anyone reading the run later) knows.
        $options['method'] = $this->method::key();
        $this->lastRun = $id;
        $this->runs->update($id, ['options' => $options, 'error' => null]);
        $dir = rtrim($this->workRoot, '/')."/$id";
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new GenerationError("Cannot create $dir.");
        }
        $steps = $this->method->steps();
        $this->say("Generation $id (work folder $dir), method {$this->method::key()}: ".implode(' → ', array_map(fn (Step $s) => $s->name(), $steps)));
        $this->progress = $progress = new GenerationProgress($this->runs, $id, $this->method->stages((bool) $this->voices), $this->spend ? fn () => $this->spend->total() : null);
        // What this run spends is counted into its work folder, carrying on from where a resumed run was.
        $this->spend?->attach("$dir/spend.json");
        // And every call is logged in the database for auditing.
        $this->spend?->logTo($this->events, $id);
        // And every step and call is written down in the work folder's trace/, for developers.
        $tracer = $this->method->tracer();
        $tracer->attach($dir, $this->method::key(), array_map(fn (Step $s) => $s->name(), $steps));
        $ended = ['ok', null];

        // Everything the steps share: what the run already has (from an earlier session), and the services.
        $run = new GenerationRun(
            $id, $dir, $prompt, $options, $userId, $saved, $this->method,
            $this->runs, $this->store, $this->standards, $progress, $this->spend, $this->events, $tracer, $this->voices,
            fn (string $m) => $this->say($m),
            fn (string $status) => $this->status($id, $status),
        );
        $run->alignment = $saved['alignment'] ?? null;
        $run->blueprint = $saved['blueprint'] ?? null;
        $run->manifest = $saved['manifest'] ?? null;

        try {
            if ($redo !== null) {
                $this->forgetFrom($steps, (string) $redo, $run);
            }
            // ------------------------------------------------------------ the steps, in order
            foreach ($steps as $step) {
                $tracer->step($step, $run, fn () => $step->run($run), fn () => $this->spend?->total() ?? 0.0);
                if ($run->stoppedAs !== null) {
                    break; // design-only, or no import: the run ends here, as the step said
                }
            }
            if ($tracer->folder()) {
                $this->say("Trace: {$tracer->folder()}/README.md");
            }

            return $run->result();
        } catch (\Throwable $e) {
            if ($this->spend) {
                $this->say('Spent so far: '.$this->spend->describe().'.');
            }
            $ended = [$e instanceof GenerationCancelled ? 'cancelled' : 'failed', mb_substr($e->getMessage(), 0, 500)];
            $this->runs->update($id, ['status' => $e instanceof GenerationCancelled ? 'cancelled' : 'failed', 'error' => mb_substr($e->getMessage(), 0, 4000)]);
            throw $e;
        } finally {
            $this->events?->stage($id, null, $ended[0], $ended[1]);
            $this->spend?->logTo(null);
            $tracer->detach();
            $this->progress = null;
        }
    }

    /**
     * `--redo=<step>`: forget what that step and every step after it made in earlier sessions, so they
     * run again. (The steps before it are reused as usual.)
     *
     * @param  Step[]  $steps
     */
    private function forgetFrom(array $steps, string $name, GenerationRun $run): void
    {
        $names = array_map(fn (Step $s) => $s->name(), $steps);
        $from = array_search($name, $names, true);
        if ($from === false) {
            throw new GenerationError("The method {$this->method::key()} has no step \"$name\". Its steps are: ".implode(', ', $names).'.');
        }
        foreach (array_slice($steps, $from) as $step) {
            $step->forget($run);
        }
        $this->say("Doing again from \"$name\": ".implode(', ', array_slice($names, $from)));
    }

    /**
     * A voice for each character, from what the blueprint says of them: a different one each while
     * they last.
     *
     * @return array<string, string> by character key
     */
    public static function voicesFor(array $blueprint, VoicePicker $picker): array
    {
        $wanted = [];
        foreach ($blueprint['characters'] as $c) {
            $v = (array) ($c['voice'] ?? []);
            $wanted[$c['key']] = [
                'gender' => $v['gender'] ?? null, 'age' => $v['age'] ?? null, 'accent' => $v['accent'] ?? null,
                'describe' => implode(' ', array_filter([$v['sound'] ?? null, $c['personality'] ?? null, $c['role'] ?? null, $c['appearance'] ?? null, ! empty($c['guide']) ? 'warm friendly clear guide' : null])),
            ];
        }

        $lang = $blueprint['language'] ?? 'en';
        // A story's narrator reads its captions, in a voice of their own: a dramatic, charismatic storyteller unless the story asks otherwise.
        // They read the whole story, so they are chosen by fit alone: flair would hand them a giant or a warrior. The characters then
        // get theatrical voices as usual, other than the narrator's.
        if (($blueprint['format'] ?? 'mission') === 'story') {
            $v = (array) ($blueprint['narrator']['voice'] ?? []);
            $narrator = $picker->withFlair(0)->pick(['__narrator' => [
                'gender' => $v['gender'] ?? null, 'age' => $v['age'] ?? 'adult', 'accent' => $v['accent'] ?? null,
                'describe' => trim(($v['sound'] ?? '').' dramatic charismatic engaging expressive storyteller narrator'),
            ]], $lang)['__narrator'] ?? null;

            return ($narrator !== null ? ['__narrator' => $narrator] : []) + $picker->pick($wanted, $lang, $narrator !== null ? [$narrator] : []);
        }

        // A mission is narrated by the default narrator (it sets no narrator_voice): its voice is kept for them.
        $narrator = $picker->narrator($lang);

        return $picker->pick($wanted, $lang, $narrator !== null ? [$narrator] : []);
    }

    /** Import a package (this run's, or one from elsewhere) as a private draft, and record its standards. */
    public function import(string $zip, ?int $userId, array $alignment = [], array $evidence = [], bool $publish = false): int
    {
        return ImportStep::importZip($this->store, $this->standards, $zip, $userId, $alignment, $evidence, $publish, fn (string $m) => $this->say($m));
    }

    /**
     * What each background must leave room for: where its edges lead, where its doors, holes and ladders
     * stand, where things hang on its wall, and what students look at where there is no object of its own
     * (painted in). scene => [exits => [edge => "towards the Lab"], passages => [[via, x, towards]],
     * wall => [x...], looks => [[x, what, where]]].
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
                    $out[$key]['passages'][] = ['via' => $end['via'], 'x' => $end['x'], 'towards' => $towards, 'look' => $end['look'] ?? null];
                }
            }
        }
        foreach ($b['interactions'] as $it) {
            $scene = $scenes[$it['scene']] ?? null;
            if ($scene && ! empty($it['item']) && isset($items[$it['item']]) && AssetDirector::placementOf($it, $items[$it['item']], $scene) === 'wall') {
                // Painted on the wall unless it is taken away (then it is a thing of its own, hung there).
                $out[$it['scene']]['wall'][] = AssetDirector::paintedOnWall($it)
                    ? ['x' => (float) ($it['x'] ?? 0.5), 'what' => "{$items[$it['item']]['name']}: {$items[$it['item']]['appearance']}"]
                    : ['x' => (float) ($it['x'] ?? 0.5), 'what' => null];
            }
            // Something to look at that has no object: the background shows it where its marker is.
            if ($scene && empty($it['item']) && ! empty($it['look']) && isset($it['x']) && empty($it['character']) && empty($it['at_report'])) {
                $out[$it['scene']]['looks'][] = ['x' => (float) $it['x'], 'what' => $it['look'], 'where' => AssetDirector::placementOf($it, null, $scene)];
            }
        }
        // Things in the scene to look at (details): painted in where they are. Lights hung on a wall: painted on it.
        foreach ($b['scenes'] as $scene) {
            foreach (array_values($scene['lights'] ?? []) as $l) {
                if (($l['placement'] ?? null) === 'wall') {
                    $out[$scene['key']]['lights'][] = ['x' => (float) $l['x'], 'what' => rtrim((string) $l['look'], '.').', lit and glowing', 'where' => $l['where'] ?? 'wall'];
                }
            }
            // A scene made on its own: things standing out on the floor, to be cut out of the picture afterwards.
            if (! empty($scene['standing'])) {
                $out[$scene['key']]['standing'] = array_map(fn ($t) => ['x' => (float) $t['x'], 'depth' => $t['depth'] ?? 'middle', 'look' => (string) $t['look']], array_values($scene['standing']));
            }
            foreach ($scene['details'] ?? [] as $d) {
                if (! empty($d['look']) && isset($d['x'])) {
                    $out[$scene['key']]['looks'][] = ['x' => (float) $d['x'], 'what' => $d['look'], 'where' => ($d['placement'] ?? 'back') === 'ground' ? 'ground' : 'back'];
                }
            }
        }

        return $out;
    }

    /** The run's status; a stage of the bar also starts the stage's part of it (and checks for a cancel). */
    private function status(int $id, string $status): void
    {
        // The audit log's clock: the stage that was running ends, and this one starts (a status that is not a stage just ends it).
        $this->events?->stage($id, isset(GenerationProgress::STAGES[$status]) ? $status : null);
        $this->spend?->stage(isset(GenerationProgress::STAGES[$status]) ? $status : null);
        if ($this->progress && isset(GenerationProgress::STAGES[$status])) {
            $this->progress->stage($status);
        } else {
            $this->runs->update($id, ['status' => $status]);
        }
    }

    private function say(string $message): void
    {
        $this->log && ($this->log)($message);
    }
}
