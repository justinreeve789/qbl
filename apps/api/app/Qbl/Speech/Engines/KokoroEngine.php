<?php

namespace App\Qbl\Speech\Engines;

use App\Qbl\Generation\Http\CurlHttpClient;
use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\Speech\Speech;
use App\Qbl\Speech\SpeechEngine;
use App\Qbl\Speech\SpeechError;

/**
 * Kokoro, an open-weight text-to-speech model (Apache 2.0), served by Kokoro-FastAPI: the "tts"
 * container in docker-compose.yml. Runs on the server's own CPU (or a GPU), costs nothing per line,
 * and reports when every word is said.
 *
 * A voice is ['voice' => one of its voices ("af_heart") or a blend of them ("af_bella(2)+af_sky(1)",
 * weighted), 'speed' => 0.25 to 4, 'lang' => its language code, only to override the one the voice
 * implies ("a": a Japanese voice reading English), 'volume' => 0.1 to 4, for a voice that comes out
 * quieter or louder than the others]. See https://github.com/remsky/Kokoro-FastAPI.
 *
 * A blend can also take a voice away: "am_santa(1.5)-am_michael(0.5)" is Santa pushed further from
 * an ordinary man than Santa is, a caricature of him. That is how the catalog's theatrical voices
 * (giants, pixies, wizards) are made. The weights are sent adding up to 1 (those taken away counted
 * as negative), and the service must use them as they are: VOICE_WEIGHT_NORMALIZATION=false, as the
 * tts container in docker-compose.yml has it. A service left at its default still speaks such a
 * voice clearly, only much closer to the ordinary one.
 */
class KokoroEngine implements SpeechEngine
{
    public function __construct(
        private HttpClient $http,
        private string $url = 'http://tts:8880',
        private string $apiKey = '',
        private int $timeout = 120,
    ) {
        $this->url = rtrim($this->url, '/');
    }

    /** @param array{url?: string, api_key?: string, timeout?: int} $config */
    public static function fromConfig(array $config, ?HttpClient $http = null): self
    {
        // One retry: the editor waits on this, and a service that is down stays down.
        return new self($http ?? new CurlHttpClient(1), (string) ($config['url'] ?? 'http://tts:8880'), (string) ($config['api_key'] ?? ''), (int) ($config['timeout'] ?? 120));
    }

    public function name(): string
    {
        return 'kokoro';
    }

    public function synthesize(string $text, array $voice, ?string $lang = null): Speech
    {
        $body = [
            'model' => 'kokoro',
            'input' => $text,
            'voice' => self::blend((string) ($voice['voice'] ?? 'af_heart')),
            'response_format' => 'mp3',
            'speed' => max(0.25, min(4.0, (float) ($voice['speed'] ?? 1.0))),
            'stream' => false,
            'return_timestamps' => true,
        ];
        if (! empty($voice['lang'])) {
            $body['lang_code'] = (string) $voice['lang'];
        }
        if (isset($voice['volume']) && (float) $voice['volume'] !== 1.0) {
            $body['volume_multiplier'] = max(0.1, min(4.0, (float) $voice['volume']));
        }
        $data = $this->call('POST', '/dev/captioned_speech', $body);
        $audio = base64_decode((string) ($data['audio'] ?? ''), true);
        if ($audio === false || $audio === '') {
            throw new SpeechError('Kokoro answered without audio.');
        }
        $words = Speech::words(array_map(fn ($t) => [$t['word'] ?? '', $t['start_time'] ?? null, $t['end_time'] ?? 0], (array) ($data['timestamps'] ?? [])));
        // Kokoro-FastAPI 0.10 gives no word timings for some Spanish lines with both ¡ and ¿ in them.
        // The marks change nothing in how the line sounds (its ? and ! stay), so ask again without them.
        if (! $words && preg_match('/[¡¿]/u', $text)) {
            $again = $this->synthesize(str_replace(['¡', '¿'], '', $text), $voice, $lang);
            if ($again->words) {
                return $again;
            }
        }

        return new Speech($audio, 'mp3', $words, $words ? $words[array_key_last($words)]['e'] : null);
    }

    /**
     * A blend as Kokoro-FastAPI is sent it, with weights that add up to 1 once those taken away are
     * counted as negative: "af_bella(2)+af_sky(1)" is "af_bella(0.6667)+af_sky(0.3333)", and
     * "am_santa(3)-am_michael(1)" is "am_santa(1.5)-am_michael(0.5)". A single voice is its name.
     */
    public static function blend(string $voice): string
    {
        $parts = self::parts($voice);
        if (count($parts) === 1 && $parts[0][1] > 0) {
            return $parts[0][0];
        }
        $sum = array_sum(array_column($parts, 1));
        if ($sum <= 0) {
            throw new SpeechError("The voice \"$voice\" takes away as much as it adds, which leaves no voice.");
        }
        $out = '';
        foreach ($parts as $i => [$name, $weight]) {
            if ($i === 0 && $weight < 0) {
                throw new SpeechError("The voice \"$voice\" must start with a voice that is added.");
            }
            $out .= ($i === 0 ? '' : ($weight < 0 ? '-' : '+')).$name.'('.rtrim(rtrim(number_format(abs($weight) / $sum, 4, '.', ''), '0'), '.').')';
        }

        return $out;
    }

    /**
     * The voices a blend is made of, with the weight of each (negative when taken away).
     *
     * @return list<array{0: string, 1: float}>
     */
    public static function parts(string $voice): array
    {
        $parts = [];
        foreach (preg_split('/([+-])/', $voice, -1, PREG_SPLIT_DELIM_CAPTURE) as $i => $token) {
            if ($i % 2) {
                $sign = $token === '-' ? -1.0 : 1.0;

                continue;
            }
            if (! preg_match('/^\s*([A-Za-z0-9_]+)\s*(?:\(\s*(\d+(?:\.\d+)?)\s*\))?\s*$/', $token, $m) || (isset($m[2]) && (float) $m[2] <= 0)) {
                throw new SpeechError("\"$voice\" is not a Kokoro voice or a blend of them, such as af_bella(2)+af_sky(1).");
            }
            $parts[] = [$m[1], ($sign ?? 1.0) * (float) ($m[2] ?? 1)];
        }

        return $parts;
    }

    public function voices(): array
    {
        $data = $this->call('GET', '/v1/audio/voices');

        return array_values(array_map(fn ($v) => is_array($v) ? (string) ($v['id'] ?? $v['name'] ?? '') : (string) $v, (array) ($data['voices'] ?? [])));
    }

    private function call(string $method, string $path, ?array $body = null): array
    {
        $headers = $this->apiKey !== '' ? ['Authorization' => 'Bearer '.$this->apiKey] : [];
        try {
            $response = $this->http->send($method, $this->url.$path, $headers, $body, timeout: $this->timeout);
        } catch (\Throwable $e) {
            throw new SpeechError("The text-to-speech service at {$this->url} cannot be reached (is the tts container running? docker compose up -d tts): ".$e->getMessage(), 0, $e);
        }
        if (! $response->ok()) {
            $detail = json_decode($response->body, true);
            $message = is_array($detail) ? json_encode($detail['detail'] ?? $detail, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) : mb_substr($response->body, 0, 300);
            throw new SpeechError("Kokoro refused ($response->status): $message");
        }
        $data = json_decode($response->body, true);
        if (! is_array($data)) {
            throw new SpeechError('Kokoro answered with something that is not JSON.');
        }

        return $data;
    }
}
