<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Pipeline\Steps\OutlineStep;

/**
 * Sketch the story first (premise, hook, scenes, puzzles, twist, finale) in a small answer about
 * nothing but the story; then design the blueprint from that outline.
 *
 *   align → OUTLINE → design (from the outline) → estimate → draw → build → voice → package → import
 *
 * What it tests: whether separating "what is the story" from "fill in four hundred fields" gives
 * better stories. outline.json in the work folder is short enough to compare across many runs.
 *
 * The outline is its own job ('outline'): give it a different model by overriding chooseModel().
 */
final class OutlineFirstMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'outline-first';
    }

    public static function summary(): string
    {
        return 'Outline the story in a small call first, then design the blueprint from the outline.';
    }

    public function steps(): array
    {
        return self::insertBefore(parent::steps(), 'design', new OutlineStep);
    }
}
