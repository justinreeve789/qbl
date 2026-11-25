<?php

/**
 * Tests for the generator telling a story (format "story"), run against SQLite with no network:
 *
 *   php apps/api/tests/story_generation.php            (npm run test:story-generation)
 *
 * The language model is a stand-in that reads the request as a story and answers with the story
 * fixture (first with a mistake, to exercise the correction loop); the placeholder draws the pictures,
 * including the water painted flat to be cut out. The story is built, voiced (narrator included),
 * packaged, imported, checked by the game's validator and watched to the end in the real engine.
 *
 * With KEEP=1 the work folder is left behind.
 */

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Build\StoryBuilder;
use App\Qbl\Generation\Curriculum\StandardsImporter;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\BlueprintSchema;
use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\Design\StoryPlan;
use App\Qbl\Generation\Design\StorySchema;
use App\Qbl\Generation\Design\StoryValidator;
use App\Qbl\Generation\GenerationEvents;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechFactory;
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
    check($actual === $expected, $what.' (got '.json_encode($actual).', expected '.json_encode($expected).')');
}

final class NoNetwork implements HttpClient
{
    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        throw new RuntimeException("The tests must not reach the network ($url).");
    }
}

/** Reads every request as a story, and answers with the story fixture; the first draft has a beat out of order. */
final class StoryModel implements LanguageModel
{
    public array $calls = [];

    public int $drafts = 0;

    public function __construct(private array $story) {}

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $this->calls[] = ['name' => $name, 'content' => $content, 'schema' => $schema];
        switch ($name) {
            case 'curriculum_alignment':
                return [
                    'standards' => [['code' => 'TEST-3-LS1-1', 'alignment' => 'supporting', 'rationale' => 'Living things need water.']],
                    'learning_objectives' => [['id' => 'LO1', 'text' => 'Students will be able to describe how water moves between the ground and the sky.', 'standards' => []], ['id' => 'LO2', 'text' => 'Students will be able to name evaporation, condensation and precipitation.', 'standards' => []]],
                    'vocabulary' => [['term' => 'evaporation', 'definition' => 'when water warms up and turns into vapour']],
                    'misconceptions' => ['Clouds are made of smoke.'],
                    'format' => 'story',
                ];
            case 'story_blueprint':
                $this->drafts++;
                $b = $this->story;
                if ($this->drafts === 1) {
                    // Fen speaks in the last scene before coming on.
                    array_splice($b['scenes'][2]['script'], 2, 0, [['do' => 'say', 'who' => 'fen', 'text' => 'Is that you, Drip?']]);
                }

                return $b;
            case 'blueprint_changes':
                return ['changes' => [['op' => 'remove', 'path' => 'scenes.river.script.2', 'value' => '']]];
            case 'style_review':
                return ['scores' => array_fill_keys(['line', 'shading', 'colour', 'shapes', 'rendering', 'subject', 'composition'], 8), 'problems' => [], 'fix' => ''];
        }
        throw new RuntimeException("Unexpected request $name");
    }
}

final class FakeVoices implements SpeechEngine
{
    public array $said = [];

    public function name(): string
    {
        return 'kokoro';
    }

    public function synthesize(string $text, array $voice, ?string $lang = null): Speech
    {
        $this->said[] = [$text, $voice['voice'] ?? null];
        $words = Speech::words(array_map(fn ($w, $i) => [$w, $i * 0.3, $i * 0.3 + 0.25], preg_split('/\s+/', $text), array_keys(preg_split('/\s+/', $text))));

        return new Speech('ID3'."\x04\x00\x00\x00\x00\x00\x00".str_repeat("\xFF\xFB\x90\x64".str_repeat("\x00", 413), 6).$text, 'mp3', $words, $words ? $words[array_key_last($words)]['e'] : null);
    }

    public function voices(): array
    {
        return [];
    }
}

$work = sys_get_temp_dir().'/qbl-story-test-'.bin2hex(random_bytes(4));
mkdir($work, 0775, true);
$pdo = new PDO('sqlite::memory:');
$store = new ScenarioStore($pdo, "$work/media", '/media');
foreach ([...ScenarioStore::sqliteSchema(), ...StandardsStore::sqliteSchema(), ...GenerationRuns::sqliteSchema(), ...GenerationEvents::sqliteSchema()] as $sql) {
    $pdo->exec($sql);
}
$story = require __DIR__.'/fixtures/generation/story.php';
$config = [
    'llm' => ['api_key' => 'test', 'model' => 'test', 'judge_model' => 'test'],
    'images' => ['driver' => 'placeholder'],
    'style' => 'qbl-cartoon',
    'styles_dir' => __DIR__.'/../resources/art-styles',
    'work_dir' => "$work/generations",
    'judge' => ['enabled' => true, 'min_score' => 7, 'max_attempts' => 2],
    'limits' => ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18],
];
$standards = new StandardsStore($pdo);
(new StandardsImporter($standards, new NoNetwork))->fromFile(__DIR__.'/fixtures/generation/standards.json', 'TEST-SCI', 'Test State');
$has = fn (array $errors, string $text) => (bool) array_filter($errors, fn ($e) => str_contains($e, $text));

// ------------------------------------------------------------------ the game and the generator agree
$sounds = file_get_contents(__DIR__.'/../../../packages/shared/src/sounds.ts');
preg_match_all('/^  ([a-z_]+): \{ label/m', $sounds, $m);
same(BlueprintSchema::SOUNDS, $m[1], 'the generator knows exactly the game\'s own sounds');
preg_match("/WEATHER_KINDS: WeatherKind\\[\\] = \\[([^\\]]+)\\]/", file_get_contents(__DIR__.'/../../../packages/shared/src/weather.ts'), $w);
same(BlueprintSchema::WEATHERS, array_map(fn ($s) => trim($s, " '"), explode(',', $w[1])), 'and the weather it can have');

// ------------------------------------------------------------------ the story validator
$valid = MissionDesigner::tidyStory($story);
same(StoryValidator::errors($valid), [], 'the story fixture is valid, once tidied');
same($valid['format'], 'story', 'tidied, it says it is a story');
same(count($valid['ending']['discussion']), 3, 'empty questions are dropped, and at most three kept');
same(array_column($valid['scenes'][0]['cast'], 'who'), ['drip', 'fen'], 'a cast member with nobody named is dropped');
check(! isset($valid['scenes'][0]['water']['color']), 'a water colour that is not a colour is dropped');
check(! isset($valid['scenes'][2]['foreground']), 'a foreground that looks like nothing is dropped');
same($valid['characters'][0]['gestures'], ['wave', 'cheer'], 'only gestures that can be drawn are kept');
check(! isset($valid['characters'][1]['guide']) && ! isset($valid['characters'][1]['scene']), 'a story has no guide, and characters are in no one scene');
$bad = $valid;
array_unshift($bad['scenes'][1]['script'], ['do' => 'say', 'who' => 'drip', 'text' => 'Hello?']);
check($has(StoryValidator::errors($bad), 'not on stage yet'), 'speaking before coming on is caught');
$bad = $valid;
$bad['scenes'][0]['script'][] = ['do' => 'enter', 'who' => 'drip', 'from' => 'right', 'x' => 0.5];
check($has(StoryValidator::errors($bad), 'cannot come back'), 'coming back after leaving a scene is caught');
$bad = $valid;
$bad['scenes'][2]['script'][3]['passer'] = 'bus';
check($has(StoryValidator::errors($bad), 'not one of this scene\'s ambient'), 'a pass of something that is not there is caught');
$bad = $valid;
$bad['scenes'][0]['kind'] = 'indoor';
$bad['scenes'][0]['weather'] = ['kind' => 'rain'];
$bad['scenes'][0]['script'][] = ['do' => 'weather', 'weather' => 'snow'];
$errors = StoryValidator::errors($bad);
check($has($errors, 'weather falls only') && $has($errors, 'only an outdoor or underground scene has water'), 'weather and water indoors are caught');
$bad = $valid;
$bad['characters'][] = ['key' => 'owl', 'name' => 'Owl', 'role' => 'x', 'appearance' => 'an owl', 'personality' => 'wise', 'height_cm' => 40];
check($has(StoryValidator::errors($bad), 'owl never appears'), 'a character who never appears is caught');
$bad = $valid;
$bad['scenes'][0]['script'] = [['do' => 'wait', 'seconds' => 1], ['do' => 'gesture', 'who' => 'fen', 'gesture' => 'wave'], ['do' => 'sound', 'sound' => 'bell']];
check($has(StoryValidator::errors($bad), 'nobody says anything'), 'a silent scene is caught');
$bad = $valid;
$bad['scenes'][2]['ambient'][0]['motion'] = 'drives_by';
$bad['scenes'][1]['ambient'] = [['key' => 'van', 'look' => 'a van', 'motion' => 'drives_by', 'size_cm' => 400]];
check($has(StoryValidator::errors($bad), 'vehicles drive by only outdoors'), 'a vehicle driving by up high is caught');
$schema = StorySchema::schema(['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18]);
same($schema['properties']['scenes']['items']['properties']['script']['items']['properties']['do']['enum'], StorySchema::BEATS, 'the schema offers every beat');
check(isset($schema['properties']['scenes']['items']['properties']['water'], $schema['properties']['scenes']['items']['properties']['weather']) && ! isset($schema['properties']['scenes']['items']['properties']['exits']), 'a story scene has water and weather, and no exits');

// A mission's scenes have weather, water and vehicles too, where they make sense.
$mission = MissionDesigner::tidy(require __DIR__.'/fixtures/generation/blueprint.php');
$m = $mission;
$at = array_search('orchard', array_column($m['scenes'], 'key'), true);
$m['scenes'][$at]['weather'] = ['kind' => 'rain', 'intensity' => 'light'];
$m['scenes'][$at]['water'] = ['kind' => 'stream', 'where' => 'front', 'look' => 'mossy banks'];
$m['scenes'][$at]['ambient'][] = ['key' => 'cart', 'look' => 'a little wooden cart', 'motion' => 'drives_by', 'size_cm' => 250, 'sound' => 'hooves'];
$e = BlueprintValidator::errors($m, ['LO1', 'LO2']);
check(! $has($e, '.weather') && ! $has($e, '.water') && ! $has($e, 'ambient'), 'a mission scene can have rain, a stream and a cart going by: '.implode(' | ', $e));
$m['scenes'][$at]['water']['where'] = 'middle';
check($has(BlueprintValidator::errors($m, ['LO1', 'LO2']), 'water.x'), 'water in the middle of the floor needs a place');
$g = array_search('greenhouse', array_column($m['scenes'], 'key'), true);
$m['scenes'][$g]['weather'] = ['kind' => 'snow'];
check($has(BlueprintValidator::errors($m, ['LO1', 'LO2']), 'scenes.greenhouse.weather'), 'but no snow falls in the greenhouse');
same(MissionDesigner::tidyScene(['kind' => 'indoor', 'weather' => ['kind' => 'rain']])['weather'] ?? null, null, 'tidy takes weather out of an indoor scene');
same(MissionDesigner::tidyScene(['kind' => 'outdoor', 'water' => ['kind' => 'waterfall', 'where' => 'front', 'look' => 'cliff']])['water']['where'] ?? null, 'back', 'and puts a waterfall at the back');

// Where water lies, in scene pixels.
$front = Sizes::water(['ground_line' => 0.65, 'water' => ['kind' => 'river', 'where' => 'front']]);
same([$front['x0'], $front['x1'], $front['y1']], [0, 2250, 1200], 'a river along the front crosses the whole width to the bottom');
check($front['y0'] > 780 * 1.1 && $front['y0'] < 1200, 'starting near the front of the floor');
$pond = Sizes::water(['ground_line' => 0.65, 'water' => ['kind' => 'pond', 'where' => 'middle', 'x' => 0.5, 'width' => 0.2]]);
same([$pond['x0'], $pond['x1']], [900, 1350], 'a pond is as wide as it says, where it says');
$fall = Sizes::water(['ground_line' => 0.7, 'water' => ['kind' => 'waterfall', 'x' => 0.3]]);
check($fall['y0'] < 840 && $fall['y1'] > 840 && $fall['where'] === 'back', 'a waterfall comes down from above the floor into its back');

// ------------------------------------------------------------------ the art: a story is drawn as a mission is
$art = StoryPlan::forArt($valid);
same(array_column($art['characters'], 'scene'), ['pond', 'pond', 'sky'], 'each character is drawn for the first scene they are in');
same(AssetDirector::gesturesUsed($art, $art['characters'][0]), ['cheer', 'wave'], 'Drip is drawn cheering and waving, as the script asks');
same(AssetDirector::gesturesUsed($art, $art['characters'][1]), ['point'], 'Fen points');
same(AssetDirector::gesturesUsed($art, $art['characters'][2]), [], 'and Nimbus needs no gesture drawn');
same(AssetDirector::ambientPoses(['motion' => 'drives_by']) !== [], true, 'a vehicle that drives by has poses to draw');
// The see-through box a cut-out river leaves.
$im = ImageTools::blank(400, 300);
imagealphablending($im, false);
imagefilledrectangle($im, 0, 0, 399, 299, imagecolorallocatealpha($im, 30, 120, 30, 0));
imagefilledrectangle($im, 100, 200, 300, 260, imagecolorallocatealpha($im, 0, 0, 0, 127));
$box = ImageTools::clearBox($im, 0, 150, 399, 299, 1);
same(array_slice($box, 0, 4), [100, 200, 201, 61], 'the clear box of a cut-out is found');
check(AssetDirector::waterHole($im, ['x0' => 90, 'y0' => 190, 'x1' => 310, 'y1' => 270]) !== null, 'and taken as the water\'s hole where it was asked for');
same(AssetDirector::waterHole($im, ['x0' => 0, 'y0' => 0, 'x1' => 80, 'y1' => 80]), null, 'but not where nothing was cut out');

// ------------------------------------------------------------------ the whole run
$model = new StoryModel($story);
$voices = new FakeVoices;
$speech = new SpeechFactory(['voices' => __DIR__.'/../resources/speech/voices.json'], null, $voices);
$factory = new GenerationFactory($config, $store, new NoNetwork, $model, speech: $speech);
$log = [];
$generator = $factory->generator(['images' => 'placeholder'], function ($m) use (&$log) {
    $log[] = $m;
});
$result = $generator->generate('Tell the story of a raindrop going round the water cycle, for grade 3', ['grade' => '3', 'subject' => 'Science', 'frameworks' => ['TEST-SCI']], null);
same($result['status'], 'done', 'the story is made');
check(in_array('Telling it as a story: it plays by itself, scene after scene', $log, true), 'the aligner read the request as a story');
same($model->drafts, 1, 'written once, and corrected by a change');
same(count(array_filter($model->calls, fn ($c) => $c['name'] === 'blueprint_changes')), 1, 'one correction');
$correction = array_values(array_filter($model->calls, fn ($c) => $c['name'] === 'blueprint_changes'))[0];
check(str_contains(json_encode($correction['content']), 'fen is not on stage yet'), 'the correction is told who was not on stage');
check(isset(array_values(array_filter($model->calls, fn ($c) => $c['name'] === 'story_blueprint'))[0]['schema']['properties']['scenes']['items']['properties']['script']), 'the story is written to the story schema');
$run = (new GenerationRuns($pdo))->get($result['run']);
same([$run['options']['format'] ?? null, $run['blueprint']['format'] ?? null], ['story', 'story'], 'the run remembers it is a story');

$scenarioId = $result['scenario_id'];
$doc = $store->compile($scenarioId);
same($doc['title'], 'Drip Goes Round', 'it is imported');
same(array_column($doc['scenes'], 'shortname'), ['pond', 'sky', 'river'], 'its scenes in the order they are told');
same(array_unique(array_map(fn ($s) => [$s['story'] ?? false, $s['show_avatars']], $doc['scenes']), SORT_REGULAR), [[true, false]], 'every scene plays by itself, with no avatars');
same($doc['start_scene_id'], $doc['scenes'][0]['id'], 'it starts at the beginning');
same(array_column($doc['objectives'], 'text'), ['Watch the story to the end'], 'its checklist is to watch it to the end');
same($doc['narration'] ?? null, 'on', 'it is read aloud');
check(is_string($doc['narrator_voice'] ?? null) && $doc['narrator_voice'] !== '', 'by a narrator with a voice of their own');
$story0 = fn (array $scene) => array_values(array_filter($scene['start_events'], fn ($e) => $e['shortname'] === 'story'))[0]['actions'];
$a0 = $story0($doc['scenes'][0]);
$a2 = $story0($doc['scenes'][2]);
same(array_slice(array_column($a0, 'type'), 0, 3), ['wait', 'text_overlay', 'text_overlay'], 'the first scene opens with the title, then the narrator');
same($a0[1]['text'], 'Drip Goes Round', 'the title is the story\'s');
same([$a0[2]['alignment'] ?? null, $a0[2]['text_font_style'] ?? null, $a0[2]['narrate'] ?? null], ['bottom center', 'caption', true], 'narration is a caption, read aloud');
check(isset($a0[2]['narration_media_id']), 'in the narrator\'s recorded voice');
same(end($a0)['type'], 'jump', 'a scene ends by moving on');
same(end($a0)['scene_id'], $doc['scenes'][1]['id'], 'to the next one');
// Drip starts on the left facing right, Fen on the right facing left: they already face each other, so nobody turns before speaking.
same(array_slice(array_column($a0, 'type'), 3, 2), ['dialogue', 'animate'], 'they face each other, so Drip speaks at once and Fen points');
$says = array_values(array_filter($a0, fn ($a) => $a['type'] === 'dialogue'));
same(array_column($says, 'style'), ['bubble', 'bubble'], 'lines are said in speech bubbles');
check(! array_filter($says, fn ($a) => ! isset($a['narration_media_id'])), 'every line is recorded in its character\'s voice');
$leaves = array_values(array_filter($a0, fn ($a) => $a['type'] === 'walk' && $a['position_x'] > $doc['scenes'][0]['width']));
same(count($leaves), 1, 'Drip walks off the stage beyond the right edge');
$cast = array_column($doc['scenes'][1]['characters'], 'position_x', 'character_id');
$drip = array_values(array_filter($doc['characters'], fn ($c) => $c['name'] === 'Drip'))[0]['id'];
check($cast[$drip] < 0, 'in the clouds, Drip waits off stage to the left before coming on');
$a1 = $story0($doc['scenes'][1]);
same(array_values(array_filter($a1, fn ($a) => $a['type'] === 'weather'))[0]['kind'] ?? null, 'storm', 'a storm blows up');
same(array_values(array_filter($a1, fn ($a) => $a['type'] === 'audio'))[0]['sound'] ?? null, 'thunder', 'with thunder');
same($doc['scenes'][2]['weather']['kind'] ?? null, 'rain', 'it is raining on the river');
same(array_values(array_filter($a2, fn ($a) => $a['type'] === 'weather'))[0]['kind'] ?? null, 'clear', 'until it clears');
// The water flows where the picture was cut out.
same(array_column($doc['scenes'][0]['flows'] ?? [], 'kind'), ['lake'], 'the pond is still water');
same(array_column($doc['scenes'][2]['flows'] ?? [], 'direction'), ['right'], 'the river flows to the right');
check(! isset($doc['scenes'][2]['flows'][0]['layer']), 'behind the picture: the water was cut out of it');
$flow = $doc['scenes'][2]['flows'][0];
check($flow['y'] > 800 && $flow['y'] + $flow['height'] >= 1180, 'along the front of the floor');
$floor = $doc['scenes'][2]['walkable_areas'][0];
check(max(array_column($floor, 'y')) < $flow['y'], 'and nobody walks in it');
$bg = array_values(array_filter($doc['assets'], fn ($m) => $m['id'] === end($doc['scenes'][2]['background_media'])['media_id']))[0];
same(strtolower(pathinfo($bg['filename'], PATHINFO_EXTENSION)), 'png', 'the river scene\'s picture keeps its see-through water');
check(count($doc['scenes'][0]['blocked_areas']) === 1, 'nobody walks into the pond');
// The truck only drives by when the script says, with its sound.
$pass = array_values(array_filter($doc['scenes'][2]['indirect_events'], fn ($e) => $e['shortname'] === 'pass-truck'));
same(count($pass), 1, 'the truck has a pass of its own');
same(array_values(array_filter($pass[0]['actions'], fn ($a) => $a['type'] === 'audio'))[0]['sound'] ?? null, 'car', 'and sounds like a car');
check(! array_filter($doc['scenes'][2]['start_events'], fn ($e) => $e['shortname'] === 'ambient-truck'), 'and does not come by on its own');
check((bool) array_filter($a2, fn ($a) => $a['type'] === 'run_event' && $a['target_event_id'] === $pass[0]['id']), 'the script sends it by');
same(array_column($doc['scenes'][0]['critters'] ?? [], 'behavior', 'name'), ['wren' => 'lands'], 'the wren comes and goes by itself, as a critter');
// The end.
$types = array_column($a2, 'type');
same(array_slice($types, -4), ['text_overlay', 'variable', 'award', 'infobox'], 'the last scene ends: The End, done, an award, and things to talk about');
$box = end($a2);
check(str_contains($box['content'], 'Why did Drip feel heavy in the cloud?') && str_contains($box['content'], 'And one day, Drip will rise again.'), 'the questions and the closing line are in the box');
same($box['call_to_actions'][0]['action'] ?? null, ['type' => 'jump', 'scene_id' => $doc['scenes'][0]['id']], 'which offers to watch it again from the start');
// Voices.
$voiceOf = fn (string $start) => array_values(array_filter($voices->said, fn ($x) => str_starts_with($x[0], $start)))[0][1] ?? null;
check($voiceOf('Once there was') !== null, 'the narrator\'s lines are recorded');
same($voiceOf('High up it was cold'), $voiceOf('Once there was'), 'all in one narrator\'s voice');
check($voiceOf('Good morning, Fen') !== null && $voiceOf('Good morning, Fen') !== $voiceOf('Once there was'), 'which is not Drip\'s');
check(count(array_unique(array_filter(array_map(fn ($c) => $c['tts_voice'] ?? null, $doc['characters'])))) === 3, 'each character has a voice of their own');
$narrated = array_values(array_filter(Voicer::lines($store->bundle($scenarioId)), fn ($l) => $l['character_id'] === 0));
// The captions, and the title card and "The End" too: a story reads everything aloud, and what no character says is the narrator's.
same(array_column($narrated, 'text')[0] ?? null, 'Drip Goes Round', 'the narrator reads the title');
same(count($narrated), 7, 'the editor finds the narrator\'s lines to record again');
check(count(array_filter($narrated, fn ($l) => $l['media_id'] !== null)) === 7, 'every one recorded when the story was made');
// The README.
$zip = new ZipArchive;
$zip->open($result['zip']);
$readme = $zip->getFromName('README.txt');
check(str_contains($readme, 'A story: it plays by itself') && str_contains($readme, '2. Up in the Clouds (8 beats)') && str_contains($readme, '  - Where might Drip go next time?'), 'the README tells the teacher what happens and what to talk about');
check($zip->locateName('previews/river.png') !== false, 'with a preview of each scene');
$zip->close();

// The game's own validator, and watching it to the end in the real engine.
$tsx = __DIR__.'/../../../node_modules/.bin/tsx';
if (is_file($tsx)) {
    $json = dirname($result['zip']).'/scenario.json';
    exec(escapeshellarg($tsx).' '.escapeshellarg(__DIR__.'/../../../tools/validate-scenario.ts').' '.escapeshellarg($json).' 2>&1', $out, $code);
    check($code === 0 && ! preg_grep('/ERROR/', $out), 'the game\'s validator accepts the story: '.implode(' | ', $out));
    $client = realpath(__DIR__.'/../../client');
    $out = [];
    exec('cd '.escapeshellarg($client).' && QBL_GENERATED_STORY='.escapeshellarg($json).' '.escapeshellarg($tsx).' --tsconfig tsconfig.test.json --test test/generated-story.test.ts 2>&1', $out, $code);
    check($code === 0 && preg_grep('/^# pass 1/', $out), 'the story plays to the end by itself: '.implode("\n", array_slice(preg_grep('/error|expected|actual|not ok/i', $out) ?: $out, 0, 12)));
} else {
    fwrite(STDOUT, "(skipped the game's validator and watching it: run npm install to include them)\n");
}

// A request read as a mission, or asked for as one, stays a mission.
same(StoryBuilder::readingTime('Short.'), 2600, 'a short caption stays long enough to read');

if (! getenv('KEEP')) {
    exec('rm -rf '.escapeshellarg($work));
} else {
    fwrite(STDOUT, "Work folder kept: $work\n");
}
if ($failures) {
    fwrite(STDERR, "$failures of $checks checks failed\n");
    exit(1);
}
echo "All $checks checks passed\n";
