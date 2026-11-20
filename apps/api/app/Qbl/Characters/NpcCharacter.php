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

        return $settings;
    }

    public function toDocument(): array
    {
        return array_filter(['id' => $this->id, 'name' => $this->name, 'scale' => $this->scale, 'animations' => $this->animations ?: null] + $this->settings, fn ($v) => $v !== null);
    }
}
