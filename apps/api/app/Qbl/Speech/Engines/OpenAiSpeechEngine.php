<?php

namespace App\Qbl\Speech\Engines;

use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechError;

/**
 * Any service that speaks OpenAI's POST /v1/audio/speech: OpenAI itself, and the many servers that
 * copy it (Kokoro-FastAPI among them). That endpoint returns only audio, with no word timings, so
 * the game lights the words of these recordings at an even pace.
 *
 * A voice is ['voice' => "coral", 'speed' => 0.25 to 4, 'instructions' => how to speak, for models
 * that take it, such as gpt-4o-mini-tts].
 */
class OpenAiSpeechEngine implements SpeechEngine
{
    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $model = 'gpt-4o-mini-tts',
        private string $url = 'https://api.openai.com',
        private int $timeout = 120,
    ) {
        $this->url = rtrim($this->url, '/');
    }

    /** @param array{url?: string, api_key?: string, model?: string, timeout?: int} $config */
    public static function fromConfig(array $config, ?HttpClient $http = null): self
    {
        return new self($http ?? new CurlHttpClient(1), (string) ($config['api_key'] ?? ''), (string) ($config['model'] ?? 'gpt-4o-mini-tts'), (string) ($config['url'] ?? 'https://api.openai.com'), (int) ($config['timeout'] ?? 120));
    }

    public function name(): string
    {
        return 'openai';
    }

    public function synthesize(string $text, array $voice, ?string $lang = null): Speech
    {
        $body = array_filter([
            'model' => $this->model,
            'input' => $text,
            'voice' => (string) ($voice['voice'] ?? 'alloy'),
            'response_format' => 'mp3',
            'speed' => isset($voice['speed']) ? max(0.25, min(4.0, (float) $voice['speed'])) : null,
            'instructions' => $voice['instructions'] ?? null,
        ], fn ($v) => $v !== null);
        try {
            $response = $this->http->send('POST', $this->url.'/v1/audio/speech', $this->apiKey !== '' ? ['Authorization' => 'Bearer '.$this->apiKey] : [], $body, timeout: $this->timeout);
        } catch (\Throwable $e) {
            throw new SpeechError("The text-to-speech service at {$this->url} cannot be reached: ".$e->getMessage(), 0, $e);
        }
        if (! $response->ok()) {
            throw new SpeechError("The text-to-speech service refused ($response->status): ".mb_substr($response->body, 0, 300));
        }
        if ($response->body === '' || str_starts_with(ltrim($response->body), '{')) {
            throw new SpeechError('The text-to-speech service answered without audio.');
        }

        return new Speech($response->body, 'mp3');
    }

    public function voices(): array
    {
        return [];
    }
}
