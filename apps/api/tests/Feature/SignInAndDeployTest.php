<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Laravel\Socialite\Contracts\Factory as SocialiteFactory;
use Laravel\Socialite\Facades\Socialite;
use Laravel\Socialite\Two\User as GoogleUser;
use Tests\TestCase;

/**
 * Google sign-in, creating an account with a password, running behind a TLS-terminating firewall, seeding by hand, and the
 * one-migration-per-table layout on a database made before it.
 */
class SignInAndDeployTest extends TestCase
{
    use RefreshDatabase;

    private function withGoogle(array $more = []): void
    {
        config(['services.google.client_id' => 'client-id.apps.googleusercontent.com', 'services.google.client_secret' => 'secret'] + $more);
    }

    private function googleAccount(string $id, string $email, string $name = 'Ada Lovelace', bool $verified = true): GoogleUser
    {
        return (new GoogleUser)->setRaw(['sub' => $id, 'email' => $email, 'email_verified' => $verified])->map(['id' => $id, 'email' => $email, 'name' => $name]);
    }

    /**
     * In production every request is a new PHP process. Here they share one, so what Socialite
     * keeps from the previous request (or a fake put in its place) is dropped between them.
     */
    private function newRequest(): static
    {
        Socialite::clearResolvedInstance(SocialiteFactory::class);
        $this->app->forgetInstance(SocialiteFactory::class);
        $this->app['auth']->forgetGuards();
        $this->unencryptedCookies = [];

        return $this;
    }

    /** Start a sign-in as a browser would, and return what it needs for the way back: the state and the cookie. */
    private function begin(string $return = '/editor/', ?string $role = null): array
    {
        $response = $this->newRequest()->get('/api/auth/google/redirect?return='.urlencode($return).($role ? '&role='.urlencode($role) : ''))->assertRedirect();
        parse_str((string) parse_url($response->headers->get('Location'), PHP_URL_QUERY), $query);
        $cookie = collect($response->headers->getCookies())->firstWhere(fn ($c) => $c->getName() === 'qbl_google');

        return [$query, $cookie];
    }

    /** Come back from Google as the given account. */
    private function finish(GoogleUser $account, array $started, ?string $state = null)
    {
        [$query, $cookie] = $started;
        $this->newRequest();
        Socialite::fake('google', $account);

        return $this->withUnencryptedCookie('qbl_google', $cookie->getValue())->get('/api/auth/google/callback?code=abc&state='.($state ?? $query['state']));
    }

    public function test_google_sign_in_is_off_until_it_is_configured(): void
    {
        $this->getJson('/api/auth/providers')->assertOk()->assertJsonPath('google', false);
        $this->get('/api/auth/google/redirect')->assertNotFound();

        $this->withGoogle();
        $this->getJson('/api/auth/providers')->assertOk()->assertJsonPath('google', true);
    }

    public function test_a_new_google_account_becomes_a_student_and_is_signed_in(): void
    {
        $this->withGoogle();
        $started = $this->begin('/starshipexplorer');
        $this->assertStringStartsWith('https://accounts.google.com/', $this->newRequest()->get('/api/auth/google/redirect')->headers->get('Location'));
        $this->assertSame(url('/api/auth/google/callback'), $started[0]['redirect_uri']);
        $this->assertTrue($started[1]->isHttpOnly());

        $page = $this->finish($this->googleAccount('g-100', 'Ada@School.example'), $started)->assertOk();
        $this->assertStringContainsString('no-store', $page->headers->get('Cache-Control'));
        $this->assertMatchesRegularExpression('#localStorage\.setItem\(\'qbl\.token\',"([^"]+)"\)\}catch\(e\)\{\}location\.replace\("/starshipexplorer"\)#', $page->getContent());
        preg_match('#setItem\(\'qbl\.token\',"([^"]+)"#', $page->getContent(), $m);

        $user = User::where('email', 'ada@school.example')->firstOrFail();
        $this->assertSame(['student', 'Ada Lovelace', 'g-100', null], [$user->role, $user->name, $user->google_id, $user->getRawOriginal('password')]);
        $this->assertNotNull($user->email_verified_at);
        $this->withToken($m[1])->getJson('/api/me')->assertOk()->assertJsonPath('user.name', 'Ada Lovelace')->assertJsonMissingPath('user.google_id');

        // Coming back later is the same account, even if the address at Google has changed.
        $this->finish($this->googleAccount('g-100', 'ada.new@school.example'), $this->begin())->assertOk();
        $this->assertSame(1, User::count());

        // Someone with only a Google sign-in has no password to guess.
        $this->postJson('/api/auth/login', ['email' => 'ada@school.example', 'password' => ''])->assertStatus(422);
        $this->postJson('/api/auth/login', ['email' => 'ada@school.example', 'password' => 'anything'])->assertStatus(422);
    }

    public function test_an_existing_account_is_joined_by_its_verified_address_and_keeps_its_role(): void
    {
        $this->withGoogle();
        $teacher = User::create(['name' => 'Ms Byron', 'email' => 'byron@school.example', 'password' => 'secret-password', 'role' => 'teacher']);

        $this->finish($this->googleAccount('g-200', 'byron@school.example', 'A. Byron'), $this->begin())->assertOk();

        $this->assertSame(['teacher', 'Ms Byron', 'g-200'], [$teacher->refresh()->role, $teacher->name, $teacher->google_id]);
        $this->assertSame(1, User::count());

        // An address Google has not verified joins nothing and creates nothing.
        $this->finish($this->googleAccount('g-201', 'someone@school.example', 'X', false), $this->begin('/editor/'))->assertRedirect('/editor/#signin=unverified');
        $this->assertSame(1, User::count());
    }

    public function test_domains_decide_who_may_sign_in_and_every_new_account_is_a_student(): void
    {
        $this->withGoogle(['qbl.google.domains' => ['school.example', 'staff.school.example']]);

        $this->finish($this->googleAccount('g-1', 'kid@elsewhere.example'), $this->begin('/missions'))->assertRedirect('/missions#signin=domain');
        $this->assertSame(0, User::count());

        $this->finish($this->googleAccount('g-2', 'kid@school.example'), $this->begin())->assertOk();
        $this->finish($this->googleAccount('g-3', 'head@staff.school.example'), $this->begin())->assertOk();
        // The domain says nothing about the role: staff are made teachers with qbl:update-role.
        $this->assertSame(['kid@school.example' => 'student', 'head@staff.school.example' => 'student'], User::pluck('role', 'email')->all());
    }

    /** A Google account that started as a student is made a teacher by hand, and can then use the editor. */
    public function test_update_role_makes_an_existing_account_a_teacher(): void
    {
        $user = User::create(['name' => 'Ms Frizzle', 'email' => 'frizzle@school.org', 'password' => 'secret-password', 'role' => 'student']);
        $token = $user->createToken('player')->plainTextToken;
        // The role alone decides: a student may not use the editor, Classes or reports.
        $this->withToken($token)->getJson('/api/editor/scenarios')->assertStatus(403);
        $this->newRequest()->withToken($token)->getJson('/api/teach/assignments')->assertStatus(403);

        $this->artisan('qbl:update-role', ['email' => 'frizzle@school.org'])->expectsOutputToContain('is a student')->assertSuccessful();
        $this->artisan('qbl:update-role', ['email' => 'frizzle@school.org', '--role' => 'principal'])->assertFailed();
        $this->artisan('qbl:update-role', ['email' => 'nobody@school.org', '--role' => 'teacher'])->assertFailed();
        $this->artisan('qbl:update-role', ['email' => 'frizzle@school.org', '--role' => 'Teacher'])->expectsOutputToContain('is now a teacher')->assertSuccessful();

        $this->assertSame('teacher', $user->fresh()->role);
        // The same token works at once: the role is read on every request.
        $this->newRequest()->withToken($token)->getJson('/api/me')->assertJsonPath('user.role', 'teacher');
        $this->newRequest()->withToken($token)->getJson('/api/editor/scenarios')->assertOk();
        $this->newRequest()->withToken($token)->getJson('/api/teach/assignments')->assertOk();

        // And back: made a student again, the same account is refused once more.
        $this->artisan('qbl:update-role', ['email' => 'frizzle@school.org', '--role' => 'student'])->assertSuccessful();
        $this->newRequest()->withToken($token)->getJson('/api/editor/scenarios')->assertStatus(403);
        $this->newRequest()->withToken($token)->getJson('/api/teach/assignments')->assertStatus(403);

        $guest = User::create(['name' => 'Guest', 'email' => 'guest-1@guest.invalid', 'password' => 'x', 'role' => 'guest']);
        $this->artisan('qbl:update-role', ['email' => $guest->email, '--role' => 'admin'])->assertFailed();
        $this->assertSame('guest', $guest->fresh()->role);
    }

    /** A role typed straight into the database with a capital or a space still counts: "Teacher " is a teacher. */
    public function test_a_role_written_by_hand_is_read_as_the_role_it_spells(): void
    {
        $user = User::create(['name' => 'Mr Keating', 'email' => 'keating@school.org', 'password' => 'secret-password', 'role' => 'student']);
        $token = $user->createToken('player')->plainTextToken;
        \Illuminate\Support\Facades\DB::table('users')->where('id', $user->id)->update(['role' => 'Teacher ']);

        // An account is told its own address too, so a page can say exactly who is signed in.
        $this->withToken($token)->getJson('/api/me')->assertJsonPath('user.role', 'teacher')->assertJsonPath('user.email', 'keating@school.org');
        $this->newRequest()->withToken($token)->getJson('/api/editor/scenarios')->assertOk();
        $this->newRequest()->withToken($token)->getJson('/api/teach/assignments')->assertOk();

        // And qbl:user stores a role the same way, or says it is not one.
        $this->artisan('qbl:user', ['email' => 'new@school.org', 'name' => 'New', '--role' => 'headmaster'])->assertFailed();
        $this->assertNull(User::where('email', 'new@school.org')->first());
        $this->artisan('qbl:user', ['email' => 'new@school.org', 'name' => 'New', '--role' => 'Teacher'])->expectsQuestion('Password', 'long-enough-password')->assertSuccessful();
        $this->assertSame('teacher', \Illuminate\Support\Facades\DB::table('users')->where('email', 'new@school.org')->value('role'));
    }

    public function test_anyone_may_create_a_students_account_with_a_password(): void
    {
        $this->getJson('/api/auth/providers')->assertOk()->assertJsonPath('register', true);

        $made = $this->postJson('/api/auth/register', [
            'name' => '  <b>Grace</b> Hopper ', 'email' => ' Grace@Example.ORG ', 'password' => 'cobol-1959', 'password_confirmation' => 'cobol-1959',
        ])->assertCreated()
            ->assertJsonPath('user.name', 'Grace Hopper')->assertJsonPath('user.role', 'student')->assertJsonPath('user.email', 'grace@example.org');

        $user = User::where('email', 'grace@example.org')->firstOrFail();
        $this->assertNotNull($user->self_registered_at);
        $this->assertNull($user->email_verified_at);
        $this->assertTrue($user->hasUnprovenAddress());
        $this->newRequest()->withToken($made->json('token'))->getJson('/api/me')->assertOk()->assertJsonPath('user.id', $user->id);
        // A student's account: no editor, no Classes.
        $this->newRequest()->withToken($made->json('token'))->getJson('/api/editor/scenarios')->assertStatus(403);

        // Signing in with it later, with the address in any case.
        $this->newRequest()->postJson('/api/auth/login', ['email' => 'grace@example.org', 'password' => 'cobol-1959'])->assertOk();
        $this->newRequest()->postJson('/api/auth/login', ['email' => 'GRACE@example.org', 'password' => 'cobol-1959'])->assertOk();
        $this->newRequest()->postJson('/api/auth/login', ['email' => 'grace@example.org', 'password' => 'wrong-password'])->assertStatus(422);
    }

    public function test_creating_an_account_never_takes_over_or_chooses_anything_it_should_not(): void
    {
        // More attempts than the five a minute one address is allowed.
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
        $ok = ['name' => 'Kid', 'password' => 'long-enough', 'password_confirmation' => 'long-enough'];
        User::create(['name' => 'Ms Byron', 'email' => 'byron@school.example', 'password' => null, 'role' => 'teacher']);

        // An address that already has an account (here one that only signs in with Google) is refused, in any case.
        $this->postJson('/api/auth/register', ['email' => 'BYRON@school.example'] + $ok)->assertStatus(422)->assertJsonValidationErrors(['email']);
        $this->assertNull(User::where('email', 'byron@school.example')->value('password'));
        // A role asked for is ignored.
        $this->postJson('/api/auth/register', ['email' => 'kid@school.example', 'role' => 'admin'] + $ok)->assertCreated()->assertJsonPath('user.role', 'student');
        // Guests' made-up addresses, short or mismatched passwords, and empty names are refused.
        $this->postJson('/api/auth/register', ['email' => 'guest-1@guest.invalid'] + $ok)->assertStatus(422)->assertJsonValidationErrors(['email']);
        $this->postJson('/api/auth/register', ['email' => 'a@school.example', 'password' => 'short', 'password_confirmation' => 'short'] + $ok)->assertStatus(422)->assertJsonValidationErrors(['password']);
        $this->postJson('/api/auth/register', ['email' => 'b@school.example', 'password_confirmation' => 'different!'] + $ok)->assertStatus(422)->assertJsonPath('message', 'The two passwords are not the same.');
        $this->postJson('/api/auth/register', ['email' => 'c@school.example', 'name' => '<i></i>'] + $ok)->assertStatus(422)->assertJsonValidationErrors(['name']);
        $this->assertSame(2, User::count());

        // A site can turn it off.
        config(['qbl.allow_registration' => false]);
        $this->getJson('/api/auth/providers')->assertJsonPath('register', false);
        $this->postJson('/api/auth/register', ['email' => 'd@school.example'] + $ok)->assertForbidden();
    }

    public function test_someone_creating_an_account_may_say_they_are_a_teacher(): void
    {
        $this->withoutMiddleware(\Illuminate\Routing\Middleware\ThrottleRequests::class);
        $ok = ['password' => 'long-enough', 'password_confirmation' => 'long-enough'];
        $this->getJson('/api/auth/providers')->assertOk()->assertJsonPath('teacher', true);

        $made = $this->postJson('/api/auth/register', ['name' => 'Ms Frizzle', 'email' => 'frizzle@school.example', 'role' => 'teacher'] + $ok)
            ->assertCreated()->assertJsonPath('user.role', 'teacher');
        // A teacher's account from the start: the editor and Classes work with the same token.
        $this->newRequest()->withToken($made->json('token'))->getJson('/api/editor/scenarios')->assertOk();
        $this->newRequest()->withToken($made->json('token'))->getJson('/api/teach/students')->assertOk();
        // Saying "student", or nothing (an older form), is a student's account.
        $this->newRequest()->postJson('/api/auth/register', ['name' => 'Arnold', 'email' => 'arnold@school.example', 'role' => 'student'] + $ok)->assertCreated()->assertJsonPath('user.role', 'student');
        $this->newRequest()->postJson('/api/auth/register', ['name' => 'Wanda', 'email' => 'wanda@school.example'] + $ok)->assertCreated()->assertJsonPath('user.role', 'student');

        // A site that makes its teachers itself turns the choice off: asking for it is refused, not quietly ignored.
        config(['qbl.allow_teacher_registration' => false]);
        $this->newRequest()->getJson('/api/auth/providers')->assertJsonPath('teacher', false);
        $this->newRequest()->postJson('/api/auth/register', ['name' => 'Mr Ratliff', 'email' => 'ratliff@school.example', 'role' => 'teacher'] + $ok)
            ->assertStatus(422)->assertJsonValidationErrors(['role']);
        $this->assertFalse(User::where('email', 'ratliff@school.example')->exists());
        $this->newRequest()->postJson('/api/auth/register', ['name' => 'Ralphie', 'email' => 'ralphie@school.example', 'role' => 'student'] + $ok)->assertCreated()->assertJsonPath('user.role', 'student');
    }

    public function test_signing_up_with_google_as_a_teacher_makes_a_teachers_account_and_nothing_else(): void
    {
        $this->withGoogle();
        // A new account: a teacher's.
        $this->finish($this->googleAccount('g-300', 'liz@school.example'), $this->begin('/missions', 'teacher'))->assertOk()->assertSee('location.replace("/missions")', false);
        $this->assertSame('teacher', User::where('google_id', 'g-300')->value('role'));

        // An account that already exists keeps its role, whatever the sign-up form said.
        User::create(['name' => 'Keesha', 'email' => 'keesha@school.example', 'password' => 'secret-password', 'role' => 'student']);
        $this->finish($this->googleAccount('g-301', 'keesha@school.example'), $this->begin('/missions', 'teacher'))->assertOk();
        $this->assertSame('student', User::where('email', 'keesha@school.example')->value('role'));

        // Only "teacher" means anything; and a site that turned the choice off makes a student.
        $this->finish($this->googleAccount('g-302', 'tim@school.example'), $this->begin('/missions', 'admin'))->assertOk();
        $this->assertSame('student', User::where('google_id', 'g-302')->value('role'));
        config(['qbl.allow_teacher_registration' => false]);
        $this->finish($this->googleAccount('g-303', 'phoebe@school.example'), $this->begin('/missions', 'teacher'))->assertOk();
        $this->assertSame('student', User::where('google_id', 'g-303')->value('role'));
    }

    /**
     * Nobody checks the address typed when an account is created, so someone could create one in
     * another person's name. Google signing in with that address shows whose it is: the account
     * becomes theirs, and the password and tokens of whoever created it stop working.
     */
    public function test_google_proves_whose_a_created_account_is(): void
    {
        $this->withGoogle();
        $made = $this->postJson('/api/auth/register', ['name' => 'Not Byron', 'email' => 'byron@school.example', 'password' => 'squatting', 'password_confirmation' => 'squatting'])->assertCreated();
        $squatter = $made->json('token');
        $this->artisan('qbl:update-role', ['email' => 'byron@school.example', '--role' => 'teacher'])->expectsOutputToContain('nobody has checked')->assertSuccessful();

        $this->finish($this->googleAccount('g-300', 'byron@school.example', 'A. Byron'), $this->begin())->assertOk();

        $user = User::where('email', 'byron@school.example')->firstOrFail();
        $this->assertSame(['g-300', null], [$user->google_id, $user->getRawOriginal('password')]);
        $this->assertNotNull($user->email_verified_at);
        $this->assertFalse($user->hasUnprovenAddress());
        $this->newRequest()->withToken($squatter)->getJson('/api/me')->assertUnauthorized();
        $this->newRequest()->postJson('/api/auth/login', ['email' => 'byron@school.example', 'password' => 'squatting'])->assertStatus(422);
        $this->assertSame(1, User::count());

        // An account an administrator made is joined as before, and keeps its password.
        $admin = User::create(['name' => 'Ms Lovelace', 'email' => 'ada@school.example', 'password' => 'secret-password', 'role' => 'teacher']);
        $this->finish($this->googleAccount('g-301', 'ada@school.example'), $this->begin())->assertOk();
        $this->assertSame('g-301', $admin->refresh()->google_id);
        $this->newRequest()->postJson('/api/auth/login', ['email' => 'ada@school.example', 'password' => 'secret-password'])->assertOk();
        $this->artisan('qbl:update-role', ['email' => 'ada@school.example', '--role' => 'admin'])->doesntExpectOutputToContain('nobody has checked')->assertSuccessful();
    }

    public function test_an_answer_that_does_not_match_a_sign_in_this_browser_started_is_refused(): void
    {
        $this->withGoogle();

        $this->finish($this->googleAccount('g-1', 'a@b.example'), $this->begin('/editor/'), 'not-the-state')->assertRedirect('/editor/#signin=expired');
        // Nor one that arrives with no sign-in under way at all.
        $this->newRequest();
        Socialite::fake('google', $this->googleAccount('g-1', 'a@b.example'));
        $this->get('/api/auth/google/callback?code=abc&state=anything')->assertRedirect('/missions#signin=expired');
        $this->assertSame(0, User::count());

        // The way back is always a page of this site.
        foreach (['//evil.example/x', 'https://evil.example', '/\\evil.example', 'javascript:alert(1)'] as $return) {
            $this->finish($this->googleAccount('g-9', 'z@b.example'), $this->begin($return))->assertOk()->assertSee('location.replace("/missions")', false);
        }
    }

    public function test_behind_the_firewall_the_site_knows_it_is_https(): void
    {
        // QBL_PUBLIC_URL (APP_URL) is the address people type; Google is told to come back to it.
        $this->withGoogle(['app.url' => 'https://qbl.school.example']);
        $forwarded = ['X-Forwarded-Proto' => 'https', 'X-Forwarded-Host' => 'qbl.school.example', 'X-Forwarded-For' => '203.0.113.9'];
        $secure = fn ($response) => collect($response->headers->getCookies())->firstWhere(fn ($c) => $c->getName() === 'qbl_google')->isSecure();

        // From the firewall (a trusted address) the request counts as https, so the cookie is secure-only.
        // (The address is spelled out because it is what reaches Apache: plain http.)
        $response = $this->newRequest()->withHeaders($forwarded)->get('http://apache/api/auth/google/redirect');
        parse_str((string) parse_url($response->headers->get('Location'), PHP_URL_QUERY), $query);
        $this->assertSame('https://qbl.school.example/api/auth/google/callback', $query['redirect_uri']);
        $this->assertTrue($secure($response));

        // With an http public address (a local try-out), the headers are believed only from a trusted
        // address: from anywhere else the request is what it is, plain http.
        config(['app.url' => 'http://localhost:8080']);
        $response = $this->newRequest()->withServerVariables(['REMOTE_ADDR' => '203.0.113.50'])->withHeaders($forwarded)->get('http://apache/api/auth/google/redirect');
        $this->assertFalse($secure($response));
    }

    public function test_an_https_public_address_is_used_whatever_the_firewall_sends(): void
    {
        // QBL_PUBLIC_URL=https://dev.questlab.cc (a trailing slash is fine). The firewall sends no
        // X-Forwarded-* headers at all and passes its own idea of the host: still https, still that name.
        $this->withGoogle(['app.url' => 'https://dev.questlab.cc/']);
        $cookie = fn ($response) => collect($response->headers->getCookies())->firstWhere(fn ($c) => $c->getName() === 'qbl_google');
        $redirectUri = function ($response) {
            parse_str((string) parse_url($response->headers->get('Location'), PHP_URL_QUERY), $query);

            return $query['redirect_uri'];
        };

        $response = $this->newRequest()->get('http://10.0.0.5:8080/api/auth/google/redirect?return=/missions');
        $this->assertSame('https://dev.questlab.cc/api/auth/google/callback', $redirectUri($response));
        $this->assertTrue($cookie($response)->isSecure());

        // A failed sign-in goes back to the public address too.
        $this->newRequest();
        $this->get('http://10.0.0.5:8080/api/auth/google/callback?state=anything')->assertRedirect('https://dev.questlab.cc/missions#signin=expired');

        // A trusted firewall that says this visitor came by plain http: the cookie is not https-only
        // (the browser would drop it), but every address still names the https site.
        $response = $this->newRequest()->withHeaders(['X-Forwarded-Proto' => 'http'])->get('http://10.0.0.5:8080/api/auth/google/redirect');
        $this->assertSame('https://dev.questlab.cc/api/auth/google/callback', $redirectUri($response));
        $this->assertFalse($cookie($response)->isSecure());
    }

    public function test_nothing_is_seeded_until_the_command_is_run(): void
    {
        $this->getJson('/api/scenarios/starshipexplorer/play')->assertNotFound();
        $this->assertSame(0, DB::table('shop_items')->count());

        $this->artisan('qbl:seed', ['--password' => 'demo-password'])->assertSuccessful();

        $this->getJson('/api/scenarios/starshipexplorer/play')->assertOk();
        $this->assertSame(17, DB::table('shop_items')->count(), 'fifteen platform items and the mission\'s two');
        $this->postJson('/api/auth/login', ['email' => 'teacher@qbl.test', 'password' => 'demo-password'])->assertOk();

        // Run again, edits to the demo are kept; with --reset the shipped version is put back.
        DB::table('scenarios')->where('id', 1)->update(['title' => 'Edited']);
        $this->artisan('qbl:seed')->assertSuccessful();
        $this->assertSame('Edited', DB::table('scenarios')->where('id', 1)->value('title'));
        $this->artisan('qbl:seed', ['--reset' => true])->assertSuccessful();
        $this->assertSame('Starship Explorer', DB::table('scenarios')->where('id', 1)->value('title'));
    }

    public function test_a_database_made_by_the_old_all_in_one_migrations_is_left_as_it_is(): void
    {
        // Make the migrations table look as it did then: two entries for the two big files, none for the new ones.
        $split = DB::table('migrations')->where(fn ($q) => $q->where('migration', 'like', '2026_11_15_0000%')->orWhere('migration', 'like', '2026_11_16_00000%'))
            ->whereNotIn('migration', ['2026_11_15_000001_create_personal_access_tokens_table', '2026_11_16_000000_add_code_to_scenarios', '2026_11_16_000001_add_reveal_radius_to_events']);
        $this->assertSame(19, $split->count());
        $split->delete();
        DB::table('migrations')->insert([['migration' => '2026_11_15_000000_create_qbl_tables', 'batch' => 1], ['migration' => '2026_11_16_000002_add_progress_and_shop', 'batch' => 1]]);
        // That database had no audience column and no Google id yet.
        Schema::table('events', fn ($table) => $table->dropColumn('audience'));
        Schema::table('users', function ($table) {
            $table->dropUnique(['google_id']);
            $table->dropColumn('google_id');
        });
        DB::table('scenarios')->insert(['shortname' => 'kept', 'title' => 'Kept', 'code' => 'abcdefghijklmnop', 'created_at' => now(), 'updated_at' => now()]);

        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]), Artisan::output());

        $this->assertSame('Kept', DB::table('scenarios')->where('shortname', 'kept')->value('title'), 'existing rows are untouched');
        $this->assertTrue(Schema::hasColumn('events', 'audience') && Schema::hasColumn('users', 'google_id'));
        $this->assertSame(0, DB::table('migrations')->whereIn('migration', ['2026_11_15_000000_create_qbl_tables', '2026_11_16_000002_add_progress_and_shop'])->count(), 'the old files\' entries are gone');
        $this->assertSame(0, Artisan::call('migrate', ['--force' => true]), 'and there is nothing left to run');
    }
}
