<?php

namespace Tests\Feature;

use App\Qbl\ScenarioStore;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechFactory;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * php artisan qbl:voice through real Laravel, with a stand-in for the text-to-speech service.
 * The voices themselves are tested in tests/speech.php.
 */
class VoiceScenarioTest extends TestCase
{
    use RefreshDatabase;

    private string $work;

    protected function setUp(): void
    {
        parent::setUp();
        $this->work = sys_get_temp_dir().'/qbl-voice-feature-'.bin2hex(random_bytes(4));
        config(['qbl.media_dir' => "{$this->work}/media", 'qbl_speech.cache_dir' => "{$this->work}/speech"]);
        $this->app->forgetInstance(ScenarioStore::class);
        $engine = new class implements SpeechEngine
        {
            public function name(): string
            {
                return 'kokoro';
            }

            public function synthesize(string $text, array $voice, ?string $lang = null): Speech
            {
                $frames = str_repeat("\xFF\xFB\x90\x64".str_repeat("\x00", 413), 6);

                return new Speech("ID3\x04\x00\x00\x00\x00\x00\x00".$frames, 'mp3', Speech::words([[$text, 0, 1]]), 1000);
            }

            public function voices(): array
            {
                return ['af_heart'];
            }
        };
        $this->app->singleton(SpeechFactory::class, fn () => new SpeechFactory(config('qbl_speech'), null, $engine));
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->work));
        parent::tearDown();
    }

    public function test_the_voices_are_listed(): void
    {
        $this->artisan('qbl:voice', ['--list' => true])
            ->expectsOutputToContain('Heart: woman, American')
            ->assertSuccessful();
    }

    public function test_a_scenarios_characters_are_given_voices_and_their_lines_recorded(): void
    {
        $store = $this->app->make(ScenarioStore::class);
        $scenario = $store->createScenario(['title' => 'Voices'], null);
        $id = (int) $scenario['id'];
        $scene = (int) $store->bundle($id)['scenes'][0]['id'];
        $ada = $store->createRow($id, 'characters', ['name' => 'Ada']);
        $event = $store->createRow($id, 'events', ['scene_id' => $scene, 'kind' => 'hotspot', 'shortname' => 'talk']);
        $line = $store->createRow($id, 'actions', ['event_id' => $event['id'], 'type' => 'dialogue', 'params' => ['text' => 'Hello, {{QBLPlayerName}}!', 'speaker' => 'character', 'character_id' => $ada['id']]]);

        $this->artisan('qbl:voice', ['key' => $scenario['code'], '--dry-run' => true])
            ->expectsOutputToContain('No character has a voice yet')
            ->assertSuccessful();
        $this->artisan('qbl:voice', ['key' => $scenario['code'], '--assign' => true])
            ->expectsOutputToContain('Ada: ')
            ->expectsOutputToContain('1 lines recorded')
            ->assertSuccessful();

        $action = collect($store->bundle($id)['actions'])->firstWhere('id', $line['id']);
        $media = collect($store->bundle($id)['media'])->firstWhere('id', $action['params']['narration_media_id']);
        $this->assertSame('audio', $media['type']);
        $this->assertSame('Hello, explorer!', $media['params']['speech']['text']);
        $this->assertFileExists("{$this->work}/media/{$media['filepath']}");
    }

    public function test_an_unknown_scenario_is_refused(): void
    {
        $this->artisan('qbl:voice', ['key' => 'nonesuch'])->expectsOutputToContain('There is no scenario nonesuch.')->assertFailed();
    }
}
