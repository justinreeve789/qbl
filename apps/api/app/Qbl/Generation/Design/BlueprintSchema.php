<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\Art\LibraryCritters;

/**
 * The shape of a mission blueprint: what the language model writes, and all it writes.
 *
 * A blueprint is deliberately higher-level than the scenario JSON. The model decides the story,
 * the places, the people and things, what students do and in what order; it never writes event ids,
 * action sequences, variable names or coordinates. MissionBuilder turns a blueprint into QBL rows
 * with the patterns from docs/src/content/docs/developers/extensions/patterns.md, so whatever the model writes, the result is a
 * scenario the validator accepts and the runtime plays.
 */
final class BlueprintSchema
{
    public const KEY = '^[a-z][a-z0-9_]{1,30}$';

    public const INTERACTIONS = ['talk', 'collect', 'inspect', 'use', 'question', 'experiment', 'team_task'];

    /** Drawn for a character when the mission plays them. */
    public const GESTURES = ['wave', 'point', 'cheer', 'think'];

    /** What a character (or the student) can do in a little scene: see Cutscenes. */
    public const BEATS = ['walk', 'say', 'gesture', 'wait', 'leave', 'fall'];

    /** The controls of an instrument: what students set. */
    public const CONTROLS = ['slider', 'switch', 'wheel'];

    /** How a condition on an instrument's controls compares. */
    public const COMPARE = ['=', '!=', '<', '>', '<=', '>='];

    public const CALLOUT_TONES = ['tip', 'fact', 'warn', 'think'];

    /** Times of day a scene's living sky can show, in order (see packages/shared/src/sky.ts). */
    public const SKY_TIMES = ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];

    /**
     * Lights a scene can have: each a thing drawn and stood in the scene, with a glow over it that moves
     * as it says (`glow`: flicker, fire, glow, blink), in its colour, reaching `radius` pixels, and its
     * usual height with what holds it (`cm`). `at` is where its light is in the picture, if it cannot be
     * found by looking (fractions across and down).
     */
    public const LIGHTS = [
        'lantern' => ['glow' => 'flicker', 'color' => '#ffc46b', 'radius' => 120, 'cm' => 160, 'at' => [0.5, 0.25]],
        'torch' => ['glow' => 'flicker', 'color' => '#ffb050', 'radius' => 110, 'cm' => 150, 'at' => [0.5, 0.12]],
        'campfire' => ['glow' => 'fire', 'color' => '#ff9a40', 'radius' => 180, 'cm' => 70, 'at' => [0.5, 0.55]],
        'candle' => ['glow' => 'flicker', 'color' => '#ffd27a', 'radius' => 60, 'cm' => 30, 'at' => [0.5, 0.15]],
        'lamp' => ['glow' => 'glow', 'color' => '#ffe2a0', 'radius' => 150, 'cm' => 280, 'at' => [0.5, 0.1], 'period' => 6],
        'beacon' => ['glow' => 'blink', 'color' => '#ff4a3a', 'radius' => 70, 'cm' => 110, 'at' => [0.5, 0.1]],
        'crystal' => ['glow' => 'glow', 'color' => '#8ad8ff', 'radius' => 110, 'cm' => 80, 'at' => [0.5, 0.4], 'period' => 4],
        'screen' => ['glow' => 'glow', 'color' => '#7ae0ff', 'radius' => 90, 'cm' => 110, 'at' => [0.5, 0.4], 'period' => 3],
    ];

    /** What can be in the air of a scene. */
    public const ATMOSPHERES = ['fireflies', 'leaves', 'snow', 'rain', 'dust', 'bubbles'];

    /** Gestures a cutscene can ask for: the drawn ones, and moves every figure can do. */
    public const CUTSCENE_GESTURES = ['wave', 'point', 'cheer', 'think', 'jump', 'spin', 'dance'];

    /** How a creature that is only there for life moves through a scene. */
    public const AMBIENT_MOTIONS = ['lands', 'climbs', 'hides', 'walks_by', 'flies_by', 'swims_by', 'drives_by'];

    /** The sounds the game makes itself (packages/shared/src/sounds.ts): no recording needed. */
    public const SOUNDS = ['rain', 'heavy_rain', 'wind', 'river', 'stream', 'waves', 'fire', 'birds', 'crickets', 'thunder', 'car', 'horn', 'hooves', 'bell', 'chime', 'knock', 'door', 'footsteps', 'splash', 'whoosh', 'pop', 'tweet'];

    /** The weather a scene can have, drawn by the game (packages/shared/src/weather.ts). */
    public const WEATHERS = ['rain', 'snow', 'storm', 'blizzard', 'fog'];

    /** How heavy weather is, as the game's intensity (0 to 1). */
    public const INTENSITY = ['light' => 0.35, 'steady' => 0.6, 'heavy' => 0.9];

    /** Water that flows in a scene, drawn by the game behind the painted banks. */
    public const WATERS = ['river', 'stream', 'waterfall', 'sea', 'lake', 'pond'];

    /** Where a scene's water lies: across the front of the floor, across its back, in its middle (a pond, a lake). */
    public const WATER_PLACES = ['front', 'back', 'middle'];

    /** Scene kinds that weather falls on, and that can have water in their floor. */
    public const WEATHER_KINDS = ['outdoor', 'up_high'];

    public const WATER_KINDS = ['outdoor', 'underground'];

    public const FOREGROUND_PLACES = ['bottom', 'left', 'right'];

    public const WIDTHS = ['normal', 'wide'];

    public const ITEM_KINDS = ['collectible', 'tool', 'evidence', 'prop', 'vehicle'];

    public const EDGES = ['left', 'right', 'top', 'bottom'];

    /** A scene's weather: drawn by the game over the scene, with its own sound. */
    public static function weatherSchema(): array
    {
        return ['type' => 'object', 'required' => ['kind'], 'description' => 'Optional, for outdoor and up_high scenes: the weather, drawn by the game over the scene, with its own sound: rain splashing on the ground, snow, a storm (heavy rain blown by the wind, the light going, lightning and thunder), a blizzard, fog drifting by. Only where the story calls for it; most scenes have none.', 'properties' => [
            'kind' => ['type' => 'string', 'enum' => self::WEATHERS],
            'intensity' => ['type' => 'string', 'enum' => array_keys(self::INTENSITY)],
        ]];
    }

    /** Water that flows in a scene: painted out of the background and animated by the game. */
    public static function waterSchema(): array
    {
        return ['type' => 'object', 'required' => ['kind', 'where', 'look'], 'description' => 'Optional, for outdoor (and underground) scenes: water that moves, drawn by the game: a river or stream flowing across the front or the back of the floor, a pond or lake lying in its middle, a waterfall pouring down at the back into a pool, the sea along the back. The background is painted around it (its banks, its shore), and the game makes the water itself flow, ripple and glint, with its sound. Nobody walks on it.', 'properties' => [
            'kind' => ['type' => 'string', 'enum' => self::WATERS],
            'where' => ['type' => 'string', 'enum' => self::WATER_PLACES, 'description' => 'front: across the front of the floor, nearest the viewer (characters stand behind it). back: across the back of the floor, between it and the scenery (the sea, a river beyond the path). middle: lying in the floor where x says (a pond, a lake). A waterfall is always at the back, where x says.'],
            'x' => ['type' => 'number', 'minimum' => 0.2, 'maximum' => 0.8, 'description' => 'middle and waterfall: where its middle is, across the scene.'],
            'width' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.5, 'description' => 'middle and waterfall: how wide it is, as a share of the scene.'],
            'flows' => ['type' => 'string', 'enum' => ['left', 'right'], 'description' => 'A river or stream: which way it flows. Default right.'],
            'look' => self::text('Its banks or shore and what is around the water: "low grassy banks with reeds and a few flat stepping stones", "a rocky cliff with ferns, the water falling into a round pool".', 200),
            'color' => ['type' => 'string', 'pattern' => '^#[0-9a-fA-F]{6}$', 'description' => 'Optional: the water\'s colour, if not a clear blue (a muddy brown river, a green pond).'],
        ]];
    }

    private static function text(string $d, int $max = 400): array
    {
        return ['type' => 'string', 'description' => $d, 'maxLength' => $max];
    }

    public static function schema(array $limits): array
    {
        $key = ['type' => 'string', 'pattern' => self::KEY];
        $text = fn (string $d, int $max = 400) => ['type' => 'string', 'description' => $d, 'maxLength' => $max];
        $line = ['type' => 'object', 'required' => ['speaker', 'text'], 'properties' => [
            'speaker' => ['type' => 'string', 'description' => 'A character key, or "player" for the student\'s own reply.'],
            'text' => $text('What is said. At most 200 characters. {{QL_PlayerName}} is the student\'s name.', 200),
        ]];
        $award = ['type' => 'object', 'required' => ['stars', 'xp', 'note'], 'properties' => [
            'stars' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 10],
            'xp' => ['type' => 'integer', 'minimum' => 0, 'maximum' => 50],
            'note' => $text('Two to four words shown with it: "Sample collected".', 40),
        ]];
        $cutscene = ['type' => 'array', 'maxItems' => 8, 'description' => 'Optional: a little scene played right after this, for everyone in the scene, so the place reacts to what students did: the characters (or the student) walk somewhere, say something, make a gesture, wait, or leave. Things happen in order. Use them to show cause and effect: the gate creaks open and the keeper strolls through it; the robot zooms over to the fixed pump and does a happy spin; the heron, startled, flaps off.', 'items' => [
            'type' => 'object', 'required' => ['who', 'do'],
            'properties' => [
                'who' => ['type' => 'string', 'description' => 'A character key of a character in this scene, or "player" for the student.'],
                'do' => ['type' => 'string', 'enum' => self::BEATS, 'description' => 'walk: to x. say: a line in a speech bubble (text). gesture: wave, point, cheer, think (drawn for them when asked), or jump, spin, dance. wait: seconds. leave: walk off the left or right edge and be gone for good (not the guide, and not someone students still need). fall: they slip out of sight (off a cliff, into a crevasse, swept off by the river), crying out (text), after walking to x if given; an interaction that rescues them must bring them back. Not the guide.'],
                'x' => ['type' => 'number', 'minimum' => 0.08, 'maximum' => 0.92, 'description' => 'walk: where to, across the scene. fall: where they go over.'],
                'text' => $text('say: what they say; fall: what they cry out. At most 120 characters.', 120),
                'gesture' => ['type' => 'string', 'enum' => self::CUTSCENE_GESTURES],
                'seconds' => ['type' => 'number', 'minimum' => 0.5, 'maximum' => 6],
                'edge' => ['type' => 'string', 'enum' => ['left', 'right'], 'description' => 'leave: which way they go.'],
            ],
        ]];
        $controlCondition = ['type' => 'object', 'required' => ['control', 'op', 'value'], 'properties' => [
            'control' => $key,
            'op' => ['type' => 'string', 'enum' => self::COMPARE],
            'value' => ['type' => ['number', 'string'], 'description' => 'A number for a slider, 1 or 0 for a switch (on/off), an option for a wheel.'],
        ]];
        $instrument = ['type' => 'object', 'required' => ['controls', 'goal', 'test', 'success'], 'description' => 'experiment: a hands-on instrument students work with, its controls side by side on one panel: sliders to set a number (no typing), switches, a wheel of chance to spin. What it shows changes at once as they move the controls (shows), and they press the test button to try it. Make it fit the scene and the learning: a pulley with a slider for the rope and one for the wheels, a circuit board of switches with a bulb that lights, a mixing desk for paint colours, a wheel of chance for which way the wind blows a seed.', 'properties' => [
            'controls' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => ['type' => 'object', 'required' => ['key', 'kind', 'label'], 'properties' => [
                'key' => $key,
                'kind' => ['type' => 'string', 'enum' => self::CONTROLS, 'description' => 'slider: a number from min to max in steps. switch: on (1) or off (0). wheel: spun, lands on one of its options at random (repeat an option to make it likelier).'],
                'label' => $text('"Rope length", "Battery", "Wind".', 30),
                'min' => ['type' => 'number'], 'max' => ['type' => 'number'], 'step' => ['type' => 'number'], 'start' => ['type' => 'number'],
                'unit' => $text('slider: shown after the number ("cm", "°C"), or empty.', 10),
                'options' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 10, 'items' => $text('An option on the wheel.', 20)],
            ]]],
            'shows' => ['type' => 'array', 'maxItems' => 8, 'description' => 'What the instrument shows while its controls are set a certain way, at once, before testing: "💡 The bulb glows dimly" while one battery is on; "The water is boiling!" above 100 °C. Make cause and effect visible; never give the goal away outright.', 'items' => ['type' => 'object', 'required' => ['when', 'text'], 'properties' => [
                'when' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 4, 'items' => $controlCondition],
                'text' => $text('Short, one line, may start with an emoji.', 120),
            ]]],
            'meters' => ['type' => 'array', 'maxItems' => 3, 'description' => 'Bars that show a slider\'s value at a glance.', 'items' => ['type' => 'object', 'required' => ['control', 'label'], 'properties' => [
                'control' => $key,
                'label' => $text('"Rope out", "Heat".', 30),
            ]]],
            'goal' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $controlCondition, 'description' => 'When the test succeeds: all of these hold. Use ranges (>= and <=) for sliders where a range makes sense.'],
            'test' => $text('The test button: "Lift!", "Close the circuit", "Mix it".', 30),
            'misses' => ['type' => 'array', 'maxItems' => 4, 'description' => 'What testing tells students when it fails, for the commonest wrong settings: a nudge with a reason, not the answer.', 'items' => ['type' => 'object', 'required' => ['when', 'text'], 'properties' => [
                'when' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 4, 'items' => $controlCondition],
                'text' => $text('"The rope slips: with one wheel you would need to pull Mo\'s whole weight."', 200),
            ]]],
            'success' => $text('Explanation shown when it works.', 500),
            'objective' => ['type' => 'string'],
        ]];

        return [
            'type' => 'object',
            'required' => ['title', 'subtitle', 'description', 'story', 'start_scene', 'scenes', 'characters', 'items', 'interactions', 'steps', 'twists', 'intro', 'completion'],
            'properties' => [
                'title' => $text('Mission title, at most 6 words.', 60),
                'subtitle' => $text('One line under the title that says what students will do.', 140),
                'description' => $text('For the teacher: what the mission is about, what students do, and what they learn. 2-4 sentences.', 800),
                'story' => ['type' => 'object', 'required' => ['premise', 'player_role', 'resolution'], 'properties' => [
                    'premise' => $text('The situation that needs solving.', 600),
                    'player_role' => $text('Who the students are in the story (they are always space explorers from the starship).', 200),
                    'resolution' => $text('How the mission ends when they succeed.', 400),
                ]],
                'art_direction' => ['type' => 'object', 'properties' => [
                    'setting' => $text('Where this happens, visually: biome, era, architecture, recurring motifs. Must work in the house art style.', 400),
                    'accent_colors' => ['type' => 'array', 'maxItems' => 3, 'description' => 'Up to 3 accent colours for this mission, as #rrggbb, chosen to sit inside the house palette.', 'items' => ['type' => 'string', 'pattern' => '^#[0-9a-fA-F]{6}$']],
                    'time_of_day' => ['type' => 'string', 'enum' => ['morning', 'midday', 'golden hour', 'dusk', 'night', 'indoor lighting']],
                ]],
                'start_scene' => $key,
                'scenes' => ['type' => 'array', 'minItems' => 2, 'maxItems' => $limits['max_scenes'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'title', 'background', 'ground_line', 'exits'],
                    'properties' => [
                        'key' => $key,
                        'title' => $text('Name shown when students arrive: "Wilting Marsh".', 40),
                        'description' => $text('For the teacher: what happens here.', 300),
                        'kind' => ['type' => 'string', 'enum' => Sizes::SCENE_KINDS, 'description' => 'outdoor; indoor (inside a building, a ship, a lab: there is a back wall); underground (a cave, a burrow, a cellar); up_high (a rooftop, a treetop, a cliff ledge); underwater. Vary them: a mission that only ever walks along one street is dull.'],
                        'background' => $text('What the background picture shows, as a side-on view: the place, its landmarks and the objects that are part of the scenery, left to right. Things in it are at real sizes beside a 130 cm child (a door is taller than them, a house many times taller): describe them as seen from a few metres away. No characters or people. Do not describe the art style; that is added for you. Do not describe doors, holes or ladders that are exits: they are drawn for you where the exits say. With distance: only what is near (the far view is its own picture).', 700),
                        'ground_line' => ['type' => 'number', 'minimum' => 0.55, 'maximum' => 0.8, 'description' => 'Where the walkable floor begins, as a fraction of the picture height from the top. Everything below it is floor students walk on.'],
                        'width' => ['type' => 'string', 'enum' => self::WIDTHS, 'description' => 'normal (default): a little wider than the screen. wide: a long place students walk along while the view follows them (a street, a riverbank, a long hall): about one and a half times as long. Use wide for one or two scenes where a journey fits.'],
                        'distance' => $text('Optional, for outdoor, up_high and underwater scenes: what is seen far away behind the place (the sky and clouds, far hills, a city skyline, a moon). It is drawn as a picture of its own that drifts slower than the scene as students walk, for depth. Best in wide scenes.', 300),
                        'foreground' => ['type' => 'object', 'required' => ['look', 'where'], 'description' => 'Optional: something big and close to the viewer that students walk behind, for depth: the top of a wall we peer over, the edge of a crate, a fern, a rock, part of a market stall. Use it in one or two scenes, where it fits the place.', 'properties' => [
                            'look' => $text('What it is, as one object: "the top of an old stone wall with moss on it".', 200),
                            'where' => ['type' => 'string', 'enum' => self::FOREGROUND_PLACES, 'description' => 'bottom: a low strip along the bottom edge (a wall top). left or right: a piece in that bottom corner (a fern, a crate, a lamp post).'],
                        ]],
                        'floor' => ['type' => 'object', 'description' => 'Optional: where students can walk, when it is not the whole floor. Make it match the place: a room ends at its walls, a ledge ends at the drop, a pond in the middle of a garden is walked around.', 'properties' => [
                            'left' => ['type' => 'number', 'minimum' => 0, 'maximum' => 0.4, 'description' => 'Where the walkable floor starts from the left (0: at the edge). Not with an exit on the left edge.'],
                            'right' => ['type' => 'number', 'minimum' => 0.6, 'maximum' => 1, 'description' => 'Where it ends on the right (1: at the edge). Not with an exit on the right edge.'],
                            'blocked' => ['type' => 'array', 'maxItems' => 2, 'items' => ['type' => 'object', 'required' => ['x', 'width', 'what'], 'properties' => [
                                'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85, 'description' => 'Its middle, across the scene.'],
                                'width' => ['type' => 'number', 'minimum' => 0.05, 'maximum' => 0.22],
                                'what' => $text('Something lying in the floor that students walk around, painted into the background there: "a small round pond with lily pads", "a crack in the ice", "a flower bed".', 160),
                            ]]],
                        ]],
                        'arrival' => ['type' => 'object', 'description' => 'Optional: what happens the first time students arrive here, for everyone there: a tense moment (a character slips off the cliff the moment you arrive, a bridge cracks, an alarm goes off) or a surprise. Played once.', 'properties' => [
                            'title' => $text('Shown big: "Look out!"', 40),
                            'dialogue' => ['type' => 'array', 'maxItems' => 4, 'items' => $line],
                            'cutscene' => $cutscene,
                        ]],
                        'details' => ['type' => 'array', 'maxItems' => 5, 'description' => 'Things in the scene students can click to read about, painted into the background: colour, jokes, red herrings, small clues. They are only looked at, never picked up or counted.', 'items' => ['type' => 'object', 'required' => ['x', 'label', 'look', 'text'], 'properties' => [
                            'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9],
                            'label' => $text('Its name: "Old boot".', 30),
                            'look' => $text('What is painted there: "a muddy old boot with a flower growing out of it".', 160),
                            'text' => $text('What the student notices, as their own thought: "Someone lost a boot. Something is growing in it!"', 160),
                            'placement' => ['type' => 'string', 'enum' => ['back', 'ground']],
                        ]]],
                        'ambient' => ['type' => 'array', 'maxItems' => 3, 'description' => 'Optional: a little life that has nothing to do with the lesson, coming and going now and then on each student\'s screen: birds that land, peck about and fly off; a squirrel that darts about and runs up a tree; a rabbit that pops out of a bush, sits twitching its nose and hops into another; a cat that strolls by; fish that swim past; a car driving by. Shy animals scatter early when anyone comes near (birds take off, the squirrel bolts up its tree, the rabbit dives into the nearest bush). One or two in most outdoor scenes.', 'items' => [
                            'type' => 'object', 'required' => ['key', 'look', 'motion', 'size_cm'],
                            'properties' => [
                                'key' => $key,
                                'look' => $text('What it looks like: "a small round blue bird with an orange beak".', 160),
                                'motion' => ['type' => 'string', 'enum' => self::AMBIENT_MOTIONS, 'description' => 'lands: flies in, lands on the floor, hops and pecks, flies off (birds; count for a little flock). climbs: scampers in, darts about, runs up one of the scene\'s trees out of sight (a squirrel: the background must have a tree standing out on the floor). hides: pops out of one bush, sits a while twitching its nose, hops into another (a rabbit, a hedgehog: the background must have two or more bushes standing out on the floor). walks_by: walks across the floor. flies_by: flies across the sky. swims_by: swims across (underwater). drives_by: a vehicle (a car, a cart, a bus, a tractor, a horse and cart) drives across the back of the floor, outdoors.'],
                                'size_cm' => ['type' => 'integer', 'minimum' => 5, 'maximum' => 900, 'description' => 'Its real longest side: a sparrow 15, a cat 45, a car 420, a bus 900.'],
                                'library' => ['type' => 'string', 'enum' => array_keys(LibraryCritters::CATALOGUE), 'description' => 'Optional, and best when one fits: a ready-made animal or vehicle from the asset library, already animated, used instead of drawing one (look is then only a note). Only with a motion it suits: '.str_replace("\n", '; ', LibraryCritters::described())],
                                'count' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 5, 'description' => 'lands: how many come together (a little flock). Default 1.'],
                                'shy' => ['type' => 'boolean', 'description' => 'Default true for animals: it scatters when anyone comes near. false: it does not care (a tame hen, a cat).'],
                                'sound' => ['type' => 'string', 'enum' => self::SOUNDS, 'description' => 'Optional: the sound it makes as it passes (car, hooves, tweet...).'],
                            ],
                        ]],
                        'sky' => ['type' => 'object', 'required' => ['time'], 'description' => 'Outdoor and up_high scenes: a living sky behind the scene, drawn by the game, with the sun or the moon and stars, and clouds drifting by. It can change slowly while students are there: a sunset passing through gold, orange, pink and purple into a starry dusk; a dawn. Most outdoor scenes have one; choose the time from the story.', 'properties' => [
                            'time' => ['type' => 'string', 'enum' => self::SKY_TIMES, 'description' => 'The time of day when students arrive.'],
                            'until' => ['type' => 'string', 'enum' => self::SKY_TIMES, 'description' => 'Optional: what it slowly becomes over about ten minutes, and then stays (afternoon until dusk: a sunset).'],
                            'clouds' => ['type' => 'string', 'enum' => ['none', 'few', 'many']],
                        ]],
                        'lights' => ['type' => 'array', 'maxItems' => 4, 'description' => 'Optional: lights that glow and move, where the place has them: lanterns and torches that flicker at night, a campfire with embers rising, a crashed ship\'s beacon still blinking, glowing crystals in a cave, a lab screen. Each is drawn and stood in the scene, with its glow over it; they shine fully in the dark and only a little by day.', 'items' => [
                            'type' => 'object', 'required' => ['x', 'kind', 'look'],
                            'properties' => [
                                'x' => ['type' => 'number', 'minimum' => 0.05, 'maximum' => 0.95],
                                'kind' => ['type' => 'string', 'enum' => array_keys(self::LIGHTS), 'description' => 'lantern, torch, candle (flicker); campfire (flickers, embers rise); lamp, crystal, screen (glow, breathing slowly); beacon (blinks on and off).'],
                                'look' => $text('What it looks like, with what holds it: "an iron lantern hanging from a wooden post", "a red warning beacon on a bent antenna sticking out of the wreck".', 160),
                                'placement' => ['type' => 'string', 'enum' => ['ground', 'back', 'wall'], 'description' => 'ground: out on the floor. back: at the back of the floor. wall: hung on the back wall (indoors, underground).'],
                                'color' => ['type' => 'string', 'pattern' => '^#[0-9a-fA-F]{6}$', 'description' => 'Optional: its light\'s colour, if not the usual for its kind.'],
                                'height_cm' => ['type' => 'integer', 'minimum' => 10, 'maximum' => 600, 'description' => 'Optional: how tall it is, with what holds it.'],
                                'on_after' => ['type' => 'string', 'pattern' => self::KEY, 'description' => 'Optional: the key of an interaction, combination, step or twist. The light is out until that is done (or has happened), then comes on: the beacon once the ship\'s power is fixed, the lighthouse lamp once it is relit, the lamps when the generator starts. Its fixture is there all along, unlit.'],
                                'off_after' => ['type' => 'string', 'pattern' => self::KEY, 'description' => 'Optional: the key of an interaction, combination, twist, or a step with a single interaction. The light shines until that is done (or has happened), then goes out: the campfire put out by the storm, the alarm light once the leak is fixed.'],
                            ],
                        ]],
                        'atmosphere' => ['type' => 'array', 'maxItems' => 2, 'description' => 'Optional: what is in the air: fireflies at dusk, leaves falling in an autumn wood, snow, rain, dust floating in a sunbeam in an old barn, bubbles rising under water.', 'items' => [
                            'type' => 'object', 'required' => ['kind'],
                            'properties' => [
                                'kind' => ['type' => 'string', 'enum' => self::ATMOSPHERES],
                                'amount' => ['type' => 'string', 'enum' => ['few', 'some', 'many']],
                            ],
                        ]],
                        'weather' => self::weatherSchema(),
                        'water' => self::waterSchema(),
                        'indoor' => ['type' => 'boolean', 'description' => 'Older field: the same as kind "indoor".'],
                        'exits' => ['type' => 'array', 'maxItems' => 4, 'items' => [
                            'type' => 'object', 'required' => ['to'],
                            'properties' => [
                                'to' => $key,
                                'via' => ['type' => 'string', 'enum' => Connections::VIAS, 'description' => 'How students get there. edge (default): walk off an edge of the scene. Or a passage that stands IN the scene where x says: door, gate, cave (a cave mouth), portal, tunnel, ladder or stairs_up (up to somewhere higher), or hole, hatch or stairs_down (in the floor: down to somewhere lower). Use a passage when it fits the story: going into a building is a door, exploring underground starts with a hole or a hatch, a treetop is up a ladder.'],
                                'edge' => ['type' => 'string', 'enum' => self::EDGES, 'description' => 'For via edge: which edge students walk off. top = towards the back, bottom = towards the viewer. Each edge leads to at most one scene.'],
                                'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85, 'description' => 'For a passage: where it is across the scene.'],
                                'look' => $text('For a passage: what it looks like, as one object: "a crooked round blue door in the bakery wall", "a dark hole between tree roots". No text or signs.', 200),
                                'label' => $text('For a passage: the button over it, at most 5 words: "Enter the bakery", "Jump into the hole!".', 40),
                                'back' => ['type' => 'object', 'description' => 'For a passage, optional: the way back in the other scene. Default: out of a door, gate, cave or tunnel towards the viewer (the bottom edge); back up a ladder from a hole or hatch; back down a hatch from a ladder; the same kind of portal or stairs.', 'properties' => [
                                    'via' => ['type' => 'string', 'enum' => Connections::VIAS],
                                    'edge' => ['type' => 'string', 'enum' => self::EDGES],
                                    'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85],
                                    'look' => $text('What it looks like.', 200),
                                ]],
                                'requires' => ['type' => 'string', 'description' => 'Optional: the key of one interaction, step or twist that must be done (or happen) before this way opens.'],
                                'locked_message' => $text('Shown while it is still closed.', 160),
                            ],
                        ]],
                        'props' => ['type' => 'array', 'maxItems' => 4, 'items' => ['type' => 'object', 'required' => ['item', 'x'], 'properties' => [
                            'item' => $key,
                            'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9],
                        ]]],
                    ],
                ]],
                'characters' => ['type' => 'array', 'minItems' => 1, 'maxItems' => $limits['max_characters'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'role', 'appearance', 'personality', 'scene', 'x', 'height_cm'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'role' => $text('Their part in the story.', 200),
                        'appearance' => $text('Only what they look like: species or kind of being, body shape, height relative to a child, clothing, colours (name 3-4 main colours), one or two distinctive features. Full body. Friendly and appropriate for children. No text or logos on clothing.', 500),
                        'height_cm' => ['type' => 'integer', 'minimum' => 30, 'maximum' => 260, 'description' => 'How tall they are, beside 130 cm child explorers: an adult 165-185, a grandparent 160, a small robot 70, a dog 60, a tall alien 220. They are drawn to that size.'],
                        'personality' => $text('How they talk and behave, in a few words.', 200),
                        'voice' => ['type' => 'object', 'description' => 'What they sound like, to choose the voice their lines are recorded in. Cast it like a cartoon: voices are theatrical and larger than life, and no two characters should sound alike.', 'properties' => [
                            'gender' => ['type' => 'string', 'enum' => ['female', 'male', 'neutral'], 'description' => 'neutral for a robot, a computer or a creature that is neither.'],
                            'age' => ['type' => 'string', 'enum' => ['child', 'young', 'adult', 'elder']],
                            'accent' => ['type' => 'string', 'enum' => ['American', 'British'], 'description' => 'Only when it matters to the character.'],
                            'sound' => $text('A few vivid words on how the voice sounds and what kind of voice it is: booming giant, squeaky pixie, jolly, mischievous imp, grand wizard, theatrical, regal and haughty, zany inventor, gruff pirate, spooky whisper, sly, bubbly, heroic, chirpy robot, otherworldly alien. Plain words (warm, calm, clear) only for a character who should sound ordinary.', 120),
                        ]],
                        'guide' => ['type' => 'boolean', 'description' => 'True for the one character who briefs the students and receives the final report.'],
                        'scene' => $key,
                        'x' => ['type' => 'number', 'minimum' => 0.12, 'maximum' => 0.88, 'description' => 'Where they stand, as a fraction of the scene width.'],
                        'gestures' => ['type' => 'array', 'maxItems' => 2, 'items' => ['type' => 'string', 'enum' => self::GESTURES], 'description' => 'Drawn animations besides idle and walk (every character gets those).'],
                        'walks' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 4, 'items' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9], 'description' => 'Optional: spots across the scene they stroll between on their own, stopping at each for a while (a gardener tending rows, a guard on patrol, a shopkeeper). Students click them wherever they are. Never the guide.'],
                        'wanders' => ['type' => 'boolean', 'description' => 'Older field: paces a little either side of their spot. Prefer walks.'],
                        'chatter' => ['type' => 'array', 'maxItems' => 3, 'items' => $text('Something they say to themselves now and then, in a speech bubble: a hint, a joke, a bit of local colour. At most 80 characters.', 80)],
                    ],
                ]],
                'items' => ['type' => 'array', 'maxItems' => $limits['max_items'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'kind', 'appearance', 'size_cm'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'kind' => ['type' => 'string', 'enum' => self::ITEM_KINDS, 'description' => 'collectible/tool/evidence: a thing students can pick up into their bag (collect, or given by an interaction), or that an interaction shows. prop: scenery that stands in a scene (blocks walking), or what a use is done on. vehicle: something students can ride.'],
                        'appearance' => $text('Only what it looks like, as a single object: shape, material, colours, details. No text.', 400),
                        'description' => $text('For a thing students carry: what they read when they point at it in their bag, one short sentence ("A coil of strong rope, long enough to reach the top of a tree").', 140),
                        'size_cm' => ['type' => 'integer', 'minimum' => 2, 'maximum' => 1200, 'description' => 'Its real longest side in centimetres: a pollen vial 12, a book 25, a toolbox 50, a crate 70, a barrel 100, a console 140, a door 210, a tree 600. A child explorer is 130. It is drawn to that scale.'],
                        'size' => ['type' => 'string', 'enum' => ['small', 'medium', 'large'], 'description' => 'Older field, used only without size_cm.'],
                    ],
                ]],
                'interactions' => ['type' => 'array', 'minItems' => 3, 'maxItems' => 30, 'items' => [
                    'type' => 'object', 'required' => ['key', 'type', 'scene', 'label'],
                    'properties' => [
                        'key' => $key,
                        'type' => ['type' => 'string', 'enum' => self::INTERACTIONS, 'description' => 'talk: a conversation with a character. collect: pick up a thing into the bag; only things that will be used (every thing in the bag must help solve the mission). inspect: look closely at something and learn from it (it can turn out to matter, or hand something over). use: use a thing from the bag on something in the scene, or give it to a character (the puzzle of a point-and-click adventure). question: a multiple-choice question that checks understanding. experiment: a hands-on instrument with controls side by side (instrument). team_task: something that needs several students to each do their part (e.g. three crew members each turn a valve).'],
                        'scene' => $key,
                        'label' => $text('Short text shown over it: "Collect a sample", "Talk to Dr. Ren".', 40),
                        'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9, 'description' => 'Where it is, as a fraction of the scene width. Not needed for talk (it is where the character stands).'],
                        'placement' => ['type' => 'string', 'enum' => Sizes::PLACEMENTS, 'description' => 'Where its item is: ground (lying or standing on the floor students walk on: a rock sample, a footprint, a dropped tool), back (standing against the back where the floor meets the scenery: machines, consoles, big plants), surface (small things, on a table, bench or flat rock that is added for you), wall (mounted on the back wall: a map, a switch, a gauge; only in indoor and underground scenes). Default: by its size.'],
                        'look' => $text('For an interaction with no item: what students look at there, painted into the background at that spot ("a crack in the cave wall", "the old well"). A small question mark marks it.', 160),
                        'hidden' => ['type' => 'boolean', 'description' => 'True for a discovery that only appears when a student walks close to it: a clue in the shadows, a fossil in the dirt. Use one or two per mission for students who explore.'],
                        'quiet' => ['type' => 'boolean', 'description' => 'inspect: no question mark over it, only its name when students come near or point at it, like the scene\'s details: for a thing that looks like nothing much but turns out to matter (the scarecrow\'s coat hides the key).'],
                        'resolves' => ['type' => 'string', 'description' => 'Optional: the key of a twist this sets right (it clears the way the twist blocked).'],
                        'character' => ['type' => 'string', 'description' => 'talk: the character key. use: the character the thing is given to (instead of a spot in the scene).'],
                        'item' => ['type' => 'string', 'description' => 'collect: the item picked up (it goes into the bag). inspect/experiment/team_task: the item drawn there (optional). use: what the thing is used on, drawn there (a prop: a locked chest, a rusty gate; optional: without it, look says what is painted there).'],
                        'uses' => ['type' => 'string', 'description' => 'use: the key of the thing from the bag that is used (collected, given or made earlier).'],
                        'keeps' => ['type' => 'boolean', 'description' => 'use: true when the thing stays in the bag afterwards (a torch, a magnifier); otherwise it is used up or handed over.'],
                        'gives' => ['type' => 'string', 'description' => 'Optional, for any interaction but collect: the key of a thing that goes into the bag when it is done (the keeper gives a key, the chest holds a map).'],
                        'hint' => $text('use: what clicking it without the right thing says: what is wrong, and a nudge towards what would help ("The latch is rusted solid. Something slippery might loosen it."). For a character, what they say they need.', 200),
                        'rescues' => ['type' => 'string', 'description' => 'Optional: the key of a character this saves after they fell (a fall in a cutscene, often on arriving in the scene). It shows only while they are in trouble, and they are back once it is done. Its item is best a picture of them in trouble ("Mo clinging to a root below the edge").'],
                        'cutscene' => $cutscene,
                        'requires' => ['type' => 'array', 'maxItems' => 3, 'items' => $key, 'description' => 'Keys of interactions, combinations, steps or twists that must be done (or have happened) first. A use needs no requirement for its thing: it is there once the thing is in the bag.'],
                        'locked_hint' => $text('Optional: shown when clicked before it is available. Only used when requires has one key.', 160),
                        'after' => ['type' => 'string', 'description' => 'question only: the key of an interaction right after which this question pops up by itself (it can also be reopened by clicking it).'],
                        'at_report' => ['type' => 'boolean', 'description' => 'question only: asked by the guide in the final debrief, when the crew reports back, instead of standing in a scene. Its scene is the guide\'s; no x. Never listed in steps.'],
                        'dialogue' => ['type' => 'array', 'maxItems' => 8, 'items' => $line, 'description' => 'talk: the conversation, in order. use: what is said once the thing has been used or given. Other types: optional lines a character says first.'],
                        'info' => ['type' => 'object', 'required' => ['title', 'body'], 'properties' => [
                            'title' => $text('Heading.', 60),
                            'body' => $text('What the student observes or learns: concrete, accurate, at the grade level. Up to 3 short paragraphs separated by blank lines.', 900),
                            'picture' => ['type' => 'string', 'description' => 'Optional: an item key whose picture is shown large at the top.'],
                            'callout' => ['type' => 'object', 'required' => ['tone', 'text'], 'description' => 'Optional: a coloured note under the text.', 'properties' => [
                                'tone' => ['type' => 'string', 'enum' => self::CALLOUT_TONES, 'description' => 'tip, fact (did you know), warn (careful), think (something to wonder about).'],
                                'text' => $text('One or two sentences.', 240),
                            ]],
                            'cards' => ['type' => 'array', 'maxItems' => 4, 'description' => 'Optional: flip cards students turn over: a word and what it means, a question and its answer.', 'items' => ['type' => 'object', 'required' => ['front', 'back'], 'properties' => [
                                'front' => $text('Front.', 80),
                                'back' => $text('Back.', 200),
                            ]]],
                            'reveal' => ['type' => 'object', 'required' => ['prompt', 'text'], 'description' => 'Optional: a card that opens: a question to think about before seeing the answer.', 'properties' => [
                                'prompt' => $text('"Why do you think…?"', 120),
                                'text' => $text('What it shows when opened.', 300),
                            ]],
                        ]],
                        'question' => ['type' => 'object', 'required' => ['prompt', 'choices', 'objective'], 'properties' => [
                            'prompt' => $text('The question.', 300),
                            'choices' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 4, 'items' => ['type' => 'object', 'required' => ['text', 'correct', 'feedback'], 'properties' => [
                                'text' => $text('The answer as a button label.', 80),
                                'correct' => ['type' => 'boolean', 'description' => 'For a predict question: false for all.'],
                                'feedback' => $text('Explanation shown after choosing it; for a wrong answer, explain the misconception without giving the answer away.', 400),
                            ]]],
                            'purpose' => ['type' => 'string', 'enum' => ['check', 'predict'], 'description' => 'check (default): has one right answer and is scored. predict: asks students to commit to a prediction before they find out (every answer is accepted and recorded, nothing is right or wrong yet); follow it with the experiment or inspection that shows the answer.'],
                            'objective' => ['type' => 'string', 'description' => 'The learning objective id it checks (LO1...).'],
                            'standards' => ['type' => 'array', 'items' => ['type' => 'string'], 'description' => 'Standard codes it gives evidence for.'],
                        ]],
                        'instrument' => $instrument,
                        'team' => ['type' => 'object', 'required' => ['needed', 'part', 'success'], 'properties' => [
                            'needed' => ['type' => 'integer', 'minimum' => 2, 'maximum' => 6, 'description' => 'How many different students must each do their part.'],
                            'part' => $text('What one student does: "turns a valve".', 160),
                            'success' => $text('Shown to everyone in the scene when the team is done.', 200),
                        ]],
                        'award' => $award,
                    ],
                ]],
                'combinations' => ['type' => 'array', 'maxItems' => 3, 'description' => 'Optional: two things from the bag that students put together to make a third (a rope and a hook make a grappling hook; a lens and a tube make a telescope). The two are used up and the new one goes into the bag. The making should make sense, and teach something where it can.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'items', 'makes', 'text'],
                    'properties' => [
                        'key' => $key,
                        'items' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 2, 'items' => $key, 'description' => 'The two item keys.'],
                        'makes' => $key,
                        'text' => $text('Shown when they are put together: "You tie the hook to the rope: a grappling hook!"', 160),
                    ],
                ]],
                'twists' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 2, 'description' => 'One or two twists or turns that change the situation part-way: a twist makes things harder (fog hides the landmarks, the labels were swapped), a turn changes luck or a heart (a gust knocks down just the branch needed, a grumpy keeper becomes a friend). Each should teach something: what students learn about the topic by dealing with it. At least one is invented for this mission.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'after', 'title', 'dialogue', 'invented'],
                    'properties' => [
                        'key' => $key,
                        'invented' => ['type' => 'boolean', 'description' => 'true for a twist you invented for this mission, out of its place, its story and its topic (not one of the ideas you were given). At least one twist is invented.'],
                        'after' => ['type' => 'string', 'description' => 'The interaction or step key right after which it happens (not a combination).'],
                        'title' => $text('Flashed big across the screen, at most 5 words: "RUMBLE! The ground shakes!"', 50),
                        'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 4, 'items' => $line, 'description' => 'Characters react and say what it means (they can speak from anywhere, over the radio).'],
                        'cutscene' => $cutscene,
                        'notice' => $text('One line for crew members who were elsewhere when it happened: "A rockslide has blocked the canyon path!"', 160),
                        'blocks' => ['type' => 'object', 'required' => ['to'], 'description' => 'Optional: it closes the way from the scene where it happens to another scene until it is set right.', 'properties' => [
                            'to' => $key,
                            'message' => $text('Shown when students try that way while it is closed.', 160),
                        ]],
                        'obstacle' => ['type' => 'object', 'required' => ['item', 'x'], 'description' => 'Optional: a prop that appears in the scene where it happens (fallen rocks, a toppled tree) and goes once it is set right.', 'properties' => [
                            'item' => $key,
                            'x' => ['type' => 'number', 'minimum' => 0.15, 'maximum' => 0.85],
                        ]],
                        'award' => $award,
                    ],
                ]],
                'steps' => ['type' => 'array', 'minItems' => 2, 'maxItems' => 8, 'description' => 'The mission checklist, in order.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'text', 'done_when'],
                    'properties' => [
                        'key' => $key,
                        'text' => $text('Checklist line. A step with several interactions shows its count automatically.', 120),
                        'done_when' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $key, 'description' => 'Interaction (or combination) keys; the step is done when all of them are.'],
                        'after' => ['type' => 'string', 'description' => 'Optional: a step key (or a twist key); this step is only listed once that one is done (or has happened).'],
                        'optional' => ['type' => 'boolean'],
                    ],
                ]],
                'cutscenes' => ['type' => 'array', 'maxItems' => 2, 'description' => 'Optional, at most two, and short: moments told like a comic or a film, between the playing. The student is taken to a page that plays by itself, then brought back where they were. Use one where the story turns: the opening hook (when intro, at most 20 seconds before students can act), or the payoff after a big discovery. Each is one to four panels; a panel is a scene of its own, set in one of the mission\'s places (its picture is used again, or a close-up of it drawn), or the next panel of the one before (a moment later, with changes). Tell it with storytelling devices: an establishing wide shot, then a close-up on a face as the truth dawns; a before and after; a reveal (the same panel with one thing changed: the creature is now on the roof); an insert of the clue in someone\'s hand (show); a memory (show with tone memory); a camera push in for tension. Never more than about 20 seconds on one still picture.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'when', 'panels'],
                    'properties' => [
                        'key' => $key,
                        'when' => ['type' => 'string', 'description' => '"intro": the first time a student arrives in the start scene, before the guide\'s briefing. Or an interaction\'s key: right after a student first completes it.'],
                        'panels' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 4, 'items' => [
                            'type' => 'object', 'required' => ['cast', 'script'],
                            'properties' => [
                                'at' => ['type' => 'string', 'pattern' => self::KEY, 'description' => 'The scene (place) it is set in: its look is used. Not needed when it continues.'],
                                'continues' => ['type' => 'boolean', 'description' => 'true: the next panel of the panel before: the same place and view a moment later, everything where it was unless changes or the script says otherwise.'],
                                'shot' => ['type' => 'string', 'enum' => Cutscenes::SHOTS, 'description' => 'wide (default): the whole place. close: a close-up, the characters drawn twice as big; its script fits in about 20 seconds.'],
                                'changes' => ['type' => 'string', 'maxLength' => 300, 'description' => 'With continues: what is different in the picture itself ("the vault door now stands open, gold light spilling out").'],
                                'cast' => ['type' => 'array', 'maxItems' => 4, 'items' => ['type' => 'object', 'required' => ['who', 'x'], 'properties' => [
                                    'who' => $key, 'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9], 'facing' => ['type' => 'string', 'enum' => ['left', 'right']],
                                ]]],
                                'script' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 12, 'items' => StorySchema::beat()],
                            ],
                        ]],
                    ],
                ]],
                'intro' => ['type' => 'object', 'required' => ['dialogue'], 'properties' => [
                    'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $line, 'description' => 'The guide briefs the students when they first arrive in the start scene.'],
                ]],
                'completion' => ['type' => 'object', 'required' => ['label', 'dialogue', 'award'], 'properties' => [
                    'label' => $text('Shown over the guide once every required step is done: "Report to Captain Vega".', 40),
                    'debrief' => $text('What the guide says before asking the debrief questions (the at_report questions): "Before we fly home, tell me what you worked out."', 200),
                    'dialogue' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 6, 'items' => $line],
                    'award' => $award,
                    'cutscene' => $cutscene,
                ]],
                'badge' => ['type' => 'object', 'required' => ['name', 'appearance'], 'properties' => [
                    'name' => $text('A patch students can buy in the marketplace with their stars, only from this mission.', 40),
                    'appearance' => $text('What the round embroidered patch shows. No text.', 200),
                ]],
            ],
        ];
    }
}
