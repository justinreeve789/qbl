<?php

namespace App\Qbl\Generation;

use PDO;
use Throwable;

/**
 * The generation_events table: an audit log of everything a run of the generator did that took time
 * or money, one row each (see the migration for the columns). Plain PHP over PDO, like GenerationRuns.
 *
 * Logging never stops a run: a row that cannot be written is dropped (and noted in the PHP error log).
 */
class GenerationEvents
{
    public const TYPES = ['llm', 'picture', 'voice', 'stage', 'estimate'];

    private const COLUMNS = ['stage', 'type', 'kind', 'step', 'label', 'attempt', 'model', 'size', 'started_at', 'duration_ms',
        'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens', 'references', 'usd', 'score', 'outcome', 'note', 'detail'];

    /** Columns that stay text even when they look like numbers. */
    private const TEXT = ['prompt', 'status', 'stage', 'type', 'kind', 'step', 'label', 'note', 'model', 'size', 'outcome', 'started_at', 'created_at', 'detail'];

    /** @var array<int, int> the last sequence number used, by run */
    private array $seq = [];

    /** @var array{0: int, 1: float}|null the stage that is open: [event id, start time] */
    private ?array $open = null;

    public function __construct(private PDO $pdo, private ?\Closure $clock = null)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    /**
     * Write one event. $event holds any of the columns; started_at defaults to now (or, with
     * 'seconds', to that long ago); detail may be an array. Returns the row's id, or null if it could
     * not be written.
     *
     * @param  array<string, mixed>  $event
     */
    public function record(int $run, array $event): ?int
    {
        try {
            $seconds = isset($event['seconds']) ? (float) $event['seconds'] : null;
            if ($seconds !== null) {
                $event['duration_ms'] ??= (int) round($seconds * 1000);
                $event['started_at'] ??= self::stamp($this->now() - $seconds);
            }
            $event['started_at'] ??= self::stamp($this->now());
            if (isset($event['detail']) && ! is_string($event['detail'])) {
                $event['detail'] = json_encode($event['detail'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }
            if (isset($event['note'])) {
                $event['note'] = mb_substr((string) $event['note'], 0, 2000);
            }
            foreach (['step', 'label'] as $k) {
                if (isset($event[$k])) {
                    $event[$k] = mb_substr((string) $event[$k], 0, 190);
                }
            }
            $row = array_intersect_key($event, array_flip(self::COLUMNS)) + ['usd' => 0];
            $row['generation_id'] = $run;
            $row['seq'] = $this->nextSeq($run);
            $row['created_at'] = gmdate('Y-m-d H:i:s');
            $cols = array_keys($row);
            $this->pdo->prepare('INSERT INTO `generation_events` (`'.implode('`, `', $cols).'`) VALUES ('.implode(', ', array_fill(0, count($cols), '?')).')')
                ->execute(array_values($row));

            return (int) $this->pdo->lastInsertId();
        } catch (Throwable $e) {
            error_log('generation_events: could not log an event: '.$e->getMessage());

            return null;
        }
    }

    /** Change columns of a row already written. */
    public function update(int $id, array $fields): void
    {
        try {
            $fields = array_intersect_key($fields, array_flip(self::COLUMNS));
            if (! $fields) {
                return;
            }
            if (isset($fields['note'])) {
                $fields['note'] = mb_substr((string) $fields['note'], 0, 2000);
            }
            $sets = implode(', ', array_map(fn ($c) => "`$c` = ?", array_keys($fields)));
            $this->pdo->prepare("UPDATE `generation_events` SET $sets WHERE `id` = ?")->execute([...array_values($fields), $id]);
        } catch (Throwable $e) {
            error_log('generation_events: could not update an event: '.$e->getMessage());
        }
    }

    /**
     * What came of attempts at one picture: the judge's score on each, whether it was kept, rejected
     * before judging (a problem found in the picture itself) or lost to a better attempt. Applies to the
     * picture drawn and the judge call made for each attempt (the latest of each, if a resumed run drew
     * it twice).
     *
     * @param  list<array{attempt: int, score?: float|int|null, problem?: string, problems?: list<string>}>  $attempts
     * @param  int|null  $kept  the attempt that was kept, if any
     */
    public function attempts(int $run, string $step, array $attempts, ?int $kept, ?string $keptNote = null): void
    {
        try {
            foreach ($attempts as $a) {
                $n = (int) $a['attempt'];
                $st = $this->pdo->prepare('SELECT MAX(`id`) AS id, `type` FROM `generation_events` WHERE `generation_id` = ? AND `step` = ? AND `attempt` = ? GROUP BY `type`');
                $st->execute([$run, $step, $n]);
                $problem = $a['problem'] ?? (isset($a['problems']) ? implode('; ', array_slice((array) $a['problems'], 0, 4)) : null);
                foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $row) {
                    $fields = ['score' => isset($a['score']) ? round((float) $a['score'], 1) : null];
                    if ($row['type'] === 'picture') {
                        $fields['outcome'] = $n === $kept ? 'kept' : (isset($a['problem']) && ! isset($a['score']) ? 'rejected' : 'discarded');
                        $fields['note'] = $n === $kept ? $keptNote : $problem;
                    } else {
                        $fields['note'] = $problem;
                    }
                    $this->update((int) $row['id'], $fields);
                }
            }
        } catch (Throwable $e) {
            error_log('generation_events: could not mark attempts: '.$e->getMessage());
        }
    }

    /**
     * Start a stage of a run (aligning, designing, drawing...), ending the one before. Null ends it
     * without starting another.
     */
    public function stage(int $run, ?string $stage, string $outcome = 'ok', ?string $note = null): void
    {
        if ($this->open) {
            [$id, $t0] = $this->open;
            $this->open = null;
            $this->update($id, ['duration_ms' => (int) round(($this->now() - $t0) * 1000), 'outcome' => $outcome, 'note' => $note]);
        }
        if ($stage !== null && ($id = $this->record($run, ['type' => 'stage', 'stage' => $stage, 'step' => $stage]))) {
            $this->open = [$id, $this->now()];
        }
    }

    /** Start something that will be ended with end(): a voice line, say. Returns its id and start time. */
    public function begin(int $run, array $event): ?array
    {
        $id = $this->record($run, $event);

        return $id ? [$id, $this->now()] : null;
    }

    /** End what begin() started. @param array{0: int, 1: float}|null $started */
    public function end(?array $started, string $outcome = 'ok', ?string $note = null): void
    {
        if ($started) {
            $this->update($started[0], ['duration_ms' => (int) round(($this->now() - $started[1]) * 1000), 'outcome' => $outcome, 'note' => $note]);
        }
    }

    // ------------------------------------------------------------------ reading

    /** Every event of a run, in order. */
    public function forRun(int $run): array
    {
        $st = $this->pdo->prepare('SELECT * FROM `generation_events` WHERE `generation_id` = ? ORDER BY `seq`');
        $st->execute([$run]);

        return array_map(fn ($r) => self::present($r), $st->fetchAll(PDO::FETCH_ASSOC));
    }

    /**
     * Where a run's time and money went: totals, and the same by stage and by type and kind.
     *
     * @return array{total: array, stages: list<array>, kinds: list<array>}
     */
    public function totals(int $run): array
    {
        $sum = 'COUNT(*) AS events, COALESCE(SUM(`duration_ms`), 0) AS ms, COALESCE(SUM(`usd`), 0) AS usd, COALESCE(SUM(`input_tokens`), 0) AS input_tokens, '
            .'COALESCE(SUM(`output_tokens`), 0) AS output_tokens, COALESCE(SUM(`cache_read_tokens`), 0) AS cache_read_tokens, COALESCE(SUM(`cache_write_tokens`), 0) AS cache_write_tokens';
        $spent = "`type` IN ('llm', 'picture', 'voice')";
        $one = fn (string $sql) => $this->rows($sql, [$run]);

        return [
            'total' => self::numbers($one("SELECT $sum FROM `generation_events` WHERE `generation_id` = ? AND $spent")[0] ?? []),
            // Stage rows are the clock on the wall (what a teacher waits); spent figures are what its calls add up to.
            'stages' => array_map(self::numbers(...), $one("SELECT `stage`, MAX(CASE WHEN `type` = 'stage' THEN `duration_ms` END) AS stage_ms, "
                .'SUM(CASE WHEN `type` = \'llm\' THEN 1 ELSE 0 END) AS llm_calls, SUM(CASE WHEN `type` = \'picture\' THEN 1 ELSE 0 END) AS pictures, '
                .'SUM(CASE WHEN `type` = \'voice\' THEN 1 ELSE 0 END) AS voice_lines, COALESCE(SUM(`usd`), 0) AS usd, MIN(`seq`) AS first_seq '
                .'FROM `generation_events` WHERE `generation_id` = ? AND `stage` IS NOT NULL AND `type` <> \'estimate\' GROUP BY `stage` ORDER BY first_seq')),
            'kinds' => array_map(self::numbers(...), $one("SELECT `type`, `kind`, $sum, SUM(CASE WHEN `outcome` = 'kept' THEN 1 ELSE 0 END) AS kept FROM `generation_events` "
                ."WHERE `generation_id` = ? AND $spent GROUP BY `type`, `kind` ORDER BY `type`, `usd` DESC")),
        ];
    }

    /**
     * Recent runs with what each took and cost, newest first.
     *
     * @return list<array>
     */
    public function runs(int $limit = 20): array
    {
        $rows = $this->rows('SELECT g.`id`, g.`status`, g.`prompt`, g.`created_at`, g.`user_id`, '
            ."(SELECT COUNT(*) FROM `generation_events` e WHERE e.`generation_id` = g.`id` AND e.`type` = 'llm') AS llm_calls, "
            ."(SELECT COUNT(*) FROM `generation_events` e WHERE e.`generation_id` = g.`id` AND e.`type` = 'picture') AS pictures, "
            ."(SELECT COALESCE(SUM(e.`usd`), 0) FROM `generation_events` e WHERE e.`generation_id` = g.`id` AND e.`type` IN ('llm', 'picture', 'voice')) AS usd, "
            ."(SELECT COALESCE(SUM(e.`duration_ms`), 0) FROM `generation_events` e WHERE e.`generation_id` = g.`id` AND e.`type` = 'stage') AS ms "
            .'FROM `scenario_generations` g ORDER BY g.`id` DESC LIMIT '.max(1, $limit));

        return array_map(self::numbers(...), $rows);
    }

    /** The table and its indexes for SQLite (the dev server and the tests); MySQL gets them from the migration. */
    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `generation_events` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `generation_id` INTEGER NOT NULL, `seq` INTEGER NOT NULL, `stage`, `type` NOT NULL, `kind`, `step`, `label`, `attempt` INTEGER, `model`, `size`, '
                .'`started_at` NOT NULL, `duration_ms` INTEGER, `input_tokens` INTEGER, `output_tokens` INTEGER, `cache_read_tokens` INTEGER, `cache_write_tokens` INTEGER, `references` INTEGER, `usd` REAL NOT NULL DEFAULT 0, `score` REAL, `outcome`, `note`, `detail`, `created_at`)',
            'CREATE INDEX IF NOT EXISTS `generation_events_run` ON `generation_events` (`generation_id`, `seq`)',
            'CREATE INDEX IF NOT EXISTS `generation_events_step` ON `generation_events` (`generation_id`, `step`, `attempt`)',
        ];
    }

    // ------------------------------------------------------------------ helpers

    private function nextSeq(int $run): int
    {
        if (! isset($this->seq[$run])) {
            $st = $this->pdo->prepare('SELECT COALESCE(MAX(`seq`), 0) FROM `generation_events` WHERE `generation_id` = ?');
            $st->execute([$run]);
            $this->seq[$run] = (int) $st->fetchColumn();
        }

        return ++$this->seq[$run];
    }

    private function rows(string $sql, array $args = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    private function now(): float
    {
        return $this->clock ? (float) ($this->clock)() : microtime(true);
    }

    /** "2026-11-21 14:20:05.123" (UTC) */
    private static function stamp(float $t): string
    {
        return gmdate('Y-m-d H:i:s', (int) floor($t)).sprintf('.%03d', (int) round(($t - floor($t)) * 1000) % 1000);
    }

    /** Numbers come back from PDO as strings on some drivers: make them numbers. */
    private static function numbers(array $row): array
    {
        foreach ($row as $k => $v) {
            if (is_string($v) && is_numeric($v) && ! in_array($k, self::TEXT, true)) {
                $row[$k] = str_contains($v, '.') ? (float) $v : (int) $v;
            }
        }

        return $row;
    }

    private static function present(array $row): array
    {
        $row = self::numbers($row);
        $row['detail'] = isset($row['detail']) && is_string($row['detail']) ? json_decode($row['detail'], true) : null;

        return $row;
    }
}
