<?php

/*
 * Plans, Stripe, and AI generator credits. Everything comes from .env (see .env.example).
 * Read by App\Qbl\Billing\* through BillingFactory. See docs/src/content/docs/developers/billing.md.
 */

$int = fn (string $key, int $default) => is_numeric(env($key)) ? (int) env($key) : $default;

return [
    // Off: everyone may do everything (every mission, any number of students, the generator
    // without credits), as before billing existed. On: the plans below apply.
    'enabled' => (bool) env('QBL_BILLING_ENABLED', false),

    'stripe' => [
        'secret' => env('STRIPE_SECRET'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        'base_url' => env('STRIPE_BASE_URL', 'https://api.stripe.com'),
        // The monthly prices made in Stripe (php artisan qbl:billing setup prints them).
        'prices' => [
            'teacher' => env('STRIPE_PRICE_TEACHER'),
            'teacher_plus' => env('STRIPE_PRICE_TEACHER_PLUS'),
        ],
        // Stripe Tax works out sales tax at checkout (it must be set up in Stripe first).
        'automatic_tax' => (bool) env('STRIPE_AUTOMATIC_TAX', false),
    ],

    // The free trial of a paid plan, once per account.
    'trial_days' => $int('QBL_TRIAL_DAYS', 7),
    // true: a card is taken at the start of the trial and charged when it ends unless cancelled.
    // false: no card for the trial; it ends unless one is added before then.
    'trial_requires_card' => (bool) env('QBL_TRIAL_REQUIRES_CARD', true),

    // Buying a teacher plan makes a student account a teacher (accounts made on the sign-in page
    // are students). Accounts a school manages are never changed: their school decides.
    'promote_to_teacher' => (bool) env('QBL_BILLING_PROMOTES_TO_TEACHER', true),

    // What each plan gives. `price` is what the pages show, in US dollars a month: keep it equal to
    // the Stripe price. students: how many students a teacher may have (null: no limit).
    'plans' => [
        'free' => [
            'name' => 'Free',
            'price' => 0,
            'summary' => 'Play the free missions.',
            'curricular' => false,
            'generator' => false,
            'students' => $int('QBL_FREE_STUDENT_LIMIT', 0),
            'monthly_credits' => 0,
            'credit_carryover' => 0,
        ],
        'teacher' => [
            'name' => 'Teacher',
            'price' => $int('QBL_PRICE_TEACHER', 30),
            'summary' => 'Every curricular mission, for up to 40 students.',
            'curricular' => true,
            'generator' => false,
            'students' => $int('QBL_TEACHER_STUDENT_LIMIT', 40),
            'monthly_credits' => 0,
            'credit_carryover' => 0,
        ],
        'teacher_plus' => [
            'name' => 'Teacher Plus',
            'price' => $int('QBL_PRICE_TEACHER_PLUS', 50),
            'summary' => 'Everything in Teacher, and the AI mission generator.',
            'curricular' => true,
            'generator' => true,
            'students' => $int('QBL_TEACHER_STUDENT_LIMIT', 40),
            // Credits added at the start of each billing month. Unused credits carry over to the next
            // month up to credit_carryover; the rest expire when the new month's credits arrive.
            'monthly_credits' => $int('QBL_PLUS_MONTHLY_CREDITS', 100),
            'credit_carryover' => $int('QBL_PLUS_CREDIT_CARRYOVER', 100),
            // During the free trial (instead of the monthly credits).
            'trial_credits' => $int('QBL_PLUS_TRIAL_CREDITS', 20),
        ],
    ],

    // What the generator costs, in credits.
    'costs' => [
        'generation' => $int('QBL_CREDITS_PER_GENERATION', 10),
    ],

    // Where "Contact us for a quote" requests are emailed (they are also kept in quote_requests).
    'sales_email' => env('QBL_SALES_EMAIL'),
    // A number schools and districts can call about a quote, shown on the plans page (optional).
    'sales_phone' => env('QBL_SALES_PHONE'),
];
