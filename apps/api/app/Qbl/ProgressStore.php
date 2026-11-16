<?php

namespace App\Qbl;

use PDO;

/**
 * Stars, XP, ranks and the marketplace.
 *
 * Stars are a currency and XP is experience; both belong to a player's account and carry across
 * every scenario. Only this class changes them. Like ScenarioStore it is plain PHP over PDO, so
 * the same code runs under Laravel, in the tests and in the development server.
 *
 * Awards come from scenario events, which run in the player's browser. An award is therefore a
 * request: it is granted only if the action is in the scenario's published document, with the
 * amounts written there, and only once per player unless the action says it is repeatable.
 */
class ProgressStore
{
    public const KINDS = ['wearable', 'pet', 'animation', 'ability', 'move'];
    public const SLOTS = ['head', 'body', 'back', 'hand'];
    public const ANIMATIONS = ['bounce', 'sway', 'pulse', 'float'];

    public const DEFAULT_RANKS = [
        ['xp' => 0, 'name' => 'Cadet'], ['xp' => 100, 'name' => 'Explorer'], ['xp' => 300, 'name' => 'Navigator'],
        ['xp' => 700, 'name' => 'Specialist'], ['xp' => 1500, 'name' => 'Commander'], ['xp' => 3000, 'name' => 'Admiral'],
    ];

    /** The most one award action may give or take, as a guard against a mistyped number. */
    public const MAX_AWARD = 10000;

    public function __construct(private PDO $pdo, private array $ranks = self::DEFAULT_RANKS)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        usort($this->ranks, fn ($a, $b) => $a['xp'] <=> $b['xp']);
    }

    /** A player's totals, rank, and what they own and wear. */
    public function progress(int $userId): array
    {
        $user = $this->user($userId);
        $xp = (int) $user['xp'];
        $rank = $this->ranks[0] ?? ['xp' => 0, 'name' => ''];
        $next = null;
        foreach ($this->ranks as $r) {
            if ($xp >= $r['xp']) {
                $rank = $r;
            } elseif ($next === null) {
                $next = $r['xp'];
            }
        }
        $items = $this->all('SELECT `shop_item_id`, `equipped` FROM `user_items` WHERE `user_id` = ? ORDER BY `shop_item_id`', [$userId]);

        return [
            'stars' => (int) $user['stars'],
            'xp' => $xp,
            'rank' => $rank['name'],
            'next_rank_xp' => $next,
            'owned' => array_map(fn ($i) => (int) $i['shop_item_id'], $items),
            'equipped' => array_values(array_map(fn ($i) => (int) $i['shop_item_id'], array_filter($items, fn ($i) => (int) $i['equipped'] === 1))),
        ];
    }

    /**
     * Grant an award action of a published scenario document. Returns the player's progress with
     * `delta_stars`, `delta_xp`, `note` and `rank_up`. An award already granted comes back with zero
     * deltas and `already` set, which is not an error: the event simply ran again.
     */
    public function award(int $userId, int $scenarioId, array $document, int $actionId): array
    {
        $action = self::findAward($document, $actionId);
        if (! $action) {
            throw new StoreError(404, 'That award is not part of this scenario.');
        }
        $stars = self::amount($action['stars'] ?? 0);
        $xp = self::amount($action['xp'] ?? 0);
        $key = empty($action['repeatable']) ? "s$scenarioId:a$actionId" : null;
        $note = isset($action['note']) ? mb_substr((string) $action['note'], 0, 120) : null;
        $before = $this->progress($userId);

        if ($key !== null && $this->one('SELECT `id` FROM `progress_ledger` WHERE `user_id` = ? AND `grant_key` = ?', [$userId, $key])) {
            return $before + ['delta_stars' => 0, 'delta_xp' => 0, 'note' => $note, 'rank_up' => false, 'already' => true];
        }

        $this->transaction(function () use ($userId, $scenarioId, $key, $stars, $xp, $note) {
            // The unique (user, grant_key) index is what makes "once" hold when two requests race.
            $this->run('INSERT INTO `progress_ledger` (`user_id`, `scenario_id`, `grant_key`, `stars`, `xp`, `note`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [$userId, $scenarioId, $key, $stars, $xp, $note, gmdate('Y-m-d H:i:s')]);
            // Neither total goes below zero: taking away more than a player has leaves them with none.
            $this->run('UPDATE `users` SET `stars` = MAX(0, `stars` + ?), `xp` = MAX(0, `xp` + ?) WHERE `id` = ?', [$stars, $xp, $userId], true);
        });
        $after = $this->progress($userId);

        return $after + [
            'delta_stars' => $after['stars'] - $before['stars'], 'delta_xp' => $after['xp'] - $before['xp'],
            'note' => $note, 'rank_up' => $after['rank'] !== $before['rank'] && $after['xp'] > $before['xp'],
        ];
    }

    /** What is for sale: the platform's items, and a scenario's own when one is given. */
    public function catalogue(?int $scenarioId = null): array
    {
        $rows = $this->all(
            'SELECT * FROM `shop_items` WHERE (`scenario_id` IS NULL'.($scenarioId !== null ? ' OR `scenario_id` = ?' : '').') AND `active` = 1 ORDER BY (`scenario_id` IS NULL), `sequence`, `id`',
            $scenarioId !== null ? [$scenarioId] : [],
        );

        return array_map([self::class, 'item'], $rows);
    }

    /** Buy an item with stars. `$scenarioId` is where the player is shopping: a scenario's own items are only sold there. */
    public function buy(int $userId, int $itemId, ?int $scenarioId = null): array
    {
        $this->user($userId); // guests have no wallet, even for something free
        $item = $this->one('SELECT * FROM `shop_items` WHERE `id` = ? AND `active` = 1', [$itemId]);
        if (! $item || ($item['scenario_id'] !== null && (int) $item['scenario_id'] !== $scenarioId)) {
            throw new StoreError(404, 'That item is not for sale here.');
        }
        if ($this->one('SELECT `id` FROM `user_items` WHERE `user_id` = ? AND `shop_item_id` = ?', [$userId, $itemId])) {
            throw new StoreError(409, 'You already own that.');
        }
        $price = max(0, (int) $item['price']);
        $this->transaction(function () use ($userId, $itemId, $item, $price) {
            // Spend only if there is enough: the WHERE makes the check and the spending one step.
            $spent = $this->run('UPDATE `users` SET `stars` = `stars` - ? WHERE `id` = ? AND `stars` >= ?', [$price, $userId, $price]);
            if ($spent !== 1) {
                throw new StoreError(422, 'You do not have enough stars for that.');
            }
            $this->run('INSERT INTO `user_items` (`user_id`, `shop_item_id`, `equipped`, `created_at`) VALUES (?, ?, 0, ?)', [$userId, $itemId, gmdate('Y-m-d H:i:s')]);
            $this->run('INSERT INTO `progress_ledger` (`user_id`, `scenario_id`, `grant_key`, `stars`, `xp`, `note`, `created_at`) VALUES (?, ?, NULL, ?, 0, ?, ?)',
                [$userId, $item['scenario_id'], -$price, 'Bought: '.$item['name'], gmdate('Y-m-d H:i:s')]);
        });

        return $this->progress($userId);
    }

    /**
     * Put on or take off something the player owns. One wearable per slot, one pet and one
     * animation can be on at a time, so putting one on takes off what was there. Abilities stack.
     */
    public function equip(int $userId, int $itemId, bool $on): array
    {
        $item = $this->one('SELECT s.* FROM `shop_items` s JOIN `user_items` u ON u.`shop_item_id` = s.`id` WHERE u.`user_id` = ? AND s.`id` = ?', [$userId, $itemId]);
        if (! $item) {
            throw new StoreError(404, 'You do not own that.');
        }
        $this->transaction(function () use ($userId, $itemId, $item, $on) {
            // Abilities and moves add up; of everything else one at a time is on.
            if ($on && ! in_array($item['kind'], ['ability', 'move'], true)) {
                $same = $item['kind'] === 'wearable' ? ' AND s.`slot` = ?' : '';
                $params = $item['kind'] === 'wearable' ? [$userId, $item['kind'], $item['slot']] : [$userId, $item['kind']];
                $this->run("UPDATE `user_items` SET `equipped` = 0 WHERE `user_id` = ? AND `shop_item_id` IN (SELECT s.`id` FROM `shop_items` s WHERE s.`kind` = ?$same)", $params);
            }
            $this->run('UPDATE `user_items` SET `equipped` = ? WHERE `user_id` = ? AND `shop_item_id` = ?', [$on ? 1 : 0, $userId, $itemId]);
        });

        return $this->progress($userId);
    }

    /** What the player's avatar wears, as the game server passes it to everyone in the room. */
    public function look(int $userId): string
    {
        return implode(',', $this->progress($userId)['equipped']);
    }

    /** A shop row as the game reads it: settings folded in, numbers as numbers. */
    public static function item(array $row): array
    {
        $settings = is_array($row['settings'] ?? null) ? $row['settings'] : (json_decode((string) ($row['settings'] ?? ''), true) ?: []);

        return array_filter($settings + [
            'id' => (int) $row['id'],
            'scenario_id' => $row['scenario_id'] === null ? null : (int) $row['scenario_id'],
            'name' => (string) $row['name'],
            'description' => $row['description'] ?? null,
            'kind' => (string) $row['kind'],
            'slot' => $row['slot'] ?? null,
            'price' => (int) $row['price'],
            'media_id' => ($row['media_id'] ?? null) === null ? null : (int) $row['media_id'],
            'image_url' => $row['image_url'] ?? null,
        ], fn ($v) => $v !== null);
    }

    /** Find an award action by id anywhere in a scenario document's events. */
    public static function findAward(array $document, int $actionId): ?array
    {
        foreach ($document['scenes'] ?? [] as $scene) {
            foreach (['start_events', 'end_events', 'hotspots', 'indirect_events'] as $list) {
                foreach ($scene[$list] ?? [] as $event) {
                    foreach ($event['actions'] ?? [] as $action) {
                        if ((int) ($action['id'] ?? 0) === $actionId && ($action['type'] ?? '') === 'award') {
                            return $action;
                        }
                    }
                }
            }
        }

        return null;
    }

    /** Tables this class needs beyond ScenarioStore's, for SQLite (development and tests). */
    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `users` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `name`, `email`, `role`, `stars` INTEGER NOT NULL DEFAULT 0, `xp` INTEGER NOT NULL DEFAULT 0)',
            'CREATE TABLE IF NOT EXISTS `progress_ledger` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER, `scenario_id` INTEGER, `grant_key`, `stars` INTEGER, `xp` INTEGER, `note`, `created_at`, UNIQUE (`user_id`, `grant_key`))',
            'CREATE TABLE IF NOT EXISTS `user_items` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER, `shop_item_id` INTEGER, `equipped` INTEGER NOT NULL DEFAULT 0, `created_at`, UNIQUE (`user_id`, `shop_item_id`))',
        ];
    }

    // ------------------------------------------------------------------ helpers

    private function user(int $userId): array
    {
        $user = $this->one('SELECT `id`, `role`, `stars`, `xp` FROM `users` WHERE `id` = ?', [$userId]);
        if (! $user) {
            throw new StoreError(404, 'No such player.');
        }
        if (($user['role'] ?? '') === 'guest') {
            throw new StoreError(403, 'Stars and XP need an account. Guests do not have them.');
        }

        return $user;
    }

    private static function amount(mixed $v): int
    {
        return max(-self::MAX_AWARD, min(self::MAX_AWARD, (int) round((float) $v)));
    }

    private function transaction(callable $work): void
    {
        // Inside someone else's transaction (Laravel's tests wrap each test in one), just do the work.
        $own = ! $this->pdo->inTransaction();
        if ($own) {
            $this->pdo->beginTransaction();
        }
        try {
            $work();
            if ($own) {
                $this->pdo->commit();
            }
        } catch (\Throwable $e) {
            if ($own) {
                $this->pdo->rollBack();
            }
            // Two award requests at once: the second insert hits the unique index. That is "already granted".
            if ($e instanceof \PDOException && str_contains($e->getMessage(), 'progress_ledger')) {
                return;
            }
            throw $e;
        }
    }

    private function run(string $sql, array $params = [], bool $portableMax = false): int
    {
        // MariaDB spells the two-argument maximum GREATEST; SQLite spells it MAX.
        if ($portableMax && $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) !== 'sqlite') {
            $sql = str_replace('MAX(', 'GREATEST(', $sql);
        }
        return $this->statement($sql, $params)->rowCount();
    }

    private function one(string $sql, array $params = []): ?array
    {
        $row = $this->statement($sql, $params)->fetch(PDO::FETCH_ASSOC);

        return $row === false ? null : $row;
    }

    private function all(string $sql, array $params = []): array
    {
        return $this->statement($sql, $params)->fetchAll(PDO::FETCH_ASSOC);
    }

    /** Run a statement with numbers bound as numbers, so comparisons mean the same on every database. */
    private function statement(string $sql, array $params): \PDOStatement
    {
        $statement = $this->pdo->prepare($sql);
        foreach (array_values($params) as $i => $value) {
            $statement->bindValue($i + 1, $value, match (true) {
                is_int($value) => PDO::PARAM_INT, $value === null => PDO::PARAM_NULL, default => PDO::PARAM_STR,
            });
        }
        $statement->execute();

        return $statement;
    }
}
