<?php

namespace App\Http\Controllers;

use App\Qbl\Api\V1\Api;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Everything under /api/v1: the public API for schools, districts and businesses. The routes and
 * rules are in App\Qbl\Api\V1\Api, which has no framework calls; this only translates.
 * Reference: docs/src/content/docs/developers/api-v1.md.
 */
class ApiV1Controller extends Controller
{
    public function __invoke(Request $request, Api $api, ?string $path = null): Response
    {
        $files = [];
        foreach (['image', 'portrait'] as $field) {
            if ($upload = $request->file($field)) {
                $files[$field] = ['tmp_name' => $upload->getRealPath(), 'name' => $upload->getClientOriginalName()];
            }
        }
        $basic = $request->getUser() !== null ? [(string) $request->getUser(), (string) $request->getPassword()] : null;

        [$status, $body, $headers] = $api->handle(
            $request->method(),
            $path ?? '',
            $request->query(),
            $request->isJson() ? $request->json()->all() : $request->post(),
            $files,
            ['bearer' => $request->bearerToken(), 'basic' => $basic],
        ) + [2 => []];
        $headers += ['QBL-API-Version' => Api::VERSION];

        if (isset($body['html'])) {
            return response($body['html'], $status, $headers + ['Content-Type' => 'text/html; charset=utf-8']);
        }
        if (isset($body['csv'])) {
            return response($body['csv'], $status, $headers + ['Content-Type' => 'text/csv; charset=utf-8', 'Content-Disposition' => 'attachment; filename="'.$body['filename'].'"']);
        }

        return $body === null ? response()->noContent($status, $headers) : response()->json($body, $status, $headers);
    }
}
