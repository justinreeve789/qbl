<?php

namespace App\Qbl\Generation\Pipeline;

use App\Qbl\Generation\Llm\LanguageModel;

/**
 * Wraps a language model so every call it answers is written to the run's trace: the system prompt,
 * the user turn (with its pictures), the JSON schema the answer must follow, the answer, and how long
 * it took. It changes nothing about the call itself: the wrapped model still counts its spend, and
 * an error is recorded and then thrown on, untouched.
 *
 * $job says what the model is used for in this method ("align", "design", "judge", "critic", ...),
 * so two calls of the same model for different jobs can be told apart in the trace.
 */
final class TracingLanguageModel implements LanguageModel
{
    public function __construct(private LanguageModel $inner, private Tracer $tracer, private string $job, private string $model = '') {}

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $started = microtime(true);
        try {
            $answer = $this->inner->structured($system, $content, $name, $schema, $maxTokens);
        } catch (\Throwable $e) {
            $this->tracer->llm($this->job, $this->model, $system, $content, $name, $schema, $maxTokens, null, microtime(true) - $started, $e->getMessage());
            throw $e;
        }
        $this->tracer->llm($this->job, $this->model, $system, $content, $name, $schema, $maxTokens, $answer, microtime(true) - $started, null);

        return $answer;
    }

    /** The model inside, for code that needs to know what it really is. */
    public function inner(): LanguageModel
    {
        return $this->inner;
    }
}
