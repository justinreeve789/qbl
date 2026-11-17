<?php

namespace App\Http\Controllers;

use App\Qbl\ClassApi;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Missions, avatars and the teacher's classes. The routes and rules are in App\Qbl\ClassApi,
 * which has no framework calls; this controller only translates the request and response.
 */
class ClassController extends Controller
{
    public function __invoke(Request $request, ClassApi $api, string $path): Response
    {
        $user = $request->user();
        [$status, $body] = $api->handle(
            $request->method(),
            $path,
            $request->isJson() ? $request->json()->all() : $request->post(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role] : null,
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
