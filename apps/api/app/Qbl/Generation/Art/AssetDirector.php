<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\Design\BlueprintSchema;
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

    /** The far view behind a scene: as wide as the widest screen's view plus a third of a wide scene's extra length. */
    public const FAR_WIDTH = 2800;

    /** How wide the band of clouds is: it repeats across the sky. */
    public const CLOUDS_WIDTH = 2400;

    /** A foreground's size: a strip along the bottom at most this share of the height, a corner piece this tall. */
    public const FOREGROUND_STRIP = 0.2;

    public const FOREGROUND_CORNER = 0.42;

    /** How tall the question mark over things to click is. */
    public const MARKER_PX = 54;

    private array $manifest = [];

    /** The mission's own first accepted background and character sheet (see 3 above). */
    private ?Reference $sceneLook = null;

    private ?Reference $castLook = null;

    /** @var callable|null */
    private $log;

    /** @var callable|null fn(int, int, string): pictures drawn, for the progress bar */
    private $progress;

    public function __construct(
        private ImageGenerator $images,
        private ArtStyle $style,
        private ?StyleJudge $judge,
        private string $workDir,
        private int $maxAttempts = 3,
        ?callable $log = null,
        private ?Spend $spend = null,
        /** QBL_GEN_PORTRAITS, QBL_GEN_IDLE_FRAMES, QBL_GEN_PROP_SHEETS, QBL_GEN_SCALE_GUIDE: see config/qbl_generation.php. */
        private array $pictures = [],
    ) {
        $this->log = $log;
        $this->pictures += ['portraits' => 'crop', 'idle_frames' => false, 'prop_sheets' => true, 'scale_guide' => true];
        if (! is_dir("$workDir/assets") && ! mkdir("$workDir/assets", 0775, true) && ! is_dir("$workDir/assets")) {
            throw new GenerationError("Cannot create $workDir/assets.");
        }
    }

    /** Be told how many of the mission's pictures are drawn, before each one and at the end (see drawMission). */
    public function onProgress(callable $progress): void
    {
        $this->progress = $progress;
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
        // Progress is counted in the pictures estimate() expects, so the bar moves as the money is spent.
        // Redraws are not known ahead: they slow a step down rather than add steps.
        $total = max(1, $this->estimate($b)['pictures']);
        $done = 0;
        $tick = function (string $detail) use (&$done, $total) {
            $this->progress && ($this->progress)(min($done, $total), $total, $detail);
        };
        $titles = array_column($b['scenes'], 'title', 'key');

        foreach (array_values($b['characters']) as $i => $c) {
            $tick(sprintf('Drawing %s (character %d of %d)', $c['name'], $i + 1, count($b['characters'])));
            $gestures = self::gesturesUsed($b, $c);
            $assets += $this->character($c, $setting, $accents, $gestures);
            // Their sheet, the walk, each gesture, and the idle strip and portrait when those are drawn.
            $done += 2 + count($gestures) + ($this->pictures['idle_frames'] ? 1 : 0) + ($this->pictures['portraits'] === 'draw' ? 1 : 0);
        }
        $afterThings = $done;
        // Small things, several to a picture where it can: items, the tables and rocks they stand on, the marker.
        $things = self::things($b);
        $sheets = $this->pictures['prop_sheets'] && count($things) > 1;
        $afterThings += $sheets ? (int) ceil(count($things) / self::SHEET_MAX) : count($things);
        if ($sheets) {
            $todo = array_filter($things, fn ($t) => ! ($this->cached($t['key'])['asset'] ?? null));
            $chunks = array_chunk($todo, self::SHEET_MAX, true);
            foreach ($chunks as $n => $chunk) {
                $tick(sprintf('Drawing the props: %s', self::listed(array_column($chunk, 'label'))));
                if (count($chunk) > 1) {
                    $this->thingsSheet(array_values($chunk), $accents, $n + 1);
                }
                $done++;
            }
        }
        foreach ($things as $t) {
            if (! $sheets) {
                $tick('Drawing '.$t['label']);
                $done++;
            }
            // Already drawn on a sheet (or by an earlier run), or drawn on its own.
            $assets[$t['asset']] = $this->cutout($t['key'], $t['kind'], $t['subject'], $t['kind'] === 'vehicle' ? '3:2' : '1:1', $this->style->anchorsFor($t['kind']), [], $t['accents'] ? $accents : [], height: $t['fit']['height'] ?? null, width: $t['fit']['width'] ?? null, label: $t['label'], pull: true, longest: $t['fit']['longest'] ?? null);
        }
        // Whatever the sheets did (some cells drawn again alone, some reused), the props are done.
        $done = $afterThings;
        // Where each light's glow goes: the brightest part of its picture.
        foreach ($assets as $key => $asset) {
            if (str_starts_with($key, 'light:') && is_file($asset['path'] ?? '')) {
                $assets[$key]['glow'] = ImageTools::brightSpot(ImageTools::load((string) file_get_contents($asset['path'])));
            }
        }
        // The doors, holes and ladders that lead between scenes.
        foreach (Connections::ends($b) as $scene => $ends) {
            foreach ($ends as $end) {
                if ($end['via'] !== 'edge') {
                    $tick(sprintf('Drawing the %s to %s', str_replace('_', ' ', $end['via']), $titles[$end['to']] ?? $end['to']));
                    $assets["passage:$scene:{$end['to']}"] = $this->passage($end, $accents);
                    $done++;
                }
            }
        }
        foreach (array_values($b['scenes']) as $i => $scene) {
            $tick(sprintf('Painting %s (scene %d of %d)', $scene['title'] ?? $scene['key'], $i + 1, count($b['scenes'])));
            $assets["bg:{$scene['key']}"] = $this->background($scene, $layouts[$scene['key']] ?? [], $setting, $accents, $b['art_direction']['time_of_day'] ?? null);
            $done++;
            if (! empty($scene['distance'])) {
                $tick(sprintf('Painting the far view behind %s', $scene['title'] ?? $scene['key']));
                $assets["far:{$scene['key']}"] = $this->distance($scene, $setting, $accents, $b['art_direction']['time_of_day'] ?? null);
                $done++;
            }
            if (! empty($scene['foreground'])) {
                $tick(sprintf('Drawing the foreground of %s', $scene['title'] ?? $scene['key']));
                $assets["fg:{$scene['key']}"] = $this->foreground($scene, $setting, $accents);
                $done++;
            }
        }
        // Clouds to drift across the living skies: one picture for the whole mission.
        if (self::cloudy($b)) {
            $tick('Drawing the clouds');
            $assets['clouds'] = $this->clouds($setting);
            $done++;
        }
        // Creatures that bring scenes to life: their poses, drawn with the props, made into a little sprite sheet each.
        foreach ($b['scenes'] as $scene) {
            foreach ($scene['ambient'] ?? [] as $a) {
                $poses = [];
                foreach (self::ambientPoses($a) as $pose => $_) {
                    $poses[$pose] = $assets["ambient:{$scene['key']}:{$a['key']}:$pose"] ?? null;
                }
                if (! in_array(null, $poses, true)) {
                    $assets["ambient:{$scene['key']}:{$a['key']}"] = $this->creatureSheet("{$scene['key']}-{$a['key']}", $a, $poses);
                }
            }
        }
        // The quiet question mark over things to click: drawn here, the same in every mission.
        $assets['marker'] = $this->marker();
        if (! empty($b['badge'])) {
            $tick('Drawing the badge: '.$b['badge']['name']);
            $assets['badge'] = $this->cutout('badge', 'badge', "{$b['badge']['name']}: {$b['badge']['appearance']}", '1:1', [], [], $accents, height: 110, label: $b['badge']['name']);
            $done++;
        }
        $done = $total;
        $tick('All the pictures are drawn');

        return $assets;
    }

    /**
     * The small things a mission needs drawn: each item (vehicles too), each table or rock small things
     * stand on, and the marker for interactions without an item. key (as recorded), asset (as
     * MissionBuilder expects), kind, subject, label, fit (the size to scale to), accents.
     *
     * @return array<string, array>
     */
    public static function things(array $b, string $marker = ''): array
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
        // Ambient creatures: each pose a thing of its own, put together into a sprite sheet once drawn.
        foreach ($b['scenes'] as $scene) {
            foreach ($scene['ambient'] ?? [] as $a) {
                $px = Sizes::pixels((int) max(5, min(150, (int) ($a['size_cm'] ?? 25))));
                foreach (self::ambientPoses($a) as $pose => $how) {
                    $key = "ambient:{$scene['key']}:{$a['key']}:$pose";
                    $out[$key] = ['key' => $key, 'asset' => $key, 'kind' => 'item', 'subject' => rtrim($a['look'], '.').", seen from the side facing right, $how", 'label' => "{$a['key']} $pose", 'accents' => true, 'fit' => ['longest' => $px]];
                }
            }
        }
        // Lights stood in scenes (a lantern on its post, a campfire, a beacon on its antenna), lit, so the
        // game's glow can be put where their light is.
        foreach ($b['scenes'] as $scene) {
            foreach (array_values($scene['lights'] ?? []) as $i => $l) {
                $kind = BlueprintSchema::LIGHTS[$l['kind']] ?? BlueprintSchema::LIGHTS['lantern'];
                $out["light:{$scene['key']}:$i"] = [
                    'key' => 'light:'.substr(md5($l['kind'].'|'.$l['look']), 0, 12), 'asset' => "light:{$scene['key']}:$i", 'kind' => 'item',
                    'subject' => rtrim($l['look'], '.').', lit and glowing'.(($l['placement'] ?? null) === 'wall' ? '. Mounted on a wall, seen straight on, with its fixings showing' : ''),
                    'label' => "{$l['kind']} in {$scene['key']}", 'accents' => false,
                    'fit' => ['longest' => Sizes::pixels((int) ($l['height_cm'] ?? $kind['cm']))],
                ];
            }
        }
        // Things to click with no picture of their own are marked by a question mark drawn in code (marker()).

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
        $used = array_values(array_filter($asked, fn ($g) => ($g === 'wave' && $talks) || ($g === 'cheer' && ! empty($c['guide']))));
        // A gesture a cutscene asks of them is played too.
        $beats = [...($b['completion']['cutscene'] ?? [])];
        foreach ([...$b['interactions'], ...($b['twists'] ?? [])] as $row) {
            array_push($beats, ...($row['cutscene'] ?? []));
        }
        foreach ($beats as $beat) {
            if (($beat['who'] ?? '') === $c['key'] && ($beat['do'] ?? '') === 'gesture' && in_array($beat['gesture'] ?? '', BlueprintSchema::GESTURES, true)) {
                $used[] = $beat['gesture'];
            }
        }

        return array_values(array_unique($used));
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
        $things = self::things($b);
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
        if (self::cloudy($b)) {
            $add('clouds');
        }
        foreach ($b['scenes'] as $scene) {
            if (! empty($scene['distance'])) {
                $add('distance');
            }
            if (! empty($scene['foreground'])) {
                $add('foreground');
            }
        }
        if (! empty($b['badge'])) {
            $add('badge');
        }
        $usd = 0.0;
        $spend = $this->spend ?? new Spend;
        foreach ($by as $kind => $n) {
            [$model, $size] = $this->images instanceof PricedImageGenerator ? $this->images->pricing(['kind' => $kind]) : ['placeholder', null];
            // With the references a picture of its kind is sent: the anchors, and a character's sheet for its strips.
            // ...and a background its scale guide.
            $refs = count($this->style->anchorsFor($kind)) + ($kind === 'strip' || $kind === 'portrait' ? 1 : 0) + ($kind === 'background' || $kind === 'character' ? 1 : 0) + ($kind === 'background' && $this->pictures['scale_guide'] ? 1 : 0);
            $each = $spend->pictureWithReferences($model, $size, $refs) + ($this->judge ? self::JUDGE_ESTIMATE_USD : 0);
            $usd += $n * $each * min($this->maxAttempts, self::EXPECTED_ATTEMPTS);
        }

        return ['pictures' => array_sum($by), 'usd' => round($usd, 2), 'by_kind' => $by];
    }

    /** "a, b and c", for the progress bar. */
    private static function listed(array $names): string
    {
        $names = array_values(array_map(fn ($n) => preg_replace(['/^surface (indoor|outdoor)$/', '/^marker$/'], ['a $1 surface', 'the marker'], (string) $n), $names));

        return count($names) > 1 ? implode(', ', array_slice($names, 0, -1)).' and '.end($names) : (string) ($names[0] ?? 'the props');
    }

    /** Where an interaction's item goes; the same rule MissionBuilder uses. */
    public static function placementOf(array $it, ?array $item, array $scene): string
    {
        if (! $item) {
            // Nothing drawn: what students look at is painted into the background, at the back unless it lies on the floor.
            return ($it['placement'] ?? null) === 'ground' ? 'ground' : 'back';
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
            $this->spend?->at($sheetKey, $attempt, "$count things on one sheet");
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
        $t0 = microtime(true);
        $failure = null;
        try {
            return $this->images->generate($prompt, $refs, $aspect, $transparent, $hints);
        } catch (\Throwable $e) {
            $failure = $e->getMessage();
            throw $e;
        } finally {
            // Paid for whether or not it comes back usable. A generator that does not say its price is
            // counted at Spend::UNKNOWN_PICTURE, except the placeholder, which is free.
            if ($this->spend) {
                [$model, $size] = $this->images instanceof PricedImageGenerator ? $this->images->pricing($hints) : [$this->images->describe(), null];
                $this->spend->picture($model, $size, (string) ($hints['kind'] ?? 'picture'), count($refs), microtime(true) - $t0, $failure === null ? 'ok' : 'error', $failure);
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
            $this->spend?->at($assetKey, $attempt, "$name: $animation");
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

    /**
     * How a scene's background is drawn and cut to size: the aspect asked for, the size it comes back at
     * once scaled to the scene's width, and how much of its top is cut off (wide scenes keep their
     * bottom: the floor and the scenery, not the sky). [aspect, drawn width, drawn height, top cut].
     */
    public static function frame(array $scene): array
    {
        $w = Sizes::sceneWidth($scene);
        $h = Sizes::SCENE_HEIGHT;
        [$aspect, $ratio] = $w > 2400 ? ['21:9', 21 / 9] : ['16:9', 16 / 9];
        $drawnH = (int) round($w / $ratio);
        $cut = $w > 2400 ? $drawnH - $h : intdiv($drawnH - $h, 2);

        return [$aspect, $w, $drawnH, max(0, $cut)];
    }

    /** What a background must say about size: how tall a child is, a door, a table, at this picture's scale. */
    public static function scaleNotes(array $scene): array
    {
        [, , $drawnH, $cut] = self::frame($scene);
        $ground = (int) round(Sizes::SCENE_HEIGHT * (float) $scene['ground_line']);
        $pct = fn (float $px) => (int) round(100 * $px / $drawnH);
        $child = Sizes::PERSON_PX;

        return [
            sprintf('SCALE: a 130 cm child standing at the back of the floor is %d%% of the picture\'s height tall (head to feet), and %d%% at the front of the floor. Draw everything to that scale, as seen from a few metres away: a doorway is about %d%% of the picture\'s height, a table top %d%% above the floor, a grown-up %d%%, a two-storey house about %d%%; anything bigger (a big tree, a cliff, a tall building) runs off the top of the picture rather than being shrunk',
                $pct($child * Sizes::DEPTH_BACK), $pct($child * Sizes::DEPTH_FRONT), $pct($child * 1.6 * Sizes::DEPTH_BACK), $pct($child * 0.55), $pct($child * 1.3), $pct($child * 4.4)),
            sprintf('The walkable floor starts %d%% of the way down the picture and fills everything below that line', round(100 * ($ground + $cut) / $drawnH)),
        ];
    }

    private function background(array $scene, array $layout, string $setting, array $accents, ?string $time): array
    {
        $key = "bg:{$scene['key']}";
        $look = 'another scene of this same mission, but a DIFFERENT place: match how it is painted (colours, light, level of detail) and the size of things beside people, not its buildings, layout, landmarks or sky';
        if (($cache = $this->cached($key)) && ! empty($cache['asset'])) {
            if (! $this->sceneLook) {
                $this->sceneLook = new Reference((string) file_get_contents($cache['asset']['path']), $look, str_ends_with($cache['asset']['path'], '.jpg') ? 'image/jpeg' : 'image/png');
            }

            return $cache['asset'];
        }
        [$aspect, $w, $drawnH, $cut] = self::frame($scene);
        $h = Sizes::SCENE_HEIGHT;
        $ground = (int) round($h * (float) $scene['ground_line']);
        $at = fn (float $x) => round($x * 100).'% of the way from the left';
        $down = fn (int $y) => round(100 * ($y + $cut) / $drawnH).'%';
        $notes = self::scaleNotes($scene);
        $floor = $scene['floor'] ?? [];
        $notes[] = 'Keep the floor open, flat and empty, with no objects, plants, rocks or furniture standing on it'.(! empty($floor['blocked']) ? ', except what the requirements below place in it' : '');
        $notes[] = 'No characters, people, animals or creatures';
        if (($floor['left'] ?? 0) > 0.02) {
            $notes[] = 'The floor ends '.$at((float) $floor['left']).' at a wall, a drop or something nobody can cross; left of that is not floor';
        }
        if (($floor['right'] ?? 1) < 0.98) {
            $notes[] = 'The floor ends '.$at((float) $floor['right']).' at a wall, a drop or something nobody can cross; right of that is not floor';
        }
        foreach ($floor['blocked'] ?? [] as $blocked) {
            $notes[] = sprintf('Lying in the middle of the floor %s, about %d%% of the picture\'s width across and flat (seen from the side, it is a low wide shape on the ground): %s', $at((float) $blocked['x']), round(100 * (float) $blocked['width']), $blocked['what']);
        }
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
            'up_high' => 'A place high up: beyond its edge the land, trees or roofs far below',
            'underwater' => 'An underwater place: the sea floor, light rippling down from the surface far above, bubbles',
            default => 'An outdoor place',
        };
        // Doors, holes and ladders are drawn separately and stood in the scene; the background leaves room.
        foreach ($layout['passages'] ?? [] as $p) {
            $notes[] = Connections::inFloor($p['via'])
                ? $at($p['x']).", the floor is plain and open (an opening leading {$p['towards']} is added there later; do not paint it)"
                : match ($p['via']) {
                    'door' => $at($p['x']).", a wall of a building stands at the back of the floor, plain where a door leading {$p['towards']} is added later (do not paint the door)",
                    'cave', 'tunnel' => $at($p['x']).", a rock face or bank stands at the back of the floor, plain where an opening leading {$p['towards']} is added later (do not paint it)",
                    'ladder', 'stairs_up' => $at($p['x']).", something tall rises at the back of the floor (a wall, a cliff or a big tree) with a ledge or opening high above, where a way up leading {$p['towards']} is added later (do not paint the ladder or stairs)",
                    default => $at($p['x']).", the back of the floor is plain where a way through leading {$p['towards']} is added later (do not paint it)",
                };
        }
        foreach ($layout['wall'] ?? [] as $x) {
            $notes[] = 'The back wall is plain and uncluttered '.$at($x).', a little above the floor (something is hung there later)';
        }
        // What students look at where there is no object of its own: part of the painting.
        foreach ($layout['looks'] ?? [] as $l) {
            $notes[] = $l['where'] === 'ground'
                ? $at($l['x']).', on the floor near the back: '.$l['what']
                : $at($l['x']).', at the back of the floor: '.$l['what'].', clearly visible';
        }
        if (($scene['foreground']['where'] ?? null) === 'bottom') {
            $notes[] = 'The lowest part of the floor will be hidden behind something close to the viewer: paint the floor all the way to the bottom edge, plain';
        }
        // With a far view or a living sky behind it, the sky is left flat, to be cut out.
        $distance = ! empty($scene['distance']) || ! empty($scene['sky']);
        if ($distance) {
            $notes[] = "The sky above the scenery is a perfectly flat, solid {$this->style->bible()['chroma']} fill, from the tops of the nearest buildings, trees or hills to the top edge: no clouds, sun, moon, far hills or anything else in it (".(! empty($scene['distance']) ? 'a far view is added behind later' : 'the sky is added behind later').'). Do not use this colour anywhere else';
        }
        if ($time) {
            $notes[] = "Time of day: $time";
        }
        $subject = ($setting ? "$setting. " : '')."{$scene['title']}: {$scene['background']}";
        $refs = $this->style->anchorsFor('background');
        if ($this->sceneLook) {
            $refs[] = $this->sceneLook;
        }
        if ($this->pictures['scale_guide']) {
            $refs[] = $this->guide($scene);
        }
        $chroma = $this->style->chroma();
        $result = $this->attempts($key, 'background', $subject, $aspect, $refs, [], $accents, $notes, ['kind' => 'background', 'label' => $scene['title'], 'ground_line' => ($ground + $cut) / $drawnH, 'sky_key' => $distance], function (string $raw) use ($w, $h, $distance, $chroma) {
            // A wide scene keeps its bottom (the floor and the scenery); a normal one is cut about its middle.
            $im = ImageTools::cover(ImageTools::load($raw), $w, $h, $w > 2400 ? 1.0 : 0.5);
            $problem = null;
            if ($distance) {
                // The flat sky goes, so the far view shows through; only what touches the edges.
                $im = ImageTools::chromaKey($im, $chroma, 110, 0, anywhere: false);
                if (ImageTools::clearShare($im) < 0.04) {
                    $problem = "The sky must be one flat solid {$this->style->bible()['chroma']} colour from the skyline to the top edge, with nothing in it";
                }
            }
            if (($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }

            return [$im, $problem];
        }, jpeg: ! $distance);
        $this->sceneLook ??= new Reference((string) file_get_contents($result['path']), $look, $distance ? 'image/png' : 'image/jpeg');

        return $result;
    }

    /** The scale guide sent with a scene's background (see ImageTools::scaleGuide), at the shape it is drawn. */
    private function guide(array $scene): Reference
    {
        [, $w, $drawnH, $cut] = self::frame($scene);
        $s = 1600 / $w;
        $groundFinal = (int) round(Sizes::SCENE_HEIGHT * (float) $scene['ground_line']);
        $ground = (int) round(($groundFinal + $cut) * $s);
        $blocked = [];
        foreach ($scene['floor']['blocked'] ?? [] as $b) {
            $x = (float) $b['x'] * 1600;
            $half = (float) $b['width'] * 800;
            $y = $ground + (int) ((($drawnH * $s) - $ground) * 0.45);
            $blocked[] = [(int) ($x - $half), (int) ($x + $half), $y - 25, $y + 25];
        }
        $im = ImageTools::scaleGuide(1600, (int) round($drawnH * $s), $ground, (int) round(Sizes::PERSON_PX * $s),
            fn (int $feet) => Sizes::depth((int) round($feet / $s) - $cut, $groundFinal), $blocked);

        return new Reference(ImageTools::png($im), 'a layout and SCALE GUIDE, not a picture to copy: the grey band is the walkable floor, the grey figures show how tall a 130 cm child is at the back, the middle and the front of the floor, and the outline is a doorway beside them. Paint the scene to exactly this scale and layout; do not draw the figures, the outline, the grey or the lines');
    }

    /** The far view behind a scene whose sky is cut out: wider than the screen, drifting slower than the scene. */
    private function distance(array $scene, string $setting, array $accents, ?string $time): array
    {
        $notes = ['No characters, people, animals or buildings close to the viewer', 'The horizon is low, about '.round(100 * max(0.45, (float) $scene['ground_line'] - 0.12)).'% of the way down; below it only far-off land, water or haze'];
        if ($time) {
            $notes[] = "Time of day: $time";
        }
        $subject = ($setting ? "$setting. " : '')."Far behind {$scene['title']}: {$scene['distance']}";
        // With a living sky, the far view's own sky is left flat too, to be cut out: the game draws the sky.
        $sky = ! empty($scene['sky']);
        if ($sky) {
            $notes[] = "The sky above the far land is a perfectly flat, solid {$this->style->bible()['chroma']} fill to the top edge: no clouds, sun, moon or anything else in it (the sky is added behind later). Do not use this colour anywhere else";
        }
        $chroma = $this->style->chroma();

        return $this->attempts("far:{$scene['key']}", 'distance', $subject, '21:9', $this->style->anchorsFor('distance'), [], $accents, $notes, ['kind' => 'distance', 'label' => $scene['title'].' (far)', 'sky_key' => $sky], function (string $raw) use ($sky, $chroma) {
            $im = ImageTools::cover(ImageTools::load($raw), self::FAR_WIDTH, Sizes::SCENE_HEIGHT);
            $problem = null;
            if ($sky) {
                $im = ImageTools::chromaKey($im, $chroma, 110, 0, anywhere: false);
                if (ImageTools::clearShare($im) < 0.04) {
                    $problem = "The sky must be one flat solid {$this->style->bible()['chroma']} colour above the far land, to the top edge, with nothing in it";
                }
            }
            if (($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }

            return [$im, $problem];
        }, jpeg: ! $sky);
    }

    /** Whether any scene has a living sky with clouds in it. */
    public static function cloudy(array $b): bool
    {
        return (bool) array_filter($b['scenes'], fn ($s) => ! empty($s['sky']) && ($s['sky']['clouds'] ?? 'few') !== 'none');
    }

    /**
     * A band of clouds for living skies to drift across: several separate clouds in a row, cut out and
     * kept the full width (empty at both ends), so it repeats without a seam. White and day-lit: the game
     * tints them with the sky's light (gold at sunset, blue at night).
     */
    private function clouds(string $setting): array
    {
        if (($cache = $this->cached('clouds')) && ! empty($cache['asset'])) {
            return $cache['asset'];
        }
        $subject = 'five separate soft fluffy white clouds of different sizes, floating in a row across the picture, well apart from each other, lit from above'.($setting ? ", in the sky of this place: $setting" : '');
        $notes = ['Only the clouds: no ground, no land, no sun, no birds', 'Leave clear space at the far left and far right edges: no cloud touches any edge of the picture'];

        return $this->attempts('clouds', 'clouds', $subject, '21:9', $this->style->anchorsFor('clouds'), [], [], $notes, ['kind' => 'clouds', 'label' => 'clouds'], function (string $raw) {
            $im = $this->cut(ImageTools::load($raw));
            $box = ImageTools::bbox($im) ?? throw new GenerationError('Nothing was left once the background was removed.');
            $touches = $box[0] <= 1 || imagesx($im) - 1 <= $box[0] + $box[2];
            // The whole width, so it repeats seamlessly; only the empty sky above and below goes.
            $im = ImageTools::crop($im, 0, max(0, $box[1] - 6), imagesx($im), min(imagesy($im), $box[3] + 12));
            $im = ImageTools::resize($im, self::CLOUDS_WIDTH, max(1, (int) round(imagesy($im) * self::CLOUDS_WIDTH / imagesx($im))));

            return [$im, $touches ? 'No cloud may touch the left or right edge of the picture: leave clear sky at both ends' : null];
        });
    }

    /** The piece in front of a scene that students walk behind: a low strip along the bottom, or a piece in a corner. */
    private function foreground(array $scene, string $setting, array $accents): array
    {
        $where = $scene['foreground']['where'];
        $w = Sizes::sceneWidth($scene);
        $h = Sizes::SCENE_HEIGHT;
        $subject = rtrim($scene['foreground']['look'], '.').($setting ? ", fitting this place: $setting" : '');
        $notes = $where === 'bottom'
            ? ['A long low strip, many times wider than it is tall, running the whole width of the picture: only its top edge has any shape; its bottom edge and both ends run off the picture']
            : ['It stands in the bottom '.$where.' corner: its bottom edge runs off the bottom of the picture'.($where === 'left' ? ' and its left side off the left edge' : ' and its right side off the right edge')];
        $key = "fg:{$scene['key']}";
        if (($cache = $this->cached($key)) && ! empty($cache['asset'])) {
            return $cache['asset'];
        }

        return $this->attempts($key, 'foreground', $subject, $where === 'bottom' ? '21:9' : '3:4', $this->style->anchorsFor('foreground'), [], $accents, $notes, ['kind' => 'foreground', 'label' => $scene['title'].' (front)', 'where' => $where], function (string $raw) use ($where, $w, $h) {
            $im = ImageTools::trim($this->cut(ImageTools::load($raw)));
            if (! ImageTools::bbox($im)) {
                throw new GenerationError('Nothing was left once the background was removed.');
            }
            if (($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }
            if ($where === 'bottom') {
                // Across the whole width; only its top part shows, the rest being below the scene's edge.
                $im = ImageTools::resize($im, $w, max(1, (int) round(imagesy($im) * $w / imagesx($im))));
                $cap = (int) round($h * self::FOREGROUND_STRIP);
                if (imagesy($im) > $cap) {
                    $im = ImageTools::crop($im, 0, 0, $w, $cap);
                }
            } else {
                $tall = (int) round($h * self::FOREGROUND_CORNER);
                $im = ImageTools::resize($im, max(1, (int) round(imagesx($im) * $tall / imagesy($im))), $tall);
            }

            return [$im, null];
        });
    }

    /** The question mark over things to click, as a picture. */
    private function marker(): array
    {
        $path = "{$this->workDir}/assets/marker.png";
        $im = ImageTools::questionMark(self::MARKER_PX);
        file_put_contents($path, ImageTools::png($im));

        return ['path' => $path, 'width' => imagesx($im), 'height' => imagesy($im)];
    }

    /** The poses an ambient creature is drawn in, by how it moves: name => how. */
    public static function ambientPoses(array $a): array
    {
        return match ($a['motion'] ?? 'lands') {
            'lands' => ['rest' => 'standing on the ground, still', 'up' => 'flying, wings raised high', 'down' => 'flying, wings swept down'],
            'flies_by' => ['up' => 'flying, wings raised high', 'down' => 'flying, wings swept down'],
            'swims_by' => ['up' => 'swimming, tail curved up', 'down' => 'swimming, tail curved down'],
            default => ['up' => 'walking, mid-stride with its legs apart', 'down' => 'walking, its legs passing under its body'],
        };
    }

    /**
     * A creature's poses as one sprite sheet, with an `idle` (still, or its first frame) and a `move`
     * (the moving frames, looping), for MissionBuilder to show and move about.
     */
    private function creatureSheet(string $name, array $a, array $poses): array
    {
        $frames = array_map(fn ($p) => ImageTools::load((string) file_get_contents($p['path'])), $poses);
        $cw = max(array_map('imagesx', $frames)) + 8;
        $ch = max(array_map('imagesy', $frames)) + 8;
        $cells = array_map(fn ($f) => ImageTools::cell($f, $cw, $ch, 1.0, 4), array_values($frames));
        $sheet = ImageTools::sheet([$cells], $cw, $ch, count($cells));
        $path = "{$this->workDir}/assets/".self::file("ambient:$name").'.png';
        file_put_contents($path, ImageTools::png($sheet));
        $names = array_keys($poses);
        $moveFrames = array_keys(array_filter($names, fn ($n) => $n !== 'rest'));
        $idle = isset($poses['rest']) ? [array_search('rest', $names, true)] : [$moveFrames[0]];

        return [
            'path' => $path, 'width' => imagesx($sheet), 'height' => imagesy($sheet), 'frame_width' => $cw, 'frame_height' => $ch,
            'params' => ['sheet' => ['columns' => count($cells), 'rows' => 1], 'animations' => [
                ['name' => 'idle', 'frames' => $idle, 'duration' => 600],
                ['name' => 'move', 'frames' => $moveFrames, 'duration' => ($a['motion'] ?? '') === 'walks_by' ? 500 : 280, 'repeat' => true],
            ]],
        ];
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
            $this->spend?->at($key, $attempt, ($hints['label'] ?? '') !== '' ? (string) $hints['label'] : $key);
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
        $this->logAttempts($key, $attempts, $extra);
        file_put_contents("{$this->workDir}/assets/".self::file($key).'.json', json_encode($entry, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    }

    /**
     * Tells the audit log how each attempt at a picture came out: which one was kept (the one the
     * attempts loops chose: most cells filled, then the highest score, the first of equals), and each
     * attempt's judge score.
     */
    private function logAttempts(string $key, array $attempts, array $extra): void
    {
        if (! $this->spend || ! $attempts) {
            return;
        }
        $kept = null;
        if (($extra['accepted'] ?? true) !== false) {
            $best = null;
            foreach ($attempts as $a) {
                if (isset($a['problem']) && ! isset($a['score'])) {
                    continue;
                }
                $rank = [(int) ($a['cells'] ?? 0), (float) ($a['score'] ?? 10) - (isset($a['problem']) ? 3 : 0)];
                if (! $best || $rank > $best[0]) {
                    $best = [$rank, (int) $a['attempt']];
                }
            }
            $kept = $best[1] ?? null;
        }
        $this->spend->attempts($key, $attempts, $kept, ! empty($extra['below_bar']) ? 'kept below the style bar' : null);
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
                $this->spend?->at("anchor:$role-$v", 1, "anchor candidate $role $v");
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
