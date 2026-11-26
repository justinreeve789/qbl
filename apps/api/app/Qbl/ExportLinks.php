<?php

namespace App\Qbl;

/**
 * Short-lived links to download a scenario's ZIP (EditorApi: POST scenarios/{id}/export-link).
 *
 * The editor signs in with a Bearer token, which a plain browser download cannot send. Fetching
 * the ZIP with script instead holds the whole file in the page's memory first, and large
 * scenarios fail there (Chrome: "net::ERR_FAILED 200"). So the editor asks for a link, signed for
 * the scenario and the user, and lets the browser download from it: streamed to disk, with the
 * browser's own progress bar. Framework-free; the secret is the app key (or the dev server's).
 */
class ExportLinks
{
    public function __construct(
        private string $secret,
        /** How long a link works, in seconds. It is used at once; this only covers a slow click. */
        private int $ttl = 300,
    ) {
        if ($secret === '') {
            throw new \InvalidArgumentException('ExportLinks needs a secret.');
        }
    }

    /** A ticket for one scenario and one user, to put in the link's path. */
    public function make(int $scenarioId, int $userId, ?int $now = null): string
    {
        $payload = self::b64(json_encode(['s' => $scenarioId, 'u' => $userId, 'e' => ($now ?? time()) + $this->ttl]));

        return $payload.'.'.self::b64(hash_hmac('sha256', $payload, $this->secret, true));
    }

    /** [scenario id, user id] from a ticket that is genuine and not expired, or null. */
    public function read(string $ticket, ?int $now = null): ?array
    {
        if (! preg_match('/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/', $ticket, $m)) {
            return null;
        }
        if (! hash_equals(self::b64(hash_hmac('sha256', $m[1], $this->secret, true)), $m[2])) {
            return null;
        }
        $data = json_decode((string) base64_decode(strtr($m[1], '-_', '+/')), true);
        if (! is_array($data) || ! is_int($data['s'] ?? null) || ! is_int($data['u'] ?? null) || ! is_int($data['e'] ?? null)) {
            return null;
        }
        if ($data['e'] < ($now ?? time())) {
            return null;
        }

        return [$data['s'], $data['u']];
    }

    private static function b64(string $bytes): string
    {
        return rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
