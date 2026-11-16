<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $data = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
        ]);

        $user = User::where('email', $data['email'])->first();

        // An account that has only ever signed in with Google has no password to check.
        if (! $user || $user->role === 'guest' || ! $user->password || ! Hash::check($data['password'], $user->password)) {
            throw ValidationException::withMessages(['email' => 'These credentials do not match our records.']);
        }

        return response()->json([
            'token' => $user->createToken('player')->plainTextToken,
            'user' => $user->toQbl(),
        ]);
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
        return response()->json(['user' => $request->user()->toQbl()]);
    }
}
