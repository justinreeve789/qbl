<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Design\StoryPlan;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Step 3: estimate. Before a single picture is paid for, count what the blueprint needs drawn (one
 * background per scene, a sheet and a walk per character, the props...) and price it at list prices
 * with the method's picture source. A run asked to stop after the design (--design-only) stops here,
 * so the teacher or developer can read the blueprint and the price and decide.
 *
 * Also makes the art director for the run, which the draw step uses: the method decides who draws
 * (GenerationMethod::director()).
 *
 * In:  $run->blueprint
 * Out: $run->director, $run->art, $run->estimate; stops the run as "designed" with stop_after=design
 */
final class EstimateStep extends Step
{
    public function name(): string
    {
        return 'estimate';
    }

    public function stage(): string
    {
        return 'designing';
    }

    public function run(GenerationRun $run): void
    {
        self::prepare($run);
        $estimate = $run->estimate = $run->director->estimate($run->art);
        $run->events?->record($run->id, ['type' => 'estimate', 'stage' => 'designing', 'step' => 'drawing estimate', 'usd' => round((float) $estimate['usd'], 5), 'detail' => ['pictures' => $estimate['pictures']]]);
        $spend = $run->spend;
        $run->say(sprintf('Drawing it will take about %d pictures, about $%.2f%s.', $estimate['pictures'], $estimate['usd'],
            $spend ? sprintf(' (spent so far: $%.2f%s)', $spend->total(), $spend->budget() > 0 ? sprintf(' of a $%.2f budget', $spend->budget()) : '') : ''));
        if ($spend && $spend->budget() > 0 && $spend->total() + $estimate['usd'] > $spend->budget()) {
            $run->warn(sprintf('The estimate ($%.2f with what is spent) is over the budget of $%.2f: some pictures may be kept below the style bar or animations left out. Raise it with --budget=... if you want them all.', $spend->total() + $estimate['usd'], $spend->budget()));
        }
        $run->output('estimate', $estimate);
        if (($run->options['stop_after'] ?? null) === 'design') {
            $run->stage('designed');
            $run->stop('designed');
        }
    }

    /** The director and the blueprint it draws from. Any step that draws calls this first. */
    public static function prepare(GenerationRun $run): void
    {
        $run->director ??= $run->method->director($run->dir);
        // A story's pictures are drawn as a mission's are, from the same blueprint seen as the art director reads one.
        $run->art ??= $run->isStory() ? StoryPlan::forArt($run->blueprint) : $run->blueprint;
    }
}
