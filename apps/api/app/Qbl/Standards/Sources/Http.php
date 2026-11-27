<?php

namespace App\Qbl\Standards\Sources;

use RuntimeException;

/** Minimal GET with retries; no framework so the dev server and tests can use it. */
final class Http
{
    public static function get(string $url, array $headers = [], int $tries = 4): string
    {
        $last = '';
        for ($i = 1; $i <= $tries; $i++) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => true, CURLOPT_TIMEOUT => 120,
                CURLOPT_HTTPHEADER => array_merge(['User-Agent: QBL standards importer', 'Accept: */*'], $headers),
            ]);
            $body = curl_exec($ch);
            $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
            $err = curl_error($ch);
            curl_close($ch);
            if ($body !== false && $status >= 200 && $status < 300) {
                return $body;
            }
            $last = $err ?: "HTTP $status";
            if ($status >= 400 && $status < 500 && $status !== 429) {
                break;
            }
            sleep(2 * $i);
        }
        throw new RuntimeException("GET $url failed: $last");
    }
}
