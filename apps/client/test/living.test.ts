import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, SKY_HOURS, type Scenario } from '@qbl/shared';
import { AtmosphereSystem } from '../src/systems/AtmosphereSystem';
import { LayerSystem } from '../src/systems/LayerSystem';
import { LightSystem } from '../src/systems/LightSystem';
import { SkySystem } from '../src/systems/SkySystem';
import { Game } from './harness';

/** A camp at sunset: a sky that goes on into dusk, clouds that are part of it, a campfire, a beacon and fireflies. */
function camp(): Scenario {
  const floor = [{ x: 0, y: 400 }, { x: 1600, y: 400 }, { x: 1600, y: 720 }, { x: 0, y: 720 }];
  return normalizeScenario({
    id: 8, shortname: 'camp', title: 'Camp', start_scene_id: 1, avatar_media_ids: [9],
    assets: [{ id: 1, type: 'image', url: 'camp.png', width: 1600, height: 720 }, { id: 2, type: 'image', url: 'clouds.png' }, { id: 9, type: 'image', url: 'avatar.png' }],
    global_variables: [],
    scenes: [{
      id: 1, shortname: 'camp', width: 1600, height: 720, walkable_areas: [floor],
      background_media: [{ media_id: 2, tile: true, scroll_speed_x: 6, parallax: 0.1, sky: true }, { media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 200, position_y: 500 }],
      sky: { time: 'golden', until: 'dusk', minutes: 1 },
      lights: [{ x: 600, y: 520, kind: 'fire', radius: 120 }, { x: 1200, y: 300, kind: 'blink', color: '#ff4040', period: 1 }, { x: 900, y: 380, kind: 'glow', color: '#8ad8ff' }],
      atmosphere: [{ kind: 'fireflies', amount: 'few' }, { kind: 'leaves' }],
    }],
  } as unknown as Scenario);
}

test('a sky that sets, lights that brighten as it darkens, and things in the air', async () => {
  const g = new Game(camp());
  await g.wait(300);
  const sky = g.scene.system(SkySystem) as any;
  assert.ok(sky.look, 'the sky is drawn');
  assert.ok(Math.abs(sky.hour - SKY_HOURS.golden) < 0.2, `it starts at golden hour (${sky.hour})`);
  const day = sky.light;
  assert.equal(g.scene.system(LayerSystem).skyLayers.length, 1, 'the clouds are part of the sky');
  const lights = (g.scene.system(LightSystem) as any).lights;
  assert.equal(lights.length, 3);
  // A minute of real time later the sun has gone down: darker, and the lights shine more.
  const start = Date.now;
  Date.now = () => start() + 61_000;
  try {
    await g.wait(500);
    assert.ok(Math.abs(sky.hour - SKY_HOURS.dusk) < 0.01, `it is dusk (${sky.hour})`);
    assert.ok(sky.light > day + 0.3, `lights shine more (${day} to ${sky.light})`);
    assert.ok(sky.dark > 0.5);
  } finally {
    Date.now = start;
  }
  // The beacon blinks: lit for a moment in each second, dark in between.
  assert.equal(lights[1].def.kind, 'blink');
  const beacon = { def: lights[1].def, level: 1, phase: 0 };
  const lit = [0, 50, 100, 150, 400, 600, 800].map((ms) => LightSystem.brightness(beacon, 1000 + ms) > 0.5);
  assert.deepEqual(lit, [false, true, true, true, false, false, false]);
  // A glow breathes, never going dark.
  const glow = lights[2];
  const breaths = Array.from({ length: 40 }, (_, i) => LightSystem.brightness(glow, i * 100));
  assert.ok(Math.min(...breaths) >= 0.7 && Math.max(...breaths) - Math.min(...breaths) > 0.2);
  const air = (g.scene.system(AtmosphereSystem) as any).layers;
  assert.deepEqual(air.map((l: any) => [l.def.kind, l.motes.length]), [['fireflies', 8], ['leaves', 14]]);
});

test('without a sky, lights are always fully lit', async () => {
  const s = camp();
  delete (s.scenes[0] as any).sky;
  const g = new Game(s);
  await g.wait(100);
  assert.equal(g.scene.system(SkySystem).light, 1);
});

test('a light with conditions is on only while they hold, fading in and out', async () => {
  const s = camp();
  delete (s.scenes[0] as any).sky;
  (s as any).global_variables = [{ variable_name: 'repaired', variable_type: 'number', default_value: 0 }];
  // The beacon comes on once the ship is repaired; the campfire goes out then.
  (s.scenes[0] as any).lights[1].conditions = [{ variable: 'repaired', operator: '=', operand: 1 }];
  (s.scenes[0] as any).lights[0].conditions = [{ variable: 'repaired', operator: '=', operand: 0 }];
  const g = new Game(s);
  await g.wait(100);
  const [fire, beacon, glow] = (g.scene.system(LightSystem) as any).lights;
  assert.equal(beacon.on, false, 'the beacon starts off');
  assert.equal(beacon.shown, 0, 'and is not drawn at all');
  assert.equal(beacon.halo.visible, false);
  assert.equal(fire.shown, 1, 'the fire starts lit, without fading in');
  assert.equal(glow.shown, 1, 'a light without conditions is always on');
  await g.ctx.vars.apply('repaired', 'set', 1);
  assert.equal(beacon.on, true);
  assert.equal(fire.on, false);
  await g.wait(150);
  assert.ok(beacon.shown > 0 && beacon.shown < 1, `the beacon is fading in (${beacon.shown})`);
  assert.ok(fire.shown > 0 && fire.shown < 1, `the fire is fading out (${fire.shown})`);
  await g.wait(400);
  assert.equal(beacon.shown, 1, 'the beacon is fully on');
  assert.equal(fire.shown, 0, 'the fire is out');
  assert.equal(fire.halo.visible, false);
  assert.equal(glow.shown, 1);
});
