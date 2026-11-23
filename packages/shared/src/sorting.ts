import type { Item, Point } from './types.js';

/**
 * Who is drawn in front of whom.
 *
 * Figures (avatars, characters, pets) and items standing in a scene are drawn in the order of
 * their feet: the lower on the screen, the nearer, so the later drawn. An item's "feet" are the
 * bottom of its picture. That is right for a crate or a tree, but not for something that runs
 * into the room at an angle, such as a counter, a bench seen from the side or a curved wall: its
 * picture's bottom is only where its nearest end meets the floor, and a player standing in front
 * of its far end would be drawn behind it.
 *
 * An item's `sort_line` says where it really meets the floor: points along its base, as fractions
 * of its picture. A figure whose feet are in front of that line, where it stands across the
 * picture, is drawn in front of the item; one behind it is drawn behind.
 */

/** Points along an item's base: `[x, y]`, each a fraction of its picture (0 left/top, 1 right/bottom). */
export type SortLine = Array<[number, number]>;

/** A sort line placed in a scene: its points in scene pixels, left to right, and the depth the item is drawn at. */
export interface PlacedSortLine {
  points: Point[];
  /** The item's depth: the lowest point of the line, so no one behind the line is ever drawn in front. */
  depth: number;
  /** How far across the scene the item's picture reaches. */
  left: number;
  right: number;
}

/**
 * An item's sort line, tidied: at least two points of numbers between 0 and 1, in order from
 * left to right. Null when it has none (it sorts by the bottom of its picture) or it is unusable.
 */
export function sortLineOf(item: Pick<Item, 'sort_line'> | null | undefined): SortLine | null {
  const raw = item?.sort_line;
  if (!Array.isArray(raw)) return null;
  const points: SortLine = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Number(p[0]);
    const y = Number(p[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([clamp01(x), clamp01(y)]);
  }
  if (points.length < 2) return null;
  return points.sort((a, b) => a[0] - b[0]);
}

/**
 * Put an item's sort line in the scene: its picture is drawn standing on (`x`, `y`), the middle of
 * its bottom edge, `width` × `height` pixels, mirrored when `flipped`.
 */
export function placeSortLine(line: SortLine, at: { x: number; y: number; width: number; height: number; flipped?: boolean }): PlacedSortLine {
  const { x, y, width, height } = at;
  const points = line
    .map(([fx, fy]) => ({ x: x + (at.flipped ? 0.5 - fx : fx - 0.5) * width, y: y - (1 - fy) * height }))
    .sort((a, b) => a.x - b.x);
  return { points, depth: Math.max(...points.map((p) => p.y)), left: x - width / 2, right: x + width / 2 };
}

/** Where the line is at `x`: straight between its points, and level beyond its ends. */
export function lineYAt(points: Point[], x: number): number {
  if (points.length === 0) return 0;
  if (x <= points[0]!.x) return points[0]!.y;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    if (x <= b.x) return b.x === a.x ? Math.max(a.y, b.y) : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
  }
  return points[points.length - 1]!.y;
}

/**
 * The depth to draw a figure at whose feet are at (`x`, `y`) and which is `halfWidth` pixels wide
 * either side of them. Normally `y`. Where the figure overlaps an item with a sort line and is in
 * front of the line but above the item's own depth, it is lifted to just in front of the item.
 * Figures lifted in front of the same item keep their order among themselves, and anything a
 * figure carries (drawn up to 0.6 either side of it) stays in front of the item too.
 */
export function sortDepth(lines: Iterable<PlacedSortLine>, x: number, y: number, halfWidth = 0): number {
  let depth = y;
  for (const line of lines) {
    if (x + halfWidth < line.left || x - halfWidth > line.right) continue;
    if (y >= line.depth) continue;
    const at = lineYAt(line.points, x);
    if (y < at) continue;
    // In front of the line: between 0.7 and 0.9 in front of the item, nearer the nearer it stands.
    const top = Math.min(...line.points.map((p) => p.y));
    const near = line.depth > top ? (y - top) / (line.depth - top) : 1;
    depth = Math.max(depth, line.depth + 0.7 + 0.2 * clamp01(near));
  }
  return depth;
}

/**
 * Where an item's picture meets the floor, found from its pixels (RGBA, `width` × `height`): the
 * lowest solid pixel of each column, simplified to a few points. Thin bits that stick out (a tray
 * on the end, a handle) are skipped. Null when the picture has nothing solid in it.
 */
export function findSortLine(rgba: ArrayLike<number>, width: number, height: number, alphaCut = 128): SortLine | null {
  if (width < 2 || height < 1) return null;
  const bottoms: Array<number | null> = [];
  const solid: number[] = [];
  for (let x = 0; x < width; x++) {
    let low = -1;
    let count = 0;
    for (let y = 0; y < height; y++) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) >= alphaCut) {
        low = y;
        count++;
      }
    }
    bottoms.push(low < 0 ? null : low + 1);
    solid.push(count);
  }
  const counted = solid.filter((c) => c > 0).sort((a, b) => a - b);
  if (counted.length === 0) return null;
  const median = counted[Math.floor(counted.length / 2)]!;
  // Columns less than half as solid as most are something sticking out (a tray, the lip of a top), not the base.
  const base: Point[] = [];
  bottoms.forEach((b, x) => {
    if (b != null && solid[x]! >= median * 0.5) base.push({ x: x + 0.5, y: b });
  });
  if (base.length < 2) return null;
  // Fewer points the better: loosen the tolerance until it fits in eight.
  let tolerance = height * 0.015;
  let points = simplify(base, tolerance);
  while (points.length > 8) points = simplify(base, (tolerance *= 1.5));
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return points.map((p) => [round(p.x / width), round(p.y / height)] as [number, number]);
}

/** Douglas–Peucker: the fewest of `points` that stay within `tolerance` of all of them. */
function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const a = points[0]!;
  const b = points[points.length - 1]!;
  let far = -1;
  let farthest = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(points[i]!.y - lineYAt([a, b], points[i]!.x));
    if (d > farthest) {
      farthest = d;
      far = i;
    }
  }
  if (farthest <= tolerance) return [a, b];
  return [...simplify(points.slice(0, far + 1), tolerance).slice(0, -1), ...simplify(points.slice(far), tolerance)];
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
