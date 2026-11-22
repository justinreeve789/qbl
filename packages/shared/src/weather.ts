/**
 * Weather and flowing water (Scene.weather, Scene.flows, the weather action): their defaults, in one
 * place, for the game, the editor's preview and the validator.
 */
import type { SceneFlow, SceneWeather, WeatherAction, WeatherKind } from './types.js';

export const WEATHER_KINDS: WeatherKind[] = ['rain', 'snow', 'storm', 'blizzard', 'fog'];

export const FLOW_KINDS = ['river', 'stream', 'waterfall', 'sea', 'lake'] as const;

/** Weather with every setting filled in. */
export interface WeatherSettings {
  kind: WeatherKind;
  intensity: number;
  wind: number;
  lightning: boolean;
  /** 0 to 1. */
  darken: number;
  sound: boolean;
}

/** What weatherSettings() reads: a scene's weather, or a weather action. */
export type WeatherLike = Pick<SceneWeather, 'intensity' | 'wind' | 'lightning' | 'darken' | 'sound'> & { kind: SceneWeather['kind'] | WeatherAction['kind'] };

const DARKEN: Record<WeatherKind, number> = { rain: 15, snow: 5, storm: 35, blizzard: 18, fog: 5 };
const WIND: Record<WeatherKind, number> = { rain: 0.15, snow: 0.1, storm: 0.6, blizzard: 0.8, fog: 0.08 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A scene's weather or a weather action, with its defaults. Null for none (or `clear`). */
export function weatherSettings(w: WeatherLike | null | undefined): WeatherSettings | null {
  if (!w || !(WEATHER_KINDS as string[]).includes(w.kind)) return null;
  const kind = w.kind as WeatherKind;
  const darken = w.darken;
  return {
    kind,
    intensity: clamp(num(w.intensity, kind === 'storm' || kind === 'blizzard' ? 0.85 : 0.6), 0, 1),
    wind: clamp(num(w.wind, WIND[kind]), -1, 1),
    lightning: w.lightning ?? kind === 'storm',
    darken: clamp(num(darken, DARKEN[kind]), 0, 100) / 100,
    sound: w.sound !== false,
  };
}

/** A flow with every setting filled in. */
export interface FlowSettings {
  kind: NonNullable<SceneFlow['kind']>;
  direction: NonNullable<SceneFlow['direction']> | 'still';
  speed: number;
  color: string;
  layer: 'behind' | 'over';
  sound: boolean;
}

const FLOW: Record<NonNullable<SceneFlow['kind']>, { color: string; speed: number; direction: FlowSettings['direction'] }> = {
  river: { color: '#3f86c4', speed: 70, direction: 'right' },
  stream: { color: '#5aa6d6', speed: 55, direction: 'right' },
  waterfall: { color: '#6fb6e6', speed: 260, direction: 'down' },
  sea: { color: '#2d78b0', speed: 18, direction: 'still' },
  lake: { color: '#3c7fae', speed: 10, direction: 'still' },
};

export function flowSettings(f: SceneFlow): FlowSettings {
  const kind = f.kind && FLOW[f.kind] ? f.kind : 'river';
  const d = FLOW[kind];
  return {
    kind,
    direction: f.direction ?? d.direction,
    speed: Math.max(0, num(f.speed, d.speed)),
    color: f.color && /^#[0-9a-fA-F]{6}$/.test(f.color) ? f.color : d.color,
    layer: f.layer === 'over' ? 'over' : 'behind',
    sound: f.sound !== false,
  };
}

/** The sound a kind of water makes. */
export function flowSound(kind: FlowSettings['kind']): 'river' | 'stream' | 'waves' | null {
  switch (kind) {
    case 'river':
    case 'waterfall':
      return 'river';
    case 'stream':
      return 'stream';
    case 'sea':
      return 'waves';
    default:
      return null;
  }
}
