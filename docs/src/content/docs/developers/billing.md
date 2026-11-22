---
title: "Billing, credits and district sign-in"
host:
  who: buck
  says: "Plans, Stripe, credits and district sign-in: the money and the keys."
  side: right
---

How plans, Stripe, AI generator credits, the district admin panel and district sign-in are put together. For what teachers and district admins see, read [Plans, credits and the AI generator](/docs/editor/plans-and-generator/) and [The district admin panel](/docs/editor/district-admin/).

## Plans and entitlements

`config/qbl_billing.php` (every value from `.env`) defines the plans. With `QuestLab_BILLING_ENABLED=false` (the default) everyone may do everything, as before billing existed.

`App\Qbl\Billing\Entitlements::for($userId)` says what an account may do: `curricular`, `generator`, `students` (a limit, or null), and the credits it gets each month and in which period. A plan comes from:

1. the account's **Stripe subscription** in `subscriptions`, while its status is `trialing`, `active` or `past_due` (Stripe retrying the card);
2. its **organization's license** (`organizations.license`, set by QuestLab: `php artisan qbl:org license`, or the panel);
3. the **admin** role: everything, credits not counted.

With both a subscription and a license, the account gets the better of each.

Where plans are checked:

What | Where | Rule
---- | ----- | ----
Playing a curricular mission | `ClassStore::needsPlan` / `mayJoin` (the play endpoint and the game server's access check) | In an assignment's or team's instance, the **teacher's** plan; anywhere else the player's own. Signed out: no.
Listing missions | `ClassStore::missions` | Public curricular missions are `locked` for teachers without a plan and hidden from students without one; assigned ones are `locked` when the teacher's plan has lapsed.
Assigning | `ClassStore::assignable` / `assign` | Curricular missions are listed `locked`; assigning one is refused with 402.
Adding a student | `ClassStore::addStudent` | The plan's `students` limit (402). Not applied to rosters a district manages through the API.
Changing the tier | `EditorApi` (PATCH settings) | Only admins change `settings.tier`; settings sent without one keep it.
Copying | `EditorApi` (duplicate) | A copy of a curricular mission needs the plan; the copy stays curricular.
Generating | `GenerationApi` | The `generator` entitlement, then credits.

A mission's tier is `settings.tier`: `"curricular"`, or absent for free.

## Stripe

No SDK: `App\Qbl\Billing\Stripe` sends form-encoded requests over the generator's `HttpClient` (so tests answer from recordings), pinned to API version `2025-03-31.basil`.

Set-up:

1. `STRIPE_SECRET` in `.env`, then `php artisan qbl:billing setup`: it makes the two products and monthly prices and prints `STRIPE_PRICE_TEACHER` / `STRIPE_PRICE_TEACHER_PLUS`.
2. A webhook endpoint at `https://your-host/api/billing/webhook` for `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`; its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. The customer portal (Stripe dashboard → Settings → Billing → Customer portal): allow cancelling and updating the payment method.
4. `QuestLab_BILLING_ENABLED=true`.

Coupons are Stripe promotion codes: make them in Stripe's dashboard, or `php artisan qbl:billing coupon WELCOME20 --percent=20 --duration=repeating --months=3`.

The flow:

- `POST /api/billing/checkout {plan, promotion_code?}` makes a Stripe customer for the account (once) and a Checkout Session in subscription mode, with `trial_period_days` unless the account has had a trial (`subscriptions.trial_used_at`). A code typed on the Plans page is checked first (`POST /api/billing/promotion`) and applied as a discount; otherwise Stripe's own "Add promotion code" field is shown. `QuestLab_TRIAL_REQUIRES_CARD=false` makes the trial card-free (it is cancelled at the end if no card was added).
- The **webhook** (signature checked, each event handled once, `stripe_events`) reads the subscription from Stripe and copies it into `subscriptions`: plan (from the price), status, trial end, the current period, whether it cancels at the period's end. An event about an older subscription never ends a newer, running one. When a plan starts, a student account that no school manages becomes a teacher (`QuestLab_BILLING_PROMOTES_TO_TEACHER`).
- `POST /api/billing/change {plan}` moves between the two plans, prorated. `POST /api/billing/portal` opens Stripe's customer portal.
- `php artisan qbl:billing status|sync <email>` shows an account's plan, or reads its subscription from Stripe again.

Schools and districts: `POST /api/billing/quote` keeps the request in `quote_requests` and emails `QuestLab_SALES_EMAIL`. Agree the plan, then give the organization a license (`php artisan qbl:org license "<organization>" --students=… --generator --credits=… --expires=…`).

## Credits

`App\Qbl\Billing\Credits`, tables `credit_accounts` and `credit_ledger`.

- **Refill**: when an account's credits are read, its balance is brought up to its current period first, once per period (`period_key`): `min(balance, carry-over limit) + monthly credits`, with the expired part and the grant in the ledger. The period is the Stripe billing period (`sub:<period start>`), the trial (`trial:<subscription>`, granting `QuestLab_PLUS_TRIAL_CREDITS`), or the calendar month for a license (`org:<id>:<YYYY-MM>`). No scheduled job is needed; an account idle for months gets one month's credits.
- **Spend**: one conditional `UPDATE … WHERE balance >= cost`, so two requests cannot spend the same credits.
- **Refund**: what a reference (`generation:<id>`) spent, never more, however often it is asked.
- `php artisan qbl:billing credits <email> --add=50 --note="…"` adjusts by hand.

## The generator from the editor

`/api/editor/generations` (`App\Qbl\Generation\GenerationApi`): checks the plan, the description, that the teacher has no other run going and that the site can generate (an Anthropic key, the art style's anchors), creates the run, takes the credits, and queues `App\Jobs\RunGeneration`. The job runs the same generator as `php artisan qbl:generate` (resuming the queued run). A run that fails, or that the worker gives up on, is marked failed and its credits are given back.

The **queue worker** runs in the `app` container (`QuestLab_QUEUE_WORKER`, default on; log lines `worker:`). Jobs may run for an hour, so `DB_QUEUE_RETRY_AFTER` is 3700 in the compose file; the job also refuses to start a run that is not `queued`, so one delivered twice does nothing.

## The district admin panel

`/api/district/*` (`App\Qbl\District\DistrictApi`), the editor's `#/district`. Who may use it: QuestLab administrators (every organization) and the organization's admins (`organization_admins`; any account can be one, and it does not change the account's role). `/api/me` lists the organizations an account runs (`admin_of`).

Everything but the overview and admins needs `organizations.integrations_enabled_at` (`php artisan qbl:org enable`). `php artisan qbl:org` also lists and creates organizations and names admins.

`org_integrations` holds one row per kind (`saml`, `clever`, `google`): `config`, shown in the panel, and `secrets` (a Clever district token, a Google service account key), encrypted with the app key (`Crypt`) and never sent back: the panel only learns whether each is set. Integrations are turned off with the feature.

### Roster syncs

`App\Qbl\District\RosterSync` applies a source's schools, teachers and students through the public API's `Roster`, so the same privacy rules hold: opaque `external_id`s, pseudonyms, placeholder addresses. Enrollments are teacher–student links. People that source made (by `external_id` prefix) who are gone from it are deactivated; a source that lists nobody deactivates nobody. Each run is in `integration_runs`.

- **Clever** (`CleverClient`): QuestLab's Clever application (`CLEVER_CLIENT_ID` / `CLEVER_CLIENT_SECRET`); the district's token is fetched with them, or given in the panel. Reads `/v3.0/schools`, `/v3.0/users?role=teacher|student` and `/v3.0/sections`, following Clever's pages. `external_id` = `clever:<id>`.
- **Google Classroom** (`GoogleClassroomClient`): the district's service account signs a JWT (RS256) acting as a Workspace administrator, for `classroom.courses.readonly` and `classroom.rosters.readonly`. Reads active courses, their teachers (and owner) and students. `external_id` = `google:<account id>`.
- **Roster file** (`RosterFile`): CSV, applied at once, nobody deactivated.

Syncs run on the queue worker (`App\Jobs\SyncRoster`).

### District sign-in

`App\Http\Controllers\SsoController`. Each finds the organization's account by `external_id` (made on first sign-in when the integration allows it, as a student unless the source says teacher) and hands an API token to the browser, as Google sign-in does (`App\Http\Support\SignInPage`). A deactivated account cannot sign in.

- **SAML** (`onelogin/php-saml`): `GET /api/sso/{org}/saml/metadata`, `GET /api/sso/{org}/saml/login?return=…`, `POST /api/sso/{org}/saml/acs`. The response or assertion must be signed with the configured certificate; each assertion is accepted once (kept in the `database` cache store until it expires); the Destination is checked against `APP_URL`. IdP-initiated sign-in is allowed unless turned off. The person is the `id_attribute`'s value (so they match uploaded accounts), else a keyed hash of the NameID (`saml:…`). A role attribute decides teacher or student.
- **Clever**: `GET /api/sso/clever/login`, `GET /api/sso/clever/callback` (register this redirect URI with Clever). The district is the one whose integration has the Clever district ID `/v3.0/me` reports. Instant Login from the Clever portal arrives without a state, which Clever's design allows.
- **Google**: in `GoogleAuthController`, an address in a domain an organization claims gets that organization's account (`google:<id>`), unless the Google account is already tied to an account.
