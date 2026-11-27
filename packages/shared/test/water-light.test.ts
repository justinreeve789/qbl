import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RIPPLES_FRAG, SHAFTS_FRAG, validateScenario, waterLightSettings, type Scenario } from '../src/index.js';

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
  assert.deepEqual(r, { kind: 'ripples', color: '#e1f6ff', strength: 0.6, size: 120, speed: 1, tilt: 0.6, spread: 0.35, edge: 'soft' });
  const s = waterLightSettings({ kind: 'shafts', x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual([s.kind, s.strength, s.size], ['shafts', 0.4, 90]);
  const wild = waterLightSettings({ kind: 'lava' as never, x: 0, y: 0, width: 10, height: 10, color: 'blue', strength: 250, speed: -3, tilt: 140, edge: 'star' as never });
  assert.deepEqual([wild.kind, wild.color, wild.strength, wild.speed, wild.tilt, wild.edge], ['ripples', '#e1f6ff', 1, 0, 1, 'soft']);
  assert.equal(waterLightSettings({ x: 0, y: 0, width: 1, height: 1, speed: 0 }).speed, 0, 'speed 0 holds it still');
});

test('underwater light in a scene is valid; bad boxes and settings are caught', () => {
  assert.deepEqual(validateScenario(pool).errors, []);
  const bad = structuredClone(pool);
  bad.scenes[0]!.water_lights = [{ kind: 'fog' as never, x: 0, y: 0, width: 0, height: 10, color: 'blue', strength: 120, size: 0, speed: -1, spread: -5, edge: 'square' as never, conditions: 'sunny' as never }];
  const paths = validateScenario(bad).errors.map((e) => e.path);
  for (const p of ['', '.kind', '.color', '.strength', '.size', '.speed', '.spread', '.edge', '.conditions'].map((k) => `scenes[0].water_lights[0]${k}`)) {
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
});
