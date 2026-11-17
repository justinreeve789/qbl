<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * The platform's avatars (data/avatars.php). Each is added once, by id, so changes made since
 * are kept and nobody's chosen avatar is touched.
 */
class AvatarSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();
        $added = 0;
        foreach (require __DIR__.'/data/avatars.php' as $sequence => $avatar) {
            if (DB::table('avatars')->where('id', $avatar['id'])->exists()) {
                continue;
            }
            DB::table('avatars')->insert(['settings' => json_encode($avatar['settings'] ?? []), 'active' => true, 'sequence' => $sequence + 1, 'created_at' => $now, 'updated_at' => $now] + $avatar);
            $added++;
        }
        $this->command?->info("Avatars: $added added.");
    }
}
