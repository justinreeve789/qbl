<?php

namespace App\Qbl\Builds;

use App\Qbl\Speech\SpeechError;
use App\Qbl\Speech\Voicer;
use PDO;

/**
 * The narrator's recordings of what students' hotspots say (`opens.say`): made when a build is kept,
 * in the scenario's narrator's voice (its `narrator_voice`, or the server's default narrator for its
 * language), with whichever text-to-speech service is set up (App\Qbl\Speech).
 *
 * One recording per hotspot, kept in `build_voices` beside the build (the audio in the row, like an
 * uploaded picture), so deleting the build, resetting the student's game or deleting the student
 * deletes it. A recording whose words, voice or service no longer match is recorded again; a
 * hotspot that no longer says anything loses its recording. With no service (driver "none"), no
 * narrator (`narrator_voice: "none"`), or a service that fails, nothing is recorded and the game
 * reads the words with the browser's voice; the next save tries again.
 *
 * Recording takes a few seconds a line, so each call stops starting new recordings after `$seconds`.
 */
class BuildVoices
{
    /** Seconds a save may spend recording before it leaves the rest for the next one. */
    public const SECONDS = 20.0;

    private ?Voicer $voicer = null;

    private bool $voicerMade = false;

    /**
     * @param  (\Closure(): ?Voicer)|Voicer|null  $voicer  the recorder, or what makes it when first needed (null: none)
     * @param  \Closure(string): string  $fileUrl  where a recording is served, from its key
     */
    public function __construct(private PDO $pdo, private \Closure|Voicer|null $makeVoicer, private \Closure $fileUrl) {}

    /**
     * Record what a build's hotspots say that has no recording yet, and let go of recordings no
     * hotspot uses any more. `$build`: its row (id, scenario_id, user_id, group_key, pieces).
     *
     * @return array{recorded: int, kept: int, removed: int, left: int, error: ?string}
     */
    public function record(array $build, array $document, float $seconds = self::SECONDS): array
    {
        $buildId = (int) $build['id'];
        $pieces = is_array($build['pieces']) ? $build['pieces'] : (json_decode((string) $build['pieces'], true) ?: []);
        $voicer = $this->voicer();
        $engine = $voicer?->engine()->name();
        $lang = (string) ($document['default_language'] ?? 'en');
        $narrator = $voicer?->catalog()->narratorFor($document, $lang);
        $have = [];
        foreach ($this->all('SELECT id, piece_id, speech FROM build_voices WHERE build_id = ?', [$buildId]) as $row) {
            $have[(string) $row['piece_id']] = ['id' => (int) $row['id'], 'speech' => json_decode((string) $row['speech'], true) ?: []];
        }
        $wanted = [];
        foreach ($pieces as $p) {
            $say = is_array($p) ? BuildRules::say($p) : '';
            if ($say !== '' && is_string($p['id'] ?? null)) {
                $wanted[$p['id']] = $say;
            }
        }
        $out = ['recorded' => 0, 'kept' => 0, 'removed' => 0, 'left' => 0, 'error' => null];
        // What is no longer said, or said differently, or in another voice, goes first.
        foreach ($have as $pieceId => $row) {
            $s = $row['speech'];
            $current = isset($wanted[$pieceId]) && $narrator !== null
                && ($s['line'] ?? null) === $wanted[$pieceId] && ($s['voice'] ?? null) === $narrator && ($s['engine'] ?? null) === $engine;
            if ($current) {
                $out['kept']++;
                unset($wanted[$pieceId]);
            } else {
                $this->run('DELETE FROM build_voices WHERE id = ?', [$row['id']]);
                $out['removed']++;
            }
        }
        if (! $voicer || $narrator === null) {
            return $out;
        }
        $until = microtime(true) + $seconds;
        foreach ($wanted as $pieceId => $say) {
            if ($out['error'] !== null || microtime(true) > $until) {
                $out['left']++;

                continue;
            }
            try {
                $r = $voicer->record($say, $narrator, $lang);
            } catch (SpeechError $e) {
                // The service is down or refused: the browser reads the rest, and the next save tries again.
                $out['error'] = $e->getMessage();
                $out['left']++;

                continue;
            }
            if ($r === null) {
                continue;
            }
            $this->insert($build, (string) $pieceId, $r['speech']->audio, $r['speech']->format, $r['params']['speech']);
            $out['recorded']++;
        }

        return $out;
    }

    /**
     * The recordings of these builds, as SceneBuild.voices: build id => piece id => {url, speech}.
     *
     * @param  int[]  $buildIds
     * @return array<int, array<string, array{url: string, speech: array}>>
     */
    public function of(array $buildIds): array
    {
        $ids = array_values(array_unique(array_map('intval', $buildIds)));
        if (! $ids) {
            return [];
        }
        $out = [];
        foreach (array_chunk($ids, 500) as $chunk) {
            $rows = $this->all('SELECT build_id, piece_id, file_key, speech FROM build_voices WHERE build_id IN ('.implode(',', array_fill(0, count($chunk), '?')).') ORDER BY id', $chunk);
            foreach ($rows as $row) {
                $out[(int) $row['build_id']][(string) $row['piece_id']] = ['url' => ($this->fileUrl)((string) $row['file_key']), 'speech' => json_decode((string) $row['speech'], true) ?: []];
            }
        }

        return $out;
    }

    /** Delete a build's recordings (the build is gone). */
    public function forget(int $buildId): void
    {
        $this->run('DELETE FROM build_voices WHERE build_id = ?', [$buildId]);
    }

    /** A recording by its key: [bytes, mime], or null. */
    public function file(string $fileKey): ?array
    {
        $st = $this->pdo->prepare('SELECT bytes, mime FROM build_voices WHERE file_key = ?');
        $st->execute([$fileKey]);
        $row = $st->fetch(PDO::FETCH_ASSOC);

        return $row ? [is_resource($row['bytes']) ? stream_get_contents($row['bytes']) : (string) $row['bytes'], (string) $row['mime']] : null;
    }

    private function voicer(): ?Voicer
    {
        if (! $this->voicerMade) {
            $this->voicerMade = true;
            try {
                $this->voicer = $this->makeVoicer instanceof \Closure ? ($this->makeVoicer)() : $this->makeVoicer;
            } catch (SpeechError) {
                // A service named in the settings that does not exist: no recordings, as with "none".
                $this->voicer = null;
            }
        }

        return $this->voicer;
    }

    private function insert(array $build, string $pieceId, string $audio, string $format, array $speech): void
    {
        $now = gmdate('Y-m-d H:i:s');
        $st = $this->pdo->prepare('INSERT INTO build_voices (build_id, scenario_id, user_id, group_key, piece_id, file_key, mime, speech, bytes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        $st->bindValue(1, (int) $build['id'], PDO::PARAM_INT);
        $st->bindValue(2, (int) $build['scenario_id'], PDO::PARAM_INT);
        $st->bindValue(3, (int) $build['user_id'], PDO::PARAM_INT);
        $st->bindValue(4, (string) $build['group_key']);
        $st->bindValue(5, $pieceId);
        $st->bindValue(6, bin2hex(random_bytes(12)));
        $st->bindValue(7, match (strtolower($format)) { 'wav' => 'audio/wav', 'ogg', 'opus' => 'audio/ogg', default => 'audio/mpeg' });
        $st->bindValue(8, json_encode($speech, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $st->bindValue(9, $audio, PDO::PARAM_LOB);
        $st->bindValue(10, $now);
        $st->bindValue(11, $now);
        $st->execute();
    }

    private function all(string $sql, array $args): array
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($args);

        return $st->fetchAll(PDO::FETCH_ASSOC);
    }

    private function run(string $sql, array $args): void
    {
        $this->pdo->prepare($sql)->execute($args);
    }
}
