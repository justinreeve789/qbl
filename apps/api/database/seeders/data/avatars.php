<?php

/**
 * The platform's avatars: the characters players choose from, the same in every scenario.
 * `scale` sizes the picture in a scene. A sprite sheet also says how it is cut into frames and
 * which frames make each animation (see docs/src/content/docs/developers/extensions.md, "Animations").
 */
$avatars = [];
foreach (['Nova', 'Orion', 'Vega', 'Atlas', 'Lyra', 'Rigel', 'Juno', 'Cosmo', 'Halley'] as $i => $name) {
    $n = $i + 1;
    $avatars[] = ['id' => $n, 'name' => $name, 'image_url' => "/scenario-assets/platform/avatars/avatar-$n.png", 'portrait_url' => "/scenario-assets/platform/portraits/avatar-$n.png", 'settings' => ['scale' => 0.85]];
}
$avatars[] = [
    'id' => 10, 'name' => 'Sprocket', 'image_url' => '/scenario-assets/platform/avatars/sprocket-sheet.png', 'portrait_url' => '/scenario-assets/platform/portraits/sprocket.png',
    'settings' => [
        'scale' => 1.35, 'width' => 720, 'height' => 540, 'sheet' => ['columns' => 6, 'rows' => 3],
        'animations' => [
            ['name' => 'idle', 'frames' => [0, 1], 'duration' => 900],
            ['name' => 'walk', 'frames' => [6, 7, 8, 9, 10, 11], 'duration' => 600],
            ['name' => 'jump', 'frames' => [12, 13, 14, 13, 12], 'duration' => 600, 'repeat' => false],
            ['name' => 'dance', 'frames' => [15, 16, 17, 16], 'duration' => 700, 'repeat' => true],
        ],
    ],
];

return $avatars;
