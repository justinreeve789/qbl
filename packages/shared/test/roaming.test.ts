import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  characterPresence, characterStart, normalizeScenario, openDoors, routeBetween, ScenarioIndex, validateScenario, World,
  type ItemRec, type NpcRec, type PlayerRec, type Scenario, type User, type WorldState,
} from '../src/index.js';

const floor = (w: number) => [[{ x: 0, y: 300 }, { x: w, y: 300 }, { x: w, y: 600 }, { x: 0, y: 600 }]];

/**
 * Three rooms in a row: hall (1) ⇄ lab (2) ⇄ garden (3), joined by walk-in hotspots along the
 * edges, as the scene map makes them. The lab's door to the garden is locked by a shared variable.
 *
 * Robo walks around on his own and starts in the hall. Guide starts in the hall too (her own
 * start); Statue was placed the older way, in the hall and in the garden. Ghost is in no scene.
 */
const raw: Scenario = {
  id: 9, shortname: 'roam', title: 'Roam', start_scene_id: 1, move_speed: 400,
  assets: [{ id: 1, type: 'image', url: 'robot.png' }],
  global_variables: [
    { variable_name: 'garden_open', default_value: 1, scope: 'room' },
    { variable_name: 'coins', default_value: 0 },
  ],
  characters: [
    { id: 5, name: 'Robo', roams: true, walk_speed: 400, scene_id: 1, position_x: 200, position_y: 400, animations: { stand_right: { media_id: 1 } } },
    {
      id: 6, name: 'Guide', scene_id: 1, position_x: 400, position_y: 450, facing: 'left', event_id: 70, animations: { stand_right: { media_id: 1 } },
      events: [
        { id: 70, shortname: 'talk', actions: [{ id: 71, type: 'dialogue', speaker: 'character', character_id: 6, text: 'Hello!' }] },
        { id: 72, shortname: 'come', actions: [{ id: 73, type: 'walk', character_id: 6, scene_id: 3, to: 'spawn', spawn_point: 'bench' }] },
      ],
    },
    { id: 7, name: 'Statue', animations: { stand_right: { media_id: 1 } } },
    { id: 8, name: 'Ghost', animations: { stand_right: { media_id: 1 } } },
  ],
  scenes: [
    {
      id: 1, width: 1000, height: 600, walkable_areas: floor(1000),
      spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }, { name: 'from-lab', position_x: 940, position_y: 450, facing: 'left' }],
      hotspots: [{ id: 10, position_x: 1000, position_y: null, radius: 30, actions: [{ id: 11, type: 'jump', scene_id: 2, spawn_point: 'from-hall' }] }],
      indirect_events: [{
        id: 40, actions: [
          { id: 41, type: 'walk', character_id: 6, to: 'scene', scene_id: 3 },
          // Written before walks named a scene: it means this one.
          { id: 42, type: 'walk', character_id: 6, to: 'point', position_x: 500, position_y: 500 },
          { id: 43, type: 'walk', character_id: 5, scene_id: 2, to: 'point', position_x: 500, position_y: 500, wander: false },
          { id: 44, type: 'walk', character_id: 5, scene_id: 1, to: 'point', position_x: 300, position_y: 500 },
        ],
      }],
      characters: [{ character_id: 7, position_x: 600, position_y: 450, facing: 'left' }],
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
    },
    {
      id: 3, width: 1000, height: 600, walkable_areas: floor(1000),
      spawn_points: [{ name: 'from-lab', position_x: 60, position_y: 450, facing: 'right' }, { name: 'bench', position_x: 500, position_y: 500 }],
      hotspots: [{ id: 30, position_x: 0, position_y: null, radius: 30, actions: [{ id: 31, type: 'jump', scene_id: 2, spawn_point: 'from-garden' }] }],
      characters: [{ character_id: 7, position_x: 300, position_y: 450 }],
    },
  ],
};
const scenario = normalizeScenario(raw);

/** The same numbers every run. */
function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(instance: ConstructorParameters<typeof World>[2] = null, doc: Scenario = scenario, seed = 7) {
  const state: WorldState = { players: new Map<string, PlayerRec>(), items: new Map<string, ItemRec>(), vars: new Map<string, string>(), npcs: new Map<string, NpcRec>() };
  const clock = { now: 1_000_000 };
  const world = new World(doc, { state, now: () => clock.now, random: seeded(seed), newPlayer: () => ({}) as PlayerRec, newItem: () => ({}) as ItemRec }, instance);
  /** Let `ms` pass, in ticks of 50 ms as the game server does. */
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 50) {
      clock.now += 50;
      world.tick();
    }
  };
  /** Tick until something is true (at most `max` ms); how long it took. */
  const until = (done: () => boolean, max = 120_000) => {
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

test('every character that starts in a scene is in the world; older placements give the start', () => {
  const { state } = make();
  const robo = state.npcs!.get('5')!;
  assert.deepEqual([robo.scene_id, robo.x, robo.y, robo.moving], [1, 200, 400, false]);
  const guide = state.npcs!.get('6')!;
  assert.deepEqual([guide.scene_id, guide.x, guide.facing], [1, 400, 'left']);
  // Placed in the hall and the garden before characters had a start: the first placement wins.
  const statue = state.npcs!.get('7')!;
  assert.deepEqual([statue.scene_id, statue.x, statue.facing], [1, 600, 'left']);
  assert.equal(scenario.characters!.find((c) => c.id === 7)!.scene_id, 1);
  assert.equal(state.npcs!.get('8'), undefined, 'a character in no scene is nowhere');
});

test('a character that walks around on its own visits 3 to 7 spots, pausing 2 to 10 seconds, then leaves by an open door', () => {
  const { state, run, until } = make();
  const robo = state.npcs!.get('5')!;
  // It stands a moment before it first sets off.
  const first = until(() => robo.moving);
  assert.ok(first >= 1950 && first <= 10_050, `paused 2 to 10 s before setting off (${first} ms)`);
  // Count the stops in the hall until it has gone.
  const pauses: number[] = [];
  let stops = 0;
  while (robo.scene_id === 1) {
    until(() => !robo.moving || robo.scene_id !== 1);
    if (robo.scene_id !== 1) break;
    stops++;
    const still = until(() => robo.moving || robo.scene_id !== 1);
    pauses.push(still);
  }
  assert.ok(stops >= 3 && stops <= 7, `walked to 3 to 7 spots (${stops})`);
  // Between spots it stops 2 to 10 s; after the last it heads straight for the door.
  for (const p of pauses.slice(0, -1)) assert.ok(p >= 1950 && p <= 10_050, `a pause of ${p} ms`);
  assert.ok(pauses[pauses.length - 1]! <= 100, 'off to the door at once after the last spot');
  assert.equal(robo.scene_id, 2, 'out through the hall\'s only door, into the lab');
  assert.deepEqual([Math.round(robo.x), Math.round(robo.y)], [60, 450], 'at the spawn point the jump names');
  // In the lab, at once, a new round.
  run(200);
  assert.equal(robo.moving, true, 'walking around the lab straight away');
});

test('it leaves only by doors without conditions, and stays where there is none', () => {
  const index = new ScenarioIndex(scenario);
  assert.deepEqual(openDoors(index, index.scene(2)!).map((d) => d.hotspot.id), [20], 'the locked door to the garden is not one');
  // A lab with only the locked door: Robo starts there and never leaves.
  const shut = normalizeScenario({
    ...raw,
    characters: [{ ...raw.characters![0]!, scene_id: 2, position_x: 500, position_y: 450 }],
    scenes: raw.scenes.map((s) => (s.id === 2 ? { ...s, hotspots: s.hotspots!.filter((h) => h.id === 22) } : s)),
  });
  const { state, run } = make(null, shut, 3);
  const robo = state.npcs!.get('5')!;
  let moved = 0;
  let last = robo.x;
  for (let t = 0; t < 120_000; t += 500) {
    run(500);
    assert.equal(robo.scene_id, 2, 'still in the lab');
    if (Math.abs(robo.x - last) > 1) moved++;
    last = robo.x;
  }
  assert.ok(moved > 10, 'but it keeps walking around it');
});

test('routes go through doors, and a door locked by a shared variable is not used', () => {
  const index = new ScenarioIndex(scenario);
  assert.deepEqual(routeBetween(index, 1, 3)!.map((d) => d.hotspot.id), [10, 22]);
  assert.deepEqual(routeBetween(index, 3, 1)!.map((d) => d.hotspot.id), [30, 20]);
  assert.equal(routeBetween(index, 1, 3, (d) => d.hotspot.id !== 22), null);
});

test('a walk action sends any character, scene by scene, to the spot it names', () => {
  const { world, state, run } = make();
  world.addPlayer('a', ann, null);
  const guide = state.npcs!.get('6')!;
  // From one of her own events, which run in any scene.
  assert.equal(world.walk('a', { ticket: 't1', character_id: 6, scene_id: 3, to: 'spawn', spawn_point: 'bench' }), true);
  assert.equal(guide.trip, 't1');
  run(1500); // 400 → 1000 at 400 px/s: into the hall's east door
  assert.equal(guide.scene_id, 2, 'through the first door');
  run(5000);
  assert.equal(guide.scene_id, 3, 'through the second');
  assert.deepEqual([Math.round(guide.x), Math.round(guide.y)], [500, 500], 'at the garden\'s bench');
  assert.equal(guide.trip, '', 'arrived: the ticket is cleared');
  assert.equal(guide.moving, false);
  run(20_000);
  assert.deepEqual([guide.scene_id, Math.round(guide.x)], [3, 500], 'she does not walk around on her own: she stays');
  assert.equal(world.dirty, true, 'worth saving');
});

test('walk requests are checked against the scenario', () => {
  const { world, state, clock } = make();
  world.addPlayer('a', ann, null);
  assert.equal(world.walk('a', { ticket: 'x', character_id: 6, to: 'point', scene_id: 1, position_x: 1, position_y: 1 }), false, 'no event walks her there');
  assert.equal(world.walk('a', { ticket: 'x', character_id: 8, scene_id: 1, to: 'point', position_x: 300, position_y: 500 }), false, 'the ghost is in no scene');
  assert.equal(world.walk('a', { ticket: 'x', character_id: 6, scene_id: 1, to: 'point', position_x: 500, position_y: 500 }), true, 'an older walk, of the hall');
  assert.equal(world.walk('a', { ticket: 'y', character_id: 6, scene_id: 1, to: 'point', position_x: 500, position_y: 500 }), false, 'not again so soon');
  clock.now += 300;
  assert.equal(world.walk('a', { ticket: 'y', character_id: 5, scene_id: 2, to: 'point', position_x: 500, position_y: 500 }), false, 'wander differs from the action');
  world.setVariable('a', { name: 'garden_open', operator: 'set', operand: 0 });
  assert.equal(world.walk('a', { ticket: 'z', character_id: 6, to: 'scene', scene_id: 3 }), false, 'the way to the garden is locked');
  assert.equal(state.npcs!.get('6')!.trip, 'x');
});

test('a walk action stops a character walking around, or sets it off again', () => {
  const { world, state, run, until, clock } = make();
  world.addPlayer('a', ann, null);
  const robo = state.npcs!.get('5')!;
  run(3000);
  assert.ok(world.walk('a', { ticket: 'stay', character_id: 5, scene_id: 2, to: 'point', position_x: 500, position_y: 500, wander: false }));
  until(() => robo.trip === '');
  assert.deepEqual([robo.scene_id, Math.round(robo.x), Math.round(robo.y)], [2, 500, 500]);
  assert.equal(world.walkers.wandering(5), false);
  run(30_000);
  assert.deepEqual([robo.scene_id, Math.round(robo.x)], [2, 500], 'it stays there');
  // Kept between visits.
  const saved = world.instanceData().characters!['5']!;
  assert.equal(saved.wanders, false);
  const again = make(world.instanceData());
  assert.equal(again.world.walkers.wandering(5), false);
  again.run(30_000);
  assert.equal(Math.round(again.state.npcs!.get('5')!.x), 500);
  // A walk with "walk around again" on sets it off once there.
  clock.now += 1000;
  assert.ok(world.walk('a', { ticket: 'go', character_id: 5, scene_id: 1, to: 'point', position_x: 300, position_y: 500 }));
  until(() => robo.trip === '');
  assert.equal(world.walkers.wandering(5), true);
  const x = robo.x;
  until(() => Math.abs(robo.x - x) > 5, 15_000);
  assert.equal(world.instanceData().characters!['5']!.wanders, undefined, 'back to what it does by itself: nothing to keep');
});

test('where characters were left is saved with the instance and restored', () => {
  const { world, run } = make();
  world.addPlayer('a', ann, null);
  world.walk('a', { ticket: 't', character_id: 6, to: 'scene', scene_id: 3 });
  run(8000);
  const saved = world.instanceData().characters!;
  assert.deepEqual(saved['6'], { scene_id: 3, x: 60, y: 450, facing: 'right' });
  const again = make(world.instanceData());
  assert.deepEqual([again.state.npcs!.get('6')!.scene_id, again.state.npcs!.get('6')!.x], [3, 60]);
});

test('a world given no map of characters keeps its own (older callers, tests)', () => {
  const state: WorldState = { players: new Map(), items: new Map(), vars: new Map() };
  const world = new World(scenario, { state, now: () => 0, newPlayer: () => ({}) as PlayerRec, newItem: () => ({}) as ItemRec });
  assert.equal(world.npcs.get('5')!.scene_id, 1);
});

test('older documents: a walk without a scene is one of its event\'s scene; routines become walking around', () => {
  const walk = scenario.scenes[0]!.indirect_events![0]!.actions[1]!;
  assert.equal(walk.type === 'walk' && walk.scene_id, 1);
  const old = normalizeScenario({
    ...raw,
    characters: [{ id: 5, name: 'Robo', routine: { steps: [{ type: 'wait', duration: 100 }] } } as never],
    scenes: [{ ...raw.scenes[0]!, characters: [{ character_id: 5, position_x: 10, position_y: 400, event_id: 40 }], indirect_events: [{ id: 40, actions: [{ id: 1, type: 'walk', character_id: 5, to: 'scene', scene_id: 2, spawn_point: 'from-hall' }] }] }, ...raw.scenes.slice(1)],
  });
  const robo = old.characters![0]!;
  assert.equal(robo.roams, true);
  assert.equal((robo as { routine?: unknown }).routine, undefined);
  assert.deepEqual([robo.scene_id, robo.position_x, robo.event_id], [1, 10, 40], 'its placement is its start; clicking runs the placement\'s event');
  const w = old.scenes[0]!.indirect_events![0]!.actions[0]!;
  assert.deepEqual(w.type === 'walk' && [w.to, w.scene_id, w.spawn_point], ['spawn', 2, 'from-hall'], 'to a scene\'s spawn point is a walk to that spawn point');
});

test('a character\'s own events are in the index, belong to no scene, and their jumps lead from every scene', () => {
  const index = new ScenarioIndex(normalizeScenario({
    ...raw,
    characters: [{ ...raw.characters![1]!, events: [{ id: 70, actions: [{ id: 74, type: 'jump', scene_id: 3 }] }] }],
  }));
  const found = index.events.get(70)!;
  assert.equal(found.scene, null);
  assert.equal(found.character!.id, 6);
  assert.equal(found.event.character_id, 6);
  assert.ok(index.jumpTargets(1).includes(3) && index.jumpTargets(2).includes(3));
});

test('presence: where a character can be when a scene\'s action runs', () => {
  const npc = (id: number) => scenario.characters!.find((c) => c.id === id)!;
  assert.equal(characterPresence(scenario, npc(5), 3), 'anywhere');
  assert.equal(characterPresence(scenario, npc(7), 1), 'here');
  assert.equal(characterPresence(scenario, npc(7), 3), 'never');
  assert.equal(characterPresence(scenario, npc(6), 3), 'maybe', 'a walk action takes her to the garden');
  assert.equal(characterStart(scenario, npc(8)), null);
});

test('checks: characters that may not be there, walks, events, and placements no longer used', () => {
  assert.deepEqual(validateScenario(raw).errors, []);
  const bad = structuredClone(raw);
  const hall = bad.scenes[0]!;
  hall.indirect_events![0]!.actions.push(
    { id: 50, type: 'dialogue', speaker: 'character', character_id: 5, text: 'Beep' },
    { id: 51, type: 'animate', target: 'character', character_id: 7, animation: 'wave' },
    { id: 52, type: 'walk', character_id: 6, scene_id: 404, to: 'point', position_x: 1, position_y: 1 },
    { id: 53, type: 'run_event', target_event_id: 70 },
    { id: 54, type: 'walk', character_id: 6, scene_id: 3, to: 'spawn', spawn_point: 'nowhere' },
  );
  bad.scenes[1]!.indirect_events = [{
    id: 60, actions: [
      { id: 61, type: 'animate', target: 'character', character_id: 7, animation: 'wave' },
      { id: 62, type: 'dialogue', speaker: 'character', character_id: 6, text: 'Hm' },
    ],
  }];
  bad.scenes[2]!.indirect_events = [{ id: 65, actions: [{ id: 66, type: 'dialogue', speaker: 'character', character_id: 6, text: 'Hm' }] }];
  bad.characters![1]!.events!.push({ id: 75, actions: [{ id: 76, type: 'walk', character_id: 6, to: 'point', position_x: 1, position_y: 400 }] });
  bad.characters!.push({ id: 9, name: 'Bot', roams: true, scene_id: 2, event_id: 60, animations: { stand_right: { media_id: 1 } } });
  (bad.characters![3] as { routine?: unknown }).routine = { steps: [] };
  const result = validateScenario(bad);
  const messages = [...result.errors.map((i) => `E ${i.path}: ${i.message}`), ...result.warnings.map((i) => `W ${i.path}: ${i.message}`)];
  const has = (re: RegExp) => assert.ok(messages.some((m) => re.test(m)), `expected ${re} in\n${messages.join('\n')}`);
  has(/^W scenes\[0\]\.indirect_events\[0\]\.actions\[4\]\.character_id: Robo walks around on its own, so it may not be in this scene/);
  has(/^E scenes\[0\]\.indirect_events\[0\]\.actions\[6\]\.scene_id: Scene 404 does not exist/);
  has(/^W scenes\[0\]\.indirect_events\[0\]\.actions\[7\]\.target_event_id: This runs Guide’s event “talk”, which has Guide speak in a bubble .* may have walked to another scene/);
  has(/^E scenes\[0\]\.indirect_events\[0\]\.actions\[8\]\.spawn_point: Scene "scene 3" has no spawn point "nowhere"/);
  has(/^E scenes\[1\]\.indirect_events\[0\]\.actions\[0\]\.character_id: Statue is never in this scene/);
  has(/^W scenes\[1\]\.indirect_events\[0\]\.actions\[1\]\.character_id: Guide is never in this scene: .* shown in a story box/);
  has(/^W scenes\[2\]\.indirect_events\[0\]\.actions\[0\]\.character_id: Walk actions take Guide to other scenes too/);
  has(/^E characters\[1\]\.events\[2\]\.actions\[0\]\.scene_id: Choose the scene to walk to/);
  has(/^W characters\[4\]\.event_id: Clicking Bot runs an event of scene "scene 2", which runs only there, but Bot walks around on its own/);
  has(/^W characters\[3\]\.routine: Characters no longer follow routines/);
  has(/^W scenes\[2\]\.characters\[0\]: Statue is in one place at a time, and starts in "scene 1": this placement is not used/);
  assert.ok(!messages.some((m) => /scenes\[0\]\.characters\[0\]/.test(m)), 'the placement it starts at is fine');
});
