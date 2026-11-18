<?php

namespace App\Qbl\Generation\Art\Providers;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;

/**
 * OpenAI's GPT Image models. With reference pictures the request goes to /images/edits (up to 16
 * pictures, sent as data URLs); without, to /images/generations. It can draw transparent backgrounds.
 */
class OpenAiImageGenerator implements ImageGenerator
{
    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $model = 'gpt-image-2',
        private string $quality = 'high',
        private string $baseUrl = 'https://api.openai.com/v1',
    ) {
        if ($this->apiKey === '') {
            throw new GenerationError('OPENAI_API_KEY is not set.');
        }
    }

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        [$w, $h] = array_map('intval', explode(':', $aspect.':1'));
        $size = $w > $h ? '1536x1024' : ($w < $h ? '1024x1536' : '1024x1024');
        $body = ['model' => $this->model, 'prompt' => $prompt, 'size' => $size, 'quality' => $this->quality, 'n' => 1, 'output_format' => 'png'];
        if ($transparent) {
            $body['background'] = 'transparent';
        }
        if ($references) {
            $body['images'] = array_map(fn ($r) => ['image_url' => 'data:'.$r->mime.';base64,'.base64_encode($r->bytes)], array_slice($references, 0, 16));
            // The first picture is kept most faithfully: put the character sheet first when there is one.
            if (! str_starts_with($this->model, 'gpt-image-2')) {
                $body['input_fidelity'] = 'high';
            }
        }
        $response = $this->http->send('POST', rtrim($this->baseUrl, '/').($references ? '/images/edits' : '/images/generations'), ['Authorization' => "Bearer {$this->apiKey}"], $body, timeout: 300);
        $data = $response->json();
        if (! $response->ok()) {
            throw new GenerationError('OpenAI refused: '.($data['error']['message'] ?? $response->body));
        }
        $b64 = $data['data'][0]['b64_json'] ?? null;
        if (! $b64) {
            throw new GenerationError('OpenAI drew nothing.');
        }

        return base64_decode($b64);
    }

    public function transparency(): bool
    {
        return true;
    }

    public function describe(): string
    {
        return "openai:{$this->model}";
    }
}
