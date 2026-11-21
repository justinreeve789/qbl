<?php

namespace App\Http\Controllers;

use App\Qbl\Library\LibraryApi;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Everything under /api/editor/library: the asset library. The routes and rules are in
 * App\Qbl\Library\LibraryApi, which has no framework calls; this only translates.
 */
class LibraryController extends Controller
{
    public function __invoke(Request $request, LibraryApi $api, ?string $path = null): Response
    {
        $user = $request->user();
        $upload = $request->file('file');

        [$status, $body] = $api->handle(
            $request->method(),
            $path ?? '',
            $request->isJson() ? $request->json()->all() : $request->post(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role] : null,
            $upload ? ['file' => ['tmp_name' => $upload->getRealPath(), 'name' => $upload->getClientOriginalName()]] : [],
            $request->query(),
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
