<?php

namespace App\Console\Commands;

use App\Qbl\Standards\Sql;
use App\Qbl\Standards\Importer;
use App\Qbl\Standards\Reference;
use App\Qbl\Standards\Sources\CasePackage;
use App\Qbl\Standards\Sources\CommonStandardsProject;
use App\Qbl\Standards\Sources\UnitedKingdom;
use App\Qbl\Standards\StandardsStore;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * php artisan qbl:standards-library seed
 * php artisan qbl:standards-library csp [--jurisdiction=US-TX --jurisdiction=CA-ON] [--refresh] [--cache=DIR]
 * php artisan qbl:standards-library uk [--nation=GB-ENG] [--refresh] [--cache=DIR]
 * php artisan qbl:standards-library case <CFPackage URL or file> --jurisdiction=US-GA [--framework-slug=]
 * php artisan qbl:standards-library file <package.json>
 * php artisan qbl:standards-library status
 * php artisan qbl:standards-library search "<words>" [--jurisdiction=] [--grade=3] [--subject=mathematics]
 * php artisan qbl:standards-library history <uuid or code>
 * php artisan qbl:standards-library all   (seed, then every source)
 */
class StandardsLibrary extends Command
{
    protected $signature = 'qbl:standards-library {action : seed|csp|uk|case|file|all|status|search|history} {target? : URL, file, words, uuid or code}
        {--jurisdiction=* : jurisdiction codes, e.g. US-TX, CA-ON (csp, search) or the one jurisdiction (case)}
        {--nation=* : GB-ENG, GB-SCT, GB-WLS, GB-NIR (uk)}
        {--framework-slug= : framework slug for a CASE package}
        {--refresh : download again instead of using the cache}
        {--cache= : cache directory (default storage/app/standards)}
        {--api-key= : Common Standards Project API key, if required}
        {--grade= : US-grade equivalent to search at (K=0)}
        {--subject= : subject slug to search in}
        {--limit=20 : search results}
        {--bulk : first big load on MariaDB: drop the full-text index during the load and rebuild it after (much faster)}';

    protected $description = 'Standards library: import and look up the standards of every US state, the Common Core, NGSS, Canada and the UK';

    public function handle(): int
    {
        $pdo = DB::connection()->getPdo();
        $cache = $this->option('cache') ?: config('qbl.standards_cache', storage_path('app/standards'));
        $say = fn (string $l) => $this->line($l);

        $bulk = $this->option('bulk') && Sql::isMysql($pdo) && in_array($this->argument('action'), ['csp', 'uk', 'all'], true)
            && Sql::scalar($pdo, "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'standard_items' AND index_name = 'standard_items_fulltext'");
        if ($bulk) {
            $this->line('Dropping the full-text index for the load...');
            $pdo->exec('ALTER TABLE standard_items DROP INDEX standard_items_fulltext');
        }
        try {
            return $this->dispatch($pdo, $cache, $say);
        } finally {
            if ($bulk) {
                $this->line('Rebuilding the full-text index...');
                // rebuild the table first: re-adding a FULLTEXT index to a table that still has InnoDB's
                // hidden FTS_DOC_ID column from the dropped one leaves most rows out of the new index
                $pdo->exec('ALTER TABLE standard_items FORCE');
                $pdo->exec('ALTER TABLE standard_items ADD FULLTEXT standard_items_fulltext (statement)');
            }
        }
    }

    private function dispatch(\PDO $pdo, string $cache, \Closure $say): int
    {
        return match ($this->argument('action')) {
            'seed' => $this->seed($pdo),
            'csp' => $this->csp($pdo, $cache, $say),
            'uk' => $this->uk($pdo, $cache, $say),
            'case' => $this->case($pdo),
            'file' => $this->file($pdo),
            'all' => max($this->seed($pdo), $this->csp($pdo, $cache, $say), $this->uk($pdo, $cache, $say)),
            'status' => $this->status($pdo),
            'search' => $this->search($pdo),
            'history' => $this->history($pdo),
            default => $this->fail('Unknown action') ?? 1,
        };
    }

    private function seed(\PDO $pdo): int
    {
        Reference::seed($pdo);
        $this->info('Reference data seeded (jurisdictions, subjects, education levels).');

        return 0;
    }

    private function csp(\PDO $pdo, string $cache, \Closure $say): int
    {
        Reference::seed($pdo);
        $csp = new CommonStandardsProject("$cache/csp", (bool) $this->option('refresh'), $this->option('api-key'), $say);
        $wanted = $this->option('jurisdiction');
        $byCode = CommonStandardsProject::byCode();
        $codes = $wanted ?: array_keys($byCode);
        $importer = new Importer($pdo);
        $run = $importer->startRun(CommonStandardsProject::SOURCE, $wanted ? implode(',', $wanted) : 'all', ['refresh' => (bool) $this->option('refresh')]);
        $failed = 0;
        foreach ($codes as $code) {
            if (! isset($byCode[$code])) {
                $this->warn("$code: not in the Common Standards Project mapping");
                continue;
            }
            $seen = [];
            $tally = ['added' => 0, 'changed' => 0, 'unchanged' => 0];
            try {
                foreach ($byCode[$code] as $cspId) {
                    foreach ($csp->packages($cspId) as $package) {
                        [$result, $docId] = $importer->import($package, $run);
                        $seen[] = $docId;
                        $tally[$result]++;
                    }
                }
                $withdrawn = $importer->withdrawMissing($run, CommonStandardsProject::SOURCE, $code, $seen);
                $this->line(sprintf('%-8s %4d documents: %d new, %d changed, %d unchanged%s', $code, count($seen), $tally['added'], $tally['changed'], $tally['unchanged'], $withdrawn ? ", $withdrawn withdrawn" : ''));
            } catch (Throwable $e) {
                $failed++;
                $this->error("$code: " . $e->getMessage());
            }
        }
        $stats = $importer->finishRun($run, $failed ? 'partial' : 'ok');
        $this->info('Done: ' . json_encode($stats));

        return $failed ? 1 : 0;
    }

    private function uk(\PDO $pdo, string $cache, \Closure $say): int
    {
        Reference::seed($pdo);
        $uk = new UnitedKingdom("$cache/uk", (bool) $this->option('refresh'), $say);
        $nations = $this->option('nation') ?: array_keys(UnitedKingdom::NATIONS);
        $failed = 0;
        foreach ($nations as $nation) {
            $importer = new Importer($pdo);
            $source = UnitedKingdom::NATIONS[$nation]['source'] ?? null;
            if (! $source) {
                $this->warn("$nation: unknown nation");
                continue;
            }
            $run = $importer->startRun($source, $nation);
            try {
                $seen = [];
                foreach ($uk->packages($nation) as $package) {
                    [$result, $docId] = $importer->import($package, $run);
                    $seen[] = $docId;
                    $this->line(sprintf('%-7s %-9s %s', $nation, $result, $package['document']['title']));
                }
                $importer->withdrawMissing($run, $source, $nation, $seen);
                $importer->finishRun($run);
            } catch (Throwable $e) {
                $failed++;
                $importer->finishRun($run, 'failed', $e->getMessage());
                $this->error("$nation: " . $e->getMessage());
            }
        }

        return $failed ? 1 : 0;
    }

    private function case(\PDO $pdo): int
    {
        $target = $this->argument('target') ?? $this->fail('Give a CFPackage URL or file');
        $jurisdiction = $this->option('jurisdiction')[0] ?? $this->fail('Give --jurisdiction=CODE');
        Reference::seed($pdo);
        $package = CasePackage::fromCfPackage(CasePackage::load($target), $jurisdiction, $this->option('framework-slug'), $target);
        $importer = new Importer($pdo);
        $run = $importer->startRun($package['source'], $target);
        [$result] = $importer->import($package, $run);
        $this->info("$result: {$package['document']['title']} " . json_encode($importer->finishRun($run)));

        return 0;
    }

    private function file(\PDO $pdo): int
    {
        $path = $this->argument('target') ?? $this->fail('Give a package JSON file');
        $data = json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
        $packages = isset($data['items']) ? [$data] : $data;   // one package or a list
        Reference::seed($pdo);
        $importer = new Importer($pdo);
        $run = $importer->startRun($packages[0]['source'], basename($path));
        foreach ($packages as $p) {
            [$result] = $importer->import($p, $run);
            $this->line("$result: {$p['document']['title']}");
        }
        $this->info(json_encode($importer->finishRun($run)));

        return 0;
    }

    private function status(\PDO $pdo): int
    {
        $rows = Sql::rows($pdo, "SELECT j.code, COUNT(DISTINCT f.id) frameworks, COUNT(DISTINCT d.id) documents,
            SUM(CASE WHEN d.status = 'current' THEN 1 ELSE 0 END) current_docs, COALESCE(SUM(d.item_count), 0) items, MAX(d.last_imported_at) imported
            FROM standard_jurisdictions j LEFT JOIN standard_frameworks f ON f.jurisdiction_id = j.id LEFT JOIN standard_documents d ON d.framework_id = f.id
            GROUP BY j.code ORDER BY j.code");
        $this->table(['jurisdiction', 'frameworks', 'documents', 'current', 'items', 'last import'], $rows);
        $runs = Sql::rows($pdo, 'SELECT r.id, s.slug, r.scope, r.status, r.started_at, r.finished_at FROM standard_import_runs r JOIN standard_sources s ON s.id = r.source_id ORDER BY r.id DESC LIMIT 10');
        $this->table(['run', 'source', 'scope', 'status', 'started', 'finished'], $runs);

        return 0;
    }

    private function search(\PDO $pdo): int
    {
        $store = new StandardsStore($pdo);
        $hits = $store->search((string) $this->argument('target'), [
            'jurisdictions' => $this->option('jurisdiction'), 'grade' => $this->option('grade') !== null ? (int) $this->option('grade') : null,
            'subject' => $this->option('subject'), 'limit' => (int) $this->option('limit'),
        ]);
        $this->table(['jurisdiction', 'code', 'levels', 'statement'], array_map(fn ($h) => [
            $h['jurisdiction'], $h['code'] ?? '', $h['levels'], mb_strimwidth($h['statement'], 0, 90, '…'),
        ], $hits));

        return 0;
    }

    private function history(\PDO $pdo): int
    {
        $store = new StandardsStore($pdo);
        $item = $store->find((string) $this->argument('target'), $this->option('jurisdiction')[0] ?? null) ?? $this->fail('No such standard');
        $this->line("{$item['code']}  {$item['statement']}  [{$item['status']}]");
        foreach ($store->history((int) $item['id']) as $h) {
            $this->line(sprintf('  rev %d  %-8s %s  %s', $h['revision'], $h['change_type'], $h['created_at'], $h['fields'] ?? ''));
        }

        return 0;
    }
}
