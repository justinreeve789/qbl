<?php

/**
 * Tests for the public API, version 1 (App\Qbl\Api\*), over SQLite: client credentials,
 * scopes, the roster and its privacy rules, enrollments, assignments and teams, launch links,
 * avatars, every report, the activity feed, export and deletion, and the audit log.
 *
 *   php apps/api/tests/api_v1.php
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'Avatars', 'ClassApi', 'ScenarioStore', 'ActivityStore'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}
foreach (['Sql', 'ApiError', 'Privacy', 'Clients', 'Roster', 'Launches', 'OrgAvatars', 'Reports', 'V1/Api'] as $class) {
    require __DIR__."/../app/Qbl/Api/$class.php";
}

use App\Qbl\ActivityStore;
use App\Qbl\Api\Clients;
use App\Qbl\Api\Privacy;
use App\Qbl\Api\V1\Api;
use App\Qbl\ClassApi;
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
foreach (array_merge(ScenarioStore::sqliteSchema(), ActivityStore::sqliteSchema(), Clients::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
$media = sys_get_temp_dir().'/qbl-api-v1-'.bin2hex(random_bytes(4));
$api = new Api($pdo, $media, '/media', 'https://qbl.test');
$clients = $api->clients();
$scenarios = new ScenarioStore($pdo);
$activity = new ActivityStore($pdo);

// A published mission with two objectives, a glossary, and a question whose right answer is marked.
$s = $scenarios->createScenario(['title' => 'Wilting Stream'], null);
$sid = (int) $s['id'];
$scene = $scenarios->createRow($sid, 'scenes', ['shortname' => 'meadow', 'width' => 800, 'height' => 600]);
$scenarios->updateScenario($sid, ['start_scene_id' => $scene['id'], 'settings' => [
    'objectives' => [
        ['id' => 'samples', 'text' => 'Collect samples ({{samples}}/3)', 'complete_when' => [['variable' => 'samples', 'operator' => '>=', 'operand' => 3]]],
        ['id' => 'report', 'text' => 'Report back', 'complete_when' => [['variable' => 'reported', 'operator' => '=', 'operand' => 1]]],
    ],
    'glossary' => [['id' => 'ph', 'term' => 'pH', 'definition' => 'How acidic water is.'], ['id' => 'algae', 'term' => 'Algae', 'definition' => 'Tiny water plants.']],
    'curriculum' => ['learning_objectives' => [['id' => 'lo1', 'text' => 'Explain what pH measures', 'standards' => ['MS-LS2-4']]], 'evidence' => ['lo1' => [['interaction' => 'ph', 'type' => 'question', 'first_answer' => 'q_ph_first']]]],
]]);
foreach ([['samples', 0], ['reported', 0], ['q_ph_first', '']] as [$name, $default]) {
    $scenarios->createRow($sid, 'variables', ['variable_name' => $name, 'default_value' => $default, 'scope' => 'player']);
}
$event = $scenarios->createRow($sid, 'events', ['scene_id' => $scene['id'], 'kind' => 'indirect', 'shortname' => 'quiz']);
$quiz = $scenarios->createRow($sid, 'actions', ['event_id' => $event['id'], 'type' => 'infobox', 'params' => [
    'content' => '<p>What does <b>pH</b> measure?</p>',
    'call_to_actions' => [['text' => 'Temperature', 'correct' => false], ['text' => 'Acidity', 'correct' => true]],
]]);
$scenarios->publish($sid);
$code = $pdo->query("SELECT code FROM scenarios WHERE id = $sid")->fetchColumn();

// ---------------------------------------------------------------- clients and tokens
$district = $clients->createOrganization('Riverside District', 'district');
$other = $clients->createOrganization('Elsewhere Inc', 'business');
$made = $clients->createClient($district['id'], 'SIS sync', ['*']);
same(count($made['scopes']), count(Clients::SCOPES), "'*' gives every scope");
check(str_starts_with($made['client_secret'], 'qbls_') && ! str_contains(json_encode($clients->clients($district['id'])), $made['client_secret']), 'the secret is shown once and never kept in the clear');

[$status, $body] = $api->handle('POST', 'oauth/token', [], ['grant_type' => 'client_credentials', 'client_id' => $made['client_id'], 'client_secret' => 'wrong']);
same([$status, $body['error']['code']], [401, 'invalid_client'], 'a wrong secret gets no token');
[$status, $body] = $api->handle('POST', 'oauth/token', [], ['grant_type' => 'password']);
same([$status, $body['error']['code']], [400, 'unsupported_grant_type'], 'only client credentials');
[$status, $tok] = $api->handle('POST', 'oauth/token', [], ['grant_type' => 'client_credentials'], [], ['basic' => [$made['client_id'], $made['client_secret']]]);
same([$status, $tok['token_type'], $tok['expires_in']], [200, 'Bearer', 3600], 'HTTP Basic credentials get an hour-long bearer token');
$auth = ['bearer' => $tok['access_token']];
[, $narrow] = $api->handle('POST', 'oauth/token', [], ['client_id' => $made['client_id'], 'client_secret' => $made['client_secret'], 'scope' => 'roster:read']);
same($narrow['scope'], 'roster:read', 'a client may ask for fewer scopes');
$readOnly = ['bearer' => $narrow['access_token']];
$limited = $clients->createClient($district['id'], 'Reports only', ['reports:read']);
[$status, $body] = $api->handle('POST', 'oauth/token', [], ['client_id' => $limited['client_id'], 'client_secret' => $limited['client_secret'], 'scope' => 'roster:write']);
same([$status, $body['error']['code']], [400, 'invalid_scope'], 'never more than it has');

$call = fn (string $method, string $path, array $body = [], array $query = [], array $files = [], ?array $as = null) => $api->handle($method, $path, $query, $body, $files, $as ?? $auth);
same($api->handle('GET', 'students', [], [], [], [])[0], 401, 'no token, no answer');
same($api->handle('GET', 'students', [], [], [], ['bearer' => 'qbla_nonsense'])[1]['error']['code'], 'invalid_token', 'an unknown token is refused');
same($call('POST', 'students', ['external_id' => 'x'], [], [], $readOnly)[1]['error']['code'], 'insufficient_scope', 'a read-only token cannot write');
same($call('GET', '')[1]['data']['version'], 'v1', 'the index says which version this is');

// ----------------------------------------------------------- schools and people
[$status, $school] = $call('POST', 'schools', ['name' => 'Riverside Middle', 'external_id' => 'RMS']);
same([$status, $school['data']['parent_id']], [201, $district['id']], 'a school sits under the district');
$schoolId = $school['data']['id'];

[$status, $body] = $call('POST', 'students', ['external_id' => 'h-001', 'first_name' => 'Ann', 'email' => 'ann@kids.test']);
same([$status, $body['error']['code'], array_keys($body['error']['fields'])], [422, 'pii_not_accepted', ['first_name', 'email']], 'names and email addresses are refused outright');
same($call('POST', 'students', ['external_id' => 'ann@kids.test'])[1]['error']['code'], 'pii_not_accepted', 'so is an email address used as the external id');
same($call('POST', 'students', ['external_id' => 'h-001', 'display_name' => 'Ann'])[1]['error']['code'], 'pii_not_accepted', 'students cannot be given a display name');
[$status, $ann] = $call('POST', 'students', ['external_id' => 'h-001', 'school_id' => $schoolId, 'grade_level' => '07']);
$ann = $ann['data'];
same([$status, $ann['grade_level'], $ann['school_id'], $ann['status']], [201, '7', $schoolId, 'active'], 'a student is made with a school and grade');
check((bool) preg_match('/^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/', $ann['display_name']), 'and plays under a made-up name: '.$ann['display_name']);
$email = $pdo->query("SELECT email FROM users WHERE id = {$ann['id']}")->fetchColumn();
check(Privacy::isPlaceholderEmail($email) && ! array_key_exists('email', $ann), 'the account has a placeholder address that is never shown');
same($call('POST', 'students', ['external_id' => 'h-001'])[0], 409, 'the same external id twice is a conflict');
same($call('POST', 'students', ['external_id' => 'h-009', 'school_id' => 99999])[1]['error']['fields'], ['school_id' => 'School 99999 is not one of your schools.'], 'a school of nobody\'s is refused');

[$status, $batch] = $call('POST', 'students/batch', ['students' => [
    ['external_id' => 'h-001', 'grade_level' => '8'],
    ['external_id' => 'h-002', 'school_id' => $schoolId, 'grade_level' => '7'],
    ['external_id' => 'h-003', 'grade_level' => '7'],
    ['external_id' => 'h-004', 'last_name' => 'Smith'],
]]);
same(array_column($batch['data'], 'result'), ['updated', 'created', 'created', 'error'], 'a batch creates, updates and reports each entry');
same($batch['meta'], ['created' => 2, 'updated' => 1, 'errors' => 1], 'and counts them');
$ben = $batch['data'][1]['id'];
$cy = $batch['data'][2]['id'];
same($call('GET', 'students/ext:h-001')[1]['data']['grade_level'], '8', 'a student can be named by external id in a path');
[, $page] = $call('GET', 'students', [], ['limit' => 2]);
same([count($page['data']), $page['meta']['next_cursor'] !== null], [2, true], 'lists come a page at a time');
[, $page2] = $call('GET', 'students', [], ['limit' => 2, 'cursor' => $page['meta']['next_cursor']]);
same(array_column($page2['data'], 'external_id'), ['h-003'], 'and the cursor gives the next page');
same(array_column($call('GET', 'students', [], ['school_id' => $schoolId])[1]['data'], 'external_id'), ['h-001', 'h-002'], 'filtered by school');
$oldName = $ann['display_name'];
check((bool) preg_match('/^[A-Z][a-z]+ [A-Z][a-z]+ \d{3}$/', $call('PATCH', 'students/'.$ann['id'], ['regenerate_display_name' => true])[1]['data']['display_name']), 'a student can be given a new pseudonym');

[$status, $tan] = $call('POST', 'teachers', ['external_id' => 'staff-17', 'display_name' => 'Ms. T', 'school_id' => $schoolId]);
same([$status, $tan['data']['display_name'], $tan['data']['type']], [201, 'Ms. T', 'teacher'], 'a teacher may have a display name of their choosing');
$tan = $tan['data']['id'];
same($call('POST', 'teachers', ['external_id' => 'staff-18', 'display_name' => 'call 555-123-4567'])[1]['error']['code'], 'pii_not_accepted', 'but not contact details');
$ito = $call('POST', 'teachers', ['external_id' => 'staff-18'])[1]['data']['id'];

// ------------------------------------------------------------------ enrollments
[$status, $enr] = $call('POST', 'enrollments', ['teacher_external_id' => 'staff-17', 'student_external_ids' => ['h-001', 'h-002']]);
same([$status, count($enr['data']), $enr['meta']['added']], [200, 2, [$ann['id'], $ben]], 'students are enrolled with a teacher by external id');
same($call('GET', 'students/'.$ann['id'])[1]['data']['teacher_ids'], [$tan], 'a student lists their teachers');
same($call('POST', 'enrollments', ['teacher_id' => $tan, 'student_ids' => [$ben]])[1]['meta']['added'], [], 'enrolling again changes nothing');

// ---------------------------------------------------------- the other organization
$theirs = $clients->createClient($other['id'], 'Other', ['*']);
$theirAuth = ['bearer' => $api->handle('POST', 'oauth/token', [], ['client_id' => $theirs['client_id'], 'client_secret' => $theirs['client_secret']])[1]['access_token']];
same($call('GET', 'students/'.$ann['id'], [], [], [], $theirAuth)[0], 404, 'another organization cannot see our students');
same($call('POST', 'enrollments', ['teacher_id' => $tan, 'student_ids' => [$ann['id']]], [], [], $theirAuth)[0], 404, 'or enroll them');
same($call('GET', 'students', [], [], [], $theirAuth)[1]['data'], [], 'its list is its own');

// ----------------------------------------------------------- scenarios, assignments
[, $cat] = $call('GET', 'scenarios');
same([count($cat['data']), $cat['data'][0]['code'], $cat['data'][0]['objectives']], [1, $code, 2], 'the catalogue lists published missions');
same($call('GET', "scenarios/$sid")[1]['data']['learning_objectives'][0]['standards'], ['MS-LS2-4'], 'one mission in detail, with what it teaches');
[$status, $asg] = $call('POST', 'assignments', [
    'teacher_external_id' => 'staff-17', 'scenario_id' => $sid, 'external_id' => 'lms-555', 'due_at' => '2026-11-01T00:00:00Z', 'note' => 'Finish by Friday',
    'student_external_ids' => ['h-001', 'h-002', 'h-003'],
    'teams' => [['name' => 'Comets', 'student_external_ids' => ['h-001', 'h-002']]],
]);
$asg = $asg['data'];
same([$status, $asg['external_id'], count($asg['student_ids']), $asg['teams'][0]['name'], $asg['teams'][0]['student_ids']], [201, 'lms-555', 3, 'Comets', [$ann['id'], $ben]], 'an assignment is made with a team');
same($call('GET', 'students/'.$cy)[1]['data']['teacher_ids'], [$tan], 'assigning a student enrolls them with the teacher');
same($call('POST', 'assignments', ['teacher_id' => $tan, 'scenario_id' => $sid, 'external_id' => 'lms-555'])[0], 409, 'external ids of assignments are unique');
same(count($call('GET', 'assignments', [], ['student_id' => 'ext:h-003'])[1]['data']), 1, "a student's assignments");
same($call('PATCH', 'assignments/'.$asg['id'], ['note' => 'Thanks!'])[1]['data']['note'], 'Thanks!', 'an assignment can be changed');
[$status, $team2] = $call('POST', 'assignments/'.$asg['id'].'/teams', ['name' => 'Rockets', 'student_ids' => [$cy]]);
same([$status, $team2['data']['name'], $team2['data']['student_ids']], [201, 'Rockets', [$cy]], 'a team can be added');
same($call('PATCH', 'teams/'.$team2['data']['id'], ['student_ids' => [$cy, $ben]])[1]['data']['student_ids'], [$ben, $cy], 'and its members changed');
same($call('GET', 'assignments/'.$asg['id'].'/teams')[1]['data'][0]['student_ids'], [$ann['id']], 'which moves them out of their old team');
same($call('DELETE', 'teams/'.$team2['data']['id'])[0], 204, 'a team can be removed');
same($call('PATCH', 'assignments/'.$asg['id'], ['teams' => [['name' => 'Comets', 'id' => $asg['teams'][0]['id'], 'student_ids' => [$ann['id'], $ben]]]])[1]['data']['teams'][0]['id'], $asg['teams'][0]['id'], 'a team keeps its id (and its game) when the teams are rewritten');

// ------------------------------------------------------------------ launch links
[$status, $launch] = $call('POST', 'students/'.$ann['id'].'/launch', ['assignment_id' => $asg['id']]);
$team = 't'.$asg['teams'][0]['id'];
same([$status, $launch['data']['return_path']], [201, "/$code?group=$team"], "a launch link takes a student to their team's game");
$launchCode = basename($launch['data']['url']);
check(str_starts_with($launch['data']['url'], 'https://qbl.test/api/v1/launch/'), 'on this site');
[$status, $page] = $api->handle('GET', "launch/$launchCode", [], []);
check($status === 200 && str_contains($page['html'], "localStorage.setItem('qbl.token'"), 'opening it shows a page that signs in');
[$status, $redeemed] = $api->handle('POST', "launch/$launchCode", [], []);
same([$status, $redeemed['data']['user']['id'], $redeemed['data']['return_path']], [200, $ann['id'], "/$code?group=$team"], 'which redeems it once');
[$tokenId, $plain] = explode('|', $redeemed['data']['token']);
same($pdo->query("SELECT token FROM personal_access_tokens WHERE id = $tokenId")->fetchColumn(), hash('sha256', $plain), 'for a Sanctum token');
same($api->handle('POST', "launch/$launchCode", [], [])[0], 410, 'and never again');
same($call('POST', "teachers/$tan/launch", ['to' => 'editor'])[1]['data']['return_path'], '/editor/#/', 'a teacher can be sent to the editor');
same($call('POST', 'students/'.$ann['id'].'/launch', ['to' => 'editor'])[0], 422, 'a student cannot');

// --------------------------------------------------------------- play, then report
$now = time();
$at = fn (int $minutesAgo) => gmdate('Y-m-d\TH:i:s\Z', $now - 60 * $minutesAgo);
$activity->logActivity($sid, [
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'join', 'ref' => (string) $scene['id'], 'at' => $at(120)],
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'hotspot', 'ref' => '1', 'at' => $at(118)],
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'choice', 'ref' => (string) $quiz['id'], 'label' => 'Acidity', 'at' => $at(115)],
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'objective', 'ref' => 'samples', 'at' => $at(110)],
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'objective', 'ref' => 'report', 'at' => $at(100)],
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'join', 'ref' => (string) $scene['id'], 'at' => $at(30)],
    ['user_id' => (string) $ann['id'], 'group' => $team, 'type' => 'hotspot', 'ref' => '2', 'at' => $at(20)],
    ['user_id' => (string) $ben, 'group' => $team, 'type' => 'join', 'ref' => (string) $scene['id'], 'at' => $at(60)],
    ['user_id' => (string) $ben, 'group' => $team, 'type' => 'choice', 'ref' => (string) $quiz['id'], 'label' => 'Temperature', 'at' => $at(58)],
    ['user_id' => (string) $ben, 'group' => $team, 'type' => 'choice', 'ref' => (string) $quiz['id'], 'label' => 'Acidity', 'at' => $at(57)],
]);
$activity->logMessages($sid, [['user_id' => (string) $ben, 'name' => 'x', 'group' => $team, 'kind' => 'private', 'to_user_id' => (string) $ann['id'], 'to_name' => 'y', 'text' => 'nice one']]);
$save = $pdo->prepare('INSERT INTO scenario_sessions (scenario_id, user_id, group_key, data, updated_at) VALUES (?, ?, ?, ?, ?)');
$save->execute([$sid, $ann['id'], $team, json_encode(['time_elapsed' => 900, 'variables' => ['samples' => 3, 'reported' => 1, 'q_ph_first' => 'Acidity'], 'flags' => ['glossary:ph', 'glossary:algae']]), gmdate('Y-m-d H:i:s')]);
$save->execute([$sid, $ben, $team, json_encode(['time_elapsed' => 200, 'variables' => ['samples' => 1, 'q_ph_first' => 'Temperature'], 'flags' => ['glossary:ph']]), gmdate('Y-m-d H:i:s')]);

[$status, $report] = $call('GET', 'assignments/'.$asg['id'].'/report');
$byExt = array_column($report['data']['students'], null, 'external_id');
same([$status, $report['data']['summary']['students'], $report['data']['summary']['finished']], [200, 3, 1], 'the assignment report covers every student');
same([$byExt['h-001']['grade']['status'], $byExt['h-002']['grade']['status'], $byExt['h-003']['grade']['status']], ['completed', 'in_progress', 'not_started'], 'and says where each one is');
same($byExt['h-001']['questions'][0]['prompt'], 'What does pH measure?', 'questions carry their prompt');
same([$byExt['h-001']['questions'][0]['first_answer_correct'], $byExt['h-002']['questions'][0]['first_answer_correct'], $byExt['h-002']['questions'][0]['last_answer_correct']], [true, false, true], 'and, where the author marked the right answer, whether the first and last were right');
same([$byExt['h-001']['grade']['score'], $byExt['h-001']['grade']['score_parts']], [100.0, ['objectives' => 100.0, 'accuracy' => 100.0, 'vocabulary' => 100.0]], 'a student who did everything scores 100');
same([$byExt['h-002']['grade']['score'], $byExt['h-003']['grade']['score']], [round(100 * (0.15 * 0.5) / 1.0, 1), null], 'partial work scores in part; no work, no score');
same([$byExt['h-001']['grade']['late'], $byExt['h-002']['grade']['missing'], $byExt['h-003']['grade']['missing']], [true, true, true], 'past the due date: late if done, missing if not');
check(! str_contains(json_encode($report), '@'), 'no email address anywhere in a report');

[, $grades] = $call('GET', 'assignments/'.$asg['id'].'/grades');
same(array_keys($grades['data'][0])[0], 'student_id', 'grades are one row per student');
[, $csv] = $call('GET', 'assignments/'.$asg['id'].'/grades', [], ['format' => 'csv']);
$lines = array_map('str_getcsv', array_filter(explode("\n", $csv['csv'])));
same([count($lines), in_array('score_parts.objectives', $lines[0], true), in_array('external_id', $lines[0], true)], [4, true, true], 'and come as CSV for a spreadsheet or gradebook');
same(count($call('GET', 'assignments/'.$asg['id'].'/activity', [], ['student_id' => 'ext:h-002'])[1]['data']), 3, "an assignment's activity, for one student");
same($call('GET', 'assignments/'.$asg['id'].'/messages', [], [], [], ['bearer' => $api->handle('POST', 'oauth/token', [], ['client_id' => $limited['client_id'], 'client_secret' => $limited['client_secret']])[1]['access_token']])[1]['error']['code'], 'insufficient_scope', 'messages need their own scope');
[, $msgs] = $call('GET', 'assignments/'.$asg['id'].'/messages');
same([$msgs['data'][0]['from_external_id'], $msgs['data'][0]['to_external_id'], $msgs['data'][0]['text']], ['h-002', 'h-001', 'nice one'], 'with it, messages say who wrote to whom');

[, $eng] = $call('GET', 'reports/engagement', [], ['from' => gmdate('Y-m-d', $now - 3 * 86400), 'include' => 'students', 'group_by' => 'school']);
$e = $eng['data']['totals'];
same([$e['students'], $e['active_students'], $e['participation_rate'], $e['sessions']], [3, 2, 0.667, 3], 'engagement: who took part, and in how many sessions');
same(array_column($eng['data']['students'], 'sessions', 'external_id'), ['h-001' => 2, 'h-002' => 1, 'h-003' => 0], 'a long gap starts a new session');
same(array_column($eng['data']['groups'], 'students', 'school_id'), ['' => 1, $schoolId => 2], 'grouped by school (and those in none)');
same(array_sum(array_column($eng['data']['series'], 'active_minutes')), $e['active_minutes'], 'the series adds up to the totals');
[, $engCsv] = $call('GET', 'reports/engagement', [], ['format' => 'csv']);
check(str_contains(strtok($engCsv['csv'], "\n"), 'active_minutes'), 'engagement per student as CSV');

[, $learning] = $call('GET', 'reports/learning');
$sc = $learning['data']['scenarios'][0];
same([$sc['students'], $sc['completed'], $sc['completion_rate'], $sc['first_try_rate']], [3, 1, 0.333, 0.5], 'learning: completion and first-try answers, per mission');
same([$sc['questions'][0]['first_answer_correct_rate'], $sc['questions'][0]['first_answers'][0]['students']], [0.5, 1], 'per question: how often right the first time, and the common first answers');
same($sc['objectives'][0]['text'], 'Collect samples', 'objectives read without their placeholders');
same([$sc['learning_objectives'][0]['students_with_evidence'], $sc['learning_objectives'][0]['values']['ph.first_answer']], [2, ['Acidity' => 1, 'Temperature' => 1]], 'and the evidence each learning objective collected');
same(array_column($call('GET', 'reports/standards')[1]['data'], 'students', 'code'), ['MS-LS2-4' => 3], 'standards: who was taught each one');
[, $summary] = $call('GET', 'reports/summary');
same([$summary['data']['students'], $summary['data']['teachers'], $summary['data']['assignments'], $summary['data']['active_students_7_days']], [3, 2, 1, 2], 'the summary has the headline numbers');
[, $one] = $call('GET', 'students/ext:h-001/report');
same([$one['data']['totals']['assignments'], $one['data']['totals']['completed'], $one['data']['totals']['average_score'], $one['data']['standards'][0]['code']], [1, 1, 100.0, 'MS-LS2-4'], "one student's report, across assignments and standards");

[, $feed] = $call('GET', 'activity', [], ['limit' => 4]);
same([count($feed['data']), $feed['data'][0]['assignment_id'], $feed['data'][0]['team_id'], $feed['data'][0]['external_id']], [4, $asg['id'], $asg['teams'][0]['id'], 'h-001'], 'the activity feed names the assignment and team of each line');
[, $feed2] = $call('GET', 'activity', [], ['cursor' => $feed['meta']['next_cursor'], 'limit' => 1000]);
same([count($feed2['data']), $feed2['meta']['next_cursor']], [6, null], 'and picks up where the last page stopped');
same($call('GET', 'activity', [], [], [], $theirAuth)[1]['data'], [], "and holds only the organization's own students");

// ------------------------------------------------------------------------ avatars
$png = (function () {
    $im = imagecreatetruecolor(64, 32);
    ob_start();
    imagepng($im);

    return ob_get_clean();
})();
[$status, $av] = $call('POST', 'avatars', ['name' => 'Riverside Otter', 'external_id' => 'mascot', 'image_base64' => 'data:image/png;base64,'.base64_encode($png), 'scale' => 0.9, 'sheet' => ['columns' => 2, 'rows' => 1], 'animations' => [['name' => 'idle', 'frames' => [0, 1], 'duration' => 800]]]);
same([$status, $av['data']['owner'], $av['data']['width'], $av['data']['sheet'], $av['data']['animations'][0]['frames']], [201, 'organization', 64, ['columns' => 2, 'rows' => 1], [0, 1]], 'an organization imports its own avatar, sprite sheet and all');
check(is_file($media.'/avatars/o'.$district['id'].'/'.basename($av['data']['image_url'])), 'the picture is kept on this server');
same($call('POST', 'avatars', ['name' => 'Linked', 'image_url' => 'https://elsewhere.test/a.png'])[0], 422, 'a link to a picture elsewhere is refused');
same($call('POST', 'avatars', ['name' => 'Bad', 'image_base64' => base64_encode('not a picture')])[0], 422, 'and so is something that is not a picture');
same($call('POST', 'avatars', ['name' => 'Wild', 'image_base64' => base64_encode($png), 'sheet' => ['columns' => 2, 'rows' => 1], 'animations' => [['name' => 'idle', 'frames' => [5]]]])[0], 422, 'animation frames must be on the sheet');
$classApi = new ClassApi($pdo);
$annSees = array_column($classApi->handle('GET', 'avatars', [], ['id' => $ann['id'], 'role' => 'student'])[1]['avatars'], 'name');
$pdo->exec("INSERT INTO users (id, name, email, role, organization_id) VALUES (500, 'Zed', 'zed@x.test', 'student', {$other['id']})");
$zedSees = array_column($classApi->handle('GET', 'avatars', [], ['id' => 500, 'role' => 'student'])[1]['avatars'], 'name');
same([in_array('Riverside Otter', $annSees, true), in_array('Riverside Otter', $zedSees, true)], [true, false], "the organization's players can choose it; others cannot");
same($classApi->handle('PUT', 'me/avatar', ['avatar_media_id' => $av['data']['media_id']], ['id' => 500, 'role' => 'student'])[0], 422, 'or wear it');
same($classApi->handle('PUT', 'me/avatar', ['avatar_media_id' => $av['data']['media_id']], ['id' => $ann['id'], 'role' => 'student'])[0], 200, 'its own players can');
same($call('PATCH', 'avatars/'.$av['data']['id'], ['name' => 'Otter'])[1]['data']['name'], 'Otter', 'an avatar can be renamed');
same($call('DELETE', 'avatars/'.$av['data']['id'])[0], 204, 'and retired');
same([$call('GET', 'avatars/'.$av['data']['id'])[1]['data']['active'], $pdo->query("SELECT avatar_media_id FROM users WHERE id = {$ann['id']}")->fetchColumn()], [false, null], 'whoever wore it chooses again');
same($call('DELETE', 'avatars/1', [], [], [], $theirAuth)[0], 404, "nobody can retire another organization's avatar");

// ----------------------------------------------------------- deactivate, export, delete
same($call('PATCH', 'students/'.$ann['id'], ['status' => 'inactive'])[1]['data']['status'], 'inactive', 'a student can be deactivated');
same((int) $pdo->query("SELECT COUNT(*) FROM personal_access_tokens WHERE tokenable_id = {$ann['id']}")->fetchColumn(), 0, 'which signs them out everywhere');
same($call('POST', 'students/'.$ann['id'].'/launch')[0], 409, 'and stops launch links');
[, $export] = $call('GET', 'students/'.$ann['id'].'/export');
same([count($export['data']['activity']), count($export['data']['saved_games']), $export['data']['saved_games'][0]['data']['time_elapsed']], [7, 1, 900], 'an export has everything kept about a student');
check(count($export['data']['disclosures']) > 0, 'including who was given their records');
[$status, $deleted] = $call('DELETE', 'students/'.$ann['id']);
same([$status, $deleted['data']['deleted']['activity_log'], $deleted['data']['deleted']['users']], [200, 7, 1], 'deleting a student removes them and their data');
same((int) $pdo->query("SELECT COUNT(*) FROM chat_messages WHERE to_user_id = {$ann['id']}")->fetchColumn(), 0, 'messages to them no longer name them');
same($call('GET', 'students/'.$ann['id'])[0], 404, 'they are gone');
same($call('DELETE', "teachers/$tan", [], ['transfer_to' => 'ext:staff-18'])[1]['data']['deleted']['users'], 1, 'a teacher can be deleted, handing their classes on');
same([$call('GET', 'assignments/'.$asg['id'])[1]['data']['teacher_id'], $call('GET', "students/$ben")[1]['data']['teacher_ids']], [$ito, [$ito]], 'to the teacher named');

// ------------------------------------------------------------------------ audit
[, $log] = $call('GET', 'audit-log', [], ['student_id' => (string) $ben, 'limit' => 500]);
check(count($log['data']) > 3 && in_array('/api/v1/assignments/'.$asg['id'].'/report', array_column($log['data'], 'path'), true), 'the audit log records each disclosure of a student\'s records');
$theirLog = array_column($call('GET', 'audit-log', [], ['limit' => 1000], [], $theirAuth)[1]['data'], 'path');
same([in_array('/api/v1/avatars/1', $theirLog, true), in_array('/api/v1/assignments/'.$asg['id'].'/report', $theirLog, true)], [true, false], 'and each organization sees only its own');

array_map('unlink', glob("$media/avatars/*/*") ?: []);
echo $failures ? "api_v1: $failures of $checks checks failed\n" : "api_v1: all $checks checks passed\n";
exit($failures ? 1 : 0);
