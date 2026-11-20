<?php

namespace App\Qbl\Billing;

use App\Qbl\Generation\Http\HttpClient;
use App\Qbl\StoreError;
use Throwable;

/**
 * The few Stripe API calls QBL makes, over the same HttpClient the generator uses (so tests answer
 * with recorded responses). No Stripe SDK: requests are form-encoded as Stripe expects.
 */
class Stripe
{
    public function __construct(private HttpClient $http, private string $secret, private string $baseUrl = 'https://api.stripe.com') {}

    /**
     * @param  array  $params  nested arrays are sent as Stripe's a[b][c]=… form fields
     * @param  string|null  $idempotencyKey  for creating things, so a retried request does not make two
     */
    public function request(string $method, string $path, array $params = [], ?string $idempotencyKey = null): array
    {
        $method = strtoupper($method);
        $url = rtrim($this->baseUrl, '/').'/v1/'.ltrim($path, '/');
        $query = self::form($params);
        $headers = ['Authorization' => 'Bearer '.$this->secret, 'Stripe-Version' => '2025-03-31.basil'];
        if ($idempotencyKey !== null) {
            $headers['Idempotency-Key'] = $idempotencyKey;
        }
        if ($method === 'GET' || $method === 'DELETE') {
            $url .= $query === '' ? '' : (str_contains($url, '?') ? '&' : '?').$query;
            $body = null;
        } else {
            $headers['Content-Type'] = 'application/x-www-form-urlencoded';
            $body = $query;
        }
        try {
            $response = $this->http->send($method, $url, $headers, $body, false, 30);
        } catch (Throwable $e) {
            throw new StoreError(502, 'Could not reach Stripe. Try again in a minute.');
        }
        $data = json_decode($response->body, true);
        if (! $response->ok()) {
            $message = is_array($data) ? ($data['error']['message'] ?? null) : null;
            throw new StoreError($response->status === 404 ? 404 : 502, $message ? "Stripe: $message" : "Stripe answered {$response->status}.");
        }

        return is_array($data) ? $data : [];
    }

    /** Stripe's form encoding: a[b]=1&a[c][0]=x, with booleans as true/false. */
    public static function form(array $params): string
    {
        $walk = function (array $value) use (&$walk) {
            foreach ($value as $k => $v) {
                if (is_bool($v)) {
                    $value[$k] = $v ? 'true' : 'false';
                } elseif (is_array($v)) {
                    $value[$k] = $walk($v);
                } elseif ($v === null) {
                    unset($value[$k]);
                }
            }

            return $value;
        };

        return http_build_query($walk($params), '', '&', PHP_QUERY_RFC1738);
    }

    /**
     * Whether a webhook's body was signed by Stripe with this endpoint's secret, recently: the
     * Stripe-Signature header is "t=<time>,v1=<hex HMAC-SHA256 of "<time>.<body>">" (maybe several v1).
     */
    public static function verifySignature(string $payload, ?string $header, string $secret, int $tolerance = 300, ?int $now = null): bool
    {
        if ($header === null || $header === '' || $secret === '') {
            return false;
        }
        $time = null;
        $signatures = [];
        foreach (explode(',', $header) as $part) {
            [$k, $v] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($k === 't' && ctype_digit($v)) {
                $time = (int) $v;
            } elseif ($k === 'v1') {
                $signatures[] = $v;
            }
        }
        if ($time === null || ! $signatures || abs(($now ?? time()) - $time) > $tolerance) {
            return false;
        }
        $expected = hash_hmac('sha256', $time.'.'.$payload, $secret);
        foreach ($signatures as $signature) {
            if (hash_equals($expected, $signature)) {
                return true;
            }
        }

        return false;
    }

    /** A signature header for a payload, as Stripe makes it (for tests and the Stripe CLI-less local check). */
    public static function sign(string $payload, string $secret, ?int $time = null): string
    {
        $time ??= time();

        return "t=$time,v1=".hash_hmac('sha256', $time.'.'.$payload, $secret);
    }
}
