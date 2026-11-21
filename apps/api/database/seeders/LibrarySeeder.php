<?php

namespace Database\Seeders;

use App\Qbl\Library\AssetLibrary;
use Illuminate\Database\Seeder;

/**
 * The asset library's shipped pack (scenarios/assets/library/library.json): ready-made animals and
 * vehicles. Each asset is added once, by slug, so changes made to it since are kept; `qbl:seed --reset`
 * (or `qbl:library import --refresh`) brings them back in line with the pack.
 */
class LibrarySeeder extends Seeder
{
    public function run(): void
    {
        $counts = app(AssetLibrary::class)->importPack(null, config('qbl.seed') === 'reset');
        $this->command?->info("Library: {$counts['added']} added, {$counts['updated']} updated.");
    }
}
