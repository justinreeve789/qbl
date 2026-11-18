<?php

namespace App\Qbl\Generation\Design;

/**
 * The shape of a mission blueprint: what the language model writes, and all it writes.
 *
 * A blueprint is deliberately higher-level than the scenario JSON. The model decides the story,
 * the places, the people and things, what students do and in what order; it never writes event ids,
 * action sequences, variable names or coordinates. MissionBuilder turns a blueprint into QBL rows
 * with the patterns from docs/docs/extensions.md, so whatever the model writes, the result is a
 * scenario the validator accepts and the runtime plays.
 */
final class BlueprintSchema
{
    public const KEY = '^[a-z][a-z0-9_]{1,30}$';

    public const INTERACTIONS = ['talk', 'collect', 'inspect', 'question', 'experiment', 'team_task'];

    public const ITEM_KINDS = ['collectible', 'tool', 'evidence', 'prop', 'vehicle'];

    public const EDGES = ['left', 'right', 'top', 'bottom'];

    public static function schema(array $limits): array
    {
        $key = ['type' => 'string', 'pattern' => self::KEY];
        $text = fn (string $d, int $max = 400) => ['type' => 'string', 'description' => $d, 'maxLength' => $max];
        $line = ['type' => 'object', 'required' => ['speaker', 'text'], 'properties' => [
            'speaker' => ['type' => 'string', 'description' => 'A character key, or "player" for the student\'s own reply.'],
            'text' => $text('What is said. At most 200 characters. {{QBLPlayerName}} is the student\'s name.', 200),
        ]];
        $award = ['type' => 'object', 'required' => ['stars', 'xp', 'note'], 'properties' => [
            'stars' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 10],
            'xp' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 50],
            'note' => $text('Two to four words shown with it: "Sample collected".', 40),
        ]];

        return [
            'type' => 'object',
            'required' => ['title', 'subtitle', 'description', 'story', 'start_scene', 'scenes', 'characters', 'items', 'interactions', 'steps', 'intro', 'completion'],
            'properties' => [
                'title' => $text('Mission title, at most 6 words.', 60),
                'subtitle' => $text('One line under the title that says what students will do.', 140),
                'description' => $text('For the teacher: what the mission is about, what students do, and what they learn. 2-4 sentences.', 800),
                'story' => ['type' => 'object', 'required' => ['premise', 'player_role', 'resolution'], 'properties' => [
                    'premise' => $text('The situation that needs solving.', 600),
                    'player_role' => $text('Who the students are in the story (they are always a crew of space explorers from the starship).', 200),
                    'resolution' => $text('How the mission ends when they succeed.', 400),
                ]],
                'art_direction' => ['type' => 'object', 'properties' => [
                    'setting' => $text('Where this happens, visually: biome, era, architecture, recurring motifs. Must work in the house art style.', 400),
                    'accent_colors' => ['type' => 'array', 'maxItems' => 3, 'description' => 'Up to 3 accent colours for this mission, as #rrggbb, chosen to sit inside the house palette.', 'items' => ['type' => 'string', 'pattern' => '^#[0-9a-fA-F]{6}$']],
                    'time_of_day' => ['type' => 'string', 'enum' => ['morning', 'midday', 'golden hour', 'dusk', 'night', 'indoor lighting']],
                ]],
                'start_scene' => $key,
                'scenes' => ['type' => 'array', 'minItems' => 2, 'maxItems' => $limits['max_scenes'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'title', 'background', 'ground_line', 'exits'],
                    'properties' => [
                        'key' => $key,
                        'title' => $text('Name shown when students arrive: "Wilting Marsh".', 40),
                        'description' => $text('For the teacher: what happens here.', 300),
                        'background' => $text('What the background picture shows, as a side-on view: the place, its landmarks and the objects that are part of the scenery, left to right. No characters or people. Do not describe the art style; that is added for you.', 700),
                        'ground_line' => ['type' => 'number', 'minimum' => 0.55, 'maximum' => 0.8, 'description' => 'Where the walkable floor begins, as a fraction of the picture height from the top. Everything below it is floor students walk on.'],
                        'indoor' => ['type' => 'boolean'],
                        'exits' => ['type' => 'array', 'maxItems' => 4, 'items' => [
                            'type' => 'object', 'required' => ['edge', 'to'],
                            'properties' => [
                                'edge' => ['type' => 'string', 'enum' => self::EDGES, 'description' => 'Which edge of this scene students walk off to leave. Each edge leads to at most one scene.'],
                                'to' => $key,
                                'requires' => ['type' => 'string', 'description' => 'Optional: the key of one interaction or step that must be done before this way opens.'],
                                'locked_message' => $text('Shown while it is still closed.', 160),
                            ],
                        ]],
                        'props' => ['type' => 'array', 'maxItems' => 3, 'items' => ['type' => 'object', 'required' => ['item', 'x'], 'properties' => [
                            'item' => $key,
                            'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9],
                        ]]],
                    ],
                ]],
                'characters' => ['type' => 'array', 'minItems' => 1, 'maxItems' => $limits['max_characters'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'role', 'appearance', 'personality', 'scene', 'x'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'role' => $text('Their part in the story.', 200),
                        'appearance' => $text('Only what they look like: species or kind of being, body shape, height relative to a child, clothing, colours (name 3-4 main colours), one or two distinctive features. Full body. Friendly and appropriate for children. No text or logos on clothing.', 500),
                        'personality' => $text('How they talk and behave, in a few words.', 200),
                        'guide' => ['type' => 'boolean', 'description' => 'True for the one character who briefs the students and receives the final report.'],
                        'scene' => $key,
                        'x' => ['type' => 'number', 'minimum' => 0.12, 'maximum' => 0.88, 'description' => 'Where they stand, as a fraction of the scene width.'],
                        'gestures' => ['type' => 'array', 'maxItems' => 2, 'items' => ['type' => 'string', 'enum' => ['wave', 'point', 'cheer', 'think']], 'description' => 'Drawn animations besides idle and walk.'],
                    ],
                ]],
                'items' => ['type' => 'array', 'maxItems' => $limits['max_items'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'kind', 'appearance', 'size'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'kind' => ['type' => 'string', 'enum' => self::ITEM_KINDS, 'description' => 'collectible/tool/evidence: shown on an interaction students click. prop: scenery that stands in a scene (blocks walking). vehicle: something students can ride.'],
                        'appearance' => $text('Only what it looks like, as a single object: shape, material, colours, details. No text.', 400),
                        'size' => ['type' => 'string', 'enum' => ['small', 'medium', 'large'], 'description' => 'small: fits in a hand; medium: about a child\'s height; large: bigger than a person.'],
                    ],
                ]],
                'interactions' => ['type' => 'array', 'minItems' => 3, 'maxItems' => 24, 'items' => [
                    'type' => 'object', 'required' => ['key', 'type', 'scene', 'label'],
                    'properties' => [
                        'key' => $key,
                        'type' => ['type' => 'string', 'enum' => self::INTERACTIONS, 'description' => 'talk: a conversation with a character. collect: pick up an item (a sample, a clue). inspect: look closely at something and learn from it. question: a multiple-choice question that checks understanding. experiment: change a quantity step by step until a target is reached. team_task: something that needs several students to each do their part (e.g. three crew members each turn a valve).'],
                        'scene' => $key,
                        'label' => $text('Short text shown over it: "Collect a sample", "Talk to Dr. Ren".', 40),
                        'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9, 'description' => 'Where it is, as a fraction of the scene width. Not needed for talk (it is where the character stands).'],
                        'high' => ['type' => 'boolean', 'description' => 'True if it is up on a wall, shelf or console rather than on the ground.'],
                        'character' => ['type' => 'string', 'description' => 'talk: the character key.'],
                        'item' => ['type' => 'string', 'description' => 'collect/inspect/experiment/team_task: the item key drawn there (optional for inspect/experiment/team_task).'],
                        'requires' => ['type' => 'array', 'maxItems' => 3, 'items' => $key, 'description' => 'Keys of interactions or steps that must be done first.'],
                        'locked_hint' => $text('Optional: shown when clicked before it is available. Only used when requires has one key.', 160),
                        'after' => ['type' => 'string', 'description' => 'question only: the key of an interaction right after which this question pops up by itself (it can also be reopened by clicking it).'],
                        'dialogue' => ['type' => 'array', 'maxItems' => 8, 'items' => $line, 'description' => 'talk: the conversation, in order. Other types: optional lines a character says first.'],
                        'info' => ['type' => 'object', 'required' => ['title', 'body'], 'properties' => [
                            'title' => $text('Heading.', 60),
                            'body' => $text('What the student observes or learns: concrete, accurate, at the grade level. Up to 3 short paragraphs separated by blank lines.', 900),
                        ]],
                        'question' => ['type' => 'object', 'required' => ['prompt', 'choices', 'objective'], 'properties' => [
                            'prompt' => $text('The question.', 300),
                            'choices' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 4, 'items' => ['type' => 'object', 'required' => ['text', 'correct', 'feedback'], 'properties' => [
                                'text' => $text('The answer as a button label.', 80),
                                'correct' => ['type' => 'boolean'],
                                'feedback' => $text('Explanation shown after choosing it; for a wrong answer, explain the misconception without giving the answer away.', 400),
                            ]]],
                            'objective' => ['type' => 'string', 'description' => 'The learning objective id it checks (LO1...).'],
                            'standards' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Standard codes it gives evidence for.'],
                        ]],
                        'experiment' => ['type' => 'object', 'required' => ['quantity', 'unit', 'start', 'min', 'max', 'target', 'increase', 'decrease', 'success'], 'properties' => [
                            'quantity' => $text('What changes: "pH", "Weight on the bridge".', 40),
                            'unit' => $text('Unit shown after the number, or empty.', 12),
                            'start' => ['type' => 'integer'], 'min' => ['type' => 'integer'], 'max' => ['type' => 'integer'], 'target' => ['type' => 'integer'],
                            'increase' => $text('Button that adds one: "Add a drop of base".', 60),
                            'decrease' => $text('Button that takes one away.', 60),
                            'success' => $text('Explanation shown when the target is reached.', 500),
                            'objective' => ['type' => 'string'],
                        ]],
                        'team' => ['type' => 'object', 'required' => ['needed', 'part', 'success'], 'properties' => [
                            'needed' => ['type' => 'integer', 'minimum' => 2, 'maximum' => 6, 'description' => 'How many different students must each do their part.'],
                            'part' => $text('What one student does: "You turn the valve".', 160),
                            'success' => $text('Shown to everyone in the scene when enough have helped.', 200),
                        ]],
                        'award' => $award,
                    ],
                ]],
                'steps' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 8, 'description' => 'The mission checklist, in order.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'text', 'done_when'],
                    'properties' => [
                        'key' => $key,
                        'text' => $text('Checklist line. A step with several interactions shows its count automatically.', 120),
                        'done_when' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $key, 'description' => 'Interaction keys; the step is done when all of them are.'],
                        'after' => ['type' => 'string', 'description' => 'Optional: a step key; this step is only listed once that one is done.'],
                        'optional' => ['type' => 'boolean'],
                    ],
                ]],
                'intro' => ['type' => 'object', 'required' => ['dialogue'], 'properties' => [
                    'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $line, 'description' => 'The guide briefs the students when they first arrive in the start scene.'],
                ]],
                'completion' => ['type' => 'object', 'required' => ['label', 'dialogue', 'award'], 'properties' => [
                    'label' => $text('Shown over the guide once every required step is done: "Report to Captain Vega".', 40),
                    'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $line],
                    'award' => $award,
                ]],
                'badge' => ['type' => 'object', 'required' => ['name', 'appearance'], 'properties' => [
                    'name' => $text('A patch students can buy in the marketplace with their stars, only from this mission.', 40),
                    'appearance' => $text('What the round embroidered patch shows. No text.', 200),
                ]],
            ],
        ];
    }
}
