import type { Hotspot, Point, Scene } from './types.js';

export interface Circle { x: number; y: number; radius: number }

export function pointInPolygon(x: number, y: number, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const crosses = a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export interface WalkContext {
  width: number;
  height: number;
  walkable: Point[][];
  blocked: Point[][];
  /** Blocking items and similar round obstacles. */
  obstacles: Circle[];
}

export function walkContext(scene: Scene, size: { width: number; height: number }, obstacles: Circle[] = []): WalkContext {
  return {
    width: scene.width ?? size.width,
    height: scene.height ?? size.height,
    walkable: scene.walkable_areas ?? [],
    blocked: scene.blocked_areas ?? [],
    obstacles,
  };
}

/** Can an avatar's feet be at this point? */
export function isWalkable(ctx: WalkContext, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x > ctx.width || y > ctx.height) return false;
  if (ctx.walkable.length > 0 && !ctx.walkable.some((p) => pointInPolygon(x, y, p))) return false;
  if (ctx.blocked.some((p) => pointInPolygon(x, y, p))) return false;
  for (const o of ctx.obstacles) {
    const dx = x - o.x;
    const dy = y - o.y;
    if (dx * dx + dy * dy < o.radius * o.radius) return false;
  }
  return true;
}

/**
 * Move from one point toward another, sliding along edges when the direct
 * step is blocked. Returns the furthest allowed position.
 */
export function resolveMove(ctx: WalkContext, from: Point, to: Point): Point {
  if (isWalkable(ctx, to.x, to.y)) return to;
  if (isWalkable(ctx, to.x, from.y)) return { x: to.x, y: from.y };
  if (isWalkable(ctx, from.x, to.y)) return { x: from.x, y: to.y };
  return from;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Step `from` toward `to` by at most `maxStep` pixels. */
export function stepToward(from: Point, to: Point, maxStep: number): Point {
  const d = distance(from, to);
  if (d <= maxStep || d === 0) return { x: to.x, y: to.y };
  const k = maxStep / d;
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
}

/** Nearest walkable point to a target, searched on expanding rings. Used to repair bad spawn or save positions. */
export function nearestWalkable(ctx: WalkContext, target: Point, maxRadius = 600, stepSize = 20): Point | null {
  if (isWalkable(ctx, target.x, target.y)) return target;
  for (let r = stepSize; r <= maxRadius; r += stepSize) {
    const steps = Math.max(8, Math.floor((2 * Math.PI * r) / stepSize));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const x = target.x + Math.cos(a) * r;
      const y = target.y + Math.sin(a) * r;
      if (isWalkable(ctx, x, y)) return { x, y };
    }
  }
  return null;
}

/**
 * Server-side sanity check on a reported move. Clients predict their own
 * movement; the server accepts a new position when it is walkable and no
 * further than the avatar could have travelled since the last accepted one.
 */
export function validateMove(
  ctx: WalkContext,
  from: Point,
  to: Point,
  elapsedMs: number,
  speed: number,
  tolerance = 1.5,
): boolean {
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return false;
  const allowed = (speed * Math.max(elapsedMs, 0)) / 1000 * tolerance + 12;
  if (distance(from, to) > allowed) return false;
  return isWalkable(ctx, to.x, to.y);
}

/** Is the point inside a hotspot's trigger area? Null coordinates span the whole axis; radius -1 covers everything. */
export function inHotspot(h: { position_x?: number | null; position_y?: number | null; radius?: number }, x: number, y: number): boolean {
  const r = h.radius ?? -1;
  if (r < 0) return true;
  const dx = h.position_x == null ? 0 : x - h.position_x;
  const dy = h.position_y == null ? 0 : y - h.position_y;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Rate limiter for reported movement. Travel allowance accrues with time at
 * the avatar's speed, up to a small reserve, and each accepted move spends
 * it. Unlike a per-message check this tolerates packets arriving in bursts
 * while still preventing teleporting or speed hacks.
 */
export class MoveBudget {
  private budget: number;
  private last: number;

  constructor(now: number, private reserveSeconds = 0.6, private slack = 1.25) {
    this.last = now;
    this.budget = 0;
  }

  /** Returns true and spends the allowance if `dist` pixels may be travelled now. */
  spend(now: number, dist: number, speed: number): boolean {
    const elapsed = Math.max(0, now - this.last) / 1000;
    this.last = now;
    this.budget = Math.min(speed * this.reserveSeconds, this.budget + speed * elapsed * this.slack);
    if (!Number.isFinite(dist) || dist > this.budget + 8) return false;
    this.budget = Math.max(0, this.budget - dist);
    return true;
  }

  reset(now: number): void {
    this.last = now;
    this.budget = 0;
  }
}

// ------------------------------------------------------------ depth and reveal

/**
 * How large something standing at (x, y) is drawn, as a factor of its normal size (1 = unchanged),
 * from the scene's scale areas. The same function sizes avatars, items and characters, in the
 * game and in the editor.
 */
export function scaleAt(scene: Pick<Scene, 'scale_areas'>, x: number, y: number): number {
  for (const a of scene.scale_areas ?? []) {
    if (x < a.x || x > a.x + a.width || y < a.y || y > a.y + a.height) continue;
    const t = a.height > 0 ? (y - a.y) / a.height : 1;
    const percent = a.scale_top + (a.scale_bottom - a.scale_top) * t;
    return Math.max(0.05, percent / 100);
  }
  return 1;
}

/**
 * How visible a hotspot is to an avatar at (x, y): 0 beyond its reveal radius, 1 within its
 * full radius, and in proportion in between. A hotspot without a reveal radius is always 1.
 * A coordinate the hotspot leaves empty (it spans that axis) does not count towards the distance.
 */
export function revealAmount(hotspot: Pick<Hotspot, 'position_x' | 'position_y' | 'reveal_radius' | 'reveal_full_radius'>, x: number, y: number): number {
  const outer = hotspot.reveal_radius;
  if (outer == null || outer <= 0) return 1;
  const inner = Math.min(outer, Math.max(0, hotspot.reveal_full_radius ?? outer / 2));
  const dx = hotspot.position_x == null ? 0 : x - hotspot.position_x;
  const dy = hotspot.position_y == null ? 0 : y - hotspot.position_y;
  const distance = Math.hypot(dx, dy);
  if (distance >= outer) return 0;
  if (distance <= inner) return 1;
  return (outer - distance) / (outer - inner);
}
