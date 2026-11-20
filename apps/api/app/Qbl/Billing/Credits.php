<?php

namespace App\Qbl\Billing;

use App\Qbl\Api\Sql;
use App\Qbl\StoreError;
use PDO;

/**
 * AI generator credits. A plan with the generator grants credits at the start of each billing
 * month. What is left of last month carries over, up to the plan's carry-over limit; the rest
 * expires as the new month's credits arrive:
 *
 *     new balance = min(balance, carry-over limit) + monthly credits
 *
 * The refill is lazy: whenever an account's credits are read, the balance is brought up to its
 * current period first (the period comes from Entitlements: a Stripe billing period, the free
 * trial, or the calendar month for an organization's license). So no scheduled job is needed,
 * and an account that has not been used for three months gets one month's credits, not three.
 *
 * Every change goes in credit_ledger. Spending is one conditional UPDATE, so two generations
 * started at once cannot spend the same credits.
 */
class Credits
{
    use Sql;

    public function __construct(PDO $pdo, private Entitlements $entitlements)
    {
        $this->pdo = $pdo;
    }

    /**
     * The account's credits now (after any refill due).
     *
     * @return array{enforced: bool, balance: int, monthly: int, carryover: int, period_key: ?string, trial: bool}
     */
    public function summary(int $userId): array
    {
        $plan = $this->entitlements->for($userId);

        return [
            'enforced' => $plan['credits_enforced'],
            'balance' => $this->refill($userId, $plan),
            'monthly' => $plan['monthly_credits'],
            'carryover' => $plan['credit_carryover'],
            'period_key' => $plan['period_key'],
            'trial' => $plan['trial'],
        ];
    }

    /** Bring the balance up to the plan's current period, once per period. @return int the balance */
    public function refill(int $userId, ?array $plan = null): int
    {
        $plan ??= $this->entitlements->for($userId);
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $account = $this->account($userId);
            $key = $plan['period_key'];
            if ($key === null || $plan['monthly_credits'] <= 0 || $account['period_key'] === $key) {
                return $account['balance'];
            }
            $carried = min($account['balance'], max(0, $plan['credit_carryover']));
            $expired = max(0, $account['balance'] - $carried);
            $balance = $carried + $plan['monthly_credits'];
            // Only if nothing changed the account since it was read; otherwise read it again.
            $done = $this->run('UPDATE credit_accounts SET balance = ?, period_key = ?, updated_at = ? WHERE user_id = ? AND balance = ? AND COALESCE(period_key, \'\') = ?',
                [$balance, $key, self::now(), $userId, $account['balance'], $account['period_key'] ?? '']);
            if ($done === 1) {
                if ($expired > 0) {
                    $this->log($userId, -$expired, $carried, 'expire', $key, "Unused credits above the carry-over limit of {$plan['credit_carryover']}");
                }
                $this->log($userId, $plan['monthly_credits'], $balance, 'grant', $key, $plan['trial'] ? 'Free trial credits' : "Monthly credits ({$plan['plan_name']})");

                return $balance;
            }
        }

        return $this->account($userId)['balance'];
    }

    /**
     * Take credits for something (a generation). Free of charge where credits are not counted
     * (billing off, administrators). @return int what was taken: refund exactly that if it fails
     */
    public function spend(int $userId, int $amount, string $ref, string $note): int
    {
        $plan = $this->entitlements->for($userId);
        if (! $plan['credits_enforced'] || $amount <= 0) {
            return 0;
        }
        $balance = $this->refill($userId, $plan);
        $taken = $this->run('UPDATE credit_accounts SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?', [$amount, self::now(), $userId, $amount]);
        if ($taken !== 1) {
            throw new StoreError(402, $plan['generator']
                ? "This needs $amount credits and you have $balance. ".($plan['monthly_credits'] > 0 ? 'More arrive at the start of your next billing month.' : '')
                : 'The AI mission generator comes with the Teacher Plus plan.');
        }
        $this->log($userId, -$amount, $this->account($userId)['balance'], 'spend', $ref, $note);

        return $amount;
    }

    /** Give back what `$ref` spent (a generation that failed): never more than it spent, however often asked. */
    public function refund(int $userId, int $amount, string $ref, string $note): void
    {
        $sums = $this->one("SELECT COALESCE(SUM(CASE WHEN reason = 'spend' THEN -delta ELSE 0 END), 0) AS spent, COALESCE(SUM(CASE WHEN reason = 'refund' THEN delta ELSE 0 END), 0) AS back FROM credit_ledger WHERE user_id = ? AND ref = ?", [$userId, $ref]);
        $amount = min($amount, (int) $sums['spent'] - (int) $sums['back']);
        if ($amount <= 0) {
            return;
        }
        $this->account($userId);
        $this->run('UPDATE credit_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?', [$amount, self::now(), $userId]);
        $this->log($userId, $amount, $this->account($userId)['balance'], 'refund', $ref, $note);
    }

    /** An administrator's change (a goodwill top-up, a correction). Never below zero. */
    public function adjust(int $userId, int $delta, string $note): int
    {
        $balance = $this->refill($userId);
        $delta = max(-$balance, $delta);
        $this->run('UPDATE credit_accounts SET balance = balance + ?, updated_at = ? WHERE user_id = ?', [$delta, self::now(), $userId]);
        $after = $this->account($userId)['balance'];
        $this->log($userId, $delta, $after, 'adjust', null, mb_substr($note, 0, 255));

        return $after;
    }

    /** The most recent changes, newest first. */
    public function ledger(int $userId, int $limit = 50): array
    {
        return array_map(fn ($r) => [
            'delta' => (int) $r['delta'], 'balance_after' => (int) $r['balance_after'], 'reason' => $r['reason'], 'ref' => $r['ref'], 'note' => $r['note'], 'at' => self::iso($r['created_at']),
        ], $this->all('SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT '.max(1, min(500, $limit)), [$userId]));
    }

    /** @return array{balance: int, period_key: ?string} the account's row, made at zero the first time */
    private function account(int $userId): array
    {
        $row = $this->one('SELECT balance, period_key FROM credit_accounts WHERE user_id = ?', [$userId]);
        if (! $row) {
            try {
                $this->run('INSERT INTO credit_accounts (user_id, balance, period_key, created_at, updated_at) VALUES (?, 0, NULL, ?, ?)', [$userId, self::now(), self::now()]);
            } catch (\PDOException) {
                // Made by another request a moment ago.
            }
            $row = $this->one('SELECT balance, period_key FROM credit_accounts WHERE user_id = ?', [$userId]);
        }

        return ['balance' => (int) $row['balance'], 'period_key' => $row['period_key']];
    }

    private function log(int $userId, int $delta, int $after, string $reason, ?string $ref, ?string $note): void
    {
        $this->run('INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [$userId, $delta, $after, $reason, $ref === null ? null : mb_substr($ref, 0, 64), $note, self::now()]);
    }

    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `credit_accounts` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER UNIQUE, `balance` INTEGER DEFAULT 0, `period_key`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `credit_ledger` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER, `delta` INTEGER, `balance_after` INTEGER, `reason`, `ref`, `note`, `created_at`)',
            'CREATE TABLE IF NOT EXISTS `subscriptions` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `user_id` INTEGER UNIQUE, `stripe_customer_id` UNIQUE, `stripe_subscription_id`, `plan`, `status`, `trial_ends_at`, `current_period_start`, `current_period_end`, `cancel_at_period_end` INTEGER DEFAULT 0, `trial_used_at`, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `stripe_events` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `event_id` UNIQUE, `type`, `created_at`)',
        ];
    }
}
