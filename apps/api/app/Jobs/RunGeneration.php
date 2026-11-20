<?php

namespace App\Jobs;

use App\Qbl\Billing\Credits;
use App\Qbl\Generation\GenerationApi;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\GenerationRuns;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Make a mission a teacher asked for in the editor (App\Qbl\Generation\GenerationApi): the same
 * work as `php artisan qbl:generate`, on the queue worker. Runs once: a run that fails is marked
 * failed and its credits are given back, and the teacher can start another.
 */
class RunGeneration implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    /** Drawing a whole mission takes minutes; give it an hour. */
    public int $timeout = 3600;

    public int $tries = 1;

    public function __construct(public int $generationId) {}

    public function handle(GenerationFactory $factory, Credits $credits): void
    {
        $pdo = DB::connection()->getPdo();
        $run = (new GenerationRuns($pdo))->get($this->generationId);
        // Only a run that has not started: a job delivered twice must not draw (and charge) twice.
        if (! $run || $run['status'] !== 'queued') {
            return;
        }
        ini_set('memory_limit', '2048M');
        $log = fn (string $line) => Log::info("generation {$this->generationId}: $line");
        try {
            $factory->generator([], $log)->generate((string) $run['prompt'], [], $run['user_id'] !== null ? (int) $run['user_id'] : null, $this->generationId);
        } catch (Throwable $e) {
            report($e);
            GenerationApi::failed($pdo, $credits, $this->generationId, $e->getMessage());
        }
    }

    /** The worker gave up on it (it ran out of time, say). */
    public function failed(?Throwable $e): void
    {
        GenerationApi::failed(DB::connection()->getPdo(), app(Credits::class), $this->generationId, $e?->getMessage() ?: 'The generator stopped before the mission was finished.');
    }
}
