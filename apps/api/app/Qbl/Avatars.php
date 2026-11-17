<?php

namespace App\Qbl;

use PDO;

/**
 * The avatars players choose from. There is one set for the whole platform, so a player keeps
 * the same character in every scenario; scenarios do not define their own.
 *
 * The runtime still reads avatars from the scenario document (`avatar_media_ids`,
 * `avatar_portraits`, and the images among `assets`), so the set is added to every document as
 * it is served. Its media ids are in a range of their own, far above any scenario's.
 */
class Avatars
{
    public const BASE = 900000;          // avatar 3 is media 900003

    public const PORTRAIT_BASE = 950000; // and its portrait is media 950003

    /** @return list<array> the active avatars, in order */
    public static function all(PDO $pdo): array
    {
        $rows = $pdo->query('SELECT id, name, image_url, portrait_url, settings FROM avatars WHERE active = 1 ORDER BY sequence, id')->fetchAll(PDO::FETCH_ASSOC);

        return array_map(fn ($r) => [
            'id' => (int) $r['id'], 'media_id' => self::BASE + (int) $r['id'], 'name' => $r['name'], 'image_url' => $r['image_url'], 'portrait_url' => $r['portrait_url'],
            'settings' => is_string($r['settings']) ? (json_decode($r['settings'], true) ?: []) : ($r['settings'] ?? []),
        ], $rows);
    }

    /** Is this media id one of the platform's avatars? */
    public static function has(PDO $pdo, int $mediaId): bool
    {
        return in_array($mediaId, array_column(self::all($pdo), 'media_id'), true);
    }

    /**
     * Give a scenario document the platform's avatars in place of any it lists itself.
     * With no platform avatars set up, the document is left as it is.
     */
    public static function inject(PDO $pdo, array $document): array
    {
        $avatars = self::all($pdo);
        if (! $avatars) {
            return $document;
        }
        $assets = array_values(array_filter($document['assets'] ?? [], fn ($m) => (int) ($m['id'] ?? 0) < self::BASE));
        $ids = [];
        $portraits = [];
        foreach ($avatars as $a) {
            $s = $a['settings'];
            $scale = (float) ($s['scale'] ?? 1);
            $assets[] = array_filter([
                'id' => $a['media_id'], 'type' => 'image', 'url' => $a['image_url'], 'filename' => $a['name'],
                'scale_x' => $scale, 'scale_y' => $scale, 'priority' => 1,
                'width' => $s['width'] ?? null, 'height' => $s['height'] ?? null,
                'sheet' => $s['sheet'] ?? null, 'animations' => $s['animations'] ?? null,
            ], fn ($v) => $v !== null);
            $ids[] = $a['media_id'];
            if ($a['portrait_url']) {
                $assets[] = ['id' => self::PORTRAIT_BASE + $a['id'], 'type' => 'image', 'url' => $a['portrait_url'], 'scale_x' => 1, 'scale_y' => 1, 'priority' => 30];
                $portraits[(string) $a['media_id']] = self::PORTRAIT_BASE + $a['id'];
            }
        }
        $document['assets'] = $assets;
        $document['avatar_media_ids'] = $ids;
        $document['avatar_portraits'] = $portraits;

        return $document;
    }

    public static function sqliteSchema(): array
    {
        return ['CREATE TABLE IF NOT EXISTS `avatars` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name`, `image_url`, `portrait_url`, `settings`, `active` INTEGER NOT NULL DEFAULT 1, `sequence` INTEGER NOT NULL DEFAULT 0, `created_at`, `updated_at`)'];
    }
}
