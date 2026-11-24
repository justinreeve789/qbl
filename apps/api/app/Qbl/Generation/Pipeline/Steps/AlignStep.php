<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Step 1: align. Choose the curriculum standards the mission teaches and write its learning
 * objectives, vocabulary and the misconceptions it should confront.
 *
 * How: StandardsAligner offers the language model only the standards of the run's grade and subject
 * (from the curriculum_standards table, as a JSON-schema enum, so it cannot invent a code), and asks
 * it to choose the ones the teacher's request fits and write objectives for them.
 *
 * It also settles the format: a "mission" students play, or a "story" that plays by itself. The
 * teacher can say (options.format); otherwise the aligner reads it from the request.
 *
 * In:  $run->prompt, $run->options (grade, subject, frameworks, standards)
 * Out: $run->alignment, $run->format
 */
final class AlignStep extends Step
{
    public function name(): string
    {
        return 'align';
    }

    public function stage(): string
    {
        return 'aligning';
    }

    public function run(GenerationRun $run): void
    {
        if ($run->alignment) {
            // A resumed run: the standards were chosen before (and paid for). Use them.
            $run->skip('the run already has its alignment');
        } else {
            $run->stage('aligning');
            $run->say('Aligning to curriculum standards');
            // The model to use is the method's: $run->method->model('align') (traced, see GenerationMethod).
            $run->alignment = $run->method->aligner()->align($run->prompt, $run->options);
            // Saved on the run's row at once: if anything later fails, a resume starts after this.
            $run->save(['alignment' => $run->alignment]);
            $n = count($run->alignment['standards'] ?? []);
            $run->progress->fraction(1, "Aligned to $n standard".($n === 1 ? '' : 's'));
        }
        // The aligner's own warnings (a standard asked for that does not exist, say) go to the teacher.
        $run->warnings = array_merge($run->warnings, $run->alignment['warnings'] ?? []);
        foreach ($run->alignment['standards'] ?? [] as $s) {
            $run->say("  {$s['code']} ({$s['alignment']})");
        }

        // A mission to play, or a story to watch: as the teacher asked, or else as the aligner read the request.
        $asked = $run->options['format'] ?? null;
        $run->format = in_array($asked, ['mission', 'story'], true) ? $asked : ($run->alignment['format'] ?? 'mission');
        if ($asked !== $run->format) {
            // Remembered on the run, so a resume does not decide again.
            $run->options['format'] = $run->format;
            $run->save(['options' => $run->options]);
        }
        if ($run->isStory()) {
            $run->say('Telling it as a story: it plays by itself, scene after scene');
        }
        $run->output('alignment', $run->alignment);
    }

    public function forget(GenerationRun $run): void
    {
        $run->alignment = null;
        $run->save(['alignment' => null]);
    }
}
