<?php

/**
 * Tests for bringing scenarios in and out: the JSON-to-rows decompiler, importing rows under
 * new ids, duplicating, the starship hub template, and ZIP export and import.
 *
 *   php apps/api/tests/porting.php
 */
foreach (['StoreError', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ClassApi', 'ScenarioStore', 'ScenarioDecompiler', 'ScenarioArchive', 'EditorApi', 'ActivityStore', 'Api/Sql', 'Api/Reports'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\EditorApi;
use App\Qbl\ScenarioArchive;
use App\Qbl\ScenarioCompiler;
use App\Qbl\ScenarioDecompiler;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;

$checks = 0;
$failures = 0;
function check(bool $ok, string $what): void
{
    global $checks, $failures;
    $checks++;
    if (! $ok) {
        $failures++;
        fwrite(STDERR, "FAIL: $what\n");
    }
}
function same(mixed $actual, mixed $expected, string $what): void
{
    check($actual === $expected, $what.' (got '.substr(json_encode($actual), 0, 300).', expected '.substr(json_encode($expected), 0, 300).')');
}

/**
 * A document with everything that names it taken out, so two copies of one scenario compare
 * equal: ids are replaced by the order things were first met in, per kind of thing.
 */
function shape(array $document): array
{
    $tables = ['media_id' => 'm', 'music_media_id' => 'm', 'portrait_media_id' => 'm', 'media' => 'm', 'scene_id' => 's', 'start_scene_id' => 's', 'event_id' => 'e', 'target_event_id' => 'e', 'action_id' => 'a', 'target_id' => 'a', 'item_id' => 'i', 'character_id' => 'c'];
    $seen = [];
    $name = function (string $table, $id) use (&$seen) {
        $seen[$table] ??= [];
        $seen[$table][$id] ??= count($seen[$table]) + 1;

        return $table.$seen[$table][$id];
    };
    // Name the rows in the order the document lists them, before following references to them.
    foreach ($document['assets'] ?? [] as $m) {
        $name('m', $m['id']);
    }
    foreach ($document['items'] ?? [] as $i) {
        $name('i', $i['id']);
    }
    foreach ($document['characters'] ?? [] as $c) {
        $name('c', $c['id']);
    }
    foreach ($document['scenes'] as $s) {
        $name('s', $s['id']);
    }
    foreach ($document['scenes'] as $s) {
        foreach (['start_events', 'end_events', 'hotspots', 'indirect_events'] as $list) {
            foreach ($s[$list] ?? [] as $e) {
                $name('e', $e['id']);
                foreach ($e['actions'] ?? [] as $a) {
                    $name('a', $a['id']);
                }
            }
        }
    }
    $walk = function ($value, ?string $own = null) use (&$walk, $tables, $name) {
        if (is_string($value)) {
            // Media placed in text, such as an infobox's pictures.
            return preg_replace_callback('/\{\{media:(\d+)\}\}/', fn ($m) => '{{media:'.$name('m', (int) $m[1]).'}}', $value);
        }
        if (! is_array($value)) {
            return $value;
        }
        $out = [];
        foreach ($value as $key => $inner) {
            if (in_array($key, ['scenario_id', 'code', 'shortname', 'user_id', 'filepath', 'url', 'jump_targets'], true) && ! is_array($inner) || $key === 'jump_targets') {
                continue;
            }
            if ($key === 'id' && is_int($inner)) {
                $out[$key] = $own ? $name($own, $inner) : '#';
            } elseif (is_string($key) && isset($tables[$key]) && is_int($inner)) {
                $out[$key] = $name($tables[$key], $inner);
            } else {
                $child = match (true) {
                    $key === 'assets' => 'm', $key === 'items' && isset($value['scenes']) => 'i', $key === 'characters' && isset($value['scenes']) => 'c', $key === 'scenes' => 's',
                    in_array($key, ['start_events', 'end_events', 'hotspots', 'indirect_events'], true) => 'e', $key === 'actions' => 'a',
                    is_int($key) => $own, default => null,
                };
                $out[$key] = $walk($inner, $child);
            }
        }

        return $out;
    };

    return $walk($document);
}

$dir = sys_get_temp_dir().'/qbl-porting-'.bin2hex(random_bytes(4));
mkdir($dir);
$pdo = new PDO('sqlite::memory:');
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$store = new ScenarioStore($pdo, "$dir/media", '/media');
$pdo->exec("INSERT INTO users (id, name, role) VALUES (1, 'Ms Tan', 'teacher'), (2, 'Mr Ito', 'teacher')");
$teacher = ['id' => 1, 'name' => 'Ms Tan', 'role' => 'teacher'];
$other = ['id' => 2, 'name' => 'Mr Ito', 'role' => 'teacher'];

// ---- the decompiler is the compiler backwards
$shipped = ScenarioArchive::SHIPPED.'/starship-explorer.zip';
$demo = ScenarioArchive::read($shipped, fn (array $rows, callable $fileFor, array $document) => $document);
$again = json_decode(json_encode(ScenarioCompiler::compile(ScenarioDecompiler::rows($demo))), true);
$expected = $demo;
unset($expected['avatar_media_ids'], $expected['avatar_portraits']);
foreach ($expected as $key => $value) {
    if (($again[$key] ?? null) !== $value) {
        fwrite(STDERR, "differs at $key\n");
        foreach (is_array($value) ? $value : [] as $k => $v) {
            if (($again[$key][$k] ?? null) !== $v) {
                fwrite(STDERR, "  $key.$k: ".substr(json_encode($again[$key][$k] ?? null), 0, 400)."\n  expected: ".substr(json_encode($v), 0, 400)."\n");
                break;
            }
        }
    }
}
same($again, $expected, 'the demo, turned into rows and compiled again, is the same document (avatars apart: those are the platform\'s)');
try {
    ScenarioDecompiler::rows(['title' => 'Nothing']);
    check(false, 'a document without scenes is refused');
} catch (StoreError $e) {
    same($e->status, 422, 'a document without scenes is refused');
}
$bare = ScenarioDecompiler::rows(['title' => 'Bare', 'scenes' => [['shortname' => 'one', 'hotspots' => [['position_x' => 5, 'position_y' => 5, 'radius' => 50, 'actions' => [['type' => 'Text Overlay', 'text' => 'Hi']]]]]]]);
same([count($bare['scenes']), $bare['events'][0]['kind'], $bare['actions'][0]['type'], $bare['actions'][0]['params'], $bare['scenario']['start_scene_id'] === $bare['scenes'][0]['id']], [1, 'hotspot', 'text_overlay', ['text' => 'Hi'], true], 'a hand-written document without ids becomes rows with ids of their own');

// ---- importing rows gives everything a new id and follows every reference
(new ScenarioArchive($store))->seed($shipped);
$store->publish(1);
$copyId = $store->importRows($store->bundle(1), 1, ['title' => 'Second ship']);
$original = json_decode(json_encode($store->compile(1)), true);
$copy = json_decode(json_encode($store->compile($copyId)), true);
unset($original['avatar_media_ids'], $original['avatar_portraits']);
same([$copy['title'], $copy['id'] !== 1, preg_match('/^[a-z]{16}$/', $copy['code']), $copy['code'] !== $original['code']], ['Second ship', true, 1, true], 'the copy is a new scenario with a code of its own');
$copy['title'] = $original['title'];
same(shape($copy), shape($original), 'the copy is the same mission: every scene, event, action, condition, label and reference, under new ids');
foreach (['assets', 'scenes', 'items', 'characters'] as $list) {
    same(array_values(array_intersect(array_column($copy[$list], 'id'), array_column($original[$list], 'id'))), [], "and shares no $list row with the original");
}
$bundle = $store->bundle($copyId);
same([$bundle['scenario']['user_id'], $bundle['scenario']['published_at'], count($bundle['shop_items'])], [1, null, count($store->bundle(1)['shop_items'])], 'it belongs to whoever made it, is a draft, and has the mission\'s own shop items');
$store->deleteScenario($copyId);
$ownMedia = array_column($copy['assets'], 'id');
$placed = [];
array_walk_recursive($copy['scenes'], function ($v) use (&$placed) {
    if (is_string($v) && preg_match_all('/\{\{media:(\d+)\}\}/', $v, $m)) {
        array_push($placed, ...array_map('intval', $m[1]));
    }
});
same([$placed !== [], array_values(array_diff($placed, $ownMedia))], [true, []], 'pictures placed in an infobox\'s text are the copy\'s own media');
same(count($store->bundle(1)['scenes']), 13, 'deleting the copy leaves the original whole');

// ---- starting a new scenario from the starship hub
$hub = $store->createScenario(['title' => 'Volcano Week', 'template' => 'starship'], 1);
$doc = json_decode(json_encode($store->compile((int) $hub['id'])), true);
same([$doc['title'], count($doc['scenes']), array_column($doc['characters'], 'name')], ['Volcano Week', 8, ['Captain Vega', 'Chief Engineer Okoro', 'Botanist Lin', 'Quartermaster Pax']], 'a scenario started from the hub has the ship\'s eight rooms and its crew');
$sceneOf = array_column($doc['scenes'], null, 'shortname');
same($doc['start_scene_id'], $sceneOf['control-room']['id'], 'it starts in the control room');
same(array_column($doc['global_variables'], 'variable_name'), ['learned_dance'], 'none of the demo mission\'s variables came along');
$all = json_encode($doc);
same([str_contains($all, 'quest_started'), str_contains($all, 'Wilting'), isset($doc['objectives']), isset($doc['shop_items'])], [false, false, false, false], 'nor its quest, objectives or shop items');
$deck = $sceneOf['observation-deck'];
$mediaUrl = array_column($doc['assets'], 'url', 'id');
same([$mediaUrl[$deck['background_media'][1]['media_id']], $deck['background_media'][1]['scroll_speed_x'] > 0], ['/scenario-assets/hub/planet-pass.png', true], 'a planet drifts past the observation deck');
$blink = array_values(array_filter($sceneOf['engine-room']['start_events'], fn ($e) => ($e['shortname'] ?? '') === 'blinking-light'))[0];
same([array_column($blink['actions'], 'type'), $mediaUrl[$blink['actions'][0]['media_id']]], [['image_fixed', 'wait', 'repeat'], '/scenario-assets/hub/warning-light.png'], 'a light blinks in the engine room');
$okoro = $sceneOf['engine-room']['characters'][0];
$said = array_values(array_filter($sceneOf['engine-room']['indirect_events'], fn ($e) => $e['id'] === $okoro['event_id']))[0];
same([$said['actions'][0]['type'], $said['actions'][0]['character_id'] === $okoro['character_id']], ['dialogue', true], 'clicking a crew member runs their own event, and they are the one who speaks');
$jumps = [];
foreach ($doc['scenes'] as $s) {
    foreach ($s['hotspots'] as $e) {
        foreach ($e['actions'] as $a) {
            if ($a['type'] === 'jump') {
                $jumps[] = $a['scene_id'];
            }
        }
    }
}
same(array_diff($jumps, array_column($doc['scenes'], 'id')), [], 'every door leads to a room of this scenario, not of the demo');
foreach ($doc['assets'] as $m) {
    $file = str_starts_with($m['url'], '/scenario-assets/') ? substr($m['url'], strlen('/scenario-assets/')) : 'starship/'.$m['url'];
    if (! is_file(__DIR__.'/../../../scenarios/assets/'.$file)) {
        check(false, "the hub's media file {$m['url']} exists");
    }
}
$second = $store->createScenario(['title' => 'Ocean Week', 'template' => 'starship'], 2);
same(shape(json_decode(json_encode($store->compile((int) $second['id'])), true) + [])['scenes'], shape($doc)['scenes'], 'a second scenario gets the same ship, separately');
$store->updateRow((int) $second['id'], 'scenes', array_column($store->bundle((int) $second['id'])['scenes'], 'id')[0], ['subtitle' => 'Changed here only']);
same(in_array('Changed here only', array_column($store->bundle((int) $hub['id'])['scenes'], 'subtitle'), true), false, 'changing one copy of the ship does not change another');
try {
    $store->createScenario(['title' => 'X', 'template' => 'submarine'], 1);
    check(false, 'an unknown template is refused');
} catch (StoreError $e) {
    same($e->status, 422, 'an unknown template is refused');
}
same(count($store->bundle((int) $store->createScenario(['title' => 'Plain'], 1)['id'])['scenes']), 1, 'without a template a new scenario still starts with one empty scene');

// ---- uploads travel with a duplicate
$png = "$dir/pic.png";
$image = imagecreatetruecolor(40, 30);
imagepng($image, $png);
$mine = (int) $store->createScenario(['title' => 'Pond'], 1)['id'];
$scene = $store->bundle($mine)['scenes'][0];
$media = $store->addMediaFile($mine, $png, 'pond.png');
$store->updateRow($mine, 'scenes', $scene['id'], ['background_media' => [['media_id' => $media['id']]]]);
$event = $store->createRow($mine, 'events', ['scene_id' => $scene['id'], 'kind' => 'hotspot', 'shortname' => 'frog', 'position_x' => 10, 'position_y' => 10]);
$show = $store->createRow($mine, 'actions', ['event_id' => $event['id'], 'type' => 'image_fixed', 'media_id' => $media['id'], 'params' => ['position_x' => 1, 'position_y' => 2]]);
$store->createRow($mine, 'actions', ['event_id' => $event['id'], 'type' => 'translate', 'params' => ['target_id' => $show['id'], 'position_x' => 9]]);
$store->createRow($mine, 'shop_items', ['name' => 'Retired badge', 'kind' => 'ability', 'active' => false]);

$api = new EditorApi($store);
[$status, $body] = $api->handle('POST', "scenarios/$mine/duplicate", [], $teacher);
$dupe = (int) $body['scenario']['id'];
$b = $store->bundle($dupe);
same([$status, $b['scenario']['title'], $b['scenario']['user_id']], [201, 'Copy of Pond', 1], 'POST duplicate makes "Copy of ..." for the caller');
$copied = $b['media'][0];
same([$copied['filepath'] !== $media['filepath'], str_starts_with($copied['filepath'], "$dupe/"), is_file("$dir/media/{$copied['filepath']}"), $copied['width']], [true, true, true, 40], 'the uploaded picture was copied into the duplicate\'s own folder');
same([$b['scenes'][0]['background_media'][0]['media_id'], $b['actions'][0]['media_id'], $b['actions'][1]['params']['target_id']], [$copied['id'], $copied['id'], $b['actions'][0]['id']], 'and the scene, the action and the action that moves it all point at the copies');
same([count($b['shop_items']), $b['shop_items'][0]['active']], [1, false], 'a duplicate keeps even what is switched off');
$store->deleteScenario($dupe);
same([is_file("$dir/media/{$media['filepath']}"), is_dir("$dir/media/$dupe")], [true, false], 'deleting the duplicate removes its files and leaves the original\'s');

// ---- characters that walk around on their own, and walk actions, travel with a duplicate
$roam = (int) $store->createScenario(['title' => 'Roaming'], 1)['id'];
$roamMedia = $store->addMediaFile($roam, $png, 'guide.png');
$roamEvent = $store->createRow($roam, 'events', ['scene_id' => $store->bundle($roam)['scenes'][0]['id'], 'kind' => 'indirect']);
$lab = $store->createRow($roam, 'scenes', ['shortname' => 'lab']);
$guide = $store->createRow($roam, 'characters', ['name' => 'Guide', 'settings' => [
    'animations' => ['stand_right' => ['media_id' => $roamMedia['id']]],
    'roams' => 'yes please', 'walk_speed' => -3,
    'routine' => ['loop' => false, 'steps' => [
        ['type' => 'walk', 'to' => 'scene', 'scene_id' => $lab['id']],
        ['type' => 'dialogue', 'text' => 'Hello', 'narration_media_id' => $roamMedia['id']],
        ['type' => 'jump', 'scene_id' => $lab['id']],
        'junk',
    ]],
]]);
same([$guide['settings']['routine']['steps'][0]['type'], count($guide['settings']['routine']['steps']), $guide['settings']['routine']['loop'], isset($guide['settings']['roams']), isset($guide['settings']['walk_speed'])], ['walk', 2, false, false, false], 'a routine keeps its steps of the kinds it can have; roams is a yes or nothing; a speed is a positive number');
$walk = $store->createRow($roam, 'actions', ['event_id' => $roamEvent['id'], 'type' => 'walk', 'params' => ['character_id' => $guide['id'], 'to' => 'scene', 'scene_id' => $lab['id']]]);
same($walk['type'], 'walk', 'a walk action can be added');
[$status, $body] = $api->handle('POST', "scenarios/$roam/duplicate", [], $teacher);
$b = $store->bundle((int) $body['scenario']['id']);
$labCopy = array_values(array_filter($b['scenes'], fn ($sc) => $sc['shortname'] === 'lab'))[0];
$guideCopy = $b['characters'][0];
$walkCopy = array_values(array_filter($b['actions'], fn ($a) => $a['type'] === 'walk'))[0];
$steps = $guideCopy['settings']['routine']['steps'];
same(
    [$steps[0]['scene_id'], $steps[1]['narration_media_id'], $walkCopy['params']['scene_id'], $walkCopy['params']['character_id']],
    [$labCopy['id'], $b['media'][0]['id'], $labCopy['id'], $guideCopy['id']],
    'the routine\'s scene and recording, and the walk action\'s scene and character, point at the copies'
);
$store->deleteScenario((int) $body['scenario']['id']);
if (class_exists(ZipArchive::class)) {
    [, $out] = $api->handle('GET', "scenarios/$roam/export", [], $teacher);
    [$status, $in] = $api->handle('POST', 'scenarios/import', [], $teacher, ['file' => ['tmp_name' => $out['download']['path'], 'name' => 'roaming.zip']]);
    $back = $store->bundle((int) $in['scenario']['id']);
    $labBack = array_values(array_filter($back['scenes'], fn ($sc) => $sc['shortname'] === 'lab'))[0];
    same([$status, $back['characters'][0]['settings']['routine']['steps'][0]['scene_id'], $back['characters'][0]['settings']['routine']['loop']], [201, $labBack['id'], false], 'and a ZIP export brings the routine back in, pointing at the imported scene');
    $store->deleteScenario((int) $in['scenario']['id']);
}
// ---- a conversation keeps its lines, and the ids in them point at the copies
$talk = $store->createRow($roam, 'actions', ['event_id' => $roamEvent['id'], 'type' => 'conversation', 'params' => ['style' => 'portrait', 'start' => 'l1', 'lines' => [
    ['id' => 'l1', 'speaker' => 'character', 'character_id' => $guide['id'], 'text' => 'Shall we go to the lab?', 'narration_media_id' => $roamMedia['id'], 'choices' => [
        ['text' => 'Yes', 'correct' => true, 'next' => 'l2', 'actions' => [['type' => 'jump', 'scene_id' => $lab['id']]]],
        ['text' => 'No'],
    ]],
    ['id' => 'l2', 'text' => 'Off we go.'],
]]]);
same([$talk['type'], count($talk['params']['lines'])], ['conversation', 2], 'a conversation action can be added, with its lines');
$compiled = ScenarioCompiler::compile($store->bundle($roam));
$firstScene = (string) $store->bundle($roam)['scenes'][0]['id'];
check(in_array($lab['id'], $compiled['jump_targets']->{$firstScene} ?? [], true), 'a jump in a conversation\'s choice is one of the scene\'s jump targets');
[$status, $body] = $api->handle('POST', "scenarios/$roam/duplicate", [], $teacher);
$b = $store->bundle((int) $body['scenario']['id']);
$labCopy = array_values(array_filter($b['scenes'], fn ($sc) => $sc['shortname'] === 'lab'))[0];
$talkCopy = array_values(array_filter($b['actions'], fn ($a) => $a['type'] === 'conversation'))[0]['params'];
$line = $talkCopy['lines'][0];
same(
    [$line['character_id'], $line['narration_media_id'], $line['choices'][0]['actions'][0]['scene_id'], $line['choices'][0]['next'], $talkCopy['start']],
    [$b['characters'][0]['id'], $b['media'][0]['id'], $labCopy['id'], 'l2', 'l1'],
    'in the copy, the speaker, the recording and the choice\'s jump point at the copies; line ids stay as they were'
);
$store->deleteScenario((int) $body['scenario']['id']);
$questions = (new ReflectionMethod(\App\Qbl\Api\Reports::class, 'questions'))->invoke(null, ScenarioCompiler::compile($store->bundle($roam)));
same($questions[$talk['id'].':l1'] ?? null, ['prompt' => 'Shall we go to the lab?', 'correct' => ['Yes' => true]], 'a conversation line with choices is a question in the reports, logged as action:line');
check(! isset($questions[$talk['id'].':l2']), 'a line with nothing to choose is not');
$store->deleteScenario($roam);

// Someone else's scenario: only once published and public, and then as it was published.
same($api->handle('POST', "scenarios/$mine/duplicate", [], $other)[0], 404, 'another teacher cannot copy a draft');
$store->publish($mine);
$store->updateRow($mine, 'scenes', $scene['id'], ['subtitle' => 'Edited after publishing']);
[$status, $body] = $api->handle('POST', "scenarios/$mine/duplicate", ['title' => 'My pond'], $other);
$theirs = $store->bundle((int) $body['scenario']['id']);
same([$status, $theirs['scenario']['title'], $theirs['scenario']['user_id'], $theirs['scenes'][0]['subtitle'] === 'Edited after publishing', is_file("$dir/media/{$theirs['media'][0]['filepath']}")], [201, 'My pond', 2, false, true], 'another teacher can copy a published public mission, as published, files and all');
$store->updateScenario($mine, ['settings' => ['visibility' => 'private'] + $store->bundle($mine)['scenario']['settings']]);
same($api->handle('POST', "scenarios/$mine/duplicate", [], $other)[0], 404, 'but not a private one');

// ---- ZIP out and in again
if (class_exists(ZipArchive::class)) {
    [$status, $body] = $api->handle('GET', "scenarios/$mine/export", [], $teacher);
    $zipPath = $body['download']['path'];
    $zip = new ZipArchive;
    $zip->open($zipPath);
    $names = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $names[] = $zip->getNameIndex($i);
    }
    sort($names);
    same([$status, $names, $body['download']['name']], [200, ['README.txt', 'assets/'.basename($media['filepath']), 'scenario.json'], 'Pond-'.gmdate('Ymd').'.zip'], 'GET export gives a ZIP with scenario.json, the uploaded files and a README');
    $inside = json_decode($zip->getFromName('scenario.json'), true);
    same([$inside['title'], count($inside['scenes'])], ['Pond', 1], 'scenario.json is the scenario document');
    $zip->close();
    same($api->handle('GET', "scenarios/$mine/export", [], $other)[0], 404, 'only someone who can edit a scenario can export it');

    [$status, $body] = $api->handle('POST', 'scenarios/import', [], $other, ['file' => ['tmp_name' => $zipPath, 'name' => 'pond.zip']]);
    $in = $store->bundle((int) $body['scenario']['id']);
    same([$status, $in['scenario']['title'], $in['scenario']['user_id'], $in['scenario']['published_at'], $in['scenario']['code'] !== $store->bundle($mine)['scenario']['code']], [201, 'Pond', 2, null, true], 'POST import creates a new draft scenario for whoever imported it');
    $a = shape(json_decode(json_encode($store->compile($mine)), true));
    $z = shape(json_decode(json_encode($store->compile((int) $in['scenario']['id'])), true));
    unset($a['shop_items'], $z['shop_items'], $a['visibility'], $z['visibility']);
    same($z, $a + [], 'the imported scenario is the exported one');
    same([is_file("$dir/media/{$in['media'][0]['filepath']}"), $in['media'][0]['url'] === "/media/{$in['media'][0]['filepath']}", filesize("$dir/media/{$in['media'][0]['filepath']}") === filesize($png)], [true, true, true], 'with its picture stored again as the new scenario\'s own file');
    unlink($zipPath);

    // A ZIP made by hand: the scenario in a folder, a picture named by its address, and things that should not get through.
    $hand = "$dir/hand.zip";
    $zip = new ZipArchive;
    $zip->open($hand, ZipArchive::CREATE);
    $zip->addFromString('my-mission/scenario.json', json_encode(['title' => 'By hand', 'assets' => [
        ['id' => 1, 'type' => 'image', 'url' => 'art/sky.png'], ['id' => 2, 'type' => 'image', 'url' => 'https://example.org/far.png'], ['id' => 3, 'type' => 'image', 'url' => '../../etc/passwd'],
    ], 'scenes' => [['id' => 1, 'shortname' => 'sky', 'background_media' => [['media_id' => 1]]]]]));
    $zip->addFile($png, 'my-mission/assets/art/sky.png');
    $zip->addFromString('my-mission/.DS_Store', 'x');
    $zip->close();
    [$status, $body] = $api->handle('POST', 'scenarios/import', ['title' => 'Renamed'], $teacher, ['file' => ['tmp_name' => $hand, 'name' => 'hand.zip']]);
    $in = $store->bundle((int) $body['scenario']['id']);
    $byName = array_column($in['media'], null, 'url');
    same([$status, $in['scenario']['title'], count($in['media']), isset($byName['https://example.org/far.png']), isset($byName['../../etc/passwd']) && $byName['../../etc/passwd']['filepath'] === null], [201, 'Renamed', 3, true, true], 'a hand-made ZIP is imported: a title can be given, addresses elsewhere are kept as addresses');
    $sky = array_values(array_filter($in['media'], fn ($m) => $m['filepath'] !== null));
    same([count($sky), $in['scenes'][0]['background_media'][0]['media_id'] === $sky[0]['id']], [1, true], 'and the picture found in the ZIP became an uploaded file the scene uses');

    $bad = "$dir/bad.zip";
    $zip = new ZipArchive;
    $zip->open($bad, ZipArchive::CREATE);
    $zip->addFromString('scenario.json', json_encode(['title' => 'Bad', 'assets' => [['id' => 1, 'type' => 'image', 'filepath' => '1/script.php']], 'scenes' => [['id' => 1]]]));
    $zip->addFromString('assets/script.php', '<?php echo 1;');
    $zip->close();
    $before = count($store->listFor(['id' => 1, 'role' => 'admin']));
    [$status, $body] = $api->handle('POST', 'scenarios/import', [], $teacher, ['file' => ['tmp_name' => $bad, 'name' => 'bad.zip']]);
    same([$status, count($store->listFor(['id' => 1, 'role' => 'admin'])), count(glob("$dir/media/*/*.php"))], [422, $before, 0], 'a ZIP carrying a file that is not a picture, sound or video is refused whole, and nothing of it is kept');
    file_put_contents("$dir/not.zip", 'hello');
    same($api->handle('POST', 'scenarios/import', [], $teacher, ['file' => ['tmp_name' => "$dir/not.zip", 'name' => 'not.zip']])[0], 422, 'a file that is not a ZIP is refused');
    $zip = new ZipArchive;
    $zip->open("$dir/empty.zip", ZipArchive::CREATE);
    $zip->addFromString('notes.txt', 'nothing here');
    $zip->close();
    same($api->handle('POST', 'scenarios/import', [], $teacher, ['file' => ['tmp_name' => "$dir/empty.zip", 'name' => 'empty.zip']])[0], 422, 'so is a ZIP with no scenario.json');
} else {
    fwrite(STDERR, "SKIPPED: the ZIP checks need PHP's zip extension.\n");
}

// tidy up
exec('rm -rf '.escapeshellarg($dir));
echo $failures ? "$failures of $checks checks FAILED\n" : "porting: all $checks checks passed\n";
exit($failures ? 1 : 0);
