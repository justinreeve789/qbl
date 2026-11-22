<?php

namespace App\Console\Commands;

use App\Qbl\Speech\Engines\ChatterboxEngine;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;
use Illuminate\Console\Command;

/**
 * The reference clips the chatterbox container speaks in. Each catalog voice's clip is made the
 * first time a line is recorded in it, so this is only needed to make them all ahead of time (a
 * server that will then stop the tts container), to make them again after the catalog's Kokoro voices
 * change (--force), or to upload a recording of your own (--file). See "Chatterbox" in
 * docs/src/content/docs/developers/voices.md.
 */
class MakeChatterboxClips extends Command
{
    protected $signature = 'qbl:chatterbox-clips
        {voices?* : Only these clips (catalog voice keys, or any name with --file); default: every catalog voice}
        {--force : Make clips again even when the container already has them}
        {--file= : Upload this recording (any audio, 10 to 20 seconds of one person speaking) as the clip instead of making it}
        {--list : Only show which clips the container has}';

    protected $description = 'Make (or upload) the voice clips the Chatterbox text-to-speech service speaks in';

    public function handle(SpeechFactory $speech): int
    {
        try {
            $engine = $speech->engine('chatterbox');
            if (! $engine instanceof ChatterboxEngine) {
                $this->error('There is no chatterbox service in config/qbl_speech.php.');

                return self::FAILURE;
            }
            $has = array_flip($engine->voices());
        } catch (SpeechError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        $catalog = $speech->catalog();
        $wanted = array_values((array) $this->argument('voices')) ?: array_keys($catalog->all());

        if ($this->option('list')) {
            $rows = [];
            foreach (array_unique([...array_keys($catalog->all()), ...array_keys($has)]) as $name) {
                $rows[] = [$name, isset($has[$name]) ? 'yes' : '-', $catalog->get($name) ? 'catalog voice' : 'uploaded'];
            }
            $this->table(['Clip', 'In the container', 'From'], $rows);
            $this->line(count($has).' clips in the container. Missing ones are made the first time a line is recorded in them.');

            return self::SUCCESS;
        }

        if ($file = $this->option('file')) {
            if (count($wanted) !== 1 || ! $this->argument('voices')) {
                $this->error('Name the one clip to upload: php artisan qbl:chatterbox-clips narrator --file=reading.wav');

                return self::FAILURE;
            }
            if (! is_file($file)) {
                $this->error("There is no file $file.");

                return self::FAILURE;
            }
            try {
                $seconds = $engine->upload($wanted[0], (string) file_get_contents($file));
            } catch (SpeechError $e) {
                $this->error($e->getMessage());

                return self::FAILURE;
            }
            $this->info(sprintf('Uploaded %s (%.1f s).', $wanted[0], $seconds));
            if (! $catalog->get($wanted[0])) {
                $this->line("To give it to a voice, set that voice's engines.chatterbox.clip to \"{$wanted[0]}\" in resources/speech/voices.json.");
            }
            $this->line('Lines already recorded in it are kept: php artisan qbl:voice {code} --force records them again.');

            return self::SUCCESS;
        }

        $clips = $speech->clips('chatterbox');
        [$made, $kept, $failed] = [0, 0, 0];
        $bar = $this->output->createProgressBar(count($wanted));
        foreach ($wanted as $name) {
            $bar->advance();
            if (isset($has[$name]) && ! $this->option('force')) {
                $kept++;

                continue;
            }
            try {
                $engine->upload($name, $clips->make($name));
                $made++;
            } catch (SpeechError $e) {
                $failed++;
                $this->newLine();
                $this->warn("$name: ".$e->getMessage());
            }
        }
        $bar->finish();
        $this->newLine();
        $this->info("Made $made clips, kept $kept the container already had".($failed ? ", $failed failed" : '').'.');
        if ($made && $this->option('force')) {
            $this->line('Lines already recorded in the old clips are kept: php artisan qbl:voice {code} --force records them again.');
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }
}
