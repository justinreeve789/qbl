<?php

namespace App\Qbl;

use PDO;

/**
 * What players did and said, and what a teacher can learn from it.
 *
 * Three things are kept here, all written by the game server:
 *  - the **activity log**: one line each time a player joins or leaves, enters a scene, uses a
 *    hotspot, chooses an answer, completes an objective, learns a word or earns an award;
 *  - the **message log**: every message sent, in a scene or privately, for auditing;
 *  - **badges**: what an award action with a badge gave a player, shown on their profile.
 *
 * Reports are read from those logs and from the save data, per instance (a team's game is
 * not the same student's public game). Like the other stores this is plain PHP over PDO, so
 * Laravel, the dev server and the tests run the same code.
 */
class ActivityStore
{
    public const ACTIVITY_TYPES = ['join', 'leave', 'scene', 'hotspot', 'choice', 'objective', 'glossary', 'narration', 'award'];
    public const MESSAGE_KINDS = ['chat', 'emote', 'private'];

    /** The most lines one request from the game server may add. */
    public const MAX_BATCH = 500;

    public function __construct(private PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    // ------------------------------------------------------------------ writing

    /** Add lines to the activity log. Lines that make no sense are left out. Returns how many were kept. */
    public function logActivity(int $scenarioId, array $entries): int
    {
        $kept = 0;
        foreach (array_slice($entries, 0, self::MAX_BATCH) as $e) {
            if (! is_array($e) || ! in_array($e['type'] ?? null, self::ACTIVITY_TYPES, true) || ! ctype_digit((string) ($e['user_id'] ?? ''))) {
                continue;
            }
            $this->run(
                'INSERT INTO `activity_log` (`scenario_id`, `user_id`, `group_key`, `scene_id`, `type`, `ref`, `label`, `value`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $scenarioId, (int) $e['user_id'], self::group($e['group'] ?? null), isset($e['scene_id']) ? (int) $e['scene_id'] : null, $e['type'],
                    self::text($e['ref'] ?? null, 64), self::text($e['label'] ?? null, 200), is_numeric($e['value'] ?? null) ? $e['value'] + 0 : null, self::time($e['at'] ?? null),
                ],
            );
            $kept++;
        }

        return $kept;
    }

    /** Add messages to the message log. Returns how many were kept. */
    public function logMessages(int $scenarioId, array $entries): int
    {
        $kept = 0;
        foreach (array_slice($entries, 0, self::MAX_BATCH) as $e) {
            $text = is_array($e) ? self::text($e['text'] ?? null, 500) : null;
            if ($text === null || ! in_array($e['kind'] ?? null, self::MESSAGE_KINDS, true) || ! ctype_digit((string) ($e['user_id'] ?? ''))) {
                continue;
            }
            $this->run(
                'INSERT INTO `chat_messages` (`scenario_id`, `user_id`, `user_name`, `group_key`, `scene_id`, `kind`, `to_user_id`, `to_name`, `text`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $scenarioId, (int) $e['user_id'], self::text($e['name'] ?? null, 120), self::group($e['group'] ?? null), isset($e['scene_id']) ? (int) $e['scene_id'] : null, $e['kind'],
                    ctype_digit((string) ($e['to_user_id'] ?? '')) ? (int) $e['to_user_id'] : null, self::text($e['to_name'] ?? null, 120), $text, self::time($e['at'] ?? null),
                ],
            );
            $kept++;
        }

        return $kept;
    }

    /**
     * Give a player the badge an award action carries, once. Returns the badge when it is new,
     * and null when the action has no badge or the player already has it.
     */
    public function grantBadge(int $userId, int $scenarioId, array $document, array $action): ?array
    {
        $name = self::text($action['badge'] ?? null, 80);
        if ($name === null) {
            return null;
        }
        $key = "s$scenarioId:a".(int) ($action['id'] ?? 0);
        if ($this->one('SELECT `id` FROM `user_badges` WHERE `user_id` = ? AND `badge_key` = ?', [$userId, $key])) {
            return null;
        }
        $image = isset($action['badge_media_id']) ? self::mediaUrl($document, (int) $action['badge_media_id']) : null;
        $now = gmdate('Y-m-d H:i:s');
        try {
            $this->run(
                'INSERT INTO `user_badges` (`user_id`, `scenario_id`, `badge_key`, `name`, `description`, `image_url`, `scenario_title`, `created_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$userId, $scenarioId, $key, $name, self::text($action['badge_description'] ?? null, 255), $image, self::text($document['title'] ?? null, 255), $now],
            );
        } catch (\PDOException) {
            // Two requests raced: the unique (user, badge) key kept it to one.
            return null;
        }

        return array_filter(['name' => $name, 'description' => self::text($action['badge_description'] ?? null, 255), 'image_url' => $image, 'scenario' => self::text($document['title'] ?? null, 255), 'earned_at' => gmdate('c', strtotime($now.' UTC'))], fn ($v) => $v !== null);
    }

    // ------------------------------------------------------------------ profiles

    /** A player's badges, newest first. */
    public function badges(int $userId): array
    {
        return array_map(
            fn ($b) => array_filter(['name' => $b['name'], 'description' => $b['description'], 'image_url' => $b['image_url'], 'scenario' => $b['scenario_title'], 'earned_at' => self::iso($b['created_at'])], fn ($v) => $v !== null),
            $this->all('SELECT * FROM `user_badges` WHERE `user_id` = ? ORDER BY `created_at` DESC, `id` DESC', [$userId]),
        );
    }

    /**
     * What other players may see of a player: their name, avatar and what it wears, rank, stars,
     * XP and badges. Nothing that identifies them beyond the name they play under: no email,
     * no class, no activity.
     */
    public function profile(int $userId, ProgressStore $progress): array
    {
        $user = $this->one('SELECT `id`, `name`, `role`, `avatar_media_id` FROM `users` WHERE `id` = ?', [$userId]);
        if (! $user || $user['role'] === 'guest') {
            throw new StoreError(404, 'That player has no profile.');
        }
        $p = $progress->progress($userId);

        return [
            'user_id' => (string) $user['id'],
            'name' => (string) $user['name'],
            'avatar_media_id' => $user['avatar_media_id'] === null ? null : (int) $user['avatar_media_id'],
            'look' => $p['equipped'],
            'stars' => $p['stars'],
            'xp' => $p['xp'],
            'rank' => $p['rank'],
            'next_rank_xp' => $p['next_rank_xp'],
            'badges' => $this->badges($userId),
        ];
    }

    // ------------------------------------------------------------------- reports

    /**
     * How each student did in a mission.
     *
     * @param  array<int, array{id: int, name: string, group: string, team?: ?string}>  $students  who to report on, and the instance each plays in
     * @param  array  $document  the published scenario, for its objectives, glossary and what it teaches
     * @return array{summary: array, students: array, objectives: array, learning_objectives: array}
     */
    public function report(int $scenarioId, array $students, array $document): array
    {
        $defaults = [];
        foreach ($document['global_variables'] ?? [] as $v) {
            $defaults[$v['variable_name']] = $v['default_value'];
        }
        $objectives = array_values($document['objectives'] ?? []);
        $glossary = array_values($document['glossary'] ?? []);
        $learning = array_values($document['curriculum']['learning_objectives'] ?? []);
        $evidence = (array) ($document['curriculum']['evidence'] ?? []);
        $scenes = [];
        foreach ($document['scenes'] ?? [] as $scene) {
            $scenes[(int) $scene['id']] = $scene['shortname'] ?? ('Scene '.$scene['id']);
        }
        $shared = [];

        $rows = [];
        foreach ($students as $s) {
            $userId = (int) $s['id'];
            $group = (string) $s['group'];
            $session = self::decode($this->one('SELECT `data`, `updated_at` FROM `scenario_sessions` WHERE `scenario_id` = ? AND `user_id` = ? AND `group_key` = ?', [$scenarioId, $userId, $group])['data'] ?? null);
            // What the team shares counts for each of its members: the boulders are down for all of them.
            $shared[$group] ??= self::decode($this->one('SELECT `data` FROM `scenario_instances` WHERE `scenario_id` = ? AND `group_key` = ?', [$scenarioId, $group])['data'] ?? null)['variables'] ?? [];
            $vars = array_merge($defaults, $shared[$group], (array) ($session['variables'] ?? []));
            $flags = (array) ($session['flags'] ?? []);

            $counts = ['join' => 0, 'hotspot' => 0, 'choice' => 0, 'scene' => 0, 'glossary' => 0, 'objective' => 0, 'award' => 0];
            foreach ($this->all('SELECT `type`, COUNT(*) AS `n` FROM `activity_log` WHERE `scenario_id` = ? AND `user_id` = ? AND `group_key` = ? GROUP BY `type`', [$scenarioId, $userId, $group]) as $c) {
                $counts[$c['type']] = (int) $c['n'];
            }
            $span = $this->one('SELECT MIN(`created_at`) AS `first`, MAX(`created_at`) AS `last` FROM `activity_log` WHERE `scenario_id` = ? AND `user_id` = ? AND `group_key` = ?', [$scenarioId, $userId, $group]);
            $visited = array_values(array_unique(array_map(
                fn ($r) => $scenes[(int) $r['ref']] ?? ('Scene '.$r['ref']),
                $this->all("SELECT DISTINCT `ref` FROM `activity_log` WHERE `scenario_id` = ? AND `user_id` = ? AND `group_key` = ? AND `type` IN ('scene', 'join') AND `ref` IS NOT NULL AND `ref` != ''", [$scenarioId, $userId, $group]),
            )));

            // Questions: every answer chosen, in order, per infobox. The first one is what the student thought before any feedback.
            $questions = [];
            foreach ($this->all("SELECT `ref`, `label`, `created_at` FROM `activity_log` WHERE `scenario_id` = ? AND `user_id` = ? AND `group_key` = ? AND `type` = 'choice' ORDER BY `id`", [$scenarioId, $userId, $group]) as $c) {
                $ref = (string) $c['ref'];
                $questions[$ref] ??= ['action_id' => $ref, 'attempts' => 0, 'first_answer' => $c['label'], 'last_answer' => null];
                $questions[$ref]['attempts']++;
                $questions[$ref]['last_answer'] = $c['label'];
            }

            $done = [];
            foreach ($objectives as $o) {
                $listed = self::holds($o['show_when'] ?? [], $vars);
                $complete = ! empty($o['complete_when']) && self::holds($o['complete_when'], $vars);
                $done[] = ['id' => $o['id'], 'complete' => $complete, 'listed' => $listed || $complete];
            }
            $required = array_values(array_filter($objectives, fn ($o) => empty($o['optional'])));
            $requiredDone = count(array_filter($required, fn ($o) => ! empty($o['complete_when']) && self::holds($o['complete_when'], $vars)));

            $words = count(array_filter($glossary, fn ($g) => ! empty($g['initial']) || in_array('glossary:'.substr((string) $g['id'], 0, 48), $flags, true)));
            $earned = $this->one('SELECT COALESCE(SUM(CASE WHEN `stars` > 0 THEN `stars` ELSE 0 END), 0) AS `stars`, COALESCE(SUM(CASE WHEN `xp` > 0 THEN `xp` ELSE 0 END), 0) AS `xp` FROM `progress_ledger` WHERE `user_id` = ? AND `scenario_id` = ?', [$userId, $scenarioId]);
            $messages = $this->one('SELECT COUNT(*) AS `n` FROM `chat_messages` WHERE `scenario_id` = ? AND `user_id` = ? AND `group_key` = ?', [$scenarioId, $userId, $group]);

            // Evidence of each learning objective: the variables the mission records it in, with this student's values.
            $shown = [];
            foreach ($learning as $lo) {
                $items = [];
                foreach ((array) ($evidence[$lo['id']] ?? []) as $item) {
                    $values = [];
                    foreach ((array) $item as $key => $name) {
                        if (is_string($name) && array_key_exists($name, $vars)) {
                            $values[$key] = $vars[$name];
                        }
                    }
                    $items[] = ['interaction' => $item['interaction'] ?? null, 'type' => $item['type'] ?? null, 'values' => $values];
                }
                $shown[] = ['id' => $lo['id'], 'evidence' => $items];
            }

            $rows[] = [
                'id' => $userId, 'name' => $s['name'], 'group' => $group, 'team' => $s['team'] ?? null,
                'started' => $session !== null || $counts['join'] > 0,
                'time_spent' => (int) ($session['time_elapsed'] ?? 0),
                'visits' => $counts['join'],
                'first_seen' => self::iso($span['first'] ?? null), 'last_seen' => self::iso($span['last'] ?? null),
                'scene' => isset($session['scene_id']) ? ($scenes[(int) $session['scene_id']] ?? null) : null,
                'scenes_visited' => $visited,
                'objectives_done' => $requiredDone, 'objectives_total' => count($required),
                'finished' => count($required) > 0 && $requiredDone === count($required),
                'objectives' => $done,
                'hotspots_used' => $counts['hotspot'],
                'answers' => $counts['choice'],
                'questions' => array_values($questions),
                'words_learned' => $words, 'words_total' => count($glossary),
                'stars_earned' => (int) ($earned['stars'] ?? 0), 'xp_earned' => (int) ($earned['xp'] ?? 0),
                'badges' => array_column($this->all('SELECT `name` FROM `user_badges` WHERE `user_id` = ? AND `scenario_id` = ? ORDER BY `id`', [$userId, $scenarioId]), 'name'),
                'messages' => (int) ($messages['n'] ?? 0),
                'learning' => $shown,
            ];
        }

        $started = array_values(array_filter($rows, fn ($r) => $r['started']));
        $average = fn (string $key) => $started ? (int) round(array_sum(array_column($started, $key)) / count($started)) : 0;
        // Of the questions answered, how many were answered once: right first time, where the mission insists on the right answer.
        $asked = array_merge(...array_map(fn ($r) => $r['questions'], $rows ?: [['questions' => []]]));
        $firstTry = count(array_filter($asked, fn ($q) => $q['attempts'] === 1));

        return [
            'summary' => [
                'students' => count($rows), 'started' => count($started), 'finished' => count(array_filter($rows, fn ($r) => $r['finished'])),
                'average_time_spent' => $average('time_spent'), 'average_objectives_done' => $average('objectives_done'),
                'objectives_total' => count(array_filter($objectives, fn ($o) => empty($o['optional']))),
                'questions_answered' => count($asked), 'answered_in_one_try' => $firstTry,
                'average_words_learned' => $average('words_learned'), 'words_total' => count($glossary),
            ],
            'objectives' => array_map(fn ($o) => ['id' => $o['id'], 'text' => self::plain((string) ($o['text'] ?? '')), 'optional' => ! empty($o['optional']),
                'completed_by' => count(array_filter($rows, fn ($r) => in_array(true, array_map(fn ($d) => $d['id'] === $o['id'] && $d['complete'], $r['objectives']), true)))], $objectives),
            'learning_objectives' => array_map(fn ($lo) => ['id' => $lo['id'], 'text' => $lo['text'] ?? '', 'standards' => $lo['standards'] ?? []], $learning),
            'students' => $rows,
        ];
    }

    /** The activity log of some instances of a scenario, newest first, optionally for one student. */
    public function activity(int $scenarioId, array $groups, ?int $userId = null, int $limit = 500): array
    {
        if (! $groups) {
            return [];
        }
        $in = implode(', ', array_fill(0, count($groups), '?'));
        $rows = $this->all(
            "SELECT l.*, u.`name` AS `user_name` FROM `activity_log` l LEFT JOIN `users` u ON u.`id` = l.`user_id` WHERE l.`scenario_id` = ? AND l.`group_key` IN ($in)".($userId !== null ? ' AND l.`user_id` = ?' : '').' ORDER BY l.`id` DESC LIMIT '.max(1, min(5000, $limit)),
            array_merge([$scenarioId], array_values($groups), $userId !== null ? [$userId] : []),
        );

        return array_map(fn ($r) => array_filter([
            'user_id' => (int) $r['user_id'], 'name' => $r['user_name'], 'group' => $r['group_key'], 'scene_id' => $r['scene_id'] === null ? null : (int) $r['scene_id'],
            'type' => $r['type'], 'ref' => $r['ref'], 'label' => $r['label'], 'value' => $r['value'] === null ? null : $r['value'] + 0, 'at' => self::iso($r['created_at']),
        ], fn ($v) => $v !== null), $rows);
    }

    /** Every message sent in some instances of a scenario, newest first: in a scene or privately. */
    public function messages(int $scenarioId, array $groups, int $limit = 1000): array
    {
        if (! $groups) {
            return [];
        }
        $in = implode(', ', array_fill(0, count($groups), '?'));
        $rows = $this->all("SELECT * FROM `chat_messages` WHERE `scenario_id` = ? AND `group_key` IN ($in) ORDER BY `id` DESC LIMIT ".max(1, min(5000, $limit)), array_merge([$scenarioId], array_values($groups)));

        return array_map(fn ($r) => array_filter([
            'user_id' => (int) $r['user_id'], 'name' => $r['user_name'], 'group' => $r['group_key'], 'scene_id' => $r['scene_id'] === null ? null : (int) $r['scene_id'],
            'kind' => $r['kind'], 'to_user_id' => $r['to_user_id'] === null ? null : (int) $r['to_user_id'], 'to_name' => $r['to_name'], 'text' => $r['text'], 'at' => self::iso($r['created_at']),
        ], fn ($v) => $v !== null), $rows);
    }

    /** Tables this class needs, for SQLite (development and tests). The migrations make the same for MariaDB. */
    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `activity_log` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `scenario_id` INTEGER, `user_id` INTEGER, `group_key`, `scene_id` INTEGER, `type`, `ref`, `label`, `value` NUMERIC, `created_at`)',
            'CREATE TABLE IF NOT EXISTS `chat_messages` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `scenario_id` INTEGER, `user_id` INTEGER, `user_name`, `group_key`, `scene_id` INTEGER, `kind`, `to_user_id` INTEGER, `to_name`, `text`, `created_at`)',
            'CREATE TABLE IF NOT EXISTS `user_badges` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER, `scenario_id` INTEGER, `badge_key`, `name`, `description`, `image_url`, `scenario_title`, `created_at`, UNIQUE (`user_id`, `badge_key`))',
        ];
    }

    // ------------------------------------------------------------------- helpers

    /** Do all of these conditions hold for these variable values? The same rules as the game (variables.ts). */
    public static function holds(array $conditions, array $vars): bool
    {
        foreach ($conditions as $c) {
            $value = $vars[$c['variable'] ?? ''] ?? null;
            $operand = $c['operand'] ?? null;
            $a = is_numeric($value) ? $value + 0 : null;
            $b = is_numeric($operand) ? $operand + 0 : null;
            $both = $a !== null && $b !== null;
            $sa = strtolower((string) ($value ?? ''));
            $sb = strtolower((string) ($operand ?? ''));
            $ok = match ($c['operator'] ?? '') {
                '=' => $both ? $a == $b : $sa === $sb,
                '!=' => $both ? $a != $b : $sa !== $sb,
                '>' => $both && $a > $b,
                '<' => $both && $a < $b,
                '>=' => $both && $a >= $b,
                '<=' => $both && $a <= $b,
                default => false,
            };
            if (! $ok) {
                return false;
            }
        }

        return true;
    }

    /**
     * An objective's text without its placeholders: "Collect samples ({{samples}}/3)" reads
     * "Collect samples" in a report, where there is no one player whose count to show.
     */
    public static function plain(string $text): string
    {
        $text = preg_replace('/\s*\([^()]*\{\{[^{}]+\}\}[^()]*\)/', '', $text) ?? $text;

        return trim(preg_replace('/\s*\{\{[^{}]+\}\}/', '', $text) ?? $text);
    }

    private static function mediaUrl(array $document, int $mediaId): ?string
    {
        foreach ($document['assets'] ?? [] as $m) {
            if ((int) ($m['id'] ?? 0) === $mediaId && ! empty($m['url'])) {
                return preg_match('#^(https?:)?//|^/|^data:#', $m['url']) ? $m['url'] : rtrim((string) ($document['asset_base_url'] ?? ''), '/').'/'.ltrim($m['url'], '/');
            }
        }

        return null;
    }

    private static function decode(mixed $json): ?array
    {
        if (is_array($json)) {
            return $json;
        }
        $data = is_string($json) ? json_decode($json, true) : null;

        return is_array($data) ? $data : null;
    }

    private static function group(mixed $value): string
    {
        return substr((string) ($value ?? ''), 0, 64) ?: 'public';
    }

    private static function text(mixed $value, int $max): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value === '' ? null : mb_substr($value, 0, $max);
    }

    /** A time the game server gave, as the database keeps times (UTC); now if it gave none that reads as a time. */
    private static function time(mixed $value): string
    {
        $t = is_string($value) ? strtotime($value) : false;

        return gmdate('Y-m-d H:i:s', $t === false ? time() : $t);
    }

    private static function iso(?string $stored): ?string
    {
        return $stored ? gmdate('c', strtotime($stored.' UTC')) : null;
    }

    private function run(string $sql, array $params = []): void
    {
        $this->pdo->prepare($sql)->execute($params);
    }

    private function all(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    private function one(string $sql, array $params = []): ?array
    {
        return $this->all($sql, $params)[0] ?? null;
    }
}
