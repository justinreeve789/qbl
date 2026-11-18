<?php

namespace App\Qbl\Generation\Art\Providers;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\GenerationError;

/**
 * Draws nothing: `qbl:generate --resume=ID --offline` finishes a run with the pictures it already has.
 * A missing animation is left to the built-in move; anything else missing stops the run and is named.
 */
class OfflineImageGenerator implements ImageGenerator
{
    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        throw new GenerationError('Offline: no picture is drawn for '.($hints['label'] ?? $hints['kind'] ?? 'this').'. Draw it, or put one in the run\'s assets folder.');
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return 'offline';
    }
}
