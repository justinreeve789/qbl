<?php

namespace Tests\Feature;

use App\Models\User;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\ScenarioStore;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

require_once __DIR__.'/../fixtures/generation/FakeModel.php';

/**
 * The generator's commands through real Laravel, with a stand-in language model and the placeholder
 * pictures. The generator itself is tested in tests/generation.php.
 */
class GenerateScenarioTest extends TestCase
{
    use RefreshDatabase;

    private string $work;

    protected function setUp(): void
    {
        parent::setUp();
        $this->work = sys_get_temp_dir().'/qbl-generate-feature-'.bin2hex(random_bytes(4));
        config(['qbl.media_dir' => "{$this->work}/media", 'qbl_generation.work_dir' => "{$this->work}/generations", 'qbl_generation.images.driver' => 'placeholder']);
        $this->app->forgetInstance(ScenarioStore::class);
        $model = new \FakeModel(require __DIR__.'/../fixtures/generation/blueprint.php');
        $this->app->singleton(GenerationFactory::class, fn ($app) => new GenerationFactory(config('qbl_generation'), $app->make(ScenarioStore::class), null, $model));
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->work));
        parent::tearDown();
    }

    public function test_standards_are_imported_and_listed(): void
    {
        $this->artisan('qbl:standards', ['source' => 'file', 'id' => __DIR__.'/../fixtures/generation/standards.json', '--framework' => 'TEST-SCI'])
            ->expectsOutputToContain('Imported 4 standards into TEST-SCI.')
            ->assertSuccessful();
        $this->artisan('qbl:standards')->expectsOutputToContain('TEST-SCI')->assertSuccessful();
    }

    public function test_a_mission_is_generated_imported_as_a_private_draft_and_aligned(): void
    {
        $teacher = User::create(['name' => 'Teacher', 'email' => 'teacher@example.test', 'password' => 'secret-password', 'role' => 'teacher']);
        $this->artisan('qbl:standards', ['source' => 'file', 'id' => __DIR__.'/../fixtures/generation/standards.json', '--framework' => 'TEST-SCI'])->assertSuccessful();

        $this->artisan('qbl:generate', [
            'prompt' => 'Why does the orchard have flowers but no fruit?', '--grade' => '3', '--framework' => ['TEST-SCI'], '--owner' => 'teacher@example.test', '--images' => 'placeholder',
        ])->expectsOutputToContain('a private draft')->assertSuccessful();

        $scenario = \DB::table('scenarios')->where('title', 'The Quiet Hive')->first();
        $this->assertNotNull($scenario);
        $this->assertSame($teacher->id, (int) $scenario->user_id);
        $this->assertNull($scenario->published_at);
        $this->assertSame(3, \DB::table('scenes')->where('scenario_id', $scenario->id)->count());
        $this->assertSame('TEST-3-LS1-1', \DB::table('scenario_standards')->join('curriculum_standards', 'curriculum_standards.id', '=', 'scenario_standards.curriculum_standard_id')->where('scenario_id', $scenario->id)->value('code'));
        $run = \DB::table('scenario_generations')->first();
        $this->assertSame('done', $run->status);
        $this->assertSame((int) $scenario->id, (int) $run->scenario_id);

        // The teacher can open it in the editor and publish it.
        $token = $teacher->createToken('test')->plainTextToken;
        $this->withToken($token)->getJson("/api/editor/scenarios/{$scenario->id}")->assertOk()->assertJsonCount(2, 'characters');
        $code = $this->withToken($token)->postJson("/api/editor/scenarios/{$scenario->id}/publish")->assertOk()->json('scenario.code');
        $this->assertSame($scenario->code, $code);
    }

    public function test_design_only_stops_before_drawing_and_can_be_resumed(): void
    {
        $this->artisan('qbl:generate', ['prompt' => 'Pollination', '--design-only' => true])
            ->expectsOutputToContain('Blueprint ready')->assertSuccessful();
        $this->assertSame('designed', \DB::table('scenario_generations')->value('status'));
        $this->assertSame(0, \DB::table('scenarios')->count());

        $run = \DB::table('scenario_generations')->value('id');
        $this->artisan('qbl:generate', ['--resume' => $run, '--images' => 'placeholder', '--publish' => true])->expectsOutputToContain('Published')->assertSuccessful();
        $this->assertNotNull(\DB::table('scenarios')->where('title', 'The Quiet Hive')->value('published_at'));
    }

    public function test_a_real_image_driver_needs_approved_anchors(): void
    {
        config(['qbl_generation.styles_dir' => "{$this->work}/styles"]);
        @mkdir("{$this->work}/styles/bare", 0775, true);
        copy(resource_path('art-styles/qbl-cartoon/style.php'), "{$this->work}/styles/bare/style.php");

        $this->artisan('qbl:generate', ['prompt' => 'Pollination', '--images' => 'gemini', '--style' => 'bare'])
            ->expectsOutputToContain('no approved anchor pictures')->assertFailed();
    }
}
