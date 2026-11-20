<?php

namespace Database\Seeders;

use App\Qbl\Avatars;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * The platform's avatars (data/avatars.php), and the platform pictures they are drawn from.
 * Each avatar is added once, by id, so changes made since are kept and nobody's chosen avatar
 * is touched (see Avatars::seed).
 */
class AvatarSeeder extends Seeder
{
    public function run(): void
    {
        $added = Avatars::seed(DB::connection()->getPdo(), require __DIR__.'/data/avatars.php');
        $this->command?->info("Avatars: $added added.");
    }
}
