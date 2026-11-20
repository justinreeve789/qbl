<?php

namespace App\Qbl\Generation\Art;

/**
 * An image generator that says which model and size a picture with these hints is drawn with, so the
 * run's Spend can price it. Generators that do not say (the placeholder) cost nothing.
 */
interface PricedImageGenerator
{
    /** @return array{0: string, 1: ?string} [model as in Spend::PRICES, size or null] */
    public function pricing(array $hints): array;
}
