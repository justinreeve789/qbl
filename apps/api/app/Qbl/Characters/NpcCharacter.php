<?php

namespace App\Qbl\Characters;

/**
 * A character a scenario defines and places in its scenes: a row of `characters`, whose
 * `settings` hold its animations, size and voice. Its pictures are the scenario's media.
 *
 * Rows written before characters had animations have a picture (`media_id`) and a close-up
 * (`settings.portrait_media_id`) instead; they are read as animations (see animationsFromPicture),
 * and the editor writes animations the first time it changes one.
 */
final class NpcCharacter extends Character
{
    public function __construct(int $id, string $name, array $animations, ?float $scale = null, public readonly array $settings = [])
    {
        parent::__construct($id, $name, $animations, $scale);
    }

    /**
     * From a `characters` row. `$media` looks up the scenario's media by id (for a legacy row's
     * sheet); without it, a legacy picture is read as a still image.
     */
    public static function fromRow(array $row, ?callable $media = null): self
    {
        $settings = is_string($row['settings'] ?? null) ? (json_decode($row['settings'], true) ?: []) : (array) ($row['settings'] ?? []);
        $animations = is_array($settings['animations'] ?? null) && ! array_is_list($settings['animations']) ? $settings['animations'] : [];
        if (! $animations) {
            $pictureId = isset($row['media_id']) ? (int) $row['media_id'] : null;
            $picture = $pictureId ? (($media ? $media($pictureId) : null) ?? ['id' => $pictureId]) : null;
            $animations = self::animationsFromPicture($picture, isset($settings['portrait_media_id']) ? (int) $settings['portrait_media_id'] : null);
        }

        return new self((int) $row['id'], (string) ($row['name'] ?? 'Character'), $animations, isset($settings['scale']) ? (float) $settings['scale'] : null, $settings);
    }

    /**
     * The settings to store for a character's row: its animations checked and tidied, every
     * picture one of the scenario's (`$mediaOk`). Settings without animations are left alone.
     */
    public static function cleanSettings(array $settings, callable $mediaOk): array
    {
        if (array_key_exists('animations', $settings)) {
            $settings['animations'] = self::cleanAnimations($settings['animations'], $mediaOk) ?: null;
            if ($settings['animations'] === null) {
                unset($settings['animations']);
            }
        }
        // Walking around on its own: a yes or no, a speed, and a routine of steps.
        if (array_key_exists('roams', $settings)) {
            if ($settings['roams'] === true) {
                $settings['roams'] = true;
            } else {
                unset($settings['roams']);
            }
        }
        if (array_key_exists('walk_speed', $settings)) {
            $speed = is_numeric($settings['walk_speed']) ? (float) $settings['walk_speed'] : 0;
            if ($speed > 0) {
                $settings['walk_speed'] = min($speed, 5000);
            } else {
                unset($settings['walk_speed']);
            }
        }
        if (array_key_exists('routine', $settings)) {
            $routine = self::cleanRoutine($settings['routine']);
            if ($routine === null) {
                unset($settings['routine']);
            } else {
                $settings['routine'] = $routine;
            }
        }

        return $settings;
    }

    /** The kinds of step a routine can have, as in @qbl/shared ROUTINE_STEP_TYPES. */
    public const ROUTINE_STEPS = ['walk', 'wait', 'dialogue', 'animate', 'variable'];

    /** At most this many steps: a routine is a loop of a few things, not a script. */
    public const MAX_ROUTINE_STEPS = 100;

    /**
     * A routine kept to its shape: a list of steps of the known kinds (other keys of a step are
     * kept as they are, like an action's params), whether it loops, and its conditions. Null when
     * it has no steps left.
     */
    public static function cleanRoutine(mixed $routine): ?array
    {
        if (! is_array($routine) || ! is_array($routine['steps'] ?? null)) {
            return null;
        }
        $steps = [];
        foreach (array_values($routine['steps']) as $step) {
            if (is_array($step) && in_array($step['type'] ?? null, self::ROUTINE_STEPS, true)) {
                $steps[] = $step;
            }
            if (count($steps) >= self::MAX_ROUTINE_STEPS) {
                break;
            }
        }
        if (! $steps) {
            return null;
        }
        $out = ['steps' => $steps];
        if (($routine['loop'] ?? true) === false) {
            $out['loop'] = false;
        }
        if (is_array($routine['conditions'] ?? null) && $routine['conditions']) {
            $out['conditions'] = array_values(array_filter($routine['conditions'], 'is_array'));
        }

        return $out;
    }

    public function toDocument(): array
    {
        return array_filter(['id' => $this->id, 'name' => $this->name, 'scale' => $this->scale, 'animations' => $this->animations ?: null] + $this->settings, fn ($v) => $v !== null);
    }
}
