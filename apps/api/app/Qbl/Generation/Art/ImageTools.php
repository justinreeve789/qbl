<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\GenerationError;
use GdImage;

/**
 * The picture work done after a picture is drawn, with GD only (no ImageMagick, no Python), so it runs
 * in the app container as it is: cutting out the chroma background, finding the frames in an animation
 * strip, trimming, sizing, matching colours between pictures, pulling colours towards the style's
 * palette, and laying frames out as a sprite sheet.
 *
 * Every function that changes a picture returns a new one.
 */
final class ImageTools
{
    public static function load(string $bytes): GdImage
    {
        $im = @imagecreatefromstring($bytes);
        if (! $im) {
            throw new GenerationError('The picture could not be read.');
        }
        if (! imageistruecolor($im)) {
            imagepalettetotruecolor($im);
        }
        imagealphablending($im, false);
        imagesavealpha($im, true);

        return $im;
    }

    public static function blank(int $w, int $h): GdImage
    {
        $im = imagecreatetruecolor(max(1, $w), max(1, $h));
        imagealphablending($im, false);
        imagesavealpha($im, true);
        imagefill($im, 0, 0, imagecolorallocatealpha($im, 0, 0, 0, 127));

        return $im;
    }

    public static function png(GdImage $im): string
    {
        imagesavealpha($im, true);
        ob_start();
        imagepng($im, null, 9);

        return (string) ob_get_clean();
    }

    public static function jpeg(GdImage $im, int $quality = 88): string
    {
        ob_start();
        imagejpeg($im, null, $quality);

        return (string) ob_get_clean();
    }

    public static function resize(GdImage $im, int $w, int $h): GdImage
    {
        $out = self::blank($w, $h);
        imagecopyresampled($out, $im, 0, 0, 0, 0, $w, $h, imagesx($im), imagesy($im));

        return $out;
    }

    /** Scaled down (never up) to fit inside w x h. */
    public static function fit(GdImage $im, int $w, int $h): GdImage
    {
        $s = min(1, $w / imagesx($im), $h / imagesy($im));

        return $s >= 1 ? self::copy($im) : self::resize($im, max(1, (int) round(imagesx($im) * $s)), max(1, (int) round(imagesy($im) * $s)));
    }

    /** Cropped to the aspect of w x h about the centre, then resized to exactly w x h. */
    public static function cover(GdImage $im, int $w, int $h): GdImage
    {
        $sw = imagesx($im);
        $sh = imagesy($im);
        $scale = max($w / $sw, $h / $sh);
        $cw = (int) round($w / $scale);
        $ch = (int) round($h / $scale);
        $out = self::blank($w, $h);
        imagecopyresampled($out, $im, 0, 0, (int) (($sw - $cw) / 2), (int) (($sh - $ch) / 2), $w, $h, $cw, $ch);

        return $out;
    }

    public static function crop(GdImage $im, int $x, int $y, int $w, int $h): GdImage
    {
        $out = self::blank($w, $h);
        imagecopy($out, $im, 0, 0, $x, $y, $w, $h);

        return $out;
    }

    public static function copy(GdImage $im): GdImage
    {
        return self::crop($im, 0, 0, imagesx($im), imagesy($im));
    }

    /** Whether the picture already has a transparent background (its corners are see-through). */
    public static function hasTransparentBackground(GdImage $im): bool
    {
        $w = imagesx($im) - 1;
        $h = imagesy($im) - 1;
        $clear = 0;
        foreach ([[0, 0], [$w, 0], [0, $h], [$w, $h]] as [$x, $y]) {
            $clear += ((imagecolorat($im, $x, $y) >> 24) & 0x7F) > 100 ? 1 : 0;
        }

        return $clear >= 3;
    }

    /**
     * Remove the flat chroma background. Pixels close to the key colour that touch the border (by a path
     * of such pixels) go, and so do pixels very close to it anywhere (the gap between an arm and a body).
     * Edge pixels are softened and have the key colour's tint taken out of them.
     */
    public static function chromaKey(GdImage $src, array $key, int $near = 120, int $exact = 70, bool $anywhere = true): GdImage
    {
        $im = self::copy($src);
        $w = imagesx($im);
        $h = imagesy($im);
        [$kr, $kg, $kb] = $key;
        $dist = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($im, $x, $y);
                $dist[$y * $w + $x] = (int) sqrt((((($c >> 16) & 255) - $kr) ** 2) + (((($c >> 8) & 255) - $kg) ** 2) + ((($c & 255) - $kb) ** 2));
            }
        }
        $gone = [];
        $queue = new \SplQueue;
        for ($x = 0; $x < $w; $x++) {
            foreach ([$x, ($h - 1) * $w + $x] as $i) {
                if ($dist[$i] < $near && ! isset($gone[$i])) {
                    $gone[$i] = true;
                    $queue->enqueue($i);
                }
            }
        }
        for ($y = 0; $y < $h; $y++) {
            foreach ([$y * $w, $y * $w + $w - 1] as $i) {
                if ($dist[$i] < $near && ! isset($gone[$i])) {
                    $gone[$i] = true;
                    $queue->enqueue($i);
                }
            }
        }
        // Enclosed pockets of background (between an arm and a body) do not touch the border: start a fill
        // from every pixel that is the key colour almost exactly, so their soft edges go too.
        if ($anywhere) {
            foreach ($dist as $i => $d) {
                if ($d < $exact && ! isset($gone[$i])) {
                    $gone[$i] = true;
                    $queue->enqueue($i);
                }
            }
        }
        while (! $queue->isEmpty()) {
            $i = $queue->dequeue();
            $x = $i % $w;
            foreach ([$x > 0 ? $i - 1 : -1, $x < $w - 1 ? $i + 1 : -1, $i - $w, $i + $w] as $n) {
                if ($n >= 0 && $n < $w * $h && ! isset($gone[$n]) && $dist[$n] < $near) {
                    $gone[$n] = true;
                    $queue->enqueue($n);
                }
            }
        }
        // Only for a true chroma colour: a white or grey background must not take the whites of the eyes with it.
        if ($anywhere) {
            foreach ($dist as $i => $d) {
                if ($d < $exact) {
                    $gone[$i] = true;
                }
            }
        }
        $clear = imagecolorallocatealpha($im, 0, 0, 0, 127);
        foreach ($gone as $i => $_) {
            imagesetpixel($im, $i % $w, intdiv($i, $w), $clear);
        }
        // Soften the edge: a kept pixel next to a removed one, still tinted by the key, is partly see-through
        // and takes the colour of its solid neighbours.
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $i = $y * $w + $x;
                if (isset($gone[$i]) || $dist[$i] > $near * 1.7) {
                    continue;
                }
                $edge = false;
                $sum = [0, 0, 0];
                $n = 0;
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $xx = $x + $dx;
                        $yy = $y + $dy;
                        if ($xx < 0 || $yy < 0 || $xx >= $w || $yy >= $h) {
                            continue;
                        }
                        $j = $yy * $w + $xx;
                        if (isset($gone[$j])) {
                            $edge = true;
                        } elseif ($dist[$j] > $near * 1.7) {
                            $c = imagecolorat($im, $xx, $yy);
                            $sum[0] += ($c >> 16) & 255;
                            $sum[1] += ($c >> 8) & 255;
                            $sum[2] += $c & 255;
                            $n++;
                        }
                    }
                }
                if (! $edge) {
                    continue;
                }
                $alpha = (int) round(127 * (1 - min(1, max(0, ($dist[$i] - $exact) / ($near * 1.7 - $exact)))));
                $c = imagecolorat($im, $x, $y);
                [$r, $g, $b] = $n ? [intdiv($sum[0], $n), intdiv($sum[1], $n), intdiv($sum[2], $n)] : [($c >> 16) & 255, ($c >> 8) & 255, $c & 255];
                imagesetpixel($im, $x, $y, imagecolorallocatealpha($im, $r, $g, $b, min(127, $alpha)));
            }
        }

        return $im;
    }

    /**
     * The colour a picture was drawn on, if its border is one flat colour (at least 85% of border pixels
     * within a small distance of their median), else null. Image models do not always use the chroma
     * colour they were asked for; this finds what they used instead.
     */
    public static function borderColour(GdImage $im): ?array
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $samples = [];
        $step = max(1, intdiv($w + $h, 400));
        for ($x = 0; $x < $w; $x += $step) {
            $samples[] = imagecolorat($im, $x, 0);
            $samples[] = imagecolorat($im, $x, $h - 1);
        }
        for ($y = 0; $y < $h; $y += $step) {
            $samples[] = imagecolorat($im, 0, $y);
            $samples[] = imagecolorat($im, $w - 1, $y);
        }
        $channel = function (int $shift) use ($samples) {
            $v = array_map(fn ($c) => ($c >> $shift) & 255, $samples);
            sort($v);

            return $v[intdiv(count($v), 2)];
        };
        $median = [$channel(16), $channel(8), $channel(0)];
        $close = 0;
        foreach ($samples as $c) {
            $d = sqrt(((($c >> 16) & 255) - $median[0]) ** 2 + ((($c >> 8) & 255) - $median[1]) ** 2 + (($c & 255) - $median[2]) ** 2);
            $close += $d < 40 ? 1 : 0;
        }

        return $close >= 0.85 * count($samples) ? $median : null;
    }

    /**
     * Take the key colour's tint out of the edge of a cut-out: within $band pixels of the removed
     * background, a pixel tinted towards the key (a glow or soft shadow drawn on it) is made partly
     * see-through and has the tint removed. For a magenta key the tint is red and blue above green.
     */
    public static function despill(GdImage $src, array $key, int $band = 4): GdImage
    {
        $im = self::copy($src);
        $w = imagesx($im);
        $h = imagesy($im);
        // Which channels the key is strong in: magenta = red and blue; green = green.
        $strong = array_keys(array_filter($key, fn ($v) => $v > 160));
        $weak = array_keys(array_filter($key, fn ($v) => $v < 90));
        if (! $strong || ! $weak) {
            return $im; // not a saturated key colour; nothing to take out
        }
        $near = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) >= 120) {
                    $near[$y * $w + $x] = 0;
                }
            }
        }
        $frontier = array_keys($near);
        for ($d = 1; $d <= $band; $d++) {
            $next = [];
            foreach ($frontier as $i) {
                $x = $i % $w;
                foreach ([$x > 0 ? $i - 1 : -1, $x < $w - 1 ? $i + 1 : -1, $i - $w, $i + $w] as $n) {
                    if ($n >= 0 && $n < $w * $h && ! isset($near[$n])) {
                        $near[$n] = $d;
                        $next[] = $n;
                    }
                }
            }
            $frontier = $next;
        }
        foreach ($near as $i => $d) {
            if ($d === 0) {
                continue;
            }
            $x = $i % $w;
            $y = intdiv($i, $w);
            $c = imagecolorat($im, $x, $y);
            $rgb = [($c >> 16) & 255, ($c >> 8) & 255, $c & 255];
            $spill = min(array_map(fn ($k) => $rgb[$k], $strong)) - max(array_map(fn ($k) => $rgb[$k], $weak));
            if ($spill <= 25) {
                continue;
            }
            foreach ($strong as $k) {
                $rgb[$k] = max(0, $rgb[$k] - (int) ($spill * 0.8));
            }
            $alpha = ($c >> 24) & 0x7F;
            // Strongest at the edge, fading over the band.
            $alpha = min(127, $alpha + (int) (127 * min(1, $spill / 160) * (1 - ($d - 1) / $band)));
            imagesetpixel($im, $x, $y, ($alpha << 24) | ($rgb[0] << 16) | ($rgb[1] << 8) | $rgb[2]);
        }

        return $im;
    }

    /** The box around everything not see-through: [x, y, w, h], or null for an empty picture. */
    public static function bbox(GdImage $im, int $threshold = 100): ?array
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $x0 = $w;
        $y0 = $h;
        $x1 = -1;
        $y1 = -1;
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < $threshold) {
                    $x0 = min($x0, $x);
                    $x1 = max($x1, $x);
                    $y0 = min($y0, $y);
                    $y1 = max($y1, $y);
                }
            }
        }

        return $x1 < 0 ? null : [$x0, $y0, $x1 - $x0 + 1, $y1 - $y0 + 1];
    }

    public static function trim(GdImage $im, int $pad = 0): GdImage
    {
        $box = self::bbox($im) ?? throw new GenerationError('The picture is empty once its background is removed.');
        $out = self::blank($box[2] + 2 * $pad, $box[3] + 2 * $pad);
        imagecopy($out, $im, $pad, $pad, $box[0], $box[1], $box[2], $box[3]);

        return $out;
    }

    /**
     * The separate figures in a cut-out strip, left to right, as boxes [x, y, w, h]. Small pieces (a
     * hand drawn apart from its arm, a speck) are joined to the figure they overlap or are nearest to.
     */
    public static function figures(GdImage $im): array
    {
        return array_map(fn ($f) => $f['box'], self::figureParts($im));
    }

    /**
     * Each figure of a cut-out strip as its own picture, left to right. Only the figure's own pixels are
     * taken: a neighbour's outstretched hand inside its box is left out.
     *
     * @return GdImage[]
     */
    public static function figureCrops(GdImage $im): array
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $out = [];
        foreach (self::figureParts($im) as $f) {
            [$x0, $y0, $fw, $fh] = $f['box'];
            $crop = self::crop($im, $x0, $y0, $fw, $fh);
            $clear = imagecolorallocatealpha($crop, 0, 0, 0, 127);
            $s = $f['scale'];
            for ($y = 0; $y < $fh; $y++) {
                for ($x = 0; $x < $fw; $x++) {
                    $gx = intdiv($x0 + $x, $s);
                    $gy = intdiv($y0 + $y, $s);
                    // Kept if this grid cell, or one next to it, belongs to the figure (edges are soft).
                    $mine = false;
                    for ($dy = -1; $dy <= 1 && ! $mine; $dy++) {
                        for ($dx = -1; $dx <= 1 && ! $mine; $dx++) {
                            $mine = isset($f['cells'][($gy + $dy) * $f['grid'] + $gx + $dx]);
                        }
                    }
                    if (! $mine) {
                        imagesetpixel($crop, $x, $y, $clear);
                    }
                }
            }
            $out[] = $crop;
        }

        return $out;
    }

    /** @return array<array{box: array, cells: array<int, true>, grid: int, scale: int}> */
    private static function figureParts(GdImage $im): array
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $s = max(1, (int) round(max($w, $h) / 500)); // work on a coarser grid; it is only for finding boxes
        $gw = intdiv($w + $s - 1, $s);
        $gh = intdiv($h + $s - 1, $s);
        $solid = [];
        for ($gy = 0; $gy < $gh; $gy++) {
            for ($gx = 0; $gx < $gw; $gx++) {
                $x = min($w - 1, $gx * $s + intdiv($s, 2));
                $y = min($h - 1, $gy * $s + intdiv($s, 2));
                if (((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 90) {
                    $solid[$gy * $gw + $gx] = true;
                }
            }
        }
        // A ground line drawn under all the frames joins them into one shape. Take out long, thin
        // horizontal runs: cells in a row that is mostly solid, whose solid column is only a few
        // cells tall there (feet and bodies are much taller).
        $rowCount = array_fill(0, $gh, 0);
        foreach ($solid as $i => $_) {
            $rowCount[intdiv($i, $gw)]++;
        }
        foreach ($rowCount as $gy => $n) {
            if ($n < 0.45 * $gw) {
                continue;
            }
            for ($gx = 0; $gx < $gw; $gx++) {
                $i = $gy * $gw + $gx;
                if (! isset($solid[$i])) {
                    continue;
                }
                $run = 1;
                for ($y = $gy - 1; $y >= 0 && isset($solid[$y * $gw + $gx]) && $run <= 4; $y--) {
                    $run++;
                }
                for ($y = $gy + 1; $y < $gh && isset($solid[$y * $gw + $gx]) && $run <= 4; $y++) {
                    $run++;
                }
                if ($run <= 4) {
                    $thin[$i] = true;
                }
            }
        }
        foreach ($thin ?? [] as $i => $_) {
            unset($solid[$i]);
        }

        $seen = [];
        $boxes = [];
        foreach ($solid as $start => $_) {
            if (isset($seen[$start])) {
                continue;
            }
            $seen[$start] = true;
            $stack = [$start];
            $cells = [];
            [$x0, $y0, $x1, $y1, $n] = [PHP_INT_MAX, PHP_INT_MAX, -1, -1, 0];
            while ($stack) {
                $i = array_pop($stack);
                $cells[$i] = true;
                $gx = $i % $gw;
                $gy = intdiv($i, $gw);
                $x0 = min($x0, $gx);
                $x1 = max($x1, $gx);
                $y0 = min($y0, $gy);
                $y1 = max($y1, $gy);
                $n++;
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $nx = $gx + $dx;
                        $ny = $gy + $dy;
                        $j = $ny * $gw + $nx;
                        if ($nx >= 0 && $ny >= 0 && $nx < $gw && $ny < $gh && isset($solid[$j]) && ! isset($seen[$j])) {
                            $seen[$j] = true;
                            $stack[] = $j;
                        }
                    }
                }
            }
            $boxes[] = ['x0' => $x0 * $s, 'y0' => $y0 * $s, 'x1' => min($w - 1, ($x1 + 1) * $s), 'y1' => min($h - 1, ($y1 + 1) * $s), 'n' => $n, 'cells' => $cells];
        }
        if (! $boxes) {
            return [];
        }
        $largest = max(array_column($boxes, 'n'));
        $big = array_values(array_filter($boxes, fn ($b) => $b['n'] >= $largest * 0.12));
        $small = array_filter($boxes, fn ($b) => $b['n'] < $largest * 0.12 && $b['n'] >= $largest * 0.003);
        foreach ($small as $piece) {
            $cx = ($piece['x0'] + $piece['x1']) / 2;
            $best = null;
            $bestDistance = PHP_INT_MAX;
            foreach ($big as $k => $b) {
                $d = $cx < $b['x0'] ? $b['x0'] - $cx : ($cx > $b['x1'] ? $cx - $b['x1'] : 0);
                if ($d < $bestDistance) {
                    [$best, $bestDistance] = [$k, $d];
                }
            }
            if ($best !== null && $bestDistance < ($big[$best]['x1'] - $big[$best]['x0']) * 0.6) {
                foreach (['x0' => 'min', 'y0' => 'min', 'x1' => 'max', 'y1' => 'max'] as $edge => $f) {
                    $big[$best][$edge] = $f($big[$best][$edge], $piece[$edge]);
                }
                $big[$best]['cells'] += $piece['cells'];
            }
        }
        // Figures whose boxes overlap a lot are one figure (an arm crossing in front of the next frame's space).
        usort($big, fn ($a, $b) => $a['x0'] <=> $b['x0']);
        $merged = [];
        foreach ($big as $b) {
            $last = end($merged);
            if ($last && $b['x0'] < $last['x1'] - 0.5 * min($b['x1'] - $b['x0'], $last['x1'] - $last['x0'])) {
                $k = array_key_last($merged);
                foreach (['x0' => 'min', 'y0' => 'min', 'x1' => 'max', 'y1' => 'max'] as $edge => $f) {
                    $merged[$k][$edge] = $f($merged[$k][$edge], $b[$edge]);
                }
                $merged[$k]['cells'] += $b['cells'];
            } else {
                $merged[] = $b;
            }
        }

        return array_map(fn ($b) => ['box' => [$b['x0'], $b['y0'], $b['x1'] - $b['x0'] + 1, $b['y1'] - $b['y0'] + 1], 'cells' => $b['cells'], 'grid' => $gw, 'scale' => $s], $merged);
    }

    /** Horizontal centre of mass of what is not see-through. */
    public static function centroidX(GdImage $im): float
    {
        $sum = 0;
        $weight = 0;
        $w = imagesx($im);
        $h = imagesy($im);
        for ($y = 0; $y < $h; $y += 2) {
            for ($x = 0; $x < $w; $x += 2) {
                $a = 127 - ((imagecolorat($im, $x, $y) >> 24) & 0x7F);
                $sum += $a * $x;
                $weight += $a;
            }
        }

        return $weight ? $sum / $weight : $w / 2;
    }

    /**
     * A frame in a cell of a sprite sheet: scaled by $scale, its feet $pad pixels above the cell's bottom,
     * its centre of mass in the middle.
     */
    public static function cell(GdImage $frame, int $cellW, int $cellH, float $scale, int $pad = 6): GdImage
    {
        $fw = max(1, (int) round(imagesx($frame) * $scale));
        $fh = max(1, (int) round(imagesy($frame) * $scale));
        if ($fh > $cellH - $pad || $fw > $cellW) {
            $fit = min(($cellH - $pad) / $fh, $cellW / $fw);
            $fw = (int) floor($fw * $fit);
            $fh = (int) floor($fh * $fit);
        }
        $scaled = self::resize($frame, $fw, $fh);
        $cx = self::centroidX($scaled);
        $x = (int) round($cellW / 2 - $cx);
        $x = max(0, min($cellW - $fw, $x));
        $out = self::blank($cellW, $cellH);
        imagecopy($out, $scaled, $x, $cellH - $pad - $fh, 0, 0, $fw, $fh);

        return $out;
    }

    /** @param GdImage[][] $rows */
    public static function sheet(array $rows, int $cellW, int $cellH, int $columns): GdImage
    {
        $out = self::blank($cellW * $columns, $cellH * count($rows));
        imagealphablending($out, true);
        foreach (array_values($rows) as $r => $frames) {
            foreach (array_values($frames) as $c => $frame) {
                imagecopy($out, $frame, $c * $cellW, $r * $cellH, 0, 0, $cellW, $cellH);
            }
        }
        imagealphablending($out, false);

        return $out;
    }

    // ------------------------------------------------------------------ colour

    /** Mean and spread of the picture's colours in Lab, over what is not see-through. */
    public static function labStats(GdImage $im): array
    {
        $w = imagesx($im);
        $h = imagesy($im);
        $step = max(1, (int) floor(sqrt($w * $h / 40000)));
        $sum = [0, 0, 0];
        $sq = [0, 0, 0];
        $n = 0;
        for ($y = 0; $y < $h; $y += $step) {
            for ($x = 0; $x < $w; $x += $step) {
                $c = imagecolorat($im, $x, $y);
                if ((($c >> 24) & 0x7F) > 60) {
                    continue;
                }
                $lab = self::lab(($c >> 16) & 255, ($c >> 8) & 255, $c & 255);
                for ($k = 0; $k < 3; $k++) {
                    $sum[$k] += $lab[$k];
                    $sq[$k] += $lab[$k] ** 2;
                }
                $n++;
            }
        }
        if (! $n) {
            return ['mean' => [50, 0, 0], 'std' => [1, 1, 1]];
        }
        $mean = array_map(fn ($s) => $s / $n, $sum);
        $std = [];
        for ($k = 0; $k < 3; $k++) {
            $std[$k] = max(0.5, sqrt(max(0, $sq[$k] / $n - $mean[$k] ** 2)));
        }

        return ['mean' => $mean, 'std' => $std];
    }

    /**
     * Shift a picture's colours so their mean and spread match another's (Reinhard colour transfer),
     * by $strength. Used to make an animation's frames, drawn in another request, the same tint as the
     * character sheet they were drawn from.
     */
    public static function matchColours(GdImage $src, array $from, array $to, float $strength = 1.0): GdImage
    {
        $im = self::copy($src);
        $w = imagesx($im);
        $h = imagesy($im);
        $cache = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($im, $x, $y);
                $a = ($c >> 24) & 0x7F;
                if ($a >= 127) {
                    continue;
                }
                $rgb = $c & 0xFFFFFF;
                if (! isset($cache[$rgb])) {
                    $lab = self::lab(($rgb >> 16) & 255, ($rgb >> 8) & 255, $rgb & 255);
                    for ($k = 0; $k < 3; $k++) {
                        $t = ($lab[$k] - $from['mean'][$k]) * ($to['std'][$k] / $from['std'][$k]) + $to['mean'][$k];
                        $lab[$k] += ($t - $lab[$k]) * $strength;
                    }
                    $cache[$rgb] = self::rgbFromLab(...$lab);
                }
                [$r, $g, $b] = $cache[$rgb];
                imagesetpixel($im, $x, $y, ($a << 24) | ($r << 16) | ($g << 8) | $b);
            }
        }

        return $im;
    }

    /**
     * Move every colour $strength of the way towards the nearest palette colour (by perceived
     * difference, in Lab). Colours are looked up on a 5-bit grid, so this is quick even for backgrounds.
     *
     * @param  array<array{int,int,int}>  $palette
     */
    public static function pullToPalette(GdImage $src, array $palette, float $strength): GdImage
    {
        if ($strength <= 0 || ! $palette) {
            return $src;
        }
        $labs = array_map(fn ($p) => self::lab(...$p), array_values($palette));
        $im = self::copy($src);
        $w = imagesx($im);
        $h = imagesy($im);
        $lut = [];
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($im, $x, $y);
                $a = ($c >> 24) & 0x7F;
                if ($a >= 127) {
                    continue;
                }
                $r = ($c >> 16) & 255;
                $g = ($c >> 8) & 255;
                $b = $c & 255;
                // Worked out once per cell of a 6-bit grid, at the cell's centre; the pixel's own offset
                // from the centre is added back, so fine shading is kept exactly.
                $q = (($r >> 2) << 12) | (($g >> 2) << 6) | ($b >> 2);
                if (! isset($lut[$q])) {
                    [$cr, $cg, $cb] = [($r & 0xFC) | 2, ($g & 0xFC) | 2, ($b & 0xFC) | 2];
                    $lab = self::lab($cr, $cg, $cb);
                    $best = 0;
                    $bestD = PHP_FLOAT_MAX;
                    foreach ($labs as $i => $p) {
                        $d = ($lab[0] - $p[0]) ** 2 + ($lab[1] - $p[1]) ** 2 + ($lab[2] - $p[2]) ** 2;
                        if ($d < $bestD) {
                            [$best, $bestD] = [$i, $d];
                        }
                    }
                    // Lightness is kept, so shading survives; hue and saturation move towards the palette.
                    [$nr, $ng, $nb] = self::rgbFromLab($lab[0], $lab[1] + ($labs[$best][1] - $lab[1]) * $strength, $lab[2] + ($labs[$best][2] - $lab[2]) * $strength);
                    $lut[$q] = [$nr - $cr, $ng - $cg, $nb - $cb];
                }
                [$dr, $dg, $db] = $lut[$q];
                $nr = max(0, min(255, $r + $dr));
                $ng = max(0, min(255, $g + $dg));
                $nb = max(0, min(255, $b + $db));
                imagesetpixel($im, $x, $y, ($a << 24) | ($nr << 16) | ($ng << 8) | $nb);
            }
        }

        return $im;
    }

    /**
     * How far a picture's colours are from the palette: the average perceived difference (Delta E) from
     * each sampled colour to its nearest palette colour. Under ~12 is close; over ~25, off-palette.
     */
    public static function paletteDistance(GdImage $im, array $palette): float
    {
        $labs = array_map(fn ($p) => self::lab(...$p), array_values($palette));
        $w = imagesx($im);
        $h = imagesy($im);
        $step = max(1, (int) floor(sqrt($w * $h / 20000)));
        $total = 0;
        $n = 0;
        for ($y = 0; $y < $h; $y += $step) {
            for ($x = 0; $x < $w; $x += $step) {
                $c = imagecolorat($im, $x, $y);
                if ((($c >> 24) & 0x7F) > 60) {
                    continue;
                }
                $lab = self::lab(($c >> 16) & 255, ($c >> 8) & 255, $c & 255);
                $best = PHP_FLOAT_MAX;
                foreach ($labs as $p) {
                    $best = min($best, ($lab[0] - $p[0]) ** 2 + ($lab[1] - $p[1]) ** 2 + ($lab[2] - $p[2]) ** 2);
                }
                $total += sqrt($best);
                $n++;
            }
        }

        return $n ? round($total / $n, 1) : 0.0;
    }

    public static function lab(int $r, int $g, int $b): array
    {
        $lin = fn ($c) => ($c /= 255) <= 0.04045 ? $c / 12.92 : (($c + 0.055) / 1.055) ** 2.4;
        [$r, $g, $b] = [$lin($r), $lin($g), $lin($b)];
        $x = ($r * 0.4124 + $g * 0.3576 + $b * 0.1805) / 0.95047;
        $y = ($r * 0.2126 + $g * 0.7152 + $b * 0.0722);
        $z = ($r * 0.0193 + $g * 0.1192 + $b * 0.9505) / 1.08883;
        $f = fn ($t) => $t > 0.008856 ? $t ** (1 / 3) : 7.787 * $t + 16 / 116;

        return [116 * $f($y) - 16, 500 * ($f($x) - $f($y)), 200 * ($f($y) - $f($z))];
    }

    public static function rgbFromLab(float $l, float $a, float $b): array
    {
        $fy = ($l + 16) / 116;
        $fx = $a / 500 + $fy;
        $fz = $fy - $b / 200;
        $inv = fn ($t) => $t ** 3 > 0.008856 ? $t ** 3 : ($t - 16 / 116) / 7.787;
        [$x, $y, $z] = [$inv($fx) * 0.95047, $inv($fy), $inv($fz) * 1.08883];
        $r = $x * 3.2406 + $y * -1.5372 + $z * -0.4986;
        $g = $x * -0.9689 + $y * 1.8758 + $z * 0.0415;
        $bl = $x * 0.0557 + $y * -0.2040 + $z * 1.0570;
        $gamma = fn ($c) => (int) round(255 * max(0, min(1, $c <= 0.0031308 ? 12.92 * $c : 1.055 * ($c ** (1 / 2.4)) - 0.055)));

        return [$gamma($r), $gamma($g), $gamma($bl)];
    }
}
