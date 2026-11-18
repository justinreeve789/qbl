<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\StarshipSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Activity and message logs, reports, badges and profiles as Laravel serves them. The rules are
 * tested without the framework in tests/activity.php; this checks the wiring, on the real migrations.
 */
class ReportsTest extends TestCase
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

    public function test_the_game_server_logs_what_students_do_and_the_teacher_reads_the_report(): void
    {
        $this->seed(StarshipSeeder::class);
        config(['qbl.service_key' => 'k']);
        $internal = ['X-QBL-Service-Key' => 'k'];
        $teacher = $this->user('Teacher', 'teacher');
        $ann = $this->user('Ann', 'student');
        $ben = $this->user('Ben', 'student');
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ann@example.test'])->assertCreated();
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ben@example.test'])->assertCreated();
        $scenarioId = $this->as($teacher)->getJson('/api/teach/scenarios')->assertOk()->json('scenarios.0.id');
        $assignment = $this->as($teacher)->postJson('/api/teach/assignments', [
            'scenario_id' => $scenarioId, 'student_ids' => [$ann->id, $ben->id], 'teams' => [['name' => 'Comets', 'student_ids' => [$ann->id]]],
        ])->assertCreated()->json('assignment');
        $team = $assignment['teams'][0]['group'];
        $base = "/api/internal/scenarios/$scenarioId";

        // A team plays in its assignment's room, and the play document says so.
        $this->getJson("$base/access/{$ann->id}?group=$team", $internal)->assertOk()->assertExactJson(['allowed' => true, 'party' => $assignment['group'], 'team_name' => 'Comets']);
        $this->getJson("$base/access/{$ben->id}?group=$team", $internal)->assertOk()->assertJsonPath('allowed', false);
        $this->as($ann)->getJson("/api/scenarios/starshipexplorer/play?group=$team")->assertOk()
            ->assertJsonPath('scenario.instance', ['group' => $team, 'party' => $assignment['group'], 'team_name' => 'Comets']);

        // The game server hands over what happened, in batches. Without the service key nobody can.
        $this->postJson("$base/activity", ['entries' => []])->assertForbidden();
        $this->postJson("$base/activity", ['entries' => [
            ['user_id' => (string) $ann->id, 'group' => $team, 'scene_id' => 3, 'type' => 'join', 'ref' => '3', 'at' => '2026-11-18T10:00:00.000Z'],
            ['user_id' => (string) $ann->id, 'group' => $team, 'scene_id' => 7, 'type' => 'hotspot', 'ref' => '720', 'label' => 'sample-marsh', 'at' => '2026-11-18T10:02:00.000Z'],
            ['user_id' => (string) $ann->id, 'group' => $team, 'scene_id' => 8, 'type' => 'choice', 'ref' => '82101', 'label' => 'Acidic', 'value' => 0, 'at' => '2026-11-18T10:05:00.000Z'],
        ]], $internal)->assertOk()->assertExactJson(['kept' => 3]);
        $this->postJson("$base/messages", ['entries' => [
            ['user_id' => (string) $ann->id, 'name' => 'Ann', 'group' => $team, 'scene_id' => 7, 'kind' => 'private', 'to_user_id' => (string) $ben->id, 'to_name' => 'Ben', 'text' => 'found one!', 'at' => '2026-11-18T10:03:00.000Z'],
        ]], $internal)->assertOk()->assertExactJson(['kept' => 1]);
        $this->putJson("$base/sessions/{$ann->id}?group=$team", ['session' => ['scene_id' => 7, 'time_elapsed' => 420, 'variables' => ['samples' => 1, 'quest_started' => 1], 'flags' => ['glossary:sample']]], $internal)->assertNoContent();

        // The teacher's report.
        $report = $this->as($teacher)->getJson("/api/teach/assignments/{$assignment['id']}/report")->assertOk()->json('report');
        $this->assertSame([2, 1], [$report['summary']['students'], $report['summary']['started']]);
        $row = $report['students'][0];
        $this->assertSame(['Ann', 'Comets', true, 420, 1, 1, 1, 2, 1], [$row['name'], $row['team'], $row['started'], $row['time_spent'], $row['visits'], $row['hotspots_used'], $row['answers'], $row['words_learned'], $row['messages']]);
        $this->assertSame('Acidic', $row['questions'][0]['first_answer']);
        $this->assertFalse($report['students'][1]['started']);
        $this->assertStringNotContainsString('{{', json_encode($report['objectives']));
        $this->as($ann)->getJson("/api/teach/assignments/{$assignment['id']}/report")->assertForbidden();
        $this->as($this->user('Other', 'teacher'))->getJson("/api/teach/assignments/{$assignment['id']}/report")->assertNotFound();

        // The audit log of messages, and one student's steps.
        $this->as($teacher)->getJson("/api/teach/assignments/{$assignment['id']}/messages")->assertOk()
            ->assertJsonPath('messages.0.text', 'found one!')->assertJsonPath('messages.0.kind', 'private')->assertJsonPath('messages.0.to_name', 'Ben');
        $this->as($teacher)->getJson("/api/teach/assignments/{$assignment['id']}/activity/{$ann->id}")->assertOk()->assertJsonCount(3, 'activity');
    }

    public function test_an_award_can_give_a_badge_which_shows_on_the_players_profile(): void
    {
        $this->seed(StarshipSeeder::class);
        config(['qbl.service_key' => 'k']);
        $internal = ['X-QBL-Service-Key' => 'k'];
        $ann = $this->user('Ann', 'student');
        $ben = $this->user('Ben', 'student');
        $scenario = \App\Models\Scenario::findPublished('starshipexplorer');

        // Give the demo's first award a badge, and publish that.
        $store = app(\App\Qbl\ScenarioStore::class);
        $award = collect($store->rows($scenario->id)['actions'])->firstWhere('type', 'award');
        $store->updateRow($scenario->id, 'actions', (int) $award['id'], ['params' => ['badge' => 'Field Scientist', 'badge_description' => 'Collected a first sample'] + (array) $award['params']]);
        $store->publish($scenario->id);

        $first = $this->postJson("/api/internal/scenarios/{$scenario->id}/awards", ['user_id' => $ann->id, 'action_id' => $award['id']], $internal)->assertOk()->json('progress');
        $this->assertSame('Field Scientist', $first['badge']['name']);
        $again = $this->postJson("/api/internal/scenarios/{$scenario->id}/awards", ['user_id' => $ann->id, 'action_id' => $award['id']], $internal)->assertOk()->json('progress');
        $this->assertArrayNotHasKey('badge', $again, 'A badge is earned once.');

        // Anyone signed in can look at a player's profile; it says nothing private.
        $profile = $this->as($ben)->getJson("/api/players/{$ann->id}/profile")->assertOk()->json('profile');
        $this->assertSame(['Ann', $first['stars'], $first['xp'], $first['rank'], ['Field Scientist']], [$profile['name'], $profile['stars'], $profile['xp'], $profile['rank'], array_column($profile['badges'], 'name')]);
        $this->assertSame('Starship Explorer', $profile['badges'][0]['scenario']);
        $this->assertArrayNotHasKey('email', $profile);
        $this->app['auth']->forgetGuards();
        $this->withHeaders(['Authorization' => ''])->getJson("/api/players/{$ann->id}/profile")->assertUnauthorized();
    }
}
