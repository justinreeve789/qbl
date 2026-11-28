<?php

namespace App\Qbl\Generation\Curriculum;

use App\Qbl\Standards\Sql;
use App\Qbl\Standards\StandardsSchema;
use App\Qbl\Standards\StandardsStore;
use PDO;

/**
 * The standards a mission can be aligned to (from the standards library, App\Qbl\Standards) and the
 * ones it is aligned to (standard_alignments, alignable_type "scenario"). Plain PHP over PDO, so the
 * generation tests run it on SQLite.
 *
 * Frameworks are chosen with selectors (--framework on qbl:generate):
 *   US-TX            a jurisdiction: every current Texas framework
 *   US-TX:science    a jurisdiction's frameworks in a subject (or its child subjects)
 *   us-tx-science    a framework slug
 *   NGSS, CCSS, CCSS-MATH, CCSS-ELA   shorthands for US-NGSS, US-CCSS, US-CCSS:mathematics, US-CCSS:ela
 *   TEST-SCI         a set imported with `qbl:standards file ... --framework=TEST-SCI` (slug qbl-test-sci)
 * With none, $defaults are used (config qbl_generation.standards.default_frameworks).
 */
class MissionStandards
{
    public const ALIASES = [
        'NGSS' => 'US-NGSS', 'CCSS' => 'US-CCSS', 'CCSS-MATH' => 'US-CCSS:mathematics', 'CCSS-ELA' => 'US-CCSS:ela',
        'CCSS-ELA-LITERACY' => 'US-CCSS:ela', 'COMMON-CORE' => 'US-CCSS',
    ];

    /** Selectors that matched no framework, from the last frameworkIds() call. */
    public array $unknown = [];

    public function __construct(private PDO $pdo, private array $defaults = ['US-CCSS', 'US-NGSS', 'QBL'])
    {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    /** Framework ids for selectors (the defaults when there are none). */
    public function frameworkIds(array $selectors): array
    {
        $selectors = array_values(array_filter(array_map(fn ($s) => trim((string) $s), $selectors)));
        $this->unknown = [];
        $ids = [];
        foreach ($selectors ?: $this->defaults as $selector) {
            $s = self::ALIASES[strtoupper($selector)] ?? $selector;
            [$code, $subject] = array_pad(explode(':', $s, 2), 2, null);
            $found = Sql::rows($this->pdo, 'SELECT f.id FROM standard_frameworks f JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
                LEFT JOIN standard_subjects s ON s.id = f.subject_id LEFT JOIN standard_subjects ps ON ps.id = s.parent_id
                WHERE (f.slug = ? OR f.slug = ? OR (j.code = ? AND (? IS NULL OR s.slug = ? OR ps.slug = ?)))',
                [strtolower($s), \App\Qbl\Standards\Sources\StandardsList::slug($s), strtoupper((string) $code), $subject, $subject, $subject]);
            if (! $found) {
                $this->unknown[] = $selector;
            }
            foreach ($found as $r) {
                $ids[(int) $r['id']] = true;
            }
        }

        return array_keys($ids);
    }

    /**
     * Standards that could fit a mission: active items with a code, in current documents of the
     * frameworks, at the grade, ranked by how many of the words in $about they share (on MariaDB the
     * full-text index picks the pool first). Each comes with its parent's statement, which often
     * carries the meaning a short sub-standard leaves out.
     *
     * @param  string[]  $frameworks  selectors, see the class comment
     */
    public function candidates(array $frameworks, ?string $grade, string $about, int $limit = 120): array
    {
        $ids = $this->frameworkIds($frameworks);
        if (! $ids) {
            return [];
        }
        [$where, $params, $size] = $this->scope($ids, $grade);
        if ($where === null) {
            return [];
        }
        $words = self::words($about);
        $rows = [];
        // a small scope (the default: Common Core, NGSS, own sets) is scored whole; in a big one
        // (all of Texas) the full-text index picks the pool
        if (Sql::isMysql($this->pdo) && $words && $size > 20000) {
            // the full-text index picks the pool: fast on 1.6 million standards
            $q = implode(' ', array_keys($words));
            $rows = Sql::rows($this->pdo, str_replace('SELECT i.id,', 'SELECT MATCH(i.statement) AGAINST (? IN NATURAL LANGUAGE MODE) AS relevance, i.id,', self::SELECT)
                . ' WHERE ' . implode(' AND ', $where) . ' AND MATCH(i.statement) AGAINST (? IN NATURAL LANGUAGE MODE) ORDER BY relevance DESC LIMIT 600',
                [$q, ...$params, $q]);
        }
        if (count($rows) < $limit) {
            // few or no words in common: top up in reading order
            $seen = array_flip(array_column($rows, 'id'));
            foreach (Sql::rows($this->pdo, self::SELECT . ' WHERE ' . implode(' AND ', $where) . ' ORDER BY i.document_id, i.position LIMIT 20000', $params) as $r) {
                if (! isset($seen[$r['id']])) {
                    $rows[] = $r + ['relevance' => 0];
                }
            }
        }
        foreach ($rows as &$row) {
            $text = self::words($row['description'] . ' ' . ($row['parent_description'] ?? '') . ' ' . ($row['subject'] ?? ''));
            $row['score'] = count(array_intersect_key($words, $text));
            $row['code'] ??= self::ref($row);
        }
        unset($row);
        usort($rows, fn ($a, $b) => [$b['score'], (float) ($b['relevance'] ?? 0), $a['code']] <=> [$a['score'], (float) ($a['relevance'] ?? 0), $b['code']]);

        return $this->withGrades(array_slice($rows, 0, $limit));
    }

    /**
     * Standards by code (or short code: 3.NF.2 for CCSS.Math.Content.3.NF.A.2), case-insensitive, one per
     * code, or by the reference an uncoded statement is offered under (GB-ENG-1a2b3c4d). Within the
     * frameworks when given; otherwise anywhere, preferring the default frameworks. Each row's code is
     * the form that was asked for.
     */
    public function byCodes(array $codes, array $frameworks = []): array
    {
        $codes = array_values(array_unique(array_filter(array_map(fn ($c) => trim((string) $c), $codes))));
        if (! $codes) {
            return [];
        }
        $lower = array_map('strtolower', $codes);
        $in = implode(', ', array_fill(0, count($lower), '?'));
        // MariaDB's collation is case-insensitive, and a plain IN uses the index; SQLite needs LOWER()
        $match = Sql::isMysql($this->pdo) ? "(i.code IN ($in) OR i.alt_code IN ($in))" : "(LOWER(i.code) IN ($in) OR LOWER(i.alt_code) IN ($in))";
        $params = [...$lower, ...$lower];
        $where = ["i.status = 'active'", "d.status = 'current'"];
        $prefer = $this->frameworkIds([]);
        if ($frameworks) {
            $ids = $this->frameworkIds($frameworks) ?: [0];
            $where[] = 'd.framework_id IN (' . implode(',', $ids) . ')';
        }
        $preferSql = $prefer ? 'd.framework_id IN (' . implode(',', $prefer) . ')' : '0';
        $order = " ORDER BY ($preferSql) DESC, COALESCE(d.published_year, 0) DESC, i.id";
        // one query for codes (the code index), one per reference: an OR of both would scan every standard
        $rows = Sql::rows($this->pdo, self::SELECT . ' WHERE ' . implode(' AND ', [...$where, $match]) . $order, $params);
        foreach ($lower as $c) {
            if (preg_match('/^([a-z]{2,3}(?:-[a-z0-9]+)?)-([0-9a-f]{8})$/', $c, $m)) {
                // within that jurisdiction's documents (MariaDB's uuid type does not sort as text, so no range)
                $docs = array_map('intval', array_column(Sql::rows($this->pdo, 'SELECT d.id FROM standard_documents d JOIN standard_frameworks f ON f.id = d.framework_id
                    JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id WHERE j.code = ?', [strtoupper($m[1])]), 'id'));
                if ($docs) {
                    array_push($rows, ...Sql::rows($this->pdo, self::SELECT . ' WHERE ' . implode(' AND ', [...$where,
                        'i.document_id IN (' . implode(',', $docs) . ')', 'CAST(i.uuid AS CHAR(36)) LIKE ?']) . $order, [$m[2] . '%']));
                }
            }
        }
        $out = [];
        foreach ($rows as $r) {
            foreach ([$r['code'], $r['alt_code'], self::ref($r)] as $form) {
                $k = strtolower((string) $form);
                if ($form !== null && in_array($k, $lower, true) && ! isset($out[$k])) {
                    $out[$k] = ['code' => $codes[array_search($k, $lower, true)]] + $r;
                }
            }
        }

        return $this->withGrades(array_values($out));
    }

    /** The reference an uncoded statement (England, Wales) is offered and recorded under. */
    public static function ref(array $row): string
    {
        return StandardsStore::ref($row);
    }

    /** Record a scenario's standards (from StandardsAligner, with evidence from the built mission). */
    public function attach(int $scenarioId, array $alignment): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $this->pdo->prepare("DELETE FROM standard_alignments WHERE scenario_id = ? AND alignable_type = 'scenario'")->execute([$scenarioId]);
        $insert = $this->pdo->prepare('INSERT INTO standard_alignments (item_id, alignable_type, alignable_id, scenario_id, strength, rationale, evidence, item_revision, created_at, updated_at)
            SELECT i.id, \'scenario\', ?, ?, ?, ?, ?, d.revision, ?, ? FROM standard_items i JOIN standard_documents d ON d.id = i.document_id WHERE i.id = ?');
        $seen = [];
        foreach ($alignment as $a) {
            $id = (int) ($a['standard_id'] ?? 0);
            if (! $id || isset($seen[$id])) {
                continue;
            }
            $seen[$id] = true;
            $insert->execute([$scenarioId, $scenarioId, $a['alignment'] ?? 'primary', $a['rationale'] ?? null, json_encode($a['evidence'] ?? []), $now, $now, $id]);
        }
    }

    /** A scenario's standards: framework, code, description, alignment, rationale, evidence (and uuid, status). */
    public function forScenario(int $scenarioId): array
    {
        return array_map([StandardsStore::class, 'present'], Sql::rows($this->pdo, self::SCENARIO_SQL, [$scenarioId]));
    }

    /** What a mission's standards look like to reports and the public API (the shape scenario_standards had). */
    public const SCENARIO_SQL = StandardsStore::SCENARIO_SQL;

    private const SELECT = "SELECT i.id, i.uuid, i.code, i.alt_code, i.statement AS description, p.statement AS parent_description,
            CASE WHEN j.code = 'QBL' THEN f.title ELSE j.code END AS framework, f.slug AS framework_slug, f.title AS framework_title,
            j.code AS jurisdiction, s.name AS subject, d.id AS document_id
        FROM standard_items i JOIN standard_documents d ON d.id = i.document_id
        JOIN standard_frameworks f ON f.id = d.framework_id JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
        LEFT JOIN standard_subjects s ON s.id = f.subject_id LEFT JOIN standard_items p ON p.id = i.parent_id";

    /** [where, params, how many standards the scope holds]; where is null when no current document is in scope. */
    private function scope(array $frameworkIds, ?string $grade): array
    {
        $docs = Sql::rows($this->pdo, "SELECT id, item_count FROM standard_documents WHERE status = 'current' AND framework_id IN ("
            . implode(',', array_map('intval', $frameworkIds)) . ')');
        if (! $docs) {
            return [null, [], 0];
        }
        $size = array_sum(array_column($docs, 'item_count'));
        // by document id first, so the planner walks the few documents in scope, not every standard
        $where = ['i.document_id IN (' . implode(',', array_map(fn ($d) => (int) $d['id'], $docs)) . ')', "i.status = 'active'",
            "(i.code IS NOT NULL OR i.item_type IN ('standard', 'substandard', 'outcome', 'progression', 'expectation', 'objective', 'benchmark', 'indicator', 'competency', 'skill', 'statement'))"];
        $params = [];
        if ($grade !== null && $grade !== '') {
            $or = [];
            foreach (self::grades([$grade]) as $g) {
                $n = match (true) { $g === 'K' => 0, $g === 'Pre-K' => -1, ctype_digit($g) => (int) $g, default => null };
                if ($n !== null) {
                    $or[] = '(el.grade_from <= ? AND el.grade_to >= ?)';
                    array_push($params, $n, $n);
                }
            }
            if ($or) {
                // a correlated count, not EXISTS: MariaDB turns EXISTS into a semi-join that walks every
                // standard at the grade in the whole library (hundreds of thousands) instead of the few in scope
                $where[] = '(SELECT COUNT(*) FROM standard_item_levels il JOIN standard_education_levels el ON el.id = il.level_id WHERE il.item_id = i.id AND (' . implode(' OR ', $or) . ')) > 0';
            }
        }

        return [$where, $params, $size];
    }

    /** grade_levels as before ("K", "03"), for the rows given. */
    private function withGrades(array $rows): array
    {
        if (! $rows) {
            return $rows;
        }
        static $names = [];
        if (! $names) {
            foreach (Sql::rows($this->pdo, 'SELECT id, system, code, sort FROM standard_education_levels') as $l) {
                $names[(int) $l['id']] = [$l['system'] === 'GRADE' ? ($l['code'] === 'PK' ? 'Pre-K' : $l['code']) : $l['code'], (int) $l['sort']];
            }
        }
        $levels = [];
        // the item ids alone: joining the levels here makes MariaDB scan every item_levels row
        foreach (Sql::rows($this->pdo, 'SELECT item_id, level_id FROM standard_item_levels WHERE item_id IN (' . implode(',', array_map(fn ($r) => (int) $r['id'], $rows)) . ')') as $l) {
            if (isset($names[(int) $l['level_id']])) {
                $levels[$l['item_id']][$names[(int) $l['level_id']][1] . '.' . $l['level_id']] = $names[(int) $l['level_id']][0];
            }
        }
        foreach ($levels as &$list) {
            ksort($list, SORT_NATURAL);
            $list = array_values($list);
        }
        unset($list);
        foreach ($rows as &$r) {
            $r['grade_levels'] = $levels[$r['id']] ?? [];
        }

        return $rows;
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

    /** The standards library's tables, for SQLite test databases. */
    public static function sqliteSchema(): array
    {
        return array_values(array_filter(array_map('trim', explode(";\n", StandardsSchema::sqliteSchema()))));
    }
}
