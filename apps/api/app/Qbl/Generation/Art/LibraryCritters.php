<?php

namespace App\Qbl\Generation\Art;

/**
 * The ready-made animals and vehicles of the asset library (scenarios/assets/library, from the
 * QuestLab Assets) that a mission's little life can use instead of a drawn creature: a bluebird that
 * really takes off, lands and pecks, a squirrel, a cat, a horse and cart. The designer picks one by its
 * slug (`ambient[].library`) when it fits the place and the story; anything else (a rabbit, a heron,
 * a robot dog) is drawn as before.
 *
 * Only the animals and vehicles listed in CATALOGUE are offered, each with what it is, what it can do
 * (the ambient motions it suits) and its real size. Its picture and animations are read from the
 * library's own library.json when it is used, so the catalogue never has to repeat them.
 */
final class LibraryCritters
{
    /** slug => [what it is, the motions it suits, its real size in cm]. */
    public const CATALOGUE = [
        'bluebird' => ['a small round bluebird (pixel art) that hops, pecks, takes off and lands', ['lands', 'flies_by', 'walks_by'], 15],
        'hen' => ['a farmyard hen that struts and pecks', ['walks_by', 'lands'], 40],
        'hawk' => ['a hawk gliding high overhead', ['flies_by'], 55],
        'red-squirrel' => ['a little red squirrel that bounds along with its tail up', ['climbs', 'walks_by'], 35],
        'woodland-squirrel' => ['a brown woodland squirrel that runs, jumps and crouches', ['climbs', 'walks_by'], 35],
        'husky' => ['a grey and white husky dog that trots, runs and barks', ['walks_by'], 70],
        'puppy' => ['a cartoon puppy that runs and jumps', ['walks_by'], 45],
        'tabby-kitten' => ['a cartoon tabby kitten that runs and jumps', ['walks_by'], 35],
        'black-cat' => ['a black cat that strolls and runs', ['walks_by'], 45],
        'komodo-dragon' => ['a big lizard (a komodo dragon) that crawls along', ['walks_by'], 150],
        'snake' => ['a green snake that slithers along', ['walks_by'], 90],
        'turtle' => ['a turtle that plods along (and hides in its shell)', ['walks_by'], 30],
        'mountain-goat' => ['a white mountain goat that grazes and leaps', ['walks_by'], 110],
        'horse' => ['a brown horse that walks, runs and eats', ['walks_by'], 160],
        'goldfish' => ['a cartoon goldfish', ['swims_by'], 25],
        'yellow-tang' => ['a bright yellow reef fish', ['swims_by'], 25],
        'red-convertible' => ['a red open-top car', ['drives_by'], 420],
        'yellow-roadster' => ['a little yellow roadster car', ['drives_by'], 380],
        'farm-truck' => ['an old farm truck', ['drives_by'], 520],
        'silver-hatchback' => ['a small silver hatchback car', ['drives_by'], 400],
        'stagecoach' => ['a horse-drawn stagecoach', ['drives_by'], 600],
    ];

    /** Names the library gives the standing and walking poses, and the names a critter plays them by. */
    private const RENAME = ['stand_right' => 'idle', 'walk_right' => 'walk'];

    private ?array $assets = null;

    public function __construct(private ?string $dir) {}

    /** The catalogue as the designer sees it: one line each. */
    public static function described(): string
    {
        return implode("\n", array_map(
            fn ($slug, $c) => "- $slug: {$c[0]} (".implode(', ', $c[1]).", about {$c[2]} cm)",
            array_keys(self::CATALOGUE), self::CATALOGUE,
        ));
    }

    /** Whether the library's files are here to use. */
    public function available(): bool
    {
        return $this->dir !== null && is_file($this->dir.'/library.json');
    }

    /**
     * A ready-made critter as a sprite-sheet asset (path, size, frame size, and media params with the
     * sheet's grid and its animations, renamed: idle, walk, fly, peck, take_off, land, hop, run...), and
     * how much it is scaled to its real size. Null when it is not in the library.
     *
     * @return array{asset: array, scale: float, animations: array<string, string>, faces: string}|null
     */
    public function asset(string $slug, ?int $sizeCm = null): ?array
    {
        if (! isset(self::CATALOGUE[$slug]) || ! $this->available()) {
            return null;
        }
        $this->assets ??= array_column((array) (json_decode((string) file_get_contents($this->dir.'/library.json'), true)['assets'] ?? []), null, 'slug');
        $a = $this->assets[$slug] ?? null;
        if (! $a) {
            return null;
        }
        // An animal is a character with a sheet; a vehicle is a sheet of its own.
        $role = $a['kind'] === 'character' ? 'sheet' : ($a['definition']['file'] ?? 'sheet');
        $file = $a['files'][$role] ?? null;
        $path = $file ? realpath($this->dir.'/'.$file['file']) : false;
        if (! $path || ! is_file($path)) {
            return null;
        }
        [$w, $h] = getimagesize($path) ?: [0, 0];
        $grid = (array) ($file['params']['sheet'] ?? ['columns' => 1, 'rows' => 1]);
        $fw = (int) floor($w / max(1, (int) ($grid['columns'] ?? 1)));
        $fh = (int) floor($h / max(1, (int) ($grid['rows'] ?? 1)));
        $animations = [];
        foreach ((array) ($a['definition']['animations'] ?? $file['params']['animations'] ?? []) as $name => $def) {
            $name = is_string($name) ? $name : (string) ($def['name'] ?? '');
            if ($name === '' || ! is_array($def) || empty($def['frames']) || ($def['file'] ?? $role) !== $role) {
                continue;
            }
            $animations[] = array_filter([
                'name' => self::RENAME[$name] ?? $name, 'frames' => array_values($def['frames']), 'duration' => $def['duration'] ?? null,
                // Walking, flying and running loop; a peck or a landing plays once.
                'repeat' => $def['repeat'] ?? (in_array(self::RENAME[$name] ?? $name, ['idle', 'walk', 'fly', 'run'], true) ? true : null),
            ], fn ($v) => $v !== null);
        }
        if (! $animations) {
            $animations[] = ['name' => 'idle', 'frames' => [0]];
        }
        $names = array_column($animations, 'name');
        // What a critter asks for, played by what the sheet has.
        $play = array_filter([
            'hop' => in_array('hop', $names, true) ? 'hop' : (in_array('jump', $names, true) ? 'jump' : null),
            'climb' => in_array('run', $names, true) ? 'run' : (in_array('hop', $names, true) ? 'hop' : null),
        ]);
        // Scaled to its real size beside the people: its longest side.
        $cm = $sizeCm ?: self::CATALOGUE[$slug][2];
        $scale = $fw > 0 && $fh > 0 ? round(\App\Qbl\Generation\Design\Sizes::pixels($cm) / max($fw, $fh), 3) : 1.0;

        return [
            'asset' => ['path' => $path, 'width' => $w, 'height' => $h, 'frame_width' => $fw, 'frame_height' => $fh, 'params' => ['sheet' => ['columns' => (int) ($grid['columns'] ?? 1), 'rows' => (int) ($grid['rows'] ?? 1)] + (isset($grid['count']) ? ['count' => (int) $grid['count']] : []), 'animations' => $animations, 'library' => $slug] + (! empty($a['credit']) ? ['credit' => $a['credit']] : [])],
            'scale' => max(0.1, $scale),
            'animations' => $play,
            'faces' => (string) ($a['definition']['item']['settings']['art_faces'] ?? 'right'),
        ];
    }
}
