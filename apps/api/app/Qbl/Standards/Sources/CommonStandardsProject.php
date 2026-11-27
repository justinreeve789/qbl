<?php

namespace App\Qbl\Standards\Sources;

use App\Qbl\Standards\Package;
use App\Qbl\Standards\Reference;
use Generator;
use RuntimeException;

/**
 * Common Standards Project (commonstandardsproject.com): all 50 states, DC, the
 * Common Core, NGSS and the Canadian provinces, in English and French. Its data
 * comes largely from the Achievement Standards Network (D2L) and is CC BY.
 *
 * One CSP "standard set" is a slice of a document (usually one grade). Sets that
 * share a CSP document become one standards document here, with one section item
 * per set; sets without a document are a document each.
 *
 * Responses are cached under $cacheDir as jurisdictions/<id>.json and sets/<id>.json,
 * so a sync can be re-run offline, and a refresh only needs --refresh.
 */
final class CommonStandardsProject
{
    public const BASE = 'https://api.commonstandardsproject.com/api/v1';

    public const SOURCE = [
        'slug' => 'csp', 'name' => 'Common Standards Project', 'kind' => 'api', 'base_url' => self::BASE,
        'attribution' => 'Standards from the Common Standards Project (commonstandardsproject.com), much of it from the Achievement Standards Network (D2L Corporation). Licensed CC BY; see each document\'s license.',
    ];

    /** CSP jurisdiction id => [our jurisdiction code, language] */
    public const JURISDICTIONS = [
        'B838B98D043045748F3814B9E43CAC85' => ['US-AL', 'en'], '0DCD3CBE12314408BDBDB97FAF45EEE8' => ['US-AK', 'en'],
        '0B41FFF6B5114EB0B8A89CE0E70E22D8' => ['US-AZ', 'en'], '2E9F2A0F3440479492D152F02F081AF1' => ['US-AR', 'en'],
        'B1339AB05F0347E79200FCA63240F3B2' => ['US-CA', 'en'], '83F29380C23C4AEB843733B243CB2243' => ['US-CO', 'en'],
        '7ED35031669E470B98EF63BEAD17286D' => ['US-CT', 'en'], '4391EA3250C84205A251B6E1B60295D8' => ['US-DE', 'en'],
        'A5C1DF532ED44A6CB3D000FD37370C0F' => ['US-DC', 'en'], '80B94A122D3D4B95884660FF09CC357E' => ['US-FL', 'en'],
        'AB6E6F50DDF047E8BC3EE2CCFD33DCCC' => ['US-GA', 'en'], '64B8E297AAEF42DA886248000B292DF1' => ['US-HI', 'en'],
        'E8D078CED3B44AAD956D244FA0E47636' => ['US-ID', 'en'], '549159D28465455FB144F5B67F3ACDFF' => ['US-IL', 'en'],
        '0F7091AB177F40D8B71B326CAFD13C8D' => ['US-IN', 'en'], '78D8430CBE88474FAB3CDAAD9094C961' => ['US-IA', 'en'],
        '3D2A9582BF3D4118B30AAD2DF9A183D1' => ['US-KS', 'en'], '46C7F759B14D4334A1CD073B03B9BB7C' => ['US-KY', 'en'],
        '7F61743375274952B3D2ED9C4182ED53' => ['US-LA', 'en'], '99301CAF70794BBCA568186C479A5DFC' => ['US-ME', 'en'],
        '49FCDFBD2CF04033A9C347BFA0584DF0' => ['US-MD', 'en'], '95C543B18A1B473B894ED35ECA322576' => ['US-MA', 'en'],
        '778458DAC3234C428E022B08ADF179C3' => ['US-MI', 'en'], 'B632FB4B1B83445AA8DB46DC3F079D19' => ['US-MN', 'en'],
        '78D64C532B604AC7BC15E6578C381017' => ['US-MS', 'en'], '175A144B44F94BFAB539F3B571A3A62C' => ['US-MO', 'en'],
        '7FAA3E0A782B498DB5E5EA255681706C' => ['US-MT', 'en'], '12FDD9CA15FC49259C2EF4BB13D59D2F' => ['US-NE', 'en'],
        'A7F156ECF40D4DFDB9DE1E3541550B20' => ['US-NV', 'en'], '46115D815A5E41C185AAE63E7B3E4F83' => ['US-NH', 'en'],
        'BD9F1823F64844E38377E11EB39F173B' => ['US-NJ', 'en'], 'C558A97651934F3989D0D0A41196060C' => ['US-NM', 'en'],
        'DA1743190A534CB0AEC12F494BE1F8D7' => ['US-NY', 'en'], '8A257771396B4F0792EB9D6020CC9089' => ['US-NC', 'en'],
        '071477629D00405286BC6D79576AAB79' => ['US-ND', 'en'], 'F4CB2B5DF6904071BBCC671A3AB783B8' => ['US-OH', 'en'],
        '39FE6BDC03A5471F877A3A0048638B13' => ['US-OK', 'en'], '3C4329D21BCF435C880282CBAAE12AF1' => ['US-OR', 'en'],
        '5A99211C6D874994A2CFEE2AE40023DD' => ['US-PA', 'en'], 'D91DD2FDBCC94DC1869871FD1C0F2665' => ['US-RI', 'en'],
        '033B7F9D29D84F09AF312E83F31AE348' => ['US-SC', 'en'], '2A3604CDDF8241DC82059FFBC308E74F' => ['US-SD', 'en'],
        '180878796A3C448D808F38BCCCFD26CF' => ['US-TN', 'en'], '28903EF2A9F9469C9BF592D4D0BE10F8' => ['US-TX', 'en'],
        '178982A93FED4D9186E0AC6A740682D9' => ['US-UT', 'en'], '587F7E0F9875495DB02EF7F3E5BF00DA' => ['US-VT', 'en'],
        '27D1AF28D2F54DD3A69C057DDA772BD0' => ['US-VA', 'en'], '7432D25024594EA9A2092DF45BBA7F6C' => ['US-WA', 'en'],
        'F1D13BFFB41F4FC6B4D6132D1B6792F7' => ['US-WV', 'en'], '745124D969E9491C9FC33D3235259386' => ['US-WI', 'en'],
        '744704BE56D44FB9B3D18B543FBF9BCC' => ['US-WY', 'en'],
        '67810E9EF6944F9383DCC602A3484C23' => ['US-CCSS', 'en'], '71E5AA409D894EB0B43A8CD82F727BFE' => ['US-NGSS', 'en'],
        '5C8C751020F44B39AD4BCB5E5B6680A4' => ['CA-AB', 'en'], '5C8C751020F44B39AD4BCB5E5B6680A5' => ['CA-AB', 'fr'],
        '27702E75622642399036EF059126D888' => ['CA-BC', 'en'], 'EB941913257145ECBAAD3E7EF2DB9E4B' => ['CA-BC', 'fr'],
        '0C92C08A87AA4EBEBC6D7408AEFBFEBB' => ['CA-MB', 'en'], 'E92E49D6BA794F1EB4897C9C46C57477' => ['CA-MB', 'en'],
        '4695FD787B404E0FA11C9DF47AD69079' => ['CA-NB', 'en'], '02B8EEED5A324CADA1DCE93E3F5A06C4' => ['CA-NB', 'fr'],
        'AE0DD400C98144D79A0E158A67A9A10B' => ['CA-NS', 'en'],
        'B6AA8AC483B949F0B4198062C61A61AD' => ['CA-ON', 'en'], '6C1C46EAB3F345D78085A548AF831FB8' => ['CA-ON', 'fr'],
        '6DFC07D0F0E94A259BA0088B58546BAA' => ['CA-QC', 'en'], '021B3028C6E44063ACA4283E4D899F72' => ['CA-QC', 'fr'],
        '53B6A52587004025863E9CDAB4D2EE9F' => ['CA-SK', 'en'],
    ];

    public function __construct(
        private string $cacheDir,
        private bool $refresh = false,
        private ?string $apiKey = null,
        private ?\Closure $log = null,
    ) {
    }

    public function jurisdiction(string $id): array
    {
        return $this->get("jurisdictions/$id")['data'];
    }

    public function set(string $id): array
    {
        return $this->get("standard_sets/$id", "sets/$id.json")['data'];
    }

    /** Our jurisdiction code => CSP ids (a province can have an English and a French jurisdiction). */
    public static function byCode(): array
    {
        $out = [];
        foreach (self::JURISDICTIONS as $id => [$code]) {
            $out[$code][] = $id;
        }

        return $out;
    }

    /** @return Generator<array> one package per document */
    public function packages(string $cspJurisdictionId): Generator
    {
        [$code, $language] = self::JURISDICTIONS[$cspJurisdictionId] ?? throw new RuntimeException("Unmapped CSP jurisdiction $cspJurisdictionId");
        $j = $this->jurisdiction($cspJurisdictionId);
        $groups = [];
        foreach ($j['standardSets'] as $s) {
            $docId = $s['document']['id'] ?? null;
            $groups[$docId ? "doc:$docId" : "set:{$s['id']}"][] = $s;
        }
        foreach ($groups as $docKey => $sets) {
            $full = [];
            foreach ($sets as $s) {
                try {
                    $full[] = $this->set($s['id']);
                } catch (RuntimeException $e) {
                    $this->say("  skipped set {$s['id']}: {$e->getMessage()}");
                }
            }
            if ($full) {
                yield $this->package($code, $language, $cspJurisdictionId, $docKey, $full);
            }
        }
    }

    public function package(string $code, string $language, string $cspJurisdictionId, string $docKey, array $sets): array
    {
        usort($sets, fn ($a, $b) => [self::levelSort($a['educationLevels'] ?? []), $a['title'] ?? ''] <=> [self::levelSort($b['educationLevels'] ?? []), $b['title'] ?? '']);
        $first = $sets[0];
        $doc = $first['document'] ?? [];
        $archived = false;
        $labelYears = null;
        $subjects = [];
        foreach ($sets as $s) {
            [$subject, $isArchived, $years] = self::subject($s, $code);
            $archived = $archived || $isArchived;
            $labelYears ??= $years;
            $subjects[$subject] = ($subjects[$subject] ?? 0) + 1;
        }
        arsort($subjects);
        $subject = array_key_first($subjects);
        $jurisdictionName = Reference::JURISDICTIONS[$code][0];
        $lang = $language === 'fr' || preg_match('/fran[cç]ais/i', $first['jurisdiction']['title'] ?? '') ? 'fr' : 'en';
        $ccss = $code === 'US-CCSS';

        $items = [];
        $associations = [];
        foreach ($sets as $s) {
            $levels = self::levels($s['educationLevels'] ?? []);
            $setKey = 'set:' . $s['id'];
            $items[] = ['key' => $setKey, 'parent' => null, 'item_type' => 'section', 'statement' => trim($s['title'] ?? '') ?: $subject,
                'levels' => $levels, 'extra' => ['csp_set' => $s['id']]];
            $standards = array_values($s['standards'] ?? []);
            usort($standards, fn ($a, $b) => ($a['position'] ?? 0) <=> ($b['position'] ?? 0));
            $hasChildren = [];
            foreach ($standards as $st) {
                if (! empty($st['parentId'])) {
                    $hasChildren[$st['parentId']] = true;
                }
            }
            foreach ($standards as $st) {
                $uri = null;
                $matches = [];
                foreach ($st['exactMatch'] ?? [] as $m) {
                    if (preg_match('/^[0-9a-f]{32}$/i', $m)) {
                        $matches[] = ['destination_uri' => 'urn:guid:' . strtoupper($m)];
                    } elseif ($ccss && ! $uri && str_contains($m, 'corestandards.org')) {
                        $uri = $m;     // the Common Core's own URI for this item
                    } else {
                        $matches[] = ['destination_uri' => $m];
                    }
                }
                if (! $uri && ! empty($st['asnIdentifier'])) {
                    $uri = 'http://purl.org/ASN/resources/' . $st['asnIdentifier'];
                }
                $parent = ! empty($st['parentId']) && isset($s['standards'][$st['parentId']]) ? $st['parentId'] : $setKey;
                $items[] = [
                    'key' => $st['id'], 'parent' => $parent,
                    'code' => $st['statementNotation'] ?? null, 'alt_code' => $st['altStatementNotation'] ?? null,
                    'list_label' => $st['listId'] ?? null, 'type_label' => $st['statementLabel'] ?? null,
                    'item_type' => Package::itemType($st['statementLabel'] ?? null, isset($hasChildren[$st['id']])),
                    'statement' => self::clean($st['description'] ?? ''),
                    'notes' => array_values(array_filter(array_map([self::class, 'clean'], $st['comments'] ?? []))),
                    'asn_id' => $st['asnIdentifier'] ?? null, 'uri' => $uri, 'levels' => $levels,
                ];
                foreach ($matches as $m) {
                    if ($m['destination_uri'] !== 'urn:guid:' . strtoupper($st['id'])) {
                        $associations[] = ['origin' => $st['id'], 'type' => 'exactMatchOf'] + $m;
                    }
                }
            }
        }
        $license = $first['license'] ?? [];
        $setIds = array_column($sets, 'id');

        return [
            'source' => self::SOURCE,
            'jurisdiction' => $code,
            'framework' => [
                'slug' => self::slug($code . ' ' . $subject . ($lang === 'fr' ? ' fr' : '')),
                'title' => "$jurisdictionName: $subject",
                'subject_label' => $subject, 'language' => $lang,
            ],
            'document' => [
                'source_key' => $cspJurisdictionId . ':' . $docKey,
                'title' => trim($doc['title'] ?? '') ?: trim($first['title'] ?? '') ?: "$jurisdictionName: $subject",
                'version_label' => isset($doc['valid']) && $doc['valid'] !== '' ? (string) $doc['valid'] : ($labelYears ?? self::yearIn($first['title'] ?? '')),
                'status' => $archived || preg_match('/deprecat|archiv|retired/i', $doc['publicationStatus'] ?? '') ? 'archived' : 'current',
                'language' => $lang,
                'source_url' => $doc['sourceURL'] ?? null,
                'license' => empty($license['title']) ? null : ['title' => $license['title'], 'url' => $license['URL'] ?? null, 'rights_holder' => $license['rightsHolder'] ?? null],
                'meta' => array_filter([
                    'csp_jurisdiction' => $cspJurisdictionId, 'csp_document' => $doc['id'] ?? null,
                    'asn_document' => $doc['asnIdentifier'] ?? null, 'publication_status' => $doc['publicationStatus'] ?? null,
                    'csp_sets' => $setIds,
                ]),
            ],
            'items' => $items,
            'associations' => $associations,
        ];
    }

    /** [subject label, archived?, years in the label] */
    public static function subject(array $set, string $code): array
    {
        $subject = trim($set['subject'] ?? '');
        $archived = (bool) preg_match('/archiv/iu', $subject);
        $subject = trim(preg_replace(['/^z\s+(?=[\[{(])/u', '/[\[{(]?\s*archiv(?:ed|ée|é)\s*[\]})]?/iu'], '', $subject));
        $jName = Reference::JURISDICTIONS[$code][0] ?? '';
        $generic = $subject === '' || preg_match('/^(?:standards?|curriculum|programme d\'études|general|elementary|secondary|secondaire|primaire|grades?\b.*)$/iu', $subject)
            || ($jName !== '' && str_contains(mb_strtolower($subject), mb_strtolower($jName)));
        if ($generic) {
            // e.g. "Grade 5 - Mathematics (2005)": take the part that isn't a grade
            $title = preg_replace('/\([^)]*\)/', '', $set['title'] ?? '');
            $parts = array_values(array_filter(array_map('trim', preg_split('/\s*[-–:]\s+|\s+[-–:]\s*/u', $title)),
                fn ($p) => $p !== '' && ! preg_match('/^(?:grades?|kindergarten|year|years|high school|année|niveau|\d|k\b|pre-?k)/iu', $p)));
            $subject = preg_replace('/\s+\d+[A-Z]?$/', '', $parts[0] ?? ($set['normalizedSubject'] ?? 'General'));
        }
        // "Science (2010-2017)" and "Science (2018-)" are editions of one framework
        $years = null;
        if (preg_match('/\(([^)]*\b(?:19|20)\d\d\b[^)]*)\)/', $subject, $m)) {
            $years = trim($m[1]);
            $subject = trim(str_replace($m[0], '', $subject));
        }

        return [trim($subject, " \t-–:") ?: 'General', $archived, $years];
    }

    public static function levels(array $csp): array
    {
        $out = [];
        foreach ($csp as $l) {
            if (preg_match('/^\d{1,2}$/', $l)) {
                $out[] = 'GRADE:' . sprintf('%02d', (int) $l);
            } elseif (isset(Reference::CSP_LEVELS[$l])) {
                $out[] = 'GRADE:' . Reference::CSP_LEVELS[$l];
            }
        }

        return $out;
    }

    private static function levelSort(array $levels): int
    {
        $min = 99;
        foreach ($levels as $l) {
            $v = match (true) {
                $l === 'Pre-K' => -1, $l === 'K' => 0, (bool) preg_match('/^\d+$/', $l) => (int) $l, default => 20,
            };
            $min = min($min, $v);
        }

        return $min;
    }

    private static function yearIn(string $s): ?string
    {
        return preg_match('/\b((?:19|20)\d\d)\b/', $s, $m) ? $m[1] : null;
    }

    /**
     * Standards text with its markup removed. Only real tags are removed: maths uses "<" and ">"
     * as symbols ("record the results with >, = or <"), which strip_tags would eat.
     * Exponents and subscripts stay readable: x<sup>2</sup> -> x², H<sub>2</sub>O -> H₂O.
     */
    public static function clean(string $s): string
    {
        $tags = 'a|abbr|b|br|c|canvas|div|em|embed|audio|video|details|font|h[1-6]|i|img|input|li|ol|p|s|small|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul';
        $s = preg_replace('#<(script|style)\b[^>]*>.*?</\1>#is', '', $s);
        $s = preg_replace_callback('#<(sup|sub)\b[^<>]*>(.*?)</\1>#is', function ($m) {
            $t = trim(strip_tags($m[2]));
            $map = $m[1] === 'sup' ? ['0' => '⁰', '1' => '¹', '2' => '²', '3' => '³', '4' => '⁴', '5' => '⁵', '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹', '-' => '⁻', '+' => '⁺', 'n' => 'ⁿ']
                : ['0' => '₀', '1' => '₁', '2' => '₂', '3' => '₃', '4' => '₄', '5' => '₅', '6' => '₆', '7' => '₇', '8' => '₈', '9' => '₉', '-' => '₋', '+' => '₊'];
            if ($t !== '' && strspn($t, implode('', array_keys($map))) === strlen($t)) {
                return strtr($t, $map);
            }

            return ($m[1] === 'sup' ? '^' : '_') . (mb_strlen($t) > 1 ? "($t)" : $t);
        }, $s);
        $s = preg_replace('#<li\b[^<>]*>#i', "\n• ", $s);
        $s = preg_replace('#<(?:br|/p|/div|/tr|/ul|/ol)\b[^<>]*>#i', "\n", $s);
        $s = preg_replace('#</?(?:' . $tags . ')\b[^<>]*>#i', '', $s);
        $s = html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $s = preg_replace("/[ \t\x{00A0}]+/u", ' ', $s);
        $s = preg_replace("/ *\n */", "\n", $s);

        return trim(preg_replace("/\n{3,}/", "\n\n", $s));
    }

    public static function slug(string $s): string
    {
        $s = iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) ?: $s;

        return substr(trim(preg_replace('/[^a-z0-9]+/', '-', strtolower($s)), '-'), 0, 180);
    }

    private function get(string $path, ?string $cacheName = null): array
    {
        $file = rtrim($this->cacheDir, '/') . '/' . ($cacheName ?? str_replace('/', '-', $path) . '.json');
        if (! $cacheName && str_starts_with($path, 'jurisdictions/')) {
            $file = rtrim($this->cacheDir, '/') . '/jurisdictions/' . substr($path, 14) . '.json';
        }
        if (! $this->refresh && is_file($file) && filesize($file) > 0) {
            return json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
        }
        $body = Http::get(self::BASE . '/' . $path, $this->apiKey ? ['Api-Key: ' . $this->apiKey] : []);
        $data = json_decode($body, true, flags: JSON_THROW_ON_ERROR);
        if (! isset($data['data'])) {
            throw new RuntimeException("Unexpected response for $path");
        }
        @mkdir(dirname($file), 0775, true);
        file_put_contents($file, $body);

        return $data;
    }

    private function say(string $line): void
    {
        if ($this->log) {
            ($this->log)($line);
        }
    }
}
