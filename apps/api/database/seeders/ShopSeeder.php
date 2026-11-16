<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * The platform's marketplace catalogue (data/shop.php). Each item is added once, by id, so prices
 * and names changed since by an admin are kept, and items players already own are never touched.
 */
class ShopSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();
        $added = 0;
        foreach (require __DIR__.'/data/shop.php' as $sequence => $item) {
            if (DB::table('shop_items')->where('id', $item['id'])->exists()) {
                continue;
            }
            DB::table('shop_items')->insert(['settings' => json_encode($item['settings'] ?? []), 'scenario_id' => null, 'active' => true, 'sequence' => $sequence + 1, 'created_at' => $now, 'updated_at' => $now] + $item);
            $added++;
        }
        $this->command?->info("Marketplace: $added platform items added.");
    }
}
