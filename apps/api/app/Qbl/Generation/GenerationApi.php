<?php

namespace App\Qbl\Generation;

use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Entitlements;
use App\Qbl\Generation\Design\DesignRules;
use App\Qbl\StoreError;
use PDO;
use Throwable;

/**
 * The AI mission generator from the editor, under /api/editor/generations. A teacher describes a
 * mission; it costs credits (config/qbl_billing.php), is queued, and is built by a queue worker
 * (App\Jobs\RunGeneration), which takes several minutes. The editor shows its progress (see
 * GenerationProgress) wherever the teacher is, and they can stop it. A run that fails or is
 * stopped gives its credits back. The result is a private draft in the teacher's scenarios.
 *
 * Who: teachers and administrators. Making one needs a plan with the generator (Entitlements: a
 * subscription, an organization's license, an administrator, or billing switched off).
 *
 *   GET   editor/generations              my generations, newest first, what one costs, my plan and credits
 *   POST  editor/generations              {prompt, grade?, subject?, min_players?, max_players?, minutes?, notes?, format?, opening?, focus?, freedom?} -> 202
 *   GET   editor/generations/active       the one being made now (or null): what the editor's progress chip asks
 *   GET   editor/generations/all          administrators: everyone's latest, with who asked and what each spent
 *   GET   editor/generations/{id}         one generation: its status and progress, and the scenario once it is done
 *   GET   editor/generations/{id}/events  administrators: the audit log of the run (every call, picture and stage, with time and cost) and its totals
 *   POST  editor/generations/{id}/cancel  stop it (now if it has not started; else between two pictures)
 */
class GenerationApi
{
    /** Where a run can be while it is going; anything else has finished. */
    public const BUSY = ['queued', 'aligning', 'designing', 'drawing', 'building', 'voicing', 'importing'];

    /**
     * A run that has not moved for this long has lost its worker (the container restarted, say): it
     * is marked failed and its credits given back, so the teacher is not stuck waiting on it. Every
     * picture, line and correction moves it, so a live run never goes this long.
     */
    public const STALE_SECONDS = 1800;

    /**
     * @param  callable(int): void  $enqueue  start the work for a run (dispatch the job)
     * @param  callable(): void|null  $preflight  throws if the generator cannot run on this site (no keys, no style anchors)
     * @param  bool  $voices  whether runs record the characters' voices here (a stage of the progress bar)
     * @param  \Closure|null  $clock  the time, for tests
     */
    public function __construct(
        private PDO $pdo,
        private Entitlements $entitlements,
        private Credits $credits,
        private $enqueue,
        private $preflight = null,
        private bool $voices = false,
        private ?\Closure $clock = null,
    ) {}

    /** @return array{0: int, 1: array|null} */
    public function handle(string $method, array $parts, array $body, ?array $user): array
    {
        try {
            return $this->route(strtoupper($method), array_values($parts), $body, $user);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        if (! \App\Qbl\Roles::isStaff($user['role'] ?? null)) {
            throw new StoreError(403, 'The generator is for teachers.');
        }
        $me = (int) $user['id'];
        $admin = ($user['role'] ?? '') === 'admin';
        $this->sweep();
        if (count($parts) === 0) {
            return match ($method) {
                'GET' => [200, ['generations' => $this->mine($me, $admin), 'cost' => $this->cost(), 'plan' => $this->plan($me), 'now' => $this->now()]],
                'POST' => [202, $this->start($me, $body, $admin)],
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }
        if ($parts === ['active'] && $method === 'GET') {
            $id = $this->column('SELECT id FROM scenario_generations WHERE user_id = ? AND status IN ('.self::marks(self::BUSY).') ORDER BY id DESC LIMIT 1', [$me, ...self::BUSY]);

            return [200, ['generation' => $id ? $this->present($this->one((int) $id), $admin) : null, 'now' => $this->now()]];
        }
        if ($parts === ['all'] && $method === 'GET') {
            if (! $admin) {
                throw new StoreError(403, 'Only an administrator can see everyone\'s generations.');
            }

            return [200, ['generations' => $this->everyone(), 'now' => $this->now()]];
        }
        if (ctype_digit($parts[0] ?? '') && count($parts) <= 2) {
            $run = $this->one((int) $parts[0]);
            if (! $run || ((int) $run['user_id'] !== $me && ! $admin)) {
                throw new StoreError(404, 'No such generation.');
            }
            if (count($parts) === 1 && $method === 'GET') {
                return [200, ['generation' => $this->present($run, $admin), 'now' => $this->now()]];
            }
            if (($parts[1] ?? null) === 'events' && $method === 'GET') {
                if (! $admin) {
                    throw new StoreError(403, 'Only an administrator can see what a generation cost.');
                }
                $events = new GenerationEvents($this->pdo);

                return [200, ['generation' => $this->present($run, true), 'totals' => $events->totals((int) $run['id']), 'events' => $events->forRun((int) $run['id']), 'now' => $this->now()]];
            }
            if (($parts[1] ?? null) === 'cancel' && $method === 'POST') {
                return [200, ['generation' => $this->present($this->cancel($run), $admin), 'credits' => $this->creditsOf((int) $run['user_id']), 'now' => $this->now()]];
            }
        }
        throw new StoreError(404, 'Not found.');
    }

    /** What the page needs to say before anyone types: can they, what it costs, what they have. */
    private function plan(int $me): array
    {
        $plan = $this->entitlements->for($me);

        return [
            'generator' => $plan['generator'], 'plan_name' => $plan['plan_name'], 'source' => $plan['source'],
            'billing' => $plan['billing'], 'credits' => $plan['generator'] ? $this->credits->summary($me) : null,
        ];
    }

    private function cost(): int
    {
        return $this->entitlements->plans()->cost('generation');
    }

    private function creditsOf(?int $userId): ?array
    {
        return $userId && $this->entitlements->for($userId)['generator'] ? $this->credits->summary($userId) : null;
    }

    private function start(int $me, array $body, bool $admin): array
    {
        $plan = $this->entitlements->for($me);
        if (! $plan['generator']) {
            throw new StoreError(402, 'The AI mission generator comes with the Teacher Plus plan. See Plans to start a free trial.');
        }
        $prompt = trim(strip_tags((string) ($body['prompt'] ?? '')));
        if (mb_strlen($prompt) < 12) {
            throw new StoreError(422, 'Say what the mission is about in a sentence or two: the topic, and what students should learn.');
        }
        if (mb_strlen($prompt) > 2000) {
            throw new StoreError(422, 'Keep the description under 2000 characters.');
        }
        if ($this->column('SELECT COUNT(*) FROM scenario_generations WHERE user_id = ? AND status IN ('.self::marks(self::BUSY).')', [$me, ...self::BUSY])) {
            throw new StoreError(409, 'One of your missions is still being made. Start the next one when it is done.');
        }
        $options = self::options($body);
        $cost = $this->cost();
        $credits = $this->credits->summary($me);
        if ($credits['enforced'] && $credits['balance'] < $cost) {
            throw new StoreError(402, "A mission costs $cost credits and you have {$credits['balance']}. More arrive with your plan's next month.");
        }
        if ($this->preflight) {
            try {
                ($this->preflight)();
            } catch (Throwable $e) {
                throw new StoreError(503, 'The generator is not ready on this site: '.$e->getMessage());
            }
        }

        $runs = new GenerationRuns($this->pdo);
        $id = $runs->create($prompt, $options, $me);
        $runs->update($id, ['progress' => ['stage' => 'queued', 'stages' => GenerationProgress::stagesFor($this->voices), 'percent' => 0, 'detail' => GenerationProgress::STAGES['queued'][2], 'done' => null, 'total' => null, 'started_at' => null, 'stage_started_at' => $this->now(), 'updated_at' => $this->now()]]);
        $ref = "generation:$id";
        try {
            $this->credits->spend($me, $cost, $ref, 'Generated a mission: '.mb_substr($prompt, 0, 120));
        } catch (StoreError $e) {
            $this->pdo->prepare('DELETE FROM scenario_generations WHERE id = ?')->execute([$id]);
            throw $e;
        }
        try {
            ($this->enqueue)($id);
        } catch (Throwable $e) {
            self::failed($this->pdo, $this->credits, $id, 'Could not be queued: '.$e->getMessage());
            throw new StoreError(503, 'The generator could not start. Your credits were given back.');
        }

        return ['generation' => $this->present($this->one($id), $admin), 'credits' => $this->credits->summary($me), 'now' => $this->now()];
    }

    /**
     * Stop a run. One still waiting for the worker (or whose worker is gone) stops now; one being
     * made is asked to stop, and does so before its next picture (GenerationProgress::check), when
     * the job marks it cancelled. Either way its credits come back.
     */
    private function cancel(array $run): array
    {
        $id = (int) $run['id'];
        if (! in_array($run['status'], self::BUSY, true)) {
            throw new StoreError(409, $run['status'] === 'done' ? 'It is already made: delete the draft from your scenarios if you do not want it.' : 'It has already stopped.');
        }
        $runs = new GenerationRuns($this->pdo);
        if (! $run['cancelled_at']) {
            $runs->update($id, ['cancelled_at' => gmdate('Y-m-d H:i:s', $this->time())]);
        }
        if ($run['status'] === 'queued' || $this->stale($run)) {
            self::cancelled($this->pdo, $this->credits, $id);
        }

        return $this->one($id);
    }

    /**
     * Mark a run failed and give back what it cost (once). Used by the job when the generator
     * throws, and when the worker gives up on it.
     */
    public static function failed(PDO $pdo, Credits $credits, int $id, string $error): void
    {
        self::settle($pdo, $credits, $id, 'failed', $error, 'Credits back: the mission could not be made');
    }

    /** Mark a run cancelled (by its teacher) and give back what it cost (once). */
    public static function cancelled(PDO $pdo, Credits $credits, int $id): void
    {
        self::settle($pdo, $credits, $id, 'cancelled', 'Stopped: you cancelled it.', 'Credits back: you stopped the mission');
    }

    private static function settle(PDO $pdo, Credits $credits, int $id, string $status, string $error, string $note): void
    {
        $runs = new GenerationRuns($pdo);
        $run = $runs->get($id);
        if (! $run) {
            return;
        }
        if ($run['status'] !== $status || ! $run['error']) {
            $runs->update($id, ['status' => $status, 'error' => mb_substr($error, 0, 4000)]);
        }
        if ($run['user_id'] !== null) {
            $spent = $pdo->prepare("SELECT COALESCE(-SUM(delta), 0) FROM credit_ledger WHERE user_id = ? AND reason = 'spend' AND ref = ?");
            $spent->execute([(int) $run['user_id'], "generation:$id"]);
            $credits->refund((int) $run['user_id'], (int) $spent->fetchColumn(), "generation:$id", $note);
        }
    }

    /** Runs whose worker is gone: failed, credits back (see STALE_SECONDS). */
    private function sweep(): void
    {
        $before = gmdate('Y-m-d H:i:s', $this->time() - self::STALE_SECONDS);
        $st = $this->pdo->prepare('SELECT id, cancelled_at FROM scenario_generations WHERE status IN ('.self::marks(self::BUSY).') AND status <> ? AND updated_at < ?');
        $st->execute([...self::BUSY, 'queued', $before]);
        foreach ($st->fetchAll(PDO::FETCH_ASSOC) as $run) {
            $run['cancelled_at']
                ? self::cancelled($this->pdo, $this->credits, (int) $run['id'])
                : self::failed($this->pdo, $this->credits, (int) $run['id'], 'The generator stopped before the mission was finished (its worker went away). Try again.');
        }
    }

    private function stale(array $run): bool
    {
        return $run['status'] !== 'queued' && strtotime($run['updated_at'].' UTC') < $this->time() - self::STALE_SECONDS;
    }

    /** The teacher's form, as the generator's options. */
    public static function options(array $body): array
    {
        $min = max(1, min(8, (int) ($body['min_players'] ?? 2)));
        $max = max($min, min(8, (int) ($body['max_players'] ?? max($min, 6))));
        $text = fn ($k, $n) => isset($body[$k]) && trim((string) $body[$k]) !== '' ? mb_substr(trim(strip_tags((string) $body[$k])), 0, $n) : null;
        $grade = $text('grade', 8);
        if ($grade !== null && ! preg_match('/^(K|PK|\d{1,2})(-(K|\d{1,2}))?$/i', $grade)) {
            throw new StoreError(422, 'The grade is K, 1 to 12, or a range such as 6-8.');
        }

        return array_filter([
            'grade' => $grade === null ? null : strtoupper($grade),
            'subject' => $text('subject', 60),
            'min_players' => $min,
            'max_players' => $max,
            'minutes' => isset($body['minutes']) && is_numeric($body['minutes']) ? max(5, min(120, (int) $body['minutes'])) : null,
            'notes' => $text('notes', 1000),
            // A mission to play or a story to watch; absent: as the request reads.
            'format' => in_array($body['format'] ?? null, ['mission', 'story'], true) ? $body['format'] : null,
            // How the design rules' tensions lean (opening, focus, freedom); absent: chosen for the request while aligning.
        ] + DesignRules::chosen($body), fn ($v) => $v !== null);
    }

    private function mine(int $me, bool $admin): array
    {
        $st = $this->pdo->prepare('SELECT id FROM scenario_generations WHERE user_id = ? ORDER BY id DESC LIMIT 30');
        $st->execute([$me]);

        return array_map(fn ($id) => $this->present($this->one((int) $id), $admin), $st->fetchAll(PDO::FETCH_COLUMN));
    }

    private function everyone(): array
    {
        $st = $this->pdo->query('SELECT g.id, u.name, u.email FROM scenario_generations g LEFT JOIN users u ON u.id = g.user_id ORDER BY g.id DESC LIMIT 50');

        return array_map(fn ($r) => $this->present($this->one((int) $r['id']), true) + ['user' => ['name' => $r['name'], 'email' => $r['email']]], $st->fetchAll(PDO::FETCH_ASSOC));
    }

    private function one(int $id): ?array
    {
        return (new GenerationRuns($this->pdo))->get($id);
    }

    /**
     * A run as the page shows it: not the blueprint or the picture manifest. What it has spent on AI
     * services is for administrators only (teachers pay in credits).
     */
    private function present(array $run, bool $admin = false): array
    {
        $busy = in_array($run['status'], self::BUSY, true);
        $progress = (array) ($run['progress'] ?? []) + ['stage' => $run['status'], 'stages' => GenerationProgress::stagesFor($this->voices), 'percent' => 0, 'detail' => null, 'done' => null, 'total' => null, 'started_at' => null, 'stage_started_at' => null];
        if ($run['status'] === 'done') {
            $progress['percent'] = 100;
        }
        $usd = $progress['usd'] ?? null;
        unset($progress['usd']);

        return [
            'id' => (int) $run['id'], 'prompt' => $run['prompt'], 'status' => $run['status'], 'busy' => $busy,
            'cancelling' => $busy && ! empty($run['cancelled_at']),
            'title' => $run['blueprint']['title'] ?? null, 'scenario_id' => $run['scenario_id'] === null ? null : (int) $run['scenario_id'],
            'options' => (array) $run['options'], 'approach' => self::approach($run), 'error' => $run['error'] ?? null, 'progress' => $progress,
            'created_at' => self::iso($run['created_at']), 'updated_at' => self::iso($run['updated_at']),
        ] + ($admin ? ['usd' => $usd] : []);
    }

    /**
     * How the mission leans on the design rules (DesignRules), once it is aligned: the teacher's choices,
     * and what was chosen for them where they left "Choose for me". Null before then. A story has only
     * the settings that apply to stories.
     */
    private static function approach(array $run): ?array
    {
        if (empty($run['alignment'])) {
            return null;
        }
        $options = (array) $run['options'];
        $approach = (array) ($run['blueprint']['approach'] ?? null) ?: DesignRules::approach($options, (array) ($run['alignment']['approach'] ?? []));
        if (($options['format'] ?? null) === 'story') {
            $approach = array_intersect_key($approach, array_filter(DesignRules::SETTINGS, fn ($s) => $s['stories']));
        }

        return $approach;
    }

    private function column(string $sql, array $args): mixed
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);

        return $st->fetchColumn();
    }

    private static function marks(array $values): string
    {
        return implode(', ', array_fill(0, count($values), '?'));
    }

    /** Stored as UTC "Y-m-d H:i:s"; sent with its zone, so the browser reads it right. */
    private static function iso(?string $at): ?string
    {
        return $at === null ? null : gmdate('Y-m-d\TH:i:s\Z', (int) strtotime($at.' UTC'));
    }

    private function time(): int
    {
        return $this->clock ? ($this->clock)() : time();
    }

    private function now(): string
    {
        return gmdate('Y-m-d\TH:i:s\Z', $this->time());
    }
}
