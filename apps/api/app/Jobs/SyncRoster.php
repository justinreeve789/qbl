<?php

namespace App\Jobs;

use App\Qbl\District\DistrictApi;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;
use Throwable;

/** A roster sync (Clever or Google Classroom) started in the district admin panel, on the queue worker. */
class SyncRoster implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $timeout = 1800;

    public int $tries = 1;

    public function __construct(public int $runId) {}

    public function handle(DistrictApi $api): void
    {
        $api->performSync($this->runId);
    }

    public function failed(?Throwable $e): void
    {
        DB::table('integration_runs')->where('id', $this->runId)->whereIn('status', ['queued', 'running'])
            ->update(['status' => 'failed', 'error' => mb_substr($e?->getMessage() ?: 'The sync stopped before it finished.', 0, 2000), 'finished_at' => now(), 'updated_at' => now()]);
    }
}
