<?php

namespace App\Qbl\Generation\Art;

use GdImage;

/**
 * Lifts a thing that stands on the floor out of a background picture, pixel for pixel, onto a
 * transparent picture of its own: a tree, a lamp post, a fountain, a cart. Placed exactly over its
 * counterpart in the background it cannot be told apart from it, yet it is an item, sorted among the
 * figures by its sort line: people walk in front of it and behind it.
 *
 * How the thing is told from what is behind it: the house style outlines everything in a dark line and
 * fills it with flat colour. Starting from the edges of a box a little bigger than the thing (where only
 * scenery is), everything that can be reached without crossing an outline is scenery; what is left
 * inside is the thing. A pocket of scenery enclosed by the thing (sky between branches) is kept with
 * it, which is harmless: it is the same pixels as the background behind it, so it only hides a figure
 * walking behind that pocket. Losing part of the thing would be worse (a figure behind the tree would
 * show through its trunk), so the mask is grown by a pixel.
 *
 * When the outlines leak (a gap lets the flood run through the thing) or the thing is lost in its
 * surroundings, the outline the surveyor drew around it is used instead.
 */
final class ObjectCutter
{
    /** A pixel is an outline where its colour jumps this much (summed RGB) to a neighbour, or it is this dark. */
    private const EDGE = 96;

    private const DARK = 58;

    /**
     * @param  array{0: int, 1: int, 2: int, 3: int}  $box  x0, y0, x1, y1 in the picture's pixels: about where the thing is.
     * @param  list<array{0: int, 1: int}>  $outline  Optional: points around the thing, in the picture's pixels.
     * @return array{image: GdImage, x: int, y: int, width: int, height: int, how: string, footprint: array{0: int, 1: int}}|null
     *                                                                                                                       The cut-out, where its top left goes in the picture, how it was found ("outline" or "drawn"), and
     *                                                                                                                       where its base is across the picture. Null when nothing could be lifted out.
     */
    public static function cut(GdImage $picture, array $box, array $outline = []): ?array
    {
        $W = imagesx($picture);
        $H = imagesy($picture);
        [$bx0, $by0, $bx1, $by1] = [max(0, $box[0]), max(0, $box[1]), min($W - 1, $box[2]), min($H - 1, $box[3])];
        $bw = $bx1 - $bx0 + 1;
        $bh = $by1 - $by0 + 1;
        if ($bw < 8 || $bh < 8) {
            return null;
        }
        // A margin of scenery all round, where the flood starts.
        $pad = (int) max(10, round(0.06 * max($bw, $bh)));
        $rx0 = max(0, $bx0 - $pad);
        $ry0 = max(0, $by0 - $pad);
        $rx1 = min($W - 1, $bx1 + $pad);
        $ry1 = min($H - 1, $by1 + $pad);
        $rw = $rx1 - $rx0 + 1;
        $rh = $ry1 - $ry0 + 1;

        // Colours of the region, and which pixels are outlines (or see-through: the sky cut out, which is scenery).
        $rgb = [];
        $clear = [];
        for ($y = 0; $y < $rh; $y++) {
            for ($x = 0; $x < $rw; $x++) {
                $c = imagecolorat($picture, $rx0 + $x, $ry0 + $y);
                $i = $y * $rw + $x;
                $rgb[$i] = $c & 0xFFFFFF;
                $clear[$i] = (($c >> 24) & 0x7F) > 100;
            }
        }
        $wall = [];
        for ($y = 0; $y < $rh; $y++) {
            for ($x = 0; $x < $rw; $x++) {
                $i = $y * $rw + $x;
                if ($clear[$i]) {
                    $wall[$i] = false;

                    continue;
                }
                $c = $rgb[$i];
                $r = ($c >> 16) & 0xFF;
                $g = ($c >> 8) & 0xFF;
                $b = $c & 0xFF;
                $edge = 0.299 * $r + 0.587 * $g + 0.114 * $b < self::DARK;
                foreach ($x + 1 < $rw ? [$i + 1] : [] as $j) {
                    $edge = $edge || self::diff($c, $rgb[$j]) > self::EDGE;
                }
                if (! $edge && $y + 1 < $rh) {
                    $edge = self::diff($c, $rgb[$i + $rw]) > self::EDGE;
                }
                $wall[$i] = $edge;
            }
        }

        // Inside the outline the surveyor drew (grown a little), nothing is a seed: a box drawn too tight
        // must not start the flood inside the thing.
        $inside = $outline ? self::polygonMask($outline, $rx0, $ry0, $rw, $rh, 1.08) : null;
        $seen = array_fill(0, $rw * $rh, false);
        $queue = [];
        $seed = function (int $x, int $y) use (&$queue, &$seen, $wall, $inside, $rw) {
            $i = $y * $rw + $x;
            if (! $seen[$i] && ! $wall[$i] && ! ($inside[$i] ?? false)) {
                $seen[$i] = true;
                $queue[] = $i;
            }
        };
        for ($x = 0; $x < $rw; $x++) {
            // Not along the top when the thing runs off the top of the picture (a tall tree): that edge is the thing.
            if ($ry0 > 0 || $by0 > 2) {
                $seed($x, 0);
            }
            $seed($x, $rh - 1);
        }
        for ($y = 0; $y < $rh; $y++) {
            if ($rx0 > 0 || $bx0 > 2) {
                $seed(0, $y);
            }
            if ($rx1 < $W - 1 || $bx1 < $W - 3) {
                $seed($rw - 1, $y);
            }
        }
        for ($q = 0; $q < count($queue); $q++) {
            $i = $queue[$q];
            $x = $i % $rw;
            $y = intdiv($i, $rw);
            foreach ([[$x - 1, $y], [$x + 1, $y], [$x, $y - 1], [$x, $y + 1]] as [$nx, $ny]) {
                if ($nx < 0 || $ny < 0 || $nx >= $rw || $ny >= $rh) {
                    continue;
                }
                $j = $ny * $rw + $nx;
                if (! $seen[$j] && ! $wall[$j]) {
                    $seen[$j] = true;
                    $queue[] = $j;
                }
            }
        }

        // What the flood did not reach is the thing (with its outline), and perhaps bits of its neighbours:
        // keep the pieces that lie in the box.
        // Only the inside (not the outlines themselves) decides which pieces are the thing: a long line of
        // the scenery (the floor's edge) touching it must not join on. Its own outline is added back after.
        $interior = [];
        foreach ($seen as $i => $reached) {
            $interior[$i] = ! $reached && ! $wall[$i];
        }
        $mask = self::mainPieces($interior, $rw, $rh, $bx0 - $rx0, $by0 - $ry0, $bw, $bh);
        for ($k = 0; $k < 4; $k++) {
            $mask = self::grow($mask, $rw, $rh, $wall);
        }
        $share = array_sum(array_map('intval', $mask)) / max(1, $bw * $bh);
        $how = 'outline';
        // Too little (the flood got in) or nearly the whole box (the flood was stopped by texture all round).
        if ($share < 0.1 || $share > 0.97) {
            if (! $outline) {
                return null;
            }
            $mask = self::polygonMask($outline, $rx0, $ry0, $rw, $rh, 1.0);
            $how = 'drawn';
            if (array_sum(array_map('intval', $mask)) < 64) {
                return null;
            }
        } elseif ($inside) {
            // Never far outside the drawn outline: that is a neighbour joined on by its outline.
            $limit = self::polygonMask($outline, $rx0, $ry0, $rw, $rh, 1.15);
            foreach ($mask as $i => $m) {
                $mask[$i] = $m && $limit[$i];
            }
        }
        $mask = self::grow($mask, $rw, $rh);

        // The cut-out: the mask's own box, an even number of pixels wide so it centres on a whole pixel.
        $minX = $rw;
        $minY = $rh;
        $maxX = -1;
        $maxY = -1;
        foreach ($mask as $i => $m) {
            if ($m) {
                $x = $i % $rw;
                $y = intdiv($i, $rw);
                $minX = min($minX, $x);
                $maxX = max($maxX, $x);
                $minY = min($minY, $y);
                $maxY = max($maxY, $y);
            }
        }
        if ($maxX < 0) {
            return null;
        }
        $cw = $maxX - $minX + 1;
        if ($cw % 2 === 1) {
            if ($rx0 + $maxX + 1 < $W) {
                $maxX++;
            } else {
                $minX--;
            }
            $cw++;
        }
        $ch = $maxY - $minY + 1;
        $out = ImageTools::blank($cw, $ch);
        for ($y = $minY; $y <= $maxY; $y++) {
            for ($x = $minX; $x <= $maxX; $x++) {
                if ($x >= 0 && $x < $rw && ($mask[$y * $rw + $x] ?? false)) {
                    imagesetpixel($out, $x - $minX, $y - $minY, imagecolorat($picture, $rx0 + $x, $ry0 + $y));
                }
            }
        }

        // Its base: the columns of its lowest rows, where it stands (a tree's trunk, a cart's wheels).
        $fx0 = $cw;
        $fx1 = -1;
        $band = max(2, (int) round($ch * 0.05));
        for ($y = $maxY - $band; $y <= $maxY; $y++) {
            for ($x = $minX; $x <= $maxX; $x++) {
                if ($x >= 0 && $x < $rw && ($mask[$y * $rw + $x] ?? false)) {
                    $fx0 = min($fx0, $x);
                    $fx1 = max($fx1, $x);
                }
            }
        }

        return [
            'image' => $out, 'x' => $rx0 + $minX, 'y' => $ry0 + $minY, 'width' => $cw, 'height' => $ch, 'how' => $how,
            'footprint' => [$rx0 + $fx0, $rx0 + $fx1],
        ];
    }

    /** How different two colours are: the sum of their channels' differences. */
    private static function diff(int $a, int $b): int
    {
        return abs((($a >> 16) & 0xFF) - (($b >> 16) & 0xFF)) + abs((($a >> 8) & 0xFF) - (($b >> 8) & 0xFF)) + abs(($a & 0xFF) - ($b & 0xFF));
    }

    /**
     * The pieces of a mask that belong to the thing: the biggest piece that reaches into the middle of
     * the box, and any other piece at least a quarter its size whose middle is in the box.
     */
    private static function mainPieces(array $mask, int $w, int $h, int $bx, int $by, int $bw, int $bh): array
    {
        $label = array_fill(0, $w * $h, 0);
        $pieces = [];
        $n = 0;
        foreach ($mask as $i => $m) {
            if (! $m || $label[$i]) {
                continue;
            }
            $n++;
            $stack = [$i];
            $label[$i] = $n;
            $count = 0;
            $sx = $sy = 0;
            $central = false;
            while ($stack) {
                $k = array_pop($stack);
                $x = $k % $w;
                $y = intdiv($k, $w);
                $count++;
                $sx += $x;
                $sy += $y;
                if ($x >= $bx + $bw * 0.2 && $x <= $bx + $bw * 0.8 && $y >= $by + $bh * 0.2 && $y <= $by + $bh * 0.95) {
                    $central = true;
                }
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $nx = $x + $dx;
                        $ny = $y + $dy;
                        if ($nx < 0 || $ny < 0 || $nx >= $w || $ny >= $h) {
                            continue;
                        }
                        $j = $ny * $w + $nx;
                        if ($mask[$j] && ! $label[$j]) {
                            $label[$j] = $n;
                            $stack[] = $j;
                        }
                    }
                }
            }
            $pieces[$n] = ['count' => $count, 'central' => $central, 'cx' => $sx / $count, 'cy' => $sy / $count];
        }
        $main = null;
        foreach ($pieces as $id => $p) {
            if ($p['central'] && ($main === null || $p['count'] > $pieces[$main]['count'])) {
                $main = $id;
            }
        }
        if ($main === null) {
            return array_fill(0, $w * $h, false);
        }
        $keep = [$main => true];
        $inBox = fn ($p) => $p['cx'] >= $bx && $p['cx'] <= $bx + $bw && $p['cy'] >= $by && $p['cy'] <= $by + $bh;
        foreach ($pieces as $id => $p) {
            if ($p['count'] >= $pieces[$main]['count'] * 0.25 && $inBox($p)) {
                $keep[$id] = true;
            }
        }
        // Parts of it parted from the rest only by an outline (a trunk below its canopy, a cart's wheel):
        // pieces in the box within a few pixels of what is kept, again and again.
        for ($round = 0; $round < 4; $round++) {
            $near = array_map(fn ($l) => isset($keep[$l]), $label);
            for ($k = 0; $k < 5; $k++) {
                $near = self::grow($near, $w, $h);
            }
            $added = false;
            foreach ($near as $i => $n) {
                $l = $label[$i];
                if ($n && $l && ! isset($keep[$l]) && $pieces[$l]['count'] >= max(12, $pieces[$main]['count'] * 0.01) && $inBox($pieces[$l])) {
                    $keep[$l] = true;
                    $added = true;
                }
            }
            if (! $added) {
                break;
            }
        }

        return array_map(fn ($l) => isset($keep[$l]), $label);
    }

    /** The mask grown by one pixel all round (only into these pixels, when given: its outline). */
    private static function grow(array $mask, int $w, int $h, ?array $into = null): array
    {
        $out = $mask;
        foreach ($mask as $i => $m) {
            if (! $m) {
                continue;
            }
            $x = $i % $w;
            $y = intdiv($i, $w);
            foreach ([[$x - 1, $y], [$x + 1, $y], [$x, $y - 1], [$x, $y + 1]] as [$nx, $ny]) {
                if ($nx >= 0 && $ny >= 0 && $nx < $w && $ny < $h && ($into === null || $into[$ny * $w + $nx])) {
                    $out[$ny * $w + $nx] = true;
                }
            }
        }

        return $out;
    }

    /** Which pixels of a region (at rx0, ry0, rw × rh) are inside a polygon, scaled about its middle by $grow. */
    private static function polygonMask(array $polygon, int $rx0, int $ry0, int $rw, int $rh, float $grow): array
    {
        $cx = array_sum(array_column($polygon, 0)) / count($polygon);
        $cy = array_sum(array_column($polygon, 1)) / count($polygon);
        $pts = array_map(fn ($p) => [$cx + ($p[0] - $cx) * $grow - $rx0, $cy + ($p[1] - $cy) * $grow - $ry0], $polygon);
        $mask = array_fill(0, $rw * $rh, false);
        $n = count($pts);
        for ($y = 0; $y < $rh; $y++) {
            // Where each edge crosses this row, and fill between pairs.
            $xs = [];
            for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
                [$xi, $yi] = $pts[$i];
                [$xj, $yj] = $pts[$j];
                if (($yi > $y) !== ($yj > $y)) {
                    $xs[] = $xi + ($y - $yi) / ($yj - $yi) * ($xj - $xi);
                }
            }
            sort($xs);
            for ($k = 0; $k + 1 < count($xs); $k += 2) {
                for ($x = max(0, (int) ceil($xs[$k])); $x <= min($rw - 1, (int) floor($xs[$k + 1])); $x++) {
                    $mask[$y * $rw + $x] = true;
                }
            }
        }

        return $mask;
    }
}
