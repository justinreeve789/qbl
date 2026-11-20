import assert from 'node:assert/strict';
import { test } from 'node:test';
import { beamProblem, bodyParts, cupInside, formatReading, snapToGrid, type PhysicsBeam, type PhysicsBuild, type PhysicsWatch, type ScenePhysics } from '../src/index.js';
import { PhysicsSim } from '../src/physics-sim.js';

const SIZE = { width: 1600, height: 900 };
const run = (sim: PhysicsSim, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) sim.step();
};
const near = (actual: number | null, expected: number, within: number, what: string) => {
  assert.ok(actual != null && Math.abs(actual - expected) <= within, `${what}: ${actual} is not within ${within} of ${expected}`);
};

test('a rubber ball bounces back to about e² of the height it fell from, clay hardly at all', () => {
  const drop = (material: string) => {
    const sim = new PhysicsSim({
      enabled: true,
      // Its bottom 2 m above the floor (the bottom of the scene).
      bodies: [{ id: 'ball', shape: 'circle', x: 400, y: 900 - 200 - 10, radius: 10, material }],
      readouts: [{ id: 'bounce', measure: 'bounce_height', body_id: 'ball' }, { id: 'top', measure: 'max_height', body_id: 'ball' }],
    }, SIZE);
    run(sim, 3);
    return sim.readings();
  };
  const rubber = drop('rubber');
  near(rubber.top, 2, 0.02, 'starting height');
  near(rubber.bounce, 2 * 0.85 ** 2, 0.12, 'rubber bounce');
  const clay = drop('clay');
  assert.ok((clay.bounce ?? 0) < 0.05, `clay bounced ${clay.bounce} m`);
  const wood = drop('wood');
  assert.ok((wood.bounce ?? 0) < (rubber.bounce ?? 0) && (wood.bounce ?? 0) > (clay.bounce ?? 0), 'wood bounces between clay and rubber');
});

test('a pendulum swings in 2π√(L/g), whatever it weighs', () => {
  const swing = (length: number, material: string) => {
    const x = 800 + length * Math.sin(0.2);
    const y = 100 + length * Math.cos(0.2);
    const sim = new PhysicsSim({
      enabled: true, floor_y: null,
      bodies: [{ id: 'bob', shape: 'circle', x, y, radius: 12, material }],
      joints: [{ id: 'string', type: 'string', body_a: 'bob', x, y, x2: 800, y2: 100 }],
      readouts: [{ id: 'T', measure: 'period', body_id: 'bob' }, { id: 'n', measure: 'swings', body_id: 'bob' }],
    }, SIZE);
    run(sim, 10);
    return sim.readings();
  };
  const theory = (m: number) => 2 * Math.PI * Math.sqrt(m / 9.81);
  const steel = swing(100, 'steel');
  near(steel.T, theory(1), 0.06, '1 m steel');
  assert.ok((steel.n ?? 0) >= 3, 'it counts its swings');
  near(swing(100, 'cork').T, steel.T!, 0.04, '1 m cork, the same as steel');
  near(swing(300, 'steel').T, theory(3), 0.08, '3 m steel');
});

const glass = (extra: ScenePhysics = {}): ScenePhysics => ({
  enabled: true,
  bodies: [
    { id: 'glass', shape: 'cup', x: 800, y: 750, width: 240, height: 300, fixed: true, material: 'glass' },
    ...(extra.bodies ?? []),
  ],
  water: [{ id: 'water', body_id: 'glass', level: 120 }],
  readouts: [
    { id: 'level', measure: 'water_level', water_id: 'water' }, { id: 'rise', measure: 'water_rise', water_id: 'water' },
    { id: 'pushed', measure: 'displaced', water_id: 'water' }, { id: 'spilled', measure: 'spilled', water_id: 'water' },
    ...(extra.readouts ?? []),
  ],
  watches: extra.watches,
});

test('a rock sinks and raises the water by its volume; cork floats about a quarter under', () => {
  const inside = cupInside({ id: 'glass', shape: 'cup', x: 0, y: 0, width: 240, height: 300 });
  const sim = new PhysicsSim(glass({
    bodies: [{ id: 'rock', shape: 'circle', x: 800, y: 300, radius: 40, material: 'rock' }],
    readouts: [{ id: 'rockh', measure: 'height', body_id: 'rock' }],
  }), SIZE);
  run(sim, 5);
  const r = sim.readings();
  // The rock lies on the glass's floor, 12 px (its wall) above the scene's floor.
  near(r.rockh, 0.12, 0.02, 'rock on the bottom');
  const area = Math.PI * 40 * 40; // square pixels
  near(r.rise, (area / inside.width) / 100 * 100, 0.4, 'rise in cm');
  // Volume pushed aside: area × depth (0.1 m), in mL.
  near(r.pushed, (area / 1e4) * 0.1 * 1e6, 250, 'water pushed aside');

  const floating = new PhysicsSim(glass({ bodies: [{ id: 'cork', shape: 'box', x: 800, y: 600, width: 60, height: 30, material: 'cork' }] }), SIZE);
  run(floating, 5);
  near(floating.readings().pushed, (60 * 30 * 0.24 / 1e4) * 0.1 * 1e6, 60, 'cork pushes aside its own weight of water');
});

test('water over the rim spills, and a spill watch notices', () => {
  const fired: Array<[string, number | null]> = [];
  const def = glass({
    bodies: [{ id: 'big', shape: 'box', x: 800, y: 300, width: 180, height: 200, material: 'steel' }],
    watches: [{ id: 'overflow', when: 'spill', water_id: 'water', variable: 'spilt' }],
  });
  def.water![0]!.level = 250;
  const sim = new PhysicsSim(def, SIZE, { fired: (w, v) => fired.push([w.id, v]) });
  run(sim, 4);
  assert.ok((sim.readings().spilled ?? 0) > 100, `spilled ${sim.readings().spilled} mL`);
  assert.equal(fired[0]?.[0], 'overflow');
  assert.equal(fired.length, 1, 'once per run');
});

test('a balance beam levels when the turning effects match, and the watch waits for the player', () => {
  const fired: string[] = [];
  // A beam hung from a post: the pivot is above the beam, so it settles at a tilt that shows which side is heavier.
  const balance = (tag: string): PhysicsSim => new PhysicsSim({
    enabled: true,
    bodies: [{ id: 'beam', shape: 'box', x: 800, y: 600, width: 500, height: 12, mass: 6, friction: 1, damping: 2, marks: true }],
    joints: [{ id: 'pivot', type: 'pin', body_a: 'beam', x: 800, y: 560, min_angle: -20, max_angle: 20 }],
    tray: [{ id: 'one', body: { shape: 'box', width: 30, height: 30, mass: 1, friction: 1 } }, { id: 'two', body: { shape: 'box', width: 30, height: 30, mass: 2, friction: 1 } }],
    readouts: [{ id: 'tilt', measure: 'angle', body_id: 'beam' }],
    watches: [{ id: 'level', when: 'balanced', body_id: 'beam', value: 1.5, hold: 1 }],
  }, SIZE, { fired: (w) => fired.push(`${tag}:${w.id}`) });
  // Just above the beam where it is now, at a distance along it from the middle.
  const place = (sim: PhysicsSim, entry: string, along: number) => {
    const [, cx, cy, angle] = sim.snapshot().bodies.find(([id]) => id === 'beam')!;
    const x = cx + along * Math.cos(angle) + 22 * Math.sin(angle);
    const y = cy + along * Math.sin(angle) - 22 * Math.cos(angle);
    assert.equal(sim.input('me', { op: 'take', entry, x, y }), null);
    sim.input('me', { op: 'drop' });
  };

  const sim = balance('even');
  run(sim, 2);
  assert.equal(fired.length, 0, 'level from the start is not the player balancing it');
  place(sim, 'two', -100);
  run(sim, 3);
  assert.ok((sim.readings().tilt ?? 0) < -3, `2 kg on the left tips it left: ${sim.readings().tilt}`);
  // 2 kg at 1 m on the left; 1 kg at 2 m on the right levels it.
  place(sim, 'one', 200);
  run(sim, 8);
  near(sim.readings().tilt, 0, 1.5, 'level');
  assert.ok(fired.includes('even:level'));

  const lopsided = balance('uneven');
  place(lopsided, 'two', -100);
  place(lopsided, 'one', 100);
  run(lopsided, 5);
  assert.ok((lopsided.readings().tilt ?? 0) < -1.5, `still tipped left: ${lopsided.readings().tilt}`);
  assert.ok(!fired.includes('uneven:level'));
});

test('bridges: a truss holds more than a flat deck, and breaking is noticed', () => {
  const deck: Array<[number, number, number, number, number]> = [];
  for (let x = 400; x < 1000; x += 100) deck.push([x, 500, x + 100, 500, 0]);
  const truss = [...deck];
  for (let x = 450; x < 1000; x += 100) {
    truss.push([x - 50, 500, x, 400, 1], [x, 400, x + 50, 500, 1]);
  }
  for (let x = 450; x < 950; x += 100) truss.push([x, 400, x + 100, 400, 1]);
  const breakAt = (design: typeof deck) => {
    const watches: PhysicsWatch[] = [{ id: 'collapse', when: 'break', variable: 'collapsed' }];
    const fired: Array<number | null> = [];
    const sim = new PhysicsSim({
      enabled: true, floor_y: null, press: { enabled: true, rate: 600, max: 20000 },
      build: {
        x: 350, y: 300, width: 700, height: 300, grid: 50, anchors: [{ x: 400, y: 500 }, { x: 1000, y: 500 }], max_length: 200,
        beams: [{ material: 'wood', deck: true }, { material: 'wood' }],
        preset: design.map(([ax, ay, bx, by, kind], i): PhysicsBeam => ({ id: `p${i}`, a: { x: ax, y: ay }, b: { x: bx, y: by }, kind })),
      },
      readouts: [{ id: 'broke', measure: 'break_force' }, { id: 'breaks', measure: 'breaks' }],
      watches,
    }, SIZE, { fired: (_, v) => fired.push(v) });
    assert.equal(sim.building, true);
    sim.control('test');
    run(sim, 2);
    assert.equal(sim.readings().breaks, 0, 'it stands up by itself');
    // Press on the middle of the deck, wherever it has sagged to.
    const [, x, y] = sim.snapshot().bodies.find(([id]) => id === 'beam:p2')!;
    assert.equal(sim.bodyAt({ x, y }, false), 'beam:p2');
    assert.equal(sim.input('me', { op: 'press', body: 'beam:p2', x, y }), null);
    for (let i = 0; i < 60 * 30 && !fired.length; i++) sim.step();
    assert.equal(fired.length, 1, 'the break watch fired');
    return sim.readings().broke ?? 0;
  };
  const flat = breakAt(deck);
  const triangles = breakAt(truss);
  assert.ok(flat > 100, `the deck held something (${flat} N)`);
  assert.ok(triangles > flat * 2, `truss ${triangles} N vs deck ${flat} N`);
});

test('building rules: footings, length, budget; testing and going back keeps the design', () => {
  const build: PhysicsBuild = {
    x: 0, y: 0, width: 1000, height: 500, grid: 50, anchors: [{ x: 100, y: 300 }], max_length: 200, budget: 450,
    beams: [{ material: 'wood', deck: true, cost_per_meter: 100 }],
  };
  assert.deepEqual(snapToGrid(build, { x: 123, y: 281 }), { x: 100, y: 300 });
  assert.match(beamProblem(build, [], { a: { x: 300, y: 300 }, b: { x: 400, y: 300 }, kind: 0 }, 100)!, /footing/);
  assert.match(beamProblem(build, [], { a: { x: 100, y: 300 }, b: { x: 400, y: 300 }, kind: 0 }, 100)!, /too long/);
  assert.equal(beamProblem(build, [], { a: { x: 100, y: 300 }, b: { x: 300, y: 300 }, kind: 0 }, 100), null);
  const sim = new PhysicsSim({ enabled: true, build }, SIZE);
  assert.equal(sim.input('me', { op: 'beam', a: { x: 101, y: 302 }, b: { x: 296, y: 299 }, kind: 0 }), null);
  assert.equal(sim.input('me', { op: 'beam', a: { x: 300, y: 300 }, b: { x: 500, y: 300 }, kind: 0 }), null);
  // 4 m at 100 a metre is within the budget of 450; one more metre is over it.
  assert.match(sim.input('me', { op: 'beam', a: { x: 500, y: 300 }, b: { x: 600, y: 300 }, kind: 0 })!, /budget/);
  assert.equal(sim.readings().cost ?? sim.designSummary().cost, 400);
  sim.control('test');
  assert.equal(sim.building, false);
  assert.match(sim.input('me', { op: 'beam', a: { x: 500, y: 300 }, b: { x: 550, y: 300 }, kind: 0 })!, /building/);
  sim.control('reset');
  assert.equal(sim.building, true);
  assert.equal(sim.layout().design.length, 2);
});

test('held bodies wait for Drop; the tray runs out and a reset fills it again', () => {
  const sim = new PhysicsSim({
    enabled: true,
    bodies: [{ id: 'ball', shape: 'circle', x: 300, y: 300, radius: 20, held: true, material: 'rubber' }],
    tray: [{ id: 'weight', label: 'weights', count: 1, body: { shape: 'box', width: 40, height: 40, mass: 5 } }],
  }, SIZE);
  run(sim, 1);
  assert.deepEqual(sim.snapshot().bodies.find(([id]) => id === 'ball')?.slice(1, 3), [300, 300]);
  // A player may still move a held ball to set it up.
  assert.equal(sim.input('me', { op: 'grab', body: 'ball', x: 300, y: 300 }), null);
  sim.input('me', { op: 'drag', x: 300, y: 200 });
  run(sim, 0.1);
  sim.input('me', { op: 'drop' });
  assert.deepEqual(sim.snapshot().bodies.find(([id]) => id === 'ball')?.slice(1, 3), [300, 200]);
  sim.control('release');
  run(sim, 1);
  assert.ok(sim.snapshot().bodies.find(([id]) => id === 'ball')![2] > 400, 'it fell');

  assert.equal(sim.input('me', { op: 'take', entry: 'weight', x: 500, y: 300 }), null);
  sim.input('me', { op: 'drop' });
  assert.match(sim.input('me', { op: 'take', entry: 'weight', x: 600, y: 300 })!, /no more weights/);
  assert.equal(sim.layout().tray.weight, 0);
  assert.equal(sim.layout().spawned.length, 1);
  sim.control('reset');
  assert.equal(sim.layout().tray.weight, 1);
  assert.equal(sim.layout().spawned.length, 0);
  assert.deepEqual(sim.snapshot().bodies.find(([id]) => id === 'ball')?.slice(1, 3), [300, 300]);
});

test('gravity can be changed: a ball falls slower on the Moon', () => {
  const fall = (g: number) => {
    const sim = new PhysicsSim({ enabled: true, bodies: [{ id: 'b', shape: 'circle', x: 300, y: 100, radius: 10 }], readouts: [{ id: 'h', measure: 'height', body_id: 'b' }] }, SIZE);
    sim.control('gravity', { value: g });
    run(sim, 1);
    return 7.9 - (sim.readings().h ?? 0); // metres fallen
  };
  near(fall(9.81), 0.5 * 9.81, 0.15, 'Earth');
  near(fall(1.62), 0.5 * 1.62, 0.05, 'Moon');
});

test('shapes and formatting', () => {
  assert.equal(bodyParts({ id: 'c', shape: 'cup', x: 0, y: 0, width: 100, height: 100 }).length, 3);
  assert.equal(formatReading({ id: 'x', measure: 'water_rise' }, 1.234), '1.2 cm');
  assert.equal(formatReading({ id: 'x', measure: 'angle' }, -3.21), '-3.2°');
  assert.equal(formatReading({ id: 'x', measure: 'bounce_height' }, null), '—');
});
