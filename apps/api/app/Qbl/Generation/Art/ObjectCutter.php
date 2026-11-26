<?php

namespace App\Qbl\Generation\Art;

use GdImage;

/**
 * Lifts a thing that stands on the floor out of a background picture, pixel for pixel, onto a
 * transparent picture of its own: a tree, a lamp post, a bench, a crate, a railing. Placed exactly
 * over its counterpart in the background it cannot be told apart from it, yet it is an item, sorted
 * among the figures by its sort line: people walk in front of it and behind it.
 *
 * How the thing is told from what is behind it. The house style outlines everything in a dark line
 * and fills it with flat colour. Starting from the edges of a region a little bigger than the thing
 * (where only scenery is), everything reachable without crossing an outline is scenery; what is left
 * inside is the thing. Then, in order:
 *
 *   1. Sealing. A soft or broken outline lets the flood run inside a thing and hollow it out. The
 *      outlines are first thickened by a pixel, which seals gaps of two or three pixels. If what is
 *      left does not fill the outline the surveyor drew around the thing, the cutter tries again: with
 *      the scenery's own colours as a second wall (the flood only runs through colours seen around the
 *      thing), then with thicker seals. The first try that fits is used.
 *   2. Thin parts. A chair's leg, a railing's baluster or a bare branch is often all outline, with no
 *      fill inside. Lines joined to the thing's outline are part of the thing, unless they run out of the
 *      region (the floor's edge, a wall's base: scenery passing behind).
 *   3. Openings. What is enclosed by the thing is either the thing (a plank of a crate, a seat) or
 *      scenery seen through it (the floor between a table's legs, the wall between a railing's posts, the
 *      sky between branches, a shadow on the floor). Each enclosed patch is compared with the colours of
 *      the scenery just around the thing, and with the thing's own colours, and opened or kept by what
 *      kind of thing it is (OPENINGS):
 *        none     solid all through: a crate, a barrel, a rock, a statue, a post. Nothing inside is
 *                 opened, and anything the flood hollowed out is filled back. Only a shadow lying on the
 *                 floor beside it is left out.
 *        under    solid, but with gaps beneath or between legs: a table, a chair, a bench, a cart, a
 *                 stall, a well. A patch is opened when it is clearly the scenery's colour (and not the
 *                 thing's); its biggest part is never opened.
 *        lattice  mostly gaps: a railing, a fence, a gate, a ladder, a climbing frame. Every patch that
 *                 looks like the scenery is opened, its biggest included.
 *        leafy    a tree, a bush, a plant: only clear gaps of some size among the leaves are opened (the
 *                 sky through a canopy); small flecks between leaves stay.
 *      A shadow on the floor (a darker patch of the floor's own colour, low and flat at the thing's base)
 *      is opened for every kind: it belongs to the floor, and a figure standing on it must not be hidden.
 *   4. Edges. The outer pixels of the outline are a blend of the outline and what was behind it. Each
 *      is given the alpha that blend says (from the scenery's colour beside it and the thing's beside
 *      it) and its own colour without the scenery mixed in, so the thing has a clean soft edge over
 *      whatever passes behind it, and over its own background it adds back up to the original pixels.
 *      Pixels further in are the background's own, exactly.
 *
 * A region too small for the thing (the box the surveyor gave was tight, so the thing runs out of it)
 * is grown on that side and cut again. When no try fills the outline the surveyor drew (a dark thing
 * on a dark floor, with nothing painted between them), everything inside that outline comes too, but
 * for the openings found ("+drawn"): a sliver of floor with it is far less wrong than a part of it
 * missing. When nothing works at all, that outline alone is used ("drawn").
 */
final class ObjectCutter
{
    /** A pixel is an outline where its colour jumps this much (summed RGB) to a neighbour, or it is this dark. */
    private const EDGE = 96;

    /** The same, across a soft line two pixels wide (from the pixel before to the pixel after). */
    private const SOFT_EDGE = 125;

    private const DARK = 58;

    /** How far into its outline the thing reaches from its fill, in pixels. */
    private const OUTLINE = 4;

    /** How things can be seen through: see the class comment. */
    public const OPENINGS = ['none', 'under', 'lattice', 'leafy'];

    /** What the surveyor's kinds are, when it does not say. */
    private const KIND_OPENINGS = [
        'tree' => 'leafy', 'bush' => 'leafy', 'plant' => 'leafy', 'rock' => 'none', 'post' => 'none',
        'furniture' => 'under', 'structure' => 'under', 'railing' => 'lattice', 'other' => 'under',
    ];

    /** Words in a thing's name that say how it is open, checked in this order. */
    private const WORDS = [
        'lattice' => ['rail', 'fence', 'gate', 'banister', 'balust', 'trellis', 'ladder', 'rack', 'scaffold', 'lattice', 'grille', 'grate', 'cage', 'climbing frame', 'jungle gym', 'swing', 'arch', 'hurdle'],
        'none' => ['crate', 'barrel', 'cask', 'chest', 'rock', 'boulder', 'stone', 'statue', 'pillar', 'column', 'stump', 'cabinet', 'counter', 'kiosk', 'box', 'bin', 'sack', 'pot', 'vase', 'urn', 'block', 'safe', 'locker', 'fridge', 'oven', 'stove', 'cactus', 'hay bale', 'bale', 'pole', 'post', 'trunk'],
        'under' => ['chair', 'table', 'bench', 'stool', 'desk', 'bed', 'cart', 'wagon', 'stall', 'easel', 'piano', 'stand', 'trolley', 'bike', 'bicycle', 'seat', 'sofa', 'couch', 'well', 'gazebo', 'sign', 'telescope', 'tripod', 'lamp'],
        'leafy' => ['tree', 'bush', 'hedge', 'shrub', 'plant', 'flower', 'fern', 'palm', 'vine', 'reed', 'grass', 'sapling'],
    ];

    /** The least share of the drawn outline (or the box, without one) the thing must fill, by openings: [with an outline, with a box only]. */
    private const MIN_COVER = ['none' => [0.65, 0.5], 'under' => [0.65, 0.45], 'lattice' => [0.55, 0.4], 'leafy' => [0.55, 0.4]];

    /** A shadow is the scenery's colour times one of these. */
    private const SHADE = [0.45, 0.58, 0.72, 0.86];

    private int $w;

    private int $h;

    private int $n;

    private string $zero;

    private string $notFirst;

    private string $notLast;

    /** @var list<int> */
    private array $rgb = [];

    /**
     * How a thing can be seen through (OPENINGS): what the surveyor said, else what its name says (a
     * "wooden crate" is solid, a "park bench" open beneath), else what its kind usually is.
     */
    public static function openingsFor(string $kind, string $name = '', ?string $said = null): string
    {
        if ($said !== null && in_array($said, self::OPENINGS, true)) {
            return $said;
        }
        $name = mb_strtolower($name);
        foreach (self::WORDS as $openings => $words) {
            foreach ($words as $word) {
                if ($name !== '' && preg_match('/\b'.preg_quote($word, '/').'/u', $name)) {
                    return $openings;
                }
            }
        }

        return self::KIND_OPENINGS[$kind] ?? 'under';
    }

    /**
     * @param  array{0: int, 1: int, 2: int, 3: int}  $box  x0, y0, x1, y1 in the picture's pixels: about where the thing is.
     * @param  list<array{0: int, 1: int}>  $outline  Optional: points around the thing, in the picture's pixels.
     * @param  string  $openings  How it can be seen through (OPENINGS; openingsFor()).
     * @return array{image: GdImage, x: int, y: int, width: int, height: int, how: string, footprint: array{0: int, 1: int}, openings: string, opened: int, open: float}|null
     *                                                                                                                                                                       The cut-out, where its top left goes in the picture, how it was found ("outline", "colour", either "+drawn" when the
     *                                                                                                                                                                       surveyor's outline had to fill it out, or "drawn"), where its base is
     *                                                                                                                                                                       across the picture, and how much of it was opened to show the scenery through it. Null when nothing could be lifted out.
     */
    public static function cut(GdImage $picture, array $box, array $outline = [], string $openings = 'under'): ?array
    {
        if (! in_array($openings, self::OPENINGS, true)) {
            $openings = 'under';
        }
        $W = imagesx($picture);
        $H = imagesy($picture);
        $box = [max(0, $box[0]), max(0, $box[1]), min($W - 1, $box[2]), min($H - 1, $box[3])];
        $bw = $box[2] - $box[0] + 1;
        $bh = $box[3] - $box[1] + 1;
        if ($bw < 8 || $bh < 8) {
            return null;
        }
        // A margin of scenery all round, where the flood starts; more below, where boxes most often stop short.
        $pad = (int) max(16, round(0.1 * max($bw, $bh)));
        $extra = [0, 0, 0, (int) round($pad * 0.5)];
        $grown = [0, 0, 0, 0];
        $result = null;
        for ($round = 0; $round < 3; $round++) {
            $region = [max(0, $box[0] - $pad - $extra[0]), max(0, $box[1] - $pad - $extra[1]), min($W - 1, $box[2] + $pad + $extra[2]), min($H - 1, $box[3] + $pad + $extra[3])];
            $try = (new self)->run($picture, $box, $outline, $openings, $region, $grown);
            if ($try === null) {
                break;
            }
            $result = $try;
            if (! $try['short']) {
                break;
            }
            // It runs out of the region on these sides: look further that way.
            foreach ($try['short'] as $side) {
                $extra[$side] += 2 * $pad;
                $grown[$side] += 2 * $pad;
            }
        }
        if ($result) {
            unset($result['short']);
        }

        return $result;
    }

    private function __construct() {}

    /** One cut within a region: see the class comment. */
    private function run(GdImage $picture, array $box, array $outline, string $openings, array $region, array $grown): ?array
    {
        $W = imagesx($picture);
        $H = imagesy($picture);
        [$rx0, $ry0, $rx1, $ry1] = $region;
        $w = $this->w = $rx1 - $rx0 + 1;
        $h = $this->h = $ry1 - $ry0 + 1;
        $n = $this->n = $w * $h;
        $this->zero = str_repeat("\0", $n);
        $this->notFirst = str_repeat("\0".str_repeat("\1", $w - 1), $h);
        $this->notLast = str_repeat(str_repeat("\1", $w - 1)."\0", $h);
        $bw = $box[2] - $box[0] + 1;
        $bh = $box[3] - $box[1] + 1;
        $b = [$box[0] - $rx0, $box[1] - $ry0, $box[2] - $rx0, $box[3] - $ry0];

        // The region's colours, which pixels are see-through already (a keyed-out sky: scenery), and which are dark.
        $rgb = array_fill(0, $n, 0);
        $clear = $this->zero;
        $dark = $this->zero;
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $c = imagecolorat($picture, $rx0 + $x, $ry0 + $y);
                $i = $y * $w + $x;
                $rgb[$i] = $c & 0xFFFFFF;
                if ((($c >> 24) & 0x7F) > 100) {
                    $clear[$i] = "\1";
                } elseif (self::luma($c) < self::DARK) {
                    $dark[$i] = "\1";
                }
            }
        }
        $this->rgb = $rgb;
        // Ink is a dark line, a few pixels thick. A wide dark area (a dark-coloured thing, a dark scene's
        // shadows) is fill, told from its neighbours by its edges, not a wall all through.
        $ink = $dark & self::not($this->grow($this->shrink($dark, 4), 4));
        $wall = $this->edges($clear, $ink);

        // Where the thing may be: the box, and the surveyor's outline, grown (they are only roughly drawn).
        $boxMask = $this->rect($b[0], $b[1], $b[2], $b[3]);
        $d = (int) max(12, round(0.08 * max($bw, $bh)));
        $poly = $outline ? self::polygonMask($outline, $rx0, $ry0, $w, $h, 1.0) : null;
        if ($poly !== null && substr_count($poly, "\1") < 64) {
            $poly = null;
        }
        $zone = $this->grow($boxMask, intdiv($d, 2));
        if ($poly !== null) {
            $zone |= $this->grow($poly, $d);
        }
        // Where the region was grown because the thing ran out of it, the thing may be too.
        if (array_sum($grown)) {
            $zone |= $this->rect($grown[0] ? 0 : $b[0], $grown[1] ? 0 : $b[1], $grown[2] ? $w - 1 : $b[2], $grown[3] ? $h - 1 : $b[3]);
        }
        // Inside the outline (grown a little), nothing is a seed: a box drawn too tight must not start the flood inside the thing.
        $noSeed = $poly !== null ? self::polygonMask($outline, $rx0, $ry0, $w, $h, 1.08) : $this->zero;

        // Which sides of the region the flood starts from (not a picture edge the thing runs off), and which may grow.
        $grows = [$rx0 > 0, $ry0 > 0, $rx1 < $W - 1, $ry1 < $H - 1];
        $starts = [$rx0 > 0 || $box[0] > 2, $ry0 > 0 || $box[1] > 2, $rx1 < $W - 1 || $box[2] < $W - 3, true];
        $seeds = [];
        for ($x = 0; $x < $w; $x++) {
            if ($starts[1]) {
                $seeds[] = $x;
            }
            if ($starts[3]) {
                $seeds[] = ($h - 1) * $w + $x;
            }
        }
        for ($y = 0; $y < $h; $y++) {
            if ($starts[0]) {
                $seeds[] = $y * $w;
            }
            if ($starts[2]) {
                $seeds[] = $y * $w + $w - 1;
            }
        }

        // The scenery's colours around the thing (outside its box): a second wall for the flood, when outlines leak.
        $ring = self::not($this->grow($boxMask, 2)) & self::not($wall) & self::not($clear);
        $ringColours = substr_count($ring, "\1") >= 200 ? self::palette($this->colourCounts($ring, 1), 0.0005) : null;
        $foreign = null;
        if ($ringColours) {
            $foreign = $this->zero;
            for ($i = 0; $i < $n; $i++) {
                if ($clear[$i] === "\0" && ! isset($ringColours[self::bin($rgb[$i])])) {
                    $foreign[$i] = "\1";
                }
            }
        }

        // Try: outlines sealed by a pixel; then the scenery's colours as a wall too; then thicker seals.
        [$minCover, $minBoxCover] = self::MIN_COVER[$openings];
        $best = null;
        foreach ([[1, false], [1, true], [2, false], [2, true], [3, true]] as [$seal, $colour]) {
            if ($colour && $foreign === null) {
                continue;
            }
            $base = $colour ? ($wall | $foreign) : $wall;
            $block = $this->grow($base, $seal);
            $reached = $this->flood(self::not($block), array_values(array_filter($seeds, fn ($i) => $noSeed[$i] === "\0")));
            // Back out to where the seal stood, through anything that is not a wall.
            $open = self::not($base);
            for ($k = 0; $k < $seal; $k++) {
                $reached |= $this->grow4($reached) & $open;
            }
            $core = self::not($reached) & self::not($wall);
            $pieces = $this->pieces($core, $b, $zone);
            if ($pieces === null) {
                continue;
            }
            $band = $pieces['kept'];
            for ($k = 0; $k < self::OUTLINE; $k++) {
                $band |= $this->grow4($band) & $wall;
            }
            // Straight lines of the scenery crossing the region (a wall's base behind a table): not the thing's.
            [$lines, $normals] = $this->sceneryLines($wall & $ink, $wall, $pieces['kept']);
            $near = ($poly !== null ? $this->grow($poly, max(6, intdiv($d, 2))) : $this->grow($boxMask, 4)) | ($zone & self::not($this->grow($boxMask, intdiv($d, 2))));
            [$thin, $short] = $this->thinParts($wall & $ink & self::not($band) & self::not($lines), $band & self::not($lines), $zone, $near, $grows, $lines, $normals, $pieces['kept']);
            // The fill between a thin part's two lines (a leg's wood, a baluster's paint), where it is no more than a pixel or two.
            $thin |= $this->shrink($this->grow($thin, 1), 1) & $wall & self::not($band) & self::not($lines);
            $shape = ($band & self::not($lines)) | $thin;
            $filled = self::not($this->flood(self::not($shape), $this->borderOf()));
            $area = substr_count($filled, "\1");
            if ($area < 64) {
                continue;
            }
            // How much of where the surveyor drew it the flood left alone (the thing, and what it encloses).
            // Things open beneath or between are measured across their span (the floor between a table's legs is
            // rightly not the table, but a leg missing is missed).
            $ref = $poly ?? $boxMask;
            $body = $filled | $pieces['kept'];
            if ($openings === 'under' || $openings === 'lattice') {
                $body = $this->spans($body);
            }
            $cover = substr_count($body & $ref, "\1") / max(1, substr_count($ref, "\1"));
            $spill = substr_count($filled & self::not($zone), "\1") / $area;
            $ringLeft = substr_count($ring, "\1");
            $ringReach = $ringLeft ? substr_count($reached & $ring, "\1") / $ringLeft : 1.0;
            $fits = $cover >= ($poly !== null ? $minCover : $minBoxCover) && $spill <= 0.15 && $ringReach >= 0.25;
            $score = $cover - 2 * $spill + ($ringReach >= 0.25 ? 0 : -1);
            $try = compact('reached', 'core', 'pieces', 'band', 'thin', 'short', 'filled', 'score', 'lines', 'normals', 'fits') + ['how' => $colour ? 'colour' : 'outline'];
            if ($fits) {
                $best = $try;
                break;
            }
            if ($best === null || $score > $best['score']) {
                $best = $try;
            }
        }
        if ($best === null || $best['score'] < -0.5) {
            if ($poly === null) {
                return null;
            }

            return $this->finish($picture, $region, self::polygonMask($outline, $rx0, $ry0, $w, $h, 1.0), $clear, 'drawn', $openings, 0, 0.0, [], $this->zero, []);
        }

        [$mask, $opened, $openShare, $holes] = $this->openings($best, $wall, $ink, $clear, $openings);
        $how = $best['how'];
        if (! $best['fits'] && $poly !== null) {
            // Nothing told it from what is around it well enough to fill the outline the surveyor drew (a dark
            // thing on a dark floor). Missing part of it is worse than a sliver of floor: all inside that outline
            // comes too, but for the openings found.
            $mask |= self::polygonMask($outline, $rx0, $ry0, $w, $h, 0.97) & self::not($holes);
            $how .= '+drawn';
        }
        $short = $best['short'];
        // The thing itself at the region's edge (not a picture edge): it runs on past it.
        foreach ($this->touching($mask) as $side) {
            if ($grows[$side] && ! in_array($side, $short, true)) {
                $short[] = $side;
            }
        }

        return $this->finish($picture, $region, $mask, $clear, $how, $openings, $opened, $openShare, $short, $best['lines'], $best['normals']);
    }

    /**
     * Which enclosed patches are the thing and which are scenery seen through it (see the class
     * comment), and the thing's mask once they are opened.
     *
     * @return array{0: string, 1: int, 2: float, 3: string} the mask, how many patches were opened, what share of the thing's outline they are, and the openings
     */
    private function openings(array $cut, string $wall, string $ink, string $clear, string $openings): array
    {
        $w = $this->w;
        $n = $this->n;
        $rgb = $this->rgb;
        ['labels' => $labels, 'info' => $info, 'keep' => $keep] = $cut['pieces'];
        $filled = $cut['filled'];
        $reached = $cut['reached'];

        // The patches: every piece kept, and every other piece enclosed by the thing (a pocket).
        $patches = [];
        foreach ($info as $id => $p) {
            if (isset($keep[$id]) || $filled[$p['first']] === "\1") {
                $patches[$id] = $p + ['kept' => isset($keep[$id])];
            }
        }
        // The outline's box, for where a patch is in the thing (a shadow is low and flat).
        [$sy0, $sy1] = [PHP_INT_MAX, -1];
        for ($i = strpos($filled, "\1"); $i !== false && $i < $n; $i = strpos($filled, "\1", $i + 1)) {
            $y = intdiv($i, $w);
            $sy0 = min($sy0, $y);
            $sy1 = max($sy1, $y);
        }
        $sh = max(1, $sy1 - $sy0 + 1);
        $area = substr_count($filled, "\1");

        // Samples of each patch's pixels, and the colours of each.
        $samples = [];
        $step = [];
        foreach ($patches as $id => $p) {
            $step[$id] = max(1, intdiv($p['count'], 3000));
            $samples[$id] = [];
        }
        $seen = [];
        for ($i = 0; $i < $n; $i++) {
            $l = $labels[$i];
            if ($l && isset($patches[$l])) {
                $seen[$l] = ($seen[$l] ?? 0) + 1;
                if ($seen[$l] % $step[$l] === 0) {
                    $samples[$l][] = $i;
                }
            }
        }
        $own = [];
        $thing = [];
        foreach ($samples as $id => $list) {
            $own[$id] = [];
            foreach ($list as $i) {
                if ($clear[$i] === "\0") {
                    $k = self::bin($rgb[$i]);
                    $own[$id][$k] = ($own[$id][$k] ?? 0) + $step[$id];
                }
            }
            if ($patches[$id]['kept']) {
                foreach ($own[$id] as $k => $c) {
                    $thing[$k] = ($thing[$k] ?? 0) + $c;
                }
            }
        }

        // The scenery's colours, cell by cell, from what the flood reached.
        $cell = 24;
        $cols = intdiv($w - 1, $cell) + 1;
        $cells = [];
        for ($y = 0; $y < $this->h; $y += 2) {
            for ($x = 0, $o = $y * $w; $x < $w; $x += 2) {
                $i = $o + $x;
                if ($reached[$i] === "\1" && $clear[$i] === "\0") {
                    $c = intdiv($y, $cell) * $cols + intdiv($x, $cell);
                    $k = self::bin($rgb[$i]);
                    $cells[$c][$k] = ($cells[$c][$k] ?? 0) + 4;
                }
            }
        }

        $opened = [];
        $looks = [];
        $minHole = max(40, (int) round(0.002 * $area));
        foreach ($patches as $id => $p) {
            $list = $samples[$id];
            if (! $list) {
                continue;
            }
            // See-through already (a keyed sky between branches): scenery, whatever the thing is.
            $clearShare = count(array_filter($list, fn ($i) => $clear[$i] === "\1")) / count($list);
            if ($clearShare >= 0.5 && $openings !== 'none') {
                $opened[$id] = true;

                continue;
            }
            $scenery = $this->sceneryAround($cells, $cols, $cell, $p);
            if (! $scenery) {
                continue;
            }
            $others = $thing;
            if ($p['kept']) {
                foreach ($own[$id] as $k => $c) {
                    $others[$k] -= $c;
                }
            }
            $thingSet = self::palette($others, 0.003);
            [$asScenery, $asThing, $asShadow] = [0, 0, 0];
            $counted = 0;
            foreach ($list as $i) {
                if ($clear[$i] === "\1") {
                    continue;
                }
                $counted++;
                $c = $rgb[$i];
                $k = self::bin($c);
                $isScenery = isset($scenery[$k]);
                $asScenery += $isScenery ? 1 : 0;
                $asThing += isset($thingSet[$k]) ? 1 : 0;
                if (! $isScenery) {
                    foreach (self::SHADE as $f) {
                        if (isset($scenery[self::bin($c, 1 / $f)])) {
                            $asShadow++;
                            break;
                        }
                    }
                }
            }
            if (! $counted) {
                continue;
            }
            $sc = $asScenery / $counted;
            $th = $asThing / $counted;
            $sd = $asShadow / $counted;
            $looks[$id] = $sc;
            // A shadow lying on the floor: low in the thing, flat, the floor's colour made darker.
            $low = $p['y1'] - $p['y0'] + 1 <= 0.3 * $sh && ($p['sy'] / $p['count']) >= $sy0 + 0.75 * $sh;
            $shadow = $low && $sc + $sd >= 0.85 && $sd >= 0.3 && $th < 0.5 && ($openings !== 'none' || $this->touchesAny($labels, $id, $p, $reached));
            $open = $shadow || match ($openings) {
                'none' => false,
                'under' => ($sc >= 0.8 && $sc >= $th + 0.15) || $sc >= 0.95,
                'lattice' => ($sc >= 0.7 && $sc >= $th + 0.1) || $sc >= 0.9,
                'leafy' => $p['count'] >= $minHole && $sc >= 0.85 && $sc >= $th + 0.2,
            };
            if ($open) {
                $opened[$id] = true;
            }
        }
        // Never all of it. A tree's or a bush's biggest part stays whatever (leaves on grass are the grass's green);
        // a table's biggest part only goes if it is plainly the scenery and a good part of the thing is left.
        $kept = array_filter($patches, fn ($p) => $p['kept']);
        uasort($kept, fn ($a, $b) => $b['count'] <=> $a['count']);
        $biggest = array_key_first($kept);
        if ($biggest !== null && isset($opened[$biggest])) {
            $left = array_sum(array_map(fn ($p) => $p['count'], array_diff_key($kept, $opened)));
            $keep = match ($openings) {
                'leafy' => true,
                'under' => ($looks[$biggest] ?? 0) < 0.9 || $left < 0.25 * $kept[$biggest]['count'],
                default => false,
            };
            if ($keep) {
                unset($opened[$biggest]);
            }
        }
        if ($kept && ! array_diff_key($kept, $opened) && $openings !== 'lattice') {
            $leastLike = array_keys($kept);
            usort($leastLike, fn ($a, $b) => ($looks[$a] ?? 0) <=> ($looks[$b] ?? 0));
            unset($opened[$leastLike[0]]);
        }

        // The thing: its patches less those opened, its outline and thin parts.
        $mask = $this->zero;
        $holes = $this->zero;
        for ($i = 0; $i < $n; $i++) {
            $l = $labels[$i];
            if ($l && isset($patches[$l])) {
                if (isset($opened[$l])) {
                    $holes[$i] = "\1";
                } else {
                    $mask[$i] = "\1";
                }
            }
        }
        $lines = ($cut['band'] | $cut['thin']) & $wall;
        if ($opened) {
            // The rim of an opening that is only its soft edge (a shadow's, the floor's), not the thing's line, goes with it.
            $nearThing = $this->grow($mask, 2);
            $rim = $lines & $this->grow($holes, 3) & self::not($nearThing) & self::not($ink);
            $holeColours = [];
            foreach ($opened as $id => $_) {
                foreach ($own[$id] ?? [] as $k => $c) {
                    $holeColours[$k] = ($holeColours[$k] ?? 0) + $c;
                }
            }
            $holeSet = self::palette($holeColours, 0.002);
            for ($i = strpos($rim, "\1"); $i !== false; $i = strpos($rim, "\1", $i + 1)) {
                if (isset($holeSet[self::bin($rgb[$i])])) {
                    $lines[$i] = "\0";
                }
            }
        }
        $mask |= $lines;
        $mask &= self::not($holes);
        // Scenery lines passing behind it are not its, except where they cross it (the thing on both sides).
        $mask = ($mask & self::not($cut['lines'])) | $this->crossings($cut['lines'], $cut['normals'], $mask & self::not($cut['lines']), $mask & self::not($cut['lines']));

        // Holes in the mask: a solid thing is filled back (the flood got in somewhere); others keep only openings of some size.
        $outside = $this->flood(self::not($mask), $this->borderOf());
        $gaps = self::not($outside) & self::not($mask) & self::not($holes);
        if ($openings === 'none') {
            $mask |= $gaps;
            // Notches in its outline closed too, and what they enclose.
            $closed = $this->shrink($this->grow($mask, 2), 2) & self::not($holes);
            $mask |= self::not($this->flood(self::not($closed), $this->borderOf())) & self::not($holes);
        } else {
            // What the flood never reached inside it is its own detail (texture, a dial, a knot in the wood), however
            // big; scenery it encloses that the flood did reach stays open unless it is a fleck.
            $mask |= ($gaps & self::not($reached)) | $this->smallPieces($gaps & $reached, 16);
        }
        $openShare = $area ? substr_count($holes & $filled & self::not($mask), "\1") / $area : 0.0;

        return [$mask, count($opened), round($openShare, 3), $holes];
    }

    /** The scenery's colours around a patch: from the cells near it (further out until there are enough). */
    private function sceneryAround(array $cells, int $cols, int $cell, array $p): ?array
    {
        $rows = intdiv($this->h - 1, $cell) + 1;
        $reach = (int) max(32, 0.5 * max($p['x1'] - $p['x0'], $p['y1'] - $p['y0']));
        for ($round = 0; $round < 4; $round++, $reach *= 2) {
            $counts = [];
            $total = 0;
            for ($cy = max(0, intdiv($p['y0'] - $reach, $cell)); $cy <= min($rows - 1, intdiv($p['y1'] + $reach, $cell)); $cy++) {
                for ($cx = max(0, intdiv($p['x0'] - $reach, $cell)); $cx <= min($cols - 1, intdiv($p['x1'] + $reach, $cell)); $cx++) {
                    foreach ($cells[$cy * $cols + $cx] ?? [] as $k => $c) {
                        $counts[$k] = ($counts[$k] ?? 0) + $c;
                        $total += $c;
                    }
                }
            }
            if ($total >= 400) {
                return self::palette($counts, 0.002);
            }
        }

        return null;
    }

    /** Whether a patch touches what the flood reached (it lies at the thing's edge, not inside it). */
    private function touchesAny(array $labels, int $id, array $p, string $reached): bool
    {
        $w = $this->w;
        $near = $this->grow($reached, 3);
        for ($y = $p['y0']; $y <= $p['y1']; $y++) {
            for ($x = $p['x0']; $x <= $p['x1']; $x++) {
                $i = $y * $w + $x;
                if ($labels[$i] === $id && $near[$i] === "\1") {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Lines joined to the thing's outline that are part of it (a leg, a baluster, a branch drawn as a
     * line): not running out of the region (scenery passing behind), and mostly where the thing is. A
     * scenery line crossing one (the wall's base crossing a table's leg) parts it in two; where the
     * crossing has the thing on both sides, it is the thing's, and what lies beyond joins on too.
     *
     * @return array{0: string, 1: list<int>} the lines, and the sides the thing seems to run out of the region on
     */
    private function thinParts(string $candidates, string $band, string $zone, string $near, array $grows, string $lines, array $normals, string $kept): array
    {
        $w = $this->w;
        $h = $this->h;
        $keptSides = $this->touching($kept);
        $comps = [];
        $label = array_fill(0, $this->n, 0);
        for ($s = strpos($candidates, "\1"); $s !== false; $s = strpos($candidates, "\1", $s + 1)) {
            if ($label[$s]) {
                continue;
            }
            $id = count($comps) + 1;
            $label[$s] = $id;
            $stack = [$s];
            $c = ['pixels' => [], 'sides' => [], 'zone' => 0, 'near' => 0, 'x0' => $w, 'y0' => $h, 'x1' => -1, 'y1' => -1];
            while ($stack) {
                $i = array_pop($stack);
                $c['pixels'][] = $i;
                $x = $i % $w;
                $y = intdiv($i, $w);
                $c['x0'] = min($c['x0'], $x);
                $c['x1'] = max($c['x1'], $x);
                $c['y0'] = min($c['y0'], $y);
                $c['y1'] = max($c['y1'], $y);
                $c['zone'] += $zone[$i] === "\1" ? 1 : 0;
                $c['near'] += $near[$i] === "\1" ? 1 : 0;
                foreach ([[0, $x === 0], [1, $y === 0], [2, $x === $w - 1], [3, $y === $h - 1]] as [$side, $at]) {
                    if ($at) {
                        $c['sides'][$side] = true;
                    }
                }
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $nx = $x + $dx;
                        $ny = $y + $dy;
                        if ($nx >= 0 && $ny >= 0 && $nx < $w && $ny < $h) {
                            $j = $ny * $w + $nx;
                            if (! $label[$j] && $candidates[$j] === "\1") {
                                $label[$j] = $id;
                                $stack[] = $j;
                            }
                        }
                    }
                }
            }
            $comps[$id] = $c;
        }

        $out = $this->zero;
        $short = [];
        $decided = [];
        $thing = $band;
        $carried = $this->zero;
        for ($round = 0; $round < 6; $round++) {
            $touch = $this->grow($thing, 1);
            $onward = $this->grow($carried, 1);
            $changed = false;
            foreach ($comps as $id => $c) {
                if (isset($decided[$id])) {
                    continue;
                }
                $joined = false;
                $continued = false;
                foreach ($c['pixels'] as $i) {
                    if ($touch[$i] === "\1") {
                        $joined = true;
                        $continued = $continued || $onward[$i] === "\1";
                    }
                }
                if (! $joined) {
                    continue;
                }
                $decided[$id] = true;
                $changed = true;
                $count = count($c['pixels']);
                $outward = array_keys(array_filter($c['sides'], fn ($_, $side) => $grows[$side], ARRAY_FILTER_USE_BOTH));
                if ($outward) {
                    // Running out of the region: scenery passing behind, unless it is mostly where the thing is and does not
                    // cross the whole region (then the thing itself runs on, and the region is too small).
                    if ($c['zone'] >= 0.6 * $count) {
                        foreach ($outward as $side) {
                            $across = $side === 0 || $side === 2 ? $c['x1'] - $c['x0'] + 1 < 0.9 * $w : $c['y1'] - $c['y0'] + 1 < 0.9 * $h;
                            if ($across && ! in_array($side, $short, true)) {
                                $short[] = $side;
                            }
                        }
                    }

                    continue;
                }
                // At a picture's edge only when the thing itself runs off there (a tree off the top).
                if (array_diff(array_keys($c['sides']), $keptSides)) {
                    continue;
                }
                // Mostly where the surveyor drew it; a leg or post carried on across a scenery line is plainly the same one,
                // wherever the drawing stopped.
                if ($c['zone'] < 0.7 * $count || (! $continued && $c['near'] < 0.75 * $count)) {
                    continue;
                }
                foreach ($c['pixels'] as $i) {
                    if ($zone[$i] === "\1") {
                        $out[$i] = "\1";
                        $thing[$i] = "\1";
                    }
                }
            }
            // Where a scenery line crosses the thing (its leg), the thing goes on across it.
            $across = $this->crossings($lines, $normals, $thing, $thing | $candidates) & self::not($thing);
            if (strpos($across, "\1") !== false) {
                $out |= $across;
                $thing |= $across;
                $carried |= $across;
                $changed = true;
            }
            if (! $changed) {
                break;
            }
        }

        return [$out, $short];
    }

    /**
     * Straight lines of the scenery that cross the region from one side to another (the floor's back
     * edge, a wall's base, a window frame passing behind the thing): traced from where they meet the
     * region's edge, across it, through gaps where the thing hides them. Not from a side the thing
     * itself runs off.
     *
     * @return array{0: string, 1: array<int, array{0: float, 1: float}>} the lines' pixels, and the direction across each line at each
     */
    private function sceneryLines(string $ink, string $wall, string $kept): array
    {
        $w = $this->w;
        $h = $this->h;
        $lines = $this->zero;
        $normals = [];
        $keptSides = $this->touching($kept);
        $at = fn (float $x, float $y) => ($xi = (int) round($x)) >= 0 && ($yi = (int) round($y)) >= 0 && $xi < $w && $yi < $h ? $yi * $w + $xi : -1;
        for ($side = 0; $side < 4; $side++) {
            if (in_array($side, $keptSides, true)) {
                continue;
            }
            $along = $side === 0 || $side === 2 ? $h : $w;
            $pos = fn (int $t) => match ($side) { 0 => $t * $w, 1 => $t, 2 => $t * $w + $w - 1, 3 => ($h - 1) * $w + $t };
            $inward = match ($side) { 0 => [1, 0], 1 => [0, 1], 2 => [-1, 0], 3 => [0, -1] };
            for ($t = 0; $t < $along; $t++) {
                if ($ink[$pos($t)] !== "\1") {
                    continue;
                }
                $t0 = $t;
                while ($t + 1 < $along && $ink[$pos($t + 1)] === "\1") {
                    $t++;
                }
                if ($t - $t0 + 1 > 20) {
                    continue; // running along the edge, or a dark mass: not a line crossing it
                }
                // Its direction: the ink joined to this run within 16 pixels of the edge.
                $start = $pos(intdiv($t0 + $t, 2));
                $seen = [$start => true];
                $stack = [$start];
                $pts = [];
                while ($stack && count($pts) < 400) {
                    $i = array_pop($stack);
                    $x = $i % $w;
                    $y = intdiv($i, $w);
                    $depth = match ($side) { 0 => $x, 1 => $y, 2 => $w - 1 - $x, 3 => $h - 1 - $y };
                    if ($depth > 16) {
                        continue;
                    }
                    $pts[] = [$x, $y];
                    foreach ([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as [$dx, $dy]) {
                        $j = $at($x + $dx, $y + $dy);
                        if ($j >= 0 && ! isset($seen[$j]) && $ink[$j] === "\1") {
                            $seen[$j] = true;
                            $stack[] = $j;
                        }
                    }
                }
                if (count($pts) < 8) {
                    continue;
                }
                $mx = array_sum(array_column($pts, 0)) / count($pts);
                $my = array_sum(array_column($pts, 1)) / count($pts);
                [$sxx, $syy, $sxy] = [0.0, 0.0, 0.0];
                foreach ($pts as [$x, $y]) {
                    $sxx += ($x - $mx) ** 2;
                    $syy += ($y - $my) ** 2;
                    $sxy += ($x - $mx) * ($y - $my);
                }
                $angle = 0.5 * atan2(2 * $sxy, $sxx - $syy);
                $dir = [cos($angle), sin($angle)];
                if ($dir[0] * $inward[0] + $dir[1] * $inward[1] < 0) {
                    $dir = [-$dir[0], -$dir[1]];
                }
                if ($dir[0] * $inward[0] + $dir[1] * $inward[1] < 0.2) {
                    continue; // nearly along the edge
                }
                $normal = [-$dir[1], $dir[0]];
                // Its thickness, across it where it meets the edge.
                $half = (int) min(6, max(2, ceil(($t - $t0 + 1) * abs($dir[0] * $inward[0] + $dir[1] * $inward[1]) / 2) + 1));
                // Follow it across: keep to its ink where there is some, straight on where the thing hides it.
                [$x, $y] = [$mx, $my];
                $marked = [];
                $found = 0;
                $steps = 0;
                $lastInk = 0;
                $exit = null;
                for ($k = 0; $k < 2 * ($w + $h); $k++) {
                    $x += $dir[0];
                    $y += $dir[1];
                    if ($at($x, $y) < 0) {
                        $exit = $x < 0 ? 0 : ($y < 0 ? 1 : ($x >= $w ? 2 : 3));
                        break;
                    }
                    $steps++;
                    $offsets = [];
                    for ($o = -$half - 1; $o <= $half + 1; $o++) {
                        $j = $at($x + $o * $normal[0], $y + $o * $normal[1]);
                        if ($j >= 0 && $ink[$j] === "\1") {
                            $offsets[] = $o;
                            $marked[$j] = true;
                        }
                    }
                    if ($offsets) {
                        $found++;
                        $lastInk = $steps;
                        $shift = array_sum($offsets) / count($offsets);
                        $x += 0.3 * $shift * $normal[0];
                        $y += 0.3 * $shift * $normal[1];
                    }
                }
                // It must come out the far side to the edge (a leg ends at its table; the wall's base goes on past it).
                if ($exit === null || $exit === $side || $steps < 20 || $found < 0.25 * $steps || $steps - $lastInk > 6) {
                    continue;
                }
                foreach ($marked as $j => $_) {
                    $lines[$j] = "\1";
                    $normals[$j] = $normal;
                    // With its soft edge, a pixel or two either side.
                    foreach ([1, 2, -1, -2] as $o) {
                        $e = $at($j % $w + $o * $normal[0], intdiv($j, $w) + $o * $normal[1]);
                        if ($e >= 0 && $wall[$e] === "\1" && $ink[$e] === "\0" && ! isset($marked[$e])) {
                            $lines[$e] = "\1";
                            $normals[$e] = $normal;
                        }
                    }
                }
            }
        }

        return [$lines, $normals];
    }

    /** The scenery lines' pixels that have the thing on one side of the line and the thing (or its candidates) on the other, within 7 pixels. */
    private function crossings(string $lines, array $normals, string $one, string $other): string
    {
        $w = $this->w;
        $h = $this->h;
        $out = $this->zero;
        foreach ($normals as $i => [$nx, $ny]) {
            if ($lines[$i] !== "\1") {
                continue;
            }
            $x = $i % $w;
            $y = intdiv($i, $w);
            $hit = [];
            foreach ([1, -1] as $sign) {
                $hit[$sign] = null;
                for ($k = 1; $k <= 7; $k++) {
                    $xx = (int) round($x + $sign * $k * $nx);
                    $yy = (int) round($y + $sign * $k * $ny);
                    if ($xx < 0 || $yy < 0 || $xx >= $w || $yy >= $h) {
                        break;
                    }
                    $j = $yy * $w + $xx;
                    if ($lines[$j] === "\1") {
                        continue;
                    }
                    $hit[$sign] = $j;
                    break;
                }
            }
            if ($hit[1] === null || $hit[-1] === null) {
                continue;
            }
            [$a, $b] = [$hit[1], $hit[-1]];
            if (($one[$a] === "\1" && $other[$b] === "\1") || ($one[$b] === "\1" && $other[$a] === "\1")) {
                $out[$i] = "\1";
            }
        }

        return $out;
    }

    /**
     * The pieces of the inside that belong to the thing: the biggest piece that reaches into the middle
     * of the box, any other piece at least a quarter its size whose middle is where the thing may be, and
     * pieces parted from those only by an outline (a trunk below its canopy, a cart's wheel).
     *
     * @return array{labels: list<int>, info: array<int, array>, keep: array<int, true>, main: int, kept: string}|null
     */
    private function pieces(string $core, array $b, string $zone): ?array
    {
        $w = $this->w;
        $h = $this->h;
        [$bx0, $by0, $bx1, $by1] = $b;
        $bw = $bx1 - $bx0 + 1;
        $bh = $by1 - $by0 + 1;
        $labels = array_fill(0, $this->n, 0);
        $info = [];
        $id = 0;
        for ($s = strpos($core, "\1"); $s !== false; $s = strpos($core, "\1", $s + 1)) {
            if ($labels[$s]) {
                continue;
            }
            $id++;
            $labels[$s] = $id;
            $stack = [$s];
            $p = ['count' => 0, 'sx' => 0, 'sy' => 0, 'x0' => $w, 'y0' => $h, 'x1' => -1, 'y1' => -1, 'central' => false, 'first' => $s];
            while ($stack) {
                $i = array_pop($stack);
                $x = $i % $w;
                $y = intdiv($i, $w);
                $p['count']++;
                $p['sx'] += $x;
                $p['sy'] += $y;
                $p['x0'] = min($p['x0'], $x);
                $p['x1'] = max($p['x1'], $x);
                $p['y0'] = min($p['y0'], $y);
                $p['y1'] = max($p['y1'], $y);
                if (! $p['central'] && $x >= $bx0 + $bw * 0.2 && $x <= $bx0 + $bw * 0.8 && $y >= $by0 + $bh * 0.2 && $y <= $by0 + $bh * 0.95) {
                    $p['central'] = true;
                }
                for ($dy = -1; $dy <= 1; $dy++) {
                    for ($dx = -1; $dx <= 1; $dx++) {
                        $nx = $x + $dx;
                        $ny = $y + $dy;
                        if ($nx >= 0 && $ny >= 0 && $nx < $w && $ny < $h) {
                            $j = $ny * $w + $nx;
                            if (! $labels[$j] && $core[$j] === "\1") {
                                $labels[$j] = $id;
                                $stack[] = $j;
                            }
                        }
                    }
                }
            }
            $info[$id] = $p;
        }
        $main = null;
        foreach ($info as $k => $p) {
            if ($p['central'] && ($main === null || $p['count'] > $info[$main]['count'])) {
                $main = $k;
            }
        }
        if ($main === null) {
            return null;
        }
        $inZone = fn (array $p) => $zone[(int) round($p['sy'] / $p['count']) * $w + (int) round($p['sx'] / $p['count'])] === "\1";
        $keep = [$main => true];
        foreach ($info as $k => $p) {
            if ($p['count'] >= $info[$main]['count'] * 0.25 && $inZone($p)) {
                $keep[$k] = true;
            }
        }
        $kept = fn () => $this->labelMask($labels, $keep);
        for ($round = 0; $round < 4; $round++) {
            $near = $this->grow($kept(), 5);
            $added = false;
            for ($i = strpos($near, "\1"); $i !== false; $i = strpos($near, "\1", $i + 1)) {
                $l = $labels[$i];
                if ($l && ! isset($keep[$l]) && $info[$l]['count'] >= max(12, $info[$main]['count'] * 0.01) && $inZone($info[$l])) {
                    $keep[$l] = true;
                    $added = true;
                }
            }
            if (! $added) {
                break;
            }
        }

        return ['labels' => $labels, 'info' => $info, 'keep' => $keep, 'main' => $main, 'kept' => $kept()];
    }

    /**
     * The cut-out from its mask: the mask's box (an even number of pixels wide, so it centres on a whole
     * pixel), the background's own pixels inside, and a soft edge (see the class comment).
     */
    private function finish(GdImage $picture, array $region, string $mask, string $clear, string $how, string $openings, int $opened, float $open, array $short, string $lines, array $normals): ?array
    {
        [$rx0, $ry0] = $region;
        $W = imagesx($picture);
        $w = $this->w;
        $h = $this->h;
        $rgb = $this->rgb;
        if (substr_count($mask, "\1") < 16) {
            return null;
        }
        $alpha = $this->edgeAlpha($mask, $clear, $lines, $normals);

        [$minX, $minY, $maxX, $maxY] = [$w, $h, -1, -1];
        foreach ($alpha as $i => $a) {
            if ($a > 0) {
                $x = $i % $w;
                $y = intdiv($i, $w);
                $minX = min($minX, $x);
                $maxX = max($maxX, $x);
                $minY = min($minY, $y);
                $maxY = max($maxY, $y);
            }
        }
        if ($maxX < 0) {
            return null;
        }
        $cw = $maxX - $minX + 1;
        if ($cw % 2 === 1) {
            if ($rx0 + $maxX + 1 < $W) {
                $maxX++;
            } else {
                $minX--;
            }
            $cw++;
        }
        $ch = $maxY - $minY + 1;
        $out = ImageTools::blank($cw, $ch);
        foreach ($alpha as $i => $a) {
            if ($a <= 0) {
                continue;
            }
            $x = $i % $w;
            $y = intdiv($i, $w);
            if ($a >= 1) {
                // The background's own pixel, exactly (a see-through one stays see-through).
                imagesetpixel($out, $x - $minX, $y - $minY, imagecolorat($picture, $rx0 + $x, $ry0 + $y));
            } else {
                imagesetpixel($out, $x - $minX, $y - $minY, ($this->edgeColour[$i] ?? $rgb[$i]) | ((int) round(127 * (1 - $a)) << 24));
            }
        }

        // Its base: the columns of its lowest rows, where it stands (a tree's trunk, a table's legs).
        [$fx0, $fx1] = [$w, -1];
        $bottom = -1;
        foreach ($alpha as $i => $a) {
            if ($a >= 0.5) {
                $bottom = max($bottom, intdiv($i, $w));
            }
        }
        $band = max(2, (int) round($ch * 0.05));
        foreach ($alpha as $i => $a) {
            if ($a >= 0.5 && intdiv($i, $w) >= $bottom - $band) {
                $fx0 = min($fx0, $i % $w);
                $fx1 = max($fx1, $i % $w);
            }
        }

        return [
            'image' => $out, 'x' => $rx0 + $minX, 'y' => $ry0 + $minY, 'width' => $cw, 'height' => $ch, 'how' => $how,
            'footprint' => [$rx0 + $fx0, $rx0 + $fx1], 'openings' => $openings, 'opened' => $opened, 'open' => $open, 'short' => $short,
        ];
    }

    /** @var array<int, int> The colours of the soft edge's pixels, without the scenery mixed in. */
    private array $edgeColour = [];

    /**
     * Each pixel's alpha: 1 inside the mask, 0 outside, and along its edge (two pixels each way) the share
     * of the thing in the blend there, estimated from the scenery's colour beside it and the thing's. A
     * scenery line running past it (lines) is not its edge; where one crosses its edge, the edge carries on
     * across the line.
     *
     * @return array<int, float> only pixels with some alpha
     */
    private function edgeAlpha(string $mask, string $clear, string $lines, array $normals): array
    {
        $w = $this->w;
        $h = $this->h;
        $rgb = $this->rgb;
        $alpha = [];
        for ($i = strpos($mask, "\1"); $i !== false; $i = strpos($mask, "\1", $i + 1)) {
            $alpha[$i] = 1.0;
        }
        $outsideMask = self::not($mask);
        $rim = $mask & $this->grow($outsideMask, 1);
        $deep = $mask & self::not($rim);
        $edge = ($this->grow($mask, 2) & $outsideMask) | ($mask & $this->grow($outsideMask, 2));
        $far = self::not($this->grow($mask, 2));
        $across = [];
        for ($q = strpos($edge, "\1"); $q !== false; $q = strpos($edge, "\1", $q + 1)) {
            // A scenery line passing just beside it is the scenery, not its soft edge (see below).
            if ($clear[$q] === "\1" || ($lines[$q] === "\1" && $mask[$q] === "\0")) {
                if ($clear[$q] === "\0") {
                    $across[] = $q;
                }

                continue;
            }
            $x = $q % $w;
            $y = intdiv($q, $w);
            $inside = $mask[$q] === "\1";
            // The scenery: pixels well clear of the thing, near here.
            [$br, $bg, $bb, $nb] = [0, 0, 0, 0];
            $anyClear = false;
            for ($yy = max(0, $y - 5); $yy <= min($h - 1, $y + 5); $yy++) {
                for ($xx = max(0, $x - 5); $xx <= min($w - 1, $x + 5); $xx++) {
                    $j = $yy * $w + $xx;
                    if ($far[$j] === "\1") {
                        if ($clear[$j] === "\1") {
                            $anyClear = true;
                        } else {
                            $c = $rgb[$j];
                            $br += ($c >> 16) & 0xFF;
                            $bg += ($c >> 8) & 0xFF;
                            $bb += $c & 0xFF;
                            $nb++;
                        }
                    }
                }
            }
            if ($anyClear || $nb < 3) {
                continue; // against a keyed sky the picture's own alpha is the edge; with no scenery near, the mask is
            }
            $B = [$br / $nb, $bg / $nb, $bb / $nb];
            // The thing: for a pixel on its rim, the thing further in; for one just outside, its rim. Failing
            // that (a line too thin to have an inside), its pixel nearby least like the scenery.
            $F = $this->meanOf($inside ? $deep : $rim, $clear, $x, $y, $inside ? 2 : 1) ?? $this->meanOf($rim, $clear, $x, $y, 2);
            $farthest = -1;
            $best = null;
            for ($yy = max(0, $y - 2); $F === null && $yy <= min($h - 1, $y + 2); $yy++) {
                for ($xx = max(0, $x - 2); $xx <= min($w - 1, $x + 2); $xx++) {
                    $j = $yy * $w + $xx;
                    if ($mask[$j] === "\1" && $clear[$j] === "\0") {
                        $c = $rgb[$j];
                        $d = (((($c >> 16) & 0xFF) - $B[0]) ** 2) + (((($c >> 8) & 0xFF) - $B[1]) ** 2) + ((($c & 0xFF) - $B[2]) ** 2);
                        if ($d > $farthest) {
                            $farthest = $d;
                            $best = [($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF];
                        }
                    }
                }
            }
            $F ??= $best;
            if ($F === null) {
                continue;
            }
            $spread = ($F[0] - $B[0]) ** 2 + ($F[1] - $B[1]) ** 2 + ($F[2] - $B[2]) ** 2;
            if ($spread < 900) {
                continue; // the thing and the scenery are too alike here to tell a blend
            }
            $c = $rgb[$q];
            $p = [($c >> 16) & 0xFF, ($c >> 8) & 0xFF, $c & 0xFF];
            $a = (($p[0] - $B[0]) * ($F[0] - $B[0]) + ($p[1] - $B[1]) * ($F[1] - $B[1]) + ($p[2] - $B[2]) * ($F[2] - $B[2])) / $spread;
            $a = max(0.0, min(1.0, $a));
            if ($inside && $a >= 0.9) {
                continue;
            }
            if ($a <= 0.12) {
                unset($alpha[$q]);

                continue;
            }
            $alpha[$q] = $a;
            // Its colour without the scenery mixed in.
            $un = array_map(fn ($k) => (int) max(0, min(255, round($B[$k] + ($p[$k] - $B[$k]) / $a))), [0, 1, 2]);
            $this->edgeColour[$q] = ($un[0] << 16) | ($un[1] << 8) | $un[2];
        }
        // Where a scenery line crosses its edge, its edge carries straight on across the line: each such pixel is
        // as solid as the less solid of the pixels either side of the line (none, beside a leg; its soft edge, in it).
        foreach ($across as $q) {
            [$nx, $ny] = $normals[$q] ?? [0.0, 1.0];
            $sides = [];
            foreach ([1, -1] as $sign) {
                for ($k = 1; $k <= 8; $k++) {
                    $xx = (int) round($q % $w + $sign * $k * $nx);
                    $yy = (int) round(intdiv($q, $w) + $sign * $k * $ny);
                    if ($xx < 0 || $yy < 0 || $xx >= $w || $yy >= $h) {
                        break;
                    }
                    $j = $yy * $w + $xx;
                    if ($lines[$j] === "\0" || $mask[$j] === "\1") {
                        $sides[] = $j;
                        break;
                    }
                }
            }
            if (count($sides) === 2) {
                $a = min($alpha[$sides[0]] ?? 0.0, $alpha[$sides[1]] ?? 0.0);
                if ($a > 0) {
                    $alpha[$q] = $a;
                    $this->edgeColour[$q] = $this->edgeColour[$sides[0]] ?? $rgb[$sides[0]];
                }
            }
        }

        return $alpha;
    }

    /** The mean colour of a mask's pixels within r of (x, y), as [r, g, b]; null when there are none. */
    private function meanOf(string $mask, string $clear, int $x, int $y, int $r): ?array
    {
        [$sr, $sg, $sb, $k] = [0, 0, 0, 0];
        for ($yy = max(0, $y - $r); $yy <= min($this->h - 1, $y + $r); $yy++) {
            for ($xx = max(0, $x - $r); $xx <= min($this->w - 1, $x + $r); $xx++) {
                $j = $yy * $this->w + $xx;
                if ($mask[$j] === "\1" && $clear[$j] === "\0") {
                    $c = $this->rgb[$j];
                    $sr += ($c >> 16) & 0xFF;
                    $sg += ($c >> 8) & 0xFF;
                    $sb += $c & 0xFF;
                    $k++;
                }
            }
        }

        return $k ? [$sr / $k, $sg / $k, $sb / $k] : null;
    }

    /** Which pixels are outlines: ink (thin and dark), or where the colour jumps (from a neighbour, or across a soft two-pixel line). */
    private function edges(string $clear, string $ink): string
    {
        $w = $this->w;
        $h = $this->h;
        $rgb = $this->rgb;
        $wall = $ink;
        for ($y = 0; $y < $h; $y++) {
            for ($x = 0; $x < $w; $x++) {
                $i = $y * $w + $x;
                if ($clear[$i] === "\1" || $wall[$i] === "\1") {
                    continue;
                }
                $c = $rgb[$i];
                // The same edge is a smaller jump in the dark: the thresholds scale down with brightness (to half).
                $k = max(0.5, min(1.0, (self::luma($c) + 50) / 170));
                [$edge, $soft] = [self::EDGE * $k, self::SOFT_EDGE * $k];
                if (($x + 1 < $w && $clear[$i + 1] === "\0" && self::diff($c, $rgb[$i + 1]) > $edge)
                    || ($y + 1 < $h && $clear[$i + $w] === "\0" && self::diff($c, $rgb[$i + $w]) > $edge)
                    || ($x > 0 && $x + 1 < $w && $clear[$i - 1] === "\0" && $clear[$i + 1] === "\0" && self::diff($rgb[$i - 1], $rgb[$i + 1]) > $soft)
                    || ($y > 0 && $y + 1 < $h && $clear[$i - $w] === "\0" && $clear[$i + $w] === "\0" && self::diff($rgb[$i - $w], $rgb[$i + $w]) > $soft)) {
                    $wall[$i] = "\1";
                }
            }
        }

        return $wall;
    }

    /** Everything reachable from the seeds through the passable pixels (4-connected). */
    private function flood(string $passable, array $seeds): string
    {
        $w = $this->w;
        $h = $this->h;
        $seen = $this->zero;
        $queue = [];
        foreach ($seeds as $i) {
            if ($passable[$i] === "\1" && $seen[$i] === "\0") {
                $seen[$i] = "\1";
                $queue[] = $i;
            }
        }
        for ($q = 0; $q < count($queue); $q++) {
            $i = $queue[$q];
            $x = $i % $w;
            if ($x > 0 && $seen[$i - 1] === "\0" && $passable[$i - 1] === "\1") {
                $seen[$i - 1] = "\1";
                $queue[] = $i - 1;
            }
            if ($x + 1 < $w && $seen[$i + 1] === "\0" && $passable[$i + 1] === "\1") {
                $seen[$i + 1] = "\1";
                $queue[] = $i + 1;
            }
            if ($i >= $w && $seen[$i - $w] === "\0" && $passable[$i - $w] === "\1") {
                $seen[$i - $w] = "\1";
                $queue[] = $i - $w;
            }
            if ($i + $w < $w * $h && $seen[$i + $w] === "\0" && $passable[$i + $w] === "\1") {
                $seen[$i + $w] = "\1";
                $queue[] = $i + $w;
            }
        }

        return $seen;
    }

    /** Every pixel along the region's edge. */
    private function borderOf(): array
    {
        $w = $this->w;
        $h = $this->h;
        $out = [...range(0, $w - 1), ...range(($h - 1) * $w, $h * $w - 1)];
        for ($y = 1; $y < $h - 1; $y++) {
            $out[] = $y * $w;
            $out[] = $y * $w + $w - 1;
        }

        return $out;
    }

    /** The sides of the region (0 left, 1 top, 2 right, 3 bottom) that at least three of the mask's pixels touch. */
    private function touching(string $mask): array
    {
        $w = $this->w;
        $h = $this->h;
        $counts = [
            0 => substr_count(implode('', array_map(fn ($y) => $mask[$y * $w], range(0, $h - 1))), "\1"),
            1 => substr_count(substr($mask, 0, $w), "\1"),
            2 => substr_count(implode('', array_map(fn ($y) => $mask[$y * $w + $w - 1], range(0, $h - 1))), "\1"),
            3 => substr_count(substr($mask, ($h - 1) * $w, $w), "\1"),
        ];

        return array_keys(array_filter($counts, fn ($c) => $c >= 3));
    }

    /** The mask with each row filled from its first pixel to its last. */
    private function spans(string $m): string
    {
        $w = $this->w;
        for ($y = 0; $y < $this->h; $y++) {
            $row = substr($m, $y * $w, $w);
            $a = strpos($row, "\1");
            if ($a !== false) {
                $b = strrpos($row, "\1");
                $m = substr_replace($m, str_repeat("\1", $b - $a + 1), $y * $w + $a, $b - $a + 1);
            }
        }

        return $m;
    }

    /** The pieces of a mask smaller than this many pixels. */
    private function smallPieces(string $mask, int $most): string
    {
        $w = $this->w;
        $h = $this->h;
        $out = $this->zero;
        $seen = $this->zero;
        for ($s = strpos($mask, "\1"); $s !== false; $s = strpos($mask, "\1", $s + 1)) {
            if ($seen[$s] === "\1") {
                continue;
            }
            $seen[$s] = "\1";
            $stack = [$s];
            $piece = [];
            while ($stack && count($piece) <= $most) {
                $i = array_pop($stack);
                $piece[] = $i;
                $x = $i % $w;
                foreach ([$x > 0 ? $i - 1 : -1, $x + 1 < $w ? $i + 1 : -1, $i - $w, $i + $w] as $j) {
                    if ($j >= 0 && $j < $w * $h && $seen[$j] === "\0" && $mask[$j] === "\1") {
                        $seen[$j] = "\1";
                        $stack[] = $j;
                    }
                }
            }
            if (count($piece) <= $most && ! $stack) {
                foreach ($piece as $i) {
                    $out[$i] = "\1";
                }
            }
        }

        return $out;
    }

    /** A mask of the pixels whose label is kept. */
    private function labelMask(array $labels, array $keep): string
    {
        $m = $this->zero;
        foreach ($labels as $i => $l) {
            if ($l && isset($keep[$l])) {
                $m[$i] = "\1";
            }
        }

        return $m;
    }

    private function rect(int $x0, int $y0, int $x1, int $y1): string
    {
        $m = $this->zero;
        [$x0, $y0, $x1, $y1] = [max(0, $x0), max(0, $y0), min($this->w - 1, $x1), min($this->h - 1, $y1)];
        if ($x1 < $x0) {
            return $m;
        }
        $run = str_repeat("\1", $x1 - $x0 + 1);
        for ($y = $y0; $y <= $y1; $y++) {
            $m = substr_replace($m, $run, $y * $this->w + $x0, $x1 - $x0 + 1);
        }

        return $m;
    }

    /** A mask moved by this many pixels along the string (positive: later), with nothing coming in. */
    private function shift(string $m, int $by): string
    {
        return $by > 0 ? str_repeat("\0", $by).substr($m, 0, $this->n - $by) : substr($m, -$by).str_repeat("\0", -$by);
    }

    /** The mask grown by a pixel to its four neighbours. */
    private function grow4(string $m): string
    {
        return $m | ($this->shift($m, 1) & $this->notFirst) | ($this->shift($m, -1) & $this->notLast) | $this->shift($m, $this->w) | $this->shift($m, -$this->w);
    }

    /** The mask grown by r pixels each way (a square). */
    private function grow(string $m, int $r): string
    {
        for ($k = 0; $k < $r; $k++) {
            $m = $m | ($this->shift($m, 1) & $this->notFirst) | ($this->shift($m, -1) & $this->notLast);
            $m = $m | $this->shift($m, $this->w) | $this->shift($m, -$this->w);
        }

        return $m;
    }

    /** The mask shrunk by r pixels each way. */
    private function shrink(string $m, int $r): string
    {
        return self::not($this->grow(self::not($m), $r));
    }

    /** @return array<int, int> how many of the masked pixels (every step-th each way) have each colour */
    private function colourCounts(string $mask, int $step): array
    {
        $counts = [];
        $w = $this->w;
        for ($i = strpos($mask, "\1"); $i !== false; $i = strpos($mask, "\1", $i + 1)) {
            if ($step > 1 && (($i % $w) % $step || intdiv($i, $w) % $step)) {
                continue;
            }
            $k = self::bin($this->rgb[$i]);
            $counts[$k] = ($counts[$k] ?? 0) + 1;
        }

        return $counts;
    }

    /**
     * The colours that are common in a count (at least this share of it), each with its neighbours: a
     * set to look a pixel's colour up in, within about 8 to 16 of each channel.
     *
     * @return array<int, true>
     */
    private static function palette(array $counts, float $share): array
    {
        $total = array_sum($counts);
        $least = max(2, $share * $total);
        $set = [];
        foreach ($counts as $k => $c) {
            if ($c < $least) {
                continue;
            }
            $r = $k >> 10;
            $g = ($k >> 5) & 31;
            $b = $k & 31;
            for ($dr = max(0, $r - 1); $dr <= min(31, $r + 1); $dr++) {
                for ($dg = max(0, $g - 1); $dg <= min(31, $g + 1); $dg++) {
                    for ($db = max(0, $b - 1); $db <= min(31, $b + 1); $db++) {
                        $set[($dr << 10) | ($dg << 5) | $db] = true;
                    }
                }
            }
        }

        return $set;
    }

    /** A colour's bin (5 bits a channel), after scaling it (to undo a shadow). */
    private static function bin(int $c, float $scale = 1.0): int
    {
        $r = ($c >> 16) & 0xFF;
        $g = ($c >> 8) & 0xFF;
        $b = $c & 0xFF;
        if ($scale !== 1.0) {
            $r = min(255, (int) ($r * $scale));
            $g = min(255, (int) ($g * $scale));
            $b = min(255, (int) ($b * $scale));
        }

        return (($r >> 3) << 10) | (($g >> 3) << 5) | ($b >> 3);
    }

    private static function not(string $m): string
    {
        return strtr($m, "\0\1", "\1\0");
    }

    private static function luma(int $c): float
    {
        return 0.299 * (($c >> 16) & 0xFF) + 0.587 * (($c >> 8) & 0xFF) + 0.114 * ($c & 0xFF);
    }

    /** How different two colours are: the sum of their channels' differences. */
    private static function diff(int $a, int $b): int
    {
        return abs((($a >> 16) & 0xFF) - (($b >> 16) & 0xFF)) + abs((($a >> 8) & 0xFF) - (($b >> 8) & 0xFF)) + abs(($a & 0xFF) - ($b & 0xFF));
    }

    /** Which pixels of a region (at rx0, ry0, rw × rh) are inside a polygon, scaled about its middle by $grow. */
    private static function polygonMask(array $polygon, int $rx0, int $ry0, int $rw, int $rh, float $grow): string
    {
        $cx = array_sum(array_column($polygon, 0)) / count($polygon);
        $cy = array_sum(array_column($polygon, 1)) / count($polygon);
        $pts = array_map(fn ($p) => [$cx + ($p[0] - $cx) * $grow - $rx0, $cy + ($p[1] - $cy) * $grow - $ry0], $polygon);
        $mask = str_repeat("\0", $rw * $rh);
        $n = count($pts);
        for ($y = 0; $y < $rh; $y++) {
            // Where each edge crosses this row, and fill between pairs.
            $xs = [];
            for ($i = 0, $j = $n - 1; $i < $n; $j = $i++) {
                [$xi, $yi] = $pts[$i];
                [$xj, $yj] = $pts[$j];
                if (($yi > $y) !== ($yj > $y)) {
                    $xs[] = $xi + ($y - $yi) / ($yj - $yi) * ($xj - $xi);
                }
            }
            sort($xs);
            for ($k = 0; $k + 1 < count($xs); $k += 2) {
                $a = max(0, (int) ceil($xs[$k]));
                $b = min($rw - 1, (int) floor($xs[$k + 1]));
                if ($b >= $a) {
                    $mask = substr_replace($mask, str_repeat("\1", $b - $a + 1), $y * $rw + $a, $b - $a + 1);
                }
            }
        }

        return $mask;
    }
}
