import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeScenario, routeBetween, ScenarioIndex, validateScenario, World,
  type ItemRec, type NpcRec, type PlayerRec, type Scenario, type User, type WorldState,
} from '../src/index.js';

const floor = (w: number) => [[{ x: 0, y: 300 }, { x: w, y: 300 }, { x: w, y: 600 }, { x: 0, y: 600 }]];

/**
 * Three rooms in a row: hall (1) ⇄ lab (2) ⇄ garden (3), joined by walk-in hotspots along the
 * edges, as the scene map makes them. The lab's door to the garden is locked by a shared variable.
 */
const raw: Scenario = {
  id: 9, shortname: 'roam', title: 'Roam', start_scene_id: 1, move_speed: 400,
  assets: [{ id: 1, type: 'image', url: 'robot.png' }],
  global_variables: [
    { variable_name: 'garden_open', default_value: 1, scope: 'room' },
    { variable_name: 'robot_on', default_value: 1, scope: 'room' },
    { variable_name: 'laps', default_value: 0, scope: 'room' },
    { variable_name: 'coins', default_value: 0 },
  ],
  characters: [
    {
      id: 5, name: 'Robo', walk_speed: 200, animations: { stand_right: { media_id: 1 } },
      routine: {
        conditions: [{ variable: 'robot_on', operator: '=', operand: 1 }],
        steps: [
          { type: 'walk', to: 'point', position_x: 800, position_y: 400 },
          { type: 'dialogue', text: 'Beep!', duration: 1000 },
          { type: 'variable', name: 'laps', operator: '+', operand: 1 },
          { type: 'walk', to: 'point', position_x: 200, position_y: 400, facing: 'left' },
        ],
      },
    },
    { id: 6, name: 'Guide', roams: true, animations: { stand_right: { media_id: 1 } } },
    { id: 7, name: 'Statue', animations: { stand_right: { media_id: 1 } } },
  ],
  scenes: [
    {
      id: 1, width: 1000, height: 600, walkable_areas: floor(1000),
      spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }, { name: 'from-lab', position_x: 940, position_y: 450, facing: 'left' }],
      hotspots: [{ id: 10, position_x: 1000, position_y: null, radius: 30, actions: [{ id: 11, type: 'jump', scene_id: 2, spawn_point: 'from-hall' }] }],
      indirect_events: [{
        id: 40, actions: [
          { id: 41, type: 'walk', character_id: 6, to: 'scene', scene_id: 3 },
          { id: 42, type: 'walk', character_id: 6, to: 'point', position_x: 500, position_y: 500 },
          { id: 43, type: 'walk', character_id: 7, to: 'point', position_x: 300, position_y: 500 },
        ],
      }],
      characters: [{ character_id: 5, position_x: 200, position_y: 400 }, { character_id: 6, position_x: 400, position_y: 450 }, { character_id: 7, position_x: 600, position_y: 450 }],
    },
    {
      id: 2, width: 1000, height: 600, walkable_areas: floor(1000),
      spawn_points: [{ name: 'from-hall', position_x: 60, position_y: 450, facing: 'right' }, { name: 'from-garden', position_x: 940, position_y: 450, facing: 'left' }],
      hotspots: [
        { id: 20, position_x: 0, position_y: null, radius: 30, actions: [{ id: 21, type: 'jump', scene_id: 1, spawn_point: 'from-lab' }] },
        {
          id: 22, position_x: 1000, position_y: null, radius: 30, conditions: [{ variable: 'garden_open', operator: '=', operand: 1 }],
          actions: [{ id: 23, type: 'jump', scene_id: 3, spawn_point: 'from-lab' }],
        },
      ],
      indirect_events: [{ id: 99, actions: [{ id: 98, type: 'dialogue', speaker: 'character', character_id: 6, text: 'Welcome to the lab.' }] }],
      characters: [{ character_id: 6, position_x: 500, position_y: 450, event_id: 99 }],
    },
    {
      id: 3, width: 1000, height: 600, walkable_areas: floor(1000),
      spawn_points: [{ name: 'from-lab', position_x: 60, position_y: 450, facing: 'right' }, { name: 'bench', position_x: 500, position_y: 500 }],
      hotspots: [{ id: 30, position_x: 0, position_y: null, radius: 30, actions: [{ id: 31, type: 'jump', scene_id: 2, spawn_point: 'from-garden' }] }],
    },
  ],
};
const scenario = normalizeScenario(raw);

function make(instance: ConstructorParameters<typeof World>[2] = null) {
  const state: WorldState = { players: new Map<string, PlayerRec>(), items: new Map<string, ItemRec>(), vars: new Map<string, string>(), npcs: new Map<string, NpcRec>() };
  const clock = { now: 1_000_000 };
  const world = new World(scenario, { state, now: () => clock.now, newPlayer: () => ({}) as PlayerRec, newItem: () => ({}) as ItemRec }, instance);
  /** Let `ms` pass, in ticks of 50 ms as the game server does. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      clock.now += 50;
      world.tick();
    }
  };
  /** Tick until something is true (at most `max` ms); how long it took. */
  const until = (done: () => boolean, max = 20_000) => {
    let t = 0;
    while (!done() && t < max) {
      run(50);
      t += 50;
    }
    assert.ok(done(), 'it never happened');
    return t;
  };
  return { world, state, clock, run, until };
}
const ann: User = { id: 'u1', name: 'Ann', role: 'student' };

test('characters that roam start at their first placement; others are not in the room state', () => {
  const { state } = make();
  assert.equal(scenario.characters!.find((c) => c.id === 5)!.roams, true, 'a routine makes a character roam');
  assert.equal(scenario.characters!.find((c) => c.id === 7)!.roams, false);
  const robo = state.npcs!.get('5')!;
  assert.deepEqual([robo.scene_id, robo.x, robo.y, robo.moving], [1, 200, 400, false]);
  // The guide is placed in the hall and the lab: she starts in the first, the hall.
  assert.equal(state.npcs!.get('6')!.scene_id, 1);
  assert.equal(state.npcs!.get('7'), undefined);
});

test('a routine walks, speaks, changes a shared variable and loops', () => {
  const { state, run, until } = make();
  const robo = state.npcs!.get('5')!;
  run(500);
  assert.equal(robo.moving, true);
  assert.equal(robo.facing, 'right');
  assert.ok(robo.x > 250 && robo.x < 320, `about 100 px in half a second at 200 px/s (at ${robo.x})`);
  run(2600); // 600 px at 200 px/s, and a little more
  assert.equal(robo.moving, false);
  assert.equal(Math.round(robo.x), 800);
  assert.match(robo.line, /^\d+:1$/, 'saying the routine\'s second step');
  run(1000);
  assert.equal(robo.line, '', 'the line is over');
  assert.equal(state.vars.get('laps'), '1');
  assert.equal(robo.moving, true, 'walking back');
  const took = until(() => !robo.moving);
  assert.ok(took >= 2900 && took <= 3100, `600 px at 200 px/s takes about 3 s (took ${took} ms)`);
  assert.equal(Math.round(robo.x), 200);
  assert.equal(robo.facing, 'left', 'turned as the step says on arriving');
  run(3000);
  assert.ok(robo.x > 700, 'and off again: the routine loops');
});

test('a routine stops while its conditions fail and carries on with the same step', () => {
  const { world, state, run } = make();
  const robo = state.npcs!.get('5')!;
  run(1000);
  world.setVariable('x', { name: 'robot_on', operator: 'set', operand: 0 });
  run(100);
  const x = robo.x;
  assert.equal(robo.moving, false);
  run(2000);
  assert.equal(robo.x, x, 'it stands still');
  world.setVariable('x', { name: 'robot_on', operator: 'set', operand: 1 });
  run(3000);
  assert.equal(Math.round(robo.x), 800, 'it finished the walk it was on');
});

test('routes go through doors, and a door locked by a shared variable is not used', () => {
  const index = new ScenarioIndex(scenario);
  assert.deepEqual(routeBetween(index, 1, 3)!.map((d) => d.hotspot.id), [10, 22]);
  assert.deepEqual(routeBetween(index, 3, 1)!.map((d) => d.hotspot.id), [30, 20]);
  assert.equal(routeBetween(index, 1, 3, (d) => d.hotspot.id !== 22), null);
});

test('a player\'s walk action sends a roaming character through two rooms to the spawn points', () => {
  const { world, state, run } = make();
  world.addPlayer('a', ann, null);
  const guide = state.npcs!.get('6')!;
  assert.equal(world.walk('a', { ticket: 't1', character_id: 6, to: 'scene', scene_id: 3 }), true);
  assert.equal(guide.trip, 't1');
  run(1500); // 400 → 1000 at 400 px/s: into the hall's east door
  assert.equal(guide.scene_id, 2, 'through the first door');
  run(3000);
  assert.equal(guide.scene_id, 3, 'through the second');
  assert.deepEqual([Math.round(guide.x), Math.round(guide.y), guide.facing], [60, 450, 'right'], 'standing at the spawn point the jump names');
  assert.equal(guide.trip, '', 'arrived: the ticket is cleared');
  assert.equal(guide.moving, false);
  assert.equal(world.dirty, true, 'worth saving');
});

test('walk requests are checked against the scenario', () => {
  const { world, state, clock } = make();
  world.addPlayer('a', ann, null);
  assert.equal(world.walk('a', { ticket: 'x', character_id: 6, to: 'point', position_x: 1, position_y: 1 }), false, 'no event of the scene walks her there');
  assert.equal(world.walk('a', { ticket: 'x', character_id: 7, to: 'point', position_x: 300, position_y: 500 }), false, 'the statue does not roam: it walks in the browser');
  assert.equal(world.walk('a', { ticket: 'x', character_id: 6, to: 'point', position_x: 500, position_y: 500 }), true);
  assert.equal(world.walk('a', { ticket: 'y', character_id: 6, to: 'point', position_x: 500, position_y: 500 }), false, 'not again so soon');
  clock.now += 300;
  world.setVariable('a', { name: 'garden_open', operator: 'set', operand: 0 });
  assert.equal(world.walk('a', { ticket: 'z', character_id: 6, to: 'scene', scene_id: 3 }), false, 'the way to the garden is locked');
  assert.equal(state.npcs!.get('6')!.trip, 'x');
});

test('a player\'s walk comes before the routine, which picks up again afterwards', () => {
  const scene = scenario.scenes[0]!;
  const withRobo = normalizeScenario({
    ...raw,
    scenes: [{ ...scene, indirect_events: [{ id: 50, actions: [{ id: 51, type: 'walk', character_id: 5, to: 'point', position_x: 200, position_y: 550 }] }] }, ...raw.scenes.slice(1)],
  });
  const state: WorldState = { players: new Map(), items: new Map(), vars: new Map(), npcs: new Map() };
  const clock = { now: 0 };
  const world = new World(withRobo, { state, now: () => clock.now, newPlayer: () => ({}) as PlayerRec, newItem: () => ({}) as ItemRec });
  const run = (ms: number) => { for (let t = 0; t < ms; t += 50) { clock.now += 50; world.tick(); } };
  world.addPlayer('a', ann, null);
  run(1000);
  assert.ok(world.walk('a', { ticket: 'come', character_id: 5, to: 'point', position_x: 200, position_y: 550 }));
  const robo = state.npcs!.get('5')!;
  assert.equal(robo.trip, 'come');
  for (let t = 0; robo.trip && t < 5000; t += 50) run(50);
  assert.deepEqual([Math.round(robo.x), Math.round(robo.y), robo.trip], [200, 550, ''], 'it came where the player\'s event sent it');
  run(4000);
  assert.equal(Math.round(robo.x), 800, 'back to its routine: the walk it was on');
});

test('where characters were left is saved with the instance and restored', () => {
  const { world, run } = make();
  world.addPlayer('a', ann, null);
  world.walk('a', { ticket: 't', character_id: 6, to: 'scene', scene_id: 3 });
  run(6000);
  const saved = world.instanceData().characters!;
  assert.deepEqual(saved['6'], { scene_id: 3, x: 60, y: 450, facing: 'right', step: undefined });
  const again = make(world.instanceData());
  assert.deepEqual([again.state.npcs!.get('6')!.scene_id, again.state.npcs!.get('6')!.x], [3, 60]);
  const robo = saved['5']!;
  assert.equal(typeof robo.step, 'number', 'the routine step is kept too');
});

test('a world given no map of characters keeps its own (older callers, tests)', () => {
  const state: WorldState = { players: new Map(), items: new Map(), vars: new Map() };
  const world = new World(scenario, { state, now: () => 0, newPlayer: () => ({}) as PlayerRec, newItem: () => ({}) as ItemRec });
  assert.equal(world.npcs.get('5')!.scene_id, 1);
});

test('validation: walks and routines', () => {
  assert.deepEqual(validateScenario(raw).errors, []);
  const bad = structuredClone(raw);
  bad.characters![0]!.routine!.steps.push(
    { type: 'variable', name: 'coins', operator: '+', operand: 1 },
    { type: 'walk', to: 'scene', scene_id: 404 },
    { type: 'jump', scene_id: 2 } as never,
  );
  bad.characters![0]!.routine!.conditions!.push({ variable: 'coins', operator: '=', operand: 0 });
  bad.scenes[0]!.indirect_events![0]!.actions.push(
    { id: 44, type: 'walk', character_id: 7, to: 'scene', scene_id: 3 },
    { id: 45, type: 'walk', character_id: 6, to: 'spawn' },
    { id: 46, type: 'walk', target: 'player', to: 'scene', scene_id: 3 },
  );
  bad.scenes[2]!.indirect_events = [{ id: 60, actions: [{ id: 61, type: 'walk', character_id: 7, to: 'point', position_x: 1, position_y: 400 }] }];
  const result = validateScenario(bad);
  const messages = [...result.errors, ...result.warnings].map((i) => `${i.path}: ${i.message}`);
  const has = (re: RegExp) => assert.ok(messages.some((m) => re.test(m)), `expected ${re} in\n${messages.join('\n')}`);
  has(/routine\.steps\[4\]\.name: "coins" is each player's own/);
  has(/routine\.steps\[5\]\.scene_id: Scene 404 does not exist/);
  has(/routine\.steps\[6\]\.type: A routine step is one of/);
  has(/routine\.conditions\[1\]: "coins" is each player's own/);
  has(/actions\[3\]\.scene_id: No hotspot in this scene jumps to that scene/);
  has(/actions\[4\]\.spawn_point: spawn_point is required/);
  has(/actions\[5\]\.scene_id: No hotspot in this scene jumps to that scene/);
  has(/scenes\[2\]\.indirect_events\[0\]\.actions\[0\]\.character_id: The character to walk is not placed in this scene/);
});
