<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\StarshipSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * The API as Laravel serves it: migrations, the seeder, sign-in, the editor routes, publishing,
 * play, and the game server's internal routes. The rules themselves are tested without the
 * framework in tests/store.php; this checks that Laravel is wired to them correctly.
 */
class QblApiTest extends TestCase
{
    use RefreshDatabase;

    private function teacher(): User
    {
        return User::create(['name' => 'Teacher', 'email' => 'teacher@example.test', 'password' => 'secret-password', 'role' => 'teacher']);
    }

    public function test_the_seeder_publishes_the_demo_at_its_code(): void
    {
        $this->seed(StarshipSeeder::class);

        $document = $this->getJson('/api/scenarios/starshipexplorer/play')->assertOk()->json('scenario');
        $this->assertSame('starshipexplorer', $document['code']);
        $this->assertCount(13, $document['scenes']);

        $shipped = json_decode(file_get_contents(base_path('../../scenarios/starship.json')), true);
        unset($document['session']);
        $this->assertEquals($shipped, $document, 'The seeded, published JSON is the one shipped in scenarios/starship.json.');
    }

    public function test_seeding_again_keeps_edits(): void
    {
        $this->seed(StarshipSeeder::class);
        $token = $this->teacher()->createToken('test')->plainTextToken;
        $this->withToken($token)->patchJson('/api/editor/scenarios/1', ['title' => 'Edited'])->assertOk();

        $this->seed(StarshipSeeder::class);

        $this->withToken($token)->getJson('/api/editor/scenarios/1')->assertOk()->assertJsonPath('scenario.title', 'Edited');
    }

    public function test_signing_in_gives_a_token_that_opens_the_editor(): void
    {
        $this->teacher();

        $token = $this->postJson('/api/auth/login', ['email' => 'teacher@example.test', 'password' => 'secret-password'])->assertOk()->json('token');

        $this->withToken($token)->getJson('/api/me')->assertOk()->assertJsonPath('user.role', 'teacher');
        $this->withToken($token)->getJson('/api/editor/scenarios')->assertOk()->assertJsonPath('scenarios', []);
    }

    public function test_the_editor_is_closed_to_guests_and_students(): void
    {
        $this->getJson('/api/editor/scenarios')->assertUnauthorized();

        $this->app['auth']->forgetGuards();
        $student = User::create(['name' => 'Student', 'email' => 'student@example.test', 'password' => 'secret-password', 'role' => 'student']);
        $this->withToken($student->createToken('test')->plainTextToken)->getJson('/api/editor/scenarios')->assertForbidden();
    }

    public function test_a_scenario_is_built_published_and_played(): void
    {
        config(['qbl.media_dir' => sys_get_temp_dir().'/qbl-feature-'.bin2hex(random_bytes(4))]);
        $token = $this->teacher()->createToken('test')->plainTextToken;
        $api = fn () => $this->withToken($token);

        $scenario = $api()->postJson('/api/editor/scenarios', ['title' => 'Pond Life'])->assertCreated()->json('scenario');
        $id = $scenario['id'];
        $this->assertMatchesRegularExpression('/^[a-z]{16}$/', $scenario['code']);

        $scene = $api()->getJson("/api/editor/scenarios/$id")->assertOk()->json('scenes.0');
        $api()->patchJson("/api/editor/scenarios/$id/rows/scenes/{$scene['id']}", ['subtitle' => 'The near bank'])->assertOk();
        $event = $api()->postJson("/api/editor/scenarios/$id/rows/events", ['scene_id' => $scene['id'], 'kind' => 'start'])->assertCreated()->json('row');
        $api()->postJson("/api/editor/scenarios/$id/rows/actions", ['event_id' => $event['id'], 'type' => 'wait', 'params' => ['duration' => 500]])->assertCreated();

        $upload = $api()->post("/api/editor/scenarios/$id/media/upload", ['file' => UploadedFile::fake()->image('pond.png', 40, 30)], ['Accept' => 'application/json'])
            ->assertCreated()->json('row');
        $this->assertSame(['image', 40, 30], [$upload['type'], $upload['width'], $upload['height']]);
        $this->assertFileExists(config('qbl.media_dir').'/'.$upload['filepath']);

        // A draft can be previewed by its author but is not served to players.
        $api()->getJson("/api/editor/scenarios/$id/preview")->assertOk()->assertJsonPath('scenario.scenes.0.subtitle', 'The near bank');
        $this->getJson("/api/scenarios/{$scenario['code']}/play")->assertNotFound();

        $api()->postJson("/api/editor/scenarios/$id/publish")->assertOk();
        $this->getJson("/api/scenarios/{$scenario['code']}/play")->assertOk()
            ->assertJsonPath('scenario.title', 'Pond Life')
            ->assertJsonPath('scenario.scenes.0.start_events.0.actions.0.type', 'wait');

        // Another teacher cannot see it; deleting it removes its uploads.
        // (Within one test the application remembers who signed in first; real requests each start fresh.)
        $this->app['auth']->forgetGuards();
        $other = User::create(['name' => 'Other', 'email' => 'other@example.test', 'password' => 'secret-password', 'role' => 'teacher']);
        $this->withToken($other->createToken('test')->plainTextToken)->getJson("/api/editor/scenarios/$id")->assertNotFound();
        $this->app['auth']->forgetGuards();
        $api()->deleteJson("/api/editor/scenarios/$id")->assertNoContent();
        $this->assertDirectoryDoesNotExist(config('qbl.media_dir')."/$id");
    }

    public function test_the_game_servers_routes_need_the_service_key(): void
    {
        config(['qbl.service_key' => 'test-service-key']);
        $this->seed(StarshipSeeder::class);

        $this->getJson('/api/internal/scenarios/starshipexplorer')->assertForbidden();
        $this->getJson('/api/internal/scenarios/starshipexplorer', ['X-QBL-Service-Key' => 'test-service-key'])
            ->assertOk()->assertJsonPath('scenario.code', 'starshipexplorer');
    }

    public function test_stars_are_awarded_by_the_game_server_and_spent_in_the_marketplace(): void
    {
        config(['qbl.service_key' => 'test-service-key']);
        $this->seed(\Database\Seeders\ShopSeeder::class);
        $teacher = $this->teacher();
        $token = $teacher->createToken('test')->plainTextToken;
        $api = fn () => $this->withToken($token);

        // A scenario with one award of 20 stars and 150 XP, and an item of its own for sale.
        $scenario = $api()->postJson('/api/editor/scenarios', ['title' => 'Stars'])->json('scenario');
        $id = $scenario['id'];
        $scene = $api()->getJson("/api/editor/scenarios/$id")->json('scenes.0');
        $event = $api()->postJson("/api/editor/scenarios/$id/rows/events", ['scene_id' => $scene['id'], 'kind' => 'start'])->json('row');
        $award = $api()->postJson("/api/editor/scenarios/$id/rows/actions", ['event_id' => $event['id'], 'type' => 'award', 'params' => ['stars' => 20, 'xp' => 150]])->assertCreated()->json('row');
        $badge = $api()->postJson("/api/editor/scenarios/$id/rows/shop_items", ['name' => 'Mission badge', 'kind' => 'wearable', 'slot' => 'body', 'price' => 5])->assertCreated()->json('row');
        $api()->postJson("/api/editor/scenarios/$id/publish")->assertOk();

        $api()->getJson('/api/me/progress')->assertOk()->assertJsonPath('progress.stars', 0)->assertJsonPath('progress.rank', 'Cadet');
        // Players cannot award themselves: only the game server's route grants stars.
        $api()->postJson("/api/internal/scenarios/$id/awards", ['user_id' => $teacher->id, 'action_id' => $award['id']])->assertForbidden();
        $server = ['X-QBL-Service-Key' => 'test-service-key'];
        $this->postJson("/api/internal/scenarios/$id/awards", ['user_id' => $teacher->id, 'action_id' => $award['id']], $server)
            ->assertOk()->assertJsonPath('progress.stars', 20)->assertJsonPath('progress.rank', 'Explorer')->assertJsonPath('progress.delta_stars', 20);
        $this->postJson("/api/internal/scenarios/$id/awards", ['user_id' => $teacher->id, 'action_id' => $award['id']], $server)
            ->assertOk()->assertJsonPath('progress.stars', 20)->assertJsonPath('progress.already', true);

        $shop = $api()->getJson("/api/shop?scenario={$scenario['code']}")->assertOk();
        $this->assertSame('Mission badge', $shop->json('items.0.name'));
        $this->assertSame('Star cap', $shop->json('items.1.name'));
        $api()->postJson('/api/shop/1/buy')->assertOk()->assertJsonPath('progress.stars', 5);
        $api()->postJson('/api/shop/2/buy')->assertStatus(422);
        $api()->postJson("/api/shop/{$badge['id']}/buy", ['scenario' => $scenario['code']])->assertOk()->assertJsonPath('progress.stars', 0);
        $api()->postJson('/api/shop/1/equip', ['equipped' => true])->assertOk()->assertJsonPath('progress.equipped', [1]);
        $this->getJson("/api/internal/users/{$teacher->id}/look", $server)->assertOk()->assertJsonPath('look', '1');
    }
}
