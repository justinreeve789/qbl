<?php

namespace App\Qbl\Speech\Engines;

use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\VoiceCatalog;

/**
 * ElevenLabs (https://elevenlabs.io), a paid text-to-speech service: very natural voices in many
 * languages, charged by the character. Off unless QL_TTS_DRIVER=elevenlabs and QL_TTS_ELEVENLABS_KEY
 * are set; Kokoro stays the default. Lines are recorded once and kept, as with every service, so a
 * scenario costs its characters' lines once (and again only for lines that change).
 *
 * Asked through POST /v1/text-to-speech/{voice_id}/with-timestamps, which returns the audio and the
 * time of every character of the text; the characters are put together into words here.
 *
 * Which ElevenLabs voice speaks a catalog voice is worked out from the account's own voices (GET
 * /v1/voices), not written into the catalog: ElevenLabs retires its default voices from time to time
 * (the current set on 2026-12-31), and every account has different ones. A voice is:
 *
 *   ['key' => the catalog voice (spreads catalog voices that sound alike over the account's voices,
 *            and is what QL_TTS_ELEVENLABS_VOICES pins),
 *    'gender' => female|male|neutral, 'age' => child|young|adult|elder, 'accent' => "American",
 *    'lang' => "en-US", 'traits' => [...] (words its description should share),
 *    'voice' => an ElevenLabs voice id or name, to use that one whatever the rest says,
 *    'stability' => 0..1, 'similarity_boost' => 0..1, 'style' => 0..1, 'speed' => 0.7..1.2]
 *
 * The account's voice whose labels (gender, age, accent, language, description) fit best speaks it;
 * among those that fit (nearly) as well, the catalog key chooses, so the same catalog voice always gets the
 * same ElevenLabs voice while the account's voices stay the same. Voices of the "cloned" category (a
 * real person's voice, often a teacher's own) are only used when pinned, never picked for a character.
 */
class ElevenLabsEngine implements SpeechEngine
{
    /** Models that take a language_code; the others (multilingual v2) work the language out themselves. */
    private const LANGUAGE_CODE_MODELS = '/^eleven_(flash_v2_5|turbo_v2_5|v3)/';

    /** Voices that fit within this much of the best are all good enough; the catalog key picks one. */
    private const CLOSE = 1.0;

    /** @var ?list<array{id: string, name: string, category: string, gender: string, age: string, accent: string, langs: list<string>, about: string}> */
    private ?array $account = null;

    /**
     * @param  array<string, string>  $pins  catalog key => ElevenLabs voice id or name
     * @param  list<string>  $skip  voice categories never picked for a character (pins still use them)
     */
    public function __construct(
        private HttpClient $http,
        private string $apiKey,
        private string $model = 'eleven_multilingual_v2',
        private string $url = 'https://api.elevenlabs.io',
        private int $timeout = 120,
        private array $pins = [],
        private array $skip = ['cloned'],
        private string $format = 'mp3_44100_128',
    ) {
        $this->url = rtrim($this->url, '/');
    }

    /**
     * @param  array{api_key?: string, model?: string, url?: string, timeout?: int, voices?: string|array, skip_categories?: string|array, output_format?: string}  $config
     */
    public static function fromConfig(array $config, ?HttpClient $http = null): self
    {
        return new self(
            $http ?? new CurlHttpClient(1),
            (string) ($config['api_key'] ?? ''),
            (string) ($config['model'] ?? '') ?: 'eleven_multilingual_v2',
            (string) ($config['url'] ?? '') ?: 'https://api.elevenlabs.io',
            (int) ($config['timeout'] ?? 120),
            self::pins($config['voices'] ?? []),
            self::listOf($config['skip_categories'] ?? 'cloned'),
            (string) ($config['output_format'] ?? '') ?: 'mp3_44100_128',
        );
    }

    /**
     * Pins as written in QL_TTS_ELEVENLABS_VOICES: "storyteller=JBFqnCBsd6RMkjVDRZzb, heart=Sarah".
     *
     * @return array<string, string>
     */
    public static function pins(string|array $pins): array
    {
        if (is_array($pins)) {
            return array_filter(array_map(fn ($v) => trim((string) $v), $pins), fn ($v) => $v !== '');
        }
        $out = [];
        foreach (preg_split('/[,;\n]+/', $pins) as $pair) {
            if (str_contains($pair, '=')) {
                [$key, $voice] = array_map('trim', explode('=', $pair, 2));
                if ($key !== '' && $voice !== '') {
                    $out[$key] = $voice;
                }
            }
        }

        return $out;
    }

    public function name(): string
    {
        return 'elevenlabs';
    }

    public function synthesize(string $text, array $voice, ?string $lang = null): Speech
    {
        $chosen = $this->resolve($voice, $lang);
        $settings = array_filter([
            'stability' => self::unit($voice['stability'] ?? 0.5),
            'similarity_boost' => self::unit($voice['similarity_boost'] ?? 0.75),
            'style' => self::unit($voice['style'] ?? 0.0),
            'use_speaker_boost' => true,
            'speed' => isset($voice['speed']) ? max(0.7, min(1.2, (float) $voice['speed'])) : null,
        ], fn ($v) => $v !== null);
        $lang = $lang ?: (isset($voice['lang']) ? (string) $voice['lang'] : null);
        $body = [
            'text' => $text,
            'model_id' => $this->model,
            'voice_settings' => $settings,
            // The same line in the same voice comes out the same when it is recorded again.
            'seed' => crc32($chosen['id']."\n".$text) % 4294967295,
        ];
        if ($lang && preg_match(self::LANGUAGE_CODE_MODELS, $this->model)) {
            $body['language_code'] = VoiceCatalog::primary($lang);
        }
        $data = $this->call('POST', '/v1/text-to-speech/'.rawurlencode($chosen['id']).'/with-timestamps?output_format='.rawurlencode($this->format), $body);
        $audio = base64_decode((string) ($data['audio_base64'] ?? ''), true);
        if ($audio === false || $audio === '') {
            throw new SpeechError('ElevenLabs answered without audio.');
        }
        $alignment = is_array($data['alignment'] ?? null) ? $data['alignment'] : (is_array($data['normalized_alignment'] ?? null) ? $data['normalized_alignment'] : []);
        $words = self::words($alignment);
        $end = (array) ($alignment['character_end_times_seconds'] ?? []);
        $duration = $end ? (int) round((float) max($end) * 1000) : ($words ? $words[array_key_last($words)]['e'] : null);
        // Japanese and Chinese are written without spaces between words: the whole line would be one
        // "word", so leave them untimed, as Kokoro does (the game paces them evenly).
        if ($lang && in_array(VoiceCatalog::primary($lang), ['ja', 'zh'], true)) {
            $words = [];
        }

        return new Speech($audio, $this->format === '' || str_starts_with($this->format, 'mp3') ? 'mp3' : explode('_', $this->format)[0], $words, $duration);
    }

    /**
     * ElevenLabs times every character; words are the runs between spaces, from the start of their
     * first character to the end of their last.
     *
     * @param  array{characters?: list<string>, character_start_times_seconds?: list<float>, character_end_times_seconds?: list<float>}  $alignment
     * @return list<array{w: string, s: int, e: int}>
     */
    public static function words(array $alignment): array
    {
        $chars = array_values((array) ($alignment['characters'] ?? []));
        $starts = array_values((array) ($alignment['character_start_times_seconds'] ?? []));
        $ends = array_values((array) ($alignment['character_end_times_seconds'] ?? []));
        $timed = [];
        $word = '';
        $from = $to = 0.0;
        foreach ($chars as $i => $c) {
            $c = (string) $c;
            if (preg_match('/^\s*$/u', $c)) {
                if ($word !== '') {
                    $timed[] = [$word, $from, $to];
                    $word = '';
                }

                continue;
            }
            if ($word === '') {
                $from = (float) ($starts[$i] ?? $to);
            }
            $word .= $c;
            $to = (float) ($ends[$i] ?? $starts[$i] ?? $to);
        }
        if ($word !== '') {
            $timed[] = [$word, $from, $to];
        }

        return Speech::words($timed);
    }

    /**
     * The account's voice that speaks a catalog voice: its pin, its own `voice`, or the best fit.
     *
     * @return array{id: string, name: string, pinned: bool}
     */
    public function resolve(array $voice, ?string $lang = null): array
    {
        $key = (string) ($voice['key'] ?? '');
        $wanted = $this->pins[$key] ?? (isset($voice['voice']) && trim((string) $voice['voice']) !== '' ? trim((string) $voice['voice']) : null);
        $account = $this->account();
        if ($wanted !== null) {
            foreach ($account as $v) {
                if ($v['id'] === $wanted || strcasecmp($v['name'], $wanted) === 0) {
                    return ['id' => $v['id'], 'name' => $v['name'], 'pinned' => true];
                }
            }
            // An id that is not among the account's voices may still be one it can use (a library voice).
            if (preg_match('/^[A-Za-z0-9]{16,32}$/', $wanted)) {
                return ['id' => $wanted, 'name' => $wanted, 'pinned' => true];
            }
            throw new SpeechError("The ElevenLabs account has no voice called \"$wanted\" (pinned for \"$key\"). Use a voice id from My Voices, or remove the pin from QL_TTS_ELEVENLABS_VOICES.");
        }

        $candidates = array_values(array_filter($account, fn ($v) => ! in_array($v['category'], $this->skip, true)));
        if (! $candidates) {
            throw new SpeechError('The ElevenLabs account has no voices to give characters'.($account ? ' (only '.implode(', ', array_unique(array_column($account, 'category'))).' voices, which are not picked; pin them with QL_TTS_ELEVENLABS_VOICES)' : '').'. Add voices from the ElevenLabs Voice Library to My Voices.');
        }
        $lang = VoiceCatalog::primary((string) ($lang ?: ($voice['lang'] ?? 'en')));
        $scored = array_map(fn ($v) => [$v, self::fit($voice, $v, $lang)], $candidates);
        $bestScore = max(array_column($scored, 1));
        $best = array_column(array_filter($scored, fn ($s) => $s[1] >= $bestScore - self::CLOSE), 0);
        usort($best, fn ($a, $b) => strcmp($a['id'], $b['id']));
        $v = $best[crc32($key !== '' ? $key : json_encode($voice)) % count($best)];

        return ['id' => $v['id'], 'name' => $v['name'], 'pinned' => false];
    }

    /** How well one of the account's voices fits a catalog voice: higher is better. */
    private static function fit(array $want, array $have, string $lang): float
    {
        $score = 0.0;
        $gender = strtolower((string) ($want['gender'] ?? ''));
        if ($gender !== '') {
            $score += $have['gender'] === $gender ? 8 : ($have['gender'] === '' || $gender === 'neutral' ? 2 : 0);
        }
        // ElevenLabs labels voices young, middle aged or old. A young voice can play an adult (and the
        // other way round) nearly as well, so they come within CLOSE of each other and share the
        // catalog's many adults; elders and children keep to their own.
        $age = strtolower((string) ($want['age'] ?? 'adult'));
        $score += match ([$age, $have['age']]) {
            ['child', 'child'], ['child', 'young'], ['young', 'young'], ['adult', 'adult'], ['elder', 'elder'] => 3,
            ['young', 'adult'], ['adult', 'young'] => 2.25,
            ['young', 'child'], ['adult', 'elder'], ['elder', 'adult'] => 1.5,
            ['child', 'adult'] => 1,
            default => $have['age'] === '' ? 1 : 0,
        };
        $accent = strtolower((string) ($want['accent'] ?? ''));
        if ($accent !== '' && $have['accent'] !== '') {
            $score += str_contains($have['accent'], $accent) || str_contains($accent, $have['accent']) ? 3 : 0;
        }
        if ($lang !== 'en') {
            $score += in_array($lang, $have['langs'], true) ? 4 : 0;
        }
        foreach ((array) ($want['traits'] ?? []) as $trait) {
            $trait = strtolower((string) $trait);
            if ($trait !== '' && preg_match('/\b'.preg_quote($trait, '/').'/', $have['about'])) {
                $score += 0.5;
            }
        }
        // Voices made for characters and stories over those made for adverts and phone lines.
        if (preg_match('/\b(character|characters|narrat|story|animation|audiobook|children)/', $have['about'])) {
            $score += 0.25;
        }

        return $score;
    }

    /**
     * The account's voices, as GET /v1/voices lists them, asked once.
     *
     * @return list<array{id: string, name: string, category: string, gender: string, age: string, accent: string, langs: list<string>, about: string}>
     */
    private function account(): array
    {
        if ($this->account !== null) {
            return $this->account;
        }
        $data = $this->call('GET', '/v1/voices');
        $out = [];
        foreach ((array) ($data['voices'] ?? []) as $v) {
            if (! is_array($v) || empty($v['voice_id'])) {
                continue;
            }
            $labels = array_change_key_case(array_map(fn ($l) => strtolower(trim((string) $l)), array_filter((array) ($v['labels'] ?? []), 'is_scalar')));
            $age = str_replace(['-', ' '], '_', $labels['age'] ?? '');
            $gender = $labels['gender'] ?? '';
            $langs = [];
            foreach ((array) ($v['verified_languages'] ?? []) as $l) {
                if (is_array($l) && ! empty($l['language'])) {
                    $langs[] = VoiceCatalog::primary((string) $l['language']);
                }
            }
            if (! empty($labels['language'])) {
                $langs[] = VoiceCatalog::primary($labels['language']);
            }
            $out[] = [
                'id' => (string) $v['voice_id'],
                'name' => (string) ($v['name'] ?? $v['voice_id']),
                'category' => strtolower((string) ($v['category'] ?? '')),
                'gender' => match (true) { in_array($gender, ['female', 'woman'], true) => 'female', in_array($gender, ['male', 'man'], true) => 'male', $gender === '' => '', default => 'neutral' },
                'age' => match ($age) { 'child', 'kid' => 'child', 'young', 'young_adult' => 'young', 'middle_aged', 'adult' => 'adult', 'old', 'elderly', 'senior' => 'elder', default => '' },
                'accent' => $labels['accent'] ?? '',
                'langs' => array_values(array_unique($langs)),
                'about' => strtolower(implode(' ', array_filter([$labels['description'] ?? '', $labels['descriptive'] ?? '', $labels['use_case'] ?? '', $labels['use case'] ?? '', (string) ($v['description'] ?? '')]))),
            ];
        }

        return $this->account = $out;
    }

    public function voices(): array
    {
        return array_column($this->account(), 'id');
    }

    private static function unit(mixed $v): float
    {
        return max(0.0, min(1.0, (float) $v));
    }

    /** @return list<string> */
    private static function listOf(string|array $v): array
    {
        $items = is_array($v) ? $v : preg_split('/[,\s]+/', $v);

        return array_values(array_filter(array_map(fn ($c) => strtolower(trim((string) $c)), $items), fn ($c) => $c !== '' && $c !== 'none'));
    }

    private function call(string $method, string $path, ?array $body = null): array
    {
        if ($this->apiKey === '') {
            throw new SpeechError('ElevenLabs needs an API key: set QL_TTS_ELEVENLABS_KEY (from elevenlabs.io, My Account → API Keys), or go back to Kokoro with QL_TTS_DRIVER=kokoro.');
        }
        try {
            $response = $this->http->send($method, $this->url.$path, ['xi-api-key' => $this->apiKey, 'Accept' => 'application/json'], $body, timeout: $this->timeout);
        } catch (\Throwable $e) {
            throw new SpeechError("ElevenLabs ({$this->url}) cannot be reached: ".$e->getMessage(), 0, $e);
        }
        if (! $response->ok()) {
            $detail = json_decode($response->body, true);
            $detail = is_array($detail) ? ($detail['detail'] ?? $detail) : null;
            $message = is_array($detail) ? (string) ($detail['message'] ?? json_encode($detail, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) : (is_string($detail) ? $detail : mb_substr($response->body, 0, 300));
            $status = is_array($detail) ? (string) ($detail['status'] ?? '') : '';
            // ElevenLabs answers 401 both for a wrong key and for an account out of characters.
            $hint = match (true) {
                $response->status === 402 || $status === 'quota_exceeded' || str_contains(strtolower($message), 'quota') => ' The account is out of characters for this month.',
                $response->status === 401 => ' Check QL_TTS_ELEVENLABS_KEY, and that the key may use Text to Speech and read Voices.',
                $response->status === 429 => ' Too many requests at once for this plan; try again shortly.',
                default => '',
            };
            throw new SpeechError("ElevenLabs refused ($response->status): $message.$hint");
        }
        $data = json_decode($response->body, true);
        if (! is_array($data)) {
            throw new SpeechError('ElevenLabs answered with something that is not JSON.');
        }

        return $data;
    }
}
