import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { checkFeet, findRig, mirror, sheetOf, walkCycle, WALK_FRAMES, type Bitmap } from '../src/walkCycle';

/**
 * The walk made from a standing picture (walkCycle.ts), checked the way an animator would: the
 * feet land a step apart and pass side by side twice a cycle, a planted foot is always on the
 * ground and moves back evenly, the body bobs but never rises, and the frames line up with the
 * standing picture. On drawn figures and on the platform's own avatars.
 */

const repo = new URL('../../../', import.meta.url);

/** A PNG (8-bit RGBA, not interlaced, as the platform avatars are) as pixels. */
function readPng(path: URL): Bitmap {
  const file = readFileSync(path);
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  assert.equal(file[24], 8);
  assert.equal(file[25], 6, 'RGBA');
  const chunks: Buffer[] = [];
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    if (file.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(file.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const data = new Uint8ClampedArray(width * height * 4);
  const stride = width * 4;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= 4 ? data[y * stride + x - 4]! : 0;
      const b = y ? data[(y - 1) * stride + x]! : 0;
      const c = x >= 4 && y ? data[(y - 1) * stride + x - 4]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      data[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]!) & 255;
    }
  }
  return { width, height, data };
}

/** A figure drawn with rectangles and a circle, standing on the bottom row of the picture. */
function figure(width: number, height: number, parts: Array<{ x: number; y: number; w: number; h: number; colour: [number, number, number]; round?: boolean }>): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const p of parts) {
    for (let y = p.y; y < p.y + p.h; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (p.round && Math.hypot(x + 0.5 - (p.x + p.w / 2), y + 0.5 - (p.y + p.h / 2)) > p.w / 2) continue;
        data.set([...p.colour, 255], (y * width + x) * 4);
      }
    }
  }
  return { width, height, data };
}

/** Seen from the side, facing right: one leg (the other is behind it), a foot pointing forwards. */
const sideView = () => figure(100, 200, [
  { x: 30, y: 4, w: 40, h: 40, colour: [240, 200, 160], round: true }, // head
  { x: 30, y: 44, w: 40, h: 66, colour: [40, 120, 220] }, // body
  { x: 42, y: 110, w: 16, h: 76, colour: [60, 60, 70] }, // leg
  { x: 40, y: 186, w: 30, h: 14, colour: [30, 20, 10] }, // shoe, toe forwards
]);

/** From the front: two legs apart, each with a shoe. */
const frontView = () => figure(100, 200, [
  { x: 30, y: 4, w: 40, h: 40, colour: [240, 200, 160], round: true },
  { x: 26, y: 44, w: 48, h: 70, colour: [220, 80, 60] },
  { x: 30, y: 114, w: 16, h: 74, colour: [50, 50, 140] },
  { x: 54, y: 114, w: 16, h: 74, colour: [50, 50, 140] },
  { x: 28, y: 188, w: 22, h: 12, colour: [20, 20, 20] },
  { x: 52, y: 188, w: 22, h: 12, colour: [20, 20, 20] },
]);

const solid = (b: Bitmap, x: number, y: number) => b.data[(y * b.width + x) * 4 + 3]! > 24;
function extent(b: Bitmap): { top: number; bottom: number; left: number; right: number } {
  const e = { top: b.height, bottom: -1, left: b.width, right: -1 };
  for (let y = 0; y < b.height; y++) for (let x = 0; x < b.width; x++) if (solid(b, x, y)) (e.top = Math.min(e.top, y)), (e.bottom = y), (e.left = Math.min(e.left, x)), (e.right = Math.max(e.right, x));
  return e;
}

/** What every walk with legs must get right. */
function assertGoodWalk(name: string, source: Bitmap) {
  const cycle = walkCycle(source);
  assert.equal(cycle.mode, 'legs', `${name}: ${cycle.why}`);
  assert.equal(cycle.frames.length, WALK_FRAMES);
  const feet = checkFeet(cycle);
  assert.ok(feet.ok, `${name}: ${feet.problems.join(' ')}`);
  const rig = cycle.rig!;

  // Feet together when passing (frames 3 and 6), a step apart at contact (1 and 4), in between otherwise.
  assert.deepEqual(feet.together, [2, 5], `${name}: together ${feet.together}`);
  assert.deepEqual(feet.apart, [0, 3], `${name}: apart ${feet.apart}`);
  for (const f of [2, 5]) assert.ok(feet.gaps[f]! < 1, `${name}: passing gap ${feet.gaps[f]}`);
  for (const f of [0, 3]) assert.ok(Math.abs(feet.gaps[f]! - cycle.step) < 1.5, `${name}: contact gap ${feet.gaps[f]} for a step of ${cycle.step}`);
  for (const f of [1, 4]) assert.ok(feet.gaps[f]! > cycle.step * 0.3 && feet.gaps[f]! < cycle.step * 0.7, `${name}: down gap ${feet.gaps[f]}`);
  // A natural step: most of a leg's length, a good part of the figure's height.
  assert.ok(cycle.step > rig.reach * 0.6 && cycle.step < rig.reach * 0.85, `${name}: step ${cycle.step} for legs of ${rig.reach}`);
  assert.ok(feet.stepShare > 0.15 && feet.stepShare < 0.45, `${name}: step is ${feet.stepShare} of the height`);

  cycle.frames.forEach((frame, f) => {
    // One planted foot at least, and it is on the ground; a lifted foot is off it, not under it.
    assert.ok(frame.feet.some((foot) => foot.planted), `${name}: frame ${f + 1} has no foot down`);
    for (const foot of frame.feet) {
      if (foot.planted) assert.ok(foot.ankle.y < rig.ground, `${name}: frame ${f + 1} ankle under the ground`);
      else assert.ok(foot.sole < rig.ground - 1, `${name}: frame ${f + 1} swinging foot drags on the ground`);
    }
    // The body only goes down (the knees take the weight), and not far.
    assert.ok(frame.drop >= 0 && frame.drop < rig.reach * 0.2, `${name}: frame ${f + 1} drops ${frame.drop}`);
    // Same size as the standing picture's height, wide enough for the stride.
    assert.equal(frame.bitmap.height, source.height);
    assert.equal(frame.bitmap.width, cycle.width);
  });
  // Lowest just after contact, highest when passing.
  const drops = cycle.frames.map((f) => f.drop);
  assert.ok(drops[1]! >= drops[0]! && drops[0]! > drops[2]!, `${name}: bob ${drops}`);
  // The standing picture's middle is the frames' middle, so standing and walking line up.
  assert.ok(cycle.width > source.width && Math.abs(cycle.width - source.width - 2 * cycle.left) <= 1, `${name}: ${cycle.left} + ${source.width} in ${cycle.width}`);
  return cycle;
}

test('a figure seen from the side steps with one leg drawn twice, feet first', () => {
  const rig = findRig(sideView());
  assert.ok(!('problem' in rig));
  assert.equal(rig.legs.length, 1);
  assert.equal(rig.ground, 200);
  assert.ok(Math.abs(rig.cut - 110) <= 2, `cut at ${rig.cut}`);
  const cycle = assertGoodWalk('side view', sideView());
  // At contact the front toe is up (heel landing) and the back heel is up (pushing off).
  const contact = cycle.frames[0]!.feet;
  const front = contact.find((f) => f.ankle.x === Math.max(...contact.map((c) => c.ankle.x)))!;
  const back = contact.find((f) => f !== front)!;
  assert.ok(front.tilt < 0 && back.tilt > 0);
  // The far leg is darker than the near one.
  const darkest = Math.min(...[...cycle.frames[0]!.bitmap.data].filter((_, i) => i % 4 === 0 && cycle.frames[0]!.bitmap.data[i + 3]! > 0));
  assert.ok(darkest < 30 * 0.9, 'the shoe behind is shaded');
});

test('a figure seen from the front walks on its own two legs', () => {
  const rig = findRig(frontView());
  assert.ok(!('problem' in rig));
  assert.equal(rig.legs.length, 2);
  assert.ok(Math.abs(rig.cut - 114) <= 2, `cut at ${rig.cut}`);
  assertGoodWalk('front view', frontView());
});

test('the feet are really there in the pixels: on the ground at contact, together when passing', () => {
  const cycle = walkCycle(sideView());
  const ground = cycle.rig!.ground;
  const soleRow = (f: number) => {
    const xs: number[] = [];
    const b = cycle.frames[f]!.bitmap;
    for (let y = ground - 2; y < ground; y++) for (let x = 0; x < b.width; x++) if (solid(b, x, y)) xs.push(x);
    return xs;
  };
  for (let f = 0; f < WALK_FRAMES; f++) {
    assert.ok(soleRow(f).length > 0, `frame ${f + 1}: something on the ground`);
    assert.equal(extent(cycle.frames[f]!.bitmap).bottom, ground - 1, `frame ${f + 1}: nothing below the ground`);
  }
  // Passing: one foot on the ground, as wide as a shoe. Contact: heel in front and toe behind, a step apart.
  const width = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  assert.ok(width(soleRow(2)) <= 32, `passing: ${width(soleRow(2))}`);
  assert.ok(width(soleRow(0)) > cycle.step * 0.8, `contact: ${width(soleRow(0))} for a step of ${cycle.step}`);
});

test('a long dress has no legs to step with: it bobs instead', () => {
  const robe = figure(100, 200, [
    { x: 30, y: 4, w: 40, h: 40, colour: [240, 200, 160], round: true },
    { x: 20, y: 44, w: 60, h: 156, colour: [120, 40, 160] },
  ]);
  const cycle = walkCycle(robe);
  assert.equal(cycle.mode, 'bob');
  assert.match(cycle.why!, /too wide|No legs/);
  assert.equal(cycle.frames.length, WALK_FRAMES);
  assert.ok(new Set(cycle.frames.map((f) => f.drop)).size > 1, 'it bobs');
  assert.equal(checkFeet(cycle).ok, false);
});

test('one sprite sheet of six frames in a row; mirroring turns a figure facing left', () => {
  const cycle = walkCycle(sideView());
  const sheet = sheetOf(cycle);
  assert.equal(sheet.width, cycle.width * WALK_FRAMES);
  assert.equal(sheet.height, 200);
  const turned = mirror(mirror(sideView()));
  assert.deepEqual([...turned.data], [...sideView().data]);
});

test('the platform avatars with legs walk well; the ones on wheels, tracks or in a boat bob', () => {
  for (const n of [3, 4, 5, 8, 9]) assertGoodWalk(`avatar-${n}`, readPng(new URL(`scenarios/assets/platform/avatars/avatar-${n}.png`, repo)));
  for (const n of [2, 6, 7]) assert.equal(walkCycle(readPng(new URL(`scenarios/assets/platform/avatars/avatar-${n}.png`, repo))).mode, 'bob', `avatar-${n}`);
});
