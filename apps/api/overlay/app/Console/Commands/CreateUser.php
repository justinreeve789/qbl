<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class CreateUser extends Command
{
    protected $signature = 'qbl:user {email} {name} {--role=student : student, teacher or admin}';

    protected $description = 'Create a QBL user and prompt for a password';

    public function handle(): int
    {
        $password = $this->secret('Password');

        if (strlen((string) $password) < 8) {
            $this->error('Use at least 8 characters.');

            return self::FAILURE;
        }

        $user = User::create([
            'email' => $this->argument('email'),
            'name' => $this->argument('name'),
            'role' => $this->option('role'),
            'password' => $password,
        ]);

        $this->info("Created user {$user->id}.");

        return self::SUCCESS;
    }
}
