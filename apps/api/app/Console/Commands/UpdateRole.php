<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;

/**
 * Change what an existing account may do. The role alone decides who may use the editor,
 * Classes and reports (teachers and admins). Google sign-in always makes students, so this is
 * how such an account becomes a teacher:
 *
 *   php artisan qbl:update-role teacher@school.org --role=teacher
 *   php artisan qbl:update-role teacher@school.org            (only shows the current role)
 *
 * The new role applies from the account's next request: there is no need to sign in again,
 * though a page that is already open has to be reloaded.
 */
class UpdateRole extends Command
{
    protected $signature = 'qbl:update-role {email} {--role= : student, teacher or admin}';

    protected $description = 'Show or change the role of an existing user (student, teacher or admin)';

    private const ROLES = [User::ROLE_STUDENT, User::ROLE_TEACHER, User::ROLE_ADMIN];

    public function handle(): int
    {
        $email = trim((string) $this->argument('email'));
        $user = User::where('email', $email)->first();

        if (! $user) {
            $this->error("There is no account for {$email}. It is made the first time that person signs in, or with qbl:user.");

            return self::FAILURE;
        }

        // Guests are throwaway accounts with made-up addresses; they cannot be given a role.
        if ($user->role === 'guest') {
            $this->error("{$email} is a guest account and cannot be given a role.");

            return self::FAILURE;
        }

        $role = $this->option('role');
        if ($role === null || $role === '') {
            $this->line("{$user->name} <{$user->email}> is a {$user->role}.");

            return self::SUCCESS;
        }

        $role = strtolower(trim((string) $role));
        if (! in_array($role, self::ROLES, true)) {
            $this->error('The role must be one of: '.implode(', ', self::ROLES).'.');

            return self::FAILURE;
        }

        if ($user->role === $role) {
            $this->info("{$user->email} is already a {$role}.");

            return self::SUCCESS;
        }

        $was = $user->role;
        $user->forceFill(['role' => $role])->save();
        $this->info("{$user->email} was a {$was} and is now a {$role}.");
        // Anyone can create an account with any address on the sign-in screen.
        if ($user->hasUnprovenAddress() && $role !== User::ROLE_STUDENT) {
            $this->warn("This account was created on the sign-in screen, and nobody has checked that {$user->email} belongs to whoever created it. Make sure it is the person you mean (signing in once with Google would prove it).");
        }

        return self::SUCCESS;
    }
}
