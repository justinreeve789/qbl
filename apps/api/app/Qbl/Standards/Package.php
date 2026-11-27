<?php

namespace App\Qbl\Standards;

use InvalidArgumentException;

/**
 * The one shape every source adapter produces and Importer consumes: one document
 * (an edition of a framework) with its items in reading order. Hand-written JSON in
 * this shape can be imported with `qbl:standards-library import-file`.
 *
 * {
 *   "source":       {"slug": "manual", "name": "Entered by QBL staff", "kind": "manual"},
 *   "jurisdiction": "US-TX",                        // standard_jurisdictions.code
 *   "framework":    {"slug": "us-tx-science", "title": "Texas Science", "subject": "science",
 *                    "subject_label": "Science", "language": "en", "publisher": "TEA"},
 *   "document":     {"source_key": "teks-science-2024", "title": "TEKS Science", "version_label": "2024",
 *                    "status": "current", "language": "en", "source_url": "https://…",
 *                    "license": {"title": "…", "url": "…", "rights_holder": "…"}},
 *   "items": [
 *     {"key": "b.1", "parent": null, "code": "112.3.b.1", "item_type": "strand", "type_label": "Strand",
 *      "statement": "…", "levels": ["GRADE:03"], "is_statutory": true, "notes": ["e.g. …"],
 *      "uri": "https://…", "asn_id": null, "list_label": "1", "alt_code": null, "abbreviated": null}
 *   ],
 *   "associations": [
 *     {"origin": "b.1", "type": "exactMatchOf", "destination_uri": "http://corestandards.org/Math/Content/3/OA/A/1"}
 *   ]
 * }
 *
 * Levels are "SYSTEM:code" (see Reference::levels). Item keys must be stable across
 * imports of the same source: they are how revisions are matched.
 */
final class Package
{
    public const ITEM_TYPES = ['section', 'domain', 'strand', 'substrand', 'cluster', 'topic', 'standard', 'substandard',
        'benchmark', 'indicator', 'objective', 'expectation', 'outcome', 'competency', 'skill', 'example', 'guidance',
        'progression', 'statement'];

    public const STATUSES = ['draft', 'proposed', 'current', 'superseded', 'archived', 'withdrawn'];

    public const ASSOCIATION_TYPES = ['exactMatchOf', 'isRelatedTo', 'isPeerOf', 'isPartOf', 'precedes', 'replacedBy',
        'exemplar', 'hasSkillLevel', 'isTranslationOf', 'alignedTo'];

    public static function validate(array $p): void
    {
        foreach (['source', 'jurisdiction', 'framework', 'document', 'items'] as $k) {
            if (! isset($p[$k])) {
                throw new InvalidArgumentException("Package is missing \"$k\"");
            }
        }
        foreach (['slug'] as $k) {
            if (empty($p['source'][$k])) {
                throw new InvalidArgumentException("Package source is missing \"$k\"");
            }
        }
        foreach (['slug', 'title'] as $k) {
            if (empty($p['framework'][$k])) {
                throw new InvalidArgumentException("Package framework is missing \"$k\"");
            }
        }
        foreach (['source_key', 'title'] as $k) {
            if (empty($p['document'][$k])) {
                throw new InvalidArgumentException("Package document is missing \"$k\"");
            }
        }
        if (isset($p['document']['status']) && ! in_array($p['document']['status'], self::STATUSES, true)) {
            throw new InvalidArgumentException("Unknown document status {$p['document']['status']}");
        }
        foreach ($p['items'] as $i => $item) {
            if (! isset($item['key']) || $item['key'] === '') {
                throw new InvalidArgumentException("Item $i has no key");
            }
            if (isset($item['item_type']) && ! in_array($item['item_type'], self::ITEM_TYPES, true)) {
                throw new InvalidArgumentException("Item {$item['key']} has unknown item_type {$item['item_type']}");
            }
        }
        foreach ($p['associations'] ?? [] as $a) {
            if (! in_array($a['type'] ?? '', self::ASSOCIATION_TYPES, true)) {
                throw new InvalidArgumentException('Unknown association type ' . ($a['type'] ?? '(none)'));
            }
        }
    }

    /** Normalise a publisher's label ("Specific Expectation", "Cluster") to an item_type. */
    public static function itemType(?string $label, bool $hasChildren = false): string
    {
        $l = mb_strtolower((string) $label);
        $map = [
            'cluster' => 'cluster', 'domain' => 'domain', 'conceptual categor' => 'domain', 'strand' => 'strand', 'sub-strand' => 'substrand',
            'substrand' => 'substrand', 'topic' => 'topic', 'theme' => 'topic', 'big idea' => 'topic', 'disciplinary core idea' => 'topic',
            'benchmark' => 'benchmark', 'indicator' => 'indicator', 'objective' => 'objective', 'expectation' => 'expectation',
            'attente' => 'expectation', 'contenu' => 'expectation', 'outcome' => 'outcome', 'résultat' => 'outcome', 'competenc' => 'competency',
            'compétence' => 'competency', 'skill' => 'skill', 'example' => 'example', 'exemple' => 'example', 'access point' => 'substandard',
            'component' => 'substandard', 'element' => 'substandard', 'sub-standard' => 'substandard', 'substandard' => 'substandard',
            'standard' => 'standard', 'performance' => 'standard', 'knowledge' => 'standard', 'learning target' => 'objective',
            'goal' => 'objective', 'application' => 'standard', 'task' => 'standard', 'statement' => 'statement',
        ];
        foreach ($map as $needle => $type) {
            if ($l !== '' && str_contains($l, $needle)) {
                return $type;
            }
        }

        return $hasChildren ? 'topic' : 'standard';
    }
}
