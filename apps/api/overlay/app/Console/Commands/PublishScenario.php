<?php

namespace App\Console\Commands;

use App\Models\Scenario;
use Illuminate\Console\Command;

class PublishScenario extends Command
{
    protected $signature = 'qbl:publish {key? : Code or shortname of the scenario; all of them if omitted} {--print : Write the generated JSON to stdout}';

    protected $description = 'Generate scenario JSON from the database tables and publish it';

    public function handle(): int
    {
        $query = Scenario::query();
        if ($key = $this->argument('key')) {
            $query->where(fn ($q) => $q->where('code', strtolower($key))->orWhere('shortname', $key));
        }
        $scenarios = $query->get();
        if ($scenarios->isEmpty()) {
            $this->error('No such scenario.');

            return self::FAILURE;
        }

        foreach ($scenarios as $scenario) {
            $document = $scenario->publish();
            if ($this->option('print')) {
                $this->line(json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
            } else {
                $this->info("Published \"{$scenario->title}\" at /{$scenario->code} (".count($document['scenes']).' scenes).');
            }
        }

        return self::SUCCESS;
    }
}
