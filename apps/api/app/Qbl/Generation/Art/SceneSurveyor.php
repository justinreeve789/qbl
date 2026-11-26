<?php

namespace App\Qbl\Generation\Art;

use App\Qbl\Generation\Llm\LanguageModel;
use GdImage;

/**
 * Looks at a finished background the way a level designer would, and says where things really are
 * in it (the picture never matches what was asked to the pixel):
 *
 *   floor     the back edge of the floor people can walk on, left to right: along the base of the
 *             buildings, walls, fences, cliffs and hedges, the water's edge, and across open ground as
 *             far back as anyone could walk. FloorTracer then puts each point on the painted line.
 *   standing  things standing out on the floor that people could walk around, in front and behind: a
 *             tree, a bush, a lamp post, a fountain, a cart, a railing running across the floor. Each
 *             becomes a pixel-exact cut-out item with a sort line (ObjectCutter), so figures pass behind
 *             it. Each says how it can be seen through (openings: solid, open beneath, mostly gaps, leafy),
 *             which decides what of the picture inside its outline is cut out with it.
 *   found     where things the mission painted into the picture ended up: a door, a ladder, a lantern
 *             on the wall, a crack to inspect. Hotspots and glows go there.
 *
 * The picture is sent with a labelled grid over it, so the model can read positions off it; positions
 * come back as percentages of the picture and are returned in its pixels.
 */
final class SceneSurveyor
{
    /** What things standing on the floor can be. Trees are for climbing (squirrels), bushes for hiding in (rabbits). */
    public const KINDS = ['tree', 'bush', 'rock', 'post', 'furniture', 'structure', 'plant', 'railing', 'other'];

    public const MAX_STANDING = 8;

    /** The picture goes to the model at most this wide. */
    private const SEND_WIDTH = 1568;

    public function __construct(private LanguageModel $llm) {}

    /**
     * @param  array  $scene  The blueprint's scene (its description helps the model know what it sees).
     * @param  list<array{id: string, what: string, x?: float}>  $find  Things painted in to find: an id, what it is, about where across (0-1).
     * @return array{floor: list<array{0: int, 1: int}>, standing: list<array{name: string, kind: string, box: array, base: int, outline: list<array>, openings: string}>, found: array<string, array{0: int, 1: int, 2: int, 3: int}>}
     */
    public function survey(GdImage $picture, array $scene, array $find = []): array
    {
        $W = imagesx($picture);
        $H = imagesy($picture);
        $content = [
            'The background picture of the scene "'.($scene['title'] ?? $scene['key'] ?? '').'". It was asked to show: '.($scene['background'] ?? ''),
            'A grid is drawn over it: lines every 10% of the width and the height, numbered along the top and the left edge. Read positions off the grid, as percentages: x from the left edge (0) to the right edge (100), y from the top (0) to the bottom (100).',
            ['image' => ImageTools::png(self::gridded($picture)), 'mime' => 'image/png'],
        ];
        if ($find) {
            $content[] = "Painted into the picture, find these and give a box around each (an empty box list if it is not there):\n".implode("\n", array_map(
                fn ($f) => "- {$f['id']}: {$f['what']}".(isset($f['x']) ? ' (asked for about '.round(100 * (float) $f['x']).'% across)' : ''),
                $find,
            ));
        }
        $system = <<<'TXT'
        You are a level designer for a 2D side-on adventure game where children walk around painted scenes. You
        look at a finished background and mark, precisely, where people can walk and what they can walk around.
        The game uses your marks for its walkable area and its draw order, so be exact: follow the painted lines.

        floor: the BACK edge of the floor that a person standing in the scene could walk on, as points from the
        left edge (x 0) to the right edge (x 100). Follow the base of whatever stops a person: the bottom of building
        walls and doorsteps, fences, hedges, cliff faces, rock walls, counters along the back, the water's edge. Where
        open ground stretches away (a path, a field, a beach), the edge is as far back as a person could plausibly
        walk before the scenery (far hills, the horizon, a backdrop) begins. Put a point at every corner, where a
        building or wall juts forward or steps back, and enough points between that straight lines between them
        hug the painted base. Where nothing can be walked on at all from the back to the bottom of the picture (a
        building filling the front), give y 100 there.

        standing: things standing ON that walkable floor, away from the back edge, that a person could walk all the
        way around, passing in front of them and behind them: trees, bushes, lamp posts, signposts, statues,
        fountains, wells, rocks and boulders, barrels, crates, tables, chairs, benches, carts, market stalls,
        pillars. Also railings, fences and banisters that run ACROSS the walkable floor, from near the front
        towards the back (on the picture they run diagonally or nearly upright, not along the back): a person
        passes in front of them on one side and behind them on the other. NOT a fence or railing along the back
        of the floor (that is the floor's edge), NOT the buildings or walls themselves (they are the floor's edge),
        NOT things on a wall (pictures, windows, fireplaces, shelves, ladders, doors), NOT flat things lying on
        the floor (rugs, paths, puddles, shadows), NOT things in the distant scenery behind the floor.
        For each: a short name that says what it is ("wooden crate", "park bench", "iron railing"); its kind; a
        box around ALL of it [x0, y0, x1, y1], from its very top to the bottom of its lowest foot, leg or post,
        a little loose rather than cutting any of it off; base_y, the lowest point where it meets the floor; an
        outline of 8 to 20 points around its whole silhouette, following its legs and posts down to the floor;
        and openings, how the scene behind shows through it:
          none     solid all through, nothing behind shows through it: a crate, a barrel, a box, a rock, a
                   statue, a pillar, a post, a cabinet, a counter;
          under    solid, but the floor or wall behind shows beneath it or between its legs, posts or slats:
                   a table, a chair, a bench, a stool, a cart, a market stall, a well with a roof on posts;
          lattice  mostly gaps, the scene behind showing between its bars: a railing, a fence, a gate, a
                   ladder standing free, a bike rack, a climbing frame;
          leafy    a tree, a bush, a plant: leaves, with perhaps gaps of sky between them.
        Trees: include the whole canopy. At most 8, the biggest first.
        TXT;
        $pct = ['type' => 'number', 'minimum' => 0, 'maximum' => 100];
        $point = ['type' => 'array', 'items' => $pct, 'minItems' => 2, 'maxItems' => 2];
        $box = ['type' => 'array', 'items' => $pct, 'minItems' => 4, 'maxItems' => 4];
        $schema = [
            'type' => 'object',
            'required' => ['floor', 'standing', 'found'],
            'properties' => [
                'floor' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 40, 'items' => $point, 'description' => '[x, y] points along the back edge of the walkable floor, left to right.'],
                'standing' => ['type' => 'array', 'maxItems' => self::MAX_STANDING, 'items' => [
                    'type' => 'object', 'required' => ['name', 'kind', 'box', 'base_y', 'openings'],
                    'properties' => [
                        'name' => ['type' => 'string', 'maxLength' => 40],
                        'kind' => ['type' => 'string', 'enum' => self::KINDS],
                        'openings' => ['type' => 'string', 'enum' => ObjectCutter::OPENINGS],
                        'box' => $box,
                        'base_y' => $pct,
                        'outline' => ['type' => 'array', 'maxItems' => 24, 'items' => $point],
                    ],
                ]],
                'found' => ['type' => 'array', 'items' => [
                    'type' => 'object', 'required' => ['id', 'box'],
                    'properties' => ['id' => ['type' => 'string'], 'box' => ['type' => 'array', 'items' => $pct, 'maxItems' => 4]],
                ]],
            ],
        ];
        $answer = $this->llm->structured($system, $content, 'scene_survey', $schema, 6000);

        $px = fn (float $v, int $size) => (int) round(max(0, min(100, $v)) / 100 * $size);
        $floor = [];
        foreach ((array) ($answer['floor'] ?? []) as $p) {
            if (is_array($p) && count($p) >= 2 && is_numeric($p[0]) && is_numeric($p[1])) {
                $floor[] = [$px((float) $p[0], $W), $px((float) $p[1], $H)];
            }
        }
        usort($floor, fn ($a, $b) => $a[0] <=> $b[0]);
        $standing = [];
        foreach ((array) ($answer['standing'] ?? []) as $s) {
            $b = $s['box'] ?? null;
            if (! is_array($b) || count($b) !== 4 || ! in_array($s['kind'] ?? '', self::KINDS, true)) {
                continue;
            }
            [$x0, $y0, $x1, $y1] = [$px((float) min($b[0], $b[2]), $W), $px((float) min($b[1], $b[3]), $H), $px((float) max($b[0], $b[2]), $W), $px((float) max($b[1], $b[3]), $H)];
            if ($x1 - $x0 < 12 || $y1 - $y0 < 12) {
                continue;
            }
            $outline = [];
            foreach ((array) ($s['outline'] ?? []) as $p) {
                if (is_array($p) && count($p) >= 2) {
                    $outline[] = [$px((float) $p[0], $W), $px((float) $p[1], $H)];
                }
            }
            $name = mb_substr((string) ($s['name'] ?? $s['kind']), 0, 40);
            $standing[] = [
                'name' => $name, 'kind' => $s['kind'], 'box' => [$x0, $y0, $x1, $y1],
                'base' => isset($s['base_y']) ? $px((float) $s['base_y'], $H) : $y1, 'outline' => count($outline) >= 3 ? $outline : [],
                'openings' => ObjectCutter::openingsFor($s['kind'], $name, isset($s['openings']) ? (string) $s['openings'] : null),
            ];
        }
        $found = [];
        $wanted = array_flip(array_column($find, 'id'));
        foreach ((array) ($answer['found'] ?? []) as $f) {
            $b = $f['box'] ?? null;
            if (isset($wanted[$f['id'] ?? '']) && is_array($b) && count($b) === 4) {
                $found[$f['id']] = [$px((float) min($b[0], $b[2]), $W), $px((float) min($b[1], $b[3]), $H), $px((float) max($b[0], $b[2]), $W), $px((float) max($b[1], $b[3]), $H)];
            }
        }

        return ['floor' => $floor, 'standing' => array_slice($standing, 0, self::MAX_STANDING), 'found' => $found];
    }

    /** The picture as the model sees it: on a plain sky where it is see-through, at most SEND_WIDTH wide, with a labelled grid. */
    public static function gridded(GdImage $picture): GdImage
    {
        $W = imagesx($picture);
        $H = imagesy($picture);
        $scale = min(1, self::SEND_WIDTH / $W);
        $w = (int) round($W * $scale);
        $h = (int) round($H * $scale);
        $out = imagecreatetruecolor($w, $h);
        imagefill($out, 0, 0, imagecolorallocate($out, 196, 222, 240));
        imagealphablending($out, true);
        imagecopyresampled($out, $picture, 0, 0, 0, 0, $w, $h, $W, $H);
        $line = imagecolorallocatealpha($out, 255, 0, 160, 80);
        $ink = imagecolorallocate($out, 255, 255, 255);
        $shadow = imagecolorallocate($out, 0, 0, 0);
        for ($i = 1; $i < 10; $i++) {
            $x = (int) round($w * $i / 10);
            $y = (int) round($h * $i / 10);
            imageline($out, $x, 0, $x, $h, $line);
            imageline($out, 0, $y, $w, $y, $line);
            foreach ([[$x + 3, 3, (string) ($i * 10)], [3, $y + 3, (string) ($i * 10)]] as [$tx, $ty, $label]) {
                imagestring($out, 5, $tx + 1, $ty + 1, $label, $shadow);
                imagestring($out, 5, $tx, $ty, $label, $ink);
            }
        }

        return $out;
    }
}
