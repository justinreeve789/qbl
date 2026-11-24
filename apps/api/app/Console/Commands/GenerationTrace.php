<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * Read the trace of a generation: every step its method took and every call to an AI service each
 * step made, with the prompts and the answers (see App\Qbl\Generation\Pipeline\Tracer).
 *
 *   php artisan qbl:generation-trace 42              the steps, with time, cost and what each said
 *   php artisan qbl:generation-trace 42 --calls      ...and every call, in order
 *   php artisan qbl:generation-trace 42 --step=design   only the calls of one step
 *   php artisan qbl:generation-trace 42 --call=7     one call in full: system prompt, user turn, answer
 *   php artisan qbl:generation-trace 42 --call=7 --schema   ...with the JSON schema the answer had to follow
 *
 * The files themselves are in the run's work folder (storage/app/generations/42/trace); README.md
 * there is the same timeline, with links, for reading in an editor.
 *
 * Where qbl:generation-log answers "where did the time and money go" from the database, this answers
 * "what exactly did it do, and why did it come out like that".
 */
class GenerationTrace extends Command
{
    protected $signature = 'qbl:generation-trace
        {run : A generation id}
        {--calls : List every call, not only the steps}
        {--step= : Only the calls of this step (design, draw...)}
        {--call= : Print one call in full, by its number}
        {--schema : With --call: include the JSON schema}
        {--json : Print the index as JSON}';

    protected $description = 'Show what each step of a scenario generation did, and every AI call it made (the run\'s trace folder)';

    public function handle(): int
    {
        $dir = rtrim((string) config('qbl_generation.work_dir'), '/').'/'.(int) $this->argument('run').'/trace';
        if (! is_file("$dir/index.json")) {
            $this->error("There is no trace for generation {$this->argument('run')} ($dir). Runs made before traces existed, or with QBL_GEN_TRACE=false, have none.");

            return self::FAILURE;
        }
        $index = json_decode((string) file_get_contents("$dir/index.json"), true);
        if ($this->option('json')) {
            $this->line(json_encode($index, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));

            return self::SUCCESS;
        }
        if ($n = $this->option('call')) {
            return $this->showCall((int) $n, $index, $dir);
        }

        $this->info("Generation {$this->argument('run')}, method {$index['method']}. Files: $dir");
        $this->table(['#', 'Step', 'Outcome', 'Time', 'USD', 'Calls', 'Notes'], array_map(fn ($s) => [
            $s['n'], $s['step'], $s['outcome'].(! empty($s['error']) ? ': '.mb_substr($s['error'], 0, 60) : ''), sprintf('%.1fs', ($s['ms'] ?? 0) / 1000), sprintf('%.3f', $s['usd'] ?? 0),
            count($s['calls'] ?? []), $s['skipped'] ? 'skipped: '.$s['skipped'] : mb_substr(implode(' / ', array_slice($s['notes'] ?? [], 0, 2)), 0, 90),
        ], $index['steps']));

        if ($this->option('calls') || $this->option('step')) {
            $calls = array_filter($index['calls'], fn ($c) => ! $this->option('step') || $c['step'] === $this->option('step'));
            $this->table(['#', 'Step', 'Type', 'What', 'Time'], array_map(fn ($c) => [
                $c['n'], $c['step'], $c['type'],
                match ($c['type']) {
                    'llm' => "{$c['job']}: {$c['name']}",
                    'picture' => $c['kind'].(! empty($c['label']) ? ": {$c['label']}" : '')." ({$c['provider']})",
                    default => $c['what'] ?? '',
                }.(! empty($c['error']) ? ' FAILED' : ''),
                isset($c['seconds']) ? $c['seconds'].'s' : '',
            ], $calls));
            $this->line('One call in full: --call=<#>');
        } else {
            $this->line(count($index['calls']).' calls: --calls to list them, --call=<#> for one in full.');
        }

        return self::SUCCESS;
    }

    private function showCall(int $n, array $index, string $dir): int
    {
        $entry = collect($index['calls'])->firstWhere('n', $n);
        if (! $entry) {
            $this->error("There is no call $n.");

            return self::FAILURE;
        }
        $call = json_decode((string) file_get_contents("$dir/{$entry['file']}"), true);
        $this->info("Call $n ({$call['type']}) in step {$call['step']}, at {$call['at']}. File: $dir/{$entry['file']}");
        if ($call['type'] === 'llm') {
            $this->line("Job: {$call['job']}  Model: {$call['model']}  Answer: {$call['answer_name']}  Max tokens: {$call['max_tokens']}  Time: {$call['seconds']}s");
            $this->newLine();
            $this->comment('── System prompt');
            $this->line($call['system']);
            $this->comment('── User turn');
            foreach ($call['content'] as $part) {
                $this->line(is_string($part) ? $part : (isset($part['image']) ? '[picture '.($part['image']['file'] ?? $part['image']['sha1']).']' : json_encode($part)));
            }
            if ($this->option('schema')) {
                $this->comment('── Schema');
                $this->line(json_encode($call['schema'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            }
            $this->comment('── '.($call['error'] ? 'Failed' : 'Answer'));
            $this->line($call['error'] ?: json_encode($call['answer'], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        } elseif ($call['type'] === 'picture') {
            $this->line("Kind: {$call['kind']}  Label: ".($call['label'] ?? '-')."  Provider: {$call['provider']}  Aspect: {$call['aspect']}  Time: {$call['seconds']}s");
            $this->comment('── Prompt');
            $this->line($call['prompt']);
            $this->comment('── References');
            foreach ($call['references'] as $r) {
                $this->line("- {$r['role']}: ".($r['image']['file'] ?? $r['image']['sha1']));
            }
            $this->comment('── Hints');
            $this->line(json_encode($call['hints'], JSON_UNESCAPED_SLASHES));
            $this->comment('── '.($call['error'] ? 'Failed' : 'Result'));
            $this->line($call['error'] ?: "$dir/".($call['result']['file'] ?? $call['result']['sha1']));
        } else {
            $this->line(json_encode(array_diff_key($call, array_flip(['n', 'type', 'step', 'at'])), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
        }

        return self::SUCCESS;
    }
}
