<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Design\SceneDesigner;
use App\Qbl\Generation\GenerationError;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * A scene's step 1: plan it (SceneDesigner, language model job "design"), for the scenario the teacher
 * is making (options.scenario_id): what its background shows, what stands on its floor, what can be
 * clicked and what the narrator says about it, its lights, sky and critters. The plan is a blueprint
 * with one scene, keyed by a shortname no other scene of the scenario has.
 *
 * In:  $run->prompt, $run->options (scenario_id, kind, time, width, hotspots, repeat, animations, critters, notes)
 * Out: $run->blueprint, $run->format = "scene"
 */
final class SceneDesignStep extends Step
{
    public function name(): string
    {
        return 'design';
    }

    public function stage(): string
    {
        return 'designing';
    }

    public function run(GenerationRun $run): void
    {
        $run->format = 'scene';
        if ($run->blueprint) {
            $run->skip('the run already has its plan');

            return;
        }
        $run->stage('designing');
        $context = self::context($run);
        $designer = new SceneDesigner($run->method->model('design'));
        $plan = $designer->design($run->prompt, $run->options, $context + ['key' => 'new_scene']);
        $run->blueprint = self::keyed($plan, self::uniqueKey($plan['title'], array_column($context['scenes'], 'shortname')));
        $run->save(['blueprint' => $run->blueprint]);
        $scene = $run->blueprint['scenes'][0];
        $run->say(sprintf('Planned "%s": %d standing, %d to click, %d lights, %d critters.', $scene['title'], count($scene['standing']), count($scene['details']), count($scene['lights'] ?? []), count($scene['ambient'] ?? [])));
        $run->output('blueprint', $run->blueprint);
    }

    /** The scenario the scene is for: its title, what it is about, and its scenes. */
    public static function context(GenerationRun $run): array
    {
        $id = (int) ($run->options['scenario_id'] ?? 0);
        $scenario = $id ? $run->store->scenario($id) : null;
        if (! $scenario) {
            throw new GenerationError('The scenario this scene is for is gone.');
        }
        $scenes = $run->store->bundle($id)['scenes'];
        usort($scenes, fn ($a, $b) => ((int) ($a['sequence'] ?? 0)) <=> ((int) ($b['sequence'] ?? 0)));

        return [
            'title' => $scenario['title'] ?? null, 'description' => $scenario['description'] ?? null,
            'scenes' => array_map(fn ($s) => ['shortname' => (string) ($s['shortname'] ?? ''), 'title' => $s['subtitle'] ?? $s['shortname'] ?? null, 'description' => $s['description'] ?? null], $scenes),
        ];
    }

    /** A shortname for the new scene from its title, that none of the scenario's scenes has. */
    public static function uniqueKey(string $title, array $taken): string
    {
        $base = substr(trim((string) preg_replace('/[^a-z0-9]+/', '_', strtolower($title)), '_'), 0, 26) ?: 'scene';
        if (! preg_match('/^[a-z]/', $base)) {
            $base = "scene_$base";
        }
        $taken = array_flip(array_map('strtolower', $taken));
        $key = $base;
        for ($n = 2; isset($taken[$key]); $n++) {
            $key = "{$base}_$n";
        }

        return $key;
    }

    /** The plan with its scene under another key. */
    public static function keyed(array $plan, string $key): array
    {
        $plan['scenes'][0]['key'] = $key;
        $plan['start_scene'] = $key;

        return $plan;
    }

    public function forget(GenerationRun $run): void
    {
        $run->blueprint = null;
        $run->save(['blueprint' => null]);
    }
}
