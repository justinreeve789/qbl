<?php

namespace App\Qbl\Generation\Curriculum;

use App\Qbl\Generation\GenerationError;
use PDO;

/**
 * The curriculum_standards and scenario_standards tables. Plain PHP over PDO, like the stores in
 * App\Qbl, so the tests run it on SQLite.
 */
class StandardsStore
{
    public function __construct(private PDO $pdo)
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    /** Add a standard, or update it when one with the same source_id is there. Returns its id. */
    public function upsert(array $s): int
    {
        $now = gmdate('Y-m-d H:i:s');
        $row = [
            'framework' => strtoupper(trim((string) $s['framework'])),
            'jurisdiction' => $s['jurisdiction'] ?? null,
            'subject' => $s['subject'] ?? null,
            'code' => isset($s['code']) && trim((string) $s['code']) !== '' ? trim((string) $s['code']) : null,
            'grade_levels' => json_encode(self::grades($s['grade_levels'] ?? [])),
            'description' => trim(strip_tags((string) $s['description'])),
            'source' => $s['source'] ?? 'manual',
            'source_id' => $s['source_id'] ?? (strtoupper((string) $s['framework']).':'.($s['code'] ?? md5((string) $s['description']))),
            'parent_source_id' => $s['parent_source_id'] ?? null,
            'depth' => (int) ($s['depth'] ?? 0),
        ];
        if ($row['description'] === '') {
            throw new GenerationError('A standard needs a description.');
        }
        $existing = $this->one('SELECT `id` FROM `curriculum_standards` WHERE `source_id` = ?', [$row['source_id']]);
        if ($existing) {
            $sets = implode(', ', array_map(fn ($c) => "`$c` = ?", array_keys($row)));
            $this->pdo->prepare("UPDATE `curriculum_standards` SET $sets, `updated_at` = ? WHERE `id` = ?")->execute([...array_values($row), $now, $existing['id']]);

            return (int) $existing['id'];
        }
        $columns = array_keys($row);
        $this->pdo->prepare('INSERT INTO `curriculum_standards` (`'.implode('`, `', $columns).'`, `created_at`, `updated_at`) VALUES ('.rtrim(str_repeat('?, ', count($columns) + 2), ', ').')')
            ->execute([...array_values($row), $now, $now]);

        return (int) $this->pdo->lastInsertId();
    }

    /** The frameworks that have standards, with how many. */
    public function frameworks(): array
    {
        return $this->all('SELECT `framework`, `jurisdiction`, `subject`, COUNT(*) AS `standards` FROM `curriculum_standards` WHERE `code` IS NOT NULL GROUP BY `framework`, `jurisdiction`, `subject` ORDER BY `framework`');
    }

    /**
     * Standards that could fit a mission: those of the framework(s) and grade, ranked by how many of
     * the words in $about they share. Only standards with a code are offered, since those are what
     * teachers report against. Each comes with its parent's description, which often carries the
     * meaning a short sub-standard leaves out.
     *
     * @param  string[]  $frameworks
     */
    public function candidates(array $frameworks, ?string $grade, string $about, int $limit = 120): array
    {
        $where = ['s.`code` IS NOT NULL'];
        $params = [];
        if ($frameworks) {
            $where[] = 's.`framework` IN ('.rtrim(str_repeat('?, ', count($frameworks)), ', ').')';
            array_push($params, ...array_map('strtoupper', $frameworks));
        }
        if ($grade !== null && $grade !== '') {
            $or = [];
            foreach (self::grades([$grade]) as $g) {
                $or[] = 's.`grade_levels` LIKE ?';
                $params[] = '%"'.$g.'"%';
            }
            $where[] = '('.implode(' OR ', $or).')';
        }
        $rows = $this->all('SELECT s.*, p.`description` AS `parent_description` FROM `curriculum_standards` s
            LEFT JOIN `curriculum_standards` p ON p.`source_id` = s.`parent_source_id`
            WHERE '.implode(' AND ', $where).' ORDER BY s.`code`', $params);

        $words = self::words($about);
        foreach ($rows as &$row) {
            $text = self::words($row['description'].' '.($row['parent_description'] ?? '').' '.($row['subject'] ?? ''));
            $row['score'] = count(array_intersect_key($words, $text));
            $row['grade_levels'] = json_decode((string) $row['grade_levels'], true) ?: [];
        }
        unset($row);
        usort($rows, fn ($a, $b) => [$b['score'], $a['code']] <=> [$a['score'], $b['code']]);

        return array_slice($rows, 0, $limit);
    }

    /** Standards by code, within the frameworks when given. Codes are matched without regard to case. */
    public function byCodes(array $codes, array $frameworks = []): array
    {
        if (! $codes) {
            return [];
        }
        $params = array_map(fn ($c) => strtolower(trim($c)), $codes);
        $sql = 'SELECT * FROM `curriculum_standards` WHERE LOWER(`code`) IN ('.rtrim(str_repeat('?, ', count($params)), ', ').')';
        if ($frameworks) {
            $sql .= ' AND `framework` IN ('.rtrim(str_repeat('?, ', count($frameworks)), ', ').')';
            array_push($params, ...array_map('strtoupper', $frameworks));
        }

        return array_map(function ($r) {
            $r['grade_levels'] = json_decode((string) $r['grade_levels'], true) ?: [];

            return $r;
        }, $this->all($sql, $params));
    }

    /** Record a scenario's standards (from StandardsAligner, with evidence from the built mission). */
    public function attach(int $scenarioId, array $alignment): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $this->pdo->prepare('DELETE FROM `scenario_standards` WHERE `scenario_id` = ?')->execute([$scenarioId]);
        $insert = $this->pdo->prepare('INSERT INTO `scenario_standards` (`scenario_id`, `curriculum_standard_id`, `alignment`, `rationale`, `evidence`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?)');
        $seen = [];
        foreach ($alignment as $a) {
            if (isset($seen[$a['standard_id']])) {
                continue;
            }
            $seen[$a['standard_id']] = true;
            $insert->execute([$scenarioId, $a['standard_id'], $a['alignment'] ?? 'primary', $a['rationale'] ?? null, json_encode($a['evidence'] ?? []), $now, $now]);
        }
    }

    public function forScenario(int $scenarioId): array
    {
        return $this->all('SELECT s.`framework`, s.`code`, s.`description`, ss.`alignment`, ss.`rationale`, ss.`evidence` FROM `scenario_standards` ss
            JOIN `curriculum_standards` s ON s.`id` = ss.`curriculum_standard_id` WHERE ss.`scenario_id` = ? ORDER BY ss.`alignment`, s.`code`', [$scenarioId]);
    }

    /**
     * Grade levels as Common Standards Project writes them: "K", "01" ... "12", plus "Pre-K".
     * Accepts "5", "grade 5", "K", "6-8", "HS", "middle school".
     */
    public static function grades(array $values): array
    {
        $out = [];
        foreach ($values as $value) {
            $v = strtoupper(trim((string) $value));
            $v = preg_replace('/^(GRADES?|GR\.?)\s*/', '', $v);
            if ($v === '') {
                continue;
            }
            if (in_array($v, ['K', 'KG', 'KINDERGARTEN'], true)) {
                $out[] = 'K';
            } elseif (in_array($v, ['PK', 'PRE-K', 'PREK'], true)) {
                $out[] = 'Pre-K';
            } elseif (in_array($v, ['HS', 'HIGH SCHOOL'], true)) {
                array_push($out, '09', '10', '11', '12');
            } elseif (in_array($v, ['MS', 'MIDDLE SCHOOL'], true)) {
                array_push($out, '06', '07', '08');
            } elseif (preg_match('/^(K|\d{1,2})\s*[-–]\s*(\d{1,2})$/', $v, $m)) {
                $from = $m[1] === 'K' ? 0 : (int) $m[1];
                for ($g = $from; $g <= (int) $m[2]; $g++) {
                    $out[] = $g === 0 ? 'K' : sprintf('%02d', $g);
                }
            } elseif (ctype_digit($v)) {
                $out[] = sprintf('%02d', (int) $v);
            } else {
                $out[] = $v;
            }
        }

        return array_values(array_unique($out));
    }

    /** Words worth matching on, as array keys. */
    private static function words(string $text): array
    {
        static $stop = ['the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'use', 'using', 'how', 'what', 'their', 'they', 'can', 'into', 'about', 'students', 'student', 'mission', 'game', 'make', 'have', 'such', 'other', 'when', 'which', 'where', 'will', 'each', 'more', 'than'];
        preg_match_all('/[a-z]{3,}/', strtolower($text), $m);
        $words = [];
        foreach ($m[0] as $w) {
            if (! in_array($w, $stop, true)) {
                $words[rtrim($w, 's')] = true;
            }
        }

        return $words;
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `curriculum_standards` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `framework`, `jurisdiction`, `subject`, `code`, `grade_levels`, `description`, `source`, `source_id` UNIQUE, `parent_source_id`, `depth` INTEGER, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `scenario_standards` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `scenario_id` INTEGER, `curriculum_standard_id` INTEGER, `alignment`, `rationale`, `evidence`, `created_at`, `updated_at`, UNIQUE(`scenario_id`, `curriculum_standard_id`))',
        ];
    }

    private function one(string $sql, array $params = []): ?array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);

        return $st->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    private function all(string $sql, array $params = []): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }
}
