<?php

namespace App\Qbl\Speech;

use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\ScenarioStore;

/**
 * Puts the voices together from configuration (config/qbl_speech.php), in plain PHP, so Laravel,
 * the commands, the generator and the tests build them the same way.
 */
class SpeechFactory
{
    private ?VoiceCatalog $catalog = null;

    /** @var array<string, SpeechEngine> */
    private array $engines = [];

    public function __construct(
        private array $config,
        private ?HttpClient $http = null,
        /** For tests: the engine to use whatever the driver says. */
        private ?SpeechEngine $engine = null,
    ) {}

    /** The service lines are recorded with, or null when recording is switched off (driver "none"). */
    public function engine(?string $driver = null): ?SpeechEngine
    {
        if ($this->engine !== null) {
            return $this->engine;
        }
        $driver = strtolower((string) ($driver ?? $this->config['driver'] ?? 'none'));
        if ($driver === '' || $driver === 'none' || $driver === 'off') {
            return null;
        }
        if (isset($this->engines[$driver])) {
            return $this->engines[$driver];
        }
        $settings = $this->config['engines'][$driver] ?? null;
        $class = is_array($settings) ? ($settings['class'] ?? null) : null;
        if (! is_string($class) || ! is_subclass_of($class, SpeechEngine::class) || ! method_exists($class, 'fromConfig')) {
            $known = implode(', ', array_keys((array) ($this->config['engines'] ?? [])));
            throw new SpeechError("There is no text-to-speech service called \"$driver\" in config/qbl_speech.php (there are: $known, and none).");
        }

        return $this->engines[$driver] = $class::fromConfig($settings, $this->http);
    }

    public function catalog(): VoiceCatalog
    {
        return $this->catalog ??= VoiceCatalog::load((string) ($this->config['voices'] ?? __DIR__.'/../../../resources/speech/voices.json'));
    }

    public function picker(): VoicePicker
    {
        return new VoicePicker($this->catalog());
    }

    /** Null when recording is switched off. */
    public function voicer(?string $driver = null): ?Voicer
    {
        $engine = $this->engine($driver);

        return $engine ? new Voicer($engine, $this->catalog(), $this->config['cache_dir'] ?? null) : null;
    }

    /** Null when recording is switched off. */
    public function scenarioVoicer(ScenarioStore $store, ?string $driver = null): ?ScenarioVoicer
    {
        $voicer = $this->voicer($driver);

        return $voicer ? new ScenarioVoicer($store, $voicer) : null;
    }
}
