import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isWalkable, type Point, type WalkContext } from '@qbl/shared';
import { Pathfinder, walkSignature } from '../src/core/Pathfinder';

const floor: WalkContext = {
  width: 1200, height: 600,
  walkable: [[{ x: 0, y: 200 }, { x: 1200, y: 200 }, { x: 1200, y: 600 }, { x: 0, y: 600 }]],
  blocked: [],
  obstacles: [],
};

/** Walk a path the way the avatar does, a few pixels at a time, and say whether every step was allowed. */
function walkable(ctx: WalkContext, from: Point, path: Point[]): boolean {
  let at = from;
  for (const p of path) {
    const d = Math.hypot(p.x - at.x, p.y - at.y);
    for (let i = 1; i <= Math.ceil(d / 4); i++) {
      const t = i / Math.ceil(d / 4);
      if (!isWalkable(ctx, at.x + (p.x - at.x) * t, at.y + (p.y - at.y) * t)) return false;
    }
    at = p;
  }
  return true;
}
const length = (from: Point, path: Point[]) => path.reduce((sum, p, i) => sum + Math.hypot(p.x - (path[i - 1] ?? from).x, p.y - (path[i - 1] ?? from).y), 0);

test('a clear line is walked straight', () => {
  const finder = new Pathfinder(floor);
  assert.deepEqual(finder.find({ x: 100, y: 400 }, { x: 1100, y: 450 }), [{ x: 1100, y: 450 }]);
});

test('the path goes around a rock in the way', () => {
  const ctx = { ...floor, obstacles: [{ x: 600, y: 400, radius: 90 }] };
  const finder = new Pathfinder(ctx);
  const from = { x: 100, y: 400 };
  const to = { x: 1100, y: 400 };
  assert.equal(finder.clear(from, to), false);
  const path = finder.find(from, to)!;
  assert.ok(path && path.length >= 2, 'it takes at least one corner');
  assert.deepEqual(path.at(-1), to);
  assert.ok(walkable(ctx, from, path), 'every step of it can be walked');
  // Around, not the long way round: not much further than the straight line.
  assert.ok(length(from, path) < 1000 * 1.25, `path is ${Math.round(length(from, path))}px`);
});

test('the path goes around a blocked area and through the gap in a wall', () => {
  const ctx: WalkContext = {
    ...floor,
    // A wall across the room with a doorway near the bottom.
    blocked: [[{ x: 560, y: 200 }, { x: 640, y: 200 }, { x: 640, y: 470 }, { x: 560, y: 470 }]],
  };
  const finder = new Pathfinder(ctx);
  const from = { x: 200, y: 260 };
  const to = { x: 1000, y: 260 };
  const path = finder.find(from, to)!;
  assert.ok(path, 'a way is found');
  assert.ok(walkable(ctx, from, path));
  assert.ok(path.some((p) => p.y > 470), 'it goes through the doorway');
});

test('there is no path to somewhere cut off, and a click just off the floor still gets one', () => {
  const ctx: WalkContext = { ...floor, blocked: [[{ x: 560, y: 200 }, { x: 640, y: 200 }, { x: 640, y: 600 }, { x: 560, y: 600 }]] };
  const finder = new Pathfinder(ctx);
  assert.equal(finder.find({ x: 200, y: 300 }, { x: 1000, y: 300 }), null);
  const near = new Pathfinder({ ...floor, obstacles: [{ x: 600, y: 400, radius: 90 }] });
  // Starting in the sliver between a grid square and the edge of the floor.
  assert.ok(near.find({ x: 100, y: 203 }, { x: 1100, y: 590 }));
});

test('the signature changes when an obstacle comes, goes or moves', () => {
  const a = walkSignature(floor);
  const b = walkSignature({ ...floor, obstacles: [{ x: 600, y: 400, radius: 90 }] });
  const c = walkSignature({ ...floor, obstacles: [{ x: 620, y: 400, radius: 90 }] });
  assert.ok(a !== b && b !== c);
  assert.equal(b, walkSignature({ ...floor, obstacles: [{ x: 600, y: 400, radius: 90 }] }));
});
