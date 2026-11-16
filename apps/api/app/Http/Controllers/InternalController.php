<?php

namespace App\Http\Controllers;

use App\Models\Scenario;
use App\Models\ScenarioInstance;
use App\Models\ScenarioSession;
use App\Models\User;
use App\Qbl\ProgressStore;
use App\Qbl\StoreError;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Laravel\Sanctum\PersonalAccessToken;

/** Endpoints for the game server. Protected by the ServiceKey middleware. */
class InternalController extends Controller
{
    public function verify(Request $request): JsonResponse
    {
        $token = PersonalAccessToken::findToken((string) $request->input('token'));
        $user = $token?->tokenable;

        if (! $user instanceof User || ($token->expires_at && $token->expires_at->isPast())) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        // What the player's avatar wears travels with them into the room.
        $look = $user->role === 'guest' ? '' : app(ProgressStore::class)->look($user->id);

        return response()->json(['user' => $user->toQbl() + ['look' => $look]]);
    }

    /** An award action ran in a player's browser. It is granted only if the published scenario contains it. */
    public function award(Request $request, Scenario $scenario, ProgressStore $progress): JsonResponse
    {
        try {
            return response()->json(['progress' => $progress->award((int) $request->input('user_id'), $scenario->id, $scenario->toDocument(), (int) $request->input('action_id'))]);
        } catch (StoreError $e) {
            return response()->json(['message' => $e->getMessage()], $e->status);
        }
    }

    public function look(User $user, ProgressStore $progress): JsonResponse
    {
        return response()->json(['look' => $user->role === 'guest' ? '' : $progress->look($user->id)]);
    }

    public function scenario(string $key): JsonResponse
    {
        $scenario = Scenario::findPublished($key) ?? abort(404, 'Scenario not found.');

        return response()->json(['scenario' => $scenario->toDocument()]);
    }

    public function loadSession(Scenario $scenario, User $user): JsonResponse
    {
        $data = ScenarioSession::where('scenario_id', $scenario->id)->where('user_id', $user->id)->value('data');

        return response()->json(['session' => $data]);
    }

    public function saveSession(Request $request, Scenario $scenario, User $user): Response
    {
        $data = $request->validate(['session' => ['required', 'array']]);

        ScenarioSession::updateOrCreate(
            ['scenario_id' => $scenario->id, 'user_id' => $user->id],
            ['data' => $data['session']],
        );

        return response()->noContent();
    }

    public function loadInstance(Scenario $scenario, string $group): JsonResponse
    {
        $data = ScenarioInstance::where('scenario_id', $scenario->id)->where('group_key', $group)->value('data');

        return response()->json(['instance' => $data]);
    }

    public function saveInstance(Request $request, Scenario $scenario, string $group): Response
    {
        $data = $request->validate(['instance' => ['required', 'array']]);

        ScenarioInstance::updateOrCreate(
            ['scenario_id' => $scenario->id, 'group_key' => $group],
            ['data' => $data['instance']],
        );

        return response()->noContent();
    }
}
