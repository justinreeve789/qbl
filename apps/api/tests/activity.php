<?php

/**
 * Tests for the activity and message logs, badges, profiles and teachers' reports
 * (App\Qbl\ActivityStore and its routes in ClassApi), over SQLite.
 *
 *   php apps/api/tests/activity.php
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ActivityStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'PngToWebp', 'Avatars', 'ClassApi', 'ScenarioStore'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\ActivityStore;
use App\Qbl\ClassApi;
use App\Qbl\ClassStore;
use App\Qbl\ProgressStore;
use App\Qbl\ScenarioCompiler;
use App\Qbl\ScenarioStore;

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

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
foreach (array_merge(ScenarioStore::sqliteSchema(), ActivityStore::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
$scenarios = new ScenarioStore($pdo);
$classes = new ClassStore($pdo);
$activity = new ActivityStore($pdo);
$progress = new ProgressStore($pdo);
$pdo->exec("INSERT INTO users (id, name, email, role, avatar_media_id, stars, xp) VALUES
    (1, 'Ms Tan', 'tan@school.test', 'teacher', NULL, 0, 0), (2, 'Mr Ito', 'ito@school.test', 'teacher', NULL, 0, 0),
    (11, 'Ann', 'ann@school.test', 'student', 900001, 12, 140), (12, 'Ben', 'ben@school.test', 'student', NULL, 0, 0), (13, 'Cy', 'cy@school.test', 'student', NULL, 0, 0),
    (20, 'Guest', NULL, 'guest', NULL, 0, 0)");

// A mission with two objectives (one about a shared variable), a glossary, a question and an award with a badge.
$s = $scenarios->createScenario(['title' => 'Wilting Stream'], 1);
$id = (int) $s['id'];
$scene = $scenarios->createRow($id, 'scenes', ['shortname' => 'meadow', 'width' => 800, 'height' => 600, 'layout' => ['shadow_spots' => [['x' => 100, 'y' => 100, 'radius' => 50]]], 'params' => ['team_only' => true]]);
$scenarios->updateScenario($id, ['start_scene_id' => $scene['id'], 'settings' => [
    'objectives' => [
        ['id' => 'samples', 'text' => 'Collect samples', 'complete_when' => [['variable' => 'samples', 'operator' => '>=', 'operand' => 3]]],
        ['id' => 'path', 'text' => 'Clear the path', 'complete_when' => [['variable' => 'rockfall', 'operator' => '=', 'operand' => 0]]],
        ['id' => 'bonus', 'text' => 'Meet the frog', 'optional' => true, 'complete_when' => [['variable' => 'frog', 'operator' => '=', 'operand' => 1]]],
    ],
    'glossary' => [['id' => 'ph', 'term' => 'pH', 'definition' => 'How acidic water is.', 'initial' => true], ['id' => 'algae', 'term' => 'Algae', 'definition' => 'Tiny water plants.']],
    'scene_groups' => [['id' => 1, 'name' => 'Planet', 'team_only' => true]],
    'narration' => 'on', 'private_messages' => true,
    'curriculum' => ['learning_objectives' => [['id' => 'lo1', 'text' => 'Explain what pH measures', 'standards' => ['MS-LS2-4']]], 'evidence' => ['lo1' => [['interaction' => 'ph', 'type' => 'question', 'first_answer' => 'q_ph_first', 'tries' => 'q_ph_tries']]]],
]]);
foreach ([['samples', 0, 'player'], ['frog', 0, 'player'], ['rockfall', 1, 'room'], ['q_ph_first', '', 'player'], ['q_ph_tries', 0, 'player']] as [$name, $default, $scope]) {
    $scenarios->createRow($id, 'variables', ['variable_name' => $name, 'default_value' => $default, 'scope' => $scope]);
}
$media = $scenarios->createRow($id, 'media', ['type' => 'image', 'url' => '/media/badge.png']);
$event = $scenarios->createRow($id, 'events', ['scene_id' => $scene['id'], 'kind' => 'indirect', 'shortname' => 'report']);
$award = $scenarios->createRow($id, 'actions', ['event_id' => $event['id'], 'type' => 'award', 'params' => ['stars' => 5, 'xp' => 20, 'badge' => 'Stream Saver', 'badge_description' => 'Found out why the stream wilted', 'badge_media_id' => $media['id']]]);
$word = $scenarios->createRow($id, 'actions', ['event_id' => $event['id'], 'type' => 'glossary', 'params' => ['entry_id' => 'algae']]);
$scenarios->publish($id);
$document = $scenarios->findPublished($s['code']);
$meadow = array_values(array_filter($document['scenes'], fn ($sc) => ($sc['shortname'] ?? '') === 'meadow'))[0];

// ---- the compiled document carries the new settings
same([$document['narration'], $document['private_messages'], $document['scene_groups'][0]['team_only'], count($document['glossary'])], ['on', true, true, 2], 'narration, private messages, scene groups and the glossary are part of the document');
same([$meadow['team_only'], $meadow['shadow_spots'][0]['radius'], isset($meadow['params'])], [true, 50, false], 'a scene carries its team limit and shadow spots');
same($meadow['indirect_events'][0]['actions'][1]['type'], 'glossary', 'a glossary action is an action like any other');
$plain = ScenarioCompiler::compile(['scenario' => ['id' => 1, 'shortname' => 'x', 'title' => 'X', 'start_scene_id' => 1], 'scenes' => [['id' => 1, 'sequence' => 1]]]);
check(! array_key_exists('team_only', $plain['scenes'][0]) && ! array_key_exists('shadow_spots', $plain['scenes'][0]), 'a scene that sets neither says nothing about them');
$sky = ['time' => 'afternoon', 'until' => 'dusk', 'minutes' => 6];
$lit = ScenarioCompiler::compile(['scenario' => ['id' => 1, 'shortname' => 'x', 'title' => 'X', 'start_scene_id' => 1], 'scenes' => [['id' => 1, 'sequence' => 1,
    'layout' => json_encode(['lights' => [['x' => 10, 'y' => 20, 'kind' => 'fire']]]), 'params' => json_encode(['sky' => $sky, 'atmosphere' => [['kind' => 'fireflies']], 'music_volume' => 0.4])]]]);
same([$lit['scenes'][0]['sky'], $lit['scenes'][0]['lights'][0]['kind'], $lit['scenes'][0]['atmosphere'][0]['kind'], isset($lit['scenes'][0]['params'])], [$sky, 'fire', 'fireflies', false], 'a scene carries its living sky, its lights and what is in the air');
check(! array_key_exists('sky', $plain['scenes'][0]) && ! array_key_exists('lights', $plain['scenes'][0]) && ! array_key_exists('atmosphere', $plain['scenes'][0]), 'and one without them says nothing about them');

// ---- teams and the room they share
foreach ([11, 12, 13] as $student) {
    $pdo->prepare('INSERT INTO teacher_student (teacher_id, student_id) VALUES (1, ?)')->execute([$student]);
}
$a = $classes->assign(1, $id, [11, 12, 13], null, null, [['name' => 'Comets', 'student_ids' => [11, 12]]]);
$team = $a['teams'][0];
same($classes->access(11, 'student', $id, $team['group']), ['allowed' => true, 'party' => $a['group'], 'team_name' => 'Comets', 'teacher_name' => 'Ms Tan'], "a team plays in its assignment's room, under its own name, and knows its teacher (QL_TeacherName)");
same($classes->access(13, 'student', $id, $a['group']), ['allowed' => true, 'party' => $a['group'], 'teacher_name' => 'Ms Tan'], 'so do the students in no team');
same($classes->access(13, 'student', $id, $team['group'])['allowed'], false, 'a student is still refused a team that is not theirs');
same($classes->access(20, 'guest', $id, 'public'), ['allowed' => true, 'party' => 'public'], 'the public instance is a room of its own');
same($classes->access(11, 'student', $id, 'lunch-club')['party'], 'lunch-club', 'and so is any open group');

// ---- the logs
$t = $team['group'];
same($activity->logActivity($id, [
    ['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'join', 'ref' => (string) $scene['id'], 'at' => '2026-11-18T10:00:00.000Z'],
    ['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'hotspot', 'ref' => '40', 'label' => 'sample-1', 'at' => '2026-11-18T10:01:00.000Z'],
    ['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'choice', 'ref' => '77', 'label' => 'It measures temperature', 'at' => '2026-11-18T10:02:00.000Z'],
    ['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'choice', 'ref' => '77', 'label' => 'It measures acidity', 'at' => '2026-11-18T10:03:00.000Z'],
    ['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'choice', 'ref' => '78', 'label' => 'Algae', 'at' => '2026-11-18T10:04:00.000Z'],
    ['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'leave', 'value' => 300, 'at' => '2026-11-18T10:05:00.000Z'],
    ['user_id' => '12', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'join', 'ref' => (string) $scene['id']],
    ['user_id' => '12', 'group' => $t, 'type' => 'teleport'],
    ['user_id' => 'guest-abc', 'group' => $t, 'type' => 'join'],
    'nonsense',
]), 7, 'activity is kept; lines of an unknown kind or from nobody are not');
same($activity->logMessages($id, [
    ['user_id' => '11', 'name' => 'Ann', 'group' => $t, 'scene_id' => $scene['id'], 'kind' => 'chat', 'text' => 'over here!', 'at' => '2026-11-18T10:01:30.000Z'],
    ['user_id' => '11', 'name' => 'Ann', 'group' => $t, 'scene_id' => $scene['id'], 'kind' => 'private', 'to_user_id' => '12', 'to_name' => 'Ben', 'text' => 'did you find the frog?'],
    ['user_id' => '12', 'name' => 'Ben', 'group' => $t, 'kind' => 'emote', 'text' => '👍'],
    ['user_id' => '12', 'name' => 'Ben', 'group' => $t, 'kind' => 'chat', 'text' => '   '],
    ['user_id' => '12', 'name' => 'Ben', 'group' => $t, 'kind' => 'shout', 'text' => 'hey'],
]), 3, 'messages are kept, in a scene or private; empty ones and unknown kinds are not');
$kept = $activity->messages($id, [$t]);
same([count($kept), $kept[1]['kind'], $kept[1]['to_name'], $kept[1]['text'], $kept[2]['at']], [3, 'private', 'Ben', 'did you find the frog?', '2026-11-18T10:01:30+00:00'], 'the message log says who wrote what to whom, and when');
same($activity->messages($id, ['t999']), [], "another team's messages are not in it");
same(array_column($activity->activity($id, [$t], 11), 'type'), ['leave', 'choice', 'choice', 'choice', 'hotspot', 'join'], "one student's activity, newest first");

// ---- badges and profiles
$action = ProgressStore::findAward($document, (int) $award['id']);
$progress->award(11, $id, $document, (int) $award['id']);
$badge = $activity->grantBadge(11, $id, $document, $action);
same([$badge['name'], $badge['description'], $badge['image_url'], $badge['scenario']], ['Stream Saver', 'Found out why the stream wilted', '/media/badge.png', 'Wilting Stream'], 'an award with a badge gives the badge');
same($activity->grantBadge(11, $id, $document, $action), null, 'once');
same($activity->grantBadge(11, $id, $document, ['id' => 5, 'type' => 'award', 'stars' => 1]), null, 'an award without a badge gives none');
$profile = $activity->profile(11, $progress);
same([$profile['name'], $profile['avatar_media_id'], $profile['stars'], $profile['xp'], $profile['rank'], $profile['look'], array_column($profile['badges'], 'name')], ['Ann', 900001, 17, 160, 'Explorer', [], ['Stream Saver']], 'a profile shows avatar, stars, XP, rank and badges');
check(! array_key_exists('email', $profile), 'and never an email address');
$api = new ClassApi($pdo);
same($api->handle('GET', 'players/11/profile', [], ['id' => 12, 'role' => 'student'])[1]['profile']['rank'], 'Explorer', 'any signed-in player can look at a profile');
same($api->handle('GET', 'players/20/profile', [], ['id' => 12, 'role' => 'student'])[0], 404, 'a guest has none');
same($api->handle('GET', 'players/11/profile', [], null)[0], 401, 'and it needs a sign-in');

// ---- the report
$pdo->prepare('INSERT INTO scenario_sessions (scenario_id, user_id, group_key, data, updated_at) VALUES (?, 11, ?, ?, ?)')->execute([$id, $t, json_encode([
    'scene_id' => $scene['id'], 'time_elapsed' => 300, 'variables' => ['samples' => 3, 'q_ph_first' => 'temperature', 'q_ph_tries' => 2], 'flags' => ['glossary:algae'],
]), '2026-11-18 10:05:00']);
$pdo->prepare('INSERT INTO scenario_instances (scenario_id, group_key, data) VALUES (?, ?, ?)')->execute([$id, $t, json_encode(['variables' => ['rockfall' => 0]])]);
[$status, $body] = $api->handle('GET', "teach/assignments/{$a['id']}/report", [], ['id' => 1, 'role' => 'teacher']);
same($status, 200, 'a teacher can read the report on their assignment');
$r = $body['report'];
$ann = $r['students'][0];
same([$ann['name'], $ann['team'], $ann['time_spent'], $ann['visits'], $ann['objectives_done'], $ann['objectives_total'], $ann['finished']], ['Ann', 'Comets', 300, 1, 2, 2, true], 'time spent and objectives come from the save, shared variables included');
same([$ann['hotspots_used'], $ann['answers'], $ann['words_learned'], $ann['words_total'], $ann['stars_earned'], $ann['xp_earned'], $ann['badges'], $ann['messages']], [1, 3, 2, 2, 5, 20, ['Stream Saver'], 2], 'what they did is counted from the logs');
same($ann['questions'], [['action_id' => '77', 'attempts' => 2, 'first_answer' => 'It measures temperature', 'last_answer' => 'It measures acidity'], ['action_id' => '78', 'attempts' => 1, 'first_answer' => 'Algae', 'last_answer' => 'Algae']], 'each question keeps the first answer and how many tries it took');
same($ann['learning'][0]['evidence'][0]['values'], ['first_answer' => 'temperature', 'tries' => 2], 'evidence of a learning objective is read from the variables the mission names');
same([$ann['first_seen'], $ann['last_seen'], $ann['scenes_visited']], ['2026-11-18T10:00:00+00:00', '2026-11-18T10:05:00+00:00', ['meadow']], 'when they played and where they went');
$ben = $r['students'][1];
same([$ben['started'], $ben['objectives_done'], $ben['finished'], $ben['time_spent']], [true, 1, false, 0], "a teammate has the team's shared progress but not Ann's own");
$cy = $r['students'][2];
same([$cy['group'], $cy['team'], $cy['started'], $cy['objectives_done']], [$a['group'], null, false, 0], 'a student in no team is reported in the assignment\'s own instance, where the path is still blocked');
same([$r['summary']['students'], $r['summary']['started'], $r['summary']['finished'], $r['summary']['questions_answered'], $r['summary']['answered_in_one_try']], [3, 2, 1, 2, 1], 'the summary counts who started and finished, and questions answered in one try');
same(array_column($r['objectives'], 'completed_by'), [1, 2, 0], 'each objective says how many completed it');
same($api->handle('GET', "teach/assignments/{$a['id']}/report", [], ['id' => 2, 'role' => 'teacher'])[0], 404, "another teacher's assignment cannot be reported on");
same($api->handle('GET', "teach/assignments/{$a['id']}/report", [], ['id' => 11, 'role' => 'student'])[0], 403, 'nor can a student read reports');
same(count($api->handle('GET', "teach/assignments/{$a['id']}/messages", [], ['id' => 1, 'role' => 'teacher'])[1]['messages']), 3, 'the teacher can audit the messages');
same(count($api->handle('GET', "teach/assignments/{$a['id']}/activity/12", [], ['id' => 1, 'role' => 'teacher'])[1]['activity']), 1, "and read one student's activity");
same($api->handle('GET', "teach/assignments/{$a['id']}/nonsense", [], ['id' => 1, 'role' => 'teacher'])[0], 404, 'an unknown report is not found');

// ---- a teacher resets a student's progress
same([$activity->resetToken($id, 11, $t), $activity->resetToken($id, 12, $t)], [0, 0], 'a save has no reset token until a teacher resets it');
same($activity->logActivity($id, [['user_id' => '11', 'group' => $t, 'type' => 'reset']]), 0, 'the game server cannot write a reset line');
same($api->handle('POST', "teach/assignments/{$a['id']}/students/11/reset", [], ['id' => 2, 'role' => 'teacher'])[0], 404, "another teacher cannot reset a student's progress");
same($api->handle('POST', "teach/assignments/{$a['id']}/students/11/reset", [], ['id' => 11, 'role' => 'student'])[0], 403, 'nor can a student');
same($api->handle('POST', "teach/assignments/{$a['id']}/students/14/reset", [], ['id' => 1, 'role' => 'teacher'])[0], 404, 'only students in the assignment can be reset');
same($api->handle('GET', "teach/assignments/{$a['id']}/students/11/reset", [], ['id' => 1, 'role' => 'teacher'])[0], 404, 'a reset is a POST');
[$status, $body] = $api->handle('POST', "teach/assignments/{$a['id']}/students/11/reset", [], ['id' => 1, 'role' => 'teacher']);
same([$status, $body['reset']['student_id'], $body['reset']['group'], $body['reset']['reset_by']], [200, 11, $t, 'Ms Tan'], "the teacher resets Ann's progress in her team's game");
$saved = $pdo->prepare('SELECT COUNT(*) FROM scenario_sessions WHERE scenario_id = ? AND user_id = 11 AND group_key = ?');
$saved->execute([$id, $t]);
same((int) $saved->fetchColumn(), 0, 'her save there is deleted');
check($activity->resetToken($id, 11, $t) > 0 && $activity->resetToken($id, 12, $t) === 0, "the reset gives Ann's save a new token, and nobody else's");
$r = $api->handle('GET', "teach/assignments/{$a['id']}/report", [], ['id' => 1, 'role' => 'teacher'])[1]['report'];
$ann = $r['students'][0];
same([$ann['started'], $ann['visits'], $ann['time_spent'], $ann['answers'], $ann['questions'], $ann['scenes_visited'], $ann['first_seen']], [false, 0, 0, 0, [], [], null], 'the report counts her again from the reset');
same([$ann['reset_by'], $ann['reset_at'] !== null], ['Ms Tan', true], 'and says who reset it, and when');
same([$ann['objectives_done'], $ann['stars_earned'], $ann['badges'], $ann['messages']], [1, 5, ['Stream Saver'], 2], "what her team shares, her stars, badges and messages stay");
same([$r['students'][1]['started'], $r['students'][1]['visits'], $r['students'][1]['reset_at']], [true, 1, null], "Ben's game is untouched");
same(array_column($activity->activity($id, [$t], 11), 'type')[0], 'reset', 'the reset is a line in her step-by-step log');
$activity->logActivity($id, [['user_id' => '11', 'group' => $t, 'scene_id' => $scene['id'], 'type' => 'join', 'ref' => (string) $scene['id']]]);
same($api->handle('GET', "teach/assignments/{$a['id']}/report", [], ['id' => 1, 'role' => 'teacher'])[1]['report']['students'][0]['visits'], 1, 'playing again counts from the reset');
$pdo->exec("INSERT INTO users (id, name, email, role) VALUES (30, 'Root', 'root@school.test', 'admin')");
same($api->handle('POST', "teach/assignments/{$a['id']}/students/11/reset", [], ['id' => 30, 'role' => 'admin'])[1]['reset']['reset_by'], 'Root', 'an admin can reset progress too');

// ---- a teacher starts their own game again
$pdo->prepare('INSERT INTO scenario_sessions (scenario_id, user_id, group_key, data, updated_at) VALUES (?, 1, ?, ?, ?), (?, 1, ?, ?, ?)')
    ->execute([$id, $t, '{"scene_id":1}', '2026-11-18 11:00:00', $id, 'public', '{"scene_id":2}', '2026-11-18 11:00:00']);
[$status, $body] = $api->handle('POST', 'me/progress/reset', ['scenario_id' => $id, 'group' => $t], ['id' => 1, 'role' => 'teacher']);
same([$status, $body['reset']['group'], $body['reset']['reset_by']], [200, $t, 'Ms Tan'], 'a teacher resets their own game in a team they look in on');
$mine = $pdo->prepare('SELECT group_key FROM scenario_sessions WHERE scenario_id = ? AND user_id = 1');
$mine->execute([$id]);
same($mine->fetchAll(PDO::FETCH_COLUMN), ['public'], 'only that save goes; their public game stays');
check($activity->resetToken($id, 1, $t) > 0 && $activity->resetToken($id, 1, 'public') === 0, 'and only that save gets a new token');
same($api->handle('POST', 'me/progress/reset', ['scenario_id' => $id], ['id' => 1, 'role' => 'teacher'])[1]['reset']['group'], 'public', 'without a group it is the public game');
$mine->execute([$id]);
same($mine->fetchAll(PDO::FETCH_COLUMN), [], 'which is then gone too');
same($api->handle('POST', 'me/progress/reset', ['scenario_id' => $id, 'group' => $t], ['id' => 11, 'role' => 'student'])[0], 403, 'a student cannot reset their own progress');
same($api->handle('POST', 'me/progress/reset', ['scenario_id' => $id, 'group' => $t], ['id' => 2, 'role' => 'teacher'])[0], 403, "nor can a teacher in a game they may not join");
same($api->handle('POST', 'me/progress/reset', ['scenario_id' => 999999], ['id' => 1, 'role' => 'teacher'])[0], 404, 'an unknown mission is not found');
same($api->handle('GET', 'me/progress/reset', [], ['id' => 1, 'role' => 'teacher'])[0], 404, 'a reset is a POST');
same(array_column($api->handle('GET', "teach/assignments/{$a['id']}/report", [], ['id' => 1, 'role' => 'teacher'])[1]['report']['students'], 'name'), ['Ann', 'Ben', 'Cy'], "the teacher's own game is not in the report");

same([ActivityStore::plain('Collect samples ({{samples}}/3)'), ActivityStore::plain('Welcome {{QL_PlayerName}}, find the lab'), ActivityStore::plain('Plain')], ['Collect samples', 'Welcome, find the lab', 'Plain'], 'objective text is shown without its placeholders');

// ---- conditions are judged as the game judges them
check(ActivityStore::holds([['variable' => 'a', 'operator' => '=', 'operand' => '2']], ['a' => 2]) && ActivityStore::holds([['variable' => 'm', 'operator' => '=', 'operand' => 'Flora']], ['m' => 'flora']), 'numbers compare as numbers and text without regard to case');
check(! ActivityStore::holds([['variable' => 'm', 'operator' => '>', 'operand' => 1]], ['m' => 'flora']) && ! ActivityStore::holds([['variable' => 'missing', 'operator' => '>=', 'operand' => 0]], []), 'ordering needs numbers on both sides');
check(ActivityStore::holds([['variable' => 't', 'operator' => '%', 'operand' => 3]], ['t' => '9']) && ActivityStore::holds([['variable' => 't', 'operator' => '!%', 'operand' => 2]], ['t' => 7])
    && ! ActivityStore::holds([['variable' => 't', 'operator' => '%', 'operand' => 2]], ['t' => 7]) && ActivityStore::holds([['variable' => 't', 'operator' => '%', 'operand' => 0.3]], ['t' => 0.9]), '% is a whole multiple, !% is not, as in the game');
check(! ActivityStore::holds([['variable' => 't', 'operator' => '%', 'operand' => 0]], ['t' => 4]) && ! ActivityStore::holds([['variable' => 't', 'operator' => '!%', 'operand' => 0]], ['t' => 4]), 'dividing by 0 never holds');

echo "$checks checks, $failures failed\n";
exit($failures ? 1 : 0);
