<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Characters live in the world: the migration 2026_11_22_000000 gives events a character and reads
 * the scenes' old placements into the characters' own starts. Checked on the real migrations.
 */
class CharactersInTheWorldTest extends TestCase
{
    use RefreshDatabase;

    public function test_placements_become_starts_and_routines_become_walking_around(): void
    {
        $now = now();
        $scenario = DB::table('scenarios')->insertGetId(['shortname' => 'old', 'title' => 'Old', 'code' => 'oldworldoldworld', 'created_at' => $now, 'updated_at' => $now]);
        $robo = DB::table('characters')->insertGetId(['scenario_id' => $scenario, 'name' => 'Robo', 'settings' => json_encode(['routine' => ['steps' => [['type' => 'wait', 'duration' => 1]]]]), 'created_at' => $now, 'updated_at' => $now]);
        $vega = DB::table('characters')->insertGetId(['scenario_id' => $scenario, 'name' => 'Vega', 'settings' => json_encode(['scale' => 0.8]), 'created_at' => $now, 'updated_at' => $now]);
        $scene = fn (int $sequence, array $placements) => DB::table('scenes')->insertGetId([
            'scenario_id' => $scenario, 'shortname' => "s$sequence", 'sequence' => $sequence,
            'layout' => json_encode(['spawn_points' => [], 'characters' => $placements]), 'created_at' => $now, 'updated_at' => $now,
        ]);
        // The lab comes second in the scenario's order, though it was made first.
        $lab = $scene(2, [['character_id' => $robo, 'position_x' => 5, 'position_y' => 6]]);
        $hall = $scene(1, [['character_id' => $vega, 'position_x' => 300, 'position_y' => 400, 'facing' => 'left', 'event_id' => 77], ['character_id' => $robo, 'position_x' => 10, 'position_y' => 20]]);

        // Run the migration's data step again over these rows (the column is there already).
        (require database_path('migrations/2026_11_22_000000_characters_live_in_the_world.php'))->up();

        $settings = fn (int $id) => json_decode(DB::table('characters')->where('id', $id)->value('settings'), true);
        $this->assertSame(['scene_id' => $hall, 'position_x' => 10, 'position_y' => 20, 'roams' => true], $settings($robo), 'Robo starts at his first placement, taking the scenes in order, and walks around on his own');
        $this->assertSame(['scale' => 0.8, 'scene_id' => $hall, 'position_x' => 300, 'position_y' => 400, 'facing' => 'left', 'event_id' => 77], $settings($vega), 'Vega keeps her click');
        foreach ([$hall, $lab] as $id) {
            $this->assertArrayNotHasKey('characters', json_decode(DB::table('scenes')->where('id', $id)->value('layout'), true), 'the placements are gone from the scenes');
        }

        // A character's own event belongs to no scene.
        $event = DB::table('events')->insertGetId(['scene_id' => null, 'character_id' => $vega, 'kind' => 'character', 'created_at' => $now, 'updated_at' => $now]);
        $this->assertNull(DB::table('events')->where('id', $event)->value('scene_id'));
        DB::table('characters')->where('id', $vega)->delete();
        $this->assertSame(0, DB::table('events')->where('id', $event)->count(), 'and goes with its character');
    }
}
