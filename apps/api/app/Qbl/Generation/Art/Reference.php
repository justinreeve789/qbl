<?php

namespace App\Qbl\Generation\Art;

/** A picture sent with an image request, and what it is for ("the character sheet: draw this same character"). */
final class Reference
{
    public function __construct(public readonly string $bytes, public readonly string $role, public readonly string $mime = 'image/png') {}
}
