<?php

namespace Tests\Feature;

use App\Models\Scenario;
use App\Models\User;
use App\Qbl\Avatars;
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
        $this->assertSame(range(900011, 900019), array_column($document['avatars'], 'id'));
        $this->assertSame(['Asimov', 'Buck', 'Gil', 'Lucy', 'Mallory', 'Pinta', 'Riona', 'Sam', 'Val'], array_column($document['avatars'], 'name'));
        $this->assertArrayNotHasKey('avatar_media_ids', $document, 'avatars are characters now');
        // Each is one platform picture, given for the way the art faces, and its close-up; seeding twice does not repeat them.
        $this->assertSame(18, DB::table('platform_media')->count());
        [$asimov, , $gil] = $document['avatars'];
        $this->assertSame(['stand_left', 'portrait'], array_keys($asimov['animations']), 'Asimov faces left');
        $this->assertSame(['stand_right', 'portrait'], array_keys($gil['animations']), 'Gil faces right');
        $picture = collect($document['assets'])->firstWhere('id', $asimov['animations']['stand_left']['media_id']);
        $this->assertSame('/scenario-assets/platform/avatars/asimov.png', $picture['url']);
        foreach (collect($document['assets'])->where('id', '>=', 800000) as $media) {
            $this->assertFileExists(base_path('../../scenarios/assets/platform/'.substr($media['url'], strlen('/scenario-assets/platform/'))));
        }

        $ann = $this->user('Ann', 'student');
        $this->as($ann)->getJson('/api/avatars')->assertOk()->assertJsonCount(9, 'avatars')->assertJsonPath('avatar_media_id', null);
        $this->as($ann)->putJson('/api/me/avatar', ['avatar_media_id' => 101])->assertStatus(422);
        $this->as($ann)->putJson('/api/me/avatar', ['avatar_media_id' => 900014])->assertOk();
        $this->as($ann)->getJson('/api/me')->assertJsonPath('user.avatar_media_id', 900014);
        config(['qbl.service_key' => 'k']);
        $this->withHeaders(['X-QBL-Service-Key' => 'k'])->postJson('/api/internal/auth/verify', ['token' => $ann->createToken('game')->plainTextToken])
            ->assertOk()->assertJsonPath('user.avatar_media_id', 900014);

        // A teacher previewing a draft sees the same avatars.
        $teacher = $this->user('Teacher', 'teacher');
        $this->assertSame(range(900011, 900019), array_column($this->as($teacher)->getJson('/api/editor/scenarios/1/preview')->assertOk()->json('scenario.avatars'), 'id'));
    }

    public function test_a_database_with_the_first_cast_of_avatars_gets_the_new_one_in_its_place(): void
    {
        $pdo = DB::connection()->getPdo();
        $first = [];
        foreach (Avatars::FIRST_CAST as $id => $url) {
            $first[] = ['id' => $id, 'name' => "Old $id", 'image_url' => $url, 'settings' => ['scale' => 0.85]];
        }
        Avatars::seed($pdo, $first);
        DB::table('avatars')->insert(['id' => 40, 'name' => 'Ours', 'image_url' => '/media/ours.png', 'settings' => '{}', 'active' => 1, 'sequence' => 0, 'organization_id' => 7]);
        $ann = $this->user('Ann', 'student');
        $bo = $this->user('Bo', 'student');
        DB::table('users')->where('id', $ann->id)->update(['avatar_media_id' => 900003]);
        DB::table('users')->where('id', $bo->id)->update(['avatar_media_id' => 900040]);

        $migration = require database_path('migrations/2026_11_21_000200_replace_platform_avatars.php');
        $migration->up();
        $migration->up(); // again: nothing more happens

        $this->assertSame([11, 12, 13, 14, 15, 16, 17, 18, 19, 40], DB::table('avatars')->where('active', 1)->orderBy('id')->pluck('id')->all());
        $this->assertSame(10, DB::table('avatars')->where('active', 0)->count(), 'the first cast is kept, withdrawn');
        $this->assertNull(DB::table('users')->where('id', $ann->id)->value('avatar_media_id'), 'a player who had chosen one of the first cast chooses again');
        $this->assertSame(900040, (int) DB::table('users')->where('id', $bo->id)->value('avatar_media_id'), "an organization's own avatar is untouched");
        $this->as($ann)->getJson('/api/avatars')->assertOk()->assertJsonCount(9, 'avatars')->assertJsonPath('avatars.0.name', 'Asimov');
        $this->as($ann)->putJson('/api/me/avatar', ['avatar_media_id' => 900003])->assertStatus(422);

        $migration->down();
        $this->assertSame(range(1, 10), DB::table('avatars')->where('active', 1)->whereNull('organization_id')->orderBy('id')->pluck('id')->all());
        $migration->up();
        $this->assertSame(range(11, 19), DB::table('avatars')->where('active', 1)->whereNull('organization_id')->orderBy('id')->pluck('id')->all());
    }
}
