<?php

/**
 * Tests for the asset library (App\Qbl\Library): the shipped pack, adding assets to scenarios,
 * keeping a scenario's things in the library, and its API. Against SQLite:
 *
 *   php apps/api/tests/library.php
 */
foreach (['StoreError', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ScenarioStore', 'ScenarioDecompiler', 'Library/AssetLibrary', 'Library/LibraryApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\Library\AssetLibrary;
use App\Qbl\Library\LibraryApi;
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

$mediaDir = sys_get_temp_dir().'/qbl-library-test-'.bin2hex(random_bytes(4));
$packDir = realpath(__DIR__.'/../../../scenarios/assets/library');
$pdo = new PDO('sqlite::memory:');
$store = new ScenarioStore($pdo, $mediaDir, '/media');
foreach (array_merge(ScenarioStore::sqliteSchema(), AssetLibrary::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
$library = new AssetLibrary($pdo, $mediaDir, '/media', $packDir);
$pack = json_decode(file_get_contents("$packDir/library.json"), true);

// ------------------------------------------------------------------ the pack
$counts = $library->importPack();
same($counts['added'], count($pack['assets']), 'every asset of the pack is added');
same($library->importPack(), ['added' => 0, 'updated' => 0, 'kept' => count($pack['assets'])], 'importing again adds nothing');
$kinds = array_count_values(array_column($library->all(), 'kind'));
same($kinds, ['character' => 16, 'vehicle' => 9], 'the pack holds 16 animals and 9 vehicles');
$vehicles = $library->all(['kind' => 'vehicle']);
same(array_column($vehicles, 'slug'), ['red-convertible', 'yellow-roadster', 'farm-truck', 'silver-hatchback', 'motorcycle', 'bicycle', 'bay-horse', 'palomino-horse', 'stagecoach'], 'the vehicles, in the pack\'s order');
same(array_column($library->categories(['kind' => 'vehicle']), 'name'), ['Cars', 'Bikes', 'Horses', 'Horse-drawn'], 'their categories');
foreach ($library->all() as $asset) {
    foreach ($asset['files'] as $file) {
        check($library->filePath($file) !== null && str_starts_with($file['url'], '/scenario-assets/library/'), "{$asset['slug']}: its {$file['role']} file is in the pack and served from it");
    }
    check(! empty($asset['credit']['license']) && ! empty($asset['credit']['url']), "{$asset['slug']} has a credit");
}
same(array_column($library->all(['q' => 'horse']), 'slug'), ['horse', 'bay-horse', 'palomino-horse', 'stagecoach'], 'searching finds every word in name, description and tags');
same(array_column($library->all(['kind' => 'vehicle', 'tag' => 'west']), 'slug'), ['bay-horse', 'palomino-horse', 'stagecoach'], 'and by tag');
same($library->find('nothing-here'), null, 'an unknown slug is not found');
$horse = $library->get('bay-horse');
same($library->get((string) $horse['id'])['slug'], 'bay-horse', 'an asset is found by id or by slug');
$sheet = $horse['files'][0];
same([$sheet['role'], array_column($sheet['params']['animations'], 'name')], ['sheet', ['idle', 'walk', 'gallop']], 'a horse\'s sheet walks, idles and gallops');
foreach ($vehicles as $v) {
    $s = $v['definition']['item']['settings'];
    check($s['hide_rider_below'] > 0 && $s['hide_rider_below'] < 1 && $s['speed_multiplier'] > 1 && $s['art_faces'] === 'right', "{$v['slug']}: a seat and a speed");
}

// ------------------------------------------------------------------ adding to a scenario
$scenario = $store->createScenario(['title' => 'Zoo and garage'], 1);
$sid = (int) $scenario['id'];
$added = $library->addToScenario($store, $sid, 'red-squirrel');
same($added['created']['table'], 'characters', 'an animal makes a character');
$squirrel = $added['created']['row'];
same($squirrel['name'], 'Red Squirrel', 'named after the asset');
same(count($added['copied']), 2, 'its sheet and close-up are copied into the scenario');
$byRole = [];
foreach ($added['media'] as $m) {
    $byRole[$m['params']['library']['file']] = $m;
    check(is_file("$mediaDir/{$m['filepath']}"), "the {$m['params']['library']['file']} file is stored for the scenario");
    same($m['params']['credit']['license'], 'CC0', 'the media carries the credit');
}
$animations = $squirrel['settings']['animations'];
same($animations['walk_right']['media_id'], $byRole['sheet']['id'], 'its walk is drawn from the copied sheet');
same($animations['portrait']['media_id'], $byRole['portrait']['id'], 'and its close-up from the copied portrait');
same($byRole['sheet']['params']['sheet'], $pack['assets'][0]['files']['sheet']['params']['sheet'], 'the sheet keeps its grid');
same($byRole['sheet']['params']['category'], 'character', 'filed under characters');

$again = $library->addToScenario($store, $sid, 'red-squirrel');
same([$again['created']['row']['name'], $again['copied']], ['Red Squirrel 2', []], 'adding it again shares the pictures and takes the next name');
same(array_column($again['media'], 'id'), array_column($added['media'], 'id'), 'the same media');

$ride = $library->addToScenario($store, $sid, 'stagecoach', ['name' => 'The Mail Coach']);
$coach = $ride['created']['row'];
same([$ride['created']['table'], $coach['name'], (bool) $coach['vehicle']], ['items', 'The Mail Coach', true], 'a vehicle makes an item to ride, under the name given');
same($coach['settings']['hide_rider_below'], $library->get('stagecoach')['definition']['item']['settings']['hide_rider_below'], 'with the seat from the library');
same((int) $coach['media_id'], $ride['media'][0]['id'], 'drawn from its copied sheet');
same(array_column($ride['media'][0]['params']['animations'], 'name'), ['idle', 'walk'], 'whose idle and walk play by themselves');
same(count($ride['media']), 1, 'only the sheet is copied, not the card\'s preview');

$document = $store->compile($sid);
$compiledCoach = array_values(array_filter($document['items'], fn ($i) => $i['name'] === 'The Mail Coach'))[0];
same([$compiledCoach['vehicle'], $compiledCoach['speed_multiplier'], $compiledCoach['art_faces']], [true, 1.4, 'right'], 'the scenario JSON has the vehicle with its riding settings');
check(count(array_filter($document['characters'], fn ($c) => str_starts_with($c['name'], 'Red Squirrel'))) === 2, 'and both squirrels');

$library->save(['id' => $library->get('motorcycle')['id'], 'active' => false]);
check(! in_array('motorcycle', array_column($library->all(), 'slug'), true), 'a withdrawn asset is not listed');
try {
    $library->addToScenario($store, $sid, 'motorcycle');
    check(false, 'a withdrawn asset cannot be added');
} catch (App\Qbl\StoreError $e) {
    same($e->status, 422, 'a withdrawn asset cannot be added');
}
$library->save(['id' => $library->get('motorcycle')['id'], 'active' => true]);

// ------------------------------------------------------------------ keeping a scenario's things
$kept = $library->capture($store, $sid, 'characters', $squirrel['id'], ['name' => 'Squeaky', 'category' => 'Our characters', 'tags' => 'school, mascot']);
same([$kept['kind'], $kept['slug'], $kept['source'], $kept['tags']], ['character', 'squeaky', 'scenario', ['school', 'mascot']], 'a character is kept as a library asset');
same(array_column($kept['files'], 'role'), ['sheet', 'portrait'], 'with the pictures its animations use');
same($kept['definition']['animations']['walk_right']['file'], 'sheet', 'its animations point at them by role');
same($kept['definition']['animations']['walk_right']['frames'], $animations['walk_right']['frames'], 'keeping their frames');
check(str_starts_with($kept['files'][0]['url'], '/media/library/') && $library->filePath($kept['files'][0]) !== null, 'its files are stored in the media directory');
same($kept['files'][0]['params']['sheet'], $byRole['sheet']['params']['sheet'], 'the sheet\'s grid comes along');

$other = (int) $store->createScenario(['title' => 'Another'], 1)['id'];
$copy = $library->addToScenario($store, $other, 'squeaky');
same([$copy['created']['row']['name'], count($copy['copied'])], ['Squeaky', 2], 'and added to another scenario like any asset');

$keptCoach = $library->capture($store, $sid, 'items', $coach['id']);
same([$keptCoach['kind'], $keptCoach['slug'], $keptCoach['definition']['item']['settings']['speed_multiplier']], ['vehicle', 'the-mail-coach', 1.4], 'a vehicle is kept with its settings');

try {
    $library->save(['slug' => 'squeaky', 'kind' => 'monster', 'name' => 'x']);
    check(false, 'an unknown kind is refused');
} catch (App\Qbl\StoreError $e) {
    same($e->status, 422, 'an unknown kind is refused');
}
$library->remove('squeaky');
same($library->find('squeaky'), null, 'an asset can be removed');
check(! is_dir("$mediaDir/library/{$kept['id']}") || ! glob("$mediaDir/library/{$kept['id']}/*"), 'with its stored files');
check(is_file("$mediaDir/{$copy['media'][0]['filepath']}"), 'while scenarios that added it keep their copies');

// ------------------------------------------------------------------ the API
$api = new LibraryApi($library, $store);
$teacher = ['id' => 1, 'name' => 'Teacher', 'role' => 'teacher'];
$admin = ['id' => 2, 'name' => 'Admin', 'role' => 'admin'];
$pdo->exec("INSERT INTO `users` (`id`, `name`, `role`) VALUES (1, 'Teacher', 'teacher'), (2, 'Admin', 'admin'), (3, 'Other', 'teacher')");
same($api->handle('GET', '', [], null)[0], 401, 'the library needs a signed-in user');
same($api->handle('GET', '', [], ['id' => 9, 'role' => 'student'])[0], 403, 'students cannot use it');
[$status, $body] = $api->handle('GET', '', [], $teacher, [], ['kind' => 'vehicle,item']);
same([$status, count($body['assets']), $body['categories'][0]], [200, 10, ['name' => 'Cars', 'count' => 4]], 'teachers list the vehicles');
[$status, $body] = $api->handle('POST', 'bay-horse/add', ['scenario_id' => $sid], $teacher);
same([$status, $body['created']['row']['name']], [201, 'Bay Horse'], 'and add one to their scenario');
same($api->handle('POST', 'bay-horse/add', ['scenario_id' => $sid], ['id' => 3, 'role' => 'teacher'])[0], 404, 'but not to someone else\'s');
same($api->handle('POST', '', ['kind' => 'picture', 'name' => 'Sky'], $teacher)[0], 403, 'only administrators change the library');
[$status, $body] = $api->handle('POST', '', ['kind' => 'picture', 'name' => 'Night Sky', 'category' => 'Backdrops', 'credit' => ['author' => 'QuestLab', 'license' => 'CC0']], $admin);
same([$status, $body['asset']['slug'], $body['asset']['created_by']], [201, 'night-sky', 2], 'administrators create assets');
$png = tempnam(sys_get_temp_dir(), 'qbl');
imagepng(imagecreatetruecolor(4, 3), $png);
[$status, $body] = $api->handle('POST', 'night-sky/files', ['role' => 'image', 'params' => '{"scale_x": 2}'], $admin, ['file' => ['tmp_name' => $png, 'name' => 'sky.png']]);
same([$status, $body['asset']['files'][0]['width'], $body['asset']['files'][0]['params']['scale_x']], [201, 4, 2], 'and give them files');
[$status, $body] = $api->handle('PATCH', 'night-sky', ['definition' => ['file' => 'image'], 'tags' => ['space', 'night']], $admin);
same([$status, $body['asset']['definition'], $body['asset']['tags']], [200, ['file' => 'image'], ['space', 'night']], 'and change them');
[$status, $body] = $api->handle('POST', 'night-sky/add', ['scenario_id' => $sid], $teacher);
same([$status, $body['created'], $body['media'][0]['scale_x'], $body['media'][0]['params']['category']], [201, null, 2, 'picture'], 'a picture adds only its media, stretched as the library says');
$pdo->exec("UPDATE `library_assets` SET `organization_id` = 7 WHERE `slug` = 'night-sky'");
same($api->handle('GET', 'night-sky', [], $teacher)[0], 404, 'an organization\'s asset is hidden from teachers outside it');
$pdo->exec('UPDATE `users` SET `organization_id` = 7 WHERE `id` = 1');
same($api->handle('GET', 'night-sky', [], $teacher)[0], 200, 'and shown to its own');
[$status, $body] = $api->handle('POST', 'capture', ['scenario_id' => $sid, 'table' => 'characters', 'row_id' => $squirrel['id'], 'slug' => 'squirrel-two'], $admin);
same([$status, $body['asset']['slug']], [201, 'squirrel-two'], 'administrators keep a scenario\'s character through the API');
same($api->handle('DELETE', 'squirrel-two', [], $admin)[0], 204, 'and remove assets');
same($api->handle('GET', 'squirrel-two', [], $admin)[0], 404, 'which are gone');

unlink($png);
exec('rm -rf '.escapeshellarg($mediaDir));
if ($failures) {
    fwrite(STDERR, "$failures of $checks checks failed\n");
    exit(1);
}
echo "ok: $checks checks passed (pack, adding, keeping, API)\n";
