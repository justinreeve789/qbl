<?php

namespace App\Qbl\Standards;

use InvalidArgumentException;
use PDO;
use Throwable;

/**
 * Loads standards packages (see Package::validate) into the standard_* tables.
 *
 * Every source adapter (Common Standards Project, CASE, England, Scotland, Wales,
 * Northern Ireland, a hand-made JSON file) produces packages; this class is the
 * only thing that writes standards. Importing is idempotent and revision-aware:
 *
 *  - A document whose content hash is unchanged is only touched (last_imported_at).
 *  - Otherwise its revision goes up by one. Items are matched by source key, and
 *    failing that by identical code + statement within the same parent (a move).
 *    Changed items keep their id and uuid; the old values go to standard_item_revisions.
 *    Items missing from the new package are retired, never deleted, so alignments
 *    to QBL content survive and can be shown as "this standard was retired".
 *  - Associations are replaced per document and resolved to items afterwards
 *    (resolveAssociations), so crosswalks work whichever side is imported first.
 */
final class Importer
{
    private array $levelIds = [];
    private array $subjectIds = [];
    private array $jurisdictionIds = [];
    private array $licenseIds = [];
    private array $sourceIds = [];
    private array $stats = [];
    private array $touchedFrameworks = [];

    public function __construct(private PDO $db)
    {
        foreach (Sql::rows($db, 'SELECT id, system, code FROM standard_education_levels') as $r) {
            $this->levelIds[$r['system'] . ':' . $r['code']] = (int) $r['id'];
        }
        foreach (Sql::rows($db, 'SELECT id, slug FROM standard_subjects') as $r) {
            $this->subjectIds[$r['slug']] = (int) $r['id'];
        }
        foreach (Sql::rows($db, 'SELECT id, code FROM standard_jurisdictions') as $r) {
            $this->jurisdictionIds[$r['code']] = (int) $r['id'];
        }
        $this->resetStats();
    }

    public function resetStats(): void
    {
        $this->stats = ['documents_added' => 0, 'documents_changed' => 0, 'documents_unchanged' => 0,
            'items_added' => 0, 'items_changed' => 0, 'items_retired' => 0, 'items_restored' => 0, 'items_moved' => 0,
            'documents_withdrawn' => 0, 'associations' => 0];
    }

    public function stats(): array
    {
        return $this->stats;
    }

    /**
     * Import packages in one run (reference rows seeded first). The packages share the first one's source.
     *
     * @return array the run's stats
     */
    public static function importAll(PDO $db, array $packages, ?string $scope = null): array
    {
        if (! $packages) {
            return [];
        }
        Reference::seed($db);
        $importer = new self($db);
        $run = $importer->startRun($packages[0]['source'], $scope);
        foreach ($packages as $p) {
            $importer->import($p, $run);
        }

        return $importer->finishRun($run);
    }

    // ---------------------------------------------------------------- runs

    public function source(array $s): int
    {
        if (isset($this->sourceIds[$s['slug']])) {
            return $this->sourceIds[$s['slug']];
        }
        $now = date('Y-m-d H:i:s');

        return $this->sourceIds[$s['slug']] = Sql::upsert($this->db, 'standard_sources', ['slug' => $s['slug']], [
            'name' => $s['name'] ?? $s['slug'], 'kind' => $s['kind'] ?? 'manual',
            'base_url' => $s['base_url'] ?? null, 'attribution' => $s['attribution'] ?? null, 'updated_at' => $now,
        ], ['created_at' => $now]);
    }

    public function startRun(array $source, ?string $scope = null, array $options = [], ?int $userId = null): int
    {
        $this->resetStats();
        $this->touchedFrameworks = [];

        return Sql::insert($this->db, 'standard_import_runs', [
            'source_id' => $this->source($source), 'scope' => $scope, 'status' => 'running',
            'options' => Sql::json($options), 'user_id' => $userId, 'started_at' => date('Y-m-d H:i:s'),
        ]);
    }

    public function finishRun(int $runId, string $status = 'ok', ?string $error = null): array
    {
        $this->refreshFrameworks(array_keys($this->touchedFrameworks));
        $this->stats['associations'] = $this->resolveAssociations();
        Sql::update($this->db, 'standard_import_runs', $runId, [
            'status' => $status, 'error' => $error, 'stats' => Sql::json($this->stats), 'finished_at' => date('Y-m-d H:i:s'),
        ]);

        return $this->stats;
    }

    // ---------------------------------------------------------------- one package

    /** @return array{0: string, 1: int} [added|changed|unchanged, document id] */
    public function import(array $pkg, int $runId): array
    {
        Package::validate($pkg);
        $sourceId = $this->source($pkg['source']);
        $slug = $pkg['source']['slug'];
        $jurisdictionId = $this->jurisdictionIds[$pkg['jurisdiction']] ?? throw new InvalidArgumentException("Unknown jurisdiction {$pkg['jurisdiction']}");
        $frameworkId = $this->framework($pkg['framework'], $jurisdictionId);
        $this->touchedFrameworks[$frameworkId] = true;

        $d = $pkg['document'];
        $items = $this->normalise($pkg['items']);
        $docHash = sha1(json_encode([$d['title'], $d['version_label'] ?? null, $d['source_url'] ?? null, $d['language'] ?? 'en',
            array_map(fn ($i) => [$i['key'], $i['hash']], $items), $pkg['associations'] ?? []]));

        $existing = Sql::row($this->db, 'SELECT id, framework_id, revision, content_hash, status, status_locked FROM standard_documents WHERE source_id = ? AND source_key = ?', [$sourceId, $d['source_key']]);
        $now = date('Y-m-d H:i:s');
        if ($existing && (int) $existing['framework_id'] !== $frameworkId) {
            $this->touchedFrameworks[(int) $existing['framework_id']] = true;   // the adapter now groups it elsewhere
        }
        if ($existing && $existing['content_hash'] === $docHash) {
            $values = ['framework_id' => $frameworkId, 'last_import_run_id' => $runId, 'last_imported_at' => $now];
            // a source can archive (or bring back) a document without changing its text
            $said = $d['status'] ?? 'current';
            $open = ['current', 'superseded'];
            if (! $existing['status_locked'] && ($said === 'current' ? ! in_array($existing['status'], $open, true) : $existing['status'] !== $said)) {
                $values['status'] = $said;
            }
            Sql::update($this->db, 'standard_documents', (int) $existing['id'], $values);
            $this->stats['documents_unchanged']++;

            return ['unchanged', (int) $existing['id']];
        }

        $own = ! $this->db->inTransaction();   // join a caller's transaction (tests, a bigger job)
        $own && $this->db->beginTransaction();
        try {
            $docValues = [
                'framework_id' => $frameworkId, 'title' => mb_substr($d['title'], 0, 500),
                'version_label' => $d['version_label'] ?? null, 'published_year' => $d['published_year'] ?? self::year($d['version_label'] ?? null),
                'adopted_on' => $d['adopted_on'] ?? null, 'effective_from' => $d['effective_from'] ?? null, 'effective_until' => $d['effective_until'] ?? null,
                'language' => $d['language'] ?? 'en', 'publisher' => $d['publisher'] ?? null, 'source_url' => $d['source_url'] ?? null,
                'license_id' => isset($d['license']) ? $this->license($d['license']) : null,
                'content_hash' => $docHash, 'last_import_run_id' => $runId, 'last_imported_at' => $now,
                'meta' => Sql::json($d['meta'] ?? null), 'updated_at' => $now,
            ];
            if (! $existing || ! $existing['status_locked']) {
                $docValues['status'] = $d['status'] ?? 'current';
            }
            if ($existing) {
                $docId = (int) $existing['id'];
                $revision = (int) $existing['revision'] + 1;
                $docValues['revision'] = $revision;
                Sql::update($this->db, 'standard_documents', $docId, $docValues);
                $this->stats['documents_changed']++;
                $result = 'changed';
            } else {
                $revision = 1;
                $docId = Sql::insert($this->db, 'standard_documents', $docValues + [
                    'uuid' => $d['uuid'] ?? Sql::uuid5("$slug|document|{$d['source_key']}"), 'source_id' => $sourceId,
                    'source_key' => $d['source_key'], 'revision' => 1, 'created_at' => $now,
                ]);
                $this->stats['documents_added']++;
                $result = 'added';
            }

            $counts = $this->syncItems($docId, $revision, $runId, $slug, $d['source_key'], $items, (bool) $existing);
            $this->syncAssociations($docId, $sourceId, $pkg['associations'] ?? [], (bool) $existing);

            $active = (int) Sql::scalar($this->db, "SELECT COUNT(*) FROM standard_items WHERE document_id = ? AND status = 'active'", [$docId]);
            Sql::update($this->db, 'standard_documents', $docId, ['item_count' => $active]);
            Sql::insert($this->db, 'standard_document_revisions', [
                'document_id' => $docId, 'revision' => $revision, 'import_run_id' => $runId, 'content_hash' => $docHash,
                'item_count' => $active, 'added' => $counts['added'], 'changed' => $counts['changed'],
                'retired' => $counts['retired'], 'restored' => $counts['restored'],
                'note' => $revision === 1 ? 'first import' : null, 'created_at' => $now,
            ]);
            $this->db->prepare('DELETE FROM standard_document_levels WHERE document_id = ?')->execute([$docId]);
            $this->db->prepare(Sql::insertIgnore($this->db) . ' INTO standard_document_levels (document_id, level_id)
                SELECT DISTINCT ?, l.level_id FROM standard_item_levels l JOIN standard_items i ON i.id = l.item_id
                WHERE i.document_id = ? AND i.status = \'active\'')->execute([$docId, $docId]);
            $own && $this->db->commit();
        } catch (Throwable $e) {
            $own && $this->db->rollBack();
            throw $e;
        }

        return [$result, $docId];
    }

    /** Mark documents of a source+jurisdiction that a full sync did not see as withdrawn. */
    public function withdrawMissing(int $runId, array $source, string $jurisdiction, array $seenDocumentIds): int
    {
        $sourceId = $this->source($source);
        $jid = $this->jurisdictionIds[$jurisdiction] ?? null;
        if (! $jid) {
            return 0;
        }
        $ids = array_map('intval', array_column(Sql::rows($this->db,
            "SELECT d.id FROM standard_documents d JOIN standard_frameworks f ON f.id = d.framework_id
             WHERE d.source_id = ? AND f.jurisdiction_id = ? AND d.status <> 'withdrawn' AND d.status_locked = 0", [$sourceId, $jid]), 'id'));
        $gone = array_diff($ids, $seenDocumentIds);
        foreach ($gone as $id) {
            Sql::update($this->db, 'standard_documents', $id, ['status' => 'withdrawn', 'last_import_run_id' => $runId, 'updated_at' => date('Y-m-d H:i:s')]);
            $fid = (int) Sql::scalar($this->db, 'SELECT framework_id FROM standard_documents WHERE id = ?', [$id]);
            $this->touchedFrameworks[$fid] = true;
        }
        $this->stats['documents_withdrawn'] += count($gone);

        return count($gone);
    }

    // ---------------------------------------------------------------- frameworks and editions

    private function framework(array $f, int $jurisdictionId): int
    {
        $subject = $f['subject'] ?? Reference::subjectFor($f['subject_label'] ?? '', $f['title']);
        $row = Sql::row($this->db, 'SELECT f.id, s.slug FROM standard_frameworks f LEFT JOIN standard_subjects s ON s.id = f.subject_id WHERE f.slug = ?', [$f['slug']]);
        if ($row) {
            // title and subject are curated after creation; imports only fill in a subject still unknown
            if (in_array($row['slug'], [null, 'other'], true) && $subject !== 'other' && isset($this->subjectIds[$subject])) {
                Sql::update($this->db, 'standard_frameworks', (int) $row['id'], ['subject_id' => $this->subjectIds[$subject]]);
            }

            return (int) $row['id'];
        }
        $now = date('Y-m-d H:i:s');

        return Sql::insert($this->db, 'standard_frameworks', [
            'slug' => $f['slug'], 'jurisdiction_id' => $jurisdictionId, 'title' => mb_substr($f['title'], 0, 255),
            'subject_id' => $this->subjectIds[$subject] ?? $this->subjectIds['other'] ?? null,
            'subject_label' => isset($f['subject_label']) ? mb_substr($f['subject_label'], 0, 255) : null,
            'language' => $f['language'] ?? 'en', 'publisher' => $f['publisher'] ?? null,
            'description' => $f['description'] ?? null, 'organization_id' => $f['organization_id'] ?? null,
            'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    /**
     * Work out which editions are in force. Within a framework, documents whose titles
     * match once years and words like "revised" are removed are editions of one another:
     * the latest year is current, earlier ones are superseded (and linked by supersedes_id).
     * Archived, withdrawn and admin-locked documents keep their status.
     */
    public function refreshFrameworks(?array $frameworkIds = null): void
    {
        $frameworkIds ??= array_map('intval', array_column(Sql::rows($this->db, 'SELECT id FROM standard_frameworks'), 'id'));
        foreach ($frameworkIds as $fid) {
            if (! Sql::scalar($this->db, 'SELECT 1 FROM standard_documents WHERE framework_id = ? LIMIT 1', [$fid])) {
                // emptied by regrouping; frameworks made by hand (organization ones) are kept
                $this->db->prepare('DELETE FROM standard_frameworks WHERE id = ? AND organization_id IS NULL')->execute([$fid]);
                continue;
            }
            $docs = Sql::rows($this->db, 'SELECT id, title, published_year, status, status_locked FROM standard_documents WHERE framework_id = ? ORDER BY COALESCE(published_year, 0), id', [$fid]);
            $groups = [];
            foreach ($docs as $doc) {
                $groups[self::editionKey($doc['title'])][] = $doc;
            }
            foreach ($groups as $group) {
                $live = array_values(array_filter($group, fn ($d) => ! in_array($d['status'], ['archived', 'withdrawn', 'draft', 'proposed'], true)));
                $latestYear = $live ? (int) end($live)['published_year'] : 0;
                $prev = null;
                foreach ($live as $doc) {
                    $older = $doc['published_year'] && $latestYear && (int) $doc['published_year'] < $latestYear;
                    $values = ['supersedes_id' => $prev && $prev['published_year'] && $doc['published_year'] > $prev['published_year'] ? (int) $prev['id'] : null];
                    if (! $doc['status_locked']) {
                        $values['status'] = $older ? 'superseded' : 'current';
                    }
                    Sql::update($this->db, 'standard_documents', (int) $doc['id'], $values);
                    $prev = $doc;
                }
            }
            $current = Sql::scalar($this->db, "SELECT id FROM standard_documents WHERE framework_id = ? AND status = 'current' ORDER BY COALESCE(published_year, 0) DESC, item_count DESC, id DESC LIMIT 1", [$fid]);
            Sql::update($this->db, 'standard_frameworks', $fid, ['current_document_id' => $current ? (int) $current : null, 'updated_at' => date('Y-m-d H:i:s')]);
        }
    }

    public static function editionKey(string $title): string
    {
        $t = mb_strtolower($title);
        $t = preg_replace('/\((?:[^)]*\b(?:19|20)\d\d\b[^)]*)\)/u', ' ', $t);
        $t = preg_replace('/\b(?:19|20)\d\d(?:\s*[-–]\s*(?:19|20)?\d\d)?\b/u', ' ', $t);
        $t = preg_replace('/\b(?:revised|revision|updated|adopted|edition|draft|version|archived)\b/u', ' ', $t);

        return trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', $t));
    }

    public static function year(?string $label): ?int
    {
        return $label && preg_match('/\b((?:19|20)\d\d)\b/', $label, $m) ? (int) $m[1] : null;
    }

    private function license(array $l): ?int
    {
        if (empty($l['title']) && empty($l['url'])) {
            return null;
        }
        $hash = sha1(($l['title'] ?? '') . '|' . ($l['url'] ?? '') . '|' . ($l['rights_holder'] ?? ''));
        if (isset($this->licenseIds[$hash])) {
            return $this->licenseIds[$hash];
        }
        $now = date('Y-m-d H:i:s');

        return $this->licenseIds[$hash] = Sql::upsert($this->db, 'standard_licenses', ['hash' => $hash], [], [
            'title' => $l['title'] ?? 'Unknown', 'url' => $l['url'] ?? null, 'rights_holder' => $l['rights_holder'] ?? null,
            'attribution' => $l['attribution'] ?? null, 'created_at' => $now, 'updated_at' => $now,
        ]);
    }

    // ---------------------------------------------------------------- items

    /** Unique keys, parents before children, a content hash per item. */
    private function normalise(array $items): array
    {
        $byKey = [];
        foreach ($items as $i => $item) {
            $key = self::key((string) $item['key']);
            if (isset($item['parent']) && $item['parent'] !== null) {
                $item['parent'] = self::key((string) $item['parent']);
            }
            for ($n = 2; isset($byKey[$key]); $n++) {
                $key = $item['key'] . '~' . $n;
            }
            $item['key'] = $key;
            $item['order'] = $i;
            $byKey[$key] = $item;
        }
        $children = [];
        $roots = [];
        foreach ($byKey as $key => $item) {
            $p = $item['parent'] ?? null;
            if ($p !== null && isset($byKey[$p]) && $p !== $key) {
                $children[$p][] = $key;
            } else {
                $roots[] = $key;
            }
        }
        $out = [];
        $seen = [];
        $visit = function (string $key, ?string $parent) use (&$visit, &$out, &$seen, $byKey, $children) {
            if (isset($seen[$key])) {
                return;
            }
            $seen[$key] = true;
            $item = $byKey[$key];
            $item['parent'] = $parent;
            $levels = array_values(array_unique($item['levels'] ?? []));
            sort($levels);
            $item['levels'] = $levels;
            $item['notes'] = isset($item['notes']) && $item['notes'] !== [] ? array_values((array) $item['notes']) : null;
            $item['statement'] = trim((string) ($item['statement'] ?? ''));
            $item['hash'] = sha1(json_encode([
                $item['code'] ?? null, $item['alt_code'] ?? null, $item['list_label'] ?? null, $item['type_label'] ?? null,
                $item['item_type'] ?? 'standard', $item['statement'], $item['abbreviated'] ?? null, $item['notes'],
                $item['is_statutory'] ?? null, $item['uri'] ?? null, $item['asn_id'] ?? null, $item['language'] ?? null,
                $parent, $levels, $item['extra'] ?? null,
            ], JSON_UNESCAPED_UNICODE));
            $out[] = $item;
            foreach ($children[$key] ?? [] as $child) {
                $visit($child, $key);
            }
        };
        foreach ($roots as $key) {
            $visit($key, null);
        }
        // cycles: anything not reached becomes a root
        foreach ($byKey as $key => $_) {
            $visit($key, null);
        }

        return $out;
    }

    private function syncItems(int $docId, int $revision, int $runId, string $slug, string $docKey, array $items, bool $hadDocument): array
    {
        $counts = ['added' => 0, 'changed' => 0, 'retired' => 0, 'restored' => 0];
        $now = date('Y-m-d H:i:s');
        $old = [];
        if ($hadDocument) {
            foreach (Sql::rows($this->db, 'SELECT * FROM standard_items WHERE document_id = ?', [$docId]) as $r) {
                $old[$r['source_key']] = $r;
            }
        }
        // moves: a new key whose code + statement + parent key matches an old row nobody claims
        $newKeys = array_flip(array_column($items, 'key'));
        $orphans = [];
        foreach ($old as $key => $r) {
            if (! isset($newKeys[$key])) {
                $orphans[sha1($r['code'] . '|' . $r['statement'])][] = $key;
            }
        }
        $keyToId = [];
        $idToLineage = [];
        $insert = $this->db->prepare('INSERT INTO standard_items (uuid, document_id, parent_id, source_key, lineage, depth, position, code, alt_code,
            list_label, type_label, item_type, statement, abbreviated, notes, is_statutory, language, uri, asn_id, status, first_revision,
            last_revision, content_hash, extra, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
        $levelRows = [];
        $levelReplace = [];
        $log = [];

        foreach ($items as $pos => $item) {
            $key = $item['key'];
            $parentId = $item['parent'] !== null ? ($keyToId[$item['parent']] ?? null) : null;
            $lineage = $parentId ? $idToLineage[$parentId] . $parentId . '/' : '/';
            $depth = substr_count($lineage, '/') - 1;
            $values = [
                'parent_id' => $parentId, 'lineage' => $lineage, 'depth' => min($depth, 255), 'position' => $pos,
                'code' => self::cut($item['code'] ?? null, 191), 'alt_code' => self::cut($item['alt_code'] ?? null, 191),
                'list_label' => self::cut($item['list_label'] ?? null, 16), 'type_label' => self::cut($item['type_label'] ?? null, 100),
                'item_type' => $item['item_type'] ?? 'standard', 'statement' => $item['statement'],
                'abbreviated' => self::cut($item['abbreviated'] ?? null, 500), 'notes' => Sql::json($item['notes']),
                'is_statutory' => isset($item['is_statutory']) ? (int) (bool) $item['is_statutory'] : null,
                'language' => $item['language'] ?? null, 'uri' => self::cut($item['uri'] ?? null, 500),
                'asn_id' => self::cut($item['asn_id'] ?? null, 32), 'content_hash' => $item['hash'], 'extra' => Sql::json($item['extra'] ?? null),
            ];
            $row = $old[$key] ?? null;
            $moved = false;
            if (! $row) {
                $sig = sha1(($values['code'] ?? '') . '|' . $values['statement']);
                if (! empty($orphans[$sig])) {
                    $row = $old[array_shift($orphans[$sig])];
                    $moved = true;
                }
            }
            if ($row) {
                $id = (int) $row['id'];
                unset($old[$row['source_key']]);
                $wasRetired = $row['status'] === 'retired';
                $changed = $row['content_hash'] !== $item['hash'];
                if ($changed || $wasRetired || $moved) {
                    $change = $wasRetired ? 'restored' : ($moved && ! $changed ? 'moved' : 'changed');
                    $fields = array_keys(array_filter($values, fn ($v, $c) => in_array($c, ['parent_id', 'code', 'alt_code', 'list_label', 'type_label', 'item_type', 'statement', 'abbreviated', 'notes', 'is_statutory', 'uri', 'asn_id', 'extra'], true) && (string) $v !== (string) $row[$c], ARRAY_FILTER_USE_BOTH));
                    $before = array_intersect_key($row, array_flip(['source_key', 'parent_id', 'code', 'alt_code', 'list_label', 'type_label', 'item_type', 'statement', 'abbreviated', 'notes', 'is_statutory', 'uri', 'asn_id', 'status']));
                    $before['levels'] = array_map(fn ($l) => $l['system'] . ':' . $l['code'], Sql::rows($this->db, 'SELECT e.system, e.code FROM standard_item_levels l JOIN standard_education_levels e ON e.id = l.level_id WHERE l.item_id = ?', [$id]));
                    $log[] = [$id, $revision, $runId, $change, Sql::json($before), Sql::json($fields ?: null), $now];
                    $values += ['source_key' => $key, 'status' => 'active', 'retired_at' => null, 'last_revision' => $revision, 'updated_at' => $now];
                    Sql::update($this->db, 'standard_items', $id, $values);
                    $levelReplace[] = $id;
                    $counts[$wasRetired ? 'restored' : 'changed']++;
                    $this->stats[$wasRetired ? 'items_restored' : ($moved && ! $changed ? 'items_moved' : 'items_changed')]++;
                    $this->queueLevels($levelRows, $id, $item['levels']);
                } elseif ((int) $row['position'] !== $pos || $row['lineage'] !== $lineage || (int) $row['parent_id'] !== (int) $parentId) {
                    Sql::update($this->db, 'standard_items', $id, ['position' => $pos, 'lineage' => $lineage, 'depth' => $values['depth'], 'parent_id' => $parentId]);
                }
            } else {
                $insert->execute([
                    $item['uuid'] ?? Sql::uuid5("$slug|item|$docKey|$key"), $docId, $parentId, $key, $lineage, $values['depth'], $pos,
                    $values['code'], $values['alt_code'], $values['list_label'], $values['type_label'], $values['item_type'],
                    $values['statement'], $values['abbreviated'], $values['notes'], $values['is_statutory'], $values['language'],
                    $values['uri'], $values['asn_id'], 'active', $revision, $revision, $item['hash'], $values['extra'], $now, $now,
                ]);
                $id = (int) $this->db->lastInsertId();
                if ($revision > 1) {
                    $log[] = [$id, $revision, $runId, 'added', null, null, $now];
                }
                $counts['added']++;
                $this->stats['items_added']++;
                $this->queueLevels($levelRows, $id, $item['levels']);
            }
            $keyToId[$key] = $id;
            $idToLineage[$id] = $lineage;
        }

        foreach ($old as $r) {
            if ($r['status'] === 'retired') {
                continue;
            }
            Sql::update($this->db, 'standard_items', (int) $r['id'], ['status' => 'retired', 'retired_at' => $now, 'last_revision' => $revision, 'updated_at' => $now]);
            $log[] = [(int) $r['id'], $revision, $runId, 'retired', null, null, $now];
            $counts['retired']++;
            $this->stats['items_retired']++;
        }

        foreach (array_chunk($levelReplace, 500) as $ids) {
            $this->db->prepare('DELETE FROM standard_item_levels WHERE item_id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')')->execute($ids);
        }
        Sql::insertMany($this->db, 'standard_item_levels', ['item_id', 'level_id'], $levelRows, Sql::insertIgnore($this->db));
        Sql::insertMany($this->db, 'standard_item_revisions', ['item_id', 'revision', 'import_run_id', 'change_type', 'previous', 'fields', 'created_at'], $log);

        return $counts;
    }

    private function queueLevels(array &$rows, int $itemId, array $levels): void
    {
        foreach ($levels as $level) {
            if (isset($this->levelIds[$level])) {
                $rows[] = [$itemId, $this->levelIds[$level]];
            }
        }
    }

    private function syncAssociations(int $docId, int $sourceId, array $associations, bool $hadDocument = true): void
    {
        $hadDocument && $this->db->prepare('DELETE FROM standard_associations WHERE source_id = ? AND origin_item_id IN (SELECT id FROM standard_items WHERE document_id = ?)')->execute([$sourceId, $docId]);
        if (! $associations) {
            return;
        }
        $ids = [];
        foreach (Sql::rows($this->db, 'SELECT id, source_key FROM standard_items WHERE document_id = ?', [$docId]) as $r) {
            $ids[$r['source_key']] = (int) $r['id'];
        }
        $now = date('Y-m-d H:i:s');
        $rows = [];
        foreach ($associations as $a) {
            if (! isset($ids[$a['origin']])) {
                continue;
            }
            $dest = isset($a['destination']) ? ($ids[$a['destination']] ?? null) : null;
            $rows[] = [$a['type'], $ids[$a['origin']], $dest, self::cut($a['destination_uri'] ?? null, 500), self::cut($a['destination_code'] ?? null, 191), $sourceId, $now, $now];
        }
        Sql::insertMany($this->db, 'standard_associations', ['type', 'origin_item_id', 'destination_item_id', 'destination_uri', 'destination_code', 'source_id', 'created_at', 'updated_at'], $rows);
    }

    /** Point unresolved associations at loaded items: by URI, then by CSP/CASE id (urn:guid:), then by code. */
    public function resolveAssociations(): int
    {
        $db = $this->db;
        $n = 0;
        if (Sql::isMysql($db)) {
            $n += $db->exec("UPDATE standard_associations a JOIN standard_items i ON i.uri = a.destination_uri AND i.status = 'active'
                SET a.destination_item_id = i.id WHERE a.destination_item_id IS NULL AND a.destination_uri IS NOT NULL AND a.destination_uri NOT LIKE 'urn:guid:%'");
            $n += $db->exec("UPDATE standard_associations a JOIN standard_items i ON i.source_key = SUBSTRING(a.destination_uri, 10)
                SET a.destination_item_id = i.id WHERE a.destination_item_id IS NULL AND a.destination_uri LIKE 'urn:guid:%' AND i.id <> a.origin_item_id");
            // codes are only unique within a document, so resolve a code only when exactly one active item has it
            $n += $db->exec("UPDATE standard_associations a JOIN (SELECT code, MIN(id) AS id FROM standard_items WHERE status = 'active'
                AND code IN (SELECT destination_code FROM standard_associations WHERE destination_item_id IS NULL AND destination_code IS NOT NULL)
                GROUP BY code HAVING COUNT(*) = 1) i ON i.code = a.destination_code
                SET a.destination_item_id = i.id WHERE a.destination_item_id IS NULL AND i.id <> a.origin_item_id");
        } else {
            $n += $db->exec("UPDATE standard_associations SET destination_item_id = (SELECT i.id FROM standard_items i WHERE i.uri = standard_associations.destination_uri AND i.status = 'active' LIMIT 1)
                WHERE destination_item_id IS NULL AND destination_uri IS NOT NULL AND destination_uri NOT LIKE 'urn:guid:%'");
            $n += $db->exec("UPDATE standard_associations SET destination_item_id = (SELECT i.id FROM standard_items i WHERE i.source_key = SUBSTR(standard_associations.destination_uri, 10) AND i.id <> standard_associations.origin_item_id LIMIT 1)
                WHERE destination_item_id IS NULL AND destination_uri LIKE 'urn:guid:%'");
            $n += $db->exec("UPDATE standard_associations SET destination_item_id = (SELECT MIN(i.id) FROM standard_items i WHERE i.code = standard_associations.destination_code AND i.status = 'active' GROUP BY i.code HAVING COUNT(*) = 1)
                WHERE destination_item_id IS NULL AND destination_code IS NOT NULL");
        }

        return $n;
    }

    /** Keys longer than the column keep a readable start and a hash of the whole. */
    public static function key(string $key): string
    {
        return strlen($key) <= 180 ? $key : substr($key, 0, 139) . '#' . sha1($key);
    }

    private static function cut(?string $s, int $len): ?string
    {
        if ($s === null) {
            return null;
        }
        $s = trim($s);

        return $s === '' ? null : mb_substr($s, 0, $len);
    }
}
