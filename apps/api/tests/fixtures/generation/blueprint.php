<?php

/**
 * A mission blueprint as the language model writes one, for tests/generation.php: every kind of
 * interaction, a locked exit, a question that follows a collect, a prediction, a debrief question, a
 * team task by count and one by roles, crew roles with a crew log, a door into a building and a hole
 * into a burrow, a twist that blocks a way with an obstacle until it is set right, a hidden discovery,
 * a wandering character, items of real sizes in different places, steps with counts.
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
        ['key' => 'landing', 'title' => 'Orchard Landing', 'description' => 'Where the crew meets the orchard keeper.', 'background' => 'a grassy landing area at the foot of terraced orchard hills, a small shuttle pad on the left, a glass greenhouse on the right', 'ground_line' => 0.68, 'indoor' => false,
            'exits' => [
                ['edge' => 'right', 'to' => 'orchard'],
                ['via' => 'door', 'x' => 0.62, 'to' => 'greenhouse', 'look' => 'a round glass door with a brass frame in the side of the greenhouse', 'label' => 'Enter the greenhouse'],
            ],
            'props' => [['item' => 'crate', 'x' => 0.8]]],
        ['key' => 'orchard', 'title' => 'Blue Orchard', 'description' => 'Flowering trees without fruit.', 'background' => 'rows of round blue-leaved trees covered in yellow flowers, no fruit', 'ground_line' => 0.7, 'kind' => 'outdoor',
            'exits' => [
                ['edge' => 'top', 'to' => 'hive', 'requires' => 'talk_keeper', 'locked_message' => 'The keeper asked you to talk to her before you go up to the hive.'],
                ['via' => 'hole', 'x' => 0.2, 'to' => 'burrow', 'look' => 'a dark round hole between the roots of a tree', 'label' => 'Jump into the hole!'],
            ]],
        ['key' => 'hive', 'title' => 'Hive Terrace', 'description' => 'The empty hive and a broken sprinkler.', 'background' => 'a stone terrace high on the hillside with a large round hive box and a tangle of sprinkler pipes', 'ground_line' => 0.72, 'kind' => 'up_high', 'exits' => []],
        ['key' => 'greenhouse', 'title' => 'The Greenhouse', 'description' => 'Warm, wet and full of seedlings.', 'background' => 'inside a glass greenhouse: shelves of seedlings along the back wall, misty glass panes, hanging vines', 'ground_line' => 0.7, 'kind' => 'indoor', 'exits' => []],
        ['key' => 'burrow', 'title' => 'Root Burrow', 'description' => 'Under the orchard, where the pipes run.', 'background' => 'an earthy burrow under the orchard with thick roots hanging from the ceiling and glowing mushrooms', 'ground_line' => 0.66, 'kind' => 'underground', 'exits' => []],
    ],
    'characters' => [
        ['key' => 'keeper', 'name' => 'Keeper Ama', 'role' => 'Runs the orchard', 'appearance' => 'a tall friendly woman with dark curly hair tied up, wearing green overalls with big pockets, a straw sun hat and yellow boots, skin tone skin 4', 'personality' => 'warm and practical', 'voice' => ['gender' => 'female', 'age' => 'adult', 'sound' => 'warm, calm'], 'guide' => true, 'scene' => 'landing', 'x' => 0.35, 'gestures' => ['wave', 'cheer'], 'wanders' => true],
        ['key' => 'bot', 'name' => 'Pip', 'role' => 'A small gardening robot', 'appearance' => 'a small round teal robot on one wheel with two thin arms and a single big eye', 'personality' => 'chirpy', 'scene' => 'hive', 'x' => 0.7, 'gestures' => ['point'], 'wanders' => true, 'chatter' => ['Beep! Too wet, too wet!', '']],
    ],
    'items' => [
        ['key' => 'pollen', 'name' => 'Pollen sample', 'kind' => 'collectible', 'appearance' => 'a small glass vial holding yellow pollen dust with a cork stopper', 'size_cm' => 12],
        ['key' => 'flower', 'name' => 'Orchard flower', 'kind' => 'evidence', 'appearance' => 'a large five-petalled yellow flower with an orange centre', 'size_cm' => 18],
        ['key' => 'crate', 'name' => 'Supply crate', 'kind' => 'prop', 'appearance' => 'a sturdy wooden crate with metal corners', 'size' => 'medium'],
        ['key' => 'valve', 'name' => 'Sprinkler valve', 'kind' => 'tool', 'appearance' => 'a large round red valve wheel on a pipe', 'size_cm' => 60],
        ['key' => 'scope', 'name' => 'Flight tracker', 'kind' => 'tool', 'appearance' => 'a hand-held scanner with a round screen', 'size_cm' => 20],
        ['key' => 'gauge', 'name' => 'Humidity gauge', 'kind' => 'tool', 'appearance' => 'a round brass dial gauge on a wooden backing board', 'size_cm' => 40],
        ['key' => 'pipe', 'name' => 'Leaking pipe', 'kind' => 'evidence', 'appearance' => 'a section of copper pipe with a crack and drops of water', 'size_cm' => 110],
        ['key' => 'mud', 'name' => 'Mudslide', 'kind' => 'prop', 'appearance' => 'a heap of wet mud and stones washed down a slope', 'size_cm' => 170],
        ['key' => 'feather', 'name' => 'Pollinator feather', 'kind' => 'evidence', 'appearance' => 'a tiny shimmering blue feather', 'size_cm' => 6],
    ],
    'roles' => [
        ['key' => 'botanist', 'name' => 'Botanist', 'description' => 'You study the plants and the air they grow in.'],
        ['key' => 'engineer', 'name' => 'Engineer', 'description' => 'You look after the orchard\'s pipes and machines.'],
    ],
    'interactions' => [
        ['key' => 'talk_keeper', 'type' => 'talk', 'scene' => 'landing', 'label' => 'Talk to Keeper Ama', 'character' => 'keeper', 'dialogue' => [
            ['speaker' => 'keeper', 'text' => 'Welcome, {{QBLPlayerName}}! Our trees are full of flowers, but no fruit is growing.'],
            ['speaker' => 'keeper', 'text' => 'Look at the flowers in the orchard and collect pollen. Then come up to the hive.'],
            ['speaker' => 'player', 'text' => 'We are on it!'],
        ], 'award' => ['stars' => 1, 'xp' => 5, 'note' => 'Mission accepted']],
        ['key' => 'look_flower', 'type' => 'inspect', 'scene' => 'orchard', 'label' => 'Look at a flower', 'x' => 0.35, 'item' => 'flower', 'info' => ['title' => 'A flower up close', 'body' => "The flower is open and full of yellow pollen.\n\nBut the pollen is still in the flower: nothing has carried it to another flower."]],
        ['key' => 'pollen_a', 'type' => 'collect', 'scene' => 'orchard', 'label' => 'Collect pollen', 'x' => 0.5, 'item' => 'pollen', 'requires' => ['talk_keeper'], 'locked_hint' => 'Talk to Keeper Ama first.', 'info' => ['title' => 'Pollen from the west row', 'body' => 'Lots of pollen, all still on the flowers.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Sample collected']],
        ['key' => 'pollen_b', 'type' => 'collect', 'scene' => 'orchard', 'label' => 'Collect pollen', 'x' => 0.7, 'item' => 'pollen', 'placement' => 'ground', 'requires' => ['talk_keeper'], 'info' => ['title' => 'Pollen from the east row', 'body' => 'The same here: the pollen has not moved.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Sample collected']],
        ['key' => 'q_pollen', 'type' => 'question', 'scene' => 'orchard', 'label' => 'Think about it', 'x' => 0.85, 'after' => 'pollen_b', 'question' => [
            'prompt' => 'The pollen is still on the flowers. What does a flower need for fruit to grow?',
            'choices' => [
                ['text' => 'More sunlight', 'correct' => false, 'feedback' => 'The trees get plenty of light, and they made flowers. Something else is missing.'],
                ['text' => 'Pollen carried to another flower', 'correct' => true, 'feedback' => 'Yes! Pollination moves pollen between flowers, and then fruit can grow.'],
                ['text' => 'Bigger petals', 'correct' => false, 'feedback' => 'Petal size does not make fruit. Think about where the pollen is.'],
            ],
            'objective' => 'LO1', 'standards' => ['TEST-3-LS1-1'],
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Good thinking']],
        ['key' => 'drain', 'type' => 'inspect', 'scene' => 'orchard', 'label' => 'Dig a channel', 'x' => 0.6, 'placement' => 'ground', 'resolves' => 'burst', 'info' => ['title' => 'Water runs downhill', 'body' => 'You dig a channel down the slope. The water runs away downhill and the path to the hive dries out.']],
        ['key' => 'talk_pip', 'type' => 'talk', 'scene' => 'hive', 'label' => 'Talk to Pip', 'character' => 'bot', 'dialogue' => [
            ['speaker' => 'bot', 'text' => 'Beep! The sprinkler sprays the hive every hour. The pollinators do not like getting wet!'],
        ]],
        ['key' => 'q_predict', 'type' => 'question', 'scene' => 'hive', 'label' => 'Make a prediction', 'x' => 0.15, 'after' => 'talk_pip', 'question' => [
            'purpose' => 'predict',
            'prompt' => 'If the sprinkler sprays less often, what will the pollinators do?',
            'choices' => [
                ['text' => 'Come back to the hive', 'correct' => true, 'feedback' => 'Let\'s test it and see.'],
                ['text' => 'Stay away', 'correct' => false, 'feedback' => 'Let\'s test it and see.'],
            ],
            'objective' => 'LO2',
        ]],
        ['key' => 'track', 'type' => 'experiment', 'scene' => 'hive', 'label' => 'Adjust the sprinkler timer', 'x' => 0.3, 'item' => 'scope', 'requires' => ['talk_pip'], 'experiment' => [
            'quantity' => 'Sprays per day', 'unit' => '', 'start' => 24, 'min' => 0, 'max' => 24, 'target' => 2,
            'increase' => 'Spray more often', 'decrease' => 'Spray less often', 'success' => 'Two sprays a day keep the trees watered and the hive dry.', 'objective' => 'LO2',
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Timer fixed']],
        ['key' => 'valves', 'type' => 'team_task', 'scene' => 'hive', 'label' => 'Turn a valve', 'x' => 0.5, 'item' => 'valve', 'placement' => 'back', 'requires' => ['track'], 'team' => ['needed' => 3, 'part' => 'turns a valve', 'success' => 'The pipes are fixed! The hive is dry again.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Teamwork']],
        ['key' => 'read_humidity', 'type' => 'inspect', 'scene' => 'greenhouse', 'label' => 'Read the humidity gauge', 'x' => 0.4, 'item' => 'gauge', 'placement' => 'wall', 'role' => 'botanist', 'share' => 'Humidity: 95%. The air is soaking wet.', 'info' => ['title' => 'Very wet air', 'body' => 'The gauge reads 95%. Pollinators cannot fly well in air this wet.']],
        ['key' => 'check_pipes', 'type' => 'inspect', 'scene' => 'burrow', 'label' => 'Check the pipes', 'x' => 0.6, 'item' => 'pipe', 'role' => 'engineer', 'share' => 'The sprinkler pipe under the orchard is cracked and leaking.', 'info' => ['title' => 'A cracked pipe', 'body' => 'Water is dripping from a crack. The sprinkler has been running all the time.']],
        ['key' => 'reroute', 'type' => 'team_task', 'scene' => 'greenhouse', 'label' => 'Reroute the water', 'x' => 0.75, 'team' => ['roles' => [['role' => 'botanist', 'part' => 'opens the vents'], ['role' => 'engineer', 'part' => 'switches the pump']], 'success' => 'The greenhouse dries out and the water goes where it is needed.']],
        ['key' => 'find_feather', 'type' => 'inspect', 'scene' => 'burrow', 'label' => 'Something shiny', 'x' => 0.3, 'item' => 'feather', 'hidden' => true, 'info' => ['title' => 'A pollinator feather', 'body' => 'The pollinators sheltered down here from the spray.']],
        ['key' => 'q_report', 'type' => 'question', 'scene' => 'landing', 'label' => 'What did you find?', 'at_report' => true, 'x' => 0.5, 'question' => [
            'prompt' => 'Why did the pollinators leave the orchard?',
            'choices' => [
                ['text' => 'A leaking pipe kept spraying, so the air was too wet to fly', 'correct' => true, 'feedback' => 'Exactly: the engineer\'s cracked pipe and the botanist\'s wet air together explain it.'],
                ['text' => 'The flowers had no pollen', 'correct' => false, 'feedback' => 'Your samples showed plenty of pollen. Check the crew log.'],
                ['text' => 'It was too cold', 'correct' => false, 'feedback' => 'Nobody measured cold. Look at what the botanist and engineer found.'],
            ],
            'objective' => 'LO2',
        ], 'award' => ['stars' => 2, 'xp' => 10, 'note' => 'Explained it']],
    ],
    'twists' => [
        ['key' => 'burst', 'after' => 'pollen_b', 'title' => 'WHOOSH! A pipe bursts!', 'notice' => 'A burst pipe has washed mud over the path to the hive!', 'dialogue' => [
            ['speaker' => 'keeper', 'text' => 'Crew! A sprinkler pipe just burst. Mud is sliding over the path to the hive!'],
            ['speaker' => 'keeper', 'text' => 'Water always runs downhill. Can you give it somewhere to go?'],
        ], 'blocks' => ['to' => 'hive', 'message' => 'Mud blocks the path. Dig a channel to drain it first.'], 'obstacle' => ['item' => 'mud', 'x' => 0.5], 'award' => ['stars' => 0, 'xp' => 0, 'note' => '']],
    ],
    'steps' => [
        ['key' => 'meet', 'text' => 'Talk to Keeper Ama', 'done_when' => ['talk_keeper']],
        ['key' => 'samples', 'text' => 'Collect pollen in the orchard', 'done_when' => ['pollen_a', 'pollen_b'], 'after' => 'meet'],
        ['key' => 'why', 'text' => 'Work out what the flowers need', 'done_when' => ['q_pollen'], 'after' => 'samples'],
        ['key' => 'clear', 'text' => 'Clear the mudslide', 'done_when' => ['drain'], 'after' => 'burst'],
        ['key' => 'crew', 'text' => 'Each role: investigate', 'done_when' => ['read_humidity', 'check_pipes', 'reroute']],
        ['key' => 'fix', 'text' => 'Fix the sprinkler with your crew', 'done_when' => ['track', 'valves'], 'after' => 'why'],
        ['key' => 'flowers', 'text' => 'Look closely at a flower', 'done_when' => ['look_flower'], 'optional' => true],
        ['key' => 'secret', 'text' => 'Find out where the pollinators hid', 'done_when' => ['find_feather'], 'optional' => true],
    ],
    'intro' => ['dialogue' => [['speaker' => 'keeper', 'text' => 'Over here, crew! Come and talk to me.']]],
    'completion' => ['label' => 'Report to Keeper Ama', 'debrief' => 'You are back! Before we celebrate, tell me what you worked out.', 'dialogue' => [['speaker' => 'keeper', 'text' => 'The pollinators are back! Look, the first fruit is growing.']], 'award' => ['stars' => 8, 'xp' => 40, 'note' => 'Mission complete']],
    'badge' => ['name' => 'Quiet Hive patch', 'appearance' => 'a round patch with a smiling pollinator over a blue tree'],
];
