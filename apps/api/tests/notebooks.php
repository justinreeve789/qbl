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

// ------------------------------------------------------------------ teachers reading their students' notebooks

$pdo->exec("INSERT INTO users (id, name, email, role) VALUES (2, 'Mr Ode', 'ode@school.test', 'teacher'), (3, 'Head', 'head@school.test', 'admin'), (13, 'Quick Fox', 'cy@school.test', 'student')");
$pdo->exec('INSERT INTO teacher_student (teacher_id, student_id) VALUES (1, 13)');
$ode = ['id' => 2, 'name' => 'Mr Ode', 'role' => 'teacher'];
$head = ['id' => 3, 'name' => 'Head', 'role' => 'admin'];
$cy = ['id' => 13, 'name' => 'Quick Fox', 'role' => 'student'];
// A second assignment of the same mission, in teams: Quick Fox plays in team Otters' game.
$b = $classes->assign(1, $mid, [11, 13], null, null, [['name' => 'Otters', 'student_ids' => [13]]]);
$otters = 't'.$b['teams'][0]['id'];
$notebooks->save($cy, $code, $otters, ['pages' => [$page, ['id' => 'p2', 'parent' => 'p1', 'title' => 'Eggs', 'cards' => [['id' => 'c9', 'kind' => 'check', 'text' => 'Count them']]] + $page]]);
// Brave Otter wrote in the first assignment's game; in this one, nothing.
$list = $notebooks->forAssignment($tan, (int) $a['id']);
same($list['assignment'], ['id' => (int) $a['id'], 'title' => 'Pond Life'], 'the list names the assignment');
same(array_map(fn ($s) => [$s['name'], $s['pages'], $s['cards'], $s['updated_at'] !== null], $list['students']),
    [['Brave Otter', 1, 1, true], ['Calm Heron', 0, 0, false]], "a teacher sees how much each of the assignment's students wrote, and when");
$list = $notebooks->forAssignment($tan, (int) $b['id']);
same(array_map(fn ($s) => [$s['name'], $s['team'], $s['pages'], $s['cards']], $list['students']),
    [['Brave Otter', null, 0, 0], ['Quick Fox', 'Otters', 2, 2]], "in the game each plays in there: a team's for those in one; notes in the other assignment's game are not counted");
$read = $notebooks->studentNotebook($tan, (int) $b['id'], 13);
same([$read['student'], array_column($read['notebook']['pages'], 'title'), $read['notebook']['pages'][1]['parent']],
    [['id' => 13, 'name' => 'Quick Fox', 'team' => 'Otters'], ['Frogs and toads', 'Eggs'], 'p1'], "the teacher reads a student's whole notebook, its subpages too");
same($notebooks->studentNotebook($tan, (int) $b['id'], 11), ['student' => ['id' => 11, 'name' => 'Brave Otter', 'team' => null], 'notebook' => ['pages' => []], 'updated_at' => null], 'a student who wrote nothing there has an empty notebook');
same(count($notebooks->studentNotebook($head, (int) $b['id'], 13)['notebook']['pages']), 2, 'an admin may read it too');
refused(fn () => $notebooks->studentNotebook($tan, (int) $b['id'], 12), 404, 'not a student who is not in that assignment');
refused(fn () => $notebooks->forAssignment($ode, (int) $a['id']), 404, "another teacher cannot read this teacher's class");
refused(fn () => $notebooks->studentNotebook($ode, (int) $b['id'], 13), 404, 'nor one notebook in it');
refused(fn () => $notebooks->forAssignment($ann, (int) $a['id']), 403, "a student cannot read classmates' notebooks");
refused(fn () => $notebooks->forAssignment($tan, 999), 404, 'nor is there an assignment that does not exist');
$notebooks->save($cy, $open['code'], 'public', ['pages' => [$page]]);
same(array_column($notebooks->forAssignment($tan, (int) $b['id'])['students'], 'pages'), [0, 2], 'notes kept in a public game stay private');

[$status, $body] = $api->handle('GET', 'teach/'.$b['id'], [], $tan);
same([$status, count($body['students'] ?? [])], [200, 2], 'GET teach/{assignment} lists its students');
[$status, $body] = $api->handle('GET', 'teach/'.$b['id'].'/13', [], $tan);
same([$status, count($body['notebook']['pages'] ?? [])], [200, 2], 'GET teach/{assignment}/{student} is that notebook');
same($api->handle('PUT', 'teach/'.$b['id'].'/13', ['notebook' => ['pages' => []]], $tan)[0], 405, 'which a teacher cannot change');
same(count($notebooks->forPlayer($cy, $code, $otters)['notebook']['pages']), 2, 'and it is as the student left it');
same($api->handle('GET', 'teach', [], $tan)[0], 404, 'teach needs an assignment');
same($api->handle('GET', 'teach/x/13', [], $tan)[0], 404, 'given by its number');
same($api->handle('GET', 'teach/'.$b['id'], [], $cy)[0], 403, 'over HTTP students are refused');
same($api->handle('GET', 'teach/'.$b['id'], [], null)[0], 401, 'and so is anyone signed out');

// ------------------------------------------------------------------ starting again, deleting, exporting

$notebooks->save($ben, $code, $group, ['pages' => [$page]]);
$classes->resetProgress(1, (int) $a['id'], 11);
same($notebooks->forPlayer($ann, $code, $group)['notebook'], ['pages' => []], "starting a student's game again empties their notebook there");
same(count($notebooks->forPlayer($ben, $code, $group)['notebook']['pages']), 1, "and leaves classmates' notebooks alone");
same(count($notebooks->forPlayer($guest, $open['code'], 'public')['notebook']['pages']), 1, 'and notebooks in other games');

echo "$checks checks, $failures failures\n";
exit($failures ? 1 : 0);
