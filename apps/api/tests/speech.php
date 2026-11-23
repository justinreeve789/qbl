<?php

/**
 * Tests for characters' recorded voices (App\Qbl\Speech), run against SQLite with no network:
 *
 *   php apps/api/tests/speech.php            (npm run test:speech)
 *
 * The services are answered with recorded responses, and a stand-in engine "records" small MP3s,
 * so the catalog, choosing voices, recording a scenario's lines, keeping them up to date, the
 * editor's routes and the compiled document all run for real.
 *
 * With KOKORO_URL=http://localhost:8880 it also records a few lines with a real Kokoro-FastAPI, and
 * with CHATTERBOX_URL=http://localhost:8004 (and KOKORO_URL, to make clips) with a real chatterbox container.
 */

use App\Qbl\EditorApi;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\ScenarioCompiler;
use App\Qbl\ScenarioDecompiler;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\ChatterboxClips;
use App\Qbl\Speech\Engines\ChatterboxEngine;
use App\Qbl\Speech\Engines\KokoroEngine;
use App\Qbl\Speech\Engines\OpenAiSpeechEngine;
use App\Qbl\Speech\ScenarioVoicer;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;
use App\Qbl\Speech\VoiceCatalog;
use App\Qbl\Speech\VoicePicker;
use App\Qbl\Speech\Voicer;

set_error_handler(function (int $no, string $message, string $file, int $line) {
    if (! (error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($message, 0, $no, $file, $line);
});
spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'App\\') && is_file($file = __DIR__.'/../app/'.str_replace('\\', '/', substr($class, 4)).'.php')) {
        require $file;
    }
});

$failures = 0;
$checks = 0;
function check(bool $ok, string $what): void
{
    global $failures, $checks;
    $checks++;
    if (! $ok) {
        $failures++;
        fwrite(STDERR, "FAIL: $what\n");
    }
}
function same(mixed $actual, mixed $expected, string $what): void
{
    check($actual === $expected, $what.' (got '.json_encode($actual, JSON_UNESCAPED_UNICODE).', expected '.json_encode($expected, JSON_UNESCAPED_UNICODE).')');
}
function throws(callable $fn, string $class, string $contains, string $what): void
{
    try {
        $fn();
        check(false, "$what (nothing was thrown)");
    } catch (Throwable $e) {
        check($e instanceof $class && str_contains($e->getMessage(), $contains), "$what (got ".get_class($e).': '.$e->getMessage().')');
    }
}

final class Recorded implements HttpClient
{
    public array $sent = [];

    public function __construct(private array $answers) {}

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        $this->sent[] = compact('method', 'url', 'headers', 'body');
        $answer = array_shift($this->answers);
        if ($answer instanceof Throwable) {
            throw $answer;
        }

        return $answer;
    }
}

/** A few frames of silence that file type detection takes for MP3, with the text inside so each recording differs. */
function mp3(string $text = ''): string
{
    return 'ID3'."\x04\x00\x00\x00\x00\x00\x00".str_repeat("\xFF\xFB\x90\x64".str_repeat("\x00", 413), 6).$text;
}

/** Records instantly: each word 300 ms, in order. Counts what it is asked. */
final class FakeEngine implements SpeechEngine
{
    public array $said = [];

    public bool $down = false;

    public function name(): string
    {
        return 'kokoro';
    }

    public function synthesize(string $text, array $voice, ?string $lang = null): Speech
    {
        if ($this->down) {
            throw new SpeechError('The text-to-speech service at http://tts:8880 cannot be reached.');
        }
        $this->said[] = [$text, $voice];
        $timed = [];
        foreach (preg_split('/\s+/', $text) as $i => $w) {
            $timed[] = [$w, $i * 0.3, $i * 0.3 + 0.25];
        }
        $words = Speech::words($timed);

        return new Speech(mp3($text.json_encode($voice)), 'mp3', $words, $words ? $words[array_key_last($words)]['e'] : null);
    }

    public function voices(): array
    {
        return ['af_heart', 'af_bella'];
    }
}

$catalogPath = __DIR__.'/../resources/speech/voices.json';
$catalog = VoiceCatalog::load($catalogPath);

// ------------------------------------------------------------------ word timings
same(Speech::words([['Hello', 0.0223, 0.4223], [',', 0.4223, 0.47], ['explorer', 0.47, 1.347], ['!', 1.347, 1.5], ['forty-two', 2.38, 2.9]]), [
    ['w' => 'Hello', 's' => 22, 'e' => 422], ['w' => 'explorer', 's' => 470, 'e' => 1347], ['w' => 'forty-two', 's' => 2380, 'e' => 2900],
], 'timings in seconds become milliseconds, and punctuation the service lists as words is dropped');

// ------------------------------------------------------------------ Kokoro
$http = new Recorded([new HttpResponse(200, json_encode(['audio' => base64_encode(mp3()), 'audio_format' => 'mp3', 'timestamps' => [
    ['word' => 'Hello', 'start_time' => 0.02, 'end_time' => 0.42], ['word' => ',', 'start_time' => 0.42, 'end_time' => 0.47], ['word' => 'explorer', 'start_time' => 0.47, 'end_time' => 1.35],
]]))]);
$kokoro = new KokoroEngine($http, 'http://tts:8880/', 'secret');
$said = $kokoro->synthesize('Hello, explorer', ['voice' => 'af_bella(2)+af_sky(1)', 'speed' => 1.1]);
same($http->sent[0]['url'], 'http://tts:8880/dev/captioned_speech', 'Kokoro is asked for speech with word timings');
same(array_intersect_key($http->sent[0]['body'], array_flip(['input', 'voice', 'speed', 'response_format', 'stream', 'return_timestamps'])), [
    'input' => 'Hello, explorer', 'voice' => 'af_bella(0.6667)+af_sky(0.3333)', 'response_format' => 'mp3', 'speed' => 1.1, 'stream' => false, 'return_timestamps' => true,
], 'in the voice (a blend, its weights adding up to 1) and speed the catalog gives, as one MP3');
same([isset($http->sent[0]['body']['lang_code']), isset($http->sent[0]['body']['volume_multiplier'])], [false, false], 'in the voice\'s own language and at its own volume unless the catalog says otherwise');
same([KokoroEngine::blend('af_heart'), KokoroEngine::blend('af_heart(2)'), KokoroEngine::blend('af_sky(1)+af_bella(1)')], ['af_heart', 'af_heart', 'af_sky(0.5)+af_bella(0.5)'], 'a single voice is sent by its name, an even blend as halves');
same([KokoroEngine::blend('am_santa(1.5)-am_michael(0.5)'), KokoroEngine::blend('am_santa(3)-am_michael(1)'), KokoroEngine::blend('am_santa(0.8)+am_onyx(0.7)-am_michael(0.5)')], ['am_santa(1.5)-am_michael(0.5)', 'am_santa(1.5)-am_michael(0.5)', 'am_santa(0.8)+am_onyx(0.7)-am_michael(0.5)'], 'a blend that takes a voice away (a caricature) still adds up to 1');
same(KokoroEngine::parts('jf_tebukuro(0.5) + af_alloy(0.5)-am_onyx'), [['jf_tebukuro', 0.5], ['af_alloy', 0.5], ['am_onyx', -1.0]], 'a blend is read as its voices and their weights');
throws(fn () => KokoroEngine::blend('af_heart-af_heart'), SpeechError::class, 'leaves no voice', 'a blend that takes away all it adds is refused');
throws(fn () => KokoroEngine::blend('af_heart++af_sky'), SpeechError::class, 'not a Kokoro voice', 'and so is one that cannot be read');
same($http->sent[0]['headers'], ['Authorization' => 'Bearer secret'], 'with the key, when there is one');
$http = new Recorded([new HttpResponse(200, json_encode(['audio' => base64_encode(mp3('x')), 'timestamps' => [['word' => 'Fee', 'start_time' => 0.1, 'end_time' => 0.4]]]))]);
(new KokoroEngine($http))->synthesize('Fee, fi, fo, fum!', ['voice' => 'jf_tebukuro(1.3)-am_onyx(0.3)', 'speed' => 0.85, 'lang' => 'a', 'volume' => 1.4]);
same(array_intersect_key($http->sent[0]['body'], array_flip(['voice', 'speed', 'lang_code', 'volume_multiplier'])), ['voice' => 'jf_tebukuro(1.3)-am_onyx(0.3)', 'speed' => 0.85, 'lang_code' => 'a', 'volume_multiplier' => 1.4], 'a theatrical voice: an exaggerated blend, read as English whatever language the voices are from, louder when it is a quiet one');
same([$said->audio, $said->format, array_column($said->words, 'w'), $said->duration], [mp3(), 'mp3', ['Hello', 'explorer'], 1350], 'the audio is decoded and the words timed');
$http = new Recorded([
    new HttpResponse(200, json_encode(['audio' => base64_encode(mp3('a')), 'timestamps' => []])),
    new HttpResponse(200, json_encode(['audio' => base64_encode(mp3('b')), 'timestamps' => [['word' => 'Hola,', 'start_time' => 0.1, 'end_time' => 0.4], ['word' => 'Empezamos?', 'start_time' => 0.5, 'end_time' => 1.2]]])),
]);
$said = (new KokoroEngine($http))->synthesize('¡Hola! ¿Empezamos?', ['voice' => 'ef_dora']);
same([$http->sent[1]['body']['input'] ?? null, $said->audio, count($said->words)], ['Hola! Empezamos?', mp3('b'), 2], 'a Spanish line Kokoro gives no timings for is asked again without ¡ and ¿, which it then times');
$http = new Recorded([new HttpResponse(400, json_encode(['detail' => ['error' => 'validation_error', 'message' => 'Voice not found: af_nobody']]))]);
throws(fn () => (new KokoroEngine($http))->synthesize('Hi', ['voice' => 'af_nobody']), SpeechError::class, 'Voice not found', 'a refusal says why');
$http = new Recorded([new RuntimeException('Could not resolve host: tts')]);
throws(fn () => (new KokoroEngine($http))->synthesize('Hi', []), SpeechError::class, 'docker compose up -d tts', 'a service that cannot be reached says how to start it');
$http = new Recorded([new HttpResponse(200, json_encode(['voices' => [['id' => 'af_heart', 'name' => 'af_heart'], ['id' => 'am_puck']]]))]);
same((new KokoroEngine($http))->voices(), ['af_heart', 'am_puck'], 'Kokoro lists its voices');

// ------------------------------------------------------------------ Chatterbox
$spoken = fn (string $audio = '', array $words = [], float $duration = 1.5) => new HttpResponse(200, json_encode(['audio' => base64_encode(mp3($audio)), 'format' => 'mp3', 'duration' => $duration, 'timestamps' => $words]));
$http = new Recorded([$spoken('a', [['word' => 'Fee,', 'start_time' => 0.1, 'end_time' => 0.4], ['word' => 'fi!', 'start_time' => 0.5, 'end_time' => 0.9]], 1.25)]);
$said = (new ChatterboxEngine($http, 'http://chatterbox:8004/'))->synthesize('Fee, fi!', ['clip' => 'giant', 'exaggeration' => 0.8, 'cfg_weight' => 0.35, 'speed' => 1.0], 'en-GB');
same($http->sent[0]['url'], 'http://chatterbox:8004/v1/speech', 'Chatterbox is asked for speech with word timings');
same($http->sent[0]['body'], ['input' => 'Fee, fi!', 'voice' => 'giant', 'language' => 'en-GB', 'exaggeration' => 0.8, 'cfg_weight' => 0.35, 'response_format' => 'mp3', 'return_timestamps' => true], 'in the clip, with the feeling the catalog gives, in the line\'s language (an even speed is not sent)');
same([$said->audio, array_column($said->words, 'w'), $said->duration], [mp3('a'), ['Fee,', 'fi!'], 1250], 'the audio is decoded, the words timed, and the length is the recording\'s');
$http = new Recorded([$spoken()]);
(new ChatterboxEngine($http))->synthesize('Hi', ['clip' => 'pixie', 'exaggeration' => 9, 'speed' => 3, 'volume' => 1.4, 'seed' => 7]);
same(array_intersect_key($http->sent[0]['body'], array_flip(['exaggeration', 'speed', 'volume', 'seed', 'language'])), ['language' => 'en', 'exaggeration' => 2.0, 'seed' => 7, 'speed' => 2.0, 'volume' => 1.4], 'values are kept within what it accepts');
$http = new Recorded([new HttpResponse(404, json_encode(['detail' => 'There is no voice clip called "giant" in /voices.']))]);
throws(fn () => (new ChatterboxEngine($http))->synthesize('Hi', ['clip' => 'giant']), SpeechError::class, 'no voice clip called "giant"', 'a missing clip, with nothing to make one, says so');
$made = [];
$http = new Recorded([new HttpResponse(404, json_encode(['detail' => 'There is no voice clip called "giant" in /voices.'])), new HttpResponse(200, json_encode(['voice' => 'giant', 'seconds' => 14.2])), $spoken('b')]);
$said = (new ChatterboxEngine($http))->withClips(function (string $clip) use (&$made) {
    $made[] = $clip;

    return mp3('clip');
})->synthesize('Hi', ['clip' => 'giant']);
same([$made, $http->sent[1]['method'], $http->sent[1]['url'], $http->sent[1]['body'], $http->sent[1]['headers'], $said->audio], [['giant'], 'PUT', 'http://chatterbox:8004/v1/voices/giant', mp3('clip'), ['Content-Type' => 'application/octet-stream'], mp3('b')], 'a missing clip is made, uploaded, and the line asked for again');
$http = new Recorded([new HttpResponse(503, json_encode(['detail' => 'The model is still loading (the first start downloads it).']))]);
throws(fn () => (new ChatterboxEngine($http))->synthesize('Hi', ['clip' => 'heart']), SpeechError::class, 'still loading', 'a container still downloading its model says so');
$http = new Recorded([new RuntimeException('Could not resolve host: chatterbox')]);
throws(fn () => (new ChatterboxEngine($http))->synthesize('Hi', []), SpeechError::class, 'COMPOSE_PROFILES=chatterbox', 'a service that cannot be reached says how to start it');
throws(fn () => (new ChatterboxEngine(new Recorded([])))->upload('../etc', 'x'), SpeechError::class, 'cannot be a clip', 'a clip name cannot be a path');
$http = new Recorded([new HttpResponse(200, json_encode(['voices' => ['giant', 'heart']]))]);
same((new ChatterboxEngine($http))->voices(), ['giant', 'heart'], 'Chatterbox lists its clips');

// The clips are the catalog's voices, recorded on Kokoro.
$source = new FakeEngine();
$audio = (new ChatterboxClips($catalog, $source))->make('hada-es');
same([$source->said[0][0], $source->said[0][1]], [$catalog->clipLine('es'), $catalog->get('hada-es')['engines']['kokoro']], 'a clip is the catalog\'s clip line in the voice\'s own language, in its Kokoro voice');
check(str_starts_with($audio, 'ID3'), 'and is the audio Kokoro gives');
check(mb_strlen($catalog->clipLine('en')) > 2.5 * mb_strlen($catalog->sample('en')), 'the clip line is long enough to clone a voice from');
foreach (['en', 'es', 'fr', 'it', 'pt', 'hi', 'ja', 'zh'] as $l) {
    check($catalog->clipLine($l) !== $catalog->clipLine($l === 'en' ? 'es' : 'en'), "there is a clip line in $l");
}
throws(fn () => (new ChatterboxClips($catalog, $source))->make('my-teacher'), SpeechError::class, '--file=', 'a clip that is not a catalog voice must be uploaded');
throws(fn () => (new ChatterboxClips($catalog, null))->make('heart'), SpeechError::class, 'CLIPS_FROM=none', 'with making clips switched off, it says how to upload one');
$source->down = true;
throws(fn () => (new ChatterboxClips($catalog, $source))->make('heart'), SpeechError::class, 'made with kokoro', 'a clip that cannot be made says which service failed');

$factory = new SpeechFactory(['driver' => 'chatterbox', 'voices' => $catalogPath, 'engines' => [
    'chatterbox' => ['class' => ChatterboxEngine::class, 'url' => 'http://chatterbox:8004', 'clips_from' => 'kokoro'],
    'kokoro' => ['class' => KokoroEngine::class, 'url' => 'http://tts:8880'],
]], $http = new Recorded([
    new HttpResponse(404, json_encode(['detail' => 'There is no voice clip called "captain" in /voices.'])),
    new HttpResponse(200, json_encode(['audio' => base64_encode(mp3('kokoro clip')), 'timestamps' => []])),
    new HttpResponse(200, json_encode(['voice' => 'captain', 'seconds' => 15.0])),
    $spoken('line', [['word' => 'Aye!', 'start_time' => 0.1, 'end_time' => 0.5]]),
]));
$line = $factory->voicer()->record('Aye!', 'captain');
same(array_column($http->sent, 'url'), ['http://chatterbox:8004/v1/speech', 'http://tts:8880/dev/captioned_speech', 'http://chatterbox:8004/v1/voices/captain', 'http://chatterbox:8004/v1/speech'], 'configured as chatterbox, a voice\'s first line makes its clip with Kokoro');
same([$http->sent[1]['body']['input'], $http->sent[2]['body'], $line['params']['speech']['engine'], $line['params']['speech']['voice']], [$catalog->clipLine('en'), mp3('kokoro clip'), 'chatterbox', 'captain'], 'and the line is kept as a chatterbox recording of the catalog voice');
check($factory->clips() instanceof ChatterboxClips, 'the factory gives what makes clips');
$noClips = new SpeechFactory(['driver' => 'chatterbox', 'voices' => $catalogPath, 'engines' => ['chatterbox' => ['class' => ChatterboxEngine::class, 'clips_from' => 'none']]], new Recorded([]));
throws(fn () => $noClips->clips()->make('heart'), SpeechError::class, 'CLIPS_FROM=none', 'clips_from none makes no clips');

// ------------------------------------------------------------------ another service: the same interface
$http = new Recorded([new HttpResponse(200, mp3(), ['content-type' => 'audio/mpeg'])]);
$openai = new OpenAiSpeechEngine($http, 'sk-test', 'gpt-4o-mini-tts', 'https://api.openai.com');
$said = $openai->synthesize('Hello there', ['voice' => 'coral', 'instructions' => 'Warm.']);
same([$http->sent[0]['url'], $http->sent[0]['body']['voice'], $http->sent[0]['body']['instructions'], $http->sent[0]['body']['model']], ['https://api.openai.com/v1/audio/speech', 'coral', 'Warm.', 'gpt-4o-mini-tts'], 'an OpenAI-style service is asked the same way');
same([$said->format, $said->words], ['mp3', []], 'and gives audio without timings (the game then paces the words evenly)');

// ------------------------------------------------------------------ the catalog
$all = $catalog->all();
check(count($all) >= 40, 'the catalog has a good many voices ('.count($all).')');
same(count($all), count(array_unique(array_keys($all))), 'every voice has its own key');
foreach ($all as $key => $v) {
    $cb = $v['engines']['chatterbox'] ?? null;
    check(is_array($cb) && ($cb['clip'] ?? null) === $key, "$key speaks on Chatterbox in its own clip");
    $feeling = (float) ($cb['exaggeration'] ?? 0.5);
    check(($v['flair'] ?? 0) >= 2 ? $feeling > 0.7 : $feeling <= 0.6, "$key has as much feeling on Chatterbox as its flair ($feeling)");
}
$kokoroVoices = ['af_alloy', 'af_aoede', 'af_bella', 'af_heart', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa',
    'bf_alice', 'bf_emma', 'bf_isabella', 'bf_lily', 'bm_daniel', 'bm_fable', 'bm_george', 'bm_lewis', 'ef_dora', 'em_alex', 'em_santa', 'ff_siwis', 'hf_alpha', 'hf_beta', 'hm_omega', 'hm_psi', 'if_sara', 'im_nicola', 'jf_alpha', 'jf_gongitsune', 'jf_nezumi', 'jf_tebukuro', 'jm_kumo',
    'pf_dora', 'pm_alex', 'pm_santa', 'zf_xiaobei', 'zf_xiaoni', 'zf_xiaoxiao', 'zf_xiaoyi', 'zm_yunjian', 'zm_yunxi', 'zm_yunxia', 'zm_yunyang'];
foreach ($all as $key => $v) {
    $spec = (string) ($v['engines']['kokoro']['voice'] ?? '');
    $parts = $spec === '' ? [] : array_column(KokoroEngine::parts($spec), 0);
    check($parts && ! array_diff($parts, $kokoroVoices) && KokoroEngine::blend($spec) !== '', "$key is made of Kokoro's own voices ($spec)");
    // A voice borrowed from another language must say which language to read in, or it reads English as Japanese.
    $reads = ['en' => ['a', 'b'], 'es' => ['e'], 'fr' => ['f'], 'it' => ['i'], 'pt' => ['p'], 'hi' => ['h'], 'ja' => ['j'], 'zh' => ['z']][VoiceCatalog::primary($v['lang'])];
    check(isset($v['engines']['kokoro']['lang']) ? in_array($v['engines']['kokoro']['lang'], $reads, true) : ! array_filter($parts, fn ($p) => ! in_array($p[0], $reads, true)), "$key reads in its own language ($spec)");
    check(in_array($v['flair'], [0, 1, 2], true), "$key says how much of a character it is");
    check(in_array($v['gender'], ['female', 'male', 'neutral'], true) && in_array($v['age'], ['child', 'young', 'adult', 'elder'], true) && $v['description'] !== '' && $v['traits'], "$key says who it is and how it sounds");
    check(isset($v['engines']['openai']['voice']), "$key also says what it is on an OpenAI-style service");
}
same(array_keys(array_filter($all, fn ($v) => $v['age'] === 'child')) !== [], true, 'there are voices for children');
$theatrical = $catalog->matching(['lang' => 'en', 'flair' => 2]);
check(count($theatrical) >= 20, 'there are plenty of theatrical English voices ('.count($theatrical).')');
foreach ([['female', 'child'], ['female', 'young'], ['female', 'adult'], ['female', 'elder'], ['male', 'child'], ['male', 'young'], ['male', 'adult'], ['male', 'elder'], ['neutral', 'adult']] as [$gender, $age]) {
    check((bool) $catalog->matching(['lang' => 'en', 'flair' => 2, 'gender' => $gender, 'age' => $age]), "there is a theatrical voice for a $gender $age");
}
same(count(array_unique(array_map(fn ($v) => json_encode($v['engines']['kokoro']), $theatrical))), count($theatrical), 'no two theatrical voices are the same voice');
check((bool) $catalog->matching(['lang' => 'es', 'flair' => 2]) && (bool) $catalog->matching(['lang' => 'pt', 'flair' => 2]), 'Spanish and Portuguese have theatrical voices too');
same([$catalog->get('heart')['flair'], $catalog->get('puck')['flair'], $catalog->get('giant')['flair']], [0, 1, 2], 'a voice is everyday, has character, or is theatrical');
same(array_filter($catalog->matching(['max_flair' => 0]), fn ($v) => $v['flair'] > 0), [], 'the everyday voices can be asked for alone');
same(array_values(array_unique(array_map(fn ($v) => VoiceCatalog::primary($v['lang']), $catalog->forLanguage('es')))), ['es'], 'a Spanish scenario is offered Spanish voices');
same(array_values($catalog->forLanguage('en-GB'))[0]['lang'], 'en-GB', 'a British one, British voices first');
same([$catalog->standIn('en-us'), $catalog->standIn('es'), $catalog->standIn('xx')], ['explorer', 'explorador', 'explorer'], 'the word said in the place of the player\'s name, by language');
$borrow = new VoiceCatalog(['voices' => [
    ['key' => 'a', 'gender' => 'female', 'age' => 'adult', 'lang' => 'en-US', 'engines' => ['kokoro' => ['voice' => 'af_heart'], 'acme' => ['voice' => 'Fiona']]],
    ['key' => 'b', 'gender' => 'male', 'age' => 'adult', 'lang' => 'en-US', 'engines' => ['kokoro' => ['voice' => 'am_michael'], 'acme' => ['voice' => 'Bruce']]],
    ['key' => 'c', 'gender' => 'male', 'age' => 'elder', 'lang' => 'en-GB', 'engines' => ['kokoro' => ['voice' => 'bm_george']]],
]]);
same($borrow->specFor('c', 'kokoro'), ['key' => 'c', 'spec' => ['voice' => 'bm_george'], 'borrowed' => false], 'a voice has what it is on each service');
same($borrow->specFor('c', 'acme'), ['key' => 'b', 'spec' => ['voice' => 'Bruce'], 'borrowed' => true], 'and on a service it says nothing for, borrows the nearest voice that has it');
same($borrow->specFor('c', 'nobody'), null, 'no voice on a service none of them has');
same(array_keys($borrow->matching([])), ['a', 'b', 'c'], 'with nothing asked, every voice fits');
same(array_keys($borrow->matching(['lang' => 'en'])), ['a', 'b', 'c'], '"en" is every kind of English');
same(array_keys($borrow->matching(['lang' => 'en_gb'])), ['c'], '"en-GB" only British');
same(array_keys($borrow->matching(['gender' => 'Male', 'age' => 'adult'])), ['b'], 'voices are picked by gender and age');
same(array_keys($borrow->matching(['engine' => 'acme'])), ['a', 'b'], 'and only those with a voice of their own on the service, when asked');
same(array_keys($catalog->matching(['traits' => ['robot', 'NO-SUCH']])) !== [], true, 'and by how they sound (any of the traits)');
same(array_keys($catalog->matching(['lang' => 'xx'])), [], 'no voice fits a language the catalog has none of');
same(VoiceCatalog::label($catalog->get('heart')), 'Heart: woman, American', 'a voice is labelled by who it sounds like');

// ------------------------------------------------------------------ choosing voices
$picker = new VoicePicker($catalog);
$picked = $picker->pick([
    'guide' => ['gender' => 'female', 'age' => 'adult', 'describe' => 'warm friendly clear guide'],
    'kid' => ['gender' => 'male', 'age' => 'child', 'describe' => 'excited'],
    'bot' => ['gender' => 'neutral', 'describe' => 'a small gardening robot, chirpy'],
    'elder' => ['gender' => 'male', 'age' => 'elder', 'accent' => 'British', 'describe' => 'wise professor'],
    'twin1' => ['gender' => 'female', 'age' => 'young'],
    'twin2' => ['gender' => 'female', 'age' => 'young'],
]);
same(count($picked), 6, 'every character gets a voice');
same(count(array_unique($picked)), 6, 'each a different one');
same($catalog->get($picked['kid'])['age'].'/'.$catalog->get($picked['kid'])['gender'], 'child/male', 'a boy sounds like a boy');
same($catalog->get($picked['bot'])['gender'], 'neutral', 'a robot like a robot');
same([$catalog->get($picked['elder'])['age'], $catalog->get($picked['elder'])['accent']], ['elder', 'British'], 'an old British professor like one');
same($catalog->get($picked['guide'])['gender'], 'female', 'the guide as she is described');
same($picker->pick(['x' => ['gender' => 'female']], 'en', [$picked['guide']])['x'] !== $picked['guide'], true, 'a voice already taken is passed over while others fit');
same($catalog->get($picker->pick(['x' => ['gender' => 'male']], 'es')['x'])['lang'], 'es', 'a Spanish character gets a Spanish voice');
$many = $picker->pick(array_fill_keys(range(1, 60), ['gender' => 'female']));
same(count($many), 60, 'more characters than voices still all get one (shared)');
// Larger than life: theatrical voices first, wherever nothing says otherwise.
$cast = $picker->pick([
    'troll' => ['gender' => 'male', 'age' => 'adult', 'describe' => 'a grumpy troll who guards the bridge, booming and slow'],
    'fairy' => ['gender' => 'female', 'age' => 'child', 'describe' => 'tiny squeaky pixie'],
    'mage' => ['gender' => 'male', 'age' => 'elder', 'accent' => 'British', 'describe' => 'an ancient wizard, grand and mysterious'],
    'ruler' => ['gender' => 'female', 'age' => 'adult', 'describe' => 'the haughty queen of the hive, regal'],
    'tinkerer' => ['gender' => 'male', 'age' => 'adult', 'describe' => 'a zany inventor, excitable'],
    'someone' => ['gender' => 'male', 'age' => 'adult'],
    'guide' => ['gender' => 'female', 'age' => 'adult', 'describe' => 'Ranger Ada, practical. warm friendly clear guide'],
]);
same([$cast['troll'], $cast['fairy'], $cast['mage'], $cast['ruler'], $cast['tinkerer']], ['giant', 'pixie', 'wizard', 'queen', 'boffin'], 'characters are cast in the theatrical voices that fit them');
same($catalog->get($cast['someone'])['flair'], 2, 'a character nothing is said of gets a theatrical voice');
same($catalog->get($cast['guide'])['flair'], 0, 'but a guide described as warm, friendly and clear keeps a clear, everyday voice');
$plain = (new VoicePicker($catalog, 0))->pick(['someone' => ['gender' => 'male', 'age' => 'adult'], 'kid' => ['gender' => 'female', 'age' => 'child']]);
same([$catalog->get($plain['someone'])['flair'], $plain['kid']], [0, 'pip'], 'with no taste for flair (QL_TTS_FLAIR=0), voices are chosen by fit alone, as before');
same((new SpeechFactory(['voices' => $catalogPath, 'flair' => 0]))->picker()->pick(['x' => ['gender' => 'male', 'age' => 'adult']]), ['x' => $plain['someone']], 'the setting reaches the picker');
check($catalog->get($picker->pick(['x' => ['gender' => 'male', 'describe' => 'gigante']], 'es')['x'])['key'] === 'gigante-es', 'a Spanish giant gets the Spanish giant\'s voice');

// ------------------------------------------------------------------ recording a line
$cache = sys_get_temp_dir().'/qbl-speech-test-'.bin2hex(random_bytes(4));
$engine = new FakeEngine;
$voicer = new Voicer($engine, $catalog, $cache);
same($voicer->script('Welcome aboard, {{QL_PlayerName}}! <b>Ready?</b> &amp; go'), 'Welcome aboard, explorer! Ready? & go', 'the player\'s name is said as "explorer", and markup is not said');
same($voicer->script('Hola, {{ QL_PlayerName }}.', 'es'), 'Hola, explorador.', 'in the scenario\'s language');
same($voicer->script('Ready, {{QL_PlayerName}}?'), 'Ready, explorer?', '{{QL_PlayerName}} is said the same way');
same($voicer->script('Ready, {{QBLPlayerName}}?'), 'Ready, explorer?', 'and so is its old name');
same($voicer->script('Ask {{QL_TeacherName}}.'), null, 'any other system variable is only known in play');
same($voicer->script('You have {{score}} points.'), null, 'a line with another placeholder cannot be recorded ahead of play');
same($voicer->script('…'), null, 'nor one with nothing to say');
$line = $voicer->record('Hi there, {{QL_PlayerName}}!', 'pip');
same($engine->said[0], ['Hi there, explorer!', ['voice' => 'af_sky(1)+af_bella(1)', 'speed' => 1.12]], 'a line is recorded in the voice the catalog says, on the service in use');
same(array_keys($line['params']['speech']), ['text', 'line', 'voice', 'engine', 'words', 'duration'], 'it keeps what was said, the line it was recorded from, by whom, on which service, and when each word is');
same($line['params']['speech']['line'], 'Hi there, {{QL_PlayerName}}!', 'the line as it was written');
same([$line['params']['speech']['voice'], $line['params']['speech']['engine'], $line['params']['speech']['words'][2]], ['pip', 'kokoro', ['w' => 'explorer!', 's' => 600, 'e' => 850]], 'with the catalog\'s voice key, not the service\'s');
$again = $voicer->record('Hi there, {{QL_PlayerName}}!', 'pip');
same([count($engine->said), $again['speech']->audio], [1, $line['speech']->audio], 'the same line in the same voice comes from the cache');
$voicer->record('Hi there, {{QL_PlayerName}}!', 'heart');
same(count($engine->said), 2, 'another voice is recorded afresh');
same(strlen($voicer->sample('heart')->audio) > 0 && str_contains($engine->said[2][0], 'explorer'), true, 'a voice can be heard saying a sample line');

// ------------------------------------------------------------------ a scenario in the editor
$pdo = new PDO('sqlite::memory:');
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$mediaDir = sys_get_temp_dir().'/qbl-speech-media-'.bin2hex(random_bytes(4));
$store = new ScenarioStore($pdo, $mediaDir, '/media');
$scenario = $store->createScenario(['title' => 'Voices'], null);
$sid = (int) $scenario['id'];
$scene = (int) $store->bundle($sid)['scenes'][0]['id'];
$ada = $store->createRow($sid, 'characters', ['name' => 'Ada', 'settings' => ['tts_voice' => 'heart']]);
$bolt = $store->createRow($sid, 'characters', ['name' => 'Bolt', 'settings' => ['scale' => 0.5]]);
$event = $store->createRow($sid, 'events', ['scene_id' => $scene, 'kind' => 'hotspot', 'shortname' => 'talk']);
$say = fn (array $c, string $text, array $extra = []) => $store->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'dialogue', 'params' => ['style' => 'portrait', 'text' => $text, 'speaker' => 'character', 'character_id' => $c['id']] + $extra]);
$a1 = $say($ada, 'Welcome, {{QL_PlayerName}}! The reactor needs you.');
$a2 = $say($ada, 'You have {{score}} points.');
$a3 = $say($bolt, 'Beep boop.');
$a4 = $say($ada, 'I said nothing.', ['narrate' => false]);
$upload = $store->addMediaFile($sid, (function () {
    $f = tempnam(sys_get_temp_dir(), 'up');
    file_put_contents($f, mp3('mine'));

    return $f;
})(), 'my-voice.mp3');
$a5 = $say($ada, 'My own recording.', ['narration_media_id' => $upload['id']]);
$player = $store->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'dialogue', 'params' => ['style' => 'bubble', 'text' => 'I am the player.']]);

$engine = new FakeEngine;
$scenarioVoicer = new ScenarioVoicer($store, new Voicer($engine, $catalog, null));
$dry = $scenarioVoicer->record($sid, ['dry' => true]);
same([$dry['lines'], $dry['remaining'], $dry['recorded'], count($engine->said)], [1, 1, 0, 0], 'a dry run counts the lines to record and records nothing');
$result = $scenarioVoicer->record($sid);
same([$result['lines'], $result['recorded'], $result['kept'], $result['removed'], $result['remaining']], [1, 1, 0, 0, 0], 'only the line a character with a voice says, that can be recorded, is recorded');
same(array_column($result['skipped'], 'action_id'), [$a2['id'], $a5['id']], 'the line with a placeholder and the one with an uploaded recording are left alone, and said why');
$rows = $store->bundle($sid);
$actions = array_column($rows['actions'], null, 'id');
$recording = array_values(array_filter($rows['media'], fn ($m) => ($m['params']['speech']['engine'] ?? null) === 'kokoro'))[0] ?? null;
same([$recording['type'] ?? null, $recording['params']['speech']['text'] ?? null, $recording['params']['speech']['voice'] ?? null], ['audio', 'Welcome, explorer! The reactor needs you.', 'heart'], 'the recording is an audio media with what it says, in which voice');
check(is_file($mediaDir.'/'.$recording['filepath']) && str_starts_with((string) file_get_contents($mediaDir.'/'.$recording['filepath']), 'ID3'), 'stored with the scenario\'s uploads');
same([$actions[$a1['id']]['params']['narration_media_id'] ?? null, $actions[$a1['id']]['params']['narrate'] ?? null, $actions[$a1['id']]['params']['text']], [$recording['id'], true, 'Welcome, {{QL_PlayerName}}! The reactor needs you.'], 'the line plays it, and is read aloud');
same([isset($actions[$a3['id']]['params']['narration_media_id']), $actions[$a4['id']]['params']['narrate'], $actions[$a5['id']]['params']['narration_media_id'], isset($actions[$player['id']]['params']['narration_media_id'])], [false, false, $upload['id'], false], 'nothing else changed');

$doc = ScenarioCompiler::compile($store->rows($sid));
$asset = array_values(array_filter($doc['assets'], fn ($m) => $m['id'] === $recording['id']))[0];
same([$asset['type'], $asset['speech']['words'][1]['w'] ?? null, isset($asset['params']['speech'])], ['audio', 'explorer!', false], 'the game gets the word timings on the recording');
same(ScenarioDecompiler::rows($doc)['media'][array_search($recording['id'], array_column(ScenarioDecompiler::rows($doc)['media'], 'id'), true)]['params']['speech']['voice'], 'heart', 'and they survive the way back from a document (copies, imports)');

$again = $scenarioVoicer->record($sid);
same([$again['recorded'], $again['kept'], count($engine->said)], [0, 1, 1], 'recording again keeps what is up to date');
$store->updateRow($sid, 'actions', $a1['id'], ['params' => ['text' => 'Welcome back, {{QL_PlayerName}}!'] + $actions[$a1['id']]['params']]);
$changed = $scenarioVoicer->record($sid);
$rows = $store->bundle($sid);
$now = array_column($rows['actions'], null, 'id')[$a1['id']]['params']['narration_media_id'];
same([$changed['recorded'], $now !== $recording['id'], in_array($recording['id'], array_column($rows['media'], 'id'), true), is_file($mediaDir.'/'.$recording['filepath'])], [1, true, false, false], 'a changed line is recorded again and the old recording deleted');
$store->updateRow($sid, 'characters', $bolt['id'], ['settings' => ['scale' => 0.5, 'tts_voice' => 'robot']]);
$forced = $scenarioVoicer->record($sid, ['limit' => 1, 'force' => true]);
same([$forced['recorded'], $forced['remaining']], [1, 1], 'a limit records a few and says how many remain (the editor calls again)');
$scenarioVoicer->record($sid, ['limit' => 1, 'force' => false]);
same($engine->said[array_key_last($engine->said)], ['Beep boop.', ['voice' => 'af_alloy(1)+am_echo(1)', 'speed' => 0.95]], 'a character given a voice gets its lines recorded in it');
$store->updateRow($sid, 'characters', $ada['id'], ['settings' => []]);
$removed = $scenarioVoicer->record($sid);
$rows = $store->bundle($sid);
same([$removed['removed'], isset(array_column($rows['actions'], null, 'id')[$a1['id']]['params']['narration_media_id']), in_array($upload['id'], array_column($rows['media'], 'id'), true)], [1, false, true], 'a character whose voice is taken away loses its recordings, but not ones someone uploaded');

$given = $scenarioVoicer->assign($sid);
same(array_keys($given), [$ada['id']], 'giving voices fills in only characters without one');
check($given[$ada['id']] !== 'robot', 'with a voice no other character has');
same(array_column($store->bundle($sid)['characters'], null, 'id')[$bolt['id']]['settings'], ['scale' => 0.5, 'tts_voice' => 'robot'], 'and leaves the others as they were');

$engine->down = true;
$store->updateRow($sid, 'actions', $a1['id'], ['params' => ['text' => 'Something new.'] + array_column($store->bundle($sid)['actions'], null, 'id')[$a1['id']]['params']]);
throws(fn () => $scenarioVoicer->record($sid), SpeechError::class, 'cannot be reached', 'a service that is down is reported, not hidden');
$engine->down = false;

// One recording at a time per scenario: a request the proxy gave up on may still be recording.
$held = fopen(sys_get_temp_dir()."/qbl-voices-$sid.lock", 'c');
flock($held, LOCK_EX);
$said = count($engine->said);
$busy = $scenarioVoicer->record($sid, ['limit' => 4, 'wait' => false]);
same([$busy['busy'], $busy['recorded'], $busy['remaining'], count($engine->said)], [true, 0, 1, $said], 'while another call records the scenario, the editor is told so (with what is left) and nothing is recorded twice');
flock($held, LOCK_UN);
fclose($held);
$free = $scenarioVoicer->record($sid, ['limit' => 4, 'wait' => false]);
same([$free['busy'], $free['recorded'], $free['remaining']], [false, 1, 0], 'and once it is done, recording carries on');
$store->updateRow($sid, 'actions', $a1['id'], ['params' => ['text' => 'Something newer.'] + array_column($store->bundle($sid)['actions'], null, 'id')[$a1['id']]['params']]);

// ------------------------------------------------------------------ a conversation's lines
$talk = $store->createScenario(['title' => 'Talk'], null);
$tid = (int) $talk['id'];
$tscene = (int) $store->bundle($tid)['scenes'][0]['id'];
$vega = $store->createRow($tid, 'characters', ['name' => 'Vega', 'settings' => ['tts_voice' => 'captain']]);
$pip = $store->createRow($tid, 'characters', ['name' => 'Pip']);
$tevent = $store->createRow($tid, 'events', ['scene_id' => $tscene, 'kind' => 'hotspot', 'shortname' => 'talk']);
$conversation = $store->createRow($tid, 'actions', ['event_id' => $tevent['id'], 'type' => 'conversation', 'params' => ['style' => 'portrait', 'lines' => [
    ['id' => 'a', 'speaker' => 'character', 'character_id' => $vega['id'], 'text' => 'Ready, {{QL_PlayerName}}?', 'choices' => [['text' => 'Yes!', 'next' => 'b'], ['text' => 'Not yet', 'next' => 'c']]],
    ['id' => 'b', 'speaker' => 'player', 'text' => 'Let us go.', 'next' => 'd'],
    ['id' => 'c', 'speaker' => 'character', 'character_id' => $pip['id'], 'text' => 'Beep. Take your time.'],
    ['id' => 'd', 'speaker' => 'character', 'character_id' => $vega['id'], 'text' => 'Then follow me.'],
]]]);
$engine = new FakeEngine;
$talker = new ScenarioVoicer($store, new Voicer($engine, $catalog, null));
$r = $talker->record($tid);
$after = array_column($store->bundle($tid)['actions'], null, 'id')[$conversation['id']]['params'];
same([$r['lines'], $r['recorded']], [2, 2], 'a conversation\'s lines said by a character with a voice are recorded, each');
same([isset($after['lines'][0]['narration_media_id']), isset($after['lines'][1]['narration_media_id']), isset($after['lines'][2]['narration_media_id']), isset($after['lines'][3]['narration_media_id']), $after['narrate']], [true, false, false, true, true], 'the player\'s line and a character without a voice are left to the browser; the conversation is read aloud');
same([$after['lines'][0]['choices'][1]['next'], $after['lines'][2]['text'], $after['style']], ['c', 'Beep. Take your time.', 'portrait'], 'and nothing else about it changes');
$doc = ScenarioCompiler::compile($store->rows($tid));
$first = array_values(array_filter($doc['assets'], fn ($m) => $m['id'] === $after['lines'][0]['narration_media_id']))[0];
same([$first['speech']['text'], $first['speech']['line']], ['Ready, explorer?', 'Ready, {{QL_PlayerName}}?'], 'the game gets each line\'s timings');
$after['lines'][3]['text'] = 'Then follow me, quickly.';
$store->updateRow($tid, 'actions', $conversation['id'], ['params' => $after]);
$store->updateRow($tid, 'characters', $pip['id'], ['settings' => ['tts_voice' => 'sprite']]);
$r = $talker->record($tid);
$again = array_column($store->bundle($tid)['actions'], null, 'id')[$conversation['id']]['params'];
same([$r['recorded'], $r['kept'], $again['lines'][0]['narration_media_id'], $again['lines'][3]['narration_media_id'] !== $after['lines'][3]['narration_media_id'], isset($again['lines'][2]['narration_media_id'])], [2, 1, $after['lines'][0]['narration_media_id'], true, true], 'a changed line and a newly voiced one are recorded; the rest are kept');
check(! in_array($after['lines'][3]['narration_media_id'], array_column($store->bundle($tid)['media'], 'id'), true), 'the old recording of the changed line is deleted');
$store->updateRow($tid, 'characters', $vega['id'], ['settings' => []]);
$r = $talker->record($tid);
$gone = array_column($store->bundle($tid)['actions'], null, 'id')[$conversation['id']]['params'];
same([$r['removed'], isset($gone['lines'][0]['narration_media_id']), isset($gone['lines'][3]['narration_media_id']), isset($gone['lines'][2]['narration_media_id'])], [2, false, false, true], 'a character that loses its voice loses its lines\' recordings, and only theirs');
$builtTalk = ['rows' => ['scenario' => ['id' => 1], 'media' => [], 'characters' => [['id' => 1, 'name' => 'Vega', 'settings' => ['tts_voice' => 'captain']]], 'actions' => [
    ['id' => 1, 'type' => 'conversation', 'params' => ['lines' => [['id' => 'a', 'speaker' => 'character', 'character_id' => 1, 'text' => 'Hi.'], ['id' => 'b', 'text' => 'Hello.']]]],
]], 'files' => []];
$voicedTalk = (new Voicer(new FakeEngine, $catalog))->voiceBuilt($builtTalk, sys_get_temp_dir().'/qbl-speech-talk-'.bin2hex(random_bytes(3)), 'en');
same([$voicedTalk['recorded'], $voicedTalk['built']['rows']['actions'][0]['params']['lines'][0]['narration_media_id'] ?? null, isset($voicedTalk['built']['rows']['actions'][0]['params']['lines'][1]['narration_media_id'])], [1, 1, false], 'a conversation in a scenario being built is voiced the same way');

// ------------------------------------------------------------------ the editor's routes
$factory = new SpeechFactory(['voices' => $catalogPath, 'cache_dir' => null], null, $engine);
$api = new EditorApi($store, speech: $factory);
$teacher = ['id' => 1, 'name' => 'T', 'role' => 'admin'];
[$status, $body] = $api->handle('GET', "scenarios/$sid/voices", [], $teacher);
same([$status, $body['engine'], $body['lines']['to_record'] ?? null], [200, 'kokoro', 1], 'the editor gets the voices and how many lines are left to record');
same(array_keys($body['voices'][0]), ['key', 'name', 'gender', 'age', 'lang', 'accent', 'traits', 'description', 'flair', 'label'], 'each voice as a person picking one needs it, without the services\' details');
[$status, $body] = $api->handle('POST', "scenarios/$sid/voices/record", ['limit' => 5], $teacher);
same([$status, $body['recorded'], $body['remaining']], [200, 1, 0], 'and records them');
[$status, $body] = $api->handle('GET', "scenarios/$sid/voices/heart/sample", [], $teacher);
same([$status, $body['download']['type'], $body['download']['inline'], str_starts_with((string) file_get_contents($body['download']['path']), 'ID3')], [200, 'audio/mpeg', true, true], 'a sample is sent as audio to play');
@unlink($body['download']['path']);
[$status] = $api->handle('GET', "scenarios/$sid/voices/nobody/sample", [], $teacher);
same($status, 404, 'an unknown voice is not found');
[$status, $body] = (new EditorApi($store, speech: new SpeechFactory(['driver' => 'none', 'voices' => $catalogPath])))->handle('POST', "scenarios/$sid/voices/record", [], $teacher);
same([$status, str_contains($body['message'], 'switched off')], [503, true], 'with recording switched off the editor is told so');
[$status, $body] = (new EditorApi($store, speech: new SpeechFactory(['driver' => 'none', 'voices' => $catalogPath])))->handle('GET', "scenarios/$sid/voices", [], $teacher);
same([$status, $body['engine'], count($body['voices']) > 10], [200, null, true], 'but can still list the voices');
[$status] = (new EditorApi($store))->handle('GET', "scenarios/$sid/voices", [], $teacher);
same($status, 503, 'a server without voices set up says so');
[$status] = $api->handle('GET', "scenarios/$sid/voices", [], ['id' => 2, 'name' => 'S', 'role' => 'student']);
same($status, 403, 'students cannot use them');

// ------------------------------------------------------------------ the factory
$factory = new SpeechFactory(['driver' => 'kokoro', 'engines' => ['kokoro' => ['class' => KokoroEngine::class, 'url' => 'http://tts:8880']], 'voices' => $catalogPath], new Recorded([]));
same($factory->engine()->name(), 'kokoro', 'the configured service is used');
same((new SpeechFactory(['driver' => 'none']))->voicer(), null, 'none switches recording off');
throws(fn () => (new SpeechFactory(['driver' => 'acme', 'engines' => ['kokoro' => ['class' => KokoroEngine::class]]]))->engine(), SpeechError::class, 'there are: kokoro', 'an unknown service is named, with the ones there are');

// ------------------------------------------------------------------ a scenario being built (the generator)
$work = sys_get_temp_dir().'/qbl-speech-built-'.bin2hex(random_bytes(4));
$built = ['rows' => [
    'scenario' => ['id' => 1, 'title' => 'T', 'default_language' => 'en-us'],
    'media' => [['id' => 1, 'type' => 'image', 'filename' => 'a.png', 'url' => 'assets/a.png']],
    'characters' => [['id' => 1, 'name' => 'Keeper Ama', 'settings' => ['tts_voice' => 'heart']], ['id' => 2, 'name' => 'Pip', 'settings' => []]],
    'actions' => [
        ['id' => 1, 'type' => 'dialogue', 'params' => ['text' => 'Hello, {{QL_PlayerName}}!', 'speaker' => 'character', 'character_id' => 1]],
        ['id' => 2, 'type' => 'dialogue', 'params' => ['text' => 'Hello, {{QL_PlayerName}}!', 'speaker' => 'character', 'character_id' => 1]],
        ['id' => 3, 'type' => 'dialogue', 'params' => ['text' => 'Beep.', 'speaker' => 'character', 'character_id' => 2]],
        ['id' => 4, 'type' => 'dialogue', 'params' => ['text' => 'Score: {{score}}', 'speaker' => 'character', 'character_id' => 1]],
    ],
], 'files' => ['a.png' => '/x/a.png']];
$engine = new FakeEngine;
$voiced = (new Voicer($engine, $catalog))->voiceBuilt($built, $work, 'en');
$rows = $voiced['built']['rows'];
same([$voiced['recorded'], $voiced['skipped'], count($engine->said)], [1, 1, 1], 'a line said twice is recorded once; one with a placeholder is left');
same([$rows['media'][1]['id'], $rows['media'][1]['type'], $rows['media'][1]['url']], [2, 'audio', 'assets/voice-keeper-ama-1.mp3'], 'the recording is a new media row with its file among the assets');
same($voiced['built']['files']['voice-keeper-ama-1.mp3'], "$work/voice-keeper-ama-1.mp3", 'packaged with the pictures');
same([$rows['actions'][0]['params']['narration_media_id'], $rows['actions'][1]['params']['narration_media_id'], $rows['actions'][0]['params']['narrate']], [2, 2, true], 'both lines play it');
same([isset($rows['actions'][2]['params']['narration_media_id']), isset($rows['actions'][3]['params']['narration_media_id'])], [false, false], 'a character without a voice and a line with a placeholder are read by the browser');
$engine->down = true;
$voiced = (new Voicer($engine, $catalog))->voiceBuilt($built, $work, 'en');
same([$voiced['recorded'], count($voiced['warnings']), str_contains($voiced['warnings'][0], 'qbl:voice')], [0, 1, true], 'a service that is down does not stop a mission being made: it is a warning, with what to do later');

// ------------------------------------------------------------------ the narrator
same($catalog->narrator('en-us'), 'storyteller', 'English scenarios are narrated by the storyteller');
check(array_intersect(['dramatic', 'charismatic', 'storyteller'], $catalog->get('storyteller')['traits']) === ['dramatic', 'charismatic', 'storyteller'], 'who is dramatic and charismatic');
same([$catalog->narrator('es'), $catalog->narrator('fr-FR'), $catalog->narrator('ja')], ['alex-es', 'siwis', 'kumo'], 'other languages have a narrator of their own');
same($catalog->narrator('xx'), null, 'a language with none leaves the narration to the browser');
$override = VoiceCatalog::load($catalogPath, 'captain');
same([$override->narrator('en'), $override->narrator('es')], ['captain', 'alex-es'], 'QL_TTS_NARRATOR changes the narrator for scenarios in its language only');
same(VoiceCatalog::load($catalogPath, 'nobody')->narrator('en'), 'storyteller', 'and a voice the catalog does not have is ignored');
same([$catalog->narratorFor([], 'en'), $catalog->narratorFor(['narrator_voice' => 'onyx'], 'en'), $catalog->narratorFor(['narrator_voice' => 'none'], 'en')], ['storyteller', 'onyx', null], 'a scenario may choose its own narrator, or none');

// A story's narrator is chosen by fit, not flair (they read every caption); the characters still get theatrical voices.
$story = fn (array $narrator) => ['format' => 'story', 'language' => 'en', 'narrator' => ['voice' => $narrator], 'characters' => [
    ['key' => 'ogre', 'voice' => ['gender' => 'male', 'age' => 'adult', 'sound' => 'booming deep giant ogre']],
]];
$flairy = new VoicePicker($catalog, 3);
$told = \App\Qbl\Generation\ScenarioGenerator::voicesFor($story([]), $flairy);
same($told['__narrator'], 'storyteller', 'a story with no wishes for its narrator gets the storyteller');
$told = \App\Qbl\Generation\ScenarioGenerator::voicesFor($story(['gender' => 'female', 'accent' => 'American', 'sound' => 'gentle warm']), $flairy);
check((int) ($catalog->get($told['__narrator'])['flair'] ?? 0) < 2, 'a gentle female narrator is not handed a theatrical voice (got '.$told['__narrator'].')');
check((int) ($catalog->get($told['ogre'])['flair'] ?? 0) === 2 && $told['ogre'] !== $told['__narrator'], 'while the ogre still gets a theatrical voice of its own (got '.$told['ogre'].')');

same(Voicer::infoboxWords('<h2>The&nbsp;Water Cycle</h2><p>Water <b>goes</b> round.</p><ul><li>Rain</li><li>Snow</li></ul>'), 'The Water Cycle Water goes round. Rain Snow', 'an infobox is read as the player sees it, a word at each break');
same(Voicer::infoboxWords('<p>One</p><hr data-qbl="page"><p>Two</p>'), null, 'but not a box of pages, each read on its own');
same(Voicer::infoboxWords('<div data-qbl="flip"><p>Front</p><p data-unread>Back</p></div>'), null, 'nor one whose words depend on play');

$told = $store->createScenario(['title' => 'Told'], null);
$tid = (int) $told['id'];
$tscene = (int) $store->bundle($tid)['scenes'][0]['id'];
$tevent = $store->createRow($tid, 'events', ['scene_id' => $tscene, 'kind' => 'start']);
$act = fn (string $type, array $p) => $store->createRow($tid, 'actions', ['event_id' => $tevent['id'], 'type' => $type, 'params' => $p]);
$n1 = $act('narration', ['text' => 'Long ago, {{QL_PlayerName}}, there was a valley.']);
$n2 = $act('narration', ['text' => 'Quietly.', 'narrate' => false]);
$t1 = $act('text_overlay', ['text' => 'Chapter One', 'narrate' => true]);
$t2 = $act('text_overlay', ['text' => 'Not read aloud.']);
$i1 = $act('infobox', ['content' => '<p>Rivers run <i>downhill</i>.</p>', 'narrate' => true]);
$guide = $store->createRow($tid, 'characters', ['name' => 'Guide', 'settings' => []]);
$act('dialogue', ['speaker' => 'character', 'character_id' => $guide['id'], 'text' => 'Hello!']);
$narrated = fn () => array_values(array_filter(Voicer::lines($store->bundle($tid), $catalog), fn ($l) => $l['character_id'] === 0));
same(array_map(fn ($l) => [$l['action_id'], $l['voice'], $l['text']], $narrated()), [
    [$n1['id'], 'storyteller', 'Long ago, {{QL_PlayerName}}, there was a valley.'],
    [$t1['id'], 'storyteller', 'Chapter One'],
    [$i1['id'], 'storyteller', 'Rivers run downhill.'],
], 'what no character says is the default narrator\'s: narrations, and text overlays and infoboxes read aloud');
check(! in_array($n2['id'], array_column($narrated(), 'action_id'), true) && ! in_array($t2['id'], array_column($narrated(), 'action_id'), true), 'what is not read aloud is not the narrator\'s to record: a narration marked so, a text overlay not marked');
same(count(array_filter(Voicer::lines($store->bundle($tid)), fn ($l) => $l['voice'] !== null && $l['character_id'] === 0)), 0, 'with no catalog to ask, there is no default narrator');

$engine = new FakeEngine;
$tellers = new ScenarioVoicer($store, new Voicer($engine, $catalog, null));
$r = $tellers->record($tid);
same([$r['recorded'], $r['lines']], [3, 3], 'Record voices records the narrator\'s lines (and not the one marked not to be read)');
same($engine->said[0], ['Long ago, explorer, there was a valley.', $catalog->get('storyteller')['engines']['kokoro']], 'in the storyteller\'s voice');
$after = array_column($store->bundle($tid)['actions'], null, 'id');
same([isset($after[$n1['id']]['params']['narration_media_id']), isset($after[$n2['id']]['params']['narration_media_id']), isset($after[$t2['id']]['params']['narration_media_id'])], [true, false, false], 'each plays its recording');
$store->updateScenario($tid, ['settings' => ['narrator_voice' => 'onyx'] + (array) ($store->scenario($tid)['settings'] ?? [])]);
$r = $tellers->record($tid);
same([$r['recorded'], $r['kept'], $engine->said[3][1]], [3, 0, $catalog->get('onyx')['engines']['kokoro']], 'a new narrator records them all again, in the new voice');
$store->updateScenario($tid, ['settings' => ['narrator_voice' => 'none'] + (array) ($store->scenario($tid)['settings'] ?? [])]);
$r = $tellers->record($tid);
$after = array_column($store->bundle($tid)['actions'], null, 'id');
same([$r['removed'], isset($after[$n1['id']]['params']['narration_media_id'])], [3, false], 'no narrator: the recordings go, and the browser reads the narration');
$store->updateScenario($tid, ['settings' => array_diff_key((array) ($store->scenario($tid)['settings'] ?? []), ['narrator_voice' => 1])]);
$given = $tellers->assign($tid);
check(($given[$guide['id']] ?? null) !== null && $given[$guide['id']] !== 'storyteller', 'giving characters voices leaves the narrator\'s voice to the narrator');

// ------------------------------------------------------------------ a real Kokoro, when there is one
if ($url = getenv('KOKORO_URL')) {
    $live = KokoroEngine::fromConfig(['url' => $url]);
    $voices = $live->voices();
    foreach ($all as $key => $v) {
        foreach (array_column(KokoroEngine::parts((string) $v['engines']['kokoro']['voice']), 0) as $part) {
            check(in_array($part, $voices, true), "Kokoro has $part ($key)");
        }
    }
    $real = (new Voicer($live, $catalog))->record('Welcome aboard, {{QL_PlayerName}}! The reactor is at 42 percent, and Dr. Ruiz needs help.', 'captain');
    $words = array_column($real['params']['speech']['words'], 'w');
    check(str_starts_with($real['speech']->audio, 'ID3') || str_starts_with(bin2hex(substr($real['speech']->audio, 0, 2)), 'fff'), 'Kokoro records an MP3');
    check(in_array('explorer', $words, true) && ! in_array(',', $words, true), 'with timed words and no punctuation ('.implode(' ', $words).')');
    $times = array_column($real['params']['speech']['words'], 's');
    check($times === array_values(array_unique($times)) && $times == array_values(array_filter($times, fn ($t) => $t >= 0)) && $times === (function ($t) {
        sort($t);

        return $t;
    })($times), 'in order');
    echo 'Live Kokoro: '.count($words).' words in '.round($real['params']['speech']['duration'] / 1000, 1)." s\n";
}

// ------------------------------------------------------------------ a real Chatterbox, when there is one
if ($url = getenv('CHATTERBOX_URL')) {
    $factory = new SpeechFactory(['driver' => 'chatterbox', 'voices' => $catalogPath, 'engines' => [
        'chatterbox' => ['class' => ChatterboxEngine::class, 'url' => $url, 'clips_from' => getenv('KOKORO_URL') ? 'kokoro' : 'none'],
        'kokoro' => ['class' => KokoroEngine::class, 'url' => getenv('KOKORO_URL') ?: 'http://tts:8880'],
    ]]);
    $live = $factory->engine();
    // CHATTERBOX_REMAKE_CLIPS=1: make the three clips again with Kokoro (needs KOKORO_URL).
    foreach (getenv('CHATTERBOX_REMAKE_CLIPS') ? array_intersect(['heart', 'giant', 'hada-es'], $live->voices()) : [] as $old) {
        (new App\Qbl\Generation\Http\CurlHttpClient(0))->send('DELETE', rtrim($url, '/')."/v1/voices/$old");
    }
    foreach ([['heart', 'en-US', 'Welcome aboard, {{QL_PlayerName}}! The reactor is at 42 percent, and Dr. Ruiz needs help.'], ['giant', 'en-GB', 'Fee, fi, fo, fum! Who dares to climb my beanstalk?'], ['hada-es', 'es', '¡Hola, explorador! ¿Quieres ver cómo brillan las estrellas?']] as [$key, $lang, $text]) {
        $started = microtime(true);
        $real = (new Voicer($live, $catalog))->record($text, $key, $lang);
        $words = array_column($real['params']['speech']['words'], 'w');
        check(str_starts_with($real['speech']->audio, 'ID3') || str_starts_with(bin2hex(substr($real['speech']->audio, 0, 2)), 'fff'), "Chatterbox records an MP3 ($key)");
        check(count($words) >= count(preg_split('/\s+/', $real['script'])) - 2, "with timed words ($key: ".implode(' ', $words).')');
        $times = array_column($real['params']['speech']['words'], 's');
        $sorted = $times;
        sort($sorted);
        check($times === $sorted, "in order ($key)");
        check($real['params']['speech']['duration'] < end($real['params']['speech']['words'])['e'] + 700, "with nothing long after the last word ($key)");
        echo "Live Chatterbox, $key: ".count($words).' words in '.round($real['params']['speech']['duration'] / 1000, 1).' s, recorded in '.round(microtime(true) - $started).' s'.PHP_EOL;
        file_put_contents(sys_get_temp_dir()."/chatterbox-$key.mp3", $real['speech']->audio);
    }
    check(in_array('giant', $live->voices(), true), 'the clip made for a voice is kept by the container');
}

exec('rm -rf '.escapeshellarg($cache).' '.escapeshellarg($mediaDir).' '.escapeshellarg($work));
echo $failures ? "$failures of $checks checks FAILED\n" : "All $checks speech checks passed\n";
exit($failures ? 1 : 0);
