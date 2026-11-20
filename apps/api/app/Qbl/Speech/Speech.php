<?php

namespace App\Qbl\Speech;

/**
 * One recorded line: the audio, and when each word is said.
 *
 * `words` are in the order said, each ['w' => the word, 's' => start, 'e' => end] in milliseconds
 * from the start of the audio. They are empty when the service does not report timings; the game
 * then lights the words at an even pace over the recording instead.
 */
final class Speech
{
    /**
     * @param  list<array{w: string, s: int, e: int}>  $words
     */
    public function __construct(
        public readonly string $audio,
        /** The file type: mp3. */
        public readonly string $format,
        public readonly array $words = [],
        /** Milliseconds, when known. */
        public readonly ?int $duration = null,
    ) {}

    /**
     * Word timings in seconds (as most services give them) to the form kept here: milliseconds, and
     * only words, not the punctuation some services list as words of their own.
     *
     * @param  iterable<array{0: string, 1: float|int, 2: float|int}>  $timed  [word, start, end] in seconds
     * @return list<array{w: string, s: int, e: int}>
     */
    public static function words(iterable $timed): array
    {
        $out = [];
        foreach ($timed as [$word, $start, $end]) {
            $word = trim((string) $word);
            if ($word === '' || ! preg_match('/[\p{L}\p{N}]/u', $word) || ! is_numeric($start)) {
                continue;
            }
            $s = (int) round((float) $start * 1000);
            $out[] = ['w' => $word, 's' => $s, 'e' => max($s, (int) round((float) $end * 1000))];
        }

        return $out;
    }
}
