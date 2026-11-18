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
use App\Qbl\Generation\Build\MissionBuilder;
use App\Qbl\Generation\Curriculum\StandardsImporter;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\Generation\Llm\AnthropicModel;
use App\Qbl\ScenarioStore;

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
same(BlueprintValidator::errors($blueprint, $lo), [], 'the fixture blueprint is valid');
$bad = $blueprint;
$bad['scenes'][2]['exits'] = [['edge' => 'bottom', 'to' => 'landing']];
check((bool) array_filter(BlueprintValidator::errors($bad, $lo), fn ($e) => str_contains($e, 'must lead back')), 'an exit whose way back is taken by another scene is caught');
$bad = $blueprint;
$bad['interactions'][0]['requires'] = ['track'];
check((bool) array_filter(BlueprintValidator::errors($bad, $lo), fn ($e) => str_contains($e, 'can never')), 'a circular requirement that deadlocks the mission is caught');
check((bool) array_filter(BlueprintValidator::errors($blueprint, ['LO1', 'LO2', 'LO3']), fn ($e) => str_contains($e, 'LO3')), 'a learning objective nothing checks is caught');
$bad = $blueprint;
$bad['interactions'][4]['after'] = 'talk_pip';
check((bool) array_filter(BlueprintValidator::errors($bad, $lo), fn ($e) => str_contains($e, 'another scene')), 'a question following an interaction in another scene is caught');

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
same(count($doc['scenes']), 3, 'every scene is there');
same($doc['scenes'][0]['shortname'], 'landing', 'the start scene comes first');
same($doc['start_scene_id'], $doc['scenes'][0]['id'], 'the start scene is set');
same(count($doc['characters']), 2, 'both characters are there');
$sheet = array_values(array_filter($doc['assets'], fn ($m) => $m['id'] === $doc['characters'][0]['media_id']))[0];
same(array_column($sheet['animations'], 'name'), ['idle', 'walk', 'wave', 'cheer'], 'the guide has idle, walk and her two gestures');
same($sheet['sheet'], ['columns' => 6, 'rows' => 4], 'her sheet is a 6 x 4 grid');
same([$sheet['width'], $sheet['height']], [6 * 240, 4 * 320], 'the sheet is whole cells');
check(is_string($doc['characters'][0]['portrait_media_id'] ?? null) || is_int($doc['characters'][0]['portrait_media_id'] ?? null), 'she has a portrait');
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
    if (str_starts_with($name, 'orchard/') && $e !== $door && isset($e['position_x'], $e['position_y']) && ($e['activate_by_trigger'] ?? false)) {
        check(abs($e['position_x'] - $door['position_x']) >= 200, "$name keeps clear of the doorway");
    }
}
$runs = array_column(array_filter($collect['actions'], fn ($a) => $a['type'] === 'run_event'), 'target_event_id');
check(in_array($byShort['orchard/ask-q_pollen']['id'], $runs, true), 'the question pops up after the second sample');
$ask = $byShort['orchard/ask-q_pollen']['actions'][0];
same([$ask['type'], $ask['dismissible'], count($ask['call_to_actions'])], ['infobox', false, 3], 'the question is a non-dismissible infobox with a button per answer');
$team = $byShort['hive/valves'];
same($team['audience'] ?? null, 'scene', 'the team task is shown to the whole scene');
same(array_values(array_filter(array_column($doc['global_variables'], 'scope', 'variable_name'), fn ($s) => $s === 'room')), ['room'], 'its counter is the one shared variable');
same(array_column($doc['global_variables'], 'scope', 'variable_name')['team_valves'], 'room', 'and it is team_valves');
check(str_contains(json_encode($team['actions']), '/2)'), 'with 2 to 6 players, three valves need only two students: '.json_encode(array_column($team['actions'], 'text')));
$objectives = array_column($doc['objectives'], 'text', 'id');
same($objectives['samples'], 'Collect pollen in the orchard ({{count_samples}}/2)', 'a step of several shows its count');
same($objectives['report'], 'Report to Keeper Ama', 'the last objective is the report');
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
