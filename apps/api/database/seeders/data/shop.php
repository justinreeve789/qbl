<?php

/**
 * The platform's marketplace catalogue: items sold in every scenario. Scenario authors add
 * mission-specific items of their own in the editor. Sizes and offsets are fractions of the
 * avatar's height, so an item fits avatars of any size.
 */
$img = fn (string $name) => "/scenario-assets/shop/$name.png";

return [
    ['id' => 1, 'name' => 'Star cap', 'description' => 'A cap for people who collect stars.', 'kind' => 'wearable', 'slot' => 'head', 'price' => 15, 'image_url' => $img('star-cap'), 'settings' => ['scale' => 0.26, 'offset_y' => 0.07]],
    ['id' => 2, 'name' => 'Explorer hat', 'description' => 'Keeps two suns out of your eyes.', 'kind' => 'wearable', 'slot' => 'head', 'price' => 25, 'image_url' => $img('explorer-hat'), 'settings' => ['scale' => 0.26, 'offset_y' => 0.08]],
    ['id' => 3, 'name' => 'Space helmet', 'description' => 'Standard issue, with a fog-free visor.', 'kind' => 'wearable', 'slot' => 'head', 'price' => 60, 'image_url' => $img('space-helmet'), 'settings' => ['scale' => 0.4, 'offset_y' => 0.3]],
    ['id' => 4, 'name' => 'Flight jacket', 'description' => 'Warm at any altitude.', 'kind' => 'wearable', 'slot' => 'body', 'price' => 40, 'image_url' => $img('flight-jacket'), 'settings' => ['scale' => 0.34]],
    ['id' => 5, 'name' => 'Jetpack', 'description' => 'For looks only. Flight not included.', 'kind' => 'wearable', 'slot' => 'back', 'price' => 80, 'image_url' => $img('jetpack'), 'settings' => ['scale' => 0.42]],
    ['id' => 6, 'name' => 'Hero cape', 'description' => 'Flutters heroically.', 'kind' => 'wearable', 'slot' => 'back', 'price' => 50, 'image_url' => $img('hero-cape'), 'settings' => ['scale' => 0.5]],
    ['id' => 7, 'name' => 'Scanner', 'description' => 'A field scientist is never without one.', 'kind' => 'wearable', 'slot' => 'hand', 'price' => 30, 'image_url' => $img('scanner'), 'settings' => ['scale' => 0.24]],
    ['id' => 8, 'name' => 'Robo-pup', 'description' => 'Follows you everywhere. Never needs feeding.', 'kind' => 'pet', 'price' => 120, 'image_url' => $img('robo-pup'), 'settings' => ['scale' => 0.34]],
    ['id' => 9, 'name' => 'Glow moth', 'description' => 'A gentle light that flutters after you.', 'kind' => 'pet', 'price' => 90, 'image_url' => $img('glow-moth'), 'settings' => ['scale' => 0.26, 'offset_y' => -0.7]],
    ['id' => 10, 'name' => 'Bounce', 'description' => 'A spring in your step while you stand around.', 'kind' => 'animation', 'price' => 35, 'image_url' => $img('bounce'), 'settings' => ['animation' => 'bounce']],
    ['id' => 11, 'name' => 'Float', 'description' => 'Hover a little, as if gravity were optional.', 'kind' => 'animation', 'price' => 70, 'image_url' => $img('float'), 'settings' => ['animation' => 'float']],
    ['id' => 12, 'name' => 'Universal translator', 'description' => 'Some signs and creatures can only be understood with one of these.', 'kind' => 'ability', 'price' => 100, 'image_url' => $img('translator'), 'settings' => ['ability' => 'translator']],
    ['id' => 13, 'name' => 'Field guide', 'description' => 'Unlocks extra notes on plants and animals in missions that have them.', 'kind' => 'ability', 'price' => 60, 'image_url' => $img('field-guide'), 'settings' => ['ability' => 'field_guide']],
];
