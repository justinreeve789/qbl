<?php

namespace App\Qbl\Generation;

use App\Qbl\ScenarioCompiler;
use ZipArchive;

/**
 * A generated mission as an import ZIP, in exactly the shape ScenarioArchive exports and imports:
 *
 *   scenario.json   the scenario document, compiled from the built rows by ScenarioCompiler
 *   assets/...      every picture, under the name its media entry's url ends in
 *   previews/...    each scene as it will look, with its floor, spawn points and hotspots drawn on (ScenePreview)
 *   README.txt      what it is, its standards, and pictures to look at before publishing
 *
 * Importing it goes through the same code as a teacher's own "Import a ZIP", so a generated mission
 * enters the database the way any other does. The ZIP is kept with the run, so it can also be
 * imported again elsewhere, or by hand.
 */
final class ScenarioPackage
{
    /**
     * @param  array  $built  MissionBuilder::build()
     * @return array{zip: string, json: string, document: array}
     */
    public static function write(array $built, string $dir, array $alignment, array $manifest, array $blueprint = [], ?string $spent = null): array
    {
        if (! class_exists(ZipArchive::class)) {
            throw new GenerationError('PHP needs its zip extension to package a scenario.');
        }
        $document = ScenarioCompiler::compile($built['rows']);
        // Ids in the file are local to it; the import gives every row a new one.
        unset($document['code']);
        $json = json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        file_put_contents("$dir/scenario.json", $json);

        $zipPath = "$dir/scenario.zip";
        @unlink($zipPath);
        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new GenerationError("Could not write $zipPath.");
        }
        $zip->addFromString('scenario.json', $json);
        foreach ($built['files'] as $name => $path) {
            if (! is_file($path)) {
                throw new GenerationError("The picture $path is missing.");
            }
            $zip->addFile($path, "assets/$name");
            $zip->setCompressionName("assets/$name", ZipArchive::CM_STORE);
        }
        foreach (ScenePreview::write($document, $built['files'], "$dir/previews") as $scene => $preview) {
            $zip->addFile($preview, "previews/$scene.png");
        }
        $below = array_filter($manifest, fn ($m) => ! empty($m['below_bar']));
        $lines = [
            'A Quest Lab mission made by the AI scenario generator: '.$document['title'],
            'Made '.gmdate('Y-m-d H:i').' UTC.',
            '',
            'scenario.json is the scenario; assets/ holds its pictures. Import it in the editor',
            '(Scenarios > Import a ZIP) or with `php artisan qbl:generate --import=path/to/scenario.zip`.',
            'It is imported as a private draft: review it, then publish and assign it.',
            'previews/ shows each scene as it will look (not imported; for reviewing).',
            '',
            'Standards:',
            ...array_map(fn ($s) => "  {$s['code']} ({$s['alignment']}): {$s['description']}", $alignment['standards'] ?: [['code' => 'none', 'alignment' => '-', 'description' => 'not aligned']]),
            '',
            'Learning objectives:',
            ...array_map(fn ($lo) => "  {$lo['id']}: {$lo['text']}", $alignment['learning_objectives']),
        ];
        $lines = [...$lines, ...self::forTheTeacher($blueprint)];
        if ($spent) {
            $lines[] = '';
            $lines[] = $spent;
        }
        if ($below) {
            $lines[] = '';
            $lines[] = 'Pictures kept below the style bar (look at these before publishing):';
            foreach ($below as $m) {
                $lines[] = "  {$m['key']} (score ".($m['score'] ?? '?').')';
            }
        }
        $zip->addFromString('README.txt', implode("\n", $lines)."\n");
        $zip->close();

        return ['zip' => $zipPath, 'json' => "$dir/scenario.json", 'document' => $document];
    }

    /** What a teacher should know before running it: the puzzles and their answers, the twists, how students are assessed. */
    private static function forTheTeacher(array $b): array
    {
        if (! $b) {
            return [];
        }
        $out = [];
        $labels = array_column($b['interactions'] ?? [], 'label', 'key');
        $titles = array_column($b['scenes'] ?? [], 'title', 'key');
        $names = array_column($b['items'] ?? [], 'name', 'key');
        $characters = array_column($b['characters'] ?? [], 'name', 'key');
        $uses = array_filter($b['interactions'] ?? [], fn ($it) => $it['type'] === 'use');
        if ($uses || ! empty($b['combinations'])) {
            $out[] = '';
            $out[] = 'Puzzles with the bag (the answers, for helping students who are stuck):';
            foreach ($b['combinations'] ?? [] as $c) {
                $out[] = '  Put together: '.implode(' + ', array_map(fn ($k) => $names[$k] ?? $k, $c['items'])).' = '.($names[$c['makes']] ?? $c['makes']).'.';
            }
            foreach ($uses as $it) {
                $on = ! empty($it['character']) ? 'give it to '.($characters[$it['character']] ?? $it['character']) : '"'.$it['label'].'"';
                $out[] = '  '.($names[$it['uses']] ?? $it['uses']).": $on in ".($titles[$it['scene']] ?? $it['scene']).(! empty($it['gives']) ? ', which gives '.($names[$it['gives']] ?? $it['gives']) : '').'.';
            }
        }
        if (! empty($b['twists'])) {
            $out[] = '';
            $out[] = 'Twists (surprises; worth not spoiling):';
            foreach ($b['twists'] as $t) {
                $out[] = '  After "'.($labels[$t['after']] ?? $t['after'])."\": {$t['title']}".(! empty($t['blocks']['to']) ? ' (blocks the way to '.($titles[$t['blocks']['to']] ?? $t['blocks']['to']).' until set right)' : '');
            }
        }
        $questions = array_filter($b['interactions'] ?? [], fn ($it) => $it['type'] === 'question');
        if ($questions) {
            $out[] = '';
            $out[] = 'Questions (first answers, tries and the debrief are in the teacher report):';
            foreach ($questions as $q) {
                $kind = ! empty($q['at_report']) ? 'debrief' : ((($q['question']['purpose'] ?? 'check') === 'predict') ? 'prediction, not scored' : 'scored');
                $out[] = "  [$kind] {$q['question']['prompt']}";
            }
        }

        return $out;
    }
}
