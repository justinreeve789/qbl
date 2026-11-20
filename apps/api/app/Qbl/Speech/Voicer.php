<?php

namespace App\Qbl\Speech;

/**
 * Records what characters say, in their catalog voices, with whichever service is set up.
 *
 * A line is recorded as it is written, except that the player's name ({{QBLPlayerName}}) is said
 * as a stand-in word ("explorer"): the game shows the name and lights it while the stand-in is said.
 * A line with any other {{placeholder}} cannot be recorded (its words are only known in play) and
 * is left to the browser's voice.
 *
 * Recordings are kept in a cache by service, voice and text, so recording a scenario again, or a copy
 * of it, only asks the service for lines that changed.
 */
final class Voicer
{
    public function __construct(
        private SpeechEngine $engine,
        private VoiceCatalog $catalog,
        private ?string $cacheDir = null,
    ) {}

    public function engine(): SpeechEngine
    {
        return $this->engine;
    }

    public function catalog(): VoiceCatalog
    {
        return $this->catalog;
    }

    /** What is said for a line of dialogue, or null when it cannot be recorded ahead of play. */
    public function script(string $text, ?string $lang = 'en'): ?string
    {
        $text = html_entity_decode(strip_tags(preg_replace('/<br\s*\/?>/i', ' ', $text) ?? $text), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace('/\{\{\s*QBLPlayerName\s*\}\}/', $this->catalog->standIn($lang), $text) ?? $text;
        if (str_contains($text, '{{')) {
            return null;
        }
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? $text);

        return preg_match('/[\p{L}\p{N}]/u', $text) ? $text : null;
    }

    /**
     * Record one line in a catalog voice.
     *
     * @return ?array{speech: Speech, script: string, params: array{speech: array}} null when the line
     *                                                                              cannot be recorded (see script()) or no voice works with the service
     *
     * @throws SpeechError
     */
    public function record(string $text, string $voiceKey, ?string $lang = 'en'): ?array
    {
        $script = $this->script($text, $lang);
        $voice = $this->catalog->specFor($voiceKey, $this->engine->name());
        if ($script === null || $voice === null) {
            return null;
        }
        $speech = $this->say($script, $voice['spec'], $lang);

        return ['speech' => $speech, 'script' => $script, 'params' => ['speech' => self::params($speech, $script, $voiceKey, $this->engine->name(), $text)]];
    }

    /** A voice saying a sample line (or $text), to hear what it sounds like. */
    public function sample(string $voiceKey, ?string $lang = 'en', ?string $text = null): Speech
    {
        $voice = $this->catalog->specFor($voiceKey, $this->engine->name()) ?? throw new SpeechError("No voice works with {$this->engine->name()}.");
        $lang = $text === null ? ($this->catalog->get($voiceKey)['lang'] ?? $lang) : $lang;

        return $this->say($this->script($text ?? $this->catalog->sample($lang), $lang) ?? 'Hello!', $voice['spec'], $lang);
    }

    /** The `speech` kept on a recording's media: what it says (and the line it was recorded from), who says it, and when each word is said. */
    public static function params(Speech $speech, string $script, string $voiceKey, string $engine, ?string $line = null): array
    {
        return array_filter([
            'text' => $script, 'line' => $line, 'voice' => $voiceKey, 'engine' => $engine, 'words' => $speech->words, 'duration' => $speech->duration,
        ], fn ($v) => $v !== null);
    }

    /**
     * The lines characters say, from a scenario's rows (decoded, as ScenarioStore::bundle() and
     * MissionBuilder give them): every `dialogue` action said by a character, and every character's
     * line of a `conversation` (`line` is then its place in the action's `lines`). `voice` is the
     * character's, or null when it has none.
     *
     * @return list<array{index: int, action_id: int, line: ?int, character_id: int, voice: ?string, text: string, media_id: ?int, narrate: ?bool}>
     */
    public static function lines(array $rows): array
    {
        $voices = [];
        foreach ($rows['characters'] ?? [] as $c) {
            $settings = is_array($c['settings'] ?? null) ? $c['settings'] : (json_decode((string) ($c['settings'] ?? ''), true) ?: []);
            $voices[(int) $c['id']] = isset($settings['tts_voice']) && $settings['tts_voice'] !== '' ? (string) $settings['tts_voice'] : null;
        }
        $said = fn (array $p) => ($p['speaker'] ?? '') === 'character' && isset($p['character_id']) && array_key_exists((int) $p['character_id'], $voices);
        $entry = fn (int $i, array $a, ?int $k, array $p, array $action) => [
            'index' => $i, 'action_id' => (int) $a['id'], 'line' => $k, 'character_id' => (int) $p['character_id'], 'voice' => $voices[(int) $p['character_id']],
            'text' => (string) ($p['text'] ?? ''), 'media_id' => isset($p['narration_media_id']) ? (int) $p['narration_media_id'] : null,
            'narrate' => isset($action['narrate']) ? (bool) $action['narrate'] : null,
        ];
        $out = [];
        foreach ($rows['actions'] ?? [] as $i => $a) {
            $p = is_array($a['params'] ?? null) ? $a['params'] : (json_decode((string) ($a['params'] ?? ''), true) ?: []);
            if (($a['type'] ?? '') === 'dialogue' && $said($p)) {
                $out[] = $entry($i, $a, null, $p, $p);
            } elseif (($a['type'] ?? '') === 'conversation') {
                foreach (array_values((array) ($p['lines'] ?? [])) as $k => $line) {
                    if (is_array($line) && $said($line)) {
                        $out[] = $entry($i, $a, $k, $line, $p);
                    }
                }
            }
        }

        return $out;
    }

    /**
     * An action's params with a line set to play a recording (and the action to be read aloud), or,
     * with $mediaId null, to play none. $line: the line of a conversation, or null for a dialogue.
     */
    public static function withRecording(array $params, ?int $line, ?int $mediaId): array
    {
        if ($line === null) {
            $target = &$params;
        } else {
            $params['lines'] = array_values((array) ($params['lines'] ?? []));
            $target = &$params['lines'][$line];
        }
        if ($mediaId === null) {
            unset($target['narration_media_id']);
        } else {
            $target['narration_media_id'] = $mediaId;
            $params['narrate'] = true;
        }
        unset($target);

        return $params;
    }

    /**
     * Record the lines of a scenario that is being built (MissionBuilder::build()'s rows and files):
     * each recording becomes an audio media row and a file under $dir, and its line is set to play it.
     * The same line in the same voice is recorded once. Stops at the first failure of the service,
     * leaving the rest to the browser's voice, and says so in the warnings.
     *
     * @return array{built: array, recorded: int, skipped: int, warnings: list<string>}
     */
    public function voiceBuilt(array $built, string $dir, ?string $lang = 'en', ?callable $log = null): array
    {
        $rows = &$built['rows'];
        $lines = array_values(array_filter(self::lines($rows), fn ($l) => $l['voice'] !== null && $l['narrate'] !== false && $l['media_id'] === null));
        $nextId = max([0, ...array_map(fn ($m) => (int) $m['id'], $rows['media'] ?? [])]) + 1;
        $names = array_column($rows['characters'] ?? [], 'name', 'id');
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new SpeechError("Cannot create $dir.");
        }
        $made = [];
        $recorded = $skipped = 0;
        $warnings = [];
        foreach ($lines as $n => $line) {
            $script = $this->script($line['text'], $lang);
            $same = $script === null ? null : $line['voice'].'|'.$script;
            if ($same !== null && isset($made[$same])) {
                $mediaId = $made[$same];
            } else {
                try {
                    $r = $this->record($line['text'], $line['voice'], $lang);
                } catch (SpeechError $e) {
                    $warnings[] = 'Voices: '.$e->getMessage().' The lines not yet recorded are read by the browser\'s voice; record them later with php artisan qbl:voice or the editor.';
                    break;
                }
                if ($r === null) {
                    $skipped++;

                    continue;
                }
                $file = sprintf('voice-%s-%d.mp3', self::slug((string) ($names[$line['character_id']] ?? 'character')), $line['action_id']);
                file_put_contents("$dir/$file", $r['speech']->audio);
                $mediaId = $nextId++;
                $rows['media'][] = [
                    'id' => $mediaId, 'type' => 'audio', 'filename' => $file, 'url' => "assets/$file", 'scale_x' => 1, 'scale_y' => 1,
                    'width' => null, 'height' => null, 'priority' => 60, 'params' => $r['params'],
                ];
                $built['files'][$file] = "$dir/$file";
                $made[$same] = $mediaId;
                $recorded++;
                if ($log) {
                    $log(sprintf('  voiced %d of %d: %s', $n + 1, count($lines), mb_strimwidth($r['script'], 0, 70, '…')));
                }
            }
            $rows['actions'][$line['index']]['params'] = self::withRecording((array) $rows['actions'][$line['index']]['params'], $line['line'], $mediaId);
        }
        unset($rows);

        return ['built' => $built, 'recorded' => $recorded, 'skipped' => $skipped, 'warnings' => $warnings];
    }

    private function say(string $script, array $spec, ?string $lang): Speech
    {
        $key = sha1(json_encode([$this->engine->name(), $spec, VoiceCatalog::primary($lang), $script], JSON_UNESCAPED_UNICODE));
        $base = $this->cacheDir !== null ? rtrim($this->cacheDir, '/').'/'.substr($key, 0, 2).'/'.$key : null;
        if ($base !== null && is_file("$base.json") && is_file("$base.audio")) {
            $meta = json_decode((string) file_get_contents("$base.json"), true);
            if (is_array($meta)) {
                return new Speech((string) file_get_contents("$base.audio"), (string) ($meta['format'] ?? 'mp3'), (array) ($meta['words'] ?? []), $meta['duration'] ?? null);
            }
        }
        $speech = $this->engine->synthesize($script, $spec, $lang);
        if ($base !== null && (is_dir(dirname($base)) || @mkdir(dirname($base), 0775, true))) {
            file_put_contents("$base.audio", $speech->audio);
            file_put_contents("$base.json", json_encode(['format' => $speech->format, 'words' => $speech->words, 'duration' => $speech->duration, 'text' => $script], JSON_UNESCAPED_UNICODE));
        }

        return $speech;
    }

    private static function slug(string $name): string
    {
        $slug = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $name) ?: $name) ?? '', '-'));

        return $slug !== '' ? substr($slug, 0, 30) : 'character';
    }
}
