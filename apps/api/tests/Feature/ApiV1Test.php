<?php

namespace Tests\Feature;

use App\Qbl\Api\Clients;
use App\Qbl\Api\V1\Api;
use Database\Seeders\ShippedScenarioSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The public API (/api/v1) as Laravel serves it, on the real migrations. The rules are tested
 * without the framework in tests/api_v1.php; this checks the wiring: tokens, headers, uploads,
 * CSV, the launch page, and that a launch link's token signs in to the rest of QBL.
 */
class ApiV1Test extends TestCase
{
    use RefreshDatabase;

    private function client(array $scopes = ['*']): array
    {
        $clients = new Clients(DB::connection()->getPdo());
        $org = $clients->createOrganization('Riverside District', 'district');

        return $clients->createClient($org['id'], 'Test', $scopes);
    }

    public function test_a_school_rosters_assigns_launches_and_reads_grades(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        $made = $this->client();

        // Client credentials, by HTTP Basic, as OAuth 2 libraries send them.
        $token = $this->withHeaders(['Authorization' => 'Basic '.base64_encode($made['client_id'].':'.$made['client_secret'])])
            ->post('/api/v1/oauth/token', ['grant_type' => 'client_credentials'])
            ->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('access_token');
        $this->flushHeaders();
        $api = fn () => $this->withToken($token);

        $api()->getJson('/api/v1')->assertOk()->assertHeader('QBL-API-Version', '1')->assertJsonPath('data.version', 'v1');
        $this->withToken('qbla_wrong')->getJson('/api/v1/students')->assertUnauthorized()->assertJsonPath('error.code', 'invalid_token');
        $api()->getJson('/api/v1/nothing-here')->assertNotFound()->assertJsonPath('error.code', 'not_found');

        $api()->postJson('/api/v1/students', ['external_id' => 's1', 'first_name' => 'Ann'])->assertStatus(422)->assertJsonPath('error.code', 'pii_not_accepted');
        $student = $api()->postJson('/api/v1/students', ['external_id' => 's1', 'grade_level' => '5'])->assertCreated()->json('data');
        $this->assertStringEndsWith('.invalid', DB::table('users')->where('id', $student['id'])->value('email'));
        $teacher = $api()->postJson('/api/v1/teachers', ['external_id' => 't1', 'display_name' => 'Mr. B'])->assertCreated()->json('data');

        $scenario = $api()->getJson('/api/v1/scenarios')->assertOk()->json('data.0');
        $assignment = $api()->postJson('/api/v1/assignments', ['teacher_id' => 'ext:t1', 'scenario_id' => $scenario['id'], 'student_external_ids' => ['s1'], 'external_id' => 'lms-1'])
            ->assertCreated()->assertJsonPath('data.student_ids', [$student['id']])->json('data');

        // The student's launch link: the page, then the POST it makes, then a token that works across QBL.
        $url = $api()->postJson("/api/v1/students/{$student['id']}/launch", ['assignment_id' => $assignment['id']])->assertCreated()->json('data.url');
        $path = parse_url($url, PHP_URL_PATH);
        $this->flushHeaders();
        $this->get($path)->assertOk()->assertHeader('Content-Type', 'text/html; charset=utf-8')->assertSee("localStorage.setItem('qbl.token'", false);
        $signIn = $this->postJson($path)->assertOk()->assertJsonPath('data.return_path', "/{$scenario['code']}?group=a{$assignment['id']}")->json('data.token');
        $this->postJson($path)->assertStatus(410);
        $this->withToken($signIn)->getJson('/api/me')->assertOk()->assertJsonPath('user.id', $student['id'])->assertJsonPath('user.role', 'student');
        $this->app['auth']->forgetGuards();
        $this->withToken($signIn)->getJson('/api/missions')->assertOk()->assertJsonPath('missions.0.assignment_id', $assignment['id']);
        $this->app['auth']->forgetGuards();
        $this->withToken($signIn)->getJson('/api/v1/students')->assertUnauthorized(); // a player's token is not an API token

        // The game server reports what the student did; the school reads it back.
        config(['qbl.service_key' => 'k']);
        $this->postJson("/api/internal/scenarios/{$scenario['id']}/activity", ['entries' => [
            ['user_id' => (string) $student['id'], 'group' => 'a'.$assignment['id'], 'type' => 'join', 'ref' => '1'],
        ]], ['X-QBL-Service-Key' => 'k'])->assertOk();
        $this->flushHeaders();
        $api()->getJson("/api/v1/assignments/{$assignment['id']}/grades")->assertOk()->assertJsonPath('data.0.external_id', 's1')->assertJsonPath('data.0.status', 'in_progress');
        $csv = $api()->get("/api/v1/assignments/{$assignment['id']}/grades?format=csv")->assertOk()->assertHeader('Content-Type', 'text/csv; charset=utf-8');
        $this->assertStringStartsWith('student_id,external_id,display_name', $csv->getContent());
        $api()->getJson('/api/v1/reports/engagement')->assertOk()->assertJsonPath('data.totals.active_students', 1);
        $api()->getJson('/api/v1/activity')->assertOk()->assertJsonPath('data.0.assignment_id', $assignment['id']);
        $this->assertSame($teacher['id'], $api()->getJson('/api/v1/assignments?external_id=lms-1')->json('data.0.teacher_id'));
        $api()->getJson('/api/v1/reports/learning')->assertOk()->assertJsonPath('data.scenarios.0.students', 1);
        $api()->getJson('/api/v1/reports/summary?group_by=school')->assertOk()->assertJsonPath('data.students', 1);
        $api()->getJson('/api/v1/reports/engagement?group_by=teacher&interval=week&timezone=America/Denver')->assertOk()->assertJsonPath('data.groups.0.teacher_id', $teacher['id']);
        $api()->getJson('/api/v1/students/ext:s1/report')->assertOk()->assertJsonPath('data.totals.assignments', 1);
        $api()->postJson('/api/v1/students/batch', ['students' => [['external_id' => 's1', 'grade_level' => '6'], ['external_id' => 's2']]])->assertOk()->assertJsonPath('meta', ['created' => 1, 'updated' => 1, 'errors' => 0]);
        $api()->getJson('/api/v1/students/ext:s1/export')->assertOk()->assertJsonCount(1, 'data.activity');
        $this->assertGreaterThan(5, DB::table('api_audit_log')->count());
        $api()->deleteJson('/api/v1/students/ext:s1')->assertOk()->assertJsonPath('data.deleted.users', 1);
        $this->assertSame(0, DB::table('activity_log')->where('user_id', $student['id'])->count());
        $api()->getJson('/api/v1/audit-log?student_id='.$student['id'])->assertOk()->assertJsonPath('data.0.method', 'DELETE');
    }

    public function test_an_avatar_is_uploaded_as_a_file(): void
    {
        config(['qbl.media_dir' => storage_path('framework/testing/media')]);
        $this->app->forgetInstance(Api::class);
        $made = $this->client(['avatars:read', 'avatars:write']);
        $token = $this->postJson('/api/v1/oauth/token', ['client_id' => $made['client_id'], 'client_secret' => $made['client_secret']])->json('access_token');

        $avatar = $this->withToken($token)->post('/api/v1/avatars', [
            'name' => 'Mascot', 'image' => UploadedFile::fake()->image('mascot.png', 120, 60), 'sheet' => '{"columns": 2, "rows": 1}', 'scale' => '1.2',
        ], ['Accept' => 'application/json'])->assertCreated()->json('data');
        $this->assertSame([120, ['columns' => 2, 'rows' => 1], 'organization'], [$avatar['width'], $avatar['sheet'], $avatar['owner']]);
        $this->assertFileExists(storage_path('framework/testing/media').substr($avatar['image_url'], strlen('/media')));
        $this->withToken($token)->getJson('/api/v1/students')->assertForbidden()->assertJsonPath('error.code', 'insufficient_scope');
    }
}
