<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Llm\LanguageModel;

/**
 * Writes the mission blueprint from the teacher's prompt and the curriculum alignment, and has the
 * model correct it until BlueprintValidator finds nothing wrong.
 */
class MissionDesigner
{
    public function __construct(private LanguageModel $llm, private array $limits, private int $repairs = 3) {}

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

        $blueprint = $this->llm->structured($this->system(), [$brief], 'mission_blueprint', $schema, 32000);
        $blueprint = self::tidy($blueprint);
        for ($round = 1; ; $round++) {
            $errors = BlueprintValidator::errors($blueprint, $objectiveIds);
            if (! $errors) {
                return $blueprint;
            }
            if ($round > $this->repairs) {
                throw new GenerationError("The mission blueprint still has problems after {$this->repairs} corrections:\n- ".implode("\n- ", $errors));
            }
            $log && $log('Correcting the blueprint ('.count($errors).' problem'.(count($errors) === 1 ? '' : 's').'): '.$errors[0]);
            $blueprint = self::tidy($this->llm->structured($this->system(), [
                $brief,
                "Here is the blueprint you wrote:\n".json_encode($blueprint, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                "It cannot be built because of these problems. Give the whole corrected blueprint, changing only what is needed:\n- ".implode("\n- ", $errors),
            ], 'mission_blueprint', $schema, 32000));
        }
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
          in the lower part of the picture. Students move between scenes by walking off an edge (left, right, top
          = towards the back, bottom = towards the viewer). Connections are two-way: if A's right edge leads to B,
          then B's left edge leads back to A; only list each connection once. An exit can stay closed until an
          interaction or step is done.
        - Characters (NPCs) stand in one scene; students click them to talk. One is the guide, who briefs the crew
          at the start and receives their final report.
        - Interactions are things students click: talk, collect (pick up a sample or clue), inspect (look closely and
          learn), question (multiple choice, with feedback on every answer; students may try again until right),
          experiment (change a quantity one step at a time until it reaches a target), team_task (several students
          must each do their part; everyone in the scene sees the progress).
        - Requirements chain them: an interaction can require others first. The checklist (steps) shows progress.
        - Students earn stars and XP through awards; be modest (1-5 stars, 5-25 XP; completion up to 10 and 50).

        Design rules:
        - The learning is the gameplay. Every learning objective must be checked by at least one question or
          experiment whose "objective" names it, and the observations students make (info) must contain the
          evidence they need to answer. Content must be scientifically and historically accurate and at the grade
          level: short sentences, concrete examples, vocabulary defined in context.
        - Surface the listed misconceptions in wrong-answer feedback.
        - Make the group matter: include at least one team_task, and spread the work so students explore
          different scenes and share what they found.
        - 3 to 6 scenes for a 30-45 minute mission unless told otherwise; 2 to 5 characters; every scene has
          something to do. Place interactions apart from each other across the width (x between 0.15 and 0.85,
          at least 0.15 apart in a scene), and away from the edges students leave by.
        - Character appearance and item appearance describe only what they look like; never describe an art style,
          medium or rendering. Backgrounds are empty of characters. No text, signs with words, logos or real brands
          in any picture. Keep everything friendly for children: no weapons, gore or frightening imagery.
        - Dialogue is warm and brief (one or two sentences a line), in character, and never talks down to students.
        - Keys are lowercase with underscores, unique across all lists.
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
        $lines[] = sprintf('Players: %d to %d students together.', $options['min_players'] ?? 2, $options['max_players'] ?? 6);
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
        foreach (['scenes', 'characters', 'items', 'interactions', 'steps'] as $list) {
            $b[$list] = array_values(array_filter($b[$list] ?? [], 'is_array'));
        }
        foreach ($b['interactions'] as &$it) {
            $it['requires'] = array_values(array_unique(array_filter((array) ($it['requires'] ?? []), 'is_string')));
            foreach (['item', 'character', 'after', 'locked_hint'] as $k) {
                if (isset($it[$k]) && $it[$k] === '') {
                    unset($it[$k]);
                }
            }
        }
        unset($it);
        foreach ($b['scenes'] as &$s) {
            $s['exits'] = array_values(array_filter($s['exits'] ?? [], 'is_array'));
            foreach ($s['exits'] as &$x) {
                if (($x['requires'] ?? null) === '') {
                    unset($x['requires']);
                }
            }
            unset($x);
        }
        unset($s);
        // A single guide: if the model marked none, the first character who speaks in the intro is it.
        if (! array_filter($b['characters'], fn ($c) => ! empty($c['guide'])) && $b['characters']) {
            $speaker = $b['intro']['dialogue'][0]['speaker'] ?? $b['characters'][0]['key'];
            foreach ($b['characters'] as &$c) {
                $c['guide'] = $c['key'] === $speaker;
            }
            unset($c);
        }

        return $b;
    }
}
