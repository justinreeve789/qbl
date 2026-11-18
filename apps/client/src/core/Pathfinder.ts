import * as navmeshLibrary from 'navmesh';
import type { NavMesh as NavMeshType } from 'navmesh';
import { isWalkable, type Point, type WalkContext } from '@qbl/shared';

// The library is published as one CommonJS bundle. Bundlers hand over its exports directly; Node's
// own module loader (the tests) hands them over as the default export.
type Library = typeof import('navmesh');
const wrapped = navmeshLibrary as unknown as { default?: Library & { default?: Library } };
const { NavMesh, buildPolysFromGridMap }: Library = typeof navmeshLibrary.buildPolysFromGridMap === 'function' ? navmeshLibrary : (wrapped.default as Library);

/** Size of the squares the scene is sampled in to build the mesh, in scene pixels. */
const CELL = 24;
/** A scene larger than this many squares is sampled more coarsely, to keep building the mesh quick. */
const MAX_CELLS = 40_000;

/**
 * Finds a way around things. The scene's walkable areas, blocked areas and obstacles (blocking
 * items, solid objects) are sampled into a grid; the `navmesh` library merges the walkable
 * squares into a navigation mesh and finds the shortest path across it, pulled tight around
 * corners. The avatar then walks that path one corner at a time.
 *
 * The mesh is only as fine as the grid, so the path is a guide: each step is still checked by
 * the same "feet inside polygons" rule as before, which is what the game server checks too.
 */
export class Pathfinder {
  private mesh: NavMeshType | null = null;
  private cell = CELL;

  constructor(private ctx: WalkContext) {
    const { width, height } = ctx;
    if (!(width > 0) || !(height > 0)) return;
    while ((width / this.cell) * (height / this.cell) > MAX_CELLS) this.cell *= 2;
    const cols = Math.ceil(width / this.cell);
    const rows = Math.ceil(height / this.cell);
    const grid: boolean[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: boolean[] = [];
      for (let c = 0; c < cols; c++) row.push(this.open(c, r));
      grid.push(row);
    }
    const polygons = buildPolysFromGridMap(grid, this.cell, this.cell, (walkable) => walkable);
    if (polygons.length) this.mesh = new NavMesh(polygons);
  }

  /** A square is open when its centre and its four corners (pulled in a little) can all be stood on. */
  private open(c: number, r: number): boolean {
    const s = this.cell;
    const inset = s * 0.2;
    const x0 = c * s + inset, x1 = (c + 1) * s - inset, y0 = r * s + inset, y1 = (r + 1) * s - inset;
    const ok = (x: number, y: number) => isWalkable(this.ctx, x, y);
    return ok(c * s + s / 2, r * s + s / 2) && ok(x0, y0) && ok(x1, y0) && ok(x0, y1) && ok(x1, y1);
  }

  /**
   * The corners to walk through to get from one point to another, ending at the destination
   * (the start is not included). Null: there is no way known, and the caller walks straight
   * for it as it always did.
   */
  find(from: Point, to: Point): Point[] | null {
    if (!this.mesh) return null;
    // A straight line that is clear needs no mesh, and keeps short walks exactly where they were clicked.
    if (this.clear(from, to)) return [to];
    const start = this.onMesh(from);
    const end = this.onMesh(to);
    if (!start || !end) return null;
    const path = this.mesh.findPath(start, end);
    if (!path || path.length < 2) return null;
    const out = path.slice(1).map((p) => ({ x: p.x, y: p.y }));
    // The mesh ends at the square the destination is in; the last step is to the spot itself.
    if (end.x !== to.x || end.y !== to.y) out.push(to);
    return this.simplify(from, out);
  }

  /** Can the avatar walk the straight line between two points? Sampled every few pixels. */
  clear(a: Point, b: Point): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(d / 6));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      if (!isWalkable(this.ctx, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  /** The point itself when it is on the mesh, or else the centre of the nearest open square around it. */
  private onMesh(p: Point): Point | null {
    const mesh = this.mesh!;
    if (mesh.isPointInMesh(p)) return p;
    const s = this.cell;
    const c0 = Math.floor(p.x / s);
    const r0 = Math.floor(p.y / s);
    for (let ring = 0; ring <= 4; ring++) {
      let best: Point | null = null;
      let bestD = Infinity;
      for (let r = r0 - ring; r <= r0 + ring; r++) {
        for (let c = c0 - ring; c <= c0 + ring; c++) {
          if (Math.max(Math.abs(r - r0), Math.abs(c - c0)) !== ring) continue;
          const q = { x: c * s + s / 2, y: r * s + s / 2 };
          const d = Math.hypot(q.x - p.x, q.y - p.y);
          if (d < bestD && mesh.isPointInMesh(q)) {
            best = q;
            bestD = d;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Drop corners that can be skipped because the way past them is clear. */
  private simplify(from: Point, path: Point[]): Point[] {
    const out: Point[] = [];
    let at = from;
    let i = 0;
    while (i < path.length) {
      let next = i;
      for (let j = path.length - 1; j > i; j--) {
        if (this.clear(at, path[j]!)) {
          next = j;
          break;
        }
      }
      out.push(path[next]!);
      at = path[next]!;
      i = next + 1;
    }
    return out;
  }
}

/** Something that changes whenever what can be walked on does: the mesh is rebuilt when it differs. */
export function walkSignature(ctx: WalkContext): string {
  return `${ctx.width}x${ctx.height}|${ctx.walkable.length}|${ctx.blocked.length}|${ctx.obstacles.map((o) => `${Math.round(o.x)},${Math.round(o.y)},${Math.round(o.radius)}`).join(';')}`;
}
