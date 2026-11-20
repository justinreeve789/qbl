<?php

namespace App\Qbl\Generation\Llm;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Spend;

/**
 * Claude, through the Messages API, with structured outputs: the answer's schema goes in
 * output_config.format and the answer comes back as JSON in the text block, guaranteed to match.
 * (Current models do not allow forcing a tool call.) A schema too large for the API to compile into a
 * strict grammar (the mission blueprint) is offered as a tool instead, which the model is told to
 * call; that is not enforced, so its callers validate the answer, as they do anyway.
 *
 * Structured outputs accept only part of JSON Schema. Like Anthropic's own SDK helpers, this class
 * strips what is not accepted (lengths, numeric bounds, item counts, patterns), writes it into the
 * field's description instead so the model still sees it, and sets additionalProperties to false.
 * The callers check the answers themselves (BlueprintValidator and the rest).
 *
 * Costs: the system prompt is marked for prompt caching, and so is any part of the user turn followed by
 * ['cache' => true] (what stays the same across calls goes first: the style anchors for the judge, the
 * brief for the designer's corrections), so repeated calls read it from the cache at a twentieth of the
 * price. Every call's token usage is reported to the run's Spend.
 */
class AnthropicModel implements LanguageModel
{
    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $model = 'claude-sonnet-5-5',
        private string $baseUrl = 'https://api.anthropic.com',
        private ?Spend $spend = null,
    ) {
        if ($this->apiKey === '') {
            throw new GenerationError('ANTHROPIC_API_KEY is not set.');
        }
    }

    /** Schemas the API would not compile into a strict grammar (too large); they go by the tool route. */
    private static array $tooLarge = [];

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $parts = self::parts($content);
        $cachedSystem = [['type' => 'text', 'text' => $system, 'cache_control' => ['type' => 'ephemeral']]];
        if (! isset(self::$tooLarge[$name])) {
            [$status, $data] = $this->call($name, [
                'model' => $this->model, 'max_tokens' => $maxTokens, 'system' => $cachedSystem,
                'messages' => [['role' => 'user', 'content' => $parts]],
                'output_config' => ['format' => ['type' => 'json_schema', 'schema' => self::supported($schema)]],
            ]);
            $message = (string) ($data['error']['message'] ?? '');
            if ($status === 400 && preg_match('/grammar|too many|too large/i', $message)) {
                self::$tooLarge[$name] = true; // and fall through to the tool route below
            } else {
                if ($status < 200 || $status >= 300) {
                    throw new GenerationError('The language model refused: '.($message ?: json_encode($data)));
                }
                $this->checkStop($data, $name, $maxTokens);
                $text = '';
                foreach ($data['content'] ?? [] as $block) {
                    if (($block['type'] ?? '') === 'text') {
                        $text .= $block['text'];
                    }
                }
                $answer = json_decode($text, true);
                if (! is_array($answer)) {
                    throw new GenerationError("The language model's $name was not JSON: ".mb_substr($text, 0, 200));
                }

                return self::withoutNulls($answer);
            }
        }

        // The tool route, for schemas too large for a strict grammar: the schema is offered as a tool the
        // model is told to call. Not enforced token by token, so callers validate (they all do).
        $request = [
            'model' => $this->model, 'max_tokens' => $maxTokens,
            'system' => [['type' => 'text', 'text' => $system."\n\nGive your whole answer by calling the $name tool once, with input that follows its schema exactly. Do not answer in text.", 'cache_control' => ['type' => 'ephemeral']]],
            'tools' => [['name' => $name, 'description' => 'Give the answer by calling this tool. Its input is the whole answer.', 'input_schema' => $schema]],
            'tool_choice' => ['type' => 'auto'],
            'messages' => [['role' => 'user', 'content' => $parts]],
        ];
        for ($try = 1; $try <= 2; $try++) {
            [$status, $data] = $this->call($name, $request);
            if ($status < 200 || $status >= 300) {
                throw new GenerationError('The language model refused: '.($data['error']['message'] ?? json_encode($data)));
            }
            $this->checkStop($data, $name, $maxTokens);
            foreach ($data['content'] ?? [] as $block) {
                if (($block['type'] ?? '') === 'tool_use' && ($block['name'] ?? '') === $name && is_array($block['input'] ?? null)) {
                    return $block['input'];
                }
            }
            // Answered in text instead: ask once more, plainly.
            $request['messages'][] = ['role' => 'assistant', 'content' => $data['content'] ?? [['type' => 'text', 'text' => '...']]];
            $request['messages'][] = ['role' => 'user', 'content' => [['type' => 'text', 'text' => "Now give the answer by calling the $name tool."]]];
        }
        throw new GenerationError("The language model did not answer with $name.");
    }

    /**
     * The user turn as content blocks. ['cache' => true] after a part marks everything up to it for
     * prompt caching (at most three marks; the system prompt has the fourth).
     */
    public static function parts(array $content): array
    {
        $parts = [];
        $marks = 0;
        foreach ($content as $item) {
            if (is_string($item)) {
                $parts[] = ['type' => 'text', 'text' => $item];
            } elseif (isset($item['image'])) {
                $parts[] = ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $item['mime'] ?? 'image/png', 'data' => base64_encode($item['image'])]];
            } elseif (! empty($item['cache']) && $parts && $marks < 3) {
                $parts[array_key_last($parts)]['cache_control'] = ['type' => 'ephemeral'];
                $marks++;
            }
        }

        return $parts;
    }

    /** @return array{int, array} */
    private function call(string $purpose, array $body): array
    {
        $response = $this->http->send('POST', rtrim($this->baseUrl, '/').'/v1/messages', [
            'x-api-key' => $this->apiKey,
            'anthropic-version' => '2023-06-01',
        ], $body, timeout: 900);
        $data = $response->json();
        if ($this->spend && is_array($data['usage'] ?? null)) {
            $this->spend->llm($this->model, $purpose, $data['usage']);
        }

        return [$response->status, $data];
    }

    private function checkStop(array $data, string $name, int $maxTokens): void
    {
        $stop = $data['stop_reason'] ?? '';
        if ($stop === 'max_tokens') {
            throw new GenerationError("The language model ran out of room while writing $name; it needs more than $maxTokens tokens.");
        }
        if ($stop === 'refusal') {
            throw new GenerationError("The language model declined to write $name.");
        }
    }

    /** Fields that came back null were optional and left out: remove them. */
    private static function withoutNulls(array $value): array
    {
        $list = array_is_list($value);
        foreach ($value as $k => $v) {
            if ($v === null && ! $list) {
                unset($value[$k]);
            } elseif (is_array($v)) {
                $value[$k] = self::withoutNulls($v);
            }
        }

        return $value;
    }

    private const UNSUPPORTED = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'maxItems', 'pattern', 'uniqueItems', 'minProperties', 'maxProperties'];

    /** The schema with what structured outputs do not accept moved into descriptions. */
    public static function supported(array $schema): array
    {
        $notes = [];
        foreach (self::UNSUPPORTED as $key) {
            if (array_key_exists($key, $schema)) {
                $notes[] = "$key: ".json_encode($schema[$key], JSON_UNESCAPED_SLASHES);
                unset($schema[$key]);
            }
        }
        if (isset($schema['minItems']) && $schema['minItems'] > 1) {
            $notes[] = "minItems: {$schema['minItems']}";
            $schema['minItems'] = 1;
        }
        if ($notes) {
            $schema['description'] = trim(($schema['description'] ?? '').' ('.implode(', ', $notes).')');
        }
        if (($schema['type'] ?? null) === 'object') {
            $schema['additionalProperties'] = false;
            // Structured outputs allow only a few optional fields (24) and fewer nullable ones (16) in a
            // whole schema. So every field is required: an optional object may be null (structured()
            // drops the nulls, so callers see it absent), and an optional value is given empty
            // ("", [], false, 0), which the callers already treat as absent.
            $required = $schema['required'] ?? [];
            foreach ($schema['properties'] ?? [] as $k => $p) {
                $p = self::supported($p);
                if (! in_array($k, $required, true)) {
                    if (($p['type'] ?? null) === 'object') {
                        $p = ['anyOf' => [$p, ['type' => 'null']]] + (isset($p['description']) ? ['description' => $p['description'].' (null if not needed)'] : ['description' => 'null if not needed']);
                    } else {
                        $empty = match ($p['type'] ?? null) {
                            'string' => isset($p['enum']) ? 'any of the values' : '""', 'array' => '[]', 'boolean' => 'false', 'integer', 'number' => '0', default => 'empty',
                        };
                        $p['description'] = trim(($p['description'] ?? '').' (Optional: give '.$empty.' if not needed.)');
                    }
                }
                $schema['properties'][$k] = $p;
            }
            if (! empty($schema['properties'])) {
                $schema['required'] = array_keys($schema['properties']);
            }
            if (isset($schema['properties']) && $schema['properties'] === []) {
                $schema['properties'] = new \stdClass;
            }
        }
        if (isset($schema['items']) && is_array($schema['items'])) {
            $schema['items'] = self::supported($schema['items']);
        }

        return $schema;
    }
}
