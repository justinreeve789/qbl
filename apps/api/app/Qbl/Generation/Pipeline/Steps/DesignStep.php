<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\StoryPlan;
use App\Qbl\Generation\Design\StoryValidator;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Step 2: design. Write the blueprint: the whole mission as data (story, scenes and how they connect,
 * characters, items, interactions and puzzles, questions, twists, the checklist), but no pictures and
 * no engine rows yet. Everything after this works from the blueprint.
 *
 * How (MissionDesigner):
 *   1. One big structured call: the system prompt (what makes a good QBL adventure), the brief (the
 *      teacher's request, the alignment, the limits) and the JSON schema (BlueprintSchema).
 *   2. tidy(): fill defaults and fix small things the model gets wrong in predictable ways.
 *   3. BlueprintValidator::errors(): over a hundred rules, ending in a simulated playthrough (can every
 *      scene be reached, every puzzle solved, the mission finished?).
 *   4. If anything is wrong, the problems go back to the model, which answers with only the changes
 *      (cheap); after three rounds of changes, one whole rewrite; then it gives up.
 *
 * Every one of those calls is in the trace (calls/NNNN-llm-design-*.json), with the problems it was
 * asked to fix.
 *
 * In:  $run->alignment, $run->designOptions() (the options, plus notes from earlier steps)
 * Out: $run->blueprint (also written to blueprint.json in the work folder)
 */
class DesignStep extends Step
{
    public function name(): string
    {
        return 'design';
    }

    public function stage(): string
    {
        return 'designing';
    }

    public function run(GenerationRun $run): void
    {
        if ($this->reusable($run)) {
            $run->skip('the run already has a blueprint that passes the validator');
        } else {
            $run->stage('designing');
            $run->say('Designing the mission');
            $run->blueprint = $this->design($run);
            $run->save(['blueprint' => $run->blueprint]);
        }
        self::writeBlueprint($run);
        $run->output('blueprint', $run->blueprint);
    }

    /**
     * Write one blueprint. Subclasses that design differently (several candidates, an outline first)
     * override this and keep the rest.
     */
    protected function design(GenerationRun $run): array
    {
        return $run->method->designer()->design(
            $run->prompt,
            $run->alignment,
            $run->designOptions(),
            fn (string $m) => $run->say($m),
            fn (float $f, string $detail) => $run->progress->fraction($f, $detail),
        );
    }

    /** Whether the blueprint the run already has can be used as it is (a resumed run). */
    protected function reusable(GenerationRun $run): bool
    {
        $b = $run->blueprint;
        if (! $b) {
            return false;
        }
        // Designed as the other kind (a mission, and now a story is wanted): design it again.
        if ((($b['format'] ?? 'mission') === 'story') !== $run->isStory()) {
            return false;
        }

        // The validator may have learned new rules since: an old blueprint that breaks one is redesigned.
        return ! ($run->isStory() ? StoryValidator::errors($b) : BlueprintValidator::errors($b, $run->objectiveIds()));
    }

    /** blueprint.json in the work folder, and one line about it in the log. */
    public static function writeBlueprint(GenerationRun $run): void
    {
        $b = $run->blueprint;
        file_put_contents("$run->dir/blueprint.json", json_encode($b, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $run->say($run->isStory() ? StoryPlan::describe($b) : sprintf('"%s": %d scenes, %d characters, %d items, %d interactions (%d with the bag), %d combinations, %d twists',
            $b['title'], count($b['scenes']), count($b['characters']), count($b['items']), count($b['interactions']),
            count(array_filter($b['interactions'], fn ($it) => ($it['type'] ?? '') === 'use')), count($b['combinations'] ?? []), count($b['twists'] ?? [])));
    }

    public function forget(GenerationRun $run): void
    {
        $run->blueprint = null;
        $run->save(['blueprint' => null]);
    }
}
