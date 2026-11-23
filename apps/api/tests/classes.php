<?php

/**
 * Tests for classes, assignments, teams, missions and the platform avatars
 * (App\Qbl\ClassStore, ClassApi, Avatars), over SQLite.
 *
 *   php apps/api/tests/classes.php
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ClassApi', 'ScenarioStore'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\Avatars;
use App\Qbl\ClassApi;
use App\Qbl\ClassStore;
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
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
foreach (ScenarioStore::sqliteSchema() as $sql) {
    $pdo->exec($sql);
}
$scenarios = new ScenarioStore($pdo);
$classes = new ClassStore($pdo);
$pdo->exec("INSERT INTO users (id, name, email, role) VALUES
    (1, 'Ms Tan', 'tan@school.test', 'teacher'), (2, 'Mr Ito', 'ito@school.test', 'teacher'),
    (11, 'Ann', 'ann@school.test', 'student'), (12, 'Ben', 'Ben@School.test', 'student'), (13, 'Cy', 'cy@school.test', 'student'), (14, 'Dee', 'dee@school.test', 'student'),
    (20, 'Guest', NULL, 'guest'), (30, 'Root', 'root@school.test', 'admin')");

// Three scenarios: a public one, a private one of Ms Tan's, and a draft.
$open = $scenarios->createScenario(['title' => 'Open Day'], 2);
$scenarios->publish((int) $open['id']);
$own = $scenarios->createScenario(['title' => 'Tan Special'], 1);
$scenarios->updateScenario((int) $own['id'], ['settings' => ['visibility' => 'private'] + ($own['settings'] ?? [])]);
$scenarios->publish((int) $own['id']);
$draft = $scenarios->createScenario(['title' => 'Draft'], 1);
[$openId, $ownId, $draftId] = [(int) $open['id'], (int) $own['id'], (int) $draft['id']];

// ---- students
same($classes->students(1), [], 'a teacher starts with no students');
same($classes->addStudent(1, ' ANN@school.test ')['id'], 11, 'a student is added by the address they sign in with, however it is typed');
$classes->addStudent(1, 'ben@school.test');
$classes->addStudent(1, 'cy@school.test');
$classes->addStudent(1, 'ann@school.test');
same(array_column($classes->students(1), 'name'), ['Ann', 'Ben', 'Cy'], 'adding a student twice adds them once');
$classes->addStudent(2, 'ann@school.test');
same(array_column($classes->students(2), 'id'), [11], 'a student can have two teachers');
refused(fn () => $classes->addStudent(1, 'nobody@school.test'), 404, 'someone who has never signed in cannot be added');
refused(fn () => $classes->addStudent(1, 'tan@school.test'), 422, 'a teacher is not their own student');

// ---- what can be assigned
same(array_column($classes->assignable(1), 'title'), ['Open Day', 'Tan Special'], 'a teacher can assign public scenarios and their own private ones, but not drafts');
same(array_column($classes->assignable(2), 'title'), ['Open Day'], "another teacher's private scenario is not offered");
same(count($classes->assignable(30, true)), 2, 'an admin can assign any published scenario');

// ---- assignments
$a = $classes->assign(1, $ownId, [11, 12, 13], '2026-12-01 15:00', 'Read chapter 4 first');
same([$a['scenario']['title'], $a['due_at'], $a['note'], $a['group'], array_column($a['students'], 'id'), $a['teams']], ['Tan Special', '2026-12-01 15:00:00', 'Read chapter 4 first', 'a'.$a['id'], [11, 12, 13], []], 'an assignment has a scenario, students, a due date and a note');
refused(fn () => $classes->assign(1, $ownId, [14]), 422, "a mission can only go to the teacher's own students");
refused(fn () => $classes->assign(1, $draftId, [11]), 422, 'a draft cannot be assigned');
refused(fn () => $classes->assign(2, $ownId, [11]), 422, "nor can another teacher's private scenario");
refused(fn () => $classes->assign(1, $ownId, [11], 'next Blursday'), 422, 'a due date must be a date');
$b = $classes->assign(2, $openId, [11]);
same($b['due_at'], null, 'a due date is optional');

// ---- missions: public ones plus assigned ones
$m = $classes->missions(11);
same(array_map(fn ($x) => [$x['title'], $x['kind'], $x['group']], $m), [['Tan Special', 'assigned', 'a'.$a['id']], ['Open Day', 'assigned', 'a'.$b['id']], ['Open Day', 'public', 'public']], 'a student sees what was assigned (soonest due first), then the public missions');
same([$m[0]['teacher'], $m[0]['due_at'], $m[0]['note'], $m[0]['team'], $m[0]['started_at']], ['Ms Tan', '2026-12-01 15:00:00', 'Read chapter 4 first', null, null], 'an assigned mission says who gave it, when it is due, and that it has not been started');
same(array_map(fn ($x) => [$x['title'], $x['kind']], $classes->missions(14)), [['Open Day', 'public']], 'a student with no teacher sees the public missions only: private ones stay hidden');
same(array_column($classes->missions(20), 'kind'), ['public'], 'so does a guest');
$pdo->prepare("INSERT INTO scenario_sessions (scenario_id, user_id, group_key, data, updated_at) VALUES (?, 11, ?, '{}', '2026-11-17 09:00:00')")->execute([$ownId, 'a'.$a['id']]);
same($classes->missions(11)[0]['started_at'], '2026-11-17 09:00:00', 'a mission that has a save is marked as started');

// ---- teams: each is its own instance
$a = $classes->update(1, $a['id'], ['teams' => [['name' => 'Comets', 'student_ids' => [11, 12]], ['name' => 'Quasars', 'student_ids' => [13]]]]);
[$comets, $quasars] = $a['teams'];
same([$comets['name'], $comets['student_ids'], $comets['group'], $quasars['student_ids']], ['Comets', [11, 12], 't'.$comets['id'], [13]], 'students are put into teams');
$m = $classes->missions(11)[0];
same([$m['team'], $m['group'], $m['started_at']], ['Comets', 't'.$comets['id'], null], "a student in a team plays in the team's instance, which starts fresh");
$a = $classes->update(1, $a['id'], ['teams' => [['id' => $comets['id'], 'name' => 'Comets!', 'student_ids' => [11]], ['id' => $quasars['id'], 'name' => 'Quasars', 'student_ids' => [13]]]]);
same([$a['teams'][0]['id'], $a['teams'][0]['name'], $a['teams'][0]['student_ids']], [$comets['id'], 'Comets!', [11]], 'a team keeps its instance when it is renamed or its members change');
same($classes->missions(12)[0]['group'], 'a'.$a['id'], "a student in no team plays in the assignment's own instance");
$a = $classes->update(1, $a['id'], ['due_at' => null]);
same([$a['due_at'], $a['note'], count($a['teams'])], [null, 'Read chapter 4 first', 2], 'changing the due date leaves the rest alone');
$a = $classes->update(1, $a['id'], ['student_ids' => [11, 13]]);
same([array_column($a['students'], 'id'), $a['teams'][0]['student_ids']], [[11, 13], [11]], 'changing the students keeps the teams of those who stay');
refused(fn () => $classes->update(2, $a['id'], ['note' => 'mine now']), 404, "a teacher cannot change another teacher's assignment");

// ---- who may join which instance
$join = fn (int $user, string $role, int $scenario, string $group) => $classes->mayJoin($user, $role, $scenario, $group);
same($join(14, 'student', $openId, 'public'), true, 'anyone may play a public mission');
same($join(20, 'guest', $openId, 'lunch-club'), true, 'and an open group of one');
same($join(14, 'student', $ownId, 'public'), false, 'a private mission is not open to all');
same($join(11, 'student', $ownId, 't'.$comets['id']), true, 'a team member may join their team');
same($join(13, 'student', $ownId, 't'.$comets['id']), false, 'but not another team');
same($join(11, 'student', $ownId, 'a'.$a['id']), false, "nor the assignment's own instance, once in a team");
same($join(12, 'student', $ownId, 'a'.$a['id']), false, 'a student taken off the assignment may no longer join');
same($join(1, 'teacher', $ownId, 't'.$quasars['id']), true, 'the teacher may look in on any of their teams');
same($join(2, 'teacher', $ownId, 't'.$quasars['id']), false, 'another teacher may not');
same($join(30, 'admin', $ownId, 't'.$quasars['id']), true, 'an admin may');
same($join(11, 'student', $openId, 't'.$comets['id']), false, 'a team belongs to one scenario');
same($join(11, 'student', $openId, 'a'.$b['id']), true, "a student may join the other teacher's assignment");
same($join(11, 'student', 99999, 'public'), false, 'there is nothing to join in a scenario that does not exist');

// ---- leaving
$classes->removeStudent(1, 11);
same([array_column($classes->students(1), 'id'), array_column($classes->assignments(1)[0]['students'], 'id')], [[12, 13], [13]], "a removed student leaves the teacher's assignments too");
same(array_map(fn ($x) => $x['kind'], $classes->missions(11)), ['assigned', 'public'], "but keeps the other teacher's");
$classes->unassign(1, $a['id']);
same([$classes->assignments(1), $pdo->query('SELECT COUNT(*) FROM teams')->fetchColumn() == 0], [[], true], 'deleting an assignment removes its teams');

// ---- the platform's avatars
$document = ['assets' => [['id' => 5, 'type' => 'image', 'url' => 'bg.png'], ['id' => 6, 'type' => 'image', 'url' => 'old-avatar.png']], 'avatar_media_ids' => [6], 'avatar_portraits' => []];
same(Avatars::inject($pdo, $document), $document, 'with no platform avatars a scenario keeps its own');
$pdo->exec("INSERT INTO avatars (id, name, image_url, portrait_url, settings, active, sequence) VALUES
    (1, 'Nova', '/a/nova.png', '/p/nova.png', '{\"scale\":0.85}', 1, 2),
    (2, 'Sprocket', '/a/sprocket.png', NULL, '{\"scale\":1.35,\"sheet\":{\"columns\":6,\"rows\":3},\"animations\":[{\"name\":\"walk\",\"frames\":[6,7]}]}', 1, 1),
    (3, 'Retired', '/a/old.png', NULL, NULL, 0, 3)");
$out = Avatars::inject($pdo, $document);
same(array_column($out['avatars'], 'id'), [900002, 900001], 'the platform avatars replace the scenario\'s, in order, without retired ones');
same(isset($out['avatar_media_ids']) || isset($out['avatar_portraits']), false, 'the older lists go: avatars are characters now');
$byId = array_column($out['assets'], null, 'id');
same([$byId[900001]['url'], $byId[950001]['url'], $byId[900002]['sheet'], isset($byId[5])], ['/a/nova.png', '/p/nova.png', ['columns' => 6, 'rows' => 3], true], 'each picture arrives as an image, with the close-up; the scenario\'s own media stays');
$nova = $out['avatars'][1];
same([$nova['name'], $nova['scale'], $nova['platform'], $nova['animations']], ['Nova', 0.85, true, ['stand_right' => ['media_id' => 900001], 'portrait' => ['media_id' => 950001]]], 'an avatar of the older shape is one picture facing right, and its close-up');
same($out['avatars'][0]['animations'], ['stand_right' => ['media_id' => 900002, 'frames' => [0]], 'walk_right' => ['media_id' => 900002, 'frames' => [6, 7]]], "a sheet's own walk becomes the walking pose");
same(Avatars::inject($pdo, $out), $out, 'adding them twice changes nothing');

// ---- avatars drawn from the platform's own pictures, shared between avatars
$sheet = ['url' => '/a/crew.png', 'width' => 600, 'height' => 200, 'sheet' => ['columns' => 6, 'rows' => 2]];
same(Avatars::seed($pdo, [
    ['id' => 4, 'name' => 'Pilot', 'image_url' => '/a/crew.png', 'settings' => ['scale' => 1.1], 'animations' => [
        'stand_right' => $sheet + ['frames' => [0]], 'walk_right' => $sheet + ['frames' => [1, 2, 3], 'duration' => 450], 'stand_left' => $sheet + ['frames' => [0], 'flip' => true],
        'portrait' => ['url' => '/a/pilot-face.png'], 'salute' => $sheet + ['frames' => [4, 5], 'repeat' => false],
    ]],
    ['id' => 5, 'name' => 'Medic', 'image_url' => '/a/crew.png', 'animations' => ['stand_right' => $sheet + ['frames' => [6]], 'walk_right' => $sheet + ['frames' => [7, 8, 9]]]],
    ['id' => 1, 'name' => 'Nova again', 'image_url' => '/x.png'],
]), 2, 'seeding adds new avatars and leaves existing ones alone');
same((int) $pdo->query('SELECT COUNT(*) FROM platform_media')->fetchColumn(), 2, 'one platform picture per address, however many avatars use it');
$out = Avatars::inject($pdo, $document);
$pilot = array_values(array_filter($out['avatars'], fn ($a) => $a['name'] === 'Pilot'))[0];
$medic = array_values(array_filter($out['avatars'], fn ($a) => $a['name'] === 'Medic'))[0];
$crew = $pilot['animations']['stand_right']['media_id'];
same([$pilot['id'], $crew >= Avatars::MEDIA_BASE, $medic['animations']['walk_right']['media_id'] === $crew], [900004, true, true], 'both are cut from the same sheet, served in the platform range');
same([$pilot['animations']['walk_right'], $pilot['animations']['stand_left'], $pilot['animations']['salute']], [['media_id' => $crew, 'frames' => [1, 2, 3], 'duration' => 450], ['media_id' => $crew, 'frames' => [0], 'flip' => true], ['media_id' => $crew, 'frames' => [4, 5], 'repeat' => false]], 'animations keep their frames, timing, mirroring and looping');
$assets = array_column($out['assets'], null, 'id');
same([$assets[$crew]['sheet'], $assets[$crew]['width'], count(array_filter($out['assets'], fn ($m) => $m['id'] === $crew))], [['columns' => 6, 'rows' => 2], 600, 1], 'the shared sheet is in the document once, with its grid');
$listed = array_column(array_map(fn ($a) => Avatars::present($a), Avatars::all($pdo)), null, 'name');
same([$listed['Medic']['picture'], $listed['Pilot']['portrait']['url'], $listed['Nova']['picture']], [['url' => '/a/crew.png', 'sheet' => ['columns' => 6, 'rows' => 2], 'frame' => 6], '/a/pilot-face.png', ['url' => '/a/nova.png']], 'the chooser gets each avatar standing, one frame of a sheet, and its close-up');
same(Avatars::inject($pdo, $out), $out, 'and again, adding them twice changes nothing');
$pdo->exec('UPDATE avatars SET active = 0 WHERE id IN (4, 5)');

// ---- over HTTP
$api = new ClassApi($pdo);
$ann = ['id' => 11, 'name' => 'Ann', 'role' => 'student'];
$tan = ['id' => 1, 'name' => 'Ms Tan', 'role' => 'teacher'];
same($api->handle('GET', 'missions', [], null)[0], 401, 'missions need a sign-in');
same(array_column($api->handle('GET', 'missions', [], $ann)[1]['missions'], 'kind'), ['assigned', 'public'], 'GET missions lists them');
same($api->handle('GET', 'teach/students', [], $ann)[0], 403, 'students cannot use the teacher routes');
[$status, $body] = $api->handle('POST', 'teach/students', ['email' => 'dee@school.test'], $tan);
same([$status, $body['student']['name']], [201, 'Dee'], 'POST teach/students adds a student');
[$status, $body] = $api->handle('POST', 'teach/assignments', ['scenario_id' => $openId, 'student_ids' => [14, 13], 'due_at' => '2026-12-24', 'teams' => [['name' => 'A', 'student_ids' => [14]]]], $tan);
same([$status, $body['assignment']['due_at'], $body['assignment']['teams'][0]['student_ids']], [201, '2026-12-24 00:00:00', [14]], 'POST teach/assignments assigns, with teams');
$id = $body['assignment']['id'];
same($api->handle('PUT', "teach/assignments/$id", ['note' => 'Bring a pencil'], $tan)[1]['assignment']['note'], 'Bring a pencil', 'PUT changes it');
same($api->handle('PUT', "teach/assignments/$id", ['note' => 'x'], ['id' => 2, 'role' => 'teacher'])[0], 404, 'only for its own teacher');
same($api->handle('DELETE', "teach/assignments/$id", [], $tan)[0], 204, 'DELETE removes it');
same($api->handle('DELETE', 'teach/students/14', [], $tan)[0], 204, 'DELETE teach/students removes a student');
same($api->handle('GET', 'teach/nonsense', [], $tan)[0], 404, 'unknown routes are 404');
[$status, $body] = $api->handle('GET', 'avatars', [], $ann);
same([array_column($body['avatars'], 'name'), $body['avatar_media_id']], [['Sprocket', 'Nova'], null], 'GET avatars lists the set; nothing is chosen yet');
same($api->handle('PUT', 'me/avatar', ['avatar_media_id' => 6], $ann)[0], 422, "a scenario's own picture cannot be chosen as an avatar");
same($api->handle('PUT', 'me/avatar', ['avatar_media_id' => 900001], $ann)[1], ['avatar_media_id' => 900001], 'PUT me/avatar chooses one');
same($api->handle('GET', 'avatars', [], $ann)[1]['avatar_media_id'], 900001, 'and it is remembered');

// ---- missions that wait for their teacher to launch them (settings.wait_for_launch)
$portal = $scenarios->createScenario(['title' => 'Time Portal'], 1);
$scenarios->updateScenario((int) $portal['id'], ['settings' => ['wait_for_launch' => true] + ($portal['settings'] ?? [])]);
$scenarios->publish((int) $portal['id']);
$portalId = (int) $portal['id'];
$titles = fn (int $user) => array_column($classes->missions($user), 'title');
same(in_array('Time Portal', $titles(13), true), false, 'a public mission that waits for a teacher is not on a student’s page by itself');
same(in_array('Time Portal', $titles(1), true), true, 'but teachers see it, to try it and assign it');
same($classes->mayJoin(13, 'student', $portalId, 'public'), false, 'and students cannot join its public game');
same($classes->waitingForLaunch('student', $portalId, 'public'), true, 'which is put down to it waiting for a teacher');
same($classes->mayJoin(1, 'teacher', $portalId, 'public'), true, 'teachers can');
$trip = $classes->assign(1, $portalId, [12, 13], null, null, [['name' => 'Red', 'student_ids' => [13]]]);
[$tripId, $redGroup] = [$trip['id'], $trip['teams'][0]['group']];
same([$trip['waiting'], $trip['launched_at'], $trip['scenario']['waits_for_launch']], [true, null, true], 'assigned, it waits for its teacher to launch it');
same(in_array('Time Portal', $titles(12), true), false, 'its students do not see it yet');
same([$classes->mayJoin(12, 'student', $portalId, "a$tripId"), $classes->mayJoin(13, 'student', $portalId, $redGroup)], [false, false], 'nor can they join it');
same([$classes->waitingForLaunch('student', $portalId, "a$tripId"), $classes->waitingForLaunch('student', $portalId, $redGroup)], [true, true], 'because it has not been launched');
same($classes->mayJoin(1, 'teacher', $portalId, $redGroup), true, 'its teacher can go in first');
refused(fn () => $classes->launch(2, $tripId), 404, 'only its own teacher launches it');
$launch = $classes->launch(1, $tripId);
same([$launch['code'], $launch['title'], $launch['party'], $launch['students']], [$portal['code'], 'Time Portal', "a$tripId", [['id' => 12, 'group' => "a$tripId"], ['id' => 13, 'group' => $redGroup]]],
    'launching says where it is and which game each student plays in');
check($launch['launched_at'] !== null, 'and when it was launched');
same(in_array('Time Portal', $titles(12), true) && in_array('Time Portal', $titles(13), true), true, 'launched, it is on its students’ pages');
same([$classes->mayJoin(12, 'student', $portalId, "a$tripId"), $classes->mayJoin(13, 'student', $portalId, $redGroup)], [true, true], 'and they can join it');
same($classes->mayJoin(13, 'student', $portalId, "a$tripId"), false, 'in their own team’s game only, as before');
same($classes->waitingForLaunch('student', $portalId, $redGroup), false, 'nothing waits any more');
$pdo->exec("UPDATE assignments SET launched_at = '2026-01-01 00:00:00' WHERE id = $tripId");
same($classes->launch(1, $tripId)['launched_at'], '2026-01-01 00:00:00', 'launching again sends whoever is there, and keeps the first time');
same(in_array('Time Portal', $titles(14), true), false, 'students it was not assigned to still do not see it');
same([$classes->unlaunch(1, $tripId)['waiting'], in_array('Time Portal', $titles(12), true)], [true, false], 'hidden again, it waits once more');
same($classes->launch(30, $tripId, true)['assignment_id'], $tripId, 'an admin can launch any assignment');
$plain = $classes->assign(1, $openId, [12]);
same([$plain['waiting'], $classes->launch(1, $plain['id'])['code']], [false, $open['code']], 'a mission that does not wait is never waiting, and can still be launched (to send the students there)');
$scenarios->updateScenario($portalId, ['settings' => ['wait_for_launch' => false]]);
$classes->unlaunch(1, $tripId);
same(in_array('Time Portal', $titles(12), true), true, 'the setting applies at once: switched off, it shows without a launch');
$scenarios->updateScenario($portalId, ['settings' => ['wait_for_launch' => true]]);
// The same over HTTP.
same($api->handle('POST', "teach/assignments/$tripId/launch", [], $ann)[0], 403, 'students cannot launch');
[$status, $body] = $api->handle('POST', "teach/assignments/$tripId/launch", [], $tan);
same([$status, $body['launch']['assignment_id'], $body['assignment']['waiting']], [200, $tripId, false], 'POST teach/assignments/{id}/launch launches it');
[$status, $body] = $api->handle('DELETE', "teach/assignments/$tripId/launch", [], $tan);
same([$status, $body['assignment']['waiting']], [200, true], 'DELETE …/launch hides it again');
same($api->handle('POST', "teach/assignments/$tripId/launch", [], ['id' => 2, 'role' => 'teacher'])[0], 404, 'only for its own teacher');
$pdo->exec("UPDATE scenarios SET published_at = NULL WHERE id = $portalId");
refused(fn () => $classes->launch(1, $tripId), 422, 'an unpublished mission cannot be launched');

// ---- the picture on a mission's card: its start scene's main background layer
$card = new ReflectionMethod(ClassStore::class, 'card');
$cardDoc = fn (array $layers) => ['id' => 1, 'code' => 'x', 'title' => 'T', 'document' => [
    'start_scene_id' => 2, 'asset_base_url' => '/m',
    'assets' => [['id' => 7, 'type' => 'image', 'url' => 'sky.png'], ['id' => 8, 'type' => 'image', 'url' => 'deck.png'], ['id' => 9, 'type' => 'image', 'url' => 'other.png']],
    'scenes' => [['id' => 1, 'background_media' => [['media_id' => 9]]], ['id' => 2, 'background_media' => $layers]],
]];
same($card->invoke(null, $cardDoc([['media_id' => 7], ['media_id' => 8]]))['image'], '/m/sky.png', "with no layer marked main, the start scene's first background is the card's picture");
same($card->invoke(null, $cardDoc([['media_id' => 7], ['media_id' => 8, 'main' => true]]))['image'], '/m/deck.png', 'a background layer marked main is the picture instead');

echo $failures ? "$failures of $checks checks FAILED\n" : "classes: all $checks checks passed\n";
exit($failures ? 1 : 0);
