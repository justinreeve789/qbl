<?php

namespace App\Http\Controllers;

use App\Qbl\Notebooks\NotebookApi;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Players' notebooks: their own notes on a scenario. The routes and rules are in
 * App\Qbl\Notebooks\NotebookApi and NotebookStore, which have no framework calls; this controller
 * only translates the request and response.
 */
class NotebookController extends Controller
{
    public function __invoke(Request $request, NotebookApi $api, string $path = ''): Response
    {
        $user = $request->user();
        [$status, $body] = $api->handle(
            $request->method(),
            $path,
            $request->isJson() ? $request->json()->all() : $request->post(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role] : null,
            $request->query(),
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
