<?php

/**
 * The platform's avatars: the characters players choose from, the same in every scenario.
 * `scale` sizes them in a scene. An avatar is either one picture with a close-up (`image_url`,
 * `portrait_url`: a still picture faces right and is mirrored to face left), or a character with
 * `animations` by name: the poses stand_right, stand_left, walk_right, walk_left and portrait
 * (a missing one is filled in from another), and moves such as jump. See Avatars::seed, and
 * docs/src/content/docs/developers/extensions/characters.md.
 *
 * The cast (ids 11 to 19) replaced the first set (1 to 10: Nova … Halley and Sprocket) on
 * 2026-11-21; see the migration 2026_11_21_000200_replace_platform_avatars, which retires those
 * on a database that has them. Each is one picture, given for the way the art faces (the other
 * way is that picture mirrored), and a close-up of the head.
 */
$cast = [
    // id => [name, the way the picture faces, its width (all are 512 high but Asimov, 511)]
    11 => ['Asimov', 'left', 278],
    12 => ['Buck', 'left', 275],
    13 => ['Gil', 'right', 214],
    14 => ['Lucy', 'right', 371],
    15 => ['Mallory', 'left', 277],
    16 => ['Pinta', 'right', 226],
    17 => ['Riona', 'left', 272],
    18 => ['Sam', 'right', 253],
    19 => ['Val', 'right', 241],
];

$avatars = [];
foreach ($cast as $id => [$name, $facing, $width]) {
    $file = strtolower($name).'.png';
    $picture = "/scenario-assets/platform/avatars/$file";
    $portrait = "/scenario-assets/platform/portraits/$file";
    $avatars[] = [
        'id' => $id, 'name' => $name, 'image_url' => $picture, 'portrait_url' => $portrait,
        // 512 pixels high at 0.45: about as tall in a scene as the first set was.
        'settings' => ['scale' => 0.45],
        'animations' => [
            "stand_$facing" => ['url' => $picture, 'width' => $width, 'height' => $name === 'Asimov' ? 511 : 512],
            'portrait' => ['url' => $portrait, 'width' => 320, 'height' => 320],
        ],
    ];
}

return $avatars;
