<?php

namespace App\Qbl\Generation\Llm;

/**
 * A language model that answers with structured data. Every call the generator makes is of this
 * kind: it describes the answer as a JSON schema and gets back an array in that shape, so nothing
 * downstream ever parses prose.
 */
interface LanguageModel
{
    /**
     * @param  string  $system  Instructions.
     * @param  array  $content  The user turn: strings, and images as ['image' => bytes, 'mime' => 'image/png'].
     * @param  string  $name  A name for the answer ("mission_blueprint").
     * @param  array  $schema  JSON schema of the answer (an object).
     * @return array The answer, in the schema's shape (not yet validated beyond what the model enforces).
     */
    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array;
}
