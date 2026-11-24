<?php

use App\Qbl\Generation\Llm\LanguageModel;

/** Answers like the language model would, from fixtures. Records what it was asked. */
final class FakeModel implements LanguageModel
{
    public array $calls = [];

    public int $blueprints = 0;

    /** Corrections asked for (as changes). With $badChanges, the changes miss, so the designer must rewrite. */
    public int $corrections = 0;

    public bool $badChanges = false;

    /** Reviews by the critic so far (BlueprintCritic). */
    public int $reviews = 0;

    /** What the critic's changes do: "title" renames the mission (harmless), "break" gives a question two right answers. */
    public string $reviewChanges = 'title';

    public function __construct(private array $blueprint) {}

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $this->calls[] = ['name' => $name, 'content' => $content, 'schema' => $schema];
        switch ($name) {
            case 'curriculum_alignment':
                // Only standards offered as an enum may come back; choose the first offered.
                $codes = $schema['properties']['standards']['items']['properties']['code']['enum'] ?? [];

                return [
                    'standards' => [['code' => 'TEST-3-LS1-1', 'alignment' => 'primary', 'rationale' => 'Students find out what pollination does.'], ['code' => 'NOT-OFFERED', 'alignment' => 'supporting', 'rationale' => 'made up']],
                    'learning_objectives' => [
                        ['id' => 'LO1', 'text' => 'Students will be able to explain why flowers need pollen moved to make fruit.', 'standards' => ['TEST-3-LS1-1']],
                        ['id' => 'LO2', 'text' => 'Students will be able to change one condition of an environment and observe the effect.', 'standards' => in_array('TEST-3-LS2-1', $codes, true) ? ['TEST-3-LS2-1'] : []],
                    ],
                    'vocabulary' => [['term' => 'pollen', 'definition' => 'a yellow powder flowers make']],
                    'misconceptions' => ['Flowers turn into fruit by themselves.'],
                ];
            case 'mission_blueprint':
                $this->blueprints++;
                $b = $this->blueprint;
                if ($this->blueprints === 1) {
                    // A first draft with a mistake the validator must catch: two correct answers.
                    $q = array_search('q_pollen', array_column($b['interactions'], 'key'), true);
                    $b['interactions'][$q]['question']['choices'][0]['correct'] = true;
                }

                return $b;
            case 'blueprint_changes':
                $this->corrections++;

                return ['changes' => $this->badChanges
                    ? [['op' => 'set', 'path' => 'interactions.nowhere.question.choices.0.correct', 'value' => 'false']]
                    : [['op' => 'set', 'path' => 'interactions.q_pollen.question.choices.0.correct', 'value' => 'false']]];
            case 'blueprint_review':
                // The critic: a low score with a change the first time, a passing score after. Asked for scores
                // only (best-of), every second candidate scores higher, so the second is kept.
                $this->reviews++;
                $withChanges = isset($schema['properties']['changes']);
                $score = $withChanges ? ($this->reviews === 1 ? 6 : 9) : ($this->reviews % 2 === 0 ? 8 : 6);
                $change = $this->reviewChanges === 'break'
                    ? ['op' => 'set', 'path' => 'interactions.q_pollen.question.choices.0.correct', 'value' => 'true']
                    : ['op' => 'set', 'path' => 'title', 'value' => '"The Quiet Hive Revisited"'];

                return ['scores' => array_fill_keys(['learning', 'fun', 'clarity', 'fit', 'coherence'], $score), 'strengths' => ['A good hook.'], 'problems' => $score < 8 ? ['The title gives nothing away.'] : []]
                    + ($withChanges ? ['changes' => $score < 8 ? [$change] : []] : []);
            case 'mission_outline':
                return [
                    'title' => 'The Quiet Hive', 'premise' => 'The orchard has flowers but no fruit.', 'hook' => 'A silent hive.',
                    'scenes' => [['title' => 'Orchard', 'what_happens' => 'Find the problem', 'learning' => 'Flowers need pollen moved']],
                    'puzzles' => [['what' => 'Wake the bees', 'needs' => 'warmth', 'teaches' => 'pollinators']],
                    'twist' => 'A storm.', 'misconception_moment' => 'Flowers do not turn into fruit by themselves.', 'finale' => 'Fruit at last.',
                ];
            case 'style_review':
                return ['scores' => array_fill_keys(['line', 'shading', 'colour', 'shapes', 'rendering', 'subject', 'composition'], 8), 'problems' => [], 'fix' => ''];
        }
        throw new RuntimeException("Unexpected request $name");
    }
}
