<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Characters live in the world, not in scenes.
 *
 * - An event can belong to a character instead of a scene (kind `character`, `character_id` set,
 *   `scene_id` empty): one of the character's own events, which runs in whatever scene the player
 *   is in. So `scene_id` may be empty, and `character_id` is new.
 * - A character starts in a scene of its own (`settings.scene_id`, `position_x`, `position_y`,
 *   `facing`) instead of being placed in scenes (`scenes.layout.characters`). Its first placement,
 *   taking the scenes in order, becomes its start, and that placement's event what clicking it
 *   runs; the placements are then removed from the scenes. A character with a routine walked
 *   around on its own, and still does (`settings.roams`); its routine is dropped.
 *
 * Guarded, so a database that already has the column is left as it is.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('events', 'character_id')) {
            Schema::table('events', function (Blueprint $table) {
                $table->foreignId('scene_id')->nullable()->change();
                $table->foreignId('character_id')->nullable()->after('scene_id')->constrained()->cascadeOnDelete();
            });
        }

        DB::transaction(function () {
            $scenes = DB::table('scenes')->orderBy('scenario_id')->orderBy('sequence')->orderBy('id')->get(['id', 'scenario_id', 'layout']);
            $first = [];
            foreach ($scenes as $scene) {
                $layout = json_decode((string) $scene->layout, true) ?: [];
                $placements = is_array($layout['characters'] ?? null) ? $layout['characters'] : [];
                if (! $placements) {
                    continue;
                }
                foreach ($placements as $p) {
                    $id = (int) ($p['character_id'] ?? 0);
                    if ($id > 0 && ! isset($first[$id])) {
                        $first[$id] = ['scene_id' => (int) $scene->id] + $p;
                    }
                }
                unset($layout['characters']);
                DB::table('scenes')->where('id', $scene->id)->update(['layout' => json_encode($layout ?: new stdClass, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
            }

            foreach (DB::table('characters')->get(['id', 'settings']) as $c) {
                $settings = json_decode((string) $c->settings, true) ?: [];
                $before = $settings;
                $p = $first[(int) $c->id] ?? null;
                if ($p && ! isset($settings['scene_id'])) {
                    $settings['scene_id'] = $p['scene_id'];
                    foreach (['position_x', 'position_y', 'facing'] as $key) {
                        if (isset($p[$key])) {
                            $settings[$key] = $p[$key];
                        }
                    }
                    if (! isset($settings['event_id']) && isset($p['event_id'])) {
                        $settings['event_id'] = (int) $p['event_id'];
                    }
                }
                if (array_key_exists('routine', $settings)) {
                    if (! empty($settings['routine']['steps'])) {
                        $settings['roams'] = true;
                    }
                    unset($settings['routine']);
                }
                if ($settings !== $before) {
                    DB::table('characters')->where('id', $c->id)->update(['settings' => json_encode($settings ?: new stdClass, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
                }
            }
        });
    }

    public function down(): void
    {
        // The placements are not put back: characters keep the start they were given.
    }
};
