<?php

namespace App\Qbl\Generation;

use App\Qbl\Generation\Art\LibraryCritters;

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\CharacterAnimator;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\Providers\AutoSpriteAnimator;
use App\Qbl\Generation\Art\Providers\GeminiImageGenerator;
use App\Qbl\Generation\Art\Providers\OfflineImageGenerator;
use App\Qbl\Generation\Art\Providers\OpenAiImageGenerator;
use App\Qbl\Generation\Art\Providers\PlaceholderImageGenerator;
use App\Qbl\Generation\Art\Providers\ScenarioImageGenerator;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Llm\AnthropicModel;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\Generation\Methods\GenerationMethod;
use App\Qbl\Generation\Methods\GenerationMethods;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;
use App\Qbl\Speech\VoicePicker;
use App\Qbl\Speech\Voicer;

/**
 * Puts the generator together from configuration (config/qbl_generation.php), in plain PHP, so Laravel,
 * the commands and the tests build it the same way. Services are only constructed when used: drawing
 * with the placeholder needs no image key, and designing only needs the language model's.
 *
 * The factory makes the shared services (language models, picture sources, the spend ledger, voices);
 * a generation method (Methods/GenerationMethod) decides which of them a run uses, and in what steps.
 */
class GenerationFactory
{
    private ?LanguageModel $llm = null;

    private ?LanguageModel $judgeLlm = null;

    private ?LanguageModel $alignLlm = null;

    private ?Spend $spend = null;

    /** For tests: the model that stands in for every model. */
    private ?LanguageModel $llmOverride = null;

    public function __construct(
        private array $config,
        private ScenarioStore $store,
        private ?HttpClient $http = null,
        /** For tests: a model to use instead of Anthropic's. */
        ?LanguageModel $llm = null,
        /** For tests: a picture source to use whatever the driver says. */
        private ?ImageGenerator $images = null,
        /** The characters' voices (config/qbl_speech.php); none when null. */
        private ?SpeechFactory $speech = null,
    ) {
        $this->http ??= new CurlHttpClient;
        $this->llmOverride = $llm;
        $this->llm = $llm;
        $this->judgeLlm = $llm;
        $this->alignLlm = $llm;
    }

    /**
     * The asset library's ready-made animals and vehicles, for scenes' little life, or null when they
     * are turned off (QBL_GEN_LIBRARY_CRITTERS=false). The library is the shipped pack: QBL_LIBRARY_DIR,
     * else the checkout's scenarios/assets/library, else where the containers mount it.
     */
    public function libraryCritters(): ?LibraryCritters
    {
        if (! (bool) $this->config('library_critters', true)) {
            return null;
        }
        $dir = $this->config('library_dir') ?: (getenv('QBL_LIBRARY_DIR') ?: null);
        if (! $dir) {
            $checkout = dirname(__DIR__, 5).'/scenarios/assets/library';
            $dir = is_dir($checkout) ? $checkout : '/repo/scenarios/assets/library';
        }
        $library = new LibraryCritters((string) $dir);

        return $library->available() ? $library : null;
    }

    public function config(string $key, mixed $default = null): mixed
    {
        $value = $this->config;
        foreach (explode('.', $key) as $part) {
            if (! is_array($value) || ! array_key_exists($part, $value)) {
                return $default;
            }
            $value = $value[$part];
        }

        return $value;
    }

    public function http(): HttpClient
    {
        return $this->http;
    }

    public function llm(): LanguageModel
    {
        return $this->llm ??= $this->anthropic((string) $this->config('llm.model'));
    }

    public function judgeLlm(): LanguageModel
    {
        return $this->judgeLlm ??= $this->anthropic((string) $this->config('llm.judge_model'));
    }

    /** The model that aligns to standards: a smaller one than the designer's (QBL_GEN_ALIGN_MODEL). */
    public function alignLlm(): LanguageModel
    {
        return $this->alignLlm ??= $this->anthropic((string) $this->config('llm.align_model', $this->config('llm.model')));
    }

    /** What runs spend, shared by every model and the art director (each run counts into its own file). */
    public function spend(): Spend
    {
        return $this->spend ??= new Spend((float) $this->config('budget', 0), (array) $this->config('prices', []));
    }

    /** A Claude model by name, with the configured key, limits and spend ledger (for methods that want another model). */
    public function anthropicModel(string $model): LanguageModel
    {
        return $this->llmOverride ?? $this->anthropic($model);
    }

    /** For tests: the picture source injected in place of every driver, if any. */
    public function injectedImages(): ?ImageGenerator
    {
        return $this->images;
    }

    private function anthropic(string $model): AnthropicModel
    {
        return new AnthropicModel(
            $this->http, (string) $this->config('llm.api_key'), $model, (string) $this->config('llm.base_url', 'https://api.anthropic.com'), $this->spend(),
            thinkingRoom: (int) $this->config('llm.thinking_tokens', 32000),
            effort: (string) $this->config('llm.effort', ''),
            timeout: (int) $this->config('llm.timeout', 1800),
        );
    }

    public function standards(): StandardsStore
    {
        return new StandardsStore($this->store->pdo());
    }

    public function style(?string $key = null): ArtStyle
    {
        return ArtStyle::load((string) $this->config('styles_dir'), $key ?? (string) $this->config('style', 'qbl-adventure'));
    }

    public function images(?string $driver = null, ?ArtStyle $style = null): ImageGenerator
    {
        if ($this->images) {
            return $this->images;
        }
        $driver ??= (string) $this->config('images.driver', 'gemini');
        $c = fn (string $k, $d = '') => (string) $this->config("images.$driver.$k", $d);

        return match ($driver) {
            'gemini' => new GeminiImageGenerator($this->http, $c('api_key'), $c('model', 'gemini-3-pro-image'), $c('base_url', 'https://generativelanguage.googleapis.com/v1beta'), $c('image_size', '2K'), $c('props_model', ''), $c('props_size', '')),
            'openai' => new OpenAiImageGenerator($this->http, $c('api_key'), $c('model', 'gpt-image-2'), $c('quality', 'high'), $c('base_url', 'https://api.openai.com/v1')),
            'scenario' => new ScenarioImageGenerator($this->http, $c('api_key'), $c('api_secret'), $c('model_id'), $c('base_url', 'https://api.cloud.scenario.com/v1')),
            'offline' => new OfflineImageGenerator,
            'placeholder' => new PlaceholderImageGenerator(($style ?? $this->style())->chroma(), array_values(($style ?? $this->style())->palette())),
            default => throw new GenerationError("Unknown image driver \"$driver\": use gemini, openai, scenario, placeholder or offline."),
        };
    }

    /**
     * Who animates the characters (config `animations`): AutoSprite, made from each character's sheet
     * in one request per character. Null when that is switched off ("draw": strips are drawn by the
     * image model) or not set up (no AUTOSPRITE_API_KEY), with a line in the log saying so.
     */
    public function animator(?string $driver = null, ?callable $log = null): ?CharacterAnimator
    {
        $driver ??= (string) $this->config('animations.driver', 'autosprite');
        if ($driver === 'draw' || $driver === '') {
            return null;
        }
        if ($driver !== 'autosprite') {
            throw new GenerationError("Unknown animation driver \"$driver\": use autosprite or draw.");
        }
        $c = fn (string $k, $d = null) => $this->config("animations.autosprite.$k", $d);
        if ((string) $c('api_key', '') === '') {
            $log && $log('AUTOSPRITE_API_KEY is not set, so the characters\' animations are drawn as strips by the image model.');

            return null;
        }
        $list = $c('animations', []);
        $list = is_string($list) ? array_values(array_filter(array_map('trim', explode(',', $list)))) : array_values((array) $list);

        return new AutoSpriteAnimator(
            $this->http,
            // The one generation request per character must never be sent twice: no retries for it.
            $this->http instanceof CurlHttpClient ? new CurlHttpClient(0) : $this->http,
            (string) $c('api_key'),
            $list,
            (string) $c('video_tier', 'turbo'),
            (int) $c('frames', 16),
            (int) $c('frame_size', 256),
            (string) $c('remove_bg', 'default'),
            (string) $c('base_url', 'https://www.autosprite.io/api/v1'),
            (int) $c('timeout', 900),
            $this->spend(),
        );
    }

    /**
     * The generation method a run uses: by key (--method), else QBL_GEN_METHOD, else "classic".
     *
     * @param  array  $options  as for generator()
     */
    public function method(?string $key = null, array $options = [], ?callable $log = null): GenerationMethod
    {
        $key = $key ?: (string) $this->config('method', 'classic');
        $class = GenerationMethods::classFor($key, (array) $this->config('methods', []));

        return new $class($this, $options, $log);
    }

    /** Every method there is: key => summary. */
    public function methods(): array
    {
        return array_map(fn (string $class) => $class::summary(), GenerationMethods::all((array) $this->config('methods', [])));
    }

    /** The method a run was made with (to resume it the same way), if it says. */
    public function savedMethod(int $run): ?string
    {
        $method = (new GenerationRuns($this->store->pdo()))->get($run)['options']['method'] ?? null;

        return is_string($method) && $method !== '' ? $method : null;
    }

    /**
     * @param  array{method?: ?string, style?: ?string, images?: ?string, judge?: ?bool, attempts?: ?int, anchors_required?: bool, budget?: ?float, voices?: ?bool}  $options
     *                                                                                                                                                                         method: which GenerationMethod (default QBL_GEN_METHOD, else classic); the rest are passed to it
     */
    public function generator(array $options = [], ?callable $log = null): ScenarioGenerator
    {
        $method = $this->method($options['method'] ?? null, $options, $log);
        // Refuse now, before anything is spent, if the method cannot work as set up (no style anchors, say).
        $method->check();
        $spend = $this->spend();
        if (isset($options['budget'])) {
            $spend->setBudget((float) $options['budget']);
        }

        return new ScenarioGenerator(
            new GenerationRuns($this->store->pdo()),
            $this->standards(),
            $method,
            $this->store,
            (string) $this->config('work_dir'),
            $log,
            $spend,
            $this->voices($method->wantsVoices() === false ? false : ($options['voices'] ?? null), $log),
            new GenerationEvents($this->store->pdo()),
        );
    }

    /**
     * What gives the characters voices and records their lines; null when that is switched off
     * ($wanted false, or QL_TTS_DRIVER=none) or the voices are not set up.
     *
     * @return ?array{picker: VoicePicker, voicer: Voicer}
     */
    private function voices(?bool $wanted, ?callable $log): ?array
    {
        if ($wanted === false || ! $this->speech) {
            return null;
        }
        try {
            $voicer = $this->speech->voicer();
        } catch (SpeechError $e) {
            $log && $log('Voices are not set up, so the lines will be read by the browser: '.$e->getMessage());

            return null;
        }

        return $voicer ? ['picker' => $this->speech->picker(), 'voicer' => $voicer] : null;
    }

    public function director(string $dir, ?string $styleKey = null, ?string $driver = null, ?callable $log = null): AssetDirector
    {
        $style = $this->style($styleKey);

        return new AssetDirector($this->images($driver, $style), $style, null, $dir, 1, $log, library: $this->libraryCritters());
    }
}
