<?php

namespace App\Qbl\Generation;

use App\Qbl\Generation\Art\ImageTools;
use GdImage;

/**
 * A picture of each generated scene as it will look in the game, before anything is imported: the
 * background, the props, the characters standing in their first frame, and the things to click, with
 * the walkable floor, spawn points and hotspots drawn over it. Written to the run's work folder and put
 * in the ZIP under previews/, so a teacher can see the whole mission at a glance.
 */
final class ScenePreview
{
    /**
     * @param  array  $document  The compiled scenario document (media urls "assets/<file>").
     * @param  array<string, string>  $files  File name => path, as MissionBuilder returns them.
     * @return array<string, string> scene shortname => preview PNG path
     */
    /** The top, middle and horizon of the sky at each time of day, as the game draws them (sky.ts). */
    private const SKY = [
        'dawn' => [[43, 58, 122], [138, 111, 176], [246, 163, 138]],
        'morning' => [[90, 168, 230], [159, 208, 242], [230, 242, 246]],
        'midday' => [[61, 143, 224], [124, 188, 240], [207, 233, 247]],
        'afternoon' => [[74, 150, 220], [140, 194, 238], [232, 238, 221]],
        'golden' => [[91, 136, 200], [233, 183, 126], [255, 207, 122]],
        'sunset' => [[58, 79, 154], [217, 112, 138], [255, 154, 74]],
        'dusk' => [[31, 42, 102], [106, 74, 142], [215, 122, 138]],
        'night' => [[11, 16, 48], [27, 35, 80], [46, 58, 110]],
    ];

    private static function mix(array $a, array $b, float $t): array
    {
        $t = max(0.0, min(1.0, $t));

        return [(int) round($a[0] + ($b[0] - $a[0]) * $t), (int) round($a[1] + ($b[1] - $a[1]) * $t), (int) round($a[2] + ($b[2] - $a[2]) * $t)];
    }

    public static function write(array $document, array $files, string $dir, float $scale = 0.5): array
    {
        if (! is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $media = array_column($document['assets'], null, 'id');
        $load = function (?int $id) use ($media, $files): ?GdImage {
            $file = $files[basename((string) ($media[$id]['url'] ?? ''))] ?? null;

            return $file ? ImageTools::load((string) file_get_contents($file)) : null;
        };
        $characters = array_column($document['characters'], null, 'id');
        $items = array_column($document['items'], null, 'id');
        $out = [];

        foreach ($document['scenes'] as $scene) {
            $w = (int) $scene['width'];
            $h = (int) $scene['height'];
            $im = imagecreatetruecolor($w, $h);
            imagealphablending($im, true);
            // Layers where they are when the view is at the scene's left end (a far view drifts from there).
            $layer = function (array $layer) use ($im, $load, $w, $h) {
                if ($pic = $load($layer['media_id'])) {
                    // A far view drifts as students walk; seen all at once, it is stretched to the scene's width.
                    $dw = ($layer['parallax'] ?? 1) < 1 ? max($w, (int) ($layer['display_width'] ?? $w)) : (int) ($layer['display_width'] ?? $w);
                    imagecopyresampled($im, $pic, (int) ($layer['position_x'] ?? 0), (int) ($layer['position_y'] ?? 0), 0, 0, $dw, (int) ($layer['display_height'] ?? $h), imagesx($pic), imagesy($pic));
                }
            };
            // A living sky behind it all, as students first see it (see packages/shared/src/sky.ts).
            if ($sky = $scene['sky'] ?? null) {
                [$top, $middle, $low] = self::SKY[$sky['time']] ?? self::SKY['midday'];
                $horizon = (int) ($h * ($sky['horizon'] ?? 0.6));
                for ($y = 0; $y < $h; $y++) {
                    $c = $y < $horizon * 0.55 ? self::mix($top, $middle, $y / max(1, $horizon * 0.55)) : ($y < $horizon ? self::mix($middle, $low, ($y - $horizon * 0.55) / max(1, $horizon * 0.45)) : $low);
                    imageline($im, 0, $y, $w, $y, imagecolorallocate($im, ...$c));
                }
            }
            foreach ($scene['background_media'] as $l) {
                $layer($l);
            }
            // Figures and things on the floor are a little smaller at the back of it (the scene's scale area).
            $depth = function (float $y) use ($scene): float {
                foreach ($scene['scale_areas'] ?? [] as $a) {
                    if ($y >= $a['y'] && $y <= $a['y'] + $a['height']) {
                        $t = ($y - $a['y']) / max(1, $a['height']);

                        return ($a['scale_top'] + ($a['scale_bottom'] - $a['scale_top']) * $t) / 100;
                    }
                }

                return 1.0;
            };
            $stand = function (?GdImage $pic, float $x, float $feet, float $s = 1.0) use ($im, $depth) {
                $s *= $depth($feet);
                if ($pic) {
                    $pw = (int) (imagesx($pic) * $s);
                    $ph = (int) (imagesy($pic) * $s);
                    imagecopyresampled($im, $pic, (int) ($x - $pw / 2), (int) ($feet - $ph), 0, 0, $pw, $ph, imagesx($pic), imagesy($pic));
                }
            };
            foreach ($scene['items'] as $p) {
                $item = $items[$p['item_id']] ?? null;
                $stand($item ? $load($item['media_id']) : null, $p['position_x'], $p['position_y'], (float) ($item['scale'] ?? 1));
            }
            // Characters start in a scene of their own (older documents placed them in scenes).
            $here = array_values(array_filter($document['characters'], fn ($c) => (int) ($c['scene_id'] ?? 0) === (int) $scene['id'] && isset($c['position_x'], $c['position_y'])));
            $placed = array_map(fn ($c) => ['character_id' => $c['id'], 'position_x' => $c['position_x'], 'position_y' => $c['position_y'], 'facing' => $c['facing'] ?? 'right'], $here);
            foreach ([...$placed, ...($scene['characters'] ?? [])] as $p) {
                $c = $characters[$p['character_id']] ?? null;
                $sheet = $c ? $load($c['media_id']) : null;
                $grid = $media[$c['media_id'] ?? 0]['sheet'] ?? null;
                if ($sheet && $grid) {
                    $sheet = ImageTools::crop($sheet, 0, 0, intdiv(imagesx($sheet), $grid['columns']), intdiv(imagesy($sheet), $grid['rows']));
                }
                if ($sheet && ($p['facing'] ?? 'right') === 'left') {
                    imageflip($sheet, IMG_FLIP_HORIZONTAL);
                }
                $stand($sheet, $p['position_x'], $p['position_y'], (float) ($c['scale'] ?? 1));
            }
            $texts = [];
            foreach ($scene['hotspots'] as $hotspot) {
                // Only the first of several hotspots on one spot (a "locked" twin, a "waiting" twin, what is
                // left after a use) is drawn.
                $spot = $hotspot['position_x'].','.$hotspot['position_y'];
                if (isset($texts[$spot]) || preg_match('/-(closed|locked|waiting|done|use)$/', $hotspot['shortname'] ?? '')) {
                    continue;
                }
                foreach ($hotspot['labels'] as $label) {
                    if ($label['type'] === 'image' && ($pic = $load($label['media']))) {
                        $pw = (int) round(imagesx($pic) * (float) ($label['scale_x'] ?? 1));
                        $ph = (int) round(imagesy($pic) * (float) ($label['scale_y'] ?? 1));
                        imagecopyresampled($im, $pic, (int) ($label['position_x'] - $pw / 2), (int) ($label['position_y'] - $ph / 2), 0, 0, $pw, $ph, imagesx($pic), imagesy($pic));
                    } elseif ($label['type'] === 'text') {
                        $texts[$spot][] = [$label['position_x'], $label['position_y'], (string) $label['text']];
                    }
                }
                $texts[$spot] ??= [];
            }

            foreach ($scene['foreground_media'] ?? [] as $l) {
                $layer($l);
            }
            // Lights: a soft glow in their colour.
            foreach ($scene['lights'] ?? [] as $l) {
                [$r, $g, $b] = sscanf(ltrim($l['color'] ?? '#ffc46b', '#'), '%02x%02x%02x');
                $radius = (int) ($l['radius'] ?? 90);
                for ($k = 10; $k >= 1; $k--) {
                    $d = (int) (2 * $radius * $k / 10);
                    imagefilledellipse($im, (int) $l['x'], (int) $l['y'], $d, $d, imagecolorallocatealpha($im, $r, $g, $b, 118));
                }
            }

            // Overlays are drawn on the scaled picture, so lines and text stay readable.
            $small = ImageTools::resize($im, (int) ($w * $scale), (int) ($h * $scale));
            imagealphablending($small, true);
            $green = imagecolorallocatealpha($small, 40, 220, 90, 30);
            $red = imagecolorallocatealpha($small, 230, 40, 60, 20);
            $blue = imagecolorallocate($small, 40, 90, 230);
            $ink = imagecolorallocate($small, 20, 20, 30);
            $paper = imagecolorallocatealpha($small, 255, 255, 255, 30);
            imagesetthickness($small, 3);
            foreach ($scene['walkable_areas'] as $poly) {
                $points = [];
                foreach ($poly as $pt) {
                    array_push($points, (int) ($pt['x'] * $scale), (int) ($pt['y'] * $scale));
                }
                imagepolygon($small, $points, $green);
            }
            foreach ($scene['blocked_areas'] ?? [] as $poly) {
                $points = [];
                foreach ($poly as $pt) {
                    array_push($points, (int) ($pt['x'] * $scale), (int) ($pt['y'] * $scale));
                }
                imagepolygon($small, $points, $red);
            }
            foreach ($scene['hotspots'] as $hotspot) {
                [$x, $y, $r] = [$hotspot['position_x'], $hotspot['position_y'], (float) $hotspot['radius']];
                if ($x !== null && $y !== null) {
                    imageellipse($small, (int) ($x * $scale), (int) ($y * $scale), (int) (2 * $r * $scale), (int) (2 * $r * $scale), $red);
                } elseif ($x !== null) {
                    imagefilledrectangle($small, (int) ($x * $scale) - 4, 0, (int) ($x * $scale) + 4, (int) ($h * $scale), $red);
                } elseif ($y !== null) {
                    imagefilledrectangle($small, 0, (int) ($y * $scale) - 4, (int) ($w * $scale), (int) ($y * $scale) + 4, $red);
                }
            }
            foreach ($scene['spawn_points'] as $sp) {
                imagefilledellipse($small, (int) ($sp['position_x'] * $scale), (int) ($sp['position_y'] * $scale), 12, 12, $blue);
                imagestring($small, 2, (int) ($sp['position_x'] * $scale) + 8, (int) ($sp['position_y'] * $scale) - 6, $sp['name'], $blue);
            }
            foreach ($texts as $list) {
                foreach ($list as [$x, $y, $text]) {
                    $text = preg_replace('/\{\{label_\w+\}\}/', 'Talk to ...', $text);
                    $tw = imagefontwidth(3) * strlen($text);
                    $tx = (int) ($x * $scale - $tw / 2);
                    $ty = (int) ($y * $scale - 7);
                    imagefilledrectangle($small, $tx - 3, $ty - 2, $tx + $tw + 3, $ty + 15, $paper);
                    imagestring($small, 3, $tx, $ty, $text, $ink);
                }
            }
            imagefilledrectangle($small, 0, 0, (int) ($w * $scale), 22, $paper);
            imagestring($small, 4, 8, 3, ($scene['subtitle'] ?? $scene['shortname']).'  ('.$scene['shortname'].')', $ink);
            $path = "$dir/{$scene['shortname']}.png";
            file_put_contents($path, ImageTools::png($small));
            $out[$scene['shortname']] = $path;
        }

        return $out;
    }
}
