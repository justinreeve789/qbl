<?php

/**
 * "QBL Adventure": the look of a classic 1990s point-and-click adventure game, from Justin's own prompt
 * that worked well in Recraft: "2d art for a game, multiplayer, no characters in scene, but plenty of
 * open space to move around, intricate details. Cartoon illustration with vibrant colors, like a 90s
 * LucasArts adventure game. Make it of a town on an alien planet. Hovels everywhere. Lots of open space."
 *
 * The look is described in its own terms rather than by naming a studio, so the model draws the style
 * and not any particular game's places or characters.
 *
 * See qbl-cartoon/style.php for what each field does. Bump `version` when you change the words or
 * the anchors: every picture records the version it was drawn with.
 */
return [
    'name' => 'QBL Adventure',
    'version' => 1,

    'summary' => 'Hand-painted cartoon art in the spirit of classic 1990s point-and-click adventure games: vibrant, intricate, whimsical and a little wonky, with lots of open floor to walk on.',

    'medium' => 'high-resolution hand-painted 2D cartoon illustration in the spirit of classic 1990s point-and-click adventure games, rich intricate detail, vibrant saturated colour; not pixel art',
    'line' => 'confident dark brown-violet (#2A1B3D) ink outlines on characters and objects, varying in weight like a brush, thicker on outer silhouettes; scenery painted with selective linework',
    'shading' => 'painted shading with smooth gradients and bold colour shifts: warm golden lights against cool violet and teal shadows, soft glows from lamps and windows, atmospheric haze in the distance; no photographic texture or noise',
    'shapes' => 'whimsical, exaggerated and slightly wonky: crooked leaning buildings, bulging domes, curling chimneys and tilted windows, nothing perfectly straight or symmetrical; chunky readable silhouettes',
    'characters' => 'cartoon proportions about 3 to 4 heads tall, big expressive faces with large eyes, oversized hands and feet, lively readable poses, friendly and goofy rather than realistic',
    'lighting' => 'vivid storybook lighting with a strong warm key light and cool fill; skies with dramatic painted gradients',
    'mood' => 'curious, funny and inviting; adventurous but never scary',

    'palette' => [
        'ink' => '#2A1B3D',
        'deep violet' => '#3E2A6B',
        'twilight blue' => '#2B4C8C',
        'sky teal' => '#3FB8C9',
        'pale aqua' => '#BDF0E8',
        'jade' => '#1E9E78',
        'lime moss' => '#8FD14F',
        'olive' => '#5C7A2E',
        'gold' => '#FFC93C',
        'amber' => '#F2913D',
        'tangerine' => '#FF6B35',
        'brick' => '#B5452F',
        'berry' => '#B83280',
        'lilac' => '#B48EF0',
        'plum shadow' => '#5B2A5E',
        'sandstone' => '#E8C38A',
        'adobe' => '#C98A5B',
        'bark' => '#6E4630',
        'slate' => '#5F6F8A',
        'mist' => '#E9E4F2',
        'skin 1' => '#FFE0C2',
        'skin 2' => '#F1B98A',
        'skin 3' => '#C98B5E',
        'skin 4' => '#8D5A3B',
        'skin 5' => '#5C3A28',
    ],

    'kinds' => [
        'background' => 'A wide side-on background for a 2D multiplayer adventure game, like a painted stage set seen from the front at a child\'s eye level, showing {subject}. Lots of open, flat, uncluttered ground in the front part of the scene for many players to walk around on, as described below. Intricate detail in the buildings and scenery standing along the back and sides. No characters, people or creatures anywhere.',
        'character' => 'A full-body character design of {subject}, standing in a relaxed neutral pose, turned three-quarters towards the right, whole body visible from head to feet with nothing cropped, feet flat on the ground. One single character only.',
        'portrait' => 'A head-and-shoulders portrait of the same character as in the reference sheet: {subject}. Turned three-quarters towards the right, expressive friendly face, centred, top of the head close to the top edge.',
        'strip' => 'An animation sprite strip for a 2D adventure game: {subject}. Exactly {frames} frames of the SAME character as the reference character sheet, side by side in one horizontal row, evenly spaced with clear empty space between frames, every frame the same size and scale, feet on the same baseline, facing right. Identical design, colours, outfit and proportions in every frame. No ground line, floor, shadow or anything else under or between the frames.',
        'item' => 'A single object for a 2D adventure game: {subject}. Shown whole and centred, from a three-quarter view slightly above, with nothing else in the picture.',
        'vehicle' => 'A single vehicle for a 2D adventure game: {subject}. Side view facing right, whole and centred, wheels or base at the bottom, nothing else in the picture.',
        'badge' => 'A round embroidered mission patch: {subject}. Seen straight on, centred, with a stitched border. No letters or numbers.',
    ],

    'marker' => 'a small floating crystal beacon: a glowing teal crystal above a little brass stand with curly ornaments, with a soft sparkle',

    'avoid' => 'photorealism, 3D rendering, clay or plastic look, pixel art, anime style, flat vector minimalism, muddy or desaturated colours, letters, words, numbers, signs with writing, logos, watermarks, signatures, frames, borders, UI elements, multiple views (unless a strip is asked for), cropped limbs, extra fingers, weapons, gore, anything scary, characters from existing games or films',

    // Cut-outs are drawn on this and it is removed. It is not in the palette (berry and lilac are far enough from it).
    'chroma' => '#FF00FF',

    'post' => [
        // Painted gradients: pull gently, so colour stays rich.
        'palette_pull' => 0.25,
        'match_frames' => true,
        'portrait_backdrop' => '#3E2A6B',
    ],

    'anchors' => [
        'environment' => 'anchors/environment.png',
        'character' => 'anchors/character.png',
        'props' => 'anchors/props.png',
        'portrait' => 'anchors/portrait.png',
    ],

    'bootstrap' => [
        'environment' => ['kind' => 'background', 'subject' => 'a town on an alien planet: crooked domed hovels everywhere, leaning towers with curly chimneys, strange bulbous plants, glowing lanterns, a twin-mooned sky with a ringed planet, cobbled lanes; the hovels crowd the back and sides while a wide plaza of open ground fills the front', 'ground_line' => 0.62],
        'character' => ['kind' => 'character', 'subject' => 'a young space explorer from a friendly starship crew: an oversized teal flight jacket with brass buttons and rolled sleeves, a tangerine scarf, baggy olive trousers tucked into chunky boots, goggles pushed up on a mop of curly dark hair, a satchel full of gadgets, skin tone skin 3'],
        'props' => ['kind' => 'item', 'subject' => 'four adventure-game objects in a row with space between them: a brass telescope on a tripod, a glowing jar of alien fireflies, a crooked wooden signpost with no writing, and a curly potted alien plant'],
        'portrait' => ['kind' => 'portrait', 'subject' => 'the young space explorer from the character anchor, grinning'],
    ],
];
