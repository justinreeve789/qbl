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
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(gone.length, 1, 'once only: the fallback for players between scenes does not send them twice');
  stop();
});

test('playing another scenario, with a launcher scene chosen: their page goes to the teacher’s scenario first, at once', async () => {
  const { g, gone, connection, stop } = game();
  await g.wait(100);
  const pages: string[] = [];
  g.ctx.leavePage = (href) => pages.push(href);
  connection.launched(portal({ detour: '/hub?group=public&launch=x' }));
  assert.deepEqual(pages, ['/hub?group=public&launch=x'], 'no waiting for the scene they are in');
  assert.deepEqual(gone, [], 'not on to the launched scenario yet: the launcher scene takes them there');
  stop();
});

test('sent to the launcher scene while between two scenes: their game is taken there once it has arrived', async () => {
  const { g, connection, stop } = game();
  await g.wait(100);
  const before = g.scene.def.id;
  // Between scenes: no scene to run the jump in for now.
  const inScene = g.ctx.inScene;
  const sceneId = g.ctx.sceneId;
  g.ctx.inScene = null;
  g.ctx.sceneId = null;
  connection.launched(portal({ scene_id: CONTROL_ROOM }));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(g.scene.def.id, before, 'nothing to follow while between scenes');
  g.ctx.inScene = inScene;
  g.ctx.sceneId = sceneId;
  await g.hold([], () => g.scene.def.id === CONTROL_ROOM, 5000);
  assert.equal(g.scene.def.id, CONTROL_ROOM, 'once a scene is running, they are taken there');
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

// ------------------------------------------------------------- a launcher scene with Open URL

/** A browser window, as much as Open URL uses: where the game is, and the tabs it opens (null: blocked). */
function fakeWindow(blocked = false) {
  const opened: string[] = [];
  const w = { location: { href: 'https://qbl.test/starship?group=t7', origin: 'https://qbl.test' }, open: (href: string) => (opened.push(href), blocked ? null : {}) };
  (globalThis as { window?: unknown }).window = w;
  return { opened, restore: () => delete (globalThis as { window?: unknown }).window };
}

/** The control room as a launcher scene that ends with Open URL to the launched scenario. */
function urlGame(newTab: boolean, url = '{{QL_SCENARIO_LAUNCH_URL}}') {
  const s = scenario();
  const room = s.scenes.find((sc) => sc.id === CONTROL_ROOM)!;
  room.launcher = true;
  room.start_events = [{
    id: 9001,
    actions: [
      { id: 9002, type: 'text_overlay', text: 'Boarding for {{QL_SCENARIO_LAUNCH_URL}}', duration: 100, conditions: [{ variable: 'QL_SCENARIO_LAUNCH_URL', operator: '!=', operand: '' }] },
      { id: 9003, type: 'open_url', url, ...(newTab ? {} : { new_tab: false }) },
      { id: 9004, type: 'text_overlay', text: 'Still here.', duration: 100 },
    ] as Action[],
  }];
  const g = new Game(s, { id: 'u1', name: 'Sam', role: 'student' });
  const gone: LaunchBroadcast[] = [];
  const left: string[] = [];
  g.ctx.goToMission = (launch) => gone.push(launch);
  g.ctx.leavePage = (href) => left.push(href);
  const stop = new LaunchFeature().start(g.ctx);
  return { g, gone, left, stop, connection: g.ctx.connection as OfflineConnection };
}

test('a launcher scene: QL_SCENARIO_LAUNCH_URL is the student’s own game of the launched scenario, and Open URL in the same tab takes them there', async (t) => {
  const win = fakeWindow();
  t.after(win.restore);
  const { g, gone, left, connection, stop } = urlGame(false);
  t.after(stop);
  await g.wait(100);
  assert.equal(g.var('QL_SCENARIO_LAUNCH_URL'), '', 'empty before anything is launched');
  connection.launched(portal({ scene_id: CONTROL_ROOM, url: '/timeportal?group=t7' }));
  assert.equal(g.var('QL_SCENARIO_LAUNCH_URL'), 'https://qbl.test/timeportal?group=t7');
  await g.hold([], () => g.scene.def.id === CONTROL_ROOM, 5000);
  await g.wait(30);
  assert.deepEqual(g.ui.texts, ['Boarding for https://qbl.test/timeportal?group=t7']);
  await g.wait(200);
  assert.deepEqual(gone.map((l) => [l.code, l.group]), [['timeportal', 't7']], 'the launched scenario, saved and left as a travel action does');
  assert.deepEqual(left, []);
  assert.deepEqual(win.opened, [], 'no new tab');
  assert.ok(!g.ui.texts.includes('Still here.'), 'like a jump, nothing after it runs');
  assert.equal(g.var('QL_SCENARIO_LAUNCH_URL'), '', 'and once they have gone, there is nowhere left to go');
});

test('the launched scenario on its own always opens in the same tab, even when new_tab is left on', async (t) => {
  const win = fakeWindow();
  t.after(win.restore);
  const { g, gone, connection, stop } = urlGame(true, ' {{ QL_SCENARIO_LAUNCH_URL }} ');
  t.after(stop);
  await g.wait(100);
  connection.launched(portal({ scene_id: CONTROL_ROOM }));
  await g.hold([], () => g.scene.def.id === CONTROL_ROOM, 5000);
  await g.wait(300);
  assert.deepEqual(win.opened, []);
  assert.deepEqual(gone.map((l) => l.code), ['timeportal']);
});

test('Open URL in a new tab opens it there and the scene goes on; a blocked tab becomes a button', async (t) => {
  for (const blocked of [false, true]) {
    const win = fakeWindow(blocked);
    const { g, gone, connection, stop } = urlGame(true, '{{QL_SCENARIO_LAUNCH_URL}}&from=hub');
    await g.wait(100);
    connection.launched(portal({ scene_id: CONTROL_ROOM }));
    await g.hold([], () => g.scene.def.id === CONTROL_ROOM, 5000);
    await g.wait(300);
    assert.deepEqual(win.opened, ['https://qbl.test/timeportal?group=t7&from=hub'], 'without a url from the server, the same address is made from the code and group');
    assert.deepEqual(gone, []);
    assert.deepEqual(g.ui.links.map((l) => l.href), blocked ? ['https://qbl.test/timeportal?group=t7&from=hub'] : []);
    stop();
    win.restore();
  }
});

test('Open URL never opens a script address, and in a preview never leaves the editor', async (t) => {
  const win = fakeWindow();
  t.after(win.restore);
  const g = new Game(scenario(), { id: 'u1', name: 'Sam', role: 'student' });
  await g.wait(50);
  void g.scene.engine.runAction({ type: 'open_url', url: 'javascript:alert(1)', new_tab: false } as Action);
  await g.wait(20);
  assert.deepEqual(win.opened, []);
  assert.ok(g.ui.toasts.some((m) => m.includes('not a web address')));
  void g.scene.engine.runAction({ type: 'open_url', url: 'https://example.org/a', new_tab: false } as Action);
  await g.wait(20);
  assert.deepEqual(win.opened, ['https://example.org/a'], 'no leavePage (a preview): a new tab instead');
  void g.scene.engine.runAction({ type: 'open_url', url: '{{QL_SCENARIO_LAUNCH_URL}}' } as Action);
  await g.wait(20);
  assert.equal(win.opened.length, 1, 'nothing launched: nothing opens');
  assert.ok(g.ui.toasts.some((m) => m.startsWith('Here players open the scenario their teacher launched')));
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

test('moved by the room while busy, a player still hears the launcher scene: its sounds load before it starts', async () => {
  // The control room's cutscene opens with a sound no door leads to, so nothing has preloaded it.
  const s = scenario();
  s.assets.push({ id: 99001, type: 'audio', url: 'audio/countdown.mp3' } as (typeof s.assets)[number]);
  const room = s.scenes.find((sc) => sc.id === CONTROL_ROOM)!;
  room.start_events![0]!.actions.unshift({ id: 9010, type: 'audio', media_id: 99001 } as Action);
  const g = new Game(s);
  assert.notEqual(g.scene.def.id, CONTROL_ROOM);
  assert.equal(g.scene.cache.audio.exists('media-99001'), false);

  // The launch's jump has not run (the player is in a dialogue, say): the room has moved them, and the
  // screen follows it on its own after a moment, as it does for any disagreement with the room.
  (g.ctx.connection as unknown as { world: { sendToScene(id: string, scene: number): void } }).world.sendToScene(g.ctx.connection.sessionId, CONTROL_ROOM);
  await g.wait(2500);

  assert.equal(g.scene.def.id, CONTROL_ROOM);
  assert.ok(g.world.sounds.some((sound) => (sound as unknown as { key: string }).key === 'media-99001'), 'the launcher scene\'s sound played');
});
