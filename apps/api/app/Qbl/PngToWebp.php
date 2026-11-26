<?php

namespace App\Qbl;

/**
 * PNG pictures uploaded in the editor are kept as WebP: the same picture, see-through parts
 * included, usually a tenth of the size or less. Large PNGs are slow to reach players, and a
 * picture that has not arrived is left out of the scene. On by default; QBL_PNG_TO_WEBP=false
 * keeps PNGs as they are uploaded.
 *
 * A PNG is kept as it is when it is animated (WebP from GD would keep only its first frame), when
 * the server's GD cannot write WebP, when it is larger than WebP allows, when decoding it would
 * not fit in PHP's memory, or when the WebP would not be smaller.
 */
class PngToWebp
{
    /** WebP quality, 0 to 100. High enough that edges and flat colours stay clean. */
    public const QUALITY = 90;

    /** The largest width or height a WebP can have. */
    public const MAX_SIDE = 16383;

    /** Whether this server can make WebP pictures at all. */
    public static function available(): bool
    {
        return function_exists('imagewebp') && function_exists('imagecreatefrompng') && ! empty(gd_info()['WebP Support']);
    }

    /**
     * A WebP copy of the PNG at `$path`, written next to it, or null when the PNG is to be kept
     * (see the class). The caller stores the copy in place of the PNG and deletes the copy after.
     */
    public static function convert(string $path): ?string
    {
        if (! self::available()) {
            return null;
        }
        $size = @getimagesize($path);
        if (! $size || ($size[2] ?? null) !== IMAGETYPE_PNG) {
            return null;
        }
        [$width, $height] = $size;
        if ($width < 1 || $height < 1 || $width > self::MAX_SIDE || $height > self::MAX_SIDE) {
            return null;
        }
        if (Apng::info($path) !== null || ! self::fitsInMemory($width, $height)) {
            return null;
        }

        $image = @imagecreatefrompng($path);
        if (! $image) {
            return null;
        }
        $out = $path.'.webp';
        try {
            // Palette PNGs (and their transparent colour) become true colour; alpha is written as it is.
            if (! imageistruecolor($image)) {
                imagepalettetotruecolor($image);
            }
            imagealphablending($image, false);
            imagesavealpha($image, true);
            if (! @imagewebp($image, $out, self::QUALITY)) {
                @unlink($out);

                return null;
            }
        } finally {
            imagedestroy($image);
        }
        clearstatcache(true, $out);
        if (! is_file($out) || filesize($out) === 0 || filesize($out) >= filesize($path)) {
            @unlink($out);

            return null;
        }

        return $out;
    }

    /** The name a converted picture is listed under: "crew-quarters.png" → "crew-quarters.webp". */
    public static function filename(string $name): string
    {
        return preg_replace('/\.png$/i', '', $name).'.webp';
    }

    /** Whether decoding a picture this size fits in what PHP may still use (GD keeps 4 bytes a pixel, plus some). */
    private static function fitsInMemory(int $width, int $height): bool
    {
        $limit = self::bytes((string) ini_get('memory_limit'));
        if ($limit <= 0) {
            return true;
        }

        return $width * $height * 5 + 8 * 1024 * 1024 < $limit - memory_get_usage();
    }

    private static function bytes(string $value): int
    {
        $value = trim($value);
        if ($value === '' || $value === '-1') {
            return -1;
        }
        $number = (int) $value;

        return match (strtolower(substr($value, -1))) {
            'g' => $number * 1024 ** 3,
            'm' => $number * 1024 ** 2,
            'k' => $number * 1024,
            default => $number,
        };
    }
}
