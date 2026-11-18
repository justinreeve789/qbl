<?php

namespace App\Qbl\Generation\Art\Providers;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;

/**
 * Google's Gemini image models ("Nano Banana"), through generateContent. They take up to 14 reference
 * pictures with a prompt, which is what the style anchors and character sheets rely on. They cannot
 * draw transparent backgrounds, so cut-outs are drawn on the style's chroma colour.
 */
class GeminiImageGenerator implements ImageGenerator
{
    private const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $model = 'gemini-3-pro-image',
        private string $baseUrl = 'https://generativelanguage.googleapis.com/v1beta',
        private string $size = '2K',
    ) {
        if ($this->apiKey === '') {
            throw new GenerationError('GEMINI_API_KEY is not set.');
        }
    }

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        $parts = [['text' => $prompt]];
        foreach (array_slice($references, 0, 14) as $ref) {
            $parts[] = ['inline_data' => ['mime_type' => $ref->mime, 'data' => base64_encode($ref->bytes)]];
        }
        $response = $this->http->send('POST', rtrim($this->baseUrl, '/')."/models/{$this->model}:generateContent", ['x-goog-api-key' => $this->apiKey], [
            'contents' => [['role' => 'user', 'parts' => $parts]],
            'generationConfig' => [
                'responseModalities' => ['IMAGE'],
                'imageConfig' => ['aspectRatio' => in_array($aspect, self::ASPECTS, true) ? $aspect : '16:9', 'imageSize' => $this->size],
            ],
        ], timeout: 300);
        $data = $response->json();
        if (! $response->ok()) {
            $message = (string) ($data['error']['message'] ?? $response->body);
            if (str_contains($message, 'free_tier') && str_contains($message, 'limit: 0')) {
                throw new GenerationError("Gemini's image models are not part of the free tier, and this key's project is on it. Turn on billing for the key's project in Google AI Studio (aistudio.google.com, API keys > Set up billing), then try again.");
            }
            throw new GenerationError('Gemini refused: '.mb_substr($message, 0, 600));
        }
        foreach ($data['candidates'][0]['content']['parts'] ?? [] as $part) {
            $inline = $part['inlineData'] ?? $part['inline_data'] ?? null;
            if (isset($inline['data'])) {
                return base64_decode($inline['data']);
            }
        }
        $reason = $data['candidates'][0]['finishReason'] ?? ($data['promptFeedback']['blockReason'] ?? 'no image in the answer');
        throw new GenerationError("Gemini drew nothing ($reason).");
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return "gemini:{$this->model}";
    }
}
