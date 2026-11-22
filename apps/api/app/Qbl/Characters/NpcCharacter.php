<?php

namespace App\Qbl\Characters;

/**
 * A character a scenario defines: a row of `characters`, whose `settings` hold its animations,
 * size and voice, where it starts (`scene_id`, `position_x`, `position_y`, `facing`), whether it
 * walks around on its own (`roams`, `walk_speed`) and which of its events a click runs
 * (`event_id`). Its own events are rows of `events` with its `character_id`. Its pictures are the
 * scenario's media.
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
        // Walking around on its own: a yes or no, and how fast it walks.
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
        // Routines are gone: a character moves by walk actions in events, or walks around on its own.
        unset($settings['routine']);
        // Where it starts: a scene (its id; the store checks it is the scenario's), a spot, a way to face.
        foreach (['scene_id', 'event_id'] as $key) {
            if (array_key_exists($key, $settings)) {
                if (is_numeric($settings[$key]) && (int) $settings[$key] > 0) {
                    $settings[$key] = (int) $settings[$key];
                } else {
                    unset($settings[$key]);
                }
            }
        }
        foreach (['position_x', 'position_y'] as $key) {
            if (array_key_exists($key, $settings)) {
                if (is_numeric($settings[$key])) {
                    $settings[$key] = round((float) $settings[$key], 1);
                } else {
                    unset($settings[$key]);
                }
            }
        }
        if (array_key_exists('facing', $settings) && ! in_array($settings['facing'], ['left', 'right'], true)) {
            unset($settings['facing']);
        }
        // Its own events are rows of their own (events with this character's id), not settings.
        unset($settings['events']);

        return $settings;
    }

    public function toDocument(): array
    {
        return array_filter(['id' => $this->id, 'name' => $this->name, 'scale' => $this->scale, 'animations' => $this->animations ?: null] + $this->settings, fn ($v) => $v !== null);
    }
}
