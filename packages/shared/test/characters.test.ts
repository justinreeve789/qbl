import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animationDuration, animationFrames, apngFrameImages, apngInfo, characterAnimationRepeats, characterMediaIds, characterMoves, collectGlobalMediaIds,
  collectSceneMediaIds, normalizeScenario, pictureScale, readApng, resolvePortrait, resolvePose, validateScenario, type Character, type Scenario,
} from '../src/index.js';

const one = (animations: Character['animations']): Character => ({ id: 1, name: 'C', animations });

test('poses: what is missing is filled in from another pose, mirrored where it faces the other way', () => {
  const right = one({ stand_right: { media_id: 1 } });
  assert.deepEqual(resolvePose(right, false, 'right'), { name: 'stand_right', animation: { media_id: 1 }, flip: false });
  assert.deepEqual(resolvePose(right, false, 'left'), { name: 'stand_right', animation: { media_id: 1 }, flip: true }, 'one picture serves both ways');
  assert.equal(resolvePose(right, true, 'left')!.name, 'stand_right', 'no walk: it glides standing');

  const full = one({
    stand_right: { media_id: 1 }, stand_left: { media_id: 2 }, walk_right: { media_id: 3, frames: [0, 1] }, walk_left: { media_id: 3, frames: [0, 1], flip: true }, portrait: { media_id: 4 },
  });
  assert.deepEqual(resolvePose(full, false, 'left'), { name: 'stand_left', animation: { media_id: 2 }, flip: false });
  assert.deepEqual(resolvePose(full, true, 'left'), { name: 'walk_left', animation: { media_id: 3, frames: [0, 1], flip: true }, flip: true }, 'an animation can ask to be drawn mirrored');
  const walksRight = one({ stand_right: { media_id: 1 }, walk_right: { media_id: 3 } });
  assert.deepEqual([resolvePose(walksRight, true, 'left')!.name, resolvePose(walksRight, true, 'left')!.flip], ['walk_right', true]);
  const mirroredTwice = one({ stand_left: { media_id: 1, flip: true } });
  assert.equal(resolvePose(mirroredTwice, false, 'right')!.flip, false, 'a mirrored stand_left used for the right is the art as drawn');

  assert.equal(resolvePortrait(full)!.name, 'portrait');
  assert.deepEqual(resolvePortrait(one({ stand_left: { media_id: 2 } })), { name: 'stand_left', animation: { media_id: 2 }, flip: true }, 'no portrait: the character standing, facing right');
  assert.equal(resolvePose(one({ portrait: { media_id: 4 } }), false, 'right')!.name, 'portrait', 'only a portrait: it is what stands in the scene');
  assert.equal(resolvePose(one({}), false, 'right'), null);
  assert.equal(resolvePose(undefined, false, 'right'), null);
});

test('frames and timing: a sheet or an animated PNG, the frames chosen or all of them', () => {
  const sheet = { sheet: { columns: 3, rows: 2, count: 5 } };
  const apng = { apng: { frames: 4, duration: 800 } };
  assert.equal(animationFrames({}, {}), null, 'a still picture has no frames');
  assert.deepEqual(animationFrames({}, sheet), [0, 1, 2, 3, 4], 'every frame by default');
  assert.deepEqual(animationFrames({ frames: [4, 2, 9, -1] }, sheet), [4, 2], 'frames the sheet does not have are left out');
  assert.deepEqual(animationFrames({ frames: [9] }, sheet), [0]);
  assert.deepEqual(animationFrames({}, apng), [0, 1, 2, 3]);
  assert.equal(animationDuration({}, apng), 800, 'an animated PNG plays at its own speed');
  assert.equal(animationDuration({ frames: [0, 1] }, apng), 400, 'some of its frames: in proportion');
  assert.equal(animationDuration({ duration: 300 }, apng), 300);
  assert.equal(animationDuration({ frames: [0, 1, 2] }, sheet), 300, '100 ms a frame by default');
  assert.equal(animationDuration({}, {}), 0);
  assert.equal(characterAnimationRepeats('walk_left', {}), true);
  assert.equal(characterAnimationRepeats('dance', {}), true, 'a looping built-in move loops');
  assert.equal(characterAnimationRepeats('dig', {}), false);
  assert.equal(characterAnimationRepeats('dig', { repeat: true }), true);
  assert.deepEqual(characterMediaIds(one({ stand_right: { media_id: 1 }, walk_right: { media_id: 3 }, walk_left: { media_id: 3 } })), [1, 3]);
  assert.deepEqual(characterMoves(one({ stand_right: { media_id: 1 }, dig: { media_id: 2 }, jump: { media_id: 2 } })).slice(0, 3), ['dig', 'jump', 'spin']);
});

const base = (extra: Partial<Scenario>): Scenario => ({
  id: 1, shortname: 's', title: 'S', start_scene_id: 1,
  scenes: [{ id: 1, width: 800, height: 600, characters: [{ character_id: 5, position_x: 100, position_y: 500 }] }],
  ...extra,
});

test("a picture's scale_x and scale_y: positive numbers count, anything else is 1", () => {
  assert.deepEqual(pictureScale({ scale_x: 0.5, scale_y: 2 }), { x: 0.5, y: 2 });
  assert.deepEqual(pictureScale({ scale_x: '1.5' as unknown as number }), { x: 1.5, y: 1 }, 'a number sent as text still counts');
  assert.deepEqual(pictureScale({ scale_x: 0, scale_y: -1 }), { x: 1, y: 1 });
  assert.deepEqual(pictureScale(undefined), { x: 1, y: 1 });
});

test('older documents: a character picture and close-up, and a list of avatar pictures, become animations', () => {
  const s = normalizeScenario(base({
    assets: [
      { id: 1, type: 'image', url: 'npc.png' },
      { id: 2, type: 'image', url: 'npc-face.png' },
      {
        id: 3, type: 'image', url: 'robot.png', filename: 'Robot.png', scale_y: 1.3, sheet: { columns: 4, rows: 2 },
        animations: [{ name: 'idle', frames: [0, 1], duration: 900 }, { name: 'walk', frames: [4, 5, 6, 7] }, { name: 'jump', frames: [2, 3], repeat: false }],
      },
      { id: 4, type: 'image', url: 'avatar.png' },
      { id: 9, type: 'image', url: 'robot-face.png' },
    ],
    characters: [{ id: 5, name: 'Guide', media_id: 1, portrait_media_id: 2, scale: 0.8 }],
    avatar_media_ids: [3, 4],
    avatar_portraits: { '3': 9 },
  }));
  assert.deepEqual(s.characters![0]!.animations, { stand_right: { media_id: 1 }, portrait: { media_id: 2 } });
  assert.equal(s.characters![0]!.scale, 0.8);
  const [robot, plain] = s.avatars!;
  assert.equal(robot!.id, 3, "an avatar keeps its picture's id, so players' choices still match");
  assert.equal(robot!.name, 'Robot');
  assert.equal(robot!.scale, undefined, "the picture's scale stays on the picture (pictureScale), not copied to the avatar");
  assert.deepEqual(robot!.animations, {
    stand_right: { media_id: 3, frames: [0, 1], duration: 900 },
    walk_right: { media_id: 3, frames: [4, 5, 6, 7] },
    jump: { media_id: 3, frames: [2, 3], repeat: false },
    portrait: { media_id: 9 },
  });
  assert.deepEqual(plain!.animations, { stand_right: { media_id: 4 } });
  assert.deepEqual(collectSceneMediaIds(s, s.scenes[0]!).sort(), [1, 2], "the character's pictures are loaded with its scene");
  assert.deepEqual(collectGlobalMediaIds(s).sort(), [3, 4, 9], "every avatar's pictures are loaded everywhere");
  assert.deepEqual(validateScenario(s).errors, []);

  const withAnimations = normalizeScenario(base({
    assets: [{ id: 1, type: 'image', url: 'a.png' }, { id: 2, type: 'image', url: 'b.png' }],
    characters: [{ id: 5, name: 'Guide', media_id: 1, animations: { stand_right: { media_id: 2 } } }],
    avatars: [{ id: 900001, name: 'Nova', animations: { stand_right: { media_id: 1 } } }],
    avatar_media_ids: [1],
  }));
  assert.deepEqual(withAnimations.characters![0]!.animations, { stand_right: { media_id: 2 } }, 'animations win over the older picture');
  assert.deepEqual(withAnimations.avatars!.map((a) => a.id), [900001], 'a list of avatars wins over the older one');
});

test('validation: an animation needs a picture there is, and frames it has', () => {
  const doc = (animations: unknown, extra: Partial<Scenario> = {}) => base({
    assets: [{ id: 1, type: 'image', url: 'a.png', sheet: { columns: 2, rows: 2 } }, { id: 2, type: 'audio', url: 'b.mp3' }, { id: 3, type: 'image', url: 'c.png' }],
    characters: [{ id: 5, name: 'G', animations: animations as Character['animations'] }],
    ...extra,
  });
  const errors = (d: Scenario) => validateScenario(d).errors.map((e) => e.path);
  const warnings = (d: Scenario) => validateScenario(d).warnings.map((e) => e.path);
  assert.deepEqual(errors(doc({ stand_right: { media_id: 1, frames: [0, 3] } })), []);
  assert.deepEqual(errors(doc({ stand_right: { media_id: 1, frames: [4] } })), ['characters[0].animations.stand_right.frames']);
  assert.deepEqual(errors(doc({ stand_right: { media_id: 7 } })), ['characters[0].animations.stand_right.media_id']);
  assert.deepEqual(errors(doc({ stand_right: { media_id: 2 } })), ['characters[0].animations.stand_right.media_id'], 'a sound is not a picture');
  assert.deepEqual(errors(doc({ 'Big Wave': { media_id: 1 }, stand_right: { media_id: 1 } })), ['characters[0].animations.Big Wave']);
  assert.ok(warnings(doc({ stand_right: { media_id: 3, frames: [1] } })).includes('characters[0].animations.stand_right.frames'), 'a still picture has no frames');
  assert.ok(warnings(doc({ portrait: { media_id: 3 } })).includes('characters[0].animations'), 'no standing picture');
  assert.deepEqual(errors(doc({ stand_right: { media_id: 3 } }, { avatars: [{ id: 1, name: 'A', animations: { stand_right: { media_id: 9 } } }, { id: 1, name: 'B' }] })), ['avatars[0].animations.stand_right.media_id', 'avatars[1].id']);

  // Playing an animation on a character: its own names, or a built-in move.
  const animate = (name: string) => {
    const d = doc({ stand_right: { media_id: 1 }, dig: { media_id: 1, frames: [2, 3] } });
    d.scenes[0]!.start_events = [{ id: 1, actions: [{ id: 2, type: 'animate', target: 'character', character_id: 5, animation: name }] }];
    return warnings(d).filter((p) => p.endsWith('.animation'));
  };
  assert.deepEqual(animate('dig'), []);
  assert.deepEqual(animate('spin'), []);
  assert.equal(animate('fly').length, 1);
  assert.equal(animate('stand_right').length, 1, 'a pose is not something to play');
});

/** A two-frame animated PNG, 2x1 pixels, made by hand: red then blue, 300 ms and 500 ms. */
function tinyApng(): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Uint8Array) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: number[]) => {
    const body = new Uint8Array([...type].map((ch) => ch.charCodeAt(0)).concat(data));
    const out = new Uint8Array(4 + body.length + 4);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(body, 4);
    v.setUint32(4 + body.length, crc(body));
    return [...out];
  };
  const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
  const fctl = (seq: number, ms: number) => [...u32(seq), ...u32(2), ...u32(1), ...u32(0), ...u32(0), ...u16(ms), ...u16(1000), 0, 0];
  // The pixel data does not have to decode for the reader; only the chunks matter here.
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...chunk('IHDR', [...u32(2), ...u32(1), 8, 6, 0, 0, 0]),
    ...chunk('acTL', [...u32(2), ...u32(0)]),
    ...chunk('fcTL', fctl(0, 300)),
    ...chunk('IDAT', [1, 2, 3]),
    ...chunk('fcTL', fctl(1, 500)),
    ...chunk('fdAT', [...u32(2), 4, 5, 6]),
    ...chunk('IEND', []),
  ]);
}

test('animated PNGs: frames, their timing and each frame as a PNG of its own', () => {
  const bytes = tinyApng();
  assert.deepEqual(apngInfo(bytes), { frames: 2, duration: 800, plays: 0, width: 2, height: 1 });
  const file = readApng(bytes)!;
  assert.deepEqual(file.frames.map((f) => f.delay), [300, 500]);
  const frames = apngFrameImages(file);
  assert.equal(frames.length, 2);
  assert.deepEqual([...frames[1]!.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'each frame is a PNG');
  assert.ok(readApng(frames[1]!) === null, 'and is not animated');
  assert.equal(apngInfo(bytes.subarray(0, 20)), null);
  assert.equal(apngInfo(new Uint8Array([1, 2, 3])), null);
});
