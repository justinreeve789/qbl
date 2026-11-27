import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildingRules, buildProblems, cleanLabel, collectSceneMediaIds, tidyPiece, validateScenario, BUILD_LIMITS,
  type BuildPiece, type Scenario, type Scene,
} from '../src/index.js';

const scene = (building: Scene['building'], extra: Partial<Scene> = {}): Scene => ({ id: 1, width: 1000, height: 600, building, ...extra });

test('a scene allows building only when its author turned it on', () => {
  assert.equal(buildingRules(scene(undefined)), null);
  assert.equal(buildingRules(scene({ enabled: false, tools: ['label'] })), null);
  assert.equal(buildingRules(scene({ enabled: true, tools: ['label'] }, { story: true })), null, 'nobody builds in a story scene');
  const rules = buildingRules(scene({ enabled: true }));
  assert.deepEqual(rules?.tools, ['label'], 'the default is place and label, and place needs pieces');
  assert.equal(rules?.maxPieces, 12);
  assert.equal(rules?.approve, true);
  assert.equal(rules?.share, 'instance');
  assert.equal(buildingRules(scene({ enabled: true, tools: ['place'] })), null, 'place with no pieces leaves nothing to build with');
  const full = buildingRules(scene({ enabled: true, tools: ['place', 'picture', 'place'], pieces: [{ media_id: 5 }], max_pieces: 500, approve: false, share: 'own', prompt: '  Make a garden ' }));
  assert.deepEqual(full, { tools: ['place', 'picture'], pieces: [5], maxPieces: BUILD_LIMITS.maxPieces, approve: false, share: 'own', prompt: 'Make a garden' });
});

test('a build is checked against the scene’s rules', () => {
  const rules = buildingRules(scene({ enabled: true, tools: ['place', 'label', 'picture'], pieces: [{ media_id: 5 }], max_pieces: 3 }))!;
  const size = { width: 1000, height: 600 };
  const good: BuildPiece[] = [
    { id: 'a1', kind: 'sticker', x: 100, y: 100, media_id: 5, scale: 1.5, angle: 30 },
    { id: 'b2', kind: 'label', x: 200, y: 100, text: 'My pond', color: '#fde047' },
    { id: 'c3', kind: 'picture', x: 300, y: 100, upload_id: 9 },
  ];
  assert.deepEqual(buildProblems(rules, size, good, [9]), []);
  assert.match(buildProblems(rules, size, [...good, { id: 'd4', kind: 'label', x: 1, y: 1, text: 'x' }], [9]).join(' '), /up to 3/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'sticker', x: 100, y: 100, media_id: 6 }], []).join(' '), /not one of this scene's pieces/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'picture', x: 100, y: 100, upload_id: 9 }], [8]).join(' '), /not one of your pictures/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'label', x: 2000, y: 100, text: 'hi' }], []).join(' '), /outside the scene/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'label', x: 20, y: 100, text: '<b>hi</b>' }], []).join(' '), /needs words/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'label', x: 20, y: 100, text: 'hi', color: 'red' }], []).join(' '), /colour/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'label', x: 20, y: 100, text: 'hi', scale: 9 }], []).join(' '), /too big/);
  assert.match(buildProblems(rules, size, [{ id: 'a1', kind: 'label', x: 20, y: 100, text: 'hi' }, { id: 'a1', kind: 'label', x: 20, y: 100, text: 'hi' }], []).join(' '), /bad id/);
  const labelsOnly = buildingRules(scene({ enabled: true, tools: ['label'] }))!;
  assert.match(buildProblems(labelsOnly, size, [good[0]!], []).join(' '), /Placing pieces is not allowed/);
});

test('labels are kept as plain words, and pieces keep only their own fields', () => {
  assert.equal(cleanLabel('  The <big>\n pond  '), 'The big pond');
  assert.equal(cleanLabel('x'.repeat(100)).length, BUILD_LIMITS.labelLength);
  assert.deepEqual(tidyPiece({ id: 'a1', kind: 'label', x: 10.4, y: 20.6, text: ' Hi ', color: '#ffffff', media_id: 3, scale: 1 }), { id: 'a1', kind: 'label', x: 10, y: 21, text: 'Hi' });
  assert.deepEqual(tidyPiece({ id: 'a1', kind: 'sticker', x: 1, y: 2, media_id: 3, scale: 1.234, angle: 12.6, text: 'no' }), { id: 'a1', kind: 'sticker', x: 1, y: 2, scale: 1.23, angle: 13, media_id: 3 });
});

test('the pieces are loaded with the scene, and the validator checks the setting', () => {
  const doc: Scenario = {
    id: 1, shortname: 'b', title: 'B', start_scene_id: 1,
    assets: [{ id: 5, type: 'image', url: 'x.png' }, { id: 6, type: 'audio', url: 'x.mp3' }],
    scenes: [scene({ enabled: true, tools: ['place', 'zap' as never], pieces: [{ media_id: 5 }, { media_id: 6 }, { media_id: 7 }], max_pieces: 0 })],
  };
  assert.deepEqual(collectSceneMediaIds(doc, doc.scenes[0]!).sort(), [5, 6, 7]);
  const result = validateScenario(doc);
  const errors = result.errors.map((e) => `${e.path}: ${e.message}`).join('\n');
  assert.match(errors, /building\.pieces\[1\].*expected image/);
  assert.match(errors, /building\.pieces\[2\].*not in the scenario's media/);
  assert.match(errors, /"zap" is not a building tool/);
  assert.match(errors, /max_pieces is 1 to 50/);
  const off: Scenario = { ...doc, scenes: [scene({ enabled: false, pieces: [{ media_id: 7 }] })] };
  assert.equal(collectSceneMediaIds(off, off.scenes[0]!).length, 0, 'a building that is off loads nothing');
});
