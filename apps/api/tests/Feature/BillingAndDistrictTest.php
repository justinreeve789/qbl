<?php

namespace Tests\Feature;

use App\Jobs\RunGeneration;
use App\Jobs\SyncRoster;
use App\Models\Scenario;
use App\Models\User;
use App\Qbl\Billing\Credits;
use App\Qbl\Billing\Stripe;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\ScenarioStore;
use Database\Seeders\ShippedScenarioSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use OneLogin\Saml2\Utils as SamlUtils;
use Tests\TestCase;

/**
 * Plans, Stripe, credits, the generator from the editor, the district admin panel, and signing in
 * through SAML and Clever, as Laravel serves them on the real migrations. The rules are tested
 * without the framework in tests/billing.php and tests/district.php; this checks the wiring:
 * routes, the webhook's signature, the queue, SAML's XML signatures, the sign-in pages.
 */
class BillingAndDistrictTest extends TestCase
{
    use RefreshDatabase;

    private FakeHttp $http;

    protected function setUp(): void
    {
        parent::setUp();
        $this->http = new FakeHttp;
        $this->app->instance(HttpClient::class, $this->http);
    }

    private function user(string $name, string $role, array $more = []): User
    {
        $user = User::create(['name' => $name, 'email' => strtolower($name).'@example.test', 'password' => 'secret-password', 'role' => $role]);
        $user->forceFill($more)->save();

        return $user;
    }

    private function as(User $user): static
    {
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('test')->plainTextToken);
    }

    private function billingOn(): void
    {
        config([
            'qbl_billing.enabled' => true,
            'qbl_billing.stripe.secret' => 'sk_test_x',
            'qbl_billing.stripe.webhook_secret' => 'whsec_x',
            'qbl_billing.stripe.base_url' => 'https://stripe.test',
            'qbl_billing.stripe.prices' => ['teacher' => 'price_t', 'teacher_plus' => 'price_p'],
        ]);
    }

    public function test_plans_checkout_webhook_and_what_a_plan_opens(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        $this->billingOn();
        $pat = $this->user('Pat', 'student');
        $ann = $this->user('Ann', 'student');
        $admin = $this->user('Root', 'admin');

        // The plans can be read by anyone; the account's own status needs a sign-in.
        $this->getJson('/api/billing')->assertOk()->assertJsonPath('plans.1.key', 'teacher')->assertJsonPath('payments', true);
        $this->as($pat)->getJson('/api/billing')->assertOk()->assertJsonPath('entitlements.plan', 'free')->assertJsonPath('entitlements.curricular', false);

        // Make the demo a curricular mission (only an administrator may).
        $demo = Scenario::first();
        $this->as($admin)->patchJson("/api/editor/scenarios/{$demo->id}", ['settings' => ['tier' => 'curricular'] + ($demo->settings ?? [])])->assertOk();
        DB::table('scenarios')->where('id', $demo->id)->update(['published_at' => null]);
        $this->as($admin)->postJson("/api/editor/scenarios/{$demo->id}/publish")->assertOk();
        $this->as($pat)->getJson("/api/scenarios/{$demo->code}/play")->assertForbidden()->assertJsonPath('needs_plan', true);
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->getJson("/api/scenarios/{$demo->code}/play")->assertUnauthorized();

        // Checkout: a Stripe customer, then a Checkout page with the trial.
        $this->http->on('POST', '#/v1/customers$#', [200, ['id' => 'cus_pat']]);
        $this->http->on('POST', '#/v1/checkout/sessions$#', [200, ['url' => 'https://checkout.stripe.test/s']]);
        $this->as($pat)->postJson('/api/billing/checkout', ['plan' => 'teacher_plus'])->assertOk()->assertJsonPath('url', 'https://checkout.stripe.test/s');
        $this->assertSame('7', $this->http->form('#checkout/sessions#')['subscription_data']['trial_period_days']);
        $this->assertSame('Bearer sk_test_x', $this->http->last('#checkout/sessions#')['headers']['Authorization']);

        // Stripe's webhook: only signed events are believed.
        $now = time();
        $subscription = ['id' => 'sub_1', 'customer' => 'cus_pat', 'status' => 'trialing', 'metadata' => ['qbl_user_id' => (string) $pat->id], 'trial_start' => $now, 'trial_end' => $now + 7 * 86400,
            'items' => ['data' => [['id' => 'si_1', 'price' => ['id' => 'price_p'], 'current_period_start' => $now, 'current_period_end' => $now + 7 * 86400]]]];
        $this->http->on('GET', '#/v1/subscriptions/sub_1$#', [200, $subscription]);
        $event = json_encode(['id' => 'evt_1', 'type' => 'checkout.session.completed', 'data' => ['object' => ['mode' => 'subscription', 'customer' => 'cus_pat', 'subscription' => 'sub_1', 'metadata' => ['qbl_user_id' => (string) $pat->id]]]]);
        $this->flushHeaders();
        $this->call('POST', '/api/billing/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_STRIPE_SIGNATURE' => Stripe::sign($event, 'whsec_wrong')], $event)->assertStatus(400);
        $this->call('POST', '/api/billing/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_STRIPE_SIGNATURE' => Stripe::sign($event, 'whsec_x')], $event)
            ->assertOk()->assertJsonPath('result', 'subscription sub_1 is trialing');
        $this->assertSame('teacher', $pat->fresh()->role);

        // Now a teacher on the Teacher Plus trial: curricular missions, students, credits.
        $this->as($pat)->getJson('/api/billing')->assertOk()->assertJsonPath('entitlements.plan', 'teacher_plus')->assertJsonPath('entitlements.trial', true)->assertJsonPath('credits.balance', 20);
        $this->as($pat)->getJson("/api/scenarios/{$demo->code}/play")->assertOk();
        $this->as($pat)->postJson('/api/teach/students', ['email' => 'ann@example.test'])->assertCreated();
        $this->as($pat)->getJson('/api/teach/scenarios')->assertOk()->assertJsonPath('scenarios.0.locked', false);
        $this->as($pat)->getJson('/api/me')->assertOk()->assertJsonMissingPath('user.admin_of');

        // The generator from the editor: queued, paid in credits; a failure gives them back.
        Queue::fake();
        $id = $this->as($pat)->postJson('/api/editor/generations', ['prompt' => 'A mission about how plants use light, for grade 4'])->assertStatus(503)->json('message');
        $this->assertStringContainsString('ANTHROPIC_API_KEY', $id);
        config(['qbl_generation.llm.api_key' => 'test-key', 'qbl_generation.images.driver' => 'placeholder']);
        $this->app->forgetInstance(GenerationFactory::class);
        $run = $this->as($pat)->postJson('/api/editor/generations', ['prompt' => 'A mission about how plants use light, for grade 4', 'grade' => '4'])
            ->assertStatus(202)->assertJsonPath('generation.status', 'queued')->json('generation.id');
        Queue::assertPushed(RunGeneration::class, fn ($job) => $job->generationId === $run);
        $this->as($pat)->getJson('/api/billing/credits')->assertOk()->assertJsonPath('credits.balance', 10)->assertJsonPath('ledger.0.reason', 'spend');
        (new RunGeneration($run))->failed(new \RuntimeException('The worker ran out of time.'));
        $this->as($pat)->getJson("/api/editor/generations/$run")->assertOk()->assertJsonPath('generation.status', 'failed');
        $this->as($pat)->getJson('/api/billing/credits')->assertOk()->assertJsonPath('credits.balance', 20);
        // The job itself: the generator fails (here Claude cannot be reached), the run says why, the credits come back.
        $this->app->instance(GenerationFactory::class, new GenerationFactory(config('qbl_generation'), app(ScenarioStore::class), $this->http));
        $again = $this->as($pat)->postJson('/api/editor/generations', ['prompt' => 'A mission about the water cycle, for grade 5'])->assertStatus(202)->json('generation.id');
        $this->as($pat)->getJson('/api/billing/credits')->assertJsonPath('credits.balance', 10);
        (new RunGeneration($again))->handle(app(GenerationFactory::class), app(Credits::class));
        $this->assertNotEmpty($this->as($pat)->getJson("/api/editor/generations/$again")->assertJsonPath('generation.status', 'failed')->json('generation.error'));
        $this->as($pat)->getJson('/api/billing/credits')->assertOk()->assertJsonPath('credits.balance', 20);
        (new RunGeneration($again))->handle(app(GenerationFactory::class), app(Credits::class));
        $this->as($pat)->getJson('/api/billing/credits')->assertJsonPath('credits.balance', 20);
        $this->as($ann)->postJson('/api/editor/generations', ['prompt' => 'A mission about how plants use light'])->assertForbidden();

        // A cancelled subscription closes the curricular mission again.
        $event = json_encode(['id' => 'evt_2', 'type' => 'customer.subscription.deleted', 'data' => ['object' => ['status' => 'canceled'] + $subscription]]);
        $this->flushHeaders();
        $this->call('POST', '/api/billing/webhook', [], [], [], ['CONTENT_TYPE' => 'application/json', 'HTTP_STRIPE_SIGNATURE' => Stripe::sign($event, 'whsec_x')], $event)->assertOk();
        $this->as($pat)->getJson("/api/scenarios/{$demo->code}/play")->assertForbidden();
        $this->as($admin)->getJson("/api/scenarios/{$demo->code}/play")->assertOk();
    }

    public function test_schools_and_districts_ask_for_a_quote(): void
    {
        config(['qbl_billing.sales_email' => 'sales@qbl.test', 'mail.default' => 'array']);
        $this->postJson('/api/billing/quote', ['name' => 'Dana', 'email' => 'not an address', 'organization' => 'Riverside'])->assertStatus(422);
        $this->postJson('/api/billing/quote', ['name' => 'Dana Diaz', 'email' => 'dana@riverside.org', 'organization' => 'Riverside Unified', 'students' => 4200, 'message' => '<b>Hi</b> there'])->assertCreated();
        $this->assertSame('Hi there', DB::table('quote_requests')->value('message'));
        $sent = Mail::mailer('array')->getSymfonyTransport()->messages();
        $this->assertCount(1, $sent);
        $this->assertStringContainsString('Riverside Unified', $sent[0]->getOriginalMessage()->getSubject());
        $this->assertStringContainsString('Students: 4200', $sent[0]->getOriginalMessage()->getTextBody());
    }

    public function test_the_district_panel_and_signing_in_with_saml_and_clever(): void
    {
        config(['services.clever.client_id' => 'app', 'services.clever.client_secret' => 'secret', 'services.clever.api_base' => 'https://api.clever.test', 'services.clever.auth_base' => 'https://clever.test']);
        $root = $this->user('Root', 'admin');
        $ivy = $this->user('Ivy', 'teacher');
        $org = $this->as($root)->postJson('/api/district/orgs', ['name' => 'Riverside Unified'])->assertCreated()->json('organization.id');
        $this->as($root)->postJson("/api/district/orgs/$org/admins", ['email' => 'ivy@example.test'])->assertCreated();
        $this->as($ivy)->getJson('/api/me')->assertOk()->assertJsonPath('user.admin_of.0.name', 'Riverside Unified');
        $this->as($ivy)->putJson("/api/district/orgs/$org/integrations/saml", ['config' => []])->assertForbidden();
        $this->artisan('qbl:org', ['action' => 'enable', 'organization' => 'Riverside Unified'])->assertSuccessful();

        // SAML: a key and certificate for a pretend identity provider.
        $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
        $cert = openssl_csr_sign(openssl_csr_new(['commonName' => 'idp.test'], $key), null, $key, 30);
        openssl_x509_export($cert, $certPem);
        openssl_pkey_export($key, $keyPem);
        $this->as($ivy)->putJson("/api/district/orgs/$org/integrations/saml", [
            'config' => ['idp_entity_id' => 'https://idp.test/saml', 'idp_sso_url' => 'https://idp.test/sso', 'idp_x509_cert' => $certPem, 'role_attribute' => 'eduPersonAffiliation'],
            'enabled' => true,
        ])->assertOk()->assertJsonPath('integration.enabled', true);

        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $base = rtrim(config('app.url'), '/')."/api/sso/$org/saml";
        $this->get("/api/sso/$org/saml/metadata")->assertOk()->assertSee('AssertionConsumerService', false)->assertSee("$base/acs", false);
        $login = $this->get("/api/sso/$org/saml/login?return=/editor/%23/classes")->assertRedirect();
        $this->assertStringStartsWith('https://idp.test/sso?SAMLRequest=', $login->headers->get('Location'));
        $this->assertStringContainsString('RelayState='.rawurlencode('/editor/#/classes'), $login->headers->get('Location'));

        $response = $this->samlResponse($base, 'ivy.teacher@riverside.org', ['eduPersonAffiliation' => 'faculty'], $keyPem, $certPem);
        $page = $this->post("/api/sso/$org/saml/acs", ['SAMLResponse' => $response, 'RelayState' => '/editor/#/classes'])->assertOk();
        $page->assertSee("localStorage.setItem('qbl.token'", false)->assertSee('/editor/#/classes', false);
        $person = User::where('organization_id', $org)->firstOrFail();
        $this->assertSame('teacher', $person->role);
        $this->assertStringStartsWith('saml:', $person->external_id);
        $this->assertStringNotContainsString('ivy.teacher', $person->email.$person->name.$person->external_id);
        // The same answer again is refused; an unsigned one too.
        $this->post("/api/sso/$org/saml/acs", ['SAMLResponse' => $response])->assertRedirect('/missions#signin=sso');
        $unsigned = base64_encode(str_replace('_resp', '_resp2', $this->samlXml($base, 'eve@riverside.org', [])));
        $this->post("/api/sso/$org/saml/acs", ['SAMLResponse' => $unsigned])->assertRedirect('/missions#signin=sso');
        $this->assertSame(1, User::where('organization_id', $org)->count());

        // Clever: Instant Login for a district that has connected.
        $this->as($ivy)->putJson("/api/district/orgs/$org/integrations/clever", ['config' => ['district_id' => '5a1b2c3d4e5f60718293a4b5'], 'enabled' => true])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders();
        $this->http->on('POST', '#clever\.test/oauth/tokens$#', [200, ['access_token' => 'user-token']]);
        $this->http->on('GET', '#api\.clever\.test/v3\.0/me$#', [200, ['data' => ['id' => 'stu1', 'district' => '5a1b2c3d4e5f60718293a4b5', 'type' => 'student']]]);
        $this->get('/api/sso/clever/login?return=/missions')->assertRedirect();
        $this->get('/api/sso/clever/callback?code=abc&state=forged')->assertRedirect('/missions#signin=expired');
        $this->get('/api/sso/clever/callback?code=abc')->assertOk()->assertSee("localStorage.setItem('qbl.token'", false);
        $this->assertSame('student', User::where('external_id', 'clever:stu1')->value('role'));

        // A roster file and a queued Clever sync, from the panel.
        $file = UploadedFile::fake()->createWithContent('roster.csv', "role,external_id,grade_level,teacher_ids\nteacher,T-1,,\nstudent,S-1,5,T-1\n");
        $this->as($ivy)->post("/api/district/orgs/$org/roster", ['file' => $file], ['Accept' => 'application/json'])->assertCreated()->assertJsonPath('run.summary.students.created', 1);
        Queue::fake();
        $this->as($ivy)->postJson("/api/district/orgs/$org/integrations/clever/sync")->assertStatus(202);
        Queue::assertPushed(SyncRoster::class);
        $this->as($ivy)->getJson("/api/district/orgs/$org")->assertOk()->assertJsonPath('counts.students', 2)->assertJsonPath('addresses.saml_login_url', "$base/login");
    }

    private function samlXml(string $base, string $nameId, array $attributes): string
    {
        $t = fn (int $offset = 0) => gmdate('Y-m-d\TH:i:s\Z', time() + $offset);
        $attrs = '';
        foreach ($attributes as $name => $value) {
            $attrs .= '<saml:Attribute Name="'.$name.'"><saml:AttributeValue>'.$value.'</saml:AttributeValue></saml:Attribute>';
        }

        return '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp'.bin2hex(random_bytes(8)).'" Version="2.0" IssueInstant="'.$t().'" Destination="'.$base.'/acs">'
            .'<saml:Issuer>https://idp.test/saml</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>'
            .'<saml:Assertion ID="_a'.bin2hex(random_bytes(8)).'" Version="2.0" IssueInstant="'.$t().'"><saml:Issuer>https://idp.test/saml</saml:Issuer>'
            .'<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">'.$nameId.'</saml:NameID>'
            .'<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="'.$t(300).'" Recipient="'.$base.'/acs"/></saml:SubjectConfirmation></saml:Subject>'
            .'<saml:Conditions NotBefore="'.$t(-60).'" NotOnOrAfter="'.$t(300).'"><saml:AudienceRestriction><saml:Audience>'.$base.'/metadata</saml:Audience></saml:AudienceRestriction></saml:Conditions>'
            .'<saml:AuthnStatement AuthnInstant="'.$t().'" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>'
            .($attrs ? "<saml:AttributeStatement>$attrs</saml:AttributeStatement>" : '').'</saml:Assertion></samlp:Response>';
    }

    /** A response signed by the pretend identity provider, base64 as the browser posts it. */
    private function samlResponse(string $base, string $nameId, array $attributes, string $keyPem, string $certPem): string
    {
        return base64_encode(SamlUtils::addSign($this->samlXml($base, $nameId, $attributes), $keyPem, $certPem, 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', 'http://www.w3.org/2001/04/xmlenc#sha256'));
    }
}

/** Outside services, answered by pattern; every request kept. */
final class FakeHttp implements HttpClient
{
    public array $sent = [];

    private array $routes = [];

    public function on(string $method, string $pattern, array $answer): void
    {
        array_unshift($this->routes, [$method, $pattern, $answer]);
    }

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        $this->sent[] = compact('method', 'url', 'headers', 'body');
        foreach ($this->routes as [$m, $pattern, $answer]) {
            if ($m === $method && preg_match($pattern, $url)) {
                return new HttpResponse($answer[0], json_encode($answer[1]));
            }
        }

        return new HttpResponse(404, json_encode(['error' => ['message' => "Nothing at $method $url"]]));
    }

    public function last(string $pattern): ?array
    {
        foreach (array_reverse($this->sent) as $s) {
            if (preg_match($pattern, $s['url'])) {
                return $s;
            }
        }

        return null;
    }

    public function form(string $pattern): array
    {
        parse_str((string) ($this->last($pattern)['body'] ?? ''), $form);

        return $form;
    }
}
