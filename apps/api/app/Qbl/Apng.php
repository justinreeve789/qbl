<?php

namespace App\Qbl;

/**
 * Animated PNGs. An uploaded PNG that is animated is noted on its media (`params.apng`: how many
 * frames, how long one pass takes, how many times it plays), so the game knows to cut it into
 * frames and the editor can offer them. Only the chunk headers are read; nothing is decoded.
 */
class Apng
{
    /** @return array{frames: int, duration: int, plays: int}|null null when the file is not an animated PNG */
    public static function info(string $path): ?array
    {
        $f = @fopen($path, 'rb');
        if (! $f) {
            return null;
        }
        try {
            if (fread($f, 8) !== "\x89PNG\r\n\x1a\n") {
                return null;
            }
            $animated = false;
            $plays = 0;
            $frames = 0;
            $duration = 0;
            while (! feof($f)) {
                $head = fread($f, 8);
                if (strlen($head) < 8) {
                    break;
                }
                ['length' => $length] = unpack('Nlength', substr($head, 0, 4));
                $type = substr($head, 4, 4);
                if ($type === 'acTL' && $length >= 8) {
                    $animated = true;
                    $plays = unpack('N2', fread($f, 8))[2];
                    $length -= 8;
                } elseif ($type === 'fcTL' && $length >= 26) {
                    $data = fread($f, 26);
                    $num = unpack('n', substr($data, 20, 2))[1];
                    $den = unpack('n', substr($data, 22, 2))[1] ?: 100;
                    $duration += max(10, (int) round($num / $den * 1000) ?: 100);
                    $frames++;
                    $length -= 26;
                } elseif ($type === 'IEND' || $type === 'IDAT' && ! $animated) {
                    break; // the animation control chunk comes before the image data
                }
                fseek($f, $length + 4, SEEK_CUR); // the rest of the chunk and its CRC
            }

            return $animated && $frames > 1 ? ['frames' => $frames, 'duration' => $duration, 'plays' => (int) $plays] : null;
        } finally {
            fclose($f);
        }
    }
}
