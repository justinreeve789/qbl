<?php

/**
 * A mission blueprint as the language model writes one, for tests/generation.php: every kind of
 * interaction, a locked exit, a question that follows a collect, a prediction, a debrief question, a
 * team task, a door into a building and a hole into a burrow, a twist that blocks a way with an obstacle
 * until it is set right, a hidden discovery, things of real sizes in different places, steps with counts,
 * and the point-and-click side: things collected into the bag, two put together, one used on a crack in
 * the floor (and kept), one given to a robot, cutscenes after them, a twist and the finale, characters of
 * real heights who stroll about, extra characters for colour (one leaves at the end), creatures that land
 * and fly by, a wide scene with a far view behind it, foregrounds, a floor with a pond in it, and a fun
 * thing to look at that is painted into the background. Also: a robot who falls off the terrace when
 * students first arrive and is lifted back up with a pulley they make from a vine and a branch found
 * right there, a sprinkler-timer instrument with a slider and a switch, things in scenes that are only to
 * look at (details), observations with flip cards, a callout and a card that opens, and every thing in
 * the bag used, living skies (one setting slowly from golden hour to dusk), lights (a landing beacon, a
 * lantern, glowing mushrooms) and things in the air. Some fields are left half-filled on purpose, for
 * MissionDesigner::tidy().
 */
return [
    'title' => 'The Quiet Hive',
    'subtitle' => 'Find out why the pollinators left the orchard, and bring them back',
    'description' => 'Students investigate an alien orchard whose fruit has stopped growing. They observe flowers, collect pollen samples, test how far pollinators travel, and work together to restart the hive.',
    'story' => [
        'premise' => 'The orchard colony on Planet Meri has flowers but no fruit this season.',
        'player_role' => 'Space explorers from the starship.',
        'resolution' => 'The students find the pollinators were driven off by a broken sprinkler, fix it, and fruit begins to grow.',
    ],
    'art_direction' => ['setting' => 'A terraced alien orchard with round blue-leaved trees and glass greenhouses', 'accent_colors' => ['#FFB703', '#8ECAE6'], 'time_of_day' => 'morning'],
    'start_scene' => 'landing',
    'scenes' => [
        ['key' => 'landing', 'title' => 'Orchard Landing', 'description' => 'Where the students meet the orchard keeper.', 'background' => 'a grassy landing area at the foot of terraced orchard hills, a small shuttle pad on the left, a glass greenhouse on the right', 'ground_line' => 0.68, 'indoor' => false,
            'sky' => ['time' => 'morning', 'clouds' => 'few'],
            'lights' => [['x' => 0.12, 'kind' => 'beacon', 'look' => 'a small red landing beacon on a short pole', 'placement' => 'ground'], ['x' => 0.5, 'kind' => 'disco', 'look' => 'dropped: no such kind']],
            'exits' => [
                ['edge' => 'right', 'to' => 'orchard'],
                ['via' => 'door', 'x' => 0.62, 'to' => 'greenhouse', 'look' => 'a round glass door with a brass frame in the side of the greenhouse', 'label' => 'Enter the greenhouse'],
            ],
            'props' => [['item' => 'crate', 'x' => 0.8]],
            'floor' => ['left' => 0.06],
            'foreground' => ['look' => 'a big curly blue fern', 'where' => 'left'],
            'ambient' => [['key' => 'finch', 'look' => 'a small round blue bird with an orange beak', 'motion' => 'lands', 'size_cm' => 15]],
            'details' => [['x' => 0.55, 'label' => 'Old boot', 'look' => 'a muddy old boot with a daisy growing out of it', 'text' => 'Someone lost a boot. A daisy has moved in!', 'placement' => 'ground']]],
        ['key' => 'orchard', 'title' => 'Blue Orchard', 'description' => 'Flowering trees without fruit.', 'background' => 'rows of round blue-leaved trees covered in yellow flowers, no fruit', 'ground_line' => 0.7, 'kind' => 'outdoor', 'width' => 'wide',
            'sky' => ['time' => 'afternoon', 'until' => 'afternoon', 'clouds' => 'many'], 'atmosphere' => [['kind' => 'leaves', 'amount' => 'few'], ['kind' => 'leaves'], ['kind' => 'lava']],
            'distance' => 'rolling blue hills under a pale morning sky with two small moons',
            'floor' => ['blocked' => [['x' => 0.4, 'width' => 0.06, 'what' => 'a small round pond with lily pads']]],
            'ambient' => [['key' => 'moths', 'look' => 'a fluffy yellow moth with blue spots', 'motion' => 'flies_by', 'size_cm' => 8], ['key' => 'squirrel', 'look' => 'a red squirrel', 'motion' => 'climbs', 'size_cm' => 35, 'library' => 'red-squirrel']],
            'exits' => [
                ['edge' => 'top', 'to' => 'hive', 'requires' => 'talk_keeper', 'locked_message' => 'The keeper asked you to talk to her before you go up to the hive.'],
                ['via' => 'hole', 'x' => 0.2, 'to' => 'burrow', 'look' => 'a dark round hole between the roots of a tree', 'label' => 'Jump into the hole!'],
            ]],
        ['key' => 'hive', 'title' => 'Hive Terrace', 'description' => 'The empty hive and a broken sprinkler.', 'background' => 'a stone terrace high on the hillside with a large round hive box and a tangle of sprinkler pipes', 'ground_line' => 0.72, 'kind' => 'up_high', 'exits' => [],
            'sky' => ['time' => 'golden', 'until' => 'dusk', 'clouds' => 'few'], 'atmosphere' => [['kind' => 'fireflies', 'amount' => 'few']],
            'lights' => [['x' => 0.1, 'kind' => 'lantern', 'look' => 'an iron lantern hanging from a wooden post', 'color' => 'orange']],
            'foreground' => ['look' => 'a lavender bush with purple flowers', 'where' => 'right'],
            'arrival' => ['title' => 'Look out!', 'dialogue' => [['speaker' => 'player', 'text' => 'Pip rolled right off the edge of the terrace!']], 'cutscene' => [
                ['who' => 'bot', 'do' => 'say', 'text' => 'Beep! Visitors! Let me roll over and say hel-'],
                ['who' => 'bot', 'do' => 'fall', 'x' => 0.86, 'text' => 'Whoaaa! My wheel slipped! Heeelp!'],
            ]],
            'details' => [['x' => 0.62, 'label' => 'Scarecrow', 'look' => 'a scarecrow in a patched coat with a crow sitting on its hat', 'text' => 'The crow does not look scared at all.'], ['x' => 2, 'label' => '', 'look' => 'nothing', 'text' => 'dropped: no label']]],
        ['key' => 'greenhouse', 'title' => 'The Greenhouse', 'description' => 'Warm, wet and full of seedlings.', 'background' => 'inside a glass greenhouse: shelves of seedlings along the back wall, misty glass panes, hanging vines', 'ground_line' => 0.7, 'kind' => 'indoor', 'exits' => [], 'sky' => ['time' => 'night']],
        ['key' => 'burrow', 'title' => 'Root Burrow', 'description' => 'Under the orchard, where the pipes run.', 'background' => 'an earthy burrow under the orchard with thick roots hanging from the ceiling and glowing mushrooms', 'ground_line' => 0.66, 'kind' => 'underground', 'exits' => [],
            'lights' => [['x' => 0.3, 'kind' => 'crystal', 'look' => 'a cluster of glowing blue mushrooms', 'placement' => 'wall']], 'atmosphere' => [['kind' => 'dust']],
            'foreground' => ['look' => 'thick twisted tree roots', 'where' => 'bottom'],
            'ambient' => [['key' => 'beetle', 'look' => 'a shiny green beetle', 'motion' => 'walks_by', 'size_cm' => 6]]],
    ],
    'characters' => [
        ['key' => 'keeper', 'name' => 'Keeper Ama', 'role' => 'Runs the orchard', 'appearance' => 'a tall friendly woman with dark curly hair tied up, wearing green overalls with big pockets, a straw sun hat and yellow boots, skin tone skin 4', 'personality' => 'warm and practical', 'voice' => ['gender' => 'female', 'age' => 'adult', 'sound' => 'warm, calm'], 'guide' => true, 'scene' => 'landing', 'x' => 0.35, 'height_cm' => 175, 'gestures' => ['wave', 'cheer'], 'wanders' => true],
        ['key' => 'bot', 'name' => 'Pip', 'role' => 'A small gardening robot', 'appearance' => 'a small round teal robot on one wheel with two thin arms and a single big eye', 'personality' => 'chirpy', 'scene' => 'hive', 'x' => 0.7, 'height_cm' => 70, 'gestures' => ['point'], 'walks' => [0.55, 0.8], 'chatter' => ['Beep! Too wet, too wet!', '']],
        ['key' => 'gran', 'name' => 'Granny Odo', 'role' => 'A retired beekeeper who sits by the pond', 'appearance' => 'a small round grandmother with silver hair in a bun, a knitted purple cardigan and big round glasses, skin tone skin 2', 'personality' => 'chatty and funny', 'scene' => 'orchard', 'x' => 0.6, 'height_cm' => 150, 'walks' => [0.5, 0.7], 'chatter' => ['In my day the hives hummed like a choir.', 'Has anyone seen my knitting?']],
        ['key' => 'pilot', 'name' => 'Captain Zee', 'role' => 'The shuttle pilot, waiting to fly the students home', 'appearance' => 'a tall slim pilot in an orange flight suit with a white scarf and goggles on her forehead, skin tone skin 3', 'personality' => 'bored but kind', 'scene' => 'landing', 'x' => 0.15, 'height_cm' => 180, 'chatter' => ['Still waiting...', 'Nice day for flying.']],
    ],
    'items' => [
        ['key' => 'pollen', 'name' => 'Pollen sample', 'kind' => 'collectible', 'appearance' => 'a small glass vial holding yellow pollen dust with a cork stopper', 'size_cm' => 12, 'description' => 'Yellow pollen from the orchard flowers.'],
        ['key' => 'flower', 'name' => 'Orchard flower', 'kind' => 'evidence', 'appearance' => 'a large five-petalled yellow flower with an orange centre', 'size_cm' => 18],
        ['key' => 'crate', 'name' => 'Supply crate', 'kind' => 'prop', 'appearance' => 'a sturdy wooden crate with metal corners', 'size' => 'medium'],
        ['key' => 'valve', 'name' => 'Sprinkler valve', 'kind' => 'tool', 'appearance' => 'a large round red valve wheel on a pipe', 'size_cm' => 60],
        ['key' => 'scope', 'name' => 'Flight tracker', 'kind' => 'tool', 'appearance' => 'a hand-held scanner with a round screen', 'size_cm' => 20],
        ['key' => 'gauge', 'name' => 'Humidity gauge', 'kind' => 'tool', 'appearance' => 'a round brass dial gauge on a wooden backing board', 'size_cm' => 40],
        ['key' => 'pipe', 'name' => 'Leaking pipe', 'kind' => 'evidence', 'appearance' => 'a section of copper pipe with a crack and drops of water', 'size_cm' => 110],
        ['key' => 'mud', 'name' => 'Mudslide', 'kind' => 'prop', 'appearance' => 'a heap of wet mud and stones washed down a slope', 'size_cm' => 170],
        ['key' => 'feather', 'name' => 'Pollinator feather', 'kind' => 'evidence', 'appearance' => 'a tiny shimmering blue feather', 'size_cm' => 6],
        ['key' => 'twine', 'name' => 'Garden twine', 'kind' => 'tool', 'appearance' => 'a ball of green garden string', 'size_cm' => 10, 'description' => 'A long piece of strong green string.'],
        ['key' => 'hook', 'name' => 'Bent hook', 'kind' => 'tool', 'appearance' => 'a small bent metal hook', 'size_cm' => 8],
        ['key' => 'grabber', 'name' => 'Hook on a string', 'kind' => 'tool', 'appearance' => 'a small metal hook tied to a long green string', 'size_cm' => 40, 'description' => 'Good for fishing things out of tight spots.'],
        ['key' => 'vine', 'name' => 'Long vine', 'kind' => 'tool', 'appearance' => 'a long coil of green vine with a few leaves', 'size_cm' => 30, 'description' => 'Strong and bendy, like a rope.'],
        ['key' => 'branch', 'name' => 'Forked branch', 'kind' => 'tool', 'appearance' => 'a sturdy forked branch with smooth bark', 'size_cm' => 70],
        ['key' => 'pulley', 'name' => 'Branch pulley', 'kind' => 'tool', 'appearance' => 'a long green vine looped over the fork of a sturdy branch', 'size_cm' => 70, 'description' => 'Pull down on one end, and the other end goes up.'],
        ['key' => 'pip_hanging', 'name' => 'Pip, hanging on', 'kind' => 'prop', 'appearance' => 'a small round teal robot clinging with both thin arms to a root sticking out below a stone ledge', 'size_cm' => 90],
        ['key' => 'battery', 'name' => 'Robot battery', 'kind' => 'collectible', 'appearance' => 'a chunky teal battery with a glowing stripe', 'size_cm' => 14],
    ],
    'interactions' => [
        ['key' => 'talk_keeper', 'type' => 'talk', 'scene' => 'landing', 'label' => 'Talk to Keeper Ama', 'character' => 'keeper', 'dialogue' => [
            ['speaker' => 'keeper', 'text' => 'Welcome, {{QL_PlayerName}}! Our trees are full of flowers, but no fruit is growing.'],
            ['speaker' => 'keeper', 'text' => 'Look at the flowers in the orchard and collect pollen. Then come up to the hive.'],
            ['speaker' => 'player', 'text' => 'We are on it!'],
        ], 'award' => ['stars' => 1, 'xp' => 5, 'note' => 'Mission accepted']],
        ['key' => 'sundial', 'type' => 'inspect', 'scene' => 'landing', 'label' => 'An old sundial', 'x' => 0.25, 'look' => 'an old stone sundial with a snail asleep on top of it', 'info' => ['title' => 'A sleepy sundial', 'body' => 'The snail has been asleep on the sundial so long that it tells the time itself: snail o\'clock.']],
        ['key' => 'look_flower', 'type' => 'inspect', 'scene' => 'orchard', 'label' => 'Look at a flower', 'x' => 0.35, 'item' => 'flower', 'info' => ['title' => 'A flower up close', 'body' => "The flower is open and full of yellow pollen.\n\nBut the pollen is still in the flower: nothing has carried it to another flower.", 'picture' => 'flower', 'cards' => [['front' => 'Pollen', 'back' => 'A fine powder flowers make. Carried to another flower, it lets a fruit grow.'], ['front' => 'Pollinator', 'back' => 'An animal that carries pollen from flower to flower, like a bee.'], ['front' => '', 'back' => 'dropped']], 'reveal' => ['prompt' => 'Why are there no fruit?', 'text' => 'Nothing has carried the pollen from one flower to another.'], 'callout' => ['tone' => 'tip', 'text' => '']]],
        ['key' => 'pollen_a', 'type' => 'collect', 'scene' => 'orchard', 'label' => 'Collect pollen', 'x' => 0.5, 'item' => 'pollen', 'requires' => ['talk_keeper'], 'locked_hint' => 'Talk to Keeper Ama first.', 'info' => ['title' => 'Pollen from the west row', 'body' => 'Lots of pollen, all still on the flowers.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Sample collected']],
        ['key' => 'pollinate', 'type' => 'use', 'scene' => 'orchard', 'label' => 'A bare flower', 'x' => 0.8, 'look' => 'a single flower on a low branch, with no pollen on its middle', 'uses' => 'pollen', 'hint' => 'This flower has no pollen on it at all. If only someone could carry some over...', 'info' => ['title' => 'You are the pollinator!', 'body' => 'You dust pollen from the vial onto the flower. Now it can grow into a fruit.', 'callout' => ['tone' => 'think', 'text' => 'Who usually carries the pollen from flower to flower?']]],
        ['key' => 'pollen_b', 'type' => 'collect', 'scene' => 'orchard', 'label' => 'Collect pollen', 'x' => 0.7, 'item' => 'pollen', 'placement' => 'ground', 'requires' => ['talk_keeper'], 'info' => ['title' => 'Pollen from the east row', 'body' => 'The same here: the pollen has not moved.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Sample collected']],
        ['key' => 'q_pollen', 'type' => 'question', 'scene' => 'orchard', 'label' => 'Think about it', 'x' => 0.85, 'after' => 'pollen_b', 'look' => 'a flowering branch hanging low', 'question' => [
            'prompt' => 'The pollen is still on the flowers. What does a flower need for fruit to grow?',
            'choices' => [
                ['text' => 'More sunlight', 'correct' => false, 'feedback' => 'The trees get plenty of light, and they made flowers. Something else is missing.'],
                ['text' => 'Pollen carried to another flower', 'correct' => true, 'feedback' => 'Yes! Pollination moves pollen between flowers, and then fruit can grow.'],
                ['text' => 'Bigger petals', 'correct' => false, 'feedback' => 'Petal size does not make fruit. Think about where the pollen is.'],
            ],
            'objective' => 'LO1', 'standards' => ['TEST-3-LS1-1'],
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Good thinking']],
        ['key' => 'drain', 'type' => 'inspect', 'scene' => 'orchard', 'label' => 'Dig a channel', 'x' => 0.6, 'placement' => 'ground', 'look' => 'a muddy patch where water pools', 'resolves' => 'burst', 'info' => ['title' => 'Water runs downhill', 'body' => 'You dig a channel down the slope. The water runs away downhill and the path to the hive dries out.']],
        ['key' => 'talk_gran', 'type' => 'talk', 'scene' => 'orchard', 'label' => 'Talk to Granny Odo', 'character' => 'gran', 'dialogue' => [
            ['speaker' => 'gran', 'text' => 'Ooh, visitors! Do you like my pond? The frogs sing louder than my old bees.'],
        ]],
        ['key' => 'get_vine', 'type' => 'collect', 'scene' => 'hive', 'label' => 'Pull down a vine', 'x' => 0.2, 'item' => 'vine', 'placement' => 'wall', 'info' => ['title' => 'A long vine', 'body' => 'It is long and strong enough to hold a small robot.']],
        ['key' => 'get_branch', 'type' => 'collect', 'scene' => 'hive', 'label' => 'A fallen branch', 'x' => 0.42, 'item' => 'branch', 'placement' => 'ground', 'info' => ['title' => 'A forked branch', 'body' => 'The storm brought it down, right where you need it. The fork at the top is smooth.']],
        ['key' => 'save_pip', 'type' => 'use', 'scene' => 'hive', 'label' => 'Pip, hanging on!', 'x' => 0.86, 'item' => 'pip_hanging', 'placement' => 'back', 'uses' => 'pulley', 'rescues' => 'bot', 'hint' => 'Pip is clinging to a root below the edge, too far down to reach. Something to lift him with...', 'info' => ['title' => 'Heave!', 'body' => 'The pulley turns your pull downwards into a lift upwards. Up comes Pip!', 'callout' => ['tone' => 'fact', 'text' => 'A pulley changes the direction of a force: you pull down, the load goes up.']], 'cutscene' => [
            ['who' => 'bot', 'do' => 'say', 'text' => 'Beep! Thank you! That was a long way down.'],
            ['who' => 'bot', 'do' => 'gesture', 'gesture' => 'spin'],
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Pip is safe']],
        ['key' => 'talk_pip', 'type' => 'talk', 'scene' => 'hive', 'label' => 'Talk to Pip', 'character' => 'bot', 'dialogue' => [
            ['speaker' => 'bot', 'text' => 'Beep! The sprinkler sprays the hive every hour. The pollinators do not like getting wet!'],
        ]],
        ['key' => 'give_battery', 'type' => 'use', 'scene' => 'hive', 'label' => 'Give Pip a battery', 'uses' => 'battery', 'character' => 'bot', 'requires' => ['talk_pip'], 'hint' => 'Beep... my battery is flat. I cannot reach the timer controls without power.', 'dialogue' => [
            ['speaker' => 'bot', 'text' => 'Bzzt! Full power! Now I can open the timer for you.'],
        ], 'cutscene' => [
            ['who' => 'bot', 'do' => 'gesture', 'gesture' => 'spin'],
            ['who' => 'bot', 'do' => 'walk', 'x' => 0.35],
            ['who' => 'bot', 'do' => 'say', 'text' => 'Timer controls: online!'],
        ], 'award' => ['stars' => 2, 'xp' => 10, 'note' => 'Pip is powered up']],
        ['key' => 'q_predict', 'type' => 'question', 'scene' => 'hive', 'label' => 'Make a prediction', 'x' => 0.15, 'after' => 'talk_pip', 'question' => [
            'purpose' => 'predict',
            'prompt' => 'If the sprinkler sprays less often, what will the pollinators do?',
            'choices' => [
                ['text' => 'Come back to the hive', 'correct' => true, 'feedback' => 'Let\'s test it and see.'],
                ['text' => 'Stay away', 'correct' => false, 'feedback' => 'Let\'s test it and see.'],
            ],
            'objective' => 'LO2',
        ]],
        ['key' => 'track', 'type' => 'experiment', 'scene' => 'hive', 'label' => 'Adjust the sprinkler timer', 'x' => 0.3, 'item' => 'scope', 'requires' => ['talk_pip', 'give_battery'], 'instrument' => [
            'title' => 'Sprinkler timer',
            'controls' => [
                ['key' => 'sprays', 'kind' => 'slider', 'label' => 'Sprays per day', 'min' => '0', 'max' => 24, 'step' => 1, 'start' => 24, 'unit' => ''],
                ['key' => 'power', 'kind' => 'switch', 'label' => 'Timer power', 'options' => ['dropped']],
            ],
            'meters' => [['control' => 'sprays', 'label' => 'Water used'], ['control' => '', 'label' => 'dropped']],
            'shows' => [
                ['when' => [['control' => 'power', 'op' => '=', 'value' => 0]], 'text' => 'The timer screen is dark.'],
                ['when' => [['control' => 'sprays', 'op' => '>=', 'value' => 12]], 'text' => '💧 The hive is dripping wet.'],
                ['when' => [['control' => 'sprays', 'op' => '>=', 'value' => 2], ['control' => 'sprays', 'op' => '<=', 'value' => '3']], 'text' => '🌳 Trees watered, hive dry.'],
                ['when' => [['control' => 'sprays', 'op' => '<=', 'value' => 1]], 'text' => '🥀 The leaves start to droop.'],
                ['when' => [], 'text' => ''],
            ],
            'goal' => [['control' => 'sprays', 'op' => '>=', 'value' => 2], ['control' => 'sprays', 'op' => '<=', 'value' => 3], ['control' => 'power', 'op' => '=', 'value' => 1]],
            'test' => 'Run the timer',
            'misses' => [
                ['when' => [['control' => 'power', 'op' => '=', 'value' => 0]], 'text' => 'Nothing happens: the timer has no power. Is it switched on?'],
                ['when' => [['control' => 'sprays', 'op' => '>=', 'value' => 4]], 'text' => 'The hive still gets soaked several times a day. Pollinators need it dry.'],
                ['when' => [['control' => 'sprays', 'op' => '<=', 'value' => 1]], 'text' => 'The trees need some water too: one spray a day is not enough in this heat.'],
            ],
            'success' => 'Two or three sprays a day keep the trees watered and the hive dry.', 'objective' => 'LO2',
        ], 'award' => ['stars' => 3, 'xp' => 10, 'note' => 'Timer fixed']],
        ['key' => 'valves', 'type' => 'team_task', 'scene' => 'hive', 'label' => 'Turn a valve', 'x' => 0.5, 'item' => 'valve', 'placement' => 'back', 'requires' => ['track'], 'team' => ['needed' => 3, 'part' => 'turns a valve', 'success' => 'The pipes are fixed! The hive is dry again.'], 'award' => ['stars' => 2, 'xp' => 5, 'note' => 'Teamwork']],
        ['key' => 'read_humidity', 'type' => 'inspect', 'scene' => 'greenhouse', 'label' => 'Read the humidity gauge', 'x' => 0.4, 'item' => 'gauge', 'placement' => 'wall', 'role' => 'botanist', 'share' => 'Humidity: 95%.', 'info' => ['title' => 'Very wet air', 'body' => 'The gauge reads 95%. Pollinators cannot fly well in air this wet.']],
        ['key' => 'get_twine', 'type' => 'collect', 'scene' => 'greenhouse', 'label' => 'Take the twine', 'x' => 0.2, 'item' => 'twine', 'info' => ['title' => 'Garden twine', 'body' => 'A ball of strong string for tying up seedlings.']],
        ['key' => 'check_pipes', 'type' => 'inspect', 'scene' => 'burrow', 'label' => 'Check the pipes', 'x' => 0.6, 'item' => 'pipe', 'info' => ['title' => 'A cracked pipe', 'body' => 'Water is dripping from a crack. The sprinkler has been running all the time.']],
        ['key' => 'get_hook', 'type' => 'collect', 'scene' => 'burrow', 'label' => 'Pick up the hook', 'x' => 0.45, 'item' => 'hook', 'info' => ['title' => 'A bent hook', 'body' => 'An old hook, bent but strong.']],
        ['key' => 'fish_battery', 'type' => 'use', 'scene' => 'burrow', 'label' => 'A glint in a crack', 'x' => 0.8, 'placement' => 'ground', 'look' => 'a narrow crack in the floor with something glinting deep inside', 'uses' => 'grabber', 'keeps' => true, 'gives' => 'battery', 'hint' => 'Something shiny is stuck deep in the crack, too far down for fingers.', 'info' => ['title' => 'Got it!', 'body' => 'You lower the hook into the crack and fish out a robot battery.'], 'cutscene' => [
            ['who' => 'player', 'do' => 'gesture', 'gesture' => 'jump'],
        ]],
        ['key' => 'reroute', 'type' => 'team_task', 'scene' => 'greenhouse', 'label' => 'Open a vent', 'x' => 0.75, 'team' => ['roles' => [['role' => 'botanist', 'part' => 'opens the vents']], 'needed' => 2, 'part' => 'opens a vent', 'success' => 'The greenhouse dries out and the water goes where it is needed.']],
        ['key' => 'find_feather', 'type' => 'inspect', 'scene' => 'burrow', 'label' => 'Something shiny', 'x' => 0.3, 'item' => 'feather', 'hidden' => true, 'info' => ['title' => 'A pollinator feather', 'body' => 'The pollinators sheltered down here from the spray.']],
        ['key' => 'q_report', 'type' => 'question', 'scene' => 'landing', 'label' => 'What did you find?', 'at_report' => true, 'x' => 0.5, 'question' => [
            'prompt' => 'Why did the pollinators leave the orchard?',
            'choices' => [
                ['text' => 'A leaking pipe kept spraying, so the air was too wet to fly', 'correct' => true, 'feedback' => 'Exactly: the cracked pipe and the wet air together explain it.'],
                ['text' => 'The flowers had no pollen', 'correct' => false, 'feedback' => 'Your samples showed plenty of pollen.'],
                ['text' => 'It was too cold', 'correct' => false, 'feedback' => 'Nobody measured cold. Look at what you found in the greenhouse and the burrow.'],
            ],
            'objective' => 'LO2',
        ], 'award' => ['stars' => 2, 'xp' => 10, 'note' => 'Explained it']],
    ],
    'combinations' => [
        ['key' => 'make_pulley', 'items' => ['vine', 'branch'], 'makes' => 'pulley', 'text' => 'You loop the vine over the fork of the branch: a pulley!'],
        ['key' => 'make_grabber', 'items' => ['hook', 'twine'], 'makes' => 'grabber', 'text' => 'You tie the hook to the twine: a hook on a string!'],
    ],
    'roles' => [
        ['key' => 'botanist', 'name' => 'Botanist', 'description' => 'Older blueprints had crew roles; they are dropped.'],
    ],
    'twists' => [
        ['key' => 'burst', 'after' => 'pollen_b', 'invented' => true, 'title' => 'WHOOSH! A pipe bursts!', 'notice' => 'A burst pipe has washed mud over the path to the hive!', 'dialogue' => [
            ['speaker' => 'keeper', 'text' => 'A sprinkler pipe just burst. Mud is sliding over the path to the hive!'],
            ['speaker' => 'keeper', 'text' => 'Water always runs downhill. Can you give it somewhere to go?'],
        ], 'cutscene' => [
            ['who' => 'gran', 'do' => 'gesture', 'gesture' => 'jump'],
            ['who' => 'gran', 'do' => 'say', 'text' => 'Goodness! My knitting is soaked!'],
        ], 'blocks' => ['to' => 'hive', 'message' => 'Mud blocks the path. Dig a channel to drain it first.'], 'obstacle' => ['item' => 'mud', 'x' => 0.5], 'award' => ['stars' => 0, 'xp' => 0, 'note' => '']],
    ],
    'steps' => [
        ['key' => 'meet', 'text' => 'Talk to Keeper Ama', 'done_when' => ['talk_keeper']],
        ['key' => 'samples', 'text' => 'Collect pollen in the orchard', 'done_when' => ['pollen_a', 'pollen_b'], 'after' => 'meet'],
        ['key' => 'why', 'text' => 'Work out what the flowers need', 'done_when' => ['q_pollen'], 'after' => 'samples'],
        ['key' => 'clear', 'text' => 'Clear the mudslide', 'done_when' => ['drain'], 'after' => 'burst'],
        ['key' => 'investigate', 'text' => 'Find out where the water goes', 'done_when' => ['read_humidity', 'check_pipes', 'reroute']],
        ['key' => 'save', 'text' => 'Save Pip', 'done_when' => ['save_pip']],
        ['key' => 'carry', 'text' => 'Carry pollen to a bare flower', 'done_when' => ['pollinate'], 'after' => 'samples'],
        ['key' => 'power', 'text' => 'Get Pip some power', 'done_when' => ['make_grabber', 'fish_battery', 'give_battery'], 'after' => 'meet'],
        ['key' => 'fix', 'text' => 'Fix the sprinkler together', 'done_when' => ['track', 'valves'], 'after' => 'why'],
        ['key' => 'flowers', 'text' => 'Look closely at a flower', 'done_when' => ['look_flower'], 'optional' => true],
        ['key' => 'secret', 'text' => 'Find out where the pollinators hid', 'done_when' => ['find_feather'], 'optional' => true],
    ],
    'intro' => ['dialogue' => [['speaker' => 'keeper', 'text' => 'Over here, explorers! Come and talk to me.']]],
    'completion' => ['label' => 'Report to Keeper Ama', 'debrief' => 'You are back! Before we celebrate, tell me what you worked out.', 'dialogue' => [['speaker' => 'keeper', 'text' => 'The pollinators are back! Look, the first fruit is growing.']], 'award' => ['stars' => 8, 'xp' => 40, 'note' => 'Mission complete'], 'cutscene' => [
        ['who' => 'pilot', 'do' => 'say', 'text' => 'Finally! All aboard, explorers!'],
        ['who' => 'pilot', 'do' => 'leave', 'edge' => 'left'],
    ]],
    'badge' => ['name' => 'Quiet Hive patch', 'appearance' => 'a round patch with a smiling pollinator over a blue tree'],
];
