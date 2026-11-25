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
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\PricedImageGenerator;
use App\Qbl\Generation\Art\Providers\AutoSpriteAnimator;
use App\Qbl\Generation\Art\Providers\GeminiImageGenerator;
use App\Qbl\Generation\Art\Providers\OpenAiImageGenerator;
use App\Qbl\Generation\Art\Providers\PlaceholderImageGenerator;
use App\Qbl\Generation\Art\Reference;
use App\Qbl\Generation\Art\StyleJudge;
use App\Qbl\Generation\Build\MissionBuilder;
use App\Qbl\Generation\Curriculum\StandardsImporter;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\Design\TwistIdeas;
use App\Qbl\Generation\GenerationCancelled;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\GenerationEvents;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\Generation\Llm\AnthropicModel;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\Generation\Methods\GenerationMethod;
use App\Qbl\Generation\Methods\SpriteAppMethod;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\RoutingImageGenerator;
use App\Qbl\Generation\Pipeline\Step;
use App\Qbl\Generation\Pipeline\Tracer;
use App\Qbl\Generation\ScenarioGenerator;
use App\Qbl\Generation\Spend;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechFactory;
use Random\Engine\Mt19937;
use Random\Randomizer;

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
foreach ([...ScenarioStore::sqliteSchema(), ...StandardsStore::sqliteSchema(), ...GenerationRuns::sqliteSchema(), ...GenerationEvents::sqliteSchema()] as $sql) {
    $pdo->exec($sql);
}
// Every progress report a run makes, in order, to check the editor's progress bar against.
$pdo->exec('CREATE TABLE progress_log (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `run` INTEGER, `status`, `progress`)');
$pdo->exec('CREATE TRIGGER log_progress AFTER UPDATE OF progress ON scenario_generations BEGIN INSERT INTO progress_log (run, status, progress) VALUES (NEW.id, NEW.status, NEW.progress); END');
$blueprint = require __DIR__.'/fixtures/generation/blueprint.php';
$config = [
    'llm' => ['api_key' => 'test', 'model' => 'test', 'judge_model' => 'test'],
    'images' => ['driver' => 'placeholder'],
    'style' => 'qbl-cartoon',
    'styles_dir' => __DIR__.'/../resources/art-styles',
    'work_dir' => "$work/generations",
    'judge' => ['enabled' => true, 'min_score' => 7, 'max_attempts' => 2],
    'limits' => ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18],
    // The fixture's robot falls: this mission may have its big moment.
    'pacing' => ['big_moment_chance' => 1],
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
/** Where the interaction (or scene) with this key is in its list. */
$at = fn (string $key, string $list = 'interactions') => array_search($key, array_column($blueprint[$list], 'key'), true);
// What the model wrote, as tidy() leaves it (the fixture has a few half-filled things for tidy to drop).
$valid = MissionDesigner::tidy($blueprint);
same(BlueprintValidator::errors($valid, $lo), [], 'the fixture blueprint is valid, once tidied');
same(count(BlueprintValidator::errors($blueprint, $lo)) > 0, true, 'untidied, it is not');
$bad = $valid;
$bad['scenes'][2]['exits'] = [['edge' => 'bottom', 'to' => 'landing']];
check($has(BlueprintValidator::errors($bad, $lo), 'would lead both'), 'an exit whose way back is taken by another scene is caught');
$bad = $valid;
$bad['interactions'][0]['requires'] = ['track'];
check($has(BlueprintValidator::errors($bad, $lo), 'can never'), 'a circular requirement that deadlocks the mission is caught');
check($has(BlueprintValidator::errors($valid, ['LO1', 'LO2', 'LO3']), 'LO3'), 'a learning objective nothing checks is caught');
$bad = $valid;
$bad['interactions'][$at('q_pollen')]['after'] = 'talk_pip';
check($has(BlueprintValidator::errors($bad, $lo), 'another scene'), 'a question following an interaction in another scene is caught');
$bad = $valid;
unset($bad['scenes'][0]['exits'][1]['look'], $bad['scenes'][0]['exits'][1]['x']);
$errors = BlueprintValidator::errors($bad, $lo);
check($has($errors, 'a door needs x') && $has($errors, 'a door needs look'), 'a door without a place or a look is caught');
$bad = $valid;
$bad['scenes'][1]['exits'][1]['x'] = 0.52;
check($has(BlueprintValidator::errors($bad, $lo), 'top-edge doorway'), 'a hole where the top doorway is is caught');
$bad = $valid;
$bad['scenes'][1]['exits'][] = ['edge' => 'right', 'to' => 'burrow'];
check($has(BlueprintValidator::errors($bad, $lo), 'Connect two scenes once'), 'two ways between the same scenes are caught');
// The bag: what is used comes from somewhere, is not used up twice, and says what is needed.
$bad = $valid;
$bad['interactions'][$at('get_hook')]['type'] = 'inspect';
$errors = BlueprintValidator::errors($bad, $lo);
check($has($errors, 'nothing puts "hook" into the bag'), 'putting together something nobody can pick up is caught');
$bad = $valid;
$bad['interactions'][$at('fish_battery')]['keeps'] = false;
$bad['interactions'][] = ['key' => 'fish_again', 'type' => 'use', 'scene' => 'burrow', 'label' => 'Another crack', 'x' => 0.2, 'uses' => 'grabber', 'hint' => 'Deep.', 'info' => ['title' => 'x', 'body' => 'y']];
check($has(BlueprintValidator::errors($bad, $lo), '"grabber" is used up by fish_battery and fish_again'), 'a thing used up before the second use that needs it is caught');
$bad = $valid;
unset($bad['interactions'][$at('fish_battery')]['hint']);
check($has(BlueprintValidator::errors($bad, $lo), 'fish_battery.hint'), 'a use that does not say what is needed is caught');
$bad = $valid;
$bad['interactions'][$at('give_battery')]['character'] = 'gran';
check($has(BlueprintValidator::errors($bad, $lo), 'a thing is given to a character where they are'), 'giving a thing to someone in another scene is caught');
$bad = $valid;
$bad['interactions'][$at('track')]['requires'] = ['talk_pip'];
$bad['interactions'][$at('fish_battery')]['requires'] = ['track'];
$bad['interactions'][$at('track')]['requires'][] = 'give_battery';
check($has(BlueprintValidator::errors($bad, $lo), 'can never'), 'a battery needed before it can be found deadlocks, and is caught');
$bad = $valid;
$bad['combinations'][0]['makes'] = 'crate';
check($has(BlueprintValidator::errors($bad, $lo), 'makes: "crate" is a prop'), 'making scenery from the bag is caught');
// Cutscenes: who is there, and nobody needed leaves.
$bad = $valid;
$bad['twists'][0]['cutscene'][] = ['who' => 'gran', 'do' => 'leave', 'edge' => 'left'];
check($has(BlueprintValidator::errors($bad, $lo), 'gran leaves for good'), 'someone who leaves before students can talk to them is caught');
$bad = $valid;
$bad['interactions'][$at('give_battery')]['cutscene'][] = ['who' => 'keeper', 'do' => 'say', 'text' => 'Hi'];
check($has(BlueprintValidator::errors($bad, $lo), 'keeper is in "landing", not in "hive"'), 'a cutscene with someone from another scene is caught');
$bad = $valid;
$bad['completion']['cutscene'][] = ['who' => 'keeper', 'do' => 'leave'];
check($has(BlueprintValidator::errors($bad, $lo), 'the guide never leaves'), 'the guide leaving is caught');
// Scenes: a far view only outdoors, a foreground clear of the way out, the floor clear of passages.
$bad = $valid;
$bad['scenes'][$at('greenhouse', 'scenes')]['distance'] = 'the sky';
check($has(BlueprintValidator::errors($bad, $lo), 'only an outdoor, up_high or underwater scene has a far view'), 'a far view behind a room is caught');
$bad = $valid;
$bad['scenes'][$at('greenhouse', 'scenes')]['foreground'] = ['look' => 'a wall', 'where' => 'bottom'];
check($has(BlueprintValidator::errors($bad, $lo), 'would wall off'), 'a foreground across the way out towards the viewer is caught');
$bad = $valid;
$bad['scenes'][$at('orchard', 'scenes')]['floor']['blocked'][0]['x'] = 0.25;
check($has(BlueprintValidator::errors($bad, $lo), 'in the way of the passage to "burrow"'), 'a pond on top of a hole is caught');
$bad = $valid;
$bad['scenes'][$at('orchard', 'scenes')]['ambient'][0]['motion'] = 'swims_by';
check($has(BlueprintValidator::errors($bad, $lo), 'only underwater things swim'), 'fish swimming through the air are caught');
$bad = $valid;
$bad['scenes'][$at('landing', 'scenes')]['floor']['right'] = 0.8;
check($has(BlueprintValidator::errors($bad, $lo), 'so the floor must reach it'), 'a floor that ends before the way out is caught');
$bad = $valid;
$bad['interactions'] = array_values(array_filter($bad['interactions'], fn ($it) => $it['key'] !== 'q_report'));
check($has(BlueprintValidator::errors($bad, $lo), 'debrief questions'), 'a mission without a debrief question is caught');
$bad = $valid;
$bad['steps'][2]['done_when'][] = 'q_report';
check($has(BlueprintValidator::errors($bad, $lo), 'is a debrief question'), 'a debrief question listed in a step is caught');
$bad = $valid;
foreach ($bad['interactions'] as &$it) {
    unset($it['resolves']);
}
unset($it);
check($has(BlueprintValidator::errors($bad, $lo), 'nothing sets it right'), 'a twist that blocks a way with nothing to set it right is caught');
$bad = $valid;
foreach ($bad['interactions'] as &$it) {
    if ($it['key'] === 'drain') {
        $it['scene'] = 'hive';
    }
}
unset($it);
check($has(BlueprintValidator::errors($bad, $lo), 'a twist blocks the way'), 'setting a twist right behind the way it blocks deadlocks, and is caught');
$bad = $valid;
$bad['interactions'][$at('q_predict')]['question']['purpose'] = 'check';
$bad['interactions'][$at('q_predict')]['question']['choices'][0]['correct'] = true;
check($has(BlueprintValidator::errors($bad, $lo), 'exactly one choice must be correct') === false, 'a prediction made a check with one right answer is fine');
$bad['interactions'][$at('q_predict')]['question']['choices'][1]['correct'] = true;
check($has(BlueprintValidator::errors($bad, $lo), 'exactly one choice must be correct'), 'and with two right answers is caught');
// Rescues: whoever falls is saved, never the guide; saved where they fell, not by being given something.
$bad = $valid;
unset($bad['interactions'][$at('save_pip')]['rescues']);
check($has(BlueprintValidator::errors($bad, $lo), 'bot falls, but nothing saves them'), 'someone who falls with nothing to save them is caught');
$bad = $valid;
$bad['scenes'][$at('landing', 'scenes')]['arrival'] = ['cutscene' => [['who' => 'keeper', 'do' => 'fall']]];
check($has(BlueprintValidator::errors($bad, $lo), 'the guide never falls'), 'the guide falling is caught');
$bad = $valid;
$bad['interactions'][$at('save_pip')]['character'] = 'bot';
check($has(BlueprintValidator::errors($bad, $lo), 'they are out of reach'), 'a rescue by giving the fallen one something is caught');
$bad = $valid;
$bad['interactions'][$at('talk_pip')]['requires'] = [];
check($has(BlueprintValidator::errors($bad, $lo), 'bot falls and is out of reach until saved'), 'talking to someone who has fallen is caught');
// The bag: everything in it is used.
$bad = $valid;
$bad['interactions'] = array_values(array_filter($bad['interactions'], fn ($it) => $it['key'] !== 'pollinate'));
$bad['steps'] = array_values(array_filter($bad['steps'], fn ($st) => $st['key'] !== 'carry'));
check($has(BlueprintValidator::errors($bad, $lo), '"pollen" goes into the bag (from pollen_a, pollen_b) but is never used'), 'a thing collected and never used is caught');
// Instruments: a goal the controls can reach, and not before they are moved.
$track = $at('track');
$bad = $valid;
$bad['interactions'][$track]['instrument']['goal'][0]['value'] = 30;
check($has(BlueprintValidator::errors($bad, $lo), 'no setting of sprays meets it'), 'a goal out of the slider\'s range is caught');
$bad = $valid;
$bad['interactions'][$track]['instrument']['controls'][0]['start'] = 2;
$bad['interactions'][$track]['instrument']['controls'][1]['start'] = 1;
check($has(BlueprintValidator::errors($bad, $lo), 'already met before students change anything'), 'a goal met from the start is caught');
$bad = $valid;
$bad['interactions'][$track]['instrument']['controls'][] = ['key' => 'wind', 'kind' => 'wheel', 'label' => 'Wind', 'options' => ['Calm', 'Breezy']];
$bad['interactions'][$track]['instrument']['goal'][] = ['control' => 'wind', 'op' => '>', 'value' => 'Stormy'];
$errors = BlueprintValidator::errors($bad, $lo);
check($has($errors, 'a wheel lands on an option; compare it with = or !='), 'a wheel compared as a number is caught');
$bad['interactions'][$track]['instrument']['goal'][3]['op'] = '=';
check($has(BlueprintValidator::errors($bad, $lo), '"Stormy" is not an option of the wheel wind'), 'and one that can never land there');
$bad['interactions'][$track]['instrument']['misses'][0]['when'][0]['control'] = 'nozzle';
check($has(BlueprintValidator::errors($bad, $lo), '"nozzle" is not one of its controls'), 'a miss about a control it does not have is caught');
// Pace, and an invented twist.
$bad = $valid;
$bad['pace'] = ['big_moment' => false];
check($has(BlueprintValidator::errors($bad, $lo), 'Nobody is in danger in this mission'), 'a fall in a mission that may not have a big moment is caught');
$bad = $valid;
$bad['scenes'][$at('orchard', 'scenes')]['arrival'] = ['cutscene' => [['who' => 'gran', 'do' => 'fall']]];
check($has(BlueprintValidator::errors($bad, $lo), 'Only one big tense moment in a mission'), 'two big moments are caught');
$bad = $valid;
$bad['twists'][0]['invented'] = false;
check($has(BlueprintValidator::errors($bad, $lo), 'at least one twist or turn is invented for this mission'), 'a mission with no invented twist is caught');
$bad['twists'][0] = ['invented' => true, 'title' => 'Fog rolls in'] + $bad['twists'][0];
check($has(BlueprintValidator::errors($bad, $lo), 'is one of the ideas you were given, not invented'), 'and one copied from the ideas');
$bad = $valid;
$bad['scenes'][$at('hive', 'scenes')]['details'] = array_fill(0, 6, ['x' => 0.5, 'label' => 'A rock', 'look' => 'a rock', 'text' => 'A rock.']);
check($has(BlueprintValidator::errors($bad, $lo), 'at most 5 things to look at'), 'too many details are caught');

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
same([isset($tidy['roles']), isset($byKey['read_humidity']['role']), isset($byKey['read_humidity']['share']), isset($byKey['reroute']['team']['roles'])], [false, false, false, false], 'crew roles are left out: every student can do everything');
same(array_column($tidy['characters'], 'height_cm', 'key'), ['keeper' => 175, 'bot' => 70, 'gran' => 150, 'pilot' => 180], 'characters keep their real heights');
$noHeight = $blueprint;
unset($noHeight['characters'][1]['height_cm']);
same(MissionDesigner::tidy($noHeight)['characters'][1]['height_cm'], Sizes::CHARACTER_CM, 'a character with no height gets an ordinary one');
same(BlueprintValidator::errors($tidy, $lo), [], 'the tidied blueprint is valid');
// Rescues, instruments, observations and details, tidied.
check(in_array('save_pip', $byKey['talk_pip']['requires'], true) && in_array('save_pip', $byKey['give_battery']['requires'], true), 'talking to Pip and giving him the battery wait until he is saved');
same(isset(array_column($tidy['characters'], null, 'key')['bot']['walks']), false, 'Pip, who falls, stays where he is until then');
$instrument = $byKey['track']['instrument'];
same([$instrument['controls'][0]['min'], isset($instrument['controls'][1]['options']), count($instrument['meters']), count($instrument['shows']), $instrument['shows'][2]['when'][1]['value']], [0, false, 1, 4, 3], 'an instrument\'s numbers are numbers, and what is left half-filled is dropped');
$cards = $byKey['look_flower']['info'];
same([count($cards['cards']), isset($cards['callout']), isset($cards['reveal'])], [2, false, true], 'flip cards and notes left empty are dropped');
same(array_column(array_column($tidy['scenes'], null, 'key')['hive']['details'], 'label'), ['Scarecrow'], 'a detail without a label is dropped');
$legacy = MissionDesigner::tidy([...$blueprint, 'interactions' => [['key' => 'old', 'type' => 'experiment', 'scene' => 'hive', 'label' => 'Old', 'experiment' => ['quantity' => 'pH', 'unit' => '', 'start' => 4, 'min' => 0, 'max' => 14, 'target' => 7, 'increase' => '+', 'decrease' => '-', 'success' => 'Neutral.']]]])['interactions'][0];
same([isset($legacy['experiment']), $legacy['instrument']['controls'][0]['kind'], $legacy['instrument']['goal'][0]], [false, 'slider', ['control' => 'value', 'op' => '=', 'value' => 7]], 'an older-style experiment becomes an instrument with one slider');
$wheel = MissionDesigner::tidy([...$blueprint, 'interactions' => [['key' => 'spin', 'type' => 'experiment', 'scene' => 'hive', 'label' => 'Spin', 'instrument' => ['controls' => [['key' => 'w', 'kind' => 'wheel', 'label' => 'Wind', 'options' => ['North|ish', 'South, really', ' ']]], 'goal' => [], 'test' => 'Go', 'success' => 'Yes']]]])['interactions'][0]['instrument']['controls'][0]['options'];
same($wheel, ['North ish', 'South  really'], 'a wheel\'s options lose the characters that separate them');

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
same([Sizes::depth(800, 800), Sizes::depth(1200, 800)], [Sizes::DEPTH_BACK, Sizes::DEPTH_FRONT], 'things are drawn smaller at the back of the floor than at its front');
check(abs(MissionBuilder::characterScale(['height_cm' => 130]) * (AssetDirector::CELL_H - 30) - Sizes::PERSON_PX) < 1, 'a 130 cm character is drawn as tall as a child explorer');
check(MissionBuilder::characterScale(['height_cm' => 70]) < MissionBuilder::characterScale(['height_cm' => 130]) && MissionBuilder::characterScale(['height_cm' => 180]) > MissionBuilder::characterScale(['height_cm' => 130]), 'a small robot is smaller, a grown-up taller');
same(AssetDirector::frame(['width' => 'wide']), ['21:9', 3600, 1543, 343], 'a wide scene is drawn wider and keeps its bottom');
same(AssetDirector::frame([]), ['16:9', 2250, 1266, 33], 'a normal one is cut about its middle');
$notes = AssetDirector::scaleNotes(['ground_line' => 0.7]);
check(str_contains($notes[0], 'SCALE: a 130 cm child standing at the back of the floor is 16% of the picture') && str_contains($notes[0], 'a doorway is about 26%'), 'a background is told how big people and things are in it: '.$notes[0]);
same($notes[1], 'The walkable floor starts 69% of the way down the picture and fills everything below that line', 'and where the floor is, in the picture as it is drawn');
$mark = ImageTools::questionMark(54);
same(imagesy($mark), 54, 'the question mark over things to click is drawn in code, small');
check(ImageTools::hasTransparentBackground($mark) && ImageTools::clearShare($mark) > 0.4, 'on nothing: it floats over the scene');
$guide = ImageTools::scaleGuide(800, 450, 300, 100, fn ($y) => 1.0);
same([imagesx($guide), imagesy($guide)], [800, 450], 'a scale guide is drawn the shape of the background');
same(imagecolorat($guide, 400, 440) & 0xFF, 196, 'with the floor as a grey band');
$tall = imagecreatetruecolor(100, 200);
imagefilledrectangle($tall, 0, 0, 100, 100, imagecolorallocate($tall, 255, 0, 0));
imagefilledrectangle($tall, 0, 100, 100, 200, imagecolorallocate($tall, 0, 0, 255));
same(imagecolorat(ImageTools::cover($tall, 100, 100, 1.0), 50, 10) & 0xFF, 255, 'cut to keep its bottom, a picture keeps its bottom');

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
same($http->sent[0]['body']['system'][0]['cache_control'] ?? null, ['type' => 'ephemeral'], 'the instructions are marked for the prompt cache');
same(array_column(AnthropicModel::parts(['a', ['cache' => true], 'b']), 'cache_control'), [['type' => 'ephemeral']], 'a cache mark goes on the part before it');
$meter = new Spend(0, ['claude-test' => ['input' => 4, 'output' => 20, 'cache_read' => 0.2, 'cache_write' => 5]]);
$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{}']], 'stop_reason' => 'end_turn', 'usage' => ['input_tokens' => 1000, 'output_tokens' => 10000, 'cache_read_input_tokens' => 20000, 'cache_creation_input_tokens' => 0]]))]);
(new AnthropicModel($http, 'key', 'claude-test', 'https://api.anthropic.com', $meter))->structured('sys', ['x'], 'answer', ['type' => 'object']);
same($meter->total(), 0.208, 'every call\'s tokens are priced: input, output and cache reads');
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
$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{}']], 'stop_reason' => 'end_turn']))]);
(new AnthropicModel($http, 'key'))->structured('sys', ['x'], 'answer', ['type' => 'object'], 32000);
same([$http->sent[0]['body']['max_tokens'], isset($http->sent[0]['body']['output_config']['effort'])], [64000, false], 'room to think is added to the answer\'s limit, and no effort is sent unless set');
$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{}']], 'stop_reason' => 'end_turn']))]);
(new AnthropicModel($http, 'key', thinkingRoom: 200000, effort: 'low'))->structured('sys', ['x'], 'answer', ['type' => 'object'], 32000);
same([$http->sent[0]['body']['max_tokens'], $http->sent[0]['body']['output_config']['effort'] ?? null, isset($http->sent[0]['body']['output_config']['format'])], [128000, 'low', true], 'the limit stops at the model\'s most, and the effort goes beside the format');
$http = new Recorded([
    new HttpResponse(400, json_encode(['type' => 'error', 'error' => ['type' => 'invalid_request_error', 'message' => 'The compiled grammar is too large']])),
    new HttpResponse(200, json_encode(['content' => [['type' => 'thinking', 'thinking' => '', 'signature' => 's']], 'stop_reason' => 'max_tokens'])),
]);
check((function () use ($http) {
    try {
        (new AnthropicModel($http, 'key', effort: 'high'))->structured('sys', ['x'], 'thinker_answer', ['type' => 'object'], 1000);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'spent it all thinking') && str_contains($e->getMessage(), 'QBL_GEN_THINKING_TOKENS');
    }

    return false;
})(), 'running out while still thinking says so, and what to change');
same($http->sent[1]['body']['output_config'] ?? null, ['effort' => 'high'], 'the tool route sends the effort too');
check((function () {
    try {
        new AnthropicModel(new Recorded([]), 'key', effort: 'loud');
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'QBL_GEN_LLM_EFFORT');
    }

    return false;
})(), 'an unknown effort is refused at once');

$http = new Recorded([new HttpResponse(200, json_encode(['candidates' => [['content' => ['parts' => [['text' => 'here'], ['inlineData' => ['mimeType' => 'image/png', 'data' => base64_encode($png)]]]]]]]))]);
same((new GeminiImageGenerator($http, 'gkey', 'gemini-test'))->generate('draw', [$ref], '21:9', false), $png, 'Gemini\'s picture is read from inlineData');
same($http->sent[0]['body']['generationConfig']['imageConfig']['aspectRatio'], '21:9', 'Gemini is asked for the aspect ratio in imageConfig');
same(array_keys($http->sent[0]['body']['contents'][0]['parts'][1]), ['inline_data'], 'references go to Gemini inline');
check(str_ends_with($http->sent[0]['url'], '/models/gemini-test:generateContent'), 'Gemini is called at generateContent');
$http = new Recorded([new HttpResponse(200, json_encode(['candidates' => [['content' => ['parts' => [['inlineData' => ['data' => base64_encode($png)]]]]]]])), new HttpResponse(200, json_encode(['candidates' => [['content' => ['parts' => [['inlineData' => ['data' => base64_encode($png)]]]]]]]))]);
$gemini = new GeminiImageGenerator($http, 'gkey', 'gemini-3-pro-image', 'https://g', '2K', 'gemini-3.1-flash-image', '1K');
$gemini->generate('draw', [], '1:1', false, ['kind' => 'sheet']);
$gemini->generate('draw', [], '16:9', false, ['kind' => 'background']);
same([str_contains($http->sent[0]['url'], 'gemini-3.1-flash-image'), $http->sent[0]['body']['generationConfig']['imageConfig']['imageSize'], str_contains($http->sent[1]['url'], 'gemini-3-pro-image'), $http->sent[1]['body']['generationConfig']['imageConfig']['imageSize']], [true, '1K', true, '2K'], 'small cut-outs go to the cheaper model at 1K, backgrounds to the main one at 2K');
same($gemini->pricing(['kind' => 'item', 'anchor' => true])[0], 'gemini-3-pro-image', 'anchors are always drawn with the main model');
same([round((new Spend)->pictureCost('gemini-3.1-flash-image', '1K'), 3), round((new Spend)->pictureCost('gemini-3-pro-image-preview', '2K'), 3), (new Spend)->pictureCost('placeholder', null)], [0.067, 0.134, 0.0], 'pictures are priced by model and size');

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
/** Records every line instantly, as a few frames of MP3 with each word 300 ms. */
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
$voices = new FakeVoices;
$speech = new SpeechFactory(['voices' => __DIR__.'/../resources/speech/voices.json'], null, $voices);
$factory = new GenerationFactory($config, $store, new NoNetwork, $model, speech: $speech);
check((function () use ($factory) {
    try {
        $factory->generator(['images' => 'gemini']);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'anchor');
    }

    return false;
})(), 'a real image driver is refused while the style has no approved anchors');

$log = [];
$generator = $factory->generator(['images' => 'placeholder', 'survey' => true], function ($m) use (&$log) {
    $log[] = $m;
});
$result = $generator->generate('A mission about why an orchard has flowers but no fruit, for grade 3', ['grade' => '3', 'subject' => 'Science', 'frameworks' => ['TEST-SCI'], 'min_players' => 2, 'max_players' => 6], null);
same($result['status'], 'done', 'the run finishes');
same([$model->blueprints, $model->corrections], [1, 1], 'the blueprint with a mistake was corrected once, by changes rather than a rewrite');
$correction = array_values(array_filter($model->calls, fn ($c) => $c['name'] === 'blueprint_changes'))[0];
check(str_contains(json_encode($correction['content']), 'two correct') || str_contains(json_encode($correction['content']), 'exactly one choice'), 'the correction is told what is wrong');
same($correction['content'][1], ['cache' => true], 'with the brief marked for the prompt cache');
$alignmentCall = $model->calls[0];
check(in_array('TEST-3-LS1-1', $alignmentCall['schema']['properties']['standards']['items']['properties']['code']['enum'], true) && ! in_array('TEST-5-PS1-1', $alignmentCall['schema']['properties']['standards']['items']['properties']['code']['enum'], true), 'only standards of the grade are offered, as an enum');
$run = (new GenerationRuns($pdo))->get($result['run']);
same(array_column($run['alignment']['standards'], 'code'), ['TEST-3-LS1-1'], 'a standard that was not offered is dropped');
same($run['status'], 'done', 'the run is recorded as done');

// ------------------------------------------------------------------ progress, for the editor's bar
$reports = array_map(fn ($r) => ['status' => $r['status']] + json_decode($r['progress'], true), $pdo->query('SELECT status, progress FROM progress_log WHERE run = '.(int) $result['run'].' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
$stagesSeen = array_values(array_unique(array_column($reports, 'stage')));
same($stagesSeen, ['aligning', 'designing', 'drawing', 'building', 'voicing', 'importing'], 'progress goes through every stage in order (voicing too, with voices set up)');
same($reports[0]['stages'], $stagesSeen, 'and says from the start which stages there will be');
same(array_column($reports, 'status'), array_column($reports, 'stage'), 'the run\'s status follows the stage');
$percents = array_column($reports, 'percent');
check($percents === array_values(array_filter($percents, fn ($p, $i) => $i === 0 || $p >= $percents[$i - 1], ARRAY_FILTER_USE_BOTH)), 'the bar never goes backwards');
same((float) end($percents), 100.0, 'and ends full');
$drawing = array_values(array_filter($reports, fn ($r) => $r['stage'] === 'drawing' && $r['total'] !== null));
$estimate = $factory->director("$work/estimate-only")->estimate($run['blueprint']);
same(end($drawing)['total'], $estimate['pictures'], 'drawing is counted in the pictures the estimate expects');
same([end($drawing)['done'], end($drawing)['detail']], [$estimate['pictures'], 'All the pictures are drawn'], 'and finishes at all of them');
$details = implode("\n", array_column($reports, 'detail'));
foreach (['Drawing Keeper Ama (character 1 of 4)', 'Drawing the props:', 'Painting Orchard Landing (scene 1 of', 'Painting the far view behind Blue Orchard', 'Drawing the foreground of Root Burrow', 'Looking over Orchard Landing for where people can walk', 'Recording line 1 of', 'Fixing 1 problem in the design (round 1)'] as $said) {
    check(str_contains($details, $said), "progress says what it is doing: \"$said\"");
}
check(count(array_unique(array_column($drawing, 'done'))) > 5, 'and moves picture by picture, not only stage by stage');

$scenarioId = $result['scenario_id'];
$scenario = $store->scenario($scenarioId);

// The characters' voices.
$built = $store->bundle($scenarioId);
$given = array_column(array_map(fn ($c) => ['name' => $c['name'], 'voice' => $c['settings']['tts_voice'] ?? null], $built['characters']), 'voice', 'name');
same(count(array_filter($given)), 4, 'every character is given a voice');
same(count(array_unique($given)), 4, 'a different one each');
$voiceCatalog = $speech->catalog();
same($voiceCatalog->get($given['Pip'])['gender'] ?? null, 'neutral', 'the robot sounds like one');
$spoken = array_filter($built['actions'], fn ($a) => $a['type'] === 'dialogue' && ($a['params']['speaker'] ?? '') === 'character');
$voicedLines = array_filter($spoken, fn ($a) => isset($a['params']['narration_media_id']));
$unvoiced = array_filter($spoken, fn ($a) => ! isset($a['params']['narration_media_id']));
check(count($voicedLines) >= 5, 'the characters\' lines are recorded ('.count($voicedLines).' of '.count($spoken).')');
check(! array_filter($unvoiced, fn ($a) => ! preg_match('/\{\{(?!\s*QL_PlayerName)/', (string) $a['params']['text'])), 'every line left to the browser shows a variable that is only known in play');
check(! array_filter($voices->said, fn ($s) => str_contains($s[0], '{{')), 'no placeholder is ever said');
$mediaById = array_column($built['media'], null, 'id');
$aLine = array_values($voicedLines)[0];
$rec = $mediaById[$aLine['params']['narration_media_id']] ?? null;
same([$rec['type'] ?? null, $rec['params']['speech']['engine'] ?? null, $aLine['params']['narrate'] ?? null], ['audio', 'kokoro', true], 'a line plays its recording, which keeps its word timings');
check(is_file("$work/media/".$rec['filepath']), 'and the recording is stored with the scenario');
check(in_array('Recording the characters\' lines (kokoro)', $log, true), 'the run says it records the lines');
same($scenario['title'], 'The Quiet Hive', 'the scenario is imported');
same(strlen($scenario['code']), 16, 'it has its own code');
same($scenario['settings']['visibility'] ?? null, 'private', 'it is a private draft');
same($scenario['published_at'] ?? null, null, 'it is not published');
$doc = $store->compile($scenarioId);
same(count($doc['scenes']), 5, 'every scene is there');
same($doc['scenes'][0]['shortname'], 'landing', 'the start scene comes first');
same($doc['start_scene_id'], $doc['scenes'][0]['id'], 'the start scene is set');
same(count($doc['characters']), 4, 'every character is there');
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
same(array_column($collect['labels'], 'type'), ['image', 'image', 'text'], 'a collect shows its item, a question mark over it and its name');
$markerId = array_values(array_filter($doc['assets'], fn ($m) => $m['filename'] === 'marker.png'))[0]['id'] ?? null;
same([$collect['labels'][1]['media'], $collect['labels'][1]['placement'] ?? null], [$markerId, 'front'], 'the question mark is the quiet one drawn in code, over everything');
check($collect['labels'][1]['position_y'] < $collect['labels'][0]['position_y'], 'just above the thing');
same($collect['labels'][2]['show_near'] ?? null, MissionBuilder::HINT_NEAR, 'its name shows only near it (or under the pointer)');
same(array_column($byShort['orchard/q_pollen']['labels'], 'type'), ['image', 'text'], 'a question without an item is only a question mark over the background, and its name');
same($byShort['orchard/q_pollen']['labels'][0]['media'], $markerId, 'the same question mark');
$pulsing = [];
foreach ($doc['scenes'] as $scene) {
    foreach ($scene['hotspots'] as $h) {
        foreach ($h['labels'] as $l) {
            if (! empty($l['pulse'])) {
                $pulsing[] = $h['shortname'];
            }
        }
    }
}
same($pulsing, [], 'nothing pulses');
$prompts = array_column($run['manifest'], 'prompt', 'key');
check(str_contains($prompts['bg:landing'], 'SCALE: a 130 cm child') && str_contains($prompts['bg:landing'], 'SCALE GUIDE'), 'every background is told, and shown, how big people are in it');
check(str_contains($prompts['bg:landing'], 'an old stone sundial with a snail asleep on top of it'), 'and paints in what students look at that has no object of its own');
check(str_contains($prompts['bg:landing'], 'The floor ends 6% of the way from the left'), 'and where the floor ends');
check(str_contains($prompts['bg:orchard'], 'a small round pond with lily pads') && str_contains($prompts['bg:orchard'], 'The sky above the scenery is a perfectly flat, solid #FF00FF'), 'the orchard paints its pond, and leaves its sky to be cut out');
check(str_contains($prompts['far:orchard'] ?? '', 'rolling blue hills') && str_contains($prompts['fg:burrow'] ?? '', 'thick twisted tree roots'), 'its far view and the burrow\'s roots are drawn on their own');
check(isset($prompts['ambient:landing:finch:rest'], $prompts['ambient:landing:finch:up']), 'the finch is drawn resting and flying');
check(! isset($prompts['marker']), 'the question mark is not drawn by the image model');
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
same([$scopes['done_pollen_a'], $scopes['done_read_humidity'], $scopes['has_pollen'], $scopes['away_pilot']], ['player', 'player', 'player', 'room'], 'each student does every task and carries their own bag; someone who leaves has left for everyone');
same(array_filter(array_keys($scopes), fn ($v) => preg_match('/^(my_role|role_name|crew_|found_|did_)/', $v)), [], 'there are no crew roles');

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

$runs = fn (array $e) => array_column(array_filter($e['actions'], fn ($a) => $a['type'] === 'run_event'), 'target_event_id');

// No crew roles: every student can do everything.
check(! in_array('role', array_column($doc['objectives'], 'id'), true) && ! isset($byShort['landing/crew-station']), 'there is no crew station and no role to choose');
check(! array_filter($byShort['greenhouse/read_humidity']['conditions'] ?? [], fn ($c) => $c['variable'] === 'my_role'), 'anyone can read the gauge');
same(array_column($doc['objectives'], 'text', 'id')['power'], 'Get Pip some power ({{count_power}}/3)', 'a step can count a combination');

// The bag: things carried, put together, used and given.
$itemsByName = array_column($doc['items'], null, 'name');
$grabber = $itemsByName['Hook on a string'] ?? null;
same([$grabber['carried_when'] ?? null, $grabber['description'] ?? null], [[['variable' => 'has_grabber', 'operator' => '>', 'operand' => 0]], 'Good for fishing things out of tight spots.'], 'a thing that can be carried is in the bag while its variable says so, with what it is');
check(isset($itemsByName['Pollen sample']['carried_when'], $itemsByName['Robot battery']['carried_when']) && ! isset($itemsByName['Supply crate']['carried_when']), 'collected and given things are carried; scenery is not');
check(in_array('has_twine', array_column(array_filter($byShort['greenhouse/get_twine']['actions'], fn ($a) => $a['type'] === 'variable'), 'name'), true) && str_contains(json_encode($byShort['greenhouse/get_twine']['actions']), 'Added to your bag: Garden twine'), 'a collected thing goes into the bag, and the student is told');
same(count($doc['combinations'] ?? []), 2, 'two things can be put together');
$combo = array_values(array_filter($doc['combinations'], fn ($c) => str_contains(json_encode($c['actions']), 'has_grabber')))[0];
same($combo['items'], [$itemsByName['Bent hook']['id'], $itemsByName['Garden twine']['id']], 'the hook and the twine');
$set = array_column(array_filter($combo['actions'], fn ($a) => $a['type'] === 'variable' && $a['operator'] === 'set'), 'operand', 'name');
same($set, ['has_hook' => 0, 'has_twine' => 0, 'has_grabber' => 1, 'done_make_grabber' => 1], 'are used up, and make the hook on a string');
check(in_array('count_power', array_column($combo['actions'], 'name'), true) && str_contains(json_encode($combo['actions']), 'a hook on a string!'), 'which counts for its step and says what happened');
$fish = $byShort['burrow/fish_battery-use'];
same($fish['conditions'][0], ['id' => $fish['conditions'][0]['id'], 'event_id' => $fish['id'], 'type' => 'variable', 'variable' => 'QL_Holding', 'operator' => '=', 'operand' => $grabber['id']], 'a use takes the thing it needs from the bag');
same($fish['labels'], [], 'it shows nothing of its own');
check(! in_array('has_grabber', array_column($fish['actions'], 'name'), true), 'a thing that is kept stays in the bag');
check(in_array('has_battery', array_column($fish['actions'], 'name'), true), 'and what it finds goes into the bag');
same(array_column($byShort['burrow/fish_battery']['labels'], 'type'), ['image', 'text'], 'without the thing, the crack is a question mark');
same([$byShort['burrow/fish_battery']['actions'][0]['type'], $byShort['burrow/fish_battery']['actions'][0]['text']], ['text_overlay', 'Something shiny is stuck deep in the crack, too far down for fingers.'], 'that says what is needed');
check(isset($byShort['burrow/fish_battery-done']), 'and afterwards it is still there to see');
$chatBot = $byShort['hive/chat-bot'];
$giveRun = array_values(array_filter($chatBot['actions'], fn ($a) => ($a['target_event_id'] ?? null) === ($byShort['hive/give-give_battery']['id'] ?? -1)))[0] ?? null;
check($giveRun && in_array(['QL_Holding', '=', $itemsByName['Robot battery']['id']], array_map(fn ($c) => [$c['variable'], $c['operator'], $c['operand']], $giveRun['conditions']), true), 'Pip takes the battery when it is given to him');
check(str_contains(json_encode($chatBot['actions']), 'That is not what I need') && str_contains(json_encode($chatBot['actions']), 'my battery is flat'), 'anything else he turns down, and he says what he needs');
$give = $byShort['hive/give-give_battery'];
check(in_array('has_battery', array_column($give['actions'], 'name'), true), 'the battery leaves the bag');
$cutsceneId = array_values(array_filter(array_column(array_filter($give['actions'], fn ($a) => $a['type'] === 'run_event'), 'target_event_id'), fn ($id) => str_starts_with(array_values(array_filter($byShort, fn ($e) => $e['id'] === $id))[0]['shortname'] ?? '', 'cutscene-')))[0] ?? null;
$cutscene = array_values(array_filter($byShort, fn ($e) => $e['id'] === $cutsceneId))[0] ?? null;
same(array_column($cutscene['actions'] ?? [], 'type'), ['freeze', 'animate', 'walk', 'dialogue', 'freeze'], 'then a little scene: Pip spins, rolls over and says so');
same([$cutscene['audience'] ?? null, $cutscene['actions'][1]['animation'] ?? null], ['scene', 'spin'], 'everyone there sees it');
check(in_array('done_give_battery', array_column($byShort['hive/track']['conditions'], 'variable'), true), 'the timer needs Pip powered up');

// Scenes with depth: a wide one with a far view, foregrounds, a pond, smaller at the back.
$scenesByName = array_column($doc['scenes'], null, 'shortname');
$orchard = $scenesByName['orchard'];
same([$orchard['width'], count($orchard['background_media'])], [3600, 4], 'the orchard is wide, with two bands of clouds and a far view behind it');
$far = $orchard['background_media'][2];
check(($far['parallax'] ?? 1) < 1 && ($far['parallax'] ?? 0) > 0 && $far['display_width'] >= 2400 + (3600 - 2400) * $far['parallax'] - 1, 'which drifts slower than the scene and is wide enough to: '.json_encode($far));
check(str_ends_with($assetById[$far['media_id']]['filename'], '.png') && ! empty($far['sky']), 'under a living sky, the far view is a PNG with its sky cut out, and takes on the sky\'s light');
$nearPic = $assetById[$orchard['background_media'][3]['media_id']];
check(str_ends_with($nearPic['filename'], '.png'), 'the scene in front of it is a PNG, its sky cut out');
same(count($orchard['blocked_areas']), 1, 'nobody walks through the pond');
$pondXs = array_column($orchard['blocked_areas'][0], 'x');
$pondYs = array_column($orchard['blocked_areas'][0], 'y');
check(! array_filter($orchard['spawn_points'], fn ($p) => $p['position_x'] > min($pondXs) && $p['position_x'] < max($pondXs) && $p['position_y'] > min($pondYs) && $p['position_y'] < max($pondYs)), 'nobody arrives in it');
check(! array_filter($orchard['characters'], fn ($p) => $p['position_x'] > min($pondXs) && $p['position_x'] < max($pondXs) && $p['position_y'] > min($pondYs) && $p['position_y'] < max($pondYs)), 'nobody stands in it');
same([$orchard['scale_areas'][0]['scale_top'], $orchard['scale_areas'][0]['scale_bottom']], [90, 108], 'figures are smaller at the back of the floor');
$landing = $scenesByName['landing'];
same([count($landing['foreground_media']), $landing['foreground_media'][0]['position_x']], [1, 0], 'the landing has a fern in front, in the left corner');
check($landing['walkable_areas'][0][0]['x'] > 0, 'its floor ends before the left edge');
$burrow = $scenesByName['burrow'];
$roots = $burrow['foreground_media'][0];
same([$roots['position_x'], $roots['display_width'], $roots['position_y'] + $roots['display_height']], [0, 2250, 1200], 'roots run along the bottom of the burrow');
$burrowBottom = max(array_column($burrow['walkable_areas'][0], 'y'));
check($burrowBottom < 1200 && $burrowBottom > $roots['position_y'], 'students can walk behind them, but not out of sight');
$hive = $scenesByName['hive'];
same($hive['foreground_media'][0]['position_x'] + $hive['foreground_media'][0]['display_width'], 2250, 'a bush stands in the hive\'s right corner');
$door = $byShort['landing/way-greenhouse'];
same(array_column($door['labels'], 'type'), ['text'], 'a door is painted into the background: its hotspot has no picture of its own');
same($door['labels'][0]['show_near'] ?? null, MissionBuilder::HINT_NEAR, 'and says where it goes only near it');

// A little life.
$crittersOf = fn (string $scene) => array_column($scenesByName[$scene]['critters'] ?? [], null, 'name');
$finch = $crittersOf('landing')['finch'] ?? null;
check($finch !== null && ! isset($byShort['landing/ambient-finch']), 'a finch visits the landing, as a critter of the scene (not a scripted event)');
same([$finch['behavior'] ?? null, count($finch['spots'] ?? []), $finch['shy'] ?? 'default'], ['lands', 3, 'default'], 'landing on one of three spots on the floor, and shy');
$finchSheet = $assetById[$finch['media_id']];
same(array_column($finchSheet['animations'] ?? [], 'name'), ['idle', 'move'], 'its picture sits still or flaps');
same(($finch['animations'] ?? [])['fly'] ?? null, 'move', 'and it flies with its move');
same([$crittersOf('orchard')['moths']['behavior'] ?? null, $crittersOf('burrow')['beetle']['behavior'] ?? null], ['flies_by', 'walks_by'], 'moths flit through the orchard and a beetle crosses the burrow');
$squirrel = $crittersOf('orchard')['squirrel'] ?? null;
$squirrelSheet = $squirrel ? $assetById[$squirrel['media_id']] : null;
check($squirrel !== null && $squirrel['behavior'] === 'climbs' && in_array('hop', array_column($squirrelSheet['animations'] ?? [], 'name'), true), 'a ready-made squirrel from the asset library runs about the orchard, with its own animations');
check(! isset($prompts['ambient:orchard:squirrel:up']) && ($squirrel['scale'] ?? 0) > 0, 'and is not drawn: it is scaled to its size');
check(isset($byShort['landing/sundial']) && ! array_filter($byShort['landing/sundial']['labels'], fn ($l) => $l['type'] === 'image' && $l['media'] !== $markerId), 'a fun thing to look at is painted in, with only a question mark over it');

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
check(! str_contains(json_encode($report['actions']), 'crew log'), 'there is no crew log to read');
$finale = $byShort['landing/finale'];
check(str_contains(json_encode($finale['actions']), 'cutscene-finale') || (bool) array_filter($byShort, fn ($e, $k) => str_starts_with($k, 'landing/cutscene-finale') && in_array($e['id'], $runs($finale), true), ARRAY_FILTER_USE_BOTH), 'the ending has a little scene');
$goodbye = array_values(array_filter($byShort, fn ($e, $k) => str_starts_with($k, 'landing/cutscene-finale'), ARRAY_FILTER_USE_BOTH))[0];
same(array_column($goodbye['actions'], 'type'), ['freeze', 'dialogue', 'walk', 'variable', 'freeze'], 'the pilot calls everyone aboard and walks off');
same(array_column($doc['characters'], 'conditions', 'name')['Captain Zee'][0]['variable'] ?? null, 'away_pilot', 'and is gone after');
same(array_column(array_filter($doc['curriculum']['evidence'][1]['evidence'], fn ($e) => $e['type'] === 'prediction'), 'answer'), ['q_q_predict_answer'], 'a prediction\'s answer is kept for the teacher');

$quiet = 0;
foreach ($doc['scenes'] as $scene) {
    foreach ($scene['hotspots'] as $h) {
        foreach ($h['labels'] as $l) {
            $quiet += ($l['pulse'] ?? null) === false ? 1 : 0;
        }
    }
}
check($quiet > 20, 'every label says so, so none pulses whatever an older client does by default');

// Arriving at the hive: Pip slips off the edge, for everyone, once; he is pulled back up with a pulley.
same([$scopes['arrival_hive'] ?? null, $scopes['away_bot'] ?? null, $scopes['saved_save_pip'] ?? null], ['room', 'room', 'room'], 'arriving, falling and being saved are shared');
$arrival = $byShort['hive/arrival'];
same([$arrival['audience'] ?? null, $arrival['actions'][0]['name'], $arrival['actions'][1]['text']], ['scene', 'arrival_hive', 'Look out!'], 'what happens on arriving is shown to everyone there, once');
check(in_array($arrival['id'], $runs($byShort['hive/arrive']), true), 'and set off by arriving');
$fall = array_values(array_filter($byShort, fn ($e, $k) => str_starts_with($k, 'hive/arrival-'), ARRAY_FILTER_USE_BOTH))[0] ?? null;
same(array_column($fall['actions'] ?? [], 'type'), ['freeze', 'dialogue', 'walk', 'animate', 'dialogue', 'variable', 'freeze'], 'Pip says hello, rolls to the edge, slips, cries out and is gone');
same(array_column($doc['characters'], 'conditions', 'name')['Pip'][0]['variable'] ?? null, 'away_bot', 'out of sight while he is away');
$saveConditions = array_map(fn ($c) => [$c['variable'], $c['operator'], $c['operand']], $byShort['hive/save_pip-use']['conditions']);
check(in_array(['away_bot', '=', 1], $saveConditions, true) && in_array(['saved_save_pip', '=', 0], $saveConditions, true), 'the rescue is there while he is in trouble');
check(! isset($byShort['hive/save_pip-done']), 'and gone afterwards: its picture is of Pip hanging on');
$saved = array_column(array_filter($byShort['hive/save_pip-use']['actions'], fn ($a) => $a['type'] === 'variable'), 'operand', 'name');
same([$saved['saved_save_pip'] ?? null, $saved['away_bot'] ?? null, $saved['has_pulley'] ?? null], [1, 0, 0], 'saving him brings him back, for everyone, and uses up the pulley');
same(array_column($doc['objectives'], 'complete_when', 'id')['save'][0]['variable'] ?? null, 'saved_save_pip', 'whoever saved him, he is saved for the whole team');

// The sprinkler timer: its controls side by side, saved as they are left; tested until it works.
same([$scopes['c_track_sprays'], array_column($doc['global_variables'], 'default_value', 'variable_name')['c_track_sprays'], array_column($doc['global_variables'], 'default_value', 'variable_name')['c_track_power']], ['player', 24, 0], 'each control is a variable of its own, starting where it starts');
$box = $byShort['hive/experiment-track-loop']['actions'][1];
check($box['type'] === 'infobox' && $box['size'] === 'large' && $box['dismissible'] === false, 'the instrument is a big box that stays until students step away');
check(str_contains($box['content'], '<div data-qbl="panel"><input data-qbl="slider" data-var="c_track_sprays" data-min="0" data-max="24" data-step="1" data-value="{{c_track_sprays}}"'), 'a slider for the sprays, as it was left: '.$box['content']);
check(str_contains($box['content'], 'data-qbl="switch" data-var="c_track_power"') && str_contains($box['content'], 'data-qbl="meter" data-var="c_track_sprays"'), 'a power switch and a meter beside it');
check(str_contains($box['content'], '<div data-qbl="when" data-when="c_track_sprays &gt;= 2; c_track_sprays &lt;= 3"><p>🌳 Trees watered, hive dry.</p></div>'), 'what it shows as the controls move');
same(array_column($box['call_to_actions'], 'text'), ['Run the timer', 'Step away'], 'a test button and a way out');
$loop = $byShort['hive/experiment-track-loop']['actions'];
$done = array_values(array_filter($loop, fn ($a) => $a['type'] === 'variable' && $a['name'] === 'done_track'))[0];
same(array_map(fn ($c) => [$c['variable'], $c['operator'], $c['operand']], $done['conditions']), [['menu_track', '=', 2], ['c_track_sprays', '>=', 2], ['c_track_sprays', '<=', 3], ['c_track_power', '=', 1]], 'done when tested with the goal\'s settings');
same(count(array_filter($loop, fn ($a) => $a['type'] === 'infobox' && str_contains($a['content'], 'Not yet'))), 4, 'each miss says why, and anything else gets a nudge');
same(end($loop)['type'], 'repeat', 'and the box opens again');

// Rich observations; things only to look at.
$flower = array_values(array_filter($byShort['orchard/look_flower']['actions'], fn ($a) => $a['type'] === 'infobox'))[0];
check($flower['size'] === 'large' && substr_count($flower['content'], 'data-qbl="flip"') === 2 && str_contains($flower['content'], '<details><summary>Why are there no fruit?</summary>') && str_contains($flower['content'], 'src="{{media:'), 'a flower up close: its picture, flip cards and a card that opens');
$boot = $byShort['landing/detail-0'];
same([$boot['labels'][0]['type'], $boot['labels'][0]['text'], $boot['labels'][0]['show_near'] ?? null, $boot['actions'][0]['type'], $boot['actions'][0]['style']], ['text', 'Old boot', MissionBuilder::HINT_NEAR, 'dialogue', 'bubble'], 'a thing to look at: its name near it, and what the student notices in a bubble');
check(! array_filter($boot['labels'], fn ($l) => $l['type'] === 'image'), 'with no question mark: it is only to look at');
check(str_contains($prompts['bg:landing'], 'a muddy old boot with a daisy growing out of it'), 'painted into the background');

// Living skies, clouds, lights and the air.
$itemsById = array_column($doc['items'], null, 'id');
$tidied = array_column($tidy['scenes'], null, 'key');
same([$tidied['orchard']['sky'], $tidied['greenhouse']['sky'] ?? null, array_column($tidied['orchard']['atmosphere'], 'kind'), count($tidied['landing']['lights']), $tidied['hive']['lights'][0]['color'] ?? null],
    [['time' => 'afternoon', 'clouds' => 'many'], null, ['leaves'], 1, null], 'tidied: a sky that does not change has no until, an indoor scene has no sky, no repeats or unknown kinds, a colour that is not one is dropped');
$hive = $scenesByName['hive'];
same($hive['sky'], ['time' => 'golden', 'until' => 'dusk', 'minutes' => 10, 'horizon' => 0.6, 'sun_x' => 0.72, 'shade' => 60], 'the hive terrace\'s sun sets slowly from golden hour to dusk');
same([$hive['background_media'][0]['tile'] ?? false, $hive['background_media'][0]['sky'] ?? false, $hive['background_media'][0]['scroll_speed_x'] ?? 0, $hive['background_media'][0]['parallax'] ?? 1], [true, true, 7, 0.06], 'clouds drift across it, repeating, taking on its light');
same($assetById[$hive['background_media'][0]['media_id']]['width'] ?? null, AssetDirector::CLOUDS_WIDTH, 'one band of clouds for the whole mission');
check(str_ends_with($assetById[end($hive['background_media'])['media_id']]['filename'], '.png'), 'the terrace in front has its sky cut out');
same($hive['atmosphere'], [['kind' => 'fireflies', 'amount' => 'few']], 'fireflies come out');
$lantern = $hive['lights'][0];
same([$lantern['kind'], $lantern['color'], $lantern['strength']], ['flicker', '#ffc46b', 75], 'a lantern flickers, warm');
$post = array_values(array_filter($hive['items'], fn ($p) => $itemsById[$p['item_id']]['name'] === 'Lantern'))[0] ?? null;
check($post && abs($lantern['x'] - $post['position_x']) < 80 && $lantern['y'] < $post['position_y'] && $lantern['y'] > $post['position_y'] - 400, 'its glow is on the lantern stood at the back of the terrace: '.json_encode([$lantern, $post]));
same($itemsById[$post['item_id']]['blocking'] ?? null, false, 'which nobody bumps into');
$landing = $scenesByName['landing'];
same([$landing['lights'][0]['kind'], $landing['lights'][0]['color'], count($landing['background_media']), $landing['sky']['time']], ['blink', '#ff4a3a', 2, 'morning'], 'the landing beacon blinks red, under a morning sky with a band of clouds');
$burrow = $scenesByName['burrow'];
same([isset($burrow['sky']), $burrow['lights'][0]['kind'], $burrow['atmosphere'][0]['kind']], [false, 'glow', 'dust'], 'underground: no sky, mushrooms that glow, dust in the air');
check(str_contains($prompts['bg:hive'], 'the sky is added behind later'), 'a background under a living sky is asked for a flat sky to cut out');
$anyPrompt = fn (string $needle) => (bool) array_filter($prompts, fn ($p) => str_contains((string) $p, $needle));
check(str_contains($prompts['clouds'] ?? '', 'fluffy white clouds') && $anyPrompt('an iron lantern hanging from a wooden post, lit and glowing'), 'the clouds are drawn, and the lantern lit');
$glowAt = ImageTools::brightSpot(ImageTools::load((function () {
    $im = imagecreatetruecolor(100, 200);
    imagefill($im, 0, 0, imagecolorallocate($im, 60, 40, 30));
    imagefilledellipse($im, 50, 40, 30, 30, imagecolorallocate($im, 255, 220, 120));

    return ImageTools::png($im);
})()));
check($glowAt && abs($glowAt[0] - 0.5) < 0.05 && abs($glowAt[1] - 0.2) < 0.05, 'a light\'s glow goes on the brightest part of its picture: '.json_encode($glowAt));
same(ImageTools::brightSpot(ImageTools::load(ImageTools::png(imagecreatetruecolor(50, 50)))), null, 'and on a picture with nothing bright, nowhere');
$bad = $valid;
$bad['scenes'][$at('greenhouse', 'scenes')]['sky'] = ['time' => 'night'];
$bad['scenes'][$at('greenhouse', 'scenes')]['atmosphere'] = [['kind' => 'rain']];
$bad['scenes'][$at('hive', 'scenes')]['lights'][0]['placement'] = 'wall';
$errors = BlueprintValidator::errors($bad, $lo);
check($has($errors, 'only outdoor and up_high scenes have a sky') && $has($errors, 'no rain falls or flies indoors') && $has($errors, 'have a back wall to hang it on'), 'a sky indoors, rain in a greenhouse and a lantern on a wall out of doors are caught');

// Characters.
$characters = array_column($doc['characters'], null, 'name');
foreach ($characters as $name => $c) {
    check(isset($c['animations']['stand_right'], $c['animations']['walk_right'], $c['animations']['portrait']), "$name stands, walks and has a portrait");
}
same(array_column($characters['Pip']['routine']['steps'] ?? [], 'type'), ['wait', 'dialogue'], 'Pip, who falls, stays where he is (to come back there) and mutters');
check($characters['Pip']['scale'] < $characters['Keeper Ama']['scale'] && $characters['Keeper Ama']['scale'] < $characters['Captain Zee']['scale'], 'a small robot is drawn smaller than the keeper, the tall pilot taller');
same(array_column($characters['Granny Odo']['routine']['steps'] ?? [], 'type'), ['walk', 'wait', 'dialogue', 'walk', 'wait', 'dialogue'], 'Granny Odo strolls between her spots and says her bits now and then');
$twistScene = array_values(array_filter($byShort, fn ($e, $k) => str_starts_with($k, 'orchard/cutscene-burst'), ARRAY_FILTER_USE_BOTH))[0] ?? null;
check($twistScene && in_array($twistScene['id'], $runs($byShort['orchard/twist-burst']), true) && str_contains(json_encode($twistScene['actions']), 'knitting is soaked'), 'the twist makes Granny Odo jump');
same([isset($byShort['orchard/label-gran']), isset($byShort['hive/label-bot']), isset($byShort['landing/label-keeper'])], [false, true, true], 'a character who paces has no label left behind; Pip and the guide keep theirs');

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
                // Twins of one hotspot (while locked, while waiting, afterwards) share its place and show one at a time.
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
same(array_column($doc['characters'], 'name'), ['Keeper Ama', 'Pip', 'Granny Odo', 'Captain Zee'], 'characters keep their names');

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

// Cancelled from the editor: it stops at the next report, as cancelled (not failed), and draws nothing more.
$runs = new GenerationRuns($pdo);
$stopId = $runs->create('A mission that is stopped before it is made', ['grade' => '3', 'frameworks' => ['TEST-SCI']], null);
$runs->update($stopId, ['cancelled_at' => gmdate('Y-m-d H:i:s')]);
check((function () use ($generator, $stopId) {
    try {
        $generator->generate('', [], null, $stopId);
    } catch (GenerationCancelled) {
        return true;
    }

    return false;
})(), 'a cancelled run stops');
same([$runs->get($stopId)['status'], $runs->get($stopId)['alignment']], ['cancelled', null], 'as cancelled, before asking the model anything');

$design = $generator->generate('Another mission', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design']);
same($design['status'], 'designed', '--design-only stops after the blueprint');
check(($design['estimate']['pictures'] ?? 0) > 5 && isset($design['estimate']['usd']), 'and says how many pictures drawing it will take, and roughly what they cost');

// ------------------------------------------------------------------ keeping costs down
[$changed, $problems] = MissionDesigner::applyChanges($blueprint, [
    ['op' => 'set', 'path' => 'interactions.q_pollen.question.choices.0.correct', 'value' => 'true'],
    ['op' => 'set', 'path' => 'scenes.orchard.exits.1.x', 'value' => '0.3'],
    ['op' => 'remove', 'path' => 'steps.0', 'value' => ''],
    ['op' => 'append', 'path' => 'steps', 'value' => '{"key": "extra", "text": "More", "done_when": ["look_flower"]}'],
    ['op' => 'set', 'path' => 'title', 'value' => 'A plain title'],
    ['op' => 'set', 'path' => 'interactions.nowhere.label', 'value' => '"x"'],
]);
$byKey = array_column($changed['interactions'], null, 'key');
same([$byKey['q_pollen']['question']['choices'][0]['correct'], $changed['scenes'][1]['exits'][1]['x'], $changed['steps'][0]['key'], end($changed['steps'])['key'], $changed['title']], [true, 0.3, 'samples', 'extra', 'A plain title'], 'a correction\'s changes are applied by key, by position, and to lists');
same(count($problems), 1, 'and a change to something that is not there is reported');

$badModel = new FakeModel($blueprint);
$badModel->badChanges = true;
$tinyAlignment = ['learning_objectives' => [['id' => 'LO1', 'text' => 'a', 'standards' => []], ['id' => 'LO2', 'text' => 'b', 'standards' => []]], 'standards' => [], 'vocabulary' => [], 'misconceptions' => []];
$designed = (new MissionDesigner($badModel, ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18]))->design('x', $tinyAlignment, ['big_moment' => true]);
same([$badModel->corrections, $badModel->blueprints, BlueprintValidator::errors($designed, ['LO1', 'LO2'])], [3, 2, []], 'when changes do not fix it, the blueprint is rewritten once as a last resort');
same($designed['pace'], ['big_moment' => true], 'the blueprint says whether it may have a big moment');

// Twists and turns: a few ideas, picked at random for each mission; big moments only now and then.
$pickModel = new FakeModel($blueprint);
$quiet = new MissionDesigner($pickModel, ['max_scenes' => 8, 'max_characters' => 6, 'max_items' => 18], repairs: 0, bigMomentChance: 0.25, random: new Randomizer(new Mt19937(7)));
try {
    $quiet->design('x', $tinyAlignment, ['big_moment' => false]);
    check(false, 'a mission that may not have a big moment, with a fall, is refused');
} catch (GenerationError $e) {
    check(str_contains($e->getMessage(), 'Nobody is in danger in this mission'), 'a mission that may not have a big moment, with a fall, is refused: '.substr($e->getMessage(), 0, 200));
}
$brief = $pickModel->calls[0]['content'][0];
check(str_contains($brief, 'Pace: nobody is in danger in this mission'), 'the brief says so');
preg_match_all('/^- ([^:\n]+): /m', substr($brief, strpos($brief, 'Twists and turns from other missions')), $m);
$names = array_column(TwistIdeas::IDEAS, 'big', 'name');
same([count($m[1]), count(array_filter($m[1], fn ($n) => $names[$n] ?? true))], [6, 0], 'six ideas from the list, none of them a big moment');
$bigPick = TwistIdeas::pick(new Randomizer(new Mt19937(3)), 6, true);
same(count(array_filter($bigPick, fn ($i) => $i['big'])), 1, 'where a big moment is allowed, one of the ideas is one');
same(count(TwistIdeas::IDEAS) >= 23 && count(array_filter(TwistIdeas::IDEAS, fn ($i) => ! $i['big'])) >= 20, true, 'twenty and more ideas to draw on, most of them small');
$chances = 0;
for ($i = 0; $i < 400; $i++) {
    $chances += (new MissionDesigner(new FakeModel($blueprint), [], 0, 0.25, new Randomizer(new Mt19937($i))))->pace([]) ? 1 : 0;
}
check($chances > 60 && $chances < 140, "about one mission in four may have a big moment ($chances of 400)");

/** The placeholder, priced like Gemini: Pro for most pictures, Flash for small cut-outs. Counts what it draws. */
final class PricedPlaceholder implements ImageGenerator, PricedImageGenerator
{
    public array $drawn = [];

    public function __construct(private PlaceholderImageGenerator $inner) {}

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        $this->drawn[] = $hints['kind'] ?? '?';

        return $this->inner->generate($prompt, $references, $aspect, $transparent, $hints);
    }

    public function pricing(array $hints): array
    {
        return in_array($hints['kind'] ?? '', GeminiImageGenerator::PROPS_KINDS, true) ? ['gemini-3.1-flash-image', '1K'] : ['gemini-3-pro-image', '2K'];
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return 'priced-placeholder';
    }
}
/** A judge that never likes anything: every picture would be drawn again and again. */
final class GrumpyJudge implements LanguageModel
{
    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        return ['scores' => array_fill_keys(StyleJudge::CRITERIA, 4), 'problems' => ['meh'], 'fix' => 'better'];
    }
}
$cheap = MissionDesigner::tidy($blueprint);
$layouts = ScenarioGenerator::layouts($cheap);
$images = new PricedPlaceholder($placeholder);
$meter = new Spend(0);
$director = new AssetDirector($images, $style, null, "$work/cost-a", 1, null, $meter);
$estimate = $director->estimate($cheap);
$director->drawMission($cheap, $layouts);
$kinds = array_count_values($images->drawn);
same(count($images->drawn), $estimate['pictures'], 'the estimate counts the pictures a mission needs: '.json_encode($estimate['by_kind']));
$thingCount = count(AssetDirector::things($cheap));
// (A last sheet of one thing would be one picture all the same: it is drawn alone.)
$lone = $thingCount % AssetDirector::SHEET_MAX === 1 ? 1 : 0;
same([$kinds['sheet'] ?? 0, $kinds['item'] ?? 0], [(int) ceil($thingCount / AssetDirector::SHEET_MAX) - $lone, $lone], "its $thingCount small things (creatures' poses too) are drawn on sheets, not one picture each");
same([$kinds['portrait'] ?? 0, $kinds['strip'] ?? 0], [0, 6], 'portraits are cut from the sheets; strips only for walks and the gestures the mission plays');
same([$kinds['distance'] ?? 0, $kinds['foreground'] ?? 0], [1, 3], 'one far view and three foregrounds');
same(AssetDirector::gesturesUsed($cheap, array_column($cheap['characters'], null, 'key')['bot']), [], 'Pip\'s pointing is never played, so it is not drawn');
check(abs($meter->total() - $estimate['usd']) < 0.03, 'what it spent matches the estimate: $'.$meter->total().' / $'.$estimate['usd']);
check($meter->total() < 3.5, 'a five-scene mission with four characters, a far view and three foregrounds is drawn for under $3.50: $'.$meter->total());
$portrait = array_values(array_filter($director->manifest(), fn ($m) => $m['key'] === 'portrait:keeper'))[0];
same([$portrait['note'], $portrait['below_bar']], ['Cut from the character sheet.', false], 'a cut portrait is not flagged');

$drawEach = new PricedPlaceholder($placeholder);
(new AssetDirector($drawEach, $style, null, "$work/cost-b", 1, null, new Spend(0), ['portraits' => 'draw', 'idle_frames' => true, 'prop_sheets' => false]))->drawMission($cheap, $layouts);
$kindsEach = array_count_values($drawEach->drawn);
same([$kindsEach['portrait'] ?? 0, $kindsEach['strip'] ?? 0, $kindsEach['sheet'] ?? 0, $kindsEach['item'] ?? 0], [4, 10, 0, $thingCount], 'each saving can be turned off: drawn portraits, idle animations, one picture per thing');

$noBudget = new PricedPlaceholder($placeholder);
(new AssetDirector($noBudget, $style, new StyleJudge(new GrumpyJudge), "$work/cost-c", 3, null, new Spend(0)))->drawMission($cheap, $layouts);
$budgeted = new PricedPlaceholder($placeholder);
$tight = new Spend(2.6);
$budgetDirector = new AssetDirector($budgeted, $style, new StyleJudge(new GrumpyJudge), "$work/cost-d", 3, null, $tight);
$budgetDirector->drawMission($cheap, $layouts);
check(count($budgeted->drawn) < count($noBudget->drawn) * 0.6, 'with a budget, a picture the judge dislikes stops being redrawn once it is spent: '.count($budgeted->drawn).' pictures instead of '.count($noBudget->drawn));
check($tight->total() < 2 * $tight->budget() && $tight->total() >= $tight->budget(), 'the run finishes past its budget but short of twice it: $'.$tight->total());
check((bool) array_filter($budgetDirector->manifest(), fn ($m) => ! empty($m['below_bar'])), 'what was not redrawn is flagged to be looked at');
check((function () {
    $s = new Spend(0.5);
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    $s->picture('gemini-3-pro-image', '2K', 'background');
    try {
        $s->checkLimit('drawing');
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), '--budget');
    }

    return false;
})(), 'at twice its budget a run stops, saying how to resume it with a bigger one');
$resumedSpend = new Spend(0);
$resumedSpend->attach("$work/cost-d-spend.json");
$resumedSpend->picture('gemini-3-pro-image', '2K', 'background');
$again = new Spend(0);
$again->attach("$work/cost-d-spend.json");
same($again->total(), 0.134, 'a resumed run carries on counting from what it had spent');

// ------------------------------------------------------------------ the audit log (generation_events)
$events = new GenerationEvents($pdo);
$byType = fn (array $log, string $type) => array_values(array_filter($log, fn ($e) => $e['type'] === $type));

// A whole run: every stage in order, each with how long it took, and how it ended.
$wholeRun = $events->forRun($result['run']);
$stageRows = $byType($wholeRun, 'stage');
same(array_slice(array_column($stageRows, 'step'), 0, 6), ['aligning', 'designing', 'drawing', 'building', 'voicing', 'importing'], 'the log has each stage of a run, in order');
check(! array_filter(array_slice($stageRows, 0, 6), fn ($e) => $e['duration_ms'] === null || $e['outcome'] !== 'ok'), 'each with how long it took and that it went well');
$seqs = array_column($wholeRun, 'seq');
same($seqs, range(1, count($seqs)), 'events are numbered in the order they happened, and a resumed run carries on counting');
$pictureRows = $byType($wholeRun, 'picture');
$spentFile = json_decode((string) file_get_contents("$work/generations/{$result['run']}/spend.json"), true);
same(count($pictureRows), array_sum(array_column($spentFile['images'], 'pictures')), 'every picture drawn is logged, as many as the spend counted');
check(count(array_unique(array_column($pictureRows, 'stage'))) === 1 && $pictureRows[0]['stage'] === 'drawing', 'under the drawing stage');
check(! array_diff(['background', 'sheet', 'strip'], array_column($pictureRows, 'kind')), 'with what each was (background, sheet, strip...)');
check(count($byType($wholeRun, 'voice')) >= 5 && ! array_filter($byType($wholeRun, 'voice'), fn ($e) => $e['duration_ms'] === null || $e['model'] !== 'kokoro' || $e['label'] === null), 'each recorded voice line is logged with its text, the engine and how long it took');
$estimateRow = $byType($wholeRun, 'estimate')[0] ?? null;
check($estimateRow && ($estimateRow['detail']['pictures'] ?? 0) > 5, 'the estimate made before drawing is logged, to compare with what was spent');
same(round($events->totals($result['run'])['total']['usd'], 4), round((float) $result['spend']['total'], 4), 'the log adds up to what the run says it spent');
check(in_array('drawing', array_column($events->totals($result['run'])['stages'], 'stage'), true) && $events->totals($result['run'])['stages'][0]['stage'] === 'aligning', 'totals come by stage, in order');
$stopped = $events->forRun($stopId);
same([$stopped[0]['type'], $stopped[0]['step'], $stopped[0]['outcome'], $stopped[0]['duration_ms'] !== null], ['stage', 'aligning', 'cancelled', true], 'a cancelled run closes the stage it was in as cancelled');

// Language-model calls: tokens, cost, time, and how they ended.
$auditRun = $runs->create('The audit log', [], null);
$audit = new Spend(0, ['claude-test' => ['input' => 4, 'output' => 20, 'cache_read' => 0.2, 'cache_write' => 5]]);
$audit->logTo($events, $auditRun);
$audit->stage('designing');
$usage = ['input_tokens' => 1000, 'output_tokens' => 10000, 'cache_read_input_tokens' => 20000, 'cache_creation_input_tokens' => 0];
$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{}']], 'stop_reason' => 'end_turn', 'usage' => $usage]))]);
(new AnthropicModel($http, 'key', 'claude-test', 'https://api.anthropic.com', $audit))->structured('sys', ['x'], 'mission_blueprint', ['type' => 'object']);
$audit->at('background:orchard', 2, 'Blue Orchard');
$http = new Recorded([new HttpResponse(200, json_encode(['content' => [['type' => 'text', 'text' => '{"a": ']], 'stop_reason' => 'max_tokens', 'usage' => ['input_tokens' => 10, 'output_tokens' => 20]]))]);
try {
    (new AnthropicModel($http, 'key', 'claude-test', 'https://api.anthropic.com', $audit))->structured('sys', ['x'], 'style_review', ['type' => 'object']);
} catch (GenerationError) {
}
$http = new Recorded([new HttpResponse(500, json_encode(['error' => ['message' => 'overloaded']]))]);
try {
    (new AnthropicModel($http, 'key', 'claude-test', 'https://api.anthropic.com', $audit))->structured('sys', ['x'], 'style_review', ['type' => 'object']);
} catch (GenerationError) {
}
$llmRows = $events->forRun($auditRun);
same(count($llmRows), 3, 'every language-model call is logged, even those that failed');
same([$llmRows[0]['type'], $llmRows[0]['kind'], $llmRows[0]['step'], $llmRows[0]['stage'], $llmRows[0]['model'], $llmRows[0]['outcome']], ['llm', 'mission_blueprint', 'mission_blueprint', 'designing', 'claude-test', 'ok'], 'a call says what it was for, the stage and the model');
same([$llmRows[0]['input_tokens'], $llmRows[0]['output_tokens'], $llmRows[0]['cache_read_tokens'], $llmRows[0]['cache_write_tokens'], round((float) $llmRows[0]['usd'], 3)], [1000, 10000, 20000, 0, 0.208], 'with its tokens, cache reads included, and what they cost');
check($llmRows[0]['duration_ms'] !== null && $llmRows[0]['started_at'] !== null, 'and when it began and how long it took');
same([$llmRows[1]['step'], $llmRows[1]['attempt'], $llmRows[1]['label'], $llmRows[1]['outcome']], ['background:orchard', 2, 'Blue Orchard', 'truncated'], 'a call made for a picture is logged with the picture and attempt, and one cut off by max_tokens says so');
same([$llmRows[2]['outcome'], (float) $llmRows[2]['usd'], str_contains((string) $llmRows[2]['note'], 'overloaded')], ['error', 0.0, true], 'a call the service refused is logged as an error, with why, at no cost');
same(round($audit->total(), 4), round((float) $events->totals($auditRun)['total']['usd'], 4), 'the log and the spend agree');

// Pictures: each attempt is logged with the judge's score, and the one kept is marked.
$pictureRun = $runs->create('The audit log, pictures', [], null);
$pictureSpend = new Spend(0);
$pictureSpend->logTo($events, $pictureRun);
$pictureSpend->stage('drawing');
$pictureImages = new PricedPlaceholder($placeholder);
(new AssetDirector($pictureImages, $style, new StyleJudge(new GrumpyJudge), "$work/audit-c", 3, null, $pictureSpend))->drawMission($cheap, $layouts);
$drawnRows = $byType($events->forRun($pictureRun), 'picture');
same(count($drawnRows), count($pictureImages->drawn), 'every picture drawn is logged once');
$perStep = [];
foreach ($drawnRows as $e) {
    $perStep[$e['step']][] = $e;
}
check(! array_filter($perStep, fn ($rows) => count(array_filter($rows, fn ($e) => $e['outcome'] === 'kept')) !== 1), 'of the attempts at each picture, exactly one is marked kept');
$redrawn = array_values(array_filter($perStep, fn ($rows) => count($rows) === 3))[0] ?? [];
same([array_column($redrawn, 'attempt'), array_column($redrawn, 'outcome')], [[1, 2, 3], ['kept', 'discarded', 'discarded']], 'a picture the judge disliked three times shows its attempts, the first (the best of equals) kept');
same(array_unique(array_column($redrawn, 'score')), [4.0], 'each with the judge\'s score');
check(! array_filter($drawnRows, fn ($e) => $e['model'] === null || $e['duration_ms'] === null || (float) $e['usd'] <= 0), 'with the model, how long it took and what it cost');
same(round((float) $events->totals($pictureRun)['total']['usd'], 4), round($pictureSpend->total(), 4), 'the log adds up to the spend');
$kinds = array_column($events->totals($pictureRun)['kinds'], null, 'kind');
check(($kinds['background']['events'] ?? 0) >= 3 && ($kinds['background']['kept'] ?? 0) === 5, 'totals by kind count the pictures and how many were kept');
$failedRun = $runs->create('The audit log, a picture that fails', [], null);
$failing = new Spend(0);
$failing->logTo($events, $failedRun);
$failing->picture('gemini-3-pro-image', '2K', 'background', 1, 3.2, 'error', 'The image service said no');
$failedRow = $events->forRun($failedRun)[0];
same([$failedRow['outcome'], $failedRow['note'], $failedRow['duration_ms'], round((float) $failedRow['usd'], 3)], ['error', 'The image service said no', 3200, 0.136], 'a picture that fails is logged as an error with its time, and still counts as paid for (its price and the reference picture sent)');
$quiet = new Spend(0);
$quiet->picture('gemini-3-pro-image', '2K', 'background');
same($quiet->total(), 0.134, 'with no log attached, spending works as before');
check(count($events->runs(50)) >= 4 && $events->runs(1)[0]['id'] === $failedRun, 'recent runs are listed newest first, with their totals');

// ------------------------------------------------------------------ generation methods and the trace
// The main run above used the default method (classic). Its trace: every step, and every call each made.
$traced = $result['trace'] ?? null;
check($traced !== null && is_file("$traced/index.json") && is_file("$traced/README.md"), 'a run writes a trace to its work folder');
$index = json_decode((string) file_get_contents("$traced/index.json"), true);
same($index['method'], 'classic', 'the trace says which method made it');
$firstSession = array_slice($index['steps'], 0, 8);
$firstSession = array_slice($index['steps'], 0, 9);
same(array_column($firstSession, 'step'), ['align', 'design', 'estimate', 'draw', 'survey', 'build', 'voice', 'package', 'import'], 'the classic method takes its nine steps in order');
same(array_unique(array_column($firstSession, 'outcome')), ['ok'], 'each ok');
same(array_column(array_slice($index['steps'], 9), 'skipped'), ['the run already has its alignment', 'the run already has a blueprint that passes the validator', null, null, null, null, null, null, null], 'the resumed session is in the same trace, its reused steps marked skipped');
same(count($index['sessions']), 2, 'and the trace counts both sessions');
$designStep = $firstSession[1];
$designCalls = array_values(array_filter($index['calls'], fn ($c) => in_array($c['n'], $designStep['calls'], true)));
same(array_column($designCalls, 'name'), ['mission_blueprint', 'blueprint_changes'], 'the design step\'s calls are filed under it: the draft, then the correction');
same(array_unique(array_column($designCalls, 'job')), ['design'], 'as the design job');
$correctionCall = json_decode((string) file_get_contents("$traced/{$designCalls[1]['file']}"), true);
check(str_contains(json_encode($correctionCall['content']), 'cannot be built because') && isset($correctionCall['answer']['changes']) && $correctionCall['system'] !== '', 'a call\'s file has the system prompt, the user turn (with the problems to fix) and the answer');
check(isset($designStep['outputs']['blueprint']) && json_decode((string) file_get_contents("$traced/{$designStep['outputs']['blueprint']}"), true)['title'] === 'The Quiet Hive', 'a step\'s outputs are kept in files of their own');
$pictureCalls = array_values(array_filter($index['calls'], fn ($c) => $c['type'] === 'picture' && $c['step'] === 'draw'));
check(count($pictureCalls) >= 10, 'every picture request is in the trace ('.count($pictureCalls).')');
$aPicture = json_decode((string) file_get_contents("$traced/{$pictureCalls[0]['file']}"), true);
check($aPicture['prompt'] !== '' && isset($aPicture['hints']['kind']) && is_file("$traced/{$aPicture['result']['file']}"), 'with its prompt, hints and the picture that came back');
// (The placeholder's shapes are not judged; with a real picture source, the judge's calls are traced as its own job.)
$judging = (new GenerationFactory($config, $store, new NoNetwork, $model, images: new PricedPlaceholder($placeholder)))->method('classic', ['anchors_required' => false]);
$judging->tracer()->attach("$work/judge-trace", 'classic', ['draw']);
$judging->judge()->judge('item', $placeholder->generate('a jar', [], '1:1', false, ['kind' => 'item', 'label' => 'jar']), $style->anchorsFor('item') ?: [new Reference($placeholder->generate('anchor', [], '1:1', false, ['kind' => 'item']), 'style anchor 1')], [], 'a jar');
$judgeIndex = json_decode((string) file_get_contents("$work/judge-trace/trace/index.json"), true);
same(array_column($judgeIndex['calls'], 'job'), ['judge'], 'the style judge\'s calls are traced too, as the judge job');
$judgeCall = json_decode((string) file_get_contents("$work/judge-trace/trace/{$judgeIndex['calls'][0]['file']}"), true);
$sent = array_values(array_filter($judgeCall['content'], fn ($p) => is_array($p) && isset($p['image'])));
check(count($sent) >= 2 && is_file("$work/judge-trace/trace/{$sent[0]['image']['file']}") && ! str_contains(json_encode($judgeCall), 'iVBOR'), 'pictures sent to a model are kept as files, not inline');
$judging->tracer()->detach();
check(str_contains((string) file_get_contents("$traced/README.md"), '| 2 | [design]'), 'README.md shows the timeline');

// The list of methods.
$methods = $factory->methods();
same(array_keys($methods), ['classic', 'draft', 'gemini-judge', 'sprite-app', 'critic', 'best-of', 'outline-first'], 'every built-in method is listed');
check(! array_filter($methods, fn ($s) => strlen($s) < 20), 'each saying what it tries');
check((function () use ($factory) {
    try {
        $factory->generator(['method' => 'nonsense']);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'There is no generation method "nonsense"') && str_contains($e->getMessage(), 'critic');
    }

    return false;
})(), 'an unknown method is refused, naming the ones there are');
same($factory->savedMethod($result['run']), 'classic', 'a run remembers its method, to be resumed with it');

// draft: the real design, placeholder pictures, nothing judged, no voices.
$judgedBefore = count(array_filter($model->calls, fn ($c) => $c['name'] === 'style_review'));
$draft = $factory->generator(['method' => 'draft'])->generate('A draft of the orchard mission', ['grade' => '3', 'frameworks' => ['TEST-SCI']], null);
same([$draft['status'], $draft['method']], ['done', 'draft'], 'the draft method makes a whole mission');
same(count(array_filter($model->calls, fn ($c) => $c['name'] === 'style_review')), $judgedBefore, 'without judging a picture');
$draftIndex = json_decode((string) file_get_contents("{$draft['trace']}/index.json"), true);
same(array_column($draftIndex['steps'], 'skipped')[4], 'no surveyor (placeholder pictures, or QBL_GEN_SURVEY=false)', 'without reading the backgrounds');
same(array_column($draftIndex['steps'], 'skipped')[6], 'voices are off for this run', 'and without voices');
same((new GenerationRuns($pdo))->get($draft['run'])['options']['method'], 'draft', 'the run records its method');

// --redo: a step of an earlier run done again, and the steps after it; the ones before reused.
$designsBefore = $model->blueprints;
$redone = $factory->generator(['method' => 'draft'])->generate('', ['redo' => 'design'], null, $draft['run']);
same($model->blueprints, $designsBefore + 1, 'redo=design designs it again');
$redoIndex = json_decode((string) file_get_contents("{$redone['trace']}/index.json"), true);
$redoSteps = array_slice($redoIndex['steps'], 9);
same([$redoSteps[0]['skipped'], $redoSteps[1]['skipped']], ['the run already has its alignment', null], 'reusing the alignment before it');
check(! isset((new GenerationRuns($pdo))->get($draft['run'])['options']['redo']), 'and redo is not saved with the run (a later resume would redo again)');
check((function () use ($factory, $draft) {
    try {
        $factory->generator(['method' => 'draft'])->generate('', ['redo' => 'nowhere'], null, $draft['run']);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'has no step "nowhere"');
    }

    return false;
})(), 'redo of a step the method does not have is refused, naming its steps');

// critic: reviewed, changed, reviewed again until it passes.
$criticModel = new FakeModel($blueprint);
$criticFactory = new GenerationFactory($config, $store, new NoNetwork, $criticModel);
$critiqued = $criticFactory->generator(['method' => 'critic'])->generate('A mission about pollination', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design'], null);
same($critiqued['status'], 'designed', 'the critic method runs to the design');
$critiqueDir = dirname($critiqued['trace']);
$reviews = json_decode((string) file_get_contents("$critiqueDir/critique.json"), true);
same([count($reviews), $reviews[0]['outcome'], $reviews[1]['outcome']], [2, 'applied', 'passed (at least 8)'], 'it is reviewed, its changes applied, and reviewed again until it passes');
same((new GenerationRuns($pdo))->get($critiqued['run'])['blueprint']['title'], 'The Quiet Hive Revisited', 'the critic\'s change is in the saved blueprint');
same(array_column(json_decode((string) file_get_contents("{$critiqued['trace']}/index.json"), true)['steps'], 'step'), ['align', 'design', 'critique', 'estimate'], 'between the design and the estimate');
$criticModel->reviewChanges = 'break';
$criticModel->reviews = 0;
$broken = $criticFactory->generator(['method' => 'critic'])->generate('A mission about pollination, again', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design'], null);
$reviews = json_decode((string) file_get_contents(dirname($broken['trace']).'/critique.json'), true);
same($reviews[0]['outcome'], 'discarded: the changes would break the mission', 'changes that would break the mission are thrown away');
same((new GenerationRuns($pdo))->get($broken['run'])['blueprint']['title'], 'The Quiet Hive', 'and the blueprint stays as it was');
$reviewsBefore = $criticModel->reviews;
$criticFactory->generator(['method' => 'critic'])->generate('', [], null, $broken['run']);
same($criticModel->reviews, $reviewsBefore, 'a resumed run is not reviewed again');

// best-of: two candidates, the one the critic scores higher kept.
$bestModel = new FakeModel($blueprint);
$best = (new GenerationFactory($config, $store, new NoNetwork, $bestModel))->generator(['method' => 'best-of', 'candidates' => 2])->generate('A mission about pollination', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design'], null);
$bestDir = dirname($best['trace']);
same([$bestModel->blueprints, $bestModel->reviews], [2, 2], 'best-of designs each candidate and has each scored');
check(is_file("$bestDir/candidates/1.json") && is_file("$bestDir/candidates/2.review.json"), 'every candidate and its review is kept');
$bestIndex = json_decode((string) file_get_contents("{$best['trace']}/index.json"), true);
same(json_decode((string) file_get_contents("{$best['trace']}/{$bestIndex['steps'][1]['outputs']['candidates']}"), true)['kept'], 2, 'the higher-scoring one is kept');

// outline-first: an outline, then the design from it.
$outlineModel = new FakeModel($blueprint);
$outlined = (new GenerationFactory($config, $store, new NoNetwork, $outlineModel))->generator(['method' => 'outline-first'])->generate('A mission about pollination', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design', 'notes' => 'Keep it short.'], null);
same(array_column($outlineModel->calls, 'name'), ['curriculum_alignment', 'mission_outline', 'mission_blueprint', 'blueprint_changes'], 'outline-first outlines before it designs');
$briefed = json_encode(array_values(array_filter($outlineModel->calls, fn ($c) => $c['name'] === 'mission_blueprint'))[0]['content']);
check(str_contains($briefed, 'Build the mission from this outline') && str_contains($briefed, 'Wake the bees') && str_contains($briefed, 'Keep it short.'), 'and the designer is given the outline, with the teacher\'s own notes');
check(is_file(dirname($outlined['trace']).'/outline.json'), 'the outline is kept in the work folder');
check(! isset((new GenerationRuns($pdo))->get($outlined['run'])['options']['notes']) || (new GenerationRuns($pdo))->get($outlined['run'])['options']['notes'] === 'Keep it short.', 'the outline is not saved into the teacher\'s notes');

// sprite-app: pictures routed by kind.
final class Recorder implements ImageGenerator
{
    public array $drawn = [];

    public function __construct(private string $name, private PlaceholderImageGenerator $inner, private bool $alpha = false) {}

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        $this->drawn[] = $hints['kind'] ?? '?';

        return $this->inner->generate($prompt, $references, $aspect, $transparent, $hints);
    }

    public function transparency(): bool
    {
        return $this->alpha;
    }

    public function describe(): string
    {
        return $this->name;
    }
}
$scenes = new Recorder('scenes', $placeholder);
$sprites = new Recorder('sprites', $placeholder, true);
$router = new RoutingImageGenerator($scenes, array_fill_keys(SpriteAppMethod::SPRITE_KINDS, $sprites));
$router->generate('a background', [], '16:9', false, ['kind' => 'background']);
$router->generate('a character', [], '3:4', true, ['kind' => 'character']);
$router->generate('a walk', [], '16:9', true, ['kind' => 'strip']);
same([$scenes->drawn, $sprites->drawn], [['background'], ['character', 'strip']], 'the router sends scenes to one source and sprites to the other');
same($router->transparency(), false, 'and only claims transparency when every source has it');
check(str_contains($router->describe(), 'character') && str_contains($router->describe(), 'rest→scenes'), 'it says where each kind goes: '.$router->describe());
$spriteMethod = $factory->method('sprite-app', ['sprite_driver' => 'placeholder', 'anchors_required' => false]);
check(str_starts_with($spriteMethod->images()->describe(), 'route('), 'the sprite-app method draws through a router');
$sprited = $factory->generator(['method' => 'sprite-app', 'sprite_driver' => 'placeholder', 'voices' => false])->generate('A sprite-app mission', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'import' => false], null);
same($sprited['status'], 'packaged', 'and makes a whole mission with it');

// gemini-judge: Gemini's main model for everything, and a stricter judge.
$geminiConfig = $config;
$geminiConfig['images'] = ['driver' => 'gemini', 'gemini' => ['api_key' => 'k', 'model' => 'gemini-3-pro-image', 'props_model' => 'gemini-3.1-flash-image', 'props_size' => '1K']];
$geminiFactory = new GenerationFactory($geminiConfig, $store, new NoNetwork, $model);
same($geminiFactory->method('classic', ['anchors_required' => false])->images()->pricing(['kind' => 'item']), ['gemini-3.1-flash-image', '1K'], 'classic draws small things with the cheaper props model');
same($geminiFactory->method('gemini-judge', ['anchors_required' => false])->images()->pricing(['kind' => 'item']), ['gemini-3-pro-image', '2K'], 'gemini-judge draws everything with the main model');
$minScore = fn (GenerationMethod $m) => (fn () => $this->minScore())->call($m);
same([$minScore($geminiFactory->method('classic')), $minScore($geminiFactory->method('gemini-judge'))], [7.0, 8.0], 'and judges more strictly');
check((function () use ($geminiFactory) {
    try {
        $geminiFactory->generator(['method' => 'gemini-judge']);
    } catch (GenerationError $e) {
        return str_contains($e->getMessage(), 'anchor');
    }

    return false;
})(), 'like classic, it needs the style\'s anchors');

// A method of one's own, from configuration: its own step, filed in the trace like the built-in ones.
final class CountScenesStep extends Step
{
    public function name(): string
    {
        return 'count-scenes';
    }

    public function stage(): string
    {
        return 'designing';
    }

    public function run(GenerationRun $run): void
    {
        $run->data['scenes'] = count($run->blueprint['scenes']);
        $run->say("{$run->data['scenes']} scenes");
        $run->output('count', ['scenes' => $run->data['scenes']]);
        $run->stop('designed');
    }
}
final class CountingMethod extends GenerationMethod
{
    public static function key(): string
    {
        return 'counting';
    }

    public static function summary(): string
    {
        return 'A test method: align, design, count the scenes, stop.';
    }

    public function steps(): array
    {
        return [...array_slice(parent::steps(), 0, 2), new CountScenesStep];
    }
}
$customConfig = $config + ['methods' => ['counting' => CountingMethod::class]];
$customFactory = new GenerationFactory($customConfig, $store, new NoNetwork, new FakeModel($blueprint));
check(isset($customFactory->methods()['counting']), 'a method of one\'s own is listed from configuration');
$counted = $customFactory->generator(['method' => 'counting'])->generate('A mission about pollination', ['grade' => '3', 'frameworks' => ['TEST-SCI']], null);
$countIndex = json_decode((string) file_get_contents("{$counted['trace']}/index.json"), true);
same([$counted['status'], array_column($countIndex['steps'], 'step'), $countIndex['steps'][2]['notes']], ['designed', ['align', 'design', 'count-scenes'], ['5 scenes']], 'and runs its own steps, which are traced like the rest');

// The trace can be switched off, and can keep only hashes of pictures.
$quietConfig = $config;
$quietConfig['trace'] = ['enabled' => false];
$untraced = (new GenerationFactory($quietConfig, $store, new NoNetwork, new FakeModel($blueprint)))->generator(['method' => 'draft'])->generate('Untraced', ['grade' => '3', 'frameworks' => ['TEST-SCI'], 'stop_after' => 'design'], null);
check(! isset($untraced['trace']) && ! is_dir("$work/generations/{$untraced['run']}/trace"), 'with the trace off, nothing is written');
$hashes = new Tracer(true, 'none');
$hashes->attach("$work/hash-trace", 'test', ['x']);
$hashes->picture('test', 'a prompt', [new Reference('not a picture', 'style anchor 1')], '1:1', false, ['kind' => 'item'], 'bytes', 0.1, null);
$hashCall = json_decode((string) file_get_contents("$work/hash-trace/trace/calls/0001-picture-item.json"), true);
same([$hashCall['result']['sha1'], isset($hashCall['result']['file']), $hashCall['references'][0]['role']], [sha1('bytes'), false, 'style anchor 1'], 'with pictures "none", only their hashes are kept');

// ------------------------------------------------------------------ AutoSprite: every animation in one request, never another
/**
 * AutoSprite as its API documents it, in memory: characters, the spritesheets request, jobs, sheets
 * and the presigned files. Each sheet is a row of 64 px frames of a 20 x 40 block standing at
 * (32, 60); a jump lifts it off the ground in the middle frames.
 */
final class FakeAutoSprite implements HttpClient
{
    public array $sent = [];

    /** job id => [kind, polls left before it finishes, outcome] */
    private array $jobs = [];

    public function __construct(
        /** kinds that fail to start (in the answer's "failed") */
        public array $failToStart = [],
        /** kinds whose job fails */
        public array $failJob = [],
        /** an error to answer the spritesheets request with: [status, code] */
        public ?array $refuse = null,
        /** take the request, then lose the answer (the connection drops) */
        public bool $loseAnswer = false,
        /** polls each job stays "running" */
        public int $slow = 1,
        public int $frames = 6,
    ) {}

    public function count(string $method, string $pattern): int
    {
        return count(array_filter($this->sent, fn ($s) => $s['method'] === $method && preg_match($pattern, $s['url'])));
    }

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        $this->sent[] = compact('method', 'url', 'headers', 'body', 'multipart');
        $path = (string) parse_url($url, PHP_URL_PATH);
        if (str_starts_with($url, 'https://files.test/')) {
            [$id, $ext] = explode('.', basename($path));
            $kind = $this->jobs['rose_'.substr($id, 3)][0];

            return new HttpResponse(200, $ext === 'png' ? $this->sheet($kind) : json_encode($this->atlas()));
        }
        if (($headers['x-api-key'] ?? '') !== 'vspk_test') {
            return new HttpResponse(401, json_encode(['error' => ['code' => 'UNAUTHORIZED', 'message' => 'Invalid API key']]));
        }
        if ($method === 'POST' && $path === '/api/v1/characters') {
            return new HttpResponse(201, json_encode(['id' => 'char_1', 'name' => $body['name'] ?? '']));
        }
        if ($method === 'POST' && preg_match('#/characters/char_1/spritesheets$#', $path)) {
            if ($this->refuse) {
                return new HttpResponse($this->refuse[0], json_encode(['error' => ['code' => $this->refuse[1], 'message' => 'Not enough credits for all animations']]));
            }
            if (count($body['animations']) > 10) {
                return new HttpResponse(400, json_encode(['error' => ['code' => 'TOO_MANY_ANIMATIONS', 'message' => 'At most 10']]));
            }
            $workflows = $failed = [];
            foreach ($body['animations'] as $a) {
                if (in_array($a['kind'], $this->failToStart, true)) {
                    $failed[] = ['kind' => $a['kind'], 'error' => 'could not start'];

                    continue;
                }
                $id = 'rose_'.(count($this->jobs) + 1);
                $this->jobs[$id] = [$a['kind'], $this->slow, in_array($a['kind'], $this->failJob, true) ? 'failed' : 'succeeded'];
                $workflows[] = ['jobId' => $id, 'kind' => $a['kind'], 'videoId' => 'vid_'.$id];
            }
            if ($this->loseAnswer) {
                throw new GenerationError('Connection reset by peer');
            }

            return new HttpResponse(202, json_encode(['characterId' => 'char_1', 'workflows' => $workflows, 'creditsUsed' => 5 * count($workflows)] + ($failed ? ['failed' => $failed] : [])));
        }
        if ($method === 'GET' && $path === '/api/v1/jobs') {
            return new HttpResponse(200, json_encode(['jobs' => array_map(fn ($id) => ['jobId' => $id, 'characterId' => 'char_1', 'status' => 'running'], array_keys($this->jobs)), 'hasMore' => false]));
        }
        if ($method === 'GET' && preg_match('#/jobs/(rose_\d+)$#', $path, $m)) {
            $job = &$this->jobs[$m[1]];
            if ($job[1]-- > 0) {
                return new HttpResponse(200, json_encode(['jobId' => $m[1], 'status' => 'running', 'progress' => ['total' => 3, 'completed' => 1], 'spritesheetIds' => []]));
            }

            return new HttpResponse(200, json_encode($job[2] === 'failed'
                ? ['jobId' => $m[1], 'status' => 'failed', 'error' => 'Video generation timed out', 'spritesheetIds' => []]
                : ['jobId' => $m[1], 'status' => 'succeeded', 'spritesheetIds' => ['ss_'.substr($m[1], 5)]]));
        }
        if ($method === 'GET' && preg_match('#/spritesheets/ss_(\d+)$#', $path, $m)) {
            $kind = $this->jobs["rose_$m[1]"][0];

            return new HttpResponse(200, json_encode(['id' => "ss_$m[1]", 'kind' => $kind, 'status' => 'ready', 'frameWidth' => 64, 'frameHeight' => 64, 'frameCount' => $this->frames, 'columns' => $this->frames,
                'sheetUrl' => "https://files.test/ss_$m[1].png?sig=x", 'atlasUrl' => "https://files.test/ss_$m[1].json?sig=x", 'speedMultiplier' => 1]));
        }

        return new HttpResponse(404, json_encode(['error' => ['code' => 'NOT_FOUND', 'message' => "$method $path"]]));
    }

    private function sheet(string $kind): string
    {
        $im = ImageTools::blank(64 * $this->frames, 64);
        $teal = imagecolorallocatealpha($im, 30, 160, 150, 0);
        for ($i = 0; $i < $this->frames; $i++) {
            $lift = $kind === 'jump' ? (int) round(sin(M_PI * $i / ($this->frames - 1)) * 16) : 0;
            imagefilledrectangle($im, 64 * $i + 22, 20 - $lift, 64 * $i + 41, 59 - $lift, $teal);
        }

        return ImageTools::png($im);
    }

    private function atlas(): array
    {
        $frames = [];
        for ($i = 0; $i < $this->frames; $i++) {
            $frames[(string) $i] = ['x' => 64 * $i, 'y' => 0, 'w' => 64, 'h' => 64, 'duration' => 333];
        }

        return ['frames' => $frames, 'meta' => ['size' => ['w' => 64 * $this->frames, 'h' => 64], 'frame_size' => ['w' => 64, 'h' => 64], 'duration_s' => 2, 'fps' => $this->frames / 2, 'pivot' => ['x' => 0.5, 'y' => 60 / 64]]];
    }
}

$noSleep = fn (int $s) => null;
$autoSprite = fn (FakeAutoSprite $fake, array $list = [], int $timeout = 900) => new AutoSpriteAnimator($fake, $fake, 'vspk_test', $list, timeout: $timeout, spend: new Spend, sleep: $noSleep);
$animatedDirector = function (string $dir, FakeAutoSprite $fake, string $fallback = 'draw', int $timeout = 900, ?PricedPlaceholder $images = null) use ($placeholder, $style, $autoSprite) {
    return new AssetDirector($images ?? new PricedPlaceholder($placeholder), $style, null, $dir, 1, animator: $autoSprite($fake, [], $timeout), animatorFallback: $fallback);
};
$pip = $blueprint['characters'][1];

$fake = new FakeAutoSprite;
$pictures = new PricedPlaceholder($placeholder);
$director = $animatedDirector("$work/autosprite", $fake, images: $pictures);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
$asked = $fake->sent[array_key_last(array_filter($fake->sent, fn ($s) => str_ends_with($s['url'], '/spritesheets')))]['body'];
same([$fake->count('POST', '#/characters$#'), $fake->count('POST', '#/spritesheets$#')], [1, 1], 'AutoSprite: the sheet is uploaded once and every animation is asked for in ONE request');
same(array_column($asked['animations'], 'kind'), ['idle', 'walk', 'point', 'wave', 'victory', 'custom', 'talk', 'jump', 'dance', 'crouch'], 'the request holds all ten (the most allowed), the mission\'s own first');
check($asked['videoTier'] === 'turbo' && $asked['frameCount'] === 16 && ! isset($asked['animations'][0]['prompt']) && isset($asked['animations'][5]['prompt'], $asked['animations'][5]['name']), 'presets carry no prompt; the custom "think" has a name and a prompt');
check(($asked['animations'][6]['loop'] ?? false) && ($asked['animations'][8]['loop'] ?? false), 'talk and dance are asked to loop seamlessly');
check((bool) array_filter($fake->sent, fn ($s) => $s['multipart'] && $s['body']['image'] instanceof CURLFile), 'the character sheet is uploaded as a file');
check(! array_filter($fake->sent, fn ($s) => str_starts_with($s['url'], 'https://files.test/') && isset($s['headers']['x-api-key'])), 'the key is never sent to the presigned file addresses');
same(array_column($drawn['char:bot']['params']['animations'], 'name'), ['idle', 'walk', 'point', 'wave', 'cheer', 'think', 'talk', 'jump', 'dance', 'crouch'], 'the sheet has every animation, standing and walking first');
check(! in_array('strip', $pictures->drawn, true) && in_array('character', $pictures->drawn, true), 'the image model draws the character sheet and no strips');
$rows = array_column($drawn['char:bot']['params']['animations'], null, 'name');
check(! isset($rows['idle']['repeat']) && ! isset($rows['walk']['repeat']) && $rows['jump']['repeat'] === false && $rows['cheer']['duration'] === 2000, 'idle and walk loop; gestures play once, at the length AutoSprite made them');
same([$drawn['char:bot']['frame_width'], $drawn['char:bot']['params']['sheet']['columns']], [AssetDirector::ANIMATED_CELL_W, 6], 'cells are 256 wide, one column per frame');
check($drawn['char:bot']['body_height'] > 100 && $drawn['char:bot']['body_height'] <= AssetDirector::CELL_H - 30, 'the body height is recorded ('.$drawn['char:bot']['body_height'].' px)');
check(MissionBuilder::characterScale($pip, $drawn['char:bot']) > MissionBuilder::characterScale($pip), 'and the game shows a smaller-drawn body at the same real size');
$sheetIm = ImageTools::load((string) file_get_contents($drawn['char:bot']['path']));
$cellBox = fn (int $frame) => ImageTools::bbox(ImageTools::crop($sheetIm, ($frame % 6) * 256, intdiv($frame, 6) * 320, 256, 320));
$jump = $rows['jump']['frames'];
check($cellBox($jump[3])[1] + $cellBox($jump[3])[3] < $cellBox($jump[0])[1] + $cellBox($jump[0])[3] - 10, 'frames are placed by their pivot: the jump leaves the ground');
check(abs($cellBox($rows['idle']['frames'][0])[1] + $cellBox($rows['idle']['frames'][0])[3] - (320 - 6)) <= 2, 'standing feet are on the cell\'s baseline');
check(is_file("$work/autosprite/assets/autosprite-bot.json") && (array_column($director->manifest(), null, 'key')['animations:bot']['accepted'] ?? false), 'what AutoSprite made is recorded with the run');

// Resumed: nothing is asked again, nothing is even read again.
$before = count($fake->sent);
$again = $animatedDirector("$work/autosprite", $fake);
$redone = (new ReflectionMethod($again, 'character'))->invoke($again, $pip, '', [], ['point']);
same([count($fake->sent) - $before, count($redone['char:bot']['params']['animations'])], [0, 10], 'a resumed run reuses every animation without a single request');

// Some fail: the walk is made from the standing picture, the rest stand in with built-in moves. No second request.
$fake = new FakeAutoSprite(failToStart: ['wave'], failJob: ['walk']);
$director = $animatedDirector("$work/autosprite-partial", $fake);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
$names = array_column($drawn['char:bot']['params']['animations'], 'name');
check(in_array('walk', $names, true) && ! in_array('wave', $names, true) && in_array('point', $names, true), 'a failed walk is made from the standing picture; a failed gesture is left to the built-in moves');
$entry = array_column($director->manifest(), null, 'key')['animations:bot'];
check(isset($entry['missing']['walk'], $entry['missing']['wave']) && $entry['below_bar'] === true, 'what is missing, and why, is recorded and flagged');
(new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
same($fake->count('POST', '#/spritesheets$#'), 1, 'and nothing is asked for again, even for what failed');

// Refused outright (no credits): nothing spent; the strips are drawn instead, and AutoSprite is not asked again.
$fake = new FakeAutoSprite(refuse: [402, 'INSUFFICIENT_CREDITS']);
$pictures = new PricedPlaceholder($placeholder);
$director = $animatedDirector("$work/autosprite-refused", $fake, images: $pictures);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
check(in_array('strip', $pictures->drawn, true) && $drawn['char:bot']['frame_width'] === AssetDirector::CELL_W, 'a refused request falls back to drawn strips');
check(str_contains((string) array_column($director->manifest(), null, 'key')['animations:bot']['note'], 'INSUFFICIENT_CREDITS'), 'with AutoSprite\'s reason recorded');
(new ReflectionMethod($animatedDirector("$work/autosprite-refused", $fake), 'character'))->invoke($animatedDirector("$work/autosprite-refused", $fake), $pip, '', [], ['point']);
same($fake->count('POST', '#/spritesheets$#'), 1, 'a resumed run does not ask a refusing AutoSprite again');
$fake = new FakeAutoSprite(refuse: [403, 'PLAN_REQUIRED']);
$pictures = new PricedPlaceholder($placeholder);
$director = $animatedDirector("$work/autosprite-puppet", $fake, 'puppet', images: $pictures);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
same([array_column($drawn['char:bot']['params']['animations'], 'name'), in_array('strip', $pictures->drawn, true)], [['idle', 'walk'], false], 'with the puppet fallback, nothing more is asked of anyone: a walk from the standing picture');

// The answer is lost after AutoSprite took the request: its jobs are found, not asked for again.
$fake = new FakeAutoSprite(loseAnswer: true);
$director = $animatedDirector("$work/autosprite-lost", $fake);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
same([$fake->count('POST', '#/spritesheets$#'), count($drawn['char:bot']['params']['animations'])], [1, 10], 'a lost answer is recovered from the character\'s jobs, without asking again');

// Slow jobs: the run goes on without them; a resume collects them, still without asking again.
$fake = new FakeAutoSprite(slow: 50);
$director = $animatedDirector("$work/autosprite-slow", $fake, timeout: 15);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
check(str_contains((string) (array_column($director->manifest(), null, 'key')['animations:bot']['missing']['walk'] ?? ''), 'resume the run'), 'animations not ready in time are named, with what to do');
$director = $animatedDirector("$work/autosprite-slow", $fake, timeout: 900);
$drawn = (new ReflectionMethod($director, 'character'))->invoke($director, $pip, '', [], ['point']);
same([count($drawn['char:bot']['params']['animations']), $fake->count('POST', '#/spritesheets$#'), $fake->count('POST', '#/characters$#')], [10, 1, 1], 'and a resume collects them by polling, never asking again');

// Offline: only what was made before.
$fake = new FakeAutoSprite;
$offline = $autoSprite($fake);
$offline->offline();
$png = ImageTools::png(ImageTools::blank(8, 8));
file_put_contents("$work/offline-sheet.png", $png);
check($offline->animate('x', 'X', 'x', "$work/offline-sheet.png", ['walk'], $work)['refused'] !== null && $fake->sent === [], 'finishing offline asks nothing new of AutoSprite');

// What is asked for, the estimate, and the grid read when there is no atlas.
same($autoSprite(new FakeAutoSprite, ['jump'])->animationsFor(['walk', 'cheer']), ['idle', 'walk', 'cheer', 'jump'], 'a trimmed list still holds idle, walk and the mission\'s gestures');
same(AutoSpriteAnimator::frameBoxes([], ['frameWidth' => 10, 'frameHeight' => 20, 'columns' => 2, 'frameCount' => 3], 20, 40), [[0, 0, 10, 20], [10, 0, 10, 20], [0, 20, 10, 20]], 'without an atlas, frames are read from the sheet\'s grid');
$estimateDirector = $animatedDirector("$work/autosprite-estimate", new FakeAutoSprite);
$estimate = $estimateDirector->estimate($blueprint);
check(($estimate['by_kind']['animation'] ?? 0) === 10 * count($blueprint['characters']) && ! isset($estimate['by_kind']['strip']) && $estimate['usd'] >= 10 * count($blueprint['characters']) * 0.095, 'the estimate counts and prices AutoSprite\'s animations instead of strips');

// Wiring: AutoSprite is the primary animator whenever its key is set, never for free pictures.
$withKey = $config;
$withKey['animations'] = ['driver' => 'autosprite', 'autosprite' => ['api_key' => 'vspk_test']];
$keyed = new GenerationFactory($withKey, $store, new FakeAutoSprite, $model, images: new PricedPlaceholder($placeholder));
check($keyed->method('classic', ['anchors_required' => false])->animator() instanceof AutoSpriteAnimator, 'with AUTOSPRITE_API_KEY set, AutoSprite animates the characters');
check($keyed->method('classic', ['animations' => 'draw'])->animator() === null, '--animations=draw draws strips instead');
check((new GenerationFactory($withKey, $store, new FakeAutoSprite, $model))->method('classic', ['images' => 'placeholder'])->animator() === null, 'placeholder pictures never call AutoSprite');
check((new GenerationFactory($config, $store, new NoNetwork, $model, images: new PricedPlaceholder($placeholder)))->method('classic')->animator() === null, 'without a key, the strips are drawn as before');
check($autoSprite(new FakeAutoSprite)->estimateUsd(['walk']) === 10 * (new Spend)->pictureCost('autosprite', 'turbo'), 'ten turbo animations are priced from Spend\'s table');

if (getenv('KEEP')) {
    fwrite(STDOUT, "Work folder kept: $work\n");
} else {
    exec('rm -rf '.escapeshellarg($work));
}
echo $failures ? "\n$failures of $checks checks failed\n" : "All $checks checks passed\n";
exit($failures ? 1 : 0);
