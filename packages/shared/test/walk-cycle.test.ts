import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { checkFeet, findRig, mirror, sheetOf, walkCycle, WALK_FRAMES, type Bitmap, type WalkRig } from '../src/walkCycle.js';

/**
 * The walk made from a standing picture (walkCycle.ts), checked the way an animator would: the
 * feet land a step apart and pass side by side twice a cycle, a planted foot is always on the
 * ground and moves back evenly, the body bobs but never rises, and the frames line up with the
 * standing picture. On drawn figures and on the platform's own avatars.
 */

const repo = new URL('../../../', import.meta.url);

/** A PNG (8 bits, RGBA or a palette, not interlaced, as the platform avatars are) as pixels. */
function readPng(path: URL): Bitmap {
  const file = readFileSync(path);
  const width = file.readUInt32BE(16);
  const height = file.readUInt32BE(20);
  assert.equal(file[24], 8);
  const kind = file[25]!;
  assert.ok(kind === 6 || kind === 3, 'RGBA or a palette');
  const bytes = kind === 6 ? 4 : 1;
  const chunks: Buffer[] = [];
  let palette = Buffer.alloc(0);
  let clear = Buffer.alloc(0);
  for (let at = 8; at < file.length;) {
    const length = file.readUInt32BE(at);
    const type = file.toString('ascii', at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (type === 'IDAT') chunks.push(body);
    if (type === 'PLTE') palette = body;
    if (type === 'tRNS') clear = body;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bytes;
  const rows = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x]!;
      const a = x >= bytes ? rows[y * stride + x - bytes]! : 0;
      const b = y ? rows[(y - 1) * stride + x]! : 0;
      const c = x >= bytes && y ? rows[(y - 1) * stride + x - bytes]! : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      rows[y * stride + x] = (v + [0, a, b, (a + b) >> 1, paeth][filter]!) & 255;
    }
  }
  if (kind === 6) return { width, height, data: new Uint8ClampedArray(rows) };
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const k = rows[i]!;
    data.set([palette[k * 3]!, palette[k * 3 + 1]!, palette[k * 3 + 2]!, k < clear.length ? clear[k]! : 255], i * 4);
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
  // (Short-legged, big-headed figures take steps of about a seventh of their height.)
  assert.ok(feet.stepShare > 0.12 && feet.stepShare < 0.45, `${name}: step is ${feet.stepShare} of the height`);

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

test('the new cast walk well; arms hanging free swing, hands on hips and folded arms stay', () => {
  // Facing left in their pictures: turned to face right first, as the editor and qbl:walk do.
  const facingLeft = ['asimov', 'buck', 'mallory', 'riona'];
  const arms: Record<string, number> = {};
  for (const name of ['asimov', 'buck', 'gil', 'lucy', 'mallory', 'pinta', 'riona', 'sam', 'val']) {
    const picture = readPng(new URL(`scenarios/assets/platform/avatars/${name}.png`, repo));
    const cycle = assertGoodWalk(name, facingLeft.includes(name) ? mirror(picture) : picture);
    arms[name] = cycle.rig!.arms.length;
  }
  assert.deepEqual(arms, { asimov: 2, buck: 0, gil: 0, lucy: 0, mallory: 1, pinta: 2, riona: 0, sam: 0, val: 0 });
});

/** From the front, arms hanging beside the body with a gap, on two legs. */
const withArms = (hands: 'hanging' | 'on hips') => figure(120, 220, [
  { x: 40, y: 4, w: 40, h: 40, colour: [240, 200, 160], round: true },
  { x: 36, y: 44, w: 48, h: 76, colour: [220, 80, 60] }, // body
  ...(hands === 'hanging'
    ? [{ x: 22, y: 50, w: 10, h: 80, colour: [240, 200, 160] as [number, number, number] }, { x: 88, y: 50, w: 10, h: 80, colour: [240, 200, 160] as [number, number, number] }]
    : [{ x: 22, y: 50, w: 10, h: 40, colour: [240, 200, 160] as [number, number, number] }, { x: 22, y: 86, w: 18, h: 8, colour: [240, 200, 160] as [number, number, number] }]),
  { x: 32, y: 46, w: 6, h: 8, colour: [220, 80, 60] }, // shoulders: the arms leave the body here
  { x: 82, y: 46, w: 6, h: 8, colour: [220, 80, 60] },
  { x: 40, y: 120, w: 16, h: 88, colour: [50, 50, 140] },
  { x: 64, y: 120, w: 16, h: 88, colour: [50, 50, 140] },
  { x: 38, y: 208, w: 22, h: 12, colour: [20, 20, 20] },
  { x: 62, y: 208, w: 22, h: 12, colour: [20, 20, 20] },
]);

test('arms hanging free swing about the shoulders, against the legs', () => {
  const rig = findRig(withArms('hanging')) as WalkRig;
  assert.ok(!('problem' in rig));
  assert.deepEqual(rig.arms.map((a) => a.side), [-1, 1]);
  for (const arm of rig.arms) assert.ok(arm.shoulder.y < arm.armpit && arm.hand.y > 120, `shoulder ${arm.shoulder.y}, armpit ${arm.armpit}, hand ${arm.hand.y}`);
  const cycle = assertGoodWalk('arms', withArms('hanging'));
  cycle.frames.forEach((frame, f) => {
    // The two arms swing opposite ways, and each against the leg on its side.
    const [left, right] = frame.arms;
    assert.ok(Math.abs(left! + right!) < 1e-6, `frame ${f + 1}: ${frame.arms}`);
  });
  // At contact the near leg is in front, so the near (right) arm is back, and the other way round.
  assert.ok(cycle.frames[0]!.arms[1]! < -10 && cycle.frames[3]!.arms[1]! > 10, `${cycle.frames.map((f) => f.arms[1])}`);
  // In the pixels: the right hand (skin colour, below the body's middle) is further forwards in frame 4 than in frame 1.
  const handX = (f: number) => {
    const b = cycle.frames[f]!.bitmap;
    let most = -1;
    for (let y = 115; y < 135; y++) for (let x = Math.floor(b.width / 2); x < b.width; x++) if (b.data[(y * b.width + x) * 4]! > 200 && b.data[(y * b.width + x) * 4 + 1]! > 170 && solid(b, x, y)) most = Math.max(most, x);
    return most;
  };
  assert.ok(handX(3) > handX(0) + 6, `hand at ${handX(0)} then ${handX(3)}`);
  // Hands on the hips (the arm meets the body again) stay where they are.
  const akimbo = findRig(withArms('on hips')) as WalkRig;
  assert.equal(akimbo.arms.length, 0);
});

test('the hips have no seam: the body and the tops of the legs are one in every frame', () => {
  const cycle = walkCycle(frontView());
  const rig = cycle.rig!;
  assert.ok(rig.band >= 2);
  cycle.frames.forEach((frame, f) => {
    // Across the body, from above the cut down to it: no gap between what stays and what moves.
    for (let y = rig.cut - rig.band; y < rig.cut; y++) {
      for (let x = 28; x < 72; x++) assert.ok(solid(frame.bitmap, x + cycle.left, y + frame.drop), `frame ${f + 1}: hole at ${x}, ${y}`);
    }
  });
});

test('a tail hanging beside a leg stays with the body, and nothing at the right edge spills onto the next row', () => {
  // Facing right, the tail behind (left), hanging from the back and touching the far leg; the
  // near foot reaches the picture's right edge.
  const tailed = figure(100, 200, [
    { x: 30, y: 4, w: 40, h: 40, colour: [240, 200, 160], round: true },
    { x: 26, y: 44, w: 48, h: 70, colour: [220, 80, 60] },
    { x: 8, y: 100, w: 20, h: 8, colour: [200, 120, 40] }, // the tail, out from the back...
    { x: 8, y: 100, w: 8, h: 50, colour: [200, 120, 40] }, // ...down...
    { x: 8, y: 142, w: 24, h: 8, colour: [200, 120, 40] }, // ...and against the far leg
    { x: 32, y: 114, w: 14, h: 74, colour: [50, 50, 140] },
    { x: 58, y: 114, w: 14, h: 74, colour: [50, 50, 140] },
    { x: 30, y: 188, w: 22, h: 12, colour: [20, 20, 20] },
    { x: 56, y: 188, w: 44, h: 12, colour: [20, 20, 20] },
  ]);
  const rig = findRig(tailed) as WalkRig;
  assert.ok(!('problem' in rig));
  for (let y = 100; y < 150; y++) for (let x = 8; x < 28; x++) assert.equal(rig.legOf[y * 100 + x], 0, `tail pixel ${x}, ${y} taken for a leg`);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 8; x++) assert.equal(rig.legOf[y * 100 + x], 0, `${x}, ${y} at the left edge`);
  assertGoodWalk('tail', tailed);
});

test('a leg held up beside the standing one is not drawn: the standing one walks for both', () => {
  const skipping = figure(120, 200, [
    { x: 30, y: 4, w: 40, h: 40, colour: [240, 200, 160], round: true },
    { x: 26, y: 44, w: 48, h: 70, colour: [220, 80, 60] },
    { x: 42, y: 114, w: 16, h: 74, colour: [50, 50, 140] }, // the standing leg
    { x: 40, y: 188, w: 30, h: 12, colour: [20, 20, 20] },
    { x: 64, y: 114, w: 14, h: 30, colour: [60, 160, 60] }, // the raised one, sticking out forwards
    { x: 70, y: 140, w: 40, h: 14, colour: [60, 160, 60] },
  ]);
  const rig = findRig(skipping) as WalkRig;
  assert.ok(!('problem' in rig));
  assert.equal(rig.legs.length, 1);
  assert.ok(rig.raised, 'the raised leg is found');
  const cycle = assertGoodWalk('raised leg', skipping);
  for (const frame of cycle.frames) {
    const b = frame.bitmap;
    for (let i = 0; i < b.width * b.height; i++) assert.ok(!(b.data[i * 4 + 1]! > 120 && b.data[i * 4]! < 100 && b.data[i * 4 + 3]! > 24), 'no green left');
  }
});
