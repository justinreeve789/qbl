<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\CharacterAnimator;
use App\Qbl\Generation\Art\Providers\AutoSpriteAnimator;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\StyleJudge;
use App\Qbl\Generation\Build\MissionBuilder;
use App\Qbl\Generation\Build\StoryBuilder;
use App\Qbl\Generation\Curriculum\StandardsAligner;
use App\Qbl\Generation\Design\BlueprintCritic;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\Generation\Pipeline\Steps\AlignStep;
use App\Qbl\Generation\Pipeline\Steps\BuildStep;
use App\Qbl\Generation\Pipeline\Steps\DesignStep;
use App\Qbl\Generation\Pipeline\Steps\DrawStep;
use App\Qbl\Generation\Pipeline\Steps\EstimateStep;
use App\Qbl\Generation\Pipeline\Steps\ImportStep;
use App\Qbl\Generation\Pipeline\Steps\PackageStep;
use App\Qbl\Generation\Pipeline\Steps\VoiceStep;
use App\Qbl\Generation\Pipeline\Tracer;
use App\Qbl\Generation\Pipeline\TracingImageGenerator;
use App\Qbl\Generation\Pipeline\TracingLanguageModel;

/**
 * A way of making a scenario from a teacher's prompt. This is the class to subclass to try something
 * different.
 *
 * A method decides two things:
 *
 *   WHAT HAPPENS, IN WHAT ORDER: steps() — a list of Step objects. The default is the classic pipeline:
 *
 *       align → design → estimate → draw → build → voice → package → import
 *
 *     Add a step (a critic after design), replace one (design three candidates and keep the best), or
 *     drop one (no voices).
 *
 *   WHO DOES EACH JOB: the make*() and chooseModel() hooks below — which language model aligns,
 *     designs and judges; which service draws (Gemini, OpenAI, Scenario, a router that sends sprites
 *     to one and backgrounds to another, the free placeholder); who animates the characters
 *     (AutoSprite, the primary source when it is set up, else strips drawn by the image model);
 *     whether pictures are judged and how
 *     strictly; which builder turns the blueprint into engine rows.
 *
 * Steps never build their own services: they ask the method ($run->method->designer(), ->model('critic'),
 * ->director($dir)...). That is what makes a method one place to read to know how a run was made.
 *
 * Everything the method hands out is wrapped for the trace (see Tracer): every language model call
 * and every picture request is written to the run's trace/ folder, including those of models and
 * picture sources a subclass makes. A subclass never has to remember to do that.
 *
 * Choosing a method: `php artisan qbl:generate "..." --method=critic`, or QBL_GEN_METHOD for every
 * run (the editor's too). `php artisan qbl:generate --list-methods` lists them. A resumed run carries
 * on with the method it was started with unless another is given.
 *
 * Writing one:
 *
 *   final class MyMethod extends GenerationMethod
 *   {
 *       public static function key(): string { return 'mine'; }
 *       public static function summary(): string { return 'What it tries, in one line.'; }
 *
 *       // Who designs: a cheaper model for a quick experiment.
 *       protected function chooseModel(string $job): LanguageModel
 *       {
 *           return $job === 'design' ? $this->factory->anthropicModel('claude-sonnet-5-5') : parent::chooseModel($job);
 *       }
 *
 *       // What happens: the classic steps with a step of yours after the design.
 *       public function steps(): array
 *       {
 *           return self::insertAfter(parent::steps(), 'design', new MyCheckStep);
 *       }
 *   }
 *
 * then add it to GenerationMethods::BUILT_IN (or, without touching that file, to the `methods`
 * setting: QBL_GEN_METHODS='{"mine": "App\\Qbl\\Generation\\Methods\\MyMethod"}').
 *
 * Settings for a method live under `method_options.<key>` in config/qbl_generation.php, read with
 * setting(). Options from the command (images, judge, attempts, style, voices...) win over a
 * method's own choices, so `--images=placeholder` makes any method free to try.
 */
abstract class GenerationMethod
{
    /** What this method has made so far, so each part is made once per generator. */
    private array $made = [];

    /** @var callable|null */
    protected $log;

    protected Tracer $tracer;

    /**
     * @param  array  $options  the generator's options: style, images, judge, attempts, budget, voices, anchors_required, and any of the method's own settings
     */
    public function __construct(protected GenerationFactory $factory, protected array $options = [], ?callable $log = null)
    {
        $this->log = $log;
        $this->tracer = new Tracer((bool) $factory->config('trace.enabled', true), (string) $factory->config('trace.pictures', 'thumb'));
    }

    /** The name it is chosen by: --method=<key>. Lower case, with dashes. */
    abstract public static function key(): string;

    /** One line saying what it tries, for --list-methods. */
    abstract public static function summary(): string;

    // ================================================================================================
    // WHAT HAPPENS: the steps
    // ================================================================================================

    /**
     * The steps of a run, in order. Override to change the pipeline; see insertAfter(), replace() and
     * without() for small changes to the classic list.
     *
     * @return Step[]
     */
    public function steps(): array
    {
        return [
            new AlignStep,     // standards and learning objectives                 (language model: 'align')
            new DesignStep,    // the blueprint, corrected until it validates        (language model: 'design')
            new EstimateStep,  // count and price the pictures; --design-only stops here
            new DrawStep,      // every picture, judged against the style anchors    (images(), judge())
            new BuildStep,     // blueprint + pictures → engine rows (plain code, no AI)
            new VoiceStep,     // record the characters' lines (when voices are set up)
            new PackageStep,   // the import ZIP; --no-import stops here
            new ImportStep,    // a private draft in the editor
        ];
    }

    /** @param Step[] $steps */
    protected static function insertAfter(array $steps, string $after, Step ...$new): array
    {
        $at = self::indexOf($steps, $after);

        return [...array_slice($steps, 0, $at + 1), ...$new, ...array_slice($steps, $at + 1)];
    }

    /** @param Step[] $steps */
    protected static function insertBefore(array $steps, string $before, Step ...$new): array
    {
        $at = self::indexOf($steps, $before);

        return [...array_slice($steps, 0, $at), ...$new, ...array_slice($steps, $at)];
    }

    /** @param Step[] $steps */
    protected static function replace(array $steps, string $name, Step $with): array
    {
        $steps[self::indexOf($steps, $name)] = $with;

        return $steps;
    }

    /** @param Step[] $steps */
    protected static function without(array $steps, string ...$names): array
    {
        return array_values(array_filter($steps, fn (Step $s) => ! in_array($s->name(), $names, true)));
    }

    private static function indexOf(array $steps, string $name): int
    {
        foreach ($steps as $i => $s) {
            if ($s->name() === $name) {
                return $i;
            }
        }
        throw new GenerationError("There is no step \"$name\" to put a step next to.");
    }

    // ================================================================================================
    // WHO DOES EACH JOB: hooks to override
    // ================================================================================================

    /**
     * The language model for a job. Jobs the built-in steps use:
     *   align   choosing standards, writing objectives      (default QBL_GEN_ALIGN_MODEL, Sonnet)
     *   design  writing and correcting the blueprint         (default QBL_GEN_LLM_MODEL, Opus)
     *   judge   scoring pictures against the style anchors   (default QBL_GEN_JUDGE_MODEL, Sonnet)
     *   critic  reviewing a blueprint as a teacher would     (default: the design model)
     *   outline sketching the story before the blueprint     (default: the design model)
     * A step of your own can ask for any job name; unknown jobs get the design model.
     */
    protected function chooseModel(string $job): LanguageModel
    {
        return match ($job) {
            'align' => $this->factory->alignLlm(),
            'judge' => $this->factory->judgeLlm(),
            default => $this->factory->llm(),
        };
    }

    /** The model's name, for the trace. */
    protected function modelName(string $job): string
    {
        return (string) match ($job) {
            'align' => $this->factory->config('llm.align_model', $this->factory->config('llm.model')),
            'judge' => $this->factory->config('llm.judge_model'),
            default => $this->factory->config('llm.model'),
        };
    }

    /**
     * Who draws. Only asked when the command has not named a source itself (see images()). The default
     * is the configured driver (QBL_GEN_IMAGE_DRIVER: gemini, openai, scenario or placeholder).
     */
    protected function makeImages(): ImageGenerator
    {
        return $this->factory->images($this->imageDriver(), $this->style());
    }

    /** The driver this method draws with by default. */
    protected function preferredDriver(): string
    {
        return (string) $this->factory->config('images.driver', 'gemini');
    }

    /**
     * Who animates the characters from their sheets, or null to draw each animation as a strip.
     *
     * AutoSprite is the primary source: used whenever AUTOSPRITE_API_KEY is set, unless the command
     * or configuration says "draw" (--animations=draw, QBL_GEN_ANIMATION_DRIVER=draw). Never for
     * placeholder pictures, so a free run stays free; offline (--offline), only what was made before.
     */
    protected function makeAnimator(): ?CharacterAnimator
    {
        $offline = ($this->options['images'] ?? null) === 'offline' || $this->imageDriver() === 'offline';
        if (! $offline && $this->placeholderPictures()) {
            return null;
        }
        $animator = $this->factory->animator(isset($this->options['animations']) ? (string) $this->options['animations'] : null, $this->log);
        if ($animator instanceof AutoSpriteAnimator) {
            // Its upload, its one request, each job's end and each sheet go in the trace as notes.
            $animator->observe(fn (string $what, array $detail) => $this->tracer->note($what, $detail), $this->log);
            if ($offline) {
                $animator->offline();
            }
        }

        return $animator;
    }

    /** When the animator refuses a character outright (nothing spent): "draw" their strips instead, or "puppet". */
    protected function animatorFallback(): string
    {
        return (string) ($this->options['animation_fallback'] ?? $this->factory->config('animations.fallback', 'draw'));
    }

    /** Who judges each picture, or null to keep every first attempt. */
    protected function makeJudge(): ?StyleJudge
    {
        return $this->judging() ? new StyleJudge($this->model('judge'), $this->minScore()) : null;
    }

    /** Below this (out of 10) a picture is drawn again. */
    protected function minScore(): float
    {
        return (float) $this->factory->config('judge.min_score', 7);
    }

    /** How many tries a picture gets before the best is kept. */
    protected function attempts(): int
    {
        return (int) ($this->options['attempts'] ?? $this->factory->config('judge.max_attempts', 3));
    }

    /** Whether pictures are judged: as the command says, else as configured; never for placeholder shapes. */
    protected function judging(): bool
    {
        return (bool) ($this->options['judge'] ?? $this->factory->config('judge.enabled', true)) && ! $this->placeholderPictures();
    }

    /** Which pictures are made and how (portraits cropped or drawn, idle frames, prop sheets, scale guide). */
    protected function pictures(): array
    {
        return (array) $this->factory->config('pictures', []);
    }

    protected function makeAligner(): StandardsAligner
    {
        return new StandardsAligner($this->factory->standards(), $this->model('align'));
    }

    protected function makeDesigner(): MissionDesigner
    {
        return new MissionDesigner(
            $this->model('design'),
            (array) $this->factory->config('limits', ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18]),
            bigMomentChance: (float) $this->factory->config('pacing.big_moment_chance', 0.25),
        );
    }

    protected function makeCritic(): BlueprintCritic
    {
        return new BlueprintCritic($this->model('critic'));
    }

    /** The art director for a run's folder: it writes the prompts, asks images(), has judge() check. */
    protected function makeDirector(string $dir): AssetDirector
    {
        return new AssetDirector($this->images(), $this->style(), $this->judge(), $dir, max(1, $this->attempts()), $this->log, $this->factory->spend(), $this->pictures(), $this->animator(), $this->animatorFallback());
    }

    /** Turns the blueprint and pictures into engine rows. */
    public function builder(bool $story): MissionBuilder|StoryBuilder
    {
        return $story ? new StoryBuilder : new MissionBuilder;
    }

    /** Whether runs record voices: null as the command and configuration say; false never. */
    public function wantsVoices(): ?bool
    {
        return null;
    }

    /**
     * Refuse before anything is spent if the method cannot work as set up. By default: real pictures
     * need the style's approved anchors, since they are what keeps every picture in one style.
     */
    public function check(): void
    {
        $style = $this->style();
        if (($this->options['anchors_required'] ?? true) && ! $this->placeholderPictures() && count($style->anchors()) === 0) {
            throw new GenerationError("The art style \"{$style->key}\" has no approved anchor pictures yet, and they are what keeps every picture in one style. Make them first: php artisan qbl:art-style {$style->key} --bootstrap (then --approve). To go ahead without them, pass --without-anchors.");
        }
    }

    // ================================================================================================
    // What steps call. Final: these make each part once and wrap it for the trace.
    // ================================================================================================

    /** The (traced) language model for a job. */
    final public function model(string $job): LanguageModel
    {
        return $this->made["model:$job"] ??= new TracingLanguageModel($this->chooseModel($job), $this->tracer, $job, $this->modelName($job));
    }

    /**
     * Who draws (traced). The command's --images=placeholder or --offline wins over the method, so any
     * method can be tried for free or finished without drawing.
     */
    final public function images(): ImageGenerator
    {
        return $this->made['images'] ??= TracingImageGenerator::wrap(
            in_array($this->options['images'] ?? null, ['placeholder', 'offline'], true) ? $this->factory->images($this->options['images'], $this->style()) : $this->makeImages(),
            $this->tracer,
        );
    }

    final public function judge(): ?StyleJudge
    {
        if (! array_key_exists('judge', $this->made)) {
            $this->made['judge'] = $this->makeJudge();
        }

        return $this->made['judge'];
    }

    /** Who animates the characters (see makeAnimator), made once. */
    final public function animator(): ?CharacterAnimator
    {
        if (! array_key_exists('animator', $this->made)) {
            $this->made['animator'] = $this->makeAnimator();
        }

        return $this->made['animator'];
    }

    final public function aligner(): StandardsAligner
    {
        return $this->made['aligner'] ??= $this->makeAligner();
    }

    final public function designer(): MissionDesigner
    {
        return $this->made['designer'] ??= $this->makeDesigner();
    }

    final public function critic(): BlueprintCritic
    {
        return $this->made['critic'] ??= $this->makeCritic();
    }

    /** A new art director for a run's folder (one per run: it keeps that run's manifest). */
    final public function director(string $dir): AssetDirector
    {
        return $this->makeDirector($dir);
    }

    final public function style(): ArtStyle
    {
        return $this->made['style'] ??= $this->factory->style($this->options['style'] ?? null);
    }

    final public function tracer(): Tracer
    {
        return $this->tracer;
    }

    /** The image driver: as the command says (--images), else the method's preference. */
    final public function imageDriver(): string
    {
        return (string) ($this->options['images'] ?? $this->preferredDriver());
    }

    /**
     * A setting for this method: the generator's options first (so a test or command can pass it),
     * then config method_options.<key>.<name>, then $default.
     */
    final public function setting(string $name, mixed $default = null): mixed
    {
        // A setting left empty in the configuration (null) means "the method's default".
        return $this->options[$name] ?? $this->factory->config('method_options.'.static::key().".$name") ?? $default;
    }

    /** Whether the pictures are flat placeholder shapes (or none at all): nothing to judge, no anchors needed. */
    final protected function placeholderPictures(): bool
    {
        return in_array($this->imageDriver(), ['placeholder', 'offline'], true) && ! $this->factory->injectedImages();
    }

    /** Write a line to the generator's log. */
    final protected function say(string $message): void
    {
        $this->log && ($this->log)($message);
    }
}
