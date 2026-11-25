<?php

namespace App\Qbl\Generation\Build;

use App\Qbl\Characters\NpcCharacter;
use App\Qbl\Generation\Design\BlueprintSchema;
use App\Qbl\Generation\Design\Sizes;
use App\Qbl\Generation\GenerationError;

/**
 * Turns a story blueprint (StorySchema) and its pictures into rows of the QBL tables, as MissionBuilder
 * does for a mission, and with its helpers: the scenes look and live the same way (layers, far views,
 * skies, lights, the air, weather, water, creatures and vehicles going by).
 *
 * Every scene is a story scene (`story`): no avatars, the player does not walk, the view follows whoever
 * acts. Its script becomes one start event that acts it out, beat by beat: the narrator's captions (read
 * aloud in the narrator's voice), lines in speech bubbles (in each character's voice), walks on, about and
 * off the stage, gestures, sounds, the weather changing, a car going by; then a jump to the next scene.
 * The last scene ends with "The End", the things to talk about, and a button to watch it again.
 *
 * Who stands where is followed beat by beat, so a character turns to face whoever they speak to and
 * walks from where they are. Characters not on the stage when a scene opens wait off it, beyond the edge
 * they will come on from.
 */
class StoryBuilder extends MissionBuilder
{
    public function build(array $blueprint, array $alignment, array $assets, array $options = []): array
    {
        $this->rows = array_fill_keys(['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'], []);
        $b = $blueprint;
        if (count($b['scenes'] ?? []) === 0) {
            throw new GenerationError('The story has no scenes.');
        }
        foreach ($b['scenes'] as $s) {
            $this->scenesByKey[$s['key']] = $s;
        }
        $this->variable('mission_complete', 0);

        // ---------------------------------------------------------------- media
        foreach ($b['items'] ?? [] as $item) {
            if ($asset = $assets["item:{$item['key']}"] ?? null) {
                $this->itemMedia[$item['key']] = [$this->media("item-{$item['key']}", $asset, 40), $asset, $item + ['kind' => 'prop']];
            }
        }
        foreach ($b['characters'] as $c) {
            $sheet = $assets["char:{$c['key']}"] ?? throw new GenerationError("There is no picture for the character {$c['key']}.");
            $mediaId = $this->media("character-{$c['key']}", $sheet, 10);
            $portrait = isset($assets["portrait:{$c['key']}"]) ? $this->media("portrait-{$c['key']}", $assets["portrait:{$c['key']}"], 30) : null;
            $id = $this->id('characters');
            $animations = NpcCharacter::animationsFromPicture(['id' => $mediaId] + (array) ($sheet['params'] ?? []), $portrait);
            $this->rows['characters'][] = ['id' => $id, 'name' => $c['name'], 'media_id' => $mediaId, 'settings' => array_filter([
                'scale' => self::characterScale($c, $sheet), 'animations' => $animations, 'tts_voice' => $options['voices'][$c['key']] ?? null, 'walk_speed' => self::STROLL,
            ])];
            $this->characterRows[$c['key']] = array_key_last($this->rows['characters']);
            $this->characterIds[$c['key']] = [$id, $c, $sheet];
        }

        // ---------------------------------------------------------------- scenes, in the order they are told
        foreach ($b['scenes'] as $s) {
            $this->sceneIds[$s['key']] = $this->id('scenes');
        }
        $keys = array_column($b['scenes'], 'key');
        foreach ($b['scenes'] as $i => $s) {
            $this->storyScene($s, $i + 1, $assets, $b, $keys[$i + 1] ?? null);
        }

        // ---------------------------------------------------------------- the scenario
        $this->rows['scenario'] = [
            'id' => 1,
            'shortname' => self::slug($b['title']),
            'title' => $b['title'],
            'subtitle' => $b['subtitle'],
            'description' => $b['description'],
            'start_scene_id' => $this->sceneIds[$keys[0]],
            'enable_save_session' => true,
            'require_login' => true,
            'allow_groups' => true,
            'max_players' => (int) ($options['max_players'] ?? 30),
            'default_language' => 'en-us',
            'settings' => array_filter([
                'spec_version' => 2,
                'visibility' => 'private',
                'chat_mode' => 'emotes',
                'move_speed' => 420,
                // Read aloud: the narration, and every line (in the characters' voices once recorded).
                'narration' => 'on',
                'narrator_voice' => $options['voices']['__narrator'] ?? null,
                'objectives' => [['id' => 'watch', 'text' => 'Watch the story to the end', 'complete_when' => [$this->cond('mission_complete', '=', 1)]]],
                'curriculum' => [
                    'standards' => array_map(fn ($s) => ['framework' => $s['framework'], 'code' => $s['code'], 'description' => $s['description'], 'alignment' => $s['alignment'], 'rationale' => $s['rationale']], $alignment['standards']),
                    'learning_objectives' => $alignment['learning_objectives'],
                    'vocabulary' => $alignment['vocabulary'],
                    'evidence' => $this->evidenceVariables($alignment),
                    'scored_questions' => 0,
                    'discussion' => array_values($b['ending']['discussion'] ?? []),
                ],
                'generated' => array_filter(['by' => 'qbl:generate', 'format' => 'story', 'generation_id' => $options['generation_id'] ?? null, 'art_style' => $options['style'] ?? null, 'at' => gmdate('c')]),
            ], fn ($v) => $v !== null),
        ];
        foreach ($alignment['standards'] as $s) {
            $this->evidence[$s['code']] ??= [];
        }

        return ['rows' => $this->rows, 'files' => $this->files, 'evidence' => $this->evidence];
    }

    /** The end of the story: "The End", the things to talk about, and a way to watch it again. */
    protected function ending(int $e, array $b): void
    {
        $this->action($e, 'text_overlay', ['text' => 'The End', 'text_font_size' => 64, 'duration' => 3000]);
        $this->action($e, 'variable', ['name' => 'mission_complete', 'operator' => 'set', 'operand' => 1]);
        $this->action($e, 'award', ['stars' => 3, 'xp' => 10, 'note' => 'Story watched']);
        $h = fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES);
        $html = '<h3>'.$h($b['title']).'</h3>';
        if (! empty($b['ending']['text'])) {
            $html .= '<p>'.$h($b['ending']['text']).'</p>';
        }
        $questions = array_values($b['ending']['discussion'] ?? []);
        if ($questions) {
            $html .= '<div data-qbl="callout" data-tone="think"><p><strong>Let\'s talk about it</strong></p><ol>'.implode('', array_map(fn ($q) => '<li>'.$h($q).'</li>', $questions)).'</ol></div>';
        }
        $first = $this->sceneIds[$b['scenes'][0]['key']];
        $this->action($e, 'infobox', ['content' => $html, 'dismissible' => true, 'call_to_actions' => [['text' => '↺ Watch it again', 'action' => ['type' => 'jump', 'scene_id' => $first]]]]);
    }

}
