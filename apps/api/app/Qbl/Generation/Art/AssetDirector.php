<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\GenerationError;
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
 */
class AssetDirector
{
    public const SIZES = ['small' => 130, 'medium' => 230, 'large' => 400];

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
    ) {
        $this->log = $log;
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
            $assets += $this->character($c, $setting, $accents);
        }
        foreach ($b['items'] as $item) {
            $assets["item:{$item['key']}"] = $this->item($item, $accents);
        }
        foreach ($b['scenes'] as $scene) {
            $assets["bg:{$scene['key']}"] = $this->background($scene, $layouts[$scene['key']] ?? [], $setting, $accents, $b['art_direction']['time_of_day'] ?? null);
        }
        // Interactions with no item of their own (a question, an inspection of the scenery) get the style's marker.
        if (array_filter($b['interactions'], fn ($it) => $it['type'] !== 'talk' && empty($it['item']))) {
            $assets['marker'] = $this->cutout('marker', 'item', (string) ($this->style->bible()['marker'] ?? 'a small glowing beacon'), '1:1', $this->style->anchorsFor('item'), [], [], height: 120, label: 'marker', pull: true);
        }
        if (! empty($b['badge'])) {
            $assets['badge'] = $this->cutout('badge', 'badge', "{$b['badge']['name']}: {$b['badge']['appearance']}", '1:1', [], [], $accents, height: 110, label: $b['badge']['name']);
        }

        return $assets;
    }

    // ==================================================================== characters

    private function character(array $c, string $setting, array $accents): array
    {
        $key = $c['key'];
        $subject = "{$c['name']}, {$c['appearance']}";

        // 1. The character sheet: the design every other picture of them is drawn from.
        $refs = $this->style->anchorsFor('character');
        if ($this->castLook) {
            $refs[] = $this->castLook;
        }
        $sheet = $this->cutout("design:$key", 'character', $subject, '3:4', $refs, [], $accents, height: 640, label: $c['name'], pull: true);
        $sheetRef = new Reference((string) file_get_contents($sheet['path']), "the character sheet of {$c['name']}: draw exactly this character, same design, outfit, colours and proportions");
        $this->castLook ??= new Reference($sheetRef->bytes, 'another character from the same game: match its style, not its design');
        $sheetIm = ImageTools::load($sheetRef->bytes);
        $sheetStats = ImageTools::labStats($sheetIm);

        // 2. Their portrait, drawn from the sheet and set on the house backdrop.
        $portrait = $this->cutout("portrait:$key", 'portrait', $c['name'].' ('.$c['appearance'].')', '1:1', [$sheetRef, ...$this->style->anchorsFor('portrait')], [$sheetRef], $accents, height: null, label: $c['name'].' portrait', pull: true, portrait: true);

        // 3. Their animations, a strip each, drawn from the sheet.
        $rows = [];
        $animations = [];
        $columns = 1;
        $wanted = array_unique(['idle', 'walk', ...array_values(array_intersect($c['gestures'] ?? [], array_keys(self::ANIMATIONS)))]);
        foreach ($wanted as $name) {
            [$count, $duration, $loops] = self::ANIMATIONS[$name];
            $frames = $this->strip($key, "{$c['name']} ({$c['appearance']})", $name, $count, $sheetRef, $accents);
            if ($frames === null) {
                continue; // the built-in moves cover anything not drawn
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

    /** One animation strip, cut into its frames. Null if it could not be drawn well enough. */
    private function strip(string $key, string $name, string $animation, int $count, Reference $sheet, array $accents): ?array
    {
        $assetKey = "strip:$key:$animation";
        $cache = $this->cached($assetKey);
        $notes = [];
        $best = null;
        $attempts = $cache['attempts'] ?? [];
        if ($cache && ! empty($cache['frames'])) {
            return array_map(fn ($f) => ImageTools::load((string) file_get_contents($f)), $cache['frames']);
        }
        $aspect = $count >= 5 ? '21:9' : '16:9';
        for ($attempt = count($attempts) + 1; $attempt <= $this->maxAttempts; $attempt++) {
            $refs = [$sheet, ...$this->style->anchorsFor('strip')];
            $prompt = $this->style->prompt('strip', "$name ".self::MOTION[$animation], $refs, ['frames' => $count], $notes, $this->images->transparency(), $accents);
            $this->say("Drawing $name: $animation ($count frames), attempt $attempt");
            $raw = $this->images->generate($prompt, $refs, $aspect, $this->images->transparency(), ['kind' => 'strip', 'frames' => $count, 'animation' => $animation, 'label' => $name]);
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

    private function item(array $item, array $accents): array
    {
        $vehicle = $item['kind'] === 'vehicle';
        $height = self::SIZES[$item['size']] ?? self::SIZES['medium'];

        return $this->cutout("item:{$item['key']}", $vehicle ? 'vehicle' : 'item', "{$item['name']}: {$item['appearance']}", $vehicle ? '3:2' : '1:1', $this->style->anchorsFor($vehicle ? 'vehicle' : 'item'), [], $accents, height: $vehicle ? null : $height, width: $vehicle ? 340 : null, label: $item['name'], pull: true);
    }

    /**
     * A picture cut out of its background, trimmed, and scaled to a height (or width), judged and
     * retried. Returns the asset: path, width, height.
     */
    private function cutout(string $key, string $kind, string $subject, string $aspect, array $refs, array $subjectRefs, array $accents, ?int $height = null, ?int $width = null, string $label = '', bool $pull = true, bool $portrait = false): array
    {
        if ($cache = $this->cached($key)) {
            if (! empty($cache['asset'])) {
                return $cache['asset'];
            }
        }
        $result = $this->attempts($key, $kind, $subject, $aspect, $refs, $subjectRefs, $accents, [], ['kind' => $kind, 'label' => $label], function (string $raw) use ($height, $width, $pull, $portrait) {
            $im = $this->cut(ImageTools::load($raw));
            $box = ImageTools::bbox($im) ?? throw new GenerationError('Nothing was left once the background was removed.');
            $touches = $box[0] <= 1 || $box[1] <= 1 || imagesx($im) - 1 <= $box[0] + $box[2] || imagesy($im) - 1 <= $box[1] + $box[3];
            $im = ImageTools::trim($im, 2);
            if ($pull && ($strength = (float) $this->style->post('palette_pull', 0)) > 0) {
                $im = ImageTools::pullToPalette($im, $this->style->palette(), $strength);
            }
            if ($portrait) {
                $im = $this->portrait($im);
            } elseif ($height || $width) {
                $s = $height ? $height / imagesy($im) : $width / imagesx($im);
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
            $prompt = $this->style->prompt($kind, $subject, $refs, [], [...$notes, ...$extra], $this->images->transparency() && ArtStyle::cutout($kind), $accents);
            $this->say("Drawing $key, attempt $attempt");
            try {
                $raw = $this->images->generate($prompt, $refs, $aspect, $this->images->transparency() && ArtStyle::cutout($kind), $hints);
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
            $this->say("Kept the best of {$this->maxAttempts} attempts at $key, but it is below the style bar (score {$best['score']}); look at it before publishing.");
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
                $raw = $this->images->generate($prompt, $refs, $kind === 'background' ? '16:9' : ($kind === 'item' ? '16:9' : ($kind === 'portrait' ? '1:1' : '3:4')), $this->images->transparency() && ArtStyle::cutout($kind), ['kind' => $kind, 'label' => "$role $v", 'ground_line' => $spec['ground_line'] ?? 0.7]);
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
