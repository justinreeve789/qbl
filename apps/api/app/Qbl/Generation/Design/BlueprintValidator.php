<?php

namespace App\Qbl\Generation\Design;

/**
 * Checks a blueprint before anything is drawn or built: references, the rules of each kind of
 * interaction, the bag (what is carried, used and put together), cutscenes, twists and the final debrief, and, by playing the mission through in the
 * abstract, that every required step can actually be reached and done. The errors are written for the
 * language model, which is asked to correct the blueprint until there are none.
 */
final class BlueprintValidator
{
    public const OPPOSITE = Connections::OPPOSITE;

    /** At most this many debrief questions: the report is the end of the mission, not an exam. */
    public const MAX_REPORT_QUESTIONS = 3;

    /** @return string[] errors; empty when the blueprint can be built */
    public static function errors(array $b, array $objectiveIds = []): array
    {
        $e = [];
        $scenes = self::index($b['scenes'] ?? [], 'scenes', $e);
        $characters = self::index($b['characters'] ?? [], 'characters', $e);
        $items = self::index($b['items'] ?? [], 'items', $e);
        $interactions = self::index($b['interactions'] ?? [], 'interactions', $e);
        $steps = self::index($b['steps'] ?? [], 'steps', $e);
        $twists = self::index($b['twists'] ?? [], 'twists', $e);
        $combinations = self::index($b['combinations'] ?? [], 'combinations', $e);
        foreach ([[$interactions, $steps], [$interactions, $twists], [$steps, $twists], [$combinations, $interactions], [$combinations, $steps], [$combinations, $twists]] as [$one, $other]) {
            foreach (array_intersect_key($one, $other) as $k => $_) {
                $e[] = "\"$k\" is used as a key twice (interactions, combinations, steps and twists share their keys); keys must be unique.";
            }
        }
        $doneKeys = $interactions + $combinations + $steps + $twists;

        if (! isset($scenes[$b['start_scene'] ?? ''])) {
            $e[] = 'start_scene "'.($b['start_scene'] ?? '').'" is not a scene key.';
        }

        // ---- how scenes connect: edges and passages, two-way
        array_push($e, ...Connections::problems($b, $scenes));
        foreach ($scenes as $key => $scene) {
            foreach ($scene['exits'] ?? [] as $i => $x) {
                if (! empty($x['requires']) && ! isset($doneKeys[$x['requires']])) {
                    $e[] = "scenes.$key.exits[$i].requires: \"{$x['requires']}\" is not an interaction, step or twist key.";
                }
            }
        }

        // ---- characters
        $guides = 0;
        $guide = null;
        foreach ($characters as $key => $c) {
            if (! isset($scenes[$c['scene'] ?? ''])) {
                $e[] = "characters.$key.scene: \"".($c['scene'] ?? '').'" is not a scene key.';
            }
            if (! empty($c['guide'])) {
                $guides++;
                $guide = $c;
            }
        }
        if ($guides !== 1) {
            $e[] = "Exactly one character must have guide: true (found $guides).";
        }

        foreach ($scenes as $key => $scene) {
            array_push($e, ...self::sceneProblems($key, $scene, Connections::ends($b)[$key] ?? []));
            if (! empty($scene['arrival'])) {
                foreach ($scene['arrival']['dialogue'] ?? [] as $i => $line) {
                    if (($line['speaker'] ?? '') !== 'player' && ! isset($characters[$line['speaker'] ?? ''])) {
                        $e[] = "scenes.$key.arrival.dialogue[$i].speaker: \"".($line['speaker'] ?? '').'" is not a character key or "player".';
                    }
                }
            }
            foreach ($scene['props'] ?? [] as $i => $p) {
                $item = $items[$p['item'] ?? ''] ?? null;
                if (! $item) {
                    $e[] = "scenes.$key.props[$i]: \"".($p['item'] ?? '').'" is not an item key.';
                } elseif (! in_array($item['kind'], ['prop', 'vehicle'], true)) {
                    $e[] = "scenes.$key.props[$i]: \"{$p['item']}\" is a {$item['kind']}; only props and vehicles stand in a scene. Use it in a collect or inspect interaction instead.";
                }
            }
        }

        // ---- interactions
        $assessed = [];
        $reportQuestions = 0;
        $resolvers = [];
        $guideKey = $guide['key'] ?? null;
        // Who leaves for good, or falls, in a cutscene, after what, and where.
        $leaves = [];
        $falls = [];
        $arrivals = [];
        foreach ($scenes as $key => $scene) {
            if (! empty($scene['arrival']['cutscene'])) {
                $arrivals[] = ['cutscene' => $scene['arrival']['cutscene'], 'scene' => $key];
                array_push($e, ...self::beatProblems($scene['arrival']['cutscene'], "scenes.$key.arrival.cutscene", $key, $characters, $guide['key'] ?? null));
            }
        }
        foreach ([...array_values($interactions), ...array_values($twists), ...$arrivals] as $row) {
            foreach ($row['cutscene'] ?? [] as $beat) {
                if (($beat['do'] ?? '') === 'leave') {
                    $leaves[$beat['who'] ?? ''][] = $row;
                }
                if (($beat['do'] ?? '') === 'fall' && ($beat['who'] ?? 'player') !== 'player') {
                    $falls[$beat['who']][] = $row;
                }
            }
        }
        foreach ($b['completion']['cutscene'] ?? [] as $beat) {
            if (($beat['do'] ?? '') === 'fall') {
                $e[] = 'completion.cutscene: nobody falls at the end of the mission; there is no one left to save them.';
            }
        }
        $rescuers = [];
        foreach ($falls as $who => $rows) {
            if (count($rows) > 1) {
                $e[] = "$who falls more than once; let them fall once, and be saved once.";
            }
        }
        // Big tense moments are rare: whether this mission may have one was decided for it (pace).
        if ($falls && ($b['pace']['big_moment'] ?? true) === false) {
            $e[] = 'Nobody is in danger in this mission (see Pace in the brief): nobody falls. Take out the fall of '.implode(', ', array_keys($falls)).' and its rescue; make the surprise a smaller one that comes from the place and the topic.';
        } elseif (count($falls) > 1) {
            $e[] = 'Only one big tense moment in a mission: '.implode(' and ', array_keys($falls)).' both fall. Keep one.';
        }
        // At least one twist invented for this mission, not an idea it was given.
        $invented = array_filter($twists, fn ($t) => ! empty($t['invented']));
        if (! $twists) {
            $e[] = 'twists: add a twist or turn, invented for this mission (invented: true).';
        } elseif (! $invented) {
            $e[] = 'twists: at least one twist or turn is invented for this mission, out of its place, story and topic, and marked invented: true.';
        }
        foreach ($invented as $tk => $t) {
            if (TwistIdeas::isIdea($t)) {
                $e[] = "twists.$tk: \"".($t['title'] ?? $tk).'" is one of the ideas you were given, not invented; invent one for this mission, or mark it invented: false and invent another.';
            }
        }
        foreach ($interactions as $key => $it) {
            $p = "interactions.$key";
            $scene = $it['scene'] ?? '';
            if (! isset($scenes[$scene])) {
                $e[] = "$p.scene: \"$scene\" is not a scene key.";
            }
            foreach ($it['requires'] ?? [] as $r) {
                if (! isset($doneKeys[$r])) {
                    $e[] = "$p.requires: \"$r\" is not an interaction, step or twist key.";
                } elseif ($r === $key) {
                    $e[] = "$p requires itself.";
                }
            }
            if (isset($it['item']) && $it['item'] !== '' && ! isset($items[$it['item']])) {
                $e[] = "$p.item: \"{$it['item']}\" is not an item key.";
            }
            foreach (array_merge($it['dialogue'] ?? []) as $i => $line) {
                if (($line['speaker'] ?? '') !== 'player' && ! isset($characters[$line['speaker'] ?? ''])) {
                    $e[] = "$p.dialogue[$i].speaker: \"".($line['speaker'] ?? '').'" is not a character key or "player".';
                }
            }
            if (! empty($it['gives']) && ($it['type'] ?? '') === 'team_task') {
                $e[] = "$p.gives: a team task gives nothing (only the last to help would get it); give it from something one student does.";
            } elseif (! empty($it['gives'])) {
                if (! isset($items[$it['gives']])) {
                    $e[] = "$p.gives: \"{$it['gives']}\" is not an item key.";
                } elseif (! in_array($items[$it['gives']]['kind'], ['collectible', 'tool', 'evidence'], true)) {
                    $e[] = "$p.gives: \"{$it['gives']}\" is a {$items[$it['gives']]['kind']}; only collectibles, tools and evidence go into the bag.";
                } elseif (! empty($it['at_report'])) {
                    $e[] = "$p.gives: a debrief question gives nothing; the mission ends there.";
                }
            }
            if (! empty($it['cutscene'])) {
                array_push($e, ...self::beatProblems($it['cutscene'], "$p.cutscene", $scene, $characters, $guideKey));
            }
            if (! empty($it['resolves'])) {
                if (! isset($twists[$it['resolves']])) {
                    $e[] = "$p.resolves: \"{$it['resolves']}\" is not a twist key.";
                } else {
                    $resolvers[$it['resolves']][] = $key;
                }
            }
            if (! empty($it['rescues'])) {
                $who = $it['rescues'];
                if (! isset($falls[$who])) {
                    $e[] = "$p.rescues: \"$who\" never falls; a rescue saves someone who fell (a fall in a cutscene, often on arriving in the scene). Remove rescues, or let them fall.";
                } elseif (($characters[$who]['scene'] ?? '') !== $scene) {
                    $e[] = "$p.rescues: $who is in \"{$characters[$who]['scene']}\"; they are saved where they fell.";
                } elseif (isset($rescuers[$who])) {
                    $e[] = "$p.rescues: {$rescuers[$who]} already saves $who; one rescue each.";
                } else {
                    $rescuers[$who] = $key;
                }
                $type = $it['type'] ?? '';
                if (! in_array($type, ['use', 'experiment', 'inspect', 'team_task'], true) || ($type === 'use' && ! empty($it['character']))) {
                    $e[] = "$p.rescues: a rescue is something done where they fell: a use of a thing on the spot (not given to them: they are out of reach), an experiment (a pulley to set up), a team task (everyone pulls), or an inspect.";
                }
                if (! empty($it['at_report']) || ! empty($it['hidden'])) {
                    $e[] = "$p.rescues: a rescue is there to see while they are in trouble; it cannot be hidden or a debrief question.";
                }
            }
            switch ($it['type'] ?? '') {
                case 'talk':
                    $c = $characters[$it['character'] ?? ''] ?? null;
                    if (! $c) {
                        $e[] = "$p.character: a talk needs a character key.";
                    } elseif (($c['scene'] ?? '') !== $scene) {
                        $e[] = "$p: {$it['character']} stands in \"{$c['scene']}\", not in \"$scene\".";
                    }
                    if (empty($it['dialogue'])) {
                        $e[] = "$p: a talk needs dialogue.";
                    }
                    if ($c && isset($leaves[$c['key']]) && ! self::before($key, $leaves[$c['key']])) {
                        $e[] = "$p: {$c['key']} leaves for good in a cutscene, after which nobody can talk to them. Make this talk a requirement of what makes them leave, or let them stay.";
                    }
                    if ($c && isset($falls[$c['key']])) {
                        array_push($e, ...self::fallenProblems($key, $it, $c['key'], $falls[$c['key']], $interactions));
                    }
                    break;
                case 'use':
                    $thing = $items[$it['uses'] ?? ''] ?? null;
                    if (! $thing) {
                        $e[] = "$p.uses: a use needs the key of the thing from the bag that is used (\"".($it['uses'] ?? '').'" is not an item key).';
                    } elseif (! in_array($thing['kind'], ['collectible', 'tool', 'evidence'], true)) {
                        $e[] = "$p.uses: \"{$it['uses']}\" is a {$thing['kind']}; only collectibles, tools and evidence are carried.";
                    }
                    if (! empty($it['character'])) {
                        $c = $characters[$it['character']] ?? null;
                        if (! $c) {
                            $e[] = "$p.character: \"{$it['character']}\" is not a character key.";
                        } elseif (($c['scene'] ?? '') !== $scene) {
                            $e[] = "$p: {$it['character']} is in \"{$c['scene']}\", not in \"$scene\"; a thing is given to a character where they are.";
                        } elseif (isset($leaves[$c['key']]) && ! self::before($key, $leaves[$c['key']])) {
                            $e[] = "$p: {$c['key']} leaves for good in a cutscene, after which nothing can be given to them. Make this a requirement of what makes them leave, or let them stay.";
                        } elseif (isset($falls[$c['key']])) {
                            array_push($e, ...self::fallenProblems($key, $it, $c['key'], $falls[$c['key']], $interactions));
                        }
                        if (isset($it['item']) || isset($it['x'])) {
                            $e[] = "$p: a thing given to a character needs no item or x (it is where they stand); remove them.";
                        }
                    } elseif (! isset($it['x'])) {
                        $e[] = "$p.x: a use on something in the scene needs x (or give it to a character with character).";
                    }
                    if (empty($it['hint'])) {
                        $e[] = "$p.hint: say what clicking it without the right thing tells students: what is wrong, and a nudge towards what would help.";
                    }
                    if (empty($it['info']) && empty($it['dialogue']) && empty($it['cutscene'])) {
                        $e[] = "$p: show what happens when the thing is used: give it info, dialogue or a cutscene.";
                    }
                    if (! empty($it['after'])) {
                        $e[] = "$p.after: only a question pops up after something; remove after.";
                    }
                    break;
                case 'collect':
                    if (empty($it['item']) || ! in_array($items[$it['item']]['kind'] ?? '', ['collectible', 'tool', 'evidence'], true)) {
                        $e[] = "$p: a collect needs an item of kind collectible, tool or evidence (it goes into the bag).";
                    }
                    if (empty($it['info'])) {
                        $e[] = "$p: a collect needs info (what the student observes).";
                    }
                    break;
                case 'inspect':
                    if (empty($it['info'])) {
                        $e[] = "$p: an inspect needs info.";
                    }
                    break;
                case 'question':
                    $q = $it['question'] ?? null;
                    if (! $q) {
                        $e[] = "$p: a question needs question.";
                        break;
                    }
                    $predict = ($q['purpose'] ?? 'check') === 'predict';
                    $correct = count(array_filter($q['choices'] ?? [], fn ($c) => ! empty($c['correct'])));
                    if (! $predict && $correct !== 1) {
                        $e[] = "$p.question: exactly one choice must be correct (found $correct).";
                    }
                    if (! $predict && $objectiveIds && ! in_array($q['objective'] ?? '', $objectiveIds, true)) {
                        $e[] = "$p.question.objective: \"".($q['objective'] ?? '').'" is not one of the learning objectives ('.implode(', ', $objectiveIds).').';
                    }
                    if (! $predict) {
                        $assessed[$q['objective'] ?? ''] = true;
                    }
                    if (! empty($it['at_report'])) {
                        $reportQuestions += $predict ? 0 : 1;
                        if ($predict) {
                            $e[] = "$p: a debrief question (at_report) checks what the crew found out; it cannot be a prediction.";
                        }
                        if ($guide && $scene !== ($guide['scene'] ?? '')) {
                            $e[] = "$p: a debrief question (at_report) is asked by the guide, so its scene must be \"{$guide['scene']}\".";
                        }
                        if (! empty($it['after'])) {
                            $e[] = "$p: a debrief question (at_report) cannot also pop up after an interaction; remove after.";
                        }
                    }
                    if (! empty($it['after'])) {
                        $after = $interactions[$it['after']] ?? null;
                        if (! $after) {
                            $e[] = "$p.after: \"{$it['after']}\" is not an interaction key.";
                        } elseif (($after['scene'] ?? '') !== $scene) {
                            $e[] = "$p.after: \"{$it['after']}\" is in another scene; a question can only follow an interaction in its own scene.";
                        } elseif (($after['type'] ?? '') === 'question') {
                            $e[] = "$p.after: a question cannot follow another question; let it follow what the student did.";
                        }
                    }
                    break;
                case 'experiment':
                    $x = $it['instrument'] ?? null;
                    if (! is_array($x)) {
                        $e[] = "$p: an experiment needs instrument.";
                        break;
                    }
                    array_push($e, ...self::instrumentProblems($x, "$p.instrument"));
                    if (! empty($x['objective'])) {
                        if ($objectiveIds && ! in_array($x['objective'], $objectiveIds, true)) {
                            $e[] = "$p.instrument.objective: \"{$x['objective']}\" is not one of the learning objectives (".implode(', ', $objectiveIds).').';
                        }
                        $assessed[$x['objective']] = true;
                    }
                    break;
                case 'team_task':
                    $t = $it['team'] ?? null;
                    if (! $t) {
                        $e[] = "$p: a team_task needs team.";
                        break;
                    }
                    if (empty($t['needed']) || empty($t['part'])) {
                        $e[] = "$p.team: give needed (how many students) and part (what each does).";
                    }
                    break;
                default:
                    $e[] = "$p.type: unknown type \"".($it['type'] ?? '').'".';
            }
        }
        foreach ($falls as $who => $rows) {
            if (isset($characters[$who]) && ! isset($rescuers[$who])) {
                $e[] = "$who falls, but nothing saves them. Add an interaction with rescues: \"$who\" in the scene where they fall: something students do to pull them up, using what they find there.";
            }
        }
        foreach ($objectiveIds as $lo) {
            if (! isset($assessed[$lo])) {
                $e[] = "Learning objective $lo is not checked by any question or experiment. Add one whose objective is $lo.";
            }
        }
        if ($reportQuestions < 1) {
            $e[] = 'Add one to '.self::MAX_REPORT_QUESTIONS.' debrief questions: questions with at_report true, in the guide\'s scene, that the guide asks when the crew reports back. They check that students can explain what they found, ideally by putting several findings together.';
        } elseif ($reportQuestions > self::MAX_REPORT_QUESTIONS) {
            $e[] = "There are $reportQuestions debrief questions (at_report); keep it to ".self::MAX_REPORT_QUESTIONS.' at most.';
        }

        // ---- the bag: what is carried comes from somewhere, and is not used up before it is needed
        $provided = [];
        $consumed = [];
        foreach ($interactions as $key => $it) {
            if (($it['type'] ?? '') === 'collect' && ! empty($it['item'])) {
                $provided[$it['item']][] = $key;
            }
            if (! empty($it['gives']) && ($it['type'] ?? '') !== 'collect') {
                $provided[$it['gives']][] = $key;
            }
            if (($it['type'] ?? '') === 'use' && ! empty($it['uses']) && empty($it['keeps'])) {
                $consumed[$it['uses']][] = $key;
            }
        }
        foreach ($combinations as $key => $c) {
            $p = "combinations.$key";
            $pair = array_values((array) ($c['items'] ?? []));
            if (count($pair) !== 2 || $pair[0] === $pair[1]) {
                $e[] = "$p.items: put two different things together.";
            }
            foreach ($pair as $i => $k) {
                if (! isset($items[$k])) {
                    $e[] = "$p.items[$i]: \"$k\" is not an item key.";
                } elseif (! in_array($items[$k]['kind'], ['collectible', 'tool', 'evidence'], true)) {
                    $e[] = "$p.items[$i]: \"$k\" is a {$items[$k]['kind']}; only things carried in the bag can be put together.";
                } else {
                    $consumed[$k][] = $key;
                }
            }
            $made = $items[$c['makes'] ?? ''] ?? null;
            if (! $made) {
                $e[] = "$p.makes: \"".($c['makes'] ?? '').'" is not an item key.';
            } elseif (! in_array($made['kind'], ['collectible', 'tool', 'evidence'], true)) {
                $e[] = "$p.makes: \"{$c['makes']}\" is a {$made['kind']}; what is made goes into the bag, so it is a collectible, tool or evidence.";
            } else {
                $provided[$c['makes']][] = $key;
            }
        }
        foreach ($interactions as $key => $it) {
            if (($it['type'] ?? '') === 'use' && isset($items[$it['uses'] ?? '']) && empty($provided[$it['uses']])) {
                $e[] = "interactions.$key.uses: nothing puts \"{$it['uses']}\" into the bag. Add a collect of it, give it from an interaction (gives), or make it in a combination.";
            }
        }
        foreach ($combinations as $key => $c) {
            foreach ((array) ($c['items'] ?? []) as $k) {
                if (isset($items[$k]) && empty($provided[$k])) {
                    $e[] = "combinations.$key: nothing puts \"$k\" into the bag. Add a collect of it, give it from an interaction (gives), or make it in another combination.";
                }
            }
        }
        // Every thing in the bag helps solve the mission: it is used on something, given to someone, or put
        // together into something that is.
        $useful = [];
        foreach ($interactions as $it) {
            if (($it['type'] ?? '') === 'use' && ! empty($it['uses'])) {
                $useful[$it['uses']] = true;
            }
        }
        do {
            $more = false;
            foreach ($combinations as $c) {
                if (isset($useful[$c['makes'] ?? ''])) {
                    foreach ((array) ($c['items'] ?? []) as $k) {
                        if (is_string($k) && ! isset($useful[$k])) {
                            $useful[$k] = $more = true;
                        }
                    }
                }
            }
        } while ($more);
        foreach ($provided as $k => $by) {
            if (isset($items[$k]) && ! isset($useful[$k])) {
                $e[] = "\"$k\" goes into the bag (from ".implode(', ', $by).') but is never used: every thing in the bag must help solve the mission. Use it on something or give it to someone (a use), put it together with another thing into something that is used (a combination), or, if it is only to look at, make it an inspect (and drop the gives). Red herrings are scene details, never things to pick up.';
            }
        }
        foreach ($consumed as $k => $by) {
            if (isset($provided[$k]) && count($by) > count($provided[$k])) {
                $e[] = "\"$k\" is used up by ".implode(' and ', $by).', but only '.implode(', ', $provided[$k]).' puts it into the bag. Set keeps: true on a use that should not use it up, or give students another.';
            }
        }

        // ---- twists
        foreach ($twists as $key => $t) {
            $p = "twists.$key";
            $after = $t['after'] ?? '';
            if (! isset($interactions[$after]) && ! isset($steps[$after])) {
                $e[] = "$p.after: \"$after\" is not an interaction or step key".(isset($combinations[$after]) ? ' (a combination happens wherever students are, so a twist cannot follow it).' : '.');
            }
            if (! empty($t['cutscene'])) {
                $where = $interactions[$after]['scene'] ?? null;
                if (! $where) {
                    $e[] = "$p.cutscene: a twist with a cutscene must come after an interaction (not a step), so that it is known who is there.";
                } else {
                    array_push($e, ...self::beatProblems($t['cutscene'], "$p.cutscene", $where, $characters, $guideKey));
                }
            }
            if (isset($interactions[$after]) && ! empty($interactions[$after]['at_report'])) {
                $e[] = "$p.after: \"$after\" is a debrief question; a twist must happen during the mission.";
            }
            foreach ($t['dialogue'] ?? [] as $i => $line) {
                if (($line['speaker'] ?? '') !== 'player' && ! isset($characters[$line['speaker'] ?? ''])) {
                    $e[] = "$p.dialogue[$i].speaker: \"".($line['speaker'] ?? '').'" is not a character key or "player".';
                }
            }
            $where = $interactions[$after]['scene'] ?? null;
            if (! empty($t['blocks']) || ! empty($t['obstacle'])) {
                if (! $where) {
                    $e[] = "$p: a twist that blocks a way or puts an obstacle in a scene must come after an interaction (not a step), so that it is known where it happens.";
                }
                if (empty($resolvers[$key])) {
                    $e[] = "$p: nothing sets it right. Give one interaction resolves: \"$key\" (and requires: [\"$key\"]), something students do to clear the way.";
                }
            }
            if (! empty($t['blocks']) && $where) {
                $to = $t['blocks']['to'] ?? '';
                $connected = array_filter(Connections::ends($b)[$where] ?? [], fn ($end) => $end['to'] === $to);
                if (! $connected) {
                    $e[] = "$p.blocks.to: \"$where\" (where the twist happens) has no way to \"$to\".";
                }
            }
            if (! empty($t['obstacle'])) {
                $item = $items[$t['obstacle']['item'] ?? ''] ?? null;
                if (! $item || $item['kind'] !== 'prop') {
                    $e[] = "$p.obstacle.item: \"".($t['obstacle']['item'] ?? '').'" must be an item of kind prop.';
                }
            }
        }

        // ---- steps
        foreach ($steps as $key => $s) {
            foreach ($s['done_when'] ?? [] as $k) {
                if (! isset($interactions[$k]) && ! isset($combinations[$k])) {
                    $e[] = "steps.$key.done_when: \"$k\" is not an interaction or combination key.";
                } elseif (! empty($interactions[$k]['at_report'])) {
                    $e[] = "steps.$key.done_when: \"$k\" is a debrief question, asked when the crew reports back after every step is done; it cannot be part of a step.";
                }
            }
            if (! empty($s['after']) && ! isset($steps[$s['after']]) && ! isset($twists[$s['after']])) {
                $e[] = "steps.$key.after: \"{$s['after']}\" is not a step or twist key.";
            }
        }
        if (! array_filter($steps, fn ($s) => empty($s['optional']))) {
            $e[] = 'At least one step must be required (not optional).';
        }
        foreach (['intro', 'completion'] as $part) {
            foreach ($b[$part]['dialogue'] ?? [] as $i => $line) {
                if (($line['speaker'] ?? '') !== 'player' && ! isset($characters[$line['speaker'] ?? ''])) {
                    $e[] = "$part.dialogue[$i].speaker: \"".($line['speaker'] ?? '').'" is not a character key or "player".';
                }
            }
        }

        if (! empty($b['completion']['cutscene']) && $guide) {
            array_push($e, ...self::beatProblems($b['completion']['cutscene'], 'completion.cutscene', $guide['scene'] ?? '', $characters, null));
        }

        if (! $e) {
            $e = self::playThrough($b, $scenes, $interactions, $steps, $twists, $resolvers, $combinations);
        }

        return $e;
    }

    /**
     * Walk the mission in the abstract: from the start scene, do every interaction whose scene can be
     * reached and whose requirements are met, let every twist happen whose trigger is done, go through
     * every way whose requirement is met, until nothing changes. Whatever required step is left undone
     * then cannot be done in the game either.
     *
     * A way a twist blocks is taken to be closed until the twist is set right (it may well happen before
     * students get there), so whatever sets it right must be reachable without it. A use needs its thing
     * in the bag first, and a combination both of its things.
     */
    private static function playThrough(array $b, array $scenes, array $interactions, array $steps, array $twists, array $resolvers, array $combinations = []): array
    {
        // What is in the bag (or has been at some point): what a use and a combination need.
        $have = [];
        $ends = Connections::ends($b);
        // Which end each twist closes: [scene, to] => twist key.
        $blocked = [];
        foreach ($twists as $key => $t) {
            if (! empty($t['blocks']['to']) && ($where = $interactions[$t['after']]['scene'] ?? null)) {
                $blocked["$where|{$t['blocks']['to']}"] = $key;
            }
        }
        $reached = [$b['start_scene'] => true];
        $done = [];
        // By reference: arrow functions would see $done as it was when they were made.
        $isDone = function (string $k) use (&$done, $steps): bool {
            return isset($done[$k]) || (isset($steps[$k]) && ! array_diff($steps[$k]['done_when'], array_keys($done)));
        };
        $resolved = function (string $twist) use (&$done, $resolvers): bool {
            return (bool) array_filter($resolvers[$twist] ?? [], fn ($k) => isset($done[$k]));
        };
        do {
            $changed = false;
            foreach ($ends as $key => $list) {
                if (! isset($reached[$key])) {
                    continue;
                }
                foreach ($list as $end) {
                    $open = empty($end['requires']) || $isDone($end['requires']);
                    if (isset($blocked["$key|{$end['to']}"])) {
                        $open = $open && $resolved($blocked["$key|{$end['to']}"]);
                    }
                    if ($open && ! isset($reached[$end['to']])) {
                        $reached[$end['to']] = $changed = true;
                    }
                }
            }
            foreach ($interactions as $key => $it) {
                if (! empty($it['at_report'])) {
                    continue;
                }
                if (($it['type'] ?? '') === 'use' && ! isset($have[$it['uses'] ?? ''])) {
                    continue;
                }
                if (! isset($done[$key]) && isset($reached[$it['scene']]) && ! array_filter($it['requires'] ?? [], fn ($r) => ! $isDone($r))) {
                    $done[$key] = $changed = true;
                    $thing = ($it['type'] ?? '') === 'collect' ? ($it['item'] ?? null) : ($it['gives'] ?? null);
                    if ($thing) {
                        $have[$thing] = true;
                    }
                }
            }
            foreach ($combinations as $key => $c) {
                $pair = (array) ($c['items'] ?? []);
                if (! isset($done[$key]) && $pair && ! array_filter($pair, fn ($k) => ! isset($have[$k]))) {
                    $done[$key] = $changed = true;
                    $have[$c['makes']] = true;
                }
            }
            foreach ($twists as $key => $t) {
                if (! isset($done[$key]) && $isDone($t['after'] ?? '')) {
                    $done[$key] = $changed = true;
                }
            }
        } while ($changed);

        $e = [];
        foreach ($scenes as $key => $_) {
            if (! isset($reached[$key])) {
                $e[] = "Scene \"$key\" can never be reached from the start scene \"{$b['start_scene']}\". Connect it with an exit, or check the requirements (and twists) on the ways leading to it.";
            }
        }
        foreach ($steps as $key => $s) {
            if (empty($s['optional'])) {
                foreach ($s['done_when'] as $k) {
                    if (! isset($done[$k])) {
                        $e[] = "Step \"$key\" can never be finished: \"$k\" can never become available (its scene cannot be reached, its requirements can never be met, the thing it uses or puts together is never in the bag first, or a twist blocks the way to it and nothing reachable sets the twist right). Remove the circular requirement.";
                    }
                }
            }
        }

        return $e;
    }

    /** A talk with, or a gift to, someone who falls: it waits for the rescue, unless it comes before the fall. */
    private static function fallenProblems(string $key, array $it, string $who, array $fallRows, array $interactions): array
    {
        $rescue = null;
        foreach ($interactions as $k => $other) {
            if (($other['rescues'] ?? null) === $who) {
                $rescue = $k;
            }
        }
        if (($rescue && in_array($rescue, $it['requires'] ?? [], true)) || self::before($key, array_filter($fallRows, fn ($r) => isset($r['key'])) ?: [['key' => null]])) {
            return [];
        }

        return ["interactions.$key: $who falls and is out of reach until saved. Add ".($rescue ? "\"$rescue\"" : 'the rescue').' to requires (or make this a requirement of what makes them fall).'];
    }

    /**
     * An instrument: its controls, what it shows and its misses read controls it has, with values they
     * can take, and its goal can be reached with the controls' ranges and options, but not before
     * students change anything.
     */
    private static function instrumentProblems(array $x, string $p): array
    {
        $e = [];
        $controls = [];
        foreach (array_values((array) ($x['controls'] ?? [])) as $i => $c) {
            $k = $c['key'] ?? '';
            if (! is_string($k) || ! preg_match('/'.BlueprintSchema::KEY.'/', $k)) {
                $e[] = "$p.controls[$i].key is missing or not a lowercase key.";

                continue;
            }
            if (isset($controls[$k])) {
                $e[] = "$p.controls: the key \"$k\" is used twice.";
            }
            if (trim((string) ($c['label'] ?? '')) === '') {
                $e[] = "$p.controls[$i]: give it a label.";
            }
            switch ($c['kind'] ?? '') {
                case 'slider':
                    $min = $c['min'] ?? null;
                    $max = $c['max'] ?? null;
                    $step = $c['step'] ?? 1;
                    if (! is_numeric($min) || ! is_numeric($max) || $min >= $max) {
                        $e[] = "$p.controls[$i]: a slider needs min below max.";
                        break;
                    }
                    if (! is_numeric($step) || $step <= 0 || ($max - $min) / $step > 200) {
                        $e[] = "$p.controls[$i].step: more than 0, with at most 200 steps from min to max.";
                        break;
                    }
                    $start = $c['start'] ?? $min;
                    if (! is_numeric($start) || $start < $min || $start > $max) {
                        $e[] = "$p.controls[$i].start: between min and max.";
                    }
                    $values = [];
                    for ($v = $min, $n = 0; $v <= $max + 1e-9 && $n <= 200; $v += $step, $n++) {
                        $values[] = round($v, 6);
                    }
                    $controls[$k] = ['kind' => 'slider', 'values' => $values, 'start' => (float) $start];
                    break;
                case 'switch':
                    $controls[$k] = ['kind' => 'switch', 'values' => [0, 1], 'start' => (float) ($c['start'] ?? 0) > 0 ? 1 : 0];
                    break;
                case 'wheel':
                    $options = array_values(array_filter((array) ($c['options'] ?? []), fn ($o) => is_string($o) && trim($o) !== ''));
                    if (count($options) < 2) {
                        $e[] = "$p.controls[$i]: a wheel needs at least two options.";
                    }
                    $controls[$k] = ['kind' => 'wheel', 'values' => $options, 'start' => null];
                    break;
                default:
                    $e[] = "$p.controls[$i].kind: one of ".implode(', ', BlueprintSchema::CONTROLS).'.';
            }
        }
        if (! $controls) {
            return [...$e, "$p.controls: an instrument needs at least one control."];
        }
        if (count($controls) > 6) {
            $e[] = "$p.controls: at most 6 controls.";
        }
        $check = function (array $list, string $where) use (&$e, $controls) {
            foreach (array_values($list) as $i => $c) {
                $k = $c['control'] ?? '';
                $op = $c['op'] ?? '';
                $control = $controls[$k] ?? null;
                if (! $control) {
                    $e[] = "{$where}[$i].control: \"$k\" is not one of its controls (".implode(', ', array_keys($controls)).').';
                } elseif (! in_array($op, BlueprintSchema::COMPARE, true)) {
                    $e[] = "{$where}[$i].op: one of ".implode(' ', BlueprintSchema::COMPARE).'.';
                } elseif ($control['kind'] === 'wheel' && ! in_array($op, ['=', '!='], true)) {
                    $e[] = "{$where}[$i]: a wheel lands on an option; compare it with = or !=.";
                } elseif ($control['kind'] === 'wheel' && ! in_array((string) ($c['value'] ?? ''), $control['values'], true)) {
                    $e[] = "{$where}[$i].value: \"".($c['value'] ?? '')."\" is not an option of the wheel $k (".implode(', ', $control['values']).').';
                } elseif ($control['kind'] !== 'wheel' && ! is_numeric($c['value'] ?? null)) {
                    $e[] = "{$where}[$i].value: a number".($control['kind'] === 'switch' ? ' (1 on, 0 off)' : '').'.';
                }
            }
        };
        $goal = (array) ($x['goal'] ?? []);
        if (! $goal) {
            $e[] = "$p.goal: say when the test succeeds.";
        }
        $check($goal, "$p.goal");
        foreach (['shows', 'misses'] as $list) {
            foreach (array_values((array) ($x[$list] ?? [])) as $i => $row) {
                if (empty($row['when'])) {
                    $e[] = "$p.{$list}[$i]: say when (which settings) with when.";
                }
                $check((array) ($row['when'] ?? []), "$p.{$list}[$i].when");
            }
        }
        foreach (array_values((array) ($x['meters'] ?? [])) as $i => $m) {
            if (($controls[$m['control'] ?? '']['kind'] ?? null) !== 'slider') {
                $e[] = "$p.meters[$i].control: a meter shows a slider's value; \"".($m['control'] ?? '').'" is not a slider of it.';
            }
        }
        foreach (['test' => 'the test button\'s label', 'success' => 'what students learn when it works'] as $k => $what) {
            if (trim((string) ($x[$k] ?? '')) === '') {
                $e[] = "$p.$k: give $what.";
            }
        }
        if ($e) {
            return $e;
        }
        // The goal can be met: on each control, some value meets every condition on it.
        $same = fn (mixed $v, mixed $w) => is_numeric($v) && is_numeric($w) ? abs($v - $w) < 1e-6 : (string) $v === (string) $w;
        $holds = fn (array $c, mixed $v) => match ($c['op']) {
            '=' => $same($v, $c['value']), '!=' => ! $same($v, $c['value']),
            '<' => $v < $c['value'] - 1e-9, '>' => $v > $c['value'] + 1e-9, '<=' => $v <= $c['value'] + 1e-6, default => $v >= $c['value'] - 1e-6,
        };
        $atStart = true;
        foreach ($controls as $k => $control) {
            $on = array_filter($goal, fn ($c) => $c['control'] === $k);
            if (! $on) {
                continue;
            }
            $fits = array_filter($control['values'], fn ($v) => ! array_filter($on, fn ($c) => ! $holds($c, $v)));
            if (! $fits) {
                $e[] = "$p.goal: no setting of $k meets it (".implode(', ', array_map(fn ($c) => "$k {$c['op']} {$c['value']}", $on)).'). Use values the control can take'.($control['kind'] === 'slider' ? ' (from min to max in steps)' : '').'.';
            }
            if ($control['start'] === null || array_filter($on, fn ($c) => ! $holds($c, $control['start']))) {
                $atStart = false;
            }
        }
        if (! $e && $atStart) {
            $e[] = "$p.goal: it is already met before students change anything; start the controls somewhere else.";
        }

        return $e;
    }

    /** Whether $key is required (directly) by one of these rows: done before it. */
    private static function before(string $key, array $rows): bool
    {
        foreach ($rows as $row) {
            if (($row['key'] ?? null) !== $key && ! in_array($key, $row['requires'] ?? [], true) && ($row['after'] ?? null) !== $key) {
                return false;
            }
        }

        return true;
    }

    /** A cutscene's beats: who is there, what they do, and that the guide never leaves. */
    private static function beatProblems(array $beats, string $p, string $scene, array $characters, ?string $guide): array
    {
        $e = [];
        $gone = [];
        foreach (array_values($beats) as $i => $beat) {
            $who = $beat['who'] ?? '';
            $do = $beat['do'] ?? '';
            if ($who !== 'player' && ! isset($characters[$who])) {
                $e[] = "$p[$i].who: \"$who\" is not a character key or \"player\".";

                continue;
            }
            if ($who !== 'player' && ($characters[$who]['scene'] ?? '') !== $scene) {
                $e[] = "$p[$i].who: $who is in \"{$characters[$who]['scene']}\", not in \"$scene\" where this happens.";
            }
            if (isset($gone[$who])) {
                $e[] = "$p[$i]: $who has already left.";
            }
            if (! in_array($do, BlueprintSchema::BEATS, true)) {
                $e[] = "$p[$i].do: \"$do\" is not one of ".implode(', ', BlueprintSchema::BEATS).'.';
            } elseif ($do === 'walk' && ! is_numeric($beat['x'] ?? null)) {
                $e[] = "$p[$i]: a walk needs x.";
            } elseif ($do === 'say' && trim((string) ($beat['text'] ?? '')) === '') {
                $e[] = "$p[$i]: say needs text.";
            } elseif ($do === 'gesture' && ! in_array($beat['gesture'] ?? '', BlueprintSchema::CUTSCENE_GESTURES, true)) {
                $e[] = "$p[$i].gesture: one of ".implode(', ', BlueprintSchema::CUTSCENE_GESTURES).'.';
            } elseif ($do === 'fall') {
                if ($who === 'player') {
                    $e[] = "$p[$i]: the student never falls; a character does, and students save them.";
                } elseif ($who === $guide || ! empty($characters[$who]['guide'])) {
                    $e[] = "$p[$i]: the guide never falls: students report to them at the end. Let another character fall.";
                }
                if (isset($beat['x']) && ! is_numeric($beat['x'])) {
                    $e[] = "$p[$i].x: a number between 0.08 and 0.92, or leave it out.";
                }
                $gone[$who] = true;
            } elseif ($do === 'leave') {
                if ($who === 'player') {
                    $e[] = "$p[$i]: the student cannot leave in a cutscene; use a way out instead.";
                } elseif ($who === $guide || ! empty($characters[$who]['guide'])) {
                    $e[] = "$p[$i]: the guide never leaves: students report to them at the end.";
                }
                $gone[$who] = true;
            }
        }

        return $e;
    }

    /** What a scene says about its size, its floor, its far view, its foreground and its creatures. */
    private static function sceneProblems(string $key, array $scene, array $ends): array
    {
        $e = [];
        $p = "scenes.$key";
        $kind = Sizes::sceneKind($scene);
        if (isset($scene['width']) && ! in_array($scene['width'], BlueprintSchema::WIDTHS, true)) {
            $e[] = "$p.width: normal or wide.";
        }
        if (! empty($scene['distance']) && ! in_array($kind, ['outdoor', 'up_high', 'underwater'], true)) {
            $e[] = "$p.distance: only an outdoor, up_high or underwater scene has a far view behind it; remove distance.";
        }
        if (! empty($scene['foreground']) && ! in_array($scene['foreground']['where'] ?? '', BlueprintSchema::FOREGROUND_PLACES, true)) {
            $e[] = "$p.foreground.where: one of ".implode(', ', BlueprintSchema::FOREGROUND_PLACES).'.';
        }
        $edges = array_column(array_filter($ends, fn ($end) => $end['via'] === 'edge'), 'edge');
        if (($scene['foreground']['where'] ?? null) === 'bottom' && in_array('bottom', $edges, true)) {
            $e[] = "$p.foreground: students leave this scene by its bottom edge (towards the viewer), which a foreground along the bottom would wall off. Put it in a corner (left or right) instead.";
        }
        $floor = $scene['floor'] ?? [];
        if (isset($floor['left']) && $floor['left'] > 0.02 && in_array('left', $edges, true)) {
            $e[] = "$p.floor.left: students leave by the left edge, so the floor must reach it (left 0).";
        }
        if (isset($floor['right']) && $floor['right'] < 0.98 && in_array('right', $edges, true)) {
            $e[] = "$p.floor.right: students leave by the right edge, so the floor must reach it (right 1).";
        }
        foreach ($floor['blocked'] ?? [] as $i => $blocked) {
            $x = (float) ($blocked['x'] ?? 0.5);
            $half = (float) ($blocked['width'] ?? 0.1) / 2;
            foreach ($ends as $end) {
                if ($end['via'] !== 'edge' && abs($end['x'] - $x) < $half + 0.06) {
                    $e[] = "$p.floor.blocked[$i]: it is in the way of the passage to \"{$end['to']}\" (x {$end['x']}); move it.";
                }
            }
            if (in_array('top', $edges, true) && abs(0.5 - $x) < $half + 0.06) {
                $e[] = "$p.floor.blocked[$i]: it is in front of the way out at the back (x 0.5); move it.";
            }
        }
        $details = (array) ($scene['details'] ?? []);
        if (count($details) > 5) {
            $e[] = "$p.details: at most 5 things to look at in a scene.";
        }
        foreach (array_values($details) as $i => $d) {
            if (trim((string) ($d['label'] ?? '')) === '' || trim((string) ($d['text'] ?? '')) === '' || trim((string) ($d['look'] ?? '')) === '') {
                $e[] = "$p.details[$i]: give it a label, look (what is painted there) and text (what the student notices).";
            }
            if (! is_numeric($d['x'] ?? null) || $d['x'] < 0.1 || $d['x'] > 0.9) {
                $e[] = "$p.details[$i].x: between 0.1 and 0.9.";
            }
        }
        foreach ($scene['ambient'] ?? [] as $i => $a) {
            $motion = $a['motion'] ?? '';
            if (! in_array($motion, BlueprintSchema::AMBIENT_MOTIONS, true)) {
                $e[] = "$p.ambient[$i].motion: one of ".implode(', ', BlueprintSchema::AMBIENT_MOTIONS).'.';
            } elseif (($motion === 'swims_by') !== ($kind === 'underwater') && in_array($motion, ['swims_by'], true)) {
                $e[] = "$p.ambient[$i]: only underwater things swim by.";
            } elseif ($kind === 'underwater' && in_array($motion, ['lands', 'flies_by'], true)) {
                $e[] = "$p.ambient[$i]: nothing flies underwater; use swims_by or walks_by.";
            }
        }
        // A living sky, lights and the air: only what makes sense for the kind of place.
        if (! empty($scene['sky']) && ! in_array($kind, ['outdoor', 'up_high'], true)) {
            $e[] = "$p.sky: only outdoor and up_high scenes have a sky to see; remove it.";
        }
        $lights = (array) ($scene['lights'] ?? []);
        if (count($lights) > 4) {
            $e[] = "$p.lights: at most 4 lights in a scene.";
        }
        foreach (array_values($lights) as $i => $l) {
            if (! isset(BlueprintSchema::LIGHTS[$l['kind'] ?? ''])) {
                $e[] = "$p.lights[$i].kind: one of ".implode(', ', array_keys(BlueprintSchema::LIGHTS)).'.';
            }
            if (($l['placement'] ?? null) === 'wall' && ! in_array($kind, ['indoor', 'underground'], true)) {
                $e[] = "$p.lights[$i]: only indoor and underground scenes have a back wall to hang it on; stand it on the ground or at the back.";
            }
        }
        foreach (array_values((array) ($scene['atmosphere'] ?? [])) as $i => $a) {
            $air = $a['kind'] ?? '';
            if (! in_array($air, BlueprintSchema::ATMOSPHERES, true)) {
                $e[] = "$p.atmosphere[$i].kind: one of ".implode(', ', BlueprintSchema::ATMOSPHERES).'.';
            } elseif ($air === 'bubbles' && $kind !== 'underwater') {
                $e[] = "$p.atmosphere[$i]: bubbles rise only under water.";
            } elseif ($kind === 'underwater' && ! in_array($air, ['bubbles', 'dust'], true)) {
                $e[] = "$p.atmosphere[$i]: under water there is no $air; bubbles or dust.";
            } elseif (in_array($air, ['rain', 'snow', 'leaves', 'fireflies'], true) && in_array($kind, ['indoor', 'underground'], true)) {
                $e[] = "$p.atmosphere[$i]: no $air falls or flies indoors or underground; dust, perhaps.";
            }
        }

        return $e;
    }

    private static function index(array $list, string $what, array &$e): array
    {
        $out = [];
        foreach ($list as $i => $row) {
            $key = $row['key'] ?? null;
            if (! is_string($key) || ! preg_match('/'.BlueprintSchema::KEY.'/', $key)) {
                $e[] = "$what[$i].key is missing or not a lowercase key.";

                continue;
            }
            if (isset($out[$key])) {
                $e[] = "$what: the key \"$key\" is used twice.";
            }
            $out[$key] = $row;
        }

        return $out;
    }
}
