<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\Art\LibraryCritters;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Llm\LanguageModel;

/**
 * Plans ONE new scene for a scenario a teacher is already making (the editor's "Generate a scene"),
 * from what they asked for: what its background shows, the things standing out on its floor that
 * people walk around (they are cut out of the picture afterwards), the things painted into it that
 * players can click to hear the narrator describe, and, if wanted, what makes it feel alive: lights
 * that glow and flicker, a living sky, what is in the air, water that flows, and little critters that
 * come and go.
 *
 * The plan comes back in the shape of a mission blueprint with one scene (BlueprintSchema's scene, plus
 * `standing` and the narrator's `texts` on details), so the mission generator's art director, surveyor
 * and builder helpers draw and lay it out exactly as they do a mission's scenes. No characters, items,
 * exits or interactions: the teacher adds those.
 *
 *   SceneDesigner::OPTIONS  what the teacher can set (the editor's dialog; GenerationApi::sceneOptions)
 *   design()                the language model's plan, tidied
 *   tidy()                  any plan made safe to build: clamped, keyed, cut to the options
 */
final class SceneDesigner
{
    /** How a thing with several descriptions answers being clicked again. */
    public const REPEATS = ['last', 'cycle'];

    /**
     * The teacher's choices, and what each can be (null: "Choose for me").
     *   place       what sort of place (Sizes::SCENE_KINDS); `kind` is the run's own ("scene")
     *   time        the time of day (BlueprintSchema::SKY_TIMES)
     *   width       normal, or wide (a long place the view follows the player along)
     *   hotspots    things to click with narrator descriptions (default true)
     *   repeat      several descriptions, clicked again: auto (chosen per thing), last (step through them,
     *               then keep saying the last), cycle (go round again)
     *   animations  lights, a living sky, what is in the air, flowing water (default true)
     *   critters    birds, squirrels, deer... that come and go now and then (default false)
     */
    public const OPTIONS = [
        'place' => Sizes::SCENE_KINDS,
        'time' => BlueprintSchema::SKY_TIMES,
        'width' => BlueprintSchema::WIDTHS,
        'repeat' => ['auto', ...self::REPEATS],
    ];

    public const MAX_STANDING = 5;

    public const MAX_DETAILS = 6;

    public const MAX_TEXTS = 4;

    public function __construct(private LanguageModel $llm) {}

    /**
     * @param  string  $prompt  what the teacher asked for, in their words
     * @param  array  $options  SceneDesigner::OPTIONS, hotspots, animations, critters, notes, grade
     * @param  array  $context  the scenario it joins: title, description, scenes [title, description], key (the new scene's shortname)
     * @return array a blueprint with one scene (see the class comment)
     */
    public function design(string $prompt, array $options, array $context): array
    {
        $options = self::defaults($options);
        $content = [self::brief($prompt, $options, $context)];
        $plan = $this->llm->structured(self::system(), $content, 'scene_design', self::schema($options), 8000);

        return self::tidy($plan, $options, (string) ($context['key'] ?? 'scene'));
    }

    /** The options as the run reads them: unknown values dropped, the switches given their defaults. */
    public static function defaults(array $options): array
    {
        $out = [];
        foreach (self::OPTIONS as $key => $allowed) {
            $out[$key] = in_array($options[$key] ?? null, $allowed, true) ? $options[$key] : null;
        }
        $out['repeat'] ??= 'auto';
        foreach (['hotspots' => true, 'animations' => true, 'critters' => false] as $key => $default) {
            $out[$key] = array_key_exists($key, $options) && $options[$key] !== null ? (bool) $options[$key] : $default;
        }
        $out['notes'] = isset($options['notes']) ? mb_substr(trim((string) $options['notes']), 0, 1000) : null;
        $out['grade'] = $options['grade'] ?? null;

        return $out;
    }

    public static function system(): string
    {
        $rules = <<<'TXT'
        You design ONE scene for an educational 2D adventure game that children play in a browser. Players are
        cartoon avatars who walk around a painted, side-on scene (like a stage seen from the audience: the floor
        runs from the bottom of the picture back to where the scenery begins). You plan the background picture and
        what in it is alive and clickable. An illustrator paints it; the game cuts things out of it and adds the rest.

        Plan these:

        background: the place, as one side-on picture, left to right: its landmarks and scenery. Real sizes beside
        a 130 cm child. No people, characters or animals. Do not describe the art style. Do not describe the things
        listed under standing, details or lights here: they are added to the picture for you where you put them.

        standing: up to 5 things standing OUT ON THE FLOOR that a person could walk all the way around, passing
        behind and in front of them: a tree, a bush, a lamp post, a statue, a fountain, a well, a boulder, barrels,
        a bench, a market stall, a table, a pillar. They are lifted out of the picture so players walk behind them,
        so they need open floor all around: space them out (x at least 0.15 apart), never at the very edges, and not
        so many that the floor is crowded. Trees and bushes suit outdoor places; furniture, pillars, crates indoor.
        Give one or two of them something to say when clicked (texts) if they are worth a look.

        details: things painted into the scenery (at the back of the floor, on a wall, or lying on the floor) that
        players click to hear the narrator describe: a faded poster, a carved date over a door, an old map, tracks
        in the mud, a strange machine, a view. Choose what rewards curiosity and fits the teacher's purpose: facts
        worth knowing, small mysteries, jokes, the history of the place. Spread them across the scene.

        texts (on details, and on standing things worth describing): what the narrator says, 1 to 4 short passages
        (each under 220 characters, warm and vivid, second person or plain description, the reading level of the
        players). Give several when a closer look reveals more: the first says what you see, the next looks closer
        or remembers something, the last is the payoff. Give one when one is enough. repeat: "last" when they build
        to a final point (after the last, clicking again repeats the last one); "cycle" when they are separate
        remarks that can go round again (a parrot's phrases, a radio's stations, rumours).

        lights (when asked for life): lamps, lanterns, torches, candles, campfires, glowing crystals, screens,
        beacons, lit windows: painted in and made to glow, flicker or blink. where: wall (hung on a back wall),
        back (standing at the back of the floor), floor (standing out on the floor: also list it under standing).
        sky (outdoor and up_high, when asked for life): a living sky the game draws behind the scenery, with drifting
        clouds; it can slowly change (afternoon until dusk). atmosphere: fireflies at dusk, leaves in autumn, dust in
        a sunbeam, bubbles under water, snow. water: a river, stream, pond or sea that flows and ripples, only when
        it is central to the place. weather: only if the teacher asks for it.

        ambient (when asked for critters): little life that comes and goes now and then: birds that land and peck
        (lands), a squirrel that runs up a tree (climbs: needs a tree under standing), a rabbit that hops between
        bushes (hides: needs two or more bushes or plants under standing), a deer, cat or fox that walks by
        (walks_by), a hawk or flock that flies by (flies_by), fish (swims_by), a cart or car on a road (drives_by).
        Prefer a ready-made library animal when one fits (library); otherwise describe the creature (look).

        ground_line: where the walkable floor begins, from the top (0.55 to 0.8): lower (0.7-0.8) for a room with a
        tall back wall, higher (0.55-0.65) for a wide open place.
        TXT;

        return $rules;
    }

    /** What the designer is told about this request. */
    public static function brief(string $prompt, array $options, array $context): string
    {
        $lines = ["The teacher asks for this scene:\n".$prompt];
        if (! empty($context['title'])) {
            $lines[] = 'It is a new scene in their scenario "'.$context['title'].'"'.(! empty($context['description']) ? ': '.mb_substr((string) $context['description'], 0, 400) : '').'.';
        }
        $others = array_values(array_filter((array) ($context['scenes'] ?? []), fn ($s) => ! empty($s['title'])));
        if ($others) {
            $lines[] = "The scenario's other scenes (make this one fit beside them, but a different place):\n".implode("\n", array_map(
                fn ($s) => '- '.$s['title'].(! empty($s['description']) ? ': '.mb_substr((string) $s['description'], 0, 160) : ''),
                array_slice($others, 0, 12),
            ));
        }
        $choices = [];
        if ($options['place']) {
            $choices[] = 'The place is '.str_replace('_', ' ', $options['place']).'.';
        }
        if ($options['time']) {
            $choices[] = "The time of day is {$options['time']}.";
        }
        if ($options['width'] === 'wide') {
            $choices[] = 'It is a WIDE scene, about one and a half screens long: a place players walk along (a street, a riverbank, a long hall). Spread things along it.';
        }
        $choices[] = $options['hotspots']
            ? 'Give it details to click (3 to 6), and texts for one or two standing things worth a look.'.match ($options['repeat']) {
                'last' => ' Where a thing has several texts, they build to a last one that stays (repeat "last").',
                'cycle' => ' Where a thing has several texts, they go round again (repeat "cycle").',
                default => '',
            }
            : 'Nothing to click: no details, and no texts on standing things.';
        $choices[] = $options['animations']
            ? 'Bring it to life: lights where the place has them, a living sky if it is outdoors, something in the air if it suits, water only if it is central.'
            : 'No lights, sky, atmosphere, water or weather.';
        $choices[] = $options['critters']
            ? 'Add one to three critters (ambient) that suit the place and its time of day.'
            : 'No critters.';
        if ($options['grade']) {
            $choices[] = "The players are in grade {$options['grade']}: write the texts for them.";
        }
        $lines[] = implode("\n", $choices);
        if ($options['notes']) {
            $lines[] = "The teacher's notes:\n".$options['notes'];
        }

        return implode("\n\n", $lines);
    }

    /** What the designer answers in: one scene, with only the parts the options allow. */
    public static function schema(array $options): array
    {
        $text = fn (string $d, int $max = 400) => ['type' => 'string', 'description' => $d, 'maxLength' => $max];
        $x = ['type' => 'number', 'minimum' => 0.08, 'maximum' => 0.92, 'description' => 'Where its middle is across the scene, from 0 (left) to 1 (right).'];
        $texts = ['type' => 'array', 'minItems' => 1, 'maxItems' => self::MAX_TEXTS, 'items' => $text('One passage the narrator reads.', 260), 'description' => 'What the narrator says when it is clicked, in order.'];
        $repeat = ['type' => 'string', 'enum' => self::REPEATS, 'description' => 'last: step through, then keep the last. cycle: go round again.'];
        $hotspots = (bool) $options['hotspots'];
        $standingProps = [
            'x' => $x,
            'depth' => ['type' => 'string', 'enum' => ['back', 'middle', 'front'], 'description' => 'How far into the floor it stands.'],
            'label' => $text('Its name, shown when the pointer is near: "Old well".', 30),
            'look' => $text('What it looks like, as painted: "a round stone well with a little wooden roof and a bucket".', 200),
        ] + ($hotspots ? ['texts' => $texts, 'repeat' => $repeat] : []);
        $props = [
            'title' => $text('The scene\'s name, shown when players arrive: "Lantern Market".', 40),
            'description' => $text('For the teacher: what this place is for, in a sentence.', 300),
            'kind' => ['type' => 'string', 'enum' => Sizes::SCENE_KINDS],
            'background' => $text('What the background picture shows, side-on, left to right (see the rules).', 700),
            'ground_line' => ['type' => 'number', 'minimum' => 0.55, 'maximum' => 0.8],
            'setting' => $text('The world and era it belongs to, in a few words: "a Victorian seaside town", "a coral reef".', 120),
            'time_of_day' => $text('The light: "warm late afternoon", "moonlit night".', 60),
            'standing' => ['type' => 'array', 'maxItems' => self::MAX_STANDING, 'items' => ['type' => 'object', 'required' => ['x', 'depth', 'label', 'look'], 'properties' => $standingProps]],
        ];
        $required = ['title', 'kind', 'background', 'ground_line', 'standing'];
        if ($hotspots) {
            $props['details'] = ['type' => 'array', 'maxItems' => self::MAX_DETAILS, 'items' => ['type' => 'object', 'required' => ['x', 'label', 'look', 'texts'], 'properties' => [
                'x' => $x,
                'label' => $text('Its name: "Faded poster".', 30),
                'look' => $text('What is painted there: "a torn circus poster on the wall showing an elephant on a ball".', 160),
                'placement' => ['type' => 'string', 'enum' => ['back', 'ground'], 'description' => 'back: at the back of the floor or on a wall. ground: lying on the floor near the back.'],
                'texts' => $texts,
                'repeat' => $repeat,
            ]]];
            $required[] = 'details';
        }
        if ($options['animations']) {
            $props['lights'] = ['type' => 'array', 'maxItems' => 4, 'items' => ['type' => 'object', 'required' => ['x', 'kind', 'look', 'where'], 'properties' => [
                'x' => $x,
                'kind' => ['type' => 'string', 'enum' => array_keys(BlueprintSchema::LIGHTS), 'description' => 'lantern, torch, candle (flicker); campfire (flickers, embers rise); lamp, crystal, screen (glow, breathing slowly; lamp also for a lit window); beacon (blinks).'],
                'look' => $text('What it looks like, with what holds it: "an iron street lamp on a tall post".', 160),
                'where' => ['type' => 'string', 'enum' => ['wall', 'back', 'floor']],
                'color' => ['type' => 'string', 'pattern' => '^#[0-9a-fA-F]{6}$'],
            ]]];
            $props['sky'] = ['type' => 'object', 'required' => ['time'], 'description' => 'Outdoor and up_high only.', 'properties' => [
                'time' => ['type' => 'string', 'enum' => BlueprintSchema::SKY_TIMES],
                'until' => ['type' => 'string', 'enum' => BlueprintSchema::SKY_TIMES],
                'clouds' => ['type' => 'string', 'enum' => ['none', 'few', 'many']],
            ]];
            $props['atmosphere'] = ['type' => 'array', 'maxItems' => 2, 'items' => ['type' => 'object', 'required' => ['kind'], 'properties' => [
                'kind' => ['type' => 'string', 'enum' => BlueprintSchema::ATMOSPHERES],
                'amount' => ['type' => 'string', 'enum' => ['few', 'some', 'many']],
            ]]];
            $props['water'] = BlueprintSchema::waterSchema();
            $props['weather'] = BlueprintSchema::weatherSchema();
        }
        if ($options['critters']) {
            $props['ambient'] = ['type' => 'array', 'maxItems' => 3, 'items' => ['type' => 'object', 'required' => ['key', 'look', 'motion', 'size_cm'], 'properties' => [
                'key' => ['type' => 'string', 'pattern' => BlueprintSchema::KEY],
                'look' => $text('What it looks like: "a young deer with white spots".', 160),
                'motion' => ['type' => 'string', 'enum' => BlueprintSchema::AMBIENT_MOTIONS],
                'size_cm' => ['type' => 'integer', 'minimum' => 5, 'maximum' => 900],
                'library' => ['type' => 'string', 'enum' => array_keys(LibraryCritters::CATALOGUE), 'description' => 'A ready-made animal or vehicle, when one fits, with a motion it suits: '.str_replace("\n", '; ', LibraryCritters::described())],
                'count' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 5],
                'shy' => ['type' => 'boolean'],
                'sound' => ['type' => 'string', 'enum' => BlueprintSchema::SOUNDS],
            ]]];
        }

        return ['type' => 'object', 'required' => $required, 'properties' => $props];
    }

    /**
     * A plan made safe to build, whoever wrote it: every number in range, every list cut to size, what the
     * options turn off taken out, a light standing on the floor also standing there to be cut out, and the
     * whole put in the shape of a one-scene mission blueprint (key $key).
     */
    public static function tidy(array $plan, array $options, string $key): array
    {
        $options = self::defaults($options);
        $str = fn ($v, int $max) => mb_substr(trim(strip_tags((string) $v)), 0, $max);
        $num = fn ($v, float $lo, float $hi, float $default) => is_numeric($v) ? max($lo, min($hi, (float) $v)) : $default;
        $title = $str($plan['title'] ?? '', 40);
        $background = $str($plan['background'] ?? '', 700);
        if ($title === '' || $background === '') {
            throw new GenerationError('The scene\'s plan has no title or background.');
        }
        $kind = $options['place'] ?? (in_array($plan['kind'] ?? null, Sizes::SCENE_KINDS, true) ? $plan['kind'] : 'outdoor');
        $hotspots = $options['hotspots'];
        $repeatOf = fn (array $t) => $options['repeat'] !== 'auto' ? $options['repeat'] : (in_array($t['repeat'] ?? null, self::REPEATS, true) ? $t['repeat'] : 'last');
        $textsOf = fn (array $t) => array_values(array_slice(array_filter(array_map(fn ($s) => $str($s, 260), (array) ($t['texts'] ?? (isset($t['text']) ? [$t['text']] : []))), 'strlen'), 0, self::MAX_TEXTS));

        $standing = [];
        foreach (array_slice((array) ($plan['standing'] ?? []), 0, self::MAX_STANDING) as $t) {
            if (! is_array($t) || trim((string) ($t['look'] ?? '')) === '') {
                continue;
            }
            $texts = $hotspots ? $textsOf($t) : [];
            $standing[] = array_filter([
                'x' => round($num($t['x'] ?? null, 0.1, 0.9, 0.5), 3),
                'depth' => in_array($t['depth'] ?? null, ['back', 'middle', 'front'], true) ? $t['depth'] : 'middle',
                'label' => $str($t['label'] ?? $t['look'], 30),
                'look' => $str($t['look'], 200),
                'texts' => $texts ?: null,
                'repeat' => count($texts) > 1 ? $repeatOf($t) : null,
            ], fn ($v) => $v !== null);
        }

        $details = [];
        foreach ($hotspots ? array_slice((array) ($plan['details'] ?? []), 0, self::MAX_DETAILS) : [] as $d) {
            $texts = is_array($d) ? $textsOf($d) : [];
            if (! $texts || trim((string) ($d['look'] ?? '')) === '') {
                continue;
            }
            $details[] = array_filter([
                'x' => round($num($d['x'] ?? null, 0.08, 0.92, 0.5), 3),
                'label' => $str($d['label'] ?? 'Something', 30),
                'look' => $str($d['look'], 160),
                'placement' => ($d['placement'] ?? null) === 'ground' ? 'ground' : 'back',
                // The first passage also as the single text a mission's details have.
                'text' => $texts[0],
                'texts' => $texts,
                'repeat' => count($texts) > 1 ? $repeatOf($d) : null,
            ], fn ($v) => $v !== null);
        }

        $scene = [
            'key' => $key,
            'title' => $title,
            'description' => $str($plan['description'] ?? '', 300) ?: null,
            'kind' => $kind,
            'background' => $background,
            'ground_line' => round($num($plan['ground_line'] ?? null, 0.55, 0.8, 0.68), 3),
            'width' => $options['width'] ?? 'normal',
            'exits' => [],
            'standing' => $standing,
            'details' => $details,
        ];

        if ($options['animations']) {
            $lights = [];
            foreach (array_slice((array) ($plan['lights'] ?? []), 0, 4) as $l) {
                if (! is_array($l) || ! isset(BlueprintSchema::LIGHTS[$l['kind'] ?? '']) || trim((string) ($l['look'] ?? '')) === '') {
                    continue;
                }
                $where = in_array($l['where'] ?? null, ['wall', 'back', 'floor'], true) ? $l['where'] : (Sizes::walled(['kind' => $kind]) ? 'wall' : 'back');
                // Every light is painted into the picture (placement "wall" is how the art director knows),
                // its glow put on its brightest part once the picture is surveyed.
                $lights[] = array_filter([
                    'x' => round($num($l['x'] ?? null, 0.05, 0.95, 0.5), 3), 'kind' => $l['kind'], 'look' => $str($l['look'], 160),
                    'placement' => 'wall', 'where' => $where,
                    'color' => is_string($l['color'] ?? null) && preg_match('/^#[0-9a-fA-F]{6}$/', $l['color']) ? $l['color'] : null,
                ], fn ($v) => $v !== null);
            }
            $scene['lights'] = $lights;
            $outdoor = in_array($kind, BlueprintSchema::WEATHER_KINDS, true);
            if ($outdoor && is_array($plan['sky'] ?? null) && in_array($plan['sky']['time'] ?? null, BlueprintSchema::SKY_TIMES, true)) {
                $sky = $plan['sky'];
                $scene['sky'] = array_filter([
                    'time' => $options['time'] ?? $sky['time'],
                    'until' => in_array($sky['until'] ?? null, BlueprintSchema::SKY_TIMES, true) && $sky['until'] !== $sky['time'] ? $sky['until'] : null,
                    'clouds' => in_array($sky['clouds'] ?? null, ['none', 'few', 'many'], true) ? $sky['clouds'] : 'few',
                ], fn ($v) => $v !== null);
            }
            $atmosphere = [];
            foreach (array_slice((array) ($plan['atmosphere'] ?? []), 0, 2) as $a) {
                if (is_array($a) && in_array($a['kind'] ?? null, BlueprintSchema::ATMOSPHERES, true)) {
                    $atmosphere[] = ['kind' => $a['kind']] + (in_array($a['amount'] ?? null, ['few', 'some', 'many'], true) ? ['amount' => $a['amount']] : []);
                }
            }
            if ($atmosphere) {
                $scene['atmosphere'] = $atmosphere;
            }
            $water = $plan['water'] ?? null;
            if (is_array($water) && in_array($water['kind'] ?? null, BlueprintSchema::WATERS, true) && in_array($kind, BlueprintSchema::WATER_KINDS, true)) {
                $scene['water'] = array_filter([
                    'kind' => $water['kind'], 'where' => in_array($water['where'] ?? null, BlueprintSchema::WATER_PLACES, true) ? $water['where'] : 'front',
                    'x' => isset($water['x']) ? round($num($water['x'], 0.2, 0.8, 0.5), 3) : null,
                    'width' => isset($water['width']) ? round($num($water['width'], 0.1, 0.5, 0.3), 3) : null,
                    'look' => $str($water['look'] ?? 'its banks', 160), 'flows' => in_array($water['flows'] ?? null, ['left', 'right'], true) ? $water['flows'] : null,
                    'color' => is_string($water['color'] ?? null) && preg_match('/^#[0-9a-fA-F]{6}$/', $water['color']) ? $water['color'] : null,
                ], fn ($v) => $v !== null);
            }
            $weather = $plan['weather'] ?? null;
            if ($outdoor && is_array($weather) && in_array($weather['kind'] ?? null, BlueprintSchema::WEATHERS, true)) {
                $scene['weather'] = ['kind' => $weather['kind']] + (isset(BlueprintSchema::INTENSITY[$weather['intensity'] ?? '']) ? ['intensity' => $weather['intensity']] : []);
            }
        }

        if ($options['critters']) {
            $trees = count(array_filter($standing, fn ($t) => preg_match('/\btree|oak|pine|palm|birch|maple|willow|trunk\b/i', $t['look'])));
            $bushes = count(array_filter($standing, fn ($t) => preg_match('/\bbush|shrub|hedge|fern|plant|rock|boulder\b/i', $t['look'])));
            $ambient = [];
            $keys = [];
            foreach (array_slice((array) ($plan['ambient'] ?? []), 0, 3) as $i => $a) {
                if (! is_array($a) || ! in_array($a['motion'] ?? null, BlueprintSchema::AMBIENT_MOTIONS, true) || trim((string) ($a['look'] ?? '')) === '') {
                    continue;
                }
                // A squirrel needs a tree to climb, a rabbit bushes to hide in; without them they walk by.
                $motion = $a['motion'];
                if (($motion === 'climbs' && $trees < 1) || ($motion === 'hides' && $bushes < 2)) {
                    $motion = 'walks_by';
                }
                $library = isset(LibraryCritters::CATALOGUE[$a['library'] ?? '']) && in_array($motion, LibraryCritters::CATALOGUE[$a['library']][1], true) ? $a['library'] : null;
                $k = preg_match('/'.BlueprintSchema::KEY.'/', (string) ($a['key'] ?? '')) ? $a['key'] : "critter_$i";
                if (isset($keys[$k])) {
                    $k .= "_$i";
                }
                $keys[$k] = true;
                $ambient[] = array_filter([
                    'key' => $k, 'look' => $str($a['look'], 160), 'motion' => $motion,
                    'size_cm' => (int) $num($a['size_cm'] ?? null, 5, 900, 30), 'library' => $library,
                    'count' => $motion === 'lands' && isset($a['count']) ? (int) $num($a['count'], 1, 5, 1) : null,
                    'shy' => isset($a['shy']) ? (bool) $a['shy'] : null,
                    'sound' => in_array($a['sound'] ?? null, BlueprintSchema::SOUNDS, true) ? $a['sound'] : null,
                ], fn ($v) => $v !== null);
            }
            if ($ambient) {
                $scene['ambient'] = $ambient;
            }
        }

        $time = $options['time'] ? "{$options['time']}".(($t = $str($plan['time_of_day'] ?? '', 60)) !== '' ? ", $t" : '') : ($str($plan['time_of_day'] ?? '', 60) ?: null);

        return [
            'format' => 'scene',
            'title' => $title,
            'language' => 'en',
            'art_direction' => array_filter(['setting' => $str($plan['setting'] ?? '', 120), 'time_of_day' => $time, 'accent_colors' => []], fn ($v) => $v !== null && $v !== ''),
            'start_scene' => $key,
            'scenes' => [$scene],
            'characters' => [], 'items' => [], 'interactions' => [], 'combinations' => [], 'steps' => [], 'twists' => [],
        ];
    }
}
