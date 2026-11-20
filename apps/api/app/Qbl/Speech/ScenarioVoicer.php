<?php

namespace App\Qbl\Speech;

use App\Qbl\ScenarioStore;

/**
 * Records the dialogue of a scenario in the editor's database: what `php artisan qbl:voice` and the
 * editor's "Record voices" button do.
 *
 * Each line a character with a voice (`tts_voice`) says gets a recording (an audio media row with its
 * word timings), and the line is set to play it. Lines that already have an up-to-date recording are
 * kept; a line whose text or voice changed is recorded again and the old recording removed; a line
 * whose character no longer has a voice loses its recording. Recordings someone uploaded themselves
 * (media without `speech.engine`) are never touched.
 */
final class ScenarioVoicer
{
    public function __construct(private ScenarioStore $store, private Voicer $voicer) {}

    /**
     * @param  array{force?: bool, limit?: ?int, seconds?: ?float, dry?: bool, character_id?: ?int}  $options
     *                                                                                                         force: record every line again; limit: at most this many recordings in this call
     *                                                                                                         (call again for the rest); seconds: start no new recording after this long;
     *                                                                                                         dry: only count; character_id: only this character's lines
     * @return array{lines: int, recorded: int, kept: int, removed: int, remaining: int, skipped: list<array{action_id: int, why: string}>}
     */
    public function record(int $scenarioId, array $options = [], ?callable $log = null): array
    {
        $rows = $this->store->bundle($scenarioId);
        $lang = $rows['scenario']['default_language'] ?? 'en';
        $engine = $this->voicer->engine()->name();
        $media = [];
        foreach ($rows['media'] as $m) {
            $media[(int) $m['id']] = $m;
        }
        $users = [];
        foreach ($rows['actions'] as $a) {
            if (isset($a['params']['narration_media_id'])) {
                $users[(int) $a['params']['narration_media_id']][] = (int) $a['id'];
            }
        }
        $actions = array_column($rows['actions'], null, 'id');
        $limit = isset($options['limit']) ? max(0, (int) $options['limit']) : null;
        $dry = (bool) ($options['dry'] ?? false);
        $deadline = isset($options['seconds']) ? microtime(true) + (float) $options['seconds'] : null;
        $out = ['lines' => 0, 'recorded' => 0, 'kept' => 0, 'removed' => 0, 'remaining' => 0, 'skipped' => []];

        foreach (Voicer::lines($rows) as $line) {
            if (isset($options['character_id']) && $line['character_id'] !== (int) $options['character_id']) {
                continue;
            }
            $current = $line['media_id'] !== null ? ($media[$line['media_id']] ?? null) : null;
            $ours = $current !== null && is_array($current['params']['speech'] ?? null) && isset($current['params']['speech']['engine']);
            if ($current !== null && ! $ours) {
                $out['skipped'][] = ['action_id' => $line['action_id'], 'why' => 'It plays a recording someone uploaded.'];

                continue;
            }
            $script = $line['voice'] !== null && $line['narrate'] !== false ? $this->voicer->script($line['text'], $lang) : null;
            if ($script === null) {
                if ($line['voice'] !== null && $line['narrate'] !== false) {
                    $out['skipped'][] = ['action_id' => $line['action_id'], 'why' => 'It has a {{placeholder}} whose words are only known in play: the browser reads it.'];
                }
                if ($ours && ! $dry) {
                    $this->unlink($scenarioId, $actions[$line['action_id']], $current, $users);
                    $out['removed']++;
                }

                continue;
            }
            $out['lines']++;
            $speech = $ours ? $current['params']['speech'] : null;
            if ($speech && empty($options['force']) && ($speech['text'] ?? null) === $script && ($speech['line'] ?? $line['text']) === $line['text'] && ($speech['voice'] ?? null) === $line['voice'] && ($speech['engine'] ?? null) === $engine) {
                $out['kept']++;

                continue;
            }
            if ($dry || ($limit !== null && $out['recorded'] >= $limit) || ($deadline !== null && microtime(true) > $deadline)) {
                $out['remaining']++;

                continue;
            }
            $made = $this->voicer->record($line['text'], $line['voice'], $lang);
            if ($made === null) {
                $out['skipped'][] = ['action_id' => $line['action_id'], 'why' => "No voice works with $engine."];

                continue;
            }
            $tmp = tempnam(sys_get_temp_dir(), 'qbl-voice');
            try {
                file_put_contents($tmp, $made['speech']->audio);
                $name = $rows['characters'][array_search($line['character_id'], array_column($rows['characters'], 'id'), true)]['name'] ?? 'character';
                $row = $this->store->addMediaFile($scenarioId, $tmp, sprintf('%s line %d.%s', $name, $line['action_id'], $made['speech']->format));
            } finally {
                @unlink($tmp);
            }
            $row = $this->store->updateRow($scenarioId, 'media', (int) $row['id'], ['params' => $made['params'] + (array) ($row['params'] ?? [])]);
            $media[(int) $row['id']] = $row;
            $action = $actions[$line['action_id']];
            $params = ['narration_media_id' => (int) $row['id'], 'narrate' => true] + (array) $action['params'];
            $params['narration_media_id'] = (int) $row['id'];
            $actions[$line['action_id']] = $this->store->updateRow($scenarioId, 'actions', $line['action_id'], ['params' => $params]);
            $users[(int) $row['id']] = [$line['action_id']];
            if ($ours) {
                $this->forget($scenarioId, $current, $line['action_id'], $users);
            }
            $out['recorded']++;
            if ($log) {
                $log(sprintf('  %s: %s', $name, mb_strimwidth($made['script'], 0, 70, '…')));
            }
        }

        return $out;
    }

    /**
     * Give a voice to each character that has none, a different one for each while they last.
     * Returns the voices given, by character id.
     *
     * @return array<int, string>
     */
    public function assign(int $scenarioId, bool $all = false): array
    {
        $rows = $this->store->bundle($scenarioId);
        $taken = [];
        $wanted = [];
        foreach ($rows['characters'] as $c) {
            $voice = $c['settings']['tts_voice'] ?? null;
            if ($voice && ! $all) {
                $taken[] = $voice;
            } else {
                $wanted[(int) $c['id']] = ['describe' => (string) $c['name']];
            }
        }
        $picked = (new VoicePicker($this->voicer->catalog()))->pick($wanted, $rows['scenario']['default_language'] ?? 'en', $taken);
        foreach ($rows['characters'] as $c) {
            if (isset($picked[(int) $c['id']])) {
                $this->store->updateRow($scenarioId, 'characters', (int) $c['id'], ['settings' => ['tts_voice' => $picked[(int) $c['id']]] + (array) ($c['settings'] ?? [])]);
            }
        }

        return $picked;
    }

    /** A line stops playing its recording, and the recording goes when nothing else plays it. */
    private function unlink(int $scenarioId, array $action, array $media, array &$users): void
    {
        $params = (array) $action['params'];
        unset($params['narration_media_id']);
        $this->store->updateRow($scenarioId, 'actions', (int) $action['id'], ['params' => $params]);
        $this->forget($scenarioId, $media, (int) $action['id'], $users);
    }

    private function forget(int $scenarioId, array $media, int $actionId, array &$users): void
    {
        $id = (int) $media['id'];
        $users[$id] = array_values(array_diff($users[$id] ?? [], [$actionId]));
        if (! $users[$id]) {
            $this->store->deleteRow($scenarioId, 'media', $id);
        }
    }
}
