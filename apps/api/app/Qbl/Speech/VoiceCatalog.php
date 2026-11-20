<?php

namespace App\Qbl\Speech;

/**
 * The voices characters can be given (resources/speech/voices.json).
 *
 * A character's `tts_voice` is a key of this catalog ("heart", "captain", "robot"), never a
 * service's own voice id, so scenarios keep their voices when the service changes. Each voice says
 * what it is on every service under `engines.<service name>`; one with nothing for the service in
 * use borrows the nearest voice that has something.
 */
final class VoiceCatalog
{
    /** @var array<string, array> by key */
    private array $voices = [];

    private array $standIns;

    private array $samples;

    public function __construct(array $data)
    {
        foreach ((array) ($data['voices'] ?? []) as $v) {
            if (is_array($v) && isset($v['key'])) {
                $this->voices[(string) $v['key']] = $v + ['name' => $v['key'], 'gender' => 'neutral', 'age' => 'adult', 'lang' => 'en', 'traits' => [], 'description' => '', 'engines' => []];
            }
        }
        $this->standIns = (array) ($data['stand_ins'] ?? []) + ['en' => 'explorer'];
        $this->samples = (array) ($data['samples'] ?? []) + ['en' => 'Hello, explorer! Shall we get started?'];
    }

    public static function load(string $path): self
    {
        $data = is_file($path) ? json_decode((string) file_get_contents($path), true) : null;
        if (! is_array($data)) {
            throw new SpeechError("The voice catalog $path is missing or is not JSON.");
        }

        return new self($data);
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

    /** For the editor: what a person picking a voice needs, without the services' details. */
    public function describe(array $voice): array
    {
        return [
            'key' => $voice['key'], 'name' => $voice['name'], 'gender' => $voice['gender'], 'age' => $voice['age'], 'lang' => $voice['lang'],
            'accent' => $voice['accent'] ?? null, 'traits' => array_values((array) $voice['traits']), 'description' => $voice['description'],
            'label' => self::label($voice),
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
