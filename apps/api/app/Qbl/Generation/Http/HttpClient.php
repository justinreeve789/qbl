<?php

namespace App\Qbl\Generation\Http;

/**
 * The one way the generator talks to outside services (the language model, image generators,
 * the standards API). An interface so the tests can answer with recorded responses and no network.
 */
interface HttpClient
{
    /**
     * @param  array<string, string>  $headers
     * @param  array|string|null  $body  An array is sent as JSON, unless $multipart is true (then as form data;
     *                                   a value that is a \CURLFile, or a list of them, is a file part).
     */
    public function send(string $method, string $url, array $headers = [], array|string|null $body = null, bool $multipart = false, int $timeout = 120): HttpResponse;
}
