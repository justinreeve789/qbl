import assert from 'node:assert/strict';
import { test } from 'node:test';
import { audioCrop, cropClock, croppedLength, cropFragment, makeCrop, normalizeScenario, validateScenario, type Scenario } from '../src/index.js';

/** A sound's crop: the part of its file that plays, kept on the media's params. */

test('a crop is read from a sound’s params, and one that keeps everything or makes no sense is none', () => {
  assert.deepEqual(audioCrop({ type: 'audio', params: { crop: { start: 1.234, end: 4 } } }), { start: 1.23, end: 4 });
  assert.deepEqual(audioCrop({ type: 'audio', params: { crop: { start: 2 } } }), { start: 2, end: null });
  assert.deepEqual(audioCrop({ type: 'audio', params: { crop: { end: 3 } } }), { start: 0, end: 3 });
  assert.deepEqual(audioCrop({ type: 'audio', params: '{"crop":{"start":1,"end":2}}' }), { start: 1, end: 2 }, 'params as the database keeps them');
  assert.equal(audioCrop({ type: 'audio', params: { crop: { start: 0 } } }), null, 'the whole file');
  assert.equal(audioCrop({ type: 'audio', params: { crop: { start: 3, end: 2 } } }), null, 'an end before its start');
  assert.equal(audioCrop({ type: 'audio', params: { crop: { start: -1, end: 2 } } })?.start, 0, 'a start below 0 is the start of the file');
  assert.equal(audioCrop({ type: 'image', params: { crop: { start: 1 } } }), null, 'only sounds');
  assert.equal(audioCrop({ type: 'audio' }), null);
  assert.equal(audioCrop(undefined), null);
});

test('a crop is made against the file’s length: clamped, rounded, and left off when it keeps everything', () => {
  assert.deepEqual(makeCrop(1.2345, 4, 10), { start: 1.23, end: 4 });
  assert.deepEqual(makeCrop(2, 10, 10), { start: 2 }, 'an end at the end of the file is left out');
  assert.deepEqual(makeCrop(0, 3, 10), { end: 3 });
  assert.equal(makeCrop(0, 10, 10), null, 'the whole file');
  assert.equal(makeCrop(-5, 20, 10), null, 'clamped to the file');
  assert.deepEqual(makeCrop(6, 4, 10), { start: 4, end: 6 }, 'ends the wrong way round are swapped');
  const tiny = makeCrop(5, 5, 10)!;
  assert.ok(tiny.end! - tiny.start! >= 0.049, 'never shorter than a twentieth of a second');
});

test('how long a cropped sound plays, its media fragment, and its times as a person reads them', () => {
  assert.equal(croppedLength({ start: 2, end: 4.5 }, 10), 2.5);
  assert.equal(croppedLength({ start: 2, end: null }, 10), 8);
  assert.equal(croppedLength({ start: 2, end: 30 }, 10), 8, 'not past the end of the file');
  assert.equal(croppedLength(null, 10), 10);
  assert.equal(cropFragment({ start: 2, end: 4.5 }), '#t=2,4.5');
  assert.equal(cropFragment({ start: 2, end: null }), '#t=2');
  assert.equal(cropFragment(null), '');
  assert.equal(cropClock(3.46), '0:03.5');
  assert.equal(cropClock(65), '1:05.0');
});

test('the validator warns about a crop that is not used', () => {
  const s = normalizeScenario({
    id: 1, shortname: 'v', title: 'V', start_scene_id: 1,
    assets: [
      { id: 1, type: 'audio', url: 'a.mp3', params: { crop: { start: 1, end: 3 } } },
      { id: 2, type: 'audio', url: 'b.mp3', params: { crop: { start: 3, end: 1 } } },
      { id: 3, type: 'image', url: 'c.png', params: { crop: { start: 1 } } },
      { id: 4, type: 'audio', url: 'd.mp3', params: { crop: { start: 'soon' } } },
    ],
    scenes: [{ id: 1, shortname: 'one', width: 100, height: 100 }],
  } as unknown as Scenario);
  const crops = validateScenario(s).warnings.filter((i) => i.path.endsWith('params.crop'));
  assert.deepEqual(crops.map((i) => [i.path, i.level]), [['assets[1].params.crop', 'warning'], ['assets[2].params.crop', 'warning'], ['assets[3].params.crop', 'warning']]);
});
