<?php

namespace App\Console\Commands;

use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;
use App\Qbl\Speech\VoiceCatalog;
use Illuminate\Console\Command;
use Random\Engine\Mt19937;
use Random\Engine\Secure;
use Random\Randomizer;

/**
 * Say any text in a voice picked at random from the catalog (resources/speech/voices.json), with
 * the text-to-speech service in use, and save it as an MP3. For trying voices out and for one-off
 * audio; recording a scenario's lines is qbl:voice. See docs/src/content/docs/developers/voices.md.
 */
class TextToSpeech extends Command
{
    protected $signature = 'qbl:tts
        {text? : What to say (default: the catalog\'s sample line for the language)}
        {--file= : Read what to say from a text file instead}
        {--voice= : Use this voice instead of a random one (see qbl:voice --list)}
        {--lang=en : Pick from voices of this language: en, en-GB, es, fr, … (any: every language)}
        {--gender= : Pick from female, male or neutral voices}
        {--age= : Pick from child, young, adult or elder voices}
        {--trait=* : Pick from voices that sound like this (repeatable: --trait=warm --trait=calm)}
        {--count=1 : Say it in this many different random voices, one file each}
        {--seed= : Make the random pick repeatable}
        {--out= : Where to save it: a file, or a folder for several (default: tts-<voice>.mp3 here)}
        {--timings : Also save the word timings next to each file, as <name>.json}
        {--driver= : The service to use instead of the configured one (kokoro, openai)}';

    protected $description = 'Say some text in a random voice from the catalog and save it as an MP3';

    public function handle(SpeechFactory $speech): int
    {
        $catalog = $speech->catalog();
        try {
            $voicer = $speech->voicer($this->option('driver'));
        } catch (SpeechError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }
        if (! $voicer) {
            $this->error('Text-to-speech is switched off (QBL_TTS_DRIVER=none). Try --driver=kokoro.');

            return self::FAILURE;
        }
        $engine = $voicer->engine()->name();

        $text = $this->text();
        if ($text === false) {
            return self::FAILURE;
        }

        $count = (int) $this->option('count');
        if ($count < 1) {
            $this->error('--count must be 1 or more.');

            return self::FAILURE;
        }
        $voices = $this->pick($catalog, $engine, $count);
        if ($voices === null) {
            return self::FAILURE;
        }

        $outs = $this->destinations($voices);
        if ($outs === null) {
            return self::FAILURE;
        }

        $failed = 0;
        foreach ($voices as $i => $key) {
            $voice = $catalog->get($key);
            // The voice's own language, so a Spanish voice says the Spanish sample and the player's name as "explorador".
            $lang = (string) $voice['lang'];
            $line = $text ?? $catalog->sample($lang);
            try {
                $said = $voicer->record($line, $key, $lang);
            } catch (SpeechError $e) {
                $this->error(VoiceCatalog::label($voice).': '.$e->getMessage());
                $failed++;

                continue;
            }
            if ($said === null) {
                $this->error('That cannot be said: it has no words, or a {{…}} placeholder other than {{QBLPlayerName}}.');

                return self::FAILURE;
            }
            $out = $outs[$i];
            if (! $this->save($out, $said['speech']->audio)) {
                $failed++;

                continue;
            }
            $timed = count($said['speech']->words);
            $length = $said['speech']->duration ? sprintf(', %.1f s', $said['speech']->duration / 1000) : '';
            $this->info("Saved $out: ".VoiceCatalog::label($voice)." [$key] ($timed words timed$length)");
            if ($this->option('timings')) {
                $json = preg_replace('/\.[^.\/]*$/', '', $out).'.json';
                $this->save($json, json_encode($said['params']['speech'], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)."\n");
            }
        }
        if ($failed === 0 && $text !== null && count($voices) === 1 && $this->option('voice') === null) {
            $this->line("Again in the same voice: php artisan qbl:tts --voice={$voices[0]} \"…\"");
        }

        return $failed === 0 ? self::SUCCESS : self::FAILURE;
    }

    /** What to say: the argument or --file, null for the catalog's sample line, false when it cannot be read. */
    private function text(): string|null|false
    {
        $file = $this->option('file');
        if ($file !== null && $file !== '') {
            if (! is_file($file) || ! is_readable($file)) {
                $this->error("Cannot read $file.");

                return false;
            }

            return (string) file_get_contents($file);
        }
        $text = $this->argument('text');

        return $text === null || trim((string) $text) === '' ? null : (string) $text;
    }

    /**
     * The voices to say it in: --voice, or $count different ones picked at random from those that
     * fit the filters and have a voice of their own on the service (none borrowed, so every pick
     * really sounds different). Null, with the reason shown, when there are none.
     *
     * @return ?list<string>
     */
    private function pick(VoiceCatalog $catalog, string $engine, int $count): ?array
    {
        $chosen = $this->option('voice');
        if ($chosen !== null && $chosen !== '') {
            if (! $catalog->get((string) $chosen)) {
                $this->error("There is no voice $chosen. See them all with: php artisan qbl:voice --list");

                return null;
            }

            return array_fill(0, $count, (string) $chosen);
        }

        $lang = strtolower((string) $this->option('lang'));
        $want = [
            'lang' => in_array($lang, ['', 'any', 'all', '*'], true) ? null : $lang,
            'gender' => $this->option('gender'),
            'age' => $this->option('age'),
            'traits' => (array) $this->option('trait'),
            'engine' => $engine,
        ];
        foreach (['gender' => ['female', 'male', 'neutral'], 'age' => ['child', 'young', 'adult', 'elder']] as $field => $allowed) {
            if ($want[$field] !== null && ! in_array(strtolower((string) $want[$field]), $allowed, true)) {
                $this->error("--$field must be one of: ".implode(', ', $allowed).'.');

                return null;
            }
        }
        $fits = array_keys($catalog->matching($want));
        if (! $fits) {
            $asked = array_filter(['lang' => $want['lang'], 'gender' => $want['gender'], 'age' => $want['age'], 'trait' => implode('/', $want['traits'])]);
            $this->error('No voice on '.$engine.' fits '.($asked ? implode(', ', array_map(fn ($k, $v) => "$k=$v", array_keys($asked), $asked)) : 'at all').'. See them all with: php artisan qbl:voice --list');

            return null;
        }

        $seed = $this->option('seed');
        $random = new Randomizer($seed !== null && $seed !== '' ? new Mt19937(crc32((string) $seed)) : new Secure);
        $shuffled = $random->shuffleArray($fits);
        if ($count > count($shuffled)) {
            $this->warn('Only '.count($shuffled).' voices fit, so some are used more than once.');
        }
        $picked = [];
        for ($i = 0; $i < $count; $i++) {
            $picked[] = $shuffled[$i % count($shuffled)];
        }

        return $picked;
    }

    /**
     * The file each recording is saved to, by its place in $voices.
     *
     * @param  list<string>  $voices
     * @return ?list<string>
     */
    private function destinations(array $voices): ?array
    {
        $out = (string) $this->option('out');
        $several = count($voices) > 1;
        $folder = $out === '' ? '' : ($several || is_dir($out) || str_ends_with($out, '/') ? rtrim($out, '/') : null);
        if ($folder === null) {
            return [$out];
        }
        if ($folder !== '' && ! is_dir($folder) && ! @mkdir($folder, 0775, true)) {
            $this->error("Cannot make the folder $folder.");

            return null;
        }
        $names = [];
        $used = [];
        foreach ($voices as $key) {
            $used[$key] = ($used[$key] ?? 0) + 1;
            $name = 'tts-'.$key.($used[$key] > 1 ? '-'.$used[$key] : '').'.mp3';
            $names[] = $folder === '' ? $name : "$folder/$name";
        }

        return $names;
    }

    private function save(string $path, string $bytes): bool
    {
        $dir = dirname($path);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true)) {
            $this->error("Cannot make the folder $dir.");

            return false;
        }
        if (@file_put_contents($path, $bytes) === false) {
            $this->error("Cannot write $path.");

            return false;
        }

        return true;
    }
}
