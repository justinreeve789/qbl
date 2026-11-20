<?php

namespace App\Qbl;

/**
 * Turns the rows of the QBL tables into the scenario JSON document the game
 * plays (the structure in docs/src/content/docs/developers).
 *
 * It is deliberately plain PHP with no framework calls: it takes arrays and
 * returns an array. Values may arrive straight from a database driver, so
 * numbers and booleans may be strings and JSON columns may be undecoded text.
 */
class ScenarioCompiler
{
    private const EVENT_KEYS = [
        'start' => 'start_events',
        'end' => 'end_events',
        'hotspot' => 'hotspots',
        'indirect' => 'indirect_events',
    ];

    /**
     * @param  array{scenario: array, media?: array, variables?: array, items?: array, characters?: array,
     *               scenes?: array, events?: array, actions?: array, conditions?: array, labels?: array}  $rows
     */
    public static function compile(array $rows): array
    {
        $s = $rows['scenario'];
        $id = self::int($s['id']);

        $conditions = ['event_id' => [], 'action_id' => [], 'item_id' => [], 'character_id' => []];
        foreach (self::sorted($rows['conditions'] ?? [], 'id') as $c) {
            foreach (array_keys($conditions) as $owner) {
                if (($c[$owner] ?? null) !== null) {
                    $conditions[$owner][self::int($c[$owner])][] = self::strip([
                        'id' => self::int($c['id']),
                        $owner => self::int($c[$owner]),
                        'type' => $c['type'] ?? 'variable',
                        'variable' => $c['variable'],
                        'operator' => $c['operator'],
                        'operand' => self::scalar($c['operand']),
                    ]);
                }
            }
        }

        $actions = [];
        foreach (self::sorted($rows['actions'] ?? [], 'sequence') as $a) {
            $eventId = self::int($a['event_id']);
            $actionId = self::int($a['id']);
            // Type-specific attributes live in params; they sit beside the common ones in the document.
            $actions[$eventId][] = self::strip(array_merge(self::json($a['params'] ?? null), [
                'id' => $actionId,
                'event_id' => $eventId,
                'type' => $a['type'],
                'sequence' => self::int($a['sequence']),
                'blocking' => self::bool($a['blocking'] ?? true),
                'media_id' => self::intOrNull($a['media_id'] ?? null),
                'conditions' => $conditions['action_id'][$actionId] ?? null,
            ]));
        }

        $labels = [];
        foreach (self::sorted($rows['labels'] ?? [], 'id') as $l) {
            $labels[self::int($l['event_id'])][] = self::strip(array_merge(self::json($l['params'] ?? null), [
                'id' => self::int($l['id']),
                'event_id' => self::int($l['event_id']),
                'type' => $l['type'],
                'position_x' => self::num($l['position_x']),
                'position_y' => self::num($l['position_y']),
                'scale_x' => self::num($l['scale_x'] ?? 1),
                'scale_y' => self::num($l['scale_y'] ?? 1),
                'text' => $l['text'] ?? null,
                'media' => self::intOrNull($l['media_id'] ?? null),
            ]));
        }

        $events = [];
        foreach (self::sorted($rows['events'] ?? [], 'sequence') as $e) {
            $eventId = self::int($e['id']);
            $event = [
                'id' => $eventId,
                'shortname' => $e['shortname'] ?? null,
                'scene_id' => self::int($e['scene_id']),
                'overridable' => self::bool($e['overridable'] ?? false),
                'block_hotspots' => self::bool($e['block_hotspots'] ?? false),
                'conditions' => $conditions['event_id'][$eventId] ?? [],
            ];
            // Shown to every player in the scene, not only the one who set it off.
            if (($e['audience'] ?? 'player') === 'scene') {
                $event['audience'] = 'scene';
            }
            if ($e['kind'] === 'hotspot') {
                // Null coordinates are meaningful ("the entire axis"), so they are kept.
                $event['position_x'] = self::numOrNull($e['position_x'] ?? null);
                $event['position_y'] = self::numOrNull($e['position_y'] ?? null);
                $event['radius'] = self::numOrNull($e['radius'] ?? null) ?? -1;
                $event['activate_by_trigger'] = self::bool($e['activate_by_trigger'] ?? false);
                if (self::bool($e['once'] ?? false)) {
                    $event['once'] = true;
                }
                // Hotspots that only appear when the avatar is near.
                foreach (['reveal_radius', 'reveal_full_radius'] as $key) {
                    if (self::numOrNull($e[$key] ?? null) !== null) {
                        $event[$key] = self::numOrNull($e[$key]);
                    }
                }
                $event['labels'] = $labels[$eventId] ?? [];
            }
            $event['actions'] = $actions[$eventId] ?? [];
            if ($event['shortname'] === null) {
                unset($event['shortname']);
            }
            $events[self::int($e['scene_id'])][self::EVENT_KEYS[$e['kind']]][] = $event;
        }

        $scenes = [];
        foreach (self::sorted($rows['scenes'] ?? [], 'sequence') as $sc) {
            $sceneId = self::int($sc['id']);
            $layout = self::json($sc['layout'] ?? null);
            $scenes[] = self::strip([
                'id' => $sceneId,
                'shortname' => $sc['shortname'] ?? null,
                'scenario_id' => $id,
                'sequence' => self::int($sc['sequence']),
                'group_id' => self::intOrNull($sc['group_id'] ?? null),
                'subtitle' => $sc['subtitle'] ?? null,
                'description' => $sc['description'] ?? null,
                'is_intro_scene' => self::bool($sc['is_intro_scene'] ?? false),
                'zoom' => self::num($sc['zoom'] ?? 1),
                'show_avatars' => self::bool($sc['show_avatars'] ?? true),
                'width' => self::intOrNull($sc['width'] ?? null),
                'height' => self::intOrNull($sc['height'] ?? null),
                'background_media' => self::json($sc['background_media'] ?? null),
                'foreground_media' => self::json($sc['foreground_media'] ?? null),
                'walkable_areas' => $layout['walkable_areas'] ?? [],
                'blocked_areas' => $layout['blocked_areas'] ?? [],
                'spawn_points' => $layout['spawn_points'] ?? [],
                'scale_areas' => $layout['scale_areas'] ?? [],
                'shadow_spots' => ($layout['shadow_spots'] ?? []) ?: null,
                // Whether the scene shows a player only their own team. Absent: as its group says.
                'team_only' => array_key_exists('team_only', self::json($sc['params'] ?? null)) && self::json($sc['params'] ?? null)['team_only'] !== null ? self::bool(self::json($sc['params'] ?? null)['team_only']) : null,
                'items' => $layout['items'] ?? [],
                'characters' => $layout['characters'] ?? [],
                // The scene's own background music, when it has one, is kept in params.
                'music_media_id' => self::intOrNull(self::json($sc['params'] ?? null)['music_media_id'] ?? null),
                'music_volume' => self::numOrNull(self::json($sc['params'] ?? null)['music_volume'] ?? null),
                'params' => array_diff_key(self::json($sc['params'] ?? null), ['music_media_id' => 1, 'music_volume' => 1, 'team_only' => 1]) ?: null,
                'start_events' => $events[$sceneId]['start_events'] ?? [],
                'end_events' => $events[$sceneId]['end_events'] ?? [],
                'hotspots' => $events[$sceneId]['hotspots'] ?? [],
                'indirect_events' => $events[$sceneId]['indirect_events'] ?? [],
            ]);
        }

        $assets = [];
        foreach (self::sorted($rows['media'] ?? [], 'priority') as $m) {
            // A sprite sheet's grid and its named animations are kept in params and belong to the media itself.
            $params = self::json($m['params'] ?? null);
            $assets[] = self::strip([
                'id' => self::int($m['id']),
                'scenario_id' => $id,
                'type' => $m['type'],
                'filename' => $m['filename'] ?? null,
                'filepath' => $m['filepath'] ?? null,
                'url' => $m['url'] ?? null,
                'scale_x' => self::num($m['scale_x'] ?? 1),
                'scale_y' => self::num($m['scale_y'] ?? 1),
                'width' => self::intOrNull($m['width'] ?? null),
                'height' => self::intOrNull($m['height'] ?? null),
                'priority' => self::int($m['priority'] ?? 100),
                'sheet' => is_array($params['sheet'] ?? null) ? $params['sheet'] : null,
                'animations' => is_array($params['sheet'] ?? null) && ! empty($params['animations']) ? array_values($params['animations']) : null,
                'apng' => is_array($params['apng'] ?? null) ? $params['apng'] : null,
                'params' => array_diff_key($params, ['sheet' => 1, 'animations' => 1, 'apng' => 1]) ?: null,
            ]);
        }

        $variables = [];
        foreach (self::sorted($rows['variables'] ?? [], 'id') as $v) {
            $variables[] = [
                'id' => self::int($v['id']),
                'scenario_id' => $id,
                'variable_name' => $v['variable_name'],
                'default_value' => self::scalar($v['default_value']),
                'scope' => $v['scope'] ?? 'player',
                'persist' => self::bool($v['persist'] ?? true),
            ];
        }

        $items = [];
        foreach (self::sorted($rows['items'] ?? [], 'id') as $i) {
            $itemId = self::int($i['id']);
            $items[] = self::strip(array_merge(self::json($i['settings'] ?? null), [
                'id' => $itemId,
                'scenario_id' => $id,
                'name' => $i['name'],
                'unique' => self::bool($i['unique'] ?? false),
                'physical' => self::bool($i['physical'] ?? false),
                'blocking' => self::bool($i['blocking'] ?? false),
                'wearable' => self::bool($i['wearable'] ?? false),
                'vehicle' => self::bool($i['vehicle'] ?? false),
                'media_id' => self::intOrNull($i['media_id'] ?? null),
                'conditions' => $conditions['item_id'][$itemId] ?? null,
            ]));
        }

        $characters = [];
        foreach (self::sorted($rows['characters'] ?? [], 'id') as $c) {
            $characterId = self::int($c['id']);
            $characters[] = self::strip(array_merge(self::json($c['settings'] ?? null), [
                'id' => $characterId,
                'scenario_id' => $id,
                'name' => $c['name'],
                'media_id' => self::intOrNull($c['media_id'] ?? null),
                'conditions' => $conditions['character_id'][$characterId] ?? null,
            ]));
        }

        // jump_targets and assets are generated, as the Scenarios page describes.
        $jumpTargets = [];
        foreach ($scenes as $scene) {
            $targets = [];
            foreach (self::EVENT_KEYS as $key) {
                foreach ($scene[$key] as $event) {
                    foreach ($event['actions'] as $action) {
                        self::collectJumps($action, $targets);
                    }
                }
            }
            unset($targets[$scene['id']]);
            $jumpTargets[(string) $scene['id']] = array_keys($targets);
        }

        return self::strip(array_merge(self::json($s['settings'] ?? null), [
            'id' => $id,
            'code' => $s['code'] ?? null,
            'shortname' => $s['shortname'],
            'title' => $s['title'],
            'subtitle' => $s['subtitle'] ?? null,
            'description' => $s['description'] ?? null,
            'user_id' => self::intOrNull($s['user_id'] ?? null),
            'start_scene_id' => self::int($s['start_scene_id']),
            'enable_save_session' => self::bool($s['enable_save_session'] ?? true),
            'require_login' => self::bool($s['require_login'] ?? true),
            'allow_groups' => self::bool($s['allow_groups'] ?? false),
            'max_players' => self::intOrNull($s['max_players'] ?? null),
            'default_language' => $s['default_language'] ?? 'en-us',
            'intro_media_portrait_id' => self::intOrNull($s['intro_media_portrait_id'] ?? null),
            'intro_media_landscape_id' => self::intOrNull($s['intro_media_landscape_id'] ?? null),
            'global_variables' => $variables,
            'jump_targets' => (object) $jumpTargets,
            'assets' => $assets,
            // Mission-specific marketplace items. Inactive ones are not sold.
            'shop_items' => array_values(array_map([ProgressStore::class, 'item'], array_filter($rows['shop_items'] ?? [], fn ($i) => self::bool($i['active'] ?? true)))) ?: null,
            'items' => $items,
            'characters' => $characters,
            'scenes' => $scenes,
        ]));
    }

    private static function collectJumps(array $action, array &$targets): void
    {
        if (strtolower(str_replace([' ', '-'], '_', (string) $action['type'])) === 'jump' && isset($action['scene_id'])) {
            $targets[(int) $action['scene_id']] = true;
        }
        foreach ($action['call_to_actions'] ?? [] as $cta) {
            if (is_array($cta['action'] ?? null)) {
                self::collectJumps($cta['action'], $targets);
            }
        }
        // A conversation's choices can jump too.
        foreach ((array) ($action['lines'] ?? []) as $line) {
            foreach ((array) ($line['choices'] ?? []) as $choice) {
                foreach ((array) ($choice['actions'] ?? []) as $inner) {
                    if (is_array($inner) && isset($inner['type'])) {
                        self::collectJumps($inner, $targets);
                    }
                }
            }
        }
    }

    // ------------------------------------------------------------ helpers

    /** Order rows by a numeric column, then by id, so output is stable. */
    private static function sorted(array $rows, string $column): array
    {
        usort($rows, fn ($a, $b) => [(float) ($a[$column] ?? 0), (int) $a['id']] <=> [(float) ($b[$column] ?? 0), (int) $b['id']]);

        return $rows;
    }

    /** Drop nulls so optional attributes are simply absent. */
    private static function strip(array $data): array
    {
        return array_filter($data, fn ($v) => $v !== null);
    }

    private static function int(mixed $v): int
    {
        return (int) $v;
    }

    private static function intOrNull(mixed $v): ?int
    {
        return $v === null || $v === '' ? null : (int) $v;
    }

    private static function num(mixed $v): int|float
    {
        $f = (float) $v;

        return floor($f) == $f && abs($f) < PHP_INT_MAX ? (int) $f : $f;
    }

    private static function numOrNull(mixed $v): int|float|null
    {
        return $v === null || $v === '' ? null : self::num($v);
    }

    private static function bool(mixed $v): bool
    {
        return is_string($v) ? in_array(strtolower($v), ['1', 'true', 't', 'yes'], true) : (bool) $v;
    }

    /** A JSON column: already an array, or text to decode. */
    private static function json(mixed $v): array
    {
        if (is_array($v)) {
            return $v;
        }
        if (is_string($v) && $v !== '') {
            $decoded = json_decode($v, true);

            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    /** A JSON column holding one string or number (a variable's value or a condition's operand). */
    private static function scalar(mixed $v): string|int|float
    {
        if (is_string($v)) {
            $decoded = json_decode($v, true);
            if (json_last_error() === JSON_ERROR_NONE && (is_string($decoded) || is_int($decoded) || is_float($decoded))) {
                return $decoded;
            }
        }

        return is_int($v) || is_float($v) ? $v : (string) $v;
    }
}
