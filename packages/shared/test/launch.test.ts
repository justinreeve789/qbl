import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  departureScenes, isDepartureScene, isLauncherScene, launcherScenes, launchPath, leavesForLaunch, normalizeActionType, normalizeScenario, planLaunch, ScenarioIndex, SceneEngine, SYSTEM_VARIABLES, validateScenario, VariableStore, World,
  type Action, type ActionHandle, type EngineHost, type GameEvent, type ItemRec, type LaunchPlan, type PlayerRec, type OpenUrlAction, type Scenario, type TravelAction, type WorldState,
} from '../src/index.js';

// ------------------------------------------------------------- the travel action

/** Just enough of a host: actions finish at once, and travel goes where `destination` says. */
class Host implements EngineHost {
  log: string[] = [];
  destination: string | null = null;
  present(action: Action): ActionHandle {
    this.log.push(`present:${action.id}`);
    return { done: Promise.resolve(), cancel() {} };
  }
  translate() {
    return null;
  }
  delay(): ActionHandle {
    return { done: Promise.resolve(), cancel() {} };
  }
  jump(sceneId: number) {
    this.log.push(`jump:${sceneId}`);
  }
  travel(action: TravelAction) {
    this.log.push(`asked:${action.to ?? 'launched'}`);
    const where = this.destination;
    return where ? () => this.log.push(`travel:${where}`) : null;
  }
  /** Open URL: a new tab opens and the event goes on; the same tab leaves, like travel. */
  openUrl(action: OpenUrlAction) {
    this.log.push(`open:${action.url}:${action.new_tab === false ? 'here' : 'tab'}`);
    if (!action.url) return null;
    return action.new_tab === false ? () => this.log.push(`left:${action.url}`) : null;
  }
  warn(m: string) {
    this.log.push(`warn:${m}`);
  }
}
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};
const ev = (id: number, actions: Array<Record<string, unknown>>): GameEvent => ({ id, actions: actions as unknown as Action[] });

function engine(destination: string | null) {
  const scenario = normalizeScenario({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    scenes: [{
      id: 1, width: 100, height: 100,
      start_events: [ev(1, [{ id: 11, type: 'text_overlay', text: 'Doors close', duration: 1 }, { id: 12, type: 'travel' }, { id: 13, type: 'text_overlay', text: 'The shuttle is not ready yet', duration: 1 }])],
      end_events: [ev(2, [{ id: 21, type: 'text_overlay', text: 'Goodbye', duration: 1 }])],
    }],
  });
  const index = new ScenarioIndex(scenario);
  const host = new Host();
  host.destination = destination;
  return { host, engine: new SceneEngine(index.scene(1)!, index, new VariableStore([]), host) };
}

test('travel goes to the launched mission once the end events have run, and ends the event', async () => {
  const { host, engine: e } = engine('portal');
  e.start();
  await flush();
  assert.deepEqual(host.log, ['present:11', 'asked:launched', 'present:21', 'travel:portal'], 'like a jump: end events, then away; nothing after it runs');
});

test('travel with nowhere to go does nothing, and the event carries on', async () => {
  const { host, engine: e } = engine(null);
  e.start();
  await flush();
  assert.deepEqual(host.log, ['present:11', 'asked:launched', 'present:13']);
});

test('travel is an action type of its own, checked by the validator', () => {
  assert.equal(normalizeActionType('Travel'), 'travel');
  const doc = (action: Record<string, unknown>) => ({
    id: 1, shortname: 't', title: 't', start_scene_id: 1,
    scenes: [{ id: 1, width: 100, height: 100, start_events: [ev(1, [{ id: 2, type: 'travel', ...action }])] }],
  });
  assert.ok(validateScenario(doc({}) as never).ok, 'no attributes needed');
  assert.ok(validateScenario(doc({ to: 'launched' }) as never).ok);
  const bad = validateScenario(doc({ to: 'mars' }) as never);
  assert.ok(!bad.ok && bad.errors.some((x) => x.path.endsWith('.to')), 'it only goes to the launched mission');
});

test('two system variables say where a launch is taking the player: its title and its address', () => {
  const names = SYSTEM_VARIABLES.map((v) => v.name as string);
  assert.deepEqual(names.filter((n) => /Mission|launch/i.test(n)), ['QL_NextMission', 'QL_SCENARIO_LAUNCH_URL']);
  assert.equal(launchPath('time portal', 't 7'), '/time%20portal?group=t%207');
});

// ------------------------------------------------------------- the Open URL action

function urlEngine(actions: Array<Record<string, unknown>>) {
  const scenario = normalizeScenario({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    scenes: [{
      id: 1, width: 100, height: 100,
      start_events: [ev(1, [...actions, { id: 13, type: 'text_overlay', text: 'After', duration: 1 }])],
      end_events: [ev(2, [{ id: 21, type: 'text_overlay', text: 'Goodbye', duration: 1 }])],
    }],
  });
  const index = new ScenarioIndex(scenario);
  const host = new Host();
  return { host, engine: new SceneEngine(index.scene(1)!, index, new VariableStore([]), host) };
}

test('Open URL in a new tab (the default) opens it and the event carries on', async () => {
  const { host, engine: e } = urlEngine([{ id: 12, type: 'open_url', url: 'https://example.org' }]);
  e.start();
  await flush();
  assert.deepEqual(host.log, ['open:https://example.org:tab', 'present:13']);
});

test('Open URL in the same tab leaves like a jump: the end events run, and nothing after it', async () => {
  const { host, engine: e } = urlEngine([{ id: 12, type: 'open_url', url: '{{QL_SCENARIO_LAUNCH_URL}}', new_tab: false }]);
  e.start();
  await flush();
  assert.deepEqual(host.log, ['open:{{QL_SCENARIO_LAUNCH_URL}}:here', 'present:21', 'left:{{QL_SCENARIO_LAUNCH_URL}}']);
});

test('Open URL is checked by the validator: an address is needed, and one the game opens', () => {
  assert.equal(normalizeActionType('Open URL'), 'open_url');
  const doc = (action: Record<string, unknown>) => ({
    id: 1, shortname: 't', title: 't', start_scene_id: 1,
    scenes: [{ id: 1, width: 100, height: 100, start_events: [ev(1, [{ id: 2, type: 'open_url', ...action }])] }],
  });
  const ok = (action: Record<string, unknown>) => validateScenario(doc(action) as never);
  assert.ok(ok({ url: '{{QL_SCENARIO_LAUNCH_URL}}' }).ok);
  assert.ok(!ok({ url: '{{QL_SCENARIO_LAUNCH_URL}}' }).warnings.some((w) => w.message.includes('QL_SCENARIO_LAUNCH_URL')), 'a system variable');
  assert.ok(ok({ url: 'https://example.org', new_tab: false }).ok);
  assert.ok(ok({ url: '/sciencelab' }).ok, 'a page of this site');
  for (const url of ['', '   ', 'javascript:alert(1)', 'example.org']) {
    const bad = ok({ url });
    assert.ok(!bad.ok && bad.errors.some((x) => x.path.endsWith('.url')), `"${url}" is refused`);
  }
  assert.ok(!ok({ url: 'https://example.org', new_tab: 'yes' }).ok);
});

// ------------------------------------------------------------- launcher scenes

test('a launcher scene is one its setting says is, and without the setting one with a travel action', () => {
  const scenario = normalizeScenario({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    scenes: [
      { id: 1, width: 10, height: 10 },
      { id: 2, width: 10, height: 10, launcher: true, start_events: [ev(1, [{ id: 2, type: 'open_url', url: '{{ QL_SCENARIO_LAUNCH_URL }}' }])] },
      { id: 3, width: 10, height: 10, start_events: [ev(3, [{ id: 4, type: 'travel' }])] },
      { id: 4, width: 10, height: 10, launcher: false, start_events: [ev(5, [{ id: 6, type: 'travel' }])] },
      { id: 5, width: 10, height: 10, start_events: [ev(7, [{ id: 8, type: 'open_url', url: '{{QL_SCENARIO_LAUNCH_URL}}' }])] },
    ],
  });
  assert.deepEqual(launcherScenes(scenario).map((s) => s.id), [2, 3], 'the setting, then the old rule; an Open URL alone does not make one');
  assert.equal(isLauncherScene(scenario.scenes[3]!), false, 'unticked, a travel action does not make it one');
  assert.deepEqual(scenario.scenes.map(leavesForLaunch), [false, true, true, true, true]);
  const warned = validateScenario({ ...scenario, scenes: [...scenario.scenes, { id: 6, width: 10, height: 10, launcher: true }] } as never).warnings;
  assert.ok(warned.some((w) => w.path === 'scenes[5]' && w.message.includes('{{QL_SCENARIO_LAUNCH_URL}}')), 'a launcher scene that never leaves is flagged');
  assert.ok(!warned.some((w) => w.path === 'scenes[1]' && w.message.includes('launcher')));
});

// ------------------------------------------------------------- departure scenes

test('a departure scene is one with a travel action anywhere in its events', () => {
  const scenario = normalizeScenario({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    scenes: [
      { id: 1, width: 10, height: 10 },
      { id: 2, width: 10, height: 10, start_events: [ev(1, [{ id: 2, type: 'travel' }])] },
      { id: 3, width: 10, height: 10, hotspots: [{ id: 3, position_x: 1, position_y: 1, radius: 5, actions: [{ id: 4, type: 'conversation', lines: [{ id: 'l1', text: 'Ready?', choices: [{ text: 'Go!', actions: [{ type: 'travel' }] }] }] }] }] as never },
    ],
  });
  assert.deepEqual(departureScenes(scenario).map((s) => s.id), [2, 3], 'in a conversation’s choice too');
  assert.equal(isDepartureScene(scenario.scenes[0]!), false);
});

// ------------------------------------------------------------- who goes where

const plan: LaunchPlan = {
  assignment_id: 5, scenario_id: 9, code: 'timeportal', title: 'Time Portal', party: 'a5',
  students: [{ id: 11, group: 't1' }, { id: 12, group: 't2' }, { id: 13, group: 't2' }, { id: 14, group: 'a5' }],
};
const seat = (sessionId: string, userId: string, role = 'student') => ({ sessionId, userId, role });

test('a launch sends the assignment’s students here into their own games, and the teacher with the most of them', () => {
  const out = planLaunch(plan, [seat('T', '1', 'teacher'), seat('a', '11'), seat('b', '12'), seat('c', '13'), seat('x', '99'), seat('y', '2', 'teacher')], 'T');
  assert.deepEqual(out.go, [{ sessionId: 'a', group: 't1' }, { sessionId: 'b', group: 't2' }, { sessionId: 'c', group: 't2' }, { sessionId: 'T', group: 't2' }]);
  assert.equal(out.report, '🚀 Time Portal is launched: 3 students here are on the way. 1 student here is not in it and stays.', 'another teacher looking in is not counted');
});

test('a teacher can stay behind, and is told when nobody here is in the mission', () => {
  assert.deepEqual(planLaunch(plan, [seat('T', '1', 'teacher'), seat('a', '11')], 'T', true).go, [{ sessionId: 'a', group: 't1' }]);
  const alone = planLaunch(plan, [seat('T', '1', 'teacher'), seat('x', '98'), seat('z', '99')], 'T');
  assert.deepEqual(alone.go, [{ sessionId: 'T', group: 't1' }], 'with nobody going, the teacher goes to the first team’s game');
  assert.equal(alone.report, '🚀 Time Portal is launched: it is on its students’ missions page now. Nobody here is in it; the 2 students here stay.');
});

// ------------------------------------------------------------- the world's side

const floor = (w: number) => [[{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: 600 }, { x: 0, y: 600 }]];
const hub: Scenario = normalizeScenario({
  id: 7, shortname: 'hub', title: 'Hub', start_scene_id: 1,
  scenes: [
    { id: 1, width: 1000, height: 600, walkable_areas: floor(1000), spawn_points: [{ name: 'default', position_x: 100, position_y: 400 }],
      hotspots: [{ id: 10, position_x: 900, position_y: 400, radius: 20, actions: [{ id: 11, type: 'jump', scene_id: 2 }] }] },
    { id: 2, width: 800, height: 600, walkable_areas: floor(800), spawn_points: [{ name: 'default', position_x: 50, position_y: 450 }],
      hotspots: [{ id: 20, position_x: 10, position_y: 400, radius: 20, actions: [{ id: 21, type: 'jump', scene_id: 1 }] }] },
    { id: 3, width: 800, height: 600, walkable_areas: floor(800), spawn_points: [{ name: 'default', position_x: 400, position_y: 300 }], start_events: [ev(30, [{ id: 31, type: 'travel' }])] },
  ],
});

function world() {
  const state: WorldState = { players: new Map<string, PlayerRec>(), items: new Map<string, ItemRec>(), vars: new Map<string, string>() };
  const w = new World(hub, { state, now: () => 1_000_000, newPlayer: () => ({} as PlayerRec), newItem: () => ({} as ItemRec) });
  return { w, state };
}

test('the server takes a launched player to the departure scene, though no door leads there', () => {
  const { w, state } = world();
  w.addPlayer('a', { id: 'u1', name: 'Ann', role: 'student' }, { scene_id: 2, position_x: 300, position_y: 200 });
  assert.equal(w.changeScene('a', { scene_id: 3 }), false, 'a player cannot go there by themselves');
  assert.equal(w.sendToScene('a', 3), true);
  assert.deepEqual([state.players.get('a')!.scene_id, state.players.get('a')!.x, state.players.get('a')!.y], [3, 400, 300], 'at its spawn point');
  assert.equal(w.changeScene('a', { scene_id: 3 }), true, 'so their game’s own jump there is accepted');
  assert.deepEqual([w.sessionOf('a')!.scene_id, w.sessionOf('a')!.position_x, w.sessionOf('a')!.position_y], [2, 300, 200],
    'while they are there, they are saved where they were before: a visit another day does not start mid-countdown');
  assert.equal(w.sendToScene('a', 3), true, 'launched again while there');
  assert.equal(w.sessionOf('a')!.scene_id, 2, 'still saved where they were before the first launch');
  assert.equal(w.sendToScene('a', 404), false, 'no such scene');
});

test('once a player goes on from the departure scene, they are saved where they are', () => {
  const { w } = world();
  w.addPlayer('a', { id: 'u1', name: 'Ann', role: 'student' }, null);
  w.sendToScene('a', 2);
  assert.equal(w.sessionOf('a')!.scene_id, 1);
  assert.equal(w.changeScene('a', { scene_id: 1 }), true);
  assert.equal(w.changeScene('a', { scene_id: 2 }), true);
  assert.equal(w.sessionOf('a')!.scene_id, 2, 'back in scene 2 by the door, they are saved there');
});
