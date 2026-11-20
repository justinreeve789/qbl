<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Llm\LanguageModel;

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
    public function __construct(private LanguageModel $llm, private array $limits, private int $repairs = 3) {}

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
     * @param  array{grade?: ?string, subject?: ?string, scenes?: ?int, min_players?: int, max_players?: int, minutes?: ?int, notes?: ?string}  $options
     * @param  callable|null  $log  fn(string $message)
     */
    public function design(string $prompt, array $alignment, array $options, ?callable $log = null): array
    {
        $schema = BlueprintSchema::schema($this->limits);
        $objectiveIds = array_column($alignment['learning_objectives'], 'id');
        $brief = $this->brief($prompt, $alignment, $options);

        $blueprint = self::tidy($this->llm->structured($this->system(), [$brief], 'mission_blueprint', $schema, 32000));
        $rewritten = false;
        $limit = $this->repairs;
        for ($round = 1; ; $round++) {
            try {
                $errors = BlueprintValidator::errors($blueprint, $objectiveIds);
            } catch (\TypeError|\ErrorException|\ValueError $e) {
                // Not even the right shape (the tool route is not enforced token by token).
                $errors = ['The blueprint does not follow the schema: '.$e->getMessage().'. Give every field the type the schema says.'];
            }
            if (! $errors) {
                return $blueprint;
            }
            if ($round > $limit) {
                if ($rewritten) {
                    throw new GenerationError("The mission blueprint still has problems after {$this->repairs} corrections and a rewrite:\n- ".implode("\n- ", $errors));
                }
                // Changes did not get there: one whole rewrite, as a last resort.
                $log && $log('Rewriting the blueprint ('.count($errors).' problem'.(count($errors) === 1 ? '' : 's').' left): '.$errors[0]);
                $blueprint = self::tidy($this->llm->structured($this->system(), [
                    $brief, ['cache' => true],
                    "Here is the blueprint you wrote:\n".json_encode($blueprint, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                    "It cannot be built because of these problems. Give the whole corrected blueprint, changing only what is needed:\n- ".implode("\n- ", $errors),
                ], 'mission_blueprint', $schema, 32000));
                $rewritten = true;
                $limit = $round; // checked once more, then no more corrections

                continue;
            }
            $log && $log('Correcting the blueprint ('.count($errors).' problem'.(count($errors) === 1 ? '' : 's').'): '.$errors[0]);
            $answer = $this->llm->structured($this->system(), [
                $brief, ['cache' => true],
                "Here is the blueprint you wrote:\n".json_encode($blueprint, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                "It cannot be built because of these problems:\n- ".implode("\n- ", $errors)."\n\nAnswer with only the changes that fix them (not the whole blueprint), changing as little as possible. Keep everything else as it is.",
            ], 'blueprint_changes', self::CHANGES_SCHEMA, 6000);
            [$changed, $problems] = self::applyChanges($blueprint, (array) ($answer['changes'] ?? []));
            if ($problems) {
                $log && $log('Some changes could not be made: '.$problems[0]);
            }
            $blueprint = self::tidy($changed);
        }
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
        space explorers aboard an intergalactic starship; each mission takes their crew somewhere (a planet, a
        habitat, a historical reconstruction, inside a cell...) to solve a problem by thinking like scientists,
        historians, mathematicians or writers. A small group plays together in the same world at once.

        What the game can do, and so all a mission may use:
        - Scenes are side-on 2D places (like a stage set) students walk around in, seen from the side with a floor
          in the lower part of the picture. A scene is outdoor, indoor, underground, up_high or underwater.
        - Ways between scenes. Walk off an edge (left, right, top = towards the back, bottom = towards the viewer),
          or use a passage that stands in the scene where you say: a door into a building, a gate, a cave mouth, a
          portal, a tunnel, a ladder or stairs up to somewhere higher, or a hole, hatch or stairs down in the floor
          (students jump into a hole!). Every way is two-way: list each connection once, from either scene, and
          the way back is added for you (out of a building towards the viewer, back up a ladder out of a hole...).
          Use passages where the story calls for them, so the world feels like somewhere: the inside of the lab
          is through its door, the buried ruins are down a hole, the lookout is up a ladder. A way can stay closed
          until an interaction, step or twist is done.
        - Characters (NPCs) stand in one scene; students click them to talk. One is the guide, who briefs the crew
          at the start and debriefs them at the end. Every character is drawn standing, walking and in a close-up
          portrait. A character can wander (pace about near their spot) and mutter a line now and then. Their lines
          are recorded in a voice chosen from what `voice` says (gender, age, how it sounds): give each character a
          voice of their own, so students can tell them apart by ear.
        - Items are drawn to their real size (size_cm), next to students who are 130 cm tall: a vial is tiny, a
          crate comes up to a student's waist, a door is taller than them. Where an interaction's item is
          (placement): on the ground students walk on, at the back where the floor meets the scenery, on a
          surface (a table or flat rock, added for you) for small things, or on the wall in indoor and underground
          scenes. Big things go at the back so the floor stays open. Props are scenery items that stand in a scene.
        - Interactions are things students click: talk, collect (pick up a sample or clue), inspect (look closely and
          learn), question (multiple choice, with feedback on every answer; students may try again until right),
          experiment (change a quantity one step at a time until it reaches a target), team_task (several students
          must each do their part; everyone in the scene sees the progress). Something hidden only appears when a
          student walks close to it.
        - Crew roles: students can each pick a role (Botanist, Engineer, Navigator...) at the start. A role's jobs
          are interactions only students in that role can do; they count for the whole crew, and what they find
          (share) goes into a crew log everyone can read. A team_task can give each role its own different part.
        - Twists: a surprise right after something is done (a storm, a rockslide, an escaped animal, a reading that
          makes no sense). It is flashed across every screen in that scene, characters react, and it can close a
          way and put an obstacle in the scene until something students do sets it right.
        - Requirements chain interactions: one can require others (or a twist) first. The checklist (steps) shows
          progress.
        - Students earn stars and XP through awards; be modest (1-5 stars, 5-25 XP; completion up to 10 and 50).

        Design rules:
        - The learning is the gameplay. Every learning objective must be checked by at least one scored question
          or experiment whose "objective" names it, and the observations students make (info) must contain the
          evidence they need to answer. Content must be scientifically and historically accurate and at the grade
          level: short sentences, concrete examples, vocabulary defined in context.
        - Assess, don't just tell. Ask questions right after the observation they are about (after). Before an
          experiment or discovery, a prediction question (purpose predict) makes students commit to an idea first.
          End with 1 to 3 debrief questions (at_report) the guide asks when the crew reports back: they ask
          students to explain or apply what they found, not to recall a word. Surface the listed misconceptions
          in wrong-answer feedback, without giving the answer away.
        - Make the group matter. With 2 or more students, give the crew 2 to 4 roles (no more than the fewest
          students who play), give each role its own jobs in different places, write what each finds into the
          crew log (share), and make at least one debrief question need findings from more than one role. Include
          at least one team_task.
        - Keep it exciting. Include one twist (two in a long mission) that turns the plan upside down and teaches
          something on the way: what students do about it uses what they are learning. Add one or two hidden
          discoveries for the curious, and make places varied: inside and outside, up high and underground.
        - 3 to 6 scenes for a 30-45 minute mission unless told otherwise; 2 to 5 characters; every scene has
          something to do. Place interactions and passages apart from each other across the width (x between 0.15
          and 0.85, at least 0.15 apart in a scene), and away from the edges students leave by.
        - Character appearance and item appearance describe only what they look like; never describe an art style,
          medium or rendering. Backgrounds are empty of characters. No text, signs with words, logos or real brands
          in any picture. Keep everything friendly for children: no weapons, gore or frightening imagery; a twist
          is exciting, never scary.
        - Dialogue is warm and brief (one or two sentences a line), in character, and never talks down to students.
        - Keys are lowercase with underscores, unique across interactions, steps and twists.
        TXT;
    }

    private function brief(string $prompt, array $alignment, array $options): string
    {
        $lines = ["Teacher's request: $prompt", ''];
        foreach (['grade' => 'Grade', 'subject' => 'Subject'] as $k => $label) {
            if (! empty($options[$k])) {
                $lines[] = "$label: {$options[$k]}";
            }
        }
        $min = (int) ($options['min_players'] ?? 2);
        $lines[] = sprintf('Players: %d to %d students together.', $min, $options['max_players'] ?? 6);
        $lines[] = $min >= 2
            ? sprintf('Crew roles: give the crew 2 to %d roles.', min(4, $min))
            : 'Crew roles: a student may play alone, so roles are optional; if you add them, a student can switch roles to do every job.';
        if (! empty($options['scenes'])) {
            $lines[] = "Number of scenes: exactly {$options['scenes']}.";
        }
        if (! empty($options['minutes'])) {
            $lines[] = "Playing time: about {$options['minutes']} minutes.";
        }
        if (! empty($options['notes'])) {
            $lines[] = "Also: {$options['notes']}";
        }
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

        return implode("\n", $lines);
    }

    /** Small things the model gets wrong that need no second opinion. */
    public static function tidy(array $b): array
    {
        foreach (['scenes', 'characters', 'items', 'interactions', 'steps', 'roles', 'twists'] as $list) {
            $b[$list] = array_values(array_filter($b[$list] ?? [], 'is_array'));
        }
        if (! $b['roles']) {
            unset($b['roles']);
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
                unset($c['wanders']);
                $guideScene ??= $c['scene'] ?? null;
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
            foreach (['item', 'character', 'after', 'locked_hint', 'dialogue', 'x', 'role', 'share', 'resolves', 'placement'] as $k) {
                if (isset($it[$k]) && ($it[$k] === '' || $it[$k] === [] || ($k === 'x' && ! $it[$k]))) {
                    unset($it[$k]);
                }
            }
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
            if (($it['type'] ?? '') === 'team_task' && ! empty($it['team']['roles'])) {
                $it['team']['roles'] = array_values(array_filter($it['team']['roles'], 'is_array'));
            }
        }
        unset($it);
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
        }
        unset($t);
        foreach ($b['scenes'] as &$s) {
            if (! in_array($s['kind'] ?? null, Sizes::SCENE_KINDS, true)) {
                $s['kind'] = ! empty($s['indoor']) ? 'indoor' : 'outdoor';
            }
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
}
