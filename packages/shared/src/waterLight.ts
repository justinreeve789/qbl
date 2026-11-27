/**
 * Light under water (Scene.water_lights): its defaults, in one place, for the game, the editor's
 * preview and the validator.
 */
import type { SceneWaterLight } from './types.js';

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
