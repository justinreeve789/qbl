/**
 * Light under water (Scene.water_lights): its defaults, in one place, for the game, the editor's
 * preview and the validator.
 */
import type { Point, SceneWaterLight } from './types.js';

export const WATER_LIGHT_KINDS = ['ripples', 'shafts'] as const;
export type WaterLightKind = (typeof WATER_LIGHT_KINDS)[number];

/** A water light with every setting filled in. Percentages become 0 to 1 (speed may go past 1). */
export interface WaterLightSettings {
  kind: WaterLightKind;
  color: string;
  /** 0 to 1. */
  strength: number;
  /** Pixels. */
  size: number;
  /** 1 is the usual pace, 0 still. */
  speed: number;
  /** Ripples: 0 to 1. */
  tilt: number;
  /** Shafts: 0 to 1. */
  spread: number;
  edge: 'soft' | 'oval';
}

const DEFAULTS: Record<WaterLightKind, { strength: number; size: number }> = {
  ripples: { strength: 60, size: 120 },
  shafts: { strength: 40, size: 90 },
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function waterLightSettings(w: SceneWaterLight): WaterLightSettings {
  const kind: WaterLightKind = w.kind === 'shafts' ? 'shafts' : 'ripples';
  const d = DEFAULTS[kind];
  return {
    kind,
    color: w.color && /^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : '#e1f6ff',
    strength: clamp(num(w.strength, d.strength), 0, 100) / 100,
    size: clamp(num(w.size, d.size), 8, 2000),
    speed: clamp(num(w.speed, 100), 0, 500) / 100,
    tilt: clamp(num(w.tilt, 60), 0, 100) / 100,
    spread: clamp(num(w.spread, 35), 0, 100) / 100,
    edge: w.edge === 'oval' ? 'oval' : 'soft',
  };
}

/** The most corners an outline may have (the shader takes them as a fixed-size list). */
export const WATER_LIGHT_MAX_CORNERS = 16;

/** Whether a light has an outline of its own that is used: ripples with 3 or more good corners. */
export function waterLightShaped(w: SceneWaterLight): boolean {
  return w.kind !== 'shafts' && Array.isArray(w.shape) && w.shape.filter(goodPoint).length >= 3;
}

const goodPoint = (p: unknown): p is Point =>
  !!p && typeof (p as Point).x === 'number' && Number.isFinite((p as Point).x) && typeof (p as Point).y === 'number' && Number.isFinite((p as Point).y);

/** Where a water light is drawn: its box, or the bounds of its outline, with the outline's corners. */
export interface WaterLightArea {
  x: number;
  y: number;
  width: number;
  height: number;
  /** In scene pixels; null for a plain box. At most WATER_LIGHT_MAX_CORNERS. */
  corners: Point[] | null;
}

export function waterLightArea(w: SceneWaterLight): WaterLightArea {
  if (!waterLightShaped(w)) return { x: w.x, y: w.y, width: w.width, height: w.height, corners: null };
  const corners = w.shape!.filter(goodPoint).slice(0, WATER_LIGHT_MAX_CORNERS);
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, corners };
}

/**
 * The outline's corners for the shader: relative to the top left of its area, two to a vec4, in a
 * list of WATER_LIGHT_MAX_CORNERS / 2 + 1 (the last is never used but keeps indexing in range).
 */
export function waterLightCornerData(area: WaterLightArea): Float32Array {
  const data = new Float32Array((WATER_LIGHT_MAX_CORNERS / 2 + 1) * 4);
  (area.corners ?? []).forEach((p, i) => {
    data[i * 2] = p.x - area.x;
    data[i * 2 + 1] = p.y - area.y;
  });
  return data;
}

/** A first outline for a light that gets one: eight corners, an octagon fitted in its box. */
export function waterLightStartShape(w: Pick<SceneWaterLight, 'x' | 'y' | 'width' | 'height'>): Point[] {
  const cx = w.x + w.width / 2;
  const cy = w.y + w.height / 2;
  return Array.from({ length: 8 }, (_, i) => {
    const a = ((i + 0.5) / 8) * Math.PI * 2;
    return { x: Math.round(cx + Math.cos(a) * w.width / 2), y: Math.round(cy + Math.sin(a) * w.height / 2) };
  });
}
