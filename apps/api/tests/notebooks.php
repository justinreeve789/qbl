<?php

/**
 * Tests for players' notebooks (App\Qbl\Notebooks): cleaning (against the shared package's
 * fixtures, so the server and the game agree), keeping and reading a notebook, who may, and what
 * resetting, deleting and exporting a student do with it. Over SQLite.
 *
 *   php apps/api/tests/notebooks.php
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ActivityStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'PngToWebp', 'Avatars', 'ClassApi', 'ScenarioStore', 'Notebooks/NotebookStore', 'Notebooks/NotebookApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\ClassStore;
use App\Qbl\Notebooks\NotebookApi;
use App\Qbl\Notebooks\NotebookStore;
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
    check($actual === $expected, $what.' (got '.json_encode($actual, JSON_UNESCAPED_UNICODE).', expected '.json_encode($expected, JSON_UNESCAPED_UNICODE).')');
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

// ------------------------------------------------------------------ cleaning, as the game does

$fixtures = __DIR__.'/../../../packages/shared/test/fixtures';
$input = json_decode(file_get_contents("$fixtures/notebook-input.json"), true);
$expected = json_decode(file_get_contents("$fixtures/notebook-clean.json"), true);
same(NotebookStore::clean($input['notebook'], strtotime($input['now'])), $expected, 'a notebook is cleaned as cleanNotebook in notebook.ts cleans it');
same(NotebookStore::clean($expected, strtotime($input['now'])), $expected, 'a clean notebook is kept as it is');
foreach ([null, 'pages', 5, [], ['pages' => 'no']] as $raw) {
    same(NotebookStore::clean($raw), ['pages' => []], 'anything that is not a notebook is an empty one: '.json_encode($raw));
}
$at = '2026-11-27T20:00:00Z';
$frogs = str_repeat('🐸', NotebookStore::CARD + 1);
$many = ['pages' => array_map(fn ($i) => ['id' => "p$i", 'parent' => null, 'title' => "Page $i", 'icon' => '⭐', 'color' => 'sun', 'text' => str_repeat('x', NotebookStore::TEXT + 10), 'created_at' => $at, 'updated_at' => $at,
    'cards' => array_map(fn ($j) => ['id' => "c$j", 'kind' => 'note', 'text' => $frogs, 'color' => 'sun', 'created_at' => $at, 'updated_at' => $at], range(0, NotebookStore::CARDS + 1))], range(0, NotebookStore::PAGES + 4))];
$clean = NotebookStore::clean($many);
same(count($clean['pages']), NotebookStore::PAGES, 'no more pages than the limit');
same(mb_strlen($clean['pages'][0]['text']), NotebookStore::TEXT, 'nor more writing on a page');
same(count($clean['pages'][0]['cards']), NotebookStore::CARDS, 'nor more cards');
same(mb_strlen($clean['pages'][0]['cards'][0]['text']), NotebookStore::CARD, 'characters are counted, not bytes');

// ------------------------------------------------------------------ a mission and its players

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
foreach (array_merge(ScenarioStore::sqliteSchema(), App\Qbl\ActivityStore::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
$scenarios = new ScenarioStore($pdo);
$classes = new ClassStore($pdo);
$notebooks = new NotebookStore($pdo, $classes);
$api = new NotebookApi($notebooks);
$pdo->exec("INSERT INTO users (id, name, email, role) VALUES
    (1, 'Ms Tan', 'tan@school.test', 'teacher'), (11, 'Brave Otter', 'ann@school.test', 'student'), (12, 'Calm Heron', 'ben@school.test', 'student'), (20, 'Guest', NULL, 'guest')");
$pdo->exec('INSERT INTO teacher_student (teacher_id, student_id) VALUES (1, 11), (1, 12)');
$tan = ['id' => 1, 'name' => 'Ms Tan', 'role' => 'teacher'];
$ann = ['id' => 11, 'name' => 'Brave Otter', 'role' => 'student'];
$ben = ['id' => 12, 'name' => 'Calm Heron', 'role' => 'student'];
$guest = ['id' => 20, 'name' => 'Guest', 'role' => 'guest'];

$mission = $scenarios->createScenario(['title' => 'Pond Life'], 1);
$mid = (int) $mission['id'];
$scenarios->updateScenario($mid, ['settings' => ['visibility' => 'private'] + ($mission['settings'] ?? [])]);
$scenarios->publish($mid);
$code = $mission['code'];
$a = $classes->assign(1, $mid, [11, 12]);
$group = 'a'.$a['id'];

$open = $scenarios->createScenario(['title' => 'Open Day'], 1);
$scenarios->updateScenario((int) $open['id'], ['settings' => ['visibility' => 'public'] + ($open['settings'] ?? [])]);
$scenarios->publish((int) $open['id']);

// ------------------------------------------------------------------ keeping a notebook

same($notebooks->forPlayer($ann, $code, $group), ['notebook' => ['pages' => []], 'updated_at' => null], 'a player starts with an empty notebook');
$page = ['id' => 'p1', 'parent' => null, 'title' => 'Frogs', 'icon' => '🐸', 'color' => 'mint', 'text' => "Frogs lay eggs\nin water", 'created_at' => $at, 'updated_at' => $at,
    'cards' => [['id' => 'c1', 'kind' => 'flash', 'text' => 'Baby frog?', 'back' => 'Tadpole', 'color' => 'sun', 'created_at' => $at, 'updated_at' => $at]]];
$saved = $notebooks->save($ann, $code, $group, ['pages' => [$page]]);
same($saved['notebook']['pages'][0]['cards'][0]['back'], 'Tadpole', 'what is kept is sent back');
check(is_string($saved['updated_at']) && str_ends_with($saved['updated_at'], 'Z'), 'with when it was kept');
same($notebooks->forPlayer($ann, $code, $group)['notebook']['pages'][0]['text'], "Frogs lay eggs\nin water", 'the player reads it back');
same($notebooks->forPlayer($ben, $code, $group)['notebook'], ['pages' => []], 'a classmate does not see it: each has their own');
$page['title'] = 'Frogs and toads';
$notebooks->save($ann, $code, $group, ['pages' => [$page]]);
same((int) $pdo->query('SELECT COUNT(*) FROM notebooks')->fetchColumn(), 1, 'keeping it again replaces it');
same($notebooks->forPlayer($ann, $code, $group)['notebook']['pages'][0]['title'], 'Frogs and toads', 'with what is new');
refused(fn () => $notebooks->forPlayer($ann, $code, 'public'), 404, 'a private mission has no public game to keep notes in');
refused(fn () => $notebooks->forPlayer(['id' => 99, 'name' => 'X', 'role' => 'student'], $code, $group), 404, 'nor does anyone outside the class');
refused(fn () => $notebooks->save($ann, $code, $group, 'pages'), 422, 'a notebook must be sent');
refused(fn () => $notebooks->forPlayer($ann, 'nothere', $group), 404, 'a scenario that is not published has no notebooks');
$notebooks->save($guest, $open['code'], 'public', ['pages' => [$page]]);
same($notebooks->forPlayer($guest, $open['code'], 'public')['notebook']['pages'][0]['id'], 'p1', 'a guest keeps a notebook too');
same($notebooks->forPlayer($ann, $open['code'], 'public')['notebook'], ['pages' => []], 'notes belong to one scenario: another game starts empty');
$notebooks->save($ben, $code, $group, ['pages' => [$page]]);
same($notebooks->save($ben, $code, $group, ['pages' => []])['updated_at'], null, 'a notebook with no pages is deleted');
same((int) $pdo->query("SELECT COUNT(*) FROM notebooks WHERE user_id = 12")->fetchColumn(), 0, 'and is gone from the table');

// ------------------------------------------------------------------ over HTTP

same($api->handle('GET', $code, [], null, ['group' => $group])[0], 401, 'signed out: refused');
[$status, $body] = $api->handle('GET', $code, [], $ann, ['group' => $group]);
same([$status, $body['notebook']['pages'][0]['title'] ?? null], [200, 'Frogs and toads'], 'GET {scenario}?group= is the player\'s notebook');
[$status, $body] = $api->handle('PUT', $code, ['notebook' => ['pages' => [$page + ['icon' => '🦖']]]], $ann, ['group' => $group]);
same($status, 200, 'PUT {scenario}?group= keeps it');
same($api->handle('DELETE', $code, [], $ann, ['group' => $group])[0], 405, 'nothing else is offered');
same($api->handle('GET', "$code/pages", [], $ann, ['group' => $group])[0], 404, 'nor any other path');

// ------------------------------------------------------------------ starting again, deleting, exporting

$notebooks->save($ben, $code, $group, ['pages' => [$page]]);
$classes->resetProgress(1, (int) $a['id'], 11);
same($notebooks->forPlayer($ann, $code, $group)['notebook'], ['pages' => []], "starting a student's game again empties their notebook there");
same(count($notebooks->forPlayer($ben, $code, $group)['notebook']['pages']), 1, "and leaves classmates' notebooks alone");
same(count($notebooks->forPlayer($guest, $open['code'], 'public')['notebook']['pages']), 1, 'and notebooks in other games');

echo "$checks checks, $failures failures\n";
exit($failures ? 1 : 0);
