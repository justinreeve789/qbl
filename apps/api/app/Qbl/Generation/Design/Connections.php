<?php

namespace App\Qbl\Generation\Design;

/**
 * How the scenes of a blueprint connect, as each scene sees it.
 *
 * A blueprint lists each connection once, from one of its two scenes. A connection is either a scene
 * edge (walk off the left, right, back or front) or a passage that stands somewhere in the scene: a door
 * into a building, a cave mouth, a hole in the ground to jump into, a ladder up a tree. Every connection
 * is two-way, so this works out the other end of each one: the opposite edge for an edge, and for a
 * passage the way back that suits it (out of a building towards the viewer, a ladder back up out of a
 * hole...) unless the blueprint says what it is.
 *
 * The validator, the background prompts, the art director and the builder all read the connections from
 * here, so they agree on where every way in and out is.
 */
final class Connections
{
    public const EDGES = ['left', 'right', 'top', 'bottom'];

    public const OPPOSITE = ['left' => 'right', 'right' => 'left', 'top' => 'bottom', 'bottom' => 'top'];

    /** Passages that stand against the back of the floor, like a door in a wall. */
    public const UPRIGHT = ['door', 'gate', 'cave', 'portal', 'tunnel', 'ladder', 'stairs_up'];

    /** Passages that lie in the floor, like a hole students jump into. */
    public const IN_FLOOR = ['hole', 'hatch', 'stairs_down'];

    public const VIAS = ['edge', 'door', 'gate', 'cave', 'portal', 'tunnel', 'ladder', 'stairs_up', 'hole', 'hatch', 'stairs_down'];

    /** The way back through a passage, when the blueprint does not say. */
    public const RETURN = [
        'door' => ['via' => 'edge', 'edge' => 'bottom'],
        'gate' => ['via' => 'edge', 'edge' => 'bottom'],
        'cave' => ['via' => 'edge', 'edge' => 'bottom'],
        'tunnel' => ['via' => 'edge', 'edge' => 'bottom'],
        'portal' => ['via' => 'portal', 'x' => 0.5],
        'hole' => ['via' => 'ladder', 'x' => 0.5],
        'hatch' => ['via' => 'ladder', 'x' => 0.5],
        'stairs_down' => ['via' => 'stairs_up', 'x' => 0.5],
        'ladder' => ['via' => 'hatch', 'x' => 0.5],
        'stairs_up' => ['via' => 'stairs_down', 'x' => 0.5],
    ];

    /** What a way back looks like when nobody described it. %s is where it leads. */
    private const LOOK = [
        'door' => 'an open doorway in a wall, leading back to %s',
        'gate' => 'an open gate, leading back to %s',
        'cave' => 'a dark cave mouth in a rock face, leading back to %s',
        'portal' => 'a shimmering round portal standing upright on the floor, leading back to %s',
        'tunnel' => 'the round mouth of a tunnel, leading back to %s',
        'ladder' => 'a sturdy ladder going up to an opening above, leading back up to %s',
        'stairs_up' => 'a short flight of stairs going up, leading back to %s',
        'hole' => 'a round dark hole in the ground with rough edges, leading down to %s',
        'hatch' => 'an open trapdoor in the floor with the top of a ladder showing, leading down to %s',
        'stairs_down' => 'stone steps going down through an opening in the floor, leading down to %s',
    ];

    /** What the button over a passage says. %s is the scene it leads to. */
    private const LABEL = [
        'door' => 'Go in: %s',
        'gate' => 'Through the gate: %s',
        'cave' => 'Into the cave: %s',
        'portal' => 'Through the portal: %s',
        'tunnel' => 'Into the tunnel: %s',
        'ladder' => 'Climb up: %s',
        'stairs_up' => 'Go up: %s',
        'hole' => 'Jump down: %s',
        'hatch' => 'Climb down: %s',
        'stairs_down' => 'Go down: %s',
    ];

    /** Whether a way through lies in the floor (a hole) rather than standing at the back (a door). */
    public static function inFloor(string $via): bool
    {
        return in_array($via, self::IN_FLOOR, true);
    }

    /**
     * Every scene's ways in and out, the ones the blueprint lists and the ways back.
     *
     * @return array<string, list<array{id: string, via: string, edge?: string, x?: float, to: string, requires?: ?string, locked_message?: ?string, label?: string, look?: string, listed: bool}>>
     */
    public static function ends(array $b): array
    {
        $titles = [];
        foreach ($b['scenes'] ?? [] as $s) {
            if (isset($s['key'])) {
                $titles[$s['key']] = $s['title'] ?? $s['key'];
            }
        }
        $out = array_fill_keys(array_keys($titles), []);
        // Listed exits, then each pair of scenes once: a scene that also lists the way back says what it is.
        $listed = [];
        foreach ($b['scenes'] ?? [] as $s) {
            foreach ($s['exits'] ?? [] as $x) {
                if (! is_array($x) || ! isset($titles[$x['to'] ?? ''], $titles[$s['key'] ?? ''])) {
                    continue;
                }
                $listed[$s['key']][$x['to']] ??= $x;
            }
        }
        $done = [];
        foreach ($listed as $from => $list) {
            foreach ($list as $to => $x) {
                if (isset($done["$to|$from"])) {
                    continue; // already paired with the exit listed in $to
                }
                $done["$from|$to"] = true;
                $out[$from][] = self::end($x, $to, $titles[$to], true);
                $back = $listed[$to][$from] ?? null;
                if ($back) {
                    $out[$to][] = self::end($back, $from, $titles[$from], true);
                } else {
                    $out[$to][] = self::end(self::returnOf($x) + [
                        'requires' => $x['requires'] ?? null,
                        'locked_message' => $x['locked_message'] ?? null,
                    ], $from, $titles[$from], false);
                }
            }
        }

        return $out;
    }

    /** The way back through an exit, as the blueprint gives it or by default. */
    public static function returnOf(array $x): array
    {
        $via = $x['via'] ?? 'edge';
        if ($via === 'edge') {
            return ['via' => 'edge', 'edge' => self::OPPOSITE[$x['edge'] ?? 'left'] ?? 'right'];
        }
        $back = is_array($x['back'] ?? null) ? $x['back'] : [];
        $default = self::RETURN[$via] ?? ['via' => 'edge', 'edge' => 'bottom'];
        if (! in_array($back['via'] ?? null, self::VIAS, true)) {
            return $default + ['look' => null];
        }

        return array_filter([
            'via' => $back['via'],
            'edge' => $back['via'] === 'edge' ? ($back['edge'] ?? 'bottom') : null,
            'x' => $back['via'] !== 'edge' ? (float) ($back['x'] ?? 0.5) : null,
            'look' => $back['look'] ?? null,
        ], fn ($v) => $v !== null);
    }

    private static function end(array $x, string $to, string $toTitle, bool $listed): array
    {
        $via = in_array($x['via'] ?? 'edge', self::VIAS, true) ? ($x['via'] ?? 'edge') : 'edge';
        if ($via === 'edge') {
            $edge = in_array($x['edge'] ?? null, self::EDGES, true) ? $x['edge'] : 'right';

            return array_filter(['id' => "exit-$edge", 'via' => 'edge', 'edge' => $edge, 'to' => $to, 'requires' => $x['requires'] ?? null, 'locked_message' => $x['locked_message'] ?? null, 'listed' => $listed], fn ($v) => $v !== null);
        }

        return array_filter([
            'id' => "way-$to",
            'via' => $via,
            'x' => max(0.12, min(0.88, (float) ($x['x'] ?? 0.5))),
            'to' => $to,
            'requires' => $x['requires'] ?? null,
            'locked_message' => $x['locked_message'] ?? null,
            'label' => ! empty($x['label']) ? (string) $x['label'] : sprintf(self::LABEL[$via], $toTitle),
            'look' => ! empty($x['look']) ? (string) $x['look'] : sprintf(self::LOOK[$via], $toTitle),
            'listed' => $listed,
        ], fn ($v) => $v !== null);
    }

    /**
     * Problems with how the scenes connect, written for the language model. $scenes: key => scene.
     *
     * @return string[]
     */
    public static function problems(array $b, array $scenes): array
    {
        $e = [];
        foreach ($scenes as $key => $scene) {
            $to = [];
            foreach ($scene['exits'] ?? [] as $i => $x) {
                $p = "scenes.$key.exits[$i]";
                $via = $x['via'] ?? 'edge';
                if (! in_array($via, self::VIAS, true)) {
                    $e[] = "$p.via: \"$via\" is not one of ".implode(', ', self::VIAS).'.';

                    continue;
                }
                if (! isset($scenes[$x['to'] ?? ''])) {
                    $e[] = "$p: \"".($x['to'] ?? '').'" is not a scene key.';

                    continue;
                }
                if ($x['to'] === $key) {
                    $e[] = "$p leads to its own scene.";
                }
                if (isset($to[$x['to']])) {
                    $e[] = "$p: \"$key\" already has a way to \"{$x['to']}\". Connect two scenes once.";
                }
                $to[$x['to']] = true;
                if ($via === 'edge' && ! in_array($x['edge'] ?? null, self::EDGES, true)) {
                    $e[] = "$p: an edge exit needs edge (left, right, top or bottom).";
                }
                if ($via !== 'edge') {
                    if (! isset($x['x']) || ! is_numeric($x['x'])) {
                        $e[] = "$p: a $via needs x, where it is across the scene (0.15 to 0.85).";
                    }
                    if (empty($x['look'])) {
                        $e[] = "$p: a $via needs look: what it looks like (\"a round blue door in the bakery wall\").";
                    }
                    $back = $x['back'] ?? null;
                    if (is_array($back) && isset($back['via']) && ! in_array($back['via'], self::VIAS, true)) {
                        $e[] = "$p.back.via: \"{$back['via']}\" is not one of ".implode(', ', self::VIAS).'.';
                    }
                }
            }
        }
        // Both scenes list the same connection: two edges must be opposite.
        foreach ($scenes as $key => $scene) {
            foreach ($scene['exits'] ?? [] as $x) {
                $back = null;
                foreach ($scenes[$x['to'] ?? '']['exits'] ?? [] as $y) {
                    if (($y['to'] ?? null) === $key) {
                        $back = $y;
                    }
                }
                if ($back && ($x['via'] ?? 'edge') === 'edge' && ($back['via'] ?? 'edge') === 'edge' && ($back['edge'] ?? null) !== (self::OPPOSITE[$x['edge'] ?? ''] ?? null)) {
                    $e[] = "\"$key\" leaves by its {$x['edge']} edge into \"{$x['to']}\", so \"{$x['to']}\"'s ".(self::OPPOSITE[$x['edge']] ?? '?')." edge must lead back to \"$key\", but it lists its {$back['edge']} edge. Exits are two-way: list each connection once.";
                }
            }
        }
        if ($e) {
            return $e;
        }

        // Each edge leads to one scene, and passages stand apart from each other.
        foreach (self::ends($b) as $key => $ends) {
            $edges = [];
            $xs = [];
            foreach ($ends as $end) {
                if ($end['via'] === 'edge') {
                    if (isset($edges[$end['edge']])) {
                        $e[] = "The {$end['edge']} edge of \"$key\" would lead both to \"{$edges[$end['edge']]}\" and to \"{$end['to']}\" (counting the ways back, which are added for you). Each edge leads to one scene: move one of them to another edge, or use a passage such as a door.";
                    }
                    $edges[$end['edge']] = $end['to'];
                } else {
                    foreach ($xs as [$ox, $oto]) {
                        if (abs($ox - $end['x']) < 0.12) {
                            $e[] = "In \"$key\" the way to \"{$end['to']}\" (x ".round($end['x'], 2).") is too close to the way to \"$oto\" (x ".round($ox, 2).'). Keep passages at least 0.12 apart; set back.x on one of them if it is a way back.';
                        }
                    }
                    $xs[] = [$end['x'], $end['to']];
                }
            }
            // A doorway at the centre back (the top edge) leaves no room for a passage there.
            if (isset($edges['top'])) {
                foreach ($xs as [$ox, $oto]) {
                    if (abs($ox - 0.5) < 0.12) {
                        $e[] = "In \"$key\" the way to \"$oto\" is at the centre, where the top-edge doorway to \"{$edges['top']}\" is. Move it to x below 0.38 or above 0.62.";
                    }
                }
            }
        }

        return $e;
    }
}
