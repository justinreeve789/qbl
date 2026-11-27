<?php

namespace Tests\Feature;

use App\Models\User;
use App\Qbl\ScenarioStore;
use Database\Seeders\ShippedScenarioSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * Student building through Laravel: the migration, the routes, a picture upload and the picture
 * served by its key, a teacher's approval, and a reset. The rules are tested in tests/builds.php.
 */
class StudentBuildsTest extends TestCase
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

    public function test_a_student_builds_uploads_and_their_teacher_approves_it(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        $teacher = $this->user('Teacher', 'teacher');
        $ann = $this->user('Ann', 'student');
        $ben = $this->user('Ben', 'student');
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ann@example.test'])->assertCreated();
        $this->as($teacher)->postJson('/api/teach/students', ['email' => 'ben@example.test'])->assertCreated();
        $scenarioId = (int) collect($this->as($teacher)->getJson('/api/teach/scenarios')->assertOk()->json('scenarios'))->firstWhere('code', 'starshipexplorer')['id'];

        // The starship's first scene lets students add words, pictures and hotspots.
        $store = app(ScenarioStore::class);
        $doc = $store->compile($scenarioId);
        $sceneId = (int) $doc['start_scene_id'];
        $scene = $store->decode('scenes', (array) $store->pdo()->query("SELECT * FROM scenes WHERE id = $sceneId")->fetch(\PDO::FETCH_ASSOC));
        $store->updateRow($scenarioId, 'scenes', $sceneId, ['params' => ['building' => ['enabled' => true, 'tools' => ['label', 'picture', 'hotspot']]] + ($scene['params'] ?? [])]);
        $store->publish($scenarioId);

        $group = 'a'.$this->as($teacher)->postJson('/api/teach/assignments', ['scenario_id' => $scenarioId, 'student_ids' => [$ann->id, $ben->id]])->assertCreated()->json('assignment.id');
        $base = '/api/builds/starshipexplorer';

        $this->app['auth']->forgetGuards();
        $this->withoutToken()->getJson("$base?group=$group")->assertUnauthorized();
        $this->as($ann)->getJson("$base?group=$group")->assertOk()->assertJsonPath('may_build', true)->assertJsonPath('builds', []);
        $picture = $this->as($ann)->post("$base/uploads?group=$group", ['file' => UploadedFile::fake()->image('poster.jpg', 2400, 1200)], ['Accept' => 'application/json'])
            ->assertCreated()->assertJsonPath('upload.width', 1600)->json('upload');
        $this->app['auth']->forgetGuards();
        $file = $this->withoutToken()->get($picture['url'])->assertOk();
        $this->assertContains($file->headers->get('Content-Type'), ['image/webp', 'image/png']);
        $this->get('/api/builds/files/'.str_repeat('0', 24))->assertNotFound();

        $this->as($ann)->putJson("$base/scenes/$sceneId?group=$group", ['pieces' => [
            ['id' => 'l1', 'kind' => 'label', 'x' => 100, 'y' => 100, 'text' => 'Landing pad'],
            ['id' => 'p1', 'kind' => 'picture', 'x' => 400, 'y' => 300, 'upload_id' => $picture['id']],
            ['id' => 'h1', 'kind' => 'hotspot', 'x' => 500, 'y' => 300, 'opens' => ['text' => 'Hello', 'upload_id' => $picture['id']]],
        ]])->assertOk()->assertJsonPath('build.status', 'pending')->assertJsonPath('build.pieces.2.opens.text', 'Hello');
        $this->as($ann)->putJson("$base/scenes/$sceneId?group=$group", ['pieces' => [['id' => 'x', 'kind' => 'sticker', 'x' => 1, 'y' => 1, 'media_id' => 1]]])->assertStatus(422);
        $this->as($ben)->getJson("$base?group=$group")->assertJsonPath('builds', []);

        $queue = $this->as($teacher)->getJson('/api/builds/teach')->assertOk()->json('builds');
        $this->assertCount(1, $queue);
        $this->assertSame(['Ann', 'Your class'], [$queue[0]['student']['name'], $queue[0]['where']]);
        $this->as($ann)->getJson('/api/builds/teach')->assertForbidden();

        // Her teacher sees it in the game, and changes it.
        $mine = $this->as($teacher)->getJson("$base?group=$group")->assertOk();
        $mine->assertJsonPath('builds.0.editable', true)->assertJsonPath('builds.0.uploads.0.id', $picture['id']);
        $this->as($ben)->putJson("/api/builds/teach/{$queue[0]['id']}/pieces", ['pieces' => []])->assertNotFound();
        $this->as($teacher)->putJson("/api/builds/teach/{$queue[0]['id']}/pieces", ['pieces' => [
            ['id' => 'l1', 'kind' => 'label', 'x' => 120, 'y' => 100, 'text' => 'Landing pad'],
            ['id' => 'p1', 'kind' => 'picture', 'x' => 400, 'y' => 300, 'upload_id' => $picture['id']],
        ]])
            ->assertOk()->assertJsonPath('build.status', 'pending')->assertJsonPath('build.pieces.0.x', 120);
        $this->as($teacher)->putJson("/api/builds/teach/{$queue[0]['id']}", ['status' => 'approved'])->assertOk()->assertJsonPath('build.status', 'approved');
        $seen = $this->as($ben)->getJson("$base?group=$group")->assertOk();
        $seen->assertJsonPath('builds.0.author', 'Ann');
        $this->assertSame($picture['url'], $seen->json('pictures.'.$picture['id'].'.url'));

        // Starting Ann's game again removes what she built and uploaded.
        $this->as($teacher)->postJson('/api/teach/assignments/'.substr($group, 1)."/students/{$ann->id}/reset")->assertOk();
        $this->as($ann)->getJson("$base?group=$group")->assertJsonPath('builds', [])->assertJsonPath('uploads', []);
        $this->get($picture['url'])->assertNotFound();
    }
}
