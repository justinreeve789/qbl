<?php

namespace App\Qbl\Api;

use App\Qbl\StoreError;

/**
 * A problem to report to an API client: an HTTP status, a stable machine-readable code (which
 * clients may switch on; the message may be reworded), and for invalid input, which fields.
 */
class ApiError extends StoreError
{
    public function __construct(int $status, public readonly string $errorCode, string $message, public readonly array $fields = [])
    {
        parent::__construct($status, $message);
    }

    public static function invalid(string $field, string $message): self
    {
        return new self(422, 'invalid_request', $message, [$field => $message]);
    }

    public static function notFound(string $what = 'That'): self
    {
        return new self(404, 'not_found', "$what was not found.");
    }
}
