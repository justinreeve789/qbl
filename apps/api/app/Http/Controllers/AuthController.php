<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
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
     * What an account is told about itself: toQbl(), and its address, so a page can say exactly
     * which account is signed in. Other players never get this.
     */
    private function own(User $user): array
    {
        return $user->toQbl() + ($user->role === 'guest' ? [] : ['email' => $user->email]);
    }
}
