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

// ------------------------------------------------------------------ cut-outs: openings, thin parts, scenery lines, edges
// How a thing is seen through: what the surveyor said, else its name, else its kind.
same([ObjectCutter::openingsFor('furniture', 'wooden crate'), ObjectCutter::openingsFor('other', 'park bench'), ObjectCutter::openingsFor('structure', 'iron railing'), ObjectCutter::openingsFor('railing'), ObjectCutter::openingsFor('tree', 'old oak'), ObjectCutter::openingsFor('rock', 'boulder', 'lattice'), ObjectCutter::openingsFor('other')],
    ['none', 'under', 'lattice', 'lattice', 'leafy', 'lattice', 'under'], 'a crate is solid, a bench open beneath, a railing mostly gaps, a tree leafy; the surveyor\'s word goes first');
// A room in the house style, softened as a painter's edges are: a wall whose base line runs right across
// behind everything at y 500, a wooden floor, a window.
$room = imagecreatetruecolor(1600, 900);
$rc = fn (int $r, int $g, int $b) => imagecolorallocate($room, $r, $g, $b);
$rink = $rc(40, 30, 45);
$wallColour = $rc(196, 170, 140);
$shade = $rc(98, 78, 55);                                                   // the floor's colour, in shadow
imagefilledrectangle($room, 0, 0, 1599, 499, $wallColour);
imagefilledrectangle($room, 0, 500, 1599, 899, $rc(150, 120, 85));
imagesetthickness($room, 3);
imageline($room, 0, 500, 1599, 500, $rink);
// A crate: three planks, the middle one the wall's very colour; a gap in its outline on the left.
imagefilledellipse($room, 240, 562, 230, 34, $shade);
imagefilledrectangle($room, 150, 380, 330, 560, $rc(170, 120, 60));
imagefilledrectangle($room, 152, 440, 328, 500, $wallColour);
imagerectangle($room, 150, 380, 330, 560, $rink);
imageline($room, 150, 440, 330, 440, $rink);
imageline($room, 150, 500, 330, 500, $rink);
imagesetthickness($room, 1);
imagefilledrectangle($room, 150, 470, 153, 472, $wallColour);
// A table: a top, four legs drawn as nothing but ink (the wall's base line crosses them), its shadow beneath.
imagefilledellipse($room, 600, 640, 320, 40, $shade);
imagefilledrectangle($room, 450, 420, 750, 450, $rc(120, 80, 50));
imagesetthickness($room, 3);
imagerectangle($room, 450, 420, 750, 450, $rink);
imagesetthickness($room, 4);
foreach ([[472, 640], [728, 640], [520, 610], [680, 610]] as [$lx, $ly]) {
    imageline($room, $lx, 450, $lx, $ly, $rink);
}
// A railing running across the floor from the front (x 900, y 860) towards the back (x 1396, y 564).
imagesetthickness($room, 6);
for ($k = 0; $k <= 8; $k++) {
    imageline($room, 900 + $k * 62, 860 - $k * 37, 900 + $k * 62, 710 - $k * 31, $rink);
}
imageline($room, 900, 710, 1396, 512, $rink);
imageline($room, 900, 790, 1396, 556, $rink);
// A tree with a gap in its canopy showing the wall.
imagesetthickness($room, 3);
imagefilledrectangle($room, 1508, 330, 1532, 600, $rc(110, 70, 40));
imagerectangle($room, 1508, 330, 1532, 600, $rink);
imagefilledellipse($room, 1520, 240, 150, 240, $rc(60, 140, 70));
imageellipse($room, 1520, 240, 150, 240, $rink);
imagefilledellipse($room, 1500, 220, 40, 50, $wallColour);
imageellipse($room, 1500, 220, 40, 50, $rink);
imagesetthickness($room, 1);
imagefilter($room, IMG_FILTER_SMOOTH, 6);
$alphaAt = function (array $cut, int $x, int $y): int {
    $x -= $cut['x'];
    $y -= $cut['y'];
    if ($x < 0 || $y < 0 || $x >= $cut['width'] || $y >= $cut['height']) {
        return 0;
    }

    return 127 - ((imagecolorat($cut['image'], $x, $y) >> 24) & 0x7F);
};
$crate = ObjectCutter::cut($room, [148, 378, 332, 565], [[148, 378], [332, 378], [332, 562], [148, 562]], 'none');
same([$alphaAt($crate, 240, 470), $alphaAt($crate, 151, 471), $alphaAt($crate, 200, 410)], [127, 127, 127], 'a crate is solid all through: a plank the wall\'s colour, and where its outline has a gap');
same([$alphaAt($crate, 340, 563), $crate['opened']], [0, 0], 'and its shadow on the floor is left on the floor');
$tableOutline = [[448, 418], [752, 418], [752, 450], [735, 642], [465, 642], [455, 450]];
$table = ObjectCutter::cut($room, [445, 415, 755, 645], $tableOutline, 'under');
same([$alphaAt($table, 600, 435), $alphaAt($table, 472, 600), $alphaAt($table, 728, 600), $alphaAt($table, 520, 590), $alphaAt($table, 680, 590)], [127, 127, 127, 127, 127], 'a table keeps its top and all four legs, though they are only lines and the wall\'s base crosses them');
same([$alphaAt($table, 472, 500), $alphaAt($table, 520, 500)], [127, 127], 'where the wall\'s base crosses a leg, the leg goes on');
same([$alphaAt($table, 600, 550), $alphaAt($table, 600, 475), $alphaAt($table, 600, 500), $alphaAt($table, 600, 636)], [0, 0, 0, 0], 'the floor and the wall between its legs, the wall\'s base passing behind, and its shadow stay in the background');
check($table['y'] + $table['height'] >= 640 && $table['open'] > 0.2, 'all of it, down to its front feet: '.json_encode([$table['y'], $table['height'], $table['open']]));
$tight = ObjectCutter::cut($room, [445, 415, 755, 560], [], 'under');
check($tight['y'] + $tight['height'] >= 640 && $alphaAt($tight, 472, 630) === 127, 'a box that stops short of the feet is looked past: the legs are cut out whole ('.($tight['y'] + $tight['height']).')');
$tableLine = SortLine::forCutout($table['image'], 1.0, 'under');
check(count($tableLine) === 2 && min(array_column($tableLine, 1)) >= 0.97, 'its sort line runs from foot to foot, not along the underside of its top over the gaps: '.json_encode($tableLine));
$railing = ObjectCutter::cut($room, [895, 360, 1405, 865], [[895, 860], [895, 705], [1400, 505], [1400, 565], [905, 865]], 'lattice');
same([$alphaAt($railing, 1000, 700), $alphaAt($railing, 1150, 560), $alphaAt($railing, 1360, 505)], [0, 0, 0], 'a railing\'s gaps show the floor and the wall behind, and the wall\'s base passing behind it is not taken');
same([$alphaAt($railing, 962, 760), $alphaAt($railing, 900, 850), $alphaAt($railing, 1148, 680), $alphaAt($railing, 1024, 652)], [127, 127, 127, 127], 'its posts and rails are all there');
same($alphaAt($railing, 1396, 475), 127, 'even the top of its last post, beyond the wall\'s base and the outline the surveyor drew');
check($railing['opened'] >= 6, 'every gap between its posts is open: '.$railing['opened']);
$railLine = SortLine::forCutout($railing['image'], 0.1, 'lattice');
check($railLine[0][1] > 0.95 && end($railLine)[1] < 0.3, 'its sort line climbs across the picture with its base: '.json_encode($railLine));
$tree2 = ObjectCutter::cut($room, [1440, 115, 1600, 602], [], 'leafy');
same([$alphaAt($tree2, 1500, 220), $alphaAt($tree2, 1520, 300), $alphaAt($tree2, 1560, 200), $alphaAt($tree2, 1520, 500), $alphaAt($tree2, 1470, 500), $alphaAt($tree2, 1580, 500)], [0, 127, 127, 127, 0, 0], 'a tree: the wall through the gap in its canopy and the wall\'s base beside its trunk stay behind; its leaves and trunk come out');
// Its edge: the same lamp post painted over two different scenes; cut from one and laid over the other, it
// must look like the other (no ring of the first scene's colours around it).
$lampOn = function (array $wall, array $floor, bool $lamp): GdImage {
    $im = imagecreatetruecolor(400, 400);
    imagefilledrectangle($im, 0, 0, 399, 249, imagecolorallocate($im, ...$wall));
    imagefilledrectangle($im, 0, 250, 399, 399, imagecolorallocate($im, ...$floor));
    if ($lamp) {
        imagefilledellipse($im, 200, 120, 90, 90, imagecolorallocate($im, 230, 200, 90));
        imagesetthickness($im, 3);
        imageellipse($im, 200, 120, 90, 90, imagecolorallocate($im, 40, 30, 45));
        imagefilledrectangle($im, 192, 165, 208, 330, imagecolorallocate($im, 90, 90, 100));
        imagerectangle($im, 192, 165, 208, 330, imagecolorallocate($im, 40, 30, 45));
    }
    imagefilter($im, IMG_FILTER_SMOOTH, 6);

    return $im;
};
$lamp = ObjectCutter::cut($lampOn([120, 170, 220], [100, 160, 90], true), [140, 60, 260, 335], [], 'none');
$over = $lampOn([240, 120, 140], [70, 60, 50], false);
$truth = $lampOn([240, 120, 140], [70, 60, 50], true);
imagealphablending($over, true);
imagecopy($over, $lamp['image'], $lamp['x'], $lamp['y'], 0, 0, $lamp['width'], $lamp['height']);
$off = 0;
for ($y = 50; $y < 345; $y++) {
    for ($x = 130; $x < 270; $x++) {
        [$p, $q] = [imagecolorat($over, $x, $y), imagecolorat($truth, $x, $y)];
        $off += max(abs((($p >> 16) & 255) - (($q >> 16) & 255)), abs((($p >> 8) & 255) - (($q >> 8) & 255)), abs(($p & 255) - ($q & 255))) > 40 ? 1 : 0;
    }
}
check($off <= 10, "a cut-out's edge carries none of the scene it was cut from: laid over another, $off pixels are off");

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
same([$tree['openings'], $model->asked[0]['schema']['properties']['standing']['items']['properties']['openings']['enum']], ['leafy', ObjectCutter::OPENINGS], 'the surveyor says how each thing is seen through (a tree it does not say about is leafy)');
check(in_array('railing', SceneSurveyor::KINDS, true), 'railings running across the floor are among the things to walk around');
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
// A railing running across the floor is blocked all along its base, not just at its front foot.
file_put_contents("$work/assets/railing.png", ImageTools::png($railing['image']));
$fenced = (new class extends MissionBuilder
{
    public function blockedFor(array $assets): array
    {
        $this->rows = ['media' => [], 'items' => []];
        [$this->width, $this->ground, $this->shot] = [1600, 500, 1];
        $this->blocked = [];
        $this->surveyed('room', $assets, 500, 900);

        return $this->blocked;
    }
})->blockedFor(['survey:room' => ['floor' => [[0, 506], [1600, 506]], 'standing' => [['name' => 'iron railing', 'kind' => 'railing']]], 'cutout:room:0' => [
    'path' => "$work/assets/railing.png", 'x' => $railing['x'], 'y' => $railing['y'], 'width' => $railing['width'], 'height' => $railing['height'],
    'footprint' => $railing['footprint'], 'sort_line' => $railLine, 'openings' => 'lattice',
]]);
$inPatch = fn (int $x, int $y) => (bool) array_filter($fenced, fn ($r) => $x >= $r[0] && $x <= $r[1] && $y >= $r[2] && $y <= $r[3]);
check(count($fenced) >= 8 && $inPatch(902, 856) && $inPatch(1150, 710) && $inPatch(1390, 565), 'a railing across the floor is blocked along the whole of its base: '.count($fenced).' patches');
check(! $inPatch(1150, 800) && ! $inPatch(1150, 620), 'and only there: the floor either side of it is open');
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
