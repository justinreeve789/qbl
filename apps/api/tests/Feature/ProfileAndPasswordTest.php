<?php

namespace Tests\Feature;

use App\Models\User;
use App\Notifications\ResetPasswordLink;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * The profile page (the name over the character, changing the password) and "Forgot your
 * password?" (a link by email, then a new password with it).
 */
class ProfileAndPasswordTest extends TestCase
{
    use RefreshDatabase;

    /** Each request as a new one, as in production: no guard keeps the last request's user. */
    private function fresh(): static
    {
        $this->app['auth']->forgetGuards();

        return $this;
    }

    private function student(array $more = []): User
    {
        return User::create(['name' => 'Ada', 'email' => 'ada@school.example', 'password' => 'old-password', 'role' => 'student'] + $more);
    }

    /** The token from the link in the email last sent to $user. */
    private function linkToken(User $user): array
    {
        $sent = null;
        Notification::assertSentTo($user, ResetPasswordLink::class, function (ResetPasswordLink $n) use (&$sent) {
            $sent = $n;

            return true;
        });
        $fragment = (string) parse_url($sent->url, PHP_URL_FRAGMENT);
        parse_str($fragment, $params);

        return [$params['reset-password'] ?? null, $params['email'] ?? null, $sent];
    }

    public function test_an_account_is_told_what_its_profile_can_change(): void
    {
        $token = $this->student()->createToken('player')->plainTextToken;
        $this->withToken($token)->getJson('/api/me')->assertOk()
            ->assertJsonPath('user.has_password', true)
            ->assertJsonPath('user.uses_google', false)
            ->assertJsonPath('user.name_locked', false);

        // Google only: no password here.
        $google = User::create(['name' => 'Grace', 'email' => 'grace@school.example', 'role' => 'student']);
        $google->forceFill(['google_id' => 'g-1'])->save();
        $this->fresh()->withToken($google->createToken('player')->plainTextToken)->getJson('/api/me')
            ->assertJsonPath('user.has_password', false)->assertJsonPath('user.uses_google', true);

        // Guests get none of it, as before.
        $guest = $this->fresh()->postJson('/api/auth/guest', ['name' => 'Zed']);
        if ($guest->status() === 200) {
            $guest->assertJsonMissingPath('user.has_password');
        }
    }

    public function test_changing_the_name_over_the_character(): void
    {
        $user = $this->student();
        $token = $user->createToken('player')->plainTextToken;

        $this->withToken($token)->patchJson('/api/me', ['name' => "  Captain   <b>Ada</b>  "])->assertOk()->assertJsonPath('user.name', 'Captain Ada');
        $this->assertSame('Captain Ada', $user->fresh()->name);

        $this->fresh()->withToken($token)->patchJson('/api/me', ['name' => '   '])->assertStatus(422)->assertJsonValidationErrors(['name']);
        $this->fresh()->withToken($token)->patchJson('/api/me', ['name' => str_repeat('x', 61)])->assertStatus(422)->assertJsonPath('message', 'Use a name of at most 60 characters.');
        // Other players see it: no contact details.
        $this->fresh()->withToken($token)->patchJson('/api/me', ['name' => 'ada@home.example'])->assertStatus(422);
        $this->fresh()->withToken($token)->patchJson('/api/me', ['name' => 'Call 555 123 4567'])->assertStatus(422);
        $this->assertSame('Captain Ada', $user->fresh()->name);

        // Signed out: nothing.
        $this->fresh()->withoutToken()->patchJson('/api/me', ['name' => 'Nobody'])->assertStatus(401);
    }

    public function test_a_rostered_student_keeps_their_schools_pseudonym_and_a_guest_cannot_rename(): void
    {
        $orgId = DB::table('organizations')->insertGetId(['name' => 'District', 'kind' => 'district', 'created_at' => now(), 'updated_at' => now()]);
        $rostered = User::create(['name' => 'Brave Otter 417', 'email' => 'u-1@roster.qbl.invalid', 'role' => 'student']);
        $rostered->forceFill(['organization_id' => $orgId])->save();
        $token = $rostered->createToken('player')->plainTextToken;
        $this->withToken($token)->getJson('/api/me')->assertJsonPath('user.name_locked', true)->assertJsonPath('user.has_password', false)->assertJsonMissingPath('user.email');
        $this->fresh()->withToken($token)->patchJson('/api/me', ['name' => 'Real Name'])->assertStatus(403);
        $this->assertSame('Brave Otter 417', $rostered->fresh()->name);

        // A rostered teacher chooses their own display name.
        $teacher = User::create(['name' => 'Teacher 1', 'email' => 'u-2@roster.qbl.invalid', 'role' => 'teacher']);
        $teacher->forceFill(['organization_id' => $orgId])->save();
        $this->fresh()->withToken($teacher->createToken('player')->plainTextToken)->patchJson('/api/me', ['name' => 'Mr Keating'])->assertOk();

        $guest = User::create(['name' => 'Zed', 'email' => 'guest-1@guest.invalid', 'password' => 'x', 'role' => 'guest']);
        $this->fresh()->withToken($guest->createToken('guest')->plainTextToken)->patchJson('/api/me', ['name' => 'Zed 2'])->assertStatus(403);
    }

    public function test_changing_the_password_ends_the_other_sign_ins_and_keeps_this_one(): void
    {
        $user = $this->student();
        $here = $user->createToken('player')->plainTextToken;
        $phone = $user->createToken('player')->plainTextToken;

        $this->withToken($here)->putJson('/api/me/password', ['current_password' => 'wrong', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
            ->assertStatus(422)->assertJsonPath('message', 'That is not your current password.');
        $this->fresh()->withToken($here)->putJson('/api/me/password', ['current_password' => 'old-password', 'password' => 'short', 'password_confirmation' => 'short'])
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
        $this->fresh()->withToken($here)->putJson('/api/me/password', ['current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'other-password'])
            ->assertStatus(422)->assertJsonValidationErrors(['password']);
        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));

        $this->fresh()->withToken($here)->putJson('/api/me/password', ['current_password' => 'old-password', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
            ->assertOk()->assertJsonPath('signed_out_elsewhere', 1);
        $this->assertTrue(Hash::check('new-password', $user->fresh()->password));
        $this->fresh()->withToken($here)->getJson('/api/me')->assertOk();
        $this->fresh()->withToken($phone)->getJson('/api/me')->assertStatus(401);

        $this->fresh()->postJson('/api/auth/login', ['email' => 'ada@school.example', 'password' => 'old-password'])->assertStatus(422);
        $this->fresh()->postJson('/api/auth/login', ['email' => 'ada@school.example', 'password' => 'new-password'])->assertOk();
    }

    public function test_an_account_that_signs_in_with_google_has_no_password_to_change(): void
    {
        $user = User::create(['name' => 'Grace', 'email' => 'grace@school.example', 'role' => 'student']);
        $user->forceFill(['google_id' => 'g-1'])->save();
        $this->withToken($user->createToken('player')->plainTextToken)
            ->putJson('/api/me/password', ['current_password' => 'x', 'password' => 'new-password', 'password_confirmation' => 'new-password'])
            ->assertStatus(409)->assertJsonPath('message', 'You sign in with Google, so there is no password to change here.');
        $this->assertNull($user->fresh()->password);
    }

    public function test_forgot_password_emails_a_link_that_sets_a_new_password_and_signs_in(): void
    {
        Notification::fake();
        config(['app.url' => 'https://dev.questlab.cc']);
        $user = $this->student(['email' => 'ada@school.example']);
        $user->forceFill(['self_registered_at' => now()])->save();
        $old = $user->createToken('player')->plainTextToken;

        // Typed with capitals: still found.
        $answer = $this->postJson('/api/auth/forgot-password', ['email' => 'Ada@School.example'])->assertStatus(202)->json('message');
        [$token, $email, $sent] = $this->linkToken($user);
        $this->assertStringStartsWith('https://dev.questlab.cc/missions#reset-password=', $sent->url);
        $this->assertSame('ada@school.example', $email);
        $this->assertNotEmpty($token);
        $mail = $sent->toMail($user);
        $this->assertSame('Choose a new password for QuestLab', $mail->subject);
        $this->assertSame($sent->url, $mail->actionUrl);

        // No such account, or none with a password: the same answer, and no email.
        $google = User::create(['name' => 'Grace', 'email' => 'grace@school.example', 'role' => 'student']);
        $google->forceFill(['google_id' => 'g-1'])->save();
        $this->fresh()->postJson('/api/auth/forgot-password', ['email' => 'nobody@school.example'])->assertStatus(202)->assertJsonPath('message', $answer);
        $this->fresh()->postJson('/api/auth/forgot-password', ['email' => 'grace@school.example'])->assertStatus(202)->assertJsonPath('message', $answer);
        Notification::assertNotSentTo($google, ResetPasswordLink::class);
        $this->fresh()->postJson('/api/auth/forgot-password', ['email' => 'not an address'])->assertStatus(422);

        // A wrong token, a wrong address, a mismatch: refused, the password unchanged.
        $this->fresh()->postJson('/api/auth/reset-password', ['token' => 'nope', 'email' => $email, 'password' => 'brand-new-pw', 'password_confirmation' => 'brand-new-pw'])
            ->assertStatus(422)->assertJsonPath('message', 'This link has expired or was already used. Ask for a new one.');
        $this->fresh()->postJson('/api/auth/reset-password', ['token' => $token, 'email' => 'grace@school.example', 'password' => 'brand-new-pw', 'password_confirmation' => 'brand-new-pw'])->assertStatus(422);
        $this->fresh()->postJson('/api/auth/reset-password', ['token' => $token, 'email' => $email, 'password' => 'brand-new-pw', 'password_confirmation' => 'different'])->assertStatus(422);
        $this->assertTrue(Hash::check('old-password', $user->fresh()->password));

        $done = $this->fresh()->postJson('/api/auth/reset-password', ['token' => $token, 'email' => $email, 'password' => 'brand-new-pw', 'password_confirmation' => 'brand-new-pw'])
            ->assertOk()->assertJsonPath('user.id', $user->id)->assertJsonPath('user.email', 'ada@school.example');
        $user->refresh();
        $this->assertTrue(Hash::check('brand-new-pw', $user->password));
        // The link proved the address, as Google sign-in would.
        $this->assertNotNull($user->email_verified_at);
        $this->assertFalse($user->hasUnprovenAddress());
        // Signed in with the new token; every earlier sign-in ended.
        $this->fresh()->withToken($done->json('token'))->getJson('/api/me')->assertOk();
        $this->fresh()->withToken($old)->getJson('/api/me')->assertStatus(401);

        // A link works once.
        $this->fresh()->postJson('/api/auth/reset-password', ['token' => $token, 'email' => $email, 'password' => 'again-new-pw', 'password_confirmation' => 'again-new-pw'])->assertStatus(422);
        $this->fresh()->postJson('/api/auth/login', ['email' => 'ada@school.example', 'password' => 'brand-new-pw'])->assertOk();
    }

    public function test_asking_again_at_once_sends_no_second_email(): void
    {
        Notification::fake();
        $user = $this->student();
        $this->postJson('/api/auth/forgot-password', ['email' => 'ada@school.example'])->assertStatus(202);
        $this->fresh()->postJson('/api/auth/forgot-password', ['email' => 'ada@school.example'])->assertStatus(202);
        Notification::assertSentToTimes($user, ResetPasswordLink::class, 1);
    }

    public function test_an_administrator_can_print_a_link_when_there_is_no_mail(): void
    {
        config(['app.url' => 'http://localhost:8080']);
        $user = $this->student();
        $this->assertSame(0, Artisan::call('qbl:reset-link', ['email' => 'ada@school.example']));
        $printed = Artisan::output();
        $this->assertMatchesRegularExpression('~http://localhost:8080/missions#reset-password=([^&\s]+)&email=ada%40school.example~', $printed);
        preg_match('~reset-password=([^&\s]+)~', $printed, $m);
        $this->postJson('/api/auth/reset-password', ['token' => urldecode($m[1]), 'email' => 'ada@school.example', 'password' => 'from-admin-1', 'password_confirmation' => 'from-admin-1'])->assertOk();
        $this->assertTrue(Hash::check('from-admin-1', $user->fresh()->password));

        $this->assertSame(1, Artisan::call('qbl:reset-link', ['email' => 'nobody@school.example']));
        $google = User::create(['name' => 'Grace', 'email' => 'grace@school.example', 'role' => 'student']);
        $google->forceFill(['google_id' => 'g-1'])->save();
        $this->assertSame(1, Artisan::call('qbl:reset-link', ['email' => 'grace@school.example']));
    }
}
