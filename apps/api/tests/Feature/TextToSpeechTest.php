<?php

namespace Tests\Feature;

use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechFactory;
use Tests\TestCase;

/**
 * php artisan qbl:tts through real Laravel, with a stand-in for the text-to-speech service that
 * remembers what it was asked to say, and in which voice.
 */
class TextToSpeechTest extends TestCase
{
    private string $work;

    private object $engine;

    protected function setUp(): void
    {
        parent::setUp();
        $this->work = sys_get_temp_dir().'/qbl-tts-feature-'.bin2hex(random_bytes(4));
        mkdir($this->work, 0775, true);
        config(['qbl_speech.cache_dir' => "{$this->work}/cache"]);
        $this->engine = new class implements SpeechEngine
        {
            /** @var list<array{0: string, 1: array, 2: ?string}> */
            public array $said = [];

            public function name(): string
            {
                return 'kokoro';
            }

            public function synthesize(string $text, array $voice, ?string $lang = null): Speech
            {
                $this->said[] = [$text, $voice, $lang];

                return new Speech('ID3'.json_encode($voice), 'mp3', Speech::words([[$text, 0, 1]]), 1000);
            }

            public function voices(): array
            {
                return [];
            }
        };
        $engine = $this->engine;
        $this->app->singleton(SpeechFactory::class, fn () => new SpeechFactory(config('qbl_speech'), null, $engine));
    }

    protected function tearDown(): void
    {
        exec('rm -rf '.escapeshellarg($this->work));
        parent::tearDown();
    }

    public function test_text_is_said_in_a_random_english_voice_and_saved(): void
    {
        $out = "{$this->work}/hello.mp3";
        $this->artisan('qbl:tts', ['text' => 'Hello, {{QL_PlayerName}}!', '--out' => $out, '--timings' => true])
            ->expectsOutputToContain("Saved $out: ")
            ->assertSuccessful();

        $this->assertFileExists($out);
        $this->assertCount(1, $this->engine->said);
        [$text, , $lang] = $this->engine->said[0];
        $this->assertSame('Hello, explorer!', $text);
        $this->assertStringStartsWith('en', (string) $lang);
        $timings = json_decode((string) file_get_contents("{$this->work}/hello.json"), true);
        $this->assertSame('Hello, explorer!', $timings['text']);
        $this->assertSame('kokoro', $timings['engine']);
        $this->assertNotEmpty($timings['words']);
    }

    public function test_the_pick_fits_the_filters_and_a_seed_repeats_it(): void
    {
        $catalog = $this->app->make(SpeechFactory::class)->catalog();
        $run = function (string $seed) {
            $this->artisan('qbl:tts', ['text' => 'Hola', '--lang' => 'es', '--gender' => 'female', '--seed' => $seed, '--out' => "{$this->work}/$seed/"])
                ->assertSuccessful();

            return basename((string) glob("{$this->work}/$seed/tts-*.mp3")[0], '.mp3');
        };
        $first = substr($run('a'), 4);
        $voice = $catalog->get($first);
        $this->assertSame(['es', 'female'], [$voice['lang'], $voice['gender']]);
        $again = substr($run('a'), 4);
        $this->assertSame($first, $again, 'the same seed picks the same voice');
    }

    public function test_the_pick_is_theatrical_unless_asked_otherwise(): void
    {
        $catalog = $this->app->make(SpeechFactory::class)->catalog();
        $picked = function (array $options, string $folder) {
            $this->artisan('qbl:tts', ['text' => 'Fee, fi, fo, fum!', '--count' => 6, '--out' => "{$this->work}/$folder"] + $options)->assertSuccessful();

            return array_map(fn ($file) => preg_replace('/^tts-|(-\d)?\.mp3$/', '', basename($file)), glob("{$this->work}/$folder/tts-*.mp3"));
        };
        foreach ($picked([], 'dramatic') as $key) {
            $this->assertSame(2, $catalog->get($key)['flair'], "$key is a theatrical voice");
        }
        foreach ($picked(['--style' => 'natural'], 'natural') as $key) {
            $this->assertSame(0, $catalog->get($key)['flair'], "$key is an everyday voice");
        }
        // Hindi has no theatrical voices, nor any with character: the pick falls back to the others, and says so.
        $this->artisan('qbl:tts', ['text' => 'नमस्ते', '--lang' => 'hi', '--out' => "{$this->work}/hi.mp3"])
            ->expectsOutputToContain('the pick is from every voice')
            ->assertSuccessful();
        $this->artisan('qbl:tts', ['text' => 'Hi', '--style' => 'operatic'])
            ->expectsOutputToContain('--style must be one of')
            ->assertFailed();
    }

    public function test_several_takes_are_in_different_voices(): void
    {
        $this->artisan('qbl:tts', ['text' => 'Ready when you are.', '--count' => 3, '--out' => "{$this->work}/takes"])
            ->assertSuccessful();

        $files = glob("{$this->work}/takes/tts-*.mp3");
        $this->assertCount(3, $files);
        $this->assertCount(3, array_unique(array_map(fn ($said) => json_encode($said[1]), $this->engine->said)), 'three different voices');
    }

    public function test_a_chosen_voice_and_the_sample_line(): void
    {
        $this->artisan('qbl:tts', ['--voice' => 'heart', '--out' => "{$this->work}/heart.mp3"])
            ->expectsOutputToContain('Heart: woman, American [heart]')
            ->assertSuccessful();

        $this->assertSame(['voice' => 'af_heart'], $this->engine->said[0][1]);
        $this->assertStringContainsString('explorer', $this->engine->said[0][0], 'with no text, the catalog\'s sample line');
    }

    public function test_what_cannot_be_done_is_refused(): void
    {
        $this->artisan('qbl:tts', ['text' => 'Hi', '--voice' => 'nobody'])
            ->expectsOutputToContain('There is no voice nobody')
            ->assertFailed();
        $this->artisan('qbl:tts', ['text' => 'Hi', '--lang' => 'xx'])
            ->expectsOutputToContain('No voice on kokoro fits lang=xx')
            ->assertFailed();
        $this->artisan('qbl:tts', ['text' => 'Hi', '--age' => 'ancient'])
            ->expectsOutputToContain('--age must be one of')
            ->assertFailed();
        $this->artisan('qbl:tts', ['text' => 'Hi {{QBLScore}}', '--out' => "{$this->work}/x.mp3"])
            ->expectsOutputToContain('cannot be said')
            ->assertFailed();
        $this->assertSame([], $this->engine->said);
    }
}
