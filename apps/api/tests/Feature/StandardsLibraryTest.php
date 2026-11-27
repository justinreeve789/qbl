<?php

namespace Tests\Feature;

use App\Qbl\Standards\Sql;
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
}
