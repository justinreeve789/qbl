<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * After the design: have a critic (BlueprintCritic: a teacher and game designer) review the blueprint
 * and suggest changes, apply them, and review again, for a few rounds or until it scores well enough.
 *
 *   round 1: review → score 6.4, 9 changes → apply → validate → keep
 *   round 2: review → score 7.8, 3 changes → apply → validate → would break the mission: discard
 *   round 3: (not reached: out of rounds)
 *
 * The validator has the last word: changes that would make the mission unbuildable or unplayable are
 * thrown away whole, and the blueprint stays as it was. So this step can only ever make a blueprint
 * that already passes better, never break it.
 *
 * Every review is in the trace (calls/*-llm-critic-blueprint_review.json, and a note per round with
 * what happened to its changes); the reviews are also kept in critique.json in the work folder, which
 * is how a resumed run knows this step is done.
 *
 * Settings (method_options.<method>): rounds (default 2), pass (stop when the score reaches it, default 8).
 * Stories are not reviewed (the critic is written for missions).
 */
final class CritiqueStep extends Step
{
    public function name(): string
    {
        return 'critique';
    }

    public function stage(): string
    {
        return 'designing';
    }

    public function run(GenerationRun $run): void
    {
        if ($run->isStory()) {
            $run->skip('the critic reviews missions, not stories');

            return;
        }
        $file = "$run->dir/critique.json";
        if (is_file($file)) {
            $run->data['critique'] = json_decode((string) file_get_contents($file), true);
            $run->skip('reviewed in an earlier session (critique.json)');

            return;
        }
        $rounds = max(1, (int) $run->method->setting('rounds', 2));
        $pass = (float) $run->method->setting('pass', 8);
        $critic = $run->method->critic();
        $reviews = [];
        $blueprint = $run->blueprint;

        for ($round = 1; $round <= $rounds; $round++) {
            $run->progress->fraction(1, "A teacher's review of the mission (round $round of $rounds)");
            // 1. Review: scores, strengths, problems, and changes in the designer's change format.
            $review = $critic->review($blueprint, $run->prompt, $run->alignment, $run->options);
            $run->say(sprintf('Critic, round %d: %.1f/10 (%s)', $round, $review['score'], implode(', ', array_map(fn ($k, $v) => "$k $v", array_keys($review['scores']), $review['scores']))));
            foreach (array_slice($review['problems'], 0, 3) as $p) {
                $run->say("  - $p");
            }
            $entry = ['round' => $round] + $review + ['applied' => 0, 'outcome' => null];

            // 2. Good enough, or nothing to change: stop here.
            if ($review['score'] >= $pass || ! $review['changes']) {
                $entry['outcome'] = $review['score'] >= $pass ? "passed (at least $pass)" : 'no changes suggested';
                $reviews[] = $entry;
                $run->note('critic round '.$round, $entry);
                break;
            }

            // 3. Apply its changes to a copy, tidy it as the designer would, and check it still builds and plays.
            [$changed, $failed] = MissionDesigner::applyChanges($blueprint, $review['changes']);
            $candidate = isset($blueprint['pace']) ? ['pace' => $blueprint['pace']] + MissionDesigner::tidy($changed) : MissionDesigner::tidy($changed);
            try {
                $problems = BlueprintValidator::errors($candidate, $run->objectiveIds());
            } catch (\TypeError|\ErrorException|\ValueError $e) {
                $problems = ['not the right shape: '.$e->getMessage()];
            }

            // 4. Keep it only if the validator is happy; otherwise the blueprint stays as it was.
            if ($problems) {
                $entry['outcome'] = 'discarded: the changes would break the mission';
                $entry['broke'] = array_slice($problems, 0, 10);
                $run->say("  The critic's changes would break the mission ({$problems[0]}): kept it as it was");
            } else {
                $blueprint = $candidate;
                $entry['applied'] = count($review['changes']) - count($failed);
                $entry['outcome'] = 'applied';
                $run->say("  Applied {$entry['applied']} of ".count($review['changes']).' changes');
            }
            $entry['failed_changes'] = $failed;
            $reviews[] = $entry;
            $run->note('critic round '.$round, $entry);
        }

        $run->blueprint = $blueprint;
        $run->save(['blueprint' => $blueprint]);
        DesignStep::writeBlueprint($run);
        file_put_contents($file, json_encode($reviews, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        $run->data['critique'] = $reviews;
        $run->output('reviews', $reviews);
        $run->output('blueprint', $blueprint);
    }

    public function forget(GenerationRun $run): void
    {
        @unlink("$run->dir/critique.json");
    }
}
