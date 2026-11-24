<?php

namespace App\Qbl\Generation\Pipeline;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\PricedImageGenerator;

/**
 * Wraps a picture source so every picture it draws is written to the run's trace: the full prompt
 * the art director wrote, which reference pictures went with it (style anchors, the character sheet,
 * the scale guide...), the hints, and the picture that came back, before any cutting out or judging.
 *
 * What the director then did with the picture (judged it, redrew it, kept the best) is in the
 * director's own manifest (assets/<key>.json) and in the style judge's calls, which are traced too.
 *
 * It passes pricing through, so Spend still prices every picture by its real model and size: a priced
 * source is wrapped in TracingPricedImageGenerator (below), so the director sees exactly what it would
 * have seen without the trace. Use wrap() rather than `new`.
 */
class TracingImageGenerator implements ImageGenerator
{
    final public function __construct(protected ImageGenerator $inner, protected Tracer $tracer) {}

    /** The right wrapper for $inner: priced if it is priced. */
    public static function wrap(ImageGenerator $inner, Tracer $tracer): ImageGenerator
    {
        return $inner instanceof PricedImageGenerator ? new TracingPricedImageGenerator($inner, $tracer) : new self($inner, $tracer);
    }

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        $started = microtime(true);
        try {
            $bytes = $this->inner->generate($prompt, $references, $aspect, $transparent, $hints);
        } catch (\Throwable $e) {
            $this->tracer->picture($this->inner->describe(), $prompt, $references, $aspect, $transparent, $hints, null, microtime(true) - $started, $e->getMessage());
            throw $e;
        }
        $this->tracer->picture($this->describeFor($hints), $prompt, $references, $aspect, $transparent, $hints, $bytes, microtime(true) - $started, null);

        return $bytes;
    }

    public function transparency(): bool
    {
        return $this->inner->transparency();
    }

    public function describe(): string
    {
        return $this->inner->describe();
    }

    /** The source that actually drew a picture with these hints (a router says which of its routes). */
    private function describeFor(array $hints): string
    {
        return $this->inner instanceof RoutingImageGenerator ? $this->inner->routeFor($hints)->describe() : $this->inner->describe();
    }

    public function inner(): ImageGenerator
    {
        return $this->inner;
    }
}
