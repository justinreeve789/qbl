<?php

namespace App\Http\Controllers;

use App\Models\Scenario;
use App\Qbl\ProgressStore;
use App\Qbl\StoreError;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** A player's stars, XP and rank, and the marketplace. The rules are in App\Qbl\ProgressStore. */
class ProgressController extends Controller
{
    public function __construct(private ProgressStore $store) {}

    public function show(Request $request): JsonResponse
    {
        return $this->answer(fn () => ['progress' => $this->store->progress($request->user()->id)]);
    }

    /** What is for sale: the platform's items, plus those of the scenario named in ?scenario=. */
    public function shop(Request $request): JsonResponse
    {
        $scenario = $request->query('scenario') ? Scenario::findPublished((string) $request->query('scenario')) : null;
        $user = $request->user();

        return response()->json([
            'items' => $this->store->catalogue($scenario?->id),
            // Guests can look, but have nothing to spend.
            'progress' => $user && $user->role !== 'guest' ? $this->store->progress($user->id) : null,
        ]);
    }

    public function buy(Request $request, int $item): JsonResponse
    {
        $scenario = $request->input('scenario') ? Scenario::findPublished((string) $request->input('scenario')) : null;

        return $this->answer(fn () => ['progress' => $this->store->buy($request->user()->id, $item, $scenario?->id)]);
    }

    public function equip(Request $request, int $item): JsonResponse
    {
        return $this->answer(fn () => ['progress' => $this->store->equip($request->user()->id, $item, $request->boolean('equipped', true))]);
    }

    private function answer(callable $work): JsonResponse
    {
        try {
            return response()->json($work());
        } catch (StoreError $e) {
            return response()->json(['message' => $e->getMessage()], $e->status);
        }
    }
}
