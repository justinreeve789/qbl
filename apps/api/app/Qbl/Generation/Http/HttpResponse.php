<?php

namespace App\Qbl\Generation\Http;

use App\Qbl\Generation\GenerationError;

final class HttpResponse
{
    public function __construct(
        public readonly int $status,
        public readonly string $body,
        /** @var array<string, string> lower-cased names */
        public readonly array $headers = [],
    ) {}

    public function ok(): bool
    {
        return $this->status >= 200 && $this->status < 300;
    }

    public function json(): array
    {
        $data = json_decode($this->body, true);
        if (! is_array($data)) {
            throw new GenerationError('The service answered with something that is not JSON: '.mb_substr($this->body, 0, 200));
        }

        return $data;
    }
}
