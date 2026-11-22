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

    /** A scene's size in pixels: every scene is this tall; normal and wide scenes are this wide. */
    public const SCENE_HEIGHT = 1200;

    public const SCENE_WIDTH = ['normal' => 2250, 'wide' => 3600];

    /**
     * Depth: whatever stands at the back of the floor (on the ground line) is drawn at DEPTH_BACK of
     * its size, and at the bottom edge at DEPTH_FRONT, in proportion between, so walking towards the
     * viewer reads as coming closer. Sizes above are at the middle of the floor.
     */
    public const DEPTH_BACK = 0.9;

    public const DEPTH_FRONT = 1.08;

    /** How tall characters are when the blueprint does not say. */
    public const CHARACTER_CM = 150;

    /**
     * Where a scene's water lies (BlueprintSchema::waterSchema), in scene pixels: across the front of the
     * floor, across its back (or from just above it, for the sea), in its middle (a pond), or pouring
     * down at the back (a waterfall, into its pool). The background is painted with this left out and
     * the game's water drawn behind it; the floor is kept off it. Null without water.
     *
     * @return array{x0: int, y0: int, x1: int, y1: int, kind: string, where: string}|null
     */
    public static function water(array $scene): ?array
    {
        $w = $scene['water'] ?? null;
        if (! is_array($w) || empty($w['kind'])) {
            return null;
        }
        $W = self::sceneWidth($scene);
        $H = self::SCENE_HEIGHT;
        $G = (int) round($H * max(0.5, min(0.85, (float) ($scene['ground_line'] ?? 0.7))));
        $F = $H - $G;
        $x = (float) ($w['x'] ?? 0.5);
        $kind = (string) $w['kind'];
        $where = $kind === 'waterfall' ? 'back' : (string) ($w['where'] ?? 'front');
        if ($kind === 'waterfall') {
            $half = (float) ($w['width'] ?? 0.14) / 2;

            return ['x0' => (int) round(($x - $half) * $W), 'y0' => (int) round($G * 0.25), 'x1' => (int) round(($x + $half) * $W), 'y1' => $G + (int) round($F * 0.12), 'kind' => $kind, 'where' => $where];
        }

        return match ($where) {
            'middle' => (function () use ($w, $x, $W, $G, $F, $kind, $where) {
                $half = (float) ($w['width'] ?? 0.3) / 2;

                return ['x0' => (int) round(max(0.05, $x - $half) * $W), 'y0' => $G + (int) round($F * 0.3), 'x1' => (int) round(min(0.95, $x + $half) * $W), 'y1' => $G + (int) round($F * 0.78), 'kind' => $kind, 'where' => $where];
            })(),
            'back' => ['x0' => 0, 'y0' => $G - (int) round($F * ($kind === 'sea' ? 0.14 : 0.04)), 'x1' => $W, 'y1' => $G + (int) round($F * 0.22), 'kind' => $kind, 'where' => $where],
            default => ['x0' => 0, 'y0' => $G + (int) round($F * 0.68), 'x1' => $W, 'y1' => $H, 'kind' => $kind, 'where' => 'front'],
        };
    }

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

    public static function sceneWidth(array $scene): int
    {
        return self::SCENE_WIDTH[$scene['width'] ?? 'normal'] ?? self::SCENE_WIDTH['normal'];
    }

    /** A character's height in centimetres, within what can be drawn. */
    public static function characterCm(array $c): int
    {
        $cm = is_numeric($c['height_cm'] ?? null) ? (int) round((float) $c['height_cm']) : self::CHARACTER_CM;

        return max(30, min(260, $cm));
    }

    /**
     * How much a figure is scaled where its feet are, between the ground line (the back of the floor)
     * and the bottom edge; the same gradient the scene's scale area gives figures that walk.
     */
    public static function depth(int $feet, int $ground, int $height = self::SCENE_HEIGHT): float
    {
        $t = max(0.0, min(1.0, ($feet - $ground) / max(1, $height - $ground)));

        return self::DEPTH_BACK + (self::DEPTH_FRONT - self::DEPTH_BACK) * $t;
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
