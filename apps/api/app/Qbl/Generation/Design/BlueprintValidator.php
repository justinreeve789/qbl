<?php

namespace App\Qbl\Generation\Design;

/**
 * Checks a blueprint before anything is drawn or built: references, the rules of each kind of
 * interaction, crew roles, twists and the final debrief, and, by playing the mission through in the
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
        $roles = self::index($b['roles'] ?? [], 'roles', $e);
        $twists = self::index($b['twists'] ?? [], 'twists', $e);
        foreach ([[$interactions, $steps], [$interactions, $twists], [$steps, $twists]] as [$one, $other]) {
            foreach (array_intersect_key($one, $other) as $k => $_) {
                $e[] = "\"$k\" is used as a key twice (interactions, steps and twists share their keys); keys must be unique.";
            }
        }
        $doneKeys = $interactions + $steps + $twists;

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
        $roleJobs = [];
        $resolvers = [];
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
            if (! empty($it['role'])) {
                if (! isset($roles[$it['role']])) {
                    $e[] = "$p.role: \"{$it['role']}\" is not a role key".($roles ? ' ('.implode(', ', array_keys($roles)).').' : '; there are no roles. Add roles, or remove role.');
                } elseif (in_array($it['type'] ?? '', ['talk', 'question'], true)) {
                    $e[] = "$p.role: a {$it['type']} is for every student; give the role a collect, inspect, experiment or team_task instead.";
                } else {
                    $roleJobs[$it['role']] = true;
                }
            }
            if (! empty($it['resolves'])) {
                if (! isset($twists[$it['resolves']])) {
                    $e[] = "$p.resolves: \"{$it['resolves']}\" is not a twist key.";
                } else {
                    $resolvers[$it['resolves']][] = $key;
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
                    break;
                case 'collect':
                    if (empty($it['item']) || ! in_array($items[$it['item']]['kind'] ?? '', ['collectible', 'tool', 'evidence'], true)) {
                        $e[] = "$p: a collect needs an item of kind collectible, tool or evidence.";
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
                    $x = $it['experiment'] ?? null;
                    if (! $x) {
                        $e[] = "$p: an experiment needs experiment.";
                        break;
                    }
                    if (! ($x['min'] <= $x['start'] && $x['start'] <= $x['max'] && $x['min'] <= $x['target'] && $x['target'] <= $x['max'])) {
                        $e[] = "$p.experiment: start and target must lie between min and max.";
                    }
                    if ($x['start'] === $x['target']) {
                        $e[] = "$p.experiment: start must differ from target.";
                    }
                    if ($x['max'] - $x['min'] > 30) {
                        $e[] = "$p.experiment: keep max - min at 30 or less; each click changes the value by one.";
                    }
                    if (! empty($x['objective'])) {
                        $assessed[$x['objective']] = true;
                    }
                    break;
                case 'team_task':
                    $t = $it['team'] ?? null;
                    if (! $t) {
                        $e[] = "$p: a team_task needs team.";
                        break;
                    }
                    if (! empty($t['roles'])) {
                        if (! $roles) {
                            $e[] = "$p.team.roles: there are no crew roles. Add roles, or use needed and part.";
                        }
                        $seen = [];
                        foreach ($t['roles'] as $i => $r) {
                            if (! isset($roles[$r['role'] ?? ''])) {
                                $e[] = "$p.team.roles[$i].role: \"".($r['role'] ?? '').'" is not a role key.';
                            } elseif (isset($seen[$r['role']])) {
                                $e[] = "$p.team.roles: \"{$r['role']}\" is listed twice; each role does one part.";
                            } else {
                                $roleJobs[$r['role']] = true;
                            }
                            $seen[$r['role'] ?? ''] = true;
                        }
                        if (count($t['roles']) < 2) {
                            $e[] = "$p.team.roles: list at least two roles, each with its own part.";
                        }
                        if (! empty($it['role'])) {
                            $e[] = "$p: a team task with team.roles involves several roles; remove role.";
                        }
                    } elseif (empty($t['needed']) || empty($t['part'])) {
                        $e[] = "$p.team: give needed and part, or roles.";
                    }
                    break;
                default:
                    $e[] = "$p.type: unknown type \"".($it['type'] ?? '').'".';
            }
        }
        foreach ($objectiveIds as $lo) {
            if (! isset($assessed[$lo])) {
                $e[] = "Learning objective $lo is not checked by any question or experiment. Add one whose objective is $lo.";
            }
        }
        if ($reportQuestions < 1) {
            $e[] = 'Add one to '.self::MAX_REPORT_QUESTIONS.' debrief questions: questions with at_report true, in the guide\'s scene, that the guide asks when the crew reports back. They check that students can explain what they found (and, with roles, need what every role found).';
        } elseif ($reportQuestions > self::MAX_REPORT_QUESTIONS) {
            $e[] = "There are $reportQuestions debrief questions (at_report); keep it to ".self::MAX_REPORT_QUESTIONS.' at most.';
        }

        // ---- roles
        if ($roles && count($roles) < 2) {
            $e[] = 'With roles, give at least two (or none).';
        }
        foreach ($roles as $key => $r) {
            if (! isset($roleJobs[$key])) {
                $e[] = "Role \"$key\" has nothing only it can do. Give it at least one interaction with role \"$key\", or a part in a team_task with team.roles.";
            }
        }

        // ---- twists
        foreach ($twists as $key => $t) {
            $p = "twists.$key";
            $after = $t['after'] ?? '';
            if (! isset($interactions[$after]) && ! isset($steps[$after])) {
                $e[] = "$p.after: \"$after\" is not an interaction or step key.";
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
                if (! isset($interactions[$k])) {
                    $e[] = "steps.$key.done_when: \"$k\" is not an interaction key.";
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

        if (! $e) {
            $e = self::playThrough($b, $scenes, $interactions, $steps, $twists, $resolvers);
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
     * students get there), so whatever sets it right must be reachable without it. The crew can always
     * swap roles, so a role's job counts as something that can be done.
     */
    private static function playThrough(array $b, array $scenes, array $interactions, array $steps, array $twists, array $resolvers): array
    {
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
                if (! isset($done[$key]) && isset($reached[$it['scene']]) && ! array_filter($it['requires'] ?? [], fn ($r) => ! $isDone($r))) {
                    $done[$key] = $changed = true;
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
                        $e[] = "Step \"$key\" can never be finished: interaction \"$k\" can never become available (its scene cannot be reached, its requirements can never be met, or a twist blocks the way to it and nothing reachable sets the twist right). Remove the circular requirement.";
                    }
                }
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
