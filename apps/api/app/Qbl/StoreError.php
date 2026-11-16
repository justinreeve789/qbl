<?php

namespace App\Qbl;

use RuntimeException;

/** A problem to report to the caller, with the HTTP status that fits it. */
class StoreError extends RuntimeException
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}
