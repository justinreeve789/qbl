<?php

namespace App\Qbl\Generation\Design;

/**
 * The scenario design rules from research on educational games, as the generator uses them, and the
 * three settings a teacher can choose where that research pulls two ways.
 *
 * Where the rules come from: docs/src/content/docs/educators/game-design-rules.mdx (Aldrich, McGonigal,
 * Gee, Kapp, Squire, Steinkuehler, Shaffer, Bogost, Flanagan). They are strong heuristics, not proven laws; the
 * generator follows them and the teacher can lean the three tensions one way or the other.
 *
 * Used by:
 * - MissionDesigner::system(): missionRules() is part of the designer's instructions (fixed, so cached).
 * - MissionDesigner::brief() and storyBrief(): briefLines() says which way this run leans.
 * - BlueprintCritic: criticChecklist() is what the reviewer checks the blueprint against.
 * - BlueprintValidator: openingLines() and the checks that can be counted (something to do in the
 *   start scene, a short opening, an optional bonus step).
 *
 * Each setting starts as "Choose for me": the teacher picks one, or the aligner chooses what fits the
 * request (StandardsAligner, saved in the alignment as `approach`), or, if neither says, DEFAULTS.
 * GenerationRun::designOptions() puts the teacher's and the aligner's choices together.
 *
 * The settings travel with the blueprint as `approach` (like `pace`), so every later check of the same
 * blueprint (corrections, the critic, best-of) applies the same ones.
 */
final class DesignRules
{
    /**
     * The settings: key => [label, help, stories (whether it applies to a story), choices (value =>
     * [label, what the designer is told])]. "Choose for me" is no value at all (see approach()).
     */
    public const SETTINGS = [
        'opening' => [
            'label' => 'How it starts',
            'help' => 'Fast start or story? Research on simulations says long openings lose players; our best missions are stories. Choose for me: picked to suit the request.',
            'stories' => false,
            'choices' => [
                'action' => ['Straight into the action',
                    'Opening: straight into the action. The guide says at most two short lines, then students are doing something. Tell the story only through what they find, see and are told along the way.'],
                'balanced' => ['Action first, story through discoveries',
                    'Opening: action first, story through discoveries. A short welcome (at most four lines in all, across the briefing and the start scene\'s arrival), with something to click in the start scene from the first moment. Let the rest of the story come out through characters, discoveries and twists, not up front.'],
                'story' => ['Story first',
                    'Opening: story first. A fuller opening is welcome (the guide\'s briefing can set the scene, and the start scene\'s arrival can add a little show), but students must still have something to do within two minutes, and the start scene must have something to click.'],
            ],
        ],
        'focus' => [
            'label' => 'Rigor or play',
            'help' => 'How much the mission leans on exact, practitioner-style work versus lighter play. Choose for me: picked to suit the request and the grade.',
            'stories' => true,
            'choices' => [
                'play' => ['Lighter and playful',
                    'Rigor or play: lighter and playful. Keep the science or history correct, but favour quick puzzles, jokes and discovery over measurement. Fewer scored questions (one per objective is enough), short observations, more to explore just for fun.'],
                'balanced' => ['Quick hook, rigorous middle',
                    'Rigor or play: a quick hook and a rigorous middle. A playful first minute; then the core of the mission works the way a practitioner works, with real values, evidence and an instrument whose behaviour is accurate; then a satisfying payoff.'],
                'rigor' => ['Rigorous, like a practitioner',
                    'Rigor or play: rigorous. Students work like real practitioners from the start: real values and units, measuring before concluding, predictions checked against evidence, questions that ask why and debrief questions that ask them to apply what they found. Fun comes from the challenge and the discovery, not from padding.'],
            ],
        ],
        'freedom' => [
            'label' => 'Student freedom',
            'help' => 'How much students choose their own path. Students redirect play whatever we plan; reports show what they did. Choose for me: picked to suit the request.',
            'stories' => false,
            'choices' => [
                'guided' => ['Guided, one path',
                    'Student freedom: guided. One clear path: each step opens the next, in order. Keep optional things small and to the side, so a teacher can follow where everyone is.'],
                'balanced' => ['Some choice of order',
                    'Student freedom: some choice. A clear goal, but at least two parts of the mission can be done in either order (steps without "after" between them), with optional bonus content and room to explore without points.'],
                'open' => ['Open to explore',
                    'Student freedom: open. Most of the mission can be done in any order: several scenes open from the start, few steps wait on others, more hidden discoveries and details, and more than one way into the problem. Keep the goal clear so nobody is lost.'],
            ],
        ],
    ];

    /** When neither the teacher nor the aligner chose: how the rules resolve each tension. */
    public const DEFAULTS = ['opening' => 'balanced', 'focus' => 'balanced', 'freedom' => 'balanced'];

    /** At most how many lines the guide's briefing and the start scene's arrival say together, by opening (null: no limit beyond the schema's). */
    public const OPENING_LINES = ['action' => 2, 'balanced' => 4, 'story' => null];

    /**
     * The settings for a run: each as the teacher chose it ($options), else as the aligner chose it for
     * them ($decided), else its default.
     *
     * @return array{opening: string, focus: string, freedom: string}
     */
    public static function approach(array $options, array $decided = []): array
    {
        return array_merge(self::DEFAULTS, self::chosen($decided), self::chosen($options));
    }

    /** Only the settings the teacher chose (unknown or missing values dropped), for storing a run's options. */
    public static function chosen(array $input): array
    {
        $out = [];
        foreach (self::SETTINGS as $key => $setting) {
            $value = $input[$key] ?? null;
            if (is_string($value) && isset($setting['choices'][$value])) {
                $out[$key] = $value;
            }
        }

        return $out;
    }

    /** What the designer is told about this run's settings: one line each (stories: only those that apply to stories). */
    public static function briefLines(array $options, bool $story = false): array
    {
        $approach = self::approach($options);
        $lines = [];
        foreach (self::SETTINGS as $key => $setting) {
            if ($story && ! $setting['stories']) {
                continue;
            }
            $lines[] = $setting['choices'][$approach[$key]][1];
        }

        return $lines;
    }

    /** The most lines the opening may have for an approach, or null for no limit. */
    public static function openingLines(array $approach): ?int
    {
        return self::OPENING_LINES[$approach['opening'] ?? self::DEFAULTS['opening']] ?? null;
    }

    /** What the aligner is told, so it can choose the settings the teacher left to it. */
    public static function alignerPrompt(): string
    {
        $lines = [];
        foreach (self::SETTINGS as $key => $setting) {
            $lines[] = "- $key: ".implode('; ', array_map(fn ($v, $c) => "$v ({$c[0]})", array_keys($setting['choices']), $setting['choices']));
        }

        return "Also choose how the mission should lean where design rules pull two ways (approach), to suit this\n"
            ."request, its grade and its subject. Choose balanced unless the request points another way (a teacher\n"
            ."who wants a story to set the scene, a lab practical for older students, free exploration...).\n"
            .implode("\n", $lines);
    }

    /** The aligner's answer for the settings: one of each setting's choices. */
    public static function alignerSchema(): array
    {
        $properties = [];
        foreach (self::SETTINGS as $key => $setting) {
            $properties[$key] = ['type' => 'string', 'enum' => array_keys($setting['choices'])];
        }

        return ['type' => 'object', 'required' => array_keys($properties), 'properties' => $properties, 'description' => 'How the mission leans (see the instructions).'];
    }

    /** The rules, for the mission designer's instructions. Fixed text, so the prompt cache keeps it. */
    public static function missionRules(): string
    {
        return <<<'TXT'
        Rules from research on educational games. Follow them; the brief says which way this mission leans
        where they pull against each other (its opening, rigor or play, and student freedom).
        - Real action fast. The start scene has something to click from the first moment, and students are
          doing something within two minutes. No wall of reading or long speech before the first action.
        - A safe on-ramp. The start scene teaches the controls one at a time (walk, talk, pick up, the
          checklist) with no locked ways, no traps and nothing to get wrong. It needs no skill from the topic.
        - Start simple, then add layers. The first instrument or puzzle has one thing to change; later ones
          add a second variable, units or an interaction between things. Each scene needs only what earlier
          scenes taught. Lock later scenes behind what students must learn first.
        - Hard but learnable, never dumbed down. Difficulty rises through the mission. Include at least one
          optional bonus step that is genuinely harder (a tougher setting, a hidden discovery, a deeper
          question), and mark it optional.
        - Every scene serves a learning objective. If a scene does nothing for one, merge it into another.
          Each objective has an action that produces evidence: a scored question or an experiment's goal.
        - Rewards come from mastery, not clicking. Awards go to solving puzzles, experiments and questions,
          never to walking somewhere or talking. The mission must be worth playing without the stars.
        - Put the information inside the world. Characters, things to inspect and how an instrument behaves
          carry the lesson; observations (info) are the lab book, not the lesson. Never put a long text before
          an action.
        - The rules are the argument. What an instrument shows must follow the real science (values, units,
          direction of change). If the mission simplifies on purpose, the guide says so in the debrief. Never
          reward what the lesson warns against (no reward for rushing in a lesson about careful measurement).
        - Students work like a real practitioner. Name what they are for this mission in story.player_role
          (field biologists, ship engineers, historians), use that practitioner's tools, questions and ways of
          showing evidence, and have characters talk that way. Write step texts as what that practitioner
          gets done ("Measure how far the pollen travels"), not as clicks.
        - A place to try things. At least one instrument where students change controls freely, see what
          happens at once, and try again with nothing lost.
        - Feedback is immediate and says why. Every wrong answer's feedback and every instrument miss says
          what is wrong and nudges toward the idea, never just "Wrong". Never give the answer away.
        - Failure is cheap and a little funny. No dead ends and no game over: every mistake can be tried
          again at once. Keep the tone light when things go wrong.
        - Help comes in layers, from characters. Hints go from a nudge, to a pointer, to nearly showing how.
          A guide or coach character who knows the most can be asked again. Asking for help never costs.
        - A shared goal and a payoff. The crew works toward one big goal, and the mission has at least one
          moment of triumph or awe (a reveal, a discovery, the world changing) before the debrief.
        - Teammates need each other. Every student can do everything, but spread what is needed: clues,
          things to collect and measurements in different scenes, so the group has to pool what it finds,
          and a team_task where it fits. Never one puzzle one confident student solves alone in one place.
        - Shared sense-making. Before an experiment or a discovery, a prediction question asks the group what
          they think will happen; disagreement is settled by what they then observe.
        - Leave room for play. Some things are there just to explore, with no points: details, fun things to
          click, extra characters. Never put a quiz in front of the fun.
        - End with an after-action review. The debrief asks what happened, why, and where students would see
          this in real life; at least one debrief question asks them to explain why, not to recall a word.
        - Audit the values. A varied cast: characters of different ages, backgrounds and kinds, with women and
          men, young and old, in expert and leading roles. Whose knowledge counts is not one group's. No
          stereotypes. Reading level right for the grade.
        TXT;
    }

    /** The rules that apply to a story students watch, for the story designer's brief. */
    public static function storyRules(): string
    {
        return <<<'TXT'
        Rules from research on educational games, for a story: the lesson lives inside the world (what
        characters do, say and discover), not in narration that lectures. Get the science and history
        right; if the story simplifies on purpose, say so at the end. A varied cast with no stereotypes,
        women and men, young and old, in expert and leading roles; reading level right for the grade. End
        with things to talk about that ask what happened, why, and where students would see it in real life.
        TXT;
    }

    /** What the critic checks a blueprint against, besides its scores. */
    public static function criticChecklist(): string
    {
        return <<<'TXT'
        Also check it against the design rules from research on educational games, and list any rule it
        breaks as a problem (naming the rule): something to do in the start scene from the first moment;
        the start scene a safe on-ramp; difficulty that rises, with one optional bonus that is genuinely
        harder; every scene serving a learning objective; awards for mastery, not for clicking or walking;
        the lesson inside the world, not in walls of text; an instrument that behaves like the real thing;
        students working like a named practitioner; wrong answers that say why and loop back; layered hints
        from characters; teammates needing each other's finds; a shared goal and a payoff moment; room to
        explore without points; a debrief that asks why and where it shows up in real life; a varied cast
        with no stereotypes. Judge it by the mission's own settings (its opening, rigor or play, freedom).
        TXT;
    }
}
