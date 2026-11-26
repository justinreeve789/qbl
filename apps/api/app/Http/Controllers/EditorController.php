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

        return $this->answer($body, $status);
    }

    /** GET /api/editor-export/{ticket}: an exported ZIP, by the signed link the editor asked for (no token). */
    public function exportByLink(EditorApi $api, string $ticket): Response
    {
        [$status, $body] = $api->exportByLink($ticket);

        return $this->answer($body, $status);
    }

    private function answer(?array $body, int $status): Response
    {
        // A file to send (an exported scenario), made for this request and removed once sent.
        // Something to play in the page (a voice sample) rather than save.
        if (isset($body['download']) && ! empty($body['download']['inline'])) {
            return response()->file($body['download']['path'], ['Content-Type' => $body['download']['type'], 'Cache-Control' => 'private, max-age=3600'])->deleteFileAfterSend(true);
        }
        if (isset($body['download'])) {
            return response()->download($body['download']['path'], $body['download']['name'], ['Content-Type' => $body['download']['type']])->deleteFileAfterSend(true);
        }

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
