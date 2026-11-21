<?php

namespace Tests\Feature;

use App\Models\LibraryAsset;
use App\Models\Scenario;
use App\Models\User;
use Database\Seeders\LibrarySeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;
use Tests\TestCase;

/**
 * The asset library through Laravel: the migration, the seeder, the models, the editor routes, the
 * internal routes and qbl:library. The rules are tested in tests/library.php.
 */
class LibraryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Config::set('qbl.media_dir', sys_get_temp_dir().'/qbl-library-feature-'.getmypid());
        $this->seed(LibrarySeeder::class);
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg(config('qbl.media_dir')));
        parent::tearDown();
    }

    private function token(string $role): string
    {
        return User::create(['name' => ucfirst($role), 'email' => "$role@example.test", 'password' => 'secret-password', 'role' => $role])->createToken('test')->plainTextToken;
    }

    public function test_the_seeder_fills_the_library_and_the_models_read_it(): void
    {
        $this->assertSame(16, LibraryAsset::ofKind('character')->count());
        $this->assertSame(['bay-horse', 'palomino-horse', 'stagecoach'], LibraryAsset::active()->ofKind('vehicle')->search('horse')->ordered()->pluck('slug')->all());
        $coach = LibraryAsset::resolve('stagecoach');
        $this->assertSame('Horse-drawn', $coach->category);
        $this->assertSame('/scenario-assets/library/vehicles/stagecoach/sheet.png', $coach->file('sheet')->url);
        $this->assertFileExists($coach->file('sheet')->localPath());
        $this->assertSame('CC-BY 3.0', $coach->credit['license']);
    }

    public function test_a_teacher_adds_a_vehicle_to_their_scenario_and_it_is_in_the_published_game(): void
    {
        $token = $this->token('teacher');
        $id = $this->withToken($token)->postJson('/api/editor/scenarios', ['title' => 'Road trip'])->assertCreated()->json('scenario.id');

        $this->withToken($token)->getJson('/api/editor/library?kind=vehicle')->assertOk()->assertJsonCount(9, 'assets')->assertJsonPath('categories.0.name', 'Cars');
        $added = $this->withToken($token)->postJson('/api/editor/library/red-convertible/add', ['scenario_id' => $id])->assertCreated()->json();
        $this->assertSame('items', $added['created']['table']);
        $this->assertTrue((bool) $added['created']['row']['vehicle']);

        $code = $this->withToken($token)->postJson("/api/editor/scenarios/$id/publish")->assertOk()->json('scenario.code');
        $items = $this->getJson("/api/scenarios/$code/play")->assertOk()->json('scenario.items');
        $this->assertSame('Red Convertible', $items[0]['name']);
        $this->assertSame(2.4, $items[0]['speed_multiplier']);

        // Teachers cannot change the library; administrators can.
        $this->withToken($token)->postJson('/api/editor/library', ['kind' => 'picture', 'name' => 'Sky'])->assertForbidden();
    }

    public function test_the_model_adds_and_keeps_assets(): void
    {
        $owner = User::create(['name' => 'Admin', 'email' => 'admin@example.test', 'password' => 'secret-password', 'role' => 'admin']);
        $id = $this->withToken($owner->createToken('t')->plainTextToken)->postJson('/api/editor/scenarios', ['title' => 'Farm'])->json('scenario.id');
        $scenario = Scenario::findOrFail($id);

        $result = LibraryAsset::resolve('bay-horse')->addTo($scenario);
        $this->assertSame('Bay Horse', $result['created']['row']['name']);

        $kept = LibraryAsset::keep($scenario, 'items', $result['created']['row']['id'], ['name' => 'Our Pony', 'category' => 'School']);
        $this->assertSame(['our-pony', 'vehicle', 'scenario'], [$kept->slug, $kept->kind, $kept->source]);
        $this->assertSame(['sheet'], $kept->files->pluck('role')->all());
        $this->assertSame(1, LibraryAsset::visibleTo($owner)->where('slug', 'our-pony')->count());
    }

    public function test_internal_routes_need_the_service_key(): void
    {
        $this->getJson('/api/internal/library')->assertForbidden();
        Config::set('qbl.service_key', 'secret-service-key');
        $headers = ['X-QBL-Service-Key' => 'secret-service-key'];
        $this->getJson('/api/internal/library?kind=vehicle', $headers)->assertOk()->assertJsonCount(9, 'assets');
        $this->getJson('/api/internal/library/bicycle', $headers)->assertOk()->assertJsonPath('asset.credit.author', 'Clint Bellanger');
    }

    public function test_the_command_lists_and_imports(): void
    {
        $this->artisan('qbl:library', ['--kind' => 'vehicle'])->expectsOutputToContain('stagecoach')->assertSuccessful();
        $this->artisan('qbl:library', ['action' => 'import'])->expectsOutputToContain('0 added')->assertSuccessful();
        $this->artisan('qbl:library', ['action' => 'withdraw', 'asset' => 'motorcycle'])->assertSuccessful();
        $this->assertFalse(LibraryAsset::resolve('motorcycle')->active);
    }
}
