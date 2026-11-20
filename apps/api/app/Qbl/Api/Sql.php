<?php

namespace App\Qbl\Api;

use PDO;

/** The few PDO helpers every class of the public API uses, as the other stores have them. */
trait Sql
{
    private PDO $pdo;

    private function run(string $sql, array $params = []): int
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);

        return $st->rowCount();
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

    private function insert(string $sql, array $params = []): int
    {
        $this->run($sql, $params);

        return (int) $this->pdo->lastInsertId();
    }

    /** `?, ?, ?` for a list, for `IN (...)`. An empty list gives `NULL`, which matches nothing. */
    private static function marks(array $list): string
    {
        return $list ? implode(', ', array_fill(0, count($list), '?')) : 'NULL';
    }

    private static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    /** A time as the database keeps it (UTC), as ISO 8601. */
    private static function iso(?string $stored): ?string
    {
        return $stored ? gmdate('Y-m-d\TH:i:s\Z', strtotime($stored.' UTC')) : null;
    }

    private static function json(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        $data = is_string($value) ? json_decode($value, true) : null;

        return is_array($data) ? $data : [];
    }
}
