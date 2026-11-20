<?php

/**
 * Tests for the scenario store, the editor API and the JSON generator, run against SQLite:
 *
 *   php apps/api/tests/store.php
 *
 * These are the same classes Laravel uses in production; only the database differs.
 */
foreach (['StoreError', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ClassApi', 'ScenarioStore', 'ScenarioDecompiler', 'ScenarioArchive', 'EditorApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\EditorApi;
use App\Qbl\ScenarioArchive;
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
// The demo is shipped as the ZIP the editor exports; $seed is its rows as the archive reads them.
$zip = ScenarioArchive::SHIPPED.'/starship-explorer.zip';
$archive = new ScenarioArchive($store);
[$seed, $shipped, $zipped] = ScenarioArchive::read($zip, function (array $rows, callable $fileFor, array $document) {
    $files = [];
    foreach ($rows['media'] as $media) {
        if ($media['filepath'] !== null) {
            $files[basename($media['filepath'])] = sha1_file($fileFor($media));
        }
    }

    return [ScenarioArchive::asShipped($rows, $document), $document, $files];
});
$fromSeed = pretty($shipped);

// ------------------------------------------------------------------ seeding -> JSON
$id = $archive->seed($zip);
same($id, 1, 'seeding keeps the scenario id the ZIP was exported with');
$fromDatabase = pretty($store->compile($id));
check($fromDatabase === $fromSeed, 'JSON generated from the seeded database is the ZIP\'s scenario.json');
check(count($zipped) === 5 && array_filter(array_keys($zipped), fn ($name) => is_file("$mediaDir/1/$name") && sha1_file("$mediaDir/1/$name") === $zipped[$name]) === array_keys($zipped), 'the files in the ZIP are stored under the names the document uses');

$checkedIn = __DIR__.'/../../../scenarios/starship.json';
[$forFiles, $uploads] = ScenarioArchive::forFileBackend($store->compile($id));
check(is_file($checkedIn) && file_get_contents($checkedIn) === pretty($forFiles), 'scenarios/starship.json is current (run: npm run seed:export)');
$uploadDir = __DIR__.'/../../../scenarios/assets/starship/uploads';
check(array_keys($uploads) == array_keys($zipped) && ! array_filter($zipped, fn ($sha, $name) => ! is_file("$uploadDir/$name") || sha1_file("$uploadDir/$name") !== $sha, ARRAY_FILTER_USE_BOTH), 'and the files it uploaded are beside it, for the file backend');

$counts = fn () => array_map(fn ($t) => (int) $pdo->query("SELECT COUNT(*) FROM `$t`")->fetchColumn(), array_combine(ScenarioStore::CONTENT, ScenarioStore::CONTENT));
$before = $counts();
same($before['scenes'], count($seed['scenes']), 'every seeded scene is in the database');
same($before['actions'], count($seed['actions']), 'every seeded action is in the database');
same($before['conditions'], count($seed['conditions']), 'every seeded condition is in the database');

// Seeding again changes nothing, and a save game survives it.
$pdo->exec("INSERT INTO scenario_sessions (scenario_id, user_id, data) VALUES (1, 7, '{}')");
$archive->seed($zip, true);
same($counts(), $before, 'seeding twice leaves the same rows');
check(pretty($store->compile(1)) === $fromSeed, 'and the same document');
same(count(glob("$mediaDir/1/*")), count($zipped), 'and the same files, no more and no fewer');
same((int) $pdo->query('SELECT COUNT(*) FROM scenario_sessions')->fetchColumn(), 1, 'players\' saves survive a re-seed');

// Rows dropped from the seed disappear from the database.
$smaller = $seed;
$dropped = array_pop($smaller['actions']);
$store->replaceScenario($smaller);
same($counts()['actions'], $before['actions'] - 1, 'an action removed from the seed is removed from the database');
$store->replaceScenario($seed);
check(pretty($store->compile(1)) === $fromSeed, 'and seeding the full data restores it exactly');
same(count(glob("$mediaDir/1/*")), count($zipped), 'files the rows still use are kept');

// Seeding when the application starts: a scenario that is already there is left alone, edits and all.
$store->updateRow(1, 'scenes', 3, ['subtitle' => 'Edited by a teacher']);
same($archive->seed($zip), null, 'seeding on start leaves an existing scenario alone');
$subtitle = fn () => $pdo->query('SELECT subtitle FROM scenes WHERE id = 3')->fetchColumn();
same($subtitle(), 'Edited by a teacher', 'so an edit made in the editor survives a restart');
same($archive->seed($zip, true), 1, 'a reset replaces it');
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

// Changing the code players open the scenario at. The old code stops working.
[, $body] = $call('POST', 'scenarios', ['title' => 'Code test']);
$cid = $body['scenario']['id'];
$oldCode = $body['scenario']['code'];
same($body['scenario']['shortname'], $oldCode, 'a new scenario\'s shortname starts as its code');
$call('POST', "scenarios/$cid/publish");
check($store->findPublished($oldCode) !== null, 'the published scenario opens at its first code');
$codeBefore = $store->scenario($cid);
[$status, $body] = $call('PUT', "scenarios/$cid/code", ['code' => '  Rain-Forest-1 ']);
same([$status, $body['scenario']['code'] ?? null], [200, 'rain-forest-1'], 'a teacher can change the code; it is trimmed and lowercased');
same($body['scenario']['shortname'], 'rain-forest-1', 'a shortname that was the old code follows it');
same($body['scenario']['updated_at'], $codeBefore['updated_at'], 'changing the code is not an unpublished change');
same($store->findPublished('rain-forest-1')['code'] ?? null, 'rain-forest-1', 'the published scenario opens at the new code at once, with the new code in it');
same($store->findPublished($oldCode), null, 'and no longer at the old one');
same($call('PUT', "scenarios/$cid/code", ['code' => 'rain-forest-1'])[0], 200, 'keeping the same code is fine');
foreach (['abc' => 'too short', str_repeat('a', 33) => 'too long', '1forest' => 'starting with a digit', 'rain_forest' => 'with an underscore', 'rain--forest' => 'with two hyphens in a row', 'forest-' => 'ending with a hyphen', 'missions' => 'one of the site\'s addresses', 'docs' => 'the docs\' address'] as $bad => $why) {
    [$status, $body] = $call('PUT', "scenarios/$cid/code", ['code' => $bad]);
    same($status, 422, "a code is refused when $why");
}
check(is_string($body['error'] ?? $body['message'] ?? null), 'with a reason');
same($call('PUT', "scenarios/$cid/code", ['code' => 'starshipexplorer'])[0], 409, 'another scenario\'s code is refused');
same($call('PUT', "scenarios/$cid/code", ['code' => 'starship'])[0], 409, 'and so is another scenario\'s shortname, which opens it too');
same($call('PUT', "scenarios/$cid/code", ['code' => 'stolen-code'], $other)[0], 404, 'another teacher cannot change it');
same($call('PUT', 'scenarios/1/code', ['code' => 'my-starship'])[0], 403, 'a teacher cannot move a shared sample');
same($store->scenario(1)['code'], 'starshipexplorer', 'which keeps its code');
same($call('PATCH', "scenarios/$sid", ['shortname' => 'Rain-Forest-1'])[0], 422, 'another scenario cannot take the new code as its shortname');
same($call('PATCH', "scenarios/$cid", ['shortname' => 'Rain-Forest-1'])[0], 200, 'its own shortname may match its code');
$store->updateScenario($cid, ['shortname' => 'rainforest-rescue']);
same($call('PUT', "scenarios/$cid/code", ['code' => 'rainforest-two'])[1]['scenario']['shortname'] ?? null, 'rainforest-rescue', 'a shortname chosen by hand is left alone');
same($call('PUT', "scenarios/$cid/code", ['code' => 'rain-forest-1'])[0], 200, 'a code can be changed again');
same($call('DELETE', "scenarios/$cid")[0], 204, 'the code test scenario is deleted again');

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

// An animated PNG is noted as one when it is uploaded: its frames and its timing.
$chunk = fn (string $type, string $data) => pack('N', strlen($data)).$type.$data.pack('N', crc32($type.$data));
$pixels = fn (string $rgba) => gzcompress("\0".$rgba.$rgba."\0".$rgba.$rgba);
$fctl = fn (int $seq, int $ms) => pack('NNNNNnnCC', $seq, 2, 2, 0, 0, $ms, 1000, 0, 0);
$apngFile = sys_get_temp_dir().'/qbl-test-anim.png';
file_put_contents($apngFile, "\x89PNG\r\n\x1a\n".$chunk('IHDR', pack('NNCCCCC', 2, 2, 8, 6, 0, 0, 0)).$chunk('acTL', pack('NN', 2, 0))
    .$chunk('fcTL', $fctl(0, 300)).$chunk('IDAT', $pixels("\xff\0\0\xff")).$chunk('fcTL', $fctl(1, 500)).$chunk('fdAT', pack('N', 2).$pixels("\0\0\xff\xff")).$chunk('IEND', ''));
[$status, $body] = $call('POST', "scenarios/$sid/media/upload", [], null, ['file' => ['tmp_name' => $apngFile, 'name' => 'blink.png']]);
$blink = $body['row'] ?? [];
same([$status, $blink['params']['apng'] ?? null], [201, ['frames' => 2, 'duration' => 800, 'plays' => 0]], 'an animated PNG upload says how many frames it has and how long it plays');
[, $body] = $call('POST', "scenarios/$sid/media/upload", [], null, ['file' => ['tmp_name' => $png, 'name' => 'still.png']]);
$still = $body['row'];
same(isset($still['params']['apng']), false, 'a still PNG does not');
$asset = array_values(array_filter($store->compile($sid)['assets'], fn ($m) => $m['id'] === $blink['id']))[0];
same([$asset['apng']['frames'], isset($asset['params']['apng'])], [2, false], 'the scenario document carries it on the media');

// A character is drawn from its animations, each a picture of this scenario's.
$animations = ['stand_right' => ['media_id' => $blink['id']], 'walk_right' => ['media_id' => $still['id'], 'frames' => ['0'], 'duration' => '450', 'flip' => false, 'extra' => 1], 'wave' => ['media_id' => $blink['id'], 'repeat' => true]];
[$status, $body] = $call('POST', "scenarios/$sid/rows/characters", ['name' => 'Guide', 'settings' => ['scale' => 0.9, 'animations' => $animations]]);
$guide = $body['row'] ?? [];
same([$status, $guide['settings']['animations'] ?? null], [201, ['stand_right' => ['media_id' => $blink['id']], 'walk_right' => ['media_id' => $still['id'], 'frames' => [0], 'duration' => 450], 'wave' => ['media_id' => $blink['id'], 'repeat' => true]]], 'a character keeps its animations, tidied');
same($call('PATCH', "scenarios/$sid/rows/characters/{$guide['id']}", ['settings' => ['animations' => ['stand_right' => ['media_id' => 1]]]])[0], 422, "another scenario's picture is refused");
same($call('PATCH', "scenarios/$sid/rows/characters/{$guide['id']}", ['settings' => ['animations' => ['Stand Right' => ['media_id' => $still['id']]]]])[0], 422, 'so is a name the game cannot use');
same($call('PATCH', "scenarios/$sid/rows/characters/{$guide['id']}", ['settings' => ['animations' => [['media_id' => $still['id']]]]])[0], 422, 'and a list where names belong');
same($compiled = array_values(array_filter($store->compile($sid)['characters'], fn ($c) => $c['id'] === $guide['id']))[0]['animations']['wave'], ['media_id' => $blink['id'], 'repeat' => true], 'the document carries them');
$call('DELETE', "scenarios/$sid/rows/media/{$blink['id']}");
[, $bundle] = $call('GET', "scenarios/$sid");
$left = array_values(array_filter($bundle['characters'], fn ($c) => $c['id'] === $guide['id']))[0];
same(array_keys($left['settings']['animations']), ['walk_right'], 'deleting a picture takes away the animations drawn from it, and only those');
same($call('DELETE', "scenarios/$sid/rows/characters/{$guide['id']}")[0], 204, 'characters can be deleted');
$call('DELETE', "scenarios/$sid/rows/media/{$still['id']}");

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
