import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSortLine, lineYAt, placeSortLine, sortDepth, sortLineOf, validateScenario, type Scenario } from '../src/index.js';

/** A counter seen at an angle: its picture is 700 × 360; the base runs from y 220 on the left to 360 on the right. */
const counter = placeSortLine([[0, 220 / 360], [1, 1]], { x: 1000, y: 800, width: 700, height: 360 });

test('a sort line is placed in the scene from fractions of the picture', () => {
  assert.deepEqual(counter.points, [{ x: 650, y: 660 }, { x: 1350, y: 800 }]);
  assert.equal(counter.depth, 800);
  assert.equal(counter.left, 650);
  assert.equal(counter.right, 1350);
  // Mirrored: the low end is now on the left.
  const flipped = placeSortLine([[0, 220 / 360], [1, 1]], { x: 1000, y: 800, width: 700, height: 360, flipped: true });
  assert.deepEqual(flipped.points, [{ x: 650, y: 800 }, { x: 1350, y: 660 }]);
});

test('the line is straight between its points and level beyond them', () => {
  assert.equal(lineYAt(counter.points, 1000), 730);
  assert.equal(lineYAt(counter.points, 100), 660);
  assert.equal(lineYAt(counter.points, 2000), 800);
});

test('a figure in front of the far end is drawn in front of the counter; one behind it, behind', () => {
  // In front of the left end (the line is at 674 there): before, depth 700 < 800 put it behind.
  const front = sortDepth([counter], 720, 700, 40);
  assert.ok(front > 800 && front < 801, `in front of the counter: ${front}`);
  // Behind the line: drawn by its feet, behind the counter.
  assert.equal(sortDepth([counter], 1200, 700, 40), 700);
  // Below the counter's lowest point: in front anyway, as before.
  assert.equal(sortDepth([counter], 1200, 850, 40), 850);
  // Far to the side, not overlapping the picture: untouched.
  assert.equal(sortDepth([counter], 300, 700, 40), 700);
  // Just past the left end but overlapping the picture: the line is level there, so it is in front.
  assert.ok(sortDepth([counter], 630, 700, 40) > 800);
  // Two figures in front of the counter keep their order.
  assert.ok(sortDepth([counter], 720, 710, 40) > sortDepth([counter], 720, 700, 40));
  // No lines: the feet.
  assert.equal(sortDepth([], 720, 700, 40), 700);
});

test('sort lines are tidied and checked', () => {
  assert.equal(sortLineOf({}), null);
  assert.equal(sortLineOf({ sort_line: [[0.5, 0.5]] }), null);
  assert.deepEqual(sortLineOf({ sort_line: [[1, 1.4], [0, 0.6]] }), [[0, 0.6], [1, 1]]);
  const scenario = (sort_line: unknown): Scenario => ({ id: 1, shortname: 's', title: 'S', scenes: [{ id: 1, name: 'Here', events: [] }], items: [{ id: 1, name: 'Counter', sort_line }] } as unknown as Scenario);
  const issues = (sort_line: unknown) => { const r = validateScenario(scenario(sort_line)); return [...r.errors, ...r.warnings].filter((i) => i.path.startsWith('items[0].sort_line')); };
  assert.equal(issues([[0, 0.6], [1, 1]]).length, 0);
  assert.equal(issues([[0, 0.6]])[0]?.level, 'error');
  assert.equal(issues([[0, 0.6], [1, 2]])[0]?.level, 'error');
});

test('the line is found from the picture: the lowest solid pixel of each column, skipping thin bits that stick out', () => {
  const width = 200;
  const height = 100;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const fill = (x: number, from: number, to: number) => {
    for (let y = from; y < to; y++) rgba[(y * width + x) * 4 + 3] = 255;
  };
  for (let x = 0; x < 180; x++) {
    // A slab whose base goes down from y 60 at the left to y 100 at x 120, then stays level.
    const base = x < 120 ? 60 + (40 * x) / 120 : 100;
    fill(x, 10, Math.round(base));
  }
  // A thin tray sticking out on the right, well above the floor.
  for (let x = 180; x < 200; x++) fill(x, 10, 18);
  const line = findSortLine(rgba, width, height)!;
  assert.ok(line.length >= 2 && line.length <= 4, JSON.stringify(line));
  assert.ok(Math.abs(line[0]![1] - 0.6) < 0.03, `starts high on the left: ${JSON.stringify(line)}`);
  assert.ok(line.every(([, y]) => y >= 0.58), `the tray is not part of it: ${JSON.stringify(line)}`);
  assert.ok(line.at(-1)![0] < 0.92, `ends where the slab ends: ${JSON.stringify(line)}`);
  assert.equal(findSortLine(new Uint8ClampedArray(width * height * 4), width, height), null);
});
