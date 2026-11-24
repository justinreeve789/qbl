<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Art\ImageGenerator;

/**
 * As fast and cheap as a whole run can be: the real alignment and design (so you are testing the
 * prompts and the blueprint for real), but flat labelled placeholder shapes instead of pictures, no
 * judging and no voices. The result still imports and plays from start to finish in the editor.
 *
 * Use it to iterate on the designer's prompt, the validator or the builder, where pictures only cost
 * time and money: a run costs only its language model calls (about a dollar with Opus).
 *
 *   php artisan qbl:generate "..." --method=draft
 */
final class DraftMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'draft';
    }

    public static function summary(): string
    {
        return 'Real design, placeholder pictures, no judge, no voices: try design changes for the price of the language model calls.';
    }

    protected function preferredDriver(): string
    {
        return 'placeholder';
    }

    protected function makeImages(): ImageGenerator
    {
        // Whatever the configured driver: placeholder shapes, unless the command names a driver itself.
        return $this->factory->images($this->imageDriver(), $this->style());
    }

    protected function attempts(): int
    {
        return 1;
    }

    public function wantsVoices(): ?bool
    {
        return false;
    }
}
