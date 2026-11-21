<?php

namespace App\Qbl\Generation;

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\Providers\GeminiImageGenerator;
use App\Qbl\Generation\Art\Providers\OfflineImageGenerator;
use App\Qbl\Generation\Art\Providers\OpenAiImageGenerator;
use App\Qbl\Generation\Art\Providers\PlaceholderImageGenerator;
use App\Qbl\Generation\Art\Providers\ScenarioImageGenerator;
use App\Qbl\Generation\Art\StyleJudge;
use App\Qbl\Generation\Curriculum\StandardsAligner;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Llm\AnthropicModel;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;

/**
 * Puts the generator together from configuration (config/qbl_generation.php), in plain PHP, so Laravel,
 * the commands and the tests build it the same way. Services are only constructed when used: drawing
 * with the placeholder needs no image key, and designing only needs the language model's.
 */
class GenerationFactory
{
    private ?LanguageModel $llm = null;

    private ?LanguageModel $judgeLlm = null;

    private ?LanguageModel $alignLlm = null;

    private ?Spend $spend = null;

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
        $this->llm = $llm;
        $this->judgeLlm = $llm;
        $this->alignLlm = $llm;
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
     * @param  array{style?: ?string, images?: ?string, judge?: ?bool, attempts?: ?int, anchors_required?: bool, budget?: ?float}  $options
     */
    public function generator(array $options = [], ?callable $log = null): ScenarioGenerator
    {
        $style = $this->style($options['style'] ?? null);
        $driver = $options['images'] ?? (string) $this->config('images.driver', 'gemini');
        $placeholder = in_array($driver, ['placeholder', 'offline'], true) && ! $this->images;
        if (($options['anchors_required'] ?? true) && ! $placeholder && count($style->anchors()) === 0) {
            throw new GenerationError("The art style \"{$style->key}\" has no approved anchor pictures yet, and they are what keeps every picture in one style. Make them first: php artisan qbl:art-style {$style->key} --bootstrap (then --approve). To go ahead without them, pass --without-anchors.");
        }
        // Judging placeholder shapes against anchors would only waste calls.
        $judging = ($options['judge'] ?? (bool) $this->config('judge.enabled', true)) && ! $placeholder;
        $judge = $judging ? new StyleJudge($this->judgeLlm(), (float) $this->config('judge.min_score', 7)) : null;
        $attempts = (int) ($options['attempts'] ?? $this->config('judge.max_attempts', 3));
        $images = $this->images($driver, $style);
        $spend = $this->spend();
        if (isset($options['budget'])) {
            $spend->setBudget((float) $options['budget']);
        }
        $pictures = (array) $this->config('pictures', []);

        return new ScenarioGenerator(
            new GenerationRuns($this->store->pdo()),
            $this->standards(),
            new StandardsAligner($this->standards(), $this->alignLlm()),
            new MissionDesigner($this->llm(), (array) $this->config('limits', ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18]), bigMomentChance: (float) $this->config('pacing.big_moment_chance', 0.25)),
            fn (string $dir) => new AssetDirector($images, $style, $judge, $dir, max(1, $attempts), $log, $spend, $pictures),
            $this->store,
            (string) $this->config('work_dir'),
            $log,
            $spend,
            $this->voices($options['voices'] ?? null, $log),
            new GenerationEvents($this->store->pdo()),
        );
    }

    /**
     * What gives the characters voices and records their lines; null when that is switched off
     * ($wanted false, or QBL_TTS_DRIVER=none) or the voices are not set up.
     *
     * @return ?array{picker: \App\Qbl\Speech\VoicePicker, voicer: \App\Qbl\Speech\Voicer}
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

        return new AssetDirector($this->images($driver, $style), $style, null, $dir, 1, $log);
    }
}
