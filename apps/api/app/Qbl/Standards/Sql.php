<?php

namespace App\Qbl\Standards;

use PDO;

/** Small PDO helpers shared by the standards classes (MariaDB/MySQL and SQLite). */
final class Sql
{
    /** Namespace for name-based (v5) uuids of standards rows. */
    public const UUID_NAMESPACE = '6f1c3a52-0b7e-5d4e-9a51-7a3b2f0c9e11';

    public static function isMysql(PDO $db): bool
    {
        return in_array($db->getAttribute(PDO::ATTR_DRIVER_NAME), ['mysql', 'mariadb'], true);
    }

    public static function scalar(PDO $db, string $sql, array $args = []): mixed
    {
        $q = $db->prepare($sql);
        $q->execute($args);
        $v = $q->fetchColumn();

        return $v === false ? null : $v;
    }

    public static function rows(PDO $db, string $sql, array $args = []): array
    {
        $q = $db->prepare($sql);
        $q->execute($args);

        return $q->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function row(PDO $db, string $sql, array $args = []): ?array
    {
        $q = $db->prepare($sql);
        $q->execute($args);
        $r = $q->fetch(PDO::FETCH_ASSOC);

        return $r === false ? null : $r;
    }

    public static function insert(PDO $db, string $table, array $values): int
    {
        $cols = array_keys($values);
        $sql = sprintf('INSERT INTO %s (%s) VALUES (%s)', $table, implode(', ', $cols), implode(', ', array_fill(0, count($cols), '?')));
        $db->prepare($sql)->execute(array_values($values));

        return (int) $db->lastInsertId();
    }

    public static function update(PDO $db, string $table, int $id, array $values): void
    {
        if (! $values) {
            return;
        }
        $set = implode(', ', array_map(fn ($c) => "$c = ?", array_keys($values)));
        $db->prepare("UPDATE $table SET $set WHERE id = ?")->execute([...array_values($values), $id]);
    }

    /** Find by natural key, update $values (or insert $keys + $values + $insertOnly). Returns the id. */
    public static function upsert(PDO $db, string $table, array $keys, array $values, array $insertOnly = []): int
    {
        $where = implode(' AND ', array_map(fn ($c) => "$c = ?", array_keys($keys)));
        $id = self::scalar($db, "SELECT id FROM $table WHERE $where", array_values($keys));
        if ($id) {
            self::update($db, $table, (int) $id, $values);

            return (int) $id;
        }

        return self::insert($db, $table, $keys + $values + $insertOnly);
    }

    /** Multi-row insert in chunks. */
    public static function insertMany(PDO $db, string $table, array $cols, array $rows, string $verb = 'INSERT', int $chunk = 500): void
    {
        foreach (array_chunk($rows, $chunk) as $part) {
            $one = '(' . implode(', ', array_fill(0, count($cols), '?')) . ')';
            $sql = sprintf('%s INTO %s (%s) VALUES %s', $verb, $table, implode(', ', $cols), implode(', ', array_fill(0, count($part), $one)));
            $db->prepare($sql)->execute(array_merge(...array_map('array_values', $part)));
        }
    }

    public static function insertIgnore(PDO $db): string
    {
        return self::isMysql($db) ? 'INSERT IGNORE' : 'INSERT OR IGNORE';
    }

    /** RFC 4122 version 5 uuid. */
    public static function uuid5(string $name, string $namespace = self::UUID_NAMESPACE): string
    {
        $ns = hex2bin(str_replace('-', '', $namespace));
        $h = sha1($ns . $name);
        $h = substr($h, 0, 12) . '5' . substr($h, 13, 3) . dechex((hexdec($h[16]) & 0x3) | 0x8) . substr($h, 17, 15);

        return sprintf('%s-%s-%s-%s-%s', substr($h, 0, 8), substr($h, 8, 4), substr($h, 12, 4), substr($h, 16, 4), substr($h, 20, 12));
    }

    public static function json(mixed $v): ?string
    {
        return $v === null || $v === [] ? null : json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
