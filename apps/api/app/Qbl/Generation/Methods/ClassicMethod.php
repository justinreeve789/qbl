<?php

namespace App\Qbl\Generation\Methods;

/**
 * The pipeline as it has always been, and the default:
 *
 *   align → design → estimate → draw → build → voice → package → import
 *
 * One designer call (corrected until the validator passes), every picture from the configured driver
 * (QBL_GEN_IMAGE_DRIVER, Gemini by default) judged against the style anchors by Claude.
 *
 * Everything is inherited from GenerationMethod: read that class to see each part. This one exists so
 * the classic pipeline has a name to compare experiments against (--method=classic).
 */
final class ClassicMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'classic';
    }

    public static function summary(): string
    {
        return 'The standard pipeline: one design corrected until it validates, pictures from the configured driver judged against the style anchors.';
    }
}
