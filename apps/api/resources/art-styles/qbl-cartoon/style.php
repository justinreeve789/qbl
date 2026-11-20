<?php

/**
 * The QBL house art style: the "style bible" every generated picture is drawn to.
 *
 * Three things keep pictures consistent, and all three come from this folder:
 *  1. The same words. Every prompt is built by App\Qbl\Generation\Art\ArtStyle from the fields below,
 *     in the same order, with only the subject changing.
 *  2. The same pictures. anchors/ holds approved reference images (made by `php artisan qbl:art-style
 *     qbl-cartoon --bootstrap`, then reviewed by a person). They are sent with every request, and every
 *     result is judged against them.
 *  3. The same colours and finish. Results are pulled towards `palette` and cut out, trimmed and sized
 *     the same way, so nothing drifts in post.
 *
 * Change this file deliberately: a change to the words or the anchors changes every picture made after it.
 * Bump `version` when you do; each generated picture records the version it was made with.
 */
return [
    'name' => 'QBL Cartoon',
    'version' => 2,

    'summary' => 'A bright, friendly 2D cartoon in the look of a modern animated series for children aged 8 to 14: clean vector shapes, confident outlines, flat colour with one crisp shadow tone.',

    'medium' => 'clean 2D vector cartoon illustration, flat colour fills, as drawn for a modern animated TV series for children',
    'line' => 'smooth uniform outlines in deep plum (#2B2340) about 3 pixels thick at 1024 pixels, slightly thicker on the outer silhouette, rounded joins, no sketchy or broken lines',
    'shading' => 'cel shading: each surface has one flat base colour and one hard-edged darker shadow shape, light from the upper left; small simple white highlights; no soft gradients on characters or objects, no textures, no noise, no painterly brushwork',
    'shapes' => 'simple rounded geometric shapes, chunky readable silhouettes, slightly exaggerated proportions, gentle curves, few small details',
    'characters' => 'about 4 heads tall, big expressive eyes with a single white highlight, small simple nose, friendly open expressions, hands with four fingers, sturdy feet',
    'lighting' => 'bright, even, cheerful lighting; colours stay saturated in shadow',
    'mood' => 'optimistic, curious and welcoming; never scary',

    // The colours pictures are drawn in and pulled towards. Name each so prompts can mention them.
    'palette' => [
        'outline plum' => '#2B2340',
        'night blue' => '#1F3A68',
        'starship blue' => '#2E6FD8',
        'sky blue' => '#7CC6F2',
        'ice' => '#D9F1FF',
        'teal' => '#1FA79B',
        'mint' => '#7FE0B8',
        'leaf green' => '#4CB944',
        'moss' => '#2F7A3B',
        'sunshine' => '#FFD23F',
        'apricot' => '#FFA552',
        'coral' => '#FF6B57',
        'berry' => '#D93A6B',
        'lavender' => '#A68BF2',
        'violet' => '#6B4BC8',
        'sand' => '#F2D6A2',
        'clay' => '#C9824A',
        'cocoa' => '#7A4B32',
        'warm grey' => '#B8AFA6',
        'steel' => '#7E8BA3',
        'cloud' => '#F7F5F0',
        'skin 1' => '#FFE0C2',
        'skin 2' => '#F1B98A',
        'skin 3' => '#C98B5E',
        'skin 4' => '#8D5A3B',
        'skin 5' => '#5C3A28',
    ],

    // What each kind of picture shows and how it is framed. {subject} is replaced with what to draw.
    'kinds' => [
        'background' => 'A wide side-on game background (like a stage set seen from the front at a child\'s eye level) showing {subject}. Orthographic, no strong perspective, no vanishing point. A flat open floor fills the bottom of the picture as described below and is left empty so characters can walk anywhere on it. Scenery, buildings and landmarks stand along the back edge of the floor and behind it. Simplified background detail, slightly lighter and less saturated towards the distance.',
        'character' => 'A full-body character design of {subject}, standing in a relaxed neutral pose, turned three-quarters towards the right, whole body visible from head to feet with nothing cropped, feet flat on the ground. One single character only.',
        'portrait' => 'A head-and-shoulders portrait of the same character as in the reference sheet: {subject}. Turned three-quarters towards the right, friendly expression, centred, top of the head close to the top edge.',
        'strip' => 'An animation sprite strip for a 2D game: {subject}. Exactly {frames} frames of the SAME character as the reference character sheet, side by side in one horizontal row, evenly spaced with clear empty space between frames, every frame the same size and scale, feet on the same baseline, facing right. Identical design, colours, outfit and proportions in every frame. No ground line, floor, shadow or anything else under or between the frames.',
        'item' => 'A single game object: {subject}. Shown whole and centred, from a three-quarter view slightly above, with nothing else in the picture.',
        'vehicle' => 'A single vehicle for a 2D game: {subject}. Side view facing right, whole and centred, wheels or base at the bottom, nothing else in the picture.',
        'passage' => 'A way through for a 2D game, cut out on its own so it can be stood against the back of a scene: {subject}. Seen from the front at eye level, upright, whole and centred, its bottom edge flat where it meets the floor, with only as much wall, rock or frame around it as it needs. Nothing else in the picture.',
        'opening' => 'An opening in the floor for a 2D game, cut out on its own so it can be laid on the ground of a scene: {subject}. Seen from the front and above at a low angle, so it is a wide flat oval or shape lying on the ground, with a little of the ground around its rim. Nothing else in the picture.',
        'sheet' => 'A sheet of {count} separate objects for a 2D game, laid out in a grid of {columns} columns and {rows} rows, read left to right and top to bottom: {subject}. Each object whole, upright and centred in its own equal cell, with wide empty space around it; none touching, overlapping or crossing into another cell; every object drawn in the same style as the others. No numbers, labels, frames or grid lines. Nothing else in the picture.',
        'badge' => 'A round embroidered mission patch: {subject}. Seen straight on, centred, with a stitched border. No letters or numbers.',
    ],

    // Shown where students can click something that has no object of its own (a question, a clue in the scenery).
    'marker' => 'a small hovering hologram beacon: a glowing teal diamond above a round silver base, with a soft sparkle',

    // Said in every prompt.
    'avoid' => 'photorealism, 3D rendering, clay or plastic look, soft airbrushed gradients, painterly texture, noise or grain, pixel art, anime style, letters, words, numbers, signs with writing, logos, watermarks, signatures, frames, borders, drop shadows on the background, multiple views (unless a strip is asked for), cropped limbs, extra fingers, weapons, anything scary',

    // Cut-out pictures (characters, items, vehicles) are drawn on this flat colour, which is then removed.
    // It must not be in the palette. Providers that can draw transparent backgrounds do so instead.
    'chroma' => '#FF00FF',

    'post' => [
        // Pull every pixel this far (0..1) towards its nearest palette colour. 0 is off. Flat cartoon
        // styles take 0.4-0.6 well: it evens out colour drift between pictures without visible banding.
        'palette_pull' => 0.45,
        // Animation frames are colour-matched to their character sheet, so frames drawn in separate
        // requests cannot differ in tint.
        'match_frames' => true,
        // Every portrait is cut out and set on this same backdrop, so story boxes all look alike.
        'portrait_backdrop' => '#1F3A68',
    ],

    // Approved reference pictures, by role. Paths are relative to this folder.
    'anchors' => [
        'environment' => 'anchors/environment.png',
        'character' => 'anchors/character.png',
        'props' => 'anchors/props.png',
        'portrait' => 'anchors/portrait.png',
    ],

    // The pictures `qbl:art-style --bootstrap` draws to make the anchors, before any are approved.
    'bootstrap' => [
        'environment' => ['kind' => 'background', 'subject' => 'a grassy alien meadow with round turquoise trees, a small stream and a distant friendly starship landing pad, under a sky with two moons', 'ground_line' => 0.7],
        'character' => ['kind' => 'character', 'subject' => 'a young scientist in a mint-green lab coat over a coral jumpsuit, round glasses, curly dark hair, carrying a clipboard, skin tone skin 3'],
        'props' => ['kind' => 'item', 'subject' => 'a set of four science objects arranged in a row: a glass flask with teal liquid, a magnifying glass, a potted alien plant, and a small hand-held scanner'],
        'portrait' => ['kind' => 'portrait', 'subject' => 'the young scientist from the character anchor, smiling'],
    ],
];
