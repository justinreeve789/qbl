import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIPPLES_FRAG, RIPPLES_ON_FIGURE_FRAG, SHAFTS_FRAG, validateScenario, waterLightArea, waterLightCornerData, waterLightSettings, waterLightShaped, waterLightStartShape, type Scenario } from '../src/index.js';

const pool: Scenario = {
  id: 1, shortname: 'pool', title: 'Under the Sea', start_scene_id: 1,
  assets: [{ id: 1, type: 'image', url: 'bg.png' }],
  global_variables: [{ variable_name: 'sunny', variable_type: 'boolean', default_value: true }],
  scenes: [{
    id: 1, width: 1280, height: 720, background_media: [{ media_id: 1 }],
    water_lights: [
      { kind: 'ripples', x: 0, y: 420, width: 1280, height: 300, edge: 'oval', tilt: 70 },
      { kind: 'shafts', x: 240, y: 0, width: 800, height: 560, conditions: [{ variable: 'sunny', operator: '=', operand: true }] },
    ],
  }],
} as unknown as Scenario;

test('underwater light has sensible defaults by kind, and keeps its settings in range', () => {
  const r = waterLightSettings({ x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual(r, { kind: 'ripples', color: '#e1f6ff', strength: 0.6, size: 120, speed: 1, tilt: 0.6, spread: 0.35, edge: 'soft', figures: 1 });
  const s = waterLightSettings({ kind: 'shafts', x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual([s.kind, s.strength, s.size, s.figures], ['shafts', 0.4, 90, 0], 'shafts light figures by being in front of them');
  assert.equal(waterLightSettings({ x: 0, y: 0, width: 1, height: 1, figures: 40 }).figures, 0.4);
  assert.equal(waterLightSettings({ x: 0, y: 0, width: 1, height: 1, figures: 300 }).figures, 1);
  const wild = waterLightSettings({ kind: 'lava' as never, x: 0, y: 0, width: 10, height: 10, color: 'blue', strength: 250, speed: -3, tilt: 140, edge: 'star' as never });
  assert.deepEqual([wild.kind, wild.color, wild.strength, wild.speed, wild.tilt, wild.edge], ['ripples', '#e1f6ff', 1, 0, 1, 'soft']);
  assert.equal(waterLightSettings({ x: 0, y: 0, width: 1, height: 1, speed: 0 }).speed, 0, 'speed 0 holds it still');
});

test('underwater light in a scene is valid; bad boxes and settings are caught', () => {
  assert.deepEqual(validateScenario(pool).errors, []);
  const bad = structuredClone(pool);
  bad.scenes[0]!.water_lights = [{ kind: 'fog' as never, x: 0, y: 0, width: 0, height: 10, color: 'blue', strength: 120, size: 0, speed: -1, spread: -5, figures: -2, edge: 'square' as never, conditions: 'sunny' as never }];
  const paths = validateScenario(bad).errors.map((e) => e.path);
  for (const p of ['', '.kind', '.color', '.strength', '.size', '.speed', '.spread', '.figures', '.edge', '.conditions'].map((k) => `scenes[0].water_lights[0]${k}`)) {
    assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
  }
});

test('the shaders are WebGL 1 fragment shaders that write premultiplied colour from the same uniforms', () => {
  for (const frag of [RIPPLES_FRAG, SHAFTS_FRAG]) {
    for (const u of ['uTime', 'uBox', 'uSize', 'uShape', 'uOval', 'uColor']) assert.match(frag, new RegExp(`uniform \\w+ ${u};`));
    assert.match(frag, /varying vec2 outTexCoord;/);
    assert.match(frag, /gl_FragColor = vec4\(uColor\.rgb \* alpha, alpha\);/);
    assert.doesNotMatch(frag, /#version 300|texture\(|out vec4/, 'GLSL ES 1.0 only, for WebGL 1');
  }
  assert.match(RIPPLES_FRAG, /uniform vec4 uPoly\[9\];/, 'room for 16 corners, and one past the end');
  // The light on people and things is a filter on their own picture, from the floor's own pattern.
  for (const u of ['uTime', 'uBox', 'uSize', 'uShape', 'uOval', 'uColor', 'uCorners', 'uArea', 'uRect', 'uFeet', 'uFlat', 'uFlipX']) assert.match(RIPPLES_ON_FIGURE_FRAG, new RegExp(`uniform \\w+ ${u};`));
  assert.match(RIPPLES_ON_FIGURE_FRAG, /uniform sampler2D uMainSampler;/);
  assert.match(RIPPLES_ON_FIGURE_FRAG, /float ripplesAt\(/);
  assert.match(RIPPLES_FRAG, /ripplesAt\(u, v, 0\.0, vec2\(0\.0\)\)/, 'the floor and the figures share one pattern');
  assert.doesNotMatch(RIPPLES_ON_FIGURE_FRAG, /#version 300|texture\(|out vec4/);
});

test('rippling light can have an outline of its own; the box is its bounds, and shafts ignore it', () => {
  const shape = [{ x: 100, y: 500 }, { x: 400, y: 420 }, { x: 900, y: 460 }, { x: 800, y: 700 }, { x: 150, y: 690 }];
  const light = { kind: 'ripples' as const, x: 0, y: 0, width: 10, height: 10, shape };
  assert.equal(waterLightShaped(light), true);
  const area = waterLightArea(light);
  assert.deepEqual([area.x, area.y, area.width, area.height, area.corners!.length], [100, 420, 800, 280, 5]);
  const data = waterLightCornerData(area);
  assert.equal(data.length, 36, 'nine vec4s, two corners to each');
  assert.deepEqual([...data.slice(0, 4)], [0, 80, 300, 0], 'corners relative to the top left of the bounds');
  assert.equal(waterLightShaped({ ...light, kind: 'shafts' }), false);
  assert.deepEqual(waterLightArea({ ...light, kind: 'shafts' }).corners, null);
  assert.equal(waterLightShaped({ ...light, shape: shape.slice(0, 2) }), false, 'two corners are not an outline');
  // A first outline: eight corners inside the box.
  const start = waterLightStartShape({ x: 0, y: 400, width: 1000, height: 300 });
  assert.equal(start.length, 8);
  assert.ok(start.every((p) => p.x >= 0 && p.x <= 1000 && p.y >= 400 && p.y <= 700));

  const bad = structuredClone(pool);
  bad.scenes[0]!.water_lights = [
    { x: 0, y: 0, width: 10, height: 10, shape: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
    { x: 0, y: 0, width: 10, height: 10, shape: [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 'a' as never, y: 1 }] },
    { kind: 'shafts', x: 0, y: 0, width: 10, height: 10, shape },
  ];
  const check = validateScenario(bad);
  const errors = check.errors.map((e) => e.path);
  assert.ok(errors.includes('scenes[0].water_lights[0].shape'), errors.join(', '));
  assert.ok(errors.includes('scenes[0].water_lights[1].shape[2]'), errors.join(', '));
  assert.ok(check.warnings.some((w) => w.path === 'scenes[0].water_lights[2].shape'));
});
