<?php

/**
 * Tests for how generated scenes are laid out and told, with no network:
 *
 *   php apps/api/tests/scenes.php            (npm run test:scenes)
 *
 *   - the survey of a finished background: the floor traced right up to a building's base, a tree
 *     lifted out of the picture pixel for pixel with its sort line (the same line the editor finds),
 *     painted things found, a wall light's glow put on its brightest part;
 *   - the builder using it: the walkable polygon, the cut-out placed exactly over itself at its own
 *     size, its base blocked, placements kept in front of the floor's edge, critters climbing its trees;
 *   - things on walls painted in (no picture of their own), doors and ladders too;
 *   - cutscenes: a mission's panels (the place's own picture again, a close-up continuing it with an
 *     insert), played after an interaction and back again; a story's continuing panel, close shot,
 *     show and camera beats; the 20-second rule; and the game's validator over both.
 */

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\AssetDirector;
use App\Qbl\Generation\Art\FloorTracer;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\LibraryCritters;
use App\Qbl\Generation\Art\ObjectCutter;
use App\Qbl\Generation\Art\Providers\PlaceholderImageGenerator;
use App\Qbl\Generation\Art\SceneSurveyor;
use App\Qbl\Generation\Art\SortLine;
use App\Qbl\Generation\Build\MissionBuilder;
use App\Qbl\Generation\Build\StoryBuilder;
use App\Qbl\Generation\Design\BlueprintValidator;
use App\Qbl\Generation\Design\Cutscenes;
use App\Qbl\Generation\Design\MissionDesigner;
use App\Qbl\Generation\Design\StoryValidator;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\Generation\Pipeline\Steps\SurveyStep;
use App\Qbl\Generation\ScenarioGenerator;
use App\Qbl\ScenarioCompiler;

set_error_handler(function (int $no, string $message, string $file, int $line) {
    if (! (error_reporting() & $no)) {
        return false;
    }
    throw new ErrorException($message, 0, $no, $file, $line);
});
spl_autoload_register(function (string $class) {
    if (str_starts_with($class, 'App\\') && is_file($file = __DIR__.'/../app/'.str_replace('\\', '/', substr($class, 4)).'.php')) {
        require $file;
    }
});

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
$work = sys_get_temp_dir().'/qbl-scenes-'.getmypid();
@mkdir("$work/assets", 0775, true);

// ------------------------------------------------------------------ the sort line, as the editor finds it
// The same picture as packages/shared's findSortLine was given (a counter running into the room, a tray
// sticking out on its left): the TypeScript answered [[0.063,0.617],[0.598,0.933],[0.998,0.867]].
$counter = ImageTools::blank(200, 120);
$solid = imagecolorallocatealpha($counter, 120, 80, 40, 0);
for ($x = 0; $x < 200; $x++) {
    $top = $x < 12 ? 40 : 10;
    $bottom = $x < 12 ? 45 : ($x < 120 ? (int) round(70 + $x * 0.35) : (int) round(112 - ($x - 120) * 0.1));
    for ($y = $top; $y < $bottom; $y++) {
        imagesetpixel($counter, $x, $y, $solid);
    }
}
same(SortLine::find($counter), [[0.063, 0.617], [0.598, 0.933], [0.998, 0.867]], 'a cut-out\'s sort line is the one the editor\'s "Find it from the picture" finds');

// ------------------------------------------------------------------ a background to survey
// 2250 × 1200, in the house style's way: flat fills with dark outlines. A building on the left whose
// base comes forward to y 760; a back wall elsewhere meeting the floor at 820; a tree standing out on
// the floor at x 1500 (trunk 1480-1520 down to 980, round canopy); a lantern on the wall at x 2000.
$bgIm = imagecreatetruecolor(2250, 1200);
$c = fn (int $r, int $g, int $b) => imagecolorallocate($bgIm, $r, $g, $b);
$ink = $c(40, 30, 50);
imagefilledrectangle($bgIm, 0, 0, 2249, 819, $c(200, 186, 160));       // back wall
imagefilledrectangle($bgIm, 0, 820, 2249, 1199, $c(120, 170, 90));     // floor
imageline($bgIm, 0, 820, 2249, 820, $ink);
imagefilledrectangle($bgIm, 0, 300, 800, 760, $c(170, 90, 70));        // building jutting forward
imagerectangle($bgIm, 0, 300, 800, 760, $ink);
imagefilledrectangle($bgIm, 0, 761, 800, 819, $c(120, 170, 90));       // floor in front of it
imagesetthickness($bgIm, 3);
imagerectangle($bgIm, 1480, 700, 1520, 980, $ink);
imagefilledrectangle($bgIm, 1482, 702, 1518, 978, $c(110, 70, 40));    // trunk
imagefilledellipse($bgIm, 1500, 600, 300, 260, $c(60, 140, 70));      // canopy
imageellipse($bgIm, 1500, 600, 300, 260, $ink);
imagefilledrectangle($bgIm, 1990, 500, 2010, 540, $c(255, 220, 120));  // the lantern, lit
imagerectangle($bgIm, 1988, 498, 2012, 542, $ink);
imagesetthickness($bgIm, 1);
file_put_contents("$work/bg.png", ImageTools::png($bgIm));

// The floor: given roughly, moved onto the painted lines.
$edge = FloorTracer::snap($bgIm, [[0, 744], [790, 776], [810, 836], [2250, 806]]);
$at = fn (int $x) => SortLine::yAt($edge, $x);
check(abs($at(400) - (760 + FloorTracer::MARGIN)) <= 4, 'the floor\'s edge runs along the base of the building: '.json_encode($edge));
check(abs($at(1800) - (820 + FloorTracer::MARGIN)) <= 4, 'and along the base of the back wall elsewhere');
$poly = FloorTracer::polygon($edge, 0, 2250, 1200);
same([end($poly)['y'], $poly[count($poly) - 2]['x']], [1200, 2250], 'the walkable area runs from that edge down to the bottom');
same(FloorTracer::lineNear($bgIm, 1200, 1000, 30), null, 'open floor with nothing painted on it leaves a point where it was');

// The tree, lifted out pixel for pixel.
$cut = ObjectCutter::cut($bgIm, [1360, 480, 1640, 975]);
check($cut !== null && $cut['how'] === 'outline', 'a tree is lifted out of the picture by its outline');
[$tx, $ty] = [$cut['x'], $cut['y']];
check($tx <= 1352 && $tx >= 1340 && $ty <= 472 && $cut['y'] + $cut['height'] >= 980, 'all of it: from its canopy to its trunk\'s base ('.json_encode([$tx, $ty, $cut['width'], $cut['height']]).')');
same($cut['width'] % 2, 0, 'an even number of pixels wide, so it centres on a whole pixel');
same(imagecolorat($cut['image'], 1500 - $tx, 850 - $ty) & 0xFFFFFF, imagecolorat($bgIm, 1500, 850) & 0xFFFFFF, 'its pixels are the background\'s own');
check(((imagecolorat($cut['image'], 1420 - $tx, 900 - $ty) >> 24) & 0x7F) === 127, 'and the floor beside its trunk is see-through');
check($cut['footprint'][0] >= 1470 && $cut['footprint'][1] <= 1530, 'its base is its trunk: '.json_encode($cut['footprint']));
same(SortLine::forCutout($cut['image'], ($cut['footprint'][1] - $cut['footprint'][0] + 1) / $cut['width']), [[0.0, 1.0], [1.0, 1.0]], 'its canopy overhangs its trunk: it meets the floor level, at the bottom of its trunk');
same(SortLine::forCutout($counter), SortLine::find($counter), 'a counter running into the room keeps the line found from its pixels');
same(ObjectCutter::cut($bgIm, [2, 2, 6, 6]), null, 'nothing is lifted out of a box too small to hold anything');

// The surveyor, as a language model that can see: answers like one would.
final class ScriptedSurveyor implements LanguageModel
{
    public array $asked = [];

    public function __construct(private array $answer) {}

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $this->asked[] = ['name' => $name, 'content' => $content, 'schema' => $schema];

        return $this->answer;
    }
}
$model = new ScriptedSurveyor([
    'floor' => [[0, 62.5], [35, 64.5], [36, 69], [100, 67]],
    'standing' => [
        ['name' => 'apple tree', 'kind' => 'tree', 'box' => [60.4, 40, 72.9, 81.3], 'base_y' => 81.6],
        ['name' => 'far hill', 'kind' => 'rock', 'box' => [10, 20, 20, 30], 'base_y' => 30],
    ],
    'found' => [['id' => 'light:0', 'box' => [88, 40.5, 90, 46]], ['id' => 'nothing:here', 'box' => [1, 1, 2, 2]]],
]);
$survey = SurveyStep::look(new SceneSurveyor($model), "$work/bg.png", ['key' => 'yard', 'title' => 'The Yard', 'background' => 'a yard', 'ground_line' => 0.68], [['id' => 'light:0', 'what' => 'a lantern on the wall', 'x' => 0.89]], "$work/assets", 'yard');
same($model->asked[0]['name'], 'scene_survey', 'the surveyor is asked to survey the scene');
$sent = array_values(array_filter($model->asked[0]['content'], fn ($p) => is_array($p) && isset($p['image'])))[0]['image'];
same(imagesx(imagecreatefromstring($sent)), 1568, 'and sent the picture at most 1568 pixels across, gridded');
check(str_contains(implode("\n", array_filter($model->asked[0]['content'], 'is_string')), 'light:0: a lantern on the wall (asked for about 89% across)'), 'with what to find in it, and about where');
check(abs(SortLine::yAt($survey['floor'], 400) - 766) <= 4 && abs(SortLine::yAt($survey['floor'], 1800) - 826) <= 4, 'its floor is traced onto the painted lines');
same(array_column($survey['standing'], 'name'), ['apple tree'], 'a thing standing in the scenery behind the floor is not something to walk around');
$tree = $survey['standing'][0];
check(is_file($tree['path'] ?? '') && $tree['sort_line'] !== null && isset($tree['footprint']), 'the tree is cut out, with its sort line and footprint');
same(array_keys($survey['found']), ['light:0'], 'only what was asked for is found');
$glow = $survey['glows']['light:0'];
check(abs($glow[0] - 2000) <= 12 && abs($glow[1] - 520) <= 14, 'a lantern painted on the wall glows from its brightest part: '.json_encode($glow));

// ------------------------------------------------------------------ the fixture mission, with a cutscene
$b = MissionDesigner::tidy(require __DIR__.'/fixtures/generation/blueprint.php');
$b['cutscenes'] = [[
    'key' => 'found', 'when' => 'get_twine',
    'panels' => [
        ['at' => 'greenhouse', 'cast' => [['who' => 'bot', 'x' => 0.4]], 'script' => [
            ['do' => 'narrate', 'text' => 'Pip spots something tangled in the twine.'],
            ['do' => 'camera', 'move' => 'push_in', 'who' => 'bot', 'seconds' => 2],
            ['do' => 'say', 'who' => 'bot', 'text' => 'Beep! A note!'],
        ]],
        ['continues' => true, 'shot' => 'close', 'changes' => 'a crumpled note now lies at Pip\'s feet', 'cast' => [['who' => 'bot', 'x' => 0.4]], 'script' => [
            ['do' => 'show', 'picture' => 'a crumpled note with a drawing of a bee and an arrow', 'text' => 'It was Granny\'s old map to the hive.', 'tone' => 'memory', 'motion' => 'push_in', 'seconds' => 30],
            ['do' => 'say', 'who' => 'bot', 'text' => 'To the hive!'],
        ]],
    ],
]];
$errors = BlueprintValidator::errors($b);
check(! array_filter($errors, fn ($e) => str_contains($e, 'cutscenes')), 'a cutscene of two panels after collecting the twine is valid: '.implode(' | ', array_filter($errors, fn ($e) => str_contains($e, 'cutscenes'))));
$bad = $b;
$bad['cutscenes'][0]['when'] = 'nowhere';
$bad['cutscenes'][0]['panels'][0]['continues'] = true;
$bad['cutscenes'][0]['panels'][1]['script'] = array_fill(0, 8, ['do' => 'narrate', 'text' => str_repeat('A long, slow sentence about the note. ', 3)]);
$bad['cutscenes'][0]['panels'][1]['script'][] = ['do' => 'camera', 'move' => 'push_in', 'who' => 'nobody'];
$errors = implode("\n", BlueprintValidator::errors($bad));
check(str_contains($errors, 'cutscenes[0].when: "intro" or the key of an interaction'), 'a cutscene must play at the start or after an interaction');
check(str_contains($errors, 'the first panel continues nothing'), 'the first panel cannot continue anything');
check(str_contains($errors, 'a close-up plays for about') && str_contains($errors, 'continues it'), 'a close-up that runs long is to be continued in another panel');
check(str_contains($errors, 'push_in needs who to push in on'), 'a push in needs someone to push in on');

$panels = Cutscenes::panels($b);
same(array_column($panels, 'key'), ['cut_found_1', 'cut_found_2'], 'each panel is a scene of its own');
same([Cutscenes::pictureOf($panels[0], ['key' => 'greenhouse']), Cutscenes::pictureOf($panels[1], $panels[0])], ['same', 'closer'], 'the first is the greenhouse\'s own picture, the second a close-up drawn from it');
same(Cutscenes::showTime(['seconds' => 30, 'text' => 'Short.']), Cutscenes::MAX_STILL_MS, 'an insert stays at most 20 seconds, whatever was asked');

$style = ArtStyle::load(__DIR__.'/../resources/art-styles', 'qbl-cartoon');
$placeholder = new PlaceholderImageGenerator($style->chroma(), array_values($style->palette()));
$library = new LibraryCritters(realpath(__DIR__.'/../../../scenarios/assets/library'));
$director = new AssetDirector($placeholder, $style, null, "$work/mission", 1, library: $library);
$estimate = $director->estimate($b);
$assets = $director->drawMission($b, ScenarioGenerator::layouts($b));
check(isset($assets['bg:cut_found_2'], $assets['insert:cut_found_2:0']) && $assets['bg:cut_found_1']['path'] === $assets['bg:greenhouse']['path'], 'the close-up and the insert are drawn; the wide panel is the greenhouse\'s picture again');
check(! isset($assets['passage:landing:greenhouse']), 'the door into the greenhouse is painted into the background, not drawn apart');
$layouts = ScenarioGenerator::layouts($b);
check((bool) array_filter($layouts['landing']['passages'] ?? [], fn ($p) => $p['via'] === 'door' && $p['look']), 'the background is told what door to paint');

// The landing as surveyed: the floor edge rises toward a building on the left, a tree stands out on it.
$assets['survey:landing'] = ['floor' => [[0, 760], [800, 760], [820, 826], [2250, 826]], 'found' => [], 'glows' => [], 'standing' => [['name' => 'apple tree', 'kind' => 'tree']]];
$assets['cutout:landing:0'] = ['path' => $tree['path'], 'width' => $tree['width'], 'height' => $tree['height'], 'x' => $tree['x'], 'y' => $tree['y'], 'sort_line' => $tree['sort_line'], 'footprint' => $tree['footprint']];
$alignment = [
    'standards' => [['framework' => 'TEST-SCI', 'code' => 'TEST-3-LS1-1', 'description' => 'Plants need pollinators.', 'alignment' => 'primary', 'rationale' => 'Pollination.']],
    'learning_objectives' => [['id' => 'LO1', 'text' => 'Explain pollination.', 'standards' => ['TEST-3-LS1-1']]],
    'vocabulary' => [], 'misconceptions' => [],
];
$built = (new MissionBuilder)->build($b, $alignment, $assets);
$doc = ScenarioCompiler::compile($built['rows']);
$scenes = array_column($doc['scenes'], null, 'shortname');
$landing = $scenes['landing'];
$floor = $landing['walkable_areas'][0];
check(abs(SortLine::yAt(array_map(fn ($p) => [$p['x'], $p['y']], array_slice($floor, 0, -2)), 400) - 760) <= 1, 'the landing\'s walkable area follows the surveyed floor up to the building');
$items = array_column($doc['items'], null, 'id');
$placedTree = array_values(array_filter($landing['items'], fn ($p) => ($items[$p['item_id']]['name'] ?? '') === 'Apple tree'))[0] ?? null;
check($placedTree !== null, 'the tree is an item of the landing');
$treeItem = $items[$placedTree['item_id']];
same([$placedTree['position_x'], $placedTree['position_y']], [$tree['x'] + intdiv($tree['width'], 2), $tree['y'] + $tree['height']], 'placed exactly over itself in the picture');
$area = $landing['scale_areas'][0];
$depth = ($area['scale_top'] + ($area['scale_bottom'] - $area['scale_top']) * (($placedTree['position_y'] - $area['y']) / $area['height'])) / 100;
check(abs($treeItem['scale'] * $depth - 1) < 1e-4, 'drawn at its own size, whatever the depth there');
check($area['y'] <= 766 && $area['scale_top'] < 90, 'the scale area reaches back to the floor traced in front of the building, so nobody there is drawn at full size: '.json_encode($area));
same([$treeItem['placement'] ?? null, $treeItem['sort_line'] ?? null, $treeItem['blocking'] ?? null], ['object', $tree['sort_line'], false], 'sorted among the figures by its sort line, its base blocked instead of a circle');
check((bool) array_filter($landing['blocked_areas'], fn ($a) => min(array_column($a, 'x')) >= $tree['footprint'][0] && max(array_column($a, 'x')) <= $tree['footprint'][1] + 1), 'nobody walks through its trunk');
foreach ([...$landing['characters'], ...$landing['spawn_points']] as $p) {
    check($p['position_y'] >= SortLine::yAt([[0, 760], [800, 760], [820, 826], [2250, 826]], $p['position_x']) + 20, 'everyone stands in front of the floor\'s edge ('.json_encode([$p['position_x'], $p['position_y']]).')');
}
$squirrel = array_column($scenes['orchard']['critters'] ?? [], null, 'name')['squirrel'] ?? null;
same($squirrel['behavior'] ?? null, 'climbs', 'the orchard\'s squirrel is a critter that climbs');
$door = array_values(array_filter($landing['hotspots'], fn ($h) => $h['shortname'] === 'way-greenhouse'))[0];
same(array_column($door['labels'], 'type'), ['text'], 'the door\'s hotspot is invisible but for its name');

// The cutscene.
$cut1 = $scenes['cut_found_1'];
$cut2 = $scenes['cut_found_2'];
same([$cut1['story'] ?? false, $cut1['show_avatars'], $cut2['story'] ?? false], [true, false, true], 'its panels play by themselves, with no avatars');
same(end($cut1['background_media'])['media_id'], end($scenes['greenhouse']['background_media'])['media_id'], 'the wide panel shows the greenhouse\'s own picture');
same($cut2['scale_areas'][0]['scale_bottom'], (int) round(108 * Cutscenes::CLOSE), 'in the close-up everyone is twice as big');
$closeCuts = array_values(array_filter($cut2['items'] ?? [], fn ($p) => ($items[$p['item_id']]['params']['cut_from'] ?? null) === 'background'));
// A thing cut out of a close shot's picture (the scale area twice as big there): still drawn at its own size.
$closeBuilder = new class extends MissionBuilder
{
    public function cutInCloseUp(array $assets): array
    {
        $this->rows = ['media' => [], 'items' => []];
        [$this->width, $this->ground, $this->shot] = [2250, 816, Cutscenes::CLOSE];
        $placed = $this->surveyed('close', $assets, 816, 1200);

        return [$placed[0], $this->rows['items'][0], $this->scaleArea()];
    }
};
[$cp, $ci, $ca] = $closeBuilder->cutInCloseUp(['survey:close' => ['floor' => [[0, 800], [2250, 800]], 'standing' => [['name' => 'tree', 'kind' => 'tree']]], 'cutout:close:0' => ['path' => "$work/bg.png", 'x' => 1000, 'y' => 500, 'width' => 200, 'height' => 500, 'footprint' => [1080, 1120]]]);
$cd = ($ca['scale_top'] + ($ca['scale_bottom'] - $ca['scale_top']) * (($cp['position_y'] - $ca['y']) / $ca['height'])) / 100;
check($cd > 1.5 && abs($ci['settings']['scale'] * $cd - 1) < 1e-4, 'a thing cut out of a close-up is drawn at its own size, not twice it (depth '.round($cd, 3).', scale '.$ci['settings']['scale'].')');
foreach ($closeCuts as $p) {
    $a = $cut2['scale_areas'][0];
    $d = ($a['scale_top'] + ($a['scale_bottom'] - $a['scale_top']) * (($p['position_y'] - $a['y']) / $a['height'])) / 100;
    check(abs($items[$p['item_id']]['scale'] * $d - 1) < 1e-4, 'and a thing cut out of the close-up is still drawn at its own size, not twice it');
}
$play = fn (array $scene) => array_values(array_filter($scene['start_events'], fn ($e) => $e['shortname'] === 'story'))[0]['actions'];
$a1 = $play($cut1);
$a2 = $play($cut2);
$push = array_values(array_filter($a1, fn ($a) => $a['type'] === 'camera'))[0] ?? null;
same([$push['target'] ?? null, $push['zoom'] ?? null], ['character', 1.6], 'the camera pushes in on Pip');
same(end($a1)['scene_id'], $cut2['id'], 'the first panel moves on to the next');
$insert = array_values(array_filter($a2, fn ($a) => $a['type'] === 'image_overlay'))[0] ?? null;
same([$insert['panel'] ?? null, $insert['duration'] ?? null, $insert['tone'] ?? null, $insert['motion'] ?? null], [true, Cutscenes::MAX_STILL_MS, 'memory', 'push_in'], 'the note is shown full-screen as a memory, for no more than 20 seconds');
same([end($a2)['type'], end($a2)['scene_id'], end($a2)['spawn_point'] ?? null], ['jump', $scenes['greenhouse']['id'], 'after-found'], 'the last panel brings the student back to the greenhouse');
check(in_array('after-found', array_column($scenes['greenhouse']['spawn_points'], 'name'), true), 'beside the twine');
$twine = array_values(array_filter($scenes['greenhouse']['hotspots'], fn ($h) => $h['shortname'] === 'get_twine'))[0];
same(array_slice(array_column($twine['actions'], 'type'), -2), ['variable', 'jump'], 'collecting the twine ends by going to the cutscene');
same(end($twine['actions'])['scene_id'], $cut1['id'], 'its first panel');
check(str_contains(json_encode(end($twine['actions'])['conditions'] ?? []), 'seen_cut_found'), 'once');

// ------------------------------------------------------------------ a story told in panels
$story = MissionDesigner::tidyStory(require __DIR__.'/fixtures/generation/story.php');
$story['scenes'][] = ['key' => 'pond_later', 'title' => 'The Pond', 'continues' => 'pond', 'changes' => 'the sun is low and the pond has shrunk', 'background' => $story['scenes'][0]['background'], 'ground_line' => $story['scenes'][0]['ground_line'], 'kind' => 'outdoor',
    'cast' => [['who' => 'fen', 'x' => $story['scenes'][0]['cast'][1]['x'] ?? 0.7]], 'script' => [
        ['do' => 'camera', 'move' => 'push_in', 'who' => 'fen'],
        ['do' => 'narrate', 'text' => 'Fen sat by the shrinking pond, and waited, and waited, and waited for a very long time.'],
        ['do' => 'narrate', 'text' => 'Days went by. The frogs sang. The sun rose and set, rose and set, over the quiet water.'],
        ['do' => 'narrate', 'text' => 'Still Drip did not come back. Fen began to wonder whether drops ever came home at all.'],
        ['do' => 'show', 'picture' => 'Drip and Fen laughing on a lily pad last summer', 'text' => 'Fen remembered last summer.', 'tone' => 'memory'],
        ['do' => 'camera', 'move' => 'pull_back'],
    ]];
$story['scenes'][] = ['key' => 'face', 'title' => 'Fen', 'shot' => 'close', 'continues' => 'pond_later', 'background' => 'x', 'ground_line' => 0.7, 'cast' => [['who' => 'fen', 'x' => 0.5]], 'script' => [['do' => 'wait', 'seconds' => 1], ['do' => 'say', 'who' => 'fen', 'text' => 'Come home, Drip.'], ['do' => 'gesture', 'who' => 'fen', 'gesture' => 'think']]];
$errors = StoryValidator::errors($story);
check(! array_filter($errors, fn ($e) => str_contains($e, 'pond_later') || str_contains($e, 'scenes.face')), 'panels that continue the pond, the second a close-up, are a valid story: '.implode(' | ', $errors));
$badStory = $story;
$badStory['scenes'][3]['continues'] = 'face';
$badStory['scenes'][3]['script'][4]['picture'] = '';
$errors = implode("\n", StoryValidator::errors($badStory));
check(str_contains($errors, 'is not an earlier scene'), 'a panel continues only an earlier scene');
check(str_contains($errors, 'say what the picture shows'), 'an insert needs a picture');
$storyDirector = new AssetDirector($placeholder, $style, null, "$work/story", 1);
$storyArt = \App\Qbl\Generation\Design\StoryPlan::forArt($story);
$storyAssets = $storyDirector->drawMission($storyArt, []);
check(isset($storyAssets['bg:pond_later'], $storyAssets['bg:face'], $storyAssets['insert:pond_later:4']) && $storyAssets['bg:pond_later']['path'] !== $storyAssets['bg:pond']['path'], 'the later pond is redrawn from the first, with its changes; the close-up and the memory drawn');
same($storyDirector->estimate($storyArt)['by_kind']['background'], 3 + 2 + 1, 'and the estimate counts them');
$storyDoc = ScenarioCompiler::compile((new StoryBuilder)->build($story, $alignment, $storyAssets)['rows']);
$storyScenes = array_column($storyDoc['scenes'], null, 'shortname');
$later = $play($storyScenes['pond_later']);
$drifts = array_values(array_filter($later, fn ($a) => $a['type'] === 'camera' && ($a['target'] ?? '') === 'auto' && ($a['blocking'] ?? true) === false));
check(count($drifts) >= 1, 'with nothing moving through three long captions, the camera drifts, so the picture is never still for 20 seconds');
$pondFen = array_values(array_filter($storyScenes['pond']['characters'], fn ($c) => $c['character_id'] === $storyScenes['pond_later']['characters'][0]['character_id']))[0] ?? null;
check($pondFen === null || $pondFen['position_x'] === $storyScenes['pond_later']['characters'][0]['position_x'], 'Fen stands where she stood in the panel before');
same($storyScenes['face']['scale_areas'][0]['scale_bottom'], (int) round(108 * Cutscenes::CLOSE), 'the close-up draws her twice as big');

// ------------------------------------------------------------------ the game's own validator
$tsx = realpath(__DIR__.'/../../../node_modules/.bin/tsx');
if ($tsx) {
    foreach (['mission' => $doc, 'story' => $storyDoc] as $name => $d) {
        file_put_contents("$work/$name.json", json_encode($d));
        $out = [];
        exec(escapeshellarg($tsx).' '.escapeshellarg(__DIR__.'/../../../tools/validate-scenario.ts').' '.escapeshellarg("$work/$name.json").' 2>&1', $out, $code);
        check($code === 0 && ! preg_grep('/ERROR/', $out), "the game's validator accepts the $name: ".implode(' | ', preg_grep('/ERROR/', $out) ?: []));
    }
} else {
    fwrite(STDOUT, "(skipped the game's validator: run npm install to include it)\n");
}

if (! getenv('KEEP')) {
    exec('rm -rf '.escapeshellarg($work));
}
if ($failures) {
    fwrite(STDERR, "\n$failures of $checks checks failed\n");
    exit(1);
}
echo "All $checks checks passed\n";
