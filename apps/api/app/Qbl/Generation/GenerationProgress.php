<?php

namespace App\Qbl\Generation;

/**
 * How far one run of the generator has got, kept on its row (scenario_generations.progress) for the
 * editor's progress bar:
 *
 *   {stage, stages, percent, detail, done, total, started_at, stage_started_at, updated_at, usd?}
 *
 * Each stage owns a slice of the bar (STAGES), weighted by how long it usually takes: drawing is
 * most of it. Inside a stage the generator reports a fraction (designing: the first draft, then each
 * correction) or a count (drawing: pictures; voicing: lines). The bar never goes backwards.
 *
 * Every report also checks whether the teacher has asked to stop: if so it throws
 * GenerationCancelled, which ends the run between two pictures (nothing half-drawn is kept).
 */
class GenerationProgress
{
    /** Stage => [start %, end %, what the teacher is told]. Voicing is only there when voices are set up. */
    public const STAGES = [
        'queued' => [0, 1, 'Waiting for the generator'],
        'aligning' => [1, 6, 'Choosing the curriculum standards'],
        'designing' => [6, 26, 'Writing the story, scenes and questions'],
        'drawing' => [26, 88, 'Drawing the pictures'],
        'building' => [88, 91, 'Building the scenes and events'],
        'voicing' => [91, 98, 'Recording the characters\' voices'],
        'importing' => [98, 100, 'Saving it as your draft'],
    ];

    private array $state;

    /**
     * @param  string[]  $stages  the stages this run goes through, in order
     * @param  \Closure|null  $usd  what the run has spent so far (for administrators)
     * @param  \Closure|null  $clock  the time, for tests
     */
    public function __construct(
        private GenerationRuns $runs,
        private int $id,
        array $stages,
        private ?\Closure $usd = null,
        private ?\Closure $clock = null,
    ) {
        $now = $this->now();
        $saved = (array) ($runs->get($id)['progress'] ?? []);
        $this->state = [
            'stage' => $saved['stage'] ?? 'queued', 'stages' => array_values($stages), 'percent' => (float) ($saved['percent'] ?? 0),
            'detail' => $saved['detail'] ?? null, 'done' => null, 'total' => null,
            // A resumed run keeps the time it first started.
            'started_at' => $saved['started_at'] ?? $now, 'stage_started_at' => $now, 'updated_at' => $now,
        ];
    }

    /** The stages a run goes through. */
    public static function stagesFor(bool $voices): array
    {
        return array_values(array_filter(array_keys(self::STAGES), fn ($s) => $s !== 'queued' && ($voices || $s !== 'voicing')));
    }

    /** A new stage starts (the run's status changes with it). */
    public function stage(string $stage, ?string $detail = null, ?int $total = null): void
    {
        $this->check();
        $this->state['stage'] = $stage;
        $this->state['stage_started_at'] = $this->now();
        $this->state['detail'] = $detail ?? (self::STAGES[$stage][2] ?? null);
        $this->state['done'] = $total !== null ? 0 : null;
        $this->state['total'] = $total;
        $this->save($stage, 0.0);
    }

    /** Some of the stage is done: a fraction from 0 to 1. */
    public function fraction(float $fraction, ?string $detail = null): void
    {
        $this->check();
        if ($detail !== null) {
            $this->state['detail'] = $detail;
        }
        $this->save(null, $fraction);
    }

    /** `$done` of `$total` things are done (pictures, lines); `$detail` says what is being done now. */
    public function count(int $done, ?int $total = null, ?string $detail = null): void
    {
        $this->check();
        $total ??= $this->state['total'];
        $this->state['total'] = $total;
        $this->state['done'] = $total ? min($done, $total) : $done;
        if ($detail !== null) {
            $this->state['detail'] = $detail;
        }
        $this->save(null, $total ? min(1, $done / $total) : 0.0);
    }

    /** Stop here if the teacher asked to: the run is marked cancelled and its credits given back. */
    public function check(): void
    {
        if ($this->runs->cancelRequested($this->id)) {
            throw new GenerationCancelled('Stopped: you cancelled it.');
        }
    }

    public function snapshot(): array
    {
        return $this->state;
    }

    /** The whole run's percent, from a stage and how far through it is. */
    public static function percent(string $stage, float $fraction): float
    {
        [$from, $to] = self::STAGES[$stage] ?? [0, 100];

        return round($from + ($to - $from) * max(0, min(1, $fraction)), 1);
    }

    private function save(?string $status, float $fraction): void
    {
        $this->state['percent'] = max($this->state['percent'], self::percent($this->state['stage'], $fraction));
        $this->state['updated_at'] = $this->now();
        if ($this->usd) {
            $this->state['usd'] = round((float) ($this->usd)(), 2);
        }
        $this->runs->update($this->id, ($status ? ['status' => $status] : []) + ['progress' => $this->state]);
    }

    private function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', $this->clock ? ($this->clock)() : time());
    }
}
