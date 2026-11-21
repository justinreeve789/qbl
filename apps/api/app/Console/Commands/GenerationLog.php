<?php

namespace App\Console\Commands;

use App\Qbl\Generation\GenerationEvents;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Read the audit log of the AI scenario generator (the generation_events table): what each run did,
 * how long each stage, call and picture took, and what it cost at list prices.
 *
 *   php artisan qbl:generation-log             recent runs, with time and cost
 *   php artisan qbl:generation-log 42          one run: by stage and by kind of work
 *   php artisan qbl:generation-log 42 --steps  ...and every call in order
 *   php artisan qbl:generation-log 42 --json   everything, as JSON
 */
class GenerationLog extends Command
{
    protected $signature = 'qbl:generation-log
        {run? : A generation id; without one, the most recent runs are listed}
        {--steps : With a run: list every call, picture and line in order}
        {--type= : With --steps: only this type (llm, picture, voice, stage, estimate)}
        {--limit=20 : How many runs to list}
        {--json : Print JSON instead of tables}';

    protected $description = 'Show where a scenario generation spent its time and money (the generation_events log)';

    public function handle(): int
    {
        $events = new GenerationEvents(DB::connection()->getPdo());
        $run = $this->argument('run');
        if ($run === null) {
            return $this->listRuns($events);
        }
        $run = (int) $run;
        $log = $events->forRun($run);
        if (! $log) {
            $this->error("There is nothing logged for generation $run (it may have been made before the log existed).");

            return self::FAILURE;
        }
        $totals = $events->totals($run);
        if ($this->option('json')) {
            $this->line(json_encode(['run' => $run, 'totals' => $totals, 'events' => $log], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

            return self::SUCCESS;
        }
        $t = $totals['total'];
        $estimate = collect($log)->firstWhere('type', 'estimate');
        $this->info(sprintf('Generation %d: %d calls logged, about $%.2f%s; language model %s in, %s out tokens (%s read from cache).', $run, $t['events'] ?? 0, $t['usd'] ?? 0,
            $estimate ? sprintf(' (estimated $%.2f for the pictures before drawing)', $estimate['usd']) : '', number_format($t['input_tokens'] ?? 0), number_format($t['output_tokens'] ?? 0), number_format($t['cache_read_tokens'] ?? 0)));

        $this->line('By stage (time is the clock on the wall; the rest is what each stage called):');
        $this->table(['Stage', 'Time', 'LLM calls', 'Pictures', 'Voice lines', 'USD'], array_map(fn ($s) => [
            $s['stage'], self::time($s['stage_ms'] ?? null), $s['llm_calls'], $s['pictures'], $s['voice_lines'], self::usd($s['usd']),
        ], $totals['stages']));

        $this->line('By kind of work:');
        $this->table(['Type', 'Kind', 'Calls', 'Call time', 'In tokens', 'Out tokens', 'Cached', 'Kept', 'USD'], array_map(fn ($k) => [
            $k['type'], $k['kind'] ?? '', $k['events'], self::time($k['ms']), number_format($k['input_tokens']), number_format($k['output_tokens']), number_format($k['cache_read_tokens']), $k['type'] === 'picture' ? $k['kept'] : '', self::usd($k['usd']),
        ], $totals['kinds']));

        if ($this->option('steps')) {
            $only = $this->option('type');
            $this->line('Every event, in order:');
            $this->table(['#', 'Stage', 'Type', 'Step', 'Try', 'Model', 'Time', 'In', 'Out', 'USD', 'Score', 'Outcome'], collect($log)
                ->filter(fn ($e) => ! $only || $e['type'] === $only)
                ->map(fn ($e) => [
                    $e['seq'], $e['stage'] ?? '', $e['type'], mb_strimwidth((string) ($e['step'] ?? ''), 0, 44, '…'), $e['attempt'] ?? '', mb_strimwidth(trim(($e['model'] ?? '').' '.($e['size'] ?? '')), 0, 28, '…'),
                    self::time($e['duration_ms']), $e['input_tokens'] ?? '', $e['output_tokens'] ?? '', self::usd($e['usd']), $e['score'] ?? '', $e['outcome'] ?? '',
                ])->values()->all());
        }

        return self::SUCCESS;
    }

    private function listRuns(GenerationEvents $events): int
    {
        $runs = $events->runs(max(1, (int) $this->option('limit')));
        if ($this->option('json')) {
            $this->line(json_encode($runs, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

            return self::SUCCESS;
        }
        if (! $runs) {
            $this->line('No generations yet.');

            return self::SUCCESS;
        }
        $this->table(['Run', 'Status', 'Started (UTC)', 'Time', 'LLM calls', 'Pictures', 'USD', 'Prompt'], array_map(fn ($r) => [
            $r['id'], $r['status'], $r['created_at'], self::time($r['ms']), $r['llm_calls'], $r['pictures'], self::usd($r['usd']), mb_strimwidth((string) $r['prompt'], 0, 50, '…'),
        ], $runs));
        $this->line('Details of one: php artisan qbl:generation-log <run> [--steps]');

        return self::SUCCESS;
    }

    private static function usd(mixed $v): string
    {
        return $v === null || $v === '' ? '' : sprintf('$%.4f', (float) $v);
    }

    private static function time(mixed $ms): string
    {
        if ($ms === null || $ms === '') {
            return '';
        }
        $s = (float) $ms / 1000;

        return $s >= 60 ? sprintf('%dm %02ds', intdiv((int) $s, 60), (int) $s % 60) : sprintf('%.1fs', $s);
    }
}
