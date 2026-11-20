<?php

namespace App\Qbl;

/**
 * The reverse of ScenarioCompiler: turns a scenario document (the JSON the game plays, as the
 * documentation describes it) back into rows of the tables, so a scenario can be created from
 * a file. Compiling the result gives the same document again, apart from ids.
 *
 * Ids in the document are kept on the rows: they are what the document's parts use to refer to
 * each other, and ScenarioStore::importRows gives every row a new id and follows the references.
 * Anything without an id gets one that is unused in the document.
 */
class ScenarioDecompiler
{
    private const KINDS = ['start_events' => 'start', 'end_events' => 'end', 'hotspots' => 'hotspot', 'indirect_events' => 'indirect'];

    /** Top-level keys that are columns of `scenarios`, or are generated, and so do not belong in its settings. */
    private const NOT_SETTINGS = [
        'id', 'code', 'shortname', 'title', 'subtitle', 'description', 'user_id', 'start_scene_id', 'enable_save_session', 'require_login',
        'allow_groups', 'max_players', 'default_language', 'intro_media_portrait_id', 'intro_media_landscape_id', 'global_variables',
        'jump_targets', 'assets', 'shop_items', 'items', 'characters', 'scenes', 'session', 'instance',
    ];

    private int $next = 0;

    /** @return array{scenario: array, media: array, shop_items: array, variables: array, items: array, characters: array, scenes: array, events: array, actions: array, conditions: array, labels: array} */
    public static function rows(array $document): array
    {
        if (! is_array($document['scenes'] ?? null) || ! $document['scenes']) {
            throw new StoreError(422, 'That is not a scenario: it has no scenes.');
        }

        return (new self(self::highestId($document)))->run($document);
    }

    private function __construct(int $highest)
    {
        $this->next = $highest;
    }

    private function run(array $d): array
    {
        $rows = array_fill_keys(ScenarioStore::CONTENT, []);

        // The platform's avatars are added to every document as it is served; they are not the scenario's.
        $own = fn ($id) => (int) $id < Avatars::FLOOR;
        foreach ($d['assets'] ?? [] as $m) {
            if (! is_array($m) || ! $own($m['id'] ?? 0)) {
                continue;
            }
            $params = (array) ($m['params'] ?? []);
            foreach (['sheet', 'animations', 'apng', 'speech'] as $key) {
                if (isset($m[$key])) {
                    $params[$key] = $m[$key];
                }
            }
            $rows['media'][] = [
                'id' => $this->id($m), 'type' => $m['type'] ?? 'image', 'filename' => $m['filename'] ?? null, 'filepath' => is_string($m['filepath'] ?? null) ? $m['filepath'] : null,
                'url' => $m['url'] ?? null, 'scale_x' => $m['scale_x'] ?? 1, 'scale_y' => $m['scale_y'] ?? 1, 'width' => $m['width'] ?? null, 'height' => $m['height'] ?? null,
                'priority' => $m['priority'] ?? 100, 'params' => $params ?: null,
            ];
        }

        foreach (array_values($d['shop_items'] ?? []) as $index => $i) {
            $rows['shop_items'][] = [
                'id' => $this->id($i), 'scenario_id' => $d['id'] ?? null, 'name' => $i['name'] ?? 'Item', 'description' => $i['description'] ?? null, 'kind' => $i['kind'] ?? 'wearable', 'slot' => $i['slot'] ?? null,
                'price' => $i['price'] ?? 0, 'media_id' => $i['media_id'] ?? null, 'image_url' => $i['image_url'] ?? null, 'active' => true, 'sequence' => $index + 1,
                'settings' => array_diff_key($i, array_flip(['id', 'scenario_id', 'name', 'description', 'kind', 'slot', 'price', 'media_id', 'image_url'])),
            ];
        }

        foreach ($d['global_variables'] ?? [] as $v) {
            $rows['variables'][] = [
                'id' => $this->id($v), 'variable_name' => $v['variable_name'] ?? $v['name'] ?? '', 'default_value' => $v['default_value'] ?? 0,
                'scope' => $v['scope'] ?? 'player', 'persist' => $v['persist'] ?? true,
            ];
        }

        foreach ($d['items'] ?? [] as $i) {
            $id = $this->id($i);
            $columns = ['name', 'unique', 'physical', 'blocking', 'wearable', 'vehicle', 'media_id'];
            $rows['items'][] = ['id' => $id, 'name' => $i['name'] ?? 'Item', 'settings' => array_diff_key($i, array_flip([...$columns, 'id', 'scenario_id', 'conditions']))]
                + array_intersect_key($i, array_flip($columns));
            $this->conditions($rows, $i['conditions'] ?? [], 'item_id', $id);
        }

        foreach ($d['characters'] ?? [] as $c) {
            $id = $this->id($c);
            $rows['characters'][] = ['id' => $id, 'name' => $c['name'] ?? 'Character', 'media_id' => $c['media_id'] ?? null, 'settings' => array_diff_key($c, array_flip(['id', 'scenario_id', 'name', 'media_id', 'conditions']))];
            $this->conditions($rows, $c['conditions'] ?? [], 'character_id', $id);
        }

        foreach (array_values($d['scenes']) as $index => $s) {
            $sceneId = $this->id($s);
            $params = (array) ($s['params'] ?? []);
            foreach (['music_media_id', 'music_volume', 'team_only'] as $key) {
                if (isset($s[$key])) {
                    $params[$key] = $s[$key];
                }
            }
            $rows['scenes'][] = [
                'id' => $sceneId, 'shortname' => $s['shortname'] ?? null, 'sequence' => $s['sequence'] ?? $index + 1, 'group_id' => $s['group_id'] ?? null,
                'subtitle' => $s['subtitle'] ?? null, 'description' => $s['description'] ?? null, 'is_intro_scene' => $s['is_intro_scene'] ?? false, 'zoom' => $s['zoom'] ?? 1,
                'show_avatars' => $s['show_avatars'] ?? true, 'width' => $s['width'] ?? null, 'height' => $s['height'] ?? null,
                'background_media' => $s['background_media'] ?? [], 'foreground_media' => $s['foreground_media'] ?? [],
                'layout' => array_filter([
                    'walkable_areas' => $s['walkable_areas'] ?? [], 'blocked_areas' => $s['blocked_areas'] ?? [], 'spawn_points' => $s['spawn_points'] ?? [],
                    'scale_areas' => $s['scale_areas'] ?? null, 'shadow_spots' => $s['shadow_spots'] ?? null, 'items' => $s['items'] ?? [], 'characters' => $s['characters'] ?? [],
                    'physics' => is_array($s['physics'] ?? null) ? $s['physics'] : null,
                ], fn ($v) => $v !== null),
                'params' => $params ?: null,
            ];
            foreach (self::KINDS as $list => $kind) {
                foreach (array_values($s[$list] ?? []) as $sequence => $e) {
                    $this->event($rows, $e, $sceneId, $kind, $sequence + 1);
                }
            }
        }

        $settings = array_diff_key($d, array_flip(self::NOT_SETTINGS));
        // Avatars are the platform's. Lists a document carries are dropped, whether they came from there or from an older scenario.
        unset($settings['avatar_media_ids'], $settings['avatar_portraits'], $settings['avatars']);
        $rows['scenario'] = [
            'id' => (int) ($d['id'] ?? 0), 'code' => $d['code'] ?? null, 'shortname' => $d['shortname'] ?? null, 'title' => $d['title'] ?? 'Imported scenario',
            'subtitle' => $d['subtitle'] ?? null, 'description' => $d['description'] ?? null, 'start_scene_id' => $d['start_scene_id'] ?? $rows['scenes'][0]['id'],
            'enable_save_session' => $d['enable_save_session'] ?? true, 'require_login' => $d['require_login'] ?? false, 'allow_groups' => $d['allow_groups'] ?? true,
            'max_players' => $d['max_players'] ?? null, 'default_language' => $d['default_language'] ?? 'en-us',
            'intro_media_portrait_id' => $d['intro_media_portrait_id'] ?? null, 'intro_media_landscape_id' => $d['intro_media_landscape_id'] ?? null,
            'settings' => $settings + ['spec_version' => 2],
        ];

        return $rows;
    }

    private function event(array &$rows, array $e, int $sceneId, string $kind, int $sequence): void
    {
        $eventId = $this->id($e);
        $row = [
            'id' => $eventId, 'scene_id' => $sceneId, 'kind' => $kind, 'shortname' => $e['shortname'] ?? null, 'sequence' => $sequence,
            'overridable' => $e['overridable'] ?? false, 'block_hotspots' => $e['block_hotspots'] ?? false, 'audience' => ($e['audience'] ?? 'player') === 'scene' ? 'scene' : 'player',
            'activate_by_trigger' => $e['activate_by_trigger'] ?? false, 'once' => $e['once'] ?? false,
        ];
        if ($kind === 'hotspot') {
            $row += [
                'position_x' => $e['position_x'] ?? null, 'position_y' => $e['position_y'] ?? null, 'radius' => $e['radius'] ?? null,
                'reveal_radius' => $e['reveal_radius'] ?? null, 'reveal_full_radius' => $e['reveal_full_radius'] ?? null,
            ];
        }
        $rows['events'][] = $row;
        $this->conditions($rows, $e['conditions'] ?? [], 'event_id', $eventId);

        foreach ($e['labels'] ?? [] as $l) {
            $media = $l['media'] ?? $l['media_id'] ?? null;
            $rows['labels'][] = [
                'id' => $this->id($l), 'event_id' => $eventId, 'type' => $l['type'] ?? 'text', 'position_x' => $l['position_x'] ?? 0, 'position_y' => $l['position_y'] ?? 0,
                'scale_x' => $l['scale_x'] ?? 1, 'scale_y' => $l['scale_y'] ?? 1, 'text' => $l['text'] ?? null, 'media_id' => is_array($media) ? ($media['id'] ?? null) : $media,
                'params' => array_diff_key($l, array_flip(['id', 'event_id', 'type', 'position_x', 'position_y', 'scale_x', 'scale_y', 'text', 'media', 'media_id'])) ?: null,
            ];
        }

        foreach (array_values($e['actions'] ?? []) as $index => $a) {
            $actionId = $this->id($a);
            $rows['actions'][] = [
                'id' => $actionId, 'event_id' => $eventId, 'type' => strtolower(str_replace([' ', '-'], '_', (string) ($a['type'] ?? ''))), 'sequence' => $a['sequence'] ?? $index + 1,
                'blocking' => $a['blocking'] ?? true, 'media_id' => $a['media_id'] ?? null,
                'params' => array_diff_key($a, array_flip(['id', 'event_id', 'type', 'sequence', 'blocking', 'media_id', 'conditions'])),
            ];
            $this->conditions($rows, $a['conditions'] ?? [], 'action_id', $actionId);
        }
    }

    private function conditions(array &$rows, mixed $conditions, string $owner, int $ownerId): void
    {
        foreach (is_array($conditions) ? $conditions : [] as $c) {
            $rows['conditions'][] = [
                'id' => $this->id($c), $owner => $ownerId, 'type' => $c['type'] ?? 'variable', 'variable' => $c['variable'] ?? '',
                'operator' => $c['operator'] ?? '=', 'operand' => $c['operand'] ?? 0,
            ];
        }
    }

    /** The row's own id, or a new one that nothing in the document uses. */
    private function id(array $row): int
    {
        return isset($row['id']) && is_numeric($row['id']) ? (int) $row['id'] : ++$this->next;
    }

    private static function highestId(mixed $value): int
    {
        $highest = 0;
        if (is_array($value)) {
            foreach ($value as $key => $inner) {
                $highest = max($highest, $key === 'id' && is_numeric($inner) ? (int) $inner : self::highestId($inner));
            }
        }

        return $highest;
    }
}
