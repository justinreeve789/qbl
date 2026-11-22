<?php

namespace App\Qbl\Speech;

/**
 * The voices characters can be given (resources/speech/voices.json).
 *
 * A character's `tts_voice` is a key of this catalog ("heart", "captain", "robot"), never a
 * service's own voice id, so scenarios keep their voices when the service changes. Each voice says
 * what it is on every service under `engines.<service name>`; one with nothing for the service in
 * use borrows the nearest voice that has something.
 *
 * `flair` says how much of a character a voice is: 0 an everyday voice, 1 one with character (a
 * jolly grandpa, a trickster), 2 a theatrical one, larger than life (a giant, a pixie, a pantomime
 * villain). VoicePicker reaches for flair first; `qbl:tts` picks from it.
 */
final class VoiceCatalog
{
    /** @var array<string, array> by key */
    private array $voices = [];

    private array $standIns;

    private array $samples;

    private array $clipLines;

    /** @var array<string, string> the default narrator's voice key, by language ("en" => "storyteller") */
    private array $narrators;

    /** $narrator: a voice to narrate in instead of the catalog's default, for scenarios in its language (QL_TTS_NARRATOR). */
    public function __construct(array $data, private ?string $narrator = null)
    {
        foreach ((array) ($data['voices'] ?? []) as $v) {
            if (is_array($v) && isset($v['key'])) {
                $this->voices[(string) $v['key']] = $v + ['name' => $v['key'], 'gender' => 'neutral', 'age' => 'adult', 'lang' => 'en', 'traits' => [], 'description' => '', 'flair' => 0, 'engines' => []];
            }
        }
        $this->standIns = (array) ($data['stand_ins'] ?? []) + ['en' => 'explorer'];
        $this->samples = (array) ($data['samples'] ?? []) + ['en' => 'Hello, explorer! Shall we get started?'];
        $this->narrators = array_map('strval', (array) ($data['narrators'] ?? []));
        $this->clipLines = (array) ($data['clip_lines'] ?? []);
    }

    public static function load(string $path, ?string $narrator = null): self
    {
        $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
        if (! is_array($data)) {
            throw new SpeechError("The voice catalog $path is missing or is not JSON.");
        }

        return new self($data, $narrator !== '' ? $narrator : null);
    }

    /** @return array<string, array> by key, in the catalog's order */
    public function all(): array
    {
        return $this->voices;
    }

    public function get(string $key): ?array
    {
        return $this->voices[$key] ?? null;
    }

    /**
     * The voices for a language ("en", "en-GB", "es"): those of the same language, the closest
     * variety first. All of them when none matches.
     *
     * @return array<string, array>
     */
    public function forLanguage(?string $lang): array
    {
        $primary = self::primary($lang);
        $same = array_filter($this->voices, fn ($v) => self::primary($v['lang']) === $primary);
        if (! $same) {
            return $this->voices;
        }
        // en-GB first for a British scenario; otherwise the catalog's order.
        $exact = array_filter($same, fn ($v) => strcasecmp((string) $v['lang'], (string) $lang) === 0);

        return $exact + $same;
    }

    /**
     * The voices that fit what is asked, in the catalog's order. Every filter is optional:
     * `lang` matches a whole language ("en" is American and British, "en-GB" only British),
     * `gender` and `age` match exactly, `traits` keeps voices with at least one of them, `flair`
     * keeps voices with at least that much of it, `max_flair` those with no more, and `engine` keeps
     * only voices with an entry of their own for that service (none borrowed).
     *
     * @param  array{lang?: ?string, gender?: ?string, age?: ?string, traits?: list<string>, flair?: ?int, max_flair?: ?int, engine?: ?string}  $want
     * @return array<string, array>
     */
    public function matching(array $want): array
    {
        $lang = isset($want['lang']) && $want['lang'] !== '' ? strtolower(str_replace('_', '-', (string) $want['lang'])) : null;
        $traits = array_map('strtolower', array_values(array_filter((array) ($want['traits'] ?? []), fn ($t) => $t !== '')));

        return array_filter($this->voices, function (array $v) use ($want, $lang, $traits) {
            if ($lang !== null && (str_contains($lang, '-') ? strtolower((string) $v['lang']) !== $lang : self::primary($v['lang']) !== $lang)) {
                return false;
            }
            foreach (['gender', 'age'] as $field) {
                if (isset($want[$field]) && $want[$field] !== '' && strtolower((string) $want[$field]) !== $v[$field]) {
                    return false;
                }
            }
            if ((isset($want['flair']) && (int) $v['flair'] < (int) $want['flair']) || (isset($want['max_flair']) && (int) $v['flair'] > (int) $want['max_flair'])) {
                return false;
            }
            if ($traits && ! array_intersect($traits, array_map('strtolower', (array) $v['traits']))) {
                return false;
            }

            return empty($want['engine']) || (isset($v['engines'][$want['engine']]) && is_array($v['engines'][$want['engine']]));
        });
    }

    /**
     * What a voice is on a service: its own entry for it, or else that of the nearest voice that has
     * one (same language, then gender, then age). Null when no voice has one.
     *
     * @return ?array{key: string, spec: array<string, mixed>, borrowed: bool}
     */
    public function specFor(string $key, string $engine): ?array
    {
        $voice = $this->voices[$key] ?? null;
        if ($voice && isset($voice['engines'][$engine]) && is_array($voice['engines'][$engine])) {
            return ['key' => $key, 'spec' => $voice['engines'][$engine], 'borrowed' => false];
        }
        $best = null;
        $bestScore = -1;
        foreach ($this->voices as $k => $v) {
            if (! isset($v['engines'][$engine]) || ! is_array($v['engines'][$engine])) {
                continue;
            }
            $score = 0;
            if ($voice) {
                $score += self::primary($v['lang']) === self::primary($voice['lang']) ? 8 : 0;
                $score += $v['gender'] === $voice['gender'] ? 4 : 0;
                $score += $v['age'] === $voice['age'] ? 2 : 0;
                $score += strcasecmp((string) $v['lang'], (string) $voice['lang']) === 0 ? 1 : 0;
            }
            if ($score > $bestScore) {
                [$best, $bestScore] = [$k, $score];
            }
        }

        return $best === null ? null : ['key' => $best, 'spec' => $this->voices[$best]['engines'][$engine], 'borrowed' => true];
    }

    /**
     * The narrator's voice for a scenario that does not choose one: the configured narrator when it
     * speaks the scenario's language, otherwise the catalog's for that language. Null when there is
     * none, and the browser reads the narration.
     */
    public function narrator(?string $lang): ?string
    {
        $primary = self::primary($lang);
        if ($this->narrator !== null && isset($this->voices[$this->narrator]) && self::primary($this->voices[$this->narrator]['lang']) === $primary) {
            return $this->narrator;
        }
        $key = $this->narrators[$primary] ?? null;

        return $key !== null && isset($this->voices[$key]) ? $key : null;
    }

    /**
     * Who narrates a scenario, from its settings: its `narrator_voice`, or the default narrator for
     * its language when it has none. `"none"`: nobody, so the browser reads the narration.
     */
    public function narratorFor(array $settings, ?string $lang): ?string
    {
        return self::chosenNarrator($settings, fn () => $this->narrator($lang));
    }

    /** @param  callable(): ?string  $default */
    public static function chosenNarrator(array $settings, callable $default): ?string
    {
        $chosen = $settings['narrator_voice'] ?? null;
        if ($chosen === 'none') {
            return null;
        }

        return is_string($chosen) && $chosen !== '' ? $chosen : $default();
    }

    /** The word a recording says where the player's name is shown ("explorer"), in a language. */
    public function standIn(?string $lang): string
    {
        return (string) ($this->standIns[self::primary($lang)] ?? $this->standIns['en']);
    }

    /** A line to hear a voice by, in a language. */
    public function sample(?string $lang): string
    {
        return (string) ($this->samples[self::primary($lang)] ?? $this->samples['en']);
    }

    /**
     * A longer passage to make a voice's reference clip from (Chatterbox clones a voice from about
     * fifteen seconds of it), in a language: the catalog's clip_lines, else its sample line.
     */
    public function clipLine(?string $lang): string
    {
        return (string) ($this->clipLines[self::primary($lang)] ?? $this->clipLines['en'] ?? $this->sample($lang));
    }

    /** For the editor: what a person picking a voice needs, without the services' details. */
    public function describe(array $voice): array
    {
        return [
            'key' => $voice['key'], 'name' => $voice['name'], 'gender' => $voice['gender'], 'age' => $voice['age'], 'lang' => $voice['lang'],
            'accent' => $voice['accent'] ?? null, 'traits' => array_values((array) $voice['traits']), 'description' => $voice['description'],
            'flair' => (int) ($voice['flair'] ?? 0), 'label' => self::label($voice),
        ];
    }

    /** "Heart: woman, American: a warm, friendly woman who explains things clearly." */
    public static function label(array $voice): string
    {
        $who = match ([$voice['gender'] ?? 'neutral', $voice['age'] ?? 'adult']) {
            ['female', 'child'] => 'girl', ['male', 'child'] => 'boy', ['neutral', 'child'] => 'small creature',
            ['female', 'young'] => 'young woman', ['male', 'young'] => 'young man',
            ['female', 'elder'] => 'older woman', ['male', 'elder'] => 'older man',
            ['female', 'adult'] => 'woman', ['male', 'adult'] => 'man',
            default => 'machine or creature',
        };

        return trim($voice['name'].': '.$who.(! empty($voice['accent']) ? ', '.$voice['accent'] : ''));
    }

    public static function primary(?string $lang): string
    {
        return strtolower(explode('-', str_replace('_', '-', (string) ($lang ?: 'en')))[0]);
    }
}
