<?php

/**
 * Build the starship hub template (apps/api/database/seeders/data/hub.php) from the Starship
 * Explorer demo (apps/api/database/seeders/scenarios/starship-explorer.zip). The hub is the ship without any mission: its rooms, the doors between
 * them, the marketplace, the things to read, the crew, and a few things that go on by
 * themselves (a planet drifting past the observation deck, a warning light blinking in the
 * engine room). A new scenario can start as a copy of it.
 *
 *   php tools/make-hub.php
 *
 * Run it again after changing the demo's ship scenes, or edit the lists below.
 */
foreach (['StoreError', 'Characters/Character', 'Characters/NpcCharacter', 'Characters/AvatarCharacter', 'Apng', 'ScenarioStore', 'Avatars', 'ScenarioDecompiler', 'ScenarioArchive'] as $class) {
    require __DIR__."/../apps/api/app/Qbl/$class.php";
}
$data = __DIR__.'/../apps/api/database/seeders/data';
$rows = App\Qbl\ScenarioArchive::read(App\Qbl\ScenarioArchive::SHIPPED.'/starship-explorer.zip', fn (array $rows, callable $fileFor, array $document) => $rows + ['document' => $document]);
$rows['scenario']['settings'] += array_intersect_key($rows['document'], array_flip(['avatar_media_ids', 'avatar_portraits']));
// Files uploaded for the demo are also kept beside its other assets (npm run seed:export puts
// them in scenarios/assets/starship/uploads), and the hub uses them from there.
foreach ($rows['media'] as &$m) {
    if (is_string($m['filepath'] ?? null)) {
        [$m['url'], $m['filepath']] = ['uploads/'.basename($m['filepath']), null];
    }
}
unset($m);

// The ship's rooms, and what is kept in each. Everything else there belongs to the demo's own missions.
$keep = [
    'control-room' => ['edge-north', 'edge-east', 'edge-south', 'captain-greeting'],
    'observation-deck' => ['deck-caption', 'edge-south'],
    'laboratory' => ['caption', 'edge-west'],
    'corridor' => null, // null: everything
    'crew-quarters' => null,
    'hydroponics' => ['caption', 'edge-west', 'grow-racks', 'grow-lights', 'water-tank'],
    'engine-room' => ['caption', 'edge-south', 'reactor', 'control-desk', 'coolant-pipes'],
    'marketplace' => null,
];

$byId = fn (array $list) => array_column($list, null, 'id');
$scenes = array_values(array_filter($rows['scenes'], fn ($s) => array_key_exists($s['shortname'], $keep)));
$sceneName = array_column($scenes, 'shortname', 'id');
$events = array_values(array_filter($rows['events'], fn ($e) => isset($sceneName[$e['scene_id']])
    && ($keep[$sceneName[$e['scene_id']]] === null || in_array($e['shortname'] ?? '', $keep[$sceneName[$e['scene_id']]], true))));
$eventIds = array_column($events, 'id');
$actions = array_values(array_filter($rows['actions'], fn ($a) => in_array($a['event_id'], $eventIds, true)));
$actionIds = array_column($actions, 'id');
$labels = array_values(array_filter($rows['labels'], fn ($l) => in_array($l['event_id'], $eventIds, true)));
$conditions = array_values(array_filter($rows['conditions'], fn ($c) => in_array($c['event_id'] ?? null, $eventIds, true) || in_array($c['action_id'] ?? null, $actionIds, true)));
$sceneId = array_flip($sceneName);

// Words that only made sense in the demo.
$say = [
    25012 => 'The laboratory is through the east door, and the observation deck is up the ramp.',
    25013 => 'The main corridor, to the south, leads to the crew quarters, the hydroponics bay, the engine room and the marketplace.',
];
$content = [
    'porthole' => '<h3>The view outside</h3><p>From up here you can see a planet\'s day side and its night side at once.</p><p><em>Think about it:</em> a planet turns, so which way does its sunrise line move?</p>',
    'grow-racks' => '<h3>Plants without soil</h3><p>These plants grow with their roots in water. Everything they would take from soil is dissolved in it.</p><p>The ship keeps this water close to neutral, at about <strong>pH 6</strong>, which is what most plants like.</p>',
];
$eventName = array_column($events, 'shortname', 'id');
foreach ($actions as &$a) {
    if (isset($say[$a['id']])) {
        $a['params']['text'] = $say[$a['id']];
    }
    if ($a['type'] === 'infobox' && isset($content[$eventName[$a['event_id']] ?? ''])) {
        $a['params']['content'] = $content[$eventName[$a['event_id']]];
    }
}
unset($a);

// ---- the crew: three more people who help run the ship, each with something to say
$media = $byId($rows['media']);
$extraMedia = [
    ['id' => 60, 'type' => 'image', 'url' => '/scenario-assets/hub/planet-pass.png', 'filename' => 'planet-pass.png', 'scale_x' => 1, 'scale_y' => 1, 'width' => 4096, 'height' => 900, 'priority' => 25],
    ['id' => 61, 'type' => 'image', 'url' => '/scenario-assets/hub/warning-light.png', 'filename' => 'warning-light.png', 'scale_x' => 1, 'scale_y' => 1, 'width' => 160, 'height' => 160, 'priority' => 25],
];
$crew = [
    // name, avatar picture used as a stand-in, scene, x, y, facing, lines
    ['Chief Engineer Okoro', 3, 'engine-room', 760, 980, 'right', ['Mind the coolant pipes, {{QBLPlayerName}}. Orange is hot.', 'If a light on that wall starts blinking, it only means the reactor is thinking. Probably.']],
    ['Botanist Lin', 5, 'hydroponics', 1500, 980, 'left', ['Everything green in here ends up on someone\'s plate, or in their lungs as fresh air.', 'Have a look at the racks. The plants will not mind.']],
    ['Quartermaster Pax', 7, 'marketplace', 520, 990, 'right', ['Welcome to the marketplace. Stars you earn on missions are spent here.', 'The stalls are for new things; the wardrobe is for changing what you already own.']],
];
$characters = array_values(array_filter($rows['characters'], fn ($c) => $c['name'] === 'Captain Vega'));
$placements = [];
foreach ($crew as $i => [$name, $picture, $scene, $x, $y, $facing, $lines]) {
    $n = $i + 2;
    $extraMedia[] = ['id' => 70 + $n, 'type' => 'image', 'url' => "/scenario-assets/platform/avatars/avatar-$picture.png", 'filename' => "crew-$n.png", 'scale_x' => 0.85, 'scale_y' => 0.85, 'priority' => 1, 'params' => ['category' => 'character']];
    $extraMedia[] = ['id' => 80 + $n, 'type' => 'image', 'url' => "/scenario-assets/platform/portraits/avatar-$picture.png", 'filename' => "crew-$n-portrait.png", 'scale_x' => 1, 'scale_y' => 1, 'width' => 320, 'height' => 320, 'priority' => 30, 'params' => ['category' => 'character']];
    $characters[] = ['id' => $n, 'name' => $name, 'media_id' => 70 + $n, 'settings' => ['scale' => 0.85, 'portrait_media_id' => 80 + $n]];
    $eventId = 9000 + $n;
    $events[] = ['id' => $eventId, 'scene_id' => $sceneId[$scene], 'kind' => 'indirect', 'shortname' => 'crew-'.strtolower(explode(' ', $name)[count(explode(' ', $name)) - 1]), 'sequence' => 90, 'overridable' => false, 'block_hotspots' => false, 'audience' => 'player'];
    foreach ($lines as $j => $line) {
        $actions[] = ['id' => $eventId * 10 + $j + 1, 'event_id' => $eventId, 'type' => 'dialogue', 'sequence' => $j + 1, 'blocking' => true, 'params' => ['style' => 'portrait', 'speaker' => 'character', 'character_id' => $n, 'text' => $line]];
    }
    $placements[$scene][] = ['character_id' => $n, 'position_x' => $x, 'position_y' => $y, 'facing' => $facing, 'event_id' => $eventId];
}

// ---- things that go on by themselves
// A warning light in the engine room: shown, hidden, and round again for as long as the player is there.
$blink = 9500;
$events[] = ['id' => $blink, 'scene_id' => $sceneId['engine-room'], 'kind' => 'start', 'shortname' => 'blinking-light', 'sequence' => 90, 'overridable' => false, 'block_hotspots' => false, 'audience' => 'player'];
$actions[] = ['id' => 950001, 'event_id' => $blink, 'type' => 'image_fixed', 'sequence' => 1, 'blocking' => true, 'media_id' => 61, 'params' => ['position_x' => 1480, 'position_y' => 300, 'duration' => 700, 'layer' => 'sorted']];
$actions[] = ['id' => 950002, 'event_id' => $blink, 'type' => 'wait', 'sequence' => 2, 'blocking' => true, 'params' => ['duration' => 900]];
$actions[] = ['id' => 950003, 'event_id' => $blink, 'type' => 'repeat', 'sequence' => 3, 'blocking' => true, 'params' => []];

foreach ($scenes as &$s) {
    $name = $s['shortname'];
    // Keep only what is still in the hub among the things placed in the scene.
    $s['layout']['items'] = array_values(array_filter($s['layout']['items'] ?? [], fn ($p) => $p['item_id'] === 2));
    $s['layout']['characters'] = array_merge(
        array_values(array_filter($s['layout']['characters'] ?? [], fn ($p) => $p['character_id'] === 1)),
        $placements[$name] ?? [],
    );
    if ($name === 'observation-deck') {
        // A planet drifts past now and then: a wide, mostly empty strip scrolling between the stars and the window frame.
        array_splice($s['background_media'], 1, 0, [['media_id' => 60, 'tile' => true, 'display_width' => 2048, 'display_height' => 900, 'scroll_speed_x' => 28]]);
    }
}
unset($s);

// ---- only the media the hub uses
$used = [];
$collect = function ($value) use (&$collect, &$used) {
    foreach (is_array($value) ? $value : [] as $key => $inner) {
        if (in_array($key, ['media_id', 'music_media_id', 'portrait_media_id'], true) && is_int($inner)) {
            $used[$inner] = true;
        } else {
            $collect($inner);
        }
    }
};
$items = array_values(array_filter($rows['items'], fn ($i) => $i['id'] === 2));
$settings = array_intersect_key($rows['scenario']['settings'], array_flip(['spec_version', 'chat_mode', 'move_speed', 'asset_base_url', 'moves', 'music_media_id', 'music_volume']));
$collect([$scenes, $actions, $labels, $items, $characters, $settings]);
$allMedia = $byId(array_merge($rows['media'], $extraMedia));
$hubMedia = array_values(array_filter($allMedia, fn ($m) => isset($used[$m['id']])));

$hub = [
    'scenario' => [
        'id' => 0, 'shortname' => 'starship-hub', 'title' => 'Starship hub',
        'subtitle' => null, 'description' => null, 'start_scene_id' => $sceneId['control-room'],
        'enable_save_session' => true, 'require_login' => false, 'allow_groups' => true, 'max_players' => 30, 'default_language' => 'en-us',
        'settings' => $settings,
    ],
    'media' => $hubMedia,
    'shop_items' => [],
    'variables' => array_values(array_filter($rows['variables'], fn ($v) => $v['variable_name'] === 'learned_dance')),
    'items' => $items,
    'characters' => $characters,
    'scenes' => $scenes,
    'events' => $events,
    'actions' => $actions,
    'conditions' => $conditions,
    'labels' => $labels,
];

$header = <<<'TXT'
<?php

/**
 * The starship hub: the ship without any mission, as rows of the QBL tables. A new scenario
 * can start as a copy of it (the editor asks), so every mission launches from the same ship,
 * and each scenario is then free to change what happens aboard.
 *
 * GENERATED by tools/make-hub.php from scenarios/starship-explorer.zip. Do not edit by hand.
 * Ids here only tie the rows to each other; a copy gets new ones.
 */

return 
TXT;
$export = function ($value, int $depth = 0) use (&$export): string {
    if (! is_array($value)) {
        return var_export($value, true);
    }
    $list = array_is_list($value);
    $parts = [];
    foreach ($value as $key => $inner) {
        $parts[] = ($list ? '' : var_export($key, true).' => ').$export($inner, $depth + 1);
    }
    // One row to a line; the tables themselves are broken up.
    if ($depth < 2 && $parts) {
        $pad = str_repeat('    ', $depth + 1);

        return "[\n$pad".implode(",\n$pad", $parts).",\n".str_repeat('    ', $depth).']';
    }

    return '['.implode(', ', $parts).']';
};
file_put_contents("$data/hub.php", $header.$export($hub).";\n");
printf("hub.php: %d scenes, %d events, %d actions, %d media, %d characters\n", count($scenes), count($events), count($actions), count($hubMedia), count($characters));
