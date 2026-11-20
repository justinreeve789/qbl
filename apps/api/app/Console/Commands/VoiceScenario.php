<?php

namespace App\Console\Commands;

use App\Models\Scenario;
use App\Qbl\ScenarioStore;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\SpeechFactory;
use App\Qbl\Speech\VoiceCatalog;
use App\Qbl\StoreError;
use Illuminate\Console\Command;

/**
 * Record what a scenario's characters say, in their voices, with the text-to-speech service
 * (config/qbl_speech.php; the "tts" container by default). See docs/src/content/docs/developers/voices.md.
 */
class VoiceScenario extends Command
{
    protected $signature = 'qbl:voice
        {key? : Code or shortname of the scenario}
        {--list : List the voices characters can be given, and check them against the service}
        {--sample= : Record one voice saying a sample line (or --text) and save it as an MP3 to listen to}
        {--text= : With --sample: what to say}
        {--out= : With --sample: where to save it (default: sample-<voice>.mp3 here)}
        {--assign : First give a voice to each character that has none}
        {--reassign : First give every character a new voice, replacing the ones they have}
        {--force : Record every line again, even those whose recording is up to date}
        {--dry-run : Only say what would be recorded}
        {--driver= : The service to use instead of the configured one (kokoro, openai)}';

    protected $description = 'Record the characters\' lines of a scenario with text-to-speech voices (with word timings for highlighting)';

    public function handle(SpeechFactory $speech, ScenarioStore $store): int
    {
        try {
            if ($this->option('list')) {
                return $this->list($speech);
            }
            if ($voice = $this->option('sample')) {
                return $this->sample($speech, (string) $voice);
            }
            $key = (string) $this->argument('key');
            $scenario = $key === '' ? null : Scenario::query()->where(fn ($q) => $q->where('code', strtolower($key))->orWhere('shortname', $key))->first();
            if (! $scenario) {
                $this->error($key === '' ? 'Say which scenario: php artisan qbl:voice <code>' : "There is no scenario $key.");

                return self::FAILURE;
            }
            $voicer = $speech->scenarioVoicer($store, $this->option('driver'));
            if (! $voicer) {
                $this->error('Recording voices is switched off (QBL_TTS_DRIVER=none).');

                return self::FAILURE;
            }
            if ($this->option('assign') || $this->option('reassign')) {
                $given = $voicer->assign((int) $scenario->id, (bool) $this->option('reassign'));
                $names = $store->bundle((int) $scenario->id)['characters'];
                foreach ($names as $c) {
                    if (isset($given[$c['id']])) {
                        $this->line("  {$c['name']}: ".VoiceCatalog::label($speech->catalog()->get($given[$c['id']]) ?? ['name' => $given[$c['id']]]));
                    }
                }
            }
            $result = $voicer->record((int) $scenario->id, ['force' => (bool) $this->option('force'), 'dry' => (bool) $this->option('dry-run')], fn ($m) => $this->line($m));
        } catch (SpeechError|StoreError $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        foreach ($result['skipped'] as $s) {
            $this->warn("  Action {$s['action_id']} not recorded: {$s['why']}");
        }
        if ($this->option('dry-run')) {
            $this->info("{$result['lines']} lines by characters with a voice: {$result['remaining']} to record, {$result['kept']} up to date.");
        } else {
            $this->info("\"{$scenario->title}\": {$result['recorded']} lines recorded, {$result['kept']} already up to date, {$result['removed']} recordings removed.");
            if ($result['recorded'] > 0 || $result['removed'] > 0) {
                $this->line("Players get them once it is published: php artisan qbl:publish {$scenario->code}");
            }
        }
        if ($result['lines'] === 0) {
            $this->line('No character has a voice yet: give them one in the editor, or run this again with --assign.');
        }

        return self::SUCCESS;
    }

    private function list(SpeechFactory $speech): int
    {
        $catalog = $speech->catalog();
        $engine = $speech->engine($this->option('driver'));
        $has = [];
        if ($engine) {
            try {
                $has = array_flip($engine->voices());
            } catch (SpeechError $e) {
                $this->warn($e->getMessage());
            }
        }
        $rows = [];
        foreach ($catalog->all() as $key => $v) {
            $on = $engine ? $catalog->specFor($key, $engine->name()) : null;
            $spec = $on ? (string) ($on['spec']['voice'] ?? json_encode($on['spec'])) : '';
            $missing = $has && $on ? array_filter(preg_split('/\+/', $spec), fn ($part) => ! isset($has[preg_replace('/\(.*$/', '', trim($part))])) : [];
            $rows[] = [$key, VoiceCatalog::label($v), $v['lang'], implode(', ', array_slice((array) $v['traits'], 0, 4)),
                $spec.($on && $on['borrowed'] ? " (from {$on['key']})" : '').($missing ? '  MISSING: '.implode(', ', $missing) : '')];
        }
        $this->table(['Key', 'Voice', 'Language', 'Sounds', $engine ? 'On '.$engine->name() : 'Service'], $rows);
        $this->line($engine ? count($rows).' voices. Hear one: php artisan qbl:voice --sample=heart' : 'Recording is switched off (QBL_TTS_DRIVER=none).');

        return self::SUCCESS;
    }

    private function sample(SpeechFactory $speech, string $key): int
    {
        if (! $speech->catalog()->get($key)) {
            $this->error("There is no voice $key. See them all with: php artisan qbl:voice --list");

            return self::FAILURE;
        }
        $voicer = $speech->voicer($this->option('driver'));
        if (! $voicer) {
            $this->error('Recording voices is switched off (QBL_TTS_DRIVER=none).');

            return self::FAILURE;
        }
        $text = $this->option('text');
        $said = $voicer->sample($key, $speech->catalog()->get($key)['lang'], $text !== null ? (string) $text : null);
        $out = (string) ($this->option('out') ?: "sample-$key.{$said->format}");
        file_put_contents($out, $said->audio);
        $this->info("Saved $out (".count($said->words).' words timed'.($said->duration ? sprintf(', %.1f s', $said->duration / 1000) : '').').');

        return self::SUCCESS;
    }
}
