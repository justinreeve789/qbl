import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FOG_FRAG, fogArea, fogCornerData, fogDirectionVector, fogRadial, fogSettings, fogStartShape, validateScenario, type Scenario } from '../src/index.js';

const square = [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 600 }, { x: 100, y: 600 }];

const moor: Scenario = {
  id: 1, shortname: 'moor', title: 'The Moor', start_scene_id: 1,
  assets: [{ id: 1, type: 'image', url: 'bg.png' }],
  global_variables: [{ variable_name: 'night', variable_type: 'boolean', default_value: true }],
  scenes: [{
    id: 1, width: 1280, height: 720, background_media: [{ media_id: 1 }],
    fogs: [
      { name: 'bank', shape: square, direction: 'left', speed: 30, color: '#c8d0e0', opacity: 70, density: 80 },
      { shape: square, direction: 'outward', origin: { x: 300, y: 590 }, layer: 'behind', conditions: [{ variable: 'night', operator: '=', operand: true }] },
    ],
  }],
} as unknown as Scenario;

test('fog has sensible defaults, keeps its settings in range, and finds its middle', () => {
  const f = fogSettings({ shape: square });
  assert.deepEqual(f, { color: '#e8edf2', opacity: 0.6, density: 0.55, size: 220, speed: 25, direction: 'right', origin: { x: 300, y: 400 }, layer: 'front' });
  const wild = fogSettings({ shape: square, color: 'grey', opacity: 300, density: -4, size: 1, speed: -5, direction: 'sideways' as never, layer: 'over' as never, origin: { x: 'a' } as never });
  assert.deepEqual([wild.color, wild.opacity, wild.density, wild.size, wild.speed, wild.direction, wild.layer, wild.origin], ['#e8edf2', 1, 0, 20, 0, 'right', 'front', { x: 300, y: 400 }]);
  assert.deepEqual(fogSettings({ shape: square, origin: { x: 1, y: 2 } }).origin, { x: 1, y: 2 });
  assert.deepEqual(fogDirectionVector('up'), [0, -1]);
  assert.deepEqual(fogDirectionVector('outward'), [0, 0]);
  assert.ok(fogRadial('inward') && fogRadial('outward') && !fogRadial('down'));
});

test('fog is drawn over its outline\'s bounds, with the corners for the shader', () => {
  const area = fogArea({ shape: [{ x: 50, y: 400 }, { x: 300, y: 380 }, { x: 250, y: 500 }] });
  assert.deepEqual([area.x, area.y, area.width, area.height, area.corners?.length], [50, 380, 250, 120, 3]);
  const data = fogCornerData(area);
  assert.equal(data.length, 36);
  assert.deepEqual([...data.slice(0, 6)], [0, 20, 250, 0, 200, 120], 'relative to the top left, two to a vec4');
  assert.equal(fogArea({ shape: [{ x: 0, y: 0 }] }).corners, null, 'too few corners: nothing to draw');
  assert.deepEqual(fogStartShape({ x: 10.4, y: 20, width: 100, height: 50 }), [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 70 }, { x: 10, y: 70 }]);
});

test('fog in a scene is valid; bad outlines and settings are caught', () => {
  assert.deepEqual(validateScenario(moor).errors, []);
  assert.deepEqual(validateScenario(moor).warnings.filter((w) => w.path.includes('fogs')), []);
  const bad = structuredClone(moor);
  bad.scenes[0]!.fogs = [{
    shape: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: 'blue', opacity: 120, density: -1, size: 0, speed: -1,
    direction: 'around' as never, origin: { x: 'a' } as never, layer: 'top' as never, conditions: 'night' as never,
  }];
  const paths = validateScenario(bad).errors.map((e) => e.path);
  for (const p of ['.shape', '.color', '.opacity', '.density', '.size', '.speed', '.direction', '.origin', '.layer', '.conditions'].map((k) => `scenes[0].fogs[0]${k}`)) {
    assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
  }
  const unused = structuredClone(moor);
  unused.scenes[0]!.fogs = [{ shape: square, direction: 'left', origin: { x: 1, y: 1 } }];
  assert.ok(validateScenario(unused).warnings.some((w) => w.path === 'scenes[0].fogs[0].origin'), 'a point only fog spreading from it uses');
});

test('the fog shader is a WebGL 1 fragment shader with the uniforms the game and the editor set', () => {
  assert.match(FOG_FRAG, /#pragma phaserTemplate\(shaderName\)/);
  for (const u of ['uTime', 'uTravel', 'uBox', 'uSize', 'uDir', 'uRadial', 'uOrigin', 'uDensity', 'uColor', 'uPoly[9]', 'uCorners']) {
    assert.ok(FOG_FRAG.includes(`${u};`), u);
  }
  assert.match(FOG_FRAG, /gl_FragColor = vec4\(tint \* alpha, alpha\)/, 'premultiplied');
  assert.doesNotMatch(FOG_FRAG, /\bsin\(/, 'no sin() hash, which loses precision far from 0');
});
