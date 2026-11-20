<?php

namespace App\Http\Support;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Response;

/**
 * The one-line page that ends a sign-in made elsewhere (Google, a district's SAML identity
 * provider, Clever): it puts the API token in the browser's storage, where the game and the
 * editor look for it, and goes on to the page. The token travels in the page's body, never in an
 * address that could be logged or shared.
 */
class SignInPage
{
    public static function handoff(User $user, string $return, string $tokenName = 'sso'): Response
    {
        $flags = JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT;
        $token = json_encode($user->createToken($tokenName)->plainTextToken, $flags);
        $target = json_encode($return, $flags | JSON_UNESCAPED_SLASHES);
        $html = "<!doctype html><meta charset=\"utf-8\"><title>Signing in…</title><script>try{localStorage.setItem('qbl.token',$token);sessionStorage.setItem('qbl.signing-in','1')}catch(e){}location.replace($target)</script>";

        return response($html, 200, ['Content-Type' => 'text/html; charset=utf-8', 'Cache-Control' => 'no-store', 'Referrer-Policy' => 'no-referrer']);
    }

    /**
     * Only ever go back to a page of this site: a path, never another host. With none, the
     * missions page, where everyone lands after signing in (teachers reach the editor from its menu).
     */
    public static function localPath(mixed $path): string
    {
        $fallback = '/missions';
        if (! is_string($path) || $path === '') {
            return $fallback;
        }

        return preg_match('#^/(?!/)[A-Za-z0-9_\-./?=&%\#]*$#', $path) && ! str_contains($path, '\\') ? $path : $fallback;
    }

    /** Back to the sign-in page with a reason it did not work (`#signin=…`, read by the game and the editor). */
    public static function problem(string $code, string $return = '/missions'): RedirectResponse
    {
        return redirect(strtok($return, '#').'#signin='.$code);
    }
}
