/**
 * The living sky (Scene.sky): what the sky looks like at each time of day, and how it moves on while
 * players are in a scene. The game draws it (SkySystem), the editor previews it, and the generator's
 * scene preview paints it the same way.
 *
 * A time of day is an hour on a 24-hour clock (`SKY_HOURS`); the look at any hour is blended from the
 * nearest keyframes, so a sunset passes smoothly through gold, orange, pink and purple into blue.
 */
import type { SceneSky, SkyTime } from './types.js';

export const SKY_TIMES: SkyTime[] = ['dawn', 'morning', 'midday', 'afternoon', 'golden', 'sunset', 'dusk', 'night'];

/** The hour each time of day stands for. */
export const SKY_HOURS: Record<SkyTime, number> = {
  dawn: 6, morning: 8.5, midday: 12, afternoon: 15, golden: 17.5, sunset: 18.6, dusk: 19.4, night: 21.5,
};

export interface SkyLook {
  /** The gradient, from the top of the sky to the horizon. */
  top: string;
  middle: string;
  horizon: string;
  /** How high the sun is: 1 high in the sky, 0 on the horizon, below 0 set. */
  sun: number;
  sunColor: string;
  /** How visible the moon and the stars are, 0 to 1. */
  stars: number;
  /** The light the scene in front takes on, and how strongly (0 to 1, before the scene's `shade`). */
  shade: string;
  shadeAlpha: number;
  /** The tint for layers that are part of the sky (clouds, far views). */
  tint: string;
  /** How dark it is, 0 (day) to 1 (night): lights and fireflies shine more. */
  dark: number;
}

const NIGHT: SkyLook = { top: '#0b1030', middle: '#1b2350', horizon: '#2e3a6e', sun: -0.5, sunColor: '#ff7a3c', stars: 1, shade: '#3a4a8a', shadeAlpha: 0.45, tint: '#6070b0', dark: 1 };

/** Keyframes by hour, from the night before dawn to the night after dusk. */
const KEYS: Array<[number, SkyLook]> = [
  [4.5, NIGHT],
  [6, { top: '#2b3a7a', middle: '#8a6fb0', horizon: '#f6a38a', sun: 0.02, sunColor: '#ff9a5a', stars: 0.25, shade: '#b48ac0', shadeAlpha: 0.2, tint: '#f0b8c4', dark: 0.5 }],
  [8.5, { top: '#5aa8e6', middle: '#9fd0f2', horizon: '#e6f2f6', sun: 0.55, sunColor: '#fff2c0', stars: 0, shade: '#ffffff', shadeAlpha: 0, tint: '#ffffff', dark: 0 }],
  [12, { top: '#3d8fe0', middle: '#7cbcf0', horizon: '#cfe9f7', sun: 0.92, sunColor: '#fffbe0', stars: 0, shade: '#ffffff', shadeAlpha: 0, tint: '#ffffff', dark: 0 }],
  [15, { top: '#4a96dc', middle: '#8cc2ee', horizon: '#e8eedd', sun: 0.62, sunColor: '#fff4c8', stars: 0, shade: '#fff4e0', shadeAlpha: 0.05, tint: '#fff6e8', dark: 0 }],
  [17.5, { top: '#5b88c8', middle: '#e9b77e', horizon: '#ffcf7a', sun: 0.22, sunColor: '#ffd27a', stars: 0, shade: '#ffb060', shadeAlpha: 0.18, tint: '#ffe0b0', dark: 0.05 }],
  [18.6, { top: '#3a4f9a', middle: '#d9708a', horizon: '#ff9a4a', sun: 0, sunColor: '#ff7a3c', stars: 0, shade: '#ff8a60', shadeAlpha: 0.26, tint: '#ffb0a0', dark: 0.25 }],
  [19.4, { top: '#1f2a66', middle: '#6a4a8e', horizon: '#d77a8a', sun: -0.15, sunColor: '#ff6a3c', stars: 0.5, shade: '#7a6aa8', shadeAlpha: 0.35, tint: '#a890c8', dark: 0.65 }],
  [21.5, NIGHT],
  [28.5, NIGHT],
];

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hex = (c: [number, number, number]) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

/** A blend of two colours: t = 0 the first, 1 the second. */
export function mixColor(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** A colour as a number, for Phaser. */
export function colorNumber(color: string): number {
  return parseInt(color.replace('#', ''), 16);
}

/** What the sky looks like at an hour (0 to 24; any number, taken round the clock). */
export function skyLook(hour: number): SkyLook {
  let h = ((hour % 24) + 24) % 24;
  if (h < KEYS[0]![0]) h += 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]![0] <= h) i++;
  const [h0, a] = KEYS[i]!;
  const [h1, b] = KEYS[i + 1]!;
  const t = h1 > h0 ? Math.max(0, Math.min(1, (h - h0) / (h1 - h0))) : 0;
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    top: mixColor(a.top, b.top, t), middle: mixColor(a.middle, b.middle, t), horizon: mixColor(a.horizon, b.horizon, t),
    sun: n(a.sun, b.sun), sunColor: mixColor(a.sunColor, b.sunColor, t), stars: n(a.stars, b.stars),
    shade: mixColor(a.shade, b.shade, t), shadeAlpha: n(a.shadeAlpha, b.shadeAlpha), tint: mixColor(a.tint, b.tint, t), dark: n(a.dark, b.dark),
  };
}

/**
 * The hour a scene's sky shows after a player has been there `elapsedMs`: its `time`, moving slowly
 * (easing in and out) on to `until` over `minutes`, and staying there. Always forward round the clock:
 * from night until dawn goes through the small hours, not back through the day.
 */
export function skyHour(sky: SceneSky, elapsedMs: number): number {
  const from = SKY_HOURS[sky.time] ?? 12;
  if (!sky.until || sky.until === sky.time) return from;
  let to = SKY_HOURS[sky.until] ?? from;
  if (to < from) to += 24;
  const t = Math.max(0, Math.min(1, elapsedMs / (Math.max(0.1, sky.minutes ?? 8) * 60_000)));
  const eased = t * t * (3 - 2 * t);
  return (from + (to - from) * eased) % 24;
}
