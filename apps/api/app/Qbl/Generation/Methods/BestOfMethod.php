<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Pipeline\Steps\BestOfDesignStep;

/**
 * Design several missions from the same request, have the critic score each, and draw only the best.
 *
 *   align → DESIGN ×N, keep the best → estimate → draw → build → voice → package → import
 *
 * What it tests: how much a run's quality is luck. The losing candidates are kept in candidates/ with
 * their reviews, which is also a quick way to see the range of what one prompt produces.
 *
 * Costs N designs and N reviews; the pictures are still drawn once.
 *
 * Settings (method_options.best-of): candidates (default 3).
 */
final class BestOfMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'best-of';
    }

    public static function summary(): string
    {
        return 'Design N candidates (default 3), have the critic score them, draw only the best.';
    }

    public function steps(): array
    {
        return self::replace(parent::steps(), 'design', new BestOfDesignStep);
    }
}
