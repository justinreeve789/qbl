<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\Llm\LanguageModel;

/**
 * Reads a mission blueprint the way an experienced teacher and game designer would, and scores it.
 *
 * The blueprint validator only knows whether a mission CAN be built and played; it cannot tell whether
 * it is any good. The critic is the other half: does it teach what it says it teaches, is it fun, will
 * a child of that age follow it? It answers with scores, what works, what does not, and (if asked)
 * concrete changes in the designer's change format (MissionDesigner::CHANGES_SCHEMA), so its advice can
 * be applied without rewriting the blueprint.
 *
 * Used by the "critic" method (review, apply, review again) and "best-of" (score several candidates,
 * keep the best). Its answers are in the trace as calls/NNNN-llm-critic-blueprint_review.json.
 */
class BlueprintCritic
{
    /** What it scores, out of 10 each. The overall score is their mean. */
    public const CRITERIA = [
        'learning' => 'Students who finish will have met the learning objectives: they must use the idea to progress, not just read about it. Misconceptions are confronted.',
        'fun' => 'There is a hook in the first minute, puzzles that make you think, surprises, characters with personality, a satisfying ending.',
        'clarity' => 'A child of this grade always knows what to do next, can read every line, and is never stuck without a hint.',
        'fit' => 'Right for the grade and the teacher\'s request: vocabulary, length, difficulty, tone.',
        'coherence' => 'The story, places, characters and puzzles make sense together; things are where they would be; nothing is there for no reason.',
    ];

    public function __construct(private LanguageModel $llm) {}

    /**
     * @param  array  $alignment  StandardsAligner::align(): objectives, vocabulary, misconceptions
     * @param  bool  $withChanges  also ask for changes that would raise the scores
     * @return array{score: float, scores: array<string, float>, strengths: string[], problems: string[], changes: array}
     */
    public function review(array $blueprint, string $prompt, array $alignment, array $options = [], bool $withChanges = true): array
    {
        $criteria = implode("\n", array_map(fn ($k, $v) => "- $k: $v", array_keys(self::CRITERIA), self::CRITERIA));
        $system = <<<TXT
        You review mission blueprints for QBL, a game in which children walk around 2D cartoon scenes,
        talk to characters, collect and combine things, solve point-and-click puzzles and answer
        questions, to learn something from their curriculum. You are an experienced classroom teacher and
        a game designer. A program has already checked that the blueprint can be built and played to the
        end; your job is whether it is GOOD. Be honest and specific: a 7 is a mission a teacher would
        happily use; 9 is outstanding. Score each criterion from 0 to 10:
        $criteria
        TXT;
        if ($withChanges) {
            $system .= "\n\n".<<<'TXT'
            Then give the changes that would raise the scores most: at most 12, fewest that matter most
            (better dialogue, a clearer hint, a question that makes them use the idea, a puzzle that teaches).
            Each change is {op, path, value} on the blueprint as given: lists of things with keys are addressed
            by key ("interactions.q_pollen.question.text"), other lists by position. Keep the blueprint
            buildable: do not remove or rename anything other parts refer to, and keep every field's type.
            No changes if it is already excellent.
            TXT;
        }
        $content = [
            "The teacher asked for: $prompt",
            'Grade: '.($options['grade'] ?? 'not given').'. Subject: '.($options['subject'] ?? 'not given').'.',
            "Learning objectives:\n".implode("\n", array_map(fn ($o) => "- {$o['id']}: {$o['text']}", $alignment['learning_objectives'] ?? [])),
            "Misconceptions to confront:\n- ".implode("\n- ", $alignment['misconceptions'] ?? ['(none given)']),
            "The blueprint:\n".json_encode($blueprint, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ];
        $schema = [
            'type' => 'object',
            'required' => ['scores', 'strengths', 'problems', ...($withChanges ? ['changes'] : [])],
            'properties' => [
                'scores' => ['type' => 'object', 'required' => array_keys(self::CRITERIA), 'properties' => array_fill_keys(array_keys(self::CRITERIA), ['type' => 'number', 'minimum' => 0, 'maximum' => 10])],
                'strengths' => ['type' => 'array', 'items' => ['type' => 'string'], 'maxItems' => 4],
                'problems' => ['type' => 'array', 'items' => ['type' => 'string'], 'maxItems' => 8],
            ] + ($withChanges ? ['changes' => ['type' => 'array', 'maxItems' => 12, 'items' => MissionDesigner::CHANGES_SCHEMA['properties']['changes']['items']]] : []),
        ];

        $answer = $this->llm->structured($system, $content, 'blueprint_review', $schema, 8000);
        $scores = array_map('floatval', array_intersect_key((array) ($answer['scores'] ?? []), self::CRITERIA));

        return [
            'score' => $scores ? round(array_sum($scores) / count($scores), 2) : 0.0,
            'scores' => $scores,
            'strengths' => array_values((array) ($answer['strengths'] ?? [])),
            'problems' => array_values((array) ($answer['problems'] ?? [])),
            'changes' => $withChanges ? array_values((array) ($answer['changes'] ?? [])) : [],
        ];
    }
}
