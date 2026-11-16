/** Draw order. World objects between `background` and `foreground` sort by their y position. */
export const Depth = {
  background: -10_000,
  foreground: 100_000,
  label: 150_000,
  fixed: 160_000,
  name: 170_000,
  bubble: 180_000,
  debug: 190_000,
} as const;
