<?php

namespace App\Qbl\Generation;

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\Providers\GeminiImageGenerator;
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

/**
 * Puts the generator together from configuration (config/qbl_generation.php), in plain PHP, so Laravel,
 * the commands and the tests build it the same way. Services are only constructed when used: drawing
 * with the placeholder needs no image key, and designing only needs the language model's.
 */
class GenerationFactory
{
    private ?LanguageModel $llm = null;

    private ?LanguageModel $judgeLlm = null;

    public function __construct(
        private array $config,
        private ScenarioStore $store,
        private ?HttpClient $http = null,
        /** For tests: a model to use instead of Anthropic's. */
        ?LanguageModel $llm = null,
        /** For tests: a picture source to use whatever the driver says. */
        private ?ImageGenerator $images = null,
    ) {
        $this->http ??= new CurlHttpClient;
        $this->llm = $llm;
        $this->judgeLlm = $llm;
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
        return $this->llm ??= new AnthropicModel($this->http, (string) $this->config('llm.api_key'), (string) $this->config('llm.model'), (string) $this->config('llm.base_url', 'https://api.anthropic.com'));
    }

    public function judgeLlm(): LanguageModel
    {
        return $this->judgeLlm ??= new AnthropicModel($this->http, (string) $this->config('llm.api_key'), (string) $this->config('llm.judge_model'), (string) $this->config('llm.base_url', 'https://api.anthropic.com'));
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
            'gemini' => new GeminiImageGenerator($this->http, $c('api_key'), $c('model', 'gemini-3-pro-image'), $c('base_url', 'https://generativelanguage.googleapis.com/v1beta'), $c('image_size', '2K')),
            'openai' => new OpenAiImageGenerator($this->http, $c('api_key'), $c('model', 'gpt-image-2'), $c('quality', 'high'), $c('base_url', 'https://api.openai.com/v1')),
            'scenario' => new ScenarioImageGenerator($this->http, $c('api_key'), $c('api_secret'), $c('model_id'), $c('base_url', 'https://api.cloud.scenario.com/v1')),
            'placeholder' => new PlaceholderImageGenerator(($style ?? $this->style())->chroma(), array_values(($style ?? $this->style())->palette())),
            default => throw new GenerationError("Unknown image driver \"$driver\": use gemini, openai, scenario or placeholder."),
        };
    }

    /**
     * @param  array{style?: ?string, images?: ?string, judge?: ?bool, attempts?: ?int, anchors_required?: bool}  $options
     */
    public function generator(array $options = [], ?callable $log = null): ScenarioGenerator
    {
        $style = $this->style($options['style'] ?? null);
        $driver = $options['images'] ?? (string) $this->config('images.driver', 'gemini');
        $placeholder = $driver === 'placeholder' && ! $this->images;
        if (($options['anchors_required'] ?? true) && ! $placeholder && count($style->anchors()) === 0) {
            throw new GenerationError("The art style \"{$style->key}\" has no approved anchor pictures yet, and they are what keeps every picture in one style. Make them first: php artisan qbl:art-style {$style->key} --bootstrap (then --approve). To go ahead without them, pass --without-anchors.");
        }
        // Judging placeholder shapes against anchors would only waste calls.
        $judging = ($options['judge'] ?? (bool) $this->config('judge.enabled', true)) && ! $placeholder;
        $judge = $judging ? new StyleJudge($this->judgeLlm(), (float) $this->config('judge.min_score', 7)) : null;
        $attempts = (int) ($options['attempts'] ?? $this->config('judge.max_attempts', 3));
        $images = $this->images($driver, $style);

        return new ScenarioGenerator(
            new GenerationRuns($this->store->pdo()),
            $this->standards(),
            new StandardsAligner($this->standards(), $this->llm()),
            new MissionDesigner($this->llm(), (array) $this->config('limits', ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 14])),
            fn (string $dir) => new AssetDirector($images, $style, $judge, $dir, max(1, $attempts), $log),
            $this->store,
            (string) $this->config('work_dir'),
            $log,
        );
    }

    public function director(string $dir, ?string $styleKey = null, ?string $driver = null, ?callable $log = null): AssetDirector
    {
        $style = $this->style($styleKey);

        return new AssetDirector($this->images($driver, $style), $style, null, $dir, 1, $log);
    }
}
