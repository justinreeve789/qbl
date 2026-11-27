<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\Art\LibraryCritters;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Llm\LanguageModel;
use Random\Randomizer;

/**
 * Writes the mission blueprint from the teacher's prompt and the curriculum alignment, and has the
 * model correct it until BlueprintValidator finds nothing wrong.
 *
 * Corrections are cheap: the model answers with only the changes (set this field, remove that one, add
 * an item to a list), not the whole blueprint again, which would cost as much as writing it in the
 * first place. Only if that fails does it write the whole blueprint once more. The instructions and the
 * brief come from the prompt cache on every call after the first.
 */
class MissionDesigner
{
    private Randomizer $random;

    /**
     * @param  float  $bigMomentChance  how many missions, out of 1, may have a big tense moment (someone in
     *                                  trouble whom students save): kept rare, so it stays special
     */
    public function __construct(private LanguageModel $llm, private array $limits, private int $repairs = 3, private float $bigMomentChance = 0.25, ?Randomizer $random = null)
    {
        $this->random = $random ?? new Randomizer;
    }

    /** The answer to a correction: a list of changes. */
    public const CHANGES_SCHEMA = [
        'type' => 'object',
        'required' => ['changes'],
        'properties' => [
            'changes' => ['type' => 'array', 'minItems' => 1, 'items' => [
                'type' => 'object', 'required' => ['op', 'path', 'value'],
                'properties' => [
                    'op' => ['type' => 'string', 'enum' => ['set', 'remove', 'append'], 'description' => 'set: put value at path (replacing what is there, or adding a field). remove: delete what is at path (value ""). append: add value to the end of the list at path.'],
                    'path' => ['type' => 'string', 'description' => 'Dot-separated. A list of things with keys is addressed by key, other lists by position from 0: "interactions.q_pollen.question.choices.0.correct", "scenes.orchard.exits.1.x", "steps", "twists.storm.blocks".'],
                    'value' => ['type' => 'string', 'description' => 'The new value as JSON: true, 0.4, "text", {"key": ...}, [...]; "" for remove.'],
                ],
            ]],
        ],
    ];

    /**
     * @param  array  $alignment  StandardsAligner::align()
     * @param  array{grade?: ?string, subject?: ?string, scenes?: ?int, min_players?: int, max_players?: int, minutes?: ?int, notes?: ?string, big_moment?: bool, opening?: string, focus?: string, freedom?: string}  $options
     *                                                                                                                                                                       big_moment: whether it may have a big tense moment (else by chance)
     *                                                                                                                                                                       opening, focus, freedom: the design rules' settings (DesignRules::SETTINGS)
     * @param  callable|null  $log  fn(string $message)
     * @param  callable|null  $progress  fn(float $fraction, string $detail): how far the design has got, for the progress bar
     */
    public function design(string $prompt, array $alignment, array $options, ?callable $log = null, ?callable $progress = null): array
    {
        if (($options['format'] ?? 'mission') === 'story') {
            // A story to watch, not a mission to play: its own blueprint, checked by its own validator.
            $progress && $progress(0.05, 'Writing the story and its scenes');

            return $this->loop(StorySchema::schema($this->limits), $this->storySystem(), $this->storyBrief($prompt, $alignment, $options), 'story_blueprint',
                fn (array $b) => StoryValidator::errors($b), fn (array $b) => self::tidyStory($b), 'story', $log, $progress);
        }
        $progress && $progress(0.05, 'Writing the story, scenes and questions');
        $objectiveIds = array_column($alignment['learning_objectives'], 'id');
        // Whether this one may have a big tense moment is decided here, not by the model, so they stay rare.
        $pace = ['big_moment' => $this->pace($options)];
        // The teacher's settings for the design rules' tensions; kept on the blueprint so every later
        // check of it (corrections, the critic, best-of) holds it to the same ones.
        $approach = DesignRules::approach($options);

        return $this->loop(BlueprintSchema::schema($this->limits), $this->system(), $this->brief($prompt, $alignment, $options, $pace), 'mission_blueprint',
            fn (array $b) => BlueprintValidator::errors($b, $objectiveIds), fn (array $b) => ['pace' => $pace, 'approach' => $approach] + self::tidy($b), 'mission', $log, $progress);
    }

    /**
     * Write a blueprint and have the model correct it until $errors finds nothing wrong: by changes
     * (cheap), then, if those do not get there, by one whole rewrite.
     *
     * @param  callable(array): string[]  $errors
     * @param  callable(array): array  $tidy
     */
    private function loop(array $schema, string $system, string $brief, string $name, callable $errors, callable $tidy, string $what, ?callable $log, ?callable $progress): array
    {
        $blueprint = $tidy($this->llm->structured($system, [$brief], $name, $schema, 32000));
        // The first draft is most of the work; each correction gets it closer (how many is not known ahead).
        $progress && $progress(0.7, $what === 'story' ? 'Checking the story can be acted out from start to finish' : 'Checking the mission can be played from start to finish');
        $rewritten = false;
        $limit = $this->repairs;
        for ($round = 1; ; $round++) {
            try {
                $problems = $errors($blueprint);
            } catch (\TypeError|\ErrorException|\ValueError $e) {
                // Not even the right shape (the tool route is not enforced token by token).
                $problems = ['The blueprint does not follow the schema: '.$e->getMessage().'. Give every field the type the schema says.'];
            }
            if (! $problems) {
                $progress && $progress(1, $what === 'story' ? 'The story is written' : 'The mission is designed');

                return $blueprint;
            }
            $progress && $progress(0.7 + 0.3 * (1 - 0.5 ** $round), 'Fixing '.count($problems).' problem'.(count($problems) === 1 ? '' : 's').' in the design (round '.$round.')');
            if ($round > $limit) {
                if ($rewritten) {
                    throw new GenerationError("The $what blueprint still has problems after {$this->repairs} corrections and a rewrite:\n- ".implode("\n- ", $problems));
                }
                // Changes did not get there: one whole rewrite, as a last resort.
                $log && $log('Rewriting the blueprint ('.count($problems).' problem'.(count($problems) === 1 ? '' : 's').' left): '.$problems[0]);
                $blueprint = $tidy($this->llm->structured($system, [
                    $brief, ['cache' => true],
                    "Here is the blueprint you wrote:\n".json_encode($blueprint, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    "It cannot be built because of these problems. Give the whole corrected blueprint, changing only what is needed:\n- ".implode("\n- ", $problems),
                ], $name, $schema, 32000));
                $rewritten = true;
                $limit = $round; // checked once more, then no more corrections

                continue;
            }
            $log && $log('Correcting the blueprint ('.count($problems).' problem'.(count($problems) === 1 ? '' : 's').'): '.$problems[0]);
            $answer = $this->llm->structured($system, [
                $brief, ['cache' => true],
                "Here is the blueprint you wrote:\n".json_encode($blueprint, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                "It cannot be built because of these problems:\n- ".implode("\n- ", $problems)."\n\nAnswer with only the changes that fix them (not the whole blueprint), changing as little as possible. Keep everything else as it is.",
            ], 'blueprint_changes', self::CHANGES_SCHEMA, 6000);
            [$changed, $failed] = self::applyChanges($blueprint, (array) ($answer['changes'] ?? []));
            if ($failed) {
                $log && $log('Some changes could not be made: '.$failed[0]);
            }
            $blueprint = $tidy($changed);
        }
    }

    /** Whether a mission may have a big tense moment: as the options say, else by chance (bigMomentChance). */
    public function pace(array $options): bool
    {
        return (bool) ($options['big_moment'] ?? ($this->random->nextFloat() < $this->bigMomentChance));
    }

    /**
     * Applies a correction's changes to a blueprint. Lists of things with keys are addressed by key,
     * other lists by position.
     *
     * @return array{0: array, 1: string[]} the changed blueprint, and the changes that could not be made
     */
    public static function applyChanges(array $b, array $changes): array
    {
        $problems = [];
        foreach ($changes as $c) {
            $op = $c['op'] ?? '';
            $path = array_values(array_filter(explode('.', (string) ($c['path'] ?? '')), fn ($p) => $p !== ''));
            $value = null;
            if ($op !== 'remove') {
                $raw = (string) ($c['value'] ?? '');
                $value = json_decode($raw, true);
                if ($value === null && trim($raw) !== 'null') {
                    // Plain text the model did not quote.
                    $value = $raw;
                }
            }
            if (! $path || ! in_array($op, ['set', 'remove', 'append'], true)) {
                $problems[] = 'A change had no path or an unknown op.';

                continue;
            }
            $last = array_pop($path);
            $parent = &$b;
            $ok = true;
            foreach ($path as $part) {
                $index = self::index($parent, $part);
                if ($index === null || ! is_array($parent[$index] ?? null)) {
                    $ok = false;
                    break;
                }
                $parent = &$parent[$index];
            }
            if (! $ok || ! is_array($parent)) {
                $problems[] = "No such place: {$c['path']}.";
                unset($parent);

                continue;
            }
            $index = self::index($parent, $last);
            if ($op === 'set') {
                $parent[$index ?? $last] = $value;
            } elseif ($op === 'remove') {
                if ($index === null) {
                    $problems[] = "Nothing to remove at {$c['path']}.";
                } else {
                    $list = array_is_list($parent);
                    unset($parent[$index]);
                    if ($list) {
                        $parent = array_values($parent);
                    }
                }
            } else {
                if ($index === null) {
                    $parent[$last] = [];
                    $index = $last;
                }
                if (! is_array($parent[$index]) || ! array_is_list($parent[$index])) {
                    $problems[] = "Not a list: {$c['path']}.";
                } else {
                    $parent[$index][] = $value;
                }
            }
            unset($parent);
        }

        return [$b, $problems];
    }

    /** Where a path part is in an array: a field, a position in a list, or the thing in a list with that key. */
    private static function index(array $a, string $part): int|string|null
    {
        if (array_key_exists($part, $a)) {
            return $part;
        }
        if (array_is_list($a)) {
            if (ctype_digit($part) && array_key_exists((int) $part, $a)) {
                return (int) $part;
            }
            foreach ($a as $i => $row) {
                if (is_array($row) && ($row['key'] ?? $row['id'] ?? null) === $part) {
                    return $i;
                }
            }
        }

        return null;
    }

    private function system(): string
    {
        return <<<'TXT'
        You design missions for Quest Lab, a multiplayer educational 2D game for school students. Students are
        space explorers from an intergalactic starship; each mission takes them somewhere (a planet, a habitat, a
        historical reconstruction, inside a cell...) to solve a problem by thinking like scientists, historians,
        mathematicians or writers. A small group can play together in the same world at once.

        Think of a classic point-and-click adventure game, with learning at its heart: places that feel alive,
        characters with something to say, a story that moves forward because of what students work out, clever
        little puzzles with things they find, and a satisfying moment each time one clicks.

        What the game can do, and so all a mission may use:
        - Scenes are side-on 2D places (like a stage set) students walk around in, with a floor in the lower part
          of the picture. A scene is outdoor, indoor, underground, up_high or underwater, and normal or wide (a
          long place the view follows students along). Behind an outdoor scene a far view (distance: sky, hills,
          a skyline) can drift slower than the scene for depth. Something big and close (foreground: the top of a
          wall we peer over, a fern in the corner) can stand in front, so students walk behind it. The floor can
          end at walls or a drop, and have things lying in it that students walk around (a pond, a crack).
          Ambient creatures add life: birds that land and peck and fly off, a cat strolling by, fish swimming past.
        - Living skies, lights and air. An outdoor scene can have a living sky (sky) drawn by the game: the sun or
          the moon and twinkling stars, clouds drifting slowly by, and it can change while students are there (a
          sunset going from gold through orange, pink and purple into a starry dusk; a dawn). Lights (lights) are
          drawn into the scene with a glow that moves: lanterns and torches flicker, a campfire flickers with
          embers rising, crystals and screens breathe slowly, a crashed ship's beacon still blinks; they shine
          fully in the dark and only a little by day. Something can be in the air (atmosphere): fireflies at
          dusk, leaves falling, snow, rain, dust floating in a sunbeam, bubbles under water.
        - Weather and water. An outdoor scene can have weather the game draws, with its own sound (weather:
          rain splashing on the ground, snow, a storm with lightning and thunder, a blizzard, fog). Water can
          move (water): a river or stream flowing across the front or the back of the floor, a pond lying in
          it, a waterfall pouring down at the back, the sea along the back; the banks are painted and the game
          makes the water flow, with its sound. Vehicles can drive by in the background (ambient drives_by: a
          tractor, a cart, a bus), with a sound (car, hooves). Use these only where the place has them.
        - Ways between scenes. Walk off an edge (left, right, top = towards the back, bottom = towards the viewer),
          or use a passage that stands in the scene: a door into a building, a gate, a cave mouth, a portal, a
          tunnel, a ladder or stairs up, or a hole, hatch or stairs down in the floor (students jump into a hole!).
          Every way is two-way: list each connection once, from either scene, and the way back is added for you.
          Use passages where the story calls for them. A way can stay closed until something is done.
        - Characters (NPCs) are in one scene; students click them to talk. One is the guide, who briefs everyone
          at the start and hears their report at the end. Each has a real height (height_cm) and is drawn
          standing, walking and in a close-up portrait. A character can stroll between spots in their scene on
          their own (walks) and say lines to themselves now and then (chatter). Each has a voice of their own,
          chosen from what you say of it (voice) and recorded: make the cast sound like a cartoon,
          theatrical and each unmistakable (a booming giant, a squeaky pixie, a zany inventor, a haughty queen),
          and write their lines to be performed that way.
        - The bag. Students carry what they collect (and what characters or discoveries give them), and can:
          use a thing on something in the scene (use: oil on a rusty latch, a magnet on a well, a seed in a
          planter), give a thing to a character (use with character: the lost glasses to the professor, who can
          now read the map), or put two things together to make a new one (combinations: a lens and a tube make a
          telescope). What it is used on says what is needed if clicked without it (hint), and can hand
          something new over (gives). That is the heart of a good puzzle: notice a problem, find or make the
          thing that solves it, and see what happens.
        - Cutscenes. After any interaction, twist or the ending, a little scene can play for everyone there:
          characters (or the student) walk somewhere, say a line, wave or cheer or spin, wait, leave, or fall
          (slip out of sight off a cliff, into a crevasse). Use them so the world reacts: the gate swings open and
          the keeper strolls through; the robot zooms to the fixed pump and does a happy spin; the fisherman,
          hearing the news, packs up and leaves.
        - Arrivals. The first time students come into a scene, something can happen (arrival): a title, a few
          lines, a cutscene: a welcome, a surprise, a little show. Where the pace allows a big moment, it can be
          tense: the ranger steps too close to the edge and slips, and is left clinging to a root below. Someone
          who falls is out of reach until students save them with an interaction that rescues them, usually with
          what they gather and build right there.
        - Interactions are things students click: talk, collect (pick a thing up into the bag), inspect (look
          closely and learn), use (a thing from the bag on something, or given to someone), question (multiple
          choice, with feedback on every answer; students may try again until right), experiment (a hands-on
          instrument, below), team_task (several students each do a part; everyone in the scene sees the
          progress). Something hidden only appears when a student walks close. Things to click are marked with a
          small, quiet question mark and named when the pointer is over them; you do not need to describe markers.
          Nothing pulses or flashes.
        - Instruments (experiment). A big panel with its parts side by side, built for the scene: sliders to set
          a number (no typing), switches, a wheel of chance to spin, bars that show a value. What it shows
          changes the moment a control moves (shows: "the bulb glows dimly", "the rope is too short to reach"),
          and a test button tries it; a wrong try says why (misses) and lets students adjust. Examples: a pulley
          with sliders for rope length and the number of wheels; a circuit board of switches and a battery slider;
          a seed-spreading wheel of wind directions; a paint mixer with three colour sliders; a raft with a
          slider for the load and a switch for the outrigger. Two to four controls is usual; let students find
          the goal by noticing what changes, not by guessing.
        - Rich observations. What students observe (info) can add a coloured note (callout: a tip, a did-you-know
          fact, a careful, a think-about-it), up to four flip cards (a word and its meaning, a question and its
          answer), a card that opens to reveal an answer after students think, and a large picture of one of the
          mission's items.
        - Details. Up to five things per scene that students can click just to read about (details): painted in,
          named when the pointer is over them, with a line of what the student notices. Use them for colour,
          jokes and red herrings. They never go into the bag and never count.
        - Twists and turns: a surprise right after something is done. A twist makes things harder (fog hides the
          landmarks, the labels were swapped, a magpie steals the tool); a turn changes luck or a heart (a gust
          knocks down just the branch needed, the grumpy keeper turns out to help). It is announced, characters
          react, and it can close a way and put an obstacle in the scene until something students do sets it
          right.
        - Requirements chain things: an interaction can require others (or a twist, a combination) first. The
          checklist (steps) shows progress.
        - Students earn stars and XP through awards; be modest (1-5 stars, 5-25 XP; completion up to 10 and 50).

        Design rules:
        - The learning is the gameplay. Every learning objective must be checked by at least one scored question
          or experiment whose "objective" names it, and the observations students make (info) must contain the
          evidence they need to answer. Puzzles should turn on what they are learning where they can: the thing
          that fixes the pump works because of the science; the character needs the fact students found. Content
          must be scientifically and historically accurate and at the grade level: short sentences, concrete
          examples, vocabulary defined in context.
        - Assess, don't just tell. Ask questions right after the observation they are about (after). Before an
          experiment or discovery, a prediction question (purpose predict) makes students commit to an idea first.
          End with 1 to 3 debrief questions (at_report) the guide asks when students report back: they ask
          students to explain or apply what they found, not to recall a word. Surface the listed misconceptions
          in wrong-answer feedback, without giving the answer away.
        - Make it an adventure. Include at least two puzzles with the bag (use, give, or a combination), each
          with a hint and a cutscene or dialogue that shows what happened. Make the story move forward because of
          them: a way opens, a character changes their mind, something new is found. Include one twist or turn
          (two in a long mission) that changes the plan and teaches something on the way. Invent at least one
          for this mission from what is special about its place, its people and its topic: the ideas you are
          given show the range, not a menu. Add one or two hidden
          discoveries for the curious. Vary the places: inside and outside, up high and underground.
        - Every thing in the bag helps solve the mission: it is used on something, given to someone, or put
          together into something that is. Collect only what will be used. Red herrings are fine, but only as
          details or inspects, never as things to pick up. A thing that looks like nothing much can still turn
          out to matter (a quiet inspect, with no question mark, that gives something).
        - Find what is special about this place, and let it put exactly what students need in their path: the
          way things are placed (the vines hang right above the gap), a property of this place (the rocks here
          are magnetic, the tide goes out at noon), or luck (a wheel of chance, a storm that blows a branch
          down). Big tense moments (someone fallen, trapped or swept away, whom students save by gathering what
          is around and building something with what they learn) are rare: only when the brief's pace allows
          one, and never more than one. Exciting, never frightening: nobody is hurt, and help is always close.
        - Cutscenes (cutscenes, optional, at most two, short): where the story turns, the student can be
          taken to a page that plays by itself, told in panels like a comic, then brought back. The opening
          hook (when intro: under about 20 seconds, students must be playing within a minute or two) or the
          payoff after a big discovery (when: that interaction). Frame them as a storyteller would: a wide
          panel of the place, then a close-up as the truth dawns; the same panel again with one thing changed
          (continues + changes: the vault door now open); an insert of the clue in someone's hand (show); a
          memory (show, tone memory); a camera push in for tension. Never more than about 20 seconds on one
          still picture. Most missions need none: tell the story through what students find and do.
        - Make the scenes feel alive, and a little funny, from what this place would really have moving in it.
          Read the setting and the story: a camp at night has a campfire and lanterns, maybe fireflies; a crashed
          ship has beacons still blinking inside and out; a cave has glowing crystals; an autumn wood has falling
          leaves; a mission that ends at the close of day can have its sun set while students work. Give most
          outdoor scenes a living sky at a time that suits the story, with clouds unless it is clear or night.
          Keep it subtle: a few lights where there would be lights, not everywhere. A light can be part of the
          story: one that comes on once students have done something (on_after: the beacon once the power is
          fixed, the lighthouse relit) or goes out when something happens (off_after: the campfire the storm
          puts out). Use this where switching the light on or off is the reward or the sign of a change, now
          and then, not for every light. In most scenes add one or two
          ambient creatures, and use a ready-made one from the asset library (ambient library) whenever one fits
          the place: a bluebird or two that land (lands, count 2-3), a squirrel that runs up a tree (climbs: then
          the background must show a tree standing out on the floor), a cat strolling by, a car or a horse and
          cart driving by. Draw one only when nothing in the library fits (a rabbit that hides in the bushes:
          motion hides, and the background must show two or more bushes standing out on the floor). Add one
          or two extra characters who are not needed for the plot but give the place depth: a busker, a bored
          guard, a gossiping neighbour, a chef muttering about soup; give them chatter and an optional talk with
          a joke or a bit of local colour (not in a required step). Let some characters walk about (walks). Add a
          couple of fun things to click that have nothing to do with the lesson (an inspect of a silly statue, a
          vending machine that only sells socks).
        - Depth and size. Use a foreground in one or two scenes where it fits the place; make one or two scenes
          wide with a distance where a journey fits; give floors that are not simply open a floor (walls, a drop,
          a pond). Everything has its real size beside 130 cm students: give items size_cm and characters
          height_cm, and describe backgrounds as seen from a few metres away (a house fills much of the picture's
          height, a mountain is far off), so nothing is enormous next to the people in it.
        - With 2 or more students, a team_task can make them work together where it fits the story; it is not
          needed. Never split students into roles: every student can do everything.
        - 3 to 6 scenes for a 30-45 minute mission unless told otherwise; 3 to 6 characters; every scene has
          something to do. Place interactions and passages apart from each other across the width (x between 0.15
          and 0.85, at least 0.15 apart in a scene), and away from the edges students leave by.
        - Character appearance and item appearance describe only what they look like; never describe an art style,
          medium or rendering. Backgrounds are empty of characters. No text, signs with words, logos or real brands
          in any picture. Keep everything friendly for children: no weapons, gore or frightening imagery; a twist
          is exciting, never scary.
        - Dialogue is warm and brief (one or two sentences a line), in character, often a little funny, and never
          talks down to students.
        - Keys are lowercase with underscores, unique across interactions, combinations, steps and twists.
        TXT."\n\n".DesignRules::missionRules();
    }

    private function brief(string $prompt, array $alignment, array $options, array $pace = ['big_moment' => false]): string
    {
        $lines = ["Teacher's request: $prompt", ''];
        foreach (['grade' => 'Grade', 'subject' => 'Subject'] as $k => $label) {
            if (! empty($options[$k])) {
                $lines[] = "$label: {$options[$k]}";
            }
        }
        if ($stage = DesignRules::stage($options['grade'] ?? null)) {
            $lines[] = $stage;
        }
        $min = (int) ($options['min_players'] ?? 2);
        $lines[] = sprintf('Players: %d to %d students together.', $min, $options['max_players'] ?? 6);
        if ($min < 2) {
            $lines[] = 'A student may play alone: anything a team does must also be possible for one student.';
        }
        if (! empty($options['scenes'])) {
            $lines[] = "Number of scenes: exactly {$options['scenes']}.";
        }
        if (! empty($options['minutes'])) {
            $lines[] = "Playing time: about {$options['minutes']} minutes.";
        }
        if (! empty($options['notes'])) {
            $lines[] = "Also: {$options['notes']}";
        }
        array_push($lines, ...DesignRules::briefLines($options));
        $lines[] = '';
        if ($alignment['standards']) {
            $lines[] = 'Standards this mission is built around:';
            foreach ($alignment['standards'] as $s) {
                $lines[] = "- {$s['code']} ({$s['alignment']}): {$s['description']}";
            }
        }
        $lines[] = 'Learning objectives (each must be checked by a question or experiment):';
        foreach ($alignment['learning_objectives'] as $lo) {
            $lines[] = "- {$lo['id']}: {$lo['text']}".($lo['standards'] ? ' ['.implode(', ', $lo['standards']).']' : '');
        }
        if ($alignment['vocabulary']) {
            $lines[] = 'Vocabulary to use and define in context: '.implode('; ', array_map(fn ($v) => "{$v['term']} ({$v['definition']})", $alignment['vocabulary']));
        }
        if ($alignment['misconceptions']) {
            $lines[] = 'Misconceptions to surface: '.implode('; ', $alignment['misconceptions']);
        }
        $lines[] = '';
        $lines[] = $pace['big_moment']
            ? 'Pace: this mission may have one big tense moment (someone in trouble whom students save: fallen, trapped or swept away), or none. Never more than one.'
            : 'Pace: nobody is in danger in this mission: nobody falls, is trapped or is swept away. Its surprises are smaller and come from the place and the topic.';
        $lines[] = 'Twists and turns from other missions, to show the range (do not reuse one as it is; at least one twist in this mission must be invented for it, out of its place, its story and its topic, and marked invented):';
        foreach (TwistIdeas::pick($this->random, 6, $pace['big_moment']) as $idea) {
            $lines[] = "- {$idea['name']}: {$idea['what']} ({$idea['teaches']})";
        }

        return implode("\n", $lines);
    }

    /** A cutscene's beats, without empty fields. */
    private static function beats(mixed $beats): array
    {
        $out = [];
        foreach ((array) $beats as $beat) {
            if (! is_array($beat) || empty($beat['who']) || empty($beat['do'])) {
                continue;
            }
            $out[] = array_filter($beat, fn ($v) => $v !== '' && $v !== null && $v !== []);
        }

        return $out;
    }

    /** What students observe, without the rich parts left empty. */
    private static function info(array $info): array
    {
        if (isset($info['callout']) && (! is_array($info['callout']) || trim((string) ($info['callout']['text'] ?? '')) === '')) {
            unset($info['callout']);
        }
        if (isset($info['cards'])) {
            $info['cards'] = array_values(array_filter((array) $info['cards'], fn ($c) => is_array($c) && trim((string) ($c['front'] ?? '')) !== '' && trim((string) ($c['back'] ?? '')) !== ''));
            if (! $info['cards']) {
                unset($info['cards']);
            }
        }
        if (isset($info['reveal']) && (! is_array($info['reveal']) || trim((string) ($info['reveal']['prompt'] ?? '')) === '')) {
            unset($info['reveal']);
        }
        if (($info['picture'] ?? null) === '') {
            unset($info['picture']);
        }

        return $info;
    }

    /**
     * An experiment's instrument, tidied: numbers as numbers, a wheel's options free of the characters
     * that separate them, and an older-style experiment (one value moved up and down to a target) made
     * into an instrument with one slider.
     */
    private static function instrument(array $it): array
    {
        $x = $it['instrument'] ?? null;
        if (! is_array($x) && is_array($it['experiment'] ?? null)) {
            $old = $it['experiment'];
            $x = [
                'controls' => [['key' => 'value', 'kind' => 'slider', 'label' => $old['quantity'] ?? 'Value', 'min' => $old['min'] ?? 0, 'max' => $old['max'] ?? 10, 'step' => 1, 'start' => $old['start'] ?? 0, 'unit' => $old['unit'] ?? '']],
                'goal' => [['control' => 'value', 'op' => '=', 'value' => $old['target'] ?? 0]],
                'test' => 'Try it',
                'success' => $old['success'] ?? '',
                'objective' => $old['objective'] ?? null,
            ];
        }
        if (! is_array($x)) {
            return [];
        }
        $number = fn ($v) => is_numeric($v) ? $v + 0 : $v;
        $conditions = fn ($list) => array_values(array_map(
            fn ($c) => ['control' => (string) ($c['control'] ?? ''), 'op' => (string) ($c['op'] ?? '='), 'value' => is_string($c['value'] ?? null) ? $number(trim($c['value'])) : ($c['value'] ?? '')],
            array_filter((array) $list, 'is_array'),
        ));
        $controls = [];
        foreach (array_filter((array) ($x['controls'] ?? []), 'is_array') as $c) {
            foreach (['min', 'max', 'step', 'start'] as $k) {
                if (isset($c[$k]) && is_numeric($c[$k])) {
                    $c[$k] = $c[$k] + 0;
                } else {
                    unset($c[$k]);
                }
            }
            if (($c['kind'] ?? '') === 'wheel') {
                $c['options'] = array_values(array_filter(array_map(fn ($o) => trim(str_replace(['|', ';', ',', '"', '<', '>'], ' ', (string) $o)), (array) ($c['options'] ?? [])), fn ($o) => $o !== ''));
            } else {
                unset($c['options']);
            }
            if (($c['kind'] ?? '') !== 'slider') {
                unset($c['unit'], $c['min'], $c['max'], $c['step']);
            }
            $controls[] = $c;
        }
        $x['controls'] = $controls;
        $x['goal'] = $conditions($x['goal'] ?? []);
        foreach (['shows', 'misses'] as $k) {
            $x[$k] = array_values(array_map(
                fn ($r) => ['when' => $conditions($r['when'] ?? []), 'text' => trim((string) ($r['text'] ?? ''))],
                array_filter((array) ($x[$k] ?? []), fn ($r) => is_array($r) && trim((string) ($r['text'] ?? '')) !== ''),
            ));
            if (! $x[$k]) {
                unset($x[$k]);
            }
        }
        if (isset($x['meters'])) {
            $x['meters'] = array_values(array_filter((array) $x['meters'], fn ($m) => is_array($m) && ! empty($m['control'])));
            if (! $x['meters']) {
                unset($x['meters']);
            }
        }
        foreach (['title', 'objective'] as $k) {
            if (($x[$k] ?? null) === '' || ($x[$k] ?? false) === null) {
                unset($x[$k]);
            }
        }

        return $x;
    }

    /**
     * Rescues: someone who falls is out of reach until they are saved, so whatever needs them (a talk
     * with them, a thing given to them) waits for the rescue, unless it comes before what makes them
     * fall; and a rescue of someone who falls after an interaction waits for that interaction.
     */
    private static function rescues(array $b): array
    {
        // Who falls, and after which interaction (null: on arriving in the scene, or after a twist).
        $falls = [];
        foreach ($b['interactions'] as $it) {
            foreach ($it['cutscene'] ?? [] as $beat) {
                if (($beat['do'] ?? '') === 'fall' && ($beat['who'] ?? 'player') !== 'player') {
                    $falls[$beat['who']] ??= $it['key'] ?? null;
                }
            }
        }
        foreach ([...$b['scenes'], ...array_map(fn ($t) => ['arrival' => ['cutscene' => $t['cutscene'] ?? []]], $b['twists'])] as $s) {
            foreach ($s['arrival']['cutscene'] ?? [] as $beat) {
                if (($beat['do'] ?? '') === 'fall' && ($beat['who'] ?? 'player') !== 'player') {
                    $falls[$beat['who']] ??= null;
                }
            }
        }
        // Someone who falls stands still until then: they come back where they stood.
        foreach ($b['characters'] as &$c) {
            if (array_key_exists($c['key'] ?? '', $falls)) {
                unset($c['walks'], $c['wanders']);
            }
        }
        unset($c);
        $rescuers = [];
        foreach ($b['interactions'] as $it) {
            if (! empty($it['rescues']) && array_key_exists($it['rescues'], $falls)) {
                $rescuers[$it['rescues']] ??= $it['key'];
            }
        }
        $byKey = array_column($b['interactions'], null, 'key');
        foreach ($b['interactions'] as &$it) {
            if (! empty($it['rescues']) && ($after = $falls[$it['rescues']] ?? null) && ! in_array($after, $it['requires'], true)) {
                $it['requires'][] = $after;
            }
            $who = $it['character'] ?? null;
            $rescue = $who ? ($rescuers[$who] ?? null) : null;
            if (! $rescue || $rescue === ($it['key'] ?? null) || ! in_array($it['type'] ?? '', ['talk', 'use'], true) || in_array($rescue, $it['requires'], true)) {
                continue;
            }
            // Before the fall: what the falling waits for, directly.
            $fall = $falls[$who];
            if ($fall && ($fall === ($it['key'] ?? null) || in_array($it['key'] ?? null, $byKey[$fall]['requires'] ?? [], true))) {
                continue;
            }
            $it['requires'][] = $rescue;
        }
        unset($it);

        return $b;
    }

    /** Small things the model gets wrong that need no second opinion. */
    public static function tidy(array $b): array
    {
        foreach (['scenes', 'characters', 'items', 'interactions', 'steps', 'twists', 'combinations'] as $list) {
            $b[$list] = array_values(array_filter($b[$list] ?? [], 'is_array'));
        }
        // Crew roles are no longer made: every student can do everything (a teacher can still split the work).
        unset($b['roles']);
        if (! $b['combinations']) {
            unset($b['combinations']);
        }
        // A single guide: if the model marked none, the first character who speaks in the intro is it.
        if (! array_filter($b['characters'], fn ($c) => ! empty($c['guide'])) && $b['characters']) {
            $speaker = $b['intro']['dialogue'][0]['speaker'] ?? $b['characters'][0]['key'];
            foreach ($b['characters'] as &$c) {
                $c['guide'] = $c['key'] === $speaker;
            }
            unset($c);
        }
        $guideScene = null;
        foreach ($b['characters'] as &$c) {
            if (! empty($c['guide'])) {
                // The guide stays where students can find them.
                unset($c['wanders'], $c['walks']);
                $guideScene ??= $c['scene'] ?? null;
            }
            $c['height_cm'] = Sizes::characterCm($c);
            if (isset($c['walks'])) {
                $c['walks'] = array_values(array_filter((array) $c['walks'], 'is_numeric'));
                if (count($c['walks']) < 2) {
                    unset($c['walks']);
                }
            }
            if (isset($c['chatter'])) {
                $c['chatter'] = array_values(array_filter((array) $c['chatter'], fn ($l) => is_string($l) && trim($l) !== ''));
                if (! $c['chatter']) {
                    unset($c['chatter']);
                }
            }
        }
        unset($c);
        foreach ($b['items'] as &$item) {
            if (empty($item['size_cm']) && isset($item['size'])) {
                $item['size_cm'] = Sizes::cm($item);
            }
        }
        unset($item);
        foreach ($b['interactions'] as &$it) {
            $it['requires'] = array_values(array_unique(array_filter((array) ($it['requires'] ?? []), fn ($r) => is_string($r) && $r !== '')));
            // Crew roles and the crew log are gone.
            unset($it['role'], $it['share']);
            foreach (['item', 'character', 'after', 'locked_hint', 'dialogue', 'x', 'resolves', 'placement', 'uses', 'gives', 'hint', 'look', 'cutscene', 'rescues', 'quiet'] as $k) {
                if (isset($it[$k]) && ($it[$k] === '' || $it[$k] === [] || ($k === 'x' && ! $it[$k]))) {
                    unset($it[$k]);
                }
            }
            if (isset($it['cutscene'])) {
                $it['cutscene'] = self::beats($it['cutscene']);
            }
            // A collect puts its own item in the bag; it gives nothing else.
            if (($it['type'] ?? '') === 'collect') {
                unset($it['gives']);
            }
            if (($it['type'] ?? '') !== 'use') {
                unset($it['uses'], $it['keeps'], $it['hint']);
            }
            if (($it['type'] ?? '') !== 'inspect') {
                unset($it['quiet']);
            }
            if (isset($it['info']) && is_array($it['info'])) {
                $it['info'] = self::info($it['info']);
            }
            if (($it['type'] ?? '') === 'experiment') {
                $it['instrument'] = self::instrument($it);
                if (! $it['instrument']) {
                    unset($it['instrument']);
                }
            } else {
                unset($it['instrument']);
            }
            unset($it['experiment']);
            if (isset($it['placement']) && ! in_array($it['placement'], Sizes::PLACEMENTS, true)) {
                unset($it['placement']);
            }
            // An award of nothing is no award.
            if (isset($it['award']) && empty($it['award']['stars']) && empty($it['award']['xp'])) {
                unset($it['award']);
            }
            // Whatever sets a twist right only appears once the twist has happened.
            if (! empty($it['resolves']) && ! in_array($it['resolves'], $it['requires'], true)) {
                $it['requires'][] = $it['resolves'];
            }
            if (($it['type'] ?? '') === 'question') {
                if (($it['question']['purpose'] ?? 'check') === 'predict' && is_array($it['question']['choices'] ?? null)) {
                    foreach ($it['question']['choices'] as &$choice) {
                        $choice['correct'] = false;
                    }
                    unset($choice);
                }
                // A debrief question is the guide's: asked where the guide is, when the crew reports back.
                if (! empty($it['at_report'])) {
                    if ($guideScene) {
                        $it['scene'] = $guideScene;
                    }
                    unset($it['x'], $it['after'], $it['placement'], $it['hidden'], $it['locked_hint']);
                    $it['requires'] = [];
                } else {
                    unset($it['at_report']);
                }
            } else {
                unset($it['at_report']);
            }
            if (($it['type'] ?? '') === 'team_task' && isset($it['team'])) {
                unset($it['team']['roles']);
            }
        }
        unset($it);
        $b = self::rescues($b);
        foreach ($b['steps'] as &$step) {
            if (($step['after'] ?? null) === '') {
                unset($step['after']);
            }
        }
        unset($step);
        foreach ($b['twists'] as &$t) {
            foreach (['blocks', 'obstacle', 'award', 'notice'] as $k) {
                if (isset($t[$k]) && ($t[$k] === '' || $t[$k] === [] || (is_array($t[$k]) && ($k === 'blocks' ? empty($t[$k]['to']) : ($k === 'obstacle' ? empty($t[$k]['item']) : false))))) {
                    unset($t[$k]);
                }
            }
            if (isset($t['award']) && empty($t['award']['stars']) && empty($t['award']['xp'])) {
                unset($t['award']);
            }
            if (isset($t['cutscene'])) {
                $t['cutscene'] = self::beats($t['cutscene']);
                if (! $t['cutscene']) {
                    unset($t['cutscene']);
                }
            }
        }
        unset($t);
        if (isset($b['completion']['cutscene'])) {
            $b['completion']['cutscene'] = self::beats($b['completion']['cutscene']);
            if (! $b['completion']['cutscene']) {
                unset($b['completion']['cutscene']);
            }
        }
        foreach ($b['combinations'] ?? [] as $i => $c) {
            $b['combinations'][$i]['items'] = array_values(array_filter((array) ($c['items'] ?? []), 'is_string'));
        }
        foreach ($b['scenes'] as &$s) {
            $s = self::tidyScene($s);
            $s['exits'] = array_values(array_filter($s['exits'] ?? [], 'is_array'));
            foreach ($s['exits'] as &$x) {
                foreach (['requires', 'locked_message', 'label', 'look', 'back', 'via', 'edge'] as $k) {
                    if (($x[$k] ?? null) === '' || ($x[$k] ?? null) === []) {
                        unset($x[$k]);
                    }
                }
                $x['via'] ??= 'edge';
                if ($x['via'] === 'edge') {
                    unset($x['x'], $x['look'], $x['label'], $x['back']);
                } else {
                    unset($x['edge']);
                }
            }
            unset($x);
        }
        unset($s);

        return $b;
    }

    /**
     * How a scene looks, tidied (for missions and stories alike): its kind and width, its far view and
     * foreground, its life, sky, lights, air, weather and water, without what is empty or makes no sense.
     */
    public static function tidyScene(array $s): array
    {
        if (! in_array($s['kind'] ?? null, Sizes::SCENE_KINDS, true)) {
            $s['kind'] = ! empty($s['indoor']) ? 'indoor' : 'outdoor';
        }
        if (! in_array($s['width'] ?? null, BlueprintSchema::WIDTHS, true)) {
            unset($s['width']);
        }
        foreach (['distance', 'foreground', 'floor', 'ambient', 'arrival', 'details', 'sky', 'lights', 'atmosphere', 'weather', 'water'] as $k) {
            if (isset($s[$k]) && ($s[$k] === '' || $s[$k] === [] || (is_array($s[$k]) && $k === 'foreground' && empty($s[$k]['look'])))) {
                unset($s[$k]);
            }
        }
        // A place to build: known tools, once each; pieces as keys. Half-filled (no task) is no build.
        if (isset($s['build'])) {
            $build = is_array($s['build']) ? $s['build'] : [];
            $tools = array_values(array_unique(array_filter((array) ($build['tools'] ?? []), fn ($t) => in_array($t, BlueprintSchema::BUILD_TOOLS, true))));
            $pieces = array_values(array_unique(array_filter((array) ($build['pieces'] ?? []), fn ($p) => is_string($p) && trim($p) !== '')));
            if (trim((string) ($build['prompt'] ?? '')) === '' && ! $tools) {
                unset($s['build']);
            } else {
                $s['build'] = ['prompt' => trim((string) ($build['prompt'] ?? '')), 'tools' => $tools] + ($pieces ? ['pieces' => $pieces] : []);
            }
        }
        if (isset($s['ambient'])) {
            $s['ambient'] = array_values(array_filter((array) $s['ambient'], fn ($a) => is_array($a) && ! empty($a['look'])));
            if (! $s['ambient']) {
                unset($s['ambient']);
            }
        }
        if (isset($s['arrival'])) {
            $s['arrival'] = array_filter([
                'title' => trim((string) ($s['arrival']['title'] ?? '')),
                'dialogue' => array_values(array_filter((array) ($s['arrival']['dialogue'] ?? []), fn ($l) => is_array($l) && trim((string) ($l['text'] ?? '')) !== '')),
                'cutscene' => self::beats($s['arrival']['cutscene'] ?? []),
            ]);
            if (! $s['arrival']) {
                unset($s['arrival']);
            }
        }
        // A living sky only where there is a sky to see; lights and the air without what makes no sense.
        if (isset($s['sky'])) {
            $time = $s['sky']['time'] ?? null;
            if (! in_array($time, BlueprintSchema::SKY_TIMES, true) || ! in_array(Sizes::sceneKind($s), ['outdoor', 'up_high'], true)) {
                unset($s['sky']);
            } else {
                $s['sky'] = array_filter([
                    'time' => $time,
                    'until' => in_array($s['sky']['until'] ?? null, BlueprintSchema::SKY_TIMES, true) && $s['sky']['until'] !== $time ? $s['sky']['until'] : null,
                    'clouds' => in_array($s['sky']['clouds'] ?? null, ['none', 'few', 'many'], true) ? $s['sky']['clouds'] : 'few',
                ]);
            }
        }
        if (isset($s['lights'])) {
            $lights = [];
            foreach ((array) $s['lights'] as $l) {
                if (is_array($l) && isset(BlueprintSchema::LIGHTS[$l['kind'] ?? '']) && trim((string) ($l['look'] ?? '')) !== '' && is_numeric($l['x'] ?? null)) {
                    $l['x'] = max(0.05, min(0.95, (float) $l['x']));
                    if (! preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($l['color'] ?? ''))) {
                        unset($l['color']);
                    }
                    if (! in_array($l['placement'] ?? '', ['ground', 'back', 'wall'], true)) {
                        unset($l['placement']);
                    }
                    // When it comes on or goes out: keys only, and not the same moment for both.
                    foreach (['on_after', 'off_after'] as $when) {
                        if (isset($l[$when]) && (! is_string($l[$when]) || trim($l[$when]) === '')) {
                            unset($l[$when]);
                        }
                    }
                    if (isset($l['on_after'], $l['off_after']) && $l['on_after'] === $l['off_after']) {
                        unset($l['off_after']);
                    }
                    $lights[] = $l;
                }
            }
            $s['lights'] = array_slice($lights, 0, 4);
            if (! $s['lights']) {
                unset($s['lights']);
            }
        }
        if (isset($s['atmosphere'])) {
            $air = [];
            foreach ((array) $s['atmosphere'] as $a) {
                if (is_array($a) && in_array($a['kind'] ?? '', BlueprintSchema::ATMOSPHERES, true) && ! in_array($a['kind'], array_column($air, 'kind'), true)) {
                    $air[] = array_filter(['kind' => $a['kind'], 'amount' => in_array($a['amount'] ?? null, ['few', 'some', 'many'], true) ? $a['amount'] : null]);
                }
            }
            $s['atmosphere'] = array_slice($air, 0, 2);
            if (! $s['atmosphere']) {
                unset($s['atmosphere']);
            }
        }
        if (isset($s['details'])) {
            $details = [];
            foreach ((array) $s['details'] as $d) {
                if (is_array($d) && trim((string) ($d['label'] ?? '')) !== '' && trim((string) ($d['text'] ?? '')) !== '' && is_numeric($d['x'] ?? null)) {
                    $d['x'] = max(0.1, min(0.9, (float) $d['x']));
                    if (! in_array($d['placement'] ?? 'back', ['back', 'ground'], true)) {
                        unset($d['placement']);
                    }
                    $details[] = $d;
                }
            }
            $s['details'] = array_slice($details, 0, 5);
            if (! $s['details']) {
                unset($s['details']);
            }
        }
        if (isset($s['floor']['blocked'])) {
            $s['floor']['blocked'] = array_values(array_filter((array) $s['floor']['blocked'], 'is_array'));
        }
        // The weather only where it falls; water only where it can lie in the floor.
        if (isset($s['weather'])) {
            $w = (array) $s['weather'];
            if (! in_array($w['kind'] ?? '', BlueprintSchema::WEATHERS, true) || ! in_array(Sizes::sceneKind($s), BlueprintSchema::WEATHER_KINDS, true)) {
                unset($s['weather']);
            } else {
                $s['weather'] = array_filter(['kind' => $w['kind'], 'intensity' => isset(BlueprintSchema::INTENSITY[$w['intensity'] ?? '']) ? $w['intensity'] : null]);
            }
        }
        if (isset($s['water'])) {
            $w = (array) $s['water'];
            $kind = $w['kind'] ?? '';
            if (! in_array($kind, BlueprintSchema::WATERS, true)) {
                unset($s['water']);
            } else {
                $where = $kind === 'waterfall' ? 'back' : (in_array($w['where'] ?? '', BlueprintSchema::WATER_PLACES, true) ? $w['where'] : (in_array($kind, ['pond', 'lake'], true) ? 'middle' : 'front'));
                if (in_array($kind, ['pond', 'lake'], true) && $where === 'front') {
                    $where = 'middle';
                }
                $s['water'] = array_filter([
                    'kind' => $kind, 'where' => $where,
                    'x' => is_numeric($w['x'] ?? null) ? max(0.2, min(0.8, (float) $w['x'])) : (($where === 'middle' || $kind === 'waterfall') ? 0.5 : null),
                    'width' => is_numeric($w['width'] ?? null) ? max(0.1, min(0.5, (float) $w['width'])) : null,
                    'flows' => in_array($w['flows'] ?? '', ['left', 'right'], true) ? $w['flows'] : null,
                    'look' => trim((string) ($w['look'] ?? '')) ?: 'its banks',
                    'color' => preg_match('/^#[0-9a-fA-F]{6}$/', (string) ($w['color'] ?? '')) ? $w['color'] : null,
                ], fn ($v) => $v !== null);
            }
        }
        foreach ($s['ambient'] ?? [] as $i => $a) {
            if (isset($a['sound']) && ! in_array($a['sound'], BlueprintSchema::SOUNDS, true)) {
                unset($s['ambient'][$i]['sound']);
            }
            // A library animal that cannot do what was asked is drawn instead.
            if (isset($a['library']) && ! in_array($a['motion'] ?? '', LibraryCritters::CATALOGUE[$a['library']][1] ?? [], true)) {
                unset($s['ambient'][$i]['library']);
            }
            if (isset($a['cue']) && ! $a['cue']) {
                unset($s['ambient'][$i]['cue']);
            }
        }

        return $s;
    }

    private function storySystem(): string
    {
        return <<<'TXT'
        You write stories for Quest Lab, an educational 2D game for school students, that play like an
        animated picture book: students watch and listen while it is acted out, scene after scene. Nobody
        plays a character; there are no avatars, puzzles or questions during the story. A teacher asked
        for a story to be told: tell it well, with learning at its heart.

        What a story scene can do (and so all a story may use):
        - Each scene is a side-on 2D place, like a stage set, painted in the house style: outdoor, indoor,
          underground, up_high or underwater, normal or wide (a long place the view travels along). Behind
          an outdoor scene a far view (distance) can drift for depth; something close (foreground) can stand
          in front. The view follows whoever is acting.
        - Characters act it out: they stand on the stage when it opens (cast), come on from the left or
          right edge (enter), walk about (walk), say lines in speech bubbles (say, to someone, turning to
          them), make gestures (wave, point, cheer, think, jump, spin, dance) and walk off (leave). Each is
          drawn standing and walking at their real height (height_cm) and has a voice of their own; their
          lines are read aloud.
        - A narrator links the moments (narrate): short captions read aloud. Big words across the screen
          (title) mark a change of time or place, sparingly.
        - The place is alive and can change as the story goes: a living sky (sky: a time of day, slowly
          becoming another: a sunset into a starry dusk), lights that flicker or glow (lights), things in
          the air (atmosphere: fireflies, falling leaves, dust), weather with its own sound (weather: rain
          splashing on the ground, snow, a storm with lightning and thunder, a blizzard, fog) that a beat
          can start, change or stop (weather beat), water that flows (water: a river or stream, a pond, a
          waterfall, the sea), creatures and vehicles that pass (ambient: birds that land and fly off, a
          cat strolling by, fish, a cart or a bus driving by; with cue, only when a pass beat says), and
          sound effects at the right moment (sound: thunder, a door, a knock, a bell, a car, a splash,
          footsteps, a magic chime...).
        - Each scene plays its script, then the story moves on to the next scene by itself. After the last
          one comes "The End" and a few questions for the class to talk about.
        - Scenes are framed like the panels of a comic or the shots of a film: a wide shot (the whole place)
          or a close-up (shot close: the characters twice as big, for a face, a reaction, hands doing
          something). A scene can continue an earlier one (continues): the same place from the same view a
          moment later, everything where it was unless its changes say what is different in the picture (the
          raven now perches on the bookshelf; the candle has burned low) or its script moves people. A picture
          can be shown full-screen for a moment (show: an insert, with narration over it, the camera moving
          slowly across it, tinted as a memory or a dream), and the view can push in on someone or pull back
          (camera).

        Storytelling devices to use with them (choose what serves this story, two or three at most):
        - Establish, then go close: open a place wide, then a close-up on whoever feels most.
        - The reveal: the same panel again with one thing changed (continues + changes), a beat of silence
          (wait), then the reaction in a close-up.
        - Before and after, time passing: continue a scene with the season, the light or the room changed
          (a title like "Ten years later..." sparingly).
        - The insert: show the clue, the letter, the tiny detail in someone's hand, so students notice it.
        - Flashback and imagination: show with tone memory or dream, while the narrator speaks.
        - Dramatic irony: show students something a character cannot see (the storm gathering behind them).
        - Rising tension: shorter beats, a camera push_in, a sound (thunder, a knock), a wait.
        - Cross-cutting: alternate short scenes in two places to show things happening at the same time.
        - A cliffhanger at the end of a scene, answered in the next.
        Never leave one still picture up for more than about 20 seconds: a close-up's whole script fits in
        about 20 seconds (carry on in a panel that continues it), and an insert stays at most 20 seconds,
        with only a sentence or two read over it.

        How to write it:
        - Show, don't only tell. Each scene is acted out: characters come and go, react, talk to each
          other, gesture, and the place reacts (the rain starts as the argument begins, a bus splashes
          through a puddle, the sun sets as they walk home). The narrator links moments and says what we
          cannot see, in one or two short sentences at a time; most of the story is in what characters do
          and say.
        - The learning is in the story: a concept explained through what happens (the water cycle as a
          raindrop's journey), a moment in history seen through people who were there, a feeling or a
          choice students can talk about. Be accurate, and at the grade level: short sentences, concrete
          words, vocabulary explained in context by what happens or what a character says.
        - 3 to 6 scenes unless told otherwise, each with about 6 to 16 beats; a satisfying beginning,
          middle and end, with something at stake. A little humour helps.
        - Keep track of who is on the stage: only characters on stage speak, walk or gesture; bring others
          on with enter first; someone who leaves a scene does not come back in it. Spread people across
          the stage (x from 0.15 to 0.85), not all at one spot. Use meanwhile for things that happen at
          once (one walks across while another speaks).
        - Pick weather, water, light, life and sounds from the story and its places, where they help it:
          not everywhere. Weather falls only outdoors (and up high); water lies only in outdoor and
          underground floors.
        - Everything has its real size beside 130 cm children: give characters height_cm, describe
          backgrounds as seen from a few metres away, with no characters, people or animals in them.
        - Character and item appearance say only what they look like; never an art style, medium or
          rendering. No text, signs with words, logos or real brands in any picture. Keep everything
          friendly for children: exciting moments, never frightening ones; nobody is hurt.
        - Lines are warm and brief (one or two sentences), in character, and never talk down to students.
        - Keys are lowercase with underscores, unique within their list.
        TXT."\n\n".DesignRules::storyRules();
    }

    private function storyBrief(string $prompt, array $alignment, array $options): string
    {
        $lines = ["Teacher's request: $prompt", ''];
        foreach (['grade' => 'Grade', 'subject' => 'Subject'] as $k => $label) {
            if (! empty($options[$k])) {
                $lines[] = "$label: {$options[$k]}";
            }
        }
        if ($stage = DesignRules::stage($options['grade'] ?? null)) {
            $lines[] = $stage;
        }
        if (! empty($options['scenes'])) {
            $lines[] = "Number of scenes: exactly {$options['scenes']}.";
        }
        if (! empty($options['minutes'])) {
            $lines[] = "Length: about {$options['minutes']} minutes to watch.";
        }
        if (! empty($options['notes'])) {
            $lines[] = "Also: {$options['notes']}";
        }
        array_push($lines, ...DesignRules::briefLines($options, story: true));
        $lines[] = '';
        if ($alignment['standards']) {
            $lines[] = 'Standards the story serves:';
            foreach ($alignment['standards'] as $s) {
                $lines[] = "- {$s['code']} ({$s['alignment']}): {$s['description']}";
            }
        }
        $lines[] = 'What students should take from it (the discussion at the end should let them show it):';
        foreach ($alignment['learning_objectives'] as $lo) {
            $lines[] = "- {$lo['id']}: {$lo['text']}";
        }
        if ($alignment['vocabulary']) {
            $lines[] = 'Words to use and make clear in the story: '.implode('; ', array_map(fn ($v) => "{$v['term']} ({$v['definition']})", $alignment['vocabulary']));
        }
        if ($alignment['misconceptions']) {
            $lines[] = 'Misconceptions the story can set right: '.implode('; ', $alignment['misconceptions']);
        }

        return implode("\n", $lines);
    }

    /** A story blueprint as the builder expects it: lists as lists, scenes tidied as a mission's are, beats without empty fields. */
    public static function tidyStory(array $b): array
    {
        $b['format'] = 'story';
        foreach (['scenes', 'characters', 'items'] as $list) {
            $b[$list] = array_values(array_filter($b[$list] ?? [], 'is_array'));
        }
        foreach ($b['characters'] as &$c) {
            $c['height_cm'] = Sizes::characterCm($c);
            if (isset($c['gestures'])) {
                $c['gestures'] = array_values(array_intersect((array) $c['gestures'], BlueprintSchema::GESTURES));
            }
            unset($c['guide'], $c['scene'], $c['x'], $c['walks'], $c['wanders'], $c['chatter']);
        }
        unset($c);
        foreach ($b['scenes'] as &$s) {
            $s = self::tidyScene($s);
            unset($s['exits'], $s['details'], $s['arrival']);
            $s['cast'] = array_values(array_filter((array) ($s['cast'] ?? []), fn ($c) => is_array($c) && ! empty($c['who'])));
            foreach ($s['cast'] as &$c) {
                $c['x'] = max(0.1, min(0.9, (float) ($c['x'] ?? 0.5)));
                if (! in_array($c['facing'] ?? '', ['left', 'right'], true)) {
                    unset($c['facing']);
                }
            }
            unset($c);
            $script = [];
            foreach ((array) ($s['script'] ?? []) as $beat) {
                if (! is_array($beat) || empty($beat['do'])) {
                    continue;
                }
                $beat = array_filter($beat, fn ($v) => $v !== '' && $v !== null && $v !== []);
                // A picture insert may stay up to 20 seconds; a pause, 6.
                foreach (['x' => [0.08, 0.92], 'seconds' => [0.5, in_array($beat['do'], ['show', 'camera'], true) ? 20 : 6]] as $k => [$lo, $hi]) {
                    if (isset($beat[$k]) && is_numeric($beat[$k])) {
                        $beat[$k] = max($lo, min($hi, (float) $beat[$k]));
                    }
                }
                if (isset($beat['intensity']) && ! isset(BlueprintSchema::INTENSITY[$beat['intensity']])) {
                    unset($beat['intensity']);
                }
                if (empty($beat['meanwhile'])) {
                    unset($beat['meanwhile']);
                }
                $script[] = $beat;
            }
            $s['script'] = $script;
        }
        unset($s);
        $b['ending'] = (array) ($b['ending'] ?? []);
        $b['ending']['discussion'] = array_values(array_slice(array_filter((array) ($b['ending']['discussion'] ?? []), fn ($q) => is_string($q) && trim($q) !== ''), 0, 3));
        if (trim((string) ($b['ending']['text'] ?? '')) === '') {
            unset($b['ending']['text']);
        }
        // What the art and the builder share with missions, filled in: a story has no interactions, steps or twists.
        $b['start_scene'] = $b['scenes'][0]['key'] ?? null;

        return $b;
    }
}
