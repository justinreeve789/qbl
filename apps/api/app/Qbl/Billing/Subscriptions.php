<?php

namespace App\Qbl\Billing;

use App\Qbl\Api\Sql;
use App\Qbl\StoreError;
use PDO;

/**
 * Selling the teacher plans with Stripe:
 *
 *   - checkout     a Stripe Checkout page for a plan, with the free trial (once per account) and a
 *                  coupon: one typed on our page, or Stripe's own "Add promotion code" field
 *   - changePlan   Teacher <-> Teacher Plus, prorated
 *   - portal       Stripe's customer portal: card, invoices, cancelling
 *   - handleEvent  the webhook: keeps the subscriptions table in step with Stripe
 *
 * Stripe is the record of who pays; this table is a copy for answering quickly. Every change
 * comes back through the webhook, including those made in the portal or Stripe's dashboard.
 */
class Subscriptions
{
    use Sql;

    public function __construct(PDO $pdo, private Plans $plans, private ?Stripe $stripe, private string $appUrl)
    {
        $this->pdo = $pdo;
    }

    /**
     * @param  array{id: int, role: string, email?: ?string, name?: ?string, organization_id?: ?int}  $user
     * @return array{url: string}
     */
    public function checkout(array $user, string $plan, ?string $promotionCode = null): array
    {
        $stripe = $this->ready();
        if (! $this->plans->isPaid($plan)) {
            throw new StoreError(422, 'There is no such plan.');
        }
        $this->mayBuy($user);
        $userId = (int) $user['id'];
        $row = $this->row($userId);
        if ($row && in_array($row['status'], Entitlements::ACTIVE, true)) {
            $name = $this->plans->plan((string) $row['plan'])['name'] ?? 'a';
            throw new StoreError(409, "You already have the $name plan. Change it or manage billing instead.");
        }

        $customer = $this->customer($user, $row);
        $params = [
            'mode' => 'subscription',
            'customer' => $customer,
            'client_reference_id' => (string) $userId,
            'line_items' => [['price' => $this->plans->priceId($plan), 'quantity' => 1]],
            'success_url' => $this->url('/plans?checkout=done&session_id={CHECKOUT_SESSION_ID}'),
            'cancel_url' => $this->url('/plans?checkout=cancelled'),
            'metadata' => ['qbl_user_id' => (string) $userId, 'plan' => $plan],
            'subscription_data' => ['metadata' => ['qbl_user_id' => (string) $userId, 'plan' => $plan]],
        ];
        if (! ($row['trial_used_at'] ?? null) && $this->plans->trialDays() > 0) {
            $params['subscription_data']['trial_period_days'] = $this->plans->trialDays();
            if (! $this->plans->trialRequiresCard()) {
                $params['payment_method_collection'] = 'if_required';
                $params['subscription_data']['trial_settings'] = ['end_behavior' => ['missing_payment_method' => 'cancel']];
            }
        }
        $promotionCode = trim((string) $promotionCode);
        if ($promotionCode !== '') {
            $params['discounts'] = [['promotion_code' => $this->promotion($promotionCode)['id']]];
        } else {
            // Stripe's own field on the checkout page.
            $params['allow_promotion_codes'] = true;
        }
        if ($this->plans->automaticTax()) {
            $params['automatic_tax'] = ['enabled' => true];
            $params['customer_update'] = ['address' => 'auto'];
        }
        $session = $stripe->request('POST', 'checkout/sessions', $params);

        return ['url' => (string) ($session['url'] ?? '')];
    }

    /** Move between the paid plans. Stripe prorates the difference on the next invoice. */
    public function changePlan(int $userId, string $plan): array
    {
        $stripe = $this->ready();
        if (! $this->plans->isPaid($plan)) {
            throw new StoreError(422, 'There is no such plan.');
        }
        $row = $this->row($userId);
        if (! $row || ! $row['stripe_subscription_id'] || ! in_array($row['status'], Entitlements::ACTIVE, true)) {
            throw new StoreError(409, 'You have no plan to change. Choose one to start.');
        }
        if ($row['plan'] === $plan) {
            return $this->row($userId);
        }
        $sub = $stripe->request('GET', 'subscriptions/'.rawurlencode($row['stripe_subscription_id']));
        $item = $sub['items']['data'][0]['id'] ?? throw new StoreError(502, 'Stripe did not say what the subscription is for.');
        $sub = $stripe->request('POST', 'subscriptions/'.rawurlencode($row['stripe_subscription_id']), [
            'items' => [['id' => $item, 'price' => $this->plans->priceId($plan)]],
            'proration_behavior' => 'create_prorations',
            'metadata' => ['qbl_user_id' => (string) $userId, 'plan' => $plan],
        ]);
        $this->sync($sub);

        return $this->row($userId);
    }

    /** Stripe's customer portal, for the card, invoices and cancelling. @return array{url: string} */
    public function portal(int $userId): array
    {
        $stripe = $this->ready();
        $row = $this->row($userId);
        if (! $row || ! $row['stripe_customer_id']) {
            throw new StoreError(409, 'There is no billing to manage yet: choose a plan first.');
        }
        $session = $stripe->request('POST', 'billing_portal/sessions', ['customer' => $row['stripe_customer_id'], 'return_url' => $this->url('/plans')]);

        return ['url' => (string) ($session['url'] ?? '')];
    }

    /**
     * A coupon code as Stripe knows it (a "promotion code"), checked and described, so the plans
     * page can say what it gives before checkout. @return array{id: string, code: string, description: string}
     */
    public function promotion(string $code): array
    {
        $stripe = $this->ready();
        $code = trim($code);
        if ($code === '' || strlen($code) > 64 || ! preg_match('/^[A-Za-z0-9_\-]+$/', $code)) {
            throw new StoreError(422, 'That is not a coupon code.');
        }
        $found = $stripe->request('GET', 'promotion_codes', ['code' => $code, 'active' => true, 'limit' => 1])['data'][0] ?? null;
        $coupon = $found['coupon'] ?? $found['promotion']['coupon'] ?? null;
        if (! $found || ! is_array($coupon) || ($coupon['valid'] ?? true) === false || (! empty($found['expires_at']) && $found['expires_at'] < time())) {
            throw new StoreError(404, 'That coupon code is not valid, or has expired.');
        }

        return ['id' => (string) $found['id'], 'code' => (string) $found['code'], 'description' => self::describe($coupon)];
    }

    // -------------------------------------------------------------------- webhook

    /**
     * One Stripe event, already verified. @return string what was done, for the log
     */
    public function handleEvent(array $event): string
    {
        $id = (string) ($event['id'] ?? '');
        $type = (string) ($event['type'] ?? '');
        $object = $event['data']['object'] ?? [];
        if ($id === '' || ! is_array($object)) {
            throw new StoreError(400, 'Not a Stripe event.');
        }
        if ($this->one('SELECT id FROM stripe_events WHERE event_id = ?', [$id])) {
            return 'duplicate';
        }

        $done = match (true) {
            $type === 'checkout.session.completed' && ($object['mode'] ?? '') === 'subscription' => $this->completed($object),
            str_starts_with($type, 'customer.subscription.') => $this->sync($object),
            in_array($type, ['invoice.paid', 'invoice.payment_failed', 'invoice.payment_succeeded'], true) => $this->refetch(self::invoiceSubscription($object)),
            default => 'ignored',
        };
        try {
            $this->run('INSERT INTO stripe_events (event_id, type, created_at) VALUES (?, ?, ?)', [$id, mb_substr($type, 0, 80), self::now()]);
        } catch (\PDOException) {
            // Handled by another delivery at the same moment: the result is the same.
        }

        return $done;
    }

    /** Copy a Stripe subscription into the table. @return string what was done */
    public function sync(array $sub): string
    {
        $subId = (string) ($sub['id'] ?? '');
        $customer = is_array($sub['customer'] ?? null) ? ($sub['customer']['id'] ?? null) : ($sub['customer'] ?? null);
        $userId = $this->userFor($sub['metadata']['qbl_user_id'] ?? null, $customer);
        if (! $userId || $subId === '') {
            return 'unknown customer';
        }
        $item = $sub['items']['data'][0] ?? [];
        $plan = $this->plans->planForPrice($item['price']['id'] ?? null) ?? ($this->plans->isPaid((string) ($sub['metadata']['plan'] ?? '')) ? $sub['metadata']['plan'] : null);
        $status = (string) ($sub['status'] ?? '');
        $row = $this->row($userId);
        // An event about an older subscription must not end a newer one that is running.
        if ($row && $row['stripe_subscription_id'] && $row['stripe_subscription_id'] !== $subId
            && in_array($row['status'], Entitlements::ACTIVE, true) && ! in_array($status, Entitlements::ACTIVE, true)) {
            return 'old subscription';
        }
        $time = fn ($t) => is_numeric($t) ? gmdate('Y-m-d H:i:s', (int) $t) : null;
        $fields = [
            'stripe_customer_id' => $customer ?? $row['stripe_customer_id'] ?? null,
            'stripe_subscription_id' => $subId,
            'plan' => $plan ?? $row['plan'] ?? null,
            'status' => $status,
            'trial_ends_at' => $time($sub['trial_end'] ?? null),
            'current_period_start' => $time($sub['current_period_start'] ?? $item['current_period_start'] ?? null),
            'current_period_end' => $time($sub['current_period_end'] ?? $item['current_period_end'] ?? null),
            'cancel_at_period_end' => ! empty($sub['cancel_at_period_end']) || ! empty($sub['cancel_at']) ? 1 : 0,
            'trial_used_at' => $row['trial_used_at'] ?? (! empty($sub['trial_start']) ? $time($sub['trial_start']) : null),
        ];
        $this->save($userId, $fields);
        if (in_array($status, Entitlements::ACTIVE, true)) {
            $this->promote($userId);
        }

        return "subscription $subId is $status";
    }

    // ------------------------------------------------------------------ helpers

    public function row(int $userId): ?array
    {
        return $this->one('SELECT * FROM subscriptions WHERE user_id = ?', [$userId]);
    }

    /** Someone a school manages, a guest, or an administrator does not buy a plan here. */
    private function mayBuy(array $user): void
    {
        if (($user['role'] ?? '') === 'guest') {
            throw new StoreError(403, 'Create an account first.');
        }
        if (($user['role'] ?? '') === 'admin') {
            throw new StoreError(409, 'Administrators already have everything.');
        }
        if (! empty($user['organization_id'])) {
            throw new StoreError(409, 'Your school or district looks after your plan. Ask them about it.');
        }
    }

    private function customer(array $user, ?array $row): string
    {
        if (! empty($row['stripe_customer_id'])) {
            return $row['stripe_customer_id'];
        }
        $email = (string) ($user['email'] ?? '');
        $customer = $this->ready()->request('POST', 'customers', array_filter([
            'email' => $email !== '' && ! str_ends_with($email, '.invalid') ? $email : null,
            'name' => $user['name'] ?? null,
            'metadata' => ['qbl_user_id' => (string) $user['id']],
        ]), 'qbl-customer-'.$user['id'].'-'.($row['id'] ?? 'new'));
        $this->save((int) $user['id'], ['stripe_customer_id' => (string) $customer['id']]);

        return (string) $customer['id'];
    }

    private function completed(array $session): string
    {
        $customer = is_array($session['customer'] ?? null) ? ($session['customer']['id'] ?? null) : ($session['customer'] ?? null);
        $userId = $this->userFor($session['metadata']['qbl_user_id'] ?? $session['client_reference_id'] ?? null, $customer);
        if (! $userId) {
            return 'unknown customer';
        }
        if ($customer) {
            $this->save($userId, ['stripe_customer_id' => $customer]);
        }
        $subId = is_array($session['subscription'] ?? null) ? ($session['subscription']['id'] ?? null) : ($session['subscription'] ?? null);

        return $this->refetch($subId);
    }

    /** Ask Stripe for a subscription as it is now, and copy it. */
    private function refetch(?string $subId): string
    {
        if (! $subId || ! $this->stripe) {
            return 'no subscription';
        }

        return $this->sync($this->stripe->request('GET', 'subscriptions/'.rawurlencode($subId)));
    }

    private static function invoiceSubscription(array $invoice): ?string
    {
        $sub = $invoice['subscription'] ?? $invoice['parent']['subscription_details']['subscription'] ?? null;

        return is_array($sub) ? ($sub['id'] ?? null) : $sub;
    }

    /** The account a Stripe object is about: by the id we put in its metadata, else by its customer. */
    private function userFor(mixed $metaUserId, ?string $customer): ?int
    {
        if (is_numeric($metaUserId) && $this->one('SELECT id FROM users WHERE id = ?', [(int) $metaUserId])) {
            $owner = $customer ? $this->one('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?', [$customer]) : null;

            // A customer already tied to another account wins over metadata someone could have copied.
            return $owner ? (int) $owner['user_id'] : (int) $metaUserId;
        }
        $row = $customer ? $this->one('SELECT user_id FROM subscriptions WHERE stripe_customer_id = ?', [$customer]) : null;

        return $row ? (int) $row['user_id'] : null;
    }

    private function save(int $userId, array $fields): void
    {
        $fields['updated_at'] = self::now();
        if ($this->row($userId)) {
            $this->run('UPDATE subscriptions SET '.implode(', ', array_map(fn ($k) => "$k = ?", array_keys($fields))).' WHERE user_id = ?', [...array_values($fields), $userId]);
        } else {
            $fields += ['user_id' => $userId, 'created_at' => self::now()];
            $this->run('INSERT INTO subscriptions ('.implode(', ', array_keys($fields)).') VALUES ('.self::marks($fields).')', array_values($fields));
        }
    }

    /**
     * Buying a teacher plan makes a student account (the kind the sign-in page makes) a teacher, so
     * it can open the editor and Classes. Never the other way, and never an account a school manages.
     */
    private function promote(int $userId): void
    {
        if ($this->plans->promotesToTeacher()) {
            $this->run("UPDATE users SET role = 'teacher', updated_at = ? WHERE id = ? AND role = 'student' AND organization_id IS NULL", [self::now(), $userId]);
        }
    }

    private function ready(): Stripe
    {
        if (! $this->plans->enabled() || ! $this->stripe || ! $this->plans->stripeReady()) {
            throw new StoreError(503, 'Payments are not set up on this site yet.');
        }

        return $this->stripe;
    }

    private function url(string $path): string
    {
        return rtrim($this->appUrl, '/').$path;
    }

    /** "20% off for 3 months", "$10.00 off once". */
    public static function describe(array $coupon): string
    {
        $off = isset($coupon['percent_off']) && $coupon['percent_off'] !== null
            ? rtrim(rtrim(number_format((float) $coupon['percent_off'], 2), '0'), '.').'% off'
            : (isset($coupon['amount_off']) ? (strtoupper((string) ($coupon['currency'] ?? 'usd')) === 'USD' ? '$' : strtoupper((string) $coupon['currency']).' ').number_format($coupon['amount_off'] / 100, 2).' off' : 'A discount');
        $for = match ($coupon['duration'] ?? 'once') {
            'forever' => ' every month',
            'repeating' => ' for '.(int) ($coupon['duration_in_months'] ?? 1).((int) ($coupon['duration_in_months'] ?? 1) === 1 ? ' month' : ' months'),
            default => ' the first month',
        };

        return $off.$for;
    }
}
