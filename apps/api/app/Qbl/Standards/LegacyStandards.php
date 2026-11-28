<?php

namespace App\Qbl\Standards;

use App\Qbl\Standards\Sources\StandardsList;
use PDO;
use Throwable;

/**
 * Moves the old curriculum_standards / scenario_standards tables (2026-11-18 to 2026-11-27, the
 * generator's own list) into the standards library. Used by migration
 * 2026_11_28_000000_merge_curriculum_standards_into_library.
 *
 * Each old standard is matched to a library item: by Common Standards Project id, by CASE
 * identifier (Learning Commons), or by a code only one current library item has. The rest are
 * imported as frameworks of their own (QBL jurisdiction, slug qbl-<framework>), so no mission
 * loses an alignment. relink() later moves alignments from those copies to library items, once the
 * library has been loaded (`qbl:standards all`).
 */
final class LegacyStandards
{
    /** @return array{standards: int, matched: int, imported: int, alignments: int} */
    public static function migrate(PDO $db): array
    {
        $out = ['standards' => 0, 'matched' => 0, 'imported' => 0, 'alignments' => 0];
        if (! self::hasTable($db, 'curriculum_standards')) {
            return $out;
        }
        Reference::seed($db);
        $rows = Sql::rows($db, 'SELECT * FROM curriculum_standards ORDER BY depth, id');
        $out['standards'] = count($rows);
        $map = [];          // old id => library item id
        $unmatched = [];    // framework => rows
        foreach ($rows as $r) {
            $item = self::match($db, $r);
            if ($item) {
                $map[(int) $r['id']] = $item;
                $out['matched']++;
            } else {
                $unmatched[strtoupper((string) $r['framework'])][] = $r;
            }
        }

        // the rest become frameworks of their own, keyed by their old source_id
        $packages = [];
        foreach ($unmatched as $framework => $list) {
            $jurisdictions = array_values(array_filter(array_column($list, 'jurisdiction')));
            $package = StandardsList::package([], $framework, $jurisdictions[0] ?? null, 'legacy');
            $keys = array_flip(array_column($list, 'source_id'));
            foreach ($list as $r) {
                $package['items'][] = [
                    'key' => (string) $r['source_id'],
                    'parent' => $r['parent_source_id'] !== null && isset($keys[$r['parent_source_id']]) ? (string) $r['parent_source_id'] : null,
                    'code' => $r['code'], 'statement' => (string) $r['description'],
                    'item_type' => $r['code'] ? 'standard' : 'topic',
                    'levels' => StandardsList::levels(json_decode((string) $r['grade_levels'], true) ?: []),
                    'extra' => ['legacy_source' => $r['source']],
                ];
            }
            $package['framework']['subject_label'] = array_values(array_filter(array_column($list, 'subject')))[0] ?? null;
            $packages[] = $package;
        }
        if ($packages) {
            Importer::importAll($db, $packages, 'curriculum_standards');
            foreach ($unmatched as $framework => $list) {
                $doc = Sql::scalar($db, 'SELECT d.id FROM standard_documents d JOIN standard_sources s ON s.id = d.source_id WHERE s.slug = ? AND d.source_key = ?',
                    [StandardsList::SOURCE['slug'], "legacy:$framework"]);
                foreach ($list as $r) {
                    $id = Sql::scalar($db, 'SELECT id FROM standard_items WHERE document_id = ? AND source_key = ?', [$doc, Importer::key((string) $r['source_id'])]);
                    if ($id) {
                        $map[(int) $r['id']] = (int) $id;
                        $out['imported']++;
                    }
                }
            }
        }

        if (self::hasTable($db, 'scenario_standards')) {
            $now = date('Y-m-d H:i:s');
            foreach (Sql::rows($db, 'SELECT * FROM scenario_standards ORDER BY id') as $a) {
                $item = $map[(int) $a['curriculum_standard_id']] ?? null;
                if (! $item) {
                    continue;
                }
                $exists = Sql::scalar($db, "SELECT id FROM standard_alignments WHERE item_id = ? AND alignable_type = 'scenario' AND alignable_id = ?", [$item, $a['scenario_id']]);
                if ($exists) {
                    continue;
                }
                Sql::insert($db, 'standard_alignments', [
                    'item_id' => $item, 'alignable_type' => 'scenario', 'alignable_id' => (int) $a['scenario_id'], 'scenario_id' => (int) $a['scenario_id'],
                    'strength' => $a['alignment'] ?: 'primary', 'rationale' => $a['rationale'], 'evidence' => $a['evidence'],
                    'item_revision' => Sql::scalar($db, 'SELECT d.revision FROM standard_items i JOIN standard_documents d ON d.id = i.document_id WHERE i.id = ?', [$item]),
                    'created_at' => $a['created_at'] ?? $now, 'updated_at' => $now,
                ]);
                $out['alignments']++;
            }
        }

        return $out;
    }

    /**
     * Point alignments at copies made by migrate() (or any qbl-imported set) to the library's own item,
     * when exactly one current library item outside QBL has the same code. Returns how many moved.
     */
    public static function relink(PDO $db): int
    {
        $moved = 0;
        $rows = Sql::rows($db, "SELECT a.id, a.item_id, a.alignable_type, a.alignable_id, i.code, d.meta FROM standard_alignments a
            JOIN standard_items i ON i.id = a.item_id JOIN standard_documents d ON d.id = i.document_id JOIN standard_sources s ON s.id = d.source_id
            WHERE s.slug = ? AND i.code IS NOT NULL", [StandardsList::SOURCE['slug']]);
        foreach ($rows as $a) {
            $a['jurisdiction_text'] = json_decode((string) $a['meta'], true)['jurisdiction_text'] ?? null;
            $target = self::uniqueByCode($db, (string) $a['code'], $a['jurisdiction_text']);
            if (! $target || $target === (int) $a['item_id']) {
                continue;
            }
            $taken = Sql::scalar($db, 'SELECT id FROM standard_alignments WHERE item_id = ? AND alignable_type = ? AND alignable_id = ?', [$target, $a['alignable_type'], $a['alignable_id']]);
            if ($taken) {
                $db->prepare('DELETE FROM standard_alignments WHERE id = ?')->execute([$a['id']]);
            } else {
                Sql::update($db, 'standard_alignments', (int) $a['id'], ['item_id' => $target, 'updated_at' => date('Y-m-d H:i:s')]);
            }
            $moved++;
        }

        return $moved;
    }

    private static function match(PDO $db, array $r): ?int
    {
        $sid = (string) $r['source_id'];
        if (str_starts_with($sid, 'csp:')) {
            $id = Sql::scalar($db, "SELECT i.id FROM standard_items i JOIN standard_documents d ON d.id = i.document_id JOIN standard_sources s ON s.id = d.source_id
                WHERE s.slug = 'csp' AND i.source_key = ? ORDER BY i.status = 'active' DESC, d.status = 'current' DESC LIMIT 1", [substr($sid, 4)]);
            if ($id) {
                return (int) $id;
            }
        }
        if (str_starts_with($sid, 'lc:')) {
            $uuid = strtolower(substr($sid, 3));
            $id = Sql::scalar($db, 'SELECT id FROM standard_items WHERE uuid = ? OR uri = ? LIMIT 1', [$uuid, "urn:uuid:$uuid"]);
            if ($id) {
                return (int) $id;
            }
        }

        return $r['code'] ? self::uniqueByCode($db, (string) $r['code'], $r['jurisdiction'] ?? null) : null;
    }

    /**
     * The one library item with this code. Many states list the Common Core (or NGSS) under their own
     * name, so when several have it, the consortium's own item wins; then the jurisdiction the old row
     * named (by code or name); otherwise there is no safe match.
     */
    public static function uniqueByCode(PDO $db, string $code, ?string $jurisdiction = null): ?int
    {
        $rows = Sql::rows($db, "SELECT i.id, j.code AS jcode, j.name AS jname FROM standard_items i JOIN standard_documents d ON d.id = i.document_id
            JOIN standard_frameworks f ON f.id = d.framework_id JOIN standard_jurisdictions j ON j.id = f.jurisdiction_id
            WHERE i.code = ? AND i.status = 'active' AND d.status = 'current' AND j.code <> 'QBL' LIMIT 200", [$code]);
        $pick = function (array $rows) {
            return count($rows) === 1 ? (int) array_values($rows)[0]['id'] : null;
        };
        if (count($rows) <= 1) {
            return $pick($rows);
        }
        $origin = array_filter($rows, fn ($r) => in_array($r['jcode'], ['US-CCSS', 'US-NGSS'], true));
        if ($origin) {
            return $pick($origin);
        }
        if ($jurisdiction) {
            $j = strtolower(trim($jurisdiction));
            return $pick(array_filter($rows, fn ($r) => strtolower($r['jcode']) === $j || strtolower($r['jname']) === $j));
        }

        return null;
    }

    private static function hasTable(PDO $db, string $table): bool
    {
        try {
            $db->query("SELECT 1 FROM $table LIMIT 1");

            return true;
        } catch (Throwable) {
            return false;
        }
    }
}
