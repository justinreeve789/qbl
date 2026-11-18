<?php

namespace App\Qbl\Generation\Art;

/** Something that draws a picture from a prompt and reference pictures: Gemini, OpenAI, Scenario, or the placeholder. */
interface ImageGenerator
{
    /**
     * @param  Reference[]  $references
     * @param  string  $aspect  "16:9", "21:9", "1:1", "3:4", "4:3"
     * @param  array  $hints  What the placeholder needs to draw something meaningful: kind, label, frames, ground_line.
     * @return string PNG or JPEG bytes
     */
    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string;

    /** Whether it can draw transparent backgrounds itself (otherwise the style's chroma colour is keyed out). */
    public function transparency(): bool;

    /** For the manifest: "gemini:gemini-3-pro-image-preview". */
    public function describe(): string;
}
