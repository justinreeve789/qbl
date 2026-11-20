<?php

namespace App\Qbl\Generation\Art\Providers;

use App\Qbl\Generation\Art\ImageGenerator;

/**
 * Draws simple labelled shapes with GD, locally and for free: for trying the whole pipeline out
 * (`qbl:generate --images=placeholder`), for laying out a mission before paying for art, and for the
 * tests. Cut-outs are drawn on the chroma colour, like a real provider's, so the same cutting,
 * slicing and sheet-building runs on them.
 */
class PlaceholderImageGenerator implements ImageGenerator
{
    /** @param array{int,int,int} $chroma */
    public function __construct(private array $chroma = [255, 0, 255], private array $palette = []) {}

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        [$aw, $ah] = array_map('intval', explode(':', $aspect.':1'));
        $w = 1024;
        $h = (int) round($w * $ah / max(1, $aw));
        if ($ah > $aw) {
            [$w, $h] = [(int) round(1024 * $aw / $ah), 1024];
        }
        $im = imagecreatetruecolor($w, $h);
        $kind = $hints['kind'] ?? 'item';
        $seed = crc32(($hints['label'] ?? '').$kind);
        $colour = fn (int $i) => $this->colour($im, $seed, $i);
        $outline = imagecolorallocate($im, 43, 35, 64);
        imagesetthickness($im, 4);

        if ($kind === 'background') {
            $ground = (int) ($h * ($hints['ground_line'] ?? 0.7));
            for ($y = 0; $y < $ground; $y++) {
                $t = $y / max(1, $ground);
                imageline($im, 0, $y, $w, $y, imagecolorallocate($im, (int) (124 + 80 * $t), (int) (198 + 40 * $t), 242));
            }
            for ($i = 0; $i < 5; $i++) {
                $cx = (int) (($i + 0.5) * $w / 5);
                imagefilledellipse($im, $cx, $ground, (int) ($w / 3), (int) ($ground * 0.9), $colour($i));
                imageellipse($im, $cx, $ground, (int) ($w / 3), (int) ($ground * 0.9), $outline);
            }
            imagefilledrectangle($im, 0, $ground, $w, $h, $colour(7));
            imageline($im, 0, $ground, $w, $ground, $outline);
            $this->text($im, $hints['label'] ?? 'background', (int) ($w / 2), (int) ($ground / 3), $outline);

            return $this->png($im);
        }

        $bg = $transparent ? imagecolorallocatealpha($im, 0, 0, 0, 127) : imagecolorallocate($im, ...$this->chroma);
        imagealphablending($im, false);
        imagefilledrectangle($im, 0, 0, $w, $h, $bg);
        imagealphablending($im, true);
        imagesavealpha($im, true);

        if ($kind === 'strip' || $kind === 'character') {
            $frames = $kind === 'strip' ? max(1, (int) ($hints['frames'] ?? 4)) : 1;
            $cell = $w / $frames;
            for ($f = 0; $f < $frames; $f++) {
                $cx = (int) (($f + 0.5) * $cell);
                $this->figure($im, $cx, (int) ($h * 0.9), (int) min($cell * 0.8, $h * 0.75), $f, $frames, $colour, $outline, $hints['animation'] ?? 'idle');
            }
        } elseif ($kind === 'passage') {
            $this->passage($im, $w, $h, $hints['via'] ?? 'door', $colour, $outline);
        } elseif ($kind === 'opening') {
            // A dark hole lying on the floor, with a rim of ground around it.
            imagefilledellipse($im, (int) ($w / 2), (int) ($h / 2), (int) ($w * 0.86), (int) ($h * 0.5), $colour(6));
            imagefilledellipse($im, (int) ($w / 2), (int) ($h / 2) + 6, (int) ($w * 0.7), (int) ($h * 0.36), imagecolorallocate($im, 30, 22, 40));
            imageellipse($im, (int) ($w / 2), (int) ($h / 2), (int) ($w * 0.86), (int) ($h * 0.5), $outline);
            if (($hints['via'] ?? '') === 'hatch') {
                imagefilledrectangle($im, (int) ($w * 0.45), (int) ($h * 0.3), (int) ($w * 0.55), (int) ($h * 0.6), $colour(6));
            }
        } elseif ($kind === 'portrait') {
            imagefilledellipse($im, (int) ($w / 2), (int) ($h * 1.05), (int) ($w * 0.8), (int) ($h * 0.7), $colour(2));
            imagefilledellipse($im, (int) ($w / 2), (int) ($h * 0.45), (int) ($w * 0.55), (int) ($h * 0.6), $colour(0));
            imageellipse($im, (int) ($w / 2), (int) ($h * 0.45), (int) ($w * 0.55), (int) ($h * 0.6), $outline);
            imagefilledellipse($im, (int) ($w * 0.42), (int) ($h * 0.42), 40, 50, imagecolorallocate($im, 255, 255, 255));
            imagefilledellipse($im, (int) ($w * 0.58), (int) ($h * 0.42), 40, 50, imagecolorallocate($im, 255, 255, 255));
        } else {
            $r = (int) (min($w, $h) * 0.36);
            if ($kind === 'vehicle') {
                imagefilledrectangle($im, (int) ($w * 0.15), (int) ($h * 0.35), (int) ($w * 0.85), (int) ($h * 0.7), $colour(1));
                imagerectangle($im, (int) ($w * 0.15), (int) ($h * 0.35), (int) ($w * 0.85), (int) ($h * 0.7), $outline);
                foreach ([0.3, 0.7] as $wx) {
                    imagefilledellipse($im, (int) ($w * $wx), (int) ($h * 0.72), (int) ($h * 0.25), (int) ($h * 0.25), $outline);
                }
            } else {
                imagefilledellipse($im, (int) ($w / 2), (int) ($h / 2), 2 * $r, 2 * $r, $colour(1));
                imageellipse($im, (int) ($w / 2), (int) ($h / 2), 2 * $r, 2 * $r, $outline);
                imagefilledellipse($im, (int) ($w / 2 - $r / 3), (int) ($h / 2 - $r / 3), (int) ($r / 2), (int) ($r / 2), $colour(4));
            }
            $this->text($im, $hints['label'] ?? $kind, (int) ($w / 2), (int) ($h / 2), $outline);
        }

        return $this->png($im);
    }

    /** A door, gate, cave mouth, portal, tunnel, ladder or stairs, standing on its bottom edge. */
    private function passage(\GdImage $im, int $w, int $h, string $via, \Closure $colour, int $outline): void
    {
        $dark = imagecolorallocate($im, 30, 22, 40);
        $x0 = (int) ($w * 0.2);
        $x1 = (int) ($w * 0.8);
        $top = (int) ($h * 0.08);
        $bottom = (int) ($h * 0.96);
        if ($via === 'ladder') {
            foreach ([0.35, 0.65] as $rx) {
                imagefilledrectangle($im, (int) ($w * $rx) - 10, $top, (int) ($w * $rx) + 10, $bottom, $colour(6));
            }
            for ($y = $top + 40; $y < $bottom; $y += 70) {
                imagefilledrectangle($im, (int) ($w * 0.35), $y, (int) ($w * 0.65), $y + 14, $colour(6));
            }

            return;
        }
        if ($via === 'stairs_up') {
            for ($i = 0; $i < 6; $i++) {
                $y = $bottom - ($i + 1) * (int) (($bottom - $top) / 6);
                imagefilledrectangle($im, $x0 + $i * 20, $y, $x1, $y + (int) (($bottom - $top) / 6), $colour($i % 2 ? 6 : 7));
                imagerectangle($im, $x0 + $i * 20, $y, $x1, $y + (int) (($bottom - $top) / 6), $outline);
            }

            return;
        }
        // A frame or rock face, and a dark arched opening in it.
        imagefilledrectangle($im, $x0 - 30, $top, $x1 + 30, $bottom, $colour($via === 'cave' ? 6 : 1));
        imagerectangle($im, $x0 - 30, $top, $x1 + 30, $bottom, $outline);
        $inner = $via === 'portal' ? $colour(4) : $dark;
        imagefilledrectangle($im, $x0, $top + (int) (($x1 - $x0) / 2), $x1, $bottom, $inner);
        imagefilledellipse($im, (int) ($w / 2), $top + (int) (($x1 - $x0) / 2), $x1 - $x0, $x1 - $x0, $inner);
        if ($via === 'door') {
            imagefilledellipse($im, $x1 - 30, (int) (($top + $bottom) / 2) + 40, 22, 22, $colour(3));
        }
    }

    /** A rounded little figure; walking frames swing the legs, gestures raise an arm. */
    private function figure(\GdImage $im, int $cx, int $feet, int $height, int $frame, int $frames, \Closure $colour, int $outline, string $animation): void
    {
        $head = (int) ($height * 0.28);
        $body = (int) ($height * 0.42);
        $top = $feet - $height;
        $swing = (int) (sin(2 * M_PI * $frame / max(1, $frames)) * $height * 0.08);
        $bob = $animation === 'idle' ? (int) (sin(2 * M_PI * $frame / max(1, $frames)) * 4) : 0;
        imagesetthickness($im, max(4, (int) ($height / 30)));
        imageline($im, $cx - 12, $feet - (int) ($height * 0.3), $cx - 12 + $swing, $feet, $outline);
        imageline($im, $cx + 12, $feet - (int) ($height * 0.3), $cx + 12 - $swing, $feet, $outline);
        imagefilledellipse($im, $cx, $top + $head + (int) ($body / 2) + $bob, (int) ($height * 0.38), $body, $colour(2));
        imageellipse($im, $cx, $top + $head + (int) ($body / 2) + $bob, (int) ($height * 0.38), $body, $outline);
        $arm = in_array($animation, ['wave', 'cheer', 'point'], true) ? -(int) ($height * 0.2) - ($frame % 2) * 10 : (int) ($height * 0.1);
        imageline($im, $cx + (int) ($height * 0.17), $top + $head + (int) ($body * 0.3), $cx + (int) ($height * 0.3), $top + $head + (int) ($body * 0.3) + $arm, $outline);
        imagefilledellipse($im, $cx, $top + (int) ($head / 2) + 6 + $bob, $head, $head, $colour(0));
        imageellipse($im, $cx, $top + (int) ($head / 2) + 6 + $bob, $head, $head, $outline);
        imagefilledellipse($im, $cx + (int) ($head * 0.15), $top + (int) ($head / 2) + $bob, 10, 12, $outline);
    }

    private function colour(\GdImage $im, int $seed, int $i): int
    {
        $palette = array_values($this->palette) ?: [[46, 111, 216], [31, 167, 155], [255, 107, 87], [255, 210, 63], [166, 139, 242], [76, 185, 68], [201, 130, 74], [242, 214, 162]];
        [$r, $g, $b] = $palette[($seed + $i * 7) % count($palette)];

        return imagecolorallocate($im, $r, $g, $b);
    }

    private function text(\GdImage $im, string $text, int $cx, int $cy, int $colour): void
    {
        $text = mb_substr($text, 0, 40);
        $w = imagefontwidth(5) * strlen($text);
        imagestring($im, 5, (int) ($cx - $w / 2), $cy - 8, $text, $colour);
    }

    private function png(\GdImage $im): string
    {
        ob_start();
        imagepng($im);
        imagedestroy($im);

        return (string) ob_get_clean();
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return 'placeholder';
    }
}
