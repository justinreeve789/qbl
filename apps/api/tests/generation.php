<?php

/**
 * Tests for the AI scenario generator, run against SQLite with no network:
 *
 *   php apps/api/tests/generation.php            (npm run test:generation)
 *
 * The language model is a stand-in that answers from fixtures (and first answers with a blueprint
 * that has a mistake, to exercise the correction loop); pictures come from the placeholder generator,
 * which draws on the chroma colour like a real provider, so cutting out, finding frames, building
 * sprite sheets, packaging the ZIP and importing it all run for real.
 *
 * With KEEP=1 the work folder is left behind, to look at the pictures and the ZIP.
 */

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\Providers\GeminiImageGenerator;
use App\Qbl\Generation\Art\Providers\OpenAiImageGenerator;
use App\Qbl\Generation\Art\Providers\PlaceholderImageGenerator;
use App\Qbl\Generation\Art\Reference;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Build\MissionBuilder;
use App\Qbl\Generation\Curriculum\StandardsImporter;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\Generation\Llm\AnthropicModel;
use App\Qbl\ScenarioStore;

// A warning or notice is a failure here (Laravel turns them into exceptions).
set_error_handler(function (int $no, string $message, string $file, int $line) {
    if (! (error_reporting() & $no)) {
        return false; // silenced with @, as Laravel also leaves it
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

require __DIR__.'/fixtures/generation/FakeModel.php';

final class NoNetwork implements HttpClient
{
    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        throw new RuntimeException("The tests must not reach the network ($url).");
    }
}

$work = sys_get_temp_dir().'/qbl-generation-test-'.bin2hex(random_bytes(4));
mkdir($work, 0775, true);
$pdo = new PDO('sqlite::memory:');
$store = new ScenarioStore($pdo, "$work/media", '/media');
foreach ([...ScenarioStore::sqliteSchema(), ...StandardsStore::sqliteSchema(), ...GenerationRuns::sqliteSchema()] as $sql) {
    $pdo->exec($sql);
}
$blueprint = require __DIR__.'/fixtures/generation/blueprint.php';
$config = [
    'llm' => ['api_key' => 'test', 'model' => 'test', 'judge_model' => 'test'],
    'images' => ['driver' => 'placeholder'],
    'style' => 'qbl-cartoon',
    'styles_dir' => __DIR__.'/../resources/art-styles',
    'work_dir' => "$work/generations",
    'judge' => ['enabled' => true, 'min_score' => 7, 'max_attempts' => 2],
    'limits' => ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 14],
];
$model = new FakeModel($blueprint);
$style = ArtStyle::load($config['styles_dir'], 'qbl-cartoon');

// ------------------------------------------------------------------ standards
$standards = new StandardsStore($pdo);
$imported = (new StandardsImporter($standards, new NoNetwork))->fromFile(__DIR__.'/fixtures/generation/standards.json', 'test-sci', 'Test State');
same($imported, 4, 'standards are imported from a JSON file');
same((new StandardsImporter($standards, new NoNetwork))->fromFile(__DIR__.'/fixtures/generation/standards.json', 'TEST-SCI'), 4, 'importing again updates');
same((int) $pdo->query('SELECT COUNT(*) FROM curriculum_standards')->fetchColumn(), 4, 'importing again does not duplicate');
same(StandardsStore::grades(['5', 'K', '6-8', 'grade 3', 'HS']), ['05', 'K', '06', '07', '08', '03', '09', '10', '11', '12'], 'grade levels are normalised');
$candidates = $standards->candidates(['TEST-SCI'], '3', 'pollinators flowers fruit orchard');
same(count($candidates), 3, 'candidates are limited to the grade');
same($candidates[0]['code'], 'TEST-3-LS1-1', 'the candidate sharing the most words comes first');

// ------------------------------------------------------------------ the blueprint validator
$lo = ['LO1', 'LO2'];
$has = fn (array $errors, string $text) => (bool) array_filter($errors, fn ($e) => str_contains($e, $text));
same(BlueprintValidator::errors($blueprint, $lo), [], 'the fixture blueprint is valid');
$bad = $blueprint;
$bad['scenes'][2]['exits'] = [['edge' => 'bottom', 'to' => 'landing']];
check($has(BlueprintValidator::errors($bad, $lo), 'would lead both'), 'an exit whose way back is taken by another scene is caught');
$bad = $blueprint;
$bad['interactions'][0]['requires'] = ['track'];
check($has(BlueprintValidator::errors($bad, $lo), 'can never'), 'a circular requirement that deadlocks the mission is caught');
check($has(BlueprintValidator::errors($blueprint, ['LO1', 'LO2', 'LO3']), 'LO3'), 'a learning objective nothing checks is caught');
$bad = $blueprint;
$bad['interactions'][4]['after'] = 'talk_pip';
check($has(BlueprintValidator::errors($bad, $lo), 'another scene'), 'a question following an interaction in another scene is caught');
$bad = $blueprint;
unset($bad['scenes'][0]['exits'][1]['look'], $bad['scenes'][0]['exits'][1]['x']);
$errors = BlueprintValidator::errors($bad, $lo);
check($has($errors, 'a door needs x') && $has($errors, 'a door needs look'), 'a door without a place or a look is caught');
$bad = $blueprint;
$bad['scenes'][1]['exits'][1]['x'] = 0.52;
check($has(BlueprintValidator::errors($bad, $lo), 'top-edge doorway'), 'a hole where the top doorway is is caught');
$bad = $blueprint;
$bad['scenes'][1]['exits'][] = ['edge' => 'right', 'to' => 'burrow'];
check($has(BlueprintValidator::errors($bad, $lo), 'Connect two scenes once'), 'two ways between the same scenes are caught');
$bad = $blueprint;
$bad['interactions'][4]['role'] = 'botanist';
check($has(BlueprintValidator::errors($bad, $lo), 'is for every student'), 'a question given to one role is caught');
$bad = $blueprint;
$bad['roles'][] = ['key' => 'pilot', 'name' => 'Pilot', 'description' => 'You fly.'];
check($has(BlueprintValidator::errors($bad, $lo), 'Role "pilot" has nothing only it can do'), 'a role with no jobs is caught');
$bad = $blueprint;
$bad['interactions'] = array_values(array_filter($bad['interactions'], fn ($it) => $it['key'] !== 'q_report'));
check($has(BlueprintValidator::errors($bad, $lo), 'debrief questions'), 'a mission without a debrief question is caught');
$bad = $blueprint;
$bad['steps'][2]['done_when'][] = 'q_report';
check($has(BlueprintValidator::errors($bad, $lo), 'is a debrief question'), 'a debrief question listed in a step is caught');
$bad = $blueprint;
foreach ($bad['interactions'] as &$it) {
    unset($it['resolves']);
}
unset($it);
check($has(BlueprintValidator::errors($bad, $lo), 'nothing sets it right'), 'a twist that blocks a way with nothing to set it right is caught');
$bad = $blueprint;
foreach ($bad['interactions'] as &$it) {
    if ($it['key'] === 'drain') {
        $it['scene'] = 'hive';
    }
}
unset($it);
check($has(BlueprintValidator::errors($bad, $lo), 'a twist blocks the way'), 'setting a twist right behind the way it blocks deadlocks, and is caught');
$bad = $blueprint;
$bad['interactions'][7]['question']['purpose'] = 'check';
check($has(BlueprintValidator::errors($bad, $lo), 'exactly one choice must be correct') === false, 'a prediction made a check with one right answer is fine');
$bad['interactions'][7]['question']['choices'][1]['correct'] = true;
check($has(BlueprintValidator::errors($bad, $lo), 'exactly one choice must be correct'), 'and with two right answers is caught');

// ------------------------------------------------------------------ tidying what the model wrote
$tidy = MissionDesigner::tidy($blueprint);
$byKey = array_column($tidy['interactions'], null, 'key');
same(array_key_exists('wanders', array_column($tidy['characters'], null, 'key')['keeper']), false, 'the guide never wanders off');
check(in_array('burst', $byKey['drain']['requires'], true), 'what sets a twist right appears only once it has happened');
same([$byKey['q_report']['scene'], isset($byKey['q_report']['x'])], ['landing', false], 'a debrief question is the guide\'s, in the guide\'s scene');
same(array_column($byKey['q_predict']['question']['choices'], 'correct'), [false, false], 'a prediction has no right answer');
same(array_column($tidy['items'], 'size_cm', 'key')['crate'], 80, 'an old size becomes a real one');
same(array_column($tidy['scenes'], 'kind', 'key')['landing'], 'outdoor', 'a scene without a kind is outdoor (or indoor, as it says)');
same(array_column($tidy['characters'], null, 'key')['bot']['chatter'], ['Beep! Too wet, too wet!'], 'empty chatter is dropped');
same(BlueprintValidator::errors($tidy, $lo), [], 'the tidied blueprint is valid');

// ------------------------------------------------------------------ ways between scenes, sizes, places
$ends = Connections::ends($tidy);
$find = fn (string $scene, string $to) => array_values(array_filter($ends[$scene], fn ($e) => $e['to'] === $to))[0] ?? null;
same([$find('landing', 'greenhouse')['via'], $find('greenhouse', 'landing')['via'], $find('greenhouse', 'landing')['edge'] ?? null], ['door', 'edge', 'bottom'], 'a door into a building comes back out towards the viewer');
same([$find('orchard', 'burrow')['via'], $find('burrow', 'orchard')['via']], ['hole', 'ladder'], 'a hole comes back up a ladder');
same($find('hive', 'orchard')['edge'] ?? null, 'bottom', 'a top edge comes back by the bottom edge');
check(str_contains($find('burrow', 'orchard')['look'], 'Blue Orchard'), 'a way back nobody described says where it leads');
check(Sizes::pixels(12) < Sizes::pixels(70) && Sizes::pixels(70) < Sizes::PERSON_PX && Sizes::pixels(210) > Sizes::PERSON_PX, 'a vial is smaller than a crate, a crate smaller than a person, a door bigger: '.json_encode([Sizes::pixels(12), Sizes::pixels(70), Sizes::pixels(210)]));
check(Sizes::pixels(3) >= 50, 'a tiny thing is still big enough to see and click');
same(Sizes::pixels(2000), Sizes::MAX_PX, 'nothing is drawn taller than a scene can hold');
$outdoor = ['kind' => 'outdoor'];
$indoor = ['kind' => 'indoor'];
same([Sizes::placement(['size_cm' => 12], null, $outdoor), Sizes::placement(['size_cm' => 80], null, $outdoor), Sizes::placement(['size_cm' => 300], 'ground', $outdoor)], ['surface', 'ground', 'back'], 'small things go on a surface, middling ones on the floor, big ones at the back');
same([Sizes::placement(['size_cm' => 40], 'wall', $outdoor), Sizes::placement(['size_cm' => 40], 'wall', $indoor)], ['surface', 'wall'], 'only scenes with a wall have things on it');
same(Sizes::placement(['size_cm' => 120], 'surface', $indoor), 'ground', 'something too big for a table stands on the floor');

// ------------------------------------------------------------------ picture tools
$spread = MissionBuilder::spread(['a' => 0.5, 'b' => 0.52, 'c' => 0.9], 260, 230, 2020);
check($spread['b'] - $spread['a'] >= 260 && $spread['c'] - $spread['b'] >= 260 && $spread['c'] <= 2020, 'things in a scene are spread apart and kept inside: '.json_encode($spread));
$around = MissionBuilder::spread(['a' => 0.45, 'b' => 0.5, 'c' => 0.55, 'd' => 0.1], 260, 230, 2020, ['door' => 0.5]);
check($around['door'] === 1125 && min(array_map(fn ($k) => abs($around[$k] - 1125), ['a', 'b', 'c', 'd'])) >= 260, 'things keep clear of a doorway at the centre: '.json_encode($around));
$placeholder = new PlaceholderImageGenerator($style->chroma(), array_values($style->palette()));
$strip = ImageTools::chromaKey(ImageTools::load($placeholder->generate('', [], '21:9', false, ['kind' => 'strip', 'frames' => 6, 'animation' => 'walk'])), $style->chroma());
check(ImageTools::hasTransparentBackground($strip), 'the chroma background is cut out');
same(count(ImageTools::figures($strip)), 6, 'six figures are found in a six-frame strip');
same(count(ImageTools::figureCrops($strip)), 6, 'and cut out as six frames');
$standing = ImageTools::trim(ImageTools::chromaKey(ImageTools::load($placeholder->generate('', [], '3:4', false, ['kind' => 'character'])), $style->chroma()));
$walk = ImageTools::puppetWalk($standing, 6);
same(count($walk), 6, 'a walk can be made from one standing picture');
check(ImageTools::png($walk[1]) !== ImageTools::png($walk[4]), 'and its frames differ');
$bust = ImageTools::bust($standing);
check(imagesy($bust) < imagesy($standing) * 0.6, 'a bust is the top of the figure');
$magenta = ImageTools::load($placeholder->generate('', [], '1:1', false, ['kind' => 'item']));
same((imagecolorat(ImageTools::chromaKey($magenta, $style->chroma()), 5, 5) >> 24) & 0x7F, 127, 'a corner of a cut-out is fully transparent');
$pulled = ImageTools::pullToPalette(ImageTools::load($placeholder->generate('', [], '16:9', false, ['kind' => 'background'])), $style->palette(), 0.5);
check(ImageTools::paletteDistance($pulled, $style->palette()) <= ImageTools::paletteDistance(ImageTools::load($placeholder->generate('', [], '16:9', false, ['kind' => 'background'])), $style->palette()), 'pulling towards the palette brings colours closer to it');
[$r, $g, $b] = ImageTools::rgbFromLab(...ImageTools::lab(200, 100, 50));
check(abs($r - 200) <= 1 && abs($g - 100) <= 1 && abs($b - 50) <= 1, 'Lab conversion goes there and back');
check(str_contains($style->prompt('character', 'a robot', [], [], ['stand still']), '#FF00FF') && str_contains($style->prompt('character', 'a robot'), 'AVOID:'), 'prompts carry the chroma background and what to avoid');
same($style->prompt('item', 'a cup'), $style->prompt('item', 'a cup'), 'the same request is always worded the same');

// ------------------------------------------------------------------ the services' wire formats
final class Recorded implements HttpClient
{
    public array $sent = [];

    public function __construct(private array $answers) {}

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        $this->sent[] = compact('method', 'url', 'headers', 'body');

        return array_shift($this->answers);
    }
}
$png = ImageTools::png(ImageTools::blank(4, 4));
$ref = new Reference($png, 'style anchor (character)');

$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{"ok": true}']], 'stop_reason' => 'end_turn']))]);
$answer = (new AnthropicModel($http, 'key', 'claude-test'))->structured('sys', ['look', ['image' => $png]], 'answer', ['type' => 'object', 'properties' => ['n' => ['type' => 'integer', 'minimum' => 0, 'description' => 'How many'], 'list' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 5, 'items' => ['type' => 'string', 'pattern' => '^[a-z]+$']]]]);
same($answer, ['ok' => true], 'Claude\'s answer is read as JSON from its text block');
$format = $http->sent[0]['body']['output_config']['format'] ?? [];
same($format['type'] ?? null, 'json_schema', 'Claude is asked for structured output with the schema');
same($format['schema']['additionalProperties'] ?? null, false, 'objects in the schema forbid other properties');
check(! isset($format['schema']['properties']['n']['minimum']) && str_contains($format['schema']['properties']['n']['description'], 'minimum: 0'), 'bounds structured outputs do not accept move into the description');
same([$format['schema']['properties']['list']['minItems'] ?? null, isset($format['schema']['properties']['list']['maxItems']), isset($format['schema']['properties']['list']['items']['pattern'])], [1, false, false], 'item counts above 1 and patterns are taken out');
same($http->sent[0]['body']['messages'][0]['content'][1]['source']['type'] ?? null, 'base64', 'pictures go to Claude as base64');
same($http->sent[0]['headers']['x-api-key'], 'key', 'with the key in x-api-key');
$http = new Recorded([
    new HttpResponse(400, json_encode(['type' => 'error', 'error' => ['type' => 'invalid_request_error', 'message' => 'The compiled grammar is too large, which would cause performance issues.']])),
    new HttpResponse(200, json_encode(['content' => [['type' => 'tool_use', 'name' => 'big_answer', 'input' => ['big' => true]]], 'stop_reason' => 'tool_use'])),
    new HttpResponse(200, json_encode(['content' => [['type' => 'tool_use', 'name' => 'big_answer', 'input' => ['again' => true]]], 'stop_reason' => 'tool_use'])),
]);
$big = new AnthropicModel($http, 'key');
same($big->structured('sys', ['x'], 'big_answer', ['type' => 'object']), ['big' => true], 'a schema too large for a strict grammar is answered through a tool');
same([$http->sent[1]['body']['tool_choice'] ?? null, isset($http->sent[1]['body']['output_config'])], [['type' => 'auto'], false], 'with tool_choice auto (forcing is not allowed)');
same($big->structured('sys', ['x'], 'big_answer', ['type' => 'object']), ['again' => true], 'and the next request for it goes straight to the tool');
same(count($http->sent), 3, 'without trying the grammar again');
$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{"ok": tr']], 'stop_reason' => 'max_tokens']))]);
check((function () use ($http) {
    try {
        (new AnthropicModel($http, 'key'))->structured('sys', ['x'], 'answer', ['type' => 'object'], 10);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'ran out of room');
    }

    return false;
})(), 'an answer cut off by max_tokens is reported as such');

$http = new Recorded([new HttpResponse(200, json_encode(['candidates' => [['content' => ['parts' => [['text' => 'here'], ['inlineData' => ['mimeType' => 'image/png', 'data' => base64_encode($png)]]]]]]]))]);
same((new GeminiImageGenerator($http, 'gkey', 'gemini-test'))->generate('draw', [$ref], '21:9', false), $png, 'Gemini\'s picture is read from inlineData');
same($http->sent[0]['body']['generationConfig']['imageConfig']['aspectRatio'], '21:9', 'Gemini is asked for the aspect ratio in imageConfig');
same(array_keys($http->sent[0]['body']['contents'][0]['parts'][1]), ['inline_data'], 'references go to Gemini inline');
check(str_ends_with($http->sent[0]['url'], '/models/gemini-test:generateContent'), 'Gemini is called at generateContent');

$http = new Recorded([new HttpResponse(200, json_encode(['data' => [['b64_json' => base64_encode($png)]]]))]);
same((new OpenAiImageGenerator($http, 'okey', 'gpt-image-1.5'))->generate('draw', [$ref], '3:4', true), $png, 'OpenAI\'s picture is read from b64_json');
check(str_ends_with($http->sent[0]['url'], '/images/edits') && $http->sent[0]['body']['background'] === 'transparent' && $http->sent[0]['body']['size'] === '1024x1536', 'OpenAI gets references at /images/edits, a transparent background and a portrait size');
check(str_starts_with($http->sent[0]['body']['images'][0]['image_url'], 'data:image/png;base64,'), 'references go to OpenAI as data URLs');
$http = new Recorded([new HttpResponse(400, json_encode(['error' => ['message' => 'Your request was rejected']]))]);
check((function () use ($http) {
    try {
        (new OpenAiImageGenerator($http, 'okey'))->generate('draw', [], '1:1', false);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'Your request was rejected');
    }

    return false;
})(), 'a refusal is reported with the service\'s own message');

// ------------------------------------------------------------------ every character walks, stands and has a portrait
/** Draws like the placeholder, but cannot draw animation strips or portraits. */
final class NoStrips implements ImageGenerator
{
    public function __construct(private PlaceholderImageGenerator $inner) {}

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        if (in_array($hints['kind'] ?? '', ['strip', 'portrait'], true)) {
            throw new GenerationError('refused');
        }

        return $this->inner->generate($prompt, $references, $aspect, $transparent, $hints);
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return 'no-strips';
    }
}
$director = new AssetDirector(new NoStrips($placeholder), $style, null, "$work/no-strips", 2);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $blueprint['characters'][1], '', []);
$names = array_column($drawn['char:bot']['params']['animations'], 'name');
same($names, ['idle', 'walk'], 'a character whose strips cannot be drawn still stands and walks');
same(count($drawn['char:bot']['params']['animations'][1]['frames']), 6, 'with a six-frame walk made from the standing picture');
check(is_file($drawn['portrait:bot']['path']) && $drawn['portrait:bot']['width'] === 320, 'and a portrait cut from the sheet');
check((bool) array_filter($director->manifest(), fn ($m) => $m['key'] === 'strip:bot:walk' && ! empty($m['below_bar'])), 'flagged for a person to look at');

// ------------------------------------------------------------------ the whole run
$factory = new GenerationFactory($config, $store, new NoNetwork, $model);
check((function () use ($factory) {
    try {
        $factory->generator(['images' => 'gemini']);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'anchor');
    }

    return false;
})(), 'a real image driver is refused while the style has no approved anchors');

$log = [];
$generator = $factory->generator(['images' => 'placeholder'], function ($m) use (&$log) {
    $log[] = $m;
});
$result = $generator->generate('A mission about why an orchard has flowers but no fruit, for grade 3', ['grade' => '3', 'subject' => 'Science', 'frameworks' => ['TEST-SCI'], 'min_players' => 2, 'max_players' => 6], null);
same($result['status'], 'done', 'the run finishes');
same($model->blueprints, 2, 'the blueprint with a mistake was sent back once and corrected');
$alignmentCall = $model->calls[0];
check(in_array('TEST-3-LS1-1', $alignmentCall['schema']['properties']['standards']['items']['properties']['code']['enum'], true) && ! in_array('TEST-5-PS1-1', $alignmentCall['schema']['properties']['standards']['items']['properties']['code']['enum'], true), 'only standards of the grade are offered, as an enum');
$run = (new GenerationRuns($pdo))->get($result['run']);
same(array_column($run['alignment']['standards'], 'code'), ['TEST-3-LS1-1'], 'a standard that was not offered is dropped');
same($run['status'], 'done', 'the run is recorded as done');

$scenarioId = $result['scenario_id'];
$scenario = $store->scenario($scenarioId);
same($scenario['title'], 'The Quiet Hive', 'the scenario is imported');
same(strlen($scenario['code']), 16, 'it has its own code');
same($scenario['settings']['visibility'] ?? null, 'private', 'it is a private draft');
same($scenario['published_at'] ?? null, null, 'it is not published');
$doc = $store->compile($scenarioId);
same(count($doc['scenes']), 5, 'every scene is there');
same($doc['scenes'][0]['shortname'], 'landing', 'the start scene comes first');
same($doc['start_scene_id'], $doc['scenes'][0]['id'], 'the start scene is set');
same(count($doc['characters']), 2, 'both characters are there');
$sheet = array_values(array_filter($doc['assets'], fn ($m) => $m['id'] === $doc['characters'][0]['media_id']))[0];
same(array_column($sheet['animations'], 'name'), ['idle', 'walk', 'wave', 'cheer'], 'the guide has idle, walk and her two gestures');
same($sheet['sheet'], ['columns' => 6, 'rows' => 4], 'her sheet is a 6 x 4 grid');
same([$sheet['width'], $sheet['height']], [6 * 240, 4 * 320], 'the sheet is whole cells');
$guideAnimations = $doc['characters'][0]['animations'] ?? [];
same([$guideAnimations['stand_right']['media_id'] ?? null, $guideAnimations['walk_right']['media_id'] ?? null, isset($guideAnimations['wave'], $guideAnimations['cheer'])], [$sheet['id'], $sheet['id'], true], 'she is drawn from it: standing, walking and her gestures');
check(is_int($guideAnimations['portrait']['media_id'] ?? null) && $guideAnimations['portrait']['media_id'] !== $sheet['id'], 'she has a portrait');
foreach ($doc['assets'] as $m) {
    check(str_starts_with((string) $m['url'], '/media/'.$scenarioId.'/') && is_file("$work/media/".$m['filepath']), "media {$m['filename']} was stored with the scenario");
}
same(count($doc['shop_items'] ?? []), 1, 'the mission patch is for sale');
same($doc['curriculum']['standards'][0]['code'] ?? null, 'TEST-3-LS1-1', 'the standards travel in the document');
same($doc['curriculum']['evidence'][0]['evidence'][0]['first_answer'] ?? null, 'q_q_pollen_first', 'the evidence for LO1 names the variable with the first answer');
same($standards->forScenario($scenarioId)[0]['code'] ?? null, 'TEST-3-LS1-1', 'the scenario\'s standards are recorded');
check(str_contains((string) ($standards->forScenario($scenarioId)[0]['evidence'] ?? ''), 'q_pollen'), 'with the question that gives evidence for it');

// What students do, as the runtime sees it.
$byShort = [];
foreach ($doc['scenes'] as $scene) {
    foreach (['start_events', 'hotspots', 'indirect_events'] as $list) {
        foreach ($scene[$list] as $e) {
            $byShort[$scene['shortname'].'/'.($e['shortname'] ?? '')] = $e;
        }
    }
}
$exit = $byShort['orchard/exit-top'] ?? null;
same($exit['conditions'][0]['variable'] ?? null, 'done_talk_keeper', 'the way up to the hive opens after talking to the keeper');
same($byShort['orchard/exit-top-closed']['actions'][0]['type'] ?? null, 'text_overlay', 'and says why while it is closed');
$hiveSpawns = array_column(array_values(array_filter($doc['scenes'], fn ($s) => $s['shortname'] === 'hive'))[0]['spawn_points'], 'name');
check(in_array('from-orchard', $hiveSpawns, true), 'the hive has a spawn point for students coming from the orchard');
$collect = $byShort['orchard/pollen_b'];
same(array_column($collect['labels'], 'type'), ['image', 'text'], 'a collect shows its item and a label');
same(array_column($byShort['orchard/q_pollen']['labels'], 'type'), ['image', 'text'], 'a question without an item shows the style\'s marker');
$door = $byShort['orchard/exit-top'];
foreach ($byShort as $name => $e) {
    // The mudslide is meant to stand in the doorway: it is what blocks it.
    if (str_starts_with($name, 'orchard/') && $e !== $door && ! str_starts_with($name, 'orchard/obstacle-') && isset($e['position_x'], $e['position_y']) && ($e['activate_by_trigger'] ?? false)) {
        check(abs($e['position_x'] - $door['position_x']) >= 200, "$name keeps clear of the doorway");
    }
}
$runs = array_column(array_filter($collect['actions'], fn ($a) => $a['type'] === 'run_event'), 'target_event_id');
check(in_array($byShort['orchard/ask-q_pollen']['id'], $runs, true), 'the question pops up after the second sample');
$ask = $byShort['orchard/ask-q_pollen']['actions'][0];
same([$ask['type'], $ask['dismissible'], count($ask['call_to_actions'])], ['infobox', false, 3], 'the question is a non-dismissible infobox with a button per answer');
$team = $byShort['hive/valves'];
same($team['audience'] ?? null, 'scene', 'the team task is shown to the whole scene');
$scopes = array_column($doc['global_variables'], 'scope', 'variable_name');
same($scopes['team_valves'], 'room', 'its counter is shared');
check(str_contains(json_encode($team['actions']), '/2)'), 'with 2 to 6 players, three valves need only two students: '.json_encode(array_column($team['actions'], 'text')));
same([$scopes['done_pollen_a'], $scopes['done_read_humidity'], $scopes['did_read_humidity'], $scopes['found_read_humidity'], $scopes['my_role'], $scopes['crew_botanist']], ['player', 'room', 'player', 'room', 'player', 'room'], 'each student does their own tasks; a role\'s job and the crew log are shared');

// Ways in and out that are not edges.
$door = $byShort['landing/way-greenhouse'];
same(array_column($door['actions'], 'type'), ['freeze', 'walk', 'avatar', 'jump'], 'a door: the student walks over to it and goes through');
$sceneIds = array_column($doc['scenes'], 'id', 'shortname');
same([$door['actions'][3]['scene_id'], $door['actions'][3]['spawn_point'], $door['actions'][1]['target']], [$sceneIds['greenhouse'], 'from-landing', 'player'], 'into the greenhouse');
$spawnsOf = fn (string $scene) => array_column(array_values(array_filter($doc['scenes'], fn ($s) => $s['shortname'] === $scene))[0]['spawn_points'], null, 'name');
check(isset($spawnsOf('greenhouse')['from-landing'], $spawnsOf('landing')['from-greenhouse']), 'with somewhere to arrive at either end');
same($byShort['greenhouse/exit-bottom']['actions'][0]['scene_id'] ?? null, $sceneIds['landing'], 'and the way back out towards the viewer');
check(in_array('animate', array_column($byShort['orchard/way-burrow']['actions'], 'type'), true), 'students hop into the hole');
same($byShort['burrow/way-orchard']['actions'][3]['scene_id'] ?? null, $sceneIds['orchard'], 'and climb back up the ladder');
check(abs($spawnsOf('orchard')['from-burrow']['position_x'] - $byShort['orchard/way-burrow']['position_x']) > $byShort['orchard/way-burrow']['radius'], 'arriving beside the hole, not in it');

// Things where they belong, at their size.
$assetById = array_column($doc['assets'], null, 'id');
$picture = fn (array $hotspot) => $assetById[array_values(array_filter($hotspot['labels'], fn ($l) => $l['type'] === 'image'))[0]['media'] ?? 0] ?? null;
$vial = $picture($byShort['orchard/pollen_a']);
check(abs(max($vial['width'], $vial['height']) - Sizes::pixels(12)) <= 2, 'a 12 cm vial is drawn to its size: '.json_encode([$vial['width'], $vial['height']]));
$crate = $assetById[array_column($doc['items'], null, 'name')['Supply crate']['media_id']];
check(max($crate['width'], $crate['height']) < Sizes::PERSON_PX, 'a crate is smaller than a person');
check(isset($byShort['orchard/surface-pollen_a']) && ($byShort['orchard/surface-pollen_a']['labels'][0]['solid'] ?? false), 'a small thing stands on a surface students walk around');
check($byShort['orchard/pollen_a']['labels'][0]['position_y'] < $byShort['orchard/surface-pollen_a']['labels'][0]['position_y'], 'on top of it');
same($byShort['orchard/pollen_b']['labels'][0]['placement'] ?? null, 'object', 'a thing out on the floor can be walked behind');
$greenhouseGround = $doc['scenes'][array_search('greenhouse', array_column($doc['scenes'], 'shortname'), true)]['walkable_areas'][0][0]['y'];
check($byShort['greenhouse/read_humidity']['labels'][0]['position_y'] < $greenhouseGround - 100, 'a gauge hangs on the wall');
same($byShort['burrow/find_feather']['reveal_radius'] ?? null, 340, 'a hidden discovery appears when students come close');

// Crew roles.
same($doc['objectives'][0]['id'], 'role', 'the checklist starts with choosing a role');
$station = $byShort['landing/crew-station'] ?? null;
check($station !== null, 'the start scene has a crew station');
$menu = $byShort['landing/crew-station']['actions'][0]['target_event_id'] ?? null;
$menuEvent = array_values(array_filter($byShort, fn ($e) => $e['id'] === $menu))[0] ?? null;
check(str_contains($menuEvent['actions'][0]['content'] ?? '', '{{found_read_humidity}}') && str_contains($menuEvent['actions'][0]['content'], '{{crew_botanist}}'), 'it shows the crew log and who has which role');
$runs = fn (array $e) => array_column(array_filter($e['actions'], fn ($a) => $a['type'] === 'run_event'), 'target_event_id');
check(in_array($menu, $runs($byShort['landing/arrive']), true), 'students choose a role when they arrive');
check(str_contains($byShort['landing/choose-botanist']['actions'][array_search('infobox', array_column($byShort['landing/choose-botanist']['actions'], 'type'), true)]['content'], 'Reroute the water'), 'a role lists its jobs, team parts included');
same(array_column($byShort['greenhouse/read_humidity']['conditions'], 'variable'), ['my_role'], 'only the botanist can read the gauge');
check(isset($byShort['greenhouse/read_humidity-role']), 'everyone else is told whose job it is');
check(isset($byShort['greenhouse/reroute-botanist'], $byShort['greenhouse/reroute-engineer'], $byShort['greenhouse/reroute-waiting-none']), 'a team task with a part for each role');
check(str_contains($objectivesText = json_encode(array_column($doc['objectives'], 'text')), '(Botanist, Engineer)'), 'the checklist says which roles a step needs');

// A twist.
$twist = $byShort['orchard/twist-burst'];
same($twist['audience'] ?? null, 'scene', 'a twist is shown to everyone in the scene');
same(array_column(array_filter($twist['actions'], fn ($a) => $a['type'] === 'variable'), 'name'), ['twist_burst', 'seen_twist_burst', 'blocked_burst'], 'it happens for the whole crew and blocks a way');
check(in_array($twist['id'], $runs($byShort['orchard/pollen_b']), true), 'it happens right after the second sample');
check(in_array('blocked_burst', array_column($byShort['orchard/exit-top']['conditions'], 'variable'), true) && isset($byShort['orchard/exit-top-blocked']), 'the way up to the hive is closed while it lasts');
same(array_column(array_values(array_filter($byShort['hive/exit-bottom']['conditions'] ?? [], fn ($c) => $c['variable'] === 'blocked_burst')), 'variable'), [], 'but students on the far side can still come back');
$mud = $byShort['orchard/obstacle-burst'];
check(($mud['labels'][0]['solid'] ?? false) && abs($mud['position_x'] - $byShort['orchard/exit-top']['position_x']) < 5, 'the mudslide stands in front of the doorway it blocks');
check(in_array('blocked_burst', array_column(array_filter($byShort['orchard/drain']['actions'], fn ($a) => $a['type'] === 'variable'), 'name'), true), 'digging a channel clears it');
check(in_array('seen_twist_burst', array_column(array_filter($byShort['hive/arrive']['actions'], fn ($a) => $a['type'] === 'variable'), 'name'), true), 'students elsewhere hear about it when they arrive');

// Assessment: predictions and the debrief.
$predicted = $byShort['hive/answer-q_predict-2'];
check(in_array('done_q_predict', array_column($predicted['actions'], 'name'), true) && ! in_array('score', array_column($predicted['actions'], 'name'), true), 'every prediction is accepted and none is scored');
$report = $byShort['landing/report'];
check(in_array($byShort['landing/ask-q_report']['id'], $runs($report), true), 'the guide asks the debrief question in the report');
check(in_array($byShort['landing/finale']['id'], $runs($report), true) && in_array('mission_complete', array_column($byShort['landing/finale']['actions'], 'name'), true), 'and completes the mission only after it');
check(str_contains(json_encode($byShort['landing/finale']['actions']), 'of 2'), 'the score is out of the two scored questions');
check(str_contains(json_encode($report['actions']), 'Your crew log'), 'the debrief opens the crew log first');
same(array_column(array_filter($doc['curriculum']['evidence'][1]['evidence'], fn ($e) => $e['type'] === 'prediction'), 'answer'), ['q_q_predict_answer'], 'a prediction\'s answer is kept for the teacher');

// Characters.
$characters = array_column($doc['characters'], null, 'name');
foreach ($characters as $name => $c) {
    check(isset($c['animations']['stand_right'], $c['animations']['walk_right'], $c['animations']['portrait']), "$name stands, walks and has a portrait");
}
same(array_column($characters['Pip']['routine']['steps'] ?? [], 'type'), ['walk', 'wait', 'dialogue', 'walk', 'wait'], 'Pip paces about and mutters');
same([isset($byShort['hive/label-bot']), isset($byShort['landing/label-keeper'])], [false, true], 'a character who paces has no label left behind; the guide keeps hers');

$objectives = array_column($doc['objectives'], 'text', 'id');
same($objectives['samples'], 'Collect pollen in the orchard ({{count_samples}}/2)', 'a step of several shows its count');
same($objectives['report'], 'Report to Keeper Ama', 'the last objective is the report');
$overlaps = [];
foreach ($doc['scenes'] as $scene) {
    $texts = [];
    foreach ($scene['hotspots'] as $h) {
        if (preg_match('/^label-|^exit-/', $h['shortname'] ?? '')) {
            continue;
        }
        foreach ($h['labels'] as $l) {
            if ($l['type'] === 'text') {
                // Twins of one hotspot (for another role, while locked, while waiting) share its place and show one at a time.
                $texts[$h['position_x'].','.$h['position_y']] ??= $l;
            }
        }
    }
    $texts = array_values($texts);
    foreach ($texts as $i => $a) {
        foreach (array_slice($texts, $i + 1) as $b) {
            if (abs($a['position_y'] - $b['position_y']) < 30 && abs($a['position_x'] - $b['position_x']) < (MissionBuilder::labelWidth($a['text']) + MissionBuilder::labelWidth($b['text'])) / 2) {
                $overlaps[] = "{$scene['shortname']}: {$a['text']} / {$b['text']}";
            }
        }
    }
}
same($overlaps, [], 'no two labels in a scene overlap');
check(isset($byShort['landing/report']), 'the guide has a report conversation');
same(array_column($doc['characters'], 'name'), ['Keeper Ama', 'Pip'], 'characters keep their names');

// ------------------------------------------------------------------ the package
check(is_file($result['zip']), 'the ZIP is kept with the run');
$zip = new ZipArchive;
$zip->open($result['zip']);
$names = [];
for ($i = 0; $i < $zip->numFiles; $i++) {
    $names[] = $zip->getNameIndex($i);
}
check(in_array('scenario.json', $names, true) && in_array('README.txt', $names, true), 'it holds scenario.json and a README');
same(count(array_filter($names, fn ($n) => str_starts_with($n, 'assets/'))), count(json_decode($zip->getFromName('scenario.json'), true)['assets']), 'and one file per media entry');
$zip->close();
// The game's own validator, when the JavaScript side is installed (npm install).
$tsx = __DIR__.'/../../../node_modules/.bin/tsx';
if (is_file($tsx)) {
    exec(escapeshellarg($tsx).' '.escapeshellarg(__DIR__.'/../../../tools/validate-scenario.ts').' '.escapeshellarg(dirname($result['zip']).'/scenario.json').' 2>&1', $out, $code);
    check($code === 0 && ! preg_grep('/ERROR/', $out), 'the game\'s validator accepts the generated scenario: '.implode(' | ', $out));
    // And a student can play it through, in the real engine (apps/client/test/generated-mission.test.ts).
    $client = realpath(__DIR__.'/../../client');
    $out = [];
    exec('cd '.escapeshellarg($client).' && QBL_GENERATED_SCENARIO='.escapeshellarg(dirname($result['zip']).'/scenario.json').' '.escapeshellarg($tsx).' --tsconfig tsconfig.test.json --test test/generated-mission.test.ts 2>&1', $out, $code);
    check($code === 0 && preg_grep('/^# pass 1/', $out), 'a student plays the generated mission from the briefing to the debrief: '.implode("\n", array_slice(preg_grep('/error|expected|actual|not ok/i', $out) ?: $out, 0, 12)));
} else {
    fwrite(STDOUT, "(skipped the game's validator and the playthrough: run npm install to include them)\n");
}
$again = $generator->import($result['zip'], null);
check($again !== $scenarioId && $store->scenario($again)['title'] === 'The Quiet Hive', 'the ZIP imports again as another draft');

// ------------------------------------------------------------------ resuming
$before = count($model->calls);
$resumed = $generator->generate('', [], null, $result['run']);
same(count($model->calls), $before, 'resuming a finished run asks the model nothing again');
check((bool) array_filter($log, fn ($m) => str_contains($m, 'Reusing')), 'and draws no picture again');
check($resumed['scenario_id'] !== $scenarioId, 'resuming imports again (a fresh draft)');

$design = $generator->generate('Another mission', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design']);
same($design['status'], 'designed', '--design-only stops after the blueprint');

if (getenv('KEEP')) {
    fwrite(STDOUT, "Work folder kept: $work\n");
} else {
    exec('rm -rf '.escapeshellarg($work));
}
echo $failures ? "\n$failures of $checks checks failed\n" : "All $checks checks passed\n";
exit($failures ? 1 : 0);
