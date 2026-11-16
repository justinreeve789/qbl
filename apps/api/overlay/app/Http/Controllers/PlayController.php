<?php

namespace App\Http\Controllers;

use App\Models\Scenario;
use App\Models\ScenarioSession;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlayController extends Controller
{
    /** The published scenario document with the caller's save data in `session`. */
    public function show(Request $request, string $key): JsonResponse
    {
        $scenario = Scenario::findPublished($key) ?? abort(404, 'Scenario not found.');
        $user = $request->user('sanctum');

        if (! $user && $scenario->require_login) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if ($user && $user->role === 'guest' && $scenario->require_login) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $document = $scenario->toDocument();
        $saves = ($document['enable_save_session'] ?? true) && $user;
        $document['session'] = $saves
            ? ScenarioSession::where('scenario_id', $scenario->id)->where('user_id', $user->id)->value('data')
            : null;

        return response()->json(['scenario' => $document]);
    }
}
