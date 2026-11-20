<?php

namespace App\Console\Commands;

use App\Qbl\Api\Roster;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Delete what each organization asked QBL not to keep for long: activity and messages older than
 * its data_retention_days (PATCH /api/v1/organization). Run it daily, from cron on the host:
 *
 *   docker compose exec -T app php artisan qbl:privacy-purge
 */
class PrivacyPurgeCommand extends Command
{
    protected $signature = 'qbl:privacy-purge';

    protected $description = 'Delete activity and messages older than each organization\'s data retention period';

    public function handle(): int
    {
        foreach (Roster::purgeExpired(DB::connection()->getPdo()) as $org => $counts) {
            $this->line("Organization $org: ".json_encode($counts));
        }

        return self::SUCCESS;
    }
}
