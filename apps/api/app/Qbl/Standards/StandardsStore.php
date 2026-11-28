<?php

namespace App\Qbl\Standards;

use PDO;

/** Read side of the standards library, plus aligning QBL content to standards. */
final class StandardsStore
{
    /**
     * A mission's standards (one placeholder: the scenario id) as reports and the public API show them,
     * the fields scenario_standards had: framework (the jurisdiction code, or an imported set's name),
     * code, description, alignment, plus rationale, evidence, uuid, status, framework_slug, jurisdiction.
     */
    public const SCENARIO_SQL = "SELECT CASE WHEN j.code = 'QBL' THEN f.title ELSE j.code END AS framework, i.code, i.statement AS description,
            a.strength AS alignment, a.rationale, a.evidence, i.uuid, i.status, f.slug AS framework_slug, j.code AS jurisdiction
        FROM standard_alignments a JOIN standard_items i ON i.id = a.item_id JOIN standard_documents d ON d.id = i.document_id
        JOIN standard_frameworks f ON f.id = d.framework_id JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
        WHERE a.scenario_id = ? AND a.alignable_type = 'scenario' ORDER BY a.strength, i.code";

    /** An uncoded statement's reference: its jurisdiction and the start of its uuid (GB-ENG-1a2b3c4d). */
    public static function ref(array $row): string
    {
        return ($row['jurisdiction'] ?? 'STD') . '-' . substr((string) $row['uuid'], 0, 8);
    }

    /** A SCENARIO_SQL row with its code filled in for uncoded statements. */
    public static function present(array $row): array
    {
        $row['code'] ??= self::ref($row);

        return $row;
    }

    public function __construct(private PDO $db)
    {
    }

    /** By uuid, else by code (preferring an active item in a current document). */
    public function find(string $uuidOrCode, ?string $jurisdiction = null): ?array
    {
        if (preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $uuidOrCode)) {
            return Sql::row($this->db, 'SELECT * FROM standard_items WHERE uuid = ?', [strtolower($uuidOrCode)]);
        }
        $args = [$uuidOrCode, $uuidOrCode];
        $where = '';
        if ($jurisdiction) {
            $where = 'AND j.code = ?';
            $args[] = $jurisdiction;
        }

        return Sql::row($this->db, "SELECT i.* FROM standard_items i JOIN standard_documents d ON d.id = i.document_id
            JOIN standard_frameworks f ON f.id = d.framework_id JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
            WHERE (i.code = ? OR i.alt_code = ?) $where
            ORDER BY i.status = 'active' DESC, d.status = 'current' DESC, d.published_year DESC LIMIT 1", $args);
    }

    /**
     * Full-text search over active items of current documents.
     * Filters: jurisdictions (codes), grade (US-grade equivalent, matches any system's level band),
     * subject (slug, includes child subjects), documents (ids), include_superseded, limit, offset.
     */
    public function search(string $text, array $f = []): array
    {
        $where = ["i.status = 'active'"];
        $args = [];
        $order = 'j.code, d.id, i.position';
        $text = trim($text);
        if ($text !== '') {
            if (Sql::isMysql($this->db)) {
                $where[] = 'MATCH(i.statement) AGAINST (? IN NATURAL LANGUAGE MODE)';
                $args[] = $text;
                $order = 'MATCH(i.statement) AGAINST (? IN NATURAL LANGUAGE MODE) DESC';
            } else {
                foreach (preg_split('/\s+/', $text) as $w) {
                    $where[] = 'i.statement LIKE ?';
                    $args[] = '%' . $w . '%';
                }
            }
        }
        if (empty($f['include_superseded'])) {
            $where[] = "d.status = 'current'";
        }
        if (! empty($f['jurisdictions'])) {
            $where[] = 'j.code IN (' . implode(',', array_fill(0, count($f['jurisdictions']), '?')) . ')';
            array_push($args, ...$f['jurisdictions']);
        }
        if (! empty($f['documents'])) {
            $where[] = 'd.id IN (' . implode(',', array_map('intval', $f['documents'])) . ')';
        }
        if (! empty($f['subject'])) {
            $where[] = 'f.subject_id IN (SELECT s.id FROM standard_subjects s LEFT JOIN standard_subjects p ON p.id = s.parent_id WHERE s.slug = ? OR p.slug = ?)';
            array_push($args, $f['subject'], $f['subject']);
        }
        if (isset($f['grade'])) {
            // a correlated count, not EXISTS: MariaDB turns EXISTS into a semi-join over every standard at the grade
            $where[] = '(SELECT COUNT(*) FROM standard_item_levels il JOIN standard_education_levels el ON el.id = il.level_id
                WHERE il.item_id = i.id AND el.grade_from <= ? AND el.grade_to >= ?) > 0';
            array_push($args, (int) $f['grade'], (int) $f['grade']);
        }
        if ($text !== '' && Sql::isMysql($this->db)) {
            $args[] = $text;
        }
        $limit = max(1, min(500, (int) ($f['limit'] ?? 50)));
        $offset = max(0, (int) ($f['offset'] ?? 0));
        $sql = 'SELECT i.id, i.uuid, i.code, i.alt_code, i.item_type, i.type_label, i.statement, i.document_id, d.title AS document,
                d.version_label, j.code AS jurisdiction, f.slug AS framework
            FROM standard_items i JOIN standard_documents d ON d.id = i.document_id
            JOIN standard_frameworks f ON f.id = d.framework_id JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
            WHERE ' . implode(' AND ', $where) . " ORDER BY $order LIMIT $limit OFFSET $offset";
        $rows = Sql::rows($this->db, $sql, $args);

        return $this->withLevels($rows);
    }

    public function withLevels(array $rows): array
    {
        if (! $rows) {
            return $rows;
        }
        $ids = array_map(fn ($r) => (int) $r['id'], $rows);
        $levels = [];
        $names = [];
        foreach (Sql::rows($this->db, 'SELECT id, code FROM standard_education_levels ORDER BY sort, id') as $l) {
            $names[(int) $l['id']] = $l['code'];
        }
        // item ids alone: joining the levels table here makes MariaDB scan every item_levels row
        foreach (Sql::rows($this->db, 'SELECT item_id, level_id FROM standard_item_levels WHERE item_id IN (' . implode(',', $ids) . ')') as $l) {
            $levels[$l['item_id']][(int) $l['level_id']] = true;
        }
        foreach ($levels as $id => $set) {
            $levels[$id] = array_values(array_intersect_key($names, $set));
        }
        foreach ($rows as &$r) {
            $r['levels'] = implode(',', $levels[$r['id']] ?? []);
        }

        return $rows;
    }

    /** Ancestors from the root down, for breadcrumbs. */
    public function ancestors(array $item): array
    {
        $ids = array_filter(array_map('intval', explode('/', trim($item['lineage'], '/'))));
        if (! $ids) {
            return [];
        }
        $rows = Sql::rows($this->db, 'SELECT id, uuid, code, item_type, statement FROM standard_items WHERE id IN (' . implode(',', $ids) . ')');
        usort($rows, fn ($a, $b) => array_search((int) $a['id'], $ids) <=> array_search((int) $b['id'], $ids));

        return $rows;
    }

    public function children(int $documentId, ?int $parentId = null, bool $includeRetired = false): array
    {
        $sql = 'SELECT id, uuid, code, alt_code, item_type, type_label, statement, status, (SELECT COUNT(*) FROM standard_items c WHERE c.parent_id = i.id) AS child_count
            FROM standard_items i WHERE document_id = ? AND ' . ($parentId ? 'parent_id = ?' : 'parent_id IS NULL') . ($includeRetired ? '' : " AND status = 'active'") . ' ORDER BY position';

        return Sql::rows($this->db, $sql, $parentId ? [$documentId, $parentId] : [$documentId]);
    }

    /** Every item under $item (by lineage prefix), in reading order. */
    public function subtree(array $item): array
    {
        return Sql::rows($this->db, "SELECT id, uuid, code, item_type, depth, statement FROM standard_items WHERE document_id = ? AND lineage LIKE ? AND status = 'active' ORDER BY position",
            [$item['document_id'], $item['lineage'] . $item['id'] . '/%']);
    }

    /** Equivalent or related standards elsewhere, both directions. */
    public function crosswalk(int $itemId): array
    {
        return Sql::rows($this->db, "SELECT a.type, 'out' AS direction, i.uuid, i.code, i.statement, j.code AS jurisdiction, a.destination_uri
            FROM standard_associations a LEFT JOIN standard_items i ON i.id = a.destination_item_id
            LEFT JOIN standard_documents d ON d.id = i.document_id LEFT JOIN standard_frameworks f ON f.id = d.framework_id
            LEFT JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id WHERE a.origin_item_id = ?
            UNION ALL
            SELECT a.type, 'in', i.uuid, i.code, i.statement, j.code, NULL FROM standard_associations a JOIN standard_items i ON i.id = a.origin_item_id
            JOIN standard_documents d ON d.id = i.document_id JOIN standard_frameworks f ON f.id = d.framework_id
            JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id WHERE a.destination_item_id = ?", [$itemId, $itemId]);
    }

    public function history(int $itemId): array
    {
        return Sql::rows($this->db, 'SELECT revision, change_type, previous, fields, created_at FROM standard_item_revisions WHERE item_id = ? ORDER BY revision, id', [$itemId]);
    }

    public function documentHistory(int $documentId): array
    {
        return Sql::rows($this->db, 'SELECT revision, item_count, added, changed, retired, restored, note, created_at FROM standard_document_revisions WHERE document_id = ? ORDER BY revision', [$documentId]);
    }

    /** Frameworks for a picker, with their current edition. */
    public function frameworks(?string $jurisdiction = null, ?int $organizationId = null): array
    {
        $args = [];
        $where = ['(f.organization_id IS NULL' . ($organizationId ? ' OR f.organization_id = ?' : '') . ')'];
        if ($organizationId) {
            $args[] = $organizationId;
        }
        if ($jurisdiction) {
            $where[] = 'j.code = ?';
            $args[] = $jurisdiction;
        }

        return Sql::rows($this->db, 'SELECT f.id, f.slug, f.title, f.language, s.slug AS subject, j.code AS jurisdiction, d.id AS document_id, d.title AS document,
                d.version_label, d.item_count FROM standard_frameworks f JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
            LEFT JOIN standard_subjects s ON s.id = f.subject_id LEFT JOIN standard_documents d ON d.id = f.current_document_id
            WHERE ' . implode(' AND ', $where) . ' ORDER BY j.code, f.title', $args);
    }

    // ---------------------------------------------------------------- alignments

    /**
     * @param  string  $strength  primary | supporting (what the generator writes), or introduces | practices | assesses
     */
    public function align(int $itemId, string $type, int $id, ?int $scenarioId = null, string $strength = 'primary', ?int $userId = null,
        ?string $rationale = null, ?array $evidence = null): int
    {
        $now = date('Y-m-d H:i:s');
        $revision = Sql::scalar($this->db, 'SELECT d.revision FROM standard_items i JOIN standard_documents d ON d.id = i.document_id WHERE i.id = ?', [$itemId]);

        return Sql::upsert($this->db, 'standard_alignments', ['item_id' => $itemId, 'alignable_type' => $type, 'alignable_id' => $id], [
            'scenario_id' => $scenarioId, 'strength' => $strength, 'rationale' => $rationale, 'evidence' => Sql::json($evidence),
            'item_revision' => $revision, 'user_id' => $userId, 'updated_at' => $now,
        ], ['created_at' => $now]);
    }

    public function unalign(int $itemId, string $type, int $id): void
    {
        $this->db->prepare('DELETE FROM standard_alignments WHERE item_id = ? AND alignable_type = ? AND alignable_id = ?')->execute([$itemId, $type, $id]);
    }

    /**
     * Standards a scenario is aligned to, each flagged when it has changed or been retired
     * since it was aligned, with any replacement the publisher named.
     */
    public function alignmentsForScenario(int $scenarioId): array
    {
        return Sql::rows($this->db, "SELECT a.alignable_type, a.alignable_id, a.strength, a.rationale, i.uuid, i.code, i.statement, i.status, j.code AS jurisdiction,
                d.title AS document, d.version_label, (i.last_revision > COALESCE(a.item_revision, 0)) AS changed_since,
                (SELECT r.uuid FROM standard_associations x JOIN standard_items r ON r.id = x.destination_item_id WHERE x.origin_item_id = i.id AND x.type = 'replacedBy' LIMIT 1) AS replaced_by
            FROM standard_alignments a JOIN standard_items i ON i.id = a.item_id JOIN standard_documents d ON d.id = i.document_id
            JOIN standard_frameworks f ON f.id = d.framework_id JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
            WHERE a.scenario_id = ? ORDER BY a.alignable_type, a.alignable_id, i.code", [$scenarioId]);
    }
}
