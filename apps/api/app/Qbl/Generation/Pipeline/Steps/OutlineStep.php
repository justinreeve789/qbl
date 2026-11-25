<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Design\DesignRules;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Before the design: sketch the mission as a short outline (premise, hook, scenes, puzzles, twist,
 * finale), then hand that outline to the designer as part of its brief.
 *
 * Why try it: the blueprint is a very large, very detailed answer. Asked for it in one go, the model
 * spends its attention on getting hundreds of fields right, and the story can come out flat. Deciding
 * the story first, in a small answer about nothing but the story, and then the details, is how people
 * write too. It also gives a short, readable thing to compare between runs (outline.json).
 *
 * The outline is a separate job ('outline'), so a method can give it a different model from the
 * design: a cheaper one for the sketch, or a stronger one for the story and a cheaper one to fill it in.
 *
 * In:  $run->prompt, $run->alignment
 * Out: $run->data['outline'], and a note for the designer in $run->designNotes
 */
final class OutlineStep extends Step
{
    public function name(): string
    {
        return 'outline';
    }

    public function stage(): string
    {
        return 'designing';
    }

    public function run(GenerationRun $run): void
    {
        $file = "$run->dir/outline.json";
        if (is_file($file)) {
            $outline = json_decode((string) file_get_contents($file), true);
            $run->skip('outlined in an earlier session (outline.json)');
        } else {
            $run->stage('designing');
            $run->say('Outlining the story');
            $run->progress->fraction(0.02, 'Sketching the story before the details');
            $outline = $run->method->model('outline')->structured(self::SYSTEM, [
                "The teacher asked for: $run->prompt",
                'Grade: '.($run->options['grade'] ?? 'not given').'. Players together: '.($run->options['min_players'] ?? 2).'-'.($run->options['max_players'] ?? 6).'. '
                    .(isset($run->options['scenes']) ? "Scenes: {$run->options['scenes']}. " : '').(isset($run->options['minutes']) ? "About {$run->options['minutes']} minutes. " : ''),
                "Learning objectives:\n".implode("\n", array_map(fn ($o) => "- {$o['id']}: {$o['text']}", $run->alignment['learning_objectives'] ?? [])),
                "Misconceptions to confront:\n- ".implode("\n- ", $run->alignment['misconceptions'] ?? ['(none given)']),
                ...(! empty($run->options['notes']) ? ["The teacher's notes: {$run->options['notes']}"] : []),
                "How the mission should lean:\n- ".implode("\n- ", DesignRules::briefLines($run->designOptions())),
            ], 'mission_outline', self::SCHEMA, 4000);
            file_put_contents($file, json_encode($outline, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $run->say('  "'.($outline['title'] ?? '?').'": '.count($outline['scenes'] ?? []).' scenes, '.count($outline['puzzles'] ?? []).' puzzles');
        }
        $run->data['outline'] = $outline;
        // How the outline reaches the designer: as notes in its brief (see GenerationRun::designOptions).
        $run->designNotes[] = "Build the mission from this outline. Keep its story, scenes, puzzles, twist and ending; change details only where the blueprint's rules need it.\n".self::describe($outline);
        $run->output('outline', $outline);
    }

    public function forget(GenerationRun $run): void
    {
        @unlink("$run->dir/outline.json");
    }

    /** The outline as text for the designer's brief. */
    public static function describe(array $o): string
    {
        $lines = ['Title: '.($o['title'] ?? ''), 'Premise: '.($o['premise'] ?? ''), 'Hook (first minute): '.($o['hook'] ?? ''), 'Scenes:'];
        foreach ($o['scenes'] ?? [] as $i => $s) {
            $lines[] = '  '.($i + 1).". {$s['title']}: {$s['what_happens']} (learning: {$s['learning']})";
        }
        $lines[] = 'Puzzles:';
        foreach ($o['puzzles'] ?? [] as $p) {
            $lines[] = "  - {$p['what']} Needs: {$p['needs']}. Teaches: {$p['teaches']}.";
        }
        $lines[] = 'Twist: '.($o['twist'] ?? '');
        $lines[] = 'Misconception moment: '.($o['misconception_moment'] ?? '');
        $lines[] = 'Finale: '.($o['finale'] ?? '');

        return implode("\n", $lines);
    }

    private const SYSTEM = <<<'TXT'
    You outline missions for QBL, a game in which children walk around 2D cartoon scenes, talk to
    characters, collect and combine things in a bag, solve point-and-click puzzles, and answer questions,
    to learn something from their curriculum. Outline the story only, not its details: a premise with a
    problem the players care about; a hook that grabs them in the first minute; 3 to 6 scenes, each with
    what happens there and what is learned; 2 to 4 puzzles that can only be solved by using the idea being
    taught (not by reading about it); one twist that raises the stakes; a moment where a common
    misconception is tried and seen to fail; and a finale where the players' understanding saves the day.
    Keep it playful, concrete and right for the grade.
    TXT;

    private const SCHEMA = [
        'type' => 'object',
        'required' => ['title', 'premise', 'hook', 'scenes', 'puzzles', 'twist', 'misconception_moment', 'finale'],
        'properties' => [
            'title' => ['type' => 'string'],
            'premise' => ['type' => 'string'],
            'hook' => ['type' => 'string'],
            'scenes' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 8, 'items' => [
                'type' => 'object', 'required' => ['title', 'what_happens', 'learning'],
                'properties' => ['title' => ['type' => 'string'], 'what_happens' => ['type' => 'string'], 'learning' => ['type' => 'string']],
            ]],
            'puzzles' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => [
                'type' => 'object', 'required' => ['what', 'needs', 'teaches'],
                'properties' => ['what' => ['type' => 'string'], 'needs' => ['type' => 'string'], 'teaches' => ['type' => 'string']],
            ]],
            'twist' => ['type' => 'string'],
            'misconception_moment' => ['type' => 'string'],
            'finale' => ['type' => 'string'],
        ],
    ];
}
