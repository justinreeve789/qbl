<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Art\BackgroundCleaner;
use App\Qbl\Generation\Art\ImageTools;
use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Step 4¾ (after survey): clear. The things the survey cut out of a background (trees, wells, carts)
 * are items placed exactly over themselves. This takes them out of the background itself, so what is
 * under each one is what would be behind it: move or delete the item and there is no second copy
 * painted underneath (BackgroundCleaner). Only the pixels under the cut-outs change; the rest of the
 * picture is kept pixel for pixel, as a PNG.
 *
 * How the holes are filled is the method's choice (GenerationMethod::clearing()): "paint" asks the
 * picture source to draw what is behind them (one picture per 16:9 window of things, priced like any
 * picture), falling back to "fill" (the colours around them, no request) where its answer does not
 * line up; null leaves the background as it is.
 *
 * The floor, the sort lines and the blocked bases are measured from the picture as it was painted
 * (SurveyStep, before this), so nothing about where things stand changes.
 *
 * Saved as assets/bg-<scene>-cleared.png, with survey/<scene>-cleared.json saying what it was made
 * from; reused when a run resumes with the same cut-outs.
 *
 * In:  $run->assets "bg:<scene>", "cutout:<scene>:<n>"
 * Out: $run->assets "bg:<scene>" points at the cleared picture (with cleared_from: the one painted)
 */
final class ClearStep extends Step
{
    public function name(): string
    {
        return 'clear';
    }

    public function stage(): string
    {
        return 'drawing';
    }

    public function run(GenerationRun $run): void
    {
        $how = $run->method->clearing();
        if (! $how || ! $run->assets) {
            $run->skip($how ? 'no pictures' : 'the method keeps the cut-outs in the background');

            return;
        }
        EstimateStep::prepare($run);
        $style = $run->method->style();
        $painter = $how === 'paint'
            ? fn (string $prompt, array $refs, string $aspect, array $hints) => $run->director->retouch($prompt, $refs, $aspect, $hints)
            : null;
        $cleared = 0;
        foreach (array_keys($run->assets) as $k) {
            if (! preg_match('/^bg:(.+)$/', $k, $m) || empty($run->assets[$k]['path']) || ! empty($run->assets[$k]['cleared_from'])) {
                continue;
            }
            $key = $m[1];
            $cutouts = [];
            foreach ($run->assets as $ck => $c) {
                if (str_starts_with($ck, "cutout:$key:") && ! empty($c['path']) && is_file($c['path'])) {
                    $cutouts[] = $c;
                }
            }
            if (! $cutouts) {
                continue;
            }
            $bg = $run->assets[$k];
            $file = "$run->dir/assets/bg-".preg_replace('/[^a-z0-9_-]+/', '-', strtolower($key)).'-cleared.png';
            $record = "$run->dir/survey/$key-cleared.json";
            $from = self::madeFrom($bg['path'], $cutouts, $how);
            $saved = is_file($record) ? json_decode((string) file_get_contents($record), true) : null;
            if (! is_array($saved) || ($saved['from'] ?? null) !== $from || ! is_file($file)) {
                $run->progress->count(PHP_INT_MAX, null, 'Taking what can be walked around out of the background of '.$key);
                $picture = ImageTools::load((string) file_get_contents($bg['path']));
                $result = BackgroundCleaner::clear(
                    $picture,
                    array_map(fn ($c) => ['image' => ImageTools::load((string) file_get_contents($c['path'])), 'x' => (int) $c['x'], 'y' => (int) $c['y'], 'name' => (string) ($c['name'] ?? 'thing')], $cutouts),
                    $painter,
                    $style->chroma(),
                    'flat '.$style->bible()['chroma'],
                    fn (string $m) => $run->say($m),
                );
                file_put_contents($file, ImageTools::png($result['image']));
                $saved = ['from' => $from, 'how' => $result['how'], 'holes' => $result['holes'], 'windows' => $result['windows']];
                if (! is_dir("$run->dir/survey")) {
                    mkdir("$run->dir/survey", 0775, true);
                }
                file_put_contents($record, json_encode($saved, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));
            }
            foreach ($saved['windows'] as $w) {
                if (! empty($w['problem'])) {
                    $run->warn("Behind some of what stands in $key was filled in from the colours around it ({$w['problem']}): look at the background where those things stand.");
                }
            }
            $run->assets[$k] = ['path' => $file, 'cleared_from' => $bg['path']] + $bg;
            $run->note('clear', ['scene' => $key, 'how' => $saved['how'], 'holes' => $saved['holes'], 'windows' => count($saved['windows'])]);
            $cleared++;
        }
        if ($cleared) {
            $run->say("Took the things to walk around out of $cleared ".($cleared === 1 ? 'background' : 'backgrounds').'.');
        }
    }

    /** What a cleared picture was made from: the painted one and the cut-outs over it. */
    private static function madeFrom(string $bg, array $cutouts, string $how): string
    {
        return md5(json_encode([$how, md5_file($bg), array_map(fn ($c) => [(int) $c['x'], (int) $c['y'], md5_file($c['path'])], $cutouts)]));
    }

    public function forget(GenerationRun $run): void
    {
        foreach (glob("$run->dir/survey/*-cleared.json") ?: [] as $f) {
            unlink($f);
        }
    }
}
