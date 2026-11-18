<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call(AvatarSeeder::class);
        $this->call(ShopSeeder::class);
        $this->call(ShippedScenarioSeeder::class);

        // Demo accounts are only created when a password is supplied; nothing is seeded with a known password.
        $password = config('qbl.seed_password');
        if ($password) {
            foreach ([['teacher@qbl.test', 'Demo Teacher', 'teacher'], ['student1@qbl.test', 'Demo Student 1', 'student'], ['student2@qbl.test', 'Demo Student 2', 'student']] as [$email, $name, $role]) {
                User::updateOrCreate(['email' => $email], ['name' => $name, 'role' => $role, 'password' => $password]);
            }
            $this->command?->info('Created demo accounts teacher@qbl.test, student1@qbl.test, student2@qbl.test.');
        }
    }
}
