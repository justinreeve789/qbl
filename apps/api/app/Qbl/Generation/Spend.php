<?php

namespace App\Qbl\Generation;

/**
 * What a generation run has spent on AI services, as it goes, and how much it may spend.
 *
 * Every language-model call reports its token usage and every picture drawn reports its model and
 * size; this prices them from a table of list prices (USD) and keeps a running total for the run in
 * its work folder (spend.json), so a resumed run carries on counting. The figures are estimates from
 * list prices, not a bill.
 *
 * The budget is soft: once a run has spent it, pictures are no longer redrawn to get a better score
 * (the best so far is kept and flagged) and extras (gesture animations) are skipped, but everything
 * the mission needs is still made. At twice the budget the run stops, and can be resumed with a
 * higher budget (`qbl:generate --resume=ID --budget=...`).
 */
class Spend
{
    /**
     * List prices in USD. Language models per million tokens: input, output, cache_read, cache_write
     * (5-minute writes). Pictures per picture, by "model@size" or "model". Override or add with
     * QBL_GEN_PRICES (JSON of the same shape).
     */
    public const PRICES = [
        'claude-opus-5-5' => ['input' => 4.0, 'output' => 20.0, 'cache_read' => 0.20, 'cache_write' => 5.0],
        'claude-sonnet-5-5' => ['input' => 2.0, 'output' => 10.0, 'cache_read' => 0.10, 'cache_write' => 2.50],
        'claude-haiku-5-5' => ['input' => 0.10, 'output' => 0.50, 'cache_read' => 0.01, 'cache_write' => 0.125],
        'gemini-3-pro-image@1K' => 0.134,
        'gemini-3-pro-image@2K' => 0.134,
        'gemini-3-pro-image@4K' => 0.24,
        'gemini-3.1-flash-image@512' => 0.045,
        'gemini-3.1-flash-image@1K' => 0.067,
        'gemini-3.1-flash-image@2K' => 0.101,
        'gemini-3.1-flash-image@4K' => 0.151,
        'gpt-image-2' => 0.17,
        'scenario' => 0.05,
        // AutoSprite, per animation, by video tier: its credits (turbo 5, pro 15, max 35, ultra 10 a second,
        // so 20 for two) at the Pro plan's ~$0.019 a credit ($29 for 1,500). Uploading a character is free.
        'autosprite@turbo' => 0.095,
        'autosprite@pro' => 0.285,
        'autosprite@max' => 0.665,
        'autosprite@ultra' => 0.38,
    ];

    /** A picture from a model not in the table is counted at this. */
    public const UNKNOWN_PICTURE = 0.15;

    /** Input images Gemini reads, per reference image, in tokens; and its text input price per million. */
    private const GEMINI_INPUT = ['tokens_per_image' => 1120, 'per_million' => 2.0];

    private array $prices;

    private ?string $file = null;

    /** @var array{total: float, llm: array<string, array>, images: array<string, array>} */
    private array $ledger = ['total' => 0.0, 'llm' => [], 'images' => []];

    /** Where each call is also written for auditing (generation_events), and what it is part of. */
    private ?GenerationEvents $events = null;

    private int $run = 0;

    private ?string $stage = null;

    /** @var array{step: string, attempt: ?int, label: ?string}|null the picture being worked on */
    private ?array $at = null;

    /**
     * @param  float  $budget  USD; 0 for no budget.
     * @param  array  $prices  Added to and overriding PRICES.
     */
    public function __construct(private float $budget = 0.0, array $prices = [])
    {
        $this->prices = array_replace(self::PRICES, $prices);
    }

    /** Count into this run's file, starting from what it already holds (a resumed run). */
    public function attach(string $file): void
    {
        $this->file = $file;
        $this->ledger = ['total' => 0.0, 'llm' => [], 'images' => []];
        if (is_file($file) && is_array($saved = json_decode((string) file_get_contents($file), true))) {
            $this->ledger = array_replace($this->ledger, array_intersect_key($saved, $this->ledger));
        }
    }

    public function setBudget(float $budget): void
    {
        $this->budget = max(0.0, $budget);
    }

    public function budget(): float
    {
        return $this->budget;
    }

    /** Write every call to this run's audit log (generation_events); null stops. */
    public function logTo(?GenerationEvents $events, int $run = 0): void
    {
        $this->events = $events;
        $this->run = $run;
        $this->stage = null;
        $this->at = null;
    }

    /** The stage the run is in: calls are logged under it. Moving on forgets the picture being worked on. */
    public function stage(?string $stage): void
    {
        $this->stage = $stage;
        $this->at = null;
    }

    /**
     * What the next calls are for: this picture (by its key), this attempt at it. A picture's judge call
     * is logged with the picture it judges. Null clears it.
     */
    public function at(?string $step, ?int $attempt = null, ?string $label = null): void
    {
        $this->at = $step === null ? null : ['step' => $step, 'attempt' => $attempt, 'label' => $label];
    }

    /** What came of the attempts at a picture, for the audit log (see GenerationEvents::attempts). */
    public function attempts(string $step, array $attempts, ?int $kept, ?string $note = null): void
    {
        $this->events?->attempts($this->run, $step, $attempts, $kept, $note);
    }

    /** An extra event for the audit log (the picture estimate, say), under the current stage. */
    public function note(array $event): void
    {
        $this->events?->record($this->run, $event + ['stage' => $this->stage]);
    }

    public function total(): float
    {
        return round((float) $this->ledger['total'], 4);
    }

    /** Whether the run has spent its budget: no more redraws or extras. */
    public function over(): bool
    {
        return $this->budget > 0 && $this->ledger['total'] >= $this->budget;
    }

    /** At twice the budget, the run stops. */
    public function checkLimit(string $doing): void
    {
        if ($this->budget > 0 && $this->ledger['total'] >= 2 * $this->budget) {
            throw new GenerationError(sprintf('Stopped before %s: this run has spent about $%.2f, twice its budget of $%.2f. Resume it with a higher budget (--budget=...) to finish.', $doing, $this->total(), $this->budget));
        }
    }

    /**
     * A language-model call, from the Messages API's usage block.
     *
     * @param  array{input_tokens?: int, output_tokens?: int, cache_read_input_tokens?: int, cache_creation_input_tokens?: int}  $usage
     */
    public function llm(string $model, string $purpose, array $usage, ?float $seconds = null, ?string $stopReason = null): float
    {
        $p = $this->prices[$model] ?? $this->prices[self::family($model)] ?? null;
        $tokens = [
            'input' => (int) ($usage['input_tokens'] ?? 0),
            'output' => (int) ($usage['output_tokens'] ?? 0),
            'cache_read' => (int) ($usage['cache_read_input_tokens'] ?? 0),
            'cache_write' => (int) ($usage['cache_creation_input_tokens'] ?? 0),
        ];
        $cost = 0.0;
        if (is_array($p)) {
            foreach ($tokens as $k => $n) {
                $cost += $n * (float) ($p[$k] ?? $p['input'] ?? 0) / 1e6;
            }
        }
        $row = &$this->ledger['llm']["$model $purpose"];
        $row ??= ['calls' => 0, 'input' => 0, 'output' => 0, 'cache_read' => 0, 'cache_write' => 0, 'usd' => 0.0];
        $row['calls']++;
        foreach ($tokens as $k => $n) {
            $row[$k] += $n;
        }
        $row['usd'] = round($row['usd'] + $cost, 5);
        unset($row);
        $this->events?->record($this->run, [
            'stage' => $this->stage, 'type' => 'llm', 'kind' => $purpose, 'step' => $this->at['step'] ?? $purpose, 'label' => $this->at['label'] ?? null,
            'attempt' => $this->at['attempt'] ?? null, 'model' => $model, 'seconds' => $seconds,
            'input_tokens' => $tokens['input'], 'output_tokens' => $tokens['output'], 'cache_read_tokens' => $tokens['cache_read'], 'cache_write_tokens' => $tokens['cache_write'],
            'usd' => round($cost, 5), 'outcome' => match ($stopReason) { 'max_tokens' => 'truncated', 'refusal' => 'refused', default => 'ok' },
            'detail' => array_filter(['stop_reason' => $stopReason ?: null, 'priced' => is_array($p)], fn ($v) => $v !== null),
        ]);

        return $this->add($cost);
    }

    /** A language-model call that failed (no usage to price): logged for the audit, nothing is added to the spend. */
    public function llmFailed(string $model, string $purpose, ?float $seconds, string $why): void
    {
        $this->events?->record($this->run, [
            'stage' => $this->stage, 'type' => 'llm', 'kind' => $purpose, 'step' => $this->at['step'] ?? $purpose, 'label' => $this->at['label'] ?? null,
            'attempt' => $this->at['attempt'] ?? null, 'model' => $model, 'seconds' => $seconds, 'outcome' => 'error', 'note' => $why,
        ]);
    }

    /** A picture drawn (whether or not it is kept), with how many reference images were sent. */
    public function picture(string $model, ?string $size, string $kind, int $references = 0, ?float $seconds = null, string $outcome = 'ok', ?string $why = null): float
    {
        $cost = $this->pictureWithReferences($model, $size, $references);
        $key = $model.($size ? "@$size" : '');
        $row = &$this->ledger['images'][$key];
        $row ??= ['pictures' => 0, 'usd' => 0.0, 'kinds' => []];
        $row['pictures']++;
        $row['kinds'][$kind] = ($row['kinds'][$kind] ?? 0) + 1;
        $row['usd'] = round($row['usd'] + $cost, 5);
        unset($row);
        $this->events?->record($this->run, [
            'stage' => $this->stage, 'type' => 'picture', 'kind' => $kind, 'step' => $this->at['step'] ?? $kind, 'label' => $this->at['label'] ?? null,
            'attempt' => $this->at['attempt'] ?? null, 'model' => $model, 'size' => $size, 'references' => $references, 'seconds' => $seconds,
            'usd' => round($cost, 5), 'outcome' => $outcome, 'note' => $why,
        ]);

        return $this->add($cost);
    }

    /** What drawing one picture costs with this many reference images sent along. */
    public function pictureWithReferences(string $model, ?string $size, int $references): float
    {
        return $this->pictureCost($model, $size) + ($this->isGemini($model) ? $references * self::GEMINI_INPUT['tokens_per_image'] * self::GEMINI_INPUT['per_million'] / 1e6 : 0);
    }

    /** The list price of one picture. Free for the placeholder. */
    public function pictureCost(string $model, ?string $size): float
    {
        if (in_array($model, ['placeholder', 'offline'], true)) {
            return 0.0;
        }
        $price = $this->prices[$model.($size ? "@$size" : '')] ?? $this->prices[$model] ?? $this->prices[self::family($model).($size ? "@$size" : '')] ?? null;

        return is_numeric($price) ? (float) $price : self::UNKNOWN_PICTURE;
    }

    /** The token prices of a language model, or null if unknown. */
    public function llmPrices(string $model): ?array
    {
        $p = $this->prices[$model] ?? $this->prices[self::family($model)] ?? null;

        return is_array($p) ? $p : null;
    }

    /** @return array{total: float, budget: float, llm: array, images: array} */
    public function summary(): array
    {
        return ['total' => $this->total(), 'budget' => $this->budget] + array_intersect_key($this->ledger, ['llm' => 1, 'images' => 1]);
    }

    /** "about $2.31 (pictures $1.90, language model $0.41)" */
    public function describe(): string
    {
        $images = array_sum(array_column($this->ledger['images'], 'usd'));
        $llm = array_sum(array_column($this->ledger['llm'], 'usd'));
        $pictures = array_sum(array_column($this->ledger['images'], 'pictures'));

        return sprintf('about $%.2f (%d pictures drawn, $%.2f; language model, $%.2f)%s', $this->total(), $pictures, $images, $llm, $this->budget > 0 ? sprintf('; budget $%.2f', $this->budget) : '');
    }

    private function add(float $cost): float
    {
        $this->ledger['total'] = round($this->ledger['total'] + $cost, 5);
        if ($this->file) {
            file_put_contents($this->file, json_encode($this->summary(), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
        }

        return $cost;
    }

    private function isGemini(string $model): bool
    {
        return str_starts_with($model, 'gemini');
    }

    /** "claude-opus-5-5-20261001" → "claude-opus-5-5"; "gemini-3-pro-image-preview" → "gemini-3-pro-image". */
    private static function family(string $model): string
    {
        return (string) preg_replace(['/-\d{8}$/', '/-preview$/'], '', $model);
    }
}
