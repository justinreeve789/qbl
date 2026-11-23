import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mainLayerIndex, validateScenario, type Scenario, type SceneLayer } from '../src/index.js';

test('the main picture is the background layer marked main, else the first', () => {
  assert.equal(mainLayerIndex([]), -1);
  assert.equal(mainLayerIndex(null), -1);
  assert.equal(mainLayerIndex([{}, {}]), 0);
  assert.equal(mainLayerIndex([{}, { main: true }, {}]), 1);
  assert.equal(mainLayerIndex([{ main: false }, { main: 'yes' }]), 0, 'only true counts');
});

test('more than one main layer, or a main foreground layer, is a warning', () => {
  const doc = (background: SceneLayer[], foreground: SceneLayer[] = []): Scenario => ({
    id: 1, shortname: 'x', title: 'X', start_scene_id: 1,
    assets: [{ id: 1, type: 'image', url: 'a.png', width: 100, height: 100 }],
    scenes: [{ id: 1, shortname: 'one', width: 100, height: 100, background_media: background, foreground_media: foreground, spawn_points: [{ name: 'default', position_x: 1, position_y: 1 }] }],
  });
  const about = (s: Scenario) => validateScenario(s).warnings.filter((w) => /main picture/.test(w.message)).map((w) => w.path);
  assert.deepEqual(about(doc([{ media_id: 1 }, { media_id: 1, main: true }])), []);
  assert.deepEqual(about(doc([{ media_id: 1, main: true }, { media_id: 1, main: true }])), ['scenes[0].background_media[1]']);
  assert.deepEqual(about(doc([{ media_id: 1 }], [{ media_id: 1, main: true }])), ['scenes[0].foreground_media[0]']);
});
