<?php

use App\Qbl\Speech\Engines\KokoroEngine;
use App\Qbl\Speech\Engines\OpenAiSpeechEngine;

/**
 * Recorded voices for what characters say: `php artisan qbl:voice`, the editor's "Record voices"
 * and the AI scenario generator. See docs/src/content/docs/developers/voices.md.
 *
 * Lines are recorded once, by a text-to-speech service, and kept with the scenario as audio files
 * with the time of every word, so the game plays them and lights each word as it is said. Players
 * never wait on the service. A line with no recording is read by the browser's own voice, as before.
 *
 * Every value comes from the environment (.env); what is written here is only the fallback.
 */
$env = fn (string $key, mixed $default) => ($v = env($key)) === null || $v === '' ? $default : $v;

return [
    // Which service records: kokoro (the "tts" container in docker-compose.yml), openai (any service
    // that speaks OpenAI's /v1/audio/speech; no word timings, so words are lit at an even pace), or
    // none (nothing is recorded; the browser reads every line).
    'driver' => $env('QBL_TTS_DRIVER', 'kokoro'),

    // One entry per service. `class` is the App\Qbl\Speech\SpeechEngine that talks to it; the rest is
    // handed to that class's fromConfig(). Adding a service is a class and an entry here (see the docs).
    'engines' => [
        'kokoro' => [
            'class' => KokoroEngine::class,
            // Kokoro-FastAPI. In Docker Compose, the tts service.
            'url' => $env('QBL_TTS_URL', 'http://tts:8880'),
            // Only when the service is started with API_KEYS.
            'api_key' => (string) $env('QBL_TTS_API_KEY', ''),
            'timeout' => (int) $env('QBL_TTS_TIMEOUT', 120),
        ],
        'openai' => [
            'class' => OpenAiSpeechEngine::class,
            'url' => $env('QBL_TTS_OPENAI_URL', 'https://api.openai.com'),
            'api_key' => (string) $env('QBL_TTS_OPENAI_KEY', (string) env('OPENAI_API_KEY', '')),
            'model' => $env('QBL_TTS_OPENAI_MODEL', 'gpt-4o-mini-tts'),
            'timeout' => (int) $env('QBL_TTS_TIMEOUT', 120),
        ],
    ],

    // The voices characters can be given, by name, with what each one is on every service.
    'voices' => $env('QBL_TTS_VOICES', resource_path('speech/voices.json')),

    // The narrator: the voice that reads what no character says (narration actions, and the text
    // overlays and infoboxes read aloud) in scenarios that do not choose one in their settings. A key
    // of the voice catalog, used for scenarios in its language; for other languages, and when this is
    // empty, the catalog's own narrators (in English "storyteller", a dramatic, charismatic voice).
    'narrator' => (string) $env('QBL_TTS_NARRATOR', ''),

    // Recordings already made, by service, voice and text, so recording a scenario again (or a copy
    // of it) only records the lines that changed.
    'cache_dir' => $env('QBL_TTS_CACHE_DIR', storage_path('app/speech')),
];
