<?php

namespace App\Qbl\Billing;

use App\Qbl\Api\Sql;
use App\Qbl\ClassStore;
use App\Qbl\StoreError;
use PDO;

/**
 * What an account may do, from its plan:
 *
 *   - curricular   play and assign the curricular missions (a scenario whose settings.tier is
 *                  "curricular"); everyone may play the free ones
 *   - generator    use the AI mission generator, paying in credits
 *   - students     how many students a teacher may have (null: no limit)
 *
 * A plan comes from the account's Stripe subscription (trialing, active, or past due while Stripe
 * retries the card), and from its organization's license (a school's or district's custom plan).
 * With both, the account gets the better of each. QBL administrators may do everything, and with
 * billing turned off so may everyone.
 */
class Entitlements
{
    use Sql;

    /** Subscription states that give the plan. past_due keeps it while Stripe retries the payment. */
    public const ACTIVE = ['trialing', 'active', 'past_due'];

    public function __construct(PDO $pdo, private Plans $plans)
    {
        $this->pdo = $pdo;
    }

    public function plans(): Plans
    {
        return $this->plans;
    }

    /**
     * @return array{billing: bool, plan: string, plan_name: string, source: string, curricular: bool, generator: bool,
     *               students: ?int, credits_enforced: bool, monthly_credits: int, credit_carryover: int,
     *               period_key: ?string, trial: bool, subscription: ?array, organization: ?array}
     */
    public function for(?int $userId): array
    {
        $user = $userId ? $this->one('SELECT id, role, organization_id FROM users WHERE id = ?', [$userId]) : null;
        $free = $this->plans->plan('free') ?? ['name' => 'Free', 'students' => 0];
        $out = [
            'billing' => $this->plans->enabled(), 'plan' => 'free', 'plan_name' => $free['name'], 'source' => 'none',
            'curricular' => false, 'generator' => false, 'students' => $free['students'] ?? 0,
            'credits_enforced' => true, 'monthly_credits' => 0, 'credit_carryover' => 0, 'period_key' => null, 'trial' => false,
            'subscription' => $user ? $this->subscription((int) $user['id']) : null, 'organization' => null,
        ];
        if (! $this->plans->enabled()) {
            return ['plan' => 'unlimited', 'plan_name' => 'Everything (billing is off)', 'source' => 'billing_off', 'curricular' => true, 'generator' => true, 'students' => null, 'credits_enforced' => false] + $out;
        }
        if (! $user) {
            return $out;
        }
        if ($user['role'] === 'admin') {
            return ['plan' => 'admin', 'plan_name' => 'Administrator', 'source' => 'admin', 'curricular' => true, 'generator' => true, 'students' => null, 'credits_enforced' => false] + $out;
        }

        $grants = [];
        $sub = $out['subscription'];
        if ($sub && in_array($sub['status'], self::ACTIVE, true) && ($plan = $this->plans->plan((string) $sub['plan']))) {
            $trial = $sub['status'] === 'trialing';
            $grants[] = [
                'plan' => $plan['key'], 'plan_name' => $plan['name'], 'source' => 'subscription', 'curricular' => (bool) $plan['curricular'], 'generator' => (bool) $plan['generator'],
                'students' => $plan['students'], 'trial' => $trial,
                'monthly_credits' => (int) ($trial ? ($plan['trial_credits'] ?? $plan['monthly_credits']) : $plan['monthly_credits']),
                'credit_carryover' => (int) $plan['credit_carryover'],
                'period_key' => $trial ? 'trial:'.$sub['stripe_subscription_id'] : 'sub:'.($sub['current_period_start'] ?? $sub['stripe_subscription_id']),
            ];
        }
        if ($user['organization_id'] !== null && ($org = $this->organization((int) $user['organization_id']))) {
            $out['organization'] = ['id' => $org['id'], 'name' => $org['name']];
            if ($license = self::liveLicense($org['license'])) {
                $grants[] = [
                    'plan' => 'organization', 'plan_name' => $license['plan_name'] ?? $org['name'].' license', 'source' => 'organization',
                    'curricular' => (bool) ($license['curricular'] ?? true), 'generator' => (bool) ($license['generator'] ?? false),
                    'students' => isset($license['students']) ? (int) $license['students'] : null, 'trial' => false,
                    'monthly_credits' => (int) ($license['monthly_credits'] ?? 0), 'credit_carryover' => (int) ($license['credit_carryover'] ?? $license['monthly_credits'] ?? 0),
                    'period_key' => 'org:'.$org['id'].':'.gmdate('Y-m'),
                ];
            }
        }
        if (! $grants) {
            return $out;
        }

        // The better of each. Credits come from whichever grants more of them each month.
        usort($grants, fn ($a, $b) => $b['monthly_credits'] <=> $a['monthly_credits']);
        $best = $grants[0];
        $students = 0;
        foreach ($grants as $g) {
            $students = $g['students'] === null || $students === null ? null : max($students, $g['students']);
        }

        return [
            'plan' => $best['plan'], 'plan_name' => $best['plan_name'], 'source' => $best['source'],
            'curricular' => (bool) array_filter(array_column($grants, 'curricular')), 'generator' => (bool) array_filter(array_column($grants, 'generator')),
            'students' => $students, 'monthly_credits' => $best['monthly_credits'], 'credit_carryover' => $best['credit_carryover'],
            'period_key' => $best['monthly_credits'] > 0 ? $best['period_key'] : null, 'trial' => $best['trial'],
        ] + $out;
    }

    // ------------------------------------------------------------------ checks

    /** Whether a scenario is one of the curricular missions (settings.tier), which need a plan. */
    public static function isCurricular(array $scenario): bool
    {
        return ClassStore::isCurricular($scenario);
    }

    /** Whether this account may play (or assign) curricular missions. Signed-out players may not, when billing is on. */
    public function curricular(?int $userId): bool
    {
        return ! $this->plans->enabled() || ($userId !== null && $this->for($userId)['curricular']);
    }

    /** Refuse to add a student past the teacher's plan's limit. */
    public function checkStudentLimit(int $teacherId, int $adding = 1): void
    {
        $plan = $this->for($teacherId);
        if ($plan['students'] === null) {
            return;
        }
        $have = $this->studentCount($teacherId);
        if ($have + $adding > $plan['students']) {
            throw new StoreError(402, $plan['students'] === 0
                ? 'Adding students comes with a Teacher plan. See Plans to start a free trial.'
                : "Your plan ({$plan['plan_name']}) is for up to {$plan['students']} students, and you have $have. For more, ask us about a school plan.");
        }
    }

    public function studentCount(int $teacherId): int
    {
        return (int) ($this->one('SELECT COUNT(*) AS n FROM teacher_student WHERE teacher_id = ?', [$teacherId])['n'] ?? 0);
    }

    // ------------------------------------------------------------------ helpers

    public function subscription(int $userId): ?array
    {
        $row = $this->one('SELECT * FROM subscriptions WHERE user_id = ?', [$userId]);
        if (! $row) {
            return null;
        }

        return [
            'plan' => $row['plan'], 'status' => $row['status'], 'stripe_customer_id' => $row['stripe_customer_id'], 'stripe_subscription_id' => $row['stripe_subscription_id'],
            'trial_ends_at' => self::iso($row['trial_ends_at']), 'current_period_start' => self::iso($row['current_period_start']),
            'current_period_end' => self::iso($row['current_period_end']), 'cancel_at_period_end' => (bool) $row['cancel_at_period_end'],
            'trial_used' => $row['trial_used_at'] !== null,
        ];
    }

    private function organization(int $id): ?array
    {
        $org = $this->one('SELECT id, parent_id, name, license FROM organizations WHERE id = ?', [$id]);
        if ($org && $org['parent_id'] !== null) {
            // Accounts belong to the root organization; a school's license would be its district's.
            $org = $this->one('SELECT id, parent_id, name, license FROM organizations WHERE id = ?', [(int) $org['parent_id']]) ?? $org;
        }

        return $org ? ['id' => (int) $org['id'], 'name' => $org['name'], 'license' => self::json($org['license'])] : null;
    }

    /** An organization's license, if it has one that has not run out. */
    public static function liveLicense(array $license): ?array
    {
        if (! $license || empty($license['active'] ?? true)) {
            return null;
        }
        if (! empty($license['expires_at']) && strtotime($license['expires_at'].' 23:59:59 UTC') < time()) {
            return null;
        }

        return $license;
    }
}
