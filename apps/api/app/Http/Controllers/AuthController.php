<?php

namespace App\Http\Controllers;

use App\Models\User;
use App\Notifications\ResetPasswordLink;
use App\Qbl\Api\Privacy;
use Illuminate\Contracts\Auth\PasswordBroker;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Password as Passwords;
use Illuminate\Support\Str;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        // Addresses are stored in lower case by Google sign-in and by registering; older accounts
        // made by hand may not be, so the address exactly as typed is tried first.
        $user = User::where('email', $data['email'])->first() ?? User::where('email', Str::lower($data['email']))->first();

        // An account that has only ever signed in with Google has no password to check.
        if (! $user || $user->role === 'guest' || ! $user->password || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'These credentials do not match our records.']);
        }

        return response()->json([
            'token' => $user->createToken('player')->plainTextToken,
            'user' => $this->own($user),
        ]);
    }

    /**
     * Create an account with a name, an email address and a password, for people who would
     * rather not use Google. It is a student's account, like every new Google account: only an
     * administrator changes a role (qbl:update-role). The address is not checked, so it never
     * joins an account that already exists.
     */
    public function register(Request $request): JsonResponse
    {
        abort_unless(config('qbl.allow_registration'), 403, 'Creating an account is turned off on this site. Ask your teacher how to sign in.');

        $request->merge(['email' => Str::lower(trim((string) $request->input('email')))]);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:60'],
            // Guests' made-up addresses end in @guest.invalid; nobody may take one.
            'email' => ['required', 'string', 'email', 'max:255', 'not_regex:/@guest\.invalid$/'],
            'password' => ['required', 'string', 'confirmed', Password::min(8)],
        ], [
            'name.required' => 'Enter your name.',
            'name.max' => 'Use a name of at most 60 characters.',
            'email.required' => 'Enter your email address.',
            'email.email' => 'That does not look like an email address.',
            'email.not_regex' => 'That does not look like an email address.',
            'password.required' => 'Choose a password.',
            'password.min' => 'Use a password of at least 8 characters.',
            'password.confirmed' => 'The two passwords are not the same.',
        ]);

        $name = Str::limit(trim(strip_tags($data['name'])), 60, '');
        if ($name === '') {
            throw ValidationException::withMessages(['name' => 'Enter your name.']);
        }
        $taken = ValidationException::withMessages(['email' => 'There is already an account with that email address. Sign in instead.']);
        if (User::where('email', $data['email'])->exists()) {
            throw $taken;
        }

        try {
            $user = User::create([
                'name' => $name,
                'email' => $data['email'],
                'password' => $data['password'],
                'role' => User::ROLE_STUDENT,
            ]);
        } catch (UniqueConstraintViolationException) {
            // The same address registered by another request a moment ago.
            throw $taken;
        }
        $user->forceFill(['self_registered_at' => now()])->save();

        return response()->json([
            'token' => $user->createToken('player')->plainTextToken,
            'user' => $this->own($user),
        ], 201);
    }

    public function guest(Request $request): JsonResponse
    {
        abort_unless(config('qbl.allow_guests'), 403, 'Guest access is turned off.');

        $data = $request->validate(['name' => ['required', 'string', 'max:24']]);

        $user = User::create([
            'name' => trim(strip_tags($data['name'])) ?: 'Guest',
            'email' => 'guest-'.Str::uuid().'@guest.invalid',
            'password' => Str::random(40),
            'role' => 'guest',
        ]);

        return response()->json([
            'token' => $user->createToken('guest')->plainTextToken,
            'user' => $user->toQbl(),
        ]);
    }

    /** Signing out ends this token, so a copy of it left in a browser is worth nothing. */
    public function logout(Request $request): JsonResponse
    {
        $request->user()->currentAccessToken()?->delete();

        return response()->json(['ok' => true]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['user' => $this->own($request->user())]);
    }

    /**
     * Change the name over the player's character (and in every list that shows them). The same
     * rules as creating an account, and never contact details: other players see this name. A
     * rostered student's pseudonym is their school's to change.
     */
    public function update(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_if($user->role === 'guest', 403, 'Guests choose a name each time they play. Create an account to keep one.');
        abort_if($user->nameIsLocked(), 403, 'Your school chose the name you play under. Ask your teacher if you would like a different one.');

        $data = $request->validate([
            'name' => ['required', 'string', 'max:200'],
        ], [
            'name.required' => 'Enter a name.',
        ]);
        $name = trim(preg_replace('/\s+/u', ' ', strip_tags($data['name'])) ?? '');
        $problem = match (true) {
            $name === '' => 'Enter a name.',
            mb_strlen($name) > 60 => 'Use a name of at most 60 characters.',
            Privacy::looksLikeEmail($name) || Privacy::looksLikePhone($name) => 'Other players see this name, so leave out email addresses and phone numbers.',
            default => null,
        };
        if ($problem) {
            throw ValidationException::withMessages(['name' => $problem]);
        }
        $user->forceFill(['name' => $name])->save();

        return response()->json(['user' => $this->own($user)]);
    }

    /**
     * Change the password, given the current one. Every other sign-in of the account ends (a
     * phone left signed in, someone who knew the old password); this one stays.
     */
    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();
        if (! $user->hasPassword()) {
            abort(409, $user->google_id ? 'You sign in with Google, so there is no password to change here.' : 'This account has no password to change.');
        }
        $data = $request->validate([
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'confirmed', Password::min(8)],
        ], [
            'current_password.required' => 'Enter your current password.',
            'password.required' => 'Choose a new password.',
            'password.min' => 'Use a password of at least 8 characters.',
            'password.confirmed' => 'The two new passwords are not the same.',
        ]);
        if (! Hash::check($data['current_password'], $user->password)) {
            throw ValidationException::withMessages(['current_password' => 'That is not your current password.']);
        }
        $user->forceFill(['password' => $data['password']])->save();
        $current = $user->currentAccessToken();
        $ended = $user->tokens()->when($current?->getKey(), fn ($q, $id) => $q->whereKeyNot($id))->delete();

        return response()->json(['ok' => true, 'signed_out_elsewhere' => $ended]);
    }

    /**
     * "Forgot your password?": email a link for choosing a new one. The answer is the same whether
     * or not there is such an account, so this cannot be used to find out who has one. Only
     * accounts with a password get a link: one that signs in with Google uses Google's.
     */
    public function forgotPassword(Request $request): JsonResponse
    {
        $data = $request->validate(['email' => ['required', 'string', 'email', 'max:255']], [
            'email.required' => 'Enter your email address.',
            'email.email' => 'That does not look like an email address.',
        ]);
        $answer = response()->json([
            'ok' => true,
            'message' => 'If an account with a password uses that address, a link to choose a new password is on its way. It works for '.$this->resetMinutes().' minutes. Check your spam folder too.',
        ], 202);

        $email = trim($data['email']);
        $user = User::where('email', $email)->first() ?? User::where('email', Str::lower($email))->first();
        if (! $user || ! $user->hasRealEmail() || ! $user->hasPassword()) {
            return $answer;
        }
        $this->broker()->sendResetLink(['email' => $user->email], function (User $user, string $token) {
            $link = $this->resetUrl($user, $token);
            $user->notify(new ResetPasswordLink($link, $this->resetMinutes()));
            if (in_array(config('mail.default'), ['log', 'array'], true)) {
                // No mail server set up: the message is only written to the log, so say where.
                Log::notice("Password reset requested for {$user->email}. Mail is not set up (MAIL_MAILER=".config('mail.default').'), so the link is in this log only: '.$link);
            }
        });
        // Asked again within a minute, the broker sends nothing (auth.passwords.users.throttle): the answer is the same.

        return $answer;
    }

    /**
     * Choose a new password with the link from the email, and be signed in. The account's other
     * sign-ins end. Using the link proves the address, as signing in with Google does.
     */
    public function resetPassword(Request $request): JsonResponse
    {
        $data = $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'string', 'email'],
            'password' => ['required', 'string', 'confirmed', Password::min(8)],
        ], [
            'token.required' => 'This link is not complete. Open the link from the email again.',
            'email.required' => 'This link is not complete. Open the link from the email again.',
            'password.required' => 'Choose a new password.',
            'password.min' => 'Use a password of at least 8 characters.',
            'password.confirmed' => 'The two passwords are not the same.',
        ]);

        $signedIn = null;
        $status = $this->broker()->reset($data, function (User $user, string $password) use (&$signedIn) {
            if (! $user->hasRealEmail() || ! $user->hasPassword()) {
                return; // cannot happen with a link this sent; refused all the same
            }
            $user->forceFill(['password' => $password, 'remember_token' => Str::random(60)]);
            if ($user->email_verified_at === null) {
                $user->email_verified_at = now();
            }
            $user->save();
            $user->tokens()->delete();
            $signedIn = $user;
        });
        if ($status !== PasswordBroker::PASSWORD_RESET || ! $signedIn) {
            throw ValidationException::withMessages(['token' => 'This link has expired or was already used. Ask for a new one.']);
        }

        return response()->json([
            'token' => $signedIn->createToken('player')->plainTextToken,
            'user' => $this->own($signedIn),
        ]);
    }

    private function broker(): PasswordBroker
    {
        return Passwords::broker();
    }

    private function resetMinutes(): int
    {
        return (int) config('auth.passwords.'.config('auth.defaults.passwords').'.expire', 60);
    }

    /**
     * Where the email's link goes: the sign-in screen, ready to choose a new password. The token is
     * after the #, so it never reaches a server's logs or another site as a referrer.
     */
    private function resetUrl(User $user, string $token): string
    {
        return rtrim((string) config('app.url'), '/').'/missions#'.http_build_query(['reset-password' => $token, 'email' => $user->email], '', '&', PHP_QUERY_RFC3986);
    }

    /**
     * What an account is told about itself: toQbl(), its address, so a page can say exactly
     * which account is signed in, and what its profile page may change. Other players never get this.
     */
    private function own(User $user): array
    {
        if ($user->role === 'guest') {
            return $user->toQbl();
        }

        // Accounts a school rosters through /api/v1 have made-up addresses that are never shown.
        return $user->toQbl() + ($user->hasRealEmail() ? ['email' => $user->email] : []) + [
            'has_password' => $user->hasPassword(),
            'uses_google' => $user->google_id !== null,
            'name_locked' => $user->nameIsLocked(),
        ];
    }
}
