<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\Design\Connections;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Spend;
use GdImage;

/**
 * Draws every picture a mission needs, in one art style, and keeps each one only once it passes.
 *
 * How consistency is kept, in order of strength:
 *  1. Anchors. The style's approved anchor pictures go with every request, and every result is judged
 *     against them (StyleJudge). A result below the bar is drawn again with the judge's corrections.
 *  2. Design before motion. Each character is drawn once as a character sheet; its portrait and every
 *     animation strip are drawn FROM that sheet (it is the first reference), judged against it, and
 *     colour-matched to it, so a character looks the same in every frame and in the story box.
 *  3. The mission's own first pictures. The first background accepted goes with every later background
 *     ("another scene of the same mission"), and the first character sheet with every later character.
 *  4. One prompt writer. ArtStyle words every prompt the same way.
 *  5. One finish. Everything is cut out, trimmed, sized to fixed heights, and pulled towards the palette
 *     by the same code.
 *
 * Every accepted picture and its record are kept in the work folder, so a run that stops can be resumed
 * without drawing anything twice.
 *
 * What it costs, and how that is kept down: every picture drawn is priced into the run's Spend. Small
 * things are drawn several to a picture (a sheet cut apart) on the cheaper props model; a character gets
 * only the animations the mission plays (walk, and wave or cheer where they are used), their standing
 * picture as idle, and their portrait cut from their sheet (each configurable); and once the run has
 * spent its budget, nothing is redrawn for a better score.
 */
class AssetDirector
{
    /** Older blueprints' item sizes. Items are now drawn to their real size: see Sizes. */
    public const SIZES = ['small' => 130, 'medium' => 230, 'large' => 400];

    /** How tall passages that stand at the back are drawn, beside people PERSON_PX tall. */
    public const PASSAGE_PX = ['door' => 360, 'gate' => 380, 'cave' => 420, 'portal' => 380, 'tunnel' => 360, 'ladder' => 540, 'stairs_up' => 440];

    /** How wide openings in the floor are drawn. */
    public const OPENING_PX = ['hole' => 320, 'hatch' => 250, 'stairs_down' => 320];

    /** What small things stand on: a table indoors, a flat rock or stump elsewhere. */
    public const SURFACES = [
        'indoor' => 'a small sturdy work table with four legs and a plain empty top, waist-high to a child',
        'outdoor' => 'a low flat-topped boulder or tree stump with a plain empty top, knee-high to a child',
    ];

    public const SURFACE_PX = ['indoor' => 190, 'outdoor' => 170];

    /** Animation rows of a character's sheet: name => [frames, milliseconds per pass, loops]. */
    public const ANIMATIONS = [
        'idle' => [4, 1600, true],
        'walk' => [6, 720, true],
        'wave' => [4, 900, false],
        'cheer' => [4, 900, false],
        'point' => [3, 800, false],
        'think' => [3, 1200, false],
    ];

    private const MOTION = [
        'idle' => 'standing idle, breathing gently: a subtle loop where the chest rises and falls and the arms sway slightly; the first and last frames are almost the same',
        'walk' => 'a walk cycle seen from the side, facing right: contact, down, passing, up, contact, passing with the other leg; arms swinging opposite to the legs',
        'wave' => 'waving hello with the right hand raised beside the head, the hand moving side to side',
        'cheer' => 'cheering: both arms thrown up in celebration, a small hop, a big smile',
        'point' => 'pointing ahead to the right with one arm outstretched, as if showing the way',
        'think' => 'thinking: one hand on the chin, eyes looking up, head tilted',
    ];

    /** Things to a sheet: a grid of up to 3 × 2. */
    public const SHEET_MAX = 6;

    /** For estimates: pictures are drawn about this many times on average before one is kept, and judging one costs about this much. */
    public const EXPECTED_ATTEMPTS = 1.4;

    public const JUDGE_ESTIMATE_USD = 0.012;

    public const CELL_W = 240;

    public const CELL_H = 320;

    private array $manifest = [];

    /** The mission's own first accepted background and character sheet (see 3 above). */
    private ?Reference $sceneLook = null;

    private ?Reference $castLook = null;

    /** @var callable|null */
    private $log;

    public function __construct(
        private ImageGenerator $images,
        private ArtStyle $style,
        private ?StyleJudge $judge,
        private string $workDir,
        private int $maxAttempts = 3,
        ?callable $log = null,
        private ?Spend $spend = null,
        /** QBL_GEN_PORTRAITS, QBL_GEN_IDLE_FRAMES, QBL_GEN_PROP_SHEETS: see config/qbl_generation.php. */
        private array $pictures = [],
    ) {
        $this->log = $log;
        $this->pictures += ['portraits' => 'crop', 'idle_frames' => false, 'prop_sheets' => true];
        if (! is_dir("$workDir/assets") && ! mkdir("$workDir/assets", 0775, true) && ! is_dir("$workDir/assets")) {
            throw new GenerationError("Cannot create $workDir/assets.");
        }
    }

    public function manifest(): array
    {
        return array_values($this->manifest);
    }

    /**
     * Every picture the blueprint needs, keyed as MissionBuilder expects:
     * "bg:<scene>", "char:<key>", "portrait:<key>", "item:<key>", "badge".
     */
    public function drawMission(array $b, array $layouts): array
    {
        $accents = $b['art_direction']['accent_colors'] ?? [];
        $setting = $b['art_direction']['setting'] ?? '';
        $assets = [];

        foreach ($b['characters'] as $c) {
            $assets += $this->character($c, $setting, $accents, self::gesturesUsed($b, $c));
        }
        // Small things, several to a picture where it can: items, the tables and rocks they stand on, the marker.
        $things = self::things($b, (string) ($this->style->bible()['marker'] ?? 'a small glowing beacon'));
        if ($this->pictures['prop_sheets'] && count($things) > 1) {
            $todo = array_filter($things, fn ($t) => ! ($this->cached($t['key'])['asset'] ?? null));
            foreach (array_chunk($todo, self::SHEET_MAX, true) as $n => $chunk) {
                if (count($chunk) > 1) {
                    $this->thingsSheet(array_values($chunk), $accents, $n + 1);
                }
            }
        }
        foreach ($things as $t) {
            // Already drawn on a sheet (or by an earlier run), or drawn on its own.
            $assets[$t['asset']] = $this->cutout($t['key'], $t['kind'], $t['subject'], $t['kind'] === 'vehicle' ? '3:2' : '1:1', $this->style->anchorsFor($t['kind']), [], $t['accents'] ? $accents : [], height: $t['fit']['height'] ?? null, width: $t['fit']['width'] ?? null, label: $t['label'], pull: true, longest: $t['fit']['longest'] ?? null);
        }
        // The doors, holes and ladders that lead between scenes.
        foreach (Connections::ends($b) as $scene => $ends) {
            foreach ($ends as $end) {
                if ($end['via'] !== 'edge') {
                    $assets["passage:$scene:{$end['to']}"] = $this->passage($end, $accents);
                }
            }
        }
        foreach ($b['scenes'] as $scene) {
            $assets["bg:{$scene['key']}"] = $this->background($scene, $layouts[$scene['key']] ?? [], $setting, $accents, $b['art_direction']['time_of_day'] ?? null);
        }
        if (! empty($b['badge'])) {
            $assets['badge'] = $this->cutout('badge', 'badge', "{$b['badge']['name']}: {$b['badge']['appearance']}", '1:1', [], [], $accents, height: 110, label: $b['badge']['name']);
        }

        return $assets;
    }

    /**
     * The small things a mission needs drawn: each item (vehicles too), each table or rock small things
     * stand on, and the marker for interactions without an item. key (as recorded), asset (as
     * MissionBuilder expects), kind, subject, label, fit (the size to scale to), accents.
     *
     * @return array<string, array>
     */
    public static function things(array $b, string $marker): array
    {
        $scenes = array_column($b['scenes'], null, 'key');
        $items = array_column($b['items'], null, 'key');
        $setting = $b['art_direction']['setting'] ?? '';
        // Items hung on a wall are drawn as wall-mounted things.
        $mounted = [];
        foreach ($b['interactions'] as $it) {
            if (! empty($it['item']) && isset($items[$it['item']], $scenes[$it['scene']]) && self::placementOf($it, $items[$it['item']], $scenes[$it['scene']]) === 'wall') {
                $mounted[$it['item']] = true;
            }
        }
        $out = [];
        foreach ($b['items'] as $item) {
            $vehicle = $item['kind'] === 'vehicle';
            $out["item:{$item['key']}"] = [
                'key' => "item:{$item['key']}", 'asset' => "item:{$item['key']}", 'kind' => $vehicle ? 'vehicle' : 'item',
                'subject' => "{$item['name']}: {$item['appearance']}".(isset($mounted[$item['key']]) ? '. Mounted flat on a wall, seen straight on, with its fixings showing' : ''),
                'label' => $item['name'], 'accents' => true,
                // Drawn to its real size beside the people in the scene: its longest side.
                'fit' => $vehicle && empty($item['size_cm']) ? ['width' => 340] : ['longest' => Sizes::pixels(Sizes::cm($item))],
            ];
        }
        foreach (self::surfacesNeeded($b) as $kind) {
            $out["surface:$kind"] = ['key' => "surface:$kind", 'asset' => "surface:$kind", 'kind' => 'item', 'subject' => self::SURFACES[$kind].($setting ? ", fitting this place: $setting" : ''), 'label' => "surface $kind", 'accents' => true, 'fit' => ['width' => self::SURFACE_PX[$kind]]];
        }
        // Interactions with no item of their own (a question, an inspection of the scenery), and the crew station, get the style's marker.
        if (array_filter($b['interactions'], fn ($it) => $it['type'] !== 'talk' && empty($it['item']) && empty($it['at_report'])) || ! empty($b['roles'])) {
            $out['marker'] = ['key' => 'marker', 'asset' => 'marker', 'kind' => 'item', 'subject' => $marker, 'label' => 'marker', 'accents' => false, 'fit' => ['height' => 120]];
        }

        return $out;
    }

    /**
     * The gestures a character needs drawn: only those the mission plays. A character waves when a
     * conversation with them starts (if it was asked for), the guide cheers at the end; any other
     * gesture would never be seen.
     */
    public static function gesturesUsed(array $b, array $c): array
    {
        $asked = array_values(array_intersect($c['gestures'] ?? [], ['wave', 'cheer', 'point', 'think']));
        $talks = (bool) array_filter($b['interactions'], fn ($it) => $it['type'] === 'talk' && ($it['character'] ?? null) === $c['key']);

        return array_values(array_filter($asked, fn ($g) => ($g === 'wave' && $talks) || ($g === 'cheer' && ! empty($c['guide']))));
    }

    /**
     * What drawing this blueprint should cost: the pictures it needs, priced by the image model, with
     * the redraws and judging a run usually needs. For `--design-only`, before anything is drawn.
     *
     * @return array{pictures: int, usd: float, by_kind: array<string, int>}
     */
    public function estimate(array $b): array
    {
        $by = [];
        $add = function (string $kind, int $n = 1) use (&$by) {
            $by[$kind] = ($by[$kind] ?? 0) + $n;
        };
        foreach ($b['characters'] as $c) {
            $add('character');
            $add('strip', 1 + count(self::gesturesUsed($b, $c)) + ($this->pictures['idle_frames'] ? 1 : 0));
            if ($this->pictures['portraits'] === 'draw') {
                $add('portrait');
            }
        }
        $things = self::things($b, 'marker');
        if ($this->pictures['prop_sheets'] && count($things) > 1) {
            $add('sheet', (int) ceil(count($things) / self::SHEET_MAX));
        } else {
            $add('item', count($things));
        }
        foreach (Connections::ends($b) as $ends) {
            foreach ($ends as $end) {
                if ($end['via'] !== 'edge') {
                    $add(Connections::inFloor($end['via']) ? 'opening' : 'passage');
                }
            }
        }
        $add('background', count($b['scenes']));
        if (! empty($b['badge'])) {
            $add('badge');
        }
        $usd = 0.0;
        $spend = $this->spend ?? new Spend;
        foreach ($by as $kind => $n) {
            [$model, $size] = $this->images instanceof PricedImageGenerator ? $this->images->pricing(['kind' => $kind]) : ['placeholder', null];
            // With the references a picture of its kind is sent: the anchors, and a character's sheet for its strips.
            $refs = count($this->style->anchorsFor($kind)) + ($kind === 'strip' || $kind === 'portrait' ? 1 : 0) + ($kind === 'background' || $kind === 'character' ? 1 : 0);
            $each = $spend->pictureWithReferences($model, $size, $refs) + ($this->judge ? self::JUDGE_ESTIMATE_USD : 0);
            $usd += $n * $each * min($this->maxAttempts, self::EXPECTED_ATTEMPTS);
        }

        return ['pictures' => array_sum($by), 'usd' => round($usd, 2), 'by_kind' => $by];
    }

    /** Where an interaction's item goes; the same rule MissionBuilder uses. */
    public static function placementOf(array $it, ?array $item, array $scene): string
    {
        if (! $item) {
            return in_array($it['placement'] ?? null, ['ground', 'back'], true) ? $it['placement'] : 'ground';
        }

        return Sizes::placement($item, $it['placement'] ?? null, $scene);
    }

    /** Which surfaces small things need: "indoor" (a table), "outdoor" (a flat rock). */
    public static function surfacesNeeded(array $b): array
    {
        $scenes = array_column($b['scenes'], null, 'key');
        $items = array_column($b['items'], null, 'key');
        $out = [];
        foreach ($b['interactions'] as $it) {
            if ($it['type'] === 'talk' || ! empty($it['at_report']) || empty($it['item']) || ! isset($items[$it['item']], $scenes[$it['scene']])) {
                continue;
            }
            if (self::placementOf($it, $items[$it['item']], $scenes[$it['scene']]) === 'surface') {
                $out[self::surfaceKind($scenes[$it['scene']])] = true;
            }
        }

        return array_keys($out);
    }

    public static function surfaceKind(array $scene): string
    {
        return Sizes::sceneKind($scene) === 'indoor' ? 'indoor' : 'outdoor';
    }

    // ==================================================================== characters

    private function character(array $c, string $setting, array $accents, ?array $gestures = null): array
    {
        $key = $c['key'];
        $subject = "{$c['name']}, {$c['appearance']}";

        // 1. The character sheet: the design every other picture of them is drawn from.
        $refs = $this->style->anchorsFor('character');
        if ($this->castLook) {
            $refs[] = $this->castLook;
        }
        // Kept large: their portrait is cut from it.
        $sheet = $this->cutout("design:$key", 'character', $subject, '3:4', $refs, [], $accents, height: 1100, label: $c['name'], pull: true);
        $sheetRef = new Reference((string) file_get_contents($sheet['path']), "the character sheet of {$c['name']}: draw exactly this character, same design, outfit, colours and proportions");
        $this->castLook ??= new Reference($sheetRef->bytes, 'another character from the same game: match its style, not its design');
        $sheetIm = ImageTools::load($sheetRef->bytes);
        $sheetStats = ImageTools::labStats($sheetIm);

        // 2. Their portrait, set on the house backdrop: their head and shoulders from the sheet (free, and
        //    exactly their design), or drawn from the sheet (QBL_GEN_PORTRAITS=draw). A character always has
        //    one: a portrait that cannot be drawn is cut from the sheet too.
        if ($this->pictures['portraits'] === 'draw') {
            try {
                $portrait = $this->cutout("portrait:$key", 'portrait', $c['name'].' ('.$c['appearance'].')', '1:1', [$sheetRef, ...$this->style->anchorsFor('portrait')], [$sheetRef], $accents, height: null, label: $c['name'].' portrait', pull: true, portrait: true);
            } catch (GenerationError $e) {
                $portrait = $this->portraitFromSheet($key, $sheetIm, $e->getMessage());
            }
        } else {
            $portrait = ($this->cached("portrait:$key")['asset'] ?? null) ?: $this->portraitFromSheet($key, $sheetIm, null);
        }

        // 3. Their animations, a strip each, drawn from the sheet.
        $rows = [];
        $animations = [];
        $columns = 1;
        // Walk always; idle only if asked for (otherwise the standing picture is the idle); the gestures the
        // mission plays, unless the budget is spent.
        $gestures ??= array_values(array_intersect($c['gestures'] ?? [], array_keys(self::ANIMATIONS)));
        $wanted = array_unique([...($this->pictures['idle_frames'] ? ['idle'] : []), 'walk', ...$gestures]);
        foreach ($wanted as $name) {
            if (! in_array($name, ['idle', 'walk'], true) && $this->spend?->over() && ! $this->cached("strip:$key:$name")) {
                $this->say("Skipped $key's $name: the budget is spent (the built-in move is used)");

                continue;
            }
            [$count, $duration, $loops] = self::ANIMATIONS[$name];
            $frames = $this->strip($key, "{$c['name']} ({$c['appearance']})", $name, $count, $sheetRef, $accents);
            if ($frames === null && $name === 'walk') {
                // Every character walks. A shorter cycle is easier to draw; failing that, the standing
                // picture is made to walk (bob, lean and swing).
                $frames = $this->strip($key, "{$c['name']} ({$c['appearance']})", $name, 4, $sheetRef, $accents, variant: 'short')
                    ?? $this->puppetWalk($key, $sheetIm);
            }
            if ($frames === null) {
                continue; // the built-in moves cover any gesture not drawn
            }
            if ($this->style->post('match_frames', true)) {
                $frames = array_map(fn ($f) => ImageTools::matchColours($f, ImageTools::labStats($f), $sheetStats, 0.8), $frames);
            }
            $rows[$name] = $frames;
            $columns = max($columns, count($frames));
        }
        if (! isset($rows['idle'])) {
            // Without an idle strip the sheet itself is the standing frame.
            $rows = ['idle' => [ImageTools::trim($sheetIm)]] + $rows;
        }

        // Every row is scaled by the same rule so the character keeps one size across animations:
        // standing rows to a fixed body height, gesture rows (arms up) a little taller.
        $target = self::CELL_H - 30;
        $cells = [];
        $r = 0;
        foreach ($rows as $name => $frames) {
            $heights = array_map('imagesy', $frames);
            sort($heights);
            $median = $heights[intdiv(count($heights), 2)];
            $scale = ($name === 'idle' || $name === 'walk' ? $target : $target * 1.1) / max(1, $median);
            $cells[] = array_map(fn ($f) => ImageTools::cell($f, self::CELL_W, self::CELL_H, $scale), $frames);
            [, $duration, $loops] = self::ANIMATIONS[$name];
            $animations[] = ['name' => $name, 'frames' => range($r * $columns, $r * $columns + count($frames) - 1), 'duration' => $duration] + ($loops ? [] : ['repeat' => false]);
            $r++;
        }
        $sheetImage = ImageTools::sheet($cells, self::CELL_W, self::CELL_H, $columns);
        $path = "{$this->workDir}/assets/".self::file("char:$key").'.png';
        file_put_contents($path, ImageTools::png($sheetImage));

        return [
            "char:$key" => [
                'path' => $path, 'width' => imagesx($sheetImage), 'height' => imagesy($sheetImage), 'frame_width' => self::CELL_W, 'frame_height' => self::CELL_H,
                'params' => ['sheet' => ['columns' => $columns, 'rows' => count($cells)], 'animations' => $animations],
            ],
            "portrait:$key" => $portrait,
        ];
    }

    /** Walking frames made from the standing picture, recorded like a drawn strip. */
    private function puppetWalk(string $key, GdImage $sheet): array
    {
        $frames = ImageTools::puppetWalk($sheet, self::ANIMATIONS['walk'][0]);
        $files = [];
        foreach ($frames as $i => $frame) {
            $files[] = $file = "{$this->workDir}/assets/".self::file("strip:$key:walk")."-$i.png";
            file_put_contents($file, ImageTools::png($frame));
        }
        $this->record("strip:$key:walk", 'strip', null, [], ['accepted' => true, 'below_bar' => true, 'score' => null, 'frames' => $files, 'note' => 'No walk could be drawn; it is made from the standing picture. Draw it again before publishing if you can.']);
        $this->say("Made a walk for $key from the standing picture");

        return $frames;
    }

    /** A portrait cut from the character sheet: by choice (null $why), or because none could be drawn. */
    private function portraitFromSheet(string $key, GdImage $sheet, ?string $why): array
    {
        $im = $this->portrait(ImageTools::bust($sheet));
        $path = "{$this->workDir}/assets/".self::file("portrait:$key").'.png';
        file_put_contents($path, ImageTools::png($im));
        $asset = ['path' => $path, 'width' => imagesx($im), 'height' => imagesy($im)];
        $this->record("portrait:$key", 'portrait', null, $why ? [['problem' => $why]] : [], ['accepted' => true, 'below_bar' => $why !== null, 'score' => null, 'asset' => $asset, 'note' => $why ? 'Cut from the character sheet: no portrait could be drawn.' : 'Cut from the character sheet.']);

        return $asset;
    }

    /**
     * Several small things drawn as one picture, a grid cut apart into one asset each (recorded under
     * each thing's key, so they are picked up like pictures drawn alone). The sheet is judged once. A
     * thing whose cell came out empty or spilled into its neighbour is left for drawing on its own.
     */
    private function thingsSheet(array $things, array $accents, int $n): void
    {
        $count = count($things);
        $cols = min(3, $count);
        $rows = (int) ceil($count / $cols);
        $aspect = $rows > 1 ? '3:2' : ($cols === 3 ? '21:9' : '16:9');
        $sheetKey = "sheet:$n:".substr(md5(implode('|', array_column($things, 'key'))), 0, 8);
        $list = implode('; ', array_map(fn ($i, $t) => ($i + 1).'. '.rtrim($t['subject'], '.'), array_keys($things), $things));
        $refs = $this->style->anchorsFor('sheet');
        // Big things need the bigger picture to stay sharp in their cell.
        $big = max(array_map(fn ($t) => (int) max($t['fit']), $things)) > 380;
        $hints = ['kind' => 'sheet', 'count' => $count, 'columns' => $cols, 'rows' => $rows, 'labels' => array_column($things, 'label')] + ($big ? ['size' => '2K'] : []);
        $notes = [];
        $attempts = [];
        $best = null;
        for ($attempt = 1; $attempt <= $this->maxAttempts; $attempt++) {
            if ($attempt > 1 && ! $this->mayRedraw()) {
                break;
            }
            $prompt = $this->style->prompt('sheet', $list, $refs, ['count' => $count, 'columns' => $cols, 'rows' => $rows], $notes, $this->images->transparency(), $accents);
            $this->say("Drawing $count things on one sheet ($sheetKey), attempt $attempt");
            try {
                $raw = $this->draw($prompt, $refs, $aspect, $this->images->transparency(), $hints);
            } catch (GenerationError $e) {
                $attempts[] = ['attempt' => $attempt, 'problem' => $e->getMessage()];
                if ($this->images instanceof Providers\OfflineImageGenerator) {
                    break;
                }

                continue;
            }
            $im = $this->cut(ImageTools::load($raw));
            $cells = ImageTools::gridCells($im, $cols, $rows, $count);
            $filled = count(array_filter($cells));
            $verdict = $this->judge?->judge('item', ImageTools::png($im), $this->style->anchorsFor('item'), [], "a sheet of $count separate objects: $list", ["$count separate objects in a grid of $cols columns and $rows rows, each whole inside its own cell"]);
            $attempts[] = ['attempt' => $attempt, 'cells' => $filled] + ($verdict ? ['score' => $verdict['score'], 'problems' => $verdict['problems']] : []);
            $score = $verdict['score'] ?? 10;
            if (! $best || [$filled, $score] > [$best['filled'], $best['score']]) {
                $best = ['filled' => $filled, 'score' => $score, 'cells' => $cells, 'pass' => ! $verdict || $verdict['pass'], 'prompt' => $prompt];
            }
            if ($filled === $count && $best['pass'] && $best['cells'] === $cells) {
                break;
            }
            $notes = array_values(array_filter([$verdict['fix'] ?? null, $filled < $count ? "Draw exactly $count separate objects, one centred in each cell of a $cols by $rows grid, each small enough to have empty space all around it" : null]));
        }
        $this->record($sheetKey, 'sheet', $best['prompt'] ?? null, $attempts, ['accepted' => (bool) $best, 'score' => $best['score'] ?? null, 'things' => array_column($things, 'key')]);
        if (! $best) {
            return;
        }
        foreach ($things as $i => $t) {
            $im = $best['cells'][$i] ?? null;
            if (! $im) {
                continue; // drawn on its own
            }
            if (($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }
            $im = self::fitTo($im, $t['fit']);
            $path = "{$this->workDir}/assets/".self::file($t['key']).'.png';
            file_put_contents($path, ImageTools::png($im));
            $this->record($t['key'], $t['kind'], $best['prompt'], [], ['accepted' => true, 'score' => $best['score'], 'below_bar' => ! $best['pass'], 'sheet' => $sheetKey, 'asset' => ['path' => $path, 'width' => imagesx($im), 'height' => imagesy($im)]]);
        }
    }

    /** Scaled to ['height' => n], ['width' => n] or ['longest' => n]. */
    private static function fitTo(GdImage $im, array $fit): GdImage
    {
        $s = isset($fit['longest']) ? $fit['longest'] / max(imagesx($im), imagesy($im)) : (isset($fit['height']) ? $fit['height'] / imagesy($im) : (isset($fit['width']) ? $fit['width'] / imagesx($im) : 1));

        return ImageTools::resize($im, max(1, (int) round(imagesx($im) * $s)), max(1, (int) round(imagesy($im) * $s)));
    }

    /**
     * Draws one picture and prices it into the run's Spend. Stops the run at twice its budget.
     *
     * @param  Reference[]  $refs
     */
    private function draw(string $prompt, array $refs, string $aspect, bool $transparent, array $hints): string
    {
        $this->spend?->checkLimit('drawing '.($hints['label'] ?? $hints['kind'] ?? 'a picture'));
        try {
            return $this->images->generate($prompt, $refs, $aspect, $transparent, $hints);
        } finally {
            // Paid for whether or not it comes back usable. A generator that does not say its price is
            // counted at Spend::UNKNOWN_PICTURE, except the placeholder, which is free.
            if ($this->spend) {
                [$model, $size] = $this->images instanceof PricedImageGenerator ? $this->images->pricing($hints) : [$this->images->describe(), null];
                $this->spend->picture($model, $size, (string) ($hints['kind'] ?? 'picture'), count($refs));
            }
        }
    }

    /** Whether another attempt at a picture may be paid for: not once the budget is spent. */
    private function mayRedraw(): bool
    {
        if ($this->spend?->over()) {
            $this->say('The budget is spent: keeping the best picture so far instead of drawing it again.');

            return false;
        }

        return true;
    }

    /** One animation strip, cut into its frames. Null if it could not be drawn well enough. */
    private function strip(string $key, string $name, string $animation, int $count, Reference $sheet, array $accents, string $variant = ''): ?array
    {
        $assetKey = "strip:$key:$animation".($variant !== '' ? "-$variant" : '');
        $cache = $this->cached($assetKey);
        $notes = [];
        $best = null;
        $attempts = $cache['attempts'] ?? [];
        if ($cache && ! empty($cache['frames'])) {
            return array_map(fn ($f) => ImageTools::load((string) file_get_contents($f)), $cache['frames']);
        }
        $aspect = $count >= 5 ? '21:9' : '16:9';
        for ($attempt = count($attempts) + 1; $attempt <= $this->maxAttempts; $attempt++) {
            if ($attempt > 1 && ! $this->mayRedraw()) {
                break;
            }
            $refs = [$sheet, ...$this->style->anchorsFor('strip')];
            $prompt = $this->style->prompt('strip', "$name ".self::MOTION[$animation], $refs, ['frames' => $count], $notes, $this->images->transparency(), $accents);
            $this->say("Drawing $name: $animation ($count frames), attempt $attempt");
            try {
                $raw = $this->draw($prompt, $refs, $aspect, $this->images->transparency(), ['kind' => 'strip', 'frames' => $count, 'animation' => $animation, 'label' => $name]);
            } catch (GenerationError $e) {
                // One animation that cannot be drawn is not worth the run: the built-in move stands in.
                $attempts[] = ['attempt' => $attempt, 'problem' => $e->getMessage()];
                if ($this->images instanceof Providers\OfflineImageGenerator) {
                    break;
                }

                continue;
            }
            $im = $this->cut(ImageTools::load($raw));
            $boxes = ImageTools::figures($im);
            if (count($boxes) !== $count) {
                // Kept for looking at: why a strip was refused is easier to see than to read.
                file_put_contents("{$this->workDir}/assets/".self::file($assetKey)."-rejected-$attempt.png", $raw);
                $attempts[] = ['attempt' => $attempt, 'problem' => 'found '.count($boxes)." figures, not $count"];
                $notes = ["Draw exactly $count separate full-body figures in one row, clearly apart, none overlapping, none cut off"];

                continue;
            }
            $frames = ImageTools::figureCrops($im);
            $png = ImageTools::png($im);
            $verdict = $this->judge?->judge('strip', $png, $this->style->anchorsFor('strip'), [$sheet], "$count animation frames of $name: $animation", ["show exactly $count frames of the same character as the character sheet", 'frames side by side, same size, feet on one baseline']);
            $attempts[] = ['attempt' => $attempt] + ($verdict ? ['score' => $verdict['score'], 'problems' => $verdict['problems']] : []);
            $score = $verdict['score'] ?? 10;
            if (! $best || $score > $best[0]) {
                $best = [$score, $frames, $verdict];
            }
            if (! $verdict || $verdict['pass']) {
                break;
            }
            $notes = [$verdict['fix']];
        }
        if (! $best) {
            $this->record($assetKey, 'strip', null, $attempts, ['accepted' => false, 'note' => "No usable $animation strip; the built-in move is used instead."]);

            return null;
        }
        $files = [];
        foreach ($best[1] as $i => $frame) {
            $files[] = $file = "{$this->workDir}/assets/".self::file($assetKey)."-$i.png";
            file_put_contents($file, ImageTools::png($frame));
        }
        $this->record($assetKey, 'strip', null, $attempts, ['accepted' => true, 'score' => $best[0], 'below_bar' => $best[2] && ! $best[2]['pass'], 'frames' => $files]);

        return $best[1];
    }

    // ======================================================================= things

    private function item(array $item, array $accents, bool $mounted = false): array
    {
        $vehicle = $item['kind'] === 'vehicle';
        // Drawn to its real size beside the people in the scene: its longest side.
        $longest = Sizes::pixels(Sizes::cm($item));
        $subject = "{$item['name']}: {$item['appearance']}".($mounted ? '. Mounted flat on a wall, seen straight on, with its fixings showing' : '');

        return $this->cutout("item:{$item['key']}", $vehicle ? 'vehicle' : 'item', $subject, $vehicle ? '3:2' : '1:1', $this->style->anchorsFor($vehicle ? 'vehicle' : 'item'), [], $accents, longest: $vehicle && empty($item['size_cm']) ? null : $longest, width: $vehicle && empty($item['size_cm']) ? 340 : null, label: $item['name'], pull: true);
    }

    /** A door, cave mouth or ladder that stands at the back of a scene, or a hole or hatch in its floor. */
    private function passage(array $end, array $accents): array
    {
        $floor = Connections::inFloor($end['via']);
        $kind = $floor ? 'opening' : 'passage';

        return $this->cutout("passage:{$end['via']}:".md5($end['look']), $kind, $end['look'], $floor ? '16:9' : ($end['via'] === 'ladder' ? '9:16' : '3:4'), $this->style->anchorsFor($kind), [], $accents,
            height: $floor ? null : (self::PASSAGE_PX[$end['via']] ?? 360), width: $floor ? (self::OPENING_PX[$end['via']] ?? 300) : null, label: $end['via'], pull: true, hints: ['via' => $end['via']]);
    }

    /**
     * A picture cut out of its background, trimmed, and scaled to a height (or width), judged and
     * retried. Returns the asset: path, width, height.
     */
    private function cutout(string $key, string $kind, string $subject, string $aspect, array $refs, array $subjectRefs, array $accents, ?int $height = null, ?int $width = null, string $label = '', bool $pull = true, bool $portrait = false, ?int $longest = null, array $hints = []): array
    {
        if ($cache = $this->cached($key)) {
            if (! empty($cache['asset'])) {
                return $cache['asset'];
            }
        }
        $result = $this->attempts($key, $kind, $subject, $aspect, $refs, $subjectRefs, $accents, [], ['kind' => $kind, 'label' => $label] + $hints, function (string $raw) use ($height, $width, $longest, $pull, $portrait) {
            $im = $this->cut(ImageTools::load($raw));
            $box = ImageTools::bbox($im) ?? throw new GenerationError('Nothing was left once the background was removed.');
            $touches = $box[0] <= 1 || $box[1] <= 1 || imagesx($im) - 1 <= $box[0] + $box[2] || imagesy($im) - 1 <= $box[1] + $box[3];
            $im = ImageTools::trim($im, 2);
            if ($pull && ($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }
            if ($portrait) {
                $im = $this->portrait($im);
            } elseif ($height || $width || $longest) {
                $s = $longest ? $longest / max(imagesx($im), imagesy($im)) : ($height ? $height / imagesy($im) : $width / imagesx($im));
                $im = ImageTools::resize($im, max(1, (int) round(imagesx($im) * $s)), max(1, (int) round(imagesy($im) * $s)));
            }

            return [$im, $touches && ! $portrait ? 'The whole subject must be inside the picture with a margin of empty background on every side; nothing cut off at the edges' : null];
        });

        return $result;
    }

    /** A portrait: the cut-out head and shoulders on the house backdrop, 320 pixels square. */
    private function portrait(GdImage $bust): GdImage
    {
        $size = 320;
        $out = imagecreatetruecolor($size, $size);
        [$r, $g, $b] = ArtStyle::rgb($this->style->post('portrait_backdrop', '#1F3A68'));
        imagefill($out, 0, 0, imagecolorallocate($out, $r, $g, $b));
        // A lighter disc behind the head, the same in every portrait.
        imagefilledellipse($out, (int) ($size / 2), (int) ($size * 0.45), (int) ($size * 0.86), (int) ($size * 0.86), imagecolorallocate($out, min(255, $r + 28), min(255, $g + 28), min(255, $b + 28)));
        $s = min(($size * 0.95) / imagesx($bust), ($size * 0.92) / imagesy($bust));
        $w = (int) round(imagesx($bust) * $s);
        $h = (int) round(imagesy($bust) * $s);
        imagealphablending($out, true);
        imagecopyresampled($out, $bust, (int) (($size - $w) / 2), $size - $h, 0, 0, $w, $h, imagesx($bust), imagesy($bust));

        return $out;
    }

    // ================================================================== backgrounds

    private function background(array $scene, array $layout, string $setting, array $accents, ?string $time): array
    {
        $key = "bg:{$scene['key']}";
        if (($cache = $this->cached($key)) && ! empty($cache['asset'])) {
            if (! $this->sceneLook) {
                $this->sceneLook = new Reference((string) file_get_contents($cache['asset']['path']), 'another scene of this same mission, but a DIFFERENT place: match how it is painted (colours, light, level of detail), not its buildings, layout, landmarks or sky');
            }

            return $cache['asset'];
        }
        $ground = (float) $scene['ground_line'];
        $notes = [
            sprintf('The walkable floor starts %d%% of the way down the picture and fills everything below that line; keep that floor open, flat and empty, with no objects, plants, rocks or furniture standing on it', round($ground * 100)),
            'No characters, people, animals or creatures',
        ];
        foreach ($layout['exits'] ?? [] as $edge => $what) {
            $notes[] = match ($edge) {
                'left' => "At the far left edge, the floor continues off the picture as an open path or passage ($what)",
                'right' => "At the far right edge, the floor continues off the picture as an open path or passage ($what)",
                'top' => "In the centre of the back edge of the floor, an open doorway, gate or path leading away into the distance ($what)",
                'bottom' => 'The floor continues towards the viewer at the bottom edge',
            };
        }
        $notes[] = match (Sizes::sceneKind($scene)) {
            'indoor' => 'An indoor place, seen from inside: a back wall rises from where the floor ends, with the ceiling or roof beams at the top',
            'underground' => 'An underground place: earthy or rocky walls and a low ceiling, lit by lamps, crystals or light from above',
            'up_high' => 'A place high up: beyond its edge the land, trees or roofs far below and a wide sky',
            'underwater' => 'An underwater place: the sea floor, light rippling down from the surface far above, bubbles',
            default => 'An outdoor place',
        };
        // Doors, holes and ladders are drawn separately and stood in the scene; the background leaves room.
        foreach ($layout['passages'] ?? [] as $p) {
            $at = round($p['x'] * 100).'% of the way from the left';
            $notes[] = Connections::inFloor($p['via'])
                ? "$at, the floor is plain and open (an opening leading {$p['towards']} is added there later; do not paint it)"
                : match ($p['via']) {
                    'door' => "$at, a wall of a building stands at the back of the floor, plain where a door leading {$p['towards']} is added later (do not paint the door)",
                    'cave', 'tunnel' => "$at, a rock face or bank stands at the back of the floor, plain where an opening leading {$p['towards']} is added later (do not paint it)",
                    'ladder', 'stairs_up' => "$at, something tall rises at the back of the floor (a wall, a cliff or a big tree) with a ledge or opening high above, where a way up leading {$p['towards']} is added later (do not paint the ladder or stairs)",
                    default => "$at, the back of the floor is plain where a way through leading {$p['towards']} is added later (do not paint it)",
                };
        }
        foreach ($layout['wall'] ?? [] as $x) {
            $notes[] = 'The back wall is plain and uncluttered '.round($x * 100).'% of the way from the left, a little above the floor (something is hung there later)';
        }
        if ($time) {
            $notes[] = "Time of day: $time";
        }
        $subject = ($setting ? "$setting. " : '')."{$scene['title']}: {$scene['background']}";
        $refs = $this->style->anchorsFor('background');
        if ($this->sceneLook) {
            $refs[] = $this->sceneLook;
        }
        $result = $this->attempts($key, 'background', $subject, '16:9', $refs, [], $accents, $notes, ['kind' => 'background', 'label' => $scene['title'], 'ground_line' => $ground], function (string $raw) {
            $im = ImageTools::cover(ImageTools::load($raw), 2250, 1200);
            if (($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }

            return [$im, null];
        }, jpeg: true);
        $this->sceneLook ??= new Reference((string) file_get_contents($result['path']), 'another scene of this same mission, but a DIFFERENT place: match how it is painted (colours, light, level of detail), not its buildings, layout, landmarks or sky', 'image/jpeg');

        return $result;
    }

    // ===================================================================== attempts

    /**
     * Draw, finish, judge; again with the judge's corrections until it passes or attempts run out.
     * The best attempt is kept either way, and marked when it is below the bar.
     *
     * @param  callable(string): array{GdImage, ?string}  $finish  Returns the finished picture and a problem found without the judge.
     */
    private function attempts(string $key, string $kind, string $subject, string $aspect, array $refs, array $subjectRefs, array $accents, array $notes, array $hints, callable $finish, bool $jpeg = false): array
    {
        $attempts = [];
        $best = null;
        $extra = [];
        for ($attempt = 1; $attempt <= $this->maxAttempts; $attempt++) {
            if ($attempt > 1 && $best && ! $this->mayRedraw()) {
                break;
            }
            $prompt = $this->style->prompt($kind, $subject, $refs, [], [...$notes, ...$extra], $this->images->transparency() && ArtStyle::cutout($kind), $accents);
            $this->say("Drawing $key, attempt $attempt");
            try {
                $raw = $this->draw($prompt, $refs, $aspect, $this->images->transparency() && ArtStyle::cutout($kind), $hints);
                [$im, $problem] = $finish($raw);
            } catch (GenerationError $e) {
                $attempts[] = ['attempt' => $attempt, 'problem' => $e->getMessage()];
                if ($attempt === $this->maxAttempts && ! $best) {
                    throw new GenerationError("Could not draw $key: ".$e->getMessage());
                }

                continue;
            }
            $bytes = $jpeg ? ImageTools::jpeg($im) : ImageTools::png($im);
            $verdict = $this->judge?->judge($kind, $jpeg ? ImageTools::png($im) : $bytes, $this->style->anchorsFor($kind), $subjectRefs, $subject, $notes);
            $distance = ImageTools::paletteDistance($im, $this->style->palette());
            $attempts[] = ['attempt' => $attempt, 'palette_distance' => $distance] + ($verdict ? ['score' => $verdict['score'], 'scores' => $verdict['scores'], 'problems' => $verdict['problems']] : []) + ($problem ? ['problem' => $problem] : []);
            $score = ($verdict['score'] ?? 10) - ($problem ? 3 : 0);
            if (! $best || $score > $best['score']) {
                $best = ['score' => $score, 'bytes' => $bytes, 'width' => imagesx($im), 'height' => imagesy($im), 'pass' => (! $verdict || $verdict['pass']) && ! $problem, 'prompt' => $prompt];
            }
            if ($best['pass'] && $best['bytes'] === $bytes) {
                break;
            }
            $extra = array_values(array_filter([$verdict['fix'] ?? null, $problem]));
        }
        $path = "{$this->workDir}/assets/".self::file($key).($jpeg ? '.jpg' : '.png');
        file_put_contents($path, $best['bytes']);
        $asset = ['path' => $path, 'width' => $best['width'], 'height' => $best['height']];
        $this->record($key, $kind, $best['prompt'], $attempts, ['accepted' => true, 'score' => $best['score'], 'below_bar' => ! $best['pass'], 'asset' => $asset]);
        if (! $best['pass']) {
            $this->say("Kept the best attempt at $key, but it is below the style bar (score {$best['score']}); look at it before publishing.");
        }

        return $asset;
    }

    /** Remove the background: the provider's own transparency if it drew one, else the chroma colour. */
    private function cut(GdImage $im): GdImage
    {
        if (max(imagesx($im), imagesy($im)) > 1600) {
            $im = ImageTools::fit($im, 1600, 1600);
        }

        if (ImageTools::hasTransparentBackground($im)) {
            return $im;
        }
        $chroma = $this->style->chroma();
        $border = ImageTools::borderColour($im);
        // Drawn on the chroma colour, as asked: key it out everywhere, then take its tint off the edges.
        if (! $border || sqrt(array_sum(array_map(fn ($a, $b) => ($a - $b) ** 2, $border, $chroma))) < 90) {
            return ImageTools::despill(ImageTools::chromaKey($im, $chroma), $chroma);
        }

        // Drawn on some other flat colour (often white): remove only what touches the border.
        return ImageTools::chromaKey($im, $border, 60, 0, anywhere: false);
    }

    // ===================================================================== records

    private function record(string $key, string $kind, ?string $prompt, array $attempts, array $extra): void
    {
        $entry = ['key' => $key, 'kind' => $kind, 'provider' => $this->images->describe(), 'style' => $this->style->key.'@'.$this->style->version(), 'prompt' => $prompt, 'attempts' => $attempts] + $extra;
        $this->manifest[$key] = $entry;
        file_put_contents("{$this->workDir}/assets/".self::file($key).'.json', json_encode($entry, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /** A picture accepted by an earlier run of the same generation, if its files are still there. */
    private function cached(string $key): ?array
    {
        $file = "{$this->workDir}/assets/".self::file($key).'.json';
        if (! is_file($file)) {
            return null;
        }
        $entry = json_decode((string) file_get_contents($file), true);
        $paths = array_filter([$entry['asset']['path'] ?? null, ...($entry['frames'] ?? [])]);
        if (! is_array($entry) || empty($entry['accepted']) || ! $paths || array_filter($paths, fn ($p) => ! is_file($p))) {
            return null;
        }
        $this->manifest[$key] = $entry;
        $this->say("Reusing $key from the earlier run");

        return $entry;
    }

    private static function file(string $key): string
    {
        return preg_replace('/[^a-z0-9_-]+/', '-', strtolower($key));
    }

    private function say(string $message): void
    {
        $this->log && ($this->log)($message);
    }

    // ===================================================================== anchors

    /**
     * Candidates for a style's anchors, drawn from its bootstrap descriptions with no references: a
     * person picks the best of each (qbl:art-style --approve) and from then on they define the style.
     *
     * @return array<string, string[]> role => candidate files
     */
    public function anchorCandidates(int $variants = 3, ?array $roles = null): array
    {
        $out = [];
        $character = null;
        foreach ($this->style->bootstrap() as $role => $spec) {
            if ($roles && ! in_array($role, $roles, true)) {
                continue;
            }
            for ($v = 1; $v <= $variants; $v++) {
                $refs = [];
                if ($role === 'portrait' && ($character ??= (is_file($p = $this->style->anchorPath('character')) ? new Reference((string) file_get_contents($p), 'the character sheet: draw exactly this character') : null))) {
                    $refs[] = $character;
                }
                $kind = $spec['kind'];
                $notes = $kind === 'background' ? [sprintf('The walkable floor starts %d%% of the way down the picture and is open and empty', round(($spec['ground_line'] ?? 0.7) * 100)), 'No characters or people'] : [];
                $prompt = $this->style->prompt($kind, $spec['subject'], $refs, [], $notes, $this->images->transparency() && ArtStyle::cutout($kind));
                $this->say("Drawing anchor candidate $role $v");
                // Anchors define the style: always the main image model, never the cheaper props one.
                $raw = $this->draw($prompt, $refs, $kind === 'background' ? '16:9' : ($kind === 'item' ? '16:9' : ($kind === 'portrait' ? '1:1' : '3:4')), $this->images->transparency() && ArtStyle::cutout($kind), ['kind' => $kind, 'label' => "$role $v", 'ground_line' => $spec['ground_line'] ?? 0.7, 'anchor' => true]);
                $im = ImageTools::load($raw);
                if (ArtStyle::cutout($kind)) {
                    $im = ImageTools::trim($this->cut($im), 8);
                }
                $file = "{$this->workDir}/$role-$v.png";
                file_put_contents($file, ImageTools::png($im));
                $out[$role][] = $file;
            }
        }

        return $out;
    }
}
