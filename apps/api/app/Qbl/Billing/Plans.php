<?php

namespace App\Qbl\Billing;

/**
 * The plans, as config/qbl_billing.php describes them:
 *
 *   free          anyone: the free missions
 *   teacher       $30 a month: every curricular mission, up to 40 students
 *   teacher_plus  $50 a month: the same, and the AI mission generator with monthly credits
 *
 * Schools and districts get a custom plan by quote (an organization's `license`), not here.
 */
class Plans
{
    public const PAID = ['teacher', 'teacher_plus'];

    public function __construct(private array $config) {}

    public function enabled(): bool
    {
        return (bool) ($this->config['enabled'] ?? false);
    }

    /** Whether Stripe is set up enough to sell plans: a secret key and both prices. */
    public function stripeReady(): bool
    {
        return ! empty($this->config['stripe']['secret']) && ! array_filter(self::PAID, fn ($p) => empty($this->config['stripe']['prices'][$p]));
    }

    /** @return array{key: string, name: string, price: int, summary: string, curricular: bool, generator: bool, students: ?int, monthly_credits: int, credit_carryover: int, trial_credits?: int}|null */
    public function plan(string $key): ?array
    {
        $plan = $this->config['plans'][$key] ?? null;

        return $plan === null ? null : ['key' => $key] + $plan + ['students' => null, 'monthly_credits' => 0, 'credit_carryover' => 0];
    }

    public function isPaid(string $key): bool
    {
        return in_array($key, self::PAID, true) && $this->plan($key) !== null;
    }

    public function priceId(string $plan): ?string
    {
        return $this->config['stripe']['prices'][$plan] ?? null ?: null;
    }

    /** Which plan a Stripe price is for, or null for a price this site does not sell. */
    public function planForPrice(?string $priceId): ?string
    {
        foreach (self::PAID as $plan) {
            if ($priceId !== null && $priceId !== '' && $this->priceId($plan) === $priceId) {
                return $plan;
            }
        }

        return null;
    }

    public function trialDays(): int
    {
        return max(0, (int) ($this->config['trial_days'] ?? 7));
    }

    public function trialRequiresCard(): bool
    {
        return (bool) ($this->config['trial_requires_card'] ?? true);
    }

    public function promotesToTeacher(): bool
    {
        return (bool) ($this->config['promote_to_teacher'] ?? true);
    }

    public function automaticTax(): bool
    {
        return (bool) ($this->config['stripe']['automatic_tax'] ?? false);
    }

    /** A number to call about a school or district quote, if the site gives one. */
    public function salesPhone(): ?string
    {
        $phone = trim((string) ($this->config['sales_phone'] ?? ''));

        return $phone === '' ? null : $phone;
    }

    /** What something costs in generator credits. */
    public function cost(string $what): int
    {
        return max(0, (int) ($this->config['costs'][$what] ?? 0));
    }

    /** The plans as the pricing pages show them, free first. */
    public function catalogue(): array
    {
        $out = [];
        foreach (['free', ...self::PAID] as $key) {
            if ($plan = $this->plan($key)) {
                $out[] = array_intersect_key($plan, array_flip(['key', 'name', 'price', 'summary', 'curricular', 'generator', 'students', 'monthly_credits', 'credit_carryover', 'trial_credits']));
            }
        }

        return $out;
    }
}
