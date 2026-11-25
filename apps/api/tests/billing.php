<?php

/**
 * Tests for plans, Stripe billing and generator credits (App\Qbl\Billing\*), and how plans gate
 * curricular missions, students and the generator (ClassStore, EditorApi, GenerationApi), over
 * SQLite with Stripe answered from recordings: no network.
 *
 *   php apps/api/tests/billing.php        (npm run test:billing)
 */
spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'App\\') && is_file($file = __DIR__.'/../app/'.str_replace('\\', '/', substr($class, 4)).'.php')) {
        require $file;
    }
});

use App\Qbl\Api\Clients;
use App\Qbl\Billing\BillingApi;
use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Entitlements;
use App\Qbl\Billing\Plans;
use App\Qbl\Billing\Stripe;
use App\Qbl\Billing\Subscriptions;
use App\Qbl\ClassApi;
use App\Qbl\ClassStore;
use App\Qbl\EditorApi;
use App\Qbl\Generation\GenerationApi;
use App\Qbl\Generation\GenerationEvents;
use App\Qbl\Generation\GenerationProgress;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;

$checks = 0;
$failures = 0;
function check(bool $ok, string $what): void
{
    global $checks, $failures;
    $checks++;
    if (! $ok) {
        $failures++;
        fwrite(STDERR, "FAIL: $what\n");
    }
}
function same(mixed $actual, mixed $expected, string $what): void
{
    check($actual === $expected, $what.' (got '.json_encode($actual).', expected '.json_encode($expected).')');
}
function refused(callable $work, int $status, string $what): ?string
{
    try {
        $work();
        check(false, "$what (was not refused)");
    } catch (StoreError $e) {
        same($e->status, $status, $what);

        return $e->getMessage();
    }

    return null;
}

/** Stripe, answered from a list of [method, url pattern, answer]; every request is kept. */
final class FakeStripe implements HttpClient
{
    public array $sent = [];

    public array $routes = [];

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        parse_str(is_string($body) ? $body : '', $form);
        $this->sent[] = compact('method', 'url', 'headers', 'form');
        foreach ($this->routes as [$m, $pattern, $answer]) {
            if ($m === $method && preg_match($pattern, $url)) {
                $answer = is_callable($answer) ? $answer($form, $url) : $answer;

                return new HttpResponse($answer[0], json_encode($answer[1]));
            }
        }

        return new HttpResponse(404, json_encode(['error' => ['message' => "No such route: $method $url"]]));
    }

    public function last(string $method, string $pattern): ?array
    {
        foreach (array_reverse($this->sent) as $s) {
            if ($s['method'] === $method && preg_match($pattern, $s['url'])) {
                return $s;
            }
        }

        return null;
    }
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
foreach ([...ScenarioStore::sqliteSchema(), ...Clients::sqliteSchema(), ...Credits::sqliteSchema(), ...GenerationRuns::sqliteSchema(), ...GenerationEvents::sqliteSchema()] as $sql) {
    $pdo->exec($sql);
}
$pdo->exec('ALTER TABLE organizations ADD COLUMN integrations_enabled_at');
$pdo->exec('ALTER TABLE organizations ADD COLUMN license');
$pdo->exec("INSERT INTO users (id, name, email, role) VALUES
    (1, 'Ms Tan', 'tan@school.test', 'teacher'), (2, 'Pat', 'pat@home.test', 'student'), (3, 'Root', 'root@qbl.test', 'admin'),
    (11, 'Ann', 'ann@school.test', 'student'), (12, 'Ben', 'ben@school.test', 'student'), (13, 'Cy', 'cy@school.test', 'student'),
    (20, 'Guest', 'g@guest.invalid', 'guest')");

$config = [
    'enabled' => true,
    'stripe' => ['secret' => 'sk_test_x', 'webhook_secret' => 'whsec_test', 'base_url' => 'https://stripe.test', 'prices' => ['teacher' => 'price_teacher', 'teacher_plus' => 'price_plus']],
    'trial_days' => 7, 'trial_requires_card' => true, 'promote_to_teacher' => true,
    'plans' => [
        'free' => ['name' => 'Free', 'price' => 0, 'summary' => '', 'curricular' => false, 'generator' => false, 'students' => 0, 'monthly_credits' => 0, 'credit_carryover' => 0],
        'teacher' => ['name' => 'Teacher', 'price' => 30, 'summary' => '', 'curricular' => true, 'generator' => false, 'students' => 2, 'monthly_credits' => 0, 'credit_carryover' => 0],
        'teacher_plus' => ['name' => 'Teacher Plus', 'price' => 50, 'summary' => '', 'curricular' => true, 'generator' => true, 'students' => 2, 'monthly_credits' => 100, 'credit_carryover' => 50, 'trial_credits' => 20],
    ],
    'costs' => ['generation' => 10, 'scene_generation' => 2],
];
$plans = new Plans($config);
$entitlements = new Entitlements($pdo, $plans);
$credits = new Credits($pdo, $entitlements);
$http = new FakeStripe;
$stripe = new Stripe($http, 'sk_test_x', 'https://stripe.test');
$subscriptions = new Subscriptions($pdo, $plans, $stripe, 'https://qbl.test');
$billing = new BillingApi($entitlements, $credits, $subscriptions);

// ------------------------------------------------------------------- plans
same(array_column($plans->catalogue(), 'key'), ['free', 'teacher', 'teacher_plus'], 'the plans on sale, free first');
same([$plans->planForPrice('price_plus'), $plans->planForPrice('price_other'), $plans->stripeReady()], ['teacher_plus', null, true], 'prices map to plans');
same($entitlements->for(1)['plan'], 'free', 'a teacher without a plan is on Free');
same([$entitlements->for(3)['plan'], $entitlements->for(3)['curricular'], $entitlements->for(3)['credits_enforced']], ['admin', true, false], 'administrators have everything, without counting credits');
$off = new Entitlements($pdo, new Plans(['enabled' => false] + $config));
same([$off->for(2)['curricular'], $off->for(2)['students'], $off->for(2)['credits_enforced']], [true, null, false], 'with billing off, everyone has everything');
same($entitlements->curricular(null), false, 'signed out: no curricular missions while billing is on');

// ----------------------------------------------------------------- Stripe form & signature
same(urldecode(Stripe::form(['a' => ['b' => true, 'c' => [['d' => 1]]], 'e' => null])), 'a[b]=true&a[c][0][d]=1', 'Stripe form encoding: nested, booleans as words, nulls left out');
$payload = '{"id":"evt_1"}';
check(Stripe::verifySignature($payload, Stripe::sign($payload, 'whsec_test'), 'whsec_test'), 'a signature made with the secret is believed');
check(! Stripe::verifySignature($payload, Stripe::sign($payload, 'whsec_other'), 'whsec_test'), 'one made with another secret is not');
check(! Stripe::verifySignature($payload, Stripe::sign($payload, 'whsec_test', time() - 3600), 'whsec_test'), 'an old one is not (replay)');
check(! Stripe::verifySignature($payload.' ', Stripe::sign($payload, 'whsec_test'), 'whsec_test'), 'a changed body is not');
check(! Stripe::verifySignature($payload, null, 'whsec_test'), 'no header: no');

// --------------------------------------------------------------------- checkout
$http->routes = [
    ['POST', '#/v1/customers$#', fn ($form) => [200, ['id' => 'cus_pat', 'email' => $form['email'] ?? null]]],
    ['POST', '#/v1/checkout/sessions$#', [200, ['id' => 'cs_1', 'url' => 'https://checkout.stripe.test/cs_1']]],
    ['GET', '#/v1/promotion_codes\?#', fn ($f, $url) => str_contains($url, 'code=WELCOME20')
        ? [200, ['data' => [['id' => 'promo_1', 'code' => 'WELCOME20', 'coupon' => ['percent_off' => 20, 'duration' => 'repeating', 'duration_in_months' => 3, 'valid' => true]]]]]
        : [200, ['data' => []]]],
];
$pat = ['id' => 2, 'name' => 'Pat', 'role' => 'student', 'email' => 'pat@home.test', 'organization_id' => null];
[$status, $body] = $billing->handle('POST', 'checkout', ['plan' => 'teacher_plus'], $pat);
same([$status, $body['url'] ?? null], [200, 'https://checkout.stripe.test/cs_1'], 'checkout gives Stripe Checkout\'s address');
$sent = $http->last('POST', '#checkout/sessions#')['form'];
same([$sent['mode'], $sent['customer'], $sent['line_items'][0]['price'], $sent['subscription_data']['trial_period_days'], $sent['allow_promotion_codes'], $sent['client_reference_id']],
    ['subscription', 'cus_pat', 'price_plus', '7', 'true', '2'], 'a subscription for the plan\'s price, with the 7-day trial and Stripe\'s own coupon field');
same($http->last('POST', '#customers#')['form']['metadata']['qbl_user_id'] ?? null, '2', 'the Stripe customer is tied to the account');
check(str_contains($sent['success_url'], 'https://qbl.test/plans?checkout=done'), 'back to the plans page afterwards');
same($http->last('POST', '#customers#')['headers']['Idempotency-Key'] ?? null, 'qbl-customer-2-new', 'making a customer is idempotent');

[$status, $body] = $billing->handle('POST', 'promotion', ['code' => 'WELCOME20'], $pat);
same([$status, $body['promotion']['description'] ?? null], [200, '20% off for 3 months'], 'a coupon code is described before checkout');
same($billing->handle('POST', 'promotion', ['code' => 'NOPE'], $pat)[0], 404, 'an unknown coupon code is refused');
same($billing->handle('POST', 'promotion', ['code' => 'bad code!'], $pat)[0], 422, 'not a code at all');
$billing->handle('POST', 'checkout', ['plan' => 'teacher', 'promotion_code' => 'WELCOME20'], $pat);
$sent = $http->last('POST', '#checkout/sessions#')['form'];
same([$sent['discounts'][0]['promotion_code'] ?? null, isset($sent['allow_promotion_codes'])], ['promo_1', false], 'a code typed on our page is applied (and Stripe\'s field left off)');
same(count(array_filter($http->sent, fn ($s) => str_contains($s['url'], '/v1/customers'))), 1, 'the customer is made once');
same($billing->handle('POST', 'checkout', ['plan' => 'gold'], $pat)[0], 422, 'no such plan');
same($billing->handle('POST', 'checkout', ['plan' => 'teacher'], ['id' => 20, 'role' => 'guest'])[0], 403, 'guests create an account first');
same($billing->handle('POST', 'checkout', ['plan' => 'teacher'], ['id' => 3, 'role' => 'admin'])[0], 409, 'administrators need no plan');
same($billing->handle('POST', 'checkout', ['plan' => 'teacher'], ['id' => 11, 'role' => 'student', 'organization_id' => 5])[0], 409, 'school-managed accounts do not buy plans');
$noStripe = new BillingApi($entitlements, $credits, new Subscriptions($pdo, $plans, null, 'https://qbl.test'));
same($noStripe->handle('POST', 'checkout', ['plan' => 'teacher'], $pat)[0], 503, 'without Stripe set up, nothing is sold');
same($billing->handle('GET', '', [], null)[1]['plans'][1]['price'] ?? null, 30, 'the plans can be read signed out');

// ------------------------------------------------------------------- the webhook
$now = time();
$sub = fn (string $status, array $more = []) => $more + [
    'id' => 'sub_1', 'object' => 'subscription', 'customer' => 'cus_pat', 'status' => $status, 'metadata' => ['qbl_user_id' => '2', 'plan' => 'teacher_plus'],
    'trial_start' => $now - 3600, 'trial_end' => $now + 6 * 86400, 'cancel_at_period_end' => false,
    'items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_plus'], 'current_period_start' => $now - 3600, 'current_period_end' => $now + 6 * 86400]]],
];
$http->routes[] = ['GET', '#/v1/subscriptions/sub_1$#', fn () => [200, $sub('trialing')]];
same($subscriptions->handleEvent(['id' => 'evt_1', 'type' => 'checkout.session.completed', 'data' => ['object' => ['mode' => 'subscription', 'customer' => 'cus_pat', 'subscription' => 'sub_1', 'client_reference_id' => '2', 'metadata' => ['qbl_user_id' => '2']]]]),
    'subscription sub_1 is trialing', 'checkout completed: the subscription is read from Stripe and kept');
same($subscriptions->handleEvent(['id' => 'evt_1', 'type' => 'checkout.session.completed', 'data' => ['object' => []]]), 'duplicate', 'an event delivered twice is handled once');
$plan = $entitlements->for(2);
same([$plan['plan'], $plan['trial'], $plan['curricular'], $plan['generator'], $plan['students']], ['teacher_plus', true, true, true, 2], 'on the trial, Teacher Plus applies');
same($pdo->query('SELECT role FROM users WHERE id = 2')->fetchColumn(), 'teacher', 'buying a teacher plan makes the student account a teacher');
check($pdo->query('SELECT trial_used_at FROM subscriptions WHERE user_id = 2')->fetchColumn() !== null, 'the free trial is marked as used');
same($credits->summary(2)['balance'], 20, 'the trial grants its credits');
same($credits->summary(2)['balance'], 20, 'once');

// A second checkout while subscribed is refused; the trial is not offered again after it ends.
same($billing->handle('POST', 'checkout', ['plan' => 'teacher'], $pat)[0], 409, 'one plan at a time: change it instead');

// The trial converts: a new billing period, the monthly credits (what is left of the trial's carries over).
$credits->spend(2, 10, 'generation:x', 'test');
same($subscriptions->sync($sub('active', ['trial_end' => $now - 60, 'items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_plus'], 'current_period_start' => $now, 'current_period_end' => $now + 30 * 86400]]]])), 'subscription sub_1 is active', 'renewal');
same($credits->summary(2)['balance'], 110, 'month one: 10 left over + 100');
$credits->adjust(2, 40, 'bonus');
same($credits->summary(2)['balance'], 150, 'an administrator\'s adjustment');
$subscriptions->sync($sub('active', ['items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_plus'], 'current_period_start' => $now + 30 * 86400, 'current_period_end' => $now + 60 * 86400]]]]));
same($credits->summary(2)['balance'], 150, 'month two: 50 carried over (the limit) + 100');
$ledger = $credits->ledger(2);
same([$ledger[0]['reason'], $ledger[0]['delta'], $ledger[1]['reason'], $ledger[1]['delta']], ['grant', 100, 'expire', -100], 'the ledger says what expired and what arrived');
same($credits->summary(2)['balance'], 150, 'reading again grants nothing more in the same period');

// Spending, refunds.
same($credits->spend(2, 10, 'generation:1', 'a mission'), 10, 'a generation spends credits');
$credits->refund(2, 10, 'generation:1', 'failed');
$credits->refund(2, 10, 'generation:1', 'failed again');
same($credits->summary(2)['balance'], 150, 'a failed one gives them back, once');
$credits->adjust(2, -145, 'test');
refused(fn () => $credits->spend(2, 10, 'generation:2', 'too much'), 402, 'not enough credits');
same($credits->summary(2)['balance'], 5, 'a refused spend takes nothing');
same($credits->spend(3, 10, 'generation:3', 'admin'), 0, 'administrators are not charged');

// Changing plan, the portal.
$http->routes[] = ['POST', '#/v1/subscriptions/sub_1$#', fn ($form) => [200, $sub('active', ['metadata' => ['qbl_user_id' => '2', 'plan' => 'teacher'], 'items' => ['data' => [['id' => 'si_1', 'price' => ['id' => $form['items'][0]['price']], 'current_period_start' => $now + 30 * 86400, 'current_period_end' => $now + 60 * 86400]]]])]];
$http->routes[0] = ['GET', '#/v1/subscriptions/sub_1$#', fn () => [200, $sub('active')]];
[$status, $body] = $billing->handle('POST', 'change', ['plan' => 'teacher'], $pat);
same([$status, $body['entitlements']['plan'] ?? null, $body['entitlements']['generator'] ?? null], [200, 'teacher', false], 'Teacher Plus -> Teacher');
same($http->last('POST', '#subscriptions/sub_1$#')['form']['proration_behavior'], 'create_prorations', 'prorated');
$http->routes[] = ['POST', '#/v1/billing_portal/sessions$#', [200, ['url' => 'https://billing.stripe.test/p']]];
same($billing->handle('POST', 'portal', [], $pat)[1]['url'] ?? null, 'https://billing.stripe.test/p', 'the customer portal');
same($http->last('POST', '#billing_portal#')['form']['return_url'], 'https://qbl.test/plans', 'which comes back to the plans page');

// Cancelled: back to Free. An event about an older subscription does not end a newer one.
$subscriptions->sync($sub('canceled', ['id' => 'sub_0']));
same($entitlements->for(2)['plan'], 'teacher', 'an old subscription\'s cancellation leaves the running one alone');
$subscriptions->handleEvent(['id' => 'evt_9', 'type' => 'customer.subscription.deleted', 'data' => ['object' => $sub('canceled')]]);
same([$entitlements->for(2)['plan'], $pdo->query('SELECT role FROM users WHERE id = 2')->fetchColumn()], ['free', 'teacher'], 'cancelled: Free again (the role stays)');
$billing->handle('POST', 'checkout', ['plan' => 'teacher'], $pat);
check(! isset($http->last('POST', '#checkout/sessions#')['form']['subscription_data']['trial_period_days']), 'no second free trial');
same($subscriptions->handleEvent(['id' => 'evt_10', 'type' => 'customer.subscription.updated', 'data' => ['object' => $sub('active', ['customer' => 'cus_unknown', 'metadata' => []])]]), 'unknown customer', 'a customer QBL does not know is ignored');
same($subscriptions->handleEvent(['id' => 'evt_11', 'type' => 'charge.refunded', 'data' => ['object' => ['id' => 'ch_1']]]), 'ignored', 'other events are ignored');
same(Subscriptions::describe(['amount_off' => 1000, 'currency' => 'usd', 'duration' => 'once']), '$10.00 off the first month', 'coupon descriptions');

// ------------------------------------------------------- an organization's license
$clients = new Clients($pdo);
$org = $clients->createOrganization('Riverside', 'district');
$pdo->exec("INSERT INTO users (id, name, email, role, organization_id) VALUES (40, 'Brave Otter 1', 'u-1@roster.qbl.invalid', 'teacher', {$org['id']})");
same($entitlements->for(40)['plan'], 'free', 'a district without a license: Free');
$pdo->prepare('UPDATE organizations SET license = ? WHERE id = ?')->execute([json_encode(['curricular' => true, 'generator' => true, 'students' => null, 'monthly_credits' => 30, 'credit_carryover' => 30]), $org['id']]);
$plan = $entitlements->for(40);
same([$plan['plan'], $plan['curricular'], $plan['generator'], $plan['students'], $plan['organization']['name']], ['organization', true, true, null, 'Riverside'], 'its license applies to its teachers');
same($credits->summary(40)['balance'], 30, 'with its monthly credits, by calendar month');
$pdo->prepare('UPDATE organizations SET license = ? WHERE id = ?')->execute([json_encode(['curricular' => true, 'expires_at' => '2001-01-01']), $org['id']]);
same($entitlements->for(40)['plan'], 'free', 'an expired license gives nothing');

// ----------------------------------------------- gating: missions, students, the generator
$store = new ScenarioStore($pdo);
$classes = new ClassStore($pdo, $entitlements);
$free = $store->createScenario(['title' => 'Free Fun'], 3);
$store->publish((int) $free['id']);
$core = $store->createScenario(['title' => 'Cell Biology'], 3);
$store->updateScenario((int) $core['id'], ['settings' => ['tier' => 'curricular'] + ($core['settings'] ?? [])]);
$store->publish((int) $core['id']);
$coreId = (int) $core['id'];

// Ms Tan (1) has no plan; Pat (2) is on Teacher again.
$http->routes[0] = ['GET', '#/v1/subscriptions/sub_1$#', fn () => [200, $sub('active', ['items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_teacher'], 'current_period_start' => $now, 'current_period_end' => $now + 30 * 86400]]]])]];
$subscriptions->handleEvent(['id' => 'evt_12', 'type' => 'invoice.paid', 'data' => ['object' => ['id' => 'in_1', 'parent' => ['subscription_details' => ['subscription' => 'sub_1']]]]]);
same($entitlements->for(2)['plan'], 'teacher', 'invoice.paid (with the subscription where newer Stripe versions put it) brings the plan back');

$tanCards = array_column($classes->assignable(1), null, 'id');
same([$tanCards[$coreId]['tier'], $tanCards[$coreId]['locked'], $tanCards[(int) $free['id']]['locked']], ['curricular', true, false], 'a teacher without a plan sees curricular missions locked');
refused(fn () => $classes->addStudent(1, 'ann@school.test'), 402, 'and cannot add students on Free (limit 0)');
same(array_column($classes->assignable(2), 'locked', 'id')[$coreId], false, 'with Teacher, they are open');
$classes->addStudent(2, 'ann@school.test');
$classes->addStudent(2, 'ben@school.test');
$message = refused(fn () => $classes->addStudent(2, 'cy@school.test'), 402, 'the plan\'s student limit holds');
check(str_contains((string) $message, 'up to 2 students'), 'and says what the limit is');
$classes->addStudent(2, 'ann@school.test'); // already there: fine at the limit
refused(fn () => $classes->assign(1, $coreId, []), 402, 'assigning a curricular mission needs the plan');
$assignment = $classes->assign(2, $coreId, [11]);

// Playing: in an assignment the teacher's plan counts; anywhere else the player's own.
same([$classes->mayJoin(11, 'student', $coreId, 'a'.$assignment['id']), $classes->mayJoin(11, 'student', $coreId, 'public')], [true, false], 'a student plays a curricular mission through their teacher\'s assignment, not on their own');
same($classes->mayJoin(2, 'teacher', $coreId, 'public'), true, 'the teacher with the plan plays it');
same([$classes->mayJoin(1, 'teacher', $coreId, 'public'), $classes->mayJoin(1, 'teacher', (int) $free['id'], 'public')], [false, true], 'without a plan: free ones only');
same($classes->needsPlan($coreId, null, 'public'), true, 'signed out: needs a plan');
same($classes->mayJoin(3, 'admin', $coreId, 'public'), true, 'administrators play anything');
$annMissions = array_column($classes->missions(11), null, 'group');
check(isset($annMissions['a'.$assignment['id']]) && ! $annMissions['a'.$assignment['id']]['locked'], 'the assigned curricular mission is on the student\'s page, open');
check(! isset(array_column(array_filter($classes->missions(11), fn ($m) => $m['kind'] === 'public'), null, 'id')[$coreId]), 'the public curricular one is not shown to a student without a plan');
$tanPublic = array_column(array_filter($classes->missions(1), fn ($m) => $m['kind'] === 'public'), null, 'id');
same($tanPublic[$coreId]['locked'] ?? null, true, 'a teacher without a plan sees it locked, to know what a plan gives');

// The plan lapses: the assignment locks too.
$subscriptions->sync($sub('canceled'));
same($classes->mayJoin(11, 'student', $coreId, 'a'.$assignment['id']), false, 'when the teacher\'s plan ends, their assigned curricular missions close');
same(array_column($classes->missions(11), 'locked', 'group')['a'.$assignment['id']], true, 'and show as locked');
$subscriptions->sync($sub('active', ['items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_teacher'], 'current_period_start' => $now, 'current_period_end' => $now + 30 * 86400]]]]));

// The editor: only administrators set the tier; a copy of a curricular mission needs the plan.
$editor = new EditorApi($store, $entitlements);
$mine = $store->createScenario(['title' => 'Mine'], 1);
same($editor->handle('PATCH', 'scenarios/'.$mine['id'], ['settings' => ['tier' => 'curricular']], ['id' => 1, 'role' => 'teacher'])[0], 403, 'a teacher cannot make their mission curricular');
same($editor->handle('PATCH', 'scenarios/'.$coreId, ['settings' => ['tier' => 'curricular', 'visibility' => 'public']], ['id' => 3, 'role' => 'admin'])[0], 200, 'an administrator can');
same($editor->handle('PATCH', 'scenarios/'.$coreId, ['settings' => ['visibility' => 'public']], ['id' => 3, 'role' => 'admin'])[0], 200, 'settings sent without a tier…');
check(ClassStore::isCurricular($store->scenario($coreId)), '…keep the one it has');
same($editor->handle('POST', "scenarios/$coreId/duplicate", [], ['id' => 1, 'role' => 'teacher'])[0], 402, 'copying a curricular mission needs the plan');
[$status, $copy] = $editor->handle('POST', "scenarios/$coreId/duplicate", [], ['id' => 2, 'role' => 'teacher']);
check($status === 201 && ClassStore::isCurricular($store->scenario((int) $copy['scenario']['id'])), 'with it, the copy is curricular too');
same($editor->handle('PATCH', 'scenarios/'.$copy['scenario']['id'], ['settings' => ['tier' => 'free']], ['id' => 2, 'role' => 'teacher'])[0], 403, 'and its owner cannot make it free');
$pdo->exec('UPDATE scenarios SET user_id = NULL WHERE id = '.$coreId);
same($editor->handle('GET', "scenarios/$coreId/preview", [], ['id' => 1, 'role' => 'teacher'])[0], 402, 'a shared curricular sample cannot be opened, previewed or exported without the plan');
same($editor->handle('GET', "scenarios/$coreId/preview", [], ['id' => 2, 'role' => 'teacher'])[0], 200, 'with it, it can');

// The generator: Teacher Plus, credits, one at a time, refunds.
$queued = [];
$gen = new GenerationApi($pdo, $entitlements, $credits, function (int $id) use (&$queued) {
    $queued[] = $id;
});
same($gen->handle('POST', [], ['prompt' => 'Plants and light for grade 4'], ['id' => 2, 'role' => 'teacher'])[0], 402, 'the generator needs Teacher Plus');
$subscriptions->sync($sub('active', ['items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_plus'], 'current_period_start' => $now + 90 * 86400, 'current_period_end' => $now + 120 * 86400]]]]));
same($gen->handle('POST', [], ['prompt' => 'Plants'], ['id' => 2, 'role' => 'teacher'])[0], 422, 'a description of a few words is not enough');
same($gen->handle('POST', [], ['prompt' => 'x'], ['id' => 11, 'role' => 'student'])[0], 403, 'students do not generate');
$before = $credits->summary(2)['balance'];
[$status, $body] = $gen->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery for grade 4', 'grade' => '4', 'min_players' => 2, 'max_players' => 4], ['id' => 2, 'role' => 'teacher']);
same([$status, $body['generation']['status'] ?? null, $queued], [202, 'queued', [$body['generation']['id'] ?? 0]], 'a generation is queued');
same($credits->summary(2)['balance'], $before - 10, 'and costs 10 credits');
same($gen->handle('POST', [], ['prompt' => 'Another mission about the water cycle'], ['id' => 2, 'role' => 'teacher'])[0], 409, 'one at a time');
$runId = $body['generation']['id'];
same((new GenerationRuns($pdo))->get($runId)['options'], ['grade' => '4', 'min_players' => 2, 'max_players' => 4], 'the form becomes the generator\'s options');
same(GenerationApi::options(['opening' => 'action', 'focus' => 'rigor', 'freedom' => 'sideways']), ['min_players' => 2, 'max_players' => 6, 'opening' => 'action', 'focus' => 'rigor'], 'with the design approach settings it knows');
same($gen->handle('GET', [], [], ['id' => 2, 'role' => 'teacher'])[1]['generations'][0]['approach'], null, 'how it leans is not known before it is aligned');
(new GenerationRuns($pdo))->update($runId, ['alignment' => ['learning_objectives' => [], 'approach' => ['opening' => 'story']]]);
same($gen->handle('GET', [], [], ['id' => 2, 'role' => 'teacher'])[1]['generations'][0]['approach'], ['opening' => 'story', 'focus' => 'balanced', 'freedom' => 'balanced'], 'then the list says how it leans, with what was chosen for the teacher');
GenerationApi::failed($pdo, $credits, $runId, 'The image service is down.');
GenerationApi::failed($pdo, $credits, $runId, 'Again.');
same([$credits->summary(2)['balance'], (new GenerationRuns($pdo))->get($runId)['status']], [$before, 'failed'], 'a failed generation gives its credits back, once');
same($gen->handle('GET', [(string) $runId], [], ['id' => 1, 'role' => 'teacher'])[0], 404, 'someone else\'s generation is not shown');
same($gen->handle('GET', [], [], ['id' => 2, 'role' => 'teacher'])[1]['generations'][0]['error'] ?? null, 'The image service is down.', 'the list says why one failed');
$credits->adjust(2, -$credits->summary(2)['balance'], 'empty');
same($gen->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery'], ['id' => 2, 'role' => 'teacher'])[0], 402, 'out of credits');
same((int) $pdo->query('SELECT COUNT(*) FROM scenario_generations')->fetchColumn(), 1, 'and no run is left behind');
$broken = new GenerationApi($pdo, $entitlements, $credits, fn () => null, fn () => throw new RuntimeException('no key'));
$credits->adjust(2, 50, 'more');
same($broken->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery'], ['id' => 2, 'role' => 'teacher'])[0], 503, 'a site that cannot generate says so before charging');
same($credits->summary(2)['balance'], 50, 'and charges nothing');

// Progress, cancelling, the editor's progress chip, and what administrators see.
$clock = time();
$gen = new GenerationApi($pdo, $entitlements, $credits, function (int $id) use (&$queued) {
    $queued[] = $id;
}, null, true, function () use (&$clock) {
    return $clock;
});
$teacher = ['id' => 2, 'role' => 'teacher'];
[$status, $body] = $gen->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery for grade 4'], $teacher);
$runId = $body['generation']['id'];
same([$status, $body['credits']['balance'] ?? null], [202, 40], 'starting one says the credits left');
same([$body['generation']['progress']['stage'], $body['generation']['progress']['percent'], $body['generation']['progress']['stages']], ['queued', 0, ['aligning', 'designing', 'drawing', 'building', 'voicing', 'importing']], 'a queued run has an empty bar, and the stages it will go through');
same($gen->handle('GET', ['active'], [], $teacher)[1]['generation']['id'] ?? null, $runId, 'the progress chip finds the one being made');
same($gen->handle('GET', ['active'], [], ['id' => 1, 'role' => 'teacher'])[1]['generation'], null, 'and only your own');
same($gen->handle('GET', ['active'], [], ['id' => 11, 'role' => 'student'])[0], 403, 'students cannot ask');
same($gen->handle('POST', [(string) $runId, 'cancel'], [], ['id' => 1, 'role' => 'teacher'])[0], 404, 'another teacher cannot stop it');
[$status, $body] = $gen->handle('POST', [(string) $runId, 'cancel'], [], $teacher);
same([$status, $body['generation']['status'], $body['generation']['busy'], $body['credits']['balance']], [200, 'cancelled', false, 50], 'a queued run stops at once, with its credits back');
same($gen->handle('GET', ['active'], [], $teacher)[1]['generation'], null, 'and is no longer being made');
same($gen->handle('POST', [(string) $runId, 'cancel'], [], $teacher)[0], 409, 'a stopped run cannot be stopped again');

// One the worker is making: asked to stop, it stops at its next report, and then its credits come back.
[, $body] = $gen->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery for grade 4'], $teacher);
$runId = $body['generation']['id'];
$runs = new GenerationRuns($pdo);
$progress = new GenerationProgress($runs, $runId, GenerationProgress::stagesFor(true), fn () => 1.234);
$progress->stage('drawing', null, 10);
$progress->count(4, null, 'Painting the Greenhouse (scene 2 of 5)');
$shown = $gen->handle('GET', [(string) $runId], [], $teacher)[1]['generation'];
same([$shown['status'], $shown['progress']['done'], $shown['progress']['total'], $shown['progress']['detail']], ['drawing', 4, 10, 'Painting the Greenhouse (scene 2 of 5)'], 'the run says how far it has got');
same($shown['progress']['percent'], GenerationProgress::percent('drawing', 0.4), 'and its percent of the whole');
check(! array_key_exists('usd', $shown), 'a teacher is not shown what it spent');
same($gen->handle('GET', [(string) $runId], [], ['id' => 3, 'role' => 'admin'])[1]['generation']['usd'], 1.23, 'an administrator is');
$progress->fraction(0.1);
same($runs->get($runId)['progress']['percent'], GenerationProgress::percent('drawing', 0.4), 'the bar never goes backwards');
[$status, $body] = $gen->handle('POST', [(string) $runId, 'cancel'], [], $teacher);
same([$body['generation']['status'], $body['generation']['cancelling'], $body['credits']['balance']], ['drawing', true, 40], 'a run being made is asked to stop (the worker stops it)');
check((function () use ($progress) {
    try {
        $progress->count(5);
    } catch (App\Qbl\Generation\GenerationCancelled) {
        return true;
    }

    return false;
})(), 'the worker stops at its next picture');
GenerationApi::cancelled($pdo, $credits, $runId);
GenerationApi::cancelled($pdo, $credits, $runId);
same([$runs->get($runId)['status'], $credits->summary(2)['balance']], ['cancelled', 50], 'and gives the credits back, once');

// A run whose worker went away (the container restarted) does not keep the teacher waiting.
[, $body] = $gen->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery for grade 4'], $teacher);
$runId = $body['generation']['id'];
$runs->update($runId, ['status' => 'designing']);
$clock += GenerationApi::STALE_SECONDS - 60;
same($gen->handle('GET', ['active'], [], $teacher)[1]['generation']['status'] ?? null, 'designing', 'a slow run is left alone');
$clock += 120;
$list = $gen->handle('GET', [], [], $teacher)[1];
same([$list['generations'][0]['status'], $credits->summary(2)['balance']], ['failed', 50], 'one that has not moved for half an hour is failed, credits back');
check(str_contains($list['generations'][0]['error'], 'Try again'), 'saying so');
same($gen->handle('POST', [], ['prompt' => 'Plants need light: a greenhouse mystery for grade 4'], $teacher)[0], 202, 'and another can be started');

// Administrators see everyone's; teachers do not.
same($gen->handle('GET', ['all'], [], $teacher)[0], 403, 'a teacher cannot list everyone\'s generations');
$all = $gen->handle('GET', ['all'], [], ['id' => 3, 'role' => 'admin'])[1]['generations'];
check(count($all) >= 4 && isset($all[0]['user']['name']) && array_key_exists('usd', $all[0]), 'an administrator can, with who asked and what each spent');
same($gen->handle('GET', ['nonsense'], [], $teacher)[0], 404, 'anything else is not found');

// The audit log of a run (what each call took and cost): administrators only.
$auditLog = new GenerationEvents($pdo);
$auditLog->record($runId, ['type' => 'picture', 'kind' => 'background', 'step' => 'background:orchard', 'stage' => 'drawing', 'usd' => 0.134, 'seconds' => 12.5, 'outcome' => 'kept']);
same($gen->handle('GET', [(string) $runId, 'events'], [], $teacher)[0], 403, 'a teacher cannot see what a generation cost call by call');
[$status, $audited] = $gen->handle('GET', [(string) $runId, 'events'], [], ['id' => 3, 'role' => 'admin']);
same([$status, count($audited['events']), $audited['events'][0]['step'], $audited['events'][0]['duration_ms'], $audited['totals']['total']['usd']], [200, 1, 'background:orchard', 12500, 0.134], 'an administrator can, with every call and the totals');

// One scene for a scenario being made: cheaper, its own stages, only into a scenario the teacher can edit.
foreach ($gen->handle('GET', [], [], $teacher)[1]['generations'] as $g) {
    if ($g['busy']) {
        $gen->handle('POST', [(string) $g['id'], 'cancel'], [], $teacher);
    }
}
$mine = $store->createScenario(['title' => 'Greenhouse'], 2);
$theirs = $store->createScenario(['title' => 'Not yours'], 1);
$scene = ['kind' => 'scene', 'prompt' => 'A misty greenhouse with tall ferns', 'kind_of_place' => 'indoor', 'time' => 'dusk', 'width' => 'enormous', 'repeat' => 'cycle', 'critters' => true, 'hotspots' => false, 'grade' => '4'];
same($gen->handle('POST', [], ['scenario_id' => $theirs['id']] + $scene, $teacher)[0], 404, 'a scene cannot be added to someone else\'s scenario');
same($gen->handle('POST', [], ['scenario_id' => 999999] + $scene, $teacher)[0], 404, 'or to one that does not exist');
same($gen->handle('POST', [], ['scenario_id' => $mine['id'], 'prompt' => 'A cave'] + $scene, $teacher)[0], 422, 'a scene needs a few words too');
same($gen->handle('POST', [], ['scenario_id' => $mine['id'], 'grade' => 'thirteenth'] + $scene, $teacher)[0], 422, 'and a real grade');
$before = $credits->summary(2)['balance'];
[$status, $body] = $gen->handle('POST', [], ['scenario_id' => $mine['id']] + $scene, $teacher);
$made = $body['generation'] ?? [];
same([$status, $made['kind'] ?? null, $made['progress']['stages'] ?? null], [202, 'scene', ['designing', 'drawing', 'building', 'importing']], 'a scene is queued, with its own four stages');
same($credits->summary(2)['balance'], $before - 2, 'and costs 2 credits');
same($made['options'], ['kind' => 'scene', 'method' => 'scene', 'scenario_id' => (int) $mine['id'], 'place' => 'indoor', 'time' => 'dusk', 'repeat' => 'cycle', 'hotspots' => false, 'critters' => true, 'grade' => '4'], 'what the teacher chose is kept (an unknown width is left to the designer)');
same($gen->handle('GET', [], [], $teacher)[1]['costs'], ['mission' => 10, 'scene' => 2], 'the page is told what a mission and a scene cost');
same($gen->handle('POST', [], ['scenario_id' => $mine['id']] + $scene, $teacher)[0], 409, 'one at a time, scenes too');
same($gen->handle('POST', [], ['scenario_id' => $mine['id']] + $scene, ['id' => 3, 'role' => 'admin'])[0], 202, 'an administrator may add a scene to anyone\'s scenario');
[, $stopped] = $gen->handle('POST', [(string) $made['id'], 'cancel'], [], $teacher);
same($stopped['credits']['balance'], $before, 'a stopped scene gives its credits back');
same($pdo->query("SELECT note FROM credit_ledger WHERE reason = 'refund' ORDER BY id DESC LIMIT 1")->fetchColumn(), 'Credits back: you stopped the scene', 'saying it was the scene');

// ClassApi passes plans through to Classes.
$classApi = new ClassApi($pdo, null, $entitlements);
same($classApi->handle('POST', 'teach/students', ['email' => 'cy@school.test'], ['id' => 1, 'role' => 'teacher'])[0], 402, 'Classes refuses past the limit with 402');

echo $failures ? "billing: $failures of $checks checks FAILED\n" : "billing: all $checks checks passed\n";
exit($failures ? 1 : 0);
