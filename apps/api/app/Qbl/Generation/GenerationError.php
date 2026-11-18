<?php

namespace App\Qbl\Generation;

use RuntimeException;

/** Something the generator could not do: a service refused, an answer could not be used, a limit was reached. */
class GenerationError extends RuntimeException {}
