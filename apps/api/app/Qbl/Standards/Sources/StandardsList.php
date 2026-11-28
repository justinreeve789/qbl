<?php

namespace App\Qbl\Standards\Sources;

use App\Qbl\Standards\Reference;
use App\Qbl\Standards\Sources\CommonStandardsProject as Csp;
use InvalidArgumentException;

/**
 * A plain list of standards as one framework of your own, the format `qbl:standards file` has
 * always taken:
 *
 *   [{"code": "TEST-3-LS1-1", "description": "...", "grades": ["03"], "subject": "Science", "parent_code": null}, ...]
 *
 * The framework goes under the QBL jurisdiction (or a real one, when --jurisdiction is a code
 * such as US-TX) with the slug "qbl-<name>", so the generator finds it by its name: --framework=TEST-SCI.
 */
final class StandardsList
{
    public const SOURCE = ['slug' => 'qbl-imported', 'name' => 'Imported into QBL', 'kind' => 'manual',
        'attribution' => 'Standards imported into QBL by staff.'];

    public static function isList(mixed $data): bool
    {
        return is_array($data) && array_is_list($data) && (! $data || isset($data[0]['description']));
    }

    /**
     * @param  array  $list  [{code?, description, grades?|grade_levels?, subject?, parent_code?, jurisdiction?}]
     * @param  string  $framework  the short name missions refer to it by: TEST-SCI, NGSS-5...
     * @param  string|null  $jurisdiction  a jurisdiction code (US-TX) or free text; free text goes under QBL
     */
    public static function package(array $list, string $framework, ?string $jurisdiction = null, string $sourceKind = 'file'): array
    {
        $framework = strtoupper(trim($framework));
        if ($framework === '') {
            throw new InvalidArgumentException('Give the list a framework name (--framework=NAME).');
        }
        $code = $jurisdiction && isset(Reference::JURISDICTIONS[strtoupper($jurisdiction)]) ? strtoupper($jurisdiction) : 'QBL';
        $items = [];
        $subjects = [];
        foreach ($list as $s) {
            $description = trim((string) ($s['description'] ?? ''));
            if ($description === '') {
                continue;
            }
            $itemCode = isset($s['code']) && trim((string) $s['code']) !== '' ? trim((string) $s['code']) : null;
            $subjects[] = $s['subject'] ?? null;
            $items[] = [
                'key' => $itemCode ?? 'text:' . md5($description),
                'parent' => isset($s['parent_code']) && $s['parent_code'] !== '' ? (string) $s['parent_code'] : null,
                'code' => $itemCode, 'statement' => Csp::clean($description),
                'item_type' => $itemCode ? 'standard' : 'topic',
                'levels' => self::levels((array) ($s['grades'] ?? $s['grade_levels'] ?? [])),
            ];
        }
        $subject = array_values(array_filter($subjects))[0] ?? null;

        return [
            'source' => self::SOURCE,
            'jurisdiction' => $code,
            'framework' => ['slug' => self::slug($framework), 'title' => $framework, 'subject_label' => $subject,
                'subject' => Reference::subjectFor((string) $subject, $framework),
                'description' => $code === 'QBL' && $jurisdiction ? "Standards of $jurisdiction" : null],
            'document' => ['source_key' => "$sourceKind:$framework", 'title' => $framework . ($jurisdiction && $code === 'QBL' ? " ($jurisdiction)" : ''),
                'status' => 'current', 'language' => 'en', 'meta' => ['jurisdiction_text' => $jurisdiction]],
            'items' => $items,
        ];
    }

    /** The framework slug for a short name: TEST-SCI -> qbl-test-sci. */
    public static function slug(string $framework): string
    {
        return 'qbl-' . Csp::slug($framework);
    }

    /** "05", "5", "K", "Pre-K", "HS", "6-8" -> GRADE:05 ... */
    public static function levels(array $grades): array
    {
        $out = [];
        foreach (\App\Qbl\Generation\Curriculum\MissionStandards::grades($grades) as $g) {
            $out[] = 'GRADE:' . match ($g) { 'Pre-K' => 'PK', default => $g };
        }

        return $out;
    }
}
