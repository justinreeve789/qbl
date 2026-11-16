import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, World, type ItemRec, type PlayerRec, type Scenario, type User, type WorldState } from '../src/index.js';

const floor = (w: number) => [[{ x: 0, y: 300 }, { x: w, y: 300 }, { x: w, y: 600 }, { x: 0, y: 600 }]];

const scenario: Scenario = normalizeScenario({
  id: 7, shortname: 'w', title: 'W', start_scene_id: 1, move_speed: 400, avatar_media_ids: [1, 2],
  assets: [{ id: 1, type: 'image', url: 'a.png' }, { id: 2, type: 'image', url: 'b.png' }],
  global_variables: [
    { variable_name: 'coins', default_value: 0 },
    { variable_name: 'door', default_value: 'closed', scope: 'room' },
    { variable_name: 'count', default_value: 0, scope: 'room' },
  ],
  items: [
    { id: 1, name: 'rover', vehicle: true, unique: true, speed_multiplier: 2 },
    { id: 2, name: 'hat', wearable: true },
    { id: 3, name: 'rock', blocking: true, blocking_radius: 50 },
    { id: 4, name: 'ufo', vehicle: true },
  ],
  scenes: [
    {
      id: 1, width: 1000, height: 600, walkable_areas: floor(1000),
      spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }, { name: 'east', position_x: 900, position_y: 400 }],
      // The east edge: a walk-in hotspot spanning the whole y-axis whose action jumps to scene 2.
      hotspots: [{ id: 10, position_x: 1000, position_y: null, radius: 20, actions: [{ id: 11, type: 'jump', scene_id: 2, spawn_point: 'west' }] }],
      indirect_events: [
        { id: 20, audience: 'scene', actions: [{ id: 21, type: 'text_overlay', text: 'Rumble' }, { id: 22, type: 'variable', name: 'door', operator: 'set', operand: 'open' }] },
        { id: 30, actions: [{ id: 31, type: 'text_overlay', text: 'Mine' }] },
      ],
      items: [
        { item_id: 1, position_x: 200, position_y: 400 },
        { item_id: 2, position_x: 150, position_y: 450 },
        { item_id: 3, position_x: 500, position_y: 450 },
        { item_id: 4, position_x: 120, position_y: 500 },
      ],
    },
    { id: 2, width: 800, height: 600, walkable_areas: floor(800), spawn_points: [{ name: 'west', position_x: 50, position_y: 450 }] },
    { id: 3, width: 800, height: 600 },
  ],
});

function make(instance: ConstructorParameters<typeof World>[2] = null) {
  const state: WorldState = { players: new Map<string, PlayerRec>(), items: new Map<string, ItemRec>(), vars: new Map<string, string>() };
  const clock = { now: 1_000_000 };
  const world = new World(scenario, {
    state, now: () => clock.now, random: () => 0.5,
    newPlayer: () => ({} as PlayerRec), newItem: () => ({} as ItemRec),
  }, instance);
  return { world, state, clock };
}
const ann: User = { id: 'u1', name: 'Ann', role: 'student' };
const bob: User = { id: 'u2', name: 'Bob', role: 'student' };

test('joining: spawn, saved position, repaired position, avatar choice', () => {
  const { world, state } = make();
  world.addPlayer('a', ann, null, 2);
  const a = state.players.get('a')!;
  assert.deepEqual([a.scene_id, a.x, a.y, a.avatar, a.connected], [1, 100, 400, 2, true]);

  const s = world.addPlayer('b', bob, { scene_id: 2, position_x: 400, position_y: 500, variables: { coins: 3, door: 'x', junk: 1 }, attachments: [2, 1, 99] }, 77);
  const b = state.players.get('b')!;
  assert.deepEqual([b.scene_id, b.x, b.y, b.avatar], [2, 400, 500, 1], 'unknown avatar falls back to the first allowed');
  assert.deepEqual(s.variables, { coins: 3 }, 'only declared player-scoped variables are kept');
  assert.equal(b.attachments, '2', 'unique and unknown items are not restored from a player save');

  const { world: w2, state: s2 } = make();
  w2.addPlayer('c', ann, { scene_id: 1, position_x: 500, position_y: 100 });
  const c = s2.players.get('c')!;
  assert.ok(c.y >= 300, 'a saved position outside the walkable area is moved to the nearest valid point');
  w2.addPlayer('d', bob, { scene_id: 404 });
  assert.equal(s2.players.get('d')!.scene_id, 1, 'a deleted scene falls back to the start scene');
});

test('movement is rate-limited and kept inside walkable space', () => {
  const { world, state, clock } = make();
  world.addPlayer('a', ann, null);
  clock.now += 100;
  assert.deepEqual(world.move('a', { x: 130, y: 400, facing: 'left' }), { ok: true });
  assert.equal(state.players.get('a')!.facing, 'left');
  clock.now += 100;
  assert.deepEqual(world.move('a', { x: 900, y: 400, facing: 'right' }), { ok: false, x: 130, y: 400, scene_id: 1 }, 'teleport rejected');
  clock.now += 100;
  assert.equal(world.move('a', { x: 130, y: 290, facing: 'right' }).ok, false, 'off the floor');
  clock.now += 2000;
  assert.equal(world.move('a', { x: 130, y: NaN, facing: 'right' }).ok, false);

  // Walk toward the blocking rock at (500,450), radius 50.
  let x = 130;
  let blockedAt = 0;
  for (let i = 0; i < 40 && !blockedAt; i++) {
    clock.now += 100;
    if (world.move('a', { x: x + 30, y: 450, facing: 'right' }).ok) x += 30;
    else blockedAt = x;
  }
  assert.ok(blockedAt > 400 && blockedAt <= 450, `stopped at the rock (${blockedAt})`);
});

test('scene changes follow jump targets and land on the spawn point', () => {
  const { world, state } = make();
  world.addPlayer('a', ann, null);
  assert.equal(world.changeScene('a', { scene_id: 3 }), false, 'scene 3 is not reachable from scene 1');
  assert.equal(world.changeScene('a', { scene_id: 99 }), false);
  assert.equal(world.setAvatarVisible('a', { visible: false }), true);
  assert.equal(state.players.get('a')!.hidden, true, 'an avatar action hides the player for everyone');
  assert.equal(world.setAvatarVisible('a', { visible: 'no' as unknown as boolean }), false);
  assert.equal(world.changeScene('a', { scene_id: 2, spawn_point: 'west' }), true);
  assert.equal(state.players.get('a')!.hidden, false, 'and arriving in a scene shows them again');
  const a = state.players.get('a')!;
  assert.deepEqual([a.scene_id, a.x, a.y], [2, 50, 450]);
});

test('room variables are shared, validated and persisted', () => {
  const { world, state } = make({ variables: { door: 'open', coins: 9 }, items: {} });
  assert.equal(state.vars.get('door'), '"open"', 'restored from the instance save');
  assert.equal(state.vars.get('coins'), undefined, 'player-scoped variables never enter room state');
  world.addPlayer('a', ann, null);
  assert.equal(world.setVariable('a', { name: 'coins', operator: 'set', operand: 5 }), false);
  assert.equal(world.setVariable('a', { name: 'count', operator: '+', operand: 2 }), true);
  assert.equal(world.setVariable('a', { name: 'count', operator: 'bogus' as never, operand: 2 }), false);
  assert.equal(state.vars.get('count'), '2');
  world.setVariable('a', { name: 'count', operator: 'random' });
  assert.equal(state.vars.get('count'), '500000001');
  assert.ok(world.dirty);
  assert.deepEqual(world.instanceData().variables, { door: 'open', count: 500000001 });
});

test('items: reach, unique ownership, one vehicle, dropping, speed', () => {
  const { world, state, clock } = make();
  world.addPlayer('a', ann, null);
  world.addPlayer('b', bob, null);
  const a = state.players.get('a')!;
  const rover = state.items.get('1')!;
  assert.deepEqual([rover.scene_id, rover.x, rover.holder], [1, 200, '']);
  assert.equal(state.items.get('2'), undefined, 'non-unique items are not room state');

  assert.equal(world.item('a', { item_id: 3, action: 'attach' }), false, 'a rock is neither wearable nor a vehicle');
  assert.equal(world.item('a', { item_id: 1, action: 'attach' }), true);
  assert.equal(rover.holder, 'a');
  assert.equal(world.item('b', { item_id: 1, action: 'attach' }), false, 'someone else is riding it');
  assert.equal(world.item('a', { item_id: 4, action: 'attach' }), false, 'one vehicle at a time');
  assert.equal(world.item('a', { item_id: 2, action: 'attach' }), true);
  assert.equal(a.attachments, '1,2');
  assert.equal(world.item('b', { item_id: 2, action: 'attach' }), true, 'everyone gets their own hat');

  // Riding doubles the speed: after 200ms the rover may cover 200px, a walker may not.
  clock.now += 200;
  assert.equal(world.move('a', { x: 300, y: 400, facing: 'right' }).ok, true);
  assert.equal(world.move('b', { x: 300, y: 400, facing: 'right' }).ok, false);

  // Ride to scene 2 and get off there: the rover stays in scene 2.
  world.changeScene('a', { scene_id: 2, spawn_point: 'west' });
  assert.equal(world.item('a', { item_id: 1, action: 'detach' }), true);
  assert.deepEqual([rover.scene_id, rover.x, rover.y, rover.holder], [2, 50, 450, '']);
  assert.equal(world.item('b', { item_id: 1, action: 'attach' }), false, 'it is in another scene now');
  assert.equal(a.attachments, '2');

  // Leaving while holding a unique item drops it; the hat is saved with the player.
  world.item('a', { item_id: 1, action: 'attach' });
  world.progress('a', { variables: { coins: 4, hacked: 1 } as never, flags: ['hotspot:1'], time_elapsed: 12 });
  const saved = world.removePlayer('a')!;
  assert.equal(rover.holder, '');
  assert.deepEqual(saved.attachments, [2]);
  assert.deepEqual(saved.variables, { coins: 4 });
  assert.deepEqual([saved.scene_id, saved.flags, saved.time_elapsed], [2, ['hotspot:1'], 12]);
  assert.equal(state.players.get('a'), undefined);
  assert.deepEqual(world.instanceData().items['1'], { scene_id: 2, x: 50, y: 450 });

  // A new room for the same group puts the rover back where it was left.
  const next = make(world.instanceData());
  assert.deepEqual([next.state.items.get('1')!.scene_id, next.state.items.get('1')!.x], [2, 50]);
  assert.equal(world.findSessionByUser('u2'), 'b');
});

test('showing an event to the scene: only its shown actions, only to players in the same scene', () => {
  const { world } = make();
  const cat: User = { id: 'u3', name: 'Cat', role: 'student' };
  world.addPlayer('a', ann, null);
  world.addPlayer('b', bob, null);
  world.addPlayer('c', cat, { scene_id: 2, position: { x: 50, y: 450 }, variables: {}, flags: [], time_elapsed: 0 } as never);
  assert.deepEqual(world.show('a', { event_id: 20, action_id: 21 }), ['b'], 'Cat is in another scene');
  assert.equal(world.show('a', { event_id: 20, action_id: 22 }), null, 'a variable action is not something to show');
  assert.equal(world.show('a', { event_id: 30, action_id: 31 }), null, 'a private event cannot be pushed onto others');
  assert.equal(world.show('a', { event_id: 20, action_id: 31 }), null, 'the action must belong to the event');
  assert.equal(world.show('c', { event_id: 20, action_id: 21 }), null, 'nor from a scene the event is not in');
  assert.equal(world.show('nobody', { event_id: 20, action_id: 21 }), null);
});
