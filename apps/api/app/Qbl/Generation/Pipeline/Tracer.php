<?php

namespace App\Qbl\Generation\Pipeline;

use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\Reference;
use App\Qbl\Generation\GenerationCancelled;

/**
 * The generator's flight recorder: writes down, in the run's work folder, every step a generation
 * method takes and every call to an AI service each step makes, so a developer can open a folder and
 * see exactly what happened, in order, with the prompts and the answers.
 *
 *   storage/app/generations/<run>/trace/
 *     README.md                    the timeline, readable in any editor or on GitHub (rewritten after each step)
 *     index.json                   the same, as data: {method, steps: [...], calls: [...]}
 *     steps/03-design.json         one step: when, how long, what it cost, its notes, and its outputs
 *     steps/03-design.blueprint.json   what the step produced (each output in a file of its own)
 *     calls/0007-llm-design-mission_blueprint.json   one language model call: system prompt, user turn, schema, answer
 *     calls/0012-picture-background.json             one picture: prompt, references, hints, the result's file
 *     blobs/<sha1>.png             pictures sent or received, once each however often they are used (style anchors!)
 *
 * Read it with `php artisan qbl:generation-trace <run>` (and `--call=7` for one call in full).
 *
 * How it hooks in: the method wraps each of its language models in a TracingLanguageModel and its
 * image generator in a TracingImageGenerator (GenerationMethod does this for every model and picture
 * source, including the ones a subclass makes), and ScenarioGenerator runs every step through step().
 * Both decorators ask the tracer which step is running, so every call is filed under its step.
 *
 * Like Spend, one Tracer lives as long as the generator, and is attached to a run's folder when the
 * run starts. While it is not attached (say, a director used for an estimate), it records nothing.
 *
 * Settings (config/qbl_generation.php, `trace`): enabled (QBL_GEN_TRACE, default on) and pictures
 * (QBL_GEN_TRACE_PICTURES): "thumb" keeps a 512 px copy of every picture (default), "full" the
 * picture as it came, "none" only its size and hash.
 */
class Tracer
{
    /** The folder being written to (null: not attached, record nothing). */
    private ?string $dir = null;

    /** What is in index.json: carried on when a run is resumed. */
    private array $index = [];

    /** The step running now (its number and name), so the calls it makes are filed under it. */
    private ?array $current = null;

    public function __construct(private bool $enabled = true, private string $pictures = 'thumb') {}

    // ------------------------------------------------------------------------------------------------
    // Attaching to a run

    /** Start (or carry on) the trace of the run whose work folder is $runDir. */
    public function attach(string $runDir, string $method, array $steps): void
    {
        if (! $this->enabled) {
            return;
        }
        $this->dir = rtrim($runDir, '/').'/trace';
        foreach (['', '/steps', '/calls', '/blobs'] as $sub) {
            if (! is_dir($this->dir.$sub)) {
                @mkdir($this->dir.$sub, 0775, true);
            }
        }
        // A resumed run keeps what it recorded before: numbering carries on from there.
        $saved = is_file("$this->dir/index.json") ? json_decode((string) file_get_contents("$this->dir/index.json"), true) : null;
        $this->index = is_array($saved) ? $saved : ['steps' => [], 'calls' => []];
        $this->index['sessions'][] = ['method' => $method, 'planned' => $steps, 'started_at' => gmdate('c')];
        $this->index['method'] = $method;
        $this->save();
    }

    public function detach(): void
    {
        $this->dir = null;
        $this->current = null;
    }

    public function attached(): bool
    {
        return $this->dir !== null;
    }

    public function folder(): ?string
    {
        return $this->dir;
    }

    // ------------------------------------------------------------------------------------------------
    // Steps

    /**
     * Run one step and write down what it did. The step itself is $work; what it wants kept (outputs,
     * notes, "skipped because...") it hands to the GenerationRun, which passes it on here.
     *
     * @param  callable(): void  $work
     * @param  callable(): float  $spent  what the run has spent so far, to work out what this step cost
     */
    public function step(Step $step, GenerationRun $run, callable $work, callable $spent): void
    {
        if (! $this->dir) {
            $work();

            return;
        }
        $n = count($this->index['steps']) + 1;
        $name = $step->name();
        $this->current = ['n' => $n, 'name' => $name];
        $run->beginStep($name);
        $started = microtime(true);
        $usd = $spent();
        $entry = ['n' => $n, 'step' => $name, 'class' => $step::class, 'stage' => $step->stage(), 'started_at' => gmdate('c'), 'outcome' => 'ok'];
        try {
            $work();
        } catch (\Throwable $e) {
            $entry['outcome'] = $e instanceof GenerationCancelled ? 'cancelled' : 'failed';
            $entry['error'] = mb_substr($e->getMessage(), 0, 4000);
            throw $e;
        } finally {
            // Whatever happened, the step is written down: a failed step is the one most worth reading.
            $record = $run->endStep();
            $entry['ms'] = (int) round((microtime(true) - $started) * 1000);
            $entry['usd'] = round($spent() - $usd, 5);
            $entry['skipped'] = $record['skipped'];
            $entry['notes'] = $record['notes'];
            $entry['calls'] = array_values(array_map(fn ($c) => $c['n'], array_filter($this->index['calls'], fn ($c) => ($c['step_n'] ?? null) === $n)));
            $entry['outputs'] = [];
            $base = sprintf('%02d-%s', $n, self::slug($name));
            foreach ($record['outputs'] as $what => $value) {
                $file = "steps/$base.".self::slug($what).'.json';
                $this->write($file, $value);
                $entry['outputs'][$what] = $file;
            }
            $this->write("steps/$base.json", $entry);
            $this->index['steps'][] = $entry;
            $this->current = null;
            $this->save();
        }
    }

    // ------------------------------------------------------------------------------------------------
    // Calls (made by the tracing decorators)

    /**
     * A language model call: everything that was sent, and what came back.
     *
     * @param  array  $content  the user turn as sent: strings, ['image' => bytes, 'mime' => ...], ['cache' => true]
     */
    public function llm(string $job, string $model, string $system, array $content, string $name, array $schema, int $maxTokens, ?array $answer, float $seconds, ?string $error): void
    {
        if (! $this->dir) {
            return;
        }
        // Pictures in the user turn (style anchors, the picture being judged) are kept as blobs, not inline base64.
        $turn = array_map(fn ($part) => is_array($part) && isset($part['image']) ? ['image' => $this->blob((string) $part['image'], (string) ($part['mime'] ?? 'image/png'))] : $part, $content);
        $this->call('llm', "$job-$name", [
            'job' => $job, 'model' => $model, 'answer_name' => $name, 'max_tokens' => $maxTokens,
            'seconds' => round($seconds, 2), 'error' => $error,
            'system' => $system, 'content' => $turn, 'schema' => $schema, 'answer' => $answer,
        ], ['job' => $job, 'model' => $model, 'name' => $name, 'seconds' => round($seconds, 2), 'error' => $error]);
    }

    /**
     * A picture request: the prompt, the references sent with it (by role), what the director hinted,
     * and the picture that came back.
     *
     * @param  Reference[]  $references
     */
    public function picture(string $provider, string $prompt, array $references, string $aspect, bool $transparent, array $hints, ?string $bytes, float $seconds, ?string $error): void
    {
        if (! $this->dir) {
            return;
        }
        $kind = (string) ($hints['kind'] ?? 'picture');
        $this->call('picture', $kind, [
            'provider' => $provider, 'kind' => $kind, 'label' => $hints['label'] ?? null, 'aspect' => $aspect, 'transparent' => $transparent,
            'seconds' => round($seconds, 2), 'error' => $error, 'hints' => $hints, 'prompt' => $prompt,
            'references' => array_map(fn ($r) => ['role' => $r->role, 'image' => $this->blob($r->bytes, $r->mime)], $references),
            'result' => $bytes !== null ? $this->blob($bytes, 'image/png') : null,
        ], ['provider' => $provider, 'kind' => $kind, 'label' => $hints['label'] ?? null, 'seconds' => round($seconds, 2), 'error' => $error]);
    }

    /** Anything else a step wants to show at its place in the timeline (a critic's review, a choice made). */
    public function note(string $what, array $detail): void
    {
        if ($this->dir) {
            $this->call('note', $what, $detail, ['what' => $what]);
        }
    }

    private function call(string $type, string $what, array $full, array $summary): void
    {
        $n = count($this->index['calls']) + 1;
        $file = sprintf('calls/%04d-%s-%s.json', $n, $type, self::slug($what));
        $this->write($file, ['n' => $n, 'type' => $type, 'step' => $this->current['name'] ?? null, 'at' => gmdate('c')] + $full);
        $this->index['calls'][] = ['n' => $n, 'type' => $type, 'step' => $this->current['name'] ?? null, 'step_n' => $this->current['n'] ?? null, 'file' => $file] + $summary;
        // index.json is saved after every call too, so a run that dies mid-step still shows how far it got.
        $this->save();
    }

    // ------------------------------------------------------------------------------------------------
    // Files

    /** A picture, stored once by its content: the same style anchor sent with fifty requests is one file. */
    private function blob(string $bytes, string $mime): array
    {
        $hash = sha1($bytes);
        $about = ['sha1' => $hash, 'bytes' => strlen($bytes)];
        if ($this->pictures === 'none') {
            return $about;
        }
        $ext = $this->pictures === 'full' ? (str_contains($mime, 'jpeg') ? 'jpg' : 'png') : 'png';
        $file = "blobs/$hash.$ext";
        if (! is_file("$this->dir/$file")) {
            $out = $bytes;
            if ($this->pictures === 'thumb') {
                try {
                    // Small enough to page through quickly, big enough to see what went wrong. PNG keeps transparency.
                    $im = ImageTools::load($bytes);
                    $about['size'] = [imagesx($im), imagesy($im)];
                    if (max(imagesx($im), imagesy($im)) > 512) {
                        $im = ImageTools::fit($im, 512, 512);
                    }
                    $out = ImageTools::png($im);
                } catch (\Throwable) {
                    // Not a picture GD can read: keep it as it came.
                }
            }
            file_put_contents("$this->dir/$file", $out);
        }

        return $about + ['file' => $file];
    }

    private function write(string $file, mixed $value): void
    {
        file_put_contents("$this->dir/$file", json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR));
    }

    private function save(): void
    {
        $this->write('index.json', $this->index);
        file_put_contents("$this->dir/README.md", self::readme($this->index));
    }

    /** The timeline as Markdown: what a developer reads first. */
    public static function readme(array $index): string
    {
        $md = "# Generation trace\n\nMethod: **".($index['method'] ?? '?').'**';
        foreach ($index['sessions'] ?? [] as $i => $s) {
            $md .= $i === 0 ? "\n\nStarted {$s['started_at']}" : "; resumed {$s['started_at']}".($s['method'] !== ($index['sessions'][0]['method'] ?? null) ? " with {$s['method']}" : '');
        }
        $md .= ".\n\n## Steps\n\n| # | Step | Outcome | Time | USD | Calls | Notes |\n|---|---|---|---|---|---|---|\n";
        foreach ($index['steps'] ?? [] as $s) {
            $notes = $s['skipped'] ? 'skipped: '.$s['skipped'] : implode('; ', array_slice($s['notes'] ?? [], 0, 3));
            $md .= sprintf("| %d | [%s](%s) | %s | %.1fs | %.3f | %d | %s |\n", $s['n'], $s['step'], sprintf('steps/%02d-%s.json', $s['n'], self::slug($s['step'])), $s['outcome'], ($s['ms'] ?? 0) / 1000, $s['usd'] ?? 0, count($s['calls'] ?? []), str_replace(['|', "\n"], ['/', ' '], mb_substr($notes, 0, 160)));
        }
        $md .= "\n## Calls\n\n| # | Step | Type | What | Time |\n|---|---|---|---|---|\n";
        foreach ($index['calls'] ?? [] as $c) {
            $what = match ($c['type']) {
                'llm' => "{$c['job']}: {$c['name']} ({$c['model']})",
                'picture' => "{$c['kind']}".(! empty($c['label']) ? ": {$c['label']}" : '')." ({$c['provider']})",
                default => (string) ($c['what'] ?? ''),
            };
            $md .= sprintf("| [%d](%s) | %s | %s | %s%s | %s |\n", $c['n'], $c['file'], $c['step'] ?? '', $c['type'], str_replace('|', '/', $what), ! empty($c['error']) ? ' **failed**' : '', isset($c['seconds']) ? $c['seconds'].'s' : '');
        }

        return $md;
    }

    public static function slug(string $s): string
    {
        return trim(preg_replace('/[^a-z0-9_]+/', '-', strtolower($s)), '-') ?: 'x';
    }
}
