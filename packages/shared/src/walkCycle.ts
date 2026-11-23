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
 * - The arms swing against the legs: an arm hanging free of the body (a gap between it and the
 *   chest, down to the hand) turns about its shoulder, forwards as the leg on its side goes back.
 *   Hands on hips, arms folded or held up stay as they are.
 *
 * Nothing is cut on a hard line: each part of a leg or arm is drawn by blending the movements of
 * the bones either side of a joint (skinning), so a knee bends rather than breaks, and the tops of
 * the thighs and the shoulders blend into the body.
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
  /**
   * How much the foot rocks heel to toe, 0 to 1: all of it for a foot drawn from the side (its toe
   * well in front of the ankle), little for one pointing at the viewer, which would look broken.
   */
  footTilt: number;
  /** Half the leg's width just above the ankle: the foot beyond it goes with the foot, not the shin. */
  shinHalf: number;
}

/** An arm hanging free of the body, which swings about its shoulder. */
export interface ArmRig {
  /** Where the arm's pixels are marked in `armOf`. */
  id: number;
  /** Which side of the body it hangs on, in the picture: -1 left (with the far leg), 1 right (the near one). */
  side: -1 | 1;
  /** What it turns about. */
  shoulder: Point;
  /** The row where it parts from the body (its armpit): above it the arm blends into the shoulder. */
  armpit: number;
  hand: Point;
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
  /** The rows above the cut whose pixels blend from the body into the thighs, so the hips have no seam. */
  band: number;
  /** For each pixel of those rows over the legs, the leg it blends into (0: none). */
  bandOf: Int8Array;
  /** The arms that swing (none when they are folded, on the hips or not apart from the body). */
  arms: ArmRig[];
  /** For each pixel, the arm it belongs to (0: none). */
  armOf: Int8Array;
  /** A leg held up in the picture (a kick, a skip) while the other stands: not drawn, the standing one walks for both. */
  raised: Uint8Array | null;
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
  /** Each arm's swing, degrees from hanging (above 0 the hand is in front), in the order of `rig.arms`. */
  arms: number[];
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
  const figure = (x: number, y: number) => alpha(x, y) > ALPHA && !shadow?.[y * w + x];
  if (shadow) {
    bottom = -1;
    for (let y = h - 1; y >= 0 && bottom < 0; y--) for (let x = 0; x < w; x++) if (figure(x, y)) (bottom = y);
  }
  const height = bottom - top + 1;

  const runsWhere = (y: number, solid: (x: number, y: number) => boolean): Array<[number, number]> => {
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
        // The last pixel that was on (at the picture's right edge, x is already past it).
        runs.push([start, x - gap - (x === w ? 1 : 0)]);
        start = -1;
        gap = 0;
      }
    }
    return runs;
  };

  // The arms first, so a hand hanging beside a leg is not taken for part of it.
  const { arms, armOf } = findArms(src, top, bottom, (y) => runsWhere(y, figure), figure);
  const solid = (x: number, y: number) => figure(x, y) && !armOf[y * w + x];
  const runsOf = (y: number) => runsWhere(y, solid);

  const legOf = new Int8Array(w * h);
  // Feet start near the bottom; one may stand a little higher than the other.
  const footBand = Math.max(3, Math.round(height * 0.1));
  // Legs end below the hips, which are below the armpits.
  // (Taken from a pair of arms, the higher armpit: one part hanging from the body may be a leg held up.)
  const ceiling = Math.max(bottom - Math.round(height * 0.62), arms.length === 2 ? Math.min(...arms.map((a) => a.armpit)) + Math.round(height * 0.08) : 0);
  let previous: Array<{ x0: number; x1: number; leg: number }> = [];
  let legs = 0;
  const widths: number[] = [];
  let cut = top;
  let lastWidth = 0;
  // Each leg's edges, row by row going up.
  const edges = new Map<number, Array<[number, number]>>();
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
      else if (touching.length === 1) {
        // Something joining the leg from one side (a tail, a hand) widens it at once on that side:
        // the leg carries on within its own edges, and what joined stays with the body. (Widening on
        // both sides is the leg itself, or the hips.)
        // Compared with the leg a few rows down, as a tail can join it over a few rows.
        const leg = touching[0]!;
        const seen = edges.get(leg) ?? [];
        const [a, b] = seen[Math.max(0, seen.length - 6)] ?? [x0, x1];
        const allow = Math.max(height * 0.02, (b - a + 1) * 0.35);
        const give = Math.max(2, Math.round((b - a + 1) * 0.08));
        // (A leaning leg moves both edges the same way; something joining it widens it on one side.)
        let [from, to] = [x0, x1];
        const grown = x1 - x0 - (b - a) > allow;
        const [left, right] = [a - x0, x1 - b];
        if (!inBand && grown && left > allow && left > 2.5 * Math.max(1, right)) from = a - give;
        if (!inBand && grown && right > allow && right > 2.5 * Math.max(1, left)) to = b + give;
        here.push({ x0: from, x1: to, leg });
      }
      else if (inBand && legs < 4) here.push({ x0, x1, leg: ++legs });
    }
    if (!here.length && inBand && !merged) {
      // Specks under the feet (a stray pixel, the edge of a shadow) that lead nowhere: start again above them.
      legOf.fill(0);
      previous = [];
      legs = 0;
      widths.length = 0;
      edges.clear();
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
    for (const id of new Set(here.map((r) => r.leg))) {
      const own = here.filter((r) => r.leg === id);
      const list = edges.get(id) ?? [];
      list.push([Math.min(...own.map((r) => r.x0)), Math.max(...own.map((r) => r.x1))]);
      edges.set(id, list);
    }
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
  // An "arm" leaving the body at the hips is a leg (held up), not an arm.
  for (const arm of arms.filter((a) => a.armpit >= cut - height * 0.05)) {
    for (let i = 0; i < armOf.length; i++) if (armOf[i] === arm.id) armOf[i] = 0;
    arms.splice(arms.indexOf(arm), 1);
  }
  const raised = kept.length === 1 ? raisedLeg(src, cut, bottom, solid, runsOf, legOf, kept[0]!) : null;
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
    // A foot drawn from the side sticks out in front of its ankle; one facing the viewer sticks out both ways.
    const ahead = Math.max(0, ...foot.map(([dx]) => dx));
    const behind = Math.max(0, ...foot.map(([dx]) => -dx));
    const footTilt = 0.6 + 0.4 * Math.min(1, Math.max(0, ((ahead - behind) / Math.max(1, ahead + behind) - 0.1) / 0.35));
    const shin = span(id, Math.max(cut, Math.round(ankleY - footHeight * 0.5)));
    const shinHalf = shin ? Math.max(ankleX - shin[0], shin[1] - ankleX) + 1 : footHeight;
    return { id, hip: { x: hipX, y: pivot }, knee: { x: kneeX, y: kneeY }, ankle: { x: ankleX, y: ankleY }, sole, footHeight, foot, minX, maxX, footTilt, shinHalf };
  });
  // Far leg first: the one further back (left, facing right).
  legRigs.sort((a, b) => a.hip.x - b.hip.x);
  const hipX = legRigs.reduce((n, l) => n + l.hip.x, 0) / legRigs.length;
  const ankle = ground - legRigs.reduce((n, l) => n + l.footHeight, 0) / legRigs.length;
  const reach = ankle - pivot;

  // The hips: the rows just above the cut, over the tops of the legs, blend into the thighs. Each
  // pixel goes with the leg nearer to it (the near one, when one leg is drawn twice).
  const band = Math.max(2, Math.round(reach * 0.14));
  const bandOf = new Int8Array(w * h);
  const tops = legRigs.map((l): [number, number] => span(l.id, cut) ?? [l.minX, l.maxX]);
  const from = Math.min(...tops.map((t) => t[0]));
  const to = Math.max(...tops.map((t) => t[1]));
  for (let y = Math.max(top, cut - band); y < cut; y++) {
    for (let x = from; x <= to; x++) {
      if (!solid(x, y)) continue;
      let best = legRigs[legRigs.length - 1]!;
      if (legRigs.length > 1) for (const l of legRigs) if (Math.abs(x - l.hip.x) < Math.abs(x - best.hip.x)) best = l;
      bandOf[y * w + x] = best.id;
    }
  }

  return { ground, cut, pivot, ankle, reach, hipX, legs: legRigs, figureHeight: height, legOf, band, bandOf, arms, armOf, raised, shadow, shadowFill };
}

/**
 * With only one leg on the ground, the other may be held up beside it (a kick, a skip): a big piece
 * of the picture below the hips that is not the standing leg and does not reach the ground. It
 * would otherwise hang there while the standing leg walks for both.
 */
function raisedLeg(src: Bitmap, cut: number, bottom: number, solid: (x: number, y: number) => boolean, runsOf: (y: number) => Array<[number, number]>, legOf: Int8Array, leg: number): Uint8Array | null {
  const w = src.width;
  const legRows = bottom + 1 - cut;
  let legArea = 0;
  for (let y = cut; y <= bottom; y++) for (let x = 0; x < w; x++) if (legOf[y * w + x] === leg) legArea++;
  // The pieces of the picture in the legs' rows that are not the standing leg.
  const seen = new Uint8Array(w * (bottom + 1));
  const pieces: Array<{ pixels: number[]; high: number; low: number; left: number; right: number }> = [];
  for (let y0 = cut; y0 <= bottom; y0++) {
    for (let x0 = 0; x0 < w; x0++) {
      const start = y0 * w + x0;
      if (seen[start] || legOf[start] || !solid(x0, y0)) continue;
      const piece = { pixels: [] as number[], high: y0, low: y0, left: x0, right: x0 };
      const queue = [start];
      seen[start] = 1;
      while (queue.length) {
        const at = queue.pop()!;
        piece.pixels.push(at);
        const x = at % w;
        const y = (at - x) / w;
        piece.low = Math.max(piece.low, y);
        piece.left = Math.min(piece.left, x);
        piece.right = Math.max(piece.right, x);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= w || ny < cut || ny > bottom) continue;
            const n = ny * w + nx;
            if (!seen[n] && !legOf[n] && solid(nx, ny)) (seen[n] = 1), queue.push(n);
          }
        }
      }
      pieces.push(piece);
    }
  }
  const leg2 = pieces.find((p) => p.pixels.length >= legArea * 0.35 && p.low - p.high >= legRows * 0.25 && p.low < bottom - legRows * 0.08);
  if (!leg2) return null;
  const raised = new Uint8Array(legOf.length);
  // It, and crumbs of it (a lace, the edge of a sole) that came apart from it.
  const margin = (leg2.right - leg2.left) * 0.15;
  for (const p of pieces) {
    if (p === leg2 || (p.pixels.length < legArea * 0.05 && p.left >= leg2.left - margin && p.right <= leg2.right + margin && p.low <= leg2.low + 2)) {
      for (const at of p.pixels) raised[at] = 1;
    }
  }
  // Rows above the legs' that rest only on it (the top of a boot just over the line) are it too.
  for (let y = cut - 1; y >= Math.max(0, cut - legRows * 0.15); y--) {
    let more = false;
    for (const [x0, x1] of runsOf(y)) {
      let on = false;
      let other = false;
      for (let x = Math.max(0, x0 - 1); x <= Math.min(w - 1, x1 + 1); x++) {
        const below = (y + 1) * w + x;
        if (raised[below]) on = true;
        else if (solid(x, y + 1)) other = true;
      }
      if (on && !other) {
        for (let x = x0; x <= x1; x++) raised[y * w + x] = 1;
        more = true;
      }
    }
    if (!more) break;
  }
  // The leg carries on up into the body (under a coat, into the hips). Up each column, as far as it
  // looks like the leg's top (its colour, a few odd pixels aside); smoothed across, so the hem it
  // leaves is a curve rather than a comb.
  const topRows = leg2.pixels.filter((at) => at < (cut + Math.max(4, legRows * 0.06)) * w);
  const colour = [0, 1, 2].map((c) => topRows.reduce((n, at) => n + src.data[at * 4 + c]!, 0) / Math.max(1, topRows.length));
  const left = Math.min(...topRows.map((at) => at % w));
  const right = Math.max(...topRows.map((at) => at % w));
  const most = Math.round(legRows * 0.3);
  const depth: number[] = [];
  for (let x = left; x <= right; x++) {
    let d = 0;
    let odd = 0;
    for (let up = 1; up <= most; up++) {
      const y = cut - up;
      const at = y * w + x;
      if (y < 0 || !solid(x, y) || legOf[at]) break;
      const far = Math.hypot(...[0, 1, 2].map((c) => src.data[at * 4 + c]! - colour[c]!)) > 80;
      if (far && ++odd > 3) break;
      if (!far) (odd = 0), (d = up);
    }
    depth.push(d);
  }
  const reach = Math.max(2, Math.round((right - left) * 0.08));
  depth.forEach((_, i) => {
    const near = depth.slice(Math.max(0, i - reach), i + reach + 1).sort((a, b) => a - b);
    const d = near[Math.floor(near.length / 2)]!;
    const x = left + i;
    for (let up = 1; up <= d; up++) if (!legOf[(cut - up) * w + x]) raised[(cut - up) * w + x] = 1;
  });
  return raised;
}

/**
 * The arms that can swing: below the shoulders, a part of the picture beside the body with a gap
 * between them, which leaves the body at its top (the armpit) and ends in a hand, without touching
 * the body again (a hand on a hip) or reaching the ground (a leg, a tail on the floor). Above the
 * armpit, the outside of the shoulder goes with the arm, blending into the body.
 */
function findArms(src: Bitmap, top: number, bottom: number, runsAt: (y: number) => Array<[number, number]>, solid: (x: number, y: number) => boolean): { arms: ArmRig[]; armOf: Int8Array } {
  const { width: w, height: h, data } = src;
  const height = bottom - top + 1;
  const armOf = new Int8Array(w * h);
  // The middle of the body, across: half way through the figure's pixels, row by row, over its middle.
  const middles: number[] = [];
  for (let y = Math.round(top + height * 0.3); y <= top + height * 0.7; y++) {
    let sum = 0;
    let n = 0;
    for (let x = 0; x < w; x++) if (solid(x, y)) (sum += x), n++;
    if (n) middles.push(sum / n);
  }
  if (!middles.length) return { arms: [], armOf };
  const torsoX = middles.sort((a, b) => a - b)[Math.floor(middles.length / 2)]!;
  const bodyRun = (runs: Array<[number, number]>) => {
    let best = -1;
    let distance = Infinity;
    runs.forEach(([x0, x1], i) => {
      const d = torsoX < x0 ? x0 - torsoX : torsoX > x1 ? torsoX - x1 : 0;
      if (d < distance) (distance = d), (best = i);
    });
    return best;
  };

  interface Part { side: -1 | 1; spans: Map<number, [number, number]>; top: number; last: number; fromBody: boolean; ends: 'open' | 'free' | 'body' | 'joined' }
  const parts: Part[] = [];
  let previous: Array<{ x0: number; x1: number; part: Part }> = [];
  let previousBody: [number, number] | null = null;
  const near = (a: [number, number] | null, x0: number, x1: number) => !!a && a[0] <= x1 + 2 && a[1] >= x0 - 2;
  const from = Math.round(top + height * 0.2);
  const until = Math.round(bottom - height * 0.04);
  for (let y = from; y <= until; y++) {
    const runs = runsAt(y);
    const b = bodyRun(runs);
    const body = b >= 0 ? runs[b]! : null;
    const here: typeof previous = [];
    runs.forEach(([x0, x1], i) => {
      if (i === b) return;
      const touching = [...new Set(previous.filter((p) => p.x0 <= x1 + 1 && p.x1 >= x0 - 1).map((p) => p.part))];
      let part: Part;
      if (touching.length === 1) part = touching[0]!;
      else {
        part = { side: (x0 + x1) / 2 < torsoX ? -1 : 1, spans: new Map(), top: y, last: y, fromBody: y > from && near(previousBody, x0, x1), ends: 'open' };
        parts.push(part);
        for (const t of touching) t.ends = 'joined'; // two parts meeting: not a plain arm
        if (touching.length > 1) part.ends = 'joined';
      }
      const had = part.spans.get(y);
      part.spans.set(y, had ? [Math.min(had[0], x0), Math.max(had[1], x1)] : [x0, x1]);
      part.last = y;
      here.push({ x0, x1, part });
    });
    // Parts that stopped: did they run back into the body (a hand on the hip), or end in a hand?
    for (const p of new Set(previous.map((q) => q.part))) {
      if (p.ends !== 'open' || here.some((q) => q.part === p)) continue;
      const last = p.spans.get(p.last)!;
      p.ends = near(body, last[0], last[1]) ? 'body' : 'free';
    }
    previous = here;
    previousBody = body;
  }

  const arms: ArmRig[] = [];
  for (const p of parts) {
    const long = p.last - p.top + 1;
    // It hangs from the body, ends in a hand below the middle of the figure (not a plait beside the
    // face), and does not reach the ground.
    if (!p.fromBody || p.ends !== 'free' || long < height * 0.07 || p.top < top + height * 0.15 || p.last < top + height * 0.5 || p.last > bottom - height * 0.1) continue;
    // Not too wide for an arm (a wing, a cape, a big bag).
    const widths = [...p.spans.values()].map(([a, b]) => b - a + 1).sort((a, b) => a - b);
    const width = widths[Math.floor(widths.length / 2)]!;
    if (width > height * 0.16 || width > long * 1.2) continue;
    const id = arms.length + 1;
    if (id > 2) break;
    const first = p.spans.get(p.top)!;
    const armWidth = Math.max(...[...p.spans.entries()].filter(([y]) => y < p.top + Math.max(3, long * 0.2)).map(([, [a, b]]) => b - a + 1));
    const shoulder = { x: (first[0] + first[1]) / 2 + p.side * armWidth * 0.1, y: Math.max(top + height * 0.12, p.top - Math.round(armWidth * 0.9)) };
    for (const [y, [x0, x1]] of p.spans) for (let x = x0; x <= x1; x++) if (solid(x, y)) armOf[y * w + x] = id;
    // The outside of the shoulder, above the armpit: beyond the arm's inner edge.
    const inner = p.side < 0 ? first[1] : first[0];
    for (let y = Math.ceil(shoulder.y); y < p.top; y++) {
      for (let x = 0; x < w; x++) {
        const outside = p.side < 0 ? x <= inner && x >= first[0] - armWidth : x >= inner && x <= first[1] + armWidth;
        if (outside && solid(x, y)) armOf[y * w + x] = id;
      }
    }
    // Fingers touching something else (a leg, a pocket) carry on past where the arm stood apart:
    // from the lower arm, outwards into what touches it and looks like the hand, not far.
    const end = p.spans.get(p.last)!;
    const palm = [...p.spans.entries()].filter(([y]) => y > p.last - Math.max(3, long * 0.15));
    const colours: number[][] = [];
    for (const [y, [x0, x1]] of palm) for (let x = x0; x <= x1; x++) if (solid(x, y)) colours.push([0, 1, 2].map((c) => data[(y * w + x) * 4 + c]!));
    const colour = [0, 1, 2].map((c) => colours.reduce((n, k) => n + k[c]!, 0) / Math.max(1, colours.length));
    const reach = Math.max(3, height * 0.04);
    // What the hand touches, for comparison: the rest of the figure around the hand.
    const around: number[][] = [];
    for (let y = Math.round(p.top + long / 2); y <= Math.min(bottom, p.last + reach); y++) {
      for (let x = Math.max(0, Math.round(end[0] - reach)); x <= Math.min(w - 1, end[1] + reach); x++) if (solid(x, y) && !armOf[y * w + x]) around.push([0, 1, 2].map((c) => data[(y * w + x) * 4 + c]!));
    }
    const other = [0, 1, 2].map((c) => around.reduce((n, k) => n + k[c]!, 0) / Math.max(1, around.length));
    const handLike = (at: number) => {
      const d = (k: number[]) => Math.hypot(...[0, 1, 2].map((c) => data[at * 4 + c]! - k[c]!));
      return around.length ? d(colour) < d(other) && d(colour) < 160 : d(colour) < 60;
    };
    const queue: number[] = [];
    for (const [y, [x0, x1]] of p.spans) if (y > p.top + long / 2) for (let x = x0; x <= x1; x++) if (armOf[y * w + x] === id) queue.push(y * w + x);
    let last = p.last;
    while (queue.length) {
      const at = queue.pop()!;
      const x = at % w;
      const y = (at - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < p.top || ny > bottom || armOf[ny * w + nx] || !solid(nx, ny)) continue;
        if (nx < end[0] - reach || nx > end[1] + reach || ny > p.last + reach) continue;
        if (!handLike(ny * w + nx)) continue;
        armOf[ny * w + nx] = id;
        last = Math.max(last, ny);
        queue.push(ny * w + nx);
      }
    }
    // And the hand's outline there: dark pixels lying mostly against the hand.
    const dark = (at: number) => data[at * 4]! + data[at * 4 + 1]! + data[at * 4 + 2]! < 240;
    for (let pass = 0; pass < 2; pass++) {
      const taken: number[] = [];
      for (let y = Math.round(p.top + long / 2); y <= Math.min(bottom, last + 2); y++) {
        for (let x = Math.max(1, Math.round(end[0] - reach)); x <= Math.min(w - 2, end[1] + reach); x++) {
          const at = y * w + x;
          if (armOf[at] || !solid(x, y) || !dark(at)) continue;
          let arm = 0;
          let rest = 0;
          for (let j = -1; j <= 1; j++) {
            for (let i = -1; i <= 1; i++) {
              const n = (y + j) * w + x + i;
              if (armOf[n] === id) arm++;
              else if (solid(x + i, y + j) && !dark(n)) rest++;
            }
          }
          if (arm >= 2 && rest <= 1) taken.push(at);
        }
      }
      for (const at of taken) armOf[at] = id;
    }
    arms.push({ id, side: p.side, shoulder, armpit: p.top, hand: { x: (end[0] + end[1]) / 2, y: last } });
  }
  return { arms, armOf };
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
      const degrees = plan.tilt * leg.footTilt;
      // The foot turned with its tilt: its lowest pixel is what touches the ground (the heel when
      // landing, the toe when pushing off), so the ankle goes that far above the ground.
      const low = footLow(leg, degrees);
      // Each foot keeps to its own ground: in a three-quarter view the far foot stands a little higher.
      const onGround = leg.sole - low;
      const y = plan.planted ? onGround : Math.min(onGround, leg.sole - leg.footHeight - plan.lift * R);
      // Both feet step along one line under the middle of the hips, so they meet when passing.
      return { ankle: { x: margin + rig.hipX + plan.x * step, y }, sole: y + low, planted: plan.planted, tilt: degrees };
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
    const body: Bone = { from: { x: 0, y: 0 }, to: { x: margin, y: drop }, turn: 0 };
    const skin = new Skin(src, W, H);

    // The arms swing against the legs on their side: forwards as that leg goes back.
    const swings = rig.arms.map((arm) => {
      const phase = phases[arm.side < 0 ? 0 : 1]!;
      return -ARM_SWING * Math.cos((2 * Math.PI * phase) / WALK_FRAMES);
    });
    // The shoulders as they stand, under the arms: an arm swinging away shows its sleeve, not a notch.
    skin.draw(out, (x, y) => !!rig.armOf[y * src.width + x] && y < rig.arms.find((a) => a.id === rig.armOf[y * src.width + x])!.armpit, () => [[body, 1]], 1);
    const drawArm = (k: number) => {
      const arm = rig.arms[k]!;
      const bone: Bone = { from: arm.shoulder, to: { x: arm.shoulder.x + margin, y: arm.shoulder.y + drop }, turn: (swings[k]! * Math.PI) / 180 };
      const blend = Math.max(3, arm.armpit - arm.shoulder.y);
      skin.draw(out, (x, y) => rig.armOf[y * src.width + x] === arm.id, (_x, y) => {
        const t = smooth((y - arm.shoulder.y) / blend);
        return t >= 1 ? [[bone, 1]] : [[body, 1 - t], [bone, t]];
      }, 1);
    };
    // The far arm (on the left) behind everything, the near one in front.
    rig.arms.forEach((arm, k) => arm.side < 0 && drawArm(k));
    // The hips as they stand, under the legs: where a thigh's top moves aside, it shows the hips
    // rather than a hole.
    skin.draw(out, (x, y) => !!rig.bandOf[y * src.width + x], () => [[body, 1]], 1);

    legs.forEach((leg, i) => {
      const hip = { x: hipsX[i]!, y: hipY };
      const [l1, l2] = lengths[i]!;
      const foot = feet[i]!;
      let { knee, ankle } = solve(hip, foot.ankle, l1, l2);
      const shinOf = (k: Point, a: Point) => angleOf(a.x - k.x, a.y - k.y) - angleOf(leg.ankle.x - leg.knee.x, leg.ankle.y - leg.knee.y);
      // A foot off the ground hangs from the shin, and one pushing off peels up from its toe as the
      // shin leans back: it turns part of the way with the shin (an ankle bent far would look broken).
      // Then the leg is solved again for where that puts the ankle: a planted foot still touches the
      // ground, a lifted one still clears it.
      const pushing = foot.planted && foot.tilt > 0;
      if (!foot.planted || pushing) {
        const follow = foot.planted ? 0.35 : 0.5;
        const turn = (1 - follow) * ((-foot.tilt * Math.PI) / 180) + follow * shinOf(knee, ankle);
        const degrees = (-turn * 180) / Math.PI;
        if (!pushing || degrees > foot.tilt) {
          const low = footLow(leg, degrees);
          const y = foot.planted ? leg.sole - low : Math.min(foot.ankle.y, leg.sole - low - Math.max(2, R * 0.03));
          foot.tilt = degrees;
          foot.ankle = { x: foot.ankle.x, y };
          foot.sole = y + low;
          ({ knee, ankle } = solve(hip, foot.ankle, l1, l2));
        }
      }
      const thighTurn = angleOf(knee.x - hip.x, knee.y - hip.y) - angleOf(leg.knee.x - leg.hip.x, leg.knee.y - leg.hip.y);
      const shinTurn = shinOf(knee, ankle);
      const thigh: Bone = { from: leg.hip, to: hip, turn: thighTurn };
      const shin: Bone = { from: leg.knee, to: knee, turn: shinTurn };
      const sole: Bone = { from: leg.ankle, to: ankle, turn: (-foot.tilt * Math.PI) / 180 };
      // Where one bone gives way to the next: the hips (from the body), the knee, the ankle.
      const hips = [rig.cut - rig.band, rig.cut + rig.band * 0.5];
      const kneeBlend = Math.max(2, R * 0.09);
      // One leg drawn twice: the near copy has the hips; the far one starts at the cut, behind them.
      const withHips = !single || i === 1;
      const k = i === 0 ? shade : 1;
      const mine = (x: number, y: number) => rig.legOf[y * src.width + x] === leg.id || (withHips && rig.bandOf[y * src.width + x] === leg.id);
      // The foot first, stiff, as a puppet's would be: an ankle can bend further than a blend could
      // follow without smearing a boot. The shin is drawn over its top, which hides the joint.
      const ankleOverlap = Math.max(2, R * 0.05);
      skin.draw(out, (x, y) => y >= leg.ankle.y && mine(x, y), () => [[sole, 1]], k, rig.ground);
      skin.draw(out, (x, y) => mine(x, y) && (y < leg.ankle.y || (y < leg.ankle.y + ankleOverlap && Math.abs(x + 0.5 - leg.ankle.x) <= leg.shinHalf)), (_x, y) => {
        if (y < hips[1]!) {
          const t = smooth((y - hips[0]!) / (hips[1]! - hips[0]!));
          return [[body, 1 - t], [thigh, t]];
        }
        if (y < leg.knee.y - kneeBlend) return [[thigh, 1]];
        if (y < leg.knee.y + kneeBlend) {
          const t = smooth((y - leg.knee.y + kneeBlend) / (2 * kneeBlend));
          return [[thigh, 1 - t], [shin, t]];
        }
        return [[shin, 1]];
      }, k, rig.ground);
      // Keep the planned ankle as drawn (the same unless a leg could not reach).
      foot.ankle = ankle;
    });
    // The body rides on the hips.
    for (let y = 0; y < src.height; y++) {
      const ty = y + drop;
      if (ty >= H) break;
      for (let x = 0; x < src.width; x++) {
        const s = (y * src.width + x) * 4;
        const at = y * src.width + x;
        if (src.data[s + 3]! === 0 || rig.legOf[at] || rig.bandOf[at] || rig.armOf[at] || rig.raised?.[at] || rig.shadow?.[at]) continue;
        over(out, (ty * W + x + margin) * 4, src.data, s, 1);
      }
    }
    rig.arms.forEach((arm, k) => arm.side > 0 && drawArm(k));
    frames.push({ bitmap: { width: W, height: H, data: out }, drop, feet, arms: swings });
  }
  return trim({ mode: 'legs', width: W, height: H, frames, rig, step, ground: rig.ground, left: margin }, src.width);
}

/** How far below the ankle a foot reaches, turned by `degrees` (above 0, heel up): what touches the ground. */
function footLow(leg: LegRig, degrees: number): number {
  const tilt = (degrees * Math.PI) / 180;
  let low = 0;
  for (const [dx, dy] of leg.foot) low = Math.max(low, dx * Math.sin(tilt) + dy * Math.cos(tilt) + 0.5);
  return low;
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

/** A bone's movement: the picture's point `from` lands on `to`, the part turned by `turn` (radians, from down towards the front). */
interface Bone {
  from: Point;
  to: Point;
  turn: number;
}

/** How far each arm swings either way at its most, degrees. */
const ARM_SWING = 15;

/** 0 to 1, easing in and out. */
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/** Subsamples a pixel is split into each way: enough that a stretched joint has no holes. */
const SUB = 3;

/**
 * Draws parts of the picture that move with blended bones (skinning). Every pixel of a part is cut
 * into SUB × SUB samples, each moved by the bones' movements weighted for where it is, and laid
 * where it lands (spread over the four pixels around it); what a frame pixel gets is averaged. A sample half way along a knee
 * moves half with the thigh and half with the shin, so the leg bends smoothly instead of breaking.
 */
class Skin {
  private readonly src: Bitmap;
  private readonly W: number;
  private readonly H: number;
  private readonly sum: Float32Array;
  private readonly weight: Float32Array;
  private readonly touched: number[] = [];

  // (No parameter properties: this file also runs in Node with its types stripped, packages/shared/bin/walk.ts.)
  constructor(src: Bitmap, W: number, H: number) {
    this.src = src;
    this.W = W;
    this.H = H;
    this.sum = new Float32Array(W * H * 4);
    this.weight = new Float32Array(W * H);
  }

  /**
   * Draws the pixels `part` picks, moved by `bones` (for a point of the picture), over `out`,
   * darkened by `shade`, and nothing on or below the row `floor` (the ground).
   */
  draw(out: Uint8ClampedArray, part: (x: number, y: number) => boolean, bones: (x: number, y: number) => Array<[Bone, number]>, shade: number, floor = Infinity) {
    const { src, W, H, sum, weight, touched } = this;
    const moves = new Map<Bone, [number, number]>();
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const s = (y * src.width + x) * 4;
        const a = src.data[s + 3]!;
        if (a === 0 || !part(x, y)) continue;
        for (let j = 0; j < SUB; j++) {
          const py = y + (j + 0.5) / SUB;
          const weights = bones(x, py);
          for (let i = 0; i < SUB; i++) {
            const px = x + (i + 0.5) / SUB;
            let tx = 0;
            let ty = 0;
            for (const [bone, weight] of weights) {
              let cs = moves.get(bone);
              if (!cs) moves.set(bone, (cs = [Math.cos(bone.turn), Math.sin(bone.turn)]));
              const dx = px - bone.from.x;
              const dy = py - bone.from.y;
              tx += weight * (bone.to.x + dx * cs[0] + dy * cs[1]);
              ty += weight * (bone.to.y - dx * cs[1] + dy * cs[0]);
            }
            // Spread over the four pixels around where it lands (bilinear), so samples pulled apart
            // at a joint still meet.
            const fx = tx - 0.5;
            const fy = ty - 0.5;
            const ox = Math.floor(fx);
            const oy = Math.floor(fy);
            const u = fx - ox;
            const v = fy - oy;
            const f = a / 255;
            for (let q = 0; q < 4; q++) {
              const px2 = ox + (q & 1);
              const py2 = oy + (q >> 1);
              if (px2 < 0 || py2 < 0 || px2 >= W || py2 >= H || py2 >= floor) continue;
              const k = (q & 1 ? u : 1 - u) * (q >> 1 ? v : 1 - v);
              if (k <= 0) continue;
              const o = py2 * W + px2;
              if (!weight[o]) touched.push(o);
              weight[o]! += k;
              sum[o * 4]! += src.data[s]! * f * k;
              sum[o * 4 + 1]! += src.data[s + 1]! * f * k;
              sum[o * 4 + 2]! += src.data[s + 2]! * f * k;
              sum[o * 4 + 3]! += f * k;
            }
          }
        }
      }
    }
    // Lay what landed over the frame: a pixel that got only a few samples is at the part's edge.
    const pixel = new Uint8ClampedArray(4);
    for (const o of touched) {
      const n = weight[o]!;
      const alpha = sum[o * 4 + 3]!;
      if (alpha > 0) {
        pixel[0] = sum[o * 4]! / alpha;
        pixel[1] = sum[o * 4 + 1]! / alpha;
        pixel[2] = sum[o * 4 + 2]! / alpha;
        pixel[3] = Math.round((alpha / n) * Math.min(1, n / (SUB * SUB * 0.3)) * 255);
        over(out, o * 4, pixel, 0, shade);
      }
      weight[o] = 0;
      sum.fill(0, o * 4, o * 4 + 4);
    }
    touched.length = 0;
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
    frames.push({ bitmap: { width: W, height: h, data: out }, drop, feet: [], arms: [] });
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
