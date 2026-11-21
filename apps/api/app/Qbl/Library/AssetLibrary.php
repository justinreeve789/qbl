<?php

namespace App\Qbl\Library;

use App\Qbl\ScenarioStore;
use App\Qbl\StoreError;
use PDO;
use RuntimeException;

/**
 * The asset library: ready-made things anyone can add to a scenario (characters, vehicles, items,
 * pictures, sounds), kept once for the whole platform.
 *
 * Two tables:
 *
 *   library_assets        one row per asset: what it is (`kind`), its name and category, tags, who
 *                         drew it (`credit`), and its `definition`: what adding it makes in a scenario
 *   library_asset_files   the files an asset is drawn from, one per `role` (sheet, portrait, image,
 *                         sound, preview...), with the media params they carry (sheet grid, animations)
 *
 * Adding an asset to a scenario copies the files its definition uses into the scenario's media
 * (once: a second Red Squirrel shares the first one's sheet) and creates the rows it describes, so
 * the scenario never depends on the library afterwards and exports whole.
 *
 * Definitions, by kind (file names are the `role`s of the asset's files):
 *
 *   character  {scale?, voice?, animations: {stand_right: {file: "sheet", frames: [0, 1], duration, repeat?, flip?}, …, portrait: {file: "portrait"}}}
 *   vehicle    {file: "sheet", item: {wearable?, physical?, blocking?, unique?, settings: {scale, attach_offset_x, attach_offset_y,
 *   item        attach_layer, art_faces, hide_rider_below, speed_multiplier, …}}}  (a vehicle is an item with vehicle: true)
 *   picture    {file: "image"}           only the media row
 *   sound      {file: "sound"}           only the media row
 *
 * Files whose role is `preview` or `thumbnail` are for showing the asset in the library only.
 *
 * Where files live: assets shipped with QuestLab come from the pack in scenarios/assets/library
 * (`pack:` paths, served as /scenario-assets/library/…); files added later (uploads, assets saved
 * from a scenario) go to the media directory under library/ (`media:` paths, served as /media/library/…).
 *
 * Plain PHP over PDO, like ScenarioStore, so the same class serves Laravel (App\Models\LibraryAsset,
 * the library API, qbl:library), the dev server and the tests.
 */
class AssetLibrary
{
    /** What an asset can be, and the media category its files are filed under in a scenario. */
    public const KINDS = [
        'character' => 'character',
        'vehicle' => 'item',
        'item' => 'item',
        'picture' => 'picture',
        'sound' => 'sound',
    ];

    /** Files that only show the asset in the library; they are not copied into scenarios. */
    public const DISPLAY_ROLES = ['preview', 'thumbnail'];

    /** Item columns a vehicle or item definition may set (the rest of `item` goes into settings). */
    private const ITEM_COLUMNS = ['unique', 'physical', 'blocking', 'wearable', 'vehicle'];

    public function __construct(
        private PDO $pdo,
        /** The media directory and the URL it is served under (uploaded library files go in library/ there). */
        private ?string $mediaDir,
        private string $mediaUrl = '/media',
        /** The shipped pack: scenarios/assets/library, and the URL it is served under. */
        private ?string $packDir = null,
        private string $packUrl = '/scenario-assets/library',
    ) {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    // ====================================================================== reading

    /**
     * Assets, in their order. `$filter`: kind (or kinds, a list), category, q (words to find in the
     * name, category, description and tags), tag, inactive (true: include withdrawn ones).
     * `$user` (['id', 'role']) limits the list to what they may see: the platform's and their organization's.
     *
     * @return list<array>
     */
    public function all(array $filter = [], ?array $user = null): array
    {
        $where = [];
        $params = [];
        if (empty($filter['inactive'])) {
            $where[] = '`active` = 1';
        }
        if (! empty($filter['kind'])) {
            $kinds = array_values(array_filter((array) $filter['kind'], fn ($k) => isset(self::KINDS[$k])));
            if (! $kinds) {
                return [];
            }
            $where[] = '`kind` IN ('.implode(', ', array_fill(0, count($kinds), '?')).')';
            array_push($params, ...$kinds);
        }
        if (! empty($filter['category'])) {
            $where[] = '`category` = ?';
            $params[] = (string) $filter['category'];
        }
        [$visible, $visibleParams] = $this->visibility($user);
        if ($visible) {
            $where[] = $visible;
            array_push($params, ...$visibleParams);
        }
        $rows = $this->select('SELECT * FROM `library_assets`'.($where ? ' WHERE '.implode(' AND ', $where) : '').' ORDER BY `sequence`, `id`', $params);

        $words = preg_split('/\s+/', mb_strtolower(trim((string) ($filter['q'] ?? ''))), -1, PREG_SPLIT_NO_EMPTY);
        $tag = mb_strtolower(trim((string) ($filter['tag'] ?? '')));
        $rows = array_values(array_filter($rows, function (array $row) use ($words, $tag) {
            $tags = array_map('mb_strtolower', (array) (json_decode((string) $row['tags'], true) ?: []));
            if ($tag !== '' && ! in_array($tag, $tags, true)) {
                return false;
            }
            $text = mb_strtolower(implode(' ', [$row['name'], $row['slug'], $row['kind'], $row['category'], $row['description'], $row['style'], ...$tags]));
            foreach ($words as $word) {
                if (! str_contains($text, $word)) {
                    return false;
                }
            }

            return true;
        }));

        return $this->present($rows);
    }

    /** The categories in use, in order of first appearance, with how many assets each has. */
    public function categories(array $filter = [], ?array $user = null): array
    {
        $out = [];
        foreach ($this->all(array_diff_key($filter, ['category' => 1, 'q' => 1, 'tag' => 1]), $user) as $asset) {
            $key = $asset['category'] ?? '';
            $out[$key] = ($out[$key] ?? 0) + 1;
        }

        return array_map(fn ($name, $count) => ['name' => $name, 'count' => $count], array_keys($out), $out);
    }

    /** One asset, by id or slug, or null when there is none (or `$user` may not see it). Withdrawn ones too. */
    public function find(int|string $asset, ?array $user = null): ?array
    {
        $column = is_int($asset) || ctype_digit((string) $asset) ? 'id' : 'slug';
        [$visible, $visibleParams] = $this->visibility($user);
        $rows = $this->select("SELECT * FROM `library_assets` WHERE `$column` = ?".($visible ? " AND $visible" : ''), [$column === 'id' ? (int) $asset : (string) $asset, ...$visibleParams]);

        return $rows ? $this->present($rows)[0] : null;
    }

    /** Like find(), but a missing asset is a 404. */
    public function get(int|string $asset, ?array $user = null): array
    {
        return $this->find($asset, $user) ?? throw new StoreError(404, 'There is no such asset in the library.');
    }

    // ====================================================================== writing

    /**
     * Create an asset, or change one (by `id`, or by `slug` when that slug exists). Attributes: slug
     * (made from the name if missing), kind, name, category, description, tags, style, definition,
     * credit {title, author, license, url, note}, organization_id (null: everyone), created_by,
     * source (pack, upload, scenario), active, sequence.
     */
    public function save(array $attrs): array
    {
        $existing = isset($attrs['id']) ? $this->find((int) $attrs['id']) : (isset($attrs['slug']) ? $this->find((string) $attrs['slug']) : null);
        if (isset($attrs['id']) && ! $existing) {
            throw new StoreError(404, 'There is no such asset in the library.');
        }
        $row = [];
        if (array_key_exists('slug', $attrs) || ! $existing) {
            $slug = self::slug((string) ($attrs['slug'] ?? $attrs['name'] ?? ''));
            if ($slug === '') {
                throw new StoreError(422, 'An asset needs a name.');
            }
            $taken = $this->select('SELECT `id` FROM `library_assets` WHERE `slug` = ?', [$slug]);
            if ($taken && (! $existing || (int) $taken[0]['id'] !== $existing['id'])) {
                throw new StoreError(422, "Another asset is already called “{$slug}”.");
            }
            $row['slug'] = $slug;
        }
        if (array_key_exists('kind', $attrs) || ! $existing) {
            $kind = (string) ($attrs['kind'] ?? '');
            if (! isset(self::KINDS[$kind])) {
                throw new StoreError(422, 'The kind must be one of: '.implode(', ', array_keys(self::KINDS)).'.');
            }
            $row['kind'] = $kind;
        }
        if (array_key_exists('name', $attrs) || ! $existing) {
            $name = trim(strip_tags((string) ($attrs['name'] ?? '')));
            if ($name === '') {
                throw new StoreError(422, 'An asset needs a name.');
            }
            $row['name'] = mb_substr($name, 0, 120);
        }
        foreach (['category' => 80, 'style' => 24, 'source' => 24] as $key => $max) {
            if (array_key_exists($key, $attrs)) {
                $value = trim(strip_tags((string) $attrs[$key]));
                $row[$key] = $value === '' ? null : mb_substr($value, 0, $max);
            }
        }
        if (array_key_exists('description', $attrs)) {
            $row['description'] = $attrs['description'] === null ? null : mb_substr(trim(strip_tags((string) $attrs['description'])), 0, 2000);
        }
        if (array_key_exists('tags', $attrs)) {
            $tags = is_array($attrs['tags']) ? $attrs['tags'] : preg_split('/\s*,\s*/', (string) $attrs['tags'], -1, PREG_SPLIT_NO_EMPTY);
            $row['tags'] = json_encode(array_values(array_unique(array_filter(array_map(fn ($t) => mb_substr(mb_strtolower(trim(strip_tags((string) $t))), 0, 40), $tags), 'strlen'))));
        }
        if (array_key_exists('definition', $attrs)) {
            $row['definition'] = self::json(self::cleanDefinition($row['kind'] ?? $existing['kind'], (array) $attrs['definition']));
        }
        if (array_key_exists('credit', $attrs)) {
            $row['credit'] = $attrs['credit'] ? self::json(self::cleanCredit((array) $attrs['credit'])) : null;
        }
        foreach (['organization_id', 'created_by'] as $key) {
            if (array_key_exists($key, $attrs)) {
                $row[$key] = $attrs[$key] === null || $attrs[$key] === '' ? null : (int) $attrs[$key];
            }
        }
        if (array_key_exists('active', $attrs)) {
            $row['active'] = filter_var($attrs['active'], FILTER_VALIDATE_BOOL) ? 1 : 0;
        }
        if (array_key_exists('sequence', $attrs)) {
            $row['sequence'] = (int) $attrs['sequence'];
        }

        $now = self::now();
        if ($existing) {
            if ($row) {
                $this->update('library_assets', $existing['id'], $row + ['updated_at' => $now]);
            }

            return $this->get($existing['id']);
        }
        $row += ['active' => 1, 'sequence' => $this->nextSequence(), 'source' => 'upload', 'tags' => '[]', 'definition' => '{}'];
        $id = $this->insert('library_assets', $row + ['created_at' => $now, 'updated_at' => $now]);

        return $this->get($id);
    }

    /** Remove an asset and its files. Scenarios that added it keep their copies. */
    public function remove(int|string $asset): void
    {
        $found = $this->get($asset);
        foreach ($found['files'] as $file) {
            $this->deleteStoredFile($file['path']);
        }
        $this->run('DELETE FROM `library_asset_files` WHERE `library_asset_id` = ?', [$found['id']]);
        $this->run('DELETE FROM `library_assets` WHERE `id` = ?', [$found['id']]);
    }

    /**
     * Give an asset a file (or replace the one it has) in a role: sheet, portrait, image, sound,
     * preview... `$path` is copied into the media directory. `$params` are what the file carries into
     * a scenario's media: sheet {columns, rows, count}, animations [{name, frames, duration, repeat}],
     * scale_x/scale_y.
     */
    public function putFile(int|string $asset, string $role, string $path, array $params = [], ?string $filename = null): array
    {
        $found = $this->get($asset);
        $role = self::role($role);
        if ($this->mediaDir === null) {
            throw new StoreError(503, 'File uploads are not set up on this server.');
        }
        if (! is_file($path) || filesize($path) > ScenarioStore::MAX_UPLOAD_BYTES) {
            throw new StoreError(422, 'The file is missing or larger than 25 MB.');
        }
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
        [$type, $extension] = ScenarioStore::UPLOADS[$mime] ?? throw new StoreError(422, 'Only PNG, JPEG, WebP and GIF images, MP3, WAV and OGG audio, and MP4 and WebM video can be added.');
        $dir = $this->mediaDir.'/library/'.$found['id'];
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new RuntimeException("Cannot create $dir");
        }
        $name = bin2hex(random_bytes(12)).'.'.$extension;
        if (! (is_uploaded_file($path) ? move_uploaded_file($path, "$dir/$name") : copy($path, "$dir/$name"))) {
            throw new RuntimeException('Could not store the file.');
        }

        return $this->recordFile($found['id'], $role, 'media:library/'.$found['id'].'/'.$name, rtrim($this->mediaUrl, '/').'/library/'.$found['id'].'/'.$name, $type, $params, $filename ?? basename($path));
    }

    /** Take a file away from an asset. */
    public function removeFile(int|string $asset, string $role): array
    {
        $found = $this->get($asset);
        foreach ($found['files'] as $file) {
            if ($file['role'] === $role) {
                $this->deleteStoredFile($file['path']);
                $this->run('DELETE FROM `library_asset_files` WHERE `id` = ?', [$file['id']]);
            }
        }

        return $this->get($found['id']);
    }

    // ====================================================================== scenarios

    /**
     * Add an asset to a scenario: copy the files it uses into the scenario's media (or use the copies
     * already there), then make what it describes: a character, or an item (a vehicle is an item
     * with vehicle: true). Pictures and sounds make only their media.
     *
     * `$options`: name (the new row's name; default the asset's, numbered when taken).
     *
     * @return array{asset: array, created: array{table: string, row: array}|null, media: list<array>, copied: list<int>}
     *               `media`: every media row it uses (new or reused); `copied`: the ids of those made now
     */
    public function addToScenario(ScenarioStore $store, int $scenarioId, int|string $asset, array $options = []): array
    {
        $found = $this->get($asset);
        if (! $found['active']) {
            throw new StoreError(422, 'That asset has been withdrawn from the library.');
        }
        $definition = $found['definition'];
        $files = [];
        foreach ($found['files'] as $file) {
            $files[$file['role']] = $file;
        }
        $media = [];
        $copied = [];
        $mediaFor = function (string $role) use (&$media, &$copied, $files, $found, $store, $scenarioId): int {
            if (isset($media[$role])) {
                return $media[$role]['id'];
            }
            $file = $files[$role] ?? throw new StoreError(422, "The asset “{$found['name']}” has no {$role} file.");
            [$row, $new] = $this->copyFile($store, $scenarioId, $found, $file);
            $media[$role] = $row;
            if ($new) {
                $copied[] = $row['id'];
            }

            return $row['id'];
        };

        $created = null;
        switch ($found['kind']) {
            case 'character':
                $animations = [];
                foreach ((array) ($definition['animations'] ?? []) as $name => $animation) {
                    $animations[$name] = ['media_id' => $mediaFor((string) $animation['file'])] + array_diff_key($animation, ['file' => 1]);
                }
                $settings = array_filter(['animations' => $animations ?: null, 'scale' => $definition['scale'] ?? null, 'voice' => $definition['voice'] ?? null], fn ($v) => $v !== null);
                $created = ['table' => 'characters', 'row' => $store->createRow($scenarioId, 'characters', [
                    'name' => $this->freeName($scenarioId, 'characters', (string) ($options['name'] ?? $found['name'])),
                    'settings' => $settings,
                ])];
                break;
            case 'vehicle':
            case 'item':
                $item = (array) ($definition['item'] ?? []);
                $columns = array_intersect_key($item, array_flip(self::ITEM_COLUMNS));
                $columns['vehicle'] = $found['kind'] === 'vehicle' || ! empty($columns['vehicle']);
                $created = ['table' => 'items', 'row' => $store->createRow($scenarioId, 'items', $columns + [
                    'name' => $this->freeName($scenarioId, 'items', (string) ($options['name'] ?? $found['name'])),
                    'media_id' => isset($definition['file']) ? $mediaFor((string) $definition['file']) : null,
                    'settings' => (array) ($item['settings'] ?? []) ?: new \stdClass,
                ])];
                break;
            default:
                // A picture or a sound: the media is what is added.
                $mediaFor((string) ($definition['file'] ?? array_key_first(array_diff_key($files, array_flip(self::DISPLAY_ROLES))) ?? ''));
        }

        return ['asset' => $found, 'created' => $created, 'media' => array_values($media), 'copied' => $copied];
    }

    /**
     * Keep something from a scenario in the library for reuse: a character (with every picture its
     * animations use), an item or vehicle (with its picture), or a media file (as a picture or a
     * sound). `$attrs` are the new asset's (name, slug, category, description, tags, credit,
     * organization_id, created_by...). Returns the asset.
     */
    public function capture(ScenarioStore $store, int $scenarioId, string $table, int $rowId, array $attrs = []): array
    {
        $bundle = $store->bundle($scenarioId);
        $row = null;
        foreach ($bundle[$table] ?? throw new StoreError(422, 'Only characters, items and media can be kept in the library.') as $candidate) {
            if ((int) $candidate['id'] === $rowId) {
                $row = $candidate;
            }
        }
        if (! $row || ! in_array($table, ['characters', 'items', 'media'], true)) {
            throw new StoreError(404, 'There is no such row in this scenario.');
        }
        $mediaById = [];
        foreach ($bundle['media'] as $m) {
            $mediaById[(int) $m['id']] = $m;
        }
        // Each picture used, under a role name: the first is "sheet" (or "image"), a close-up "portrait", others "picture-2"...
        $roles = [];
        $roleOf = function (int $mediaId, string $hint = '') use (&$roles, $mediaById): string {
            if (isset($roles[$mediaId])) {
                return $roles[$mediaId];
            }
            $m = $mediaById[$mediaId] ?? throw new StoreError(422, 'It uses a picture that is not in this scenario.');
            $base = $hint ?: (($m['type'] ?? 'image') === 'audio' ? 'sound' : (! empty($m['params']['sheet']) ? 'sheet' : 'image'));
            $role = $base;
            for ($n = 2; in_array($role, $roles, true); $n++) {
                $role = "$base-$n";
            }

            return $roles[$mediaId] = $role;
        };

        $settings = is_array($row['settings'] ?? null) ? $row['settings'] : [];
        $copy = fn (array $keys) => array_intersect_key($settings, array_flip($keys));
        switch ($table) {
            case 'characters':
                $kind = 'character';
                $animations = [];
                $ordered = (array) ($settings['animations'] ?? []);
                uksort($ordered, fn ($a, $b) => ($a === 'portrait') <=> ($b === 'portrait'));
                foreach ($ordered as $name => $animation) {
                    if (! is_array($animation) || empty($animation['media_id'])) {
                        continue;
                    }
                    $animations[$name] = ['file' => $roleOf((int) $animation['media_id'], $name === 'portrait' ? 'portrait' : '')] + array_diff_key($animation, ['media_id' => 1]);
                }
                if (! $animations && ! empty($row['media_id'])) {
                    $animations['stand_right'] = ['file' => $roleOf((int) $row['media_id'])];
                }
                $definition = ['animations' => $animations] + $copy(['scale', 'voice']);
                break;
            case 'items':
                $kind = ! empty($row['vehicle']) ? 'vehicle' : 'item';
                $definition = ['item' => array_intersect_key($row, array_flip(self::ITEM_COLUMNS)) + ['settings' => $settings]];
                if (! empty($row['media_id'])) {
                    $definition['file'] = $roleOf((int) $row['media_id']);
                }
                break;
            default:
                $role = $roleOf($rowId);
                $kind = str_starts_with($role, 'sound') ? 'sound' : 'picture';
                $definition = ['file' => $role];
        }

        $asset = $this->save([
            'kind' => $kind,
            'name' => $attrs['name'] ?? $row['name'] ?? $row['filename'] ?? 'Untitled',
            'source' => 'scenario',
            'definition' => $definition,
        ] + array_intersect_key($attrs, array_flip(['slug', 'category', 'description', 'tags', 'style', 'credit', 'organization_id', 'created_by', 'sequence'])));
        foreach ($roles as $mediaId => $role) {
            $m = $mediaById[$mediaId];
            $path = $store->mediaFile($m) ?? throw new StoreError(422, "The file of “{$m['filename']}” is not on this server, so it cannot be kept.");
            $params = array_diff_key((array) ($m['params'] ?? []), ['library' => 1, 'credit' => 1, 'category' => 1, 'speech' => 1]);
            foreach (['scale_x', 'scale_y'] as $scale) {
                if (isset($m[$scale]) && (float) $m[$scale] !== 1.0) {
                    $params[$scale] = (float) $m[$scale];
                }
            }
            $this->putFile($asset['id'], $role, $path, $params, $m['filename'] ?? null);
        }

        return $this->get($asset['id']);
    }

    // ====================================================================== the shipped pack

    /**
     * Add the assets of a pack (a library.json beside its files, as tools/make-questlab-assets.py
     * writes it). Each asset is added once, by slug; with `$refresh` the ones already there are
     * brought up to date with the pack (their files, definition, credit; not whether they are active).
     *
     * @return array{added: int, updated: int, kept: int}
     */
    public function importPack(?string $manifest = null, bool $refresh = false): array
    {
        $manifest ??= $this->packDir ? $this->packDir.'/library.json' : null;
        if (! $manifest || ! is_file($manifest)) {
            return ['added' => 0, 'updated' => 0, 'kept' => 0];
        }
        $pack = json_decode((string) file_get_contents($manifest), true);
        if (! is_array($pack) || ! is_array($pack['assets'] ?? null)) {
            throw new RuntimeException("$manifest is not an asset pack.");
        }
        $root = dirname($manifest);
        $existing = [];
        foreach ($this->select('SELECT `id`, `slug` FROM `library_assets`') as $row) {
            $existing[$row['slug']] = (int) $row['id'];
        }
        $counts = ['added' => 0, 'updated' => 0, 'kept' => 0];
        foreach ($pack['assets'] as $sequence => $entry) {
            $slug = (string) $entry['slug'];
            if (isset($existing[$slug]) && ! $refresh) {
                $counts['kept']++;

                continue;
            }
            $attrs = array_intersect_key($entry, array_flip(['slug', 'kind', 'name', 'category', 'description', 'tags', 'style', 'definition', 'credit']))
                + ['source' => 'pack', 'sequence' => $sequence + 1];
            $asset = $this->save($attrs);
            $this->run('DELETE FROM `library_asset_files` WHERE `library_asset_id` = ? AND `path` LIKE ?', [$asset['id'], 'pack:%']);
            foreach ((array) ($entry['files'] ?? []) as $role => $file) {
                $relative = ltrim(str_replace('\\', '/', (string) $file['file']), '/');
                $local = realpath($root.'/'.$relative);
                if ($local === false || ! str_starts_with($local, realpath($root).DIRECTORY_SEPARATOR)) {
                    throw new RuntimeException("$slug: the pack has no file $relative.");
                }
                $size = @getimagesize($local);
                $url = $this->packDir && realpath($this->packDir) === realpath($root) ? rtrim($this->packUrl, '/').'/'.$relative : null;
                $this->recordFile($asset['id'], self::role((string) $role), 'pack:'.$relative, $url ?? rtrim($this->packUrl, '/').'/'.$relative,
                    (string) ($file['type'] ?? 'image'), (array) ($file['params'] ?? []), basename($relative), $size ?: null, filesize($local) ?: null);
            }
            $counts[isset($existing[$slug]) ? 'updated' : 'added']++;
        }

        return $counts;
    }

    // ====================================================================== presenting

    /** Rows as the API gives them: JSON decoded, typed, with their files (keyed `files`, a list, and `file_urls`, role => URL). */
    private function present(array $rows): array
    {
        if (! $rows) {
            return [];
        }
        $ids = array_map(fn ($r) => (int) $r['id'], $rows);
        $files = [];
        foreach ($this->select('SELECT * FROM `library_asset_files` WHERE `library_asset_id` IN ('.implode(', ', array_fill(0, count($ids), '?')).') ORDER BY `id`', $ids) as $f) {
            $files[(int) $f['library_asset_id']][] = [
                'id' => (int) $f['id'],
                'role' => $f['role'],
                'type' => $f['type'],
                'url' => $f['url'],
                'path' => $f['path'],
                'filename' => $f['filename'],
                'width' => $f['width'] === null ? null : (int) $f['width'],
                'height' => $f['height'] === null ? null : (int) $f['height'],
                'bytes' => $f['bytes'] === null ? null : (int) $f['bytes'],
                'params' => json_decode((string) $f['params'], true) ?: new \stdClass,
            ];
        }

        return array_map(function (array $r) use ($files) {
            $own = $files[(int) $r['id']] ?? [];

            return [
                'id' => (int) $r['id'],
                'slug' => $r['slug'],
                'kind' => $r['kind'],
                'name' => $r['name'],
                'category' => $r['category'],
                'description' => $r['description'],
                'tags' => json_decode((string) $r['tags'], true) ?: [],
                'style' => $r['style'],
                'definition' => json_decode((string) $r['definition'], true) ?: [],
                'credit' => json_decode((string) $r['credit'], true) ?: null,
                'organization_id' => $r['organization_id'] === null ? null : (int) $r['organization_id'],
                'created_by' => $r['created_by'] === null ? null : (int) $r['created_by'],
                'source' => $r['source'],
                'active' => (bool) $r['active'],
                'sequence' => (int) $r['sequence'],
                'files' => $own,
                'file_urls' => array_column($own, 'url', 'role') ?: new \stdClass,
                'updated_at' => $r['updated_at'],
            ];
        }, $rows);
    }

    // ====================================================================== helpers

    /** Where a library file is on disk, or null if it is gone. */
    public function filePath(array $file): ?string
    {
        $path = (string) ($file['path'] ?? '');
        if (str_starts_with($path, 'pack:') && $this->packDir) {
            $full = realpath($this->packDir.'/'.substr($path, 5));
            $root = realpath($this->packDir);

            return $full && $root && str_starts_with($full, $root.DIRECTORY_SEPARATOR) && is_file($full) ? $full : null;
        }
        if (str_starts_with($path, 'media:library/') && $this->mediaDir && preg_match('#^media:(library/\d+/[a-f0-9]{24}\.[a-z0-9]{2,4})$#', $path, $m)) {
            return is_file($this->mediaDir.'/'.$m[1]) ? $this->mediaDir.'/'.$m[1] : null;
        }

        return null;
    }

    /** A slug: lower-case letters, digits and dashes. */
    public static function slug(string $text): string
    {
        $text = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $text) ?: $text));

        return substr(trim($text, '-'), 0, 80);
    }

    /** The scenario's copy of a library file: the one made before (same asset, same role, same file), or a new one. */
    private function copyFile(ScenarioStore $store, int $scenarioId, array $asset, array $file): array
    {
        $key = ['asset' => $asset['slug'], 'file' => $file['role']];
        foreach ($this->select("SELECT `id`, `params` FROM `media` WHERE `scenario_id` = ? AND `params` LIKE ?", [$scenarioId, '%"library"%']) as $m) {
            $params = json_decode((string) $m['params'], true) ?: [];
            $library = $params['library'] ?? null;
            if (is_array($library) && ($library['asset'] ?? null) === $key['asset'] && ($library['file'] ?? null) === $key['file'] && ($library['id'] ?? null) === $file['id']) {
                return [$this->mediaRow($store, $scenarioId, (int) $m['id']), false];
            }
        }
        $path = $this->filePath($file) ?? throw new StoreError(422, "The {$file['role']} file of “{$asset['name']}” is missing on this server.");
        $row = $store->addMediaFile($scenarioId, $path, $file['filename'] ?: basename($path));
        $fileParams = (array) $file['params'];
        $params = array_merge(
            is_array($row['params'] ?? null) ? $row['params'] : [],
            array_diff_key($fileParams, ['scale_x' => 1, 'scale_y' => 1]),
            // Where it came from (so it is used again rather than copied twice), and who drew it.
            ['category' => self::KINDS[$asset['kind']], 'library' => $key + ['id' => $file['id']]],
            $asset['credit'] ? ['credit' => $asset['credit']] : [],
        );
        $columns = ['params' => $params, 'filename' => mb_substr($asset['name'].' – '.$file['role'].'.'.pathinfo((string) $row['filepath'], PATHINFO_EXTENSION), 0, 200)];
        foreach (['scale_x', 'scale_y'] as $scale) {
            if (isset($fileParams[$scale])) {
                $columns[$scale] = (float) $fileParams[$scale];
            }
        }

        return [$store->updateRow($scenarioId, 'media', (int) $row['id'], $columns), true];
    }

    private function mediaRow(ScenarioStore $store, int $scenarioId, int $id): array
    {
        foreach ($store->bundle($scenarioId)['media'] as $m) {
            if ((int) $m['id'] === $id) {
                return $m;
            }
        }
        throw new StoreError(404, 'Media not found.');
    }

    /** The name, or the name with the next free number ("Red Squirrel 2") when the scenario already has one so called. */
    private function freeName(int $scenarioId, string $table, string $name): string
    {
        $name = mb_substr(trim($name) ?: 'Untitled', 0, 110);
        $taken = array_map('mb_strtolower', array_column($this->select("SELECT `name` FROM `$table` WHERE `scenario_id` = ?", [$scenarioId]), 'name'));
        $candidate = $name;
        for ($n = 2; in_array(mb_strtolower($candidate), $taken, true); $n++) {
            $candidate = "$name $n";
        }

        return $candidate;
    }

    private function recordFile(int $assetId, string $role, string $path, string $url, string $type, array $params, ?string $filename, array|false|null $size = null, ?int $bytes = null): array
    {
        foreach ($this->select('SELECT `id`, `path` FROM `library_asset_files` WHERE `library_asset_id` = ? AND `role` = ?', [$assetId, $role]) as $old) {
            if ($old['path'] !== $path) {
                $this->deleteStoredFile($old['path']);
            }
            $this->run('DELETE FROM `library_asset_files` WHERE `id` = ?', [$old['id']]);
        }
        if ($size === null && ($local = $this->filePath(['path' => $path]))) {
            $size = $type === 'image' ? @getimagesize($local) : false;
            $bytes = filesize($local) ?: null;
        }
        $now = self::now();
        $this->insert('library_asset_files', [
            'library_asset_id' => $assetId,
            'role' => $role,
            'type' => in_array($type, ['image', 'audio', 'video'], true) ? $type : 'image',
            'path' => $path,
            'url' => $url,
            'filename' => $filename === null ? null : mb_substr(basename($filename), 0, 200),
            'width' => $size ? $size[0] : null,
            'height' => $size ? $size[1] : null,
            'bytes' => $bytes,
            'params' => self::json(self::cleanFileParams($params)),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->run('UPDATE `library_assets` SET `updated_at` = ? WHERE `id` = ?', [$now, $assetId]);

        return $this->get($assetId);
    }

    private function deleteStoredFile(string $path): void
    {
        // Pack files belong to the checkout; only files this library stored are removed.
        if (str_starts_with($path, 'media:') && ($local = $this->filePath(['path' => $path]))) {
            @unlink($local);
        }
    }

    /** What a definition may hold, by kind; file references must be role names. */
    private static function cleanDefinition(string $kind, array $definition): array
    {
        $out = [];
        if ($kind === 'character') {
            foreach ((array) ($definition['animations'] ?? []) as $name => $animation) {
                if (! is_array($animation) || ! is_string($animation['file'] ?? null) || ! preg_match('/^[a-z][a-z0-9_]{0,39}$/', (string) $name)) {
                    throw new StoreError(422, "Each animation needs a name (letters, digits and _) and the file it is drawn from (animation “{$name}”).");
                }
                $clean = ['file' => self::role($animation['file'])];
                if (isset($animation['frames'])) {
                    $clean['frames'] = array_values(array_map('intval', (array) $animation['frames']));
                }
                foreach (['duration' => 'intval', 'repeat' => 'boolval', 'flip' => 'boolval'] as $key => $cast) {
                    if (isset($animation[$key])) {
                        $clean[$key] = $cast($animation[$key]);
                    }
                }
                $out['animations'][$name] = $clean;
            }
            if (isset($definition['scale'])) {
                $out['scale'] = (float) $definition['scale'];
            }
            if (isset($definition['voice'])) {
                $out['voice'] = $definition['voice'];
            }

            return $out;
        }
        if (isset($definition['file'])) {
            $out['file'] = self::role((string) $definition['file']);
        }
        if (in_array($kind, ['vehicle', 'item'], true) && isset($definition['item'])) {
            $item = (array) $definition['item'];
            $out['item'] = array_map(fn ($v) => (bool) $v, array_intersect_key($item, array_flip(self::ITEM_COLUMNS)));
            if (isset($item['settings'])) {
                $out['item']['settings'] = (array) $item['settings'];
            }
        }

        return $out;
    }

    private static function cleanCredit(array $credit): array
    {
        $out = [];
        foreach (['title' => 200, 'author' => 200, 'license' => 40, 'url' => 500, 'note' => 500] as $key => $max) {
            if (isset($credit[$key]) && trim((string) $credit[$key]) !== '') {
                $out[$key] = mb_substr(trim(strip_tags((string) $credit[$key])), 0, $max);
            }
        }
        if (isset($out['url']) && ! preg_match('#^https?://#i', $out['url'])) {
            unset($out['url']);
        }

        return $out;
    }

    private static function cleanFileParams(array $params): array
    {
        $out = [];
        if (isset($params['sheet']) && is_array($params['sheet'])) {
            $sheet = $params['sheet'];
            $out['sheet'] = array_filter([
                'columns' => max(1, (int) ($sheet['columns'] ?? 1)),
                'rows' => max(1, (int) ($sheet['rows'] ?? 1)),
                'count' => isset($sheet['count']) ? max(1, (int) $sheet['count']) : null,
            ], fn ($v) => $v !== null);
        }
        if (isset($params['animations']) && is_array($params['animations'])) {
            foreach ($params['animations'] as $a) {
                if (is_array($a) && isset($a['name'], $a['frames'])) {
                    $out['animations'][] = array_filter([
                        'name' => (string) $a['name'],
                        'frames' => array_values(array_map('intval', (array) $a['frames'])),
                        'duration' => isset($a['duration']) ? (int) $a['duration'] : null,
                        'repeat' => isset($a['repeat']) ? (bool) $a['repeat'] : null,
                    ], fn ($v) => $v !== null);
                }
            }
        }
        foreach (['apng'] as $key) {
            if (isset($params[$key]) && is_array($params[$key])) {
                $out[$key] = $params[$key];
            }
        }
        foreach (['scale_x', 'scale_y'] as $key) {
            if (isset($params[$key]) && (float) $params[$key] > 0) {
                $out[$key] = (float) $params[$key];
            }
        }

        return $out;
    }

    private static function role(string $role): string
    {
        $role = strtolower(trim($role));
        if (! preg_match('/^[a-z][a-z0-9_-]{0,31}$/', $role)) {
            throw new StoreError(422, 'A file role is a short name: letters, digits, - and _ (sheet, portrait, image, sound...).');
        }

        return $role;
    }

    /** [SQL condition, params] limiting rows to what `$user` may see; none for admins, or when there is no user (internal callers). */
    private function visibility(?array $user): array
    {
        if ($user === null || ($user['role'] ?? '') === 'admin') {
            return ['', []];
        }
        $org = $this->select('SELECT `organization_id` FROM `users` WHERE `id` = ?', [(int) ($user['id'] ?? 0)])[0]['organization_id'] ?? null;

        return $org === null ? ['`organization_id` IS NULL', []] : ['(`organization_id` IS NULL OR `organization_id` = ?)', [(int) $org]];
    }

    private function nextSequence(): int
    {
        return (int) ($this->select('SELECT MAX(`sequence`) AS m FROM `library_assets`')[0]['m'] ?? 0) + 1;
    }

    private static function json(mixed $value): string
    {
        return json_encode($value === [] ? new \stdClass : $value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    private function select(string $sql, array $params = []): array
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute(array_values($params));

        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    private function run(string $sql, array $params = []): void
    {
        $this->pdo->prepare($sql)->execute(array_values($params));
    }

    private function insert(string $table, array $row): int
    {
        $columns = array_keys($row);
        $this->run("INSERT INTO `$table` (".implode(', ', array_map(fn ($c) => "`$c`", $columns)).') VALUES ('.implode(', ', array_fill(0, count($columns), '?')).')', $row);

        return (int) $this->pdo->lastInsertId();
    }

    private function update(string $table, int $id, array $row): void
    {
        $this->run("UPDATE `$table` SET ".implode(', ', array_map(fn ($c) => "`$c` = ?", array_keys($row))).' WHERE `id` = ?', [...array_values($row), $id]);
    }

    /** The tables in SQLite, for the dev server and the tests (production: the Laravel migration). */
    public static function sqliteSchema(): array
    {
        return [
            'CREATE TABLE IF NOT EXISTS `library_assets` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `slug` UNIQUE, `kind`, `name`, `category`, `description`, `tags`, `style`, `definition`, `credit`, '
                .'`organization_id` INTEGER, `created_by` INTEGER, `source`, `active` INTEGER NOT NULL DEFAULT 1, `sequence` INTEGER NOT NULL DEFAULT 0, `created_at`, `updated_at`)',
            'CREATE TABLE IF NOT EXISTS `library_asset_files` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `library_asset_id` INTEGER, `role`, `type`, `path`, `url`, `filename`, '
                .'`width` INTEGER, `height` INTEGER, `bytes` INTEGER, `params`, `created_at`, `updated_at`, UNIQUE (`library_asset_id`, `role`))',
        ];
    }
}
