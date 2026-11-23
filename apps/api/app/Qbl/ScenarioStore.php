<?php

namespace App\Qbl;

use App\Qbl\Characters\NpcCharacter;
use PDO;
use RuntimeException;

/**
 * Reads and writes scenarios as rows of the QBL tables.
 *
 * It is plain PHP over PDO with no framework calls, so the same code runs in
 * Laravel (handed Laravel's own database connection), in the dev server and
 * in the tests. It is the one place that knows which tables and columns make
 * up a scenario, who owns a row, and what has to be removed with it.
 *
 * Identifiers are quoted with backticks, which MariaDB/MySQL and SQLite both accept.
 */
class ScenarioStore
{
    /** Columns a caller may write, and how each is stored: int, num, bool, str or json. */
    public const SCHEMA = [
        'scenarios' => [
            'shortname' => 'str', 'title' => 'str', 'subtitle' => 'str', 'description' => 'str', 'start_scene_id' => 'int',
            'enable_save_session' => 'bool', 'require_login' => 'bool', 'allow_groups' => 'bool', 'max_players' => 'int',
            'default_language' => 'str', 'intro_media_portrait_id' => 'int', 'intro_media_landscape_id' => 'int', 'settings' => 'json',
        ],
        'media' => [
            'scenario_id' => 'int', 'type' => 'str', 'filename' => 'str', 'filepath' => 'str', 'url' => 'str', 'scale_x' => 'num', 'scale_y' => 'num',
            'width' => 'int', 'height' => 'int', 'priority' => 'int', 'params' => 'json',
        ],
        // What this scenario sells in the marketplace. Platform-wide items are rows with no scenario.
        'shop_items' => [
            'scenario_id' => 'int', 'name' => 'str', 'description' => 'str', 'kind' => 'str', 'slot' => 'str', 'price' => 'int',
            'media_id' => 'int', 'image_url' => 'str', 'settings' => 'json', 'active' => 'bool', 'sequence' => 'int',
        ],
        'variables' => ['scenario_id' => 'int', 'variable_name' => 'str', 'default_value' => 'json', 'scope' => 'str', 'persist' => 'bool'],
        'items' => [
            'scenario_id' => 'int', 'name' => 'str', 'unique' => 'bool', 'physical' => 'bool', 'blocking' => 'bool', 'wearable' => 'bool',
            'vehicle' => 'bool', 'media_id' => 'int', 'settings' => 'json',
        ],
        'characters' => ['scenario_id' => 'int', 'name' => 'str', 'media_id' => 'int', 'settings' => 'json'],
        'scenes' => [
            'scenario_id' => 'int', 'shortname' => 'str', 'sequence' => 'int', 'group_id' => 'int', 'subtitle' => 'str', 'description' => 'str',
            'is_intro_scene' => 'bool', 'zoom' => 'num', 'show_avatars' => 'bool', 'width' => 'int', 'height' => 'int',
            'background_media' => 'json', 'foreground_media' => 'json', 'layout' => 'json', 'params' => 'json',
        ],
        'events' => [
            'scene_id' => 'int', 'kind' => 'str', 'shortname' => 'str', 'sequence' => 'int', 'overridable' => 'bool', 'block_hotspots' => 'bool',
            'position_x' => 'num', 'position_y' => 'num', 'radius' => 'num', 'activate_by_trigger' => 'bool', 'once' => 'bool',
            'reveal_radius' => 'num', 'reveal_full_radius' => 'num', 'audience' => 'str',
        ],
        'actions' => ['event_id' => 'int', 'type' => 'str', 'sequence' => 'int', 'blocking' => 'bool', 'media_id' => 'int', 'params' => 'json'],
        'conditions' => [
            'event_id' => 'int', 'action_id' => 'int', 'item_id' => 'int', 'character_id' => 'int', 'type' => 'str', 'variable' => 'str',
            'operator' => 'str', 'operand' => 'json',
        ],
        'labels' => [
            'event_id' => 'int', 'type' => 'str', 'position_x' => 'num', 'position_y' => 'num', 'scale_x' => 'num', 'scale_y' => 'num',
            'text' => 'str', 'media_id' => 'int', 'params' => 'json',
        ],
    ];

    /** Tables that hang off a scenario, parents before children. */
    public const CONTENT = ['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'];

    /** For tables without a scenario_id: the columns that point at a parent row, and that parent's table. */
    private const PARENTS = [
        'events' => ['scene_id' => 'scenes'],
        'actions' => ['event_id' => 'events'],
        'labels' => ['event_id' => 'events'],
        'conditions' => ['event_id' => 'events', 'action_id' => 'actions', 'item_id' => 'items', 'character_id' => 'characters'],
    ];

    private const ENUMS = [
        'media.type' => ['audio', 'image', 'video'],
        'variables.scope' => ['player', 'room'],
        'events.kind' => ['start', 'end', 'hotspot', 'indirect'],
        'events.audience' => ['player', 'scene'],
        'labels.type' => ['text', 'image', 'spritemap'],
        'shop_items.kind' => ProgressStore::KINDS,
        'shop_items.slot' => ProgressStore::SLOTS,
        'conditions.operator' => ['=', '!=', '>', '<', '>=', '<=', '%', '!%'],
        'actions.type' => [
            'animate', 'award', 'glossary', 'shop', 'dialogue', 'narration', 'conversation', 'avatar', 'freeze', 'audio', 'cancel', 'cancel_event', 'image_fixed', 'image_overlay', 'infobox', 'jump', 'repeat', 'run_event', 'spritemap',
            'text_overlay', 'translate', 'variable', 'video', 'wait', 'walk', 'weather', 'camera', 'bench',
        ],
    ];

    /** What an uploaded file may be, by detected MIME type. SVG is left out on purpose: it can carry script. */
    public const UPLOADS = [
        'image/png' => ['image', 'png'], 'image/jpeg' => ['image', 'jpg'], 'image/webp' => ['image', 'webp'], 'image/gif' => ['image', 'gif'],
        'audio/mpeg' => ['audio', 'mp3'], 'audio/wav' => ['audio', 'wav'], 'audio/x-wav' => ['audio', 'wav'], 'audio/ogg' => ['audio', 'ogg'],
        'video/mp4' => ['video', 'mp4'], 'video/webm' => ['video', 'webm'],
    ];

    public const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

    /** Rows of the starship hub, which a new scenario can start as a copy of. */
    public const HUB_TEMPLATE = __DIR__.'/../../database/seeders/data/hub.php';

    /** Keys that hold the id of another row, wherever they appear in a row's JSON, and the table that row is in. */
    private const REFERENCES = [
        'media_id' => 'media', 'music_media_id' => 'media', 'portrait_media_id' => 'media', 'media' => 'media',
        'narration_media_id' => 'media', 'badge_media_id' => 'media',
        'scene_id' => 'scenes', 'event_id' => 'events', 'target_event_id' => 'events', 'action_id' => 'actions', 'target_id' => 'actions',
        'item_id' => 'items', 'character_id' => 'characters',
    ];

    /** What a row gets on import when the file does not say. */
    private const IMPORT_DEFAULTS = [
        'media' => ['scale_x' => 1, 'scale_y' => 1, 'priority' => 100],
        'shop_items' => ['kind' => 'wearable', 'price' => 0, 'active' => true, 'sequence' => 0],
        'variables' => ['default_value' => 0, 'scope' => 'player', 'persist' => true],
        'items' => ['unique' => false, 'physical' => false, 'blocking' => false, 'wearable' => false, 'vehicle' => false, 'settings' => []],
        'characters' => ['settings' => []],
        'scenes' => ['sequence' => 1, 'zoom' => 1, 'show_avatars' => true, 'is_intro_scene' => false, 'background_media' => [], 'foreground_media' => [], 'layout' => []],
        'events' => ['kind' => 'hotspot', 'sequence' => 1, 'overridable' => false, 'block_hotspots' => false, 'activate_by_trigger' => false, 'once' => false, 'audience' => 'player'],
        'actions' => ['sequence' => 1, 'blocking' => true, 'params' => []],
        'conditions' => ['type' => 'variable', 'operator' => '=', 'operand' => 0],
        'labels' => ['scale_x' => 1, 'scale_y' => 1, 'position_x' => 0, 'position_y' => 0],
    ];

    public function __construct(
        private PDO $pdo,
        /** Directory uploaded media is written to, or null if uploads are not available. */
        private ?string $mediaDir = null,
        /** URL prefix that directory is served under. */
        private string $mediaUrl = '/media',
    ) {
        $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    }

    /** The connection, for the classes beside this one that read the same database. */
    public function pdo(): PDO
    {
        return $this->pdo;
    }

    // =================================================================== reading

    /** Everything ScenarioCompiler needs for one scenario, as the database returns it. */
    public function rows(int $scenarioId): array
    {
        $scenario = $this->one('SELECT * FROM `scenarios` WHERE `id` = ?', [$scenarioId]);
        if (! $scenario) {
            throw new StoreError(404, 'Scenario not found.');
        }
        $out = ['scenario' => $scenario];
        foreach (self::CONTENT as $table) {
            $out[$table] = $this->all("SELECT * FROM `$table` WHERE ".$this->inScenario($table).' ORDER BY `id`', $this->scopeParams($table, $scenarioId));
        }

        return $out;
    }

    /** The same rows with JSON decoded and numbers and booleans typed, for the editor. */
    public function bundle(int $scenarioId): array
    {
        $rows = $this->rows($scenarioId);
        $out = ['scenario' => $this->decode('scenarios', $rows['scenario'])];
        foreach (self::CONTENT as $table) {
            $out[$table] = array_map(fn ($row) => $this->decode($table, $row), $rows[$table]);
        }

        return $out;
    }

    public function scenario(int $id): ?array
    {
        $row = $this->one('SELECT * FROM `scenarios` WHERE `id` = ?', [$id]);

        return $row ? $this->decode('scenarios', $row) : null;
    }

    /** Scenarios a user may edit: their own, shared samples with no owner, or all of them for an admin or content admin. */
    public function listFor(array $user): array
    {
        $sql = 'SELECT `id`, `code`, `shortname`, `title`, `subtitle`, `user_id`, `published_at`, `updated_at` FROM `scenarios`';
        $rows = Roles::editsAllScenarios($user['role'] ?? null)
            ? $this->all("$sql ORDER BY `updated_at` DESC")
            : $this->all("$sql WHERE `user_id` = ? OR `user_id` IS NULL ORDER BY `updated_at` DESC", [$user['id']]);

        return array_map(fn ($r) => ['id' => (int) $r['id'], 'user_id' => $r['user_id'] === null ? null : (int) $r['user_id']] + $r, $rows);
    }

    /** Whether `$user` may change `$scenario`: their own and the shared samples; every one for admins and content admins (App\Qbl\Roles). */
    public function canEdit(array $scenario, array $user): bool
    {
        $role = $user['role'] ?? '';
        if (Roles::editsAllScenarios($role)) {
            return true;
        }

        return $role === Roles::TEACHER && ($scenario['user_id'] === null || (int) $scenario['user_id'] === (int) $user['id']);
    }

    /** The scenario JSON generated from the tables as they are now (a draft: not what players get). */
    public function compile(int $scenarioId): array
    {
        return ScenarioCompiler::compile($this->rows($scenarioId));
    }

    /** Generate the JSON and make it the version players get. */
    public function publish(int $scenarioId): array
    {
        $document = $this->compile($scenarioId);
        $now = self::now();
        $this->run('UPDATE `scenarios` SET `document` = ?, `published_at` = ?, `updated_at` = ? WHERE `id` = ?', [
            json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $now, $now, $scenarioId,
        ]);

        return $document;
    }

    /** The published document for a scenario code (or a shortname), or null. */
    public function findPublished(string $key): ?array
    {
        // A code always wins over a shortname that happens to be spelled the same.
        $row = $this->one(
            'SELECT `id`, `code`, `document` FROM `scenarios` WHERE (`code` = ? OR `shortname` = ?) AND `published_at` IS NOT NULL'
            .' ORDER BY (`code` = ?) DESC LIMIT 1',
            [strtolower($key), $key, strtolower($key)],
        );
        if (! $row || $row['document'] === null) {
            return null;
        }
        $document = is_array($row['document']) ? $row['document'] : json_decode((string) $row['document'], true);

        // The code comes from the row, so documents published before codes existed carry it too.
        return is_array($document) ? array_merge($document, ['code' => $row['code']]) : null;
    }

    // ================================================================= scenarios

    /** A new scenario's code: sixteen lowercase letters, not used by any other scenario. Players open /{code} to play. */
    public function generateCode(): string
    {
        do {
            $code = '';
            for ($i = 0; $i < 16; $i++) {
                $code .= chr(97 + random_int(0, 25));
            }
        } while ($this->one('SELECT `id` FROM `scenarios` WHERE `code` = ?', [$code]));

        return $code;
    }

    /** The site's own first path segments; see RESERVED_CODES in packages/shared/src/site.ts, which must list the same. */
    public const RESERVED_CODES = [
        'about', 'admin', 'api', 'app', 'assets', 'auth', 'billing', 'classes', 'district', 'docs', 'editor', 'game', 'help', 'home', 'index',
        'login', 'logout', 'media', 'missions', 'new', 'play', 'plans', 'pricing', 'profile', 'register', 'scenario-assets', 'scenarios',
        'settings', 'shop', 'signin', 'signout', 'signup', 'sso', 'static', 'teach', 'wardrobe',
    ];

    /**
     * Why $code cannot be a scenario code, or null when it can: 4 to 32 lowercase letters, digits
     * and single hyphens, starting with a letter, not one of the site's own addresses. Pass it
     * lowercased. The same rules as codeProblem() in packages/shared/src/site.ts.
     */
    public static function codeProblem(string $code): ?string
    {
        $length = strlen($code);
        if ($length < 4) {
            return 'A code needs at least 4 characters.';
        }
        if ($length > 32) {
            return 'A code can have at most 32 characters.';
        }
        if (! preg_match('/^[a-z0-9-]+$/', $code)) {
            return 'Use only lowercase letters, digits and hyphens.';
        }
        if (! preg_match('/^[a-z]/', $code)) {
            return 'A code starts with a letter.';
        }
        if (! preg_match('/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/', $code)) {
            return 'A hyphen goes between letters or digits: not at the end, and not two in a row.';
        }
        if (in_array($code, self::RESERVED_CODES, true)) {
            return "\u{201C}$code\u{201D} is one of the site\u{2019}s own addresses.";
        }

        return null;
    }

    /**
     * Give a scenario a new code. Players open it at /{new code} from now on, and the old code
     * stops working (a shortname that was the old code becomes the new one, since shortnames open
     * scenarios too). It applies at once, to the published version as well, so it is not a change
     * that waits for publishing and does not count as one.
     */
    public function changeCode(int $id, string $code): array
    {
        $code = strtolower(trim($code));
        if (($problem = self::codeProblem($code)) !== null) {
            throw new StoreError(422, $problem);
        }

        return $this->transaction(function () use ($id, $code) {
            $current = $this->one('SELECT `code`, `shortname` FROM `scenarios` WHERE `id` = ?', [$id]);
            if (! $current) {
                throw new StoreError(404, 'Scenario not found.');
            }
            if ($current['code'] === $code) {
                return $this->scenario($id);
            }
            // A shortname opens a scenario too, so a code spelled like another's shortname is refused as well.
            if ($this->one('SELECT `id` FROM `scenarios` WHERE (`code` = ? OR LOWER(`shortname`) = ?) AND `id` <> ?', [$code, $code, $id])) {
                throw new StoreError(409, 'Another scenario already uses that code. Try a different one.');
            }
            $set = ['code' => $code];
            if (strtolower((string) $current['shortname']) === $current['code']) {
                $set['shortname'] = $code;
            }
            // Not update(): that would mark the scenario as having unpublished changes.
            $this->run('UPDATE `scenarios` SET '.implode(', ', array_map(fn ($c) => "`$c` = ?", array_keys($set))).' WHERE `id` = ?', [...array_values($set), $id]);

            return $this->scenario($id);
        });
    }

    /** Create a scenario with one empty scene, so it can be opened and tested straight away. */
    public function createScenario(array $attrs, ?int $userId): array
    {
        $title = trim((string) ($attrs['title'] ?? ''));
        if ($title === '') {
            throw new StoreError(422, 'A scenario needs a title.');
        }
        // Start from a copy of the starship: the hub missions are launched from. The copy is the
        // scenario's own, so what happens aboard can differ from one scenario to the next.
        if (($attrs['template'] ?? '') === 'starship') {
            $id = $this->importRows(require self::HUB_TEMPLATE, $userId, ['title' => $title] + array_intersect_key($attrs, ['subtitle' => 1, 'description' => 1]));

            return $this->scenario($id);
        }
        if (($attrs['template'] ?? '') !== '') {
            throw new StoreError(422, 'There is no such template.');
        }
        $code = $this->generateCode();
        $now = self::now();

        return $this->transaction(function () use ($attrs, $title, $code, $userId, $now) {
            $row = $this->encode('scenarios', [
                'title' => $title,
                'shortname' => $code,
                'enable_save_session' => true,
                'require_login' => false,
                'allow_groups' => true,
                'default_language' => 'en-us',
                'settings' => ['spec_version' => 2, 'chat_mode' => 'emotes', 'move_speed' => 420],
            ] + array_intersect_key($attrs, ['subtitle' => 1, 'description' => 1]));
            $id = $this->insert('scenarios', $row + ['code' => $code, 'user_id' => $userId, 'created_at' => $now, 'updated_at' => $now]);
            $scene = $this->createRow($id, 'scenes', ['shortname' => 'scene-1', 'subtitle' => 'First scene']);
            $this->run('UPDATE `scenarios` SET `start_scene_id` = ? WHERE `id` = ?', [$scene['id'], $id]);

            return $this->scenario($id);
        });
    }

    public function updateScenario(int $id, array $attrs): array
    {
        $row = $this->encode('scenarios', $attrs);
        if (array_key_exists('title', $row) && trim((string) $row['title']) === '') {
            throw new StoreError(422, 'A scenario needs a title.');
        }
        if (isset($row['shortname']) && $this->one('SELECT `id` FROM `scenarios` WHERE (`shortname` = ? OR `code` = ?) AND `id` <> ?', [$row['shortname'], strtolower($row['shortname']), $id])) {
            // Also refused: a shortname spelled like another scenario's code, which could be mistaken for it.
            throw new StoreError(422, 'Another scenario already uses that shortname.');
        }
        if (isset($row['start_scene_id']) && $this->scenarioOf('scenes', (int) $row['start_scene_id']) !== $id) {
            throw new StoreError(422, 'The start scene must be a scene of this scenario.');
        }
        $this->update('scenarios', $id, $row);

        return $this->scenario($id);
    }

    public function deleteScenario(int $id): void
    {
        $this->transaction(function () use ($id) {
            $this->clearContent($id);
            foreach (['scenario_sessions', 'scenario_instances'] as $table) {
                $this->run("DELETE FROM `$table` WHERE `scenario_id` = ?", [$id]);
            }
            $this->run('DELETE FROM `scenarios` WHERE `id` = ?', [$id]);
        });
        $this->removeUploads($id);
    }

    /** Remove every file uploaded for a scenario, once its rows are gone. Uploads live in a folder named by its id. */
    private function removeUploads(int $scenarioId): void
    {
        $dir = $this->mediaDir === null ? null : $this->mediaDir.'/'.$scenarioId;
        if ($dir === null || ! is_dir($dir)) {
            return;
        }
        foreach (scandir($dir) ?: [] as $name) {
            if ($name !== '.' && $name !== '..' && is_file("$dir/$name")) {
                @unlink("$dir/$name");
            }
        }
        @rmdir($dir);
    }

    // ====================================================================== rows

    public function createRow(int $scenarioId, string $table, array $attrs): array
    {
        $this->assertContentTable($table);
        if (isset(self::SCHEMA[$table]['scenario_id'])) {
            $attrs['scenario_id'] = $scenarioId;
        }
        $attrs += $this->defaults($scenarioId, $table, $attrs);
        $row = $this->encode($table, $this->cleanCharacter($scenarioId, $table, $attrs));
        $this->assertValid($scenarioId, $table, $row, true);
        $now = self::now();
        $id = $this->insert($table, $row + ['created_at' => $now, 'updated_at' => $now]);
        $this->touch($scenarioId);

        return $this->decode($table, $this->one("SELECT * FROM `$table` WHERE `id` = ?", [$id]));
    }

    public function updateRow(int $scenarioId, string $table, int $rowId, array $attrs): array
    {
        $this->assertOwned($scenarioId, $table, $rowId);
        unset($attrs['scenario_id']);
        $row = $this->encode($table, $this->cleanCharacter($scenarioId, $table, $attrs));
        $this->assertValid($scenarioId, $table, $row, false);
        $this->update($table, $rowId, $row);
        $this->touch($scenarioId);

        return $this->decode($table, $this->one("SELECT * FROM `$table` WHERE `id` = ?", [$rowId]));
    }

    /** A character's animations, checked, each picture one of the scenario's (see NpcCharacter). */
    private function cleanCharacter(int $scenarioId, string $table, array $attrs): array
    {
        if ($table === 'characters' && is_array($attrs['settings'] ?? null)) {
            $attrs['settings'] = NpcCharacter::cleanSettings($attrs['settings'], fn (int $mediaId) => $this->scenarioOf('media', $mediaId) === $scenarioId);
        }

        return $attrs;
    }

    /** Delete a row and everything that only exists because of it. */
    public function deleteRow(int $scenarioId, string $table, int $rowId): void
    {
        $this->assertOwned($scenarioId, $table, $rowId);
        $this->transaction(function () use ($scenarioId, $table, $rowId) {
            switch ($table) {
                case 'scenes':
                    foreach ($this->ids('SELECT `id` FROM `events` WHERE `scene_id` = ?', [$rowId]) as $eventId) {
                        $this->deleteEvent($eventId);
                    }
                    $this->run('UPDATE `scenarios` SET `start_scene_id` = NULL WHERE `id` = ? AND `start_scene_id` = ?', [$scenarioId, $rowId]);
                    break;
                case 'events':
                    $this->deleteEvent($rowId);

                    return;
                case 'actions':
                    $this->run('DELETE FROM `conditions` WHERE `action_id` = ?', [$rowId]);
                    break;
                case 'items':
                    $this->run('DELETE FROM `conditions` WHERE `item_id` = ?', [$rowId]);
                    break;
                case 'characters':
                    $this->run('DELETE FROM `conditions` WHERE `character_id` = ?', [$rowId]);
                    break;
                case 'shop_items':
                    // Players who bought it lose it. Their stars are not refunded: withdraw an item by making it inactive instead.
                    $this->run('DELETE FROM `user_items` WHERE `shop_item_id` = ?', [$rowId]);
                    break;
                case 'media':
                    // Things that used the file keep existing, without it. The validator then points them out.
                    foreach (['actions', 'labels', 'items', 'characters', 'shop_items'] as $user) {
                        $this->run("UPDATE `$user` SET `media_id` = NULL WHERE `media_id` = ?", [$rowId]);
                    }
                    // A character loses the animations drawn from it; its other poses fill in for them.
                    foreach ($this->all('SELECT `id`, `settings` FROM `characters` WHERE `scenario_id` = ?', [$scenarioId]) as $c) {
                        $settings = json_decode((string) $c['settings'], true) ?: [];
                        $kept = array_filter((array) ($settings['animations'] ?? []), fn ($a) => (int) ($a['media_id'] ?? 0) !== $rowId);
                        $portrait = isset($settings['portrait_media_id']) && (int) $settings['portrait_media_id'] === $rowId;
                        if (count($kept) !== count((array) ($settings['animations'] ?? [])) || $portrait) {
                            if ($kept) {
                                $settings['animations'] = $kept;
                            } else {
                                unset($settings['animations']);
                            }
                            if ($portrait) {
                                unset($settings['portrait_media_id']);
                            }
                            $this->run('UPDATE `characters` SET `settings` = ? WHERE `id` = ?', [json_encode($settings ?: new \stdClass, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $c['id']]);
                        }
                    }
                    $this->removeUploadedFile($rowId);
                    break;
            }
            $this->run("DELETE FROM `$table` WHERE `id` = ?", [$rowId]);
        });
        $this->touch($scenarioId);
    }

    /**
     * Put rows back as they were before or after an edit: the editor's undo and redo. The steps are
     * applied in order, all or none:
     *   ['op' => 'insert', 'table' => ..., 'row' => [...]]   a row that was deleted, under its own id
     *   ['op' => 'update', 'table' => ..., 'id' => n, 'attrs' => [...]]
     *   ['op' => 'delete', 'table' => ..., 'id' => n]       only that row: the steps name everything that goes with it
     *   ['op' => 'scenario', 'attrs' => [...]]
     * Unlike deleteRow, a delete here leaves a media row's file on disk, so a redo can bring it back.
     * A row is inserted under its id only if no row has that id: if one has, nothing is changed (409).
     */
    public function restore(int $scenarioId, array $steps): void
    {
        $this->transaction(function () use ($scenarioId, $steps) {
            foreach ($steps as $step) {
                $op = is_array($step) ? ($step['op'] ?? '') : '';
                $table = (string) ($step['table'] ?? '');
                switch ($op) {
                    case 'insert':
                        $this->assertContentTable($table);
                        $attrs = is_array($step['row'] ?? null) ? $step['row'] : [];
                        $rowId = (int) ($attrs['id'] ?? 0);
                        if ($rowId <= 0) {
                            throw new StoreError(422, 'A row to put back needs its id.');
                        }
                        if ($this->one("SELECT `id` FROM `$table` WHERE `id` = ?", [$rowId])) {
                            throw new StoreError(409, 'That can no longer be undone: something else has taken its place.');
                        }
                        if (isset(self::SCHEMA[$table]['scenario_id'])) {
                            $attrs['scenario_id'] = $scenarioId;
                        }
                        $row = $this->encode($table, $this->cleanCharacter($scenarioId, $table, $attrs));
                        $this->assertValid($scenarioId, $table, $row, true);
                        $now = self::now();
                        $this->insert($table, ['id' => $rowId] + $row + ['created_at' => $now, 'updated_at' => $now]);
                        break;
                    case 'update':
                        $rowId = (int) ($step['id'] ?? 0);
                        $this->assertOwned($scenarioId, $table, $rowId);
                        $attrs = is_array($step['attrs'] ?? null) ? $step['attrs'] : [];
                        unset($attrs['scenario_id'], $attrs['id']);
                        $row = $this->encode($table, $this->cleanCharacter($scenarioId, $table, $attrs));
                        $this->assertValid($scenarioId, $table, $row, false);
                        $this->update($table, $rowId, $row);
                        break;
                    case 'delete':
                        $rowId = (int) ($step['id'] ?? 0);
                        $this->assertOwned($scenarioId, $table, $rowId);
                        if ($table === 'scenes') {
                            $this->run('UPDATE `scenarios` SET `start_scene_id` = NULL WHERE `id` = ? AND `start_scene_id` = ?', [$scenarioId, $rowId]);
                        }
                        $this->run("DELETE FROM `$table` WHERE `id` = ?", [$rowId]);
                        break;
                    case 'scenario':
                        $this->updateScenario($scenarioId, array_diff_key(is_array($step['attrs'] ?? null) ? $step['attrs'] : [], ['id' => 1, 'code' => 1]));
                        break;
                    default:
                        throw new StoreError(422, 'Unknown step.');
                }
            }
        });
        $this->touch($scenarioId);
    }

    /** Store an uploaded file and create its media row. The type is taken from the file's content, not its name. */
    public function addMediaFile(int $scenarioId, string $tmpPath, string $originalName): array
    {
        if ($this->mediaDir === null) {
            throw new StoreError(503, 'File uploads are not set up on this server.');
        }
        if (! is_file($tmpPath) || filesize($tmpPath) > self::MAX_UPLOAD_BYTES) {
            throw new StoreError(422, 'The file is missing or larger than 25 MB.');
        }
        [$type, $filepath, $url, $size] = $this->storeFile($scenarioId, $tmpPath);
        // An animated PNG says so, with its frames and timing: the game cuts it into frames.
        $apng = $type === 'image' ? Apng::info($this->mediaDir.'/'.$filepath) : null;

        return $this->createRow($scenarioId, 'media', [
            'type' => $type,
            'filename' => mb_substr(basename($originalName), 0, 200),
            'filepath' => $filepath,
            'url' => $url,
            'width' => $size ? $size[0] : null,
            'height' => $size ? $size[1] : null,
        ] + ($apng ? ['params' => ['apng' => $apng]] : []));
    }

    /**
     * Keep a copy of a file in the scenario's own folder of the media directory, under a random name
     * (or under `$name`, when that is 24 hexadecimal digits as such names are). What the file is comes
     * from its content, not its name. Returns [type, filepath, url, [width, height] or false].
     */
    private function storeFile(int $scenarioId, string $path, ?string $name = null): array
    {
        $mime = (new \finfo(FILEINFO_MIME_TYPE))->file($path) ?: '';
        if (! isset(self::UPLOADS[$mime])) {
            throw new StoreError(422, 'Only PNG, JPEG, WebP and GIF images, MP3, WAV and OGG audio, and MP4 and WebM video can be uploaded.');
        }
        [$type, $extension] = self::UPLOADS[$mime];
        $dir = $this->mediaDir.'/'.$scenarioId;
        if (! is_dir($dir) && ! mkdir($dir, 0775, true) && ! is_dir($dir)) {
            throw new RuntimeException("Cannot create $dir");
        }
        $filename = (preg_match('/^[a-f0-9]{24}$/', (string) $name) ? $name : bin2hex(random_bytes(12))).'.'.$extension;
        if (! (is_uploaded_file($path) ? move_uploaded_file($path, "$dir/$filename") : copy($path, "$dir/$filename"))) {
            throw new RuntimeException('Could not store the uploaded file.');
        }

        return [$type, "$scenarioId/$filename", rtrim($this->mediaUrl, '/')."/$scenarioId/$filename", $type === 'image' ? @getimagesize("$dir/$filename") : false];
    }

    /** Where an uploaded media file is on disk, or null if the row has no file of this store's, or it is gone. */
    public function mediaFile(array $media): ?string
    {
        $path = $media['filepath'] ?? null;
        if ($this->mediaDir === null || ! is_string($path) || ! preg_match('#^\d+/[a-f0-9]{24}\.[a-z0-9]{2,4}$#', $path) || ! is_file($this->mediaDir.'/'.$path)) {
            return null;
        }

        return $this->mediaDir.'/'.$path;
    }

    // ================================================================= importing

    /**
     * Create a new scenario from rows (shaped like bundle(), or as ScenarioDecompiler makes them).
     * Every row gets a new id, and everything that referred to a row by its old id is pointed at
     * the new one, so the copy is whole and shares nothing with where it came from.
     *
     * `$fileFor` is asked for each media row and returns the path of that row's file, or null;
     * a file it returns is copied into the new scenario's own folder. A row whose file is not
     * supplied keeps its address but is no longer treated as owning a file.
     *
     * The new scenario is a draft: it has a new code, belongs to `$userId`, and is not published.
     */
    public function importRows(array $rows, ?int $userId, array $overrides = [], ?callable $fileFor = null): int
    {
        if (empty($rows['scenes'])) {
            throw new StoreError(422, 'A scenario needs at least one scene.');
        }
        $created = null;
        try {
            return $this->transaction(function () use ($rows, $userId, $overrides, $fileFor, &$created) {
                $now = self::now();
                $code = $this->generateCode();
                $source = $overrides + $rows['scenario'];
                $settings = (array) ($source['settings'] ?? []);
                // Avatars are the platform's; a scenario brought in from elsewhere does not bring its own.
                unset($settings['avatar_media_ids'], $settings['avatar_portraits'], $settings['avatars']);
                $row = $this->encode('scenarios', ['shortname' => $code, 'start_scene_id' => null, 'intro_media_portrait_id' => null, 'intro_media_landscape_id' => null, 'settings' => $settings] + $source);
                if (trim((string) ($row['title'] ?? '')) === '') {
                    throw new StoreError(422, 'A scenario needs a title.');
                }
                $id = $created = $this->insert('scenarios', $row + ['code' => $code, 'user_id' => $userId, 'created_at' => $now, 'updated_at' => $now]);

                // First every row, with the columns that point at a parent following the parent's new id...
                $map = array_fill_keys(self::CONTENT, []);
                $new = [];
                foreach (self::CONTENT as $table) {
                    foreach ($rows[$table] ?? [] as $content) {
                        $content += self::IMPORT_DEFAULTS[$table];
                        if (isset(self::SCHEMA[$table]['scenario_id'])) {
                            $content['scenario_id'] = $id;
                        }
                        foreach ((self::PARENTS[$table] ?? []) + ['media_id' => 'media'] as $column => $parent) {
                            if (isset(self::SCHEMA[$table][$column]) && isset($content[$column])) {
                                $content[$column] = $map[$parent][(int) $content[$column]] ?? null;
                            }
                        }
                        if (isset(self::PARENTS[$table]) && ! array_filter(array_intersect_key($content, self::PARENTS[$table]), fn ($v) => $v !== null)) {
                            continue; // its parent is not in the file
                        }
                        if ($table === 'media') {
                            $file = $fileFor ? $fileFor($content) : null;
                            $content['filepath'] = null;
                            if ($file !== null && $this->mediaDir !== null) {
                                [$content['type'], $content['filepath'], $content['url'], $size] = $this->storeFile($id, $file);
                                if ($size) {
                                    [$content['width'], $content['height']] = [$size[0], $size[1]];
                                }
                            }
                        }
                        $encoded = $this->encode($table, $content);
                        $this->assertValid($id, $table, array_filter($encoded, fn ($v) => $v !== null), false);
                        $newId = $this->insert($table, $encoded + ['created_at' => $now, 'updated_at' => $now]);
                        if (isset($content['id'])) {
                            $map[$table][(int) $content['id']] = $newId;
                        }
                        $new[$table][$newId] = $content;
                    }
                }

                // ...then the references kept inside JSON (an action's target, a scene's layers and placements).
                foreach ($new as $table => $list) {
                    $json = array_keys(array_filter(self::SCHEMA[$table], fn ($type) => $type === 'json'));
                    foreach ($list as $newId => $content) {
                        $changed = [];
                        foreach ($json as $column) {
                            if (is_array($content[$column] ?? null)) {
                                $layers = $table === 'scenes' && in_array($column, ['background_media', 'foreground_media'], true);
                                $value = self::follow($content[$column], $map, $layers);
                                if ($value !== $content[$column]) {
                                    $changed[$column] = $value;
                                }
                            }
                        }
                        if ($changed) {
                            $this->update($table, $newId, $this->encode($table, $changed));
                        }
                    }
                }
                $this->update('scenarios', $id, $this->encode('scenarios', ['settings' => self::follow($settings, $map)]) + [
                    'start_scene_id' => $map['scenes'][(int) ($source['start_scene_id'] ?? 0)] ?? (array_values($map['scenes'])[0] ?? array_key_first($new['scenes'])),
                    'intro_media_portrait_id' => $map['media'][(int) ($source['intro_media_portrait_id'] ?? 0)] ?? null,
                    'intro_media_landscape_id' => $map['media'][(int) ($source['intro_media_landscape_id'] ?? 0)] ?? null,
                ]);

                return $id;
            });
        } catch (\Throwable $e) {
            // The rows were rolled back; the files copied for them have to go too.
            if ($created !== null) {
                $this->removeUploads($created);
            }
            throw $e;
        }
    }

    /**
     * A copy of a scenario, as a new draft belonging to `$userId`. `$rows` are the scenario's
     * rows: bundle() for a scenario the person can edit, or its published version decompiled.
     */
    public function duplicate(array $rows, ?int $userId, ?string $title = null): array
    {
        $title = trim((string) $title) ?: 'Copy of '.($rows['scenario']['title'] ?? 'scenario');
        $id = $this->importRows($rows, $userId, ['title' => mb_substr($title, 0, 255)], fn (array $media) => $this->mediaFile($media));

        return $this->scenario($id);
    }

    /**
     * Point every reference in a JSON value at the row's new id. One whose row was not imported
     * becomes null. `{{media:ID}}` in text (an infobox's content) is pointed at the new media too.
     */
    private static function follow(array $value, array $map, bool $layers = false): array
    {
        foreach ($value as $key => $inner) {
            $table = is_string($key) ? (self::REFERENCES[$key] ?? null) : null;
            // A scene's layers may name their media by `id`.
            if ($layers && $key === 'id') {
                $table = 'media';
            }
            if ($table !== null && (is_int($inner) || (is_string($inner) && ctype_digit($inner)))) {
                $value[$key] = $map[$table][(int) $inner] ?? null;
            } elseif (is_string($inner) && str_contains($inner, '{{')) {
                // Pictures, videos and sounds placed in text: an infobox's {{media:ID}}.
                $value[$key] = preg_replace_callback(
                    '/\{\{\s*media:(\d+)\s*\}\}/',
                    fn ($m) => isset($map['media'][(int) $m[1]]) ? '{{media:'.$map['media'][(int) $m[1]].'}}' : $m[0],
                    $inner,
                );
            } elseif (is_array($inner)) {
                $value[$key] = self::follow($inner, $map, $layers && is_int($key));
            }
        }

        return $value;
    }

    // =================================================================== seeding

    /**
     * Seed a scenario shipped with the application (a ZIP in database/seeders/scenarios, read by
     * ScenarioArchive::seed), unless it is already in the database. Once seeded it belongs to
     * whoever edits it: seeding again must not undo their work, so an existing scenario is only
     * replaced when `$reset` is true.
     *
     * Returns the scenario's id, or null when it was already there and was left alone.
     */
    public function seedScenario(array $rows, bool $reset = false, ?callable $fileFor = null): ?int
    {
        $id = (int) $rows['scenario']['id'];
        $code = strtolower((string) ($rows['scenario']['code'] ?? ''));
        $present = $this->one('SELECT `id` FROM `scenarios` WHERE `id` = ? OR `code` = ?', [$id, $code]);

        return $present && ! $reset ? null : $this->replaceScenario($rows, $fileFor);
    }

    /**
     * Replace a whole scenario with rows that carry their own ids, as ScenarioDecompiler makes
     * them from a scenario.json. The ids are kept, because they are what links to a scene and
     * players' saves refer to. Content that is in the database but not in the rows is removed;
     * the scenario's id, owner and players' saves are kept.
     *
     * `$fileFor` works as it does for importRows(). A file it returns is stored under the name the
     * row's filepath ends in, when that is a name this store gives, so seeding twice gives the
     * same document. A row whose file is not supplied keeps its address but owns no file.
     */
    public function replaceScenario(array $rows, ?callable $fileFor = null): int
    {
        $scenario = $rows['scenario'];
        $id = (int) $scenario['id'];
        if ($id < 1) {
            throw new StoreError(422, 'Seed data needs a scenario id.');
        }
        $before = $this->mediaDir === null ? [] : array_column($this->all('SELECT `filepath` FROM `media` WHERE `scenario_id` = ? AND `filepath` IS NOT NULL', [$id]), 'filepath');
        $stored = $kept = [];
        try {
            $this->transaction(function () use ($rows, $scenario, $id, $fileFor, &$stored, &$kept) {
                $now = self::now();
                $row = $this->encode('scenarios', $scenario);
                $code = strtolower((string) ($scenario['code'] ?? ''));
                if (($problem = self::codeProblem($code)) !== null) {
                    throw new StoreError(422, "Seed data needs a scenario code: $problem");
                }
                if ($this->one('SELECT `id` FROM `scenarios` WHERE `code` = ? AND `id` <> ?', [$code, $id])) {
                    throw new StoreError(409, "Another scenario already has the code \"$code\".");
                }
                $existing = $this->one('SELECT `code` FROM `scenarios` WHERE `id` = ?', [$id]);
                if ($existing && $existing['code'] !== $code) {
                    throw new StoreError(409, "Scenario $id is a different scenario (\"{$existing['code']}\"); it was not replaced.");
                }
                if ($existing) {
                    $this->clearContent($id);
                    $this->update('scenarios', $id, ['start_scene_id' => null] + $row + ['code' => $code]);
                } else {
                    $this->insert('scenarios', ['id' => $id, 'start_scene_id' => null, 'code' => $code, 'created_at' => $now, 'updated_at' => $now] + $row);
                }
                foreach (self::CONTENT as $table) {
                    // Seed rows name their own ids. One that is still taken belongs to another scenario.
                    $ids = array_map(fn ($content) => (int) $content['id'], $rows[$table] ?? []);
                    foreach (array_chunk($ids, 500) as $chunk) {
                        $taken = $this->ids("SELECT `id` FROM `$table` WHERE `id` IN (".implode(',', array_fill(0, count($chunk), '?')).')', $chunk);
                        if ($taken) {
                            throw new StoreError(409, "Cannot seed: $table ".implode(', ', array_slice($taken, 0, 5)).' already belong to another scenario.');
                        }
                    }
                    foreach ($rows[$table] ?? [] as $content) {
                        $content += self::IMPORT_DEFAULTS[$table];
                        if (isset(self::SCHEMA[$table]['scenario_id'])) {
                            $content['scenario_id'] = $id;
                        }
                        if ($table === 'media' && $fileFor !== null) {
                            $file = $fileFor($content);
                            $name = pathinfo((string) ($content['filepath'] ?? ''), PATHINFO_FILENAME);
                            $content['filepath'] = null;
                            if ($file !== null && $this->mediaDir !== null) {
                                [$content['type'], $content['filepath'], $content['url'], $size] = $this->storeFile($id, $file, $name);
                                $stored[] = $content['filepath'];
                                if ($size) {
                                    [$content['width'], $content['height']] = [$size[0], $size[1]];
                                }
                            }
                        }
                        if ($table === 'media' && is_string($content['filepath'] ?? null)) {
                            $kept[] = $content['filepath'];
                        }
                        $this->insert($table, ['id' => (int) $content['id'], 'created_at' => $now, 'updated_at' => $now] + $this->encode($table, $content));
                    }
                }
                // start_scene_id points at a scene, so it is set once the scenes exist.
                $this->run('UPDATE `scenarios` SET `start_scene_id` = ? WHERE `id` = ?', [$scenario['start_scene_id'] ?? null, $id]);
            });
        } catch (\Throwable $e) {
            // The rows were rolled back; files written for them that were not there before go too.
            foreach (array_diff($stored, $before) as $path) {
                @unlink($this->mediaDir.'/'.$path);
            }
            throw $e;
        }
        // The files of the content that was replaced, unless the new content uses them too.
        foreach (array_diff($before, $kept) as $path) {
            if (preg_match('#^\d+/[a-f0-9]{24}\.[a-z0-9]{2,4}$#', $path)) {
                @unlink($this->mediaDir.'/'.$path);
            }
        }

        return $id;
    }

    // =================================================================== helpers

    private function deleteEvent(int $eventId): void
    {
        $this->run('DELETE FROM `conditions` WHERE `event_id` = ? OR `action_id` IN (SELECT `id` FROM `actions` WHERE `event_id` = ?)', [$eventId, $eventId]);
        $this->run('DELETE FROM `actions` WHERE `event_id` = ?', [$eventId]);
        $this->run('DELETE FROM `labels` WHERE `event_id` = ?', [$eventId]);
        $this->run('DELETE FROM `events` WHERE `id` = ?', [$eventId]);
    }

    /** Remove every content row of a scenario, children first. Does not rely on the database cascading. */
    private function clearContent(int $scenarioId): void
    {
        foreach (array_reverse(self::CONTENT) as $table) {
            $ids = $this->ids("SELECT `id` FROM `$table` WHERE ".$this->inScenario($table), $this->scopeParams($table, $scenarioId));
            foreach (array_chunk($ids, 500) as $chunk) {
                $this->run("DELETE FROM `$table` WHERE `id` IN (".implode(',', array_fill(0, count($chunk), '?')).')', $chunk);
            }
        }
    }

    /** SQL condition selecting a table's rows that belong to one scenario. Takes scopeParams(). */
    private function inScenario(string $table): string
    {
        $scenes = '(SELECT `id` FROM `scenes` WHERE `scenario_id` = ?)';
        $events = "(SELECT `id` FROM `events` WHERE `scene_id` IN $scenes)";

        return match ($table) {
            'events' => "`scene_id` IN $scenes",
            'actions', 'labels' => "`event_id` IN $events",
            'conditions' => "(`event_id` IN $events OR `action_id` IN (SELECT `id` FROM `actions` WHERE `event_id` IN $events)"
                .' OR `item_id` IN (SELECT `id` FROM `items` WHERE `scenario_id` = ?) OR `character_id` IN (SELECT `id` FROM `characters` WHERE `scenario_id` = ?))',
            default => '`scenario_id` = ?',
        };
    }

    private function scopeParams(string $table, int $scenarioId): array
    {
        return array_fill(0, $table === 'conditions' ? 4 : 1, $scenarioId);
    }

    /** Which scenario a row belongs to, following its parents, or null if there is no such row. */
    public function scenarioOf(string $table, int $rowId): ?int
    {
        if ($table === 'scenarios') {
            return $this->one('SELECT `id` FROM `scenarios` WHERE `id` = ?', [$rowId]) ? $rowId : null;
        }
        $row = $this->one("SELECT * FROM `$table` WHERE `id` = ?", [$rowId]);
        if (! $row) {
            return null;
        }
        if (array_key_exists('scenario_id', $row)) {
            return (int) $row['scenario_id'];
        }
        foreach (self::PARENTS[$table] as $column => $parent) {
            if ($row[$column] !== null) {
                return $this->scenarioOf($parent, (int) $row[$column]);
            }
        }

        return null;
    }

    private function assertContentTable(string $table): void
    {
        if (! in_array($table, self::CONTENT, true)) {
            throw new StoreError(404, "Unknown table \"$table\".");
        }
    }

    private function assertOwned(int $scenarioId, string $table, int $rowId): void
    {
        $this->assertContentTable($table);
        if ($this->scenarioOf($table, $rowId) !== $scenarioId) {
            throw new StoreError(404, 'Not found.');
        }
    }

    /** Reject values the runtime could not use, and references that point outside the scenario. */
    private function assertValid(int $scenarioId, string $table, array $row, bool $creating): void
    {
        foreach (self::ENUMS as $key => $allowed) {
            [$t, $column] = explode('.', $key);
            if ($t === $table && array_key_exists($column, $row) && ! in_array($row[$column], $allowed, true)) {
                throw new StoreError(422, "\"{$row[$column]}\" is not a valid $column.");
            }
        }
        foreach ((self::PARENTS[$table] ?? []) + ['media_id' => 'media'] as $column => $parent) {
            if (isset($row[$column]) && isset(self::SCHEMA[$table][$column]) && $this->scenarioOf($parent, (int) $row[$column]) !== $scenarioId) {
                throw new StoreError(422, "$column does not refer to something in this scenario.");
            }
        }
        if ($creating && isset(self::PARENTS[$table])) {
            $owners = array_filter(array_keys(self::PARENTS[$table]), fn ($column) => isset($row[$column]));
            if (count($owners) !== 1) {
                throw new StoreError(422, 'Exactly one of '.implode(', ', array_keys(self::PARENTS[$table])).' is required.');
            }
        }
        if ($table === 'variables' && isset($row['variable_name'])) {
            if (! preg_match('/^[A-Za-z_][A-Za-z0-9_]{0,63}$/', $row['variable_name']) || str_starts_with($row['variable_name'], 'QBL') || str_starts_with($row['variable_name'], 'QL_')) {
                throw new StoreError(422, 'Variable names use letters, digits and underscores, and may not start with QBL or QL_ (those are the system\'s own).');
            }
        }
        $required = ['media' => 'type', 'variables' => 'variable_name', 'items' => 'name', 'characters' => 'name', 'events' => 'kind', 'actions' => 'type', 'labels' => 'type'];
        if ($creating && isset($required[$table]) && ($row[$required[$table]] ?? '') === '') {
            throw new StoreError(422, "{$required[$table]} is required.");
        }
    }

    /** Values a new row gets when the caller does not supply them. */
    private function defaults(int $scenarioId, string $table, array $attrs): array
    {
        $next = fn (string $sql, array $params) => (int) ($this->one($sql, $params)['n'] ?? 0) + 1;

        return match ($table) {
            'media' => ['scale_x' => 1, 'scale_y' => 1, 'priority' => 100],
            'shop_items' => ['name' => 'New item', 'kind' => 'wearable', 'slot' => 'head', 'price' => 10, 'active' => true, 'sequence' => 0],
            'variables' => ['default_value' => 0, 'scope' => 'player', 'persist' => true],
            'items' => ['unique' => false, 'physical' => false, 'blocking' => false, 'wearable' => false, 'vehicle' => false, 'settings' => []],
            'characters' => ['settings' => []],
            'scenes' => [
                'sequence' => $next('SELECT MAX(`sequence`) AS n FROM `scenes` WHERE `scenario_id` = ?', [$scenarioId]),
                'zoom' => 1, 'show_avatars' => true, 'is_intro_scene' => false, 'width' => 1920, 'height' => 1080,
                'background_media' => [], 'foreground_media' => [],
                'layout' => [
                    'walkable_areas' => [[['x' => 0, 'y' => 700], ['x' => 1920, 'y' => 700], ['x' => 1920, 'y' => 1080], ['x' => 0, 'y' => 1080]]],
                    'blocked_areas' => [], 'items' => [], 'characters' => [],
                    'spawn_points' => [['name' => 'default', 'position_x' => 960, 'position_y' => 900]],
                ],
            ],
            'events' => [
                'kind' => 'hotspot', 'overridable' => false, 'block_hotspots' => false, 'activate_by_trigger' => true, 'once' => false, 'audience' => 'player',
                'sequence' => $next('SELECT MAX(`sequence`) AS n FROM `events` WHERE `scene_id` = ? AND `kind` = ?', [$attrs['scene_id'] ?? 0, $attrs['kind'] ?? 'hotspot']),
            ] + (($attrs['kind'] ?? 'hotspot') === 'hotspot' ? ['radius' => 100] : []),
            'actions' => [
                'blocking' => true, 'params' => [],
                'sequence' => $next('SELECT MAX(`sequence`) AS n FROM `actions` WHERE `event_id` = ?', [$attrs['event_id'] ?? 0]),
            ],
            'conditions' => ['type' => 'variable', 'operator' => '=', 'operand' => 0],
            'labels' => ['scale_x' => 1, 'scale_y' => 1, 'position_x' => 0, 'position_y' => 0],
            default => [],
        };
    }

    private function removeUploadedFile(int $mediaId): void
    {
        $row = $this->one('SELECT `filepath` FROM `media` WHERE `id` = ?', [$mediaId]);
        $path = $row['filepath'] ?? null;
        // Only files this store wrote: "<scenario id>/<random name>.<ext>" inside the media directory.
        if ($this->mediaDir !== null && is_string($path) && preg_match('#^\d+/[a-f0-9]{24}\.[a-z0-9]{2,4}$#', $path)) {
            @unlink($this->mediaDir.'/'.$path);
        }
    }

    private function touch(int $scenarioId): void
    {
        $this->run('UPDATE `scenarios` SET `updated_at` = ? WHERE `id` = ?', [self::now(), $scenarioId]);
    }

    /** Keep only known columns and convert each value to the form it is stored in. */
    private function encode(string $table, array $attrs): array
    {
        $out = [];
        foreach (self::SCHEMA[$table] as $column => $type) {
            if (! array_key_exists($column, $attrs)) {
                continue;
            }
            $value = $attrs[$column];
            if ($value === null || ($value === '' && $type !== 'str' && $type !== 'json')) {
                $out[$column] = null;

                continue;
            }
            $out[$column] = match ($type) {
                'int' => (int) $value,
                'num' => (float) $value,
                'bool' => filter_var($value, FILTER_VALIDATE_BOOLEAN) ? 1 : 0,
                'json' => json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                default => (string) $value,
            };
        }

        return $out;
    }

    /** Convert a database row to typed values for JSON output. */
    public function decode(string $table, array $row): array
    {
        $out = ['id' => (int) $row['id']];
        foreach (['code', 'user_id', 'published_at', 'updated_at'] as $extra) {
            if (array_key_exists($extra, $row) && $table === 'scenarios') {
                $out[$extra] = $extra === 'user_id' && $row[$extra] !== null ? (int) $row[$extra] : $row[$extra];
            }
        }
        foreach (self::SCHEMA[$table] as $column => $type) {
            $value = $row[$column] ?? null;
            if ($value === null) {
                $out[$column] = null;

                continue;
            }
            $out[$column] = match ($type) {
                'int' => (int) $value,
                'num' => (float) $value == (int) $value ? (int) $value : (float) $value,
                'bool' => is_string($value) ? in_array(strtolower($value), ['1', 'true', 't'], true) : (bool) $value,
                'json' => is_string($value) ? json_decode($value, true) : $value,
                default => (string) $value,
            };
        }

        return $out;
    }

    private static function now(): string
    {
        return gmdate('Y-m-d H:i:s');
    }

    private function transaction(callable $fn): mixed
    {
        if ($this->pdo->inTransaction()) {
            return $fn();
        }
        $this->pdo->beginTransaction();
        try {
            $result = $fn();
            $this->pdo->commit();

            return $result;
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }

    private function run(string $sql, array $params = []): \PDOStatement
    {
        $statement = $this->pdo->prepare($sql);
        $statement->execute(array_values($params));

        return $statement;
    }

    private function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch(PDO::FETCH_ASSOC);

        return $row === false ? null : $row;
    }

    private function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll(PDO::FETCH_ASSOC);
    }

    /** @return int[] */
    private function ids(string $sql, array $params = []): array
    {
        return array_map('intval', $this->run($sql, $params)->fetchAll(PDO::FETCH_COLUMN));
    }

    private function insert(string $table, array $row): int
    {
        $columns = array_keys($row);
        $this->run(
            "INSERT INTO `$table` (".implode(', ', array_map(fn ($c) => "`$c`", $columns)).') VALUES ('.implode(', ', array_fill(0, count($columns), '?')).')',
            $row,
        );

        return isset($row['id']) ? (int) $row['id'] : (int) $this->pdo->lastInsertId();
    }

    private function update(string $table, int $id, array $row): void
    {
        if (! $row) {
            return;
        }
        $row['updated_at'] = self::now();
        $this->run("UPDATE `$table` SET ".implode(', ', array_map(fn ($c) => "`$c` = ?", array_keys($row))).' WHERE `id` = ?', [...array_values($row), $id]);
    }

    // ============================================================ dev and tests

    /**
     * Statements that create the tables in SQLite, for the dev server and the tests only.
     * In production the tables come from the Laravel migration, which must list the same columns.
     */
    public static function sqliteSchema(): array
    {
        $sql = [];
        foreach (self::SCHEMA as $table => $columns) {
            $defs = ['`id` INTEGER PRIMARY KEY AUTOINCREMENT'];
            foreach ($columns as $column => $type) {
                // Typed, so that 2 and "2" compare equal as they do in MariaDB.
                $defs[] = "`$column`".match ($type) { 'int', 'bool' => ' INTEGER', 'num' => ' NUMERIC', default => '' };
            }
            if ($table === 'scenarios') {
                array_push($defs, '`code` UNIQUE', '`user_id`', '`document`', '`published_at`');
            }
            array_push($defs, '`created_at`', '`updated_at`');
            $sql[] = "CREATE TABLE IF NOT EXISTS `$table` (".implode(', ', $defs).')';
        }
        $sql = array_merge($sql, ProgressStore::sqliteSchema());
        $sql = array_merge($sql, ClassStore::sqliteSchema(), Avatars::sqliteSchema());
        foreach (['scenario_sessions' => "`user_id` INTEGER, `group_key` DEFAULT 'public'", 'scenario_instances' => '`group_key`'] as $table => $key) {
            $sql[] = "CREATE TABLE IF NOT EXISTS `$table` (`id` INTEGER PRIMARY KEY AUTOINCREMENT, `scenario_id` INTEGER, $key, `data`, `created_at`, `updated_at`)";
        }

        return $sql;
    }
}
