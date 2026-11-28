import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { FOG_FADE_MS, FogSystem } from '../src/systems/FogSystem';
import { Game } from './harness';

/** A moor: a bank of fog drifting left, steam from a vent that rises only once it is open, and a broken one. */
function moor(): Scenario {
  const floor = [{ x: 0, y: 420 }, { x: 1280, y: 420 }, { x: 1280, y: 720 }, { x: 0, y: 720 }];
  return normalizeScenario({
    id: 9, shortname: 'moor', title: 'Moor', start_scene_id: 1, avatar_media_ids: [9],
    assets: [{ id: 1, type: 'image', url: 'moor.png', width: 1280, height: 720 }, { id: 9, type: 'image', url: 'avatar.png' }],
    global_variables: [{ variable_name: 'vent_open', variable_type: 'number', default_value: 0 }],
    scenes: [{
      id: 1, shortname: 'moor', width: 1280, height: 720, walkable_areas: [floor],
      background_media: [{ media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 600, position_y: 560 }],
      fogs: [
        { shape: [{ x: 0, y: 400 }, { x: 1280, y: 380 }, { x: 1280, y: 720 }, { x: 0, y: 720 }], direction: 'left', speed: 40 },
        {
          shape: [{ x: 500, y: 100 }, { x: 800, y: 100 }, { x: 800, y: 400 }, { x: 500, y: 400 }], direction: 'inward', speed: 30, layer: 'behind',
          conditions: [{ variable: 'vent_open', operator: '=', operand: 1 }],
        },
        { shape: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
        { shape: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 50, y: 80 }], direction: 'outward', origin: { x: 50, y: 10 }, speed: 0 },
      ],
    }],
  } as unknown as Scenario);
}

test('fog drifts at its speed, and rolls in and clears with its conditions', async () => {
  const g = new Game(moor());
  await g.wait(100);
  const fogs = g.scene.system(FogSystem).fogs;
  assert.equal(fogs.length, 3, 'an outline of fewer than three corners is left out');
  const [bank, vent, still] = fogs;
  assert.deepEqual([bank!.area.x, bank!.area.y, bank!.area.width, bank!.area.height], [0, 380, 1280, 340], 'drawn over its outline\'s bounds');
  assert.equal(bank!.shader, null, 'the test\'s Phaser has no WebGL: nothing is drawn, but the fog keeps its state');
  assert.equal(vent!.s.origin.x, 650, 'the point defaults to the middle of the outline');
  assert.deepEqual(still!.s.origin, { x: 50, y: 10 });
  assert.equal(vent!.s.layer, 'behind');

  const t0 = [bank!.travel, vent!.travel, still!.travel, still!.time];
  await g.wait(500);
  const ran = bank!.travel - t0[0]!;
  assert.ok(ran > 15 && ran < 25, `about 20 px in half a second at 40 px/s (${ran})`);
  assert.ok(vent!.travel < t0[1]!, 'gathering inward runs the other way');
  assert.equal(still!.travel, t0[2], 'speed 0 does not drift');
  assert.ok(still!.time > t0[3]!, 'but still churns where it is');

  assert.equal(vent!.on, false);
  assert.equal(vent!.shown, 0);
  await g.ctx.vars.apply('vent_open', 'set', 1);
  assert.equal(vent!.on, true);
  await g.wait(FOG_FADE_MS / 2);
  assert.ok(vent!.shown > 0.2 && vent!.shown < 0.8, `the fog rolls in slowly (${vent!.shown})`);
  await g.wait(FOG_FADE_MS);
  assert.equal(vent!.shown, 1);
  await g.ctx.vars.apply('vent_open', 'set', 0);
  await g.wait(FOG_FADE_MS + 200);
  assert.equal(vent!.shown, 0, 'and clears again');
});
