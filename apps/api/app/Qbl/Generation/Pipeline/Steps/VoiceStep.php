<?php

namespace App\Qbl\Generation\Pipeline\Steps;

use App\Qbl\Generation\Pipeline\GenerationRun;
use App\Qbl\Generation\Pipeline\Step;

/**
 * Step 6: voice. Record every line the characters (and a story's narrator) say, with the voices the
 * build step chose, through the speech engine (config/qbl_speech.php: Kokoro, Chatterbox...). Lines
 * with {{placeholders}} only known in play are left for the browser to read aloud.
 *
 * Skipped when voices are not set up, or the method or command turns them off (--no-voices).
 *
 * In:  $run->built, $run->voices
 * Out: $run->built (dialogue actions now point at their recordings)
 */
final class VoiceStep extends Step
{
    public function name(): string
    {
        return 'voice';
    }

    public function stage(): string
    {
        return 'voicing';
    }

    public function run(GenerationRun $run): void
    {
        if (! $run->speech || ! $run->voices) {
            $run->skip($run->speech ? 'no character has a voice' : 'voices are off for this run');

            return;
        }
        $run->stage('voicing');
        $voicer = $run->speech['voicer'];
        $run->say('Recording the characters\' lines ('.$voicer->engine()->name().')');
        // Each line is logged in the audit log with how long it took (the tick comes before each: it ends the line before).
        $line = null;
        $voiced = $voicer->voiceBuilt($run->built, "$run->dir/voices", $run->blueprint['language'] ?? 'en', fn (string $m) => $run->say($m), function (int $done, int $total, string $text) use ($run, $voicer, &$line) {
            $run->events?->end($line);
            $line = $run->events?->begin($run->id, ['type' => 'voice', 'kind' => 'line', 'stage' => 'voicing', 'step' => 'voice:'.($done + 1), 'label' => $text, 'model' => $voicer->engine()->name()]);
            $run->progress->count($done, $total, 'Recording line '.($done + 1)." of $total: $text");
        });
        $run->events?->end($line);
        $run->built = $voiced['built'];
        $run->warnings = array_merge($run->warnings, $voiced['warnings']);
        $run->say("  {$voiced['recorded']} lines recorded".($voiced['skipped'] ? ", {$voiced['skipped']} left to the browser (they have {{placeholders}})" : ''));
    }
}
