<?php

namespace App\Http\Controllers;

use App\Qbl\EditorApi;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Everything under /api/editor. The routes and rules are in App\Qbl\EditorApi, which has no
 * framework calls and is tested on its own; this controller only translates the request and response.
 */
class EditorController extends Controller
{
    public function __invoke(Request $request, EditorApi $api, ?string $path = null): Response
    {
        $user = $request->user();
        $upload = $request->file('file');

        [$status, $body] = $api->handle(
            $request->method(),
            $path ?? '',
            $request->isJson() ? $request->json()->all() : $request->post(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role] : null,
            $upload ? ['file' => ['tmp_name' => $upload->getRealPath(), 'name' => $upload->getClientOriginalName()]] : [],
        );

        // A file to send (an exported scenario), made for this request and removed once sent.
        if (isset($body['download'])) {
            return response()->download($body['download']['path'], $body['download']['name'], ['Content-Type' => $body['download']['type']])->deleteFileAfterSend(true);
        }

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
