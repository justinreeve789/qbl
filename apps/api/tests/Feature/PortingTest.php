<?php

namespace Tests\Feature;

use App\Models\User;
use Database\Seeders\ShippedScenarioSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Bringing scenarios in and out through Laravel: starting from the starship hub, duplicating,
 * and exporting to a ZIP and importing it again. The rules are tested in tests/porting.php.
 */
class PortingTest extends TestCase
{
    use RefreshDatabase;

    private function teacher(): string
    {
        return User::create(['name' => 'Teacher', 'email' => 'teacher@example.test', 'password' => 'secret-password', 'role' => 'teacher'])->createToken('test')->plainTextToken;
    }

    public function test_a_new_scenario_can_start_as_a_copy_of_the_starship_hub(): void
    {
        $token = $this->teacher();

        $id = $this->withToken($token)->postJson('/api/editor/scenarios', ['title' => 'Volcano Week', 'template' => 'starship'])->assertCreated()->json('scenario.id');

        $bundle = $this->withToken($token)->getJson("/api/editor/scenarios/$id")->assertOk()->json();
        $this->assertCount(8, $bundle['scenes']);
        $this->assertSame(['Captain Vega', 'Chief Engineer Okoro', 'Botanist Lin', 'Quartermaster Pax'], array_column($bundle['characters'], 'name'));
        // It can be published and played straight away.
        $code = $this->withToken($token)->postJson("/api/editor/scenarios/$id/publish")->assertOk()->json('scenario.code');
        $this->getJson("/api/scenarios/$code/play")->assertOk()->assertJsonPath('scenario.title', 'Volcano Week');
    }

    public function test_a_scenario_is_duplicated_exported_and_imported_again(): void
    {
        $this->seed(ShippedScenarioSeeder::class);
        $token = $this->teacher();

        $copy = $this->withToken($token)->postJson('/api/editor/scenarios/1/duplicate')->assertCreated()->json('scenario');
        $this->assertSame('Copy of Starship Explorer', $copy['title']);
        $this->assertCount(13, $this->withToken($token)->getJson("/api/editor/scenarios/{$copy['id']}")->json('scenes'));

        $picture = UploadedFile::fake()->image('pond.png', 40, 30);
        $this->withToken($token)->post("/api/editor/scenarios/{$copy['id']}/media/upload", ['file' => $picture], ['Accept' => 'application/json'])->assertCreated();

        if (! class_exists(\ZipArchive::class)) {
            $this->markTestSkipped("PHP's zip extension is not installed.");
        }
        $download = $this->withToken($token)->get("/api/editor/scenarios/{$copy['id']}/export")->assertOk();
        $download->assertHeader('content-type', 'application/zip');
        $path = $download->baseResponse->getFile()->getPathname();
        $zip = new \ZipArchive;
        $zip->open($path);
        $this->assertNotFalse($zip->locateName('scenario.json'));
        // The demo's own five uploaded files came with the copy.
        $this->assertSame(8, $zip->numFiles, 'scenario.json, the README, the demo\'s five uploaded files and the one uploaded here');
        $zip->close();

        $upload = new UploadedFile($path, 'backup.zip', 'application/zip', null, true);
        $imported = $this->withToken($token)->post('/api/editor/scenarios/import', ['file' => $upload, 'title' => 'Restored'], ['Accept' => 'application/json'])->assertCreated()->json('scenario');
        $this->assertSame('Restored', $imported['title']);
        $bundle = $this->withToken($token)->getJson("/api/editor/scenarios/{$imported['id']}")->json();
        $this->assertCount(13, $bundle['scenes']);
        $uploaded = array_values(array_filter($bundle['media'], fn ($m) => $m['filepath'] !== null));
        $this->assertCount(6, $uploaded);
        foreach ($uploaded as $media) {
            $this->assertFileExists(config('qbl.media_dir').'/'.$media['filepath']);
        }
    }
}
