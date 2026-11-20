<?php

namespace App\Http\Controllers;

use App\Jobs\RunGeneration;
use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Entitlements;
use App\Qbl\Generation\GenerationApi;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * /api/editor/generations: the AI mission generator from the editor, paid in credits. The rules
 * are in App\Qbl\Generation\GenerationApi; the work is the RunGeneration job, on the queue worker.
 */
class GenerationController extends Controller
{
    public function __invoke(Request $request, Entitlements $entitlements, Credits $credits, GenerationFactory $factory, ?string $path = null): Response
    {
        $user = $request->user();
        $api = new GenerationApi(
            DB::connection()->getPdo(),
            $entitlements,
            $credits,
            fn (int $id) => RunGeneration::dispatch($id),
            // Say so at once, before any credits are taken, when the site cannot make missions.
            function () use ($factory) {
                if ((string) config('qbl_generation.llm.api_key') === '') {
                    throw new GenerationError('ANTHROPIC_API_KEY is not set. Ask the site\'s administrator.');
                }
                $factory->generator([]);
            },
            // Whether runs record voices here: a stage of the progress bar.
            (string) config('qbl_speech.driver', 'none') !== 'none',
        );
        [$status, $body] = $api->handle(
            $request->method(),
            array_values(array_filter(explode('/', trim((string) $path, '/')), 'strlen')),
            $request->json()->all(),
            $user ? ['id' => $user->id, 'name' => $user->name, 'role' => $user->role] : null,
        );

        return $body === null ? response()->noContent($status) : response()->json($body, $status);
    }
}
