import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { WaterLightSystem } from '../src/systems/WaterLightSystem';
import { Game } from './harness';

/** The bottom of a pool: light rippling on the floor, and shafts from the surface while the sun is out. */
function pool(): Scenario {
  const floor = [{ x: 0, y: 420 }, { x: 1280, y: 420 }, { x: 1280, y: 720 }, { x: 0, y: 720 }];
  return normalizeScenario({
    id: 9, shortname: 'pool', title: 'Pool', start_scene_id: 1, avatar_media_ids: [9],
    assets: [{ id: 1, type: 'image', url: 'pool.png', width: 1280, height: 720 }, { id: 9, type: 'image', url: 'avatar.png' }],
    global_variables: [{ variable_name: 'sunny', variable_type: 'number', default_value: 0 }],
    scenes: [{
      id: 1, shortname: 'pool', width: 1280, height: 720, walkable_areas: [floor],
      background_media: [{ media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 600, position_y: 560 }],
      water_lights: [
        { kind: 'ripples', x: 0, y: 420, width: 1280, height: 300, speed: 200 },
        { kind: 'shafts', x: 240, y: 0, width: 800, height: 560, conditions: [{ variable: 'sunny', operator: '=', operand: 1 }] },
        { kind: 'ripples', x: 0, y: 0, width: 100, height: 100, speed: 0 },
        { kind: 'ripples', x: 0, y: 0, width: 0, height: 100 },
        { kind: 'ripples', x: 0, y: 0, width: 5, height: 5, shape: [{ x: 100, y: 450 }, { x: 600, y: 430 }, { x: 500, y: 700 }] },
      ],
    }],
  } as unknown as Scenario);
}

test('underwater light runs at its own speed, and comes on and goes out with its conditions', async () => {
  const g = new Game(pool());
  await g.wait(100);
  const lights = g.scene.system(WaterLightSystem).lights;
  assert.equal(lights.length, 4, 'a light with no box is left out');
  const [ripples, shafts, still, shaped] = lights;
  assert.deepEqual([shaped!.area.x, shaped!.area.y, shaped!.area.width, shaped!.area.height, shaped!.area.corners?.length], [100, 430, 500, 270, 3], 'an outline is drawn over its own bounds');
  // The test's Phaser has no WebGL: nothing is drawn, but the light keeps its state.
  assert.equal(ripples!.shader, null);
  assert.equal(ripples!.on, true);
  assert.equal(shafts!.on, false, 'no sun: no shafts');
  assert.equal(shafts!.shown, 0);

  const t0 = [ripples!.time, still!.time];
  await g.wait(500);
  const ran = ripples!.time - t0[0]!;
  assert.ok(ran > 0.8 && ran < 1.2, `twice the usual pace: about a second in half a second (${ran})`);
  assert.equal(still!.time, t0[1], 'speed 0 holds it still');

  await g.ctx.vars.apply('sunny', 'set', 1);
  assert.equal(shafts!.on, true);
  await g.wait(150);
  assert.ok(shafts!.shown > 0 && shafts!.shown < 1, `the shafts fade in (${shafts!.shown})`);
  await g.wait(400);
  assert.equal(shafts!.shown, 1);
  await g.ctx.vars.apply('sunny', 'set', 0);
  await g.wait(500);
  assert.equal(shafts!.shown, 0, 'and fade out again');
});
