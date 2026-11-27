<?php

namespace App\Qbl\Standards\Sources;

use App\Qbl\Standards\Importer;
use App\Qbl\Standards\Package;
use App\Qbl\Standards\Reference;
use App\Qbl\Standards\Sources\CommonStandardsProject as Csp;
use RuntimeException;

/**
 * 1EdTech CASE 1.0/1.1 CFPackage -> standards package. This is the general way to
 * add any other publisher: states (Georgia, Texas, ...), vendors and frameworks that
 * run a CASE server (OpenSALT, CASE Network) publish CFPackages at
 *   <server>/ims/case/v1p0/CFPackages/<document identifier>
 *
 * CASE identifiers are kept as our uuids, so items keep their CASE identity, and
 * re-importing a newer CFPackage of the same document produces a new revision.
 */
final class CasePackage
{
    public static function load(string $urlOrFile): array
    {
        $body = is_file($urlOrFile) ? file_get_contents($urlOrFile) : Http::get($urlOrFile, ['Accept: application/json']);

        return json_decode($body, true, flags: JSON_THROW_ON_ERROR);
    }

    public static function fromCfPackage(array $pkg, string $jurisdiction, ?string $frameworkSlug = null, ?string $from = null): array
    {
        $doc = $pkg['CFDocument'] ?? throw new RuntimeException('Not a CFPackage: no CFDocument');
        $docId = strtolower($doc['identifier']);
        $host = parse_url($doc['uri'] ?? $from ?? '', PHP_URL_HOST) ?: 'case';
        $types = [];
        foreach ($pkg['CFDefinitions']['CFItemTypes'] ?? [] as $t) {
            $types[$t['identifier']] = $t['title'] ?? null;
        }

        // the tree: isChildOf(origin = child, destination = parent or the document), ordered by sequenceNumber
        $parent = [];
        $seq = [];
        $other = [];
        foreach ($pkg['CFAssociations'] ?? [] as $a) {
            $o = strtolower($a['originNodeURI']['identifier'] ?? '');
            $d = strtolower($a['destinationNodeURI']['identifier'] ?? '');
            if (($a['associationType'] ?? '') === 'isChildOf') {
                if (! isset($parent[$o])) {
                    $parent[$o] = $d === $docId ? null : $d;
                    $seq[$o] = (int) ($a['sequenceNumber'] ?? 0);
                }
            } else {
                $other[] = [$o, $a['associationType'] ?? '', $d, $a['destinationNodeURI']['uri'] ?? null, $a['destinationNodeURI']['title'] ?? null];
            }
        }
        $byId = [];
        foreach ($pkg['CFItems'] ?? [] as $i => $it) {
            $byId[strtolower($it['identifier'])] = $it + ['_order' => $i];
        }
        // reading order: depth-first by sequence number
        $kids = [];
        foreach ($byId as $id => $it) {
            $kids[$parent[$id] ?? ''][] = $id;
        }
        foreach ($kids as &$list) {
            usort($list, fn ($a, $b) => [$seq[$a] ?? PHP_INT_MAX, $byId[$a]['_order']] <=> [$seq[$b] ?? PHP_INT_MAX, $byId[$b]['_order']]);
        }
        unset($list);
        $ordered = [];
        $walk = function (string $p) use (&$walk, &$ordered, $kids) {
            foreach ($kids[$p] ?? [] as $id) {
                $ordered[] = $id;
                $walk($id);
            }
        };
        $walk('');
        foreach (array_keys($byId) as $id) {
            if (! in_array($id, $ordered, true)) {
                $ordered[] = $id;   // orphans
            }
        }

        $items = [];
        foreach ($ordered as $id) {
            $it = $byId[$id];
            $label = $it['CFItemType'] ?? ($types[$it['CFItemTypeURI']['identifier'] ?? ''] ?? null);
            $items[] = [
                'key' => $id, 'uuid' => $id, 'parent' => $parent[$id] ?? null,
                'code' => $it['humanCodingScheme'] ?? null, 'list_label' => $it['listEnumeration'] ?? null,
                'type_label' => $label, 'item_type' => Package::itemType($label, ! empty($kids[$id])),
                'statement' => Csp::clean($it['fullStatement'] ?? ''), 'abbreviated' => $it['abbreviatedStatement'] ?? null,
                'notes' => array_values(array_filter([Csp::clean($it['notes'] ?? '')])),
                'language' => self::lang($it['language'] ?? null), 'uri' => $it['uri'] ?? null,
                'levels' => self::levels($it['educationLevel'] ?? []),
            ];
        }
        $known = array_flip($ordered);
        $associations = [];
        foreach ($other as [$o, $type, $d, $uri, $title]) {
            if (! isset($known[$o]) || ! in_array($type, Package::ASSOCIATION_TYPES, true)) {
                continue;
            }
            $associations[] = ['origin' => $o, 'type' => $type, 'destination' => isset($known[$d]) ? $d : null,
                'destination_uri' => $uri ?? ($d ? "urn:uuid:$d" : null), 'destination_code' => null];
        }
        $title = trim($doc['title']);
        $status = match (strtolower($doc['adoptionStatus'] ?? '')) {
            'deprecated', 'retired' => 'archived', 'draft', 'private draft' => 'draft', 'proposed' => 'proposed', default => 'current',
        };
        $subject = implode(', ', (array) ($doc['subject'] ?? []));
        $lic = $doc['licenseURI'] ?? null;

        return [
            'source' => ['slug' => "case:$host", 'name' => "CASE server $host", 'kind' => 'case', 'base_url' => "https://$host/ims/case/v1p0/"],
            'jurisdiction' => $jurisdiction,
            'framework' => [
                'slug' => $frameworkSlug ?? Csp::slug("$jurisdiction case " . Importer::editionKey($title)),
                'title' => preg_replace('/\s*\([^)]*\)\s*$/', '', $title), 'subject_label' => $subject ?: null,
                'subject' => Reference::subjectFor($subject, $title), 'language' => self::lang($doc['language'] ?? null) ?? 'en',
                'publisher' => $doc['publisher'] ?? $doc['creator'] ?? null,
            ],
            'document' => [
                'source_key' => $docId, 'uuid' => $docId, 'title' => $title,
                'version_label' => $doc['version'] ?? null, 'published_year' => Importer::year($doc['version'] ?? null) ?? Importer::year($title),
                'adopted_on' => self::date($doc['statusStartDate'] ?? null), 'effective_until' => self::date($doc['statusEndDate'] ?? null),
                'status' => $status, 'language' => self::lang($doc['language'] ?? null) ?? 'en',
                'publisher' => $doc['publisher'] ?? $doc['creator'] ?? null, 'source_url' => $doc['officialSourceURL'] ?? $doc['uri'] ?? $from,
                'license' => $lic ? ['title' => $lic['title'] ?? 'See source', 'url' => $lic['uri'] ?? null, 'rights_holder' => $doc['creator'] ?? null] : null,
                'meta' => array_filter(['case_uri' => $doc['uri'] ?? null, 'last_change' => $doc['lastChangeDateTime'] ?? null, 'notes' => $doc['notes'] ?? null]),
            ],
            'items' => $items,
            'associations' => $associations,
        ];
    }

    /** CASE educationLevel values: "KG", "PK", "01".."12", "HS", "AS", "BA", ... */
    public static function levels(array $levels): array
    {
        $out = [];
        foreach ($levels as $l) {
            $l = strtoupper(trim((string) $l));
            $out[] = match (true) {
                (bool) preg_match('/^\d{1,2}$/', $l) => 'GRADE:' . sprintf('%02d', (int) $l),
                in_array($l, ['KG', 'K'], true) => 'GRADE:K',
                in_array($l, ['PK', 'PR', 'PREK', 'PRE-K'], true) => 'GRADE:PK',
                in_array($l, ['IT'], true) => 'GRADE:IT',
                in_array($l, ['AS', 'BA', 'PB', 'MD', 'PM', 'DO', 'PD', 'HE'], true) => 'GRADE:HE',
                in_array($l, ['AE'], true) => 'GRADE:ADULT',
                $l === 'HS' => 'GRADE:09', default => null,
            };
            if ($l === 'HS') {
                array_push($out, 'GRADE:10', 'GRADE:11', 'GRADE:12');
            }
        }

        return array_values(array_unique(array_filter($out)));
    }

    private static function lang(?string $l): ?string
    {
        return $l ? (['eng' => 'en', 'fra' => 'fr', 'fre' => 'fr', 'spa' => 'es'][strtolower($l)] ?? strtolower($l)) : null;
    }

    private static function date(?string $d): ?string
    {
        return $d && preg_match('/^\d{4}-\d{2}-\d{2}/', $d) ? substr($d, 0, 10) : null;
    }
}
