<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * Seeding is never done automatically: starting the containers migrates the database and
 * nothing else. This command is the one to run by hand.
 */
class SeedDemo extends Command
{
    protected $signature = 'qbl:seed
        {--reset : Put the shipped scenarios (Starship Explorer) back, replacing any edits made to them}
        {--password= : Also create teacher@qbl.test, student1@qbl.test and student2@qbl.test with this password}';

    protected $description = 'Seed the avatars, the marketplace catalogue, the asset library and the shipped scenarios (the Starship Explorer demo)';

    public function handle(): int
    {
        if ($this->option('reset')) {
            config(['qbl.seed' => 'reset']);
        }
        if ($this->option('password')) {
            config(['qbl.seed_password' => $this->option('password')]);
        }

        // --force: this is meant to be run on a live installation, by someone who chose to.
        return $this->call('db:seed', ['--force' => true]);
    }
}
