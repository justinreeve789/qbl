<?php

namespace App\Qbl\Generation\Design;

/**
 * The shape of a mission blueprint: what the language model writes, and all it writes.
 *
 * A blueprint is deliberately higher-level than the scenario JSON. The model decides the story,
 * the places, the people and things, what students do and in what order; it never writes event ids,
 * action sequences, variable names or coordinates. MissionBuilder turns a blueprint into QBL rows
 * with the patterns from docs/src/content/docs/developers/extensions.md, so whatever the model writes, the result is a
 * scenario the validator accepts and the runtime plays.
 */
final class BlueprintSchema
{
    public const KEY = '^[a-z][a-z0-9_]{1,30}$';

    public const INTERACTIONS = ['talk', 'collect', 'inspect', 'question', 'experiment', 'team_task'];

    public const GESTURES = ['wave', 'point', 'cheer', 'think'];

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
            'required' => ['title', 'subtitle', 'description', 'story', 'start_scene', 'scenes', 'characters', 'items', 'interactions', 'steps', 'twists', 'intro', 'completion'],
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
                        'kind' => ['type' => 'string', 'enum' => Sizes::SCENE_KINDS, 'description' => 'outdoor; indoor (inside a building, a ship, a lab: there is a back wall); underground (a cave, a burrow, a cellar); up_high (a rooftop, a treetop, a cliff ledge); underwater. Vary them: a mission that only ever walks along one street is dull.'],
                        'background' => $text('What the background picture shows, as a side-on view: the place, its landmarks and the objects that are part of the scenery, left to right. No characters or people. Do not describe the art style; that is added for you. Do not describe doors, holes or ladders that are exits: they are drawn for you where the exits say.', 700),
                        'ground_line' => ['type' => 'number', 'minimum' => 0.55, 'maximum' => 0.8, 'description' => 'Where the walkable floor begins, as a fraction of the picture height from the top. Everything below it is floor students walk on.'],
                        'indoor' => ['type' => 'boolean', 'description' => 'Older field: the same as kind "indoor".'],
                        'exits' => ['type' => 'array', 'maxItems' => 4, 'items' => [
                            'type' => 'object', 'required' => ['to'],
                            'properties' => [
                                'to' => $key,
                                'via' => ['type' => 'string', 'enum' => Connections::VIAS, 'description' => 'How students get there. edge (default): walk off an edge of the scene. Or a passage that stands IN the scene where x says: door, gate, cave (a cave mouth), portal, tunnel, ladder or stairs_up (up to somewhere higher), or hole, hatch or stairs_down (in the floor: down to somewhere lower). Use a passage when it fits the story: going into a building is a door, exploring underground starts with a hole or a hatch, a treetop is up a ladder.'],
                                'edge' => ['type' => 'string', 'enum' => self::EDGES, 'description' => 'For via edge: which edge students walk off. top = towards the back, bottom = towards the viewer. Each edge leads to at most one scene.'],
                                'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85, 'description' => 'For a passage: where it is across the scene.'],
                                'look' => $text('For a passage: what it looks like, as one object: "a crooked round blue door in the bakery wall", "a dark hole between tree roots". No text or signs.', 200),
                                'label' => $text('For a passage: the button over it, at most 5 words: "Enter the bakery", "Jump into the hole!".', 40),
                                'back' => ['type' => 'object', 'description' => 'For a passage, optional: the way back in the other scene. Default: out of a door, gate, cave or tunnel towards the viewer (the bottom edge); back up a ladder from a hole or hatch; back down a hatch from a ladder; the same kind of portal or stairs.', 'properties' => [
                                    'via' => ['type' => 'string', 'enum' => Connections::VIAS],
                                    'edge' => ['type' => 'string', 'enum' => self::EDGES],
                                    'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85],
                                    'look' => $text('What it looks like.', 200),
                                ]],
                                'requires' => ['type' => 'string', 'description' => 'Optional: the key of one interaction, step or twist that must be done (or happen) before this way opens.'],
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
                        'voice' => ['type' => 'object', 'description' => 'What they sound like, to choose the voice their lines are recorded in.', 'properties' => [
                            'gender' => ['type' => 'string', 'enum' => ['female', 'male', 'neutral'], 'description' => 'neutral for a robot, a computer or a creature that is neither.'],
                            'age' => ['type' => 'string', 'enum' => ['child', 'young', 'adult', 'elder']],
                            'accent' => ['type' => 'string', 'enum' => ['American', 'British'], 'description' => 'Only when it matters to the character.'],
                            'sound' => $text('A few words on how the voice sounds: warm, deep, squeaky, robotic, calm, excited.', 80),
                        ]],
                        'guide' => ['type' => 'boolean', 'description' => 'True for the one character who briefs the students and receives the final report.'],
                        'scene' => $key,
                        'x' => ['type' => 'number', 'minimum' => 0.12, 'maximum' => 0.88, 'description' => 'Where they stand, as a fraction of the scene width.'],
                        'gestures' => ['type' => 'array', 'maxItems' => 2, 'items' => ['type' => 'string', 'enum' => self::GESTURES], 'description' => 'Drawn animations besides idle and walk (every character gets those).'],
                        'wanders' => ['type' => 'boolean', 'description' => 'True for a character who paces back and forth near their spot while waiting (a busy inventor, a restless guard). Never the guide.'],
                        'chatter' => ['type' => 'array', 'maxItems' => 2, 'items' => $text('Something they mutter to themselves now and then, in a speech bubble: a hint or a joke. At most 80 characters.', 80)],
                    ],
                ]],
                'items' => ['type' => 'array', 'maxItems' => $limits['max_items'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'kind', 'appearance', 'size_cm'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'kind' => ['type' => 'string', 'enum' => self::ITEM_KINDS, 'description' => 'collectible/tool/evidence: shown on an interaction students click. prop: scenery that stands in a scene (blocks walking). vehicle: something students can ride.'],
                        'appearance' => $text('Only what it looks like, as a single object: shape, material, colours, details. No text.', 400),
                        'size_cm' => ['type' => 'integer', 'minimum' => 2, 'maximum' => 1200, 'description' => 'Its real longest side in centimetres: a pollen vial 12, a book 25, a toolbox 50, a crate 70, a barrel 100, a console 140, a door 210, a tree 600. A child explorer is 130. It is drawn to that scale.'],
                        'size' => ['type' => 'string', 'enum' => ['small', 'medium', 'large'], 'description' => 'Older field, used only without size_cm.'],
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
                        'placement' => ['type' => 'string', 'enum' => Sizes::PLACEMENTS, 'description' => 'Where its item is: ground (lying or standing on the floor students walk on: a rock sample, a footprint, a dropped tool), back (standing against the back where the floor meets the scenery: machines, consoles, big plants), surface (small things, on a table, bench or flat rock that is added for you), wall (mounted on the back wall: a map, a switch, a gauge; only in indoor and underground scenes). Default: by its size.'],
                        'hidden' => ['type' => 'boolean', 'description' => 'True for a discovery that only appears when a student walks close to it: a clue in the shadows, a fossil in the dirt. Use one or two per mission for students who explore.'],
                        'role' => ['type' => 'string', 'description' => 'Optional: the key of the crew role whose job this is. Only students in that role can do it; it counts for the whole crew. Not for talk or question.'],
                        'share' => $text('Optional: a short finding written into the crew log for everyone when this is done ("Soil pH: 4, very acidic"). Use it with role tasks, so the crew must pool what each role found.', 120),
                        'resolves' => ['type' => 'string', 'description' => 'Optional: the key of a twist this sets right (it clears the way the twist blocked).'],
                        'character' => ['type' => 'string', 'description' => 'talk: the character key.'],
                        'item' => ['type' => 'string', 'description' => 'collect/inspect/experiment/team_task: the item key drawn there (optional for inspect/experiment/team_task).'],
                        'requires' => ['type' => 'array', 'maxItems' => 3, 'items' => $key, 'description' => 'Keys of interactions or steps that must be done first.'],
                        'locked_hint' => $text('Optional: shown when clicked before it is available. Only used when requires has one key.', 160),
                        'after' => ['type' => 'string', 'description' => 'question only: the key of an interaction right after which this question pops up by itself (it can also be reopened by clicking it).'],
                        'at_report' => ['type' => 'boolean', 'description' => 'question only: asked by the guide in the final debrief, when the crew reports back, instead of standing in a scene. Its scene is the guide\'s; no x. Never listed in steps.'],
                        'dialogue' => ['type' => 'array', 'maxItems' => 8, 'items' => $line, 'description' => 'talk: the conversation, in order. Other types: optional lines a character says first.'],
                        'info' => ['type' => 'object', 'required' => ['title', 'body'], 'properties' => [
                            'title' => $text('Heading.', 60),
                            'body' => $text('What the student observes or learns: concrete, accurate, at the grade level. Up to 3 short paragraphs separated by blank lines.', 900),
                        ]],
                        'question' => ['type' => 'object', 'required' => ['prompt', 'choices', 'objective'], 'properties' => [
                            'prompt' => $text('The question.', 300),
                            'choices' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 4, 'items' => ['type' => 'object', 'required' => ['text', 'correct', 'feedback'], 'properties' => [
                                'text' => $text('The answer as a button label.', 80),
                                'correct' => ['type' => 'boolean', 'description' => 'For a predict question: false for all.'],
                                'feedback' => $text('Explanation shown after choosing it; for a wrong answer, explain the misconception without giving the answer away.', 400),
                            ]]],
                            'purpose' => ['type' => 'string', 'enum' => ['check', 'predict'], 'description' => 'check (default): has one right answer and is scored. predict: asks students to commit to a prediction before they find out (every answer is accepted and recorded, nothing is right or wrong yet); follow it with the experiment or inspection that shows the answer.'],
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
                        'team' => ['type' => 'object', 'required' => ['success'], 'properties' => [
                            'needed' => ['type' => 'integer', 'minimum' => 2, 'maximum' => 6, 'description' => 'How many different students must each do the same part. Not with roles.'],
                            'part' => $text('What one student does: "turns a valve".', 160),
                            'roles' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 4, 'description' => 'Instead of needed and part: each listed crew role does its own different part, and it is done when every one has.', 'items' => ['type' => 'object', 'required' => ['role', 'part'], 'properties' => [
                                'role' => $key,
                                'part' => $text('What that role does: "reads the pressure gauge".', 120),
                            ]]],
                            'success' => $text('Shown to everyone in the scene when the team is done.', 200),
                        ]],
                        'award' => $award,
                    ],
                ]],
                'roles' => ['type' => 'array', 'maxItems' => 4, 'description' => 'Optional crew roles (2 to 4): each student picks one at the start and has jobs only that role can do, so the crew must split up and pool what they find. No more roles than the fewest students who play.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'description'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('"Botanist", "Engineer", "Navigator".', 30),
                        'description' => $text('What this role does in the mission, to a student: "You study the plants and test the soil."', 200),
                    ],
                ]],
                'twists' => ['type' => 'array', 'maxItems' => 2, 'description' => 'One or two surprises that change the situation part-way (a storm rolls in, a bridge gives way, a sample turns out to be something else, an animal steals a tool). Each should teach something: what students learn about the topic by dealing with it.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'after', 'title', 'dialogue'],
                    'properties' => [
                        'key' => $key,
                        'after' => ['type' => 'string', 'description' => 'The interaction or step key right after which it happens.'],
                        'title' => $text('Flashed big across the screen, at most 5 words: "RUMBLE! The ground shakes!"', 50),
                        'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 4, 'items' => $line, 'description' => 'Characters react and say what it means (they can speak from anywhere, over the radio).'],
                        'notice' => $text('One line for crew members who were elsewhere when it happened: "A rockslide has blocked the canyon path!"', 160),
                        'blocks' => ['type' => 'object', 'required' => ['to'], 'description' => 'Optional: it closes the way from the scene where it happens to another scene until it is set right.', 'properties' => [
                            'to' => $key,
                            'message' => $text('Shown when students try that way while it is closed.', 160),
                        ]],
                        'obstacle' => ['type' => 'object', 'required' => ['item', 'x'], 'description' => 'Optional: a prop that appears in the scene where it happens (fallen rocks, a toppled tree) and goes once it is set right.', 'properties' => [
                            'item' => $key,
                            'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85],
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
                        'after' => ['type' => 'string', 'description' => 'Optional: a step key (or a twist key); this step is only listed once that one is done (or has happened).'],
                        'optional' => ['type' => 'boolean'],
                    ],
                ]],
                'intro' => ['type' => 'object', 'required' => ['dialogue'], 'properties' => [
                    'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $line, 'description' => 'The guide briefs the students when they first arrive in the start scene.'],
                ]],
                'completion' => ['type' => 'object', 'required' => ['label', 'dialogue', 'award'], 'properties' => [
                    'label' => $text('Shown over the guide once every required step is done: "Report to Captain Vega".', 40),
                    'debrief' => $text('What the guide says before asking the debrief questions (the at_report questions): "Before we fly home, tell me what you worked out."', 200),
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
