/**
 * A walk made from a standing picture: six frames of a side-on walk cycle, facing right, drawn by
 * cutting the legs out of the picture and moving them, a thigh, a shin and a foot each, with the
 * rest of the body riding on top. No DOM here: pictures are RGBA pixel buffers, so it runs (and
 * is tested) anywhere.
 *
 * The feet are what makes a walk read as one, so they are placed first and the legs follow them
 * (two-bone inverse kinematics from the hip to the ankle):
 *
 *   frame      1 contact   2 down     3 passing   4 contact   5 down     6 passing
 *   near foot  heel lands  flat       flat        toe pushes  lifts      swings by
 *   far foot   toe pushes  lifts      swings by   heel lands  flat       flat
 *
 * - At each contact (frames 1 and 4) the feet are a step apart: `stride` × the leg's length (0.72
 *   by default, about what people and cartoon characters take), heel down in front, heel up behind.
 * - At each passing (frames 3 and 6) the swinging foot passes right beside the planted one: the two
 *   ankles are at the same place across, the swinging one a little off the ground. That is where
 *   the feet come together.
 * - A planted foot moves back by the same amount every frame (a third of a step), so it does not
 *   skate while the character moves at an even speed, and a planted foot always touches the ground:
 *   the hips are lowered when a leg could not reach it.
 * - The body bobs from the legs: lowest just after contact (the knee takes the weight), highest at
 *   passing, never above where it stands.
 *
 * A picture whose legs cannot be found (a long dress, a blob) gets a gentle bob instead.
 */

export interface Bitmap {
  width: number;
  height: number;
  /** RGBA, 4 bytes a pixel, row by row. */
  data: Uint8ClampedArray;
}

export const WALK_FRAMES = 6;
/** One pass of the cycle, in milliseconds: two steps. */
export const WALK_DURATION = 720;

type Point = { x: number; y: number };

export interface LegRig {
  /** Where the leg's pixels are marked in `legOf`. */
  id: number;
  hip: Point;
  knee: Point;
  ankle: Point;
  /** The row just under this leg's sole (one foot can stand a little higher than the other). */
  sole: number;
  footHeight: number;
  /** The foot's pixels, from the ankle: what touches the ground however the foot is tilted. */
  foot: Array<[number, number]>;
  /** Pixels across the leg's picture, for the bounds of its segments. */
  minX: number;
  maxX: number;
}

export interface WalkRig {
  /** The row just under the lowest sole: the ground. */
  ground: number;
  /** First row of the legs; the body is everything above it, and anything below it that is not a leg. */
  cut: number;
  /** The hip joint's row, a little above the cut (inside the body), which the thighs turn about. */
  pivot: number;
  /** The ankles' row, standing (from the ground, the feet's height on average). */
  ankle: number;
  /** Hip to ankle, standing straight. */
  reach: number;
  /** The middle of the hips, across. */
  hipX: number;
  /** One leg drawn twice (a side view, the legs one behind the other), or the picture's own two. */
  legs: LegRig[];
  figureHeight: number;
  /** For each pixel, the leg it belongs to (0: the body). */
  legOf: Int8Array;
  /** A soft shadow on the ground under the feet, which stays where it is. */
  shadow: Uint8Array | null;
  /** The shadow as drawn in every frame: with the part the standing feet hid filled in. */
  shadowFill: Bitmap | null;
}

/** Where each foot is in one frame, as planned, in the frame's pixels (ankles, and the sole's lowest point). */
export interface FootPlace {
  ankle: Point;
  sole: number;
  planted: boolean;
  /** The foot's tilt, degrees: below 0 the toe is up (a heel landing), above 0 the heel is up. */
  tilt: number;
}

export interface WalkFrame {
  bitmap: Bitmap;
  /** How far the body is lowered, in pixels. */
  drop: number;
  /** Far foot first, then near. Empty when the walk is a bob. */
  feet: FootPlace[];
}

export interface WalkCycle {
  mode: 'legs' | 'bob';
  /** Why the legs could not be used, when `mode` is "bob". */
  why?: string;
  width: number;
  height: number;
  frames: WalkFrame[];
  rig: WalkRig | null;
  /** The step, in pixels: how far apart the ankles are at contact. */
  step: number;
  /** The picture's sole row in the frames (the ground). */
  ground: number;
  /** Where the standing picture's left edge is in the frames: as much room is left on its right. */
  left: number;
}

/** Each leg's part of the cycle, from heel strike: across in steps (+ in front of the hip), lift in leg lengths, tilt in degrees. */
const PLAN: ReadonlyArray<{ x: number; lift: number; tilt: number; planted: boolean }> = [
  { x: 0.5, lift: 0, tilt: -14, planted: true }, // contact: heel lands, toe up
  { x: 1 / 6, lift: 0, tilt: 0, planted: true }, // down: foot flat, knee takes the weight
  { x: -1 / 6, lift: 0, tilt: 0, planted: true }, // passing: under the body
  { x: -0.5, lift: 0, tilt: 18, planted: true }, // the other heel lands: heel up, pushing off the toe
  { x: -1 / 3, lift: 0.11, tilt: 28, planted: false }, // lifts, knee bent, toe trailing
  { x: -1 / 6, lift: 0.045, tilt: 6, planted: false }, // passing: right beside the planted foot
];

const ALPHA = 24;

// ------------------------------------------------------------------ the rig

/**
 * Finds the legs in a standing picture: from the soles up, the runs of pixels that carry on from
 * the feet are legs, until the two legs join (the crotch) or the one meets something much wider
 * (the hips, a hand). A soft grey shadow under the feet is set aside first. Null with a reason
 * when there is nothing to make legs of (wheels, a long dress, a blob).
 */
export function findRig(src: Bitmap): WalkRig | { problem: string } {
  const { width: w, height: h, data } = src;
  const alpha = (x: number, y: number) => data[(y * w + x) * 4 + 3]!;

  // The figure's extent, and its firm (not see-through) bottom.
  let top = -1;
  let bottom = -1;
  let firmBottom = -1;
  let left = w;
  let right = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = alpha(x, y);
      if (a <= ALPHA) continue;
      if (top < 0) top = y;
      bottom = y;
      if (a > 200) firmBottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return { problem: 'The picture is empty.' };
  if (bottom - top < 24) return { problem: 'The picture is too small to find legs in.' };

  // A shadow: see-through, dark and grey, spreading below the feet. It stays on the ground.
  let shadow: Uint8Array | null = null;
  let shadowFill: Bitmap | null = null;
  if (bottom - firmBottom >= 2) {
    const grey = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
      return a > ALPHA && a <= 200 && Math.max(r, g, b) - Math.min(r, g, b) < 48 && (r + g + b) / 3 < 130;
    };
    // Not the soft edge of something solid: a shadow pixel has nothing firm right beside it.
    const firmNear = (x: number, y: number) => {
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (x + i >= 0 && x + i < w && y + j >= 0 && y + j < h && alpha(x + i, y + j) > 200) return true;
      return false;
    };
    let below = 0;
    for (let y = firmBottom + 1; y <= bottom; y++) for (let x = 0; x < w; x++) if (grey(x, y) && !firmNear(x, y)) below++;
    if (bottom - firmBottom >= Math.max(3, (bottom - top) * 0.015) && below > (bottom - top) * 0.15) {
      shadow = new Uint8Array(w * h);
      const from = Math.round(firmBottom - (bottom - top) * 0.2);
      for (let y = Math.max(0, from); y <= bottom; y++) for (let x = 0; x < w; x++) if (grey(x, y) && !firmNear(x, y)) shadow[y * w + x] = 1;
    }
    if (shadow && shadow.some(Boolean)) shadowFill = fillShadow(src, shadow);
  }
  const solid = (x: number, y: number) => alpha(x, y) > ALPHA && !shadow?.[y * w + x];
  if (shadow) {
    bottom = -1;
    for (let y = h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < w; x++) if (solid(x, y)) (bottom = y);
  }
  const height = bottom - top + 1;

  const runsOf = (y: number): Array<[number, number]> => {
    const runs: Array<[number, number]> = [];
    let start = -1;
    let gap = 0;
    for (let x = 0; x <= w; x++) {
      const on = x < w && solid(x, y);
      if (on) {
        if (start < 0) start = x;
        gap = 0;
      } else if (start >= 0) {
        // A one-pixel gap (an outline, antialiasing) does not split a leg.
        if (x < w && ++gap <= 1) continue;
        runs.push([start, x - gap]);
        start = -1;
        gap = 0;
      }
    }
    return runs;
  };

  const legOf = new Int8Array(w * h);
  // Feet start near the bottom; one may stand a little higher than the other.
  const footBand = Math.max(3, Math.round(height * 0.1));
  const ceiling = bottom - Math.round(height * 0.62);
  let previous: Array<{ x0: number; x1: number; leg: number }> = [];
  let legs = 0;
  const widths: number[] = [];
  let cut = top;
  let lastWidth = 0;
  for (let y = bottom; y >= top; y--) {
    const inBand = y > bottom - footBand;
    const here: Array<{ x0: number; x1: number; leg: number }> = [];
    let merged = false;
    for (const [x0, x1] of runsOf(y)) {
      const touching = [...new Set(previous.filter((p) => p.x0 <= x1 + 1 && p.x1 >= x0 - 1).map((p) => p.leg))];
      if (touching.length > 1 && bottom - y < height * 0.12) {
        // Two parts of one foot (a sole with a gap) joining just above the ground: one leg after all.
        const into = Math.min(...touching);
        for (let i = 0; i < legOf.length; i++) if (touching.includes(legOf[i]!)) legOf[i] = into;
        for (const p of [...previous, ...here]) if (touching.includes(p.leg)) p.leg = into;
        here.push({ x0, x1, leg: into });
      } else if (touching.length > 1) merged = true;
      else if (touching.length === 1) here.push({ x0, x1, leg: touching[0]! });
      else if (inBand && legs < 4) here.push({ x0, x1, leg: ++legs });
    }
    if (!here.length && inBand && !merged) {
      // Specks under the feet (a stray pixel, the edge of a shadow) that lead nowhere: start again above them.
      legOf.fill(0);
      previous = [];
      legs = 0;
      widths.length = 0;
      continue;
    }
    const width = here.reduce((n, r) => n + r.x1 - r.x0 + 1, 0) / Math.max(1, new Set(here.map((r) => r.leg)).size);
    const sorted = [...widths].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : width;
    // The legs end where they join, where they stop, where something much wider starts, or high enough up.
    const widened = y < bottom - footBand && widths.length > 3 && ((width > median * 1.9 && width - median > height * 0.04) || width - lastWidth > height * 0.08);
    if (merged || !here.length || widened || y < ceiling) {
      cut = y + 1;
      break;
    }
    for (const r of here) for (let x = r.x0; x <= r.x1; x++) legOf[y * w + x] = r.leg;
    if (!inBand) widths.push(width);
    lastWidth = width;
    previous = here;
  }

  // Keep the two biggest legs; anything else that touched the ground (a tail, a stick) is the body's.
  const count = new Map<number, number>();
  for (let i = 0; i < legOf.length; i++) if (legOf[i]) count.set(legOf[i]!, (count.get(legOf[i]!) ?? 0) + 1);
  const kept = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).filter(([, n], i, all) => i === 0 || n > all[0]![1] * 0.3).map(([id]) => id);
  for (let i = 0; i < legOf.length; i++) if (legOf[i] && !kept.includes(legOf[i]!)) legOf[i] = 0;

  // One leg that is really two, standing apart and touching only at the feet (or fins, or a shadow
  // the feet stand in): split it down the gap between them.
  if (kept.length === 1) {
    const id = kept[0]!;
    const gaps: number[] = [];
    let rows = 0;
    for (let y = cut; y <= bottom - footBand; y++) {
      const runs = runsOf(y).filter(([x0, x1]) => legOf[y * w + x0] === id || legOf[y * w + x1] === id);
      rows++;
      if (runs.length === 2) gaps.push((runs[0]![1] + runs[1]![0]) / 2);
    }
    if (rows > 4 && gaps.length >= rows * 0.6) {
      const split = gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)]!;
      const other = id + 1;
      for (let y = cut; y <= bottom; y++) for (let x = Math.ceil(split); x < w; x++) if (legOf[y * w + x] === id) legOf[y * w + x] = other;
      kept.push(other);
    }
  }

  const ground = bottom + 1;
  if (!kept.length || ground - cut < height * 0.14) return { problem: 'No legs could be found at the bottom of the picture.' };
  const sortedWidths = [...widths].sort((a, b) => a - b);
  const legWidth = sortedWidths[Math.floor(sortedWidths.length / 2)] ?? 0;
  if (kept.length === 1 && legWidth > height * 0.16) {
    return { problem: 'The bottom of the picture is too wide to be legs (a long dress, a robe or wheels?).' };
  }

  const span = (id: number, y: number): [number, number] | null => {
    let a = -1;
    let b = -1;
    for (let x = 0; x < w; x++) if (legOf[y * w + x] === id) (a < 0 && (a = x), (b = x));
    return a < 0 ? null : [a, b];
  };
  // The middle of a leg's pixels over some rows.
  const centre = (id: number, y0: number, y1: number): number | null => {
    let sum = 0;
    let n = 0;
    for (let y = Math.max(cut, Math.round(y0)); y <= Math.min(bottom, Math.round(y1)); y++) {
      for (let x = 0; x < w; x++) if (legOf[y * w + x] === id) (sum += x), n++;
    }
    return n ? sum / n : null;
  };

  const pivot = cut - Math.max(1, Math.round((ground - cut) * 0.1));
  const legRigs: LegRig[] = kept.map((id) => {
    let sole = cut;
    let minX = w;
    let maxX = -1;
    for (let y = cut; y <= bottom; y++) {
      const s = span(id, y);
      if (!s) continue;
      sole = y + 1;
      minX = Math.min(minX, s[0]);
      maxX = Math.max(maxX, s[1]);
    }
    const visible = sole - cut;
    // The ankle: where the leg narrows above the foot (a foot sticks out in front), else a usual share.
    const band = Math.max(2, Math.round(visible * 0.08));
    let soleWidth = 0;
    for (let y = sole - 1; y >= sole - band; y--) {
      const s = span(id, y);
      if (s) soleWidth = Math.max(soleWidth, s[1] - s[0] + 1);
    }
    let footHeight = Math.max(2, Math.round(visible * 0.14));
    for (let up = Math.max(band, Math.round(visible * 0.06)); up < visible * 0.3; up++) {
      const s = span(id, sole - 1 - up);
      if (s && s[1] - s[0] + 1 <= soleWidth * 0.72) {
        footHeight = up;
        break;
      }
    }
    const ankleY = sole - footHeight;
    const kneeY = Math.round((pivot + ankleY) / 2);
    const hipX = centre(id, cut, cut + visible * 0.15) ?? (left + right) / 2;
    const kneeX = centre(id, kneeY - 2, kneeY + 2) ?? hipX;
    const ankleX = centre(id, ankleY - Math.max(2, footHeight * 0.5), ankleY) ?? kneeX;
    const foot: Array<[number, number]> = [];
    for (let y = ankleY; y < sole; y++) for (let x = minX; x <= maxX; x++) if (legOf[y * w + x] === id) foot.push([x + 0.5 - ankleX, y + 0.5 - ankleY]);
    return { id, hip: { x: hipX, y: pivot }, knee: { x: kneeX, y: kneeY }, ankle: { x: ankleX, y: ankleY }, sole, footHeight, foot, minX, maxX };
  });
  // Far leg first: the one further back (left, facing right).
  legRigs.sort((a, b) => a.hip.x - b.hip.x);
  const hipX = legRigs.reduce((n, l) => n + l.hip.x, 0) / legRigs.length;
  const ankle = ground - legRigs.reduce((n, l) => n + l.footHeight, 0) / legRigs.length;

  return { ground, cut, pivot, ankle, reach: ankle - pivot, hipX, legs: legRigs, figureHeight: height, legOf, shadow, shadowFill };
}

/** The shadow by itself, each row's gaps (where the feet stood on it) filled with that row's shade. */
function fillShadow(src: Bitmap, shadow: Uint8Array): Bitmap {
  const { width: w, height: h } = src;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    let a = -1;
    let b = -1;
    const sum = [0, 0, 0, 0];
    let n = 0;
    for (let x = 0; x < w; x++) {
      if (!shadow[y * w + x]) continue;
      if (a < 0) a = x;
      b = x;
      for (let c = 0; c < 4; c++) sum[c]! += src.data[(y * w + x) * 4 + c]!;
      n++;
    }
    for (let x = Math.max(0, a); n && x <= b; x++) {
      const o = (y * w + x) * 4;
      if (shadow[y * w + x]) data.set(src.data.subarray(o, o + 4), o);
      else for (let c = 0; c < 4; c++) data[o + c] = Math.round(sum[c]! / n);
    }
  }
  return { width: w, height: h, data };
}

// ------------------------------------------------------------------ the walk

/**
 * The six frames of a walk, facing right, all the same size: the standing picture's width plus room
 * for the stride on both sides (its middle stays in the middle, so standing and walking line up),
 * and its height (the soles stay on the same row).
 */
export function walkCycle(src: Bitmap, options: { stride?: number } = {}): WalkCycle {
  const rig = findRig(src);
  if ('problem' in rig) return bob(src, rig.problem);

  const R = rig.reach;
  const step = (options.stride ?? 0.72) * R;
  const single = rig.legs.length === 1;
  // A side view: one leg drawn twice, the far one darker. Two legs keep their own looks (a little darker behind).
  const legs = single ? [rig.legs[0]!, rig.legs[0]!] : rig.legs;
  const shade = single ? 0.78 : 0.9;
  const maxToe = Math.max(...legs.map((l) => l.maxX - l.minX));
  const margin = Math.ceil(step / 2 + maxToe + R * 0.3 + 4);
  const W = src.width + 2 * margin;
  const H = src.height;

  // How high the hips are over the ankles, in leg lengths: at contact, just after (down), and passing.
  const contact = 0.985 * Math.sqrt(Math.max(0.1, 1 - (step / R / 2) ** 2));
  const heights = [contact, contact - 0.03, Math.min(0.975, 0.985 * Math.sqrt(1 - (step / R / 6) ** 2))];

  const frames: WalkFrame[] = [];
  for (let f = 0; f < WALK_FRAMES; f++) {
    // The far leg is half a cycle behind the near one.
    const phases = [(f + 3) % WALK_FRAMES, f];
    const hipsX = legs.map((l) => margin + rig.hipX + (l.hip.x - rig.hipX) * 0.4);

    // Where each foot goes, and the lowest the hips may be for every planted foot to reach the ground.
    const place = (i: number): FootPlace => {
      const plan = PLAN[phases[i]!]!;
      const leg = legs[i]!;
      const tilt = (plan.tilt * Math.PI) / 180;
      // The foot turned with its tilt: its lowest pixel is what touches the ground (the heel when
      // landing, the toe when pushing off), so the ankle goes that far above the ground.
      let low = 0;
      for (const [dx, dy] of leg.foot) low = Math.max(low, dx * Math.sin(tilt) + dy * Math.cos(tilt) + 0.5);
      // Each foot keeps to its own ground: in a three-quarter view the far foot stands a little higher.
      const onGround = leg.sole - low;
      const y = plan.planted ? onGround : Math.min(onGround, leg.sole - leg.footHeight - plan.lift * R);
      // Both feet step along one line under the middle of the hips, so they meet when passing.
      return { ankle: { x: margin + rig.hipX + plan.x * step, y }, sole: y + low, planted: plan.planted, tilt: plan.tilt };
    };
    const feet = [place(0), place(1)];
    let hipY = rig.ankle - heights[f % 3]! * R;
    const lengths = legs.map((l) => [dist(l.hip, l.knee), dist(l.knee, l.ankle)] as const);
    feet.forEach((foot, i) => {
      if (!foot.planted) return;
      const most = 0.995 * (lengths[i]![0] + lengths[i]![1]);
      const dx = foot.ankle.x - hipsX[i]!;
      if (Math.abs(dx) < most) hipY = Math.max(hipY, foot.ankle.y - Math.sqrt(most * most - dx * dx));
    });
    const drop = Math.max(0, Math.ceil(hipY - rig.pivot));
    hipY = rig.pivot + drop;

    const out = new Uint8ClampedArray(W * H * 4);
    // The shadow stays on the ground, under everything.
    if (rig.shadowFill) {
      const fill = rig.shadowFill;
      for (let y = 0; y < fill.height; y++) for (let x = 0; x < fill.width; x++) over(out, (y * W + x + margin) * 4, fill.data, (y * fill.width + x) * 4, 1);
    }
    legs.forEach((leg, i) => {
      const hip = { x: hipsX[i]!, y: hipY };
      const [l1, l2] = lengths[i]!;
      const foot = feet[i]!;
      const { knee, ankle } = solve(hip, foot.ankle, l1, l2);
      const thigh = angleOf(knee.x - hip.x, knee.y - hip.y) - angleOf(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y);
      const shin = angleOf(ankle.x - knee.x, ankle.y - knee.y) - angleOf(leg.ankle.x - leg.knee.x, leg.ankle.y - leg.knee.y);
      const k = i === 0 ? shade : 1;
      const overlap = Math.max(1, Math.round(R * 0.04));
      // Foot, then shin over it, then thigh over that: the upper part of a leg covers the joint below it.
      segment(src, out, W, H, rig, leg, { from: leg.ankle.y - overlap, to: leg.sole - 1 }, leg.ankle, ankle, (-foot.tilt * Math.PI) / 180, k);
      segment(src, out, W, H, rig, leg, { from: leg.knee.y - overlap, to: leg.ankle.y + overlap }, leg.knee, knee, shin, k);
      segment(src, out, W, H, rig, leg, { from: rig.pivot, to: leg.knee.y + overlap }, leg.hip, hip, thigh, k);
      // Keep the planned ankle as drawn (the same unless a leg could not reach).
      foot.ankle = ankle;
    });
    // The body rides on the hips.
    for (let y = 0; y < src.height; y++) {
      const ty = y + drop;
      if (ty >= H) break;
      for (let x = 0; x < src.width; x++) {
        const s = (y * src.width + x) * 4;
        if (src.data[s + 3]! === 0 || rig.legOf[y * src.width + x] || rig.shadow?.[y * src.width + x]) continue;
        over(out, (ty * W + x + margin) * 4, src.data, s, 1);
      }
    }
    frames.push({ bitmap: { width: W, height: H, data: out }, drop, feet });
  }
  return trim({ mode: 'legs', width: W, height: H, frames, rig, step, ground: rig.ground, left: margin }, src.width);
}

/** Angle of a direction, measured from straight down towards the front (+x). */
function angleOf(dx: number, dy: number): number {
  return Math.atan2(dx, dy);
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Two-bone inverse kinematics: the knee for a hip and an ankle, bending forwards. */
function solve(hip: Point, target: Point, l1: number, l2: number): { knee: Point; ankle: Point } {
  const dx = target.x - hip.x;
  const dy = target.y - hip.y;
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-3), (l1 + l2) * 0.999);
  const toward = angleOf(dx, dy);
  const bend = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const a = toward + bend; // the knee goes forwards
  const knee = { x: hip.x + l1 * Math.sin(a), y: hip.y + l1 * Math.cos(a) };
  const s = angleOf(target.x - knee.x, target.y - knee.y);
  return { knee, ankle: { x: knee.x + l2 * Math.sin(s), y: knee.y + l2 * Math.cos(s) } };
}

/**
 * Draws one part of a leg, turned by `turn` (radians, from down towards the front) about its joint:
 * `from` (the joint in the picture) lands on `to`. Every pixel of the frame it can cover is looked
 * up in the picture, so a turned part has no holes. Rows above the cut (the top of the thigh, inside
 * the body) repeat the leg's first row, so a thigh swung forwards stays joined to the hips.
 */
function segment(src: Bitmap, out: Uint8ClampedArray, W: number, H: number, rig: WalkRig, leg: LegRig, rows: { from: number; to: number }, from: Point, to: Point, turn: number, shade: number) {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  // Corners of the part in the picture, turned into the frame, for the area to fill.
  const corners = [[leg.minX - 1, rows.from], [leg.maxX + 1, rows.from], [leg.minX - 1, rows.to + 1], [leg.maxX + 1, rows.to + 1]].map(([x, y]) => {
    const dx = x! - from.x;
    const dy = y! - from.y;
    return { x: to.x + dx * cos + dy * sin, y: to.y - dx * sin + dy * cos };
  });
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 1);
  const x1 = Math.min(W - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 1);
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 1);
  const y1 = Math.min(H - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Back into the picture: turned the other way about the joint.
      const dx = x + 0.5 - to.x;
      const dy = y + 0.5 - to.y;
      const sx = Math.floor(from.x + dx * cos - dy * sin);
      const sy = Math.floor(from.y + dx * sin + dy * cos);
      if (sy < rows.from || sy > rows.to || sx < 0 || sx >= src.width) continue;
      const ly = Math.max(sy, rig.cut);
      if (ly >= src.height || rig.legOf[ly * src.width + sx] !== leg.id) continue;
      over(out, (y * W + x) * 4, src.data, (ly * src.width + sx) * 4, shade);
    }
  }
}

/** A source pixel laid over the frame, its colour darkened by `shade`. */
function over(out: Uint8ClampedArray, o: number, data: Uint8ClampedArray, s: number, shade: number) {
  const a = data[s + 3]! / 255;
  if (a <= 0) return;
  const b = out[o + 3]! / 255;
  const alpha = a + b * (1 - a);
  for (let c = 0; c < 3; c++) out[o + c] = Math.round((data[s + c]! * shade * a + out[o + c]! * b * (1 - a)) / alpha);
  out[o + 3] = Math.round(alpha * 255);
}

/** Narrows the frames to what they use, keeping the standing picture's middle in the middle. */
function trim(cycle: WalkCycle, sourceWidth: number): WalkCycle {
  const middle = cycle.width / 2;
  let reach = sourceWidth / 2;
  for (const { bitmap } of cycle.frames) {
    for (let y = 0; y < bitmap.height; y++) {
      for (let x = 0; x < bitmap.width; x++) if (bitmap.data[(y * bitmap.width + x) * 4 + 3]! > 0) reach = Math.max(reach, Math.abs(x + 0.5 - middle));
    }
  }
  const half = Math.ceil(reach) + 2;
  const from = Math.max(0, Math.floor(middle - half));
  const width = Math.min(cycle.width - from, 2 * half);
  if (from === 0 && width === cycle.width) return cycle;
  const frames = cycle.frames.map((frame) => {
    const data = new Uint8ClampedArray(width * frame.bitmap.height * 4);
    for (let y = 0; y < frame.bitmap.height; y++) data.set(frame.bitmap.data.subarray((y * cycle.width + from) * 4, (y * cycle.width + from + width) * 4), y * width * 4);
    return { ...frame, bitmap: { width, height: frame.bitmap.height, data }, feet: frame.feet.map((f) => ({ ...f, ankle: { x: f.ankle.x - from, y: f.ankle.y } })) };
  });
  return { ...cycle, width, frames, left: cycle.left - from };
}

/** No legs to move: the figure bobs and its bottom sways a little, in time with a walk. */
function bob(src: Bitmap, why: string): WalkCycle {
  const { width: w, height: h, data } = src;
  let top = h;
  let bottom = -1;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i]! <= ALPHA) continue;
    const y = Math.floor((i - 3) / 4 / w);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  const height = Math.max(1, bottom - top + 1);
  const unit = Math.max(1, Math.round(height * 0.015));
  const sway = Math.max(1, Math.round(height * 0.03));
  const margin = sway + 1;
  const W = w + 2 * margin;
  const frames: WalkFrame[] = [];
  for (let f = 0; f < WALK_FRAMES; f++) {
    const drop = [1, 2, 0][f % 3]! * unit;
    const lean = Math.sin((2 * Math.PI * f) / WALK_FRAMES);
    const out = new Uint8ClampedArray(W * h * 4);
    for (let y = 0; y < h; y++) {
      const ty = y + drop;
      if (ty >= h) break;
      // The lower third sways, most at the hem.
      const share = Math.max(0, (y - (bottom - height / 3)) / (height / 3));
      const dx = Math.round(lean * sway * share);
      for (let x = 0; x < w; x++) over(out, (ty * W + x + margin + dx) * 4, data, (y * w + x) * 4, 1);
    }
    frames.push({ bitmap: { width: W, height: h, data: out }, drop, feet: [] });
  }
  return { mode: 'bob', why, width: W, height: h, frames, rig: null, step: 0, ground: bottom + 1, left: margin };
}

// ------------------------------------------------------------------ checking the feet

export interface FeetCheck {
  /** Per frame: how far apart the ankles are, in pixels, and whether a foot is on the ground. */
  gaps: number[];
  grounded: boolean[];
  /** Frames (from 0) where the feet come together, and where they are a step apart. */
  together: number[];
  apart: number[];
  /** The step as a share of the figure's height. */
  stepShare: number;
  ok: boolean;
  problems: string[];
}

/**
 * Looks at a walk the way an animator would: in every frame a foot is on the ground; the feet come
 * together (passing) and separate to a step (contact) twice a cycle, alternating; the step is a
 * natural length for the figure; and nothing hangs below the ground. Read from the frames' pixels
 * at the ground, with the planned ankles saying which foot is which.
 */
export function checkFeet(cycle: WalkCycle): FeetCheck {
  const problems: string[] = [];
  if (cycle.mode !== 'legs' || !cycle.rig) {
    return { gaps: [], grounded: [], together: [], apart: [], stepShare: 0, ok: false, problems: [cycle.why ?? 'No legs.'] };
  }
  const { rig } = cycle;
  const gaps = cycle.frames.map((f) => Math.abs(f.feet[0]!.ankle.x - f.feet[1]!.ankle.x));
  const legs = rig.legs.length === 1 ? [rig.legs[0]!, rig.legs[0]!] : rig.legs;
  const solidAt = (bitmap: Bitmap, x: number, y: number) => x >= 0 && x < bitmap.width && y >= 0 && y < bitmap.height && bitmap.data[(y * bitmap.width + x) * 4 + 3]! > ALPHA;
  const grounded = cycle.frames.map(({ bitmap, feet }) => {
    // Nothing hangs below the ground (a shadow may: it is not looked at)...
    if (!rig.shadow) {
      for (let y = rig.ground; y < bitmap.height; y++) for (let x = 0; x < bitmap.width; x++) if (solidAt(bitmap, x, y)) return false;
    }
    // ...and a planted foot has pixels on its sole row, about where its ankle is.
    return feet.some((foot, i) => {
      if (!foot.planted) return false;
      const leg = legs[i]!;
      const reach = leg.maxX - leg.minX + 2;
      for (let y = leg.sole - 2; y < leg.sole; y++) {
        for (let x = Math.floor(foot.ankle.x - reach); x <= foot.ankle.x + reach; x++) if (solidAt(bitmap, x, y)) return true;
      }
      return false;
    });
  });
  const together = gaps.flatMap((g, i) => (g <= rig.reach * 0.06 ? [i] : []));
  const widest = Math.max(...gaps);
  const apart = gaps.flatMap((g, i) => (g >= widest * 0.9 ? [i] : []));
  const stepShare = widest / rig.figureHeight;
  if (grounded.some((g) => !g)) problems.push(`No foot is on the ground in frame ${grounded.indexOf(false) + 1}.`);
  if (together.length < 2) problems.push('The feet do not come together twice in the cycle.');
  if (apart.length < 2) problems.push('The feet do not reach a full step twice in the cycle.');
  if (together.length >= 2 && apart.length >= 2 && !together.every((t) => apart.some((a) => (t - a + WALK_FRAMES) % WALK_FRAMES === 2))) {
    problems.push('The feet do not pass each other between the steps.');
  }
  if (widest < rig.reach * 0.5 || widest > rig.reach * 0.95) problems.push('The step is not a natural length for the legs.');
  // The planted foot moves back evenly (no skating).
  for (let f = 0; f < WALK_FRAMES; f++) {
    const next = (f + 1) % WALK_FRAMES;
    cycle.frames[f]!.feet.forEach((foot, i) => {
      const then = cycle.frames[next]!.feet[i]!;
      if (foot.planted && then.planted && Math.abs(foot.ankle.x - then.ankle.x - cycle.step / 3) > Math.max(2, cycle.step * 0.08)) {
        problems.push(`The planted foot slides unevenly between frames ${f + 1} and ${next + 1}.`);
      }
    });
  }
  return { gaps, grounded, together, apart, stepShare, ok: problems.length === 0, problems: [...new Set(problems)] };
}

/** Mirrors a picture left to right (to walk the other way, or to start from one facing left). */
export function mirror(src: Bitmap): Bitmap {
  const { width: w, height: h } = src;
  const data = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(src.data.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (y * w + (w - 1 - x)) * 4);
  return { width: w, height: h, data };
}

/** The frames side by side, as one sprite sheet of one row. */
export function sheetOf(cycle: WalkCycle): Bitmap {
  const W = cycle.width * cycle.frames.length;
  const data = new Uint8ClampedArray(W * cycle.height * 4);
  cycle.frames.forEach(({ bitmap }, i) => {
    for (let y = 0; y < cycle.height; y++) data.set(bitmap.data.subarray(y * cycle.width * 4, (y + 1) * cycle.width * 4), (y * W + i * cycle.width) * 4);
  });
  return { width: W, height: cycle.height, data };
}
