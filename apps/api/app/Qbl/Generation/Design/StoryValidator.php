<?php

namespace App\Qbl\Generation\Design;

/**
 * Whether a story blueprint (StorySchema) can be built and plays as it is written: every scene's script
 * is followed through, with who is on the stage at each beat, so nobody speaks or walks before they
 * have come on, nobody comes on twice, and everyone in the story appears somewhere. Each problem is a
 * sentence the model can act on, as BlueprintValidator's are.
 */
final class StoryValidator
{
    /** @return string[] problems; empty when the story can be built */
    public static function errors(array $b): array
    {
        $e = [];
        foreach (['title', 'subtitle', 'description'] as $k) {
            if (trim((string) ($b[$k] ?? '')) === '') {
                $e[] = "$k is required.";
            }
        }
        if (trim((string) ($b['story']['premise'] ?? '')) === '' || trim((string) ($b['story']['takeaway'] ?? '')) === '') {
            $e[] = 'story needs a premise and a takeaway.';
        }
        $characters = BlueprintValidator::index((array) ($b['characters'] ?? []), 'characters', $e);
        $items = BlueprintValidator::index((array) ($b['items'] ?? []), 'items', $e);
        $scenes = BlueprintValidator::index((array) ($b['scenes'] ?? []), 'scenes', $e);
        if (count($scenes) < 2) {
            $e[] = 'scenes: a story has at least 2 scenes.';
        }
        if (! $characters) {
            $e[] = 'characters: a story needs at least one character.';
        }
        foreach ($characters as $key => $c) {
            foreach (['name', 'appearance'] as $k) {
                if (trim((string) ($c[$k] ?? '')) === '') {
                    $e[] = "characters.$key.$k is required.";
                }
            }
            if (! is_numeric($c['height_cm'] ?? null) || $c['height_cm'] < 30 || $c['height_cm'] > 260) {
                $e[] = "characters.$key.height_cm: between 30 and 260.";
            }
        }
        $appears = [];
        $soundSet = array_flip(BlueprintSchema::SOUNDS);
        foreach ($scenes as $key => $scene) {
            $p = "scenes.$key";
            foreach (['title', 'background'] as $k) {
                if (trim((string) ($scene[$k] ?? '')) === '') {
                    $e[] = "$p.$k is required.";
                }
            }
            if (! is_numeric($scene['ground_line'] ?? null)) {
                $e[] = "$p.ground_line: a number between 0.55 and 0.8.";
            }
            if (! empty($scene['exits'])) {
                $e[] = "$p.exits: a story's scenes follow one another by themselves; remove exits.";
            }
            array_push($e, ...BlueprintValidator::sceneProblems($key, $scene, []));
            foreach (array_values((array) ($scene['props'] ?? [])) as $i => $prop) {
                if (! isset($items[$prop['item'] ?? ''])) {
                    $e[] = "$p.props[$i].item: \"".($prop['item'] ?? '')."\" is not one of the items.";
                }
            }
            $passers = array_column((array) ($scene['ambient'] ?? []), null, 'key');
            $on = [];
            foreach (array_values((array) ($scene['cast'] ?? [])) as $i => $c) {
                $who = (string) ($c['who'] ?? '');
                if (! isset($characters[$who])) {
                    $e[] = "$p.cast[$i].who: \"$who\" is not one of the characters.";
                } elseif (isset($on[$who])) {
                    $e[] = "$p.cast: $who is listed twice.";
                } else {
                    $on[$who] = true;
                    $appears[$who] = true;
                }
            }
            $gone = [];
            $spoken = 0;
            $script = array_values((array) ($scene['script'] ?? []));
            if (count($script) < 3) {
                $e[] = "$p.script: at least 3 beats: the scene acted out.";
            }
            if (count($script) > 24) {
                $e[] = "$p.script: at most 24 beats; split it into two scenes.";
            }
            foreach ($script as $i => $beat) {
                $bp = "$p.script[$i]";
                $do = (string) ($beat['do'] ?? '');
                $who = (string) ($beat['who'] ?? '');
                $onStage = function () use ($who, &$on, $characters, $bp, &$e, $do, &$gone): bool {
                    if (! isset($characters[$who])) {
                        $e[] = "$bp ($do).who: \"$who\" is not one of the characters.";

                        return false;
                    }
                    if (! isset($on[$who])) {
                        $e[] = isset($gone[$who])
                            ? "$bp ($do): $who has left this scene by then."
                            : "$bp ($do): $who is not on stage yet; put them in the scene's cast, or bring them on first with an enter beat.";

                        return false;
                    }

                    return true;
                };
                $text = trim((string) ($beat['text'] ?? ''));
                switch ($do) {
                    case 'narrate':
                        $spoken++;
                        if ($text === '') {
                            $e[] = "$bp (narrate): text is what the narrator says.";
                        }
                        break;
                    case 'say':
                        $spoken++;
                        $onStage();
                        if ($text === '') {
                            $e[] = "$bp (say): text is what they say.";
                        } elseif (mb_strlen($text) > 200) {
                            $e[] = "$bp (say): at most 200 characters; split it into two lines.";
                        }
                        if (! empty($beat['to']) && ($beat['to'] === $who || ! isset($on[$beat['to']]))) {
                            $e[] = "$bp (say).to: \"{$beat['to']}\" must be someone else on stage.";
                        }
                        break;
                    case 'walk':
                        $onStage();
                        if (! is_numeric($beat['x'] ?? null)) {
                            $e[] = "$bp (walk).x: where they walk to, between 0.08 and 0.92.";
                        }
                        break;
                    case 'enter':
                        if (! isset($characters[$who])) {
                            $e[] = "$bp (enter).who: \"$who\" is not one of the characters.";
                        } elseif (isset($on[$who])) {
                            $e[] = "$bp (enter): $who is already on stage.";
                        } elseif (isset($gone[$who])) {
                            $e[] = "$bp (enter): $who left this scene and cannot come back in it; start a new scene.";
                        } else {
                            $on[$who] = true;
                            $appears[$who] = true;
                        }
                        if (! in_array($beat['from'] ?? '', ['left', 'right'], true)) {
                            $e[] = "$bp (enter).from: left or right.";
                        }
                        if (! is_numeric($beat['x'] ?? null)) {
                            $e[] = "$bp (enter).x: where they walk to once on, between 0.08 and 0.92.";
                        }
                        break;
                    case 'leave':
                        if ($onStage()) {
                            unset($on[$who]);
                            $gone[$who] = true;
                        }
                        if (! in_array($beat['edge'] ?? '', ['left', 'right'], true)) {
                            $e[] = "$bp (leave).edge: left or right.";
                        }
                        break;
                    case 'gesture':
                        $onStage();
                        if (! in_array($beat['gesture'] ?? '', BlueprintSchema::CUTSCENE_GESTURES, true)) {
                            $e[] = "$bp (gesture).gesture: one of ".implode(', ', BlueprintSchema::CUTSCENE_GESTURES).'.';
                        }
                        break;
                    case 'wait':
                        if (! is_numeric($beat['seconds'] ?? null)) {
                            $e[] = "$bp (wait).seconds: how long, from 0.5 to 6.";
                        }
                        break;
                    case 'sound':
                        if (! isset($soundSet[$beat['sound'] ?? ''])) {
                            $e[] = "$bp (sound).sound: one of ".implode(', ', BlueprintSchema::SOUNDS).'.';
                        }
                        break;
                    case 'weather':
                        if (! in_array($beat['weather'] ?? '', [...BlueprintSchema::WEATHERS, 'clear'], true)) {
                            $e[] = "$bp (weather).weather: one of ".implode(', ', [...BlueprintSchema::WEATHERS, 'clear']).'.';
                        } elseif (! in_array(Sizes::sceneKind($scene), BlueprintSchema::WEATHER_KINDS, true)) {
                            $e[] = "$bp (weather): weather falls only on outdoor and up_high scenes.";
                        }
                        break;
                    case 'pass':
                        if (! isset($passers[$beat['passer'] ?? ''])) {
                            $e[] = "$bp (pass).passer: \"".($beat['passer'] ?? '').'" is not one of this scene\'s ambient creatures or vehicles; add it to ambient.';
                        }
                        break;
                    case 'title':
                        if ($text === '' || mb_strlen($text) > 60) {
                            $e[] = "$bp (title): text of at most 60 characters.";
                        }
                        break;
                    default:
                        $e[] = "$bp.do: one of ".implode(', ', StorySchema::BEATS).'.';
                }
            }
            if ($script && $spoken === 0) {
                $e[] = "$p.script: nobody says anything and the narrator is silent; tell the story.";
            }
        }
        foreach ($characters as $key => $_) {
            if (! isset($appears[$key])) {
                $e[] = "characters.$key never appears: put them in a scene's cast or bring them on, or remove them.";
            }
        }
        $discussion = array_filter((array) ($b['ending']['discussion'] ?? []), fn ($q) => trim((string) $q) !== '');
        if (! $discussion) {
            $e[] = 'ending.discussion: one to three questions for students to talk about.';
        }

        return $e;
    }
}
