<?php

namespace App\Http\Controllers;

use App\Models\Scenario;
use App\Models\ScenarioInstance;
use App\Models\ScenarioSession;
use App\Models\User;
use App\Qbl\ActivityStore;
use App\Qbl\ClassStore;
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
    public function award(Request $request, Scenario $scenario, ProgressStore $progress, ActivityStore $activity): JsonResponse
    {
        try {
            $document = $scenario->toDocument();
            $userId = (int) $request->input('user_id');
            $result = $progress->award($userId, $scenario->id, $document, (int) $request->input('action_id'));
            // An award can carry a badge, which a player earns once and others see on their profile.
            $action = ProgressStore::findAward($document, (int) $request->input('action_id'));
            if ($action && ($badge = $activity->grantBadge($userId, $scenario->id, $document, $action))) {
                $result['badge'] = $badge;
            }

            return response()->json(['progress' => $result]);
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

    /** May this player join this instance (`?group=`) of the scenario? Teams and assignments are for their members. */
    public function access(Request $request, Scenario $scenario, User $user, ClassStore $classes): JsonResponse
    {
        // Besides yes or no: the room the instance belongs to (teams of an assignment share one) and the team's name.
        return response()->json($classes->access($user->id, $user->role, $scenario->id, self::group($request)));
    }

    /** Lines for the activity log, from which teachers' reports are made. */
    public function logActivity(Request $request, Scenario $scenario, ActivityStore $activity): JsonResponse
    {
        return response()->json(['kept' => $activity->logActivity($scenario->id, (array) $request->input('entries', []))]);
    }

    /** Messages players sent, in a scene or privately, kept for auditing. */
    public function logMessages(Request $request, Scenario $scenario, ActivityStore $activity): JsonResponse
    {
        return response()->json(['kept' => $activity->logMessages($scenario->id, (array) $request->input('entries', []))]);
    }

    /** A player's save in one instance of a scenario: `?group=`, the public instance if not given. */
    public function loadSession(Request $request, Scenario $scenario, User $user): JsonResponse
    {
        $data = ScenarioSession::where('scenario_id', $scenario->id)->where('user_id', $user->id)->where('group_key', self::group($request))->value('data');

        return response()->json(['session' => $data]);
    }

    public function saveSession(Request $request, Scenario $scenario, User $user): Response
    {
        $data = $request->validate(['session' => ['required', 'array']]);

        ScenarioSession::updateOrCreate(
            ['scenario_id' => $scenario->id, 'user_id' => $user->id, 'group_key' => self::group($request)],
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

    private static function group(Request $request): string
    {
        return substr((string) $request->query('group', 'public'), 0, 64) ?: 'public';
    }
}
