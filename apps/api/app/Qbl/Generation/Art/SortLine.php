<?php

namespace App\Qbl\Generation\Art;

use GdImage;

/**
 * Where a cut-out picture meets the floor: its `sort_line` (packages/shared/src/sorting.ts), found from
 * its pixels the same way the editor's "✨ Find it from the picture" finds it (findSortLine): the lowest
 * solid pixel of each column, columns much thinner than most skipped (a tray, a branch sticking out),
 * simplified to at most eight points. A figure in front of that line is drawn in front of the item; one
 * behind it, behind.
 *
 * Kept a line-for-line port of the TypeScript, so a generated item has the line the editor would give it.
 */
final class SortLine
{
    /**
     * @return list<array{0: float, 1: float}>|null Points [x, y] as fractions of the picture, left to right.
     */
    public static function find(GdImage $im, int $alphaCut = 128): ?array
    {
        $width = imagesx($im);
        $height = imagesy($im);
        if ($width < 2 || $height < 1) {
            return null;
        }
        $bottoms = [];
        $solid = [];
        for ($x = 0; $x < $width; $x++) {
            $low = -1;
            $count = 0;
            for ($y = 0; $y < $height; $y++) {
                // GD's alpha is 0 (opaque) to 127 (clear); the TypeScript reads 0 (clear) to 255 (opaque).
                $alpha = 255 - (int) round(((imagecolorat($im, $x, $y) >> 24) & 0x7F) * 255 / 127);
                if ($alpha >= $alphaCut) {
                    $low = $y;
                    $count++;
                }
            }
            $bottoms[] = $low < 0 ? null : $low + 1;
            $solid[] = $count;
        }
        $counted = array_values(array_filter($solid, fn ($c) => $c > 0));
        if (! $counted) {
            return null;
        }
        sort($counted);
        $median = $counted[intdiv(count($counted), 2)];
        $base = [];
        foreach ($bottoms as $x => $b) {
            if ($b !== null && $solid[$x] >= $median * 0.5) {
                $base[] = [$x + 0.5, (float) $b];
            }
        }
        if (count($base) < 2) {
            return null;
        }
        $tolerance = $height * 0.015;
        $points = self::simplify($base, $tolerance);
        while (count($points) > 8) {
            $tolerance *= 1.5;
            $points = self::simplify($base, $tolerance);
        }

        return array_map(fn ($p) => [round($p[0] / $width, 3), round($p[1] / $height, 3)], $points);
    }

    /**
     * The sort line for a thing cut out of a background (SurveyStep): found from its pixels (a cart, a
     * bench, a counter running into the room), unless it stands on a narrow base under something wider
     * (a tree's trunk under its canopy, a lamp post under its arm): then someone behind the base is
     * behind the whole thing, and the line is level, along its bottom.
     *
     * A thing open beneath or between (ObjectCutter's "under" and "lattice": a table, a bench, a railing)
     * has see-through gaps where the floor shows between its legs, so the lowest pixel of a column there
     * is the underside of its top, not the floor. Its line runs from foot to foot instead (bridged()).
     *
     * @param  float  $baseShare  How much of its width its base is (ObjectCutter's footprint).
     * @param  string  $openings  How it can be seen through (ObjectCutter::OPENINGS).
     * @return list<array{0: float, 1: float}>
     */
    public static function forCutout(GdImage $im, float $baseShare = 1.0, string $openings = 'none'): array
    {
        if ($openings === 'under' || $openings === 'lattice') {
            $line = self::bridged($im);
        } else {
            $line = $baseShare >= 0.4 ? self::find($im) : null;
        }

        return $line ?? [[0.0, 1.0], [1.0, 1.0]];
    }

    /**
     * Where a thing with gaps under it meets the floor: the lowest solid pixel of each column that reaches
     * most of the way down (its legs, posts and solid parts; not a column of tabletop over a gap, nor a
     * tray sticking out), joined from below, so the line bridges straight from foot to foot. Points [x, y]
     * as fractions of the picture, left to right; null without two such columns.
     *
     * @return list<array{0: float, 1: float}>|null
     */
    public static function bridged(GdImage $im, int $alphaCut = 128): ?array
    {
        $width = imagesx($im);
        $height = imagesy($im);
        $tops = [];
        $bottoms = [];
        for ($x = 0; $x < $width; $x++) {
            for ($y = 0, $top = null, $low = null; $y < $height; $y++) {
                $alpha = 255 - (int) round(((imagecolorat($im, $x, $y) >> 24) & 0x7F) * 255 / 127);
                if ($alpha >= $alphaCut) {
                    $top ??= $y;
                    $low = $y;
                }
            }
            if ($low !== null) {
                $tops[$x] = $top;
                $bottoms[$x] = $low + 1;
            }
        }
        if (count($bottoms) < 2) {
            return null;
        }
        $extents = [];
        foreach ($bottoms as $x => $b) {
            $extents[$x] = $b - $tops[$x];
        }
        $most = max($extents);
        $feet = array_filter($bottoms, fn ($x) => $extents[$x] >= 0.4 * $most, ARRAY_FILTER_USE_KEY);
        // The hull from below: each point the line keeps has none of the others below the line through it. Each
        // column counts as low as the lowest foot within two columns (a leg's soft side does not reach as far down).
        $hull = [];
        foreach ($feet as $x => $b) {
            for ($dx = -2; $dx <= 2; $dx++) {
                $b = max($b, $feet[$x + $dx] ?? 0);
            }
            $p = [$x + 0.5, (float) $b];
            while (count($hull) >= 2) {
                [$a, $m] = [$hull[count($hull) - 2], $hull[count($hull) - 1]];
                if ($m[1] > self::yAt([$a, $p], $m[0])) {
                    break;
                }
                array_pop($hull);
            }
            $hull[] = $p;
        }
        if (count($hull) < 2) {
            return null;
        }
        $tolerance = $height * 0.015;
        $points = self::simplify($hull, $tolerance);
        while (count($points) > 8) {
            $tolerance *= 1.5;
            $points = self::simplify($hull, $tolerance);
        }

        return array_map(fn ($p) => [round($p[0] / $width, 3), round($p[1] / $height, 3)], $points);
    }

    /** Where a line of [x, y] points is at x: straight between its points, level beyond its ends. */
    public static function yAt(array $points, float $x): float
    {
        if (! $points) {
            return 0.0;
        }
        if ($x <= $points[0][0]) {
            return (float) $points[0][1];
        }
        for ($i = 1, $n = count($points); $i < $n; $i++) {
            [$ax, $ay] = $points[$i - 1];
            [$bx, $by] = $points[$i];
            if ($x <= $bx) {
                return $bx == $ax ? (float) max($ay, $by) : $ay + ($x - $ax) / ($bx - $ax) * ($by - $ay);
            }
        }

        return (float) $points[count($points) - 1][1];
    }

    /** Douglas–Peucker: the fewest of the points that stay within the tolerance of all of them. */
    public static function simplify(array $points, float $tolerance): array
    {
        if (count($points) <= 2) {
            return $points;
        }
        $a = $points[0];
        $b = $points[count($points) - 1];
        $far = -1;
        $farthest = 0.0;
        for ($i = 1, $n = count($points) - 1; $i < $n; $i++) {
            $d = abs($points[$i][1] - self::yAt([$a, $b], $points[$i][0]));
            if ($d > $farthest) {
                $farthest = $d;
                $far = $i;
            }
        }
        if ($farthest <= $tolerance) {
            return [$a, $b];
        }

        return [...array_slice(self::simplify(array_slice($points, 0, $far + 1), $tolerance), 0, -1), ...self::simplify(array_slice($points, $far), $tolerance)];
    }
}
