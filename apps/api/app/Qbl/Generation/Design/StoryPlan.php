<?php

namespace App\Qbl\Generation\Design;

use App\Qbl\Generation\Build\StoryBuilder;

/**
 * A story blueprint seen the way the art director reads a mission's, so its pictures are drawn by the
 * same code in the same style: each character in the first scene they appear in, the gestures the
 * script asks of them as a cutscene's (so exactly those are drawn), the scenes with no ways in or out,
 * and no interactions, steps or twists.
 */
final class StoryPlan
{
    public static function forArt(array $b): array
    {
        $first = [];
        $gestures = [];
        foreach ($b['scenes'] as $scene) {
            foreach (array_keys(StoryBuilder::appearing($scene)) as $who) {
                $first[$who] ??= $scene['key'];
            }
            foreach ($scene['script'] ?? [] as $beat) {
                if (($beat['do'] ?? '') === 'gesture' && ! empty($beat['who'])) {
                    $gestures[] = ['who' => $beat['who'], 'do' => 'gesture', 'gesture' => $beat['gesture'] ?? 'wave'];
                }
            }
        }
        $out = $b;
        $out['characters'] = array_map(fn ($c) => $c + ['scene' => $first[$c['key']] ?? $b['scenes'][0]['key'], 'x' => 0.5, 'guide' => false], $b['characters']);
        $out['items'] = array_map(fn ($i) => $i + ['kind' => 'prop'], $b['items'] ?? []);
        $out['scenes'] = array_map(fn ($s) => ['exits' => []] + $s, $b['scenes']);
        $out['interactions'] = [];
        $out['steps'] = [];
        $out['twists'] = [];
        $out['combinations'] = [];
        $out['start_scene'] = $b['scenes'][0]['key'];
        $out['completion'] = ['cutscene' => $gestures];

        return $out;
    }

    /** "3 scenes, 2 characters, 41 beats": for the log. */
    public static function describe(array $b): string
    {
        $beats = array_sum(array_map(fn ($s) => count($s['script'] ?? []), $b['scenes']));

        return sprintf('"%s": a story in %d scenes, %d characters, %d beats', $b['title'], count($b['scenes']), count($b['characters']), $beats);
    }
}
