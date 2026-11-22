/**
 * Sounds the game makes itself, with no recording (AudioAction.sound). The client synthesizes them
 * as they are played (apps/client/src/audio/synth.ts), so a scenario needs no sound files for its
 * rain, its river or a car going by. `loop`: a sound that goes on by itself (rain, a river), played
 * over and over with `repeat`; the others are over in a moment or a few seconds.
 */
export const BUILT_IN_SOUNDS = {
  rain: { label: 'Rain', icon: '🌧️', loop: true },
  heavy_rain: { label: 'Heavy rain', icon: '⛈️', loop: true },
  wind: { label: 'Wind', icon: '🌬️', loop: true },
  river: { label: 'A river rushing', icon: '🏞️', loop: true },
  stream: { label: 'A stream babbling', icon: '💧', loop: true },
  waves: { label: 'Waves on a shore', icon: '🌊', loop: true },
  fire: { label: 'A crackling fire', icon: '🔥', loop: true },
  birds: { label: 'Birds singing', icon: '🐦', loop: true },
  crickets: { label: 'Crickets at night', icon: '🦗', loop: true },
  thunder: { label: 'Thunder', icon: '🌩️', loop: false },
  car: { label: 'A car driving by', icon: '🚗', loop: false },
  horn: { label: 'A car horn', icon: '📯', loop: false },
  hooves: { label: 'Hooves going by', icon: '🐎', loop: false },
  bell: { label: 'A bell', icon: '🔔', loop: false },
  chime: { label: 'A magic chime', icon: '✨', loop: false },
  knock: { label: 'Knocking', icon: '🚪', loop: false },
  door: { label: 'A door creaking shut', icon: '🚪', loop: false },
  footsteps: { label: 'Footsteps', icon: '👣', loop: false },
  splash: { label: 'A splash', icon: '💦', loop: false },
  whoosh: { label: 'A whoosh', icon: '💨', loop: false },
  pop: { label: 'A pop', icon: '🫧', loop: false },
  tweet: { label: 'A bird calling', icon: '🐤', loop: false },
} as const satisfies Record<string, { label: string; icon: string; loop: boolean }>;

export type BuiltInSound = keyof typeof BUILT_IN_SOUNDS;

export const BUILT_IN_SOUND_NAMES = Object.keys(BUILT_IN_SOUNDS) as BuiltInSound[];

export function isBuiltInSound(name: unknown): name is BuiltInSound {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(BUILT_IN_SOUNDS, name);
}
