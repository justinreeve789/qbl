<?php

/**
 * Tests for making walks from standing pictures (App\Qbl\Characters\WalkMaker, `php artisan
 * qbl:walk`): for the platform's avatars and for a scenario's characters, with Node drawing the
 * walk (packages/shared/bin/walk.ts). Against SQLite:
 *
 *   php apps/api/tests/walk.php
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Characters/WalkMaker', 'Apng', 'PngToWebp', 'Avatars', 'ScenarioStore'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\Avatars;
use App\Qbl\Characters\WalkMaker;
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

$root = realpath(__DIR__.'/../../..');
$mediaDir = sys_get_temp_dir().'/qbl-walk-test-'.bin2hex(random_bytes(4));
$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$store = new ScenarioStore($pdo, $mediaDir, '/media');
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$walks = new WalkMaker("$root/packages/shared/bin/walk.ts", getenv('QBL_NODE') ?: 'node', $mediaDir, '/media', "$root/scenarios/assets");
$avatarRow = function (string $name) use ($pdo) {
    $st = $pdo->prepare('SELECT * FROM avatars WHERE name = ?');
    $st->execute([$name]);

    return $st->fetch(PDO::FETCH_ASSOC);
};

// ------------------------------------------------------------------ avatars
Avatars::seed($pdo, require __DIR__.'/../database/seeders/data/avatars.php');
$asimov = $avatarRow('Asimov');

// A dry run draws it and says how it went, and saves nothing.
$dry = $walks->forAvatar($pdo, $asimov, ['dry' => true, 'preview' => "$mediaDir/preview"]);
same($dry['mode'], 'legs', 'Asimov has legs to walk with');
same($dry['feet']['ok'] ?? null, true, 'his feet pass the checks');
same($dry['feet']['together'], [3, 6], 'his feet come together at passing');
same($dry['arms'], 2, 'both his arms swing');
check(! isset($dry['saved']), 'a dry run saves nothing');
check(is_file("$mediaDir/preview/asimov-walk.png"), 'the preview sheet is written');
same(json_decode($avatarRow('Asimov')['settings'], true)['animations']['walk_right'] ?? null, null, 'and the avatar is unchanged');
$size = getimagesize("$mediaDir/preview/asimov-walk.png");
same([$size[0] % 6, $size[1]], [0, 511], 'six frames of the standing picture\'s height');

// Made: a platform picture of its own, served under /media/platform/, as the avatar's walk right.
$made = $walks->forAvatar($pdo, $asimov);
same($made['saved'] ?? null, true, 'Asimov\'s walk is saved');
check(str_starts_with($made['url'], '/media/platform/') && is_file($mediaDir.substr($made['url'], strlen('/media'))), 'its file is in the media folder');
$settings = json_decode($avatarRow('Asimov')['settings'], true);
same($settings['animations']['walk_right'], ['media_id' => $made['media_id'], 'duration' => 720], 'it is his walk right');
check(isset($settings['animations']['stand_left'], $settings['animations']['portrait']), 'his other animations are kept');
$document = Avatars::inject($pdo, ['assets' => []]);
$served = array_values(array_filter($document['avatars'], fn ($a) => $a['name'] === 'Asimov'))[0];
$walkId = $served['animations']['walk_right']['media_id'];
$asset = array_values(array_filter($document['assets'], fn ($m) => $m['id'] === $walkId))[0] ?? null;
same($asset['sheet'] ?? null, ['columns' => 6, 'rows' => 1], 'documents carry it as a 6 × 1 sheet');
same($walkId, Avatars::MEDIA_BASE + $made['media_id'], 'under a platform media id');

// Again: skipped without --force; with it, replaced, and the old picture removed.
$again = $walks->forAvatar($pdo, $avatarRow('Asimov'));
check(isset($again['skipped']), 'an avatar that walks is skipped');
$oldFile = $mediaDir.substr($made['url'], strlen('/media'));
$replaced = $walks->forAvatar($pdo, $avatarRow('Asimov'), ['force' => true, 'stride' => 0.6]);
same($replaced['saved'] ?? null, true, '--force makes it again');
check($replaced['media_id'] !== $made['media_id'], 'as a new picture (a different stride draws a different walk)');
same((int) $pdo->query("SELECT COUNT(*) FROM platform_media WHERE id = {$made['media_id']}")->fetchColumn(), 0, 'the walk it replaced is removed');
check(! is_file($oldFile), 'with its file');

// A picture facing right is not mirrored; all nine of the cast walk.
foreach (['Buck', 'Gil', 'Lucy', 'Mallory', 'Pinta', 'Riona', 'Sam', 'Val'] as $name) {
    $r = $walks->forAvatar($pdo, $avatarRow($name), ['dry' => true]);
    same([$r['mode'], $r['feet']['ok'] ?? null], ['legs', true], "$name walks");
}

// ---------------------------------------------------------------- characters
$scenario = $store->createScenario(['title' => 'Walkers'], null);
$sid = (int) $scenario['id'];
$tmp = tempnam(sys_get_temp_dir(), 'qbl-');
copy("$root/scenarios/assets/platform/avatars/val.png", $tmp);
$picture = $store->addMediaFile($sid, $tmp, 'val.png');
$store->updateRow($sid, 'media', $picture['id'], ['scale_x' => 0.5, 'scale_y' => 0.5]);
$val = $store->createRow($sid, 'characters', ['name' => 'Val', 'settings' => ['animations' => ['stand_right' => ['media_id' => $picture['id']]], 'scale' => 0.8]]);
$r = $walks->forCharacter($store, $sid, $val);
same([$r['mode'], $r['saved'] ?? null], ['legs', true], 'a character\'s walk is made');
$bundle = $store->bundle($sid);
$walkMedia = array_values(array_filter($bundle['media'], fn ($m) => $m['id'] === $r['media_id']))[0];
same([$walkMedia['scale_x'], $walkMedia['scale_y']], [0.5, 0.5], 'at the standing picture\'s size');
same($walkMedia['params']['sheet'], ['columns' => 6, 'rows' => 1], 'as a 6 × 1 sheet');
same($walkMedia['params']['made_from'], ['media_id' => $picture['id'], 'as' => 'walk'], 'saying what it was made from');
$c = array_values(array_filter($bundle['characters'], fn ($c) => $c['id'] === $val['id']))[0];
same($c['settings']['animations']['walk_right'], ['media_id' => $r['media_id'], 'duration' => 720], 'it is the character\'s walk right');
same($c['settings']['scale'], 0.8, 'its other settings are kept');
check($store->mediaFile($walkMedia) !== null, 'its file is the scenario\'s');

// Replacing it removes the walk made before.
$r2 = $walks->forCharacter($store, $sid, $c, ['force' => true]);
same(array_values(array_filter($store->bundle($sid)['media'], fn ($m) => $m['id'] === $r['media_id'])), [], 'the walk it replaced is removed');

// A character of the older shape (a picture, no animations) gets its animations written out.
$legacy = $store->createRow($sid, 'characters', ['name' => 'Old Val', 'media_id' => $picture['id']]);
$r3 = $walks->forCharacter($store, $sid, $legacy);
$old = array_values(array_filter($store->bundle($sid)['characters'], fn ($c) => $c['id'] === $legacy['id']))[0];
same(array_keys($old['settings']['animations']), ['stand_right', 'walk_right'], 'an older character gets animations');
same($old['media_id'], null, 'in place of its picture');

// Nothing to walk from: skipped.
$none = $store->createRow($sid, 'characters', ['name' => 'Nobody']);
same($walks->forCharacter($store, $sid, $none), ['name' => 'Nobody', 'skipped' => 'it has no standing picture to make a walk from'], 'a character with no standing picture is skipped');

// A relative address is the scenario's asset_base_url's.
$store->updateScenario($sid, ['settings' => ['asset_base_url' => '/scenario-assets/platform']]);
$shipped = $store->createRow($sid, 'media', ['type' => 'image', 'url' => 'avatars/gil.png']);
$gil = $store->createRow($sid, 'characters', ['name' => 'Gil', 'settings' => ['animations' => ['stand_right' => ['media_id' => $shipped['id']]]]]);
same($walks->forCharacter($store, $sid, $gil, ['dry' => true])['mode'] ?? null, 'legs', 'a shipped picture with a relative address is found');

exec('rm -rf '.escapeshellarg($mediaDir));
echo "walk: $checks checks, $failures failed\n";
exit($failures ? 1 : 0);
