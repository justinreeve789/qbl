<?php

namespace App\Qbl\Generation\Art;

use GdImage;

/**
 * Takes the things that were cut out of a background (ObjectCutter) out of the background itself, so
 * the picture shows what is behind them: a tree's cut-out is the tree, and the background under it is
 * the floor and the wall it stood in front of. Move or delete the cut-out in the editor and there is no
 * second tree painted underneath.
 *
 * Only the pixels under the cut-outs change (their shape, grown by GROW pixels to take their soft
 * edge with it). A cut-out's see-through openings (the floor between a bench's legs) are not holes:
 * that floor is the background's, and stays exactly as painted. Every other pixel of the picture is copied over as it was,
 * and the result is a PNG, so not even a JPEG's re-compression touches the rest.
 *
 * What goes in the holes:
 *
 *   paint  The painter (the run's picture source) is shown the part of the picture around the things
 *          and a mask of them, and asked to draw the same picture without them. Only the masked pixels
 *          of its answer are used, colour-matched to the ring of picture around them. An answer that
 *          does not line up with the picture around the holes, or that left the things where they
 *          were, is not used: the holes are filled instead.
 *   fill   The holes are filled from their edges inwards with the colours around them (flat fills,
 *          as the house style paints, come out cleanly; detail behind a big thing does not).
 *
 * See-through parts of the picture (a sky or water keyed out, for the game to draw behind) stay
 * see-through where the holes continue them.
 */
final class BackgroundCleaner
{
    /**
     * How far past a cut-out's solid pixels the hole reaches: its soft edge (ObjectCutter fades the outline's
     * last two pixels out over the scenery) and a pixel more, for the ringing a JPEG leaves beside a line.
     */
    public const GROW = 3;

    /** The ring of picture around the holes that a painted answer must match, in pixels. */
    private const RING = 14;

    /** The most a painted answer may differ from the picture in that ring (mean per channel, 0 to 255). */
    private const MAX_RING_DIFF = 22.0;

    /** The most of that ring that may not match at all, once the overall colour shift is taken off (a line in the wrong place). */
    private const MAX_RING_MISMATCH = 0.12;

    /** The least a painted answer must change the holes by (mean per channel): else the things are still there. */
    private const MIN_HOLE_CHANGE = 10.0;

    /**
     * @param  list<array{image: GdImage, x: int, y: int, name?: string}>  $cutouts  Each cut-out and where its top left is in the picture.
     * @param  (callable(string, Reference[], string, array): string)|null  $painter  Draws a picture from a prompt, references, an aspect and hints; null: fill only.
     * @param  array{0: int, 1: int, 2: int}  $chroma  The style's flat colour, which a see-through sky or water is painted in.
     * @param  string  $chromaName  That colour as the painter is told it ("flat magenta #FF00FF").
     * @return array{image: GdImage, how: string, holes: int, windows: list<array{x: int, y: int, width: int, height: int, how: string, problem?: string}>}
     *                                                                                                                                                       how: "painted", "filled", "mixed" (some windows each), or "none" (no holes)
     */
    public static function clear(GdImage $picture, array $cutouts, ?callable $painter, array $chroma, string $chromaName = 'the flat chroma colour', ?callable $log = null): array
    {
        $W = imagesx($picture);
        $H = imagesy($picture);
        $out = ImageTools::copy($picture);
        $mask = self::mask($cutouts, $W, $H);
        if (! $mask) {
            return ['image' => $out, 'how' => 'none', 'holes' => 0, 'windows' => []];
        }

        $windows = [];
        foreach (self::windows($cutouts, $W, $H) as $win) {
            // Only this window's own holes are painted or filled from it: another's things are still in its picture.
            $own = self::mask(array_values(array_intersect_key($cutouts, array_flip($win['cutouts']))), $W, $H);
            $entry = ['x' => $win['x'], 'y' => $win['y'], 'width' => $win['width'], 'height' => $win['height']];
            $problem = null;
            if ($painter) {
                try {
                    $problem = self::paint($out, $picture, $own, $mask, $win, $painter, $chroma, $chromaName);
                } catch (\Throwable $e) {
                    $problem = 'the painter failed: '.$e->getMessage();
                }
                if ($problem === null) {
                    $windows[] = $entry + ['how' => 'painted'];

                    continue;
                }
                $log && $log("Could not paint behind {$win['names']}: $problem. Filling it in from around instead.");
            }
            self::fill($out, $own);
            $windows[] = $entry + ['how' => 'filled'] + ($problem ? ['problem' => $problem] : []);
        }
        $hows = array_unique(array_column($windows, 'how'));

        return ['image' => $out, 'how' => count($hows) === 1 ? ($hows[0] === 'painted' ? 'painted' : 'filled') : 'mixed', 'holes' => count($mask), 'windows' => $windows];
    }

    /**
     * Which pixels of the picture are under a cut-out (its pixels that are not see-through), grown by
     * GROW. Keyed y * width + x; only the pixels in a hole are listed.
     *
     * @return array<int, true>
     */
    public static function mask(array $cutouts, int $W, int $H): array
    {
        $mask = [];
        foreach ($cutouts as $c) {
            $im = $c['image'];
            $cw = imagesx($im);
            $ch = imagesy($im);
            for ($y = 0; $y < $ch; $y++) {
                $py = $c['y'] + $y;
                if ($py < 0 || $py >= $H) {
                    continue;
                }
                for ($x = 0; $x < $cw; $x++) {
                    $px = $c['x'] + $x;
                    if ($px >= 0 && $px < $W && ((imagecolorat($im, $x, $y) >> 24) & 0x7F) < 96) {
                        $mask[$py * $W + $px] = true;
                    }
                }
            }
        }
        for ($k = 0; $k < self::GROW; $k++) {
            $grown = $mask;
            foreach ($mask as $i => $_) {
                $x = $i % $W;
                $y = intdiv($i, $W);
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $nx = $x + $dx;
                        $ny = $y + $dy;
                        if ($nx >= 0 && $ny >= 0 && $nx < $W && $ny < $H) {
                            $grown[$ny * $W + $nx] = true;
                        }
                    }
                }
            }
            $mask = $grown;
        }

        return $mask;
    }

    /**
     * The parts of the picture to send to the painter: 16:9 windows the full height of the picture (as a
     * background is drawn), each around one or more holes that fit in it side by side. A hole wider than
     * a window gets a window as wide as it.
     *
     * @return list<array{x: int, y: int, width: int, height: int, box: array{0: int, 1: int, 2: int, 3: int}, names: string, things: list<array{name: string, box: array}>, cutouts: list<int>}>
     */
    private static function windows(array $cutouts, int $W, int $H): array
    {
        $grow = self::GROW + self::RING;
        $spans = [];
        foreach ($cutouts as $n => $c) {
            $spans[] = [
                'n' => $n,
                'x0' => max(0, $c['x'] - $grow), 'x1' => min($W - 1, $c['x'] + imagesx($c['image']) - 1 + $grow),
                'y0' => max(0, $c['y'] - $grow), 'y1' => min($H - 1, $c['y'] + imagesy($c['image']) - 1 + $grow),
                'name' => (string) ($c['name'] ?? 'thing'),
            ];
        }
        usort($spans, fn ($a, $b) => $a['x0'] <=> $b['x0']);
        $ww = min($W, (int) round($H * 16 / 9));
        $groups = [];
        foreach ($spans as $s) {
            $last = array_key_last($groups);
            if ($last !== null && max($groups[$last]['x1'], $s['x1']) - $groups[$last]['x0'] + 1 <= $ww) {
                $g = &$groups[$last];
                $g['x1'] = max($g['x1'], $s['x1']);
                $g['y0'] = min($g['y0'], $s['y0']);
                $g['y1'] = max($g['y1'], $s['y1']);
                $g['spans'][] = $s;
                unset($g);
            } else {
                $groups[] = ['x0' => $s['x0'], 'x1' => $s['x1'], 'y0' => $s['y0'], 'y1' => $s['y1'], 'spans' => [$s]];
            }
        }
        $windows = [];
        foreach ($groups as $g) {
            $w = max($ww, $g['x1'] - $g['x0'] + 1);
            $x = (int) max(0, min($W - $w, intdiv($g['x0'] + $g['x1'], 2) - intdiv($w, 2)));
            $things = array_map(fn ($s) => ['name' => $s['name'], 'box' => [$s['x0'] - $x, $s['y0'], $s['x1'] - $x, $s['y1']]], $g['spans']);
            $windows[] = [
                'x' => $x, 'y' => 0, 'width' => min($W, $w), 'height' => $H,
                'box' => [$g['x0'], $g['y0'], $g['x1'], $g['y1']],
                'names' => implode(', ', array_column($g['spans'], 'name')),
                'things' => $things,
                'cutouts' => array_column($g['spans'], 'n'),
            ];
        }

        return $windows;
    }

    /**
     * Ask the painter for one window without the things in it ($mask, its holes), and put them into
     * $out. The ring it is checked against is outside every hole ($all). Returns why it could not be
     * used, or null when it was.
     */
    private static function paint(GdImage $out, GdImage $picture, array $mask, array $all, array $win, callable $painter, array $chroma, string $chromaName): ?string
    {
        $W = imagesx($picture);
        ['x' => $wx, 'y' => $wy, 'width' => $ww, 'height' => $wh] = $win;

        // What the painter sees: the window, with anything see-through shown in the flat colour it was
        // painted in; and the holes in white on black.
        $shown = imagecreatetruecolor($ww, $wh);
        imagefill($shown, 0, 0, imagecolorallocate($shown, ...$chroma));
        imagealphablending($shown, true);
        imagecopy($shown, $picture, 0, 0, $wx, $wy, $ww, $wh);
        $holes = imagecreatetruecolor($ww, $wh);
        $white = imagecolorallocate($holes, 255, 255, 255);
        foreach ($mask as $i => $_) {
            $x = $i % $W - $wx;
            $y = intdiv($i, $W) - $wy;
            if ($x >= 0 && $y >= 0 && $x < $ww && $y < $wh) {
                imagesetpixel($holes, $x, $y, $white);
            }
        }
        $pct = fn (float $v, int $of) => (int) round(100 * $v / max(1, $of));
        $listed = implode('; ', array_map(fn ($t) => sprintf('%s (from %d%% to %d%% across, %d%% to %d%% down)', $t['name'], $pct($t['box'][0], $ww), $pct($t['box'][2], $ww), $pct($t['box'][1], $wh), $pct($t['box'][3], $wh)), $win['things']));
        $aspect = self::aspect($ww / $wh);
        $prompt = implode("\n", [
            'Draw EXACTLY the picture given as the first reference again: the same place from the same view, the same framing and size, the same composition, colours, line, light and style, every line and every object where it is.',
            "Change only this: take away the things painted white in the second reference (a mask over the first picture): $listed.",
            'Where they were, paint what would be seen behind them, carrying on what is around them: the floor and its paving or grass, the walls, fences, plants and scenery behind, and their lines and shadows. Leave no trace of them: no outline, no shadow, no stump or base.',
            "Where the sky or water is one flat solid colour ($chromaName), keep it exactly that flat colour where it carries on behind them.",
            'Do not add anything new, and do not move, redraw or restyle anything else. No text, no borders.',
        ]);
        $raw = $painter($prompt, [
            new Reference(ImageTools::png($shown), 'the picture to draw again, unchanged apart from the things to take away'),
            new Reference(ImageTools::png($holes), 'a mask over the first picture: white where the things to take away are, black everywhere else'),
        ], $aspect, ['kind' => 'retouch', 'label' => $win['names'], 'window' => [$wx, $wy, $ww, $wh]]);
        $got = ImageTools::load($raw);
        if (imagesx($got) !== $ww || imagesy($got) !== $wh) {
            $got = ImageTools::resize($got, $ww, $wh);
        }

        // Does it line up? The ring of picture around the holes must look as it does in the picture,
        // and the holes must have changed. The ring's difference is also its colour shift, taken off the
        // painted holes so they meet the picture without a seam.
        $ring = self::ring($mask, $all, $W, $win);
        $shift = [0.0, 0.0, 0.0];
        $diff = 0.0;
        $pairs = [];
        foreach ($ring as [$x, $y]) {
            $a = imagecolorat($picture, $x, $y);
            if ((($a >> 24) & 0x7F) > 64) {
                continue;
            }
            $b = imagecolorat($got, $x - $wx, $y - $wy);
            $d = [];
            foreach ([16, 8, 0] as $k => $s) {
                $d[$k] = (($b >> $s) & 0xFF) - (($a >> $s) & 0xFF);
                $shift[$k] += $d[$k];
                $diff += abs($d[$k]);
            }
            $pairs[] = $d;
        }
        $n = count($pairs);
        if ($n < 20) {
            return 'too little of the picture around the things to check the answer against';
        }
        $shift = array_map(fn ($v) => $v / $n, $shift);
        $diff /= 3 * $n;
        $off = count(array_filter($pairs, fn ($d) => abs($d[0] - $shift[0]) + abs($d[1] - $shift[1]) + abs($d[2] - $shift[2]) > 60)) / $n;
        if ($diff > self::MAX_RING_DIFF || $off > self::MAX_RING_MISMATCH) {
            return sprintf('its picture does not line up with this one around them (they differ by %.0f there, %d%% of it not matching)', $diff, round(100 * $off));
        }
        $change = 0.0;
        $m = 0;
        foreach ($mask as $i => $_) {
            $x = $i % $W;
            $y = intdiv($i, $W);
            if ($x < $wx || $y < $wy || $x >= $wx + $ww || $y >= $wy + $wh) {
                continue;
            }
            $a = imagecolorat($picture, $x, $y);
            $b = imagecolorat($got, $x - $wx, $y - $wy);
            $change += abs((($b >> 16) & 0xFF) - (($a >> 16) & 0xFF)) + abs((($b >> 8) & 0xFF) - (($a >> 8) & 0xFF)) + abs(($b & 0xFF) - ($a & 0xFF));
            $m++;
        }
        if ($m && $change / (3 * $m) < self::MIN_HOLE_CHANGE) {
            return 'it left the things where they were';
        }

        // The holes, from the answer: colour-matched, and see-through where it painted the flat colour.
        foreach ($mask as $i => $_) {
            $x = $i % $W;
            $y = intdiv($i, $W);
            if ($x < $wx || $y < $wy || $x >= $wx + $ww || $y >= $wy + $wh) {
                continue;
            }
            $b = imagecolorat($got, $x - $wx, $y - $wy);
            $rgb = [($b >> 16) & 0xFF, ($b >> 8) & 0xFF, $b & 0xFF];
            if (sqrt(($rgb[0] - $chroma[0]) ** 2 + ($rgb[1] - $chroma[1]) ** 2 + ($rgb[2] - $chroma[2]) ** 2) < 90) {
                imagesetpixel($out, $x, $y, imagecolorallocatealpha($out, 0, 0, 0, 127));

                continue;
            }
            $c = array_map(fn ($v, $s) => (int) max(0, min(255, round($v - $s))), $rgb, $shift);
            imagesetpixel($out, $x, $y, imagecolorallocatealpha($out, $c[0], $c[1], $c[2], 0));
        }

        return null;
    }

    /** The pixels within RING of the holes in a window (but not in them), as [x, y] in the picture. */
    private static function ring(array $mask, array $all, int $W, array $win): array
    {
        ['x' => $wx, 'y' => $wy, 'width' => $ww, 'height' => $wh] = $win;
        [$bx0, $by0, $bx1, $by1] = $win['box'];
        $near = [];
        foreach ($mask as $i => $_) {
            $x = $i % $W;
            $y = intdiv($i, $W);
            if ($x < $bx0 || $x > $bx1 || $y < $by0 || $y > $by1) {
                continue;
            }
            // Only from the edge of a hole: a pixel with a neighbour outside it.
            if (isset($mask[$i - 1], $mask[$i + 1], $mask[$i - $W], $mask[$i + $W])) {
                continue;
            }
            for ($dy = -self::RING; $dy <= self::RING; $dy += 2) {
                for ($dx = -self::RING; $dx <= self::RING; $dx += 2) {
                    $nx = $x + $dx;
                    $ny = $y + $dy;
                    if ($nx >= $wx && $ny >= $wy && $nx < $wx + $ww && $ny < $wy + $wh && ! isset($all[$ny * $W + $nx])) {
                        $near[$ny * $W + $nx] = [$nx, $ny];
                    }
                }
            }
        }

        return array_values($near);
    }

    /**
     * Fill holes from their edges inwards: each pixel takes the mean of its neighbours that are
     * already known, ring by ring, and is see-through when most of them are.
     *
     * @param  array<int, true>  $mask  The holes, keyed y * width + x (as mask() makes them).
     */
    public static function fill(GdImage $im, array $mask): void
    {
        $W = imagesx($im);
        $H = imagesy($im);
        $todo = $mask;
        // Colours known so far: [r, g, b, clear], read from the picture as needed.
        $known = [];
        $colour = function (int $i) use (&$known, $im, $W) {
            if (! isset($known[$i])) {
                $c = imagecolorat($im, $i % $W, intdiv($i, $W));
                $known[$i] = [($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF, (($c >> 24) & 0x7F) > 64];
            }

            return $known[$i];
        };
        while ($todo) {
            $ring = [];
            foreach ($todo as $i => $_) {
                $x = $i % $W;
                $y = intdiv($i, $W);
                $sum = [0, 0, 0];
                $solid = 0;
                $clear = 0;
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $nx = $x + $dx;
                        $ny = $y + $dy;
                        $j = $ny * $W + $nx;
                        if (($dx || $dy) && $nx >= 0 && $ny >= 0 && $nx < $W && $ny < $H && ! isset($todo[$j])) {
                            $k = $colour($j);
                            if ($k[3]) {
                                $clear++;
                            } else {
                                $sum[0] += $k[0];
                                $sum[1] += $k[1];
                                $sum[2] += $k[2];
                                $solid++;
                            }
                        }
                    }
                }
                if ($solid + $clear > 0) {
                    $ring[$i] = $clear > $solid ? [0, 0, 0, true] : [intdiv($sum[0], $solid), intdiv($sum[1], $solid), intdiv($sum[2], $solid), false];
                }
            }
            if (! $ring) {
                // Nothing known around what is left (a hole filling the whole picture): leave it as it was.
                break;
            }
            foreach ($ring as $i => $k) {
                $known[$i] = $k;
                unset($todo[$i]);
                imagesetpixel($im, $i % $W, intdiv($i, $W), $k[3] ? imagecolorallocatealpha($im, 0, 0, 0, 127) : imagecolorallocatealpha($im, $k[0], $k[1], $k[2], 0));
            }
        }
    }

    /** The aspect a painter is asked for that is nearest this ratio. */
    private static function aspect(float $ratio): string
    {
        $aspects = ['16:9' => 16 / 9, '21:9' => 21 / 9, '4:3' => 4 / 3, '1:1' => 1.0, '3:4' => 0.75];
        uasort($aspects, fn ($a, $b) => abs(log($ratio / $a)) <=> abs(log($ratio / $b)));

        return (string) array_key_first($aspects);
    }
}
