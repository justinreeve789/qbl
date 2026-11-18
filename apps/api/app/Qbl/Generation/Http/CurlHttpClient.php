<?php

namespace App\Qbl\Generation\Http;

use App\Qbl\Generation\GenerationError;

/**
 * HttpClient over PHP's curl extension. Retries what is worth retrying (429, 5xx, a dropped
 * connection) with backoff, honouring Retry-After, because a scenario takes dozens of calls and
 * one hiccup should not cost the whole run.
 */
class CurlHttpClient implements HttpClient
{
    public function __construct(private int $retries = 4, private ?\Closure $sleep = null) {}

    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse
    {
        $attempt = 0;
        while (true) {
            $attempt++;
            try {
                $response = $this->once($method, $url, $headers, $body, $multipart, $timeout);
            } catch (GenerationError $e) {
                if ($attempt > $this->retries) {
                    throw $e;
                }
                $this->pause($attempt, null);

                continue;
            }
            if (($response->status === 429 || $response->status >= 500) && $attempt <= $this->retries) {
                $this->pause($attempt, $response->headers['retry-after'] ?? null);

                continue;
            }

            return $response;
        }
    }

    private function once(string $method, string $url, array $headers, array|string|null $body, bool $multipart, int $timeout): HttpResponse
    {
        $ch = curl_init($url);
        $lines = [];
        foreach ($headers as $name => $value) {
            $lines[] = "$name: $value";
        }
        if (is_array($body) && ! $multipart) {
            $body = json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
            $lines[] = 'Content-Type: application/json';
        }
        if (is_array($body) && $multipart) {
            $body = self::flatten($body);
        }
        $received = [];
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST => strtoupper($method),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => $lines,
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_CONNECTTIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_HEADERFUNCTION => function ($ch, string $line) use (&$received) {
                if (str_contains($line, ':')) {
                    [$name, $value] = explode(':', $line, 2);
                    $received[strtolower(trim($name))] = trim($value);
                }

                return strlen($line);
            },
        ]);
        if ($body !== null) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
        }
        $text = curl_exec($ch);
        if ($text === false) {
            $error = curl_error($ch);
            curl_close($ch);
            throw new GenerationError("Could not reach $url: $error");
        }
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        return new HttpResponse($status, (string) $text, $received);
    }

    /** curl takes `image[]` style fields only as separately named keys. */
    private static function flatten(array $fields): array
    {
        $out = [];
        foreach ($fields as $name => $value) {
            if (is_array($value)) {
                foreach (array_values($value) as $i => $part) {
                    $out[$name."[$i]"] = $part;
                }
            } else {
                $out[$name] = $value;
            }
        }

        return $out;
    }

    private function pause(int $attempt, ?string $retryAfter): void
    {
        $seconds = is_numeric($retryAfter) ? min(60, (int) $retryAfter) : min(30, 2 ** $attempt);
        $this->sleep ? ($this->sleep)($seconds) : sleep($seconds);
    }
}
