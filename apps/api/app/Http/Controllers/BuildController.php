<?php

namespace App\Http\Controllers;

use App\Qbl\Builds\BuildApi;
use App\Qbl\Builds\BuildStore;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Student building: what students add to scenes that allow it. The routes and rules are in
 * App\Qbl\Builds\BuildApi and BuildStore, which have no framework calls; this controller only
 * translates the request and response.
 */
class BuildController extends Controller
{
    public function __invoke(Request $request, BuildApi $api, string $path = ''): Response
    {
        $user = $request->user();
        $files = [];
        if ($request->hasFile('file')) {
            $files['file'] = ['tmp_name' => $request->file('file')->getRealPath()];
        }
        [$status, $body] = $api->handle(
            $request->method(),
            $path,
            $request->isJson() ? $request->json()->all() : $request->post(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role] : null,
            $request->query(),
            $files,
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }

    /** An uploaded picture, by its unguessable key. No token: the game loads it as it loads any picture. */
    public function file(BuildStore $builds, string $key): Response
    {
        $file = $builds->file($key) ?? abort(404);

        return response($file[0], 200, [
            'Content-Type' => $file[1],
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
