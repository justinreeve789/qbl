<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Guards /api/internal: only the game server, which knows the shared key, may call it. */
class ServiceKey
{
    public function handle(Request $request, Closure $next): Response
    {
        $expected = (string) config('qbl.service_key');
        $given = (string) $request->header('X-QBL-Service-Key');

        abort_if($expected === '' || ! hash_equals($expected, $given), 403, 'Forbidden.');

        return $next($request);
    }
}
