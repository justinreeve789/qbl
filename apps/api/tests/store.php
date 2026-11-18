<?php

/**
 * Tests for the scenario store, the editor API and the JSON generator, run against SQLite:
 *
 *   php apps/api/tests/store.php
 *
 * These are the same classes Laravel uses in production; only the database differs.
 */
foreach (['StoreError', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Avatars', 'ClassApi', 'ScenarioStore', 'ScenarioDecompiler', 'ScenarioArchive', 'EditorApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\EditorApi;
use App\Qbl\ScenarioCompiler;
use App\Qbl\ScenarioStore;

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
function pretty(array $doc): string
{
    return json_encode($doc, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n";
}

$mediaDir = sys_get_temp_dir().'/qbl-store-test-'.bin2hex(random_bytes(4));
$pdo = new PDO('sqlite::memory:');
$store = new ScenarioStore($pdo, $mediaDir, '/media');
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$seed = require __DIR__.'/../database/seeders/data/starship.php';

// ------------------------------------------------------------------ seeding -> JSON
$id = $store->replaceScenario($seed);
same($id, 1, 'seeding keeps the scenario id from the seed data');
$fromSeed = pretty(ScenarioCompiler::compile($seed));
$fromDatabase = pretty($store->compile($id));
check($fromDatabase === $fromSeed, 'JSON generated from the seeded database equals JSON generated from the seed arrays');

$checkedIn = __DIR__.'/../../../scenarios/starship.json';
check(is_file($checkedIn) && file_get_contents($checkedIn) === $fromSeed, 'scenarios/starship.json is current (run: npm run seed:export)');

$counts = fn () => array_map(fn ($t) => (int) $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn(), array_combine(ScenarioStore::CONTENT, ScenarioStore::CONTENT));
$before = $counts();
same($before['scenes'], count($seed['scenes']), 'every seeded scene is in the database');
same($before['actions'], count($seed['actions']), 'every seeded action is in the database');
same($before['conditions'], count($seed['conditions']), 'every seeded condition is in the database');

// Seeding again changes nothing, and a save game survives it.
$pdo->exec("INSERT INTO scenario_sessions (scenario_id, user_id, data) VALUES (1, 7, '{}')");
$store->replaceScenario($seed);
same($counts(), $before, 'seeding twice leaves the same rows');
same((int) $pdo->query('SELECT COUNT(*) FROM scenario_sessions')->fetchColumn(), 1, 'players\' saves survive a re-seed');

// Rows dropped from the seed disappear from the database.
$smaller = $seed;
$dropped = array_pop($smaller['actions']);
$store->replaceScenario($smaller);
same($counts()['actions'], $before['actions'] - 1, 'an action removed from the seed is removed from the database');
$store->replaceScenario($seed);
check(pretty($store->compile(1)) === $fromSeed, 'and seeding the full data restores it exactly');

// Seeding when the application starts: a scenario that is already there is left alone, edits and all.
$store->updateRow(1, 'scenes', 3, ['subtitle' => 'Edited by a teacher']);
same($store->seedScenario($seed), null, 'seeding on start leaves an existing scenario alone');
$subtitle = fn () => $pdo->query('SELECT subtitle FROM scenes WHERE id = 3')->fetchColumn();
same($subtitle(), 'Edited by a teacher', 'so an edit made in the editor survives a restart');
same($store->seedScenario($seed, true), 1, 'a reset replaces it');
check(pretty($store->compile(1)) === $fromSeed, 'and puts the shipped version back exactly');

// Seed rows name their own ids, so seeding must refuse to take rows that belong to another scenario.
$clash = $seed;
$clash['scenario'] = ['id' => 50, 'code' => 'anotherscenariox', 'shortname' => 'another'] + $seed['scenario'];
try {
    $store->replaceScenario($clash);
    check(false, 'seeding over another scenario\'s rows is refused');
} catch (App\Qbl\StoreError $e) {
    same($e->status, 409, 'seeding over another scenario\'s rows is refused');
}
same($store->scenario(50), null, 'and nothing of the refused seed is left behind');
same($counts(), $before, 'nor is the scenario that owns those rows touched');

// ------------------------------------------------------------------ publishing and codes
same($store->findPublished('starshipexplorer'), null, 'a scenario is not served before it is published');
$store->publish(1);
$published = $store->findPublished('starshipexplorer');
same($published['code'] ?? null, 'starshipexplorer', 'published scenario is found by its 16-letter code');
same($store->findPublished('STARSHIPEXPLORER')['id'] ?? null, 1, 'codes are not case-sensitive');
same($store->findPublished('starship')['id'] ?? null, 1, 'the shortname also works');
same($store->findPublished('nosuchscenarioxx'), null, 'unknown codes find nothing');
check(pretty($published) === $fromSeed, 'the published document is the generated JSON');

// ------------------------------------------------------------------ the editor API
$api = new EditorApi($store);
$teacher = ['id' => 10, 'name' => 'T', 'role' => 'teacher'];
$other = ['id' => 11, 'name' => 'O', 'role' => 'teacher'];
$admin = ['id' => 1, 'name' => 'A', 'role' => 'admin'];
$call = fn (string $method, string $path, array $body = [], ?array $user = null, array $files = []) => $api->handle($method, $path, $body, $user ?? $GLOBALS['teacher'], $files);

same($api->handle('GET', 'scenarios', [], null)[0], 401, 'the editor needs a signed-in user');
same($api->handle('GET', 'scenarios', [], ['id' => 5, 'role' => 'student'])[0], 403, 'students cannot use the editor');
same($call('POST', 'scenarios', ['title' => ' '])[0], 422, 'a scenario needs a title');

[$status, $body] = $call('POST', 'scenarios', ['title' => 'Rainforest Rescue', 'subtitle' => 'Test']);
same($status, 201, 'a teacher can create a scenario');
$mine = $body['scenario'];
check((bool) preg_match('/^[a-z]{16}$/', $mine['code']), 'a new scenario gets a 16-letter code');
check($mine['code'] !== 'starshipexplorer', 'the code is its own');
same($mine['user_id'], 10, 'the creator owns it');
$sid = $mine['id'];

$codes = [];
for ($i = 0; $i < 200; $i++) {
    $codes[$store->generateCode()] = true;
}
same(count($codes), 200, 'generated codes do not repeat');

[, $bundle] = $call('GET', "scenarios/$sid");
same(count($bundle['scenes']), 1, 'a new scenario starts with one scene');
$scene = $bundle['scenes'][0];
same($bundle['scenario']['start_scene_id'], $scene['id'], 'which is the start scene');
same($scene['layout']['spawn_points'][0]['name'], 'default', 'with a default spawn point');
same([$scene['show_avatars'], $scene['width']], [true, 1920], 'rows come back typed');

same(count($call('GET', 'scenarios')[1]['scenarios']), 2, 'a teacher sees their own scenario and the shared sample');
same(count($call('GET', 'scenarios', [], $other)[1]['scenarios']), 1, 'another teacher sees only the shared sample');
same($call('GET', "scenarios/$sid", [], $other)[0], 404, 'and cannot open someone else\'s scenario');
same($call('PATCH', "scenarios/$sid", ['title' => 'Hacked'], $other)[0], 404, 'or change it');
same($call('GET', "scenarios/$sid", [], $admin)[0], 200, 'an admin can');

// Media by URL, and a scrolling background layer on the scene.
[$status, $body] = $call('POST', "scenarios/$sid/rows/media", ['type' => 'image', 'url' => 'https://example.org/forest.jpg', 'width' => 3000, 'height' => 1080]);
same($status, 201, 'media can be added by URL');
$bg = $body['row']['id'];
same($call('POST', "scenarios/$sid/rows/media", ['type' => 'pdf', 'url' => 'x'])[0], 422, 'media type must be audio, image or video');
[$status, $body] = $call('PATCH', "scenarios/$sid/rows/scenes/{$scene['id']}", [
    'width' => 3000, 'shortname' => 'forest-floor',
    'background_media' => [['media_id' => $bg, 'display_width' => 3000, 'display_height' => 1080], ['media_id' => $bg, 'tile' => true, 'scroll_speed_x' => 20, 'parallax' => 0.5]],
]);
same([$status, $body['row']['width'], $body['row']['background_media'][1]['scroll_speed_x']], [200, 3000, 20], 'a scene can be widened and given scrolling layers');

// A variable, a hotspot with a label, an action and conditions.
[, $body] = $call('POST', "scenarios/$sid/rows/variables", ['variable_name' => 'found_frog', 'default_value' => 0]);
same($body['row']['scope'], 'player', 'variables default to player scope');
same($call('POST', "scenarios/$sid/rows/variables", ['variable_name' => 'QBLTime'])[0], 422, 'reserved variable names are refused');
[$status, $body] = $call('POST', "scenarios/$sid/rows/events", ['scene_id' => $scene['id'], 'kind' => 'hotspot', 'shortname' => 'frog', 'position_x' => 1500, 'position_y' => 800]);
$hotspot = $body['row'];
same([$status, $hotspot['radius'], $hotspot['activate_by_trigger'], $hotspot['sequence']], [201, 100, true, 1], 'a hotspot gets sensible defaults');
[, $body] = $call('POST', "scenarios/$sid/rows/actions", ['event_id' => $hotspot['id'], 'type' => 'infobox', 'params' => ['content' => '<p>A frog!</p>']]);
$action = $body['row'];
[, $body] = $call('POST', "scenarios/$sid/rows/actions", ['event_id' => $hotspot['id'], 'type' => 'variable', 'params' => ['name' => 'found_frog', 'operator' => 'set', 'operand' => 1]]);
same([$action['sequence'], $body['row']['sequence']], [1, 2], 'actions are appended in order');
same($call('POST', "scenarios/$sid/rows/actions", ['event_id' => $hotspot['id'], 'type' => 'explode'])[0], 422, 'unknown action types are refused');
same($hotspot['audience'], 'player', 'a new event is seen only by the player who sets it off');
same($call('PATCH', "scenarios/$sid/rows/events/{$hotspot['id']}", ['audience' => 'world'])[0], 422, 'an event is for the player or for the scene, nothing else');
same($call('PATCH', "scenarios/$sid/rows/events/{$hotspot['id']}", ['audience' => 'scene'])[1]['row']['audience'], 'scene', 'an event can be shown to everyone in the scene');
[, $body] = $call('POST', "scenarios/$sid/rows/conditions", ['event_id' => $hotspot['id'], 'variable' => 'found_frog', 'operator' => '=', 'operand' => 0]);
$condition = $body['row'];
same($condition['operand'], 0, 'a condition\'s operand keeps its type');
$call('POST', "scenarios/$sid/rows/conditions", ['action_id' => $action['id'], 'variable' => 'found_frog', 'operator' => '=', 'operand' => 'no']);
same($call('POST', "scenarios/$sid/rows/conditions", ['variable' => 'found_frog'])[0], 422, 'a condition must belong to something');
[, $body] = $call('POST', "scenarios/$sid/rows/labels", ['event_id' => $hotspot['id'], 'type' => 'text', 'text' => 'Look here', 'position_x' => 1500, 'position_y' => 700]);
$label = $body['row'];

// Nothing can be attached across scenarios.
$starshipScene = $seed['scenes'][0]['id'];
same($call('POST', "scenarios/$sid/rows/events", ['scene_id' => $starshipScene, 'kind' => 'start'])[0], 422, 'an event cannot be added to another scenario\'s scene');
same($call('PATCH', "scenarios/$sid/rows/actions/{$seed['actions'][0]['id']}", ['type' => 'wait'])[0], 404, 'another scenario\'s rows cannot be changed through this one');
same($call('DELETE', "scenarios/$sid/rows/scenes/$starshipScene")[0], 404, 'or deleted');
same($call('POST', "scenarios/$sid/rows/actions", ['event_id' => $hotspot['id'], 'type' => 'audio', 'media_id' => $seed['media'][0]['id']])[0], 422, 'or their media used');
same($call('POST', "scenarios/$sid/rows/users", ['name' => 'x'])[0], 404, 'only scenario tables are reachable');

// The draft compiles to the documented JSON shape.
[, $body] = $call('GET', "scenarios/$sid/preview");
$doc = $body['scenario'];
$h = $doc['scenes'][0]['hotspots'][0];
same([$doc['code'], $doc['scenes'][0]['shortname'], $h['shortname'], $h['position_x'], $h['radius']], [$mine['code'], 'forest-floor', 'frog', 1500, 100], 'the preview JSON contains what was built');
same(array_column($h['actions'], 'type'), ['infobox', 'variable'], 'with actions in sequence');
same($h['actions'][0]['content'], '<p>A frog!</p>', 'action attributes sit beside the common ones');
same($h['conditions'][0]['variable'], 'found_frog', 'event conditions are attached');
same($h['actions'][0]['conditions'][0]['operand'], 'no', 'action conditions are attached');
same($h['labels'][0]['text'], 'Look here', 'labels are attached');
same($store->findPublished($mine['code']), null, 'a draft is not what players get');
same($call('POST', "scenarios/$sid/publish")[0], 200, 'publishing succeeds');
same($store->findPublished($mine['code'])['title'] ?? null, 'Rainforest Rescue', 'and then players can load it by code');
$call('PATCH', "scenarios/$sid", ['title' => 'Rainforest Rescue 2']);
same($store->findPublished($mine['code'])['title'], 'Rainforest Rescue', 'later edits stay a draft until published again');

// Editing and deleting.
same($call('PATCH', "scenarios/$sid/rows/actions/{$action['id']}", ['params' => ['content' => '<p>Two frogs!</p>', 'dismissible' => false]])[1]['row']['params']['dismissible'], false, 'a row can be edited');
same($call('PATCH', "scenarios/$sid/rows/events/{$hotspot['id']}", ['position_x' => null])[1]['row']['position_x'], null, 'a hotspot coordinate can be cleared to span the axis');
same($call('DELETE', "scenarios/$sid/rows/labels/{$label['id']}")[0], 204, 'a label can be deleted');
same($call('DELETE', "scenarios/$sid/rows/events/{$hotspot['id']}")[0], 204, 'deleting a hotspot');
[, $bundle] = $call('GET', "scenarios/$sid");
same([count($bundle['events']), count($bundle['actions']), count($bundle['conditions']), count($bundle['labels'])], [0, 0, 0, 0], 'removes its actions, conditions and labels');

// Uploads: the type comes from the file's content.
$png = sys_get_temp_dir().'/qbl-test.png';
file_put_contents($png, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC'));
[$status, $body] = $call('POST', "scenarios/$sid/media/upload", [], null, ['file' => ['tmp_name' => $png, 'name' => '../../evil name.png']]);
$upload = $body['row'] ?? [];
same([$status, $upload['type'] ?? null, $upload['width'] ?? null, $upload['height'] ?? null], [201, 'image', 2, 3], 'an uploaded image becomes a media row with its size');
check((bool) preg_match("#^/media/$sid/[a-f0-9]{24}\\.png$#", $upload['url'] ?? ''), 'it is stored under a random name inside the scenario\'s folder');
check(is_file("$mediaDir/{$upload['filepath']}"), 'the file is on disk');
$php = sys_get_temp_dir().'/qbl-test.php';
file_put_contents($php, "<?php echo 'x';");
same($call('POST', "scenarios/$sid/media/upload", [], null, ['file' => ['tmp_name' => $php, 'name' => 'picture.png']])[0], 422, 'a script renamed to .png is refused');
$call('PATCH', "scenarios/$sid/rows/characters/0", []);
[, $body] = $call('POST', "scenarios/$sid/rows/items", ['name' => 'Boat', 'vehicle' => true, 'media_id' => $upload['id'], 'settings' => ['speed_multiplier' => 2]]);
$item = $body['row'];
same($call('DELETE', "scenarios/$sid/rows/media/{$upload['id']}")[0], 204, 'media can be deleted');
check(! is_file("$mediaDir/{$upload['filepath']}"), 'which removes the uploaded file');
[, $bundle] = $call('GET', "scenarios/$sid");
same($bundle['items'][0]['media_id'], null, 'and things that used it keep existing without it');
same($call('DELETE', "scenarios/$sid/rows/items/{$item['id']}")[0], 204, 'items can be deleted');

// A scenario's address cannot be taken or changed through the API.
same($call('PATCH', "scenarios/$sid", ['shortname' => 'starshipexplorer'])[0], 422, 'a shortname spelled like another scenario\'s code is refused');
[, $body] = $call('PATCH', "scenarios/$sid", ['code' => 'aaaaaaaaaaaaaaaa', 'title' => 'Renamed']);
same([$body['scenario']['code'], $body['scenario']['title']], [$mine['code'], 'Renamed'], 'the code cannot be changed; other attributes can');
same($store->findPublished('starshipexplorer')['id'] ?? null, 1, 'and the demo is still what its code opens');

// Deleting a scenario removes all of it and nothing else.
[, $body] = $call('POST', "scenarios/$sid/media/upload", [], null, ['file' => ['tmp_name' => $png, 'name' => 'left-behind.png']]);
check(is_file("$mediaDir/{$body['row']['filepath']}"), 'a scenario with an uploaded file');
same($call('DELETE', "scenarios/$sid")[0], 204, 'a scenario can be deleted');
check(! is_dir("$mediaDir/$sid"), 'which removes its uploaded files from disk');
same($call('GET', "scenarios/$sid")[0], 404, 'and is gone');
same($counts(), $before, 'leaving the other scenario untouched');

array_map('unlink', [$png, $php]);
if ($failures) {
    fwrite(STDERR, "$failures of $checks checks failed\n");
    exit(1);
}
echo "ok: $checks checks passed (seeding, JSON generation, codes, publishing, editor API, uploads)\n";
