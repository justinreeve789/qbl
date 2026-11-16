<?php

namespace Database\Seeders;

use App\Qbl\ScenarioStore;
use Illuminate\Database\Seeder;

/**
 * Seeds the "Starship Explorer" mission and publishes it, so the game is playable straight away.
 *
 * The rows in data/starship.php go into the same tables the editor writes to, through the same
 * store, and the JSON players get is generated from those tables. From then on the mission can be
 * edited like any other, so seeding again leaves it alone. QBL_SEED=reset puts the shipped version back.
 */
class StarshipSeeder extends Seeder
{
    public function run(ScenarioStore $store): void
    {
        $id = $store->seedScenario(require __DIR__.'/data/starship.php', config('qbl.seed') === 'reset');
        if ($id === null) {
            $this->command?->info('Starship Explorer is already in the database and was left as it is. Set QBL_SEED=reset to restore the shipped version.');

            return;
        }
        $document = $store->publish($id);

        $this->command?->info(sprintf('Published "%s" at /%s: %d scenes, %d assets.', $document['title'], $document['code'], count($document['scenes']), count($document['assets'])));
    }
}
