<?php

namespace App\Qbl\Characters;

use App\Qbl\StoreError;

/**
 * Anyone who walks around a scene: a player's avatar (AvatarCharacter, the platform's, the same
 * in every scenario) or a character a scenario places (NpcCharacter). Both are drawn from their
 * animations, by name. Five names are the poses, which the game shows by itself: standing and
 * walking each way, and the close-up in a story box. Any other name is played when an action or
 * a move asks for it.
 *
 * An animation is `{media_id, frames?, duration?, repeat?, flip?}`: a picture (a still image, an
 * animated PNG or a sprite sheet, which is ordinary media and can serve several characters),
 * the frames of it to show, how long one pass takes, whether it loops, and whether to mirror it.
 *
 * The same rules are in packages/shared/src/characters.ts, which the game and the editor use.
 */
abstract class Character
{
    public const POSES = ['stand_right', 'stand_left', 'walk_right', 'walk_left', 'portrait'];

    public const NAME = '/^[a-z][a-z0-9_]{0,31}$/';

    /** At most this many animations per character, and frames per animation. */
    public const MAX_ANIMATIONS = 40;

    public const MAX_FRAMES = 256;

    /** @param  array<string, array>  $animations  by name */
    public function __construct(
        public readonly int $id,
        public readonly string $name,
        public readonly array $animations,
        public readonly ?float $scale = null,
    ) {}

    /** The character as the scenario document carries it. */
    abstract public function toDocument(): array;

    /** Every media id its animations use. @return list<int> */
    public function mediaIds(): array
    {
        return array_values(array_unique(array_map(fn ($a) => (int) $a['media_id'], array_values($this->animations))));
    }

    /**
     * A map of animations by name, checked and tidied: names are lowercase letters, digits and
     * underscores; each animation has a picture; frames are whole numbers. Anything else is
     * refused, as an editor sending it has gone wrong. `$mediaOk` says whether a picture may be
     * used (one of the scenario's, or one of the platform's).
     *
     * @return array<string, array>
     */
    public static function cleanAnimations(mixed $animations, ?callable $mediaOk = null): array
    {
        if ($animations === null || $animations === []) {
            return [];
        }
        if (! is_array($animations) || array_is_list($animations)) {
            throw new StoreError(422, 'animations is an object of animations by name.');
        }
        if (count($animations) > self::MAX_ANIMATIONS) {
            throw new StoreError(422, 'A character has at most '.self::MAX_ANIMATIONS.' animations.');
        }
        $out = [];
        foreach ($animations as $name => $a) {
            if (! is_string($name) || ! preg_match(self::NAME, $name)) {
                throw new StoreError(422, 'An animation name is lowercase letters, digits and underscores, starting with a letter.');
            }
            if (! is_array($a) || ! is_numeric($a['media_id'] ?? null)) {
                throw new StoreError(422, "The animation \"$name\" needs a picture.");
            }
            $mediaId = (int) $a['media_id'];
            if ($mediaOk && ! $mediaOk($mediaId)) {
                throw new StoreError(422, "The picture of the animation \"$name\" is not in this scenario.");
            }
            $clean = ['media_id' => $mediaId];
            if (isset($a['frames'])) {
                if (! is_array($a['frames']) || count($a['frames']) > self::MAX_FRAMES || array_filter($a['frames'], fn ($f) => ! is_int($f) && ! (is_string($f) && ctype_digit($f)))) {
                    throw new StoreError(422, "The frames of the animation \"$name\" are a list of frame numbers.");
                }
                if ($a['frames']) {
                    $clean['frames'] = array_map('intval', array_values($a['frames']));
                }
            }
            if (isset($a['duration']) && is_numeric($a['duration']) && $a['duration'] > 0) {
                $clean['duration'] = (int) min(600000, round((float) $a['duration']));
            }
            if (isset($a['repeat']) && is_bool($a['repeat'])) {
                $clean['repeat'] = $a['repeat'];
            }
            if (($a['flip'] ?? false) === true) {
                $clean['flip'] = true;
            }
            $out[$name] = $clean;
        }

        return $out;
    }

    /**
     * A character's animations as they were written before characters had any: one picture (a
     * still image, or a sprite sheet whose own `idle` and walks were the poses) and a close-up.
     * Art was drawn facing right; the other way is the same art mirrored.
     *
     * @param  array|null  $media  the picture's media entry: id, and sheet and animations if it is a sheet
     * @return array<string, array>
     */
    public static function animationsFromPicture(?array $media, ?int $portraitId = null): array
    {
        $out = [];
        if ($media && isset($media['id'])) {
            $id = (int) $media['id'];
            $sheet = is_array($media['sheet'] ?? null) ? $media['sheet'] : null;
            $list = $sheet && is_array($media['animations'] ?? null) && array_is_list($media['animations']) ? $media['animations'] : [];
            $find = function (string $name) use ($list) {
                foreach ($list as $a) {
                    if (($a['name'] ?? null) === $name) {
                        return $a;
                    }
                }

                return null;
            };
            $from = fn (array $a, bool $flip = false) => array_filter([
                'media_id' => $id, 'frames' => array_map('intval', $a['frames'] ?? []), 'duration' => $a['duration'] ?? null, 'repeat' => $a['repeat'] ?? null, 'flip' => $flip ?: null,
            ], fn ($v) => $v !== null && $v !== []);
            $idle = $find('idle');
            $out['stand_right'] = $idle ? $from($idle) : ($sheet ? ['media_id' => $id, 'frames' => [0]] : ['media_id' => $id]);
            $walk = $find('walk');
            $right = $find('walk_right') ?? $walk;
            $left = $find('walk_left');
            if ($right) {
                $out['walk_right'] = $from($right);
            }
            if ($left) {
                $out['walk_left'] = $from($left);
            } elseif ($walk && $right !== $walk) {
                $out['walk_left'] = $from($walk, true);
            }
            foreach ($list as $a) {
                $name = (string) ($a['name'] ?? '');
                if (preg_match(self::NAME, $name) && ! in_array($name, ['idle', 'walk', 'walk_left', 'walk_right', ...self::POSES], true)) {
                    $out[$name] = $from($a);
                }
            }
        }
        if ($portraitId !== null) {
            $out['portrait'] = ['media_id' => $portraitId];
        }

        return $out;
    }

    /**
     * The animation a page shows for the character: standing facing right (else the other way,
     * mirrored), or for `portrait` its close-up (else standing).
     *
     * @return array{name: string, animation: array, flip: bool}|null
     */
    public function chosen(string $which = 'stand'): ?array
    {
        $order = $which === 'portrait'
            ? [['portrait', false], ['stand_right', false], ['stand_left', true]]
            : [['stand_right', false], ['stand_left', true], ['portrait', false]];
        foreach ($order as [$name, $mirrored]) {
            if (isset($this->animations[$name])) {
                $a = $this->animations[$name];

                return ['name' => $name, 'animation' => $a, 'flip' => (($a['flip'] ?? false) === true) !== $mirrored];
            }
        }

        return null;
    }
}
