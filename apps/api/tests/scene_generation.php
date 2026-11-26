<?php

/**
 * Tests for generating ONE scene for a scenario being made (the editor's "Generate a scene"), with no
 * network:
 *
 *   php apps/api/tests/scene_generation.php            (npm run test:scene-generation)
 *
 *   - the plan (SceneDesigner): tidied whatever the model wrote, cut to the teacher's options;
 *   - the whole run (method "scene"): designed, painted to match the scenario's own scenes, surveyed,
 *     built and added to the scenario beside what was there;
 *   - the scene as built: the walkable area traced to the painted floor, the tree and the well cut out
 *     and placed exactly over themselves with their sort lines and their bases blocked, the scale area,
 *     the things to click and what the narrator says (stepping through to the last, or going round),
 *     the counters, the lamp's glow, the critters;
 *   - ScenarioStore::mergeRows: ids followed, a variable already there kept, a failed merge leaves the
 *     scenario's own files alone;
 *   - the game's validator over the scenario as published.
 */

use App\Qbl\Generation\Art\ArtStyle;
use App\Qbl\Generation\Art\BackgroundCleaner;
use App\Qbl\Generation\Art\ImageGenerator;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Art\Providers\PlaceholderImageGenerator;
use App\Qbl\Generation\Build\SceneBuilder;
use App\Qbl\Generation\Design\SceneDesigner;
use App\Qbl\Generation\GenerationEvents;
use App\Qbl\Generation\GenerationFactory;
use App\Qbl\Generation\GenerationRuns;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Generation\Http\HttpResponse;
use App\Qbl\Generation\Llm\LanguageModel;
use App\Qbl\Generation\Pipeline\Steps\SceneDesignStep;
use App\Qbl\Generation\Curriculum\StandardsStore;
use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;

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

final class NoNetwork implements HttpClient
{
    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        throw new RuntimeException("The tests must not reach the network ($url).");
    }
}

$work = sys_get_temp_dir().'/qbl-scene-gen-'.bin2hex(random_bytes(4));
mkdir("$work/media", 0775, true);
$pdo = new PDO('sqlite::memory:');
$store = new ScenarioStore($pdo, "$work/media", '/media');
foreach ([...ScenarioStore::sqliteSchema(), ...StandardsStore::sqliteSchema(), ...GenerationRuns::sqliteSchema(), ...GenerationEvents::sqliteSchema()] as $sql) {
    $pdo->exec($sql);
}
$pdo->exec('CREATE TABLE progress_log (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `run` INTEGER, `status`, `progress`)');
$pdo->exec('CREATE TRIGGER log_progress AFTER UPDATE OF progress ON scenario_generations BEGIN INSERT INTO progress_log (run, status, progress) VALUES (NEW.id, NEW.status, NEW.progress); END');
$style = ArtStyle::load(__DIR__.'/../resources/art-styles', 'qbl-cartoon');
[$kr, $kg, $kb] = $style->chroma();

// ------------------------------------------------------------------ the plan, tidied
$messy = [
    'title' => '  The <b>Old</b> Mill Yard, by the river at the edge of a very long village name  ', 'kind' => 'outdoor', 'background' => 'A cobbled yard before an old stone mill.',
    'ground_line' => 0.99, 'setting' => 'a storybook village',
    'standing' => [
        ['x' => 0.01, 'depth' => 'deep', 'label' => 'Oak', 'look' => 'a big oak tree', 'texts' => ['One.', '', 'Two.', 'Three.', 'Four.', 'Five.'], 'repeat' => 'spin'],
        ['x' => 0.5, 'depth' => 'front', 'label' => 'Well', 'look' => ''],
    ],
    'details' => [['x' => 0.3, 'label' => 'Poster', 'look' => 'a poster', 'texts' => ['A.', 'B.'], 'repeat' => 'cycle'], ['x' => 0.4, 'label' => 'Nothing', 'look' => 'blank', 'texts' => []]],
    'lights' => [['x' => 0.9, 'kind' => 'lamp', 'look' => 'a street lamp', 'where' => 'floor'], ['x' => 0.2, 'kind' => 'laser', 'look' => 'nope', 'where' => 'wall']],
    'sky' => ['time' => 'afternoon', 'until' => 'afternoon', 'clouds' => 'lots'],
    'ambient' => [['key' => 'Bad Key!', 'look' => 'a rabbit', 'motion' => 'hides', 'size_cm' => 9999, 'library' => 'goldfish'], ['key' => 'squirrel', 'look' => 'a squirrel', 'motion' => 'climbs', 'size_cm' => 35, 'library' => 'red-squirrel']],
];
$tidy = SceneDesigner::tidy($messy, ['critters' => true], 'yard');
$scene = $tidy['scenes'][0];
same([$tidy['format'], $tidy['start_scene'], $scene['key'], $tidy['characters'], $tidy['interactions']], ['scene', 'yard', 'yard', [], []], 'a plan is a one-scene blueprint with no characters or interactions');
same(mb_strlen($tidy['title']) <= 40 && ! str_contains($tidy['title'], '<'), true, 'its title is plain and short: '.$tidy['title']);
same($scene['ground_line'], 0.8, 'the ground line is kept in range');
same([count($scene['standing']), $scene['standing'][0]['x'], $scene['standing'][0]['depth']], [1, 0.1, 'middle'], 'a standing thing with nothing to paint is dropped; one at the very edge is moved in');
same([$scene['standing'][0]['texts'], $scene['standing'][0]['repeat']], [['One.', 'Two.', 'Three.', 'Four.'], 'last'], 'at most four passages, blanks dropped, an unknown repeat is "last"');
same([count($scene['details']), $scene['details'][0]['repeat'], $scene['details'][0]['text']], [1, 'cycle', 'A.'], 'a detail with nothing to say is dropped; "cycle" is kept; the first passage is its text');
same(array_column($scene['lights'], 'kind'), ['lamp'], 'an unknown kind of light is dropped');
same([$scene['lights'][0]['placement'], $scene['lights'][0]['where']], ['wall', 'floor'], 'every light is painted in (placement wall), standing where it was asked');
same($scene['sky'], ['time' => 'afternoon', 'clouds' => 'few'], 'a sky that "changes" to itself does not change');
same(array_column($scene['ambient'], 'motion'), ['walks_by', 'climbs'], 'a critter that hides walks by when there are no bushes; a squirrel climbs the oak');
same([$scene['ambient'][0]['key'], $scene['ambient'][0]['size_cm'], $scene['ambient'][0]['library'] ?? null], ['critter_0', 900, null], 'a bad key is replaced, a size clamped, a library animal that does not suit the motion dropped');
$off = SceneDesigner::tidy($messy, ['hotspots' => false, 'animations' => false, 'critters' => false, 'repeat' => 'cycle'], 'yard')['scenes'][0];
same([$off['details'], isset($off['standing'][0]['texts']), isset($off['lights']), isset($off['sky']), isset($off['ambient'])], [[], false, false, false, false], 'with hotspots, life and critters turned off, the plan has none');
same(SceneDesigner::tidy($messy, ['repeat' => 'cycle'], 'yard')['scenes'][0]['standing'][0]['repeat'], 'cycle', 'the teacher\'s repeat wins over the designer\'s');
same(SceneDesigner::tidy($messy, ['place' => 'indoor'], 'yard')['scenes'][0]['kind'], 'indoor', 'and so does the kind of place');
$schema = SceneDesigner::schema(SceneDesigner::defaults([]));
same([isset($schema['properties']['details']), isset($schema['properties']['lights']), isset($schema['properties']['ambient'])], [true, true, false], 'by default the designer is asked for things to click and life, not critters');
same(SceneDesignStep::uniqueKey('Old Mill Yard', ['old_mill_yard', 'Old_Mill_Yard_2']), 'old_mill_yard_3', 'the new scene\'s shortname is one the scenario does not have');
same(SceneDesignStep::uniqueKey('42 Steps', []), 'scene_42_steps', 'and starts with a letter');
same(SceneBuilder::variableBase('forest-path'), 'forest_path', 'variables are named after the scene, in letters, digits and underscores');

// ------------------------------------------------------------------ the scenario it joins
$teacher = 7;
$scenario = $store->createScenario(['title' => 'River Village'], $teacher);
$sid = (int) $scenario['id'];
$first = $store->bundle($sid)['scenes'][0];
$looksPng = "$work/looks.png";
$looks = imagecreatetruecolor(800, 450);
imagefill($looks, 0, 0, imagecolorallocate($looks, 90, 160, 220));
file_put_contents($looksPng, ImageTools::png($looks));
$media = $store->addMediaFile($sid, $looksPng, 'village.png');
$store->updateRow($sid, 'scenes', (int) $first['id'], ['subtitle' => 'Village Green', 'description' => 'Where the story starts.', 'background_media' => [['media_id' => (int) $media['id']]]]);
$store->createRow($sid, 'variables', ['variable_name' => 'old_mill_yard_look_1', 'default_value' => 5]);
$ownFiles = glob("$work/media/$sid/*");

// ------------------------------------------------------------------ the painter and the model
/**
 * Paints the background a scene asks for like the house style would (flat fills, dark outlines): a
 * stone mill along the back meeting the floor at y 790, an oak standing out on the floor (trunk at x
 * 1500, base 1010), a round well (x 640, base 960), a lit lamp on the mill's wall at x 2000, and the
 * sky in the flat chroma colour, to be cut out for the living sky. Anything else is a placeholder.
 */
final class Painter implements ImageGenerator
{
    public array $asked = [];

    public function __construct(private ImageGenerator $placeholder, private array $sky) {}

    public function generate(string $prompt, array $references, string $aspect, bool $transparent, array $hints = []): string
    {
        $this->asked[] = ['kind' => $hints['kind'] ?? null, 'prompt' => $prompt, 'references' => array_map(fn ($r) => $r->role, $references), 'aspect' => $aspect, 'hints' => $hints];
        if (($hints['kind'] ?? null) === 'retouch') {
            // The same picture without the oak and the well, as a painter would answer: the part asked for,
            // a little brighter all over (painters drift), at half size.
            [$x, $y, $w, $h] = $hints['window'];
            $part = ImageTools::crop(ImageTools::load($this->scene(false)), $x, $y, $w, $h);
            imagefilter($part, IMG_FILTER_BRIGHTNESS, 6);

            return ImageTools::png(ImageTools::resize($part, intdiv($w, 2), intdiv($h, 2)));
        }
        if (($hints['kind'] ?? null) !== 'background') {
            return $this->placeholder->generate($prompt, $references, $aspect, $transparent, $hints);
        }

        return $this->scene(true);
    }

    /** The mill yard, with or without the things standing out on its floor. */
    public function scene(bool $things): string
    {
        $im = imagecreatetruecolor(2250, 1200);
        $c = fn (int $r, int $g, int $b) => imagecolorallocate($im, $r, $g, $b);
        $ink = $c(40, 30, 50);
        imagefilledrectangle($im, 0, 0, 2249, 789, $c(...$this->sky));            // sky
        imagefilledrectangle($im, 0, 300, 2249, 789, $c(176, 160, 140));         // the mill's wall along the back
        imagefilledrectangle($im, 0, 790, 2249, 1199, $c(150, 140, 120));        // cobbles
        imagesetthickness($im, 3);
        imageline($im, 0, 790, 2249, 790, $ink);
        imagerectangle($im, 0, 300, 2249, 789, $ink);
        if ($things) {
            imagefilledrectangle($im, 1482, 702, 1518, 1008, $c(110, 70, 40));   // the oak's trunk
            imagerectangle($im, 1480, 700, 1520, 1010, $ink);
            imagefilledellipse($im, 1500, 600, 320, 280, $c(60, 140, 70));       // its canopy
            imageellipse($im, 1500, 600, 320, 280, $ink);
            imagefilledrectangle($im, 572, 842, 708, 958, $c(130, 130, 140));    // the well
            imagerectangle($im, 570, 840, 710, 960, $ink);
        }
        imagefilledrectangle($im, 1990, 480, 2010, 520, $c(255, 226, 130));      // the lamp, lit
        imagerectangle($im, 1988, 478, 2012, 522, $ink);
        imagefilledrectangle($im, 300, 520, 420, 640, $c(230, 210, 170));        // a poster on the wall
        imagerectangle($im, 300, 520, 420, 640, $ink);
        imagesetthickness($im, 1);

        return ImageTools::png($im);
    }

    public function transparency(): bool
    {
        return false;
    }

    public function describe(): string
    {
        return 'painter';
    }
}

/** Answers as a designer and a surveyor would, for the Old Mill Yard. */
final class SceneModel implements LanguageModel
{
    public array $calls = [];

    public function structured(string $system, array $content, string $name, array $schema, int $maxTokens = 16000): array
    {
        $this->calls[] = ['name' => $name, 'system' => $system, 'content' => $content, 'schema' => $schema];

        return match ($name) {
            'scene_design' => [
                'title' => 'Old Mill Yard', 'description' => 'A yard to explore before the mill.', 'kind' => 'outdoor', 'ground_line' => 0.66,
                'setting' => 'a storybook river village', 'time_of_day' => 'golden afternoon light',
                'background' => 'A cobbled yard in front of a long old stone mill with a water wheel, a poster on its wall.',
                'standing' => [
                    ['x' => 0.667, 'depth' => 'middle', 'label' => 'Old oak', 'look' => 'a big old oak tree with a wide canopy', 'texts' => ['A great oak, older than the mill.', 'Up close, someone carved initials in the bark: M.R. 1888.', 'M.R. — the miller, Martha Reed, who built this place.'], 'repeat' => 'last'],
                    ['x' => 0.284, 'depth' => 'middle', 'label' => 'Well', 'look' => 'a round stone well'],
                    ['x' => 0.9, 'depth' => 'front', 'label' => 'Ghost cart', 'look' => 'a cart nobody will paint'],
                ],
                'details' => [
                    ['x' => 0.16, 'label' => 'Faded poster', 'look' => 'a faded fair poster on the wall', 'texts' => ['A poster for the harvest fair.', 'It promises a pie the size of a cartwheel.'], 'repeat' => 'cycle'],
                    ['x' => 0.5, 'label' => 'Wheel', 'look' => 'the water wheel', 'texts' => ['The wheel turns slowly, dripping.']],
                ],
                'lights' => [['x' => 0.889, 'kind' => 'lamp', 'look' => 'a brass lamp on the mill wall', 'where' => 'wall']],
                'sky' => ['time' => 'afternoon', 'until' => 'dusk', 'clouds' => 'few'],
                'atmosphere' => [['kind' => 'leaves', 'amount' => 'few']],
                'ambient' => [
                    ['key' => 'squirrel', 'look' => 'a red squirrel', 'motion' => 'climbs', 'size_cm' => 35, 'library' => 'red-squirrel'],
                    ['key' => 'deer', 'look' => 'a young deer with white spots', 'motion' => 'walks_by', 'size_cm' => 120],
                ],
            ],
            // Asked in percentages of the picture (2250 × 1200), off by a little: the tracer and the cutter find the painted lines.
            'scene_survey' => [
                'floor' => [[0, 66.5], [50, 65.4], [100, 66.2]],
                'standing' => [
                    ['name' => 'oak tree', 'kind' => 'tree', 'box' => [60.1, 40, 73.3, 84.5], 'base_y' => 84.2],
                    ['name' => 'well', 'kind' => 'structure', 'box' => [24.9, 69.5, 31.8, 80.4], 'base_y' => 80],
                ],
                'found' => [
                    ['id' => 'detail:0', 'box' => [13.3, 43.3, 18.7, 53.3]],
                    ['id' => 'light:0', 'box' => [88, 39, 89.8, 44]],
                    ['id' => 'standing:0', 'box' => [60, 39, 73.5, 84.5]],
                ],
            ],
            default => throw new RuntimeException("Not expected: $name"),
        };
    }
}

$config = [
    'llm' => ['api_key' => 'test', 'model' => 'test', 'judge_model' => 'test'],
    'images' => ['driver' => 'placeholder'],
    'style' => 'qbl-cartoon',
    'styles_dir' => __DIR__.'/../resources/art-styles',
    'work_dir' => "$work/generations",
    'judge' => ['enabled' => false, 'max_attempts' => 1],
];
$model = new SceneModel;
$painter = new Painter(new PlaceholderImageGenerator($style->chroma()), $style->chroma());
$factory = new GenerationFactory($config, $store, new NoNetwork, $model, images: $painter);
$log = [];
$result = $factory->generator(['method' => 'scene', 'anchors_required' => false, 'judge' => false], function ($m) use (&$log) {
    $log[] = $m;
})->generate('A cobbled yard outside an old water mill, with things to discover about who built it', ['scenario_id' => $sid, 'critters' => true, 'grade' => '4'], $teacher);
same($result['status'], 'done', 'the run finishes: '.implode(' | ', array_slice($log, -3)));
same($result['scenario_id'], $sid, 'into the scenario it was made for');
same($result['method'], 'scene', 'by the scene method');

// What the designer was told: the request, the scenario, its other scenes, the options.
$brief = implode("\n", array_filter($model->calls[0]['content'], 'is_string'));
foreach (['cobbled yard', 'River Village', 'Village Green', 'grade 4', 'critters'] as $said) {
    check(str_contains($brief, $said), "the designer is told \"$said\"");
}
check(isset($model->calls[0]['schema']['properties']['ambient']), 'and asked for critters, since the teacher wanted them');

// What the painter was asked: the standing things with room around them, the scenario's look.
$bgAsk = array_values(array_filter($painter->asked, fn ($a) => $a['kind'] === 'background'))[0];
check(str_contains($bgAsk['prompt'], 'standing out on the floor') && str_contains($bgAsk['prompt'], 'round stone well') && str_contains($bgAsk['prompt'], 'walk behind it'), 'the background is asked for the standing things, each with open floor around it');
check(str_contains($bgAsk['prompt'], 'faded fair poster') && str_contains($bgAsk['prompt'], 'brass lamp on the mill wall'), 'and for the details and lights, painted in');
check((bool) preg_grep('/a scene of the same game/', $bgAsk['references']), 'with a scene of the scenario as how it is painted');
$surveyAsk = implode("\n", array_filter(array_values(array_filter($model->calls, fn ($c) => $c['name'] === 'scene_survey'))[0]['content'], 'is_string'));
check(str_contains($surveyAsk, 'standing:0') && str_contains($surveyAsk, 'detail:1') && str_contains($surveyAsk, 'light:0') && ! str_contains($surveyAsk, 'standing:1'), 'the surveyor is asked to find what is described and what glows');

// Progress, for the editor's bar.
$reports = array_map(fn ($r) => json_decode($r['progress'], true), $pdo->query('SELECT progress FROM progress_log WHERE run = '.(int) $result['run'].' ORDER BY id')->fetchAll(PDO::FETCH_ASSOC));
same(array_values(array_unique(array_column($reports, 'stage'))), ['designing', 'drawing', 'building', 'importing'], 'progress goes through the scene\'s four stages');
same($reports[0]['stages'], ['designing', 'drawing', 'building', 'importing'], 'and says so from the start');
$run = (new GenerationRuns($pdo))->get($result['run']);

// ------------------------------------------------------------------ the scene, as added
$bundle = $store->bundle($sid);
same(count($bundle['scenes']), 2, 'the scenario has its scene and the new one');
$new = array_values(array_filter($bundle['scenes'], fn ($s) => $s['shortname'] === 'old_mill_yard'))[0] ?? null;
check($new !== null, 'named after its title');
same((int) $run['blueprint']['scene_id'], (int) $new['id'], 'the run says which scene it made');
same([$new['subtitle'], (int) $new['sequence'], (int) $new['width'], (int) $new['height']], ['Old Mill Yard', 2, 2250, 1200], 'after the scenario\'s scene, at the usual size');
same((string) $store->scenario($sid)['start_scene_id'], (string) $first['id'], 'the start scene is still the scenario\'s own');
$media = array_column($bundle['media'], null, 'id');
$layers = $new['background_media'];
$bgLayer = end($layers);
check(isset($media[$bgLayer['media_id']]) && is_file("$work/media/".$media[$bgLayer['media_id']]['filepath']), 'its picture is copied into the scenario\'s media');
check(count($layers) === 2 && ! empty($layers[0]['sky']) && ! empty($layers[0]['tile']), 'with clouds drifting across its living sky behind it');
same($new['params']['sky']['time'] ?? null, 'afternoon', 'its sky starts in the afternoon');
same($new['params']['sky']['until'] ?? null, 'dusk', 'and slowly turns to dusk');
same($new['params']['atmosphere'] ?? null, [['kind' => 'leaves', 'amount' => 'few']], 'with a few leaves in the air');
$layout = $new['layout'];

// The floor, traced to the base of the mill.
$walk = $layout['walkable_areas'][0];
$backYs = array_column(array_filter($walk, fn ($p) => $p['y'] < 1100), 'y');
check($backYs && max($backYs) <= 805 && min($backYs) >= 790, 'the walkable area runs right up to the base of the mill: '.json_encode($backYs));
same([max(array_column($walk, 'x')), max(array_column($walk, 'y'))], [2250, 1200], 'edge to edge and down to the bottom');
$scale = $layout['scale_areas'][0];
check($scale['y'] <= min($backYs) && $scale['scale_top'] <= 90 && $scale['scale_bottom'] === 108, 'figures are smaller at the back of the floor: '.json_encode($scale));
$spawn = $layout['spawn_points'][0];
check($spawn['name'] === 'default' && $spawn['position_y'] > 860 && $spawn['position_y'] < 1160, 'players arrive in the middle of the floor: '.json_encode($spawn));

// What people walk around, cut out and placed over itself.
$items = array_column($bundle['items'], null, 'id');
$placed = array_map(fn ($p) => $p + ['item' => $items[$p['item_id']]], $layout['items']);
$byName = array_column($placed, null, 'name');
$oak = array_values(array_filter($placed, fn ($p) => $p['item']['name'] === 'Old oak'))[0] ?? null;
$well = array_values(array_filter($placed, fn ($p) => $p['item']['name'] === 'Well'))[0] ?? null;
check($oak && $well, 'the oak and the well are items, named as planned: '.json_encode(array_column(array_column($placed, 'item'), 'name')));
if ($oak && $well) {
    check(abs($oak['position_x'] - 1500) <= 4 && abs($oak['position_y'] - 1011) <= 4, 'the oak stands exactly where it is painted: '.json_encode([$oak['position_x'], $oak['position_y']]));
    $s = $oak['item']['settings'];
    same([$s['placement'], $s['params']['cut_from'], $oak['item']['blocking'] ?? false], ['object', 'background', false], 'it is an object cut from the background, sorted among the players');
    check($s['sort_line'] == [[0, 1], [1, 1]], 'its sort line is level at the foot of its trunk: '.json_encode($s['sort_line']));
    $t = (1011 - $scale['y']) / (1200 - $scale['y']);
    check(abs($s['scale'] * ($scale['scale_top'] + ($scale['scale_bottom'] - $scale['scale_top']) * $t) / 100 - 1) < 0.02, 'and drawn at its own size, whatever the depth there');
    $wellMedia = $media[$well['item']['media_id']];
    check(is_file("$work/media/".$wellMedia['filepath']) && $wellMedia['width'] >= 140 && $wellMedia['width'] < 200, 'the well\'s cut-out is its own picture: '.$wellMedia['width'].'×'.$wellMedia['height']);
    $png = imagecreatefrompng("$work/media/".$wellMedia['filepath']);
    check($wellMedia['width'] <= 146 && $wellMedia['height'] <= 126 && ((imagecolorat($png, 0, 60) >> 24) & 0x7F) < 64, 'cut to its own outline, with no ring of the cobbles around it: '.$wellMedia['width'].'×'.$wellMedia['height']);
}
$blocked = $layout['blocked_areas'];
$covers = fn (array $poly, int $x, int $y) => $x >= min(array_column($poly, 'x')) && $x <= max(array_column($poly, 'x')) && $y >= min(array_column($poly, 'y')) && $y <= max(array_column($poly, 'y'));
check((bool) array_filter($blocked, fn ($p) => $covers($p, 1500, 1000)), 'nobody walks through the oak\'s trunk');
check((bool) array_filter($blocked, fn ($p) => $covers($p, 640, 950)), 'or the well');
check(! array_filter($blocked, fn ($p) => $covers($p, 1000, 1000)), 'but the open floor between them is open');

// The background, with the oak and the well taken out of it: painted behind them, every other pixel as painted.
$retouches = array_values(array_filter($painter->asked, fn ($a) => $a['kind'] === 'retouch'));
same(count($retouches), 1, 'the painter is asked once to paint behind the oak and the well (they fit in one 16:9 window)');
if ($retouches) {
    $r = $retouches[0];
    check(str_contains($r['prompt'], 'oak tree') && str_contains($r['prompt'], 'well') && str_contains($r['prompt'], 'take away'), 'told what to take away');
    check(count($r['references']) === 2 && str_contains($r['references'][1], 'mask'), 'shown the picture and a mask of them');
    same([$r['aspect'], $r['hints']['window'][3]], ['16:9', 1200], 'in a 16:9 window the height of the picture');
}
$painted = glob("$work/generations/{$result['run']}/assets/bg-old_mill_yard.png")[0] ?? null;
$bgFile = "$work/media/".$media[$bgLayer['media_id']]['filepath'];
check($painted && str_ends_with($bgFile, '.png'), 'the scene\'s picture is the cleared one, a PNG: '.basename($bgFile));
if ($painted) {
    $before = ImageTools::load((string) file_get_contents($painted));
    $after = ImageTools::load((string) file_get_contents($bgFile));
    same([imagesx($after), imagesy($after)], [imagesx($before), imagesy($before)], 'at the size it was painted');
    // Every pixel more than a few pixels from the oak and the well is exactly as painted.
    $near = fn (int $x, int $y) => ($x >= 1330 && $x <= 1670 && $y >= 450 && $y <= 1020) || ($x >= 560 && $x <= 720 && $y >= 830 && $y <= 970);
    $changed = 0;
    $outside = 0;
    for ($y = 0; $y < imagesy($before); $y++) {
        for ($x = 0; $x < imagesx($before); $x++) {
            if (imagecolorat($before, $x, $y) !== imagecolorat($after, $x, $y)) {
                $changed++;
                $outside += $near($x, $y) ? 0 : 1;
            }
        }
    }
    check($changed > 20000, "the oak and the well are gone from it ($changed pixels changed)");
    same($outside, 0, 'and nothing else changed, pixel for pixel');
    $rgb = fn (GdImage $im, int $x, int $y) => [(imagecolorat($im, $x, $y) >> 16) & 0xFF, (imagecolorat($im, $x, $y) >> 8) & 0xFF, imagecolorat($im, $x, $y) & 0xFF];
    $close = fn (array $a, array $b) => max(array_map(fn ($p, $q) => abs($p - $q), $a, $b)) <= 3;
    check($close($rgb($after, 1500, 900), $rgb($before, 1000, 900)), 'behind the oak\'s trunk: the cobbles, colour-matched to those around: '.json_encode([$rgb($after, 1500, 900), $rgb($before, 1000, 900)]));
    check($close($rgb($after, 1500, 600), $rgb($before, 1000, 600)), 'behind its canopy: the mill\'s wall: '.json_encode([$rgb($after, 1500, 600), $rgb($before, 1000, 600)]));
    check($close($rgb($after, 640, 900), $rgb($before, 1000, 900)), 'behind the well: the cobbles: '.json_encode([$rgb($after, 640, 900), $rgb($before, 1000, 900)]));
}
$clearedRecord = json_decode((string) file_get_contents("$work/generations/{$result['run']}/survey/old_mill_yard-cleared.json"), true);
same([$clearedRecord['how'], array_column($clearedRecord['windows'], 'how')], ['painted', ['painted']], 'the run records that it was painted');
check((bool) array_filter($result['warnings'], fn ($w) => str_contains($w, 'Ghost cart')), 'a planned thing the picture does not show is a warning for the teacher');

// Things to click, and what the narrator says.
$events = array_values(array_filter($bundle['events'], fn ($e) => (int) $e['scene_id'] === (int) $new['id']));
$hotspots = array_column(array_filter($events, fn ($e) => $e['kind'] === 'hotspot'), null, 'shortname');
same(array_keys($hotspots), ['detail-0', 'detail-1', 'look-old-oak'], 'a hotspot for each detail and for the oak (the well has nothing to say)');
same(count($events), 3, 'and no other events: what happens there is the teacher\'s');
$poster = $hotspots['detail-0'];
check(abs($poster['position_x'] - 360) <= 3 && abs($poster['position_y'] - 580) <= 3 && $poster['activate_by_trigger'], 'the poster\'s hotspot is over the poster as painted, clicked: '.json_encode([$poster['position_x'], $poster['position_y']]));
$oakSpot = $hotspots['look-old-oak'];
check(abs($oakSpot['position_x'] - 1500) <= 10 && $oakSpot['radius'] >= 150, 'the oak\'s is over the whole tree');
$labels = array_values(array_filter($bundle['labels'], fn ($l) => (int) $l['event_id'] === (int) $poster['id']));
same([$labels[0]['type'], $labels[0]['text'], $labels[0]['params']['show_near'] ?? null], ['text', 'Faded poster', 300], 'its name shows when the player is near or points at it');
check(! array_filter($bundle['labels'], fn ($l) => $l['type'] === 'image' && in_array((int) $l['event_id'], array_map('intval', array_column($hotspots, 'id')), true)), 'nothing is drawn over the picture: the painting is the thing');
$variables = array_column($bundle['variables'], null, 'variable_name');
same(isset($variables['old_mill_yard_look_1'], $variables['old_mill_yard_look_3']), true, 'the things with several passages each count clicks in a variable of the scene');
same($variables['old_mill_yard_look_1']['default_value'], 5, 'a variable the scenario already had is kept as it was, not added again');
same(count(array_filter($bundle['variables'], fn ($v) => $v['variable_name'] === 'old_mill_yard_look_1')), 1, 'and not doubled');
same((string) $variables['old_mill_yard_look_3']['scope'], 'player', 'each player has their own count');

/** What the narrator says on each of $clicks clicks of a hotspot, playing its actions as the game does. */
$play = function (array $bundle, int $event, array $vars, int $clicks): array {
    $actions = array_values(array_filter($bundle['actions'], fn ($a) => (int) $a['event_id'] === $event));
    usort($actions, fn ($a, $b) => $a['sequence'] <=> $b['sequence']);
    $conds = [];
    foreach ($bundle['conditions'] as $c) {
        if ($c['action_id'] !== null) {
            $conds[(int) $c['action_id']][] = $c;
        }
    }
    $test = fn (array $c, array $vars) => match ($c['operator']) {
        '=' => ($vars[$c['variable']] ?? 0) == $c['operand'], '>=' => ($vars[$c['variable']] ?? 0) >= $c['operand'], '<' => ($vars[$c['variable']] ?? 0) < $c['operand'],
        default => throw new RuntimeException('operator '.$c['operator']),
    };
    $said = [];
    for ($k = 0; $k < $clicks; $k++) {
        $line = [];
        foreach ($actions as $a) {
            foreach ($conds[(int) $a['id']] ?? [] as $c) {
                if (! $test($c, $vars)) {
                    continue 2;
                }
            }
            if ($a['type'] === 'narration') {
                $line[] = $a['params']['text'];
            } elseif ($a['type'] === 'variable') {
                $p = $a['params'];
                $vars[$p['name']] = $p['operator'] === '+' ? ($vars[$p['name']] ?? 0) + $p['operand'] : $p['operand'];
            }
        }
        $said[] = implode(' / ', $line);
    }

    return $said;
};
same($play($bundle, (int) $oakSpot['id'], [], 5), [
    'A great oak, older than the mill.', 'Up close, someone carved initials in the bark: M.R. 1888.', 'M.R. — the miller, Martha Reed, who built this place.',
    'M.R. — the miller, Martha Reed, who built this place.', 'M.R. — the miller, Martha Reed, who built this place.',
], 'the oak\'s passages are told one per click, and then the last one stays');
same($play($bundle, (int) $poster['id'], [], 5), ['A poster for the harvest fair.', 'It promises a pie the size of a cartwheel.', 'A poster for the harvest fair.', 'It promises a pie the size of a cartwheel.', 'A poster for the harvest fair.'], 'the poster\'s go round again');
same($play($bundle, (int) $hotspots['detail-1']['id'], [], 2), ['The wheel turns slowly, dripping.', 'The wheel turns slowly, dripping.'], 'one passage is simply said each time');
check(! array_filter($bundle['actions'], fn ($a) => (int) $a['event_id'] === (int) $hotspots['detail-1']['id'] && $a['type'] === 'variable'), 'and counts nothing');

// The lamp's glow, the critters.
$glow = $layout['lights'][0] ?? null;
check($glow && abs($glow['x'] - 2000) <= 6 && abs($glow['y'] - 500) <= 6 && $glow['kind'] === 'glow', 'the lamp glows on its lit part: '.json_encode($glow));
$critters = array_column($layout['critters'] ?? [], null, 'name');
same(array_keys($critters), ['squirrel', 'deer'], 'a squirrel and a deer come and go');
same($critters['squirrel']['behavior'], 'climbs', 'the squirrel climbs');
check(abs($critters['squirrel']['spots'][0]['x'] - 1500) <= 8 && $critters['squirrel']['spots'][0]['top'] < 1000, 'up the oak');
same($critters['deer']['behavior'], 'walks_by', 'the deer walks by');
check(isset($media[$critters['deer']['media_id']]) && ! empty($media[$critters['deer']['media_id']]['params']['animations'] ?? $media[$critters['deer']['media_id']]['params'] ?? null), 'drawn, as a little sprite sheet of its own');

// ------------------------------------------------------------------ the game's own validator
$document = $store->compile($sid);
file_put_contents("$work/scenario.json", json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
$tsx = __DIR__.'/../../../node_modules/.bin/tsx';
if (is_file($tsx)) {
    exec(escapeshellarg($tsx).' '.escapeshellarg(__DIR__.'/../../../tools/validate-scenario.ts').' '.escapeshellarg("$work/scenario.json").' 2>&1', $out, $code);
    check($code === 0 && ! preg_grep('/ERROR/', $out), "the game's validator accepts the scenario with its new scene: ".implode(' | ', preg_grep('/ERROR|WARN/', $out) ?: []));
} else {
    fwrite(STDOUT, "(skipped the game's validator: run npm install to include it)\n");
}

// ------------------------------------------------------------------ a merge that fails takes only its own files with it
$bad = ['media' => [['id' => 1, 'type' => 'image', 'filename' => 'x.png', 'url' => 'assets/x.png']], 'scenes' => [['id' => 1, 'shortname' => 'broken', 'zoom' => 'not a number', 'layout' => []]], 'events' => [['id' => 1, 'scene_id' => 1, 'kind' => 'nonsense']]];
$before = glob("$work/media/$sid/*");
check((function () use ($store, $sid, $bad, $looksPng) {
    try {
        $store->mergeRows($sid, $bad, fn () => $looksPng);
    } catch (StoreError) {
        return true;
    }

    return false;
})(), 'a merge with a bad row is refused');
same(glob("$work/media/$sid/*"), $before, 'and the file it had copied is gone, the scenario\'s own are all there');
check(array_intersect($ownFiles, glob("$work/media/$sid/*")) === $ownFiles, 'the scenario\'s first picture among them');
same(count($store->bundle($sid)['scenes']), 2, 'nothing of it was added');
check((function () use ($store) {
    try {
        $store->mergeRows(99999, ['scenes' => [['id' => 1]]]);
    } catch (StoreError $e) {
        return $e->status === 404;
    }

    return false;
})(), 'a merge into a scenario that is gone is refused');

// ------------------------------------------------------------------ a scene for a scenario that is gone
$store->deleteScenario($sid);
check((function () use ($factory, $sid, $teacher) {
    try {
        $factory->generator(['method' => 'scene', 'anchors_required' => false, 'judge' => false])->generate('A cave behind the waterfall, glittering', ['scenario_id' => $sid], $teacher);
    } catch (Throwable $e) {
        return str_contains($e->getMessage(), 'gone');
    }

    return false;
})(), 'a scene for a scenario that is gone stops at once, before anything is drawn');

// ------------------------------------------------------------------ BackgroundCleaner on its own
/**
 * A small yard: a wall (y < 200) over cobbles, a see-through sky above y 60, a dark line where they
 * meet, and a post standing out on the cobbles whose top reaches up into the sky; and its cut-out.
 */
$yard = function (bool $post): GdImage {
    $im = ImageTools::blank(600, 400);
    imagefilledrectangle($im, 0, 60, 599, 199, imagecolorallocatealpha($im, 176, 160, 140, 0));
    imagefilledrectangle($im, 0, 200, 599, 399, imagecolorallocatealpha($im, 150, 140, 120, 0));
    imagefilledrectangle($im, 0, 198, 599, 201, imagecolorallocatealpha($im, 40, 30, 50, 0));
    if ($post) {
        imagefilledrectangle($im, 280, 20, 320, 330, imagecolorallocatealpha($im, 110, 70, 40, 0));
    }

    return $im;
};
$yardPicture = $yard(true);
$postCut = ['image' => ImageTools::crop($yardPicture, 280, 20, 41, 311), 'x' => 280, 'y' => 20, 'name' => 'post'];
$sameOutside = function (GdImage $a, GdImage $b): int {
    $n = 0;
    for ($y = 0; $y < 400; $y++) {
        for ($x = 0; $x < 600; $x++) {
            $g = BackgroundCleaner::GROW;
            $inside = $x >= 280 - $g && $x <= 320 + $g && $y >= 20 - $g && $y <= 330 + $g;
            $n += ! $inside && imagecolorat($a, $x, $y) !== imagecolorat($b, $x, $y) ? 1 : 0;
        }
    }

    return $n;
};
$pixel = fn (GdImage $im, int $x, int $y) => [(imagecolorat($im, $x, $y) >> 16) & 0xFF, (imagecolorat($im, $x, $y) >> 8) & 0xFF, imagecolorat($im, $x, $y) & 0xFF, (imagecolorat($im, $x, $y) >> 24) & 0x7F];
$chroma = $style->chroma();
$withChromaSky = function (GdImage $im) use ($chroma): GdImage {
    $out = imagecreatetruecolor(imagesx($im), imagesy($im));
    imagefill($out, 0, 0, imagecolorallocate($out, ...$chroma));
    imagealphablending($out, true);
    imagecopy($out, $im, 0, 0, 0, 0, imagesx($im), imagesy($im));

    return $out;
};

// Filled from around: no painter.
$filled = BackgroundCleaner::clear($yardPicture, [$postCut], null, $chroma);
same([$filled['how'], $sameOutside($yardPicture, $filled['image'])], ['filled', 0], 'filled from around, with nothing else touched');
same($pixel($filled['image'], 300, 300), [150, 140, 120, 0], 'the cobbles carry on where the post stood');
same($pixel($filled['image'], 300, 120), [176, 160, 140, 0], 'and the wall');
same($pixel($filled['image'], 300, 30)[3], 127, 'and the sky stays see-through behind its top');

// Painted: the painter's sky is the flat colour, which comes back see-through.
$cleanYard = $withChromaSky($yard(false));
$good = fn ($prompt, $refs, $aspect, $hints) => ImageTools::png(ImageTools::crop($cleanYard, ...$hints['window']));
$painted = BackgroundCleaner::clear($yardPicture, [$postCut], $good, $chroma);
same([$painted['how'], $sameOutside($yardPicture, $painted['image'])], ['painted', 0], 'painted behind, with nothing else touched');
same([$pixel($painted['image'], 300, 300), $pixel($painted['image'], 300, 120)], [[150, 140, 120, 0], [176, 160, 140, 0]], 'the painter\'s cobbles and wall where the post stood');
same($pixel($painted['image'], 300, 30)[3], 127, 'its flat sky see-through');
same(array_column($painted['windows'], 'width'), [600], 'one window: the whole of a picture narrower than 16:9');

// Answers that cannot be used: the holes are filled instead, and the run is told why.
$shifted = function ($prompt, $refs, $aspect, $hints) use ($withChromaSky, $yard) {
    // The same yard drawn 60 pixels lower: the line between wall and cobbles is in the wrong place.
    $low = $withChromaSky($yard(false));
    $out = imagecreatetruecolor(600, 400);
    imagecopy($out, $low, 0, 60, 0, 0, 600, 340);
    imagecopy($out, $low, 0, 0, 0, 0, 600, 60);

    return ImageTools::png($out);
};
$unchanged = fn ($prompt, $refs, $aspect, $hints) => ImageTools::png($withChromaSky($yardPicture));
$broken = fn () => throw new RuntimeException('the picture source is down');
foreach (['shifted' => [$shifted, 'line up'], 'unchanged' => [$unchanged, 'left the things'], 'broken' => [$broken, 'is down']] as $what => [$answer, $why]) {
    $told = [];
    $r = BackgroundCleaner::clear($yardPicture, [$postCut], $answer, $chroma, 'flat magenta', function ($m) use (&$told) {
        $told[] = $m;
    });
    check($r['how'] === 'filled' && str_contains($r['windows'][0]['problem'] ?? '', $why) && $told, "a $what answer is not used: ".json_encode($r['windows']));
    same([$sameOutside($yardPicture, $r['image']), $pixel($r['image'], 300, 300)], [0, [150, 140, 120, 0]], "and the post is filled in from around, nothing else touched ($what)");
}

// Things far apart in a wide picture: a window each.
$wide = ImageTools::blank(4000, 900);
imagefilledrectangle($wide, 0, 0, 3999, 899, imagecolorallocatealpha($wide, 150, 140, 120, 0));
$thing = ImageTools::blank(40, 100);
imagefilledrectangle($thing, 0, 0, 39, 99, imagecolorallocatealpha($thing, 90, 60, 30, 0));
$asks = [];
$r = BackgroundCleaner::clear($wide, [['image' => $thing, 'x' => 200, 'y' => 700], ['image' => $thing, 'x' => 700, 'y' => 700], ['image' => $thing, 'x' => 3600, 'y' => 700]], function ($prompt, $refs, $aspect, $hints) use (&$asks, $wide) {
    $asks[] = [$aspect, $hints['window']];

    return ImageTools::png(ImageTools::crop($wide, ...$hints['window']));
}, $chroma);
same(array_column($asks, 0), ['16:9', '16:9'], 'two things side by side share a 16:9 window; one far off gets its own');
same(array_map(fn ($a) => $a[1][2], $asks), [1600, 1600], 'each the height of the picture, 16:9 wide');

if (getenv('QBL_KEEP')) {
    fwrite(STDOUT, "(kept $work)\n");
} else {
    exec('rm -rf '.escapeshellarg($work));
}
if ($failures) {
    fwrite(STDERR, "$failures of $checks checks failed\n");
    exit(1);
}
echo "ok: $checks checks passed (scene plan, run, layout, cut-outs, background cleared, hotspots, counters, lights, critters, merge)\n";
