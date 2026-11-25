<?php

namespace App\Qbl\Billing;

use App\Qbl\StoreError;

/**
 * Plans, billing and credits for the signed-in account, under /api/billing. Framework-free like
 * EditorApi and ClassApi. The webhook and the quote form are in BillingController (they need the
 * raw body and mail).
 *
 *   GET   billing              the plans on sale, this account's plan, subscription and credits
 *   POST  billing/checkout     {plan, promotion_code?} -> {url}: Stripe Checkout, with the free trial
 *   POST  billing/change       {plan}: switch between Teacher and Teacher Plus
 *   POST  billing/portal       -> {url}: Stripe's page for the card, invoices and cancelling
 *   POST  billing/promotion    {code} -> what a coupon code gives, before checkout
 *   GET   billing/credits      the credits and their history
 */
class BillingApi
{
    public function __construct(private Entitlements $entitlements, private Credits $credits, private Subscriptions $subscriptions) {}

    /**
     * @param  array|null  $user  id, name, role, email, organization_id
     * @return array{0: int, 1: array|null}
     */
    public function handle(string $method, string $path, array $body, ?array $user): array
    {
        try {
            return $this->route(strtoupper($method), trim($path, '/'), $body, $user);
        } catch (StoreError $e) {
            return [$e->status, ['message' => $e->getMessage()]];
        }
    }

    private function route(string $method, string $path, array $body, ?array $user): array
    {
        $plans = $this->entitlements->plans();
        // What is on sale can be read by anyone (the pricing page, signed out).
        if ($path === '' && $method === 'GET' && ! $user) {
            return [200, ['enabled' => $plans->enabled(), 'payments' => $plans->enabled() && $plans->stripeReady(), 'trial_days' => $plans->trialDays(), 'plans' => $plans->catalogue(), 'costs' => ['generation' => $plans->cost('generation'), 'scene' => $plans->cost('scene_generation')], 'sales_phone' => $plans->salesPhone()]];
        }
        if (! $user) {
            throw new StoreError(401, 'Unauthenticated.');
        }
        $me = (int) $user['id'];

        return match (true) {
            $path === '' && $method === 'GET' => [200, $this->status($me)],
            $path === 'checkout' && $method === 'POST' => [200, $this->subscriptions->checkout($user, (string) ($body['plan'] ?? ''), isset($body['promotion_code']) ? (string) $body['promotion_code'] : null)],
            $path === 'change' && $method === 'POST' => $this->changed($me, (string) ($body['plan'] ?? '')),
            $path === 'portal' && $method === 'POST' => [200, $this->subscriptions->portal($me)],
            $path === 'promotion' && $method === 'POST' => [200, ['promotion' => array_diff_key($this->subscriptions->promotion((string) ($body['code'] ?? '')), ['id' => 1])]],
            $path === 'credits' && $method === 'GET' => [200, ['credits' => $this->credits->summary($me), 'ledger' => $this->credits->ledger($me, 100)]],
            default => throw new StoreError(404, 'Not found.'),
        };
    }

    private function changed(int $me, string $plan): array
    {
        $this->subscriptions->changePlan($me, $plan);

        return [200, $this->status($me)];
    }

    /** Everything the plans page and the editor's "Plan & credits" page show. */
    public function status(int $userId): array
    {
        $plans = $this->entitlements->plans();
        $plan = $this->entitlements->for($userId);
        $sub = $plan['subscription'];
        unset($plan['subscription']);

        return [
            'enabled' => $plans->enabled(),
            'payments' => $plans->enabled() && $plans->stripeReady(),
            'trial_days' => $plans->trialDays(),
            'plans' => $plans->catalogue(),
            'costs' => ['generation' => $plans->cost('generation'), 'scene' => $plans->cost('scene_generation')],
            'sales_phone' => $plans->salesPhone(),
            'entitlements' => $plan + ['students_used' => $this->entitlements->studentCount($userId)],
            'subscription' => $sub === null ? null : array_diff_key($sub, ['stripe_customer_id' => 1, 'stripe_subscription_id' => 1]) + ['manageable' => $sub['stripe_customer_id'] !== null],
            'credits' => $plan['generator'] || $plan['monthly_credits'] > 0 ? $this->credits->summary($userId) : null,
        ];
    }
}
