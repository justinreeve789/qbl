<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Pipeline\RoutingImageGenerator;

/**
 * Two picture services: a dedicated sprite app for characters, their animation strips and the props,
 * and the general model (Gemini by default) for backgrounds, far views and foregrounds.
 *
 * What it tests: general image models are good at scenes and weak at consistent characters across
 * frames; sprite tools trained on one style (Scenario.com with a model trained on QBL's anchors, say)
 * are the reverse. The art director does not change at all: it asks a RoutingImageGenerator for each
 * picture, which sends it on by the picture's kind. Every picture call in the trace names the service
 * that drew it.
 *
 * Settings (method_options.sprite-app):
 *   sprite_driver  which driver draws sprites: scenario (default), openai, gemini, placeholder
 *   sprite_kinds   which kinds of picture are sprites (default: character, portrait, strip, item,
 *                  vehicle, badge, sheet, passage, opening)
 * The rest go to --images, else QBL_GEN_IMAGE_DRIVER.
 *
 * With AUTOSPRITE_API_KEY set, AutoSprite animates the characters (GenerationMethod::makeAnimator), as
 * in every method: no strips are drawn, so the sprite service draws only character sheets and props.
 *
 * To add a sprite service that is not one of the drivers (PixelLab, Leonardo, a local ComfyUI...):
 * write an ImageGenerator for it (see Art/Providers/ScenarioImageGenerator.php for one that starts a
 * job and polls it), add it to GenerationFactory::images(), and set sprite_driver to its name.
 */
final class SpriteAppMethod extends GenerationMethod
{
    public const SPRITE_KINDS = ['character', 'portrait', 'strip', 'item', 'vehicle', 'badge', 'sheet', 'passage', 'opening'];

    public static function key(): string
    {
        return 'sprite-app';
    }

    public static function summary(): string
    {
        return 'A sprite app (Scenario.com by default) draws characters, animations and props; Gemini paints the scenes.';
    }

    protected function makeImages(): ImageGenerator
    {
        $scenes = $this->factory->images($this->imageDriver(), $this->style());
        $sprites = $this->factory->images((string) $this->setting('sprite_driver', 'scenario'), $this->style());
        $kinds = $this->setting('sprite_kinds', self::SPRITE_KINDS);
        $kinds = is_string($kinds) ? array_filter(array_map('trim', explode(',', $kinds))) : (array) $kinds;

        return new RoutingImageGenerator($scenes, array_fill_keys($kinds, $sprites));
    }
}
