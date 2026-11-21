<?php

namespace App\Console\Commands;

use App\Models\Scenario;
use App\Qbl\Library\AssetLibrary;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;
use Illuminate\Console\Command;

/**
 * The asset library from the command line:
 *
 *   php artisan qbl:library                         list everything (--kind=vehicle, --q=horse)
 *   php artisan qbl:library show bay-horse          one asset, its definition and files
 *   php artisan qbl:library import [--refresh]      add the shipped pack's assets (scenarios/assets/library); --refresh updates them too
 *   php artisan qbl:library add bay-horse --to=12   add an asset to scenario 12 (id, code or shortname)
 *   php artisan qbl:library keep --to=12 --table=characters --row=40 [--name=] [--category=]
 *                                                    keep a scenario's character, item or media in the library
 *   php artisan qbl:library withdraw bay-horse      hide it from the editor (restore with: restore bay-horse)
 */
class LibraryCommand extends Command
{
    protected $signature = 'qbl:library
        {action=list : list, show, import, add, keep, withdraw or restore}
        {asset? : An asset id or slug (show, add, withdraw, restore)}
        {--kind= : list: only this kind (character, vehicle, item, picture, sound)}
        {--q= : list: only assets with these words}
        {--refresh : import: also bring assets already added up to date with the pack}
        {--to= : add, keep: the scenario (id, code or shortname)}
        {--name= : add: the new row\'s name; keep: the asset\'s name}
        {--table= : keep: characters, items or media}
        {--row= : keep: the row\'s id}
        {--category= : keep: the asset\'s category}';

    protected $description = 'List, import, add and keep assets of the library (ready-made characters, vehicles and more)';

    public function handle(AssetLibrary $library, ScenarioStore $store): int
    {
        try {
            return match ($this->argument('action')) {
                'list' => $this->list($library),
                'show' => $this->show($library),
                'import' => $this->import($library),
                'add' => $this->add($library, $store),
                'keep' => $this->keep($library, $store),
                'withdraw', 'restore' => $this->activate($library, $this->argument('action') === 'restore'),
                default => $this->fail('Unknown action. Use list, show, import, add, keep, withdraw or restore.'),
            };
        } catch (StoreError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
    }

    private function list(AssetLibrary $library): int
    {
        $assets = $library->all(['kind' => $this->option('kind') ? explode(',', $this->option('kind')) : null, 'q' => $this->option('q'), 'inactive' => true]);
        $this->table(['id', 'slug', 'kind', 'name', 'category', 'files', 'licence', 'active'], array_map(fn ($a) => [
            $a['id'], $a['slug'], $a['kind'], $a['name'], $a['category'], implode(', ', array_column($a['files'], 'role')), $a['credit']['license'] ?? '', $a['active'] ? 'yes' : 'no',
        ], $assets));

        return self::SUCCESS;
    }

    private function show(AssetLibrary $library): int
    {
        $this->line(json_encode($library->get((string) $this->argument('asset')), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

        return self::SUCCESS;
    }

    private function import(AssetLibrary $library): int
    {
        $counts = $library->importPack(null, (bool) $this->option('refresh'));
        $this->info("Library: {$counts['added']} added, {$counts['updated']} updated, {$counts['kept']} left as they were.");

        return self::SUCCESS;
    }

    private function add(AssetLibrary $library, ScenarioStore $store): int
    {
        $scenario = $this->scenario();
        $result = $library->addToScenario($store, $scenario->id, (string) $this->argument('asset'), array_filter(['name' => $this->option('name')]));
        $made = $result['created'] ? "{$result['created']['table']} #{$result['created']['row']['id']} “{$result['created']['row']['name']}”" : 'its media';
        $this->info("Added “{$result['asset']['name']}” to “{$scenario->title}”: $made, ".count($result['copied']).' new media file(s).');

        return self::SUCCESS;
    }

    private function keep(AssetLibrary $library, ScenarioStore $store): int
    {
        $scenario = $this->scenario();
        $asset = $library->capture($store, $scenario->id, (string) $this->option('table'), (int) $this->option('row'), array_filter(['name' => $this->option('name'), 'category' => $this->option('category')]));
        $this->info("Kept as “{$asset['slug']}” ({$asset['kind']}, ".count($asset['files']).' file(s)).');

        return self::SUCCESS;
    }

    private function activate(AssetLibrary $library, bool $active): int
    {
        $asset = $library->get((string) $this->argument('asset'));
        $library->save(['id' => $asset['id'], 'active' => $active]);
        $this->info($active ? "“{$asset['name']}” is back in the library." : "“{$asset['name']}” is withdrawn: the editor no longer offers it. Scenarios that added it keep their copies.");

        return self::SUCCESS;
    }

    private function scenario(): Scenario
    {
        $key = (string) $this->option('to');
        $scenario = ctype_digit($key) ? Scenario::find((int) $key) : Scenario::where('code', strtolower($key))->orWhere('shortname', $key)->first();

        return $scenario ?? throw new StoreError(404, 'No such scenario (give --to=<id, code or shortname>).');
    }
}
