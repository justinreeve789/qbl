<?php

namespace App\Qbl\Speech;

/** The text-to-speech service could not record a line: it is not running, it refused, or it answered nonsense. */
class SpeechError extends \RuntimeException {}
