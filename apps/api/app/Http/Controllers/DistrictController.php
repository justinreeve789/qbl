<?php

namespace App\Http\Controllers;

use App\Qbl\District\DistrictApi;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * /api/district: the district admin panel. The routes and rules are in App\Qbl\District\DistrictApi;
 * this controller only translates the request (including an uploaded roster file) and the answer.
 */
class DistrictController extends Controller
{
    public function __invoke(Request $request, DistrictApi $api, ?string $path = null): Response
    {
        $user = $request->user();
        $upload = $request->file('file');
        [$status, $body] = $api->handle(
            $request->method(),
            $path ?? '',
            $request->isJson() ? $request->json()->all() : $request->post(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role, 'email' => $user->email] : null,
            $upload ? ['file' => ['tmp_name' => $upload->getRealPath(), 'name' => $upload->getClientOriginalName()]] : [],
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
