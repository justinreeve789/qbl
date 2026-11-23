import './fakePhaser';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, LaunchBroadcast, Scenario, User } from '@qbl/shared';
import type { LaunchableAssignment } from '../src/core/GameContext';
import { LaunchFeature, launchRows } from '../src/features/LaunchFeature';
import type { OfflineConnection } from '../src/net/Connection';
import { Game, loadScenario } from './harness';

const CONTROL_ROOM = 2;

/**
 * The starship demo with a departure scene: the control room, whose start event counts down and
 * travels to the launched mission, or, with nothing launched, says the shuttle is not ready.
 */
function scenario(): Scenario {
  const s = loadScenario();
  const room = s.scenes.find((sc) => sc.id === CONTROL_ROOM)!;
  room.start_events = [{
    id: 9001,
    actions: [
      { id: 9002, type: 'text_overlay', text: 'Off to {{QL_NextMission}} in 3, 2, 1…', duration: 300, conditions: [{ variable: 'QL_NextMission', operator: '!=', operand: '' }] },
      { id: 9003, type: 'travel' },
      { id: 9004, type: 'text_overlay', text: 'The shuttle is not ready yet.', duration: 300 },
    ] as Action[],
  }];
  return s;
}

function game(user: User = { id: 'u1', name: 'Sam', role: 'student' }) {
  const g = new Game(scenario(), user);
  const gone: LaunchBroadcast[] = [];
  g.ctx.goToMission = (launch) => gone.push(launch);
  const stop = new LaunchFeature().start(g.ctx);
  return { g, gone, stop, connection: g.ctx.connection as OfflineConnection };
}

const portal = (extra: Partial<LaunchBroadcast> = {}): LaunchBroadcast => ({ code: 'timeportal', title: 'Time Portal', group: 't7', by: 'Ms Rivera', ...extra });

test('sent through a departure scene: the player is taken there, its events play, and the travel takes them to the mission', async () => {
  const { g, gone, connection, stop } = game();
  await g.wait(100);
  assert.notEqual(g.scene.def.id, CONTROL_ROOM);
  assert.equal(g.var('QL_NextMission'), '');
  connection.launched(portal({ scene_id: CONTROL_ROOM }));
  assert.ok(g.ui.toasts.includes('🚀 Ms Rivera launched Time Portal!'), 'they are told who launched what');
  assert.equal(g.var('QL_NextMission'), 'Time Portal');
  await g.hold([], () => g.scene.def.id === CONTROL_ROOM, 5000);
  await g.wait(50);
  assert.deepEqual(g.ui.texts, ['Off to Time Portal in 3, 2, 1…'], 'the departure plays');
  assert.deepEqual(gone, [], 'and they are still here while it does');
  await g.wait(400);
  assert.deepEqual(gone.map((l) => [l.code, l.group]), [['timeportal', 't7']], 'then the travel action takes them into their own game of the mission');
  assert.ok(!g.ui.texts.includes('The shuttle is not ready yet.'), 'nothing after the travel runs');
  stop();
});

test('sent straight there: they go from the scene they are in, once its end events have run', async () => {
  const { g, gone, connection, stop } = game();
  await g.wait(100);
  const here = g.scene.def.id;
  connection.launched(portal());
  await g.wait(50);
  assert.equal(g.scene.def.id, here, 'no scene change on the way');
  assert.deepEqual(gone.map((l) => l.title), ['Time Portal']);
  await new Promise((r) => setTimeout(r, 4200));
  assert.equal(gone.length, 1, 'once only: the fallback for players between scenes does not send them twice');
  stop();
});

test('a travel action with nothing launched does nothing, and the event goes on', async () => {
  const { g, gone, stop } = game();
  await g.wait(100);
  void g.scene.engine.runAction({ type: 'jump', scene_id: CONTROL_ROOM });
  await g.hold([], () => g.scene.def.id === CONTROL_ROOM, 5000);
  await g.wait(50);
  assert.deepEqual(gone, []);
  assert.deepEqual(g.ui.texts, ['The shuttle is not ready yet.'], 'the departure is not played without a launch');
  assert.ok(g.ui.toasts.some((t) => t.startsWith('Here players go on to the mission their teacher launched')), 'a preview says what would happen');
  stop();
});

// ------------------------------------------------------------- the teacher's tab

const assignments: LaunchableAssignment[] = [
  { id: 1, scenario: { id: 1, title: 'Starship Explorer' }, due_at: null, students: [{ id: 21 }] },
  { id: 2, scenario: { id: 50, title: 'Shuttle to Mars' }, due_at: '2026-12-01 10:00:00', students: [{ id: 21 }, { id: 22 }, { id: 23 }] },
  { id: 3, scenario: { id: 51, title: 'Time Portal' }, due_at: null, waiting: true, students: [{ id: 21 }, { id: 23 }] },
  { id: 4, scenario: null, due_at: null, students: [] },
];

test('a teacher’s tab lists their other missions, waiting ones first, with how many of each are here, and the departure scenes', async (t) => {
  const { g, stop: stopFirst } = game({ id: 't1', name: 'Ms Rivera', role: 'teacher' });
  stopFirst();
  g.ctx.fetchLaunchable = async () => assignments;
  const connection = g.ctx.connection as OfflineConnection;
  connection.addPlayer('s21', { user_id: '21', name: 'Ann', scene_id: 3 });
  connection.addPlayer('s23', { user_id: '23', name: 'Cy', scene_id: 3, connected: false });
  const stop = new LaunchFeature().start(g.ctx);
  t.after(stop);
  await g.wait(50);
  const tab = g.ui.launchTab!;
  assert.deepEqual(tab.missions.map((m) => [m.assignmentId, m.title, m.waiting, m.here, m.students]), [
    [3, 'Time Portal', true, 1, 2],
    [2, 'Shuttle to Mars', false, 1, 3],
  ], 'not this mission, and not one no longer published; only those connected count as here');
  assert.deepEqual(tab.departures, [{ sceneId: CONTROL_ROOM, name: 'Starship control room' }], 'by the name players know it by');

  // Launching asks the game server; a preview has none, and says so.
  const notices: string[] = [];
  connection.on('notice', (n) => notices.push(n.message));
  g.ui.onLaunch({ assignmentId: 3, sceneId: CONTROL_ROOM, stay: false });
  assert.deepEqual(notices, ['Missions are launched in a class’s game, not in a preview.']);
});

test('students get no launch tab', async () => {
  const { g, stop } = game();
  await g.wait(10);
  assert.equal(g.ui.launchTab, null);
  stop();
  assert.deepEqual(launchRows(g.ctx, assignments).map((r) => r.assignmentId), [3, 2], 'the rows themselves do not depend on who asks');
});
