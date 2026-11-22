<?php

namespace App\Qbl\Speech;

/**
 * Chooses catalog voices for characters: one that fits each (who they are, how they talk), and a
 * different one for every character while there are enough to go round.
 *
 * Between voices that fit, it reaches for the ones with character: a voice's `flair` (0 everyday,
 * 1 with character, 2 theatrical) is worth $flair points a step. At the default of 3 a theatrical
 * voice beats an everyday one that matches one more word of the description (5 points a word), but
 * never one of the wrong gender or age, so the cast is larger than life wherever nothing says
 * otherwise, and a guide described as warm, friendly and clear still gets a clear voice. 0 chooses
 * as if every voice were an everyday one (QBL_TTS_FLAIR).
 */
final class VoicePicker
{
    private const AGES = ['child' => 0, 'young' => 1, 'adult' => 2, 'elder' => 3];

    public function __construct(private VoiceCatalog $catalog, private float $flair = 3.0) {}

    /**
     * @param  array<string, array{gender?: ?string, age?: ?string, accent?: ?string, describe?: ?string}>  $characters
     *                                                                                                                   by key: what they are, and a few words on how they talk (personality, role)
     * @param  list<string>  $taken  voices already given to other characters of the scenario
     * @return array<string, string> a voice key for each character
     */
    public function pick(array $characters, ?string $lang = 'en', array $taken = []): array
    {
        $voices = $this->catalog->forLanguage($lang);
        $used = array_fill_keys($taken, 1);
        $out = [];
        // The most particular first (a child, an elder, a robot), so the few voices that fit them are still free.
        uksort($characters, fn ($a, $b) => self::particular($characters[$b]) <=> self::particular($characters[$a]));
        foreach ($characters as $key => $want) {
            $best = null;
            $bestScore = PHP_INT_MIN;
            $i = 0;
            foreach ($voices as $vk => $v) {
                // A voice no one has yet is worth a lot; between equals, earlier in the catalog (which is in order of quality) wins.
                $score = (int) round(100 * (self::fit($want, $v) + $this->flair * (int) ($v['flair'] ?? 0) - 25 * ($used[$vk] ?? 0))) - $i++;
                if ($score > $bestScore) {
                    [$best, $bestScore] = [$vk, $score];
                }
            }
            if ($best !== null) {
                $out[$key] = $best;
                $used[$best] = ($used[$best] ?? 0) + 1;
            }
        }

        return $out;
    }

    /** How well a voice suits what is wanted. */
    public static function fit(array $want, array $voice): int
    {
        $score = 0;
        $gender = $want['gender'] ?? null;
        if ($gender) {
            $score += $voice['gender'] === $gender ? 30 : ($voice['gender'] === 'neutral' || $gender === 'neutral' ? -10 : -60);
        }
        $age = $want['age'] ?? null;
        if ($age && isset(self::AGES[$age], self::AGES[$voice['age']])) {
            $score += [12, 4, -8, -20][abs(self::AGES[$age] - self::AGES[$voice['age']])];
        }
        if (! empty($want['accent']) && ! empty($voice['accent'])) {
            $score += stripos((string) $voice['accent'], (string) $want['accent']) !== false || stripos((string) $voice['lang'], (string) $want['accent']) !== false ? 6 : -3;
        }
        $words = self::words((string) ($want['describe'] ?? ''));
        foreach ((array) $voice['traits'] as $trait) {
            if (isset($words[strtolower((string) $trait)])) {
                $score += 5;
            }
        }

        return $score;
    }

    private static function particular(array $want): int
    {
        return (in_array($want['age'] ?? null, ['child', 'elder'], true) ? 2 : 0) + (($want['gender'] ?? null) === 'neutral' ? 2 : 0) + (! empty($want['accent']) ? 1 : 0);
    }

    /** @return array<string, true> the words of a description, lower case, with simple plurals also as singulars */
    private static function words(string $text): array
    {
        $out = [];
        foreach (preg_split('/[^\p{L}\-]+/u', mb_strtolower($text), -1, PREG_SPLIT_NO_EMPTY) as $w) {
            $out[$w] = true;
            if (strlen($w) > 3 && str_ends_with($w, 's')) {
                $out[substr($w, 0, -1)] = true;
            }
        }

        return $out;
    }
}
