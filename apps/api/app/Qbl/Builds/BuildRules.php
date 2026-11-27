<?php

namespace App\Qbl\Builds;

/**
 * What students may build in a scene, and whether a build keeps to it: the server's copy of
 * packages/shared/src/builds.ts (buildingRules, buildProblems, cleanLabel, tidyPiece). The two must agree.
 */
final class BuildRules
{
    public const TOOLS = ['place', 'label', 'picture'];

    public const DEFAULT_PIECES = 12;

    public const MAX_PIECES = 50;

    public const LABEL_LENGTH = 60;

    public const MIN_SCALE = 0.2;

    public const MAX_SCALE = 4;

    /** Uploads per student per instance. */
    public const UPLOADS = 20;

    public const UPLOAD_BYTES = 8 * 1024 * 1024;

    public const PROMPT_LENGTH = 300;

    public const LABEL_COLORS = ['#ffffff', '#1f2937', '#fde047', '#fb923c', '#f87171', '#60a5fa', '#4ade80', '#c084fc'];

    /**
     * A compiled scene's building rules, or null when students cannot build there.
     *
     * @return array{tools: string[], pieces: int[], max_pieces: int, approve: bool, share: string, prompt: string}|null
     */
    public static function of(?array $scene): ?array
    {
        $b = $scene['building'] ?? null;
        if (! is_array($b) || ($b['enabled'] ?? false) !== true || ! empty($scene['story'])) {
            return null;
        }
        $tools = array_values(array_unique(array_filter((array) ($b['tools'] ?? ['place', 'label']), fn ($t) => in_array($t, self::TOOLS, true))));
        $pieces = array_values(array_map('intval', array_filter(array_map(fn ($p) => is_array($p) ? ($p['media_id'] ?? null) : null, (array) ($b['pieces'] ?? [])), fn ($id) => $id !== null)));
        $tools = array_values(array_filter($tools, fn ($t) => $t !== 'place' || $pieces));
        if (! $tools) {
            return null;
        }
        $max = is_numeric($b['max_pieces'] ?? null) ? (int) round((float) $b['max_pieces']) : self::DEFAULT_PIECES;

        return [
            'tools' => $tools,
            'pieces' => $pieces,
            'max_pieces' => min(self::MAX_PIECES, max(1, $max)),
            'approve' => ($b['approve'] ?? true) !== false,
            'share' => ($b['share'] ?? null) === 'own' ? 'own' : 'instance',
            'prompt' => mb_substr(trim((string) ($b['prompt'] ?? '')), 0, self::PROMPT_LENGTH),
        ];
    }

    /** A label's words as they are kept: one line, no markup characters, at most LABEL_LENGTH. */
    public static function cleanLabel(string $text): string
    {
        $text = preg_replace('/[\x00-\x1f\x7f<>]/u', ' ', $text) ?? '';

        return mb_substr(trim(preg_replace('/\s+/u', ' ', $text) ?? ''), 0, self::LABEL_LENGTH);
    }

    /**
     * What is wrong with a build, as sentences for the student; none when it may be saved.
     *
     * @param  array{width: int|float, height: int|float}  $size
     * @param  int[]  $uploads  the student's own uploads in this instance
     * @return string[]
     */
    public static function problems(array $rules, array $size, array $pieces, array $uploads): array
    {
        $problems = [];
        if (! array_is_list($pieces)) {
            return ['A build is a list of things.'];
        }
        if (count($pieces) > $rules['max_pieces']) {
            $problems[] = "You can add up to {$rules['max_pieces']} things here.";
        }
        $ids = [];
        foreach ($pieces as $i => $p) {
            $which = 'Thing '.($i + 1);
            if (! is_array($p)) {
                $problems[] = "$which is not something you can add.";

                continue;
            }
            $id = $p['id'] ?? null;
            if (! is_string($id) || ! preg_match('/^[a-z0-9]{1,16}$/', $id) || isset($ids[$id])) {
                $problems[] = "$which has a bad id.";
            }
            $ids[(string) $id] = true;
            $x = $p['x'] ?? null;
            $y = $p['y'] ?? null;
            if (! self::number($x) || ! self::number($y) || $x < 0 || $y < 0 || $x > $size['width'] || $y > $size['height']) {
                $problems[] = "$which is outside the scene.";
            }
            $scale = $p['scale'] ?? 1;
            if (! self::number($scale) || $scale < self::MIN_SCALE || $scale > self::MAX_SCALE) {
                $problems[] = "$which is too big or too small.";
            }
            $angle = $p['angle'] ?? 0;
            if (! self::number($angle) || $angle < -180 || $angle > 180) {
                $problems[] = "$which is turned too far.";
            }
            switch ($p['kind'] ?? null) {
                case 'sticker':
                    if (! in_array('place', $rules['tools'], true)) {
                        $problems[] = 'Placing pieces is not allowed here.';
                    } elseif (! is_numeric($p['media_id'] ?? null) || ! in_array((int) $p['media_id'], $rules['pieces'], true)) {
                        $problems[] = "$which is not one of this scene's pieces.";
                    }
                    break;
                case 'label':
                    $text = $p['text'] ?? null;
                    if (! in_array('label', $rules['tools'], true)) {
                        $problems[] = 'Labels are not allowed here.';
                    } elseif (! is_string($text) || self::cleanLabel($text) === '' || self::cleanLabel($text) !== $text) {
                        $problems[] = "$which needs words (up to ".self::LABEL_LENGTH.' letters).';
                    }
                    if (isset($p['color']) && ! in_array($p['color'], self::LABEL_COLORS, true)) {
                        $problems[] = "$which has a colour that is not offered.";
                    }
                    break;
                case 'picture':
                    if (! in_array('picture', $rules['tools'], true)) {
                        $problems[] = 'Pictures are not allowed here.';
                    } elseif (! is_int($p['upload_id'] ?? null) || ! in_array($p['upload_id'], $uploads, true)) {
                        $problems[] = "$which is not one of your pictures.";
                    }
                    break;
                default:
                    $problems[] = "$which is not something you can add.";
            }
        }

        return array_values(array_unique($problems));
    }

    /** Only the fields a piece of its kind keeps, rounded: what is stored. */
    public static function tidy(array $p): array
    {
        $out = ['id' => $p['id'], 'kind' => $p['kind'], 'x' => (int) round($p['x']), 'y' => (int) round($p['y'])];
        $scale = round((float) ($p['scale'] ?? 1), 2);
        if ($scale != 1) {
            $out['scale'] = $scale;
        }
        $angle = (int) round((float) ($p['angle'] ?? 0));
        if ($angle !== 0) {
            $out['angle'] = $angle;
        }
        if ($p['kind'] === 'sticker') {
            $out['media_id'] = (int) $p['media_id'];
        }
        if ($p['kind'] === 'picture') {
            $out['upload_id'] = (int) $p['upload_id'];
        }
        if ($p['kind'] === 'label') {
            $out['text'] = self::cleanLabel((string) $p['text']);
            if (isset($p['color']) && $p['color'] !== self::LABEL_COLORS[0]) {
                $out['color'] = $p['color'];
            }
        }

        return $out;
    }

    /**
     * A compiled scene's size: its own width and height, or else its first background's. Null when unknown.
     *
     * @return array{width: int, height: int}|null
     */
    public static function size(array $document, array $scene): ?array
    {
        if (! empty($scene['width']) && ! empty($scene['height'])) {
            return ['width' => (int) $scene['width'], 'height' => (int) $scene['height']];
        }
        $first = $scene['background_media'][0] ?? null;
        if (! is_array($first)) {
            return null;
        }
        if (! empty($first['display_width']) && ! empty($first['display_height'])) {
            return ['width' => (int) $first['display_width'], 'height' => (int) $first['display_height']];
        }
        $id = $first['media_id'] ?? $first['id'] ?? null;
        foreach ((array) ($document['assets'] ?? []) as $m) {
            if (($m['id'] ?? null) == $id && ! empty($m['width']) && ! empty($m['height'])) {
                $sx = (float) ($m['scale_x'] ?? 1) ?: 1;
                $sy = (float) ($m['scale_y'] ?? 1) ?: 1;

                return ['width' => (int) round($m['width'] * $sx), 'height' => (int) round($m['height'] * $sy)];
            }
        }

        return null;
    }

    private static function number(mixed $v): bool
    {
        return (is_int($v) || is_float($v)) && is_finite((float) $v);
    }
}
