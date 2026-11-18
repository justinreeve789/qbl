<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Str;
use Laravel\Socialite\Facades\Socialite;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\RedirectResponse as SymfonyRedirect;
use Throwable;

/**
 * Signing in with Google, for the game and the editor alike.
 *
 *   1. The sign-in screen sends the browser to /api/auth/google/redirect?return=/editor/
 *   2. Google asks the person, and sends them back to /api/auth/google/callback
 *   3. The account is found (or made), an API token is issued, and a one-line page hands the
 *      token to the game or editor in the browser's storage and goes back to where they started.
 *
 * The API keeps no sessions, so the "state" that ties step 2 to step 1 travels in a short-lived
 * encrypted cookie instead.
 */
class GoogleAuthController extends Controller
{
    private const COOKIE = 'qbl_google';

    /** Which ways of signing in the sign-in screens should offer. */
    public function providers(): JsonResponse
    {
        return response()->json(['google' => self::enabled(), 'guest' => (bool) config('qbl.allow_guests')]);
    }

    public function redirect(Request $request): SymfonyRedirect
    {
        abort_unless(self::enabled(), 404, 'Google sign-in is not set up.');

        $state = Str::random(40);
        $payload = Crypt::encryptString(json_encode(['state' => $state, 'return' => self::localPath($request->query('return'))]));
        $domains = config('qbl.google.domains');

        $response = Socialite::driver('google')
            ->stateless()
            ->scopes(['openid', 'email', 'profile'])
            // With a single allowed domain, Google shows only that organisation's accounts.
            ->with(['state' => $state, 'prompt' => 'select_account'] + (count($domains) === 1 ? ['hd' => $domains[0]] : []))
            ->redirect();
        $response->headers->setCookie(new Cookie(self::COOKIE, $payload, time() + 600, '/api/auth/google', null, $request->isSecure(), true, false, Cookie::SAMESITE_LAX));

        return $response;
    }

    public function callback(Request $request): Response|RedirectResponse
    {
        abort_unless(self::enabled(), 404, 'Google sign-in is not set up.');

        try {
            $saved = json_decode(Crypt::decryptString((string) $request->cookie(self::COOKIE)), true) ?: [];
        } catch (Throwable) {
            $saved = [];
        }
        $return = self::localPath($saved['return'] ?? null);
        $forget = new Cookie(self::COOKIE, '', 1, '/api/auth/google', null, $request->isSecure(), true, false, Cookie::SAMESITE_LAX);
        $back = fn (string $problem) => redirect($return.'#signin='.$problem)->withCookie($forget);

        // The answer must belong to a sign-in this browser started.
        if (empty($saved['state']) || ! hash_equals($saved['state'], (string) $request->query('state'))) {
            return $back('expired');
        }
        if ($request->query('error')) {
            return $back('cancelled');
        }

        try {
            $google = Socialite::driver('google')->stateless()->user();
        } catch (Throwable $e) {
            report($e);

            return $back('failed');
        }

        $email = Str::lower((string) $google->getEmail());
        if ($email === '' || ! ($google->user['email_verified'] ?? $google->user['verified_email'] ?? false)) {
            return $back('unverified');
        }
        $domain = Str::after($email, '@');
        $allowed = config('qbl.google.domains');
        if ($allowed && ! in_array($domain, $allowed, true)) {
            return $back('domain');
        }

        // Google's id for the account is the key; the address is only used to join an account
        // that already exists (one made by an administrator, say) the first time.
        $user = User::where('google_id', $google->getId())->first()
            ?? User::where('email', $email)->where('role', '!=', 'guest')->first();
        if ($user) {
            $user->forceFill(['google_id' => $google->getId(), 'email_verified_at' => $user->email_verified_at ?? now()])->save();
        } else {
            $user = User::create([
                'name' => Str::limit(trim(strip_tags((string) ($google->getName() ?: Str::before($email, '@')))), 60, ''),
                'email' => $email,
                'password' => null,
                'role' => in_array($domain, config('qbl.google.teacher_domains'), true) ? 'teacher' : 'student',
            ]);
            $user->forceFill(['google_id' => $google->getId(), 'email_verified_at' => now()])->save();
        }

        // The token goes to the page in its body, never in an address that could be logged or shared.
        $token = json_encode($user->createToken('google')->plainTextToken, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
        $target = json_encode($return, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);
        $html = "<!doctype html><meta charset=\"utf-8\"><title>Signing in…</title><script>try{localStorage.setItem('qbl.token',$token)}catch(e){}location.replace($target)</script>";

        return response($html, 200, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer'])->withCookie($forget);
    }

    public static function enabled(): bool
    {
        return (bool) config('services.google.client_id') && (bool) config('services.google.client_secret');
    }

    /**
     * Only ever go back to a page of this site: a path, never another host. Anything else goes
     * to the missions page ("/" is the marketing site, which has no sign-in of its own).
     */
    private static function localPath(mixed $path): string
    {
        $fallback = '/missions';
        $path = is_string($path) ? $path : $fallback;

        return preg_match('#^/(?!/)[A-Za-z0-9_\-./?=&%]*$#', $path) && ! str_contains($path, '\\') ? $path : $fallback;
    }
}
