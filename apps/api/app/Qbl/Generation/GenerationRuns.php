<?php

namespace App\Qbl\Generation;

use PDO;

/** The scenario_generations table: one row per run of the generator. Plain PHP over PDO. */
class GenerationRuns
{
    private const JSON = ['options', 'alignment', 'blueprint', 'manifest'];

    public function __construct(private PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    public function create(string $prompt, array $options, ?int $userId): int
    {
        $now = gmdate('Y-m-d H:i:s');
        $this->pdo->prepare('INSERT INTO `scenario_generations` (`user_id`, `prompt`, `options`, `status`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?)')
            ->execute([$userId, $prompt, json_encode($options), 'queued', $now, $now]);

        return (int) $this->pdo->lastInsertId();
    }

    public function get(int $id): ?array
    {
        $st = $this->pdo->prepare('SELECT * FROM `scenario_generations` WHERE `id` = ?');
        $st->execute([$id]);
        $row = $st->fetch(PDO::FETCH_ASSOC);
        if (! $row) {
            return null;
        }
        foreach (self::JSON as $column) {
            $row[$column] = $row[$column] !== null ? json_decode((string) $row[$column], true) : null;
        }

        return $row;
    }

    public function update(int $id, array $fields): void
    {
        foreach (self::JSON as $column) {
            if (array_key_exists($column, $fields) && $fields[$column] !== null) {
                $fields[$column] = json_encode($fields[$column], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            }
        }
        $fields['updated_at'] = gmdate('Y-m-d H:i:s');
        $sets = implode(', ', array_map(fn ($c) => "`$c` = ?", array_keys($fields)));
        $this->pdo->prepare("UPDATE `scenario_generations` SET $sets WHERE `id` = ?")->execute([...array_values($fields), $id]);
    }

    public static function sqliteSchema(): array
    {
        return ['CREATE TABLE IF NOT EXISTS `scenario_generations` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER, `scenario_id` INTEGER, `prompt`, `options`, `status`, `alignment`, `blueprint`, `manifest`, `error`, `created_at`, `updated_at`)'];
    }
}
