<?php

namespace App\Qbl\Generation\Pipeline;

use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Curriculum\MissionStandards;
use App\Qbl\Generation\Design\DesignRules;
use App\Qbl\Generation\GenerationEvents;
use App\Qbl\Generation\GenerationProgress;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Methods\GenerationMethod;
use App\Qbl\Generation\Spend;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\VoicePicker;
use App\Qbl\Speech\Voicer;

/**
 * Everything one run of the generator knows so far, handed from step to step.
 *
 * A run is a row in scenario_generations (prompt, options, alignment, blueprint, manifest...) plus a
 * work folder on disk. ScenarioGenerator makes one of these when a run starts or resumes, then hands
 * it to each of the method's steps in turn. Each step reads what earlier steps left here and adds its
 * own result:
 *
 *   align    -> $alignment          (standards, learning objectives, vocabulary, misconceptions)
 *               $format             ("mission" to play, or "story" to watch)
 *   design   -> $blueprint          (the whole mission as data: scenes, characters, items, interactions...)
 *   estimate -> $director, $art, $estimate   (who draws, what they draw from, and what it will cost)
 *   draw     -> $assets, $manifest  (every picture, and how each was made)
 *   build    -> $built              (the rows of the QBL tables)
 *   voice    -> $built              (the same, with recorded lines)
 *   package  -> $package            (scenario.json + assets/ as a ZIP)
 *   import   -> $scenarioId
 *
 * A step that wants to stop the run early (a design-only run stops after the estimate) calls stop().
 * A step that finds its work already done (a resumed run) calls skip() to say so in the trace.
 * Anything a step wants a developer to be able to read later goes through output() and note().
 *
 * Custom steps can keep their own things in $data (an outline, a critic's reviews), and add to what
 * the designer is told with designNotes[] (see designOptions()).
 */
final class GenerationRun
{
    // ---------------------------------------------------------------- what the run is working on

    /** The curriculum alignment (StandardsAligner::align). */
    public ?array $alignment = null;

    /** "mission" (students play it) or "story" (it plays by itself). Decided by the align step. */
    public string $format = 'mission';

    /** The blueprint: the whole mission as data (BlueprintSchema / StorySchema). */
    public ?array $blueprint = null;

    /** The blueprint as the art director reads it (a story's is reshaped by StoryPlan::forArt). */
    public ?array $art = null;

    /** Draws the pictures, made by the method for this run's folder. */
    public ?AssetDirector $director = null;

    /** What drawing is expected to take: {pictures, usd, by}. */
    public ?array $estimate = null;

    /** Every picture, by key, ready for the builder. */
    public ?array $assets = null;

    /** How every picture was made: provider, prompt, attempts, scores (AssetDirector::manifest). */
    public ?array $manifest = null;

    /** The built scenario: rows of the QBL tables, media, evidence (MissionBuilder::build). */
    public ?array $built = null;

    /** The character voices chosen for the build (by character key). */
    public array $voices = [];

    /** The written package: {zip, ...} (ScenarioPackage::write). */
    public ?array $package = null;

    public ?int $scenarioId = null;

    /** Things the teacher should look at before publishing. */
    public array $warnings = [];

    /** For custom steps: anything they want to hand to later steps (keyed by whatever they like). */
    public array $data = [];

    /** Extra lines for the designer's brief, added by steps that run before design (an outline, say). */
    public array $designNotes = [];

    // ---------------------------------------------------------------- how it ends

    /** Set by stop(): the run ends after this step with this status ("designed", "packaged"). */
    public ?string $stoppedAs = null;

    /** The run's status when it ends ("done", unless a step stopped it early). */
    public string $status = 'done';

    /** What the step running now has said about itself, for the trace (see Tracer::step). */
    private ?array $stepRecord = null;

    public function __construct(
        public readonly int $id,
        /** The run's work folder: everything it draws, writes and records is in here. */
        public readonly string $dir,
        /** The teacher's request, in their words. */
        public readonly string $prompt,
        /** grade, subject, frameworks, standards, scenes, players, minutes, notes, format, stop_after, import, publish... */
        public array $options,
        public readonly ?int $userId,
        /** The row as it was when the run started or resumed: what earlier sessions of it already made. */
        public readonly array $saved,
        public readonly GenerationMethod $method,
        // The services steps use. They are the generator's own, shared by every step of the run.
        public readonly GenerationRuns $runs,
        public readonly ScenarioStore $store,
        public readonly MissionStandards $standards,
        public readonly GenerationProgress $progress,
        public readonly ?Spend $spend,
        public readonly ?GenerationEvents $events,
        public readonly Tracer $tracer,
        /** @var ?array{picker: VoicePicker, voicer: Voicer} */
        public readonly ?array $speech,
        /** fn(string $message): the generator's log (the console, or the queue worker's log) */
        private readonly \Closure $say,
        /** fn(string $status): moves the run (and the progress bar and audit log) to a stage */
        private readonly \Closure $moveTo,
    ) {}

    // ---------------------------------------------------------------- for steps

    /** Write a line to the log (the console when run from artisan). */
    public function say(string $message): void
    {
        ($this->say)($message);
        if ($this->stepRecord !== null) {
            $this->stepRecord['notes'][] = $message;
        }
    }

    /**
     * Move the run to a stage: its status, the editor's progress bar (GenerationProgress::STAGES) and
     * the audit log's clock all follow. Also where a cancel from the editor is noticed.
     */
    public function stage(string $status): void
    {
        ($this->moveTo)($status);
    }

    /** Save fields on the run's row (alignment, blueprint, manifest, options...), so a resumed run finds them. */
    public function save(array $fields): void
    {
        $this->runs->update($this->id, $fields);
    }

    /** End the run after this step, with $status ("designed": blueprint only; "packaged": ZIP not imported). */
    public function stop(string $status): void
    {
        $this->stoppedAs = $status;
        $this->status = $status;
    }

    /** Say in the trace that this step had nothing to do, and why ("the run already has its alignment"). */
    public function skip(string $why): void
    {
        if ($this->stepRecord !== null) {
            $this->stepRecord['skipped'] = $why;
        }
    }

    /** Keep something this step made in the trace, as a file of its own (steps/NN-step.<what>.json). */
    public function output(string $what, mixed $value): void
    {
        if ($this->stepRecord !== null) {
            $this->stepRecord['outputs'][$what] = $value;
        }
    }

    /** Put something at this point in the trace's timeline (a review, a choice), between the calls. */
    public function note(string $what, array $detail): void
    {
        $this->tracer->note($what, $detail);
    }

    public function warn(string $warning): void
    {
        $this->warnings[] = $warning;
    }

    /**
     * What the designer is given: the run's options, with any notes earlier steps added, and the design
     * approach settings the teacher left as "Choose for me" as the aligner chose them.
     */
    public function designOptions(): array
    {
        $options = $this->options + DesignRules::chosen($this->alignment['approach'] ?? []);
        if (! $this->designNotes) {
            return $options;
        }
        $notes = trim(implode("\n\n", array_filter([$this->options['notes'] ?? null, ...$this->designNotes])));

        return ['notes' => $notes] + $options;
    }

    public function isStory(): bool
    {
        return $this->format === 'story';
    }

    /** The learning objective ids, which the blueprint validator checks every objective against. */
    public function objectiveIds(): array
    {
        return array_column($this->alignment['learning_objectives'] ?? [], 'id');
    }

    // ---------------------------------------------------------------- for the generator and tracer

    /** @internal Tracer::step: a step begins. */
    public function beginStep(string $name): void
    {
        $this->stepRecord = ['name' => $name, 'skipped' => null, 'notes' => [], 'outputs' => []];
    }

    /** @internal Tracer::step: a step ends; what it said about itself. */
    public function endStep(): array
    {
        $record = $this->stepRecord ?? ['skipped' => null, 'notes' => [], 'outputs' => []];
        $this->stepRecord = null;

        return $record;
    }

    /** What generate() returns. */
    public function result(): array
    {
        $result = ['run' => $this->id, 'status' => $this->status, 'scenario_id' => $this->scenarioId, 'zip' => $this->package['zip'] ?? null, 'warnings' => $this->warnings, 'method' => $this->method::key()];
        if ($this->status === 'designed') {
            $result['estimate'] = $this->estimate;
        }
        $result['spend'] = $this->spend?->summary();
        if ($this->tracer->folder()) {
            $result['trace'] = $this->tracer->folder();
        }

        return $result;
    }
}
