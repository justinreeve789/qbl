import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanSay, hotspotSay,
  buildingRules, buildProblems, cleanLabel, cleanNote, collectSceneMediaIds, pieceMedia, piecePictures, tidyPiece, validateScenario, withoutUpload, BUILD_LIMITS,
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

test('hotspots look like nothing, words, a piece or a picture, and open words, a picture or both', () => {
  const rules = buildingRules(scene({ enabled: true, tools: ['hotspot'], pieces: [{ media_id: 5 }] }))!;
  assert.deepEqual(rules.tools, ['hotspot'], 'hotspots alone are something to build with');
  const size = { width: 1000, height: 600 };
  const spot = (extra: Partial<BuildPiece>): BuildPiece => ({ id: 'h1', kind: 'hotspot', x: 10, y: 10, opens: { text: 'Hi' }, ...extra });
  assert.deepEqual(buildProblems(rules, size, [
    spot({}),
    spot({ id: 'h2', look: 'label', text: 'Read me', color: '#fde047', opens: { upload_id: 9 } }),
    spot({ id: 'h3', look: 'sticker', media_id: 5, opens: { text: 'Two\n\nlines', media_id: 5 } }),
    spot({ id: 'h4', look: 'picture', upload_id: 9 }),
  ], [9]), []);
  const problem = (p: BuildPiece) => buildProblems(rules, size, [p], [9]).join(' ');
  assert.match(problem(spot({ opens: {} })), /needs words or a picture/);
  assert.match(problem(spot({ opens: { text: '<b>' } })), /< or >/);
  assert.match(problem(spot({ opens: { media_id: 5, upload_id: 9 } })), /one picture/);
  assert.match(problem(spot({ opens: { upload_id: 8 } })), /not one of yours/);
  assert.match(problem(spot({ look: 'sticker', media_id: 6 })), /look like one of this scene's pieces/);
  assert.match(problem(spot({ look: 'glow' as never })), /look/);
  assert.match(buildProblems(buildingRules(scene({ enabled: true, tools: ['label'] }))!, size, [spot({})], []).join(' '), /Hotspots are not allowed/);
  assert.deepEqual(
    tidyPiece(spot({ look: 'none', text: 'gone', media_id: 5, opens: { text: '  Hi \n\n\n\n there ', upload_id: 9 } })),
    { id: 'h1', kind: 'hotspot', x: 10, y: 10, opens: { text: 'Hi\n\nthere', upload_id: 9 } },
  );
});

test('a hotspot’s words keep their lines, and removing a picture changes the hotspots that showed it', () => {
  assert.equal(cleanNote(' One <two>\r\nthree\n\n\n\nfour\t\tfive '), 'One two\nthree\n\nfour five');
  assert.equal(cleanNote('x'.repeat(600)).length, BUILD_LIMITS.noteLength);
  const pieces: BuildPiece[] = [
    { id: 'a', kind: 'picture', x: 1, y: 1, upload_id: 9 },
    { id: 'b', kind: 'hotspot', x: 1, y: 1, look: 'picture', upload_id: 9, opens: { text: 'x' } },
    { id: 'c', kind: 'hotspot', x: 1, y: 1, opens: { text: 'kept', upload_id: 9 } },
    { id: 'd', kind: 'hotspot', x: 1, y: 1, opens: { upload_id: 9 } },
    { id: 'e', kind: 'hotspot', x: 1, y: 1, opens: { upload_id: 8 } },
  ];
  assert.deepEqual(withoutUpload(pieces, 9).map((p) => [p.id, p.opens]), [['c', { text: 'kept' }], ['e', { upload_id: 8 }]]);
  assert.deepEqual(piecePictures(pieces[1]!), [9]);
  assert.deepEqual(pieceMedia({ id: 'f', kind: 'hotspot', x: 1, y: 1, look: 'sticker', media_id: 5, opens: { media_id: 6 } }), [5, 6]);
});

test('a hotspot can have the narrator say something: one plain line, kept with or without anything else', () => {
  assert.equal(cleanSay('  Long ago,\n a <river> {{ran}}\there.  '), 'Long ago, a river ran here.');
  assert.equal(cleanSay('x'.repeat(400)).length, BUILD_LIMITS.sayLength);
  const rules = buildingRules(scene({ enabled: true, tools: ['hotspot'] }))!;
  const size = { width: 1000, height: 600 };
  const spot = (opens: BuildPiece['opens']): BuildPiece => ({ id: 's1', kind: 'hotspot', x: 10, y: 10, opens });
  assert.deepEqual(buildProblems(rules, size, [spot({ say: 'The river.' })], []), [], 'the narrator saying something is enough');
  assert.match(buildProblems(rules, size, [spot({ say: 'Hi {{QL_PlayerName}}' })], [])[0] ?? '', /< > \{ or \}/);
  assert.match(buildProblems(rules, size, [spot({ say: 'x'.repeat(301) })], [])[0] ?? '', /up to 300/);
  assert.match(buildProblems(rules, size, [spot({})], [])[0] ?? '', /something for the narrator to say/);
  assert.deepEqual(tidyPiece(spot({ say: '  The   river. ', text: 'Words' })).opens, { text: 'Words', say: 'The river.' });
  assert.deepEqual(withoutUpload([spot({ say: 'Kept.', upload_id: 9 })], 9).map((p) => p.opens), [{ say: 'Kept.' }], 'removing its picture leaves what the narrator says');
  assert.equal(hotspotSay(spot({ say: 'The river.' })), 'The river.');
  assert.equal(hotspotSay({ id: 'l', kind: 'label', x: 1, y: 1, text: 'x' }), '');
});
