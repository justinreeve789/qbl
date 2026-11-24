<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\Providers\GeminiImageGenerator;

/**
 * Gemini draws every picture, with its main model at full size (no cheaper props model), and a stricter
 * judge checks each one: a higher bar and more tries before the best is kept.
 *
 * What it tests: how much of the style problem is the picture model, and how much a demanding art
 * director can fix by sending pictures back with notes. Compare its traces with classic's: the judge's
 * scores per attempt are in calls/*-llm-judge-style_review.json, the prompts it rewrote in the
 * picture calls that follow.
 *
 * Costs more than classic: every prop at the main model's price, and more redraws.
 *
 * Settings (method_options.gemini-judge): min_score (default 8), attempts (default 4),
 * model (default QBL_GEN_GEMINI_MODEL), size (default QBL_GEN_GEMINI_IMAGE_SIZE).
 */
final class GeminiJudgeMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'gemini-judge';
    }

    public static function summary(): string
    {
        return 'Gemini\'s main model draws everything; a stricter judge (8/10, 4 tries) sends pictures back with notes.';
    }

    protected function preferredDriver(): string
    {
        return 'gemini';
    }

    protected function makeImages(): ImageGenerator
    {
        // In tests (or when a picture source is injected), use that; otherwise Gemini, set up here rather than from the driver config.
        if ($injected = $this->factory->injectedImages()) {
            return $injected;
        }
        if ($this->imageDriver() !== 'gemini') {
            // The command named another driver: respect it (the stricter judge still applies).
            return parent::makeImages();
        }
        $c = fn (string $k, string $d) => (string) $this->factory->config("images.gemini.$k", $d);

        return new GeminiImageGenerator(
            $this->factory->http(),
            $c('api_key', ''),
            (string) $this->setting('model', $c('model', 'gemini-3-pro-image')),
            $c('base_url', 'https://generativelanguage.googleapis.com/v1beta'),
            (string) $this->setting('size', $c('image_size', '2K')),
            // No props model: small things are drawn by the main model too.
            '', '',
        );
    }

    protected function minScore(): float
    {
        return (float) $this->setting('min_score', 8);
    }

    protected function attempts(): int
    {
        return (int) ($this->options['attempts'] ?? $this->setting('attempts', 4));
    }
}
