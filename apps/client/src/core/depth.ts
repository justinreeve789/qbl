/** Draw order. World objects between `background` and `foreground` sort by their y position. */
export const Depth = {
  background: -10_000,
  /** Things that are part of the floor or the far wall: above the backgrounds, behind every figure. */
  floor: -1_000,
  foreground: 100_000,
  label: 150_000,
  fixed: 160_000,
  name: 170_000,
  bubble: 180_000,
  /** Text labels: in front of everything else in the scene, so they can always be read. */
  text: 185_000,
  debug: 190_000,
} as const;
