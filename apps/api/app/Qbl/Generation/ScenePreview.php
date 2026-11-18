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
            foreach ($scene['background_media'] as $layer) {
                if ($bg = $load($layer['media_id'])) {
                    imagecopyresampled($im, $bg, 0, 0, 0, 0, $w, $h, imagesx($bg), imagesy($bg));
                }
            }
            $stand = function (?GdImage $pic, float $x, float $feet, float $s = 1.0) use ($im) {
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
            foreach ($scene['characters'] as $p) {
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
                // Only the first of several hotspots on one spot (a "locked" twin, a "waiting" twin) is drawn.
                $spot = $hotspot['position_x'].','.$hotspot['position_y'];
                if (isset($texts[$spot]) || preg_match('/-(closed|locked|waiting)$/', $hotspot['shortname'] ?? '')) {
                    continue;
                }
                foreach ($hotspot['labels'] as $label) {
                    if ($label['type'] === 'image' && ($pic = $load($label['media']))) {
                        $pw = imagesx($pic);
                        $ph = imagesy($pic);
                        imagecopy($im, $pic, (int) ($label['position_x'] - $pw / 2), (int) ($label['position_y'] - $ph / 2), 0, 0, $pw, $ph);
                    } elseif ($label['type'] === 'text') {
                        $texts[$spot][] = [$label['position_x'], $label['position_y'], (string) $label['text']];
                    }
                }
                $texts[$spot] ??= [];
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
