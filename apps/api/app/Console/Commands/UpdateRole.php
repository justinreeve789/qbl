<?php


namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

class UpdateRole extends Command
{
    protected $signature = 'qbl:update-role {email} {--role=student : student, teacher or admin}';
    protected $description = 'Update user\'s role';

    public function handle(): int
    {
        $user = User::get(['email' => $this->argument('email')])->first();
        if (!$user) {
            return self::FAILURE;
        } if (in_aray($this->option('role'), [User::ROLE_ADMIN, User::ROLE_STUDENT, User::ROLE_TEACHER])) {
        $user = User::update([
            'email' => $this->argument('email')
        ], [
            'role' => $this->option('role')
        ]}

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
