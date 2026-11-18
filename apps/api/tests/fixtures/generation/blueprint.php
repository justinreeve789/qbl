<?php

/**
 * A mission blueprint as the language model writes one, for tests/generation.php: every kind of
 * interaction, a locked exit, a question that follows a collect, a team task, steps with counts.
 */
return [
    'title' => 'The Quiet Hive',
    'subtitle' => 'Find out why the pollinators left the orchard, and bring them back',
    'description' => 'Students investigate an alien orchard whose fruit has stopped growing. They observe flowers, collect pollen samples, test how far pollinators travel, and work together to restart the hive.',
    'story' => [
        'premise' => 'The orchard colony on Planet Meri has flowers but no fruit this season.',
        'player_role' => 'A crew of space explorers from the starship.',
        'resolution' => 'The crew finds the pollinators were driven off by a broken sprinkler, fixes it, and fruit begins to grow.',
    ],
    'art_direction' => ['setting' => 'A terraced alien orchard with round blue-leaved trees and glass greenhouses', 'accent_colors' => ['#FFB703', '#8ECAE6'], 'time_of_day' => 'morning'],
    'start_scene' => 'landing',
    'scenes' => [
        ['key' => 'landing', 'title' => 'Orchard Landing', 'description' => 'Where the crew meets the orchard keeper.', 'background' => 'a grassy landing area at the foot of terraced orchard hills, a small shuttle pad on the left', 'ground_line' => 0.68, 'indoor' => false,
            'exits' => [['edge' => 'right', 'to' => 'orchard']], 'props' => [['item' => 'crate', 'x' => 0.75]]],
        ['key' => 'orchard', 'title' => 'Blue Orchard', 'description' => 'Flowering trees without fruit.', 'background' => 'rows of round blue-leaved trees covered in yellow flowers, no fruit', 'ground_line' => 0.7,
            'exits' => [['edge' => 'top', 'to' => 'hive', 'requires' => 'talk_keeper', 'locked_message' => 'The keeper asked you to talk to her before you go up to the hive.']]],
        ['key' => 'hive', 'title' => 'Hive Terrace', 'description' => 'The empty hive and a broken sprinkler.', 'background' => 'a stone terrace with a large round hive box and a tangle of sprinkler pipes', 'ground_line' => 0.72, 'exits' => []],
    ],
    'characters' => [
        ['key' => 'keeper', 'name' => 'Keeper Ama', 'role' => 'Runs the orchard', 'appearance' => 'a tall friendly woman with dark curly hair tied up, wearing green overalls with big pockets, a straw sun hat and yellow boots, skin tone skin 4', 'personality' => 'warm and practical', 'guide' => true, 'scene' => 'landing', 'x' => 0.35, 'gestures' => ['wave', 'cheer']],
        ['key' => 'bot', 'name' => 'Pip', 'role' => 'A small gardening robot', 'appearance' => 'a small round teal robot on one wheel with two thin arms and a single big eye', 'personality' => 'chirpy', 'scene' => 'hive', 'x' => 0.7, 'gestures' => ['point']],
    ],
    'items' => [
        ['key' => 'pollen', 'name' => 'Pollen sample', 'kind' => 'collectible', 'appearance' => 'a small glass vial holding yellow pollen dust with a cork stopper', 'size' => 'small'],
        ['key' => 'flower', 'name' => 'Orchard flower', 'kind' => 'evidence', 'appearance' => 'a large five-petalled yellow flower with an orange centre', 'size' => 'small'],
        ['key' => 'crate', 'name' => 'Supply crate', 'kind' => 'prop', 'appearance' => 'a sturdy wooden crate with metal corners', 'size' => 'medium'],
        ['key' => 'valve', 'name' => 'Sprinkler valve', 'kind' => 'tool', 'appearance' => 'a large round red valve wheel on a pipe', 'size' => 'medium'],
        ['key' => 'scope', 'name' => 'Flight tracker', 'kind' => 'tool', 'appearance' => 'a hand-held scanner with a round screen', 'size' => 'small'],
    ],
    'interactions' => [
        ['key' => 'talk_keeper', 'type' => 'talk', 'scene' => 'landing', 'label' => 'Talk to Keeper Ama', 'character' => 'keeper', 'dialogue' => [
            ['speaker' => 'keeper', 'text' => 'Welcome, {{QBLPlayerName}}! Our trees are full of flowers, but no fruit is growing.'],
            ['speaker' => 'keeper', 'text' => 'Look at the flowers in the orchard and collect pollen. Then come up to the hive.'],
            ['speaker' => 'player', 'text' => 'We are on it!'],
        ], 'award' => ['stars' => 1, 'xp' => 5, 'note' => 'Mission accepted']],
        ['key' => 'look_flower', 'type' => 'inspect', 'scene' => 'orchard', 'label' => 'Look at a flower', 'x' => 0.25, 'item' => 'flower', 'info' => ['title' => 'A flower up close', 'body' => "The flower is open and full of yellow pollen.\n\nBut the pollen is still in the flower: nothing has carried it to another flower."]],
        ['key' => 'pollen_a', 'type' => 'collect', 'scene' => 'orchard', 'label' => 'Collect pollen', 'x' => 0.5, 'item' => 'pollen', 'requires' => ['talk_keeper'], 'locked_hint' => 'Talk to Keeper Ama first.', 'info' => ['title' => 'Pollen from the west row', 'body' => 'Lots of pollen, all still on the flowers.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Sample collected']],
        ['key' => 'pollen_b', 'type' => 'collect', 'scene' => 'orchard', 'label' => 'Collect pollen', 'x' => 0.7, 'item' => 'pollen', 'requires' => ['talk_keeper'], 'info' => ['title' => 'Pollen from the east row', 'body' => 'The same here: the pollen has not moved.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Sample collected']],
        ['key' => 'q_pollen', 'type' => 'question', 'scene' => 'orchard', 'label' => 'Think about it', 'x' => 0.85, 'after' => 'pollen_b', 'question' => [
            'prompt' => 'The pollen is still on the flowers. What does a flower need for fruit to grow?',
            'choices' => [
                ['text' => 'More sunlight', 'correct' => false, 'feedback' => 'The trees get plenty of light, and they made flowers. Something else is missing.'],
                ['text' => 'Pollen carried to another flower', 'correct' => true, 'feedback' => 'Yes! Pollination moves pollen between flowers, and then fruit can grow.'],
                ['text' => 'Bigger petals', 'correct' => false, 'feedback' => 'Petal size does not make fruit. Think about where the pollen is.'],
            ],
            'objective' => 'LO1', 'standards' => ['TEST-3-LS1-1'],
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Good thinking']],
        ['key' => 'talk_pip', 'type' => 'talk', 'scene' => 'hive', 'label' => 'Talk to Pip', 'character' => 'bot', 'dialogue' => [
            ['speaker' => 'bot', 'text' => 'Beep! The sprinkler sprays the hive every hour. The pollinators do not like getting wet!'],
        ]],
        ['key' => 'track', 'type' => 'experiment', 'scene' => 'hive', 'label' => 'Adjust the sprinkler timer', 'x' => 0.3, 'item' => 'scope', 'requires' => ['talk_pip'], 'experiment' => [
            'quantity' => 'Sprays per day', 'unit' => '', 'start' => 24, 'min' => 0, 'max' => 24, 'target' => 2,
            'increase' => 'Spray more often', 'decrease' => 'Spray less often', 'success' => 'Two sprays a day keep the trees watered and the hive dry.', 'objective' => 'LO2',
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Timer fixed']],
        ['key' => 'valves', 'type' => 'team_task', 'scene' => 'hive', 'label' => 'Turn a valve', 'x' => 0.5, 'item' => 'valve', 'requires' => ['track'], 'team' => ['needed' => 3, 'part' => 'turns a valve', 'success' => 'The pipes are fixed! The hive is dry again.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Teamwork']],
    ],
    'steps' => [
        ['key' => 'meet', 'text' => 'Talk to Keeper Ama', 'done_when' => ['talk_keeper']],
        ['key' => 'samples', 'text' => 'Collect pollen in the orchard', 'done_when' => ['pollen_a', 'pollen_b'], 'after' => 'meet'],
        ['key' => 'why', 'text' => 'Work out what the flowers need', 'done_when' => ['q_pollen'], 'after' => 'samples'],
        ['key' => 'fix', 'text' => 'Fix the sprinkler with your crew', 'done_when' => ['track', 'valves'], 'after' => 'why'],
        ['key' => 'flowers', 'text' => 'Look closely at a flower', 'done_when' => ['look_flower'], 'optional' => true],
    ],
    'intro' => ['dialogue' => [['speaker' => 'keeper', 'text' => 'Over here, crew! Come and talk to me.']]],
    'completion' => ['label' => 'Report to Keeper Ama', 'dialogue' => [['speaker' => 'keeper', 'text' => 'The pollinators are back! Look, the first fruit is growing.']], 'award' => ['stars' => 8, 'xp' => 40, 'note' => 'Mission complete']],
    'badge' => ['name' => 'Quiet Hive patch', 'appearance' => 'a round patch with a smiling pollinator over a blue tree'],
];
