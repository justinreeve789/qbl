<?php

/**
 * Tests for stars, XP, ranks and the marketplace (App\Qbl\ProgressStore), over SQLite.
 *
 *   php apps/api/tests/progress.php
 */
foreach (['StoreError', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ClassApi', 'ScenarioStore'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\ProgressStore;
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
    check($actual === $expected, $what.' (got '.json_encode($actual).', expected '.json_encode($expected).')');
}
function refused(callable $work, int $status, string $what): void
{
    try {
        $work();
        check(false, $what);
    } catch (StoreError $e) {
        same($e->status, $status, $what);
    }
}

$pdo = new PDO('sqlite::memory:');
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$scenarios = new ScenarioStore($pdo);
$progress = new ProgressStore($pdo);
$pdo->exec("INSERT INTO users (id, name, role) VALUES (1, 'Ann', 'student'), (2, 'Ben', 'student'), (3, 'Guest', 'guest')");

// A scenario with three awards: once only, repeatable, and one that takes stars away.
$scenario = $scenarios->createScenario(['title' => 'Awards'], null);
$sid = (int) $scenario['id'];
$scene = $scenarios->bundle($sid)['scenes'][0];
$event = $scenarios->createRow($sid, 'events', ['scene_id' => $scene['id'], 'kind' => 'start']);
$once = $scenarios->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'award', 'params' => ['stars' => 5, 'xp' => 120, 'note' => 'Sample collected']]);
$again = $scenarios->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'award', 'params' => ['stars' => 2, 'repeatable' => true]]);
$fine = $scenarios->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'award', 'params' => ['stars' => -50, 'xp' => -10]]);
$wait = $scenarios->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'wait', 'params' => ['duration' => 1]]);
$document = $scenarios->publish($sid);

same($progress->progress(1), ['stars' => 0, 'xp' => 0, 'rank' => 'Cadet', 'next_rank_xp' => 100, 'owned' => [], 'equipped' => []], 'a new player has nothing and is a Cadet');

$r = $progress->award(1, $sid, $document, $once['id']);
same([$r['stars'], $r['xp'], $r['rank'], $r['next_rank_xp'], $r['delta_stars'], $r['delta_xp'], $r['note'], $r['rank_up']], [5, 120, 'Explorer', 300, 5, 120, 'Sample collected', true], 'an award gives stars and XP, and XP raises the rank');
$r = $progress->award(1, $sid, $document, $once['id']);
same([$r['stars'], $r['delta_stars'], $r['delta_xp'], $r['already'] ?? false], [5, 0, 0, true], 'the same award is granted once per player');
same($progress->award(2, $sid, $document, $once['id'])['stars'], 5, 'another player gets it too');

$progress->award(1, $sid, $document, $again['id']);
same($progress->award(1, $sid, $document, $again['id'])['stars'], 9, 'a repeatable award is granted every time');
$r = $progress->award(1, $sid, $document, $fine['id']);
same([$r['stars'], $r['xp'], $r['delta_stars'], $r['rank'], $r['rank_up']], [0, 110, -9, 'Explorer', false], 'an award can take stars and XP away, but not below zero');

refused(fn () => $progress->award(1, $sid, $document, $wait['id']), 404, 'an action that is not an award grants nothing');
refused(fn () => $progress->award(1, $sid, $document, 999999), 404, 'nor does an action that is not in the scenario');
refused(fn () => $progress->award(3, $sid, $document, $once['id']), 403, 'guests have no stars or XP');
same((int) $pdo->query('SELECT COUNT(*) FROM progress_ledger WHERE user_id = 1')->fetchColumn(), 4, 'every change is in the ledger');

// The marketplace: platform items are sold everywhere, a scenario's own only there.
$pdo->exec("INSERT INTO shop_items (id, scenario_id, name, kind, slot, price, image_url, settings, active, sequence) VALUES
    (1, NULL, 'Star cap', 'wearable', 'head', 4, '/shop/cap.png', '{\"offset_y\":-6}', 1, 1),
    (2, NULL, 'Top hat', 'wearable', 'head', 3, '/shop/hat.png', NULL, 1, 2),
    (3, NULL, 'Robot pet', 'pet', NULL, 100, '/shop/robot.png', NULL, 1, 3),
    (4, NULL, 'Retired cape', 'wearable', 'back', 1, NULL, NULL, 0, 4),
    (5, NULL, 'Translator', 'ability', NULL, 1, NULL, '{\"ability\":\"translator\"}', 1, 5)");
$other = (int) $scenarios->createScenario(['title' => 'Elsewhere'], null)['id'];
$badge = $scenarios->createRow($sid, 'shop_items', ['name' => 'Mission badge', 'kind' => 'wearable', 'slot' => 'body', 'price' => 2]);
same(array_column($progress->catalogue(), 'name'), ['Star cap', 'Top hat', 'Robot pet', 'Translator'], 'the platform catalogue lists active items');
same(array_column($progress->catalogue($sid), 'name'), ['Mission badge', 'Star cap', 'Top hat', 'Robot pet', 'Translator'], 'in a scenario, its own items come first');
same($progress->catalogue()[0], ['offset_y' => -6, 'id' => 1, 'name' => 'Star cap', 'kind' => 'wearable', 'slot' => 'head', 'price' => 4, 'image_url' => '/shop/cap.png'], 'an item carries its settings');
same($scenarios->compile($sid)['shop_items'][0]['name'], 'Mission badge', 'a scenario\'s items are part of its JSON');

$progress->award(1, $sid, $document, $again['id']);
foreach (range(1, 4) as $_) {
    $progress->award(1, $sid, $document, $again['id']);
}
same($progress->progress(1)['stars'], 10, 'Ann has ten stars to spend');
$r = $progress->buy(1, 1);
same([$r['stars'], $r['owned'], $r['equipped']], [6, [1], []], 'buying spends stars and adds the item, not yet worn');
refused(fn () => $progress->buy(1, 1), 409, 'an item cannot be bought twice');
refused(fn () => $progress->buy(1, 3), 422, 'nor without enough stars');
refused(fn () => $progress->buy(1, 4), 404, 'nor when it is no longer sold');
$pdo->exec("INSERT INTO shop_items (id, scenario_id, name, kind, price, active, sequence) VALUES (50, NULL, 'Free sticker', 'wearable', 0, 1, 50)");
refused(fn () => $progress->buy(3, 50), 403, 'a guest cannot take even a free item: owning things needs an account');
$pdo->exec('DELETE FROM shop_items WHERE id = 50');
refused(fn () => $progress->buy(1, $badge['id'], $other), 404, 'a scenario\'s item is not sold in another scenario');
same($progress->buy(1, $badge['id'], $sid)['stars'], 4, 'but it is in its own');
$progress->buy(1, 2);
$progress->buy(1, 5);
same($progress->progress(1)['stars'], 0, 'down to nothing');

same($progress->equip(1, 1, true)['equipped'], [1], 'an owned item can be put on');
same($progress->equip(1, 2, true)['equipped'], [2], 'another item for the same slot replaces it');
same($progress->equip(1, $badge['id'], true)['equipped'], [2, $badge['id']], 'a different slot is worn alongside');
same($progress->equip(1, 5, true)['equipped'], [2, 5, $badge['id']], 'abilities are added, not swapped');
same($progress->look(1), '2,5,'.$badge['id'], 'the look is what the game server shows other players');
same($progress->equip(1, 2, false)['equipped'], [5, $badge['id']], 'and things can be taken off');
refused(fn () => $progress->equip(2, 1, true), 404, 'nobody can wear what they do not own');
// Moves are buttons on the player's screen; like abilities, any number can be switched on at once.
$pdo->exec("INSERT INTO shop_items (id, scenario_id, name, kind, price, settings, active, sequence) VALUES (60, NULL, 'Spin', 'move', 0, '{\"move\":\"spin\"}', 1, 60), (61, NULL, 'Wave', 'move', 0, '{\"move\":\"wave\"}', 1, 61)");
$progress->buy(1, 60);
$progress->buy(1, 61);
$progress->equip(1, 60, true);
$worn = $progress->equip(1, 61, true)['equipped'];
check(in_array(60, $worn, true) && in_array(61, $worn, true), 'two moves are on at once');
same(array_values(array_filter($progress->catalogue(), fn ($i) => $i['id'] === 60))[0]['move'], 'spin', 'a move item names its animation');
$progress->equip(1, 60, false);
$progress->equip(1, 61, false);
$pdo->exec('DELETE FROM user_items WHERE shop_item_id IN (60, 61)');
$pdo->exec('DELETE FROM shop_items WHERE id IN (60, 61)');

// Withdrawing a scenario's item, and deleting the scenario.
$scenarios->deleteRow($sid, 'shop_items', $badge['id']);
same($progress->progress(1)['owned'], [1, 2, 5], 'deleting an item takes it from those who had it');
same($progress->progress(1)['stars'], 0, 'stars and XP are the account\'s: they are not tied to a scenario');

if ($failures) {
    fwrite(STDERR, "$failures of $checks checks failed\n");
    exit(1);
}
echo "ok: $checks checks passed (awards, ranks, ledger, marketplace, wardrobe)\n";
