<?php

namespace App\Qbl;

use ZipArchive;

/**
 * A scenario as one ZIP file, for backups and for moving a scenario between installations:
 *
 *   scenario.json     the scenario document, as the documentation describes it
 *   assets/...        the files uploaded for it, under the names the document's media use
 *   README.txt
 *
 * Importing one creates a new scenario (a draft with a new code); it never replaces an
 * existing one. The ZIP is read entry by entry and never unpacked to a path taken from it.
 */
class ScenarioArchive
{
    public const MAX_FILES = 5000;

    public const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;

    public const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

    /** Where the scenarios shipped with the application are kept, one ZIP each. `qbl:seed` adds them. */
    public const SHIPPED = __DIR__.'/../../database/seeders/scenarios';

    /** The shipped scenario ZIPs, by file name. */
    public static function shipped(): array
    {
        $paths = glob(self::SHIPPED.'/*.zip') ?: [];
        sort($paths);

        return $paths;
    }

    /**
     * A published document as the game server's file backend serves it (scenarios/*.json): that
     * backend has no /media, so each uploaded file is expected beside the scenario's other assets,
     * under `$folder` of its asset_base_url. Returns [document, [file name => filepath]].
     */
    public static function forFileBackend(array $document, string $folder = 'uploads'): array
    {
        $files = [];
        foreach ($document['assets'] ?? [] as $index => $media) {
            if (is_string($media['filepath'] ?? null) && $media['filepath'] !== '') {
                $name = basename($media['filepath']);
                $files[$name] = $media['filepath'];
                unset($document['assets'][$index]['filepath']);
                $document['assets'][$index]['url'] = "$folder/$name";
            }
        }

        return [$document, $files];
    }

    public function __construct(private ScenarioStore $store) {}

    /** Write the scenario, as it is in the editor now, to a new temporary ZIP file. Returns [path, download name]. */
    public function export(int $scenarioId): array
    {
        self::needZip();
        $bundle = $this->store->bundle($scenarioId);
        $document = $this->store->compile($scenarioId);
        $path = tempnam(sys_get_temp_dir(), 'qbl-export-');
        $zip = new ZipArchive;
        if ($zip->open($path, ZipArchive::OVERWRITE) !== true) {
            throw new StoreError(500, 'Could not write the ZIP file.');
        }
        $missing = [];
        foreach ($bundle['media'] as $media) {
            if (empty($media['filepath'])) {
                continue; // not an uploaded file: its address is all there is to keep
            }
            $file = $this->store->mediaFile($media);
            if ($file === null) {
                $missing[] = $media['filename'] ?? $media['filepath'];

                continue;
            }
            $zip->addFile($file, 'assets/'.basename($media['filepath']));
            // Pictures, sound and video are compressed already.
            $zip->setCompressionName('assets/'.basename($media['filepath']), ZipArchive::CM_STORE);
        }
        $zip->addFromString('scenario.json', json_encode($document, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        $zip->addFromString('README.txt', implode("\n", [
            'A Quest Lab scenario: '.$document['title'],
            'Exported '.gmdate('Y-m-d H:i').' UTC.',
            '',
            'scenario.json is the scenario. assets/ holds the files uploaded for it; a media entry',
            'whose "filepath" ends in one of those names uses that file.',
            'Media that was not uploaded (it has an address but no file here) is loaded from that address.',
            'To bring it back: in the editor, Scenarios > Import a ZIP. That makes a new scenario.',
            $missing ? "\nFiles that could not be found and are not in this ZIP: ".implode(', ', $missing) : '',
        ]));
        $zip->close();
        $name = preg_replace('/[^A-Za-z0-9]+/', '-', (string) $document['title']);

        return [$path, trim((string) $name, '-').'-'.gmdate('Ymd').'.zip'];
    }

    /** Create a scenario from a ZIP made by export(), or put together by hand in the same shape. Returns its id. */
    public function import(string $zipPath, ?int $userId, ?string $title = null): int
    {
        $overrides = trim((string) $title) !== '' ? ['title' => trim((string) $title)] : [];

        return self::read($zipPath, fn (array $rows, callable $fileFor) => $this->store->importRows($rows, $userId, $overrides, $fileFor));
    }

    /**
     * Seed a scenario shipped with the application as a ZIP (database/seeders/scenarios). Unlike
     * import(), it keeps the code and the ids it was exported with, so it is the same scenario
     * on every installation and seeding it again finds it. Returns its id, or null when it was
     * already there and `$reset` is false. It is not published here.
     */
    public function seed(string $zipPath, bool $reset = false): ?int
    {
        return self::read($zipPath, fn (array $rows, callable $fileFor, array $document) => $this->store->seedScenario(self::asShipped($rows, $document), $reset, $fileFor));
    }

    /**
     * A shipped scenario's rows. Unlike an import, a shipped scenario keeps its own avatar lists:
     * they are the avatars where the platform has none (the file backend, or before the avatars
     * are seeded). They go back in the document's order, so that publishing the seeded scenario
     * gives the document it was shipped as.
     */
    public static function asShipped(array $rows, array $document): array
    {
        $settings = $rows['scenario']['settings'] + array_intersect_key($document, array_flip(['avatar_media_ids', 'avatar_portraits']));
        $order = array_flip(array_keys($document));
        uksort($settings, fn ($a, $b) => ($order[$a] ?? PHP_INT_MAX) <=> ($order[$b] ?? PHP_INT_MAX));
        $rows['scenario']['settings'] = $settings;

        return $rows;
    }

    /**
     * Open a scenario ZIP and hand its rows (as ScenarioDecompiler makes them from scenario.json)
     * to `$use`, with a function that returns the path of a media row's file from the ZIP, or null.
     * The files it returns are temporary and are removed once `$use` returns.
     *
     * @param  callable(array $rows, callable(array): ?string $fileFor, array $document): mixed  $use
     */
    public static function read(string $zipPath, callable $use): mixed
    {
        self::needZip();
        $zip = new ZipArchive;
        if (! is_file($zipPath) || $zip->open($zipPath, ZipArchive::RDONLY) !== true) {
            throw new StoreError(422, 'That file is not a ZIP.');
        }
        $extracted = [];
        try {
            if ($zip->numFiles > self::MAX_FILES) {
                throw new StoreError(422, 'That ZIP holds too many files.');
            }
            // What is in the ZIP, by name. The scenario may sit in a single folder, as it does when a folder was zipped.
            $entries = [];
            $total = 0;
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $stat = $zip->statIndex($i);
                $name = str_replace('\\', '/', (string) $stat['name']);
                if (str_ends_with($name, '/') || str_starts_with(basename($name), '.') || str_starts_with($name, '__MACOSX/')) {
                    continue;
                }
                $total += (int) $stat['size'];
                $entries[$name] = ['index' => $i, 'size' => (int) $stat['size']];
            }
            if ($total > self::MAX_TOTAL_BYTES) {
                throw new StoreError(422, 'That ZIP is too large once unpacked.');
            }
            $documents = array_values(array_filter(array_keys($entries), fn ($name) => basename($name) === 'scenario.json'));
            usort($documents, fn ($a, $b) => substr_count($a, '/') <=> substr_count($b, '/'));
            if (! $documents) {
                throw new StoreError(422, 'There is no scenario.json in that ZIP.');
            }
            $root = substr($documents[0], 0, -strlen('scenario.json'));
            if ($entries[$documents[0]]['size'] > self::MAX_DOCUMENT_BYTES) {
                throw new StoreError(422, 'scenario.json is too large.');
            }
            $document = json_decode((string) $zip->getFromIndex($entries[$documents[0]]['index']), true);
            if (! is_array($document)) {
                throw new StoreError(422, 'scenario.json is not valid JSON.');
            }
            // An API answer saved as it came ({"scenario": {...}}) is accepted too.
            if (! isset($document['scenes']) && is_array($document['scenario'] ?? null)) {
                $document = $document['scenario'];
            }
            $rows = ScenarioDecompiler::rows($document);

            // A media row's file is looked for by the name its filepath ends in, then by its address, then by its filename.
            $find = function (array $media) use ($entries, $root): ?string {
                $candidates = [];
                foreach (['filepath', 'url', 'filename'] as $key) {
                    $value = $media[$key] ?? null;
                    if (is_string($value) && $value !== '' && ! preg_match('#^([a-z][a-z0-9+.-]*:)?//#i', $value)) {
                        $value = ltrim($value, '/');
                        array_push($candidates, $root.'assets/'.basename($value), $root.$value, $root.'assets/'.$value);
                    }
                }
                foreach ($candidates as $name) {
                    if (isset($entries[$name]) && ! str_contains($name, '..')) {
                        return $name;
                    }
                }

                return null;
            };
            $fileFor = function (array $media) use ($zip, $entries, $find, &$extracted): ?string {
                $name = $find($media);
                if ($name === null) {
                    return null;
                }
                if ($entries[$name]['size'] > ScenarioStore::MAX_UPLOAD_BYTES) {
                    throw new StoreError(422, basename($name).' is larger than 25 MB.');
                }
                if (! isset($extracted[$name])) {
                    $temp = tempnam(sys_get_temp_dir(), 'qbl-import-');
                    $in = $zip->getStream($zip->getNameIndex($entries[$name]['index']));
                    $out = fopen($temp, 'wb');
                    if (! $in || ! $out || stream_copy_to_stream($in, $out, ScenarioStore::MAX_UPLOAD_BYTES + 1) === false) {
                        throw new StoreError(422, 'Could not read '.basename($name).' from the ZIP.');
                    }
                    fclose($in);
                    fclose($out);
                    $extracted[$name] = $temp;
                }

                return $extracted[$name];
            };

            return $use($rows, $fileFor, $document);
        } finally {
            $zip->close();
            foreach ($extracted as $temp) {
                @unlink($temp);
            }
        }
    }

    private static function needZip(): void
    {
        if (! class_exists(ZipArchive::class)) {
            throw new StoreError(503, 'ZIP files are not available on this server: PHP needs its zip extension.');
        }
    }
}
