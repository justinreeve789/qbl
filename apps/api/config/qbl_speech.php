<?php

use App\Qbl\Speech\Engines\ChatterboxEngine;
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
 * The settings are QL_TTS_*; their old names (QBL_TTS_*) are still read when the new one is not set.
 */
$env = function (string $key, mixed $default): mixed {
    foreach ([$key, str_replace('QL_TTS_', 'QBL_TTS_', $key)] as $name) {
        if (($v = env($name)) !== null && $v !== '') {
            return $v;
        }
    }

    return $default;
};

return [
    // Which service records: kokoro (the "tts" container in docker-compose.yml), chatterbox (the
    // "chatterbox" container: livelier, slower, needs COMPOSE_PROFILES=chatterbox), openai (any service
    // that speaks OpenAI's /v1/audio/speech; no word timings, so words are lit at an even pace), or
    // none (nothing is recorded; the browser reads every line).
    'driver' => $env('QL_TTS_DRIVER', 'kokoro'),

    // One entry per service. `class` is the App\Qbl\Speech\SpeechEngine that talks to it; the rest is
    // handed to that class's fromConfig(). Adding a service is a class and an entry here (see the docs).
    'engines' => [
        'kokoro' => [
            'class' => KokoroEngine::class,
            // Kokoro-FastAPI. In Docker Compose, the tts service.
            'url' => $env('QL_TTS_URL', 'http://tts:8880'),
            // Only when the service is started with API_KEYS.
            'api_key' => (string) $env('QL_TTS_API_KEY', ''),
            'timeout' => (int) $env('QL_TTS_TIMEOUT', 120),
        ],
        'chatterbox' => [
            'class' => ChatterboxEngine::class,
            // docker/chatterbox. In Docker Compose, the chatterbox service (COMPOSE_PROFILES=chatterbox).
            'url' => $env('QL_TTS_CHATTERBOX_URL', 'http://chatterbox:8004'),
            // A line takes several times longer than on Kokoro on a CPU.
            'timeout' => (int) $env('QL_TTS_CHATTERBOX_TIMEOUT', 300),
            // Chatterbox speaks in the voice of a reference clip. The first time a catalog voice is
            // used, its clip is recorded with this service (kokoro: the tts container must be running
            // then) and kept by the chatterbox container. none: clips are only uploaded
            // (php artisan qbl:chatterbox-clips).
            'clips_from' => $env('QL_TTS_CHATTERBOX_CLIPS_FROM', 'kokoro'),
        ],
        'openai' => [
            'class' => OpenAiSpeechEngine::class,
            'url' => $env('QL_TTS_OPENAI_URL', 'https://api.openai.com'),
            'api_key' => (string) $env('QL_TTS_OPENAI_KEY', (string) env('OPENAI_API_KEY', '')),
            'model' => $env('QL_TTS_OPENAI_MODEL', 'gpt-4o-mini-tts'),
            'timeout' => (int) $env('QL_TTS_TIMEOUT', 120),
        ],
    ],

    // The voices characters can be given, by name, with what each one is on every service.
    'voices' => $env('QL_TTS_VOICES', resource_path('speech/voices.json')),

    // How strongly voices with character are chosen over everyday ones when characters are given
    // voices (the generator, the editor's "Give everyone a voice", qbl:voice --assign). Every voice in
    // the catalog has a flair: 0 everyday, 1 with character, 2 theatrical (a giant, a pixie, a
    // pantomime villain). 3 (the default): a larger-than-life cast wherever a character's description
    // does not say otherwise. 0: voices are chosen by fit alone. Higher: theatrical nearly always.
    'flair' => (float) $env('QL_TTS_FLAIR', 3),

    // The narrator: the voice that reads what no character says (narration actions, and the text
    // overlays and infoboxes read aloud) in scenarios that do not choose one in their settings. A key
    // of the voice catalog, used for scenarios in its language; for other languages, and when this is
    // empty, the catalog's own narrators (in English "storyteller", a dramatic, charismatic voice).
    'narrator' => (string) $env('QL_TTS_NARRATOR', ''),

    // Recordings already made, by service, voice and text, so recording a scenario again (or a copy
    // of it) only records the lines that changed.
    'cache_dir' => $env('QL_TTS_CACHE_DIR', storage_path('app/speech')),
];
