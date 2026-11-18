<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\URL;
use Symfony\Component\HttpFoundation\Response;

/**
 * The site's public address (QBL_PUBLIC_URL, which is APP_URL) is the one every link uses.
 *
 * TLS ends at the edge container, so every request reaches Laravel as plain HTTP from Apache. When the
 * public address is https, the addresses Laravel writes (the Google sign-in's redirect_uri among
 * them) are built from it, and the request counts as secure, so its cookies are https-only.
 * Nothing then depends on the proxy in front keeping the Host header or sending X-Forwarded-Proto.
 * A trusted proxy that does say a visitor came by plain http is still believed for cookies.
 *
 * With an http public address (trying it out on localhost) nothing changes: addresses follow
 * each request, and the trusted forwarded headers, as before.
 */
class PublicAddress
{
    public function handle(Request $request, Closure $next): Response
    {
        $public = rtrim((string) config('app.url'), '/');
        if (preg_match('#^https://[^/?\#]+#i', $public, $origin)) {
            URL::forceRootUrl($origin[0]);
            URL::forceScheme('https');
            $request->server->set('HTTPS', 'on');
        }

        return $next($request);
    }
}
