<?php

namespace App\Qbl\Generation\Methods;

use App\Qbl\Generation\GenerationError;

/**
 * The list of generation methods, by the key they are chosen with (--method=<key>, QBL_GEN_METHOD).
 *
 * Add yours to BUILT_IN, or without touching this file through the `methods` setting
 * (QBL_GEN_METHODS='{"mine": "App\\Qbl\\Generation\\Methods\\MyMethod"}').
 */
final class GenerationMethods
{
    /** @var array<string, class-string<GenerationMethod>> */
    public const BUILT_IN = [
        'classic' => ClassicMethod::class,
        'draft' => DraftMethod::class,
        'gemini-judge' => GeminiJudgeMethod::class,
        'sprite-app' => SpriteAppMethod::class,
        'critic' => CriticMethod::class,
        'best-of' => BestOfMethod::class,
        'outline-first' => OutlineFirstMethod::class,
        'scene' => SceneMethod::class,
    ];

    /**
     * @param  array<string, string>  $extra  more from configuration
     * @return array<string, class-string<GenerationMethod>>
     */
    public static function all(array $extra = []): array
    {
        return array_filter($extra, 'is_string') + self::BUILT_IN;
    }

    /** @return class-string<GenerationMethod> */
    public static function classFor(string $key, array $extra = []): string
    {
        $all = self::all($extra);
        $class = $all[$key] ?? throw new GenerationError("There is no generation method \"$key\". There are: ".implode(', ', array_keys($all)).'.');
        if (! is_subclass_of($class, GenerationMethod::class)) {
            throw new GenerationError("The generation method \"$key\" ($class) is not a GenerationMethod.");
        }

        return $class;
    }
}
