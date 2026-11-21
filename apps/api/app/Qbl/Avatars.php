<?php

namespace App\Qbl;

use App\Qbl\Characters\AvatarCharacter;
use PDO;

/**
 * The avatars players choose from. There is one set for the whole platform, so a player keeps
 * the same character in every scenario; scenarios do not define their own. Each avatar is a
 * character (AvatarCharacter) with animations, whose pictures are the platform's own media
 * (`platform_media`), shared between avatars as they like.
 *
 * The game reads avatars from the scenario document (`avatars`, and their pictures among
 * `assets`), so the set is added to every document as it is served. Ids are in ranges of their
 * own, far above any scenario's: an avatar is BASE + its row id (what a player's choice holds),
 * a platform picture MEDIA_BASE + its row id.
 */
class Avatars
{
    public const BASE = 900000;          // avatar 3 is 900003 (and, for an avatar of the older shape, so is its picture)

    public const PORTRAIT_BASE = 950000; // an older avatar's close-up: 950003

    public const MEDIA_BASE = 800000;    // platform picture 7 is media 800007

    /** Media ids from here up are the platform's, never a scenario's. */
    public const FLOOR = self::MEDIA_BASE;

    /**
     * The active avatars, in order: their row, and as characters.
     *
     * @return list<array{id: int, media_id: int, name: string, image_url: string, portrait_url: ?string, settings: array, character: AvatarCharacter}>
     */
    public static function all(PDO $pdo): array
    {
        $rows = $pdo->query('SELECT id, name, image_url, portrait_url, settings FROM avatars WHERE active = 1 ORDER BY sequence, id')->fetchAll(PDO::FETCH_ASSOC);
        $media = self::platformMedia($pdo);

        return array_map(function ($r) use ($media) {
            $settings = is_string($r['settings']) ? (json_decode($r['settings'], true) ?: []) : ($r['settings'] ?? []);
            $row = ['id' => (int) $r['id'], 'media_id' => self::BASE + (int) $r['id'], 'name' => $r['name'], 'image_url' => $r['image_url'], 'portrait_url' => $r['portrait_url'], 'settings' => $settings];

            return $row + ['character' => AvatarCharacter::fromRow($row, $media)];
        }, $rows);
    }

    /** The platform's pictures, by row id. A database from before they existed has none. @return array<int, array> */
    public static function platformMedia(PDO $pdo): array
    {
        try {
            $rows = $pdo->query('SELECT id, type, url, filename, width, height, params FROM platform_media')->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException) {
            return [];
        }

        return array_column($rows, null, 'id');
    }

    /** Is this one of the platform's avatars (BASE + row id)? */
    public static function has(PDO $pdo, int $avatarId): bool
    {
        return in_array($avatarId, array_column(self::all($pdo), 'media_id'), true);
    }

    /** An avatar as `GET /api/avatars` lists it: its id (`media_id`, for older callers), name and pictures. */
    public static function present(array $avatar): array
    {
        $c = $avatar['character'];

        return [
            'media_id' => $avatar['media_id'], 'name' => $avatar['name'],
            'picture' => $c->picture('stand'), 'portrait' => $c->picture('portrait'),
            // Before avatars were characters: one picture, its grid if it is a sheet, and the close-up.
            'image_url' => $avatar['image_url'], 'portrait_url' => $avatar['portrait_url'], 'sheet' => $avatar['settings']['sheet'] ?? null,
        ];
    }

    /**
     * The avatars a player chooses from: the platform's, and their organization's own (imported
     * through /api/v1). Every active avatar is still put in every document, so players from two
     * organizations who meet in a public game can see each other.
     */
    public static function forUser(PDO $pdo, int $userId): array
    {
        try {
            $st = $pdo->prepare('SELECT organization_id FROM users WHERE id = ?');
            $st->execute([$userId]);
            $org = $st->fetchColumn();
            $rows = $pdo->query('SELECT id, organization_id FROM avatars WHERE active = 1')->fetchAll(PDO::FETCH_ASSOC);
        } catch (\PDOException) {
            return self::all($pdo); // a development database from before organizations
        }
        $ids = [];
        foreach ($rows as $r) {
            $ids[(int) $r['id']] = $r['organization_id'] === null || ($org && (int) $r['organization_id'] === (int) $org);
        }

        return array_values(array_filter(self::all($pdo), fn ($a) => $ids[$a['id']] ?? false));
    }

    /**
     * Give a scenario document the platform's avatars in place of any it lists itself: the
     * characters in `avatars`, and the pictures they use among `assets`. With no platform
     * avatars set up, the document is left as it is.
     */
    public static function inject(PDO $pdo, array $document): array
    {
        $avatars = self::all($pdo);
        if (! $avatars) {
            return $document;
        }
        $assets = array_values(array_filter($document['assets'] ?? [], fn ($m) => (int) ($m['id'] ?? 0) < self::FLOOR));
        $added = [];
        $list = [];
        foreach ($avatars as $a) {
            $c = $a['character'];
            $list[] = $c->toDocument();
            foreach ($c->media as $m) {
                if (! isset($added[$m['id']])) {
                    $added[$m['id']] = true;
                    $assets[] = $m;
                }
            }
        }
        $document['assets'] = $assets;
        $document['avatars'] = $list;
        unset($document['avatar_media_ids'], $document['avatar_portraits']);

        return $document;
    }

    /**
     * Add avatars from a seed list (database/seeders/data/avatars.php), each once, by id, so
     * changes made since are kept and nobody's choice is touched. An entry either names one
     * picture (`image_url`, with a sheet in `settings`) or has `animations` whose pictures are
     * given by address (`url`, with `sheet`, `width`, `height`): those become platform media,
     * one row per address, shared by every avatar that uses it. Returns how many were added.
     */
    public static function seed(PDO $pdo, array $entries): int
    {
        $added = 0;
        $now = gmdate('Y-m-d H:i:s');
        foreach ($entries as $sequence => $entry) {
            $exists = $pdo->prepare('SELECT 1 FROM avatars WHERE id = ?');
            $exists->execute([$entry['id']]);
            if ($exists->fetchColumn()) {
                continue;
            }
            $settings = $entry['settings'] ?? [];
            if (isset($entry['animations'])) {
                $animations = [];
                foreach ($entry['animations'] as $name => $a) {
                    $animations[$name] = ['media_id' => self::mediaFor($pdo, $a, $now)] + array_diff_key($a, array_flip(['url', 'sheet', 'width', 'height', 'filename']));
                }
                $settings['animations'] = $animations;
            }
            $pdo->prepare('INSERT INTO avatars (id, name, image_url, portrait_url, settings, active, sequence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)')
                ->execute([$entry['id'], $entry['name'], $entry['image_url'], $entry['portrait_url'] ?? null, json_encode($settings), $sequence + 1, $now, $now]);
            $added++;
        }

        return $added;
    }

    /** The first cast, by row id, each with the picture it was seeded with (retired 2026-11-21). */
    public const FIRST_CAST = [
        1 => '/scenario-assets/platform/avatars/avatar-1.png', 2 => '/scenario-assets/platform/avatars/avatar-2.png',
        3 => '/scenario-assets/platform/avatars/avatar-3.png', 4 => '/scenario-assets/platform/avatars/avatar-4.png',
        5 => '/scenario-assets/platform/avatars/avatar-5.png', 6 => '/scenario-assets/platform/avatars/avatar-6.png',
        7 => '/scenario-assets/platform/avatars/avatar-7.png', 8 => '/scenario-assets/platform/avatars/avatar-8.png',
        9 => '/scenario-assets/platform/avatars/avatar-9.png', 10 => '/scenario-assets/platform/avatars/sprocket-sheet.png',
    ];

    /**
     * Put a seed list's avatars in place of the first cast (Nova … Halley and Sprocket), on a
     * database that has it: those rows are withdrawn (kept, inactive), players who had chosen one
     * have no choice again (they are given the first avatar and may choose), and the list is
     * seeded and made active. Organizations' own avatars are not touched. A database without the
     * first cast is left alone. Returns how many of the first cast were withdrawn.
     */
    public static function replaceFirstCast(PDO $pdo, array $entries): int
    {
        $old = [];
        foreach ($pdo->query('SELECT id, image_url, organization_id FROM avatars WHERE id <= 10')->fetchAll(PDO::FETCH_ASSOC) as $r) {
            if ($r['organization_id'] === null && (self::FIRST_CAST[(int) $r['id']] ?? null) === $r['image_url']) {
                $old[] = (int) $r['id'];
            }
        }
        if (! $old) {
            return 0;
        }
        $in = implode(',', $old);
        $now = gmdate('Y-m-d H:i:s');
        $pdo->exec("UPDATE avatars SET active = 0, updated_at = '$now' WHERE id IN ($in)");
        $pdo->exec('UPDATE users SET avatar_media_id = NULL WHERE avatar_media_id IN ('.implode(',', array_map(fn ($id) => self::BASE + $id, $old)).')');
        self::seed($pdo, $entries);
        $new = implode(',', array_map(fn ($e) => (int) $e['id'], $entries));
        $pdo->exec("UPDATE avatars SET active = 1 WHERE organization_id IS NULL AND id IN ($new)");

        return count($old);
    }

    /** The platform_media row for a picture's address, made the first time it is used. */
    private static function mediaFor(PDO $pdo, array $picture, string $now): int
    {
        $find = $pdo->prepare('SELECT id FROM platform_media WHERE url = ?');
        $find->execute([$picture['url']]);
        $id = $find->fetchColumn();
        if ($id) {
            return (int) $id;
        }
        $params = array_filter(['sheet' => $picture['sheet'] ?? null, 'apng' => $picture['apng'] ?? null]);
        $pdo->prepare('INSERT INTO platform_media (type, url, filename, width, height, params, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute(['image', $picture['url'], $picture['filename'] ?? basename((string) $picture['url']), $picture['width'] ?? null, $picture['height'] ?? null, $params ? json_encode($params) : null, $now, $now]);

        return (int) $pdo->lastInsertId();
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `avatars` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name`, `image_url`, `portrait_url`, `settings`, `active` INTEGER NOT NULL DEFAULT 1, `sequence` INTEGER NOT NULL DEFAULT 0, `organization_id` INTEGER, `external_id`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `platform_media` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `type` NOT NULL DEFAULT \'image\', `url` NOT NULL, `filename`, `width` INTEGER, `height` INTEGER, `params`, `created_at`, `updated_at`)',
        ];
    }
}
