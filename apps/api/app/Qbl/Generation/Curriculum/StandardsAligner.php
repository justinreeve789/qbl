<?php

namespace App\Qbl\Generation\Curriculum;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Llm\LanguageModel;

/**
 * Decides which curriculum standards a mission teaches, before the mission is written, so the
 * mission is designed around them rather than labelled afterwards.
 *
 * The model can only choose standards that are in the curriculum_standards table: the codes it may
 * answer with are an enum in the answer's schema, built from the candidates. It never invents a code.
 * It also writes the measurable learning objectives the mission designer must cover.
 */
class StandardsAligner
{
    public function __construct(private StandardsStore $store, private LanguageModel $llm) {}

    /**
     * @param  array{grade?: ?string, subject?: ?string, frameworks?: string[], standards?: string[]}  $options
     * @return array{standards: array, learning_objectives: array, vocabulary: array, misconceptions: array, warnings: string[]}
     */
    public function align(string $prompt, array $options): array
    {
        $frameworks = array_values(array_filter((array) ($options['frameworks'] ?? [])));
        $grade = $options['grade'] ?? null;
        $warnings = [];

        if (! empty($options['standards'])) {
            // The teacher named them: use exactly those, and say so if any is not known.
            $candidates = $this->store->byCodes($options['standards'], $frameworks);
            $found = array_map(fn ($c) => strtolower((string) $c['code']), $candidates);
            $missing = array_filter($options['standards'], fn ($c) => ! in_array(strtolower(trim($c)), $found, true));
            if ($missing) {
                throw new GenerationError('These standards are not in the curriculum_standards table: '.implode(', ', $missing).'. Import them first with `php artisan qbl:standards`.');
            }
            $required = true;
        } else {
            $candidates = $this->store->candidates($frameworks, $grade, $prompt.' '.($options['subject'] ?? ''));
            $required = false;
            if (! $candidates) {
                $warnings[] = 'No standards are imported for '.($frameworks ? implode(', ', $frameworks) : 'any framework').($grade ? " at grade $grade" : '').'; the mission has learning objectives but is not aligned to standards. Run `php artisan qbl:standards` to import some.';
            }
        }

        $byCode = [];
        foreach ($candidates as $c) {
            $byCode[$c['code']] ??= $c;
        }
        $codes = array_keys($byCode);

        $list = '';
        foreach ($byCode as $code => $c) {
            $context = ! empty($c['parent_description']) ? ' (under: '.self::short($c['parent_description'], 160).')' : '';
            $list .= "- [$code] ".self::short($c['description'], 400).$context."\n";
        }

        $system = <<<'TXT'
        You are a curriculum specialist aligning an educational game mission to academic standards, before the
        mission is written. Choose only standards the mission can genuinely teach AND give evidence of through
        play: choices, questions, experiments, observations and explanations inside a 2D walk-around game where
        a small group of students explore scenes, talk to characters and collect and test things.
        Prefer 1 to 3 primary standards the whole mission is built around, plus at most 3 supporting ones.
        Do not choose a standard just because it shares a word with the request. If none fits, choose none.
        Then write measurable learning objectives ("Students will be able to ...", one observable verb each)
        that the mission must cover, each tied to the standards it serves; key vocabulary with kid-friendly
        definitions at the grade level; and common misconceptions the mission should surface and correct.
        TXT;

        $user = "Mission request: $prompt\n"
            .($grade ? "Grade: $grade\n" : '')
            .(! empty($options['subject']) ? "Subject: {$options['subject']}\n" : '')
            .($codes ? ($required ? "The teacher requires ALL of these standards; mark each primary or supporting:\n" : "Candidate standards (choose from these only):\n").$list : "No standards are available; give learning objectives only and leave standards empty.\n");

        $codeSchema = $codes ? ['type' => 'string', 'enum' => $codes] : ['type' => 'string'];
        $schema = [
            'type' => 'object',
            'required' => ['standards', 'learning_objectives', 'vocabulary', 'misconceptions'],
            'properties' => [
                'standards' => ['type' => 'array', 'maxItems' => $codes ? max(6, count($codes) * ($required ? 1 : 0)) : 0, 'items' => [
                    'type' => 'object', 'required' => ['code', 'alignment', 'rationale'],
                    'properties' => [
                        'code' => $codeSchema,
                        'alignment' => ['type' => 'string', 'enum' => ['primary', 'supporting']],
                        'rationale' => ['type' => 'string', 'description' => 'One or two sentences: what in the mission addresses it.'],
                    ],
                ]],
                'learning_objectives' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 6, 'items' => [
                    'type' => 'object', 'required' => ['id', 'text', 'standards'],
                    'properties' => [
                        'id' => ['type' => 'string', 'description' => 'LO1, LO2, ...'],
                        'text' => ['type' => 'string'],
                        'standards' => ['type' => 'array', 'items' => $codeSchema],
                    ],
                ]],
                'vocabulary' => ['type' => 'array', 'maxItems' => 10, 'items' => ['type' => 'object', 'required' => ['term', 'definition'], 'properties' => ['term' => ['type' => 'string'], 'definition' => ['type' => 'string']]]],
                'misconceptions' => ['type' => 'array', 'maxItems' => 5, 'items' => ['type' => 'string']],
            ],
        ];

        $answer = $this->llm->structured($system, [$user], 'curriculum_alignment', $schema, 6000);

        $standards = [];
        foreach ($answer['standards'] ?? [] as $s) {
            $c = $byCode[$s['code'] ?? ''] ?? null;
            if ($c === null) {
                $warnings[] = "Ignored a standard that was not offered: {$s['code']}";

                continue; // belt and braces: the enum should already prevent this
            }
            $standards[$c['code']] = [
                'standard_id' => (int) $c['id'], 'framework' => $c['framework'], 'code' => $c['code'], 'description' => $c['description'],
                'alignment' => ($s['alignment'] ?? 'primary') === 'supporting' ? 'supporting' : 'primary', 'rationale' => (string) ($s['rationale'] ?? ''),
            ];
        }
        if ($required) {
            foreach ($byCode as $code => $c) {
                $standards[$code] ??= ['standard_id' => (int) $c['id'], 'framework' => $c['framework'], 'code' => $code, 'description' => $c['description'], 'alignment' => 'primary', 'rationale' => 'Required by the request.'];
            }
        }
        $objectives = [];
        foreach ($answer['learning_objectives'] ?? [] as $i => $lo) {
            $objectives[] = [
                'id' => preg_match('/^LO\d+$/', (string) ($lo['id'] ?? '')) ? $lo['id'] : 'LO'.($i + 1),
                'text' => trim((string) $lo['text']),
                'standards' => array_values(array_filter((array) ($lo['standards'] ?? []), fn ($code) => isset($standards[$code]))),
            ];
        }
        if (! $objectives) {
            throw new GenerationError('The alignment came back without learning objectives.');
        }

        return [
            'standards' => array_values($standards),
            'learning_objectives' => $objectives,
            'vocabulary' => array_values($answer['vocabulary'] ?? []),
            'misconceptions' => array_values($answer['misconceptions'] ?? []),
            'warnings' => $warnings,
        ];
    }

    private static function short(string $text, int $max): string
    {
        $text = preg_replace('/\s+/', ' ', trim($text));

        return mb_strlen($text) > $max ? mb_substr($text, 0, $max - 1).'…' : $text;
    }
}
