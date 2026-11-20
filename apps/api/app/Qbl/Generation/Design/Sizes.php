<?php

namespace App\Qbl\Generation\Design;

/**
 * How big things are drawn, and where they go, so that a pollen vial is not as big as a crate and a
 * crate is not as big as a person, and a small thing sits on a table rather than floating at the back.
 *
 * The blueprint gives each item its real size (size_cm: its longest side). People in a scene, avatars
 * and characters alike, are drawn about PERSON_PX tall for a PERSON_CM tall child explorer, and things
 * are drawn to the same scale, except that small things are drawn a little larger than true, so they
 * can still be seen and clicked.
 */
final class Sizes
{
    /** How tall a person (a young explorer) is, and how tall they are drawn: the platform's avatars at their scale, and characters on 320-pixel frames at 0.8. */
    public const PERSON_CM = 130;

    public const PERSON_PX = 225;

    /** Old blueprints say only small, medium or large. */
    public const SIZE_CM = ['small' => 25, 'medium' => 80, 'large' => 180];

    /** Where something can be. */
    public const PLACEMENTS = ['ground', 'back', 'surface', 'wall'];

    public const SCENE_KINDS = ['outdoor', 'indoor', 'underground', 'up_high', 'underwater'];

    /** Scenes with a back wall to hang things on. */
    private const WALLED = ['indoor', 'underground'];

    /** The tallest anything is drawn: well within a 1200-pixel scene. */
    public const MAX_PX = 760;

    /** The longest side of an item, in centimetres. */
    public static function cm(array $item): int
    {
        if (isset($item['size_cm']) && is_numeric($item['size_cm']) && $item['size_cm'] > 0) {
            return (int) max(2, min(1200, round((float) $item['size_cm'])));
        }

        return self::SIZE_CM[$item['size'] ?? 'medium'] ?? self::SIZE_CM['medium'];
    }

    /** The longest side of an item's picture, in scene pixels. */
    public static function pixels(int $cm): int
    {
        $true = $cm * self::PERSON_PX / self::PERSON_CM;

        // Small things a little larger than true (a 12 cm vial is 62 pixels, not 21), large ones true to scale.
        return (int) round(min(self::MAX_PX, max($true, 52 + 0.8 * $cm)));
    }

    public static function sceneKind(array $scene): string
    {
        $kind = $scene['kind'] ?? null;
        if (in_array($kind, self::SCENE_KINDS, true)) {
            return $kind;
        }

        return ! empty($scene['indoor']) ? 'indoor' : 'outdoor';
    }

    public static function walled(array $scene): bool
    {
        return in_array(self::sceneKind($scene), self::WALLED, true);
    }

    /**
     * Where a thing of this size goes in this scene: what the blueprint asks for when it makes sense,
     * otherwise what suits its size. Small things on a stand (a table, a flat rock), middling ones on the
     * floor students walk on, big ones against the back so the floor stays open. On a wall only where
     * there is one.
     */
    public static function placement(?array $item, ?string $wanted, array $scene): string
    {
        $cm = $item ? self::cm($item) : 40;
        $walled = self::walled($scene);
        $ok = match ($wanted) {
            'wall' => $walled && $cm <= 150,
            'surface' => $cm <= 70,
            'ground' => $cm <= 150,
            'back' => true,
            default => false,
        };
        if ($ok) {
            return $wanted;
        }
        if ($cm > 150) {
            return 'back';
        }

        return $cm <= 40 ? 'surface' : 'ground';
    }
}
