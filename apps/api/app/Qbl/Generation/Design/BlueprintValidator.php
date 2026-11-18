<?php

namespace App\Qbl\Generation\Design;

/**
 * Checks a blueprint before anything is drawn or built: references, the rules of each kind of
 * interaction, and, by playing the mission through in the abstract, that every required step can
 * actually be reached and done. The errors are written for the language model, which is asked to
 * correct the blueprint until there are none.
 */
final class BlueprintValidator
{
    public const OPPOSITE = ['left' => 'right', 'right' => 'left', 'top' => 'bottom', 'bottom' => 'top'];

    /** @return string[] errors; empty when the blueprint can be built */
    public static function errors(array $b, array $objectiveIds = []): array
    {
        $e = [];
        $scenes = self::index($b['scenes'] ?? [], 'scenes', $e);
        $characters = self::index($b['characters'] ?? [], 'characters', $e);
        $items = self::index($b['items'] ?? [], 'items', $e);
        $interactions = self::index($b['interactions'] ?? [], 'interactions', $e);
        $steps = self::index($b['steps'] ?? [], 'steps', $e);
        foreach (array_intersect_key($interactions, $steps) as $k => $_) {
            $e[] = "\"$k\" is both an interaction and a step key; keys must be unique across both.";
        }
        $doneKeys = $interactions + $steps;

        if (! isset($scenes[$b['start_scene'] ?? ''])) {
            $e[] = 'start_scene "'.($b['start_scene'] ?? '').'" is not a scene key.';
        }

        // ---- exits: two-way, one per edge
        $edges = [];
        foreach ($scenes as $key => $scene) {
            foreach ($scene['exits'] ?? [] as $i => $x) {
                $p = "scenes.$key.exits[$i]";
                if (! isset($scenes[$x['to'] ?? ''])) {
                    $e[] = "$p: \"".($x['to'] ?? '').'" is not a scene key.';

                    continue;
                }
                if ($x['to'] === $key) {
                    $e[] = "$p leads to its own scene.";
                }
                if (isset($edges[$key][$x['edge']]) && $edges[$key][$x['edge']] !== $x['to']) {
                    $e[] = "$p: the {$x['edge']} edge of \"$key\" already leads to \"{$edges[$key][$x['edge']]}\". Each edge leads to one scene.";
                }
                $edges[$key][$x['edge']] = $x['to'];
                if (! empty($x['requires']) && ! isset($doneKeys[$x['requires']])) {
                    $e[] = "$p.requires: \"{$x['requires']}\" is not an interaction or step key.";
                }
            }
        }
        foreach ($edges as $from => $list) {
            foreach ($list as $edge => $to) {
                $back = self::OPPOSITE[$edge];
                if (isset($edges[$to][$back]) && $edges[$to][$back] !== $from) {
                    $e[] = "\"$from\" leaves by its $edge edge into \"$to\", so \"$to\"'s $back edge must lead back to \"$from\", but it leads to \"{$edges[$to][$back]}\". Exits are two-way: move one of them to another edge.";
                }
            }
        }

        // ---- characters
        $guides = 0;
        foreach ($characters as $key => $c) {
            if (! isset($scenes[$c['scene'] ?? ''])) {
                $e[] = "characters.$key.scene: \"".($c['scene'] ?? '').'" is not a scene key.';
            }
            $guides += ! empty($c['guide']) ? 1 : 0;
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
        foreach ($interactions as $key => $it) {
            $p = "interactions.$key";
            $scene = $it['scene'] ?? '';
            if (! isset($scenes[$scene])) {
                $e[] = "$p.scene: \"$scene\" is not a scene key.";
            }
            foreach ($it['requires'] ?? [] as $r) {
                if (! isset($doneKeys[$r])) {
                    $e[] = "$p.requires: \"$r\" is not an interaction or step key.";
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
                    $correct = count(array_filter($q['choices'] ?? [], fn ($c) => ! empty($c['correct'])));
                    if ($correct !== 1) {
                        $e[] = "$p.question: exactly one choice must be correct (found $correct).";
                    }
                    if ($objectiveIds && ! in_array($q['objective'] ?? '', $objectiveIds, true)) {
                        $e[] = "$p.question.objective: \"".($q['objective'] ?? '').'" is not one of the learning objectives ('.implode(', ', $objectiveIds).').';
                    }
                    $assessed[$q['objective'] ?? ''] = true;
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
                    if (empty($it['team'])) {
                        $e[] = "$p: a team_task needs team.";
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

        // ---- steps
        foreach ($steps as $key => $s) {
            foreach ($s['done_when'] ?? [] as $k) {
                if (! isset($interactions[$k])) {
                    $e[] = "steps.$key.done_when: \"$k\" is not an interaction key.";
                }
            }
            if (! empty($s['after']) && ! isset($steps[$s['after']])) {
                $e[] = "steps.$key.after: \"{$s['after']}\" is not a step key.";
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
            $e = self::playThrough($b, $scenes, $characters, $interactions, $steps, $edges);
        }

        return $e;
    }

    /**
     * Walk the mission in the abstract: from the start scene, do every interaction whose scene can be
     * reached and whose requirements are met, open every exit whose requirement is met, until nothing
     * changes. Whatever required step is left undone then cannot be done in the game either.
     */
    private static function playThrough(array $b, array $scenes, array $characters, array $interactions, array $steps, array $edges): array
    {
        $reached = [$b['start_scene'] => true];
        $done = [];
        // By reference: arrow functions would see $done as it was when they were made.
        $isDone = function (string $k) use (&$done, $steps): bool {
            return isset($done[$k]) || (isset($steps[$k]) && ! array_diff($steps[$k]['done_when'], array_keys($done)));
        };
        do {
            $changed = false;
            foreach ($scenes as $key => $scene) {
                if (! isset($reached[$key])) {
                    continue;
                }
                foreach ($scene['exits'] ?? [] as $x) {
                    $open = empty($x['requires']) || $isDone($x['requires']);
                    if ($open && ! isset($reached[$x['to']])) {
                        $reached[$x['to']] = $changed = true;
                    }
                }
                // Exits are two-way: the way back is open whenever the way in is.
                foreach ($scenes as $other => $o) {
                    foreach ($o['exits'] ?? [] as $x) {
                        if ($x['to'] === $key && ! isset($reached[$other]) && (empty($x['requires']) || $isDone($x['requires']))) {
                            $reached[$other] = $changed = true;
                        }
                    }
                }
            }
            foreach ($interactions as $key => $it) {
                if (! isset($done[$key]) && isset($reached[$it['scene']]) && ! array_filter($it['requires'] ?? [], fn ($r) => ! $isDone($r))) {
                    $done[$key] = $changed = true;
                }
            }
        } while ($changed);

        $e = [];
        foreach ($scenes as $key => $_) {
            if (! isset($reached[$key])) {
                $e[] = "Scene \"$key\" can never be reached from the start scene \"{$b['start_scene']}\". Connect it with an exit, or check the requirements on the exits leading to it.";
            }
        }
        foreach ($steps as $key => $s) {
            if (empty($s['optional'])) {
                foreach ($s['done_when'] as $k) {
                    if (! isset($done[$k])) {
                        $e[] = "Step \"$key\" can never be finished: interaction \"$k\" can never become available (its scene cannot be reached or its requirements can never be met). Remove the circular requirement.";
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
