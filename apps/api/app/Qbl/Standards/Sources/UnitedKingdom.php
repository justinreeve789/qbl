<?php

namespace App\Qbl\Standards\Sources;

use App\Qbl\Standards\Sources\CommonStandardsProject as Csp;
use DOMDocument;
use DOMElement;
use DOMNode;
use DOMXPath;
use Generator;
use RuntimeException;

/**
 * The four UK curricula, read from their official publications:
 *
 *  GB-ENG  National curriculum in England, programmes of study (gov.uk HTML), KS1-KS4.
 *  GB-SCT  Curriculum for Excellence experiences and outcomes (Education Scotland RTF), early-fourth level.
 *  GB-WLS  Curriculum for Wales: statements of what matters + descriptions of learning (hwb.gov.wales HTML), PS1-PS5.
 *  GB-NIR  Northern Ireland Curriculum minimum content, SR 2007/46 Schedule 2 (legislation.gov.uk XML), FS-KS4.
 *
 * All Crown copyright under the Open Government Licence v3.0. Each produces one package
 * per subject / curriculum area. Downloads are cached under $cacheDir; --refresh re-fetches.
 * When a publisher changes its page layout, the parser here is the one place to update.
 */
final class UnitedKingdom
{
    public const OGL = ['title' => 'Open Government Licence v3.0', 'url' => 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', 'rights_holder' => 'Crown copyright'];

    public const NATIONS = [
        'GB-ENG' => ['source' => ['slug' => 'gov-uk-dfe', 'name' => 'Department for Education (gov.uk)', 'kind' => 'html', 'base_url' => 'https://www.gov.uk/government/collections/national-curriculum',
            'attribution' => 'National curriculum in England, Department for Education. Contains public sector information licensed under the Open Government Licence v3.0.']],
        'GB-SCT' => ['source' => ['slug' => 'education-scotland', 'name' => 'Education Scotland', 'kind' => 'rtf', 'base_url' => 'https://education.gov.scot/curriculum-for-excellence/curriculum-for-excellence-documents/experiences-and-outcomes/',
            'attribution' => 'Curriculum for Excellence experiences and outcomes, Education Scotland. Open Government Licence v3.0.']],
        'GB-WLS' => ['source' => ['slug' => 'hwb-wales', 'name' => 'Hwb, Welsh Government', 'kind' => 'html', 'base_url' => 'https://hwb.gov.wales/curriculum-for-wales/',
            'attribution' => 'Curriculum for Wales, Welsh Government. Open Government Licence v3.0.']],
        'GB-NIR' => ['source' => ['slug' => 'legislation-gov-uk', 'name' => 'legislation.gov.uk', 'kind' => 'xml', 'base_url' => 'https://www.legislation.gov.uk/nisr/2007/46',
            'attribution' => 'The Education (Curriculum Minimum Content) Order (Northern Ireland) 2007. Open Government Licence v3.0.']],
    ];

    /** England: gov.uk publication slug => subject title */
    public const ENGLAND = [
        'art-and-design-programmes-of-study' => 'Art and design', 'citizenship-programmes-of-study' => 'Citizenship',
        'computing-programmes-of-study' => 'Computing', 'design-and-technology-programmes-of-study' => 'Design and technology',
        'english-programmes-of-study' => 'English', 'geography-programmes-of-study' => 'Geography',
        'history-programmes-of-study' => 'History', 'languages-progammes-of-study' => 'Languages',
        'mathematics-programmes-of-study' => 'Mathematics', 'music-programmes-of-study' => 'Music',
        'physical-education-programmes-of-study' => 'Physical education', 'science-programmes-of-study' => 'Science',
    ];

    /** Scotland: code prefix => [area title, subject slug] */
    public const SCOTLAND = [
        'HWB' => ['Health and wellbeing', 'health'], 'LIT' => ['Literacy across learning', 'ela'], 'ENG' => ['English', 'ela'],
        'GAI' => ['Gàidhlig', 'world-languages'], 'LGL' => ['Gaelic (learners)', 'world-languages'], 'MLAN' => ['Modern languages', 'world-languages'],
        'CLAN' => ['Classical languages', 'world-languages'], 'MNU' => ['Numeracy across learning', 'mathematics'], 'MTH' => ['Mathematics', 'mathematics'],
        'EXA' => ['Expressive arts', 'arts'], 'RME' => ['Religious and moral education', 'religious-education'],
        'RERC' => ['Religious education in Roman Catholic schools', 'religious-education'], 'SCN' => ['Sciences', 'science'],
        'SOC' => ['Social studies', 'social-studies'], 'TCH' => ['Technologies', 'computer-science'],
    ];

    public const SCOTLAND_LEVELS = ['early', 'first', 'second', 'third', 'fourth'];

    /** Wales: area slug => [title, subject slug] */
    public const WALES = [
        'expressive-arts' => ['Expressive Arts', 'arts'], 'health-and-well-being' => ['Health and Well-being', 'health'],
        'humanities' => ['Humanities', 'social-studies'], 'languages-literacy-and-communication' => ['Languages, Literacy and Communication', 'ela'],
        'mathematics-and-numeracy' => ['Mathematics and Numeracy', 'mathematics'], 'science-and-technology' => ['Science and Technology', 'science'],
    ];

    /** Northern Ireland areas of learning => subject slug */
    public const NI_AREAS = [
        'LANGUAGE AND LITERACY' => 'ela', 'MATHEMATICS AND NUMERACY' => 'mathematics', 'THE ARTS' => 'arts',
        'THE WORLD AROUND US' => 'other', 'PERSONAL DEVELOPMENT AND MUTUAL UNDERSTANDING' => 'personal-social',
        'PHYSICAL DEVELOPMENT AND MOVEMENT' => 'physical-education', 'PHYSICAL EDUCATION' => 'physical-education',
        'MODERN LANGUAGES' => 'world-languages', 'ENVIRONMENT AND SOCIETY' => 'social-studies',
        'SCIENCE AND TECHNOLOGY' => 'science', 'LEARNING FOR LIFE AND WORK' => 'personal-social',
    ];

    public const NI_STAGES = ['Foundation Stage' => 'FS', 'Key Stage 1' => 'KS1', 'Key Stage 2' => 'KS2', 'Key Stage 3' => 'KS3', 'Key Stage 4' => 'KS4'];

    public function __construct(private string $cacheDir, private bool $refresh = false, private ?\Closure $log = null)
    {
    }

    public function packages(string $nation): Generator
    {
        yield from match ($nation) {
            'GB-ENG' => $this->england(),
            'GB-SCT' => $this->scotland(),
            'GB-WLS' => $this->wales(),
            'GB-NIR' => $this->northernIreland(),
            default => throw new RuntimeException("Unknown nation $nation"),
        };
    }

    // ================================================================ England

    public function england(): Generator
    {
        foreach (self::ENGLAND as $slug => $subject) {
            $pubUrl = "https://www.gov.uk/government/publications/national-curriculum-in-england-$slug";
            $pub = $this->fetch($pubUrl, "eng-pub-$slug.html");
            if (! preg_match('#href="(/government/publications/national-curriculum-in-england-' . preg_quote($slug, '#') . '/[^"]+)"#', $pub, $m)) {
                $this->say("  England $subject: no HTML version found on $pubUrl");
                continue;
            }
            $url = 'https://www.gov.uk' . html_entity_decode($m[1]);
            yield $this->englandPackage($subject, $url, $this->fetch($url, "eng-$slug.html"));
        }
    }

    public function englandPackage(string $subject, string $url, string $html): array
    {
        $dom = self::dom($html);
        $xp = new DOMXPath($dom);
        $body = $xp->query('//div[contains(concat(" ", normalize-space(@class), " "), " govspeak ")]')->item(0)
            ?? throw new RuntimeException("No govspeak content in $url");
        $updated = null;
        foreach ($xp->query('//meta[@name="govuk:public-updated-at"]|//meta[@name="govuk:first-published-at"]') as $meta) {
            $updated ??= substr($meta->getAttribute('content'), 0, 10);
        }

        $items = [];
        $path = [];          // level (2..4) => [key, title]
        $guidance = false;
        $count = [];
        $add = function (array $item) use (&$items) {
            $items[] = $item;

            return $item['key'];
        };
        $parentKey = function () use (&$path) {
            return $path ? end($path)[0] : null;
        };
        $intro = $add(['key' => 'introduction', 'parent' => null, 'item_type' => 'section', 'statement' => 'Purpose, aims and attainment targets', 'heading' => true]);
        $path = [1 => [$intro, 'Introduction']];
        $stop = false;

        $walkList = function (DOMElement $list, ?string $parent, string $prefix) use (&$walkList, &$add, &$guidance, &$path, &$count, $subject) {
            $n = 0;
            foreach ($list->childNodes as $li) {
                if (! $li instanceof DOMElement || $li->nodeName !== 'li') {
                    continue;
                }
                $n++;
                $text = self::ownText($li);
                if ($text === '') {
                    continue;
                }
                $key = "$prefix/$n";
                $levels = self::englandLevels(array_column($path, 1));
                $add(['key' => $key, 'parent' => $parent, 'item_type' => $guidance ? 'guidance' : 'standard',
                    'statement' => $text, 'is_statutory' => ! $guidance, 'levels' => $levels]);
                foreach ($li->childNodes as $c) {
                    if ($c instanceof DOMElement && in_array($c->nodeName, ['ul', 'ol'], true)) {
                        $walkList($c, $key, $key);
                    }
                }
            }
        };

        foreach ($body->childNodes as $node) {
            if ($stop || ! $node instanceof DOMElement) {
                continue;
            }
            $tag = $node->nodeName;
            if (in_array($tag, ['h2', 'h3', 'h4', 'h5'], true)) {
                $level = (int) $tag[1];
                $title = self::text($node);
                if ($level === 2 && preg_match('/^(is this page useful|help us improve)/i', $title)) {
                    $stop = true;
                    continue;
                }
                foreach (array_keys($path) as $l) {
                    if ($l >= $level) {
                        unset($path[$l]);
                    }
                }
                $isGuidance = (bool) preg_match('/non-statutory|notes and guidance/i', $title);
                if ($level <= 3) {
                    $guidance = false;
                }
                if ($isGuidance) {
                    $guidance = true;
                }
                $parent = $parentKey();
                $base = ($parent ? $parent . '/' : '') . Csp::slug($title);
                $count[$base] = ($count[$base] ?? 0) + 1;
                $key = $count[$base] > 1 ? $base . '~' . $count[$base] : $base;
                $type = match ($level) { 2 => 'section', 3 => 'strand', default => $isGuidance ? 'guidance' : 'substrand' };
                $levels = self::englandLevels([...array_column($path, 1), $title]);
                $add(['key' => $key, 'parent' => $parent, 'item_type' => $type, 'statement' => $title, 'levels' => $levels,
                    'is_statutory' => $isGuidance ? false : null, 'heading' => true]);
                $path[$level] = [$key, $title];
            } elseif ($tag === 'ul' || $tag === 'ol') {
                $parent = $parentKey();
                $count[$parent . '/li'] = ($count[$parent . '/li'] ?? 0) + 1;
                $prefix = $parent . '/li' . $count[$parent . '/li'];
                $walkList($node, $parent, $prefix);
            }
        }
        // drop headings that ended up with nothing under them (contents lists, "Introduction" headers)
        $hasChild = [];
        foreach ($items as $i) {
            if ($i['parent']) {
                $hasChild[$i['parent']] = true;
            }
        }
        $items = array_values(array_filter($items, fn ($i) => empty($i['heading']) || isset($hasChild[$i['key']])));
        $items = array_map(function ($i) {
            unset($i['heading']);

            return $i;
        }, $items);

        return [
            'source' => self::NATIONS['GB-ENG']['source'],
            'jurisdiction' => 'GB-ENG',
            'framework' => ['slug' => 'gb-eng-national-curriculum-' . Csp::slug($subject), 'title' => "National curriculum in England: $subject",
                'subject_label' => $subject, 'publisher' => 'Department for Education'],
            'document' => [
                'source_key' => 'national-curriculum-' . Csp::slug($subject),
                'title' => "National curriculum in England: $subject programmes of study",
                'version_label' => '2013' . ($updated ? " (updated $updated)" : ''), 'published_year' => 2013,
                'status' => 'current', 'language' => 'en', 'publisher' => 'Department for Education', 'source_url' => $url,
                'license' => self::OGL, 'meta' => ['updated' => $updated],
            ],
            'items' => $items,
        ];
    }

    /** Years from the headings in force: "Year 3 programme of study", "Lower key stage 2 - years 3 and 4", "Key stage 3". */
    public static function englandLevels(array $headings): array
    {
        for ($i = count($headings) - 1; $i >= 0; $i--) {
            $h = mb_strtolower($headings[$i]);
            if (preg_match('/years? (\d+)(?:\s*(?:and|to|-|–)\s*(\d+))?/', $h, $m)) {
                $to = isset($m[2]) && $m[2] !== '' ? (int) $m[2] : (int) $m[1];

                return array_map(fn ($y) => "GB-ENG:Y$y", range((int) $m[1], max((int) $m[1], $to)));
            }
            if (preg_match('/key stages? (\d)(?:\s*(?:and|to|-|–)\s*(\d))?/', $h, $m)) {
                $years = ['1' => [1, 2], '2' => [3, 6], '3' => [7, 9], '4' => [10, 11]];
                $from = $years[$m[1]][0] ?? 1;
                $to = $years[$m[2] ?? $m[1]][1] ?? $from;

                return array_map(fn ($y) => "GB-ENG:Y$y", range($from, $to));
            }
        }

        return [];
    }

    // ================================================================ Scotland

    public function scotland(): Generator
    {
        $url = 'https://education.gov.scot/media/43ojiq01/all-experiencesoutcomes18.doc';
        $text = Rtf::toText($this->fetch($url, 'sct-experiences-outcomes.rtf'));
        yield from $this->scotlandPackages($text, $url);
    }

    public function scotlandPackages(string $text, string $url): array
    {
        $code = '[A-Z]{3,4} [0-4]-\d{2}[a-z]';
        $areas = [];
        $seen = [];
        $topic = null;
        foreach (explode(Rtf::ROW, $text) as $row) {
            $cells = explode(Rtf::CELL, $row);
            if (! preg_match("/$code/", $row)) {
                // a heading row like "Number, money and measure", or the header "Early | First | ..."
                $last = self::lastParagraph($cells[0]);
                if ($last !== '' && mb_strlen($last) < 90 && ! preg_match('/^(early|first|second|third|fourth)$/i', trim($cells[1] ?? ''))) {
                    $topic = $last;
                }
                continue;
            }
            $organiser = null;
            // text before a table's first cell is prose that may mention codes: keep only its last paragraph
            $cells[0] = self::lastParagraph($cells[0]);
            foreach ($cells as $ci => $cell) {
                if (! preg_match("/$code/", $cell)) {
                    if ($ci === 0) {
                        $organiser = self::lastParagraph($cell) ?: null;
                    }
                    continue;
                }
                // "statement CODE / CODE  statement CODE": text before each group of codes belongs to those codes
                preg_match_all("/((?:$code)(?:\s*\/\s*(?:$code))*)/", $cell, $groups, PREG_OFFSET_CAPTURE);
                $start = 0;
                foreach ($groups[1] as [$group, $offset]) {
                    $statement = self::tidy(substr($cell, $start, $offset - $start));
                    $start = $offset + strlen($group);
                    if ($statement === '') {
                        continue;
                    }
                    foreach (preg_split('/\s*\/\s*/', trim($group)) as $c) {
                        $c = preg_replace('/\s+/', ' ', $c);
                        if (isset($seen[$c])) {
                            continue;
                        }
                        $seen[$c] = true;
                        [$prefix, $rest] = explode(' ', $c);
                        $areas[$prefix][] = ['code' => $c, 'level' => self::SCOTLAND_LEVELS[(int) $rest[0]] ?? null,
                            'statement' => $statement, 'topic' => $topic, 'organiser' => $organiser];
                    }
                }
            }
        }
        $packages = [];
        foreach ($areas as $prefix => $outcomes) {
            [$title, $subject] = self::SCOTLAND[$prefix] ?? [$prefix, 'other'];
            $items = [];
            $made = [];
            foreach ($outcomes as $o) {
                $parent = null;
                foreach (['topic' => 'strand', 'organiser' => 'topic'] as $field => $type) {
                    if (! $o[$field]) {
                        continue;
                    }
                    $key = ($parent ? "$parent/" : '') . Csp::slug($o[$field]);
                    if (! isset($made[$key])) {
                        $made[$key] = true;
                        $items[] = ['key' => $key, 'parent' => $parent, 'item_type' => $type, 'statement' => $o[$field]];
                    }
                    $parent = $key;
                }
                $items[] = ['key' => $o['code'], 'parent' => $parent, 'code' => $o['code'], 'item_type' => 'outcome',
                    'type_label' => 'Experience and outcome', 'statement' => $o['statement'], 'is_statutory' => false,
                    'levels' => $o['level'] ? ["GB-SCT:{$o['level']}"] : []];
            }
            $packages[] = [
                'source' => self::NATIONS['GB-SCT']['source'],
                'jurisdiction' => 'GB-SCT',
                'framework' => ['slug' => 'gb-sct-cfe-' . Csp::slug($title), 'title' => "Curriculum for Excellence: $title", 'subject' => $subject,
                    'subject_label' => $title, 'publisher' => 'Education Scotland'],
                'document' => [
                    'source_key' => 'cfe-eo-' . strtolower($prefix), 'title' => "Curriculum for Excellence: $title experiences and outcomes",
                    'version_label' => '2009 (2017 compilation)', 'published_year' => 2009, 'status' => 'current', 'language' => 'en',
                    'publisher' => 'Education Scotland', 'source_url' => $url, 'license' => self::OGL, 'meta' => ['code_prefix' => $prefix],
                ],
                'items' => $items,
            ];
        }

        return $packages;
    }

    // ================================================================ Wales

    public function wales(): Generator
    {
        foreach (self::WALES as $slug => [$title, $subject]) {
            $base = "https://hwb.gov.wales/curriculum-for-wales/areas-of-learning-and-experience/$slug";
            $dol = $this->fetch("$base/descriptions-of-learning/", "wls-$slug-descriptions-of-learning.html");
            yield $this->walesPackage($slug, $title, $subject, "$base/descriptions-of-learning/", $dol);
        }
    }

    public function walesPackage(string $slug, string $title, string $subject, string $url, string $html): array
    {
        $xp = new DOMXPath(self::dom($html));
        $items = [];
        $strandKey = null;
        $s = 0;
        $e = 0;
        $nodes = $xp->query('//*[contains(concat(" ", normalize-space(@class), " "), " progression-steps__strand ") or contains(concat(" ", normalize-space(@class), " "), " progression-steps__element ")]');
        foreach ($nodes as $node) {
            $class = ' ' . $node->getAttribute('class') . ' ';
            if (str_contains($class, ' progression-steps__strand ')) {
                $s++;
                $e = 0;
                $strandKey = "s$s";
                $items[] = ['key' => $strandKey, 'parent' => null, 'item_type' => 'strand', 'type_label' => 'Statement of what matters',
                    'statement' => self::text($node), 'is_statutory' => true];
                continue;
            }
            $e++;
            $cells = $xp->query('.//*[contains(concat(" ", normalize-space(@class), " "), " progression-steps__cell ")]', $node);
            foreach ($cells as $step => $cell) {
                $p = 0;
                $paras = $xp->query('.//p|.//li', $cell);
                $texts = [];
                foreach ($paras as $para) {
                    $t = self::text($para);
                    if ($t !== '') {
                        $texts[] = $t;
                    }
                }
                if (! $texts && ($t = self::text($cell)) !== '') {
                    $texts[] = $t;
                }
                foreach ($texts as $t) {
                    $p++;
                    $ps = $step + 1;
                    $items[] = ['key' => "$strandKey/e$e/ps$ps/$p", 'parent' => $strandKey, 'item_type' => 'progression',
                        'type_label' => "Description of learning, progression step $ps", 'statement' => $t, 'is_statutory' => false,
                        'levels' => ["GB-WLS:PS$ps"]];
                }
            }
        }
        if (! $items) {
            throw new RuntimeException("No descriptions of learning found at $url (page layout changed?)");
        }

        return [
            'source' => self::NATIONS['GB-WLS']['source'],
            'jurisdiction' => 'GB-WLS',
            'framework' => ['slug' => "gb-wls-curriculum-for-wales-$slug", 'title' => "Curriculum for Wales: $title", 'subject' => $subject,
                'subject_label' => $title, 'publisher' => 'Welsh Government'],
            'document' => [
                'source_key' => "cfw-$slug", 'title' => "Curriculum for Wales: $title, statements of what matters and descriptions of learning",
                'version_label' => '2022', 'published_year' => 2022, 'effective_from' => '2022-09-01', 'status' => 'current', 'language' => 'en',
                'publisher' => 'Welsh Government', 'source_url' => $url, 'license' => self::OGL,
            ],
            'items' => $items,
        ];
    }

    // ================================================================ Northern Ireland

    public function northernIreland(): Generator
    {
        $url = 'https://www.legislation.gov.uk/nisr/2007/46/made/data.xml';
        yield from $this->northernIrelandPackages($this->fetch($url, 'nir-2007-46.xml'), 'https://www.legislation.gov.uk/nisr/2007/46/schedule/2/made');
    }

    public function northernIrelandPackages(string $xml, string $url): array
    {
        $dom = new DOMDocument();
        $dom->loadXML($xml, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        $xp = new DOMXPath($dom);
        $xp->registerNamespace('l', 'http://www.legislation.gov.uk/namespaces/legislation');
        $schedule = $xp->query('//l:Schedule')->item(1) ?? throw new RuntimeException('Schedule 2 not found');
        $areas = [];   // area => items
        foreach ($xp->query('.//l:Part', $schedule) as $part) {
            $titles = $xp->query('./l:Title', $part);
            $stageTitle = $titles->length ? self::text($titles->item(0)) : '';
            $stage = self::NI_STAGES[$stageTitle] ?? null;
            if (! $stage) {
                continue;  // Part 1: general statutory requirements
            }
            $state = ['area' => null, 'strand' => null, 'progression' => null, 'count' => []];
            $this->niWalk($part, $xp, $stage, $stageTitle, $state, $areas);
        }
        $packages = [];
        foreach ($areas as $area => $items) {
            $title = self::niTitle($area);
            $packages[] = [
                'source' => self::NATIONS['GB-NIR']['source'],
                'jurisdiction' => 'GB-NIR',
                'framework' => ['slug' => 'gb-nir-curriculum-' . Csp::slug($title), 'title' => "Northern Ireland Curriculum: $title",
                    'subject' => self::NI_AREAS[$area] ?? 'other', 'subject_label' => $title, 'publisher' => 'Department of Education (NI)'],
                'document' => [
                    'source_key' => 'nisr-2007-46-' . Csp::slug($title), 'title' => "Northern Ireland Curriculum minimum content: $title",
                    'version_label' => 'SR 2007/46', 'published_year' => 2007, 'adopted_on' => '2007-01-26', 'status' => 'current', 'language' => 'en',
                    'publisher' => 'Department of Education (Northern Ireland)', 'source_url' => $url, 'license' => self::OGL,
                ],
                'items' => $items,
            ];
        }

        return $packages;
    }

    private function niWalk(DOMNode $node, DOMXPath $xp, string $stage, string $stageTitle, array &$st, array &$areas): void
    {
        foreach ($node->childNodes as $c) {
            if (! $c instanceof DOMElement) {
                continue;
            }
            $tag = $c->localName;
            if ($tag === 'Title') {
                $t = self::text($c);
                if ($t === $stageTitle || $t === '') {
                    continue;
                }
                $head = strtoupper(trim(explode(':', $t)[0]));
                if ($head === 'ART AND DESIGN' && str_contains(strtoupper($t), 'MUSIC')) {
                    $head = 'THE ARTS';
                    $t = 'THE ARTS: Music';
                }
                if (isset(self::NI_AREAS[$head])) {
                    $st['area'] = $head;
                    $sub = trim(explode(':', $t, 2)[1] ?? '');
                    $key = $stage;
                    $this->niAdd($areas, $head, ['key' => $key, 'parent' => null, 'item_type' => 'section', 'statement' => $stageTitle, 'levels' => ["GB-NIR:$stage"]]);
                    $st['stageKey'] = $key;
                    if ($sub !== '') {
                        $key = "$stage/" . Csp::slug($sub);
                        $this->niAdd($areas, $head, ['key' => $key, 'parent' => $stage, 'item_type' => 'strand', 'statement' => $sub, 'levels' => ["GB-NIR:$stage"]]);
                    }
                    $st['areaKey'] = $key;
                    $st['strand'] = $key;
                    $st['progression'] = null;
                    continue;
                }
                if (! $st['area']) {
                    continue;
                }
                if (strcasecmp($t, 'Progression') === 0) {
                    $key = $st['strand'] . '/progression';
                    $this->niAdd($areas, $st['area'], ['key' => $key, 'parent' => $st['strand'], 'item_type' => 'section', 'statement' => 'Progression', 'levels' => ["GB-NIR:$stage"]]);
                    $st['progression'] = $key;
                    continue;
                }
                $key = $st['areaKey'] . '/' . Csp::slug($t);
                $this->niAdd($areas, $st['area'], ['key' => $key, 'parent' => $st['areaKey'], 'item_type' => 'strand', 'statement' => self::niTitle($t), 'levels' => ["GB-NIR:$stage"]]);
                $st['strand'] = $key;
                $st['progression'] = null;
                continue;
            }
            if (in_array($tag, ['UnorderedList', 'OrderedList'], true) && $st['area']) {
                $this->niList($c, $st['progression'] ?? $st['strand'], $stage, $st, $areas);
                continue;
            }
            if ($tag === 'Tabular') {
                $this->niTable($c, $xp, $stage, $stageTitle, $st, $areas);
                continue;
            }
            $this->niWalk($c, $xp, $stage, $stageTitle, $st, $areas);
        }
    }

    /** Key Stage 3/4 subjects are tables: a column per objective, a row of learning outcomes. */
    private function niTable(DOMElement $tabular, DOMXPath $xp, string $stage, string $stageTitle, array &$st, array &$areas): void
    {
        $title = $xp->query('./l:Title', $tabular)->item(0);
        if ($title) {
            $fake = $tabular->ownerDocument->createElementNS('http://www.legislation.gov.uk/namespaces/legislation', 'Wrapper');
            $fake->appendChild($title->cloneNode(true));
            $this->niWalk($fake, $xp, $stage, $stageTitle, $st, $areas);
        }
        if (! $st['area']) {
            return;
        }
        $xp->registerNamespace('h', 'http://www.w3.org/1999/xhtml');
        $headers = array_map(fn ($th) => self::text($th), iterator_to_array($xp->query('.//h:thead//h:th', $tabular)));
        foreach ($xp->query('.//h:tbody/h:tr', $tabular) as $tr) {
            $cells = iterator_to_array($xp->query('./h:td', $tr));
            $outcomes = $cells && preg_match('/^learning outcomes/i', self::text($cells[0]));
            foreach ($cells as $i => $td) {
                $label = $outcomes ? 'Learning outcomes' : ($headers[$i] ?? 'Column ' . ($i + 1));
                $strand = $st['areaKey'] . '/' . Csp::slug($label);
                $this->niAdd($areas, $st['area'], ['key' => $strand, 'parent' => $st['areaKey'], 'item_type' => 'strand',
                    'statement' => $label, 'levels' => ["GB-NIR:$stage"]]);
                $last = $strand;
                foreach ($td->childNodes as $c) {
                    if (! $c instanceof DOMElement) {
                        continue;
                    }
                    if (in_array($c->localName, ['UnorderedList', 'OrderedList'], true)) {
                        $this->niList($c, $last, $stage, $st, $areas);
                        continue;
                    }
                    $text = trim(self::ownText($c, ['UnorderedList', 'OrderedList']));
                    if ($outcomes && $i === 0) {
                        $text = trim(preg_replace('/^learning outcomes\s*/i', '', $text));
                    }
                    if ($text !== '') {
                        $n = $st['count'][$strand] = ($st['count'][$strand] ?? 0) + 1;
                        $last = "$strand/p$n";
                        $this->niAdd($areas, $st['area'], ['key' => $last, 'parent' => $strand, 'item_type' => $outcomes ? 'outcome' : 'standard',
                            'statement' => rtrim($text, ' ;'), 'is_statutory' => true, 'levels' => ["GB-NIR:$stage"]]);
                    }
                    foreach ($xp->query('.//l:UnorderedList|.//l:OrderedList', $c) as $list) {
                        if ($list->parentNode->localName !== 'ListItem') {
                            $this->niList($list, $last, $stage, $st, $areas);
                        }
                    }
                }
            }
        }
    }

    private function niList(DOMElement $list, string $parent, string $stage, array &$st, array &$areas): void
    {
        foreach ($list->childNodes as $li) {
            if (! $li instanceof DOMElement || $li->localName !== 'ListItem') {
                continue;
            }
            $text = rtrim(self::ownText($li, ['UnorderedList', 'OrderedList']), ' ;.');
            if ($text === '') {
                continue;
            }
            $n = $st['count'][$parent] = ($st['count'][$parent] ?? 0) + 1;
            $key = "$parent/$n";
            $this->niAdd($areas, $st['area'], ['key' => $key, 'parent' => $parent, 'item_type' => $st['progression'] ? 'progression' : 'standard',
                'statement' => $text, 'is_statutory' => true, 'levels' => ["GB-NIR:$stage"]]);
            foreach ($li->childNodes as $c) {
                if ($c instanceof DOMElement && in_array($c->localName, ['UnorderedList', 'OrderedList'], true)) {
                    $this->niList($c, $key, $stage, $st, $areas);
                }
            }
        }
    }

    private function niAdd(array &$areas, string $area, array $item): void
    {
        foreach ($areas[$area] ?? [] as $existing) {
            if ($existing['key'] === $item['key']) {
                return;
            }
        }
        $areas[$area][] = $item;
    }

    private static function niTitle(string $t): string
    {
        $t = rtrim(trim($t), ':');

        return $t === strtoupper($t) ? ucfirst(strtolower($t)) : $t;
    }

    // ================================================================ helpers

    private function fetch(string $url, string $name): string
    {
        $file = rtrim($this->cacheDir, '/') . '/' . $name;
        if (! $this->refresh && is_file($file) && filesize($file) > 0) {
            return file_get_contents($file);
        }
        $this->say("  fetching $url");
        $body = Http::get($url);
        @mkdir(dirname($file), 0775, true);
        file_put_contents($file, $body);

        return $body;
    }

    private static function dom(string $html): DOMDocument
    {
        $dom = new DOMDocument();
        libxml_use_internal_errors(true);
        $dom->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        libxml_clear_errors();

        return $dom;
    }

    public static function text(DOMNode $n): string
    {
        return trim(preg_replace('/\s+/u', ' ', $n->textContent));
    }

    /** Text of an element without its nested lists. */
    private static function ownText(DOMNode $n, array $skip = ['ul', 'ol']): string
    {
        $out = '';
        foreach ($n->childNodes as $c) {
            if ($c instanceof DOMElement && (in_array($c->nodeName, $skip, true) || in_array($c->localName, $skip, true))) {
                continue;
            }
            $out .= ' ' . $c->textContent;
        }

        return trim(preg_replace('/\s+/u', ' ', $out));
    }

    private static function lastParagraph(string $s): string
    {
        $parts = array_values(array_filter(array_map('trim', preg_split("/\n\s*\n|\n/", $s)), fn ($p) => $p !== ''));

        return $parts ? self::tidy(end($parts)) : '';
    }

    private static function tidy(string $s): string
    {
        $s = str_replace(["\t", "\u{A0}"], ' ', $s);
        $s = preg_replace('/[ ]+/', ' ', $s);
        $s = preg_replace("/\s*\n\s*/", "\n", trim($s));

        return trim($s);
    }

    private function say(string $line): void
    {
        if ($this->log) {
            ($this->log)($line);
        }
    }
}
