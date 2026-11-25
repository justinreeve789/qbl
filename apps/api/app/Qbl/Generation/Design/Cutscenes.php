<?php

namespace App\Qbl\Generation\Design;

/**
 * Cutscenes told like a comic or a film: shots and panels, for stories and for missions.
 *
 * A story scene (StorySchema), or a panel of a mission's cutscene (BlueprintSchema `cutscenes`), is a
 * page that plays by itself. What this adds is how it is framed and how one page follows another, the
 * devices a storyteller uses:
 *
 *   shot      wide (the whole place, the usual) or close (the camera near the characters, who fill much
 *             of the picture: emotion, a reaction, a decision, a hand on a key object).
 *   continues the next panel of an earlier scene: the same place from the same view a moment later.
 *             Everything stays where it was unless `changes` or the script says otherwise: the raven is
 *             now on the bookshelf; the candle has burned down; the door stands open. With no changes
 *             the earlier picture is used again (nothing is drawn); with changes it is redrawn as an edit
 *             of the earlier picture, so the two panels match.
 *   show      a beat: a picture shown full-screen over the scene for a moment (an insert): a close-up of
 *             the letter, a memory, the ship far away, what a character imagines. Its camera can move
 *             slowly over it (push in, pull out, pan) and it can be tinted as a memory or a dream. Drawn.
 *   camera    a beat: the view pushes in on someone (tension, a reaction), pulls back to the whole stage
 *             (a reveal), or pans to somewhere.
 *
 * And one rule: a still picture is never up for more than 20 seconds. An insert is at most 20 seconds;
 * a close-up panel must fit its script into about 20 seconds (more: continue it in a new panel); and
 * while any scene plays, the builder lets the camera drift a little whenever nothing has moved for a
 * while (StoryStaging), so the view never sits still too long.
 */
final class Cutscenes
{
    public const SHOTS = ['wide', 'close'];

    /** How much bigger everything is in a close shot. */
    public const CLOSE = 2.0;

    public const MOTIONS = ['still', 'push_in', 'pull_out', 'pan_left', 'pan_right'];

    public const TONES = ['memory', 'dream'];

    public const CAMERA_MOVES = ['push_in', 'pull_back', 'pan'];

    /** The longest a still picture may stay, in milliseconds. */
    public const MAX_STILL_MS = 20000;

    /** Inserts (show beats) drawn for a whole story or mission, at most. */
    public const MAX_INSERTS = 6;

    /** The schema of the beats this adds to a script (StorySchema's beat). */
    public static function beatProperties(): array
    {
        return [
            'picture' => ['type' => 'string', 'maxLength' => 300, 'description' => 'show: what the picture shows, as one illustration in the house style (no text in it): "a close-up of the torn map in Mo\'s hands, the missing corner shaped like a key", "the old lighthouse far away across the dark sea", "young Grandpa, fifty years ago, planting the very same tree".'],
            'motion' => ['type' => 'string', 'enum' => self::MOTIONS, 'description' => 'show: how the camera moves over the picture while it is shown: push_in (closer and closer: tension), pull_out (revealing more), pan_left or pan_right (gliding across), still.'],
            'tone' => ['type' => 'string', 'enum' => self::TONES, 'description' => 'show, optional: memory (warm, faded, soft edges: a flashback) or dream (hazy and bright).'],
            'move' => ['type' => 'string', 'enum' => self::CAMERA_MOVES, 'description' => 'camera: push_in on someone (who): tension, a reaction, a face as the truth dawns; pull_back to the whole stage: a reveal, the bigger picture; pan to a spot across the scene (x).'],
        ];
    }

    /** The extra fields of a story scene (or a cutscene's panel). */
    public static function sceneProperties(array $sceneKey): array
    {
        return [
            'shot' => ['type' => 'string', 'enum' => self::SHOTS, 'description' => 'wide (default): the whole place, the characters full size in it. close: a close-up, the camera near the characters, who are drawn twice as big: for emotion, a reaction, a decision, someone doing something with their hands. A close-up is a short moment: its script plays in about 20 seconds at most (continue it in another panel).'],
            'continues' => $sceneKey + ['description' => 'Optional: the key of an earlier scene this is the next panel of: the same place, from the same view, a moment later, with everything where it was unless `changes` or the script says otherwise. Repeat its background, ground_line and shot, and its cast where they ended up. Use it to show time passing, a reveal, a before and after, a reaction, without leaving the place.'],
            'changes' => ['type' => 'string', 'maxLength' => 300, 'description' => 'With continues, optional: what is different in the picture itself from the earlier panel, one or two things: "a black raven now sits on top of the bookshelf; books lie scattered on the floor", "the candle has burned down; moonlight comes through the window". No changes: the very same picture.'],
        ];
    }

    /** Roughly how long a beat takes to play, in milliseconds, and whether something moves or changes on screen during it. */
    public static function beatTime(array $beat): array
    {
        $text = trim((string) ($beat['text'] ?? ''));
        $reading = (int) max(2600, min(12000, 1600 + 62 * mb_strlen($text)));

        return match ($beat['do'] ?? '') {
            'narrate' => [$reading, false],
            'say' => [(int) max(1800, 900 + 60 * mb_strlen($text)), false],
            'title' => [2800, true],
            'wait' => [(int) round(1000 * max(0.5, min(6, (float) ($beat['seconds'] ?? 1.5)))), false],
            'walk', 'enter', 'leave' => [3200, true],
            'gesture' => [1200, true],
            'weather' => [1200, true],
            'pass' => [1800, true],
            'sound' => [0, false],
            'camera' => [(int) round(1000 * max(1, min(6, (float) ($beat['seconds'] ?? 2.5)))), true],
            'show' => [self::showTime($beat), true],
            default => [0, false],
        };
    }

    /** How long a picture insert stays: as asked, at least long enough to read its words, never over 20 seconds. */
    public static function showTime(array $beat): int
    {
        $text = trim((string) ($beat['text'] ?? ''));
        $reading = $text !== '' ? (int) (1600 + 62 * mb_strlen($text)) : 0;

        return (int) min(self::MAX_STILL_MS, max(3500, 1000 * (float) ($beat['seconds'] ?? 0), $reading));
    }

    /** How long a whole script takes, beats that run meanwhile not counted. */
    public static function scriptTime(array $script): int
    {
        $ms = 0;
        foreach ($script as $beat) {
            if (empty($beat['meanwhile'])) {
                $ms += self::beatTime((array) $beat)[0];
            }
        }

        return $ms;
    }

    /**
     * The problems with a scene's framing and beats, for a validator: a panel continuing a scene that
     * is not earlier, changes without continues, a close-up that runs long, an insert with nothing to
     * show or too much to read, a camera move with nobody to push in on.
     *
     * @param  array<string, true>  $earlier  keys of the scenes (panels) before this one
     * @return string[]
     */
    public static function problems(string $p, array $scene, array $earlier, array $characters): array
    {
        $e = [];
        if (isset($scene['shot']) && ! in_array($scene['shot'], self::SHOTS, true)) {
            $e[] = "$p.shot: wide or close.";
        }
        if (isset($scene['continues']) && ! isset($earlier[$scene['continues']])) {
            $e[] = "$p.continues: \"{$scene['continues']}\" is not an earlier scene; a panel continues one that came before it.";
        }
        if (! empty($scene['changes']) && empty($scene['continues'])) {
            $e[] = "$p.changes: only for a panel that continues an earlier one (continues).";
        }
        $script = array_values((array) ($scene['script'] ?? []));
        if (($scene['shot'] ?? 'wide') === 'close' && ($ms = self::scriptTime($script)) > self::MAX_STILL_MS + 4000) {
            $e[] = sprintf('%s: a close-up plays for about %d seconds; keep it to about 20 (a still picture gets dull) and carry on in another panel that continues it.', $p, round($ms / 1000));
        }
        foreach ($script as $i => $beat) {
            $bp = "$p.script[$i]";
            switch ($beat['do'] ?? '') {
                case 'show':
                    if (trim((string) ($beat['picture'] ?? '')) === '') {
                        $e[] = "$bp (show).picture: say what the picture shows.";
                    }
                    if (isset($beat['motion']) && ! in_array($beat['motion'], self::MOTIONS, true)) {
                        $e[] = "$bp (show).motion: one of ".implode(', ', self::MOTIONS).'.';
                    }
                    if (isset($beat['tone']) && ! in_array($beat['tone'], self::TONES, true)) {
                        $e[] = "$bp (show).tone: memory or dream.";
                    }
                    if (1600 + 62 * mb_strlen(trim((string) ($beat['text'] ?? ''))) > self::MAX_STILL_MS) {
                        $e[] = "$bp (show).text: too much to read over one picture (it would be up for more than 20 seconds); split it over two pictures, or narrate part of it in the scene.";
                    }
                    break;
                case 'camera':
                    $move = $beat['move'] ?? '';
                    if (! in_array($move, self::CAMERA_MOVES, true)) {
                        $e[] = "$bp (camera).move: one of ".implode(', ', self::CAMERA_MOVES).'.';
                    } elseif ($move === 'push_in' && ! isset($characters[$beat['who'] ?? ''])) {
                        $e[] = "$bp (camera): push_in needs who to push in on (a character on the stage).";
                    } elseif ($move === 'pan' && ! is_numeric($beat['x'] ?? null)) {
                        $e[] = "$bp (camera): pan needs x, where to look across the scene.";
                    }
                    break;
            }
        }

        return $e;
    }

    /**
     * The pictures to draw for show beats: insert key => [what it shows, its scene].
     *
     * @param  list<array>  $scenes  story scenes, or a mission's panels (panels())
     * @return array<string, array{picture: string, scene: string, tone: ?string}>
     */
    public static function inserts(array $scenes): array
    {
        $out = [];
        foreach ($scenes as $scene) {
            foreach (array_values((array) ($scene['script'] ?? [])) as $i => $beat) {
                if (($beat['do'] ?? '') === 'show' && trim((string) ($beat['picture'] ?? '')) !== '' && count($out) < self::MAX_INSERTS) {
                    $out["insert:{$scene['key']}:$i"] = ['picture' => trim((string) $beat['picture']), 'scene' => $scene['key'], 'tone' => $beat['tone'] ?? null];
                }
            }
        }

        return $out;
    }

    /**
     * A mission's cutscenes as panels: each a story scene of its own, keyed cut_<cutscene>_<n>, set in one
     * of the mission's scenes (`at`, whose look it has: background, sky, lights, weather...) or continuing
     * the panel before it (`continues: true`). `base` is the scene whose picture it starts from.
     *
     * @return list<array> scenes, in order, each with key, title, base, shot, changes, cast, script, cutscene, n
     */
    public static function panels(array $b): array
    {
        $scenes = array_column((array) ($b['scenes'] ?? []), null, 'key');
        $out = [];
        foreach ((array) ($b['cutscenes'] ?? []) as $cut) {
            $prev = null;
            foreach (array_values((array) ($cut['panels'] ?? [])) as $n => $panel) {
                $key = 'cut_'.($cut['key'] ?? 'scene').'_'.($n + 1);
                $continues = ! empty($panel['continues']) && $prev !== null;
                $at = $continues ? $prev['at'] : (string) ($panel['at'] ?? '');
                $place = $scenes[$at] ?? null;
                if (! $place) {
                    continue;
                }
                // Its look is the place's; a close shot of it, or the panel it continues, is drawn from that.
                $look = array_intersect_key($place, array_flip(['kind', 'background', 'ground_line', 'width', 'distance', 'foreground', 'sky', 'lights', 'atmosphere', 'weather', 'water', 'floor']));
                $shot = $continues ? ($panel['shot'] ?? $prev['shot']) : ($panel['shot'] ?? 'wide');
                $row = $look + [
                    'key' => $key, 'title' => $place['title'] ?? $at, 'at' => $at, 'shot' => $shot,
                    // A wide panel unchanged is the place itself; anything else starts from the place (or the panel before).
                    'base' => $continues ? $prev['key'] : $at,
                    'continues' => $continues ? $prev['key'] : null,
                    'changes' => trim((string) ($panel['changes'] ?? '')) ?: null,
                    'cast' => array_values((array) ($panel['cast'] ?? [])),
                    'script' => array_values((array) ($panel['script'] ?? [])),
                    'cutscene' => $cut['key'] ?? null, 'n' => $n + 1,
                ];
                $out[] = $row;
                $prev = $row;
            }
        }

        return $out;
    }

    /**
     * How a panel's picture is made (AssetDirector): "same" (the base's picture as it is), "edit" (the
     * base's picture redrawn with changes), "closer" (a close-up of the base's place, drawn with it as a
     * reference), or "new" (drawn as any background).
     */
    public static function pictureOf(array $scene, ?array $base): string
    {
        if (! $base) {
            return 'new';
        }
        $sameShot = ($scene['shot'] ?? 'wide') === ($base['shot'] ?? 'wide');
        if (! empty($scene['changes'])) {
            return $sameShot ? 'edit' : 'closer';
        }

        return $sameShot ? 'same' : 'closer';
    }
}
