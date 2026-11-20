<?php

namespace App\Qbl\Characters;

use App\Qbl\Avatars;

/**
 * An avatar players choose from. Avatars belong to the platform, not to a scenario, so a player
 * keeps theirs in every scenario: a row of `avatars`, added to every document as it is served
 * (Avatars::inject). Its pictures are the platform's too: rows of `platform_media`, which any
 * number of avatars can share (one sprite sheet, several avatars cut from it).
 *
 * In a document an avatar's id is Avatars::BASE + its row id, which is also what a player's
 * choice (`users.avatar_media_id`, the room's `avatar`) holds. Platform media ids are
 * Avatars::MEDIA_BASE + the row id, far above any scenario's.
 *
 * A row's `settings.animations` is either a map of animations by name whose `media_id`s are
 * `platform_media` row ids, or, for rows written before avatars were characters, a list of
 * animations on `image_url` as a sprite sheet. Such a row is read as it always looked: the
 * picture is media BASE + id, its close-up (`portrait_url`) PORTRAIT_BASE + id.
 */
final class AvatarCharacter extends Character
{
    /** @param  list<array>  $media  the media entries its animations use, as a document carries them */
    public function __construct(int $id, string $name, array $animations, ?float $scale, public readonly array $media)
    {
        parent::__construct($id, $name, $animations, $scale);
    }

    /**
     * From an `avatars` row (settings decoded) and the platform's media by row id.
     *
     * @param  array<int, array>  $platformMedia
     */
    public static function fromRow(array $row, array $platformMedia): self
    {
        $s = is_array($row['settings'] ?? null) ? $row['settings'] : (json_decode((string) ($row['settings'] ?? ''), true) ?: []);
        $rowId = (int) $row['id'];
        $scale = isset($s['scale']) ? (float) $s['scale'] : null;
        $animations = $s['animations'] ?? null;

        if (is_array($animations) && $animations && ! array_is_list($animations)) {
            $out = [];
            $media = [];
            foreach ($animations as $name => $a) {
                $m = $platformMedia[(int) ($a['media_id'] ?? 0)] ?? null;
                if (! $m || ! is_string($name)) {
                    continue; // a picture since removed: the pose is filled in from another
                }
                $served = Avatars::MEDIA_BASE + (int) $m['id'];
                $out[$name] = ['media_id' => $served] + array_diff_key($a, ['media_id' => 1]);
                $media[$served] ??= self::mediaEntry($m, $served);
            }

            return new self(Avatars::BASE + $rowId, (string) $row['name'], $out, $scale, array_values($media));
        }

        // The older shape: one picture, perhaps a sheet with its own animations, and a close-up.
        $picture = array_filter([
            'id' => Avatars::BASE + $rowId, 'type' => 'image', 'url' => $row['image_url'], 'filename' => $row['name'], 'priority' => 1,
            'width' => $s['width'] ?? null, 'height' => $s['height'] ?? null,
            'sheet' => $s['sheet'] ?? null, 'animations' => is_array($s['sheet'] ?? null) && is_array($animations) ? array_values($animations) : null,
        ], fn ($v) => $v !== null);
        $media = [$picture];
        $portraitId = null;
        if (! empty($row['portrait_url'])) {
            $portraitId = Avatars::PORTRAIT_BASE + $rowId;
            $media[] = ['id' => $portraitId, 'type' => 'image', 'url' => $row['portrait_url'], 'priority' => 30];
        }

        return new self(Avatars::BASE + $rowId, (string) $row['name'], self::animationsFromPicture($picture, $portraitId), $scale, $media);
    }

    /** A `platform_media` row as a document's media entry. */
    public static function mediaEntry(array $m, int $servedId): array
    {
        $params = is_array($m['params'] ?? null) ? $m['params'] : (json_decode((string) ($m['params'] ?? ''), true) ?: []);

        return array_filter([
            'id' => $servedId, 'type' => $m['type'] ?? 'image', 'url' => $m['url'], 'filename' => $m['filename'] ?? null, 'priority' => 1,
            'width' => isset($m['width']) ? (int) $m['width'] : null, 'height' => isset($m['height']) ? (int) $m['height'] : null,
            'sheet' => $params['sheet'] ?? null, 'apng' => $params['apng'] ?? null,
        ], fn ($v) => $v !== null);
    }

    public function toDocument(): array
    {
        return array_filter(['id' => $this->id, 'name' => $this->name, 'scale' => $this->scale, 'animations' => $this->animations ?: null, 'platform' => true], fn ($v) => $v !== null);
    }

    /**
     * How the avatar looks on a page (the chooser, a profile): standing, or its close-up. A sheet
     * shows one frame; an animated PNG plays by itself.
     *
     * @return array{url: string, sheet?: array, frame?: int, flip?: bool}|null
     */
    public function picture(string $which = 'stand'): ?array
    {
        $chosen = $this->chosen($which);
        if (! $chosen) {
            return null;
        }
        foreach ($this->media as $m) {
            if ((int) $m['id'] !== (int) $chosen['animation']['media_id']) {
                continue;
            }
            $sheet = is_array($m['sheet'] ?? null) ? $m['sheet'] : null;

            return array_filter([
                'url' => $m['url'],
                'sheet' => $sheet ? ['columns' => (int) $sheet['columns'], 'rows' => (int) $sheet['rows']] : null,
                'frame' => $sheet ? (int) ($chosen['animation']['frames'][0] ?? 0) : null,
                'flip' => $chosen['flip'] ?: null,
            ], fn ($v) => $v !== null);
        }

        return null;
    }
}
