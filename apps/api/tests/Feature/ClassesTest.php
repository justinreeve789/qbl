<?php

namespace Tests\Feature;

use App\Models\Scenario;
use App\Models\User;
use Database\Seeders\AvatarSeeder;
use Database\Seeders\ShippedScenarioSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Classes, missions, teams and the platform avatars as Laravel serves them. The rules are
 * tested without the framework in tests/classes.php; this checks the wiring, on the real migrations.
 */
class ClassesTest extends TestCase
{
    use RefreshDatabase;

    private function user(string $name, string $role): User
    {
        return User::create(['name' => $name, 'email' => strtolower($name).'@example.test', 'password' => 'secret-password', 'role' => $role]);
    }

    private function as(User $user): static
    {
        // Each request is made as one person; forget whoever made the last one.
        $this->app['auth']->forgetGuards();

        return $this->withToken($user->createToken('test')->plainTextToken);
    }

    public function test_a_teacher_assigns_a_mission_to_teams_and_each_team_has_its_own_game(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        config(['qbl.service_key' => 'k']);
        $internal = ['X-QBL-Service-Key' => 'k'];
        $teacher = $this->user('Teacher', 'teacher');
        $ann = $this->user('Ann', 'student');
        $ben = $this->user('Ben', 'student');

        $this->as($ann)->getJson('/api/teach/students')->assertForbidden();
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ann@example.test'])->assertCreated();
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ben@example.test'])->assertCreated();
        $scenarioId = $this->as($teacher)->getJson('/api/teach/scenarios')->assertOk()->json('scenarios.0.id');

        $assignment = $this->as($teacher)->postJson('/api/teach/assignments', [
            'scenario_id' => $scenarioId, 'student_ids' => [$ann->id, $ben->id], 'due_at' => '2026-12-01T15:00:00Z',
            'teams' => [['name' => 'Comets', 'student_ids' => [$ann->id]], ['name' => 'Quasars', 'student_ids' => [$ben->id]]],
        ])->assertCreated()->json('assignment');
        [$comets, $quasars] = [$assignment['teams'][0]['group'], $assignment['teams'][1]['group']];

        $missions = $this->as($ann)->getJson('/api/missions')->assertOk()->json('missions');
        $this->assertSame([['assigned', $comets, 'Comets', 'Teacher', '2026-12-01 15:00:00'], ['public', 'public', null, null, null]], array_map(
            fn ($m) => [$m['kind'], $m['group'], $m['team'] ?? null, $m['teacher'] ?? null, $m['due_at'] ?? null], $missions,
        ));
        $this->assertStringStartsWith('/scenario-assets/starship/', $missions[0]['image']);

        // The game server saves each player's game per instance, and asks who may join.
        $base = "/api/internal/scenarios/$scenarioId";
        $this->withHeaders($internal)->putJson("$base/sessions/{$ann->id}?group=$comets", ['session' => ['scene_id' => 3]])->assertNoContent();
        $this->withHeaders($internal)->putJson("$base/sessions/{$ann->id}", ['session' => ['scene_id' => 7]])->assertNoContent();
        $this->withHeaders($internal)->getJson("$base/sessions/{$ann->id}?group=$comets")->assertJsonPath('session.scene_id', 3);
        $this->withHeaders($internal)->getJson("$base/sessions/{$ann->id}?group=public")->assertJsonPath('session.scene_id', 7);
        $this->withHeaders($internal)->getJson("$base/sessions/{$ann->id}?group=$quasars")->assertJsonPath('session', null);
        $this->withHeaders($internal)->getJson("$base/access/{$ann->id}?group=$comets")->assertJsonPath('allowed', true);
        $this->withHeaders($internal)->getJson("$base/access/{$ann->id}?group=$quasars")->assertJsonPath('allowed', false);
        $this->withHeaders($internal)->getJson("$base/access/{$teacher->id}?group=$quasars")->assertJsonPath('allowed', true);

        // The player's browser gets the save of the instance it is joining, and is refused another team's.
        $this->as($ann)->getJson("/api/scenarios/starshipexplorer/play?group=$comets")->assertOk()->assertJsonPath('scenario.session.scene_id', 3);
        $this->as($ann)->getJson('/api/scenarios/starshipexplorer/play')->assertOk()->assertJsonPath('scenario.session.scene_id', 7);
        $this->as($ann)->getJson("/api/scenarios/starshipexplorer/play?group=$quasars")->assertForbidden();
        $this->assertNotNull($this->as($ann)->getJson('/api/missions')->json('missions.0.started_at'));

        $this->as($teacher)->deleteJson("/api/teach/assignments/{$assignment['id']}")->assertNoContent();
        $this->assertCount(1, $this->as($ann)->getJson('/api/missions')->json('missions'));
    }

    public function test_a_private_mission_is_only_for_those_it_was_assigned_to(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        $scenario = Scenario::first();
        $scenario->update(['settings' => ['visibility' => 'private'] + $scenario->settings, 'require_login' => false]);
        $teacher = $this->user('Teacher', 'teacher');
        $ann = $this->user('Ann', 'student');
        $ben = $this->user('Ben', 'student');
        $scenario->update(['user_id' => $teacher->id]);
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ann@example.test'])->assertCreated();
        $group = $this->as($teacher)->postJson('/api/teach/assignments', ['scenario_id' => $scenario->id, 'student_ids' => [$ann->id]])->assertCreated()->json('assignment.group');

        $this->assertSame([], $this->as($ben)->getJson('/api/missions')->json('missions'));
        $this->as($ben)->getJson('/api/scenarios/starshipexplorer/play')->assertForbidden();
        $this->as($ben)->getJson("/api/scenarios/starshipexplorer/play?group=$group")->assertForbidden();
        $this->as($ann)->getJson("/api/scenarios/starshipexplorer/play?group=$group")->assertOk();
        $this->app['auth']->forgetGuards();
        $this->flushHeaders()->getJson('/api/scenarios/starshipexplorer/play')->assertUnauthorized();
    }

    public function test_avatars_are_the_platforms_and_follow_the_player_into_every_scenario(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        $before = $this->getJson('/api/scenarios/starshipexplorer/play')->json('scenario.avatar_media_ids');
        $this->assertSame(101, $before[0], 'with no platform avatars the scenario keeps its own');

        $this->seed(AvatarSeeder::class);
        $this->seed(AvatarSeeder::class);
        $document = $this->getJson('/api/scenarios/starshipexplorer/play')->json('scenario');
        $this->assertSame(range(900001, 900010), array_column($document['avatars'], 'id'));
        $this->assertArrayNotHasKey('avatar_media_ids', $document, 'avatars are characters now');
        $nova = $document['avatars'][0];
        $this->assertSame(['stand_right' => ['media_id' => 900001], 'portrait' => ['media_id' => 950001]], $nova['animations'], 'one picture facing right, and its close-up');
        // Sprocket is drawn from a platform sheet, which seeding twice does not repeat.
        $this->assertSame(2, DB::table('platform_media')->count());
        $sprocket = $document['avatars'][9];
        $sheet = collect($document['assets'])->firstWhere('id', $sprocket['animations']['walk_right']['media_id']);
        $this->assertSame(['columns' => 6, 'rows' => 3], $sheet['sheet']);
        $this->assertSame('/scenario-assets/platform/avatars/sprocket-sheet.png', $sheet['url']);
        $this->assertSame([6, 7, 8, 9, 10, 11], $sprocket['animations']['walk_right']['frames']);
        foreach (collect($document['assets'])->where('id', '>=', 800000) as $media) {
            $this->assertFileExists(base_path('../../scenarios/assets/platform/'.substr($media['url'], strlen('/scenario-assets/platform/'))));
        }

        $ann = $this->user('Ann', 'student');
        $this->as($ann)->getJson('/api/avatars')->assertOk()->assertJsonCount(10, 'avatars')->assertJsonPath('avatar_media_id', null);
        $this->as($ann)->putJson('/api/me/avatar', ['avatar_media_id' => 101])->assertStatus(422);
        $this->as($ann)->putJson('/api/me/avatar', ['avatar_media_id' => 900004])->assertOk();
        $this->as($ann)->getJson('/api/me')->assertJsonPath('user.avatar_media_id', 900004);
        config(['qbl.service_key' => 'k']);
        $this->withHeaders(['X-QBL-Service-Key' => 'k'])->postJson('/api/internal/auth/verify', ['token' => $ann->createToken('game')->plainTextToken])
            ->assertOk()->assertJsonPath('user.avatar_media_id', 900004);

        // A teacher previewing a draft sees the same avatars.
        $teacher = $this->user('Teacher', 'teacher');
        $this->assertSame(range(900001, 900010), array_column($this->as($teacher)->getJson('/api/editor/scenarios/1/preview')->assertOk()->json('scenario.avatars'), 'id'));
    }
}
