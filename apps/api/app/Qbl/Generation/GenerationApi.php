<?php

namespace App\Qbl\Generation;

use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Entitlements;
use App\Qbl\StoreError;
use PDO;
use Throwable;

/**
 * The AI mission generator from the editor, under /api/editor/generations. A teacher describes a
 * mission; it costs credits (config/qbl_billing.php), is queued, and is built by a queue worker
 * (App\Jobs\RunGeneration), which takes several minutes. The page asks how it is going. A run
 * that fails gives its credits back. The result is a private draft in the teacher's scenarios.
 *
 *   GET   editor/generations        my generations, newest first
 *   POST  editor/generations        {prompt, grade?, subject?, min_players?, max_players?, minutes?, notes?} -> 202
 *   GET   editor/generations/{id}   one generation: its status, and the scenario once it is done
 */
class GenerationApi
{
    /** Where a run can be while it is going; anything else has finished. */
    public const BUSY = ['queued', 'aligning', 'designing', 'drawing', 'building'];

    /**
     * @param  callable(int): void  $enqueue  start the work for a run (dispatch the job)
     * @param  callable(): void|null  $preflight  throws if the generator cannot run on this site (no keys, no style anchors)
     */
    public function __construct(
        private PDO $pdo,
        private Entitlements $entitlements,
        private Credits $credits,
        private $enqueue,
        private $preflight = null,
    ) {}

    /** @return array{0: int, 1: array|null} */
    public function handle(string $method, array $parts, array $body, ?array $user): array
    {
        try {
            return $this->route(strtoupper($method), $parts, $body, $user);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, array $parts, array $body, ?array $user): array
    {
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        if (! in_array($user['role'] ?? '', ['teacher', 'admin'], true)) {
            throw new StoreError(403, 'The generator is for teachers.');
        }
        $me = (int) $user['id'];
        if (count($parts) === 0) {
            return match ($method) {
                'GET' => [200, ['generations' => $this->mine($me), 'cost' => $this->entitlements->plans()->cost('generation'), 'plan' => $this->plan($me)]],
                'POST' => [202, ['generation' => $this->start($me, $body)]],
                default => throw new StoreError(405, 'Method not allowed.'),
            };
        }
        if (count($parts) === 1 && ctype_digit($parts[0]) && $method === 'GET') {
            $run = $this->one((int) $parts[0]);
            if (! $run || ((int) $run['user_id'] !== $me && ($user['role'] ?? '') !== 'admin')) {
                throw new StoreError(404, 'No such generation.');
            }

            return [200, ['generation' => self::present($run)]];
        }
        throw new StoreError(404, 'Not found.');
    }

    /** What the page needs to say before anyone types: can they, what it costs, what they have. */
    private function plan(int $me): array
    {
        $plan = $this->entitlements->for($me);

        return ['generator' => $plan['generator'], 'plan_name' => $plan['plan_name'], 'credits' => $plan['generator'] ? $this->credits->summary($me) : null];
    }

    private function start(int $me, array $body): array
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
        $busy = $this->pdo->prepare('SELECT COUNT(*) FROM scenario_generations WHERE user_id = ? AND status IN ('.implode(', ', array_fill(0, count(self::BUSY), '?')).')');
        $busy->execute([$me, ...self::BUSY]);
        if ((int) $busy->fetchColumn() > 0) {
            throw new StoreError(409, 'One of your missions is still being made. Start the next one when it is done.');
        }
        if ($this->preflight) {
            try {
                ($this->preflight)();
            } catch (Throwable $e) {
                throw new StoreError(503, 'The generator is not ready on this site: '.$e->getMessage());
            }
        }
        $options = self::options($body);

        $runs = new GenerationRuns($this->pdo);
        $id = $runs->create($prompt, $options, $me);
        $ref = "generation:$id";
        try {
            $this->credits->spend($me, $this->entitlements->plans()->cost('generation'), $ref, 'Generated a mission: '.mb_substr($prompt, 0, 120));
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

        return self::present($this->one($id));
    }

    /**
     * Mark a run failed and give back what it cost (once). Used by the job when the generator
     * throws, and when the worker gives up on it.
     */
    public static function failed(PDO $pdo, Credits $credits, int $id, string $error): void
    {
        $run = (new GenerationRuns($pdo))->get($id);
        if (! $run) {
            return;
        }
        if ($run['status'] !== 'failed' || ! $run['error']) {
            (new GenerationRuns($pdo))->update($id, ['status' => 'failed', 'error' => mb_substr($error, 0, 4000)]);
        }
        if ($run['user_id'] !== null) {
            $spent = $pdo->prepare("SELECT COALESCE(-SUM(delta), 0) FROM credit_ledger WHERE user_id = ? AND reason = 'spend' AND ref = ?");
            $spent->execute([(int) $run['user_id'], "generation:$id"]);
            $credits->refund((int) $run['user_id'], (int) $spent->fetchColumn(), "generation:$id", 'Credits back: the mission could not be made');
        }
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
        ], fn ($v) => $v !== null);
    }

    private function mine(int $me): array
    {
        $st = $this->pdo->prepare('SELECT id FROM scenario_generations WHERE user_id = ? ORDER BY id DESC LIMIT 30');
        $st->execute([$me]);

        return array_map(fn ($id) => self::present($this->one((int) $id)), $st->fetchAll(PDO::FETCH_COLUMN));
    }

    private function one(int $id): ?array
    {
        return (new GenerationRuns($this->pdo))->get($id);
    }

    /** A run as the page shows it: not the blueprint or the picture manifest. */
    private static function present(array $run): array
    {
        $title = $run['blueprint']['title'] ?? null;

        return [
            'id' => (int) $run['id'], 'prompt' => $run['prompt'], 'status' => $run['status'], 'busy' => in_array($run['status'], self::BUSY, true),
            'title' => $title, 'scenario_id' => $run['scenario_id'] === null ? null : (int) $run['scenario_id'],
            'options' => (array) $run['options'], 'error' => $run['error'] ?? null,
            'created_at' => $run['created_at'], 'updated_at' => $run['updated_at'],
        ];
    }
}
