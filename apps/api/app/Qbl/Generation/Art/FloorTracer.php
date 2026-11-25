<?php

namespace App\Qbl\Generation\Art;

use GdImage;

/**
 * Where people can walk in a background picture: right up to whatever stops them. The surveyor (a
 * language model looking at the picture) traces the back edge of the floor roughly, as points along the
 * base of the buildings, walls, fences, cliffs and hedges and the water's edge. Here each point is
 * moved onto the line actually painted there, the strongest change from the floor below to what stands
 * above it, within a short distance up or down, so the walkable area meets the base of a wall to within
 * a few pixels instead of a few percent of the picture.
 *
 * The result is the floor's back edge, left to right in scene pixels, and the walkable polygon made
 * from it: down to the bottom of the floor, between its ends.
 */
final class FloorTracer
{
    /** How far up or down (a share of the picture's height) a point may move onto the painted line. */
    public const REACH = 0.03;

    /** Feet stand this many pixels in front of the line, not on it. */
    public const MARGIN = 6;

    /** The least change (in brightness, 0-255) that counts as a painted line. */
    private const STRONG = 22;

    /**
     * The surveyor's points moved onto the painted line, with more points between them where the edge
     * is long and level enough to follow (along a wall), then simplified again.
     *
     * @param  list<array{0: int, 1: int}>  $points  [x, y] in the picture's pixels, left to right.
     * @return list<array{0: int, 1: int}>
     */
    public static function snap(GdImage $im, array $points): array
    {
        $W = imagesx($im);
        $H = imagesy($im);
        usort($points, fn ($a, $b) => $a[0] <=> $b[0]);
        $points = array_values(array_filter($points, fn ($p) => $p[0] >= 0 && $p[0] <= $W));
        if (count($points) < 2) {
            return $points;
        }
        $reach = (int) round($H * self::REACH);
        // More points along gentle stretches (a wall's base), none along steep ones (a building's side
        // coming forward), which keep their two ends.
        $dense = [];
        for ($i = 0, $n = count($points); $i < $n; $i++) {
            $dense[] = [$points[$i], true];
            if ($i + 1 < $n) {
                [$ax, $ay] = $points[$i];
                [$bx, $by] = $points[$i + 1];
                $dx = $bx - $ax;
                if ($dx > 60 && abs($by - $ay) / $dx < 0.6) {
                    $steps = (int) floor($dx / 48);
                    for ($k = 1; $k < $steps; $k++) {
                        $t = $k / $steps;
                        $dense[] = [[(int) round($ax + $dx * $t), (int) round($ay + ($by - $ay) * $t)], false];
                    }
                }
            }
        }
        $snapped = [];
        foreach ($dense as [[$x, $y], $given]) {
            $to = self::lineNear($im, $x, $y, $reach);
            $snapped[] = [$x, $to ?? $y, $given, $to !== null];
        }
        // A point between two that found the line far from both is a stray (a window sill, a crack): back to its neighbours.
        for ($i = 1, $n = count($snapped); $i + 1 < $n; $i++) {
            if ($snapped[$i][2]) {
                continue;
            }
            $mid = ($snapped[$i - 1][1] + $snapped[$i + 1][1]) / 2;
            if (abs($snapped[$i][1] - $mid) > $reach * 0.6) {
                $snapped[$i][1] = (int) round($mid);
            }
        }
        $line = array_map(fn ($p) => [(float) $p[0], (float) $p[1]], $snapped);
        $line = SortLine::simplify($line, 2.5);

        return array_map(fn ($p) => [(int) round($p[0]), (int) min($H, round($p[1]) + self::MARGIN)], $line);
    }

    /**
     * The painted line near (x, y): the row within reach where the picture changes most from above to
     * below, over a few columns, favouring rows near where it was asked. Null when nothing there
     * changes enough to be a line (open ground: the point stays where it was).
     */
    public static function lineNear(GdImage $im, int $x, int $y, int $reach): ?int
    {
        $W = imagesx($im);
        $H = imagesy($im);
        $best = null;
        $bestScore = 0.0;
        for ($yy = max(2, $y - $reach); $yy <= min($H - 3, $y + $reach); $yy++) {
            $change = 0.0;
            $cols = 0;
            for ($xx = max(0, $x - 4); $xx <= min($W - 1, $x + 4); $xx += 2) {
                $above = self::luma($im, $xx, $yy - 2);
                $below = self::luma($im, $xx, $yy + 2);
                if ($above === null || $below === null) {
                    // See-through above (a sky cut out): the scenery's top, not a floor's edge.
                    continue;
                }
                $change += abs($above - $below);
                $cols++;
            }
            if (! $cols) {
                continue;
            }
            $change /= $cols;
            // Nearer where it was asked counts for a little more.
            $score = $change * (1 - 0.35 * abs($yy - $y) / max(1, $reach));
            if ($change >= self::STRONG && $score > $bestScore) {
                $bestScore = $score;
                $best = $yy;
            }
        }

        return $best;
    }

    /**
     * The walkable polygon: the back edge between the floor's ends, then down to the bottom. Where the
     * edge comes down too near the bottom (a building's corner reaching the front), it is held a little
     * above it, so the polygon stays one piece.
     *
     * @param  list<array{0: int, 1: int}>  $edge
     * @return list<array{x: int, y: int}>
     */
    public static function polygon(array $edge, int $left, int $right, int $bottom, int $minDepth = 50): array
    {
        $at = fn (float $x) => SortLine::yAt($edge, $x);
        $top = [];
        $top[] = [$left, $at($left)];
        foreach ($edge as [$x, $y]) {
            if ($x > $left && $x < $right) {
                $top[] = [$x, $y];
            }
        }
        $top[] = [$right, $at($right)];
        $out = array_map(fn ($p) => ['x' => (int) $p[0], 'y' => (int) min($bottom - $minDepth, round($p[1]))], $top);
        $out[] = ['x' => $right, 'y' => $bottom];
        $out[] = ['x' => $left, 'y' => $bottom];

        return $out;
    }

    /** A pixel's brightness, or null where it is see-through. */
    private static function luma(GdImage $im, int $x, int $y): ?float
    {
        $c = imagecolorat($im, $x, $y);
        if ((($c >> 24) & 0x7F) > 90) {
            return null;
        }

        return 0.299 * (($c >> 16) & 0xFF) + 0.587 * (($c >> 8) & 0xFF) + 0.114 * ($c & 0xFF);
    }
}
