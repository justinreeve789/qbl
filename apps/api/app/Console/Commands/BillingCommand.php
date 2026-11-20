<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Entitlements;
use App\Qbl\Billing\Plans;
use App\Qbl\Billing\Stripe;
use App\Qbl\Billing\Subscriptions;
use App\Qbl\StoreError;
use Illuminate\Console\Command;

/**
 * Setting up and looking after billing:
 *
 *   php artisan qbl:billing setup                      make the two plans' products and monthly prices in Stripe; prints the .env lines
 *   php artisan qbl:billing coupon WELCOME20 --percent=20 --duration=repeating --months=3
 *   php artisan qbl:billing coupon TENOFF --amount=10 --duration=once --max=100 --expires=2027-01-31
 *   php artisan qbl:billing status someone@school.org  their plan, subscription and credits
 *   php artisan qbl:billing sync someone@school.org    read their subscription from Stripe again
 *   php artisan qbl:billing credits someone@school.org --add=50 --note="Sorry about the outage"
 */
class BillingCommand extends Command
{
    protected $signature = 'qbl:billing
        {action : setup, coupon, status, sync or credits}
        {subject? : the coupon code, or an account\'s email address}
        {--currency=usd : setup: the prices\' currency}
        {--percent= : coupon: percent off}
        {--amount= : coupon: an amount off, in the currency\'s main unit (10 = $10.00)}
        {--duration=once : coupon: once, repeating (with --months) or forever}
        {--months= : coupon: how many months a repeating coupon lasts}
        {--max= : coupon: how many times it can be used in all}
        {--expires= : coupon: the last day it can be used, YYYY-MM-DD}
        {--add= : credits: add (or with a minus sign take away) this many}
        {--note= : credits: why}';

    protected $description = 'Stripe set-up, coupons, and an account\'s plan and credits';

    public function handle(Plans $plans, Entitlements $entitlements, Credits $credits, Subscriptions $subscriptions): int
    {
        try {
            return match ($this->argument('action')) {
                'setup' => $this->setup(),
                'coupon' => $this->coupon(),
                'status' => $this->status($entitlements, $credits),
                'sync' => $this->sync($subscriptions),
                'credits' => $this->credits($credits),
                default => $this->refuse('The action is one of: setup, coupon, status, sync, credits.'),
            };
        } catch (StoreError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
    }

    private function stripe(): Stripe
    {
        if (! config('qbl_billing.stripe.secret')) {
            throw new StoreError(503, 'Set STRIPE_SECRET in .env first (a test key, sk_test_…, to try it out).');
        }

        return app(Stripe::class);
    }

    private function setup(): int
    {
        $stripe = $this->stripe();
        $currency = strtolower((string) $this->option('currency'));
        $lines = [];
        foreach (Plans::PAID as $key) {
            $plan = config("qbl_billing.plans.$key");
            $product = $stripe->request('POST', 'products', [
                'name' => config('qbl.site_name', 'QuestLab').' '.$plan['name'],
                'description' => $plan['summary'],
                'metadata' => ['qbl_plan' => $key],
            ], "qbl-product-$key");
            $price = $stripe->request('POST', 'prices', [
                'product' => $product['id'],
                'currency' => $currency,
                'unit_amount' => (int) round($plan['price'] * 100),
                'recurring' => ['interval' => 'month'],
                'metadata' => ['qbl_plan' => $key],
            ], "qbl-price-$key-{$plan['price']}-$currency");
            $this->info("{$plan['name']}: product {$product['id']}, price {$price['id']} ({$plan['price']} $currency a month)");
            $lines[] = 'STRIPE_PRICE_'.strtoupper($key).'='.$price['id'];
        }
        $this->newLine();
        $this->line('Put these in .env:');
        foreach ($lines as $line) {
            $this->line("  $line");
        }
        $this->newLine();
        $this->line('Then in Stripe, add a webhook endpoint for '.rtrim((string) config('app.url'), '/').'/api/billing/webhook with the events');
        $this->line('  checkout.session.completed, customer.subscription.created, customer.subscription.updated,');
        $this->line('  customer.subscription.deleted, invoice.paid, invoice.payment_failed');
        $this->line('and put its signing secret in STRIPE_WEBHOOK_SECRET. Set up the customer portal (Settings > Billing > Customer portal)');
        $this->line('to allow cancelling and updating the card. Finally QBL_BILLING_ENABLED=true.');

        return self::SUCCESS;
    }

    private function coupon(): int
    {
        $code = strtoupper(trim((string) $this->argument('subject')));
        if (! preg_match('/^[A-Z0-9_\-]{3,40}$/', $code)) {
            return $this->refuse('Give the code to type: 3 to 40 letters, digits, - or _.');
        }
        $percent = $this->option('percent');
        $amount = $this->option('amount');
        if (($percent === null) === ($amount === null)) {
            return $this->refuse('Give one of --percent or --amount.');
        }
        $duration = (string) $this->option('duration');
        if (! in_array($duration, ['once', 'repeating', 'forever'], true) || ($duration === 'repeating' && ! $this->option('months'))) {
            return $this->refuse('--duration is once, repeating (with --months=N) or forever.');
        }
        $stripe = $this->stripe();
        $coupon = $stripe->request('POST', 'coupons', array_filter([
            'name' => $code,
            'percent_off' => $percent !== null ? (float) $percent : null,
            'amount_off' => $amount !== null ? (int) round((float) $amount * 100) : null,
            'currency' => $amount !== null ? strtolower((string) $this->option('currency')) : null,
            'duration' => $duration,
            'duration_in_months' => $duration === 'repeating' ? (int) $this->option('months') : null,
        ], fn ($v) => $v !== null));
        $expires = $this->option('expires') ? strtotime($this->option('expires').' 23:59:59 UTC') : null;
        $promotion = $stripe->request('POST', 'promotion_codes', array_filter([
            'coupon' => $coupon['id'],
            'code' => $code,
            'max_redemptions' => $this->option('max') ? (int) $this->option('max') : null,
            'expires_at' => $expires ?: null,
        ], fn ($v) => $v !== null));
        $this->info("$code: ".Subscriptions::describe($coupon)." (coupon {$coupon['id']}, promotion code {$promotion['id']}).");
        $this->line('People type it on the Plans page, or in "Add promotion code" on Stripe\'s checkout page.');

        return self::SUCCESS;
    }

    private function user(): User
    {
        $email = trim((string) $this->argument('subject'));
        $user = $email === '' ? null : User::where('email', $email)->first();
        if (! $user) {
            throw new StoreError(404, "There is no account for \"$email\".");
        }

        return $user;
    }

    private function status(Entitlements $entitlements, Credits $credits): int
    {
        $user = $this->user();
        $plan = $entitlements->for($user->id);
        $this->line("{$user->name} <{$user->email}>, a {$user->role}");
        $this->line("Plan: {$plan['plan_name']} (from: {$plan['source']})".($plan['trial'] ? ', on the free trial' : ''));
        $this->line('Curricular missions: '.($plan['curricular'] ? 'yes' : 'no').'; generator: '.($plan['generator'] ? 'yes' : 'no')
            .'; students: '.$entitlements->studentCount($user->id).' of '.($plan['students'] ?? 'no limit'));
        if ($sub = $plan['subscription']) {
            $this->line("Stripe: {$sub['status']} {$sub['plan']}, customer {$sub['stripe_customer_id']}, subscription {$sub['stripe_subscription_id']}"
                .($sub['current_period_end'] ? ", period ends {$sub['current_period_end']}" : '').($sub['cancel_at_period_end'] ? ' (cancelling then)' : ''));
        }
        $summary = $credits->summary($user->id);
        $this->line('Credits: '.($summary['enforced'] ? $summary['balance'] : 'not counted')
            .($summary['monthly'] ? " ({$summary['monthly']} a month, up to {$summary['carryover']} carried over)" : ''));

        return self::SUCCESS;
    }

    private function sync(Subscriptions $subscriptions): int
    {
        $user = $this->user();
        $row = $subscriptions->row($user->id);
        if (! $row || ! $row['stripe_subscription_id']) {
            return $this->refuse("{$user->email} has no Stripe subscription.");
        }
        $this->info($subscriptions->sync($this->stripe()->request('GET', 'subscriptions/'.rawurlencode($row['stripe_subscription_id']))));

        return self::SUCCESS;
    }

    private function credits(Credits $credits): int
    {
        $user = $this->user();
        if ($this->option('add') !== null) {
            if (! preg_match('/^-?\d+$/', (string) $this->option('add'))) {
                return $this->refuse('--add is a whole number, such as 50 or -10.');
            }
            $after = $credits->adjust($user->id, (int) $this->option('add'), (string) ($this->option('note') ?: 'Adjusted by an administrator'));
            $this->info("{$user->email} now has $after credits.");
        }
        foreach (array_slice($credits->ledger($user->id, 15), 0, 15) as $line) {
            $this->line(sprintf('%s  %+5d  = %5d  %-7s %s', $line['at'], $line['delta'], $line['balance_after'], $line['reason'], $line['note'] ?? ''));
        }

        return self::SUCCESS;
    }

    private function refuse(string $message): int
    {
        $this->error($message);

        return self::FAILURE;
    }
}
