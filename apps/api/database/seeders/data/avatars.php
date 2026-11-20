<?php

/**
 * The platform's avatars: the characters players choose from, the same in every scenario.
 * `scale` sizes them in a scene. An avatar is either one picture with a close-up (`image_url`,
 * `portrait_url`: a still picture faces right and is mirrored to face left), or a character with
 * `animations` by name: the poses stand_right, stand_left, walk_right, walk_left and portrait
 * (a missing one is filled in from another), and moves such as jump. See Avatars::seed, and
 * docs/src/content/docs/developers/extensions.md, "Characters".
 */
$avatars = [];
foreach (['Nova', 'Orion', 'Vega', 'Atlas', 'Lyra', 'Rigel', 'Juno', 'Cosmo', 'Halley'] as $i => $name) {
    $n = $i + 1;
    $avatars[] = ['id' => $n, 'name' => $name, 'image_url' => "/scenario-assets/platform/avatars/avatar-$n.png", 'portrait_url' => "/scenario-assets/platform/portraits/avatar-$n.png", 'settings' => ['scale' => 0.85]];
}

// Sprocket is drawn the way avatars are now: animations by name, cut from platform pictures that
// other avatars could share. Each picture is given by address; seeding makes it a platform_media row.
$sheet = ['url' => '/scenario-assets/platform/avatars/sprocket-sheet.png', 'width' => 720, 'height' => 540, 'sheet' => ['columns' => 6, 'rows' => 3]];
$avatars[] = [
    'id' => 10, 'name' => 'Sprocket', 'image_url' => '/scenario-assets/platform/avatars/sprocket-sheet.png', 'portrait_url' => '/scenario-assets/platform/portraits/sprocket.png',
    'settings' => ['scale' => 1.35],
    'animations' => [
        'stand_right' => $sheet + ['frames' => [0, 1], 'duration' => 900],
        'walk_right' => $sheet + ['frames' => [6, 7, 8, 9, 10, 11], 'duration' => 600],
        'portrait' => ['url' => '/scenario-assets/platform/portraits/sprocket.png'],
        'jump' => $sheet + ['frames' => [12, 13, 14, 13, 12], 'duration' => 600, 'repeat' => false],
        'dance' => $sheet + ['frames' => [15, 16, 17, 16], 'duration' => 700, 'repeat' => true],
    ],
];

return $avatars;
