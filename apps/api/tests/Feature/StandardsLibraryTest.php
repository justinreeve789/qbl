<?php

namespace Tests\Feature;

use App\Qbl\Generation\Curriculum\MissionStandards;
use App\Qbl\Standards\LegacyStandards;
use App\Qbl\Standards\Sql;
use App\Qbl\Standards\Sources\StandardsList;
use App\Qbl\Standards\Importer;
use App\Qbl\Standards\Reference;
use App\Qbl\Standards\Sources\CasePackage;
use App\Qbl\Standards\Sources\CommonStandardsProject;
use App\Qbl\Standards\Sources\UnitedKingdom;
use App\Qbl\Standards\StandardsStore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PDO;
use Tests\TestCase;

class StandardsLibraryTest extends TestCase
{
    use RefreshDatabase;

    private PDO $pdo;

    protected function setUp(): void
    {
        parent::setUp();
        $this->pdo = DB::connection()->getPdo();
        Reference::seed($this->pdo);
    }

    private function package(array $items, array $doc = [], array $assoc = [], string $fw = 'us-tx-math'): array
    {
        return [
            'source' => ['slug' => 'test', 'name' => 'Test', 'kind' => 'manual'],
            'jurisdiction' => 'US-TX',
            'framework' => ['slug' => $fw, 'title' => 'Texas math', 'subject_label' => 'Mathematics'],
            'document' => $doc + ['source_key' => 'teks-math', 'title' => 'TEKS Mathematics', 'version_label' => '2012'],
            'items' => $items,
            'associations' => $assoc,
        ];
    }

    private function v1(): array
    {
        return [
            ['key' => 'g3', 'item_type' => 'section', 'statement' => 'Grade 3', 'levels' => ['GRADE:03']],
            ['key' => 'a', 'parent' => 'g3', 'code' => '3.1A', 'statement' => 'Add whole numbers.', 'levels' => ['GRADE:03']],
            ['key' => 'b', 'parent' => 'g3', 'code' => '3.1B', 'statement' => 'Subtract whole numbers.', 'levels' => ['GRADE:03']],
            ['key' => 'c', 'parent' => 'g3', 'code' => '3.1C', 'statement' => 'Multiply by one digit.', 'levels' => ['GRADE:03']],
            ['key' => 'd', 'parent' => 'g3', 'code' => '3.1D', 'statement' => 'Tell time to the minute.', 'levels' => ['GRADE:03']],
        ];
    }

    private function importOne(array $package): array
    {
        $imp = new Importer($this->pdo);
        $run = $imp->startRun($package['source']);
        $res = $imp->import($package, $run);
        $imp->finishRun($run);

        return [$res, $imp->stats()];
    }

    public function test_first_import_builds_the_tree_with_levels(): void
    {
        [[$result, $docId]] = $this->importOne($this->package($this->v1()));
        $this->assertSame('added', $result);
        $doc = Sql::row($this->pdo, 'SELECT * FROM standard_documents WHERE id = ?', [$docId]);
        $this->assertSame(1, (int) $doc['revision']);
        $this->assertSame(5, (int) $doc['item_count']);
        $this->assertSame(2012, (int) $doc['published_year']);
        $a = Sql::row($this->pdo, "SELECT * FROM standard_items WHERE code = '3.1A'");
        $g3 = Sql::row($this->pdo, "SELECT * FROM standard_items WHERE source_key = 'g3'");
        $this->assertSame((int) $g3['id'], (int) $a['parent_id']);
        $this->assertSame('/' . $g3['id'] . '/', $a['lineage']);
        $this->assertSame(1, (int) $a['depth']);
        $this->assertSame(1, (int) Sql::scalar($this->pdo, 'SELECT COUNT(*) FROM standard_item_levels WHERE item_id = ?', [$a['id']]));
        $this->assertSame('mathematics', Sql::scalar($this->pdo, 'SELECT s.slug FROM standard_frameworks f JOIN standard_subjects s ON s.id = f.subject_id'));
    }

    public function test_reimporting_the_same_package_changes_nothing(): void
    {
        $this->importOne($this->package($this->v1()));
        [[$result]] = $this->importOne($this->package($this->v1()));
        $this->assertSame('unchanged', $result);
        $this->assertSame(1, (int) Sql::scalar($this->pdo, 'SELECT revision FROM standard_documents'));
        $this->assertSame(1, (int) Sql::scalar($this->pdo, 'SELECT COUNT(*) FROM standard_document_revisions'));
    }

    public function test_a_new_revision_keeps_ids_logs_changes_and_retires_instead_of_deleting(): void
    {
        $this->importOne($this->package($this->v1()));
        $a = Sql::row($this->pdo, "SELECT * FROM standard_items WHERE code = '3.1A'");
        $d = Sql::row($this->pdo, "SELECT * FROM standard_items WHERE code = '3.1D'");
        $store = new StandardsStore($this->pdo);
        $store->align((int) $a['id'], 'scenario', 42, 42);
        $store->align((int) $d['id'], 'question', 7, 42);

        $v2 = $this->v1();
        $v2[1]['statement'] = 'Add and subtract whole numbers within 1,000.';  // changed
        unset($v2[4]);                                                          // 3.1D removed
        $v2[3]['key'] = 'c-renamed';                                            // same code + text: a move, not a new item
        $v2[] = ['key' => 'e', 'parent' => 'g3', 'code' => '3.1E', 'statement' => 'Represent fractions.', 'levels' => ['GRADE:03']];
        [[$result], $stats] = $this->importOne($this->package(array_values($v2)));

        $this->assertSame('changed', $result);
        $this->assertSame(1, $stats['items_changed']);
        $this->assertSame(1, $stats['items_retired']);
        $this->assertSame(1, $stats['items_added']);
        $this->assertSame(1, $stats['items_moved']);
        $a2 = Sql::row($this->pdo, "SELECT * FROM standard_items WHERE code = '3.1A'");
        $this->assertSame($a['uuid'], $a2['uuid']);
        $this->assertSame(2, (int) $a2['last_revision']);
        $rev = Sql::row($this->pdo, 'SELECT * FROM standard_item_revisions WHERE item_id = ?', [$a['id']]);
        $this->assertSame('changed', $rev['change_type']);
        $this->assertSame('Add whole numbers.', json_decode($rev['previous'], true)['statement']);
        $this->assertSame(['statement'], json_decode($rev['fields'], true));
        $this->assertSame('retired', Sql::scalar($this->pdo, 'SELECT status FROM standard_items WHERE id = ?', [$d['id']]));
        $this->assertSame(1, (int) Sql::scalar($this->pdo, "SELECT COUNT(*) FROM standard_items WHERE code = '3.1C'"));
        $this->assertSame(5, (int) Sql::scalar($this->pdo, 'SELECT item_count FROM standard_documents'));

        $aligned = collect($store->alignmentsForScenario(42))->keyBy('code');
        $this->assertSame(1, (int) $aligned['3.1A']['changed_since']);
        $this->assertSame('retired', $aligned['3.1D']['status']);

        // v3 brings 3.1D back: restored with the same id
        $v3 = array_values($v2);
        $v3[] = $this->v1()[4];
        [, $stats] = $this->importOne($this->package($v3));
        $this->assertSame(1, $stats['items_restored']);
        $this->assertSame('active', Sql::scalar($this->pdo, 'SELECT status FROM standard_items WHERE id = ?', [$d['id']]));
        $this->assertSame(3, (int) Sql::scalar($this->pdo, 'SELECT revision FROM standard_documents'));
        $this->assertSame(['added', 'changed', 'moved', 'restored', 'retired'], array_values(array_unique(array_column(
            Sql::rows($this->pdo, 'SELECT change_type FROM standard_item_revisions ORDER BY change_type'), 'change_type'))));
    }

    public function test_later_editions_supersede_earlier_ones(): void
    {
        $this->importOne($this->package($this->v1(), ['source_key' => 'old', 'title' => 'Mathematics (2005)', 'version_label' => '2005']));
        $this->importOne($this->package($this->v1(), ['source_key' => 'new', 'title' => 'Mathematics (2020)', 'version_label' => '2020']));
        $this->importOne($this->package($this->v1(), ['source_key' => 'g6', 'title' => 'Grade 6 Mathematics', 'version_label' => '2005']));
        $docs = collect(Sql::rows($this->pdo, 'SELECT id, source_key, status, supersedes_id FROM standard_documents'))->keyBy('source_key');
        $this->assertSame('superseded', $docs['old']['status']);
        $this->assertSame('current', $docs['new']['status']);
        $this->assertSame((int) $docs['old']['id'], (int) $docs['new']['supersedes_id']);
        $this->assertSame('current', $docs['g6']['status'], 'a different grade is not an edition');
        $current = (int) Sql::scalar($this->pdo, 'SELECT current_document_id FROM standard_frameworks');
        $this->assertSame((int) $docs['new']['id'], $current);
    }

    public function test_crosswalks_resolve_whichever_side_comes_first(): void
    {
        $this->importOne($this->package([
            ['key' => 'x', 'code' => 'TX.3.4', 'statement' => 'Solve one-step problems.'],
        ], ['source_key' => 'tx'], [['origin' => 'x', 'type' => 'exactMatchOf', 'destination_uri' => 'http://corestandards.org/Math/Content/3/OA/A/1']]));
        $ccss = $this->package([['key' => 'oa1', 'code' => 'CCSS.Math.Content.3.OA.A.1', 'statement' => 'Interpret products of whole numbers.',
            'uri' => 'http://corestandards.org/Math/Content/3/OA/A/1', 'levels' => ['GRADE:03']]], ['source_key' => 'ccss'], [], 'ccss-math');
        $ccss['jurisdiction'] = 'US-CCSS';
        $this->importOne($ccss);
        $tx = (int) Sql::scalar($this->pdo, "SELECT id FROM standard_items WHERE code = 'TX.3.4'");
        $walk = (new StandardsStore($this->pdo))->crosswalk($tx);
        $this->assertSame('CCSS.Math.Content.3.OA.A.1', $walk[0]['code']);
        $this->assertSame('US-CCSS', $walk[0]['jurisdiction']);
    }

    public function test_grade_search_spans_school_systems(): void
    {
        $this->importOne($this->package($this->v1()));
        $eng = $this->package([['key' => 'y4', 'statement' => 'count backwards through zero to include negative numbers', 'levels' => ['GB-ENG:Y4']],
            ['key' => 'y9', 'statement' => 'use standard index form', 'levels' => ['GB-ENG:Y9']]], ['source_key' => 'eng'], [], 'eng-maths');
        $eng['jurisdiction'] = 'GB-ENG';
        $this->importOne($eng);
        $store = new StandardsStore($this->pdo);
        $hits = array_column($store->search('', ['grade' => 3, 'limit' => 50]), 'statement');
        $this->assertContains('count backwards through zero to include negative numbers', $hits);   // Year 4 ≈ grade 3
        $this->assertContains('Add whole numbers.', $hits);
        $this->assertNotContains('use standard index form', $hits);
        if (! Sql::isMysql($this->pdo)) {   // InnoDB full-text only sees committed rows; RefreshDatabase never commits
            $this->assertCount(1, $store->search('negative', ['jurisdictions' => ['GB-ENG']]));
        }
    }

    public function test_case_packages_keep_case_identifiers_and_order(): void
    {
        $doc = 'aaaaaaaa-0000-4000-8000-000000000000';
        $cf = ['CFDocument' => ['identifier' => $doc, 'uri' => "https://case.example.org/uri/$doc", 'title' => 'Example Science (2024)', 'version' => '2024',
            'adoptionStatus' => 'Adopted', 'creator' => 'Example DOE', 'subject' => ['Science'], 'licenseURI' => ['title' => 'CC BY 4.0', 'uri' => 'https://creativecommons.org/licenses/by/4.0/']],
            'CFItems' => [
                ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000002', 'fullStatement' => 'Second', 'humanCodingScheme' => 'S.2', 'educationLevel' => ['KG'], 'CFItemType' => 'Standard'],
                ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000001', 'fullStatement' => 'First', 'humanCodingScheme' => 'S.1', 'educationLevel' => ['01', '02'], 'CFItemType' => 'Standard'],
                ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000003', 'fullStatement' => 'Child of first', 'humanCodingScheme' => 'S.1.a', 'CFItemType' => 'Element'],
            ],
            'CFAssociations' => [
                ['associationType' => 'isChildOf', 'sequenceNumber' => 2, 'originNodeURI' => ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000002'], 'destinationNodeURI' => ['identifier' => $doc]],
                ['associationType' => 'isChildOf', 'sequenceNumber' => 1, 'originNodeURI' => ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000001'], 'destinationNodeURI' => ['identifier' => $doc]],
                ['associationType' => 'isChildOf', 'sequenceNumber' => 1, 'originNodeURI' => ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000003'], 'destinationNodeURI' => ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000001']],
                ['associationType' => 'isRelatedTo', 'originNodeURI' => ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000002'], 'destinationNodeURI' => ['identifier' => 'bbbbbbbb-0000-4000-8000-000000000001', 'uri' => 'https://case.example.org/uri/1']],
            ]];
        $pkg = CasePackage::fromCfPackage($cf, 'US-GA');
        $this->assertSame(['S.1', 'S.1.a', 'S.2'], array_column($pkg['items'], 'code'));
        $this->assertSame(['GRADE:01', 'GRADE:02'], $pkg['items'][0]['levels']);
        $this->importOne($pkg);
        $this->assertSame($doc, Sql::scalar($this->pdo, 'SELECT uuid FROM standard_documents'));
        $this->assertSame('bbbbbbbb-0000-4000-8000-000000000003', Sql::scalar($this->pdo, "SELECT uuid FROM standard_items WHERE code = 'S.1.a'"));
        $this->assertSame(1, (int) Sql::scalar($this->pdo, 'SELECT COUNT(*) FROM standard_associations WHERE destination_item_id IS NOT NULL'));
        $this->assertSame('science', Sql::scalar($this->pdo, 'SELECT s.slug FROM standard_frameworks f JOIN standard_subjects s ON s.id = f.subject_id'));
    }

    public function test_csp_sets_become_one_document_with_crosswalks(): void
    {
        $set = fn ($id, $grade) => ['id' => $id, 'title' => "Grade $grade - Mathematics (2005)", 'subject' => '[Archived] Ontario Standards',
            'educationLevels' => [sprintf('%02d', $grade)], 'document' => ['id' => 'D1', 'title' => 'The Ontario Curriculum: Mathematics', 'valid' => '2005'],
            'license' => ['title' => 'CC BY 3.0 US', 'URL' => 'http://creativecommons.org/licenses/by/3.0/us/', 'rightsHolder' => 'D2L Corporation'],
            'jurisdiction' => ['title' => 'Ontario'],
            'standards' => [
                "P$id" => ['id' => "P$id", 'position' => 1, 'depth' => 0, 'description' => 'Number sense', 'statementLabel' => 'Strand'],
                "C$id" => ['id' => "C$id", 'position' => 2, 'depth' => 1, 'parentId' => "P$id", 'description' => 'read numbers <b>to 1000</b>',
                    'statementLabel' => 'Specific Expectation', 'exactMatch' => ['http://corestandards.org/Math/Content/2/NBT/A/3']],
            ]];
        $csp = new CommonStandardsProject(sys_get_temp_dir());
        $pkg = $csp->package('CA-ON', 'en', 'ON', 'doc:D1', [$set('S3', 3), $set('S2', 2)]);
        $this->assertSame('archived', $pkg['document']['status']);
        $this->assertSame('ca-on-mathematics', $pkg['framework']['slug']);
        $this->assertSame('set:S2', $pkg['items'][0]['key'], 'grade 2 first');
        $this->assertSame('read numbers to 1000', $pkg['items'][2]['statement']);
        $this->assertSame('expectation', $pkg['items'][2]['item_type']);
        $this->assertSame('exactMatchOf', $pkg['associations'][0]['type']);
        $this->importOne($pkg);
        $this->assertSame(6, (int) Sql::scalar($this->pdo, 'SELECT item_count FROM standard_documents'));
    }

    public function test_uk_parsers(): void
    {
        $uk = new UnitedKingdom(sys_get_temp_dir());
        $html = '<html><body><div class="govspeak"><h2>Year 3 programme of study</h2><h3>Number - fractions</h3><p>Pupils should be taught to:</p>
            <ul><li>count up and down in tenths<ul><li>by tenths</li></ul></li><li>compare fractions</li></ul>
            <h4>Notes and guidance (non-statutory)</h4><ul><li>Pupils use fractions as numbers.</li></ul>
            <h2>Key stage 3</h2><h3>Subject content</h3><ul><li>use standard index form</li></ul><h2>Is this page useful?</h2><ul><li>no</li></ul></div></body></html>';
        $p = $uk->englandPackage('Mathematics', 'https://example', $html);
        $byText = collect($p['items'])->keyBy('statement');
        $this->assertSame(['GB-ENG:Y3'], $byText['compare fractions']['levels']);
        $this->assertTrue($byText['compare fractions']['is_statutory']);
        $this->assertFalse($byText['Pupils use fractions as numbers.']['is_statutory']);
        $this->assertSame($byText['count up and down in tenths']['key'], $byText['by tenths']['parent']);
        $this->assertSame(['GB-ENG:Y7', 'GB-ENG:Y8', 'GB-ENG:Y9'], $byText['use standard index form']['levels']);
        $this->assertArrayNotHasKey('no', $byText->all());

        $c = \App\Qbl\Standards\Sources\Rtf::CELL;
        $r = \App\Qbl\Standards\Sources\Rtf::ROW;
        $text = "Intro mentions MNU 0-11a in passing.\n\nNumber, money and measure{$c}{$r}{$c}Early{$c}First{$c}{$r}Estimation and rounding{$c}I explore size.\nMNU 0-01a{$c}I estimate.\nMNU 1-01a{$c}{$r}"
            . "Money{$c}I can share.\nHWB 0-01a / HWB 1-01a{$c}{$r}";
        $pk = collect($uk->scotlandPackages($text, 'x'))->keyBy(fn ($p) => $p['document']['source_key']);
        $mnu = collect($pk['cfe-eo-mnu']['items'])->keyBy('key');
        $this->assertSame('I estimate.', $mnu['MNU 1-01a']['statement']);
        $this->assertSame(['GB-SCT:first'], $mnu['MNU 1-01a']['levels']);
        $this->assertArrayNotHasKey('MNU 0-11a', $mnu->all());
        $hwb = collect($pk['cfe-eo-hwb']['items'])->where('item_type', 'outcome');
        $this->assertSame(['HWB 0-01a', 'HWB 1-01a'], $hwb->pluck('code')->all());
    }

    private function ccssAndTexas(): void
    {
        $ccss = fn ($subject, $code, $text, $grade, $key) => [
            'source' => ['slug' => 'csp', 'name' => 'CSP', 'kind' => 'api'], 'jurisdiction' => 'US-CCSS',
            'framework' => ['slug' => "us-ccss-$subject", 'title' => "Common Core: $subject", 'subject' => $subject],
            'document' => ['source_key' => "ccss-$subject", 'title' => "CCSS $subject"],
            'items' => [['key' => $key, 'code' => $code, 'statement' => $text, 'levels' => ["GRADE:$grade"]]],
        ];
        $this->importOne($ccss('mathematics', 'CCSS.Math.Content.3.NF.A.2', 'Understand a fraction as a number on the number line.', '03', 'CSP-NF2'));
        $this->importOne($ccss('ela', 'CCSS.ELA-Literacy.RL.3.1', 'Ask and answer questions to show understanding of a text.', '03', 'CSP-RL1'));
        // a state that lists the Common Core under its own name: the same code twice
        $copy = $ccss('mathematics', 'CCSS.Math.Content.3.NF.A.2', 'Understand a fraction as a number on the number line.', '03', 'AL-NF2');
        $copy['jurisdiction'] = 'US-AL';
        $copy['framework']['slug'] = 'us-al-mathematics';
        $copy['document']['source_key'] = 'al-math';
        $this->importOne($copy);
        $tx = $this->package([['key' => 's1', 'code' => '112.5.b.1', 'statement' => 'Plan and conduct simple investigations about pollination.', 'levels' => ['GRADE:03']]],
            ['source_key' => 'teks-sci'], [], 'us-tx-science');
        $tx['framework']['subject'] = 'science';
        $this->importOne($tx);
    }

    public function test_frameworks_are_chosen_by_jurisdiction_subject_slug_shorthand_or_set_name(): void
    {
        $this->ccssAndTexas();
        $this->importOne(StandardsList::package([['code' => 'OWN-1', 'description' => 'Pollinators move pollen.', 'grades' => ['3']]], 'OUR-SCI'));
        $m = new MissionStandards($this->pdo);
        $slugs = fn (array $sel) => array_column(Sql::rows($this->pdo, 'SELECT slug FROM standard_frameworks WHERE id IN (' . implode(',', $m->frameworkIds($sel) ?: [0]) . ') ORDER BY slug'), 'slug');
        $this->assertSame(['us-ccss-mathematics'], $slugs(['CCSS-MATH']));
        $this->assertSame(['us-ccss-ela', 'us-ccss-mathematics'], $slugs(['CCSS']));
        $this->assertSame(['us-tx-science'], $slugs(['US-TX:science']));
        $this->assertSame(['us-tx-science'], $slugs(['us-tx-science']));
        $this->assertSame(['qbl-our-sci'], $slugs(['our-sci']));
        $this->assertSame(['qbl-our-sci', 'us-ccss-ela', 'us-ccss-mathematics'], $slugs([]), 'by default: the Common Core, NGSS and our own sets');

        $codes = array_column($m->candidates([], '3', 'pollinators moving pollen'), 'code');
        $this->assertSame('OWN-1', $codes[0]);
        $this->assertNotContains('112.5.b.1', $codes, 'Texas only when asked for');
        $this->assertSame(['112.5.b.1'], array_column($m->candidates(['US-TX'], '3', 'pollination'), 'code'));
        $this->assertSame([], $m->candidates(['CCSS-MATH'], '7', 'fractions'), 'the grade is kept to');

        // a named code is found anywhere, the Common Core's own item ahead of a state's copy
        $found = $m->byCodes(['ccss.math.content.3.nf.a.2']);
        $this->assertSame('US-CCSS', $found[0]['jurisdiction']);
        $this->assertSame('ccss.math.content.3.nf.a.2', $found[0]['code'], 'in the form asked for');

        $m->attach(7, [['standard_id' => $found[0]['id'], 'alignment' => 'supporting', 'rationale' => 'Fractions on the bridge.', 'evidence' => ['q_bridge']]]);
        $row = $m->forScenario(7)[0];
        $this->assertSame(['US-CCSS', 'ccss.math.content.3.nf.a.2', 'supporting', 'Fractions on the bridge.'],
            [$row['framework'], strtolower($row['code']), $row['alignment'], $row['rationale']]);
        $this->assertStringContainsString('q_bridge', $row['evidence']);
        $m->attach(7, []);
        $this->assertSame([], $m->forScenario(7), 'attaching again replaces');
        $own = $m->byCodes(['OWN-1']);
        $m->attach(8, [['standard_id' => $own[0]['id']]]);
        $this->assertSame('OUR-SCI', $m->forScenario(8)[0]['framework'], 'an imported set shows by its name');
    }

    public function test_the_old_curriculum_standards_move_into_the_library_without_losing_an_alignment(): void
    {
        $this->ccssAndTexas();
        // the old tables as they were (temporary: on MariaDB a real CREATE TABLE would commit the test's transaction)
        $this->pdo->exec('CREATE TEMPORARY TABLE curriculum_standards (id INTEGER PRIMARY KEY, framework VARCHAR(64), jurisdiction VARCHAR(128), subject VARCHAR(128),
            code VARCHAR(128), grade_levels TEXT, description TEXT, source VARCHAR(32), source_id VARCHAR(191), parent_source_id VARCHAR(191), depth INTEGER,
            created_at DATETIME NULL, updated_at DATETIME NULL)');
        $this->pdo->exec('CREATE TEMPORARY TABLE scenario_standards (id INTEGER PRIMARY KEY, scenario_id INTEGER, curriculum_standard_id INTEGER,
            alignment VARCHAR(16), rationale TEXT, evidence TEXT, created_at DATETIME NULL, updated_at DATETIME NULL)');
        $ins = $this->pdo->prepare('INSERT INTO curriculum_standards (id, framework, jurisdiction, subject, code, grade_levels, description, source, source_id, parent_source_id, depth) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
        $ins->execute([1, 'TX-TEKS-SCI', 'Texas', 'Science', '112.5.b.1', '["03"]', 'Plan and conduct...', 'csp', 'csp:s1', null, 0]);         // not a CSP key we have: by code
        $ins->execute([2, 'CCSS-MATH', null, 'Math', 'CCSS.Math.Content.3.NF.A.2', '["03"]', 'Understand...', 'file', 'CCSS-MATH:x', null, 0]); // CCSS beats Alabama's copy
        $ins->execute([3, 'OUR-SCI', 'Our district', 'Science', 'OUR-3-1', '["03"]', 'Bees and orchards.', 'file', 'OUR-SCI:OUR-3-1', null, 0]); // nowhere: kept
        $ins->execute([4, 'OUR-SCI', 'Our district', 'Science', 'OUR-3-1a', '["03"]', 'Name three pollinators.', 'file', 'OUR-SCI:OUR-3-1a', 'OUR-SCI:OUR-3-1', 1]);
        $a = $this->pdo->prepare('INSERT INTO scenario_standards (id, scenario_id, curriculum_standard_id, alignment, rationale, evidence, created_at) VALUES (?,?,?,?,?,?,?)');
        $a->execute([1, 11, 1, 'primary', 'The orchard.', '["q_pollen"]', '2026-11-20 10:00:00']);
        $a->execute([2, 11, 2, 'supporting', 'The bridge.', '[]', '2026-11-20 10:00:00']);
        $a->execute([3, 12, 4, 'primary', 'Bees.', '["talk_pip"]', '2026-11-21 10:00:00']);

        $result = LegacyStandards::migrate($this->pdo);
        $this->assertSame(['standards' => 4, 'matched' => 2, 'imported' => 2, 'alignments' => 3], $result);
        $m = new MissionStandards($this->pdo);
        $s11 = collect($m->forScenario(11))->keyBy('code');
        $this->assertSame('US-TX', $s11['112.5.b.1']['framework']);
        $this->assertSame('US-CCSS', $s11['CCSS.Math.Content.3.NF.A.2']['framework']);
        $this->assertSame('The orchard.', $s11['112.5.b.1']['rationale']);
        $this->assertSame('["q_pollen"]', $s11['112.5.b.1']['evidence']);
        $kept = $m->forScenario(12)[0];
        $this->assertSame(['OUR-SCI', 'OUR-3-1a', 'primary'], [$kept['framework'], $kept['code'], $kept['alignment']]);
        $child = Sql::row($this->pdo, "SELECT * FROM standard_items WHERE code = 'OUR-3-1a'");
        $this->assertSame('OUR-3-1', Sql::scalar($this->pdo, 'SELECT code FROM standard_items WHERE id = ?', [$child['parent_id']]), 'the tree is kept');
        $this->assertSame(1, (int) Sql::scalar($this->pdo, "SELECT COUNT(*) FROM standard_frameworks WHERE slug = 'qbl-our-sci'"));
        $this->assertSame($m->frameworkIds(['OUR-SCI']), $m->frameworkIds(['qbl-our-sci']), 'the generator still finds it by its old name');

        // later the district's standards arrive in the library proper: relink moves the alignment over
        $district = $this->package([['key' => 'd1', 'code' => 'OUR-3-1a', 'statement' => 'Name three pollinators.', 'levels' => ['GRADE:03']]], ['source_key' => 'district'], [], 'us-tx-district-science');
        $this->importOne($district);
        $this->assertSame(1, LegacyStandards::relink($this->pdo));
        $this->assertSame('US-TX', $m->forScenario(12)[0]['framework']);
        $this->assertSame(0, LegacyStandards::relink($this->pdo), 'and only once');
    }
}
