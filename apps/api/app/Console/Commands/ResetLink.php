<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Password;

/**
 * A link for choosing a new password, printed here instead of emailed: for helping someone who
 * forgot theirs when the site has no mail server set up, or their email does not arrive.
 *
 *   php artisan qbl:reset-link student@school.org
 *
 * Give the link to that person only: whoever opens it can set the account's password. It works
 * once, for the time in config/auth.php (60 minutes), and replaces any link emailed before.
 */
class ResetLink extends Command
{
    protected $signature = 'qbl:reset-link {email}';

    protected $description = 'Print a one-time link for choosing a new password (instead of emailing it)';

    public function handle(): int
    {
        $email = trim((string) $this->argument('email'));
        $user = User::where('email', $email)->first() ?? User::where('email', strtolower($email))->first();
        if (! $user || ! $user->hasRealEmail()) {
            $this->error("There is no account for {$email}.");

            return self::FAILURE;
        }
        if (! $user->hasPassword()) {
            $this->error($user->google_id
                ? "{$user->email} signs in with Google and has no password here. They sign in with Google (and their school resets that one)."
                : "{$user->email} has no password to reset.");

            return self::FAILURE;
        }

        $token = Password::broker()->createToken($user);
        $minutes = (int) config('auth.passwords.'.config('auth.defaults.passwords').'.expire', 60);
        $this->info("Link for {$user->name} ({$user->email}), for the next {$minutes} minutes:");
        $this->line(rtrim((string) config('app.url'), '/').'/missions#'.http_build_query(['reset-password' => $token, 'email' => $user->email], '', '&', PHP_QUERY_RFC3986));

        return self::SUCCESS;
    }
}
