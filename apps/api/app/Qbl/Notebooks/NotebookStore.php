<?php

namespace App\Qbl\Notebooks;

use App\Qbl\ClassStore;
use App\Qbl\StoreError;
use PDO;

/**
 * Players' notebooks: their own notes on one scenario (packages/shared/src/notebook.ts has the
 * format). Plain PHP over PDO, like the other stores, so the dev server and Laravel share it.
 *
 * Each player has one notebook in each instance they play in (`group_key`: `public`, an
 * assignment's `a12`, a team's `t7`), kept as one JSON document. It belongs with the player's
 * save: starting their game again (ClassStore::resetProgress) deletes it, as does deleting the
 * student (Api\Roster), and a records request lists it (Api\Roster::export). The table's SQLite
 * form is in ClassStore::sqliteSchema, which owns resetting, so that every store's tests have it.
 *
 * Only the player reads and writes their notebook. Guests may keep one too: it is theirs alone,
 * and goes when their guest account does.
 *
 * `clean` is the same as cleanNotebook in notebook.ts: the two must agree (tests/notebooks.php
 * checks this one against the shared package's fixtures).
 */
class NotebookStore
{
    public const PAGES = 50;

    public const DEPTH = 3;

    public const CARDS = 30;

    public const TITLE = 60;

    public const TEXT = 5000;

    public const CARD = 240;

    public const COLORS = ['sun', 'sky', 'mint', 'rose', 'grape', 'peach'];

    public const ICONS = [
        '📝', '⭐', '❤️', '🌈', '🌻', '🌳', '🐞', '🦋', '🐸', '🐶', '🐱', '🐠',
        '🚀', '🌙', '☀️', '🔬', '🧪', '🧲', '🔢', '🎨', '🎵', '📚', '🗺️', '💡',
        '❓', '✅', '🏆', '🍎',
    ];

    public const KINDS = ['note', 'flash', 'check'];

    private ClassStore $classes;

    public function __construct(private PDO $pdo, ?ClassStore $classes = null)
    {
        $this->classes = $classes ?? new ClassStore($pdo);
    }

    /**
     * A player's notebook in one instance of a scenario: its pages, and when it was last kept
     * (null: never). An empty notebook when they have not written one.
     */
    public function forPlayer(array $user, string $key, string $group): array
    {
        $scenarioId = $this->joined($user, $key, $group);
        $row = $this->one('SELECT pages, updated_at FROM notebooks WHERE scenario_id = ? AND user_id = ? AND group_key = ?', [$scenarioId, (int) $user['id'], $group]);

        return [
            'notebook' => self::clean(['pages' => json_decode((string) ($row['pages'] ?? '[]'), true) ?: []]),
            'updated_at' => $row ? self::iso((string) $row['updated_at']) : null,
        ];
    }

    /** Keep a player's whole notebook, cleaned. One with no pages is deleted. */
    public function save(array $user, string $key, string $group, mixed $notebook): array
    {
        if (! is_array($notebook)) {
            throw new StoreError(422, 'Send the notebook.');
        }
        $scenarioId = $this->joined($user, $key, $group);
        $clean = self::clean($notebook);
        $args = [$scenarioId, (int) $user['id'], $group];
        $now = gmdate('Y-m-d H:i:s');
        if (! $clean['pages']) {
            $this->run('DELETE FROM notebooks WHERE scenario_id = ? AND user_id = ? AND group_key = ?', $args);

            return ['notebook' => $clean, 'updated_at' => null];
        }
        $json = json_encode($clean['pages'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $existing = $this->one('SELECT id FROM notebooks WHERE scenario_id = ? AND user_id = ? AND group_key = ?', $args);
        if ($existing) {
            $this->run('UPDATE notebooks SET pages = ?, updated_at = ? WHERE id = ?', [$json, $now, $existing['id']]);
        } else {
            $this->run('INSERT INTO notebooks (scenario_id, user_id, group_key, pages, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [...$args, $json, $now, $now]);
        }

        return ['notebook' => $clean, 'updated_at' => self::iso($now)];
    }

    // ------------------------------------------------------------------ cleaning

    /** A notebook as it may be kept; see cleanNotebook in packages/shared/src/notebook.ts, which this must match. */
    public static function clean(mixed $raw, ?int $now = null): array
    {
        $now ??= time();
        $list = is_array($raw) && is_array($raw['pages'] ?? null) ? $raw['pages'] : [];
        $seen = [];
        $pages = [];
        foreach ($list as $p) {
            if (count($pages) >= self::PAGES) {
                break;
            }
            if (! is_array($p) || ! self::isId($p['id'] ?? null) || isset($seen[$p['id']])) {
                continue;
            }
            $seen[$p['id']] = true;
            $cardIds = [];
            $cards = [];
            foreach (is_array($p['cards'] ?? null) ? $p['cards'] : [] as $c) {
                if (count($cards) >= self::CARDS) {
                    break;
                }
                if (! is_array($c) || ! self::isId($c['id'] ?? null) || isset($cardIds[$c['id']])) {
                    continue;
                }
                $cardIds[$c['id']] = true;
                $kind = in_array($c['kind'] ?? null, self::KINDS, true) ? $c['kind'] : 'note';
                $card = [
                    'id' => $c['id'], 'kind' => $kind, 'text' => self::clip($c['text'] ?? null, self::CARD),
                    'color' => self::color($c['color'] ?? null, 'sun'),
                    'created_at' => self::when($c['created_at'] ?? null, $now), 'updated_at' => self::when($c['updated_at'] ?? null, $now),
                ];
                if ($kind === 'flash') {
                    $card['back'] = self::clip($c['back'] ?? null, self::CARD);
                }
                if ($kind === 'check') {
                    $card['done'] = ($c['done'] ?? null) === true;
                }
                $cards[] = $card;
            }
            $title = preg_replace(['/[ \t\n]+/', '/^ | $/'], [' ', ''], self::clip($p['title'] ?? null, self::TITLE));
            $pages[] = [
                'id' => $p['id'],
                'parent' => is_string($p['parent'] ?? null) ? $p['parent'] : null,
                'title' => $title,
                'icon' => in_array($p['icon'] ?? null, self::ICONS, true) ? $p['icon'] : self::ICONS[0],
                'color' => self::color($p['color'] ?? null, 'sky'),
                'text' => self::clip($p['text'] ?? null, self::TEXT),
                'cards' => $cards,
                'created_at' => self::when($p['created_at'] ?? null, $now),
                'updated_at' => self::when($p['updated_at'] ?? null, $now),
            ];
        }
        // Parents: one that is missing, or that leads back round to the page, makes it a page of its own.
        $index = [];
        foreach ($pages as $i => $page) {
            $index[$page['id']] = $i;
        }
        foreach ($pages as $i => $page) {
            $path = [$page['id'] => true];
            for ($up = $page['parent']; $up !== null; $up = $pages[$index[$up]]['parent']) {
                if (! isset($index[$up]) || isset($path[$up])) {
                    $pages[$i]['parent'] = null;
                    break;
                }
                $path[$up] = true;
            }
        }
        // Too deep: hang it under the deepest ancestor it may have.
        foreach ($pages as $i => $page) {
            $chain = [];
            for ($up = $page['parent']; $up !== null; $up = $pages[$index[$up]]['parent']) {
                array_unshift($chain, $up);
            }
            if (count($chain) >= self::DEPTH) {
                $pages[$i]['parent'] = $chain[self::DEPTH - 2];
            }
        }

        return ['pages' => $pages];
    }

    private static function isId(mixed $id): bool
    {
        return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,24}$/', $id) === 1;
    }

    /** At most $max characters (code points), without control characters other than new lines and tabs. */
    private static function clip(mixed $value, int $max): string
    {
        if (! is_string($value)) {
            return '';
        }
        $text = preg_replace(['/\r\n?/', '/[\x00-\x08\x0B-\x1F\x7F]/u'], ["\n", ''], $value) ?? '';

        return mb_strlen($text, 'UTF-8') > $max ? mb_substr($text, 0, $max, 'UTF-8') : $text;
    }

    /** A time as ISO 8601 UTC: one that cannot be read, or more than a day ahead, is now. */
    private static function when(mixed $value, int $now): string
    {
        $t = is_string($value) && $value !== '' ? strtotime($value) : false;

        return gmdate('Y-m-d\TH:i:s\Z', $t !== false && $t <= $now + 86400 ? $t : $now);
    }

    private static function color(mixed $value, string $fallback): string
    {
        return in_array($value, self::COLORS, true) ? $value : $fallback;
    }

    private static function iso(string $utc): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', strtotime($utc.' UTC'));
    }

    // ------------------------------------------------------------------ helpers

    /** The published scenario a player is in, by its code, if they may be in that instance of it. */
    private function joined(array $user, string $key, string $group): int
    {
        $scenario = $this->one(
            'SELECT id FROM scenarios WHERE published_at IS NOT NULL AND (code = ? OR shortname = ?) ORDER BY (code = ?) DESC LIMIT 1',
            [strtolower($key), $key, strtolower($key)],
        );
        if (! $scenario || ! $this->classes->mayJoin((int) $user['id'], (string) ($user['role'] ?? ''), (int) $scenario['id'], $group)) {
            throw new StoreError(404, 'Scenario not found.');
        }

        return (int) $scenario['id'];
    }

    private function one(string $sql, array $args): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);
        $row = $st->fetch(PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    private function run(string $sql, array $args): void
    {
        $this->pdo->prepare($sql)->execute($args);
    }
}
