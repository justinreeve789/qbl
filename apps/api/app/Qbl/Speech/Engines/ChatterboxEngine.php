<?php

namespace App\Qbl\Speech\Engines;

use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechError;

/**
 * Chatterbox (Resemble AI, MIT), an open-weight model that speaks in the voice of a short reference
 * clip and can put more or less feeling into it: the "chatterbox" container in docker-compose.yml
 * (docker/chatterbox). Like Kokoro it runs on the server and costs nothing per line, and the
 * container reports when every word is said (it aligns the words to the recording afterwards).
 *
 * A voice is ['clip' => the name of a clip the container keeps (the catalog's voice key, "heart"),
 * 'exaggeration' => 0.25 to 2 (0.5 even, 0.7 lively, more is theatrical), 'cfg_weight' => 0 to 1
 * (lower is slower and more deliberate; lower it as exaggeration goes up), 'temperature', 'speed'
 * (0.5 to 2), 'volume' (0.1 to 4), 'seed' (the same seed, clip and text give the same take)].
 *
 * A clip the container does not have yet is made when it is first needed, by $clips (see
 * ChatterboxClips: the catalog voice recorded with Kokoro, so a character keeps the voice it had),
 * and uploaded. With no $clips the container's error says how to add one.
 */
class ChatterboxEngine implements SpeechEngine
{
    /** @var ?\Closure(string): string  makes the audio of a clip, by name */
    private ?\Closure $clips = null;

    public function __construct(
        private HttpClient $http,
        private string $url = 'http://chatterbox:8004',
        private int $timeout = 300,
    ) {
        $this->url = rtrim($this->url, '/');
    }

    /** @param array{url?: string, timeout?: int} $config */
    public static function fromConfig(array $config, ?HttpClient $http = null): self
    {
        return new self($http ?? new CurlHttpClient(1), (string) ($config['url'] ?? 'http://chatterbox:8004'), (int) ($config['timeout'] ?? 300));
    }

    /** @param ?callable(string): string $clips  the audio of a clip, by name; throws SpeechError when it cannot */
    public function withClips(?callable $clips): self
    {
        $this->clips = $clips === null ? null : \Closure::fromCallable($clips);

        return $this;
    }

    public function name(): string
    {
        return 'chatterbox';
    }

    public function synthesize(string $text, array $voice, ?string $lang = null): Speech
    {
        $clip = isset($voice['clip']) && $voice['clip'] !== '' ? (string) $voice['clip'] : null;
        $body = array_filter([
            'input' => $text,
            'voice' => $clip,
            'language' => $lang ?: 'en',
            'exaggeration' => isset($voice['exaggeration']) ? max(0.0, min(2.0, (float) $voice['exaggeration'])) : null,
            'cfg_weight' => isset($voice['cfg_weight']) ? max(0.0, min(1.0, (float) $voice['cfg_weight'])) : null,
            'temperature' => isset($voice['temperature']) ? max(0.05, min(5.0, (float) $voice['temperature'])) : null,
            'seed' => isset($voice['seed']) ? (int) $voice['seed'] : null,
            'speed' => isset($voice['speed']) && (float) $voice['speed'] !== 1.0 ? max(0.5, min(2.0, (float) $voice['speed'])) : null,
            'volume' => isset($voice['volume']) && (float) $voice['volume'] !== 1.0 ? max(0.1, min(4.0, (float) $voice['volume'])) : null,
            'response_format' => 'mp3',
            'return_timestamps' => true,
        ], fn ($v) => $v !== null);

        $response = $this->send('POST', '/v1/speech', $body);
        if ($response->status === 404 && $clip !== null && $this->clips !== null && str_contains($response->body, 'voice clip')) {
            $this->upload($clip, ($this->clips)($clip));
            $response = $this->send('POST', '/v1/speech', $body);
        }
        $data = $this->json($response);
        $audio = base64_decode((string) ($data['audio'] ?? ''), true);
        if ($audio === false || $audio === '') {
            throw new SpeechError('Chatterbox answered without audio.');
        }
        $words = Speech::words(array_map(fn ($t) => [$t['word'] ?? '', $t['start_time'] ?? null, $t['end_time'] ?? 0], (array) ($data['timestamps'] ?? [])));
        $duration = isset($data['duration']) ? (int) round((float) $data['duration'] * 1000) : ($words ? $words[array_key_last($words)]['e'] : null);

        return new Speech($audio, 'mp3', $words, $duration);
    }

    /** Keeps a clip in the container, under a name: any audio ffmpeg reads, at least 3 seconds (10 to 20 is best). */
    public function upload(string $clip, string $audio): float
    {
        if (! preg_match('/^[A-Za-z0-9_-]{1,64}$/', $clip)) {
            throw new SpeechError("\"$clip\" cannot be a clip's name: letters, digits, - and _ only.");
        }
        $data = $this->json($this->send('PUT', '/v1/voices/'.$clip, $audio, ['Content-Type' => 'application/octet-stream']));

        return (float) ($data['seconds'] ?? 0);
    }

    /** The clips the container has. */
    public function voices(): array
    {
        return array_values(array_map('strval', (array) ($this->json($this->send('GET', '/v1/audio/voices'))['voices'] ?? [])));
    }

    private function send(string $method, string $path, array|string|null $body = null, array $headers = []): \App\Qbl\Generation\Http\HttpResponse
    {
        try {
            return $this->http->send($method, $this->url.$path, $headers, $body, timeout: $this->timeout);
        } catch (\Throwable $e) {
            throw new SpeechError("The text-to-speech service at {$this->url} cannot be reached (is the chatterbox container running? COMPOSE_PROFILES=chatterbox, then docker compose up -d chatterbox): ".$e->getMessage(), 0, $e);
        }
    }

    private function json(\App\Qbl\Generation\Http\HttpResponse $response): array
    {
        if (! $response->ok()) {
            $detail = json_decode($response->body, true);
            $message = is_array($detail) ? (is_string($detail['detail'] ?? null) ? $detail['detail'] : json_encode($detail['detail'] ?? $detail, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)) : mb_substr($response->body, 0, 300);
            throw new SpeechError("Chatterbox refused ($response->status): $message");
        }
        $data = json_decode($response->body, true);
        if (! is_array($data)) {
            throw new SpeechError('Chatterbox answered with something that is not JSON.');
        }

        return $data;
    }
}
