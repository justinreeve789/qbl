<?php

namespace App\Qbl\Generation\Design;

/**
 * The shape of a story blueprint: what the language model writes when the teacher asks for a story to
 * be told rather than a mission to be played.
 *
 * A story is a run of scenes, each a page of a picture book that plays by itself: the places are drawn
 * as a mission's are (the same look, sizes, skies, lights, weather, water and life), and each has a
 * script of beats (someone walks on, says something, waves; the rain starts; a car goes by; the
 * narrator says what happens next). StoryBuilder turns the script into start events that act it out,
 * one scene after another, with no avatars. As with missions, the model never writes events, ids or
 * coordinates.
 */
final class StorySchema
{
    /** What can happen in a story scene, in order. */
    public const BEATS = ['narrate', 'say', 'walk', 'enter', 'leave', 'gesture', 'wait', 'sound', 'weather', 'pass', 'title', 'show', 'camera'];

    /** The parts of a mission's scene a story scene has too: how it looks, its life, its weather and water. */
    private const SCENE_PARTS = ['kind', 'background', 'ground_line', 'width', 'distance', 'foreground', 'floor', 'ambient', 'sky', 'lights', 'atmosphere', 'weather', 'water', 'props'];

    /** One beat of a script: what happens next in a story scene, or a cutscene's panel. */
    public static function beat(): array
    {
        $text = fn (string $d, int $max = 400) => ['type' => 'string', 'description' => $d, 'maxLength' => $max];

        return [
            'type' => 'object', 'required' => ['do'],
            'properties' => [
                'do' => ['type' => 'string', 'enum' => self::BEATS, 'description' => 'narrate: the narrator tells what happens (text), shown as a caption and read aloud. say: a character on stage says a line in a speech bubble (who, text; to: who they say it to, and they turn to face them). walk: a character on stage walks to x (run: hurries). enter: a character who is not on stage comes on from the left or right edge (from) and walks to x. leave: a character on stage walks off the left or right edge (edge), and is gone from this scene. gesture: a character makes a gesture. wait: a pause (seconds), for a moment to land. sound: a sound effect plays (sound). weather: the weather changes (weather: rain, snow, storm, blizzard, fog, or clear when it stops; intensity), outdoors. pass: one of this scene\'s ambient creatures or vehicles goes by now (passer). title: words shown big across the screen ("Later that night..."), sparingly. show: a picture shown full-screen for a moment, an insert (picture; text: narration read over it; motion; tone; seconds, at most 20): a close-up of an object, a memory, something far away. camera: the view moves (move: push_in on who, pull_back to the whole stage, pan to x; seconds).'],
                'who' => ['type' => 'string', 'description' => 'say, walk, enter, leave, gesture: the character\'s key.'],
                'text' => $text('narrate: one or two short sentences of the story. say: what they say, at most 160 characters. title: at most 40 characters.', 260),
                'to' => ['type' => 'string', 'description' => 'say, optional: the key of the character spoken to, who is on stage.'],
                'x' => ['type' => 'number', 'minimum' => 0.08, 'maximum' => 0.92, 'description' => 'walk, enter: where they go, across the scene.'],
                'from' => ['type' => 'string', 'enum' => ['left', 'right'], 'description' => 'enter: the edge they come on from.'],
                'edge' => ['type' => 'string', 'enum' => ['left', 'right'], 'description' => 'leave: the edge they walk off.'],
                'run' => ['type' => 'boolean', 'description' => 'walk, enter, leave: they hurry.'],
                'gesture' => ['type' => 'string', 'enum' => BlueprintSchema::CUTSCENE_GESTURES, 'description' => 'gesture: wave, point, cheer, think (drawn for the character), or jump, spin, dance.'],
                'seconds' => ['type' => 'number', 'minimum' => 0.5, 'maximum' => 20, 'description' => 'wait: at most 6. camera: how long the move takes. show: how long the picture stays, at most 20.'],
                'sound' => ['type' => 'string', 'enum' => BlueprintSchema::SOUNDS, 'description' => 'sound: thunder, car, horn, hooves, bell, chime (magic), knock, door, footsteps, splash, whoosh, pop, tweet, or a sound that goes on (rain, wind, river, birds, crickets, fire: they play for a few seconds).'],
                'weather' => ['type' => 'string', 'enum' => [...BlueprintSchema::WEATHERS, 'clear']],
                'intensity' => ['type' => 'string', 'enum' => array_keys(BlueprintSchema::INTENSITY)],
                'passer' => ['type' => 'string', 'description' => 'pass: the key of one of this scene\'s ambient creatures or vehicles.'],
                ...Cutscenes::beatProperties(),
                'meanwhile' => ['type' => 'boolean', 'description' => 'true: the next beat starts at once, while this one goes on (someone walks across while another speaks; the rain starts as the narrator talks).'],
            ],
        ];
    }

    public static function schema(array $limits): array
    {
        $mission = BlueprintSchema::schema($limits);
        $sceneParts = array_intersect_key($mission['properties']['scenes']['items']['properties'], array_flip(self::SCENE_PARTS));
        $sceneParts['background']['description'] = 'What the background picture shows, as a side-on view, like a stage set: the place, its landmarks and the scenery, left to right. Things in it are at real sizes beside a 130 cm child (a door is taller than them, a house many times taller): describe them as seen from a few metres away. No characters, people or animals: they are added. Do not describe the art style; that is added for you. With distance: only what is near (the far view is its own picture). With water: the banks or shore around it (the water itself is added).';
        $ambient = &$sceneParts['ambient']['items'];
        $ambient['properties']['cue'] = ['type' => 'boolean', 'description' => 'true: it only passes when the script says (a pass beat): the bus that splashes Mo, the cat that steals the fish. Otherwise it comes and goes now and then by itself, as life in the background.'];
        $ambient['description'] = 'Life in the place: birds that land and fly off, a cat that strolls by, fish swimming past, cars or carts driving by.';
        unset($ambient);
        // A story has no interactions, steps or twists for a light to wait for.
        unset($sceneParts['lights']['items']['properties']['on_after'], $sceneParts['lights']['items']['properties']['off_after']);
        $key = ['type' => 'string', 'pattern' => BlueprintSchema::KEY];
        $text = fn (string $d, int $max = 400) => ['type' => 'string', 'description' => $d, 'maxLength' => $max];
        $voice = $mission['properties']['characters']['items']['properties']['voice'];

        $beat = self::beat();

        return [
            'type' => 'object',
            'required' => ['title', 'subtitle', 'description', 'story', 'characters', 'scenes', 'ending'],
            'properties' => [
                'title' => $text('The story\'s title, at most 6 words.', 60),
                'subtitle' => $text('One line under the title.', 140),
                'description' => $text('For the teacher: what the story is about and what students take from it. 2-4 sentences.', 800),
                'story' => ['type' => 'object', 'required' => ['premise', 'takeaway'], 'properties' => [
                    'premise' => $text('What happens, in a few sentences: beginning, middle and end.', 800),
                    'takeaway' => $text('What students should understand or feel by the end: the idea the story carries.', 300),
                ]],
                'art_direction' => $mission['properties']['art_direction'],
                'narrator' => ['type' => 'object', 'description' => 'Who tells the story: their voice, for the narration read aloud.', 'properties' => ['voice' => $voice]],
                'characters' => ['type' => 'array', 'minItems' => 1, 'maxItems' => $limits['max_characters'], 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'role', 'appearance', 'personality', 'height_cm'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'role' => $text('Their part in the story.', 200),
                        'appearance' => $mission['properties']['characters']['items']['properties']['appearance'],
                        'height_cm' => $mission['properties']['characters']['items']['properties']['height_cm'],
                        'personality' => $text('How they talk and behave, in a few words.', 200),
                        'voice' => $voice,
                        'gestures' => ['type' => 'array', 'maxItems' => 3, 'items' => ['type' => 'string', 'enum' => BlueprintSchema::GESTURES], 'description' => 'Drawn animations besides standing and walking, for the gesture beats that ask for them.'],
                    ],
                ]],
                'items' => ['type' => 'array', 'maxItems' => $limits['max_items'], 'description' => 'Optional: big things that stand in scenes (a market cart, a well, a boat pulled up on the bank), placed with a scene\'s props.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'name', 'appearance', 'size_cm'],
                    'properties' => [
                        'key' => $key,
                        'name' => $text('Name.', 40),
                        'appearance' => $text('Only what it looks like, as a single object: shape, material, colours, details. No text.', 400),
                        'size_cm' => $mission['properties']['items']['items']['properties']['size_cm'],
                    ],
                ]],
                'scenes' => ['type' => 'array', 'minItems' => 2, 'maxItems' => $limits['max_scenes'], 'description' => 'The story\'s scenes, in the order they are told. Each plays by itself and then moves on to the next.', 'items' => [
                    'type' => 'object', 'required' => ['key', 'title', 'background', 'ground_line', 'cast', 'script'],
                    'properties' => ['key' => $key, 'title' => $text('The place: "The Riverbank".', 40), 'description' => $text('For the teacher: what happens here.', 300)] + $sceneParts + Cutscenes::sceneProperties($key) + [
                        'cast' => ['type' => 'array', 'maxItems' => 6, 'description' => 'Who is on stage when the scene opens, and where they stand. Others can come on with an enter beat.', 'items' => [
                            'type' => 'object', 'required' => ['who', 'x'],
                            'properties' => [
                                'who' => $key,
                                'x' => ['type' => 'number', 'minimum' => 0.1, 'maximum' => 0.9],
                                'facing' => ['type' => 'string', 'enum' => ['left', 'right'], 'description' => 'Default: towards the middle.'],
                            ],
                        ]],
                        'script' => ['type' => 'array', 'minItems' => 3, 'maxItems' => 24, 'items' => $beat, 'description' => 'What happens, in order: the scene acted out. Show more than tell: characters move, react and talk; the narrator links the moments.'],
                    ],
                ]],
                'ending' => ['type' => 'object', 'required' => ['discussion'], 'description' => 'After the last scene: "The End", and things to talk about.', 'properties' => [
                    'text' => $text('Optional: one line shown with "The End".', 160),
                    'discussion' => ['type' => 'array', 'minItems' => 1, 'maxItems' => 3, 'items' => $text('An open question for students to talk about: what a character felt, why something happened, what they would have done.', 200)],
                ]],
            ],
        ];
    }
}
