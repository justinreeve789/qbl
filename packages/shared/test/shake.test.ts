import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeActionType, normalizeScenario, ScenarioIndex, SceneEngine, shakeAmount, shakesUntilStopped, sharesWithScene, validateScenario, VariableStore, World,
  type Action, type ActionHandle, type EngineHost, type GameEvent, type ItemRec, type PlayerRec, type ShakeAction, type User, type WorldState,
} from '../src/index.js';

const floor = [[{ x: 0, y: 300 }, { x: 1000, y: 300 }, { x: 1000, y: 600 }, { x: 0, y: 600 }]];

/**
 * Event 10: the player's own, with a shake for everyone (2) and one following the event (3). Event 20: the scene's, with a shake kept to the player (22) and one following (23).
 * Event 30: a shake for everyone with no duration (31), then a variable. Event 40: cancels action 31. Event 50: stops event 30.
 */
const doc = () => normalizeScenario({
  id: 1, shortname: 't', title: 'T', start_scene_id: 1, global_variables: [{ variable_name: 'n', default_value: 0 }],
  scenes: [{
    id: 1, width: 1000, height: 600, walkable_areas: floor,
    spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }],
    indirect_events: [
      { id: 10, actions: [
        { id: 1, type: 'variable', name: 'n', operator: '+', operand: 1 },
        { id: 2, type: 'shake', intensity: 6, duration: 800, audience: 'scene' },
        { id: 3, type: 'shake', duration: 200 },
      ] },
      { id: 20, audience: 'scene', actions: [
        { id: 22, type: 'shake', audience: 'player', duration: 300 },
        { id: 23, type: 'shake', intensity: 2, duration: 300 },
      ] },
      { id: 30, actions: [
        { id: 31, type: 'shake', intensity: 2, audience: 'scene', blocking: true },
        { id: 32, type: 'variable', name: 'n', operator: '+', operand: 1 },
      ] },
      { id: 40, actions: [{ id: 41, type: 'cancel', action_id: 31 }] },
      { id: 50, actions: [{ id: 51, type: 'cancel_event', target_event_id: 30 }] },
    ],
  }],
});

function engineWith(log: string[], finishers: Array<() => void>) {
  const resolved = (): ActionHandle => ({ done: Promise.resolve(), cancel() {} });
  const host: EngineHost = {
    present: () => resolved(),
    translate: () => null,
    delay: () => resolved(),
    jump: () => {},
    share: (_e: GameEvent, a: Action) => log.push(`share:${a.id}`),
    shake: (a: ShakeAction) => {
      log.push(`shake:${a.id}`);
      let end = () => {};
      const done = new Promise<void>((r) => finishers.push((end = r)));
      return { done, cancel() { log.push(`stop:${a.id}`); end(); } };
    },
  };
  const scenario = doc();
  const index = new ScenarioIndex(scenario);
  const vars = new VariableStore([{ variable_name: 'n', default_value: 0 }]);
  return Object.assign(new SceneEngine(index.scene(1)!, index, vars, host), { vars });
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test('shake is a known action type, and its settings are checked', () => {
  assert.equal(normalizeActionType('shake'), 'shake');
  assert.deepEqual(validateScenario(doc()).errors, []);
  const bad = doc();
  bad.scenes[0]!.indirect_events![0]!.actions.push(
    { id: 4, type: 'shake', intensity: 11 } as Action,
    { id: 5, type: 'shake', duration: -1 } as Action,
    { id: 6, type: 'shake', audience: 'world' } as unknown as Action,
    { id: 7, type: 'shake', duration: 9000 } as Action,
  );
  const { errors, warnings } = validateScenario(bad);
  const text = errors.map((e) => `${e.path}: ${e.message}`).join('\n');
  assert.match(text, /actions\[3\]\.intensity/);
  assert.match(text, /actions\[4\]\.duration/);
  assert.match(text, /actions\[5\]\.audience/);
  assert.equal(errors.length, 3, text);
  assert.ok(warnings.some((w) => /actions\[6\]\.duration/.test(w.path)), 'a very long shake is only a warning');
});

test('how shaky: 1 to 10, default 3, clamped', () => {
  assert.equal(shakeAmount(undefined), shakeAmount(3));
  assert.ok(shakeAmount(1) < shakeAmount(5) && shakeAmount(5) < shakeAmount(10));
  assert.equal(shakeAmount(50), shakeAmount(10));
  assert.equal(shakeAmount(-2), shakeAmount(1));
  assert.ok(shakeAmount(10) <= 0.05, 'even an earthquake keeps the scene on screen');
});

test('who feels it: a shake\'s own audience wins over its event\'s', () => {
  const mine: Pick<GameEvent, 'audience'> = { audience: 'player' };
  const scene: Pick<GameEvent, 'audience'> = { audience: 'scene' };
  const shake = (audience?: 'player' | 'scene') => ({ id: 1, type: 'shake', audience } as ShakeAction);
  assert.equal(sharesWithScene(mine, shake('scene')), true, 'everyone, from the player\'s own event');
  assert.equal(sharesWithScene(scene, shake('player')), false, 'only the player, in an event shown to the scene');
  assert.equal(sharesWithScene(scene, shake()), true, 'unset: as the event');
  assert.equal(sharesWithScene(mine, shake()), false);
  assert.equal(sharesWithScene({}, shake()), false, 'an event without an audience is the player\'s');
  assert.equal(sharesWithScene(mine, { id: 1, type: 'text_overlay', text: 'x' } as Action), false, 'other actions follow their event');
});

test('the engine shakes, shares what the scene should feel, and waits when blocking', async () => {
  const log: string[] = [];
  const finishers: Array<() => void> = [];
  const engine = engineWith(log, finishers);
  void engine.triggerById(10);
  await tick();
  assert.deepEqual(log, ['share:2', 'shake:2'], 'shared first, so others feel it at the same moment');
  finishers.shift()!();
  await tick();
  assert.deepEqual(log, ['share:2', 'shake:2', 'shake:3'], 'the next one waited; it follows the event, so is not shared');
  finishers.shift()!();
  await tick();

  log.length = 0;
  void engine.triggerById(20);
  await tick();
  finishers.shift()!();
  await tick();
  assert.deepEqual(log, ['shake:22', 'share:23', 'shake:23'], 'kept to the player even in an event for the scene');
});

test('watchers feel only the shakes meant for them', () => {
  const log: string[] = [];
  const engine = engineWith(log, []);
  engine.watch(10, 2, 'ann');
  engine.watch(10, 3, 'ann');
  engine.watch(20, 22, 'ann');
  engine.watch(20, 23, 'ann');
  assert.deepEqual(log, ['shake:2', 'shake:23']);
});

test('the server passes on a shake only where it may be shown', () => {
  const state: WorldState = { players: new Map<string, PlayerRec>(), items: new Map<string, ItemRec>(), vars: new Map<string, string>() };
  const world = new World(doc(), { state, now: () => 1, random: () => 0.5, newPlayer: () => ({} as PlayerRec), newItem: () => ({} as ItemRec) }, null);
  world.addPlayer('a', { id: 'u1', name: 'Ann', role: 'student' } as User, null);
  world.addPlayer('b', { id: 'u2', name: 'Bob', role: 'student' } as User, null);
  assert.deepEqual(world.show('a', { event_id: 10, action_id: 2 }), ['b'], 'a shake for the scene, from a player\'s own event');
  assert.equal(world.show('a', { event_id: 10, action_id: 3 }), null, 'one following a player\'s event');
  assert.equal(world.show('a', { event_id: 10, action_id: 1 }), null, 'nor anything else of that event');
  assert.equal(world.show('a', { event_id: 20, action_id: 22 }), null, 'one kept to the player');
  assert.deepEqual(world.show('a', { event_id: 20, action_id: 23 }), ['b']);
});

test('no duration: shakes until stopped', () => {
  assert.equal(shakesUntilStopped({}), true);
  assert.equal(shakesUntilStopped({ duration: undefined }), true);
  assert.equal(shakesUntilStopped({ duration: 500 }), false);
  assert.equal(shakesUntilStopped({ duration: 0 }), false, '0 is a length (no shake), not "until stopped"');
  assert.deepEqual(validateScenario(doc()).warnings.filter((w) => /duration/.test(w.path)), [], 'and it is not warned about as too long');
});

test('a shake with no duration never holds up its event, and runs on after it', async () => {
  const log: string[] = [];
  const engine = engineWith(log, []);
  await engine.triggerById(30);
  assert.deepEqual(log, ['share:31', 'shake:31'], 'blocking or not, the next action did not wait');
  assert.equal(engine.vars.get('n'), 1);
  await tick();
  assert.ok(!log.includes('stop:31'), 'the event is over, but the shake goes on');
});

test('a cancel of the action, a cancel_event of its event, or leaving stops it', async () => {
  for (const [how, stop] of [
    ['cancel', (e: ReturnType<typeof engineWith>) => e.triggerById(40)],
    ['cancel_event', (e: ReturnType<typeof engineWith>) => e.triggerById(50)],
    ['leaving', (e: ReturnType<typeof engineWith>) => e.stop()],
  ] as const) {
    const log: string[] = [];
    const engine = engineWith(log, []);
    await engine.triggerById(30);
    await stop(engine);
    await tick();
    assert.ok(log.includes('stop:31'), how);
  }
});

test('on watchers\' screens it also stops when the player who started it leaves', async () => {
  const log: string[] = [];
  const engine = engineWith(log, []);
  engine.watch(30, 31, 'ann');
  engine.watch(10, 2, 'bob');
  assert.deepEqual(engine.endlessActors, ['ann'], 'only shakes with no duration are kept by who started them');
  engine.forget('bob');
  engine.forget('ann');
  await tick();
  assert.deepEqual(log, ['shake:31', 'shake:2', 'stop:31']);
  assert.deepEqual(engine.endlessActors, []);
});
