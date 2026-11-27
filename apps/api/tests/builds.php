<?php

/**
 * Tests for student building (App\Qbl\Builds): the rules, saving and showing builds, uploads,
 * teachers' reviews, and what resetting a student's game removes. Over SQLite.
 *
 *   php apps/api/tests/builds.php
 */
foreach (['StoreError', 'Roles', 'ProgressStore', 'ActivityStore', 'ScenarioCompiler', 'ClassStore', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'PngToWebp', 'Avatars', 'ClassApi', 'ScenarioStore', 'Builds/BuildRules', 'Builds/BuildStore', 'Builds/BuildApi'] as $class) {
    require __DIR__."/../app/Qbl/$class.php";
}

use App\Qbl\Builds\BuildApi;
use App\Qbl\Builds\BuildRules;
use App\Qbl\Builds\BuildStore;
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
function refused(callable $work, int $status, string $what, ?string $says = null): void
{
    try {
        $work();
        check(false, $what);
    } catch (StoreError $e) {
        same($e->status, $status, $what);
        if ($says !== null) {
            check(str_contains($e->getMessage(), $says), "$what: says \"$says\" (said \"{$e->getMessage()}\")");
        }
    }
}

$pdo = new PDO('sqlite::memory:');
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
foreach (array_merge(ScenarioStore::sqliteSchema(), App\Qbl\ActivityStore::sqliteSchema()) as $sql) {
    $pdo->exec($sql);
}
$scenarios = new ScenarioStore($pdo);
$classes = new ClassStore($pdo);
$builds = new BuildStore($pdo, '/api/builds/files', $classes);
$pdo->exec("INSERT INTO users (id, name, email, role) VALUES
    (1, 'Ms Tan', 'tan@school.test', 'teacher'), (2, 'Mr Ito', 'ito@school.test', 'teacher'),
    (11, 'Brave Otter', 'ann@school.test', 'student'), (12, 'Calm Heron', 'ben@school.test', 'student'),
    (20, 'Guest', NULL, 'guest'), (30, 'Root', 'root@school.test', 'admin')");
$pdo->exec("INSERT INTO teacher_student (teacher_id, student_id) VALUES (1, 11), (1, 12)");
$tan = ['id' => 1, 'name' => 'Ms Tan', 'role' => 'teacher'];
$ito = ['id' => 2, 'name' => 'Mr Ito', 'role' => 'teacher'];
$ann = ['id' => 11, 'name' => 'Brave Otter', 'role' => 'student'];
$ben = ['id' => 12, 'name' => 'Calm Heron', 'role' => 'student'];
$guest = ['id' => 20, 'name' => 'Guest', 'role' => 'guest'];
$root = ['id' => 30, 'name' => 'Root', 'role' => 'admin'];

// ------------------------------------------------------------------ the rules

same(BuildRules::of(['building' => ['enabled' => false]]), null, 'building that is off allows nothing');
same(BuildRules::of(['building' => ['enabled' => true], 'story' => true]), null, 'nobody builds in a story scene');
same(BuildRules::of(['building' => ['enabled' => true]])['tools'], ['label'], 'the default is place and label; place needs pieces');
same(BuildRules::of(['building' => ['enabled' => true, 'tools' => ['place']]]), null, 'place with no pieces leaves nothing to build with');
same(BuildRules::of(['building' => ['enabled' => true, 'tools' => ['place', 'picture', 'zap'], 'pieces' => [['media_id' => '5']], 'max_pieces' => 500, 'approve' => false, 'share' => 'own', 'prompt' => ' Make a garden ']]),
    ['tools' => ['place', 'picture'], 'pieces' => [5], 'max_pieces' => 50, 'approve' => false, 'share' => 'own', 'prompt' => 'Make a garden'], 'the rules with every setting');
same(BuildRules::cleanLabel("  The <big>\n pond  "), 'The big pond', 'labels are plain words on one line');
same(BuildRules::tidy(['id' => 'a1', 'kind' => 'label', 'x' => 10.4, 'y' => 20.6, 'text' => 'Hi', 'color' => '#ffffff', 'media_id' => 3, 'scale' => 1]), ['id' => 'a1', 'kind' => 'label', 'x' => 10, 'y' => 21, 'text' => 'Hi'], 'a piece keeps only its own fields');
same(BuildRules::problems(BuildRules::of(['building' => ['enabled' => true]]), ['width' => 100, 'height' => 100], ['a' => 1], []), ['A build is a list of things.'], 'a build is a list');

// ------------------------------------------------------------------ a mission with two building scenes

$mission = $scenarios->createScenario(['title' => 'Pond Life'], 1);
$mid = (int) $mission['id'];
$scenarios->updateScenario($mid, ['settings' => ['visibility' => 'private'] + ($mission['settings'] ?? [])]);
$bg = $scenarios->createRow($mid, 'media', ['type' => 'image', 'url' => 'pond.png', 'width' => 1000, 'height' => 600]);
$frog = $scenarios->createRow($mid, 'media', ['type' => 'image', 'url' => 'frog.png', 'width' => 80, 'height' => 60]);
$first = $scenarios->rows($mid)['scenes'][0];
$scenarios->updateRow($mid, 'scenes', (int) $first['id'], [
    'background_media' => [['media_id' => (int) $bg['id']]],
    'params' => ['building' => ['enabled' => true, 'tools' => ['place', 'label', 'picture'], 'pieces' => [['media_id' => (int) $frog['id']]], 'max_pieces' => 3, 'prompt' => 'Make a home for a frog']],
]);
$second = $scenarios->createRow($mid, 'scenes', ['shortname' => 'diary', 'width' => 800, 'height' => 500, 'params' => ['building' => ['enabled' => true, 'tools' => ['label'], 'approve' => false, 'share' => 'own']]]);
$third = $scenarios->createRow($mid, 'scenes', ['shortname' => 'plain', 'width' => 800, 'height' => 500]);
$scenarios->publish($mid);
$doc = $scenarios->findPublished($mission['code']);
$pond = (int) $first['id'];
$diary = (int) $second['id'];
same($doc['scenes'][0]['building']['max_pieces'] ?? null, 3, 'the compiled scene says students may build there');
check(! isset($doc['scenes'][0]['params']['building']), 'and the setting is not left in its params');
check(($doc['scenes'][2]['building'] ?? null) === null, 'a scene that does not allow building says nothing about it');
$copy = $scenarios->duplicate($scenarios->bundle($mid), 1);
$copyRows = $scenarios->bundle((int) $copy['id']);
$copyMedia = array_column($copyRows['media'], 'id', 'url');
check((int) $copyMedia['frog.png'] !== (int) $frog['id'], 'a copy has its own media');
same((int) ($copyRows['scenes'][0]['params']['building']['pieces'][0]['media_id'] ?? 0), (int) $copyMedia['frog.png'], 'and offers its own copy of each piece');

$a = $classes->assign(1, $mid, [11, 12]);
$group = 'a'.$a['id'];
$code = $mission['code'];

// ------------------------------------------------------------------ building

$view = $builds->forPlayer($ann, $code, $group);
same([$view['may_build'], $view['builds'], $view['uploads']], [true, [], []], 'a student starts with nothing built');
same($builds->forPlayer(['role' => 'admin'] + $guest, $code, $group)['may_build'], true, 'an admin may build');
refused(fn () => $builds->forPlayer($ann, $code, 'public'), 404, 'a private mission has no public game to build in');
refused(fn () => $builds->forPlayer(['id' => 99, 'name' => 'X', 'role' => 'student'], $code, $group), 404, 'nor can someone outside the class see its builds');
refused(fn () => $builds->save($guest, $code, $group, $pond, []), 403, 'guests cannot build');

$pieces = [
    ['id' => 'f1', 'kind' => 'sticker', 'x' => 100.4, 'y' => 200, 'media_id' => (int) $frog['id'], 'scale' => 1.25, 'angle' => 0],
    ['id' => 'l1', 'kind' => 'label', 'x' => 300, 'y' => 100, 'text' => 'Frog house', 'color' => '#fde047'],
];
$saved = $builds->save($ann, $code, $group, $pond, $pieces);
same($saved['status'], 'pending', 'a new build waits for the teacher');
same($saved['pieces'][0], ['id' => 'f1', 'kind' => 'sticker', 'x' => 100, 'y' => 200, 'scale' => 1.25, 'media_id' => (int) $frog['id']], 'what is kept is tidied');
same(count($builds->forPlayer($ann, $code, $group)['builds']), 1, 'the student sees their own build at once');
same($builds->forPlayer($ben, $code, $group)['builds'], [], 'classmates do not see it before it is approved');

refused(fn () => $builds->save($ann, $code, $group, $pond, [['id' => 'x', 'kind' => 'sticker', 'x' => 1, 'y' => 1, 'media_id' => (int) $bg['id']]]), 422, 'only the pieces the author chose can be placed', "not one of this scene's pieces");
refused(fn () => $builds->save($ann, $code, $group, $pond, [['id' => 'x', 'kind' => 'label', 'x' => 5000, 'y' => 1, 'text' => 'hi']]), 422, 'nothing goes outside the scene', 'outside the scene');
refused(fn () => $builds->save($ann, $code, $group, $pond, array_fill(0, 4, ['id' => 'x', 'kind' => 'label', 'x' => 1, 'y' => 1, 'text' => 'hi'])), 422, 'no more than the scene allows', 'up to 3');
refused(fn () => $builds->save($ann, $code, $group, $diary, [['id' => 'x', 'kind' => 'sticker', 'x' => 1, 'y' => 1, 'media_id' => (int) $frog['id']]]), 422, 'only the tools the scene allows', 'not allowed');
refused(fn () => $builds->save($ann, $code, $group, (int) $third['id'], []), 422, 'not in a scene that does not allow building', 'cannot build in this scene');
refused(fn () => $builds->save($ann, $code, $group, $pond, 'lots'), 422, 'a build is a list');

// ------------------------------------------------------------------ reviewing

$queue = $builds->queue($tan);
same(count($queue), 1, 'the teacher has one build to look at');
same([$queue[0]['student']['name'], $queue[0]['where'], $queue[0]['scenario']['title']], ['Brave Otter', 'Your class', 'Pond Life'], 'who made it, and where');
same([$queue[0]['preview']['width'], $queue[0]['preview']['height'], $queue[0]['preview']['background_url'], $queue[0]['preview']['scene']], [1920, 1080, 'pond.png', 'scene-1'], 'with what is needed to see it in its scene');
same($queue[0]['preview']['media'][(string) $frog['id']]['url'] ?? null, 'frog.png', 'and its pieces\' pictures');
same($builds->queue($ito), [], 'another teacher does not review it');
refused(fn () => $builds->queue($ann), 403, 'students have no queue');
refused(fn () => $builds->review($ito, $saved['id'], 'approved'), 404, 'another teacher cannot approve it');
refused(fn () => $builds->review($tan, $saved['id'], 'gone'), 422, 'a review is approved, hidden or pending');
same(count($builds->queue($root)), 1, 'an admin sees every build');

same($builds->review($tan, $saved['id'], 'approved')['status'], 'approved', 'the teacher approves it');
same($builds->queue($tan), [], 'and nothing waits any more');
same(count($builds->queue($tan, 'approved')), 1, 'it is listed with the approved ones');
$seen = $builds->forPlayer($ben, $code, $group)['builds'];
same([count($seen), $seen[0]['mine'] ?? null, $seen[0]['author'] ?? null], [1, false, 'Brave Otter'], 'classmates see it now, under its maker\'s name');
same($builds->save($ann, $code, $group, $pond, $saved['pieces'])['status'], 'approved', 'saving it unchanged keeps it approved');
$changed = $builds->save($ann, $code, $group, $pond, [...$saved['pieces'], ['id' => 'l2', 'kind' => 'label', 'x' => 5, 'y' => 5, 'text' => 'Lily pads']]);
same($changed['status'], 'pending', 'a change waits for the teacher again');
same($builds->forPlayer($ben, $code, $group)['builds'], [], 'and is hidden from classmates meanwhile');
$builds->review($tan, $changed['id'], 'hidden');
same($builds->forPlayer($ben, $code, $group)['builds'], [], 'a hidden build is not shown');
same($builds->forPlayer($ann, $code, $group)['builds'][0]['status'], 'hidden', 'its maker sees that it was hidden');

// A scene whose builds are each student's own, and need no approval.
$diaryBuild = $builds->save($ann, $code, $group, $diary, [['id' => 'd1', 'kind' => 'label', 'x' => 10, 'y' => 10, 'text' => 'Day one']]);
same($diaryBuild['status'], 'approved', 'a scene can say builds need no approval');
same(array_column($builds->forPlayer($ben, $code, $group)['builds'], 'scene_id'), [], 'and that each student\'s build is their own');
same($builds->save($ann, $code, $group, $diary, []), null, 'an empty build removes it');
same(count($builds->forPlayer($ann, $code, $group)['builds']), 1, 'leaving the other');

// ------------------------------------------------------------------ uploads

$png = tempnam(sys_get_temp_dir(), 'qbl');
$img = imagecreatetruecolor(2400, 1200);
imagefill($img, 0, 0, imagecolorallocate($img, 40, 160, 90));
imagepng($img, $png);
imagedestroy($img);
$up = $builds->upload($ann, $code, $group, $png);
same([$up['width'], $up['height']], [1600, 800], 'an upload is made no larger than 1600 pixels');
check((bool) preg_match('#^/api/builds/files/[a-f0-9]{24}$#', $up['url']), 'and is served by an unguessable key');
$file = $builds->file(substr($up['url'], -24));
check($file !== null && in_array($file[1], ['image/webp', 'image/png'], true) && @getimagesizefromstring($file[0])[0] === 1600, 'the stored picture is the re-encoded one');
same($builds->file('nope'), null, 'a bad key finds nothing');
same(count($builds->forPlayer($ann, $code, $group)['uploads']), 1, 'the student sees their upload');
same($builds->forPlayer($ben, $code, $group)['uploads'], [], 'others do not');
$bad = tempnam(sys_get_temp_dir(), 'qbl');
file_put_contents($bad, '<?php echo 1;');
refused(fn () => $builds->upload($ann, $code, $group, $bad), 422, 'only pictures can be uploaded', 'PNG, JPEG');
refused(fn () => $builds->upload($guest, $code, $group, $png), 403, 'guests cannot upload');

$withPicture = $builds->save($ann, $code, $group, $pond, [['id' => 'p1', 'kind' => 'picture', 'x' => 500, 'y' => 300, 'upload_id' => $up['id'], 'scale' => 0.25]]);
refused(fn () => $builds->save($ben, $code, $group, $pond, [['id' => 'p1', 'kind' => 'picture', 'x' => 500, 'y' => 300, 'upload_id' => $up['id']]]), 422, 'a student can hang only their own pictures', 'not one of your pictures');
$builds->review($tan, $withPicture['id'], 'approved');
$benView = $builds->forPlayer($ben, $code, $group);
same($benView['pictures'][(string) $up['id']]['url'] ?? null, $up['url'], 'classmates are given the pictures approved builds show');
same(count($builds->queue($tan, 'all')[0]['preview']['pictures']), 1, 'and so is the teacher');
refused(fn () => $builds->removeUpload($ben, $up['id']), 404, 'only its owner removes a picture');
$builds->removeUpload($ann, $up['id']);
same($builds->forPlayer($ann, $code, $group)['builds'], [], 'removing a picture takes it out of the builds that showed it');

// ------------------------------------------------------------------ the API

$api = new BuildApi($builds);
same($api->handle('GET', $code, [], null)[0], 401, 'the API needs a signed-in player');
same($api->handle('GET', $code, [], $ann, ['group' => $group])[0], 200, 'GET {scenario}?group=');
[$status, $answer] = $api->handle('PUT', "$code/scenes/$pond", ['pieces' => $pieces], $ann, ['group' => $group]);
same([$status, $answer['build']['status'] ?? null], [200, 'pending'], 'PUT {scenario}/scenes/{id}');
same($api->handle('POST', "$code/uploads", [], $ann, ['group' => $group], [])[0], 422, 'POST uploads needs a file');
same($api->handle('POST', "$code/uploads", [], $ann, ['group' => $group], ['file' => ['tmp_name' => $png]])[0], 201, 'POST {scenario}/uploads');
same(count($api->handle('GET', 'teach', [], $tan)[1]['builds']), 1, 'GET teach');
same($api->handle('PUT', 'teach/'.$answer['build']['id'], ['status' => 'approved'], $tan)[1]['build']['status'] ?? null, 'approved', 'PUT teach/{id}');
same($api->handle('GET', 'teach/x/y', [], $tan)[0], 404, 'an unknown teacher route');
same($api->handle('GET', 'files', [], $tan)[0], 404, 'files are not served here');

// ------------------------------------------------------------------ starting again

$classes->resetProgress(1, (int) $a['id'], 11);
$after = $builds->forPlayer($ann, $code, $group);
same([$after['builds'], $after['uploads']], [[], []], "starting a student's game again removes what they built and uploaded there");
same((int) $pdo->query('SELECT COUNT(*) FROM build_uploads')->fetchColumn(), 0, 'the pictures themselves are gone');
$builds->save($ben, $code, $group, $pond, [['id' => 'b1', 'kind' => 'label', 'x' => 1, 'y' => 1, 'text' => 'Mine']]);
$classes->resetProgress(1, (int) $a['id'], 11);
same(count($builds->forPlayer($ben, $code, $group)['builds']), 1, 'and leaves classmates\' builds alone');
$api->handle('DELETE', 'teach/'.$builds->forPlayer($ben, $code, $group)['builds'][0]['id'], [], $tan);
same($builds->forPlayer($ben, $code, $group)['builds'], [], 'a teacher can delete a build');

echo "$checks checks, $failures failures\n";
exit($failures ? 1 : 0);
