<?php

namespace App\Qbl\Generation\Pipeline;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\PricedImageGenerator;

/**
 * Sends each picture to a different picture source by what kind of picture it is: backgrounds to one
 * service, characters and props to another. The art director does not know: it asks this for every
 * picture as it would ask one service.
 *
 * The kinds the director asks for (ArtStyle::prompt): background, distance, foreground, clouds,
 * character, portrait, strip, item, vehicle, badge, passage, opening, sheet. Each request's hints
 * carry its kind, which is what the routing goes by.
 *
 *   new RoutingImageGenerator($gemini, ['character' => $spriteApp, 'strip' => $spriteApp, ...])
 */
final class RoutingImageGenerator implements ImageGenerator, PricedImageGenerator
{
    /**
     * @param  ImageGenerator  $default  draws every kind not routed
     * @param  array<string, ImageGenerator>  $routes  kind => source
     */
    public function __construct(private ImageGenerator $default, private array $routes) {}

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        return $this->routeFor($hints)->generate($prompt, $references, $aspect, $transparent, $hints);
    }

    public function routeFor(array $hints): ImageGenerator
    {
        return $this->routes[$hints['kind'] ?? ''] ?? $this->default;
    }

    public function pricing(array $hints): array
    {
        $route = $this->routeFor($hints);

        return $route instanceof PricedImageGenerator ? $route->pricing($hints) : [$route->describe(), null];
    }

    /**
     * The director asks this once for every picture, not per kind: so it is only true when every
     * source can draw transparency. Otherwise cut-outs are asked for on the chroma colour and keyed
     * out, which works whichever source draws them.
     */
    public function transparency(): bool
    {
        foreach ([$this->default, ...array_values($this->routes)] as $source) {
            if (! $source->transparency()) {
                return false;
            }
        }

        return true;
    }

    public function describe(): string
    {
        $byRoute = [];
        foreach ($this->routes as $kind => $source) {
            $byRoute[$source->describe()][] = $kind;
        }
        $parts = array_map(fn ($source, $kinds) => implode('/', $kinds)."→$source", array_keys($byRoute), $byRoute);

        return 'route('.implode(', ', [...$parts, 'rest→'.$this->default->describe()]).')';
    }
}
