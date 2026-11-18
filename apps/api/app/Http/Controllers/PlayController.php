<?php

namespace App\Http\Controllers;

use App\Models\Scenario;
use App\Models\ScenarioSession;
use App\Qbl\ClassStore;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlayController extends Controller
{
    /**
     * The published scenario document with the caller's save data in `session`. `?group=` names
     * the instance being joined (a team's, an assignment's, or the public one), since each has
     * its own save.
     */
    public function show(Request $request, string $key, ClassStore $classes): JsonResponse
    {
        $scenario = Scenario::findPublished($key) ?? abort(404, 'Scenario not found.');
        $user = $request->user('sanctum');

        if (! $user && $scenario->require_login) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if ($user && $user->role === 'guest' && $scenario->require_login) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $group = substr((string) $request->query('group', 'public'), 0, 64) ?: 'public';
        $private = ($scenario->settings['visibility'] ?? 'public') === 'private';
        if (! $user && $private) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        if ($user && ! $classes->mayJoin($user->id, $user->role, $scenario->id, $group)) {
            return response()->json(['message' => $private && $group === 'public' ? 'This mission is for classes it has been assigned to.' : 'You are not in that team.'], 403);
        }

        $document = $scenario->toDocument();
        $saves = ($document['enable_save_session'] ?? true) && $user;
        $document['session'] = $saves
            ? ScenarioSession::where('scenario_id', $scenario->id)->where('user_id', $user->id)->where('group_key', $group)->value('data')
            : null;

        // The instance being joined: which room it belongs to, and for a team its name.
        $access = $user ? $classes->access($user->id, $user->role, $scenario->id, $group) : ['party' => $group];
        $document['instance'] = array_filter(['group' => $group, 'party' => $access['party'], 'team_name' => $access['team_name'] ?? null], fn ($v) => $v !== null);

        return response()->json(['scenario' => $document]);
    }
}
