<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;

/**
 * Design several blueprints from the same request and keep the one the critic likes best.
 *
 * Language models write a different mission each time they are asked; one of three is usually
 * clearly better than the others. This pays for N designs (each with its own corrections until it
 * validates) and N reviews, so it costs roughly N times the design stage, but drawing, which is most
 * of a run's cost, is still paid once.
 *
 * Every candidate is kept in the work folder (candidates/1.json, 2.json...) with its review
 * (candidates/1.review.json), so you can read the ones that lost too, and the trace shows each
 * candidate's design calls in order.
 *
 * Settings (method_options.best-of): candidates (default 3).
 */
final class BestOfDesignStep extends DesignStep
{
    protected function design(GenerationRun $run): array
    {
        $n = max(1, (int) $run->method->setting('candidates', 3));
        @mkdir("$run->dir/candidates", 0775, true);
        $best = null;
        $summary = [];
        for ($i = 1; $i <= $n; $i++) {
            $run->say("Candidate $i of $n");
            // Each candidate is a whole design: first draft, then corrections until it validates.
            $candidate = parent::design($run);
            file_put_contents("$run->dir/candidates/$i.json", json_encode($candidate, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            if ($run->isStory()) {
                // The critic reads missions; for a story, the first that validates is kept.
                return $candidate;
            }
            // Scores only: its suggested changes are not wanted here (the critic method applies them).
            $review = $run->method->critic()->review($candidate, $run->prompt, $run->alignment, $run->options, withChanges: false);
            file_put_contents("$run->dir/candidates/$i.review.json", json_encode($review, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
            $summary[] = ['candidate' => $i, 'title' => $candidate['title'] ?? null, 'score' => $review['score'], 'scores' => $review['scores']];
            $run->say(sprintf('  "%s": %.1f/10', $candidate['title'] ?? '?', $review['score']));
            $run->note("candidate $i", ['title' => $candidate['title'] ?? null] + $review);
            if (! $best || $review['score'] > $best['score']) {
                $best = ['n' => $i, 'score' => $review['score'], 'blueprint' => $candidate];
            }
        }
        $run->say(sprintf('Keeping candidate %d, "%s" (%.1f/10)', $best['n'], $best['blueprint']['title'] ?? '?', $best['score']));
        $run->output('candidates', ['kept' => $best['n'], 'all' => $summary]);

        return $best['blueprint'];
    }
}
