<?php

namespace Database\Seeders;

use App\Qbl\ScenarioArchive;
use App\Qbl\ScenarioStore;
use Illuminate\Database\Seeder;

/**
 * Adds the scenarios shipped with the application, one ZIP each in database/seeders/scenarios
 * (Starship Explorer, the demo, is starship-explorer.zip), and publishes them so they can be
 * played straight away. A ZIP is the same file the editor's "Export as ZIP" makes.
 *
 * Each is imported through ScenarioArchive, keeping the code and ids it was exported with. From
 * then on it can be edited like any other scenario, so seeding again leaves it alone.
 * `php artisan qbl:seed --reset` puts the shipped version back.
 */
class ShippedScenarioSeeder extends Seeder
{
    public function run(ScenarioArchive $archive, ScenarioStore $store): void
    {
        foreach (ScenarioArchive::shipped() as $zip) {
            $id = $archive->seed($zip, config('qbl.seed') === 'reset');
            if ($id === null) {
                $this->command?->info(basename($zip).' is already in the database and was left as it is. Run "php artisan qbl:seed --reset" to restore the shipped version.');

                continue;
            }
            $document = $store->publish($id);
            $this->command?->info(sprintf('Published "%s" at /%s: %d scenes, %d assets.', $document['title'], $document['code'], count($document['scenes']), count($document['assets'])));
        }
    }
}
