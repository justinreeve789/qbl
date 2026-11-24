<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Pipeline\Steps\CritiqueStep;

/**
 * The classic pipeline with a critic after the design: a language model playing an experienced
 * teacher and game designer scores the blueprint (learning, fun, clarity, fit, coherence), suggests
 * changes, and the changes are applied if the mission still validates. Then it reviews again.
 *
 *   align → design → CRITIQUE → estimate → draw → build → voice → package → import
 *
 * What it tests: whether a second reader catches what the designer misses (lines too hard for the
 * grade, a puzzle solvable without the idea, a flat ending). Costs one or two more large calls before
 * anything is drawn. The reviews are in critique.json and the trace.
 *
 * Settings (method_options.critic): rounds (default 2), pass (stop at this score, default 8).
 * The critic is the 'critic' job: by default the design model; override chooseModel() to try another.
 */
final class CriticMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'critic';
    }

    public static function summary(): string
    {
        return 'Classic, plus a teacher-and-designer critic that reviews the blueprint and applies its changes if it still validates.';
    }

    public function steps(): array
    {
        return self::insertAfter(parent::steps(), 'design', new CritiqueStep);
    }
}
