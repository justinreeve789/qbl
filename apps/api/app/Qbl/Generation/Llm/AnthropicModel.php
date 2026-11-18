<?php

namespace App\Qbl\Generation\Llm;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;

/**
 * Claude, through the Messages API. The answer is taken from a tool call the model is required to
 * make, whose input schema is the answer's schema: that is the most reliable way to get well-formed
 * JSON back, and it works with images in the request (the style judge sends pictures).
 */
class AnthropicModel implements LanguageModel
{
    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $model = 'claude-sonnet-5-5',
        private string $baseUrl = 'https://api.anthropic.com',
    ) {
        if ($this->apiKey === '') {
            throw new GenerationError('ANTHROPIC_API_KEY is not set (config qbl_generation.llm.api_key).');
        }
    }

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $parts = [];
        foreach ($content as $item) {
            if (is_string($item)) {
                $parts[] = ['type' => 'text', 'text' => $item];
            } elseif (isset($item['image'])) {
                $parts[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $item['mime'] ?? 'image/png', 'data' => base64_encode($item['image'])]];
            }
        }
        $response = $this->http->send('POST', rtrim($this->baseUrl, '/').'/v1/messages', [
            'x-api-key' => $this->apiKey,
            'anthropic-version' => '2023-06-01',
        ], [
            'model' => $this->model,
            'max_tokens' => $maxTokens,
            'system' => $system,
            'tools' => [['name' => $name, 'description' => 'Give the answer by calling this tool. Its input is the whole answer.', 'input_schema' => $schema]],
            'tool_choice' => ['type' => 'tool', 'name' => $name],
            'messages' => [['role' => 'user', 'content' => $parts]],
        ], timeout: 600);
        $data = $response->json();
        if (! $response->ok()) {
            throw new GenerationError('The language model refused: '.($data['error']['message'] ?? $response->body));
        }
        foreach ($data['content'] ?? [] as $block) {
            if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === $name && is_array($block['input'] ?? null)) {
                if (($data['stop_reason'] ?? '') === 'max_tokens') {
                    throw new GenerationError("The language model ran out of room while writing $name; raise max_tokens or ask for less.");
                }

                return $block['input'];
            }
        }
        throw new GenerationError("The language model did not answer with $name.");
    }
}
