<?php

namespace App\Qbl\Generation\Pipeline;

use App\Qbl\Generation\Art\PricedImageGenerator;

/** A traced source that says what its pictures cost (Gemini, OpenAI, Scenario, a router). */
final class TracingPricedImageGenerator extends TracingImageGenerator implements PricedImageGenerator
{
    public function pricing(array $hints): array
    {
        /** @var PricedImageGenerator $inner */
        $inner = $this->inner;

        return $inner->pricing($hints);
    }
}
