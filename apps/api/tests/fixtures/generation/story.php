<?php

/**
 * A story blueprint as the language model writes one, for tests/story_generation.php: the water cycle as a
 * raindrop's journey, in three scenes. It has a cast on stage, characters who come on and walk off, lines
 * said to someone (so the speaker turns), gestures, a narrator, sound effects, the weather changing (a
 * storm blowing up, rain easing to clear), a living sky that sets, a pond lying in the floor, a river
 * flowing along the front of a wide scene with a far view, a bird that lands now and then and a farm truck
 * that only drives by when the script cues it, a lantern, a prop, and things to talk about at the end.
 * Some fields are left half-filled on purpose, for MissionDesigner::tidyStory().
 */
return [
    'title' => 'Drip Goes Round',
    'subtitle' => 'A raindrop\'s trip from a pond to the sky and back',
    'description' => 'Drip, a small drop of water, is warmed by the sun, rises into a cloud, falls as rain and runs home down a river. Students see evaporation, condensation and precipitation happen to someone they care about.',
    'story' => [
        'premise' => 'Drip lives in a pond. The sun warms Drip until Drip floats up as vapour, joins a cloud, grows heavy in a storm, falls as rain and rides a river back home.',
        'takeaway' => 'Water goes round and round: it evaporates, condenses into clouds and falls as rain, again and again.',
    ],
    'art_direction' => ['setting' => 'A gentle green valley with a pond, low hills and a winding river', 'accent_colors' => ['#5AA6D6', '#FFB703'], 'time_of_day' => 'morning'],
    'narrator' => ['voice' => ['gender' => 'female', 'age' => 'adult', 'sound' => 'warm, gentle']],
    'characters' => [
        ['key' => 'drip', 'name' => 'Drip', 'role' => 'A small raindrop, the hero', 'appearance' => 'a small round drop of clear blue water with big friendly eyes and tiny arms and legs', 'personality' => 'curious, brave, a bit giggly', 'height_cm' => 60,
            'voice' => ['gender' => 'neutral', 'age' => 'child', 'sound' => 'bright, bubbly'], 'gestures' => ['wave', 'cheer', 'no-such-gesture']],
        ['key' => 'fen', 'name' => 'Fen', 'role' => 'A frog who lives at the pond', 'appearance' => 'a plump green frog with a yellow belly and a tiny straw hat', 'personality' => 'sleepy, kind, slow-talking', 'height_cm' => 50,
            'voice' => ['gender' => 'male', 'age' => 'elder', 'sound' => 'deep, croaky'], 'gestures' => ['point'], 'guide' => true, 'scene' => 'pond'],
        ['key' => 'nimbus', 'name' => 'Nimbus', 'role' => 'A friendly cloud', 'appearance' => 'a big fluffy white cloud with a round face, rosy cheeks and little puffy arms', 'personality' => 'cheerful, booming', 'height_cm' => 220,
            'voice' => ['gender' => 'female', 'age' => 'adult', 'sound' => 'big and jolly']],
    ],
    'items' => [
        ['key' => 'jetty', 'name' => 'Little jetty', 'appearance' => 'a short wooden jetty of grey planks on stubby posts', 'size_cm' => 260],
    ],
    'scenes' => [
        ['key' => 'pond', 'title' => 'The Pond', 'description' => 'Drip and Fen in the morning sun; Drip starts to rise.', 'kind' => 'outdoor',
            'background' => 'a sunny meadow with tall reeds, a few smooth rocks and low hills behind',
            'ground_line' => 0.66,
            'sky' => ['time' => 'morning', 'clouds' => 'few'],
            'water' => ['kind' => 'pond', 'where' => 'middle', 'x' => 0.5, 'width' => 0.3, 'look' => 'a round pond edged with reeds and lily pads', 'color' => 'not a colour'],
            'ambient' => [['key' => 'wren', 'look' => 'a small round brown bird', 'motion' => 'lands', 'size_cm' => 12, 'sound' => 'tweet']],
            'props' => [['item' => 'jetty', 'x' => 0.78]],
            'cast' => [['who' => 'drip', 'x' => 0.25], ['who' => 'fen', 'x' => 0.75, 'facing' => 'left'], ['who' => '']],
            'script' => [
                ['do' => 'narrate', 'text' => 'Once there was a little drop of water called Drip, who lived in a pond.'],
                ['do' => 'say', 'who' => 'drip', 'to' => 'fen', 'text' => 'Good morning, Fen! The sun feels so warm today.'],
                ['do' => 'gesture', 'who' => 'fen', 'gesture' => 'point'],
                ['do' => 'say', 'who' => 'fen', 'to' => 'drip', 'text' => 'Careful, little one. Warm water likes to float away.'],
                ['do' => 'sound', 'sound' => 'chime'],
                ['do' => 'narrate', 'text' => 'The sun warmed Drip until Drip turned into vapour, light as air. That is called evaporation.', 'meanwhile' => true],
                ['do' => 'walk', 'who' => 'drip', 'x' => 0.5, 'run' => true],
                ['do' => 'gesture', 'who' => 'drip', 'gesture' => 'cheer'],
                ['do' => 'leave', 'who' => 'drip', 'edge' => 'right'],
                ['do' => 'wait', 'seconds' => 1, 'text' => ''],
            ]],
        ['key' => 'sky', 'title' => 'Up in the Clouds', 'description' => 'Drip joins Nimbus; a storm blows up.', 'kind' => 'up_high',
            'background' => 'the top of a high grassy hill with a lone bent tree, other hilltops far below',
            'ground_line' => 0.7,
            'sky' => ['time' => 'afternoon', 'until' => 'sunset', 'clouds' => 'many'],
            'lights' => [['x' => 0.15, 'kind' => 'lantern', 'look' => 'an iron lantern hanging from a wooden post', 'placement' => 'back']],
            'cast' => [['who' => 'nimbus', 'x' => 0.62]],
            'script' => [
                ['do' => 'title', 'text' => 'High above the valley...'],
                ['do' => 'enter', 'who' => 'drip', 'from' => 'left', 'x' => 0.35],
                ['do' => 'say', 'who' => 'nimbus', 'to' => 'drip', 'text' => 'Welcome, tiny one! Come and cool down with all of us.'],
                ['do' => 'narrate', 'text' => 'High up it was cold. Drip and many other drops huddled together into a cloud. That is condensation.'],
                ['do' => 'weather', 'weather' => 'storm', 'intensity' => 'heavy'],
                ['do' => 'sound', 'sound' => 'thunder'],
                ['do' => 'say', 'who' => 'drip', 'text' => 'Whoa! I feel so heavy!'],
                ['do' => 'leave', 'who' => 'drip', 'edge' => 'left', 'run' => true],
            ]],
        ['key' => 'river', 'title' => 'Down the River', 'description' => 'Drip rides the river home.', 'kind' => 'outdoor', 'width' => 'wide',
            'background' => 'a winding country lane beside a field of tall grass, a wooden fence and a red barn far along',
            'distance' => 'rolling green hills and a far-off village under the sky',
            'ground_line' => 0.64,
            'weather' => ['kind' => 'rain', 'intensity' => 'light'],
            'water' => ['kind' => 'river', 'where' => 'front', 'flows' => 'right', 'look' => 'grassy banks with reeds and a few flat stepping stones'],
            'ambient' => [['key' => 'truck', 'look' => 'a small red farm truck with round headlights', 'motion' => 'drives_by', 'size_cm' => 420, 'sound' => 'car', 'cue' => true]],
            'foreground' => ['look' => '', 'where' => 'bottom'],
            'cast' => [],
            'script' => [
                ['do' => 'narrate', 'text' => 'Drip fell as rain. That is precipitation. Plip, plop, splash!'],
                ['do' => 'sound', 'sound' => 'splash'],
                ['do' => 'enter', 'who' => 'drip', 'from' => 'left', 'x' => 0.3],
                ['do' => 'pass', 'passer' => 'truck'],
                ['do' => 'say', 'who' => 'drip', 'text' => 'Wheee! The river is taking me home!'],
                ['do' => 'weather', 'weather' => 'clear'],
                ['do' => 'enter', 'who' => 'fen', 'from' => 'right', 'x' => 0.6],
                ['do' => 'say', 'who' => 'fen', 'to' => 'drip', 'text' => 'Welcome back, traveller. Round and round you go.'],
                ['do' => 'gesture', 'who' => 'drip', 'gesture' => 'wave'],
            ]],
    ],
    'ending' => [
        'text' => 'And one day, Drip will rise again.',
        'discussion' => ['What made Drip rise out of the pond?', 'Why did Drip feel heavy in the cloud?', '', 'Where might Drip go next time?', 'A fourth question that is one too many'],
    ],
];
