import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  animationRepeats, automaticAnimation, rankFor, revealAmount, scaleAt, sceneMusic, speedFactorAt,
  applyOperator, collectSceneMediaIds, escapeHtml, evaluateObjectives, interpolate, placeholderVariables, MoveBudget, sceneSize, computeJumpTargets, inHotspot, isWalkable,
  nearestWalkable, normalizeActionType, normalizeScenario, resolveMove, ScenarioIndex, SceneEngine,
  currentName, isReserved, RESERVED_VARIABLES, SYSTEM_VARIABLES, takesItems, testCondition, validateMove, validateScenario, VariableStore, walkContext,
  type Action, type ActionHandle, type EngineHost, type GameEvent, type Scenario, type Scene,
} from '../src/index.js';

// ------------------------------------------------------------- helpers

/** A host with a manual clock so tests control time exactly. */
class FakeHost implements EngineHost {
  now = 0;
  log: string[] = [];
  jumps: Array<[number, string | undefined]> = [];
  private timers: Array<{ at: number; fire: () => void }> = [];
  durations: Record<number, number> = {};

  frozen = false;
  freeze(frozen: boolean) {
    this.frozen = frozen;
    this.log.push(frozen ? 'freeze' : 'unfreeze');
  }

  avatar(visible: boolean, duration: number): ActionHandle {
    this.log.push(`avatar:${visible ? 'show' : 'hide'}`);
    return this.timed(duration);
  }

  private timed(ms: number, label?: string): ActionHandle {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const timer = { at: this.now + ms, fire: () => finish() };
    this.timers.push(timer);
    return {
      done,
      cancel: () => {
        this.timers = this.timers.filter((t) => t !== timer);
        if (label) this.log.push(`cancel:${label}`);
        finish();
      },
    };
  }
  shared: number[] = [];
  share(_event: GameEvent, action: Action) {
    this.shared.push(action.id);
  }
  present(action: Action, _engine?: unknown, actor?: string): ActionHandle {
    this.log.push(actor ? `present:${action.id}:from:${actor}` : `present:${action.id}`);
    const ms = this.durations[action.id] ?? ('duration' in action && action.duration ? action.duration : Infinity);
    return this.timed(ms, String(action.id));
  }
  translate(): ActionHandle | null {
    return this.timed(0);
  }
  delay(ms: number): ActionHandle {
    return this.timed(ms);
  }
  jump(sceneId: number, spawn?: string): void {
    this.jumps.push([sceneId, spawn]);
  }
  warn(m: string): void {
    this.log.push(`warn:${m}`);
  }
  /** Advance the clock, firing timers in order and letting promises settle between each. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      await flush();
      const next = this.timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      this.timers = this.timers.filter((t) => t !== next);
      this.now = next.at;
      next.fire();
    }
    this.now = end;
    await flush();
  }
}
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function setup(scene: Partial<Scene>, vars: Scenario['global_variables'] = []) {
  const scenario = normalizeScenario({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1, global_variables: vars,
    assets: [{ id: 1, type: 'image', url: 'a.png' }, { id: 2, type: 'audio', url: 'a.mp3' }],
    scenes: [{ id: 1, width: 1000, height: 600, ...scene }, { id: 2, width: 100, height: 100 }],
  });
  const index = new ScenarioIndex(scenario);
  const store = new VariableStore(scenario.global_variables);
  const host = new FakeHost();
  const engine = new SceneEngine(index.scene(1)!, index, store, host);
  return { scenario, index, store, host, engine };
}
const ev = (id: number, actions: Array<Record<string, unknown>>, extra: Partial<GameEvent> = {}): GameEvent =>
  ({ id, actions: actions as unknown as Action[], ...extra });

// ----------------------------------------------------------- variables

test('operators follow the documented rules', () => {
  assert.equal(applyOperator(5, '+', 3), 8);
  assert.equal(applyOperator('5', '-', '2'), 3);
  assert.equal(applyOperator(5, '*', 'abc'), 5, 'non-numeric operand is a no-op');
  assert.equal(applyOperator(7, '%', 4), 3);
  assert.equal(applyOperator(7, '/', 0), 7, 'divide by zero is a no-op');
  assert.equal(applyOperator('x', 'set', 'hello'), 'hello');
  assert.equal(applyOperator(0, 'random', undefined, () => 0), 1);
  assert.equal(applyOperator(0, 'random', undefined, () => 0.9999999999), 1_000_000_000);
});

test('conditions: case-insensitive strings, numeric ordering', () => {
  const get = (n: string) => ({ name: 'Zam', score: '10' } as Record<string, string>)[n];
  assert.ok(testCondition({ variable: 'name', operator: '=', operand: 'zam' }, get));
  assert.ok(testCondition({ variable: 'name', operator: '!=', operand: 'bob' }, get));
  assert.ok(testCondition({ variable: 'score', operator: '>', operand: 9 }, get));
  assert.ok(testCondition({ variable: 'score', operator: '=', operand: 10 }, get));
  assert.ok(!testCondition({ variable: 'name', operator: '>', operand: 1 }, get), 'non-numeric > is false');
  assert.ok(testCondition({ variable: 'score', operator: '<=', operand: 10 }, get));
});

test('store: saved values, scopes, remote forwarding, snapshot', () => {
  const defs = [
    { variable_name: 'coins', default_value: 0 },
    { variable_name: 'door', default_value: 'closed', scope: 'room' as const },
    { variable_name: 'temp', default_value: 1, persist: false },
  ];
  const store = new VariableStore(defs, { coins: 4, door: 'open', temp: 9, ghost: 1 });
  assert.equal(store.get('coins'), 4);
  assert.equal(store.get('door'), 'closed', 'room values come from the server, not the player save');
  assert.equal(store.get('temp'), 1, 'non-persistent values reset');
  assert.equal(store.get('ghost'), undefined);

  const sent: unknown[] = [];
  store.remote = (...args) => sent.push(args);
  const seen: string[] = [];
  store.onChange((n, v) => seen.push(`${n}=${v}`));
  store.apply('coins', '+', 1);
  store.apply('door', 'set', 'open');
  store.apply('QL_TimeElapsed', 'set', 0);
  assert.deepEqual(sent, [['door', 'set', 'open']]);
  assert.equal(store.get('door'), 'closed', 'not applied until the server echoes');
  store.setFromRemote('door', 'open');
  assert.deepEqual(seen, ['coins=5', 'door=open']);
  assert.deepEqual(store.snapshot(), { coins: 5 });
  store.provide('QL_TimeElapsed', () => 42);
  assert.equal(store.get('QL_TimeElapsed'), 42);
});

test('placeholders and objectives', () => {
  const values: Record<string, string | number> = { samples: 2, name: '<b>Ann</b>', started: 1 };
  const get = (n: string) => values[n];
  assert.equal(interpolate('Samples: {{samples}}/3, {{ samples }}', get), 'Samples: 2/3, 2');
  assert.equal(interpolate('Hi {{name}}', get, { escape: escapeHtml }), 'Hi &lt;b&gt;Ann&lt;/b&gt;');
  assert.equal(interpolate('{{typo}} stays', get), '{{typo}} stays');
  assert.equal(interpolate('<img src="{{media:40}}">', get, { mediaUrl: (id) => `/m/${id}.png` }), '<img src="/m/40.png">');
  assert.equal(interpolate('{{media:99}}', get, { mediaUrl: () => null }), '{{media:99}}');
  assert.deepEqual(placeholderVariables('{{a}} {{media:3}} {{b}} {{a}}'), ['a', 'b']);

  const objectives = [
    { id: 1, text: 'Collect samples ({{samples}}/3)', show_when: [{ variable: 'started', operator: '=' as const, operand: 1 }], complete_when: [{ variable: 'samples', operator: '>=' as const, operand: 3 }] },
    { id: 2, text: 'Hidden', show_when: [{ variable: 'started', operator: '=' as const, operand: 0 }], complete_when: [{ variable: 'samples', operator: '>=' as const, operand: 0 }] },
    { id: 3, text: 'Bonus', optional: true, complete_when: [{ variable: 'samples', operator: '>' as const, operand: 1 }] },
  ];
  assert.deepEqual(evaluateObjectives(objectives, get), [
    { id: 1, text: 'Collect samples (2/3)', complete: false, optional: false },
    { id: 3, text: 'Bonus', complete: true, optional: true },
  ]);
  values.samples = 3;
  assert.equal(evaluateObjectives(objectives, get)[0]!.complete, true);
});

// ------------------------------------------------------------ geometry

test('walkability, sliding and move validation', () => {
  const scene: Scene = {
    id: 1,
    walkable_areas: [[{ x: 0, y: 300 }, { x: 1000, y: 300 }, { x: 1000, y: 600 }, { x: 0, y: 600 }]],
    blocked_areas: [[{ x: 400, y: 400 }, { x: 500, y: 400 }, { x: 500, y: 500 }, { x: 400, y: 500 }]],
  };
  const ctx = walkContext(scene, { width: 1000, height: 600 }, [{ x: 800, y: 450, radius: 40 }]);
  assert.ok(isWalkable(ctx, 100, 400));
  assert.ok(!isWalkable(ctx, 100, 200), 'above the floor');
  assert.ok(!isWalkable(ctx, 450, 450), 'blocked polygon');
  assert.ok(!isWalkable(ctx, 810, 455), 'blocking item');
  assert.ok(!isWalkable(ctx, -5, 400), 'outside the world');

  assert.deepEqual(resolveMove(ctx, { x: 100, y: 305 }, { x: 110, y: 295 }), { x: 110, y: 305 }, 'slides along the top edge');
  assert.deepEqual(resolveMove(ctx, { x: 395, y: 450 }, { x: 405, y: 450 }), { x: 395, y: 450 }, 'stops at a wall');

  assert.ok(validateMove(ctx, { x: 100, y: 400 }, { x: 140, y: 400 }, 100, 420));
  assert.ok(!validateMove(ctx, { x: 100, y: 400 }, { x: 600, y: 400 }, 100, 420), 'too far for the time elapsed');
  assert.ok(!validateMove(ctx, { x: 100, y: 310 }, { x: 100, y: 290 }, 100, 420), 'not walkable');
  assert.ok(!validateMove(ctx, { x: 100, y: 400 }, { x: NaN, y: 400 }, 100, 420));

  const fixed = nearestWalkable(ctx, { x: 450, y: 450 });
  assert.ok(fixed && isWalkable(ctx, fixed.x, fixed.y));
});

test('hotspot areas: circles, whole-axis bands and whole-scene', () => {
  assert.ok(inHotspot({ position_x: 100, position_y: 100, radius: 50 }, 130, 130));
  assert.ok(!inHotspot({ position_x: 100, position_y: 100, radius: 50 }, 160, 100));
  assert.ok(inHotspot({ radius: -1 }, 9999, 9999));
  assert.ok(inHotspot({ position_x: null, position_y: 100, radius: 20 }, 9999, 110), 'null x spans the axis');
  // A scene's right edge: x fixed, y null.
  const edge = { position_x: 2250, position_y: null, radius: 35 };
  assert.ok(inHotspot(edge, 2220, 50) && inHotspot(edge, 2250, 1199));
  assert.ok(!inHotspot(edge, 2200, 600));
});

test('move budget tolerates bursts but not teleports', () => {
  const b = new MoveBudget(0);
  assert.ok(b.spend(100, 40, 420), 'normal step');
  assert.ok(b.spend(300, 42, 420));
  assert.ok(b.spend(300, 42, 420), 'two packets in the same tick');
  assert.ok(!b.spend(310, 900, 420), 'teleport');
  assert.ok(!b.spend(60_000, 900, 420), 'standing still does not bank unlimited distance');
  assert.ok(b.spend(60_100, 200, 420));
});

// ------------------------------------------------------------ scenario

test('normalization: type names, defaults, ordering, jump targets, media', () => {
  assert.equal(normalizeActionType('Image Fixed'), 'image_fixed');
  assert.equal(normalizeActionType('runEvent'), 'run_event');
  assert.equal(normalizeActionType('text-overlay'), 'text_overlay');
  assert.equal(normalizeActionType('nope'), null);

  const s = normalizeScenario({
    id: 1, shortname: 's', title: 'S', start_scene_id: 10,
    items: [{ id: 5, name: 'rover', vehicle: true, media_id: 3 }],
    assets: [{ id: 1, type: 'image', url: 'bg.png', priority: 2 }, { id: 2, type: 'audio', url: 'x.mp3', priority: 1 }, { id: 3, type: 'image', url: 'r.png' }],
    scenes: [
      { id: 11, sequence: 2, background_media: [{ media_id: 1 }] },
      {
        id: 10, sequence: 1,
        background_media: [{ id: 9, type: 'image', url: 'inline.png' }],
        items: [{ item_id: 5, position_x: 0, position_y: 0 }],
        hotspots: [{
          id: 1, actions: [
            { id: 2, type: 'Jump' as never, scene_id: 11, sequence: 2 },
            { id: 1, type: 'Audio' as never, media_id: 2, sequence: 1 },
          ],
        }],
      },
    ],
  });
  assert.deepEqual(s.scenes.map((x) => x.id), [10, 11]);
  const h = s.scenes[0]!.hotspots![0]!;
  assert.deepEqual(h.actions.map((a) => [a.id, a.type, a.blocking]), [[1, 'audio', true], [2, 'jump', true]]);
  assert.equal(h.radius, -1);
  assert.equal(s.chat_mode, 'emotes');
  assert.deepEqual(s.assets!.map((a) => a.id), [2, 1, 3, 9], 'sorted by priority, inline media hoisted');
  assert.deepEqual(computeJumpTargets(s), { '10': [11], '11': [] });
  assert.equal(sceneSize(s, s.scenes[0]!), null);
  assert.deepEqual(sceneSize(s, { id: 1, background_media: [{ media_id: 1, display_width: 20, display_height: 10 }] }), { width: 20, height: 10 });
  assert.deepEqual(collectSceneMediaIds(s, s.scenes[0]!).sort(), [2, 3, 9]);
});

test('validation catches broken references', () => {
  const good = setup({ spawn_points: [{ name: 'default', position_x: 10, position_y: 10 }] }).scenario;
  assert.deepEqual(validateScenario(good).errors, []);

  const bad: Scenario = {
    id: 1, shortname: 'b', title: 'B', start_scene_id: 99,
    global_variables: [{ variable_name: 'QBLMine', default_value: 0 }],
    assets: [{ id: 1, type: 'audio', url: 'a.mp3' }],
    scenes: [{
      id: 1,
      background_media: [{ media_id: 1 }],
      walkable_areas: [[{ x: 0, y: 0 }]],
      spawn_points: [{ name: 'default', position_x: 5, position_y: 300 }],
      hotspots: [{
        id: 1,
        conditions: [{ variable: 'missing', operator: '=', operand: 1 }],
        actions: [
          { id: 1, type: 'jump', scene_id: 42 },
          { id: 1, type: 'image_overlay' },
          { id: 3, type: 'bogus' as never },
          { id: 4, type: 'cancel', action_id: 500 },
          { id: 5, type: 'variable', name: 'nope', operator: 'set', operand: 1 },
        ] as Action[],
      }],
    }],
  };
  const messages = validateScenario(bad).errors.map((e) => e.message).join('\n');
  for (const expected of [
    'The start scene (99) does not exist', 'kept for the system', 'Media 1 is audio, expected image',
    'at least three points', 'is inside walk-in hotspot 1', '"missing" is not declared',
    'Scene 42 does not exist', 'Duplicate action id 1', 'need a media_id',
    'Unknown action type "bogus"', 'Action 500 does not exist', '"nope" is not declared',
  ]) assert.ok(messages.includes(expected), `expected error containing: ${expected}\n${messages}`);
});

// -------------------------------------------------------------- engine

test('blocking actions run in sequence; non-blocking ones overlap', async () => {
  const { engine, host, store } = setup({}, [{ variable_name: 'n', default_value: 0 }]);
  void engine.trigger(ev(1, [
    { id: 1, type: 'audio', media_id: 2, blocking: false },
    { id: 2, type: 'text_overlay', text: 'hi', duration: 1000 },
    { id: 3, type: 'wait', duration: 500 },
    { id: 4, type: 'variable', name: 'n', operator: '+', operand: 1 },
  ]));
  host.durations[1] = 3000;
  await host.advance(0);
  assert.deepEqual(host.log, ['present:1', 'present:2'], 'audio does not hold up the subtitle');
  await host.advance(999);
  assert.equal(store.get('n'), 0);
  await host.advance(501);
  assert.equal(store.get('n'), 1);
  assert.ok(!engine.isRunning(1));
});

test('indefinite displays do not block, and cancel removes them', async () => {
  const { engine, host } = setup({});
  await Promise.race([
    engine.trigger(ev(1, [
      { id: 1, type: 'image_fixed', media_id: 1, position_x: 0, position_y: 0, duration: 0 },
      { id: 2, type: 'wait', duration: 100 },
      { id: 3, type: 'cancel', action_id: 1 },
    ])),
    host.advance(200),
  ]);
  await host.advance(0);
  assert.deepEqual(host.log, ['present:1', 'cancel:1']);
});

test('conditions bypass events and single actions', async () => {
  const { engine, host, store } = setup({}, [{ variable_name: 'key', default_value: 0 }]);
  void engine.trigger(ev(1, [{ id: 1, type: 'text_overlay', text: 'locked', duration: 10 }], {
    conditions: [{ variable: 'key', operator: '=', operand: 1 }],
  }));
  await host.advance(20);
  assert.deepEqual(host.log, []);
  store.apply('key', 'set', 1);
  void engine.trigger(ev(2, [
    { id: 2, type: 'text_overlay', text: 'a', duration: 10, conditions: [{ variable: 'key', operator: '=', operand: 0 }] },
    { id: 3, type: 'text_overlay', text: 'b', duration: 10 },
  ]));
  await host.advance(20);
  assert.deepEqual(host.log, ['present:3']);
});

test('a new event interrupts overridable events only', async () => {
  const { engine, host } = setup({});
  void engine.trigger(ev(1, [{ id: 1, type: 'text_overlay', text: 'a', duration: 1000 }, { id: 2, type: 'text_overlay', text: 'a2', duration: 10 }], { overridable: true }));
  void engine.trigger(ev(2, [{ id: 3, type: 'text_overlay', text: 'b', duration: 1000 }, { id: 4, type: 'text_overlay', text: 'b2', duration: 10 }]));
  await host.advance(0);
  void engine.trigger(ev(3, [{ id: 5, type: 'text_overlay', text: 'c', duration: 10 }]));
  await host.advance(2000);
  assert.ok(host.log.includes('cancel:1'), 'overridable event was cut short');
  assert.ok(!host.log.includes('present:2'), 'and its remaining actions never ran');
  assert.ok(host.log.includes('present:4'), 'the non-overridable event finished');
});

test('repeat loops until its condition stops it; block_hotspots gates hotspots', async () => {
  const { engine, host, store, index } = setup({
    hotspots: [{ id: 50, radius: 10, position_x: 0, position_y: 0, once: true, actions: [{ id: 51, type: 'variable', name: 'hits', operator: '+', operand: 1 }] }],
  }, [{ variable_name: 'n', default_value: 0 }, { variable_name: 'hits', default_value: 0 }]);
  void engine.trigger(ev(1, [
    { id: 1, type: 'variable', name: 'n', operator: '+', operand: 1 },
    { id: 2, type: 'wait', duration: 100 },
    { id: 3, type: 'repeat', conditions: [{ variable: 'n', operator: '<', operand: 3 }] },
    { id: 4, type: 'variable', name: 'n', operator: 'set', operand: 'done' },
  ], { block_hotspots: true }));
  const hotspot = index.scene(1)!.hotspots![0]!;
  await host.advance(50);
  assert.ok(engine.hotspotsBlocked);
  assert.equal(engine.triggerHotspot(hotspot), false);
  await host.advance(1000);
  assert.equal(store.get('n'), 'done');
  assert.ok(!engine.hotspotsBlocked);
  assert.equal(engine.triggerHotspot(hotspot), true);
  await host.advance(0);
  assert.equal(engine.triggerHotspot(hotspot), false, 'once-only hotspot does not fire twice');
  assert.equal(store.get('hits'), 1);
  assert.equal(engine.hotspotCoordinates, '', 'no hotspot is running any more');
  assert.deepEqual([...engine.flags], ['hotspot:50']);
});

test('QL_HotspotCoordinates is the running hotspot\'s position, and empty once its event is over', async () => {
  const { engine, host, index } = setup({
    hotspots: [{ id: 60, radius: 10, position_x: 120, position_y: 340, actions: [{ id: 61, type: 'wait', duration: 500 }] }],
  });
  assert.equal(engine.hotspotCoordinates, '');
  assert.equal(engine.triggerHotspot(index.scene(1)!.hotspots![0]!), true);
  await host.advance(100);
  assert.equal(engine.hotspotCoordinates, '120,340');
  await host.advance(1000);
  assert.equal(engine.hotspotCoordinates, '');
});

test('run_event runs indirect events; jump runs end events first', async () => {
  const { engine, host, store } = setup({
    indirect_events: [ev(20, [{ id: 21, type: 'wait', duration: 100 }, { id: 22, type: 'variable', name: 'trail', operator: 'set', operand: 'indirect' }])],
    end_events: [ev(30, [{ id: 31, type: 'wait', duration: 50 }, { id: 32, type: 'variable', name: 'trail', operator: 'set', operand: 'ended' }])],
  }, [{ variable_name: 'trail', default_value: '' }]);
  void engine.trigger(ev(1, [
    { id: 1, type: 'run_event', target_event_id: 20 },
    { id: 2, type: 'image_fixed', media_id: 1, position_x: 0, position_y: 0 },
    { id: 3, type: 'jump', scene_id: 2, spawn_point: 'door' },
    { id: 4, type: 'variable', name: 'trail', operator: 'set', operand: 'never' },
  ]));
  await host.advance(99);
  assert.equal(store.get('trail'), '', 'blocking run_event waits for the indirect event');
  await host.advance(1);
  assert.equal(store.get('trail'), 'indirect');
  assert.deepEqual(host.jumps, [], 'jump waits for end events');
  await host.advance(50);
  assert.equal(store.get('trail'), 'ended');
  assert.deepEqual(host.jumps, [[2, 'door']]);
  assert.ok(host.log.includes('cancel:2'), 'scene displays are torn down on jump');
  void engine.trigger(ev(9, [{ id: 90, type: 'text_overlay', text: 'x', duration: 1 }]));
  await host.advance(10);
  assert.ok(!host.log.includes('present:90'), 'nothing runs after the scene has ended');
});

test('infobox buttons run ad hoc actions', async () => {
  const { engine, host, store } = setup({}, [{ variable_name: 'mission', default_value: 0 }]);
  await Promise.race([engine.runAction({ type: 'variable', name: 'mission', operator: 'set', operand: 1 }), host.advance(1)]);
  assert.equal(store.get('mission'), 1);
});

test('the system variables: QL_ names, reserved, usable in conditions and placeholders', () => {
  assert.deepEqual(SYSTEM_VARIABLES.map((v) => v.name), [
    'QL_HotspotCoordinates', 'QL_ScenarioLanguage', 'QL_TimeElapsed', 'QL_VideoPlaying', 'QL_VideoTimeIndex',
    'QL_PlayerName', 'QL_TeacherName', 'QL_HasTeacher', 'QL_IsTeacher', 'QL_PhysicsEnabled',
    'QL_PlayerStars', 'QL_PlayerXP', 'QL_PlayerRank', 'QL_PlayerCount', 'QL_SceneId', 'QL_Holding',
  ]);
  assert.ok(RESERVED_VARIABLES.every((n) => n.startsWith('QL_')), 'every system variable is QL_');
  for (const old of ['QBLHotspotCoordinates', 'QBLScenarioLanguage', 'QBLTimeElapsed', 'QBLVideoPlaying', 'QBLVideoTimeIndex']) {
    assert.ok(!(RESERVED_VARIABLES as readonly string[]).includes(old), `${old} is gone`);
  }
  assert.ok(isReserved('QL_Anything') && isReserved('QL_Holding') && !isReserved('QLX') && !isReserved('ql_player'));
  const doc = {
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    global_variables: [{ variable_name: 'QL_Mine', default_value: 0 }],
    scenes: [{
      id: 1, width: 100, height: 100,
      start_events: [{ id: 1, conditions: [{ variable: 'QL_HasTeacher', operator: '=', operand: 1 }], actions: [
        { id: 1, type: 'text_overlay', text: 'Hi {{QL_PlayerName}}, ask {{QL_TeacherName}}.', duration: 10 },
        { id: 2, type: 'text_overlay', text: '{{QBLTimeElapsed}}', duration: 10, conditions: [{ variable: 'QBLVideoPlaying', operator: '=', operand: 1 }] },
      ] }],
    }],
  };
  const { errors, warnings } = validateScenario(doc);
  assert.ok(errors.some((e) => e.message.includes('"QL_Mine" starts with QBL or QL_')), 'authors cannot declare a QL_ variable');
  const said = warnings.map((w) => w.message).join('\n');
  assert.ok(!said.includes('QL_PlayerName') && !said.includes('QL_TeacherName') && !said.includes('QL_HasTeacher'), said);
  assert.ok(said.includes('Unknown reserved variable "QBLVideoPlaying"') && said.includes('{{QBLTimeElapsed}}'), 'the old names are reported');
});

test('the system variables\' old names still play, as their new names, and the publish check asks for the new ones', () => {
  const vars = new VariableStore([]);
  vars.provide('QL_PlayerName', () => 'Sam');
  vars.provide('QL_PlayerStars', () => 7);
  vars.provide('QL_Ability_translator', () => 1);
  assert.equal(currentName('QBLXp'), 'QL_PlayerXP');
  assert.equal(currentName('QBLAbility_map'), 'QL_Ability_map');
  assert.equal(currentName('frogs'), 'frogs');
  assert.equal(interpolate('Hi {{QBLPlayerName}}, {{QBLStars}} stars', vars.get), 'Hi Sam, 7 stars');
  assert.ok(testCondition({ variable: 'QBLAbility_translator', operator: '=', operand: 1 }, vars.get));
  assert.ok(takesItems({ conditions: [{ variable: 'QBLHolding', operator: '=', operand: 3 }], actions: [] }) && takesItems({ conditions: [{ variable: 'QL_Holding', operator: '!=', operand: 0 }], actions: [] }));
  const doc = {
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    scenes: [{
      id: 1, width: 100, height: 100,
      start_events: [{ id: 1, conditions: [{ variable: 'QBLHolding', operator: '=', operand: 1 }], actions: [
        { id: 1, type: 'text_overlay', text: 'Well done, {{QBLPlayerName}}! You are a {{QL_PlayerRank}}.', duration: 10 },
      ] }],
    }],
  };
  const said = validateScenario(doc).warnings.map((w) => w.message);
  assert.ok(said.some((m) => m.startsWith('QBLHolding is now called QL_Holding')), said.join('\n'));
  assert.ok(said.some((m) => m.startsWith('{{QBLPlayerName}} is now called {{QL_PlayerName}}')), said.join('\n'));
  assert.ok(!said.some((m) => m.includes('QL_PlayerRank')), 'new names are fine');
});

// ------------------------------------------------- the sample scenario

test('starship scenario (generated from seed data): valid, edges and music in every scene, rocket launch plays through', async () => {
  const { readFileSync } = await import('node:fs');
  const raw = JSON.parse(readFileSync(new URL('../../../scenarios/starship.json', import.meta.url), 'utf8')) as Scenario;
  const check = validateScenario(raw);
  assert.deepEqual(check.errors, []);
  assert.deepEqual(check.warnings, []);
  const scenario = normalizeScenario(raw);
  const index = new ScenarioIndex(scenario);

  // Arrivals: every spawn point is walkable, and every jump names a spawn point that exists.
  for (const scene of scenario.scenes) {
    const ctx = walkContext(scene, sceneSize(scenario, scene)!);
    for (const sp of scene.spawn_points!) {
      assert.ok(isWalkable(ctx, sp.position_x, sp.position_y), `${scene.shortname}/${sp.name} is walkable`);
    }
    // Scene edges are walk-in hotspots with a jump action; each must be reachable on foot.
    for (const h of scene.hotspots!) {
      const jump = h.actions.find((a) => a.type === 'jump');
      if (!jump || jump.type !== 'jump' || h.activate_by_trigger) continue;
      assert.ok(index.spawn(index.scene(jump.scene_id)!, jump.spawn_point)?.name === jump.spawn_point);
      const size = sceneSize(scenario, scene)!;
      let reachable = false;
      for (let x = 0; x <= size.width && !reachable; x += 10) {
        for (let y = 0; y <= size.height && !reachable; y += 10) reachable = inHotspot(h, x, y) && isWalkable(ctx, x, y);
      }
      assert.ok(reachable, `edge hotspot ${h.id} in ${scene.shortname} can be walked into`);
    }
    // Every scene has music: a start event with a repeating, persistent audio action.
    const music = scene.start_events!.flatMap((e) => e.actions).find((a) => a.type === 'audio' && a.persist && a.repeat);
    assert.ok(music || sceneMusic(scenario, scene), `${scene.shortname} has background music, its own or the scenario's`);
  }
  const targets = computeJumpTargets(scenario);
  const sorted = Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));
  // Landing site 3 <-> rocket pad 4 <-> control room 2 <-> deck 1 and lab 8; the stream runs 3 <-> marsh 7 <-> gully 6 <-> meadow 5.
  assert.deepEqual(sorted, {
    '1': [2], '2': [1, 4, 8, 9], '3': [4, 7], '4': [2, 3], '5': [3, 6], '6': [5, 7], '7': [3, 6], '8': [2],
    '9': [2, 10, 11, 12, 13], '10': [9], '11': [9], '12': [9], '13': [9],
  });

  // The rocket pad: the start event stands the rocket up, the hotspot launches it and jumps to the ship.
  const store = new VariableStore(scenario.global_variables);
  const host = new FakeHost();
  const pad = index.scene(4)!;
  const engine = new SceneEngine(pad, index, store, host);
  engine.start();
  await host.advance(0);
  assert.ok(host.log.includes('present:4001'), 'the rocket is standing on the pad');
  const rocket = pad.hotspots!.find((h) => h.shortname === 'rocket')!;
  assert.ok(engine.triggerHotspot(rocket));
  await host.advance(0);
  assert.deepEqual(host.log.filter((l) => l.startsWith('avatar') || l === 'present:4201'), ['avatar:hide'], 'the avatar steps into the rocket before anything else happens');
  await host.advance(400);
  await host.advance(1199);
  assert.ok(engine.hotspotsBlocked, 'other hotspots are locked during the countdown');
  assert.equal(engine.triggerHotspot(pad.hotspots![0]!), false);
  await host.advance(10);
  assert.ok(host.log.includes('present:4207'), 'the launch sound plays at lift-off');
  assert.deepEqual(host.jumps, [], 'the scene end event runs before the jump');
  await host.advance(200);
  assert.deepEqual(host.jumps, [[2, 'launchpad']]);
  assert.equal(store.get('visited_ship'), 1);

  // Walking off the east edge of the landing site: a walk-in hotspot whose action jumps to the rocket pad.
  const landing = index.scene(3)!;
  const east = landing.hotspots!.find((h) => h.shortname === 'edge-east')!;
  assert.deepEqual([east.position_x, east.position_y, east.activate_by_trigger], [2250, null, false]);
  const walkHost = new FakeHost();
  const walk = new SceneEngine(landing, index, new VariableStore(scenario.global_variables), walkHost);
  assert.ok(!inHotspot(east, 1050, 960) && inHotspot(east, 2230, 1000));
  assert.ok(walk.triggerHotspot(east));
  await walkHost.advance(0);
  assert.deepEqual(walkHost.jumps, [[4, 'west']]);

  // Mission button in the control room: sets the player's mission and bumps the shared counter.
  const sent: unknown[] = [];
  store.remote = (...args) => sent.push(args);
  const control = new SceneEngine(index.scene(2)!, index, store, new FakeHost());
  const flora = index.scene(2)!.hotspots!.find((h) => h.shortname === 'mission-flora')!;
  const infobox = flora.actions[0]!;
  assert.equal(infobox.type, 'infobox');
  if (infobox.type === 'infobox') await Promise.race([control.runAction(infobox.call_to_actions![0]!.action!), flush()]);
  assert.equal(store.get('mission'), 'flora');
  assert.deepEqual(sent, [['missions_started', '+', 1]]);
});

test('scale areas size things by where they stand', () => {
  const scene = { scale_areas: [{ x: 0, y: 400, width: 1000, height: 400, scale_top: 60, scale_bottom: 100 }, { x: 0, y: 0, width: 2000, height: 2000, scale_top: 200, scale_bottom: 200 }] };
  assert.equal(scaleAt(scene, 500, 800), 1);
  assert.equal(scaleAt(scene, 500, 400), 0.6);
  assert.equal(scaleAt(scene, 500, 600), 0.8);
  assert.equal(scaleAt(scene, 1500, 600), 2, 'outside the first box, the next one that contains the point applies');
  assert.equal(scaleAt({}, 500, 600), 1);
  assert.equal(scaleAt({ scale_areas: [] }, 5000, 5000), 1);
});

test('a hotspot with a reveal radius fades in as the avatar approaches', () => {
  const spot = { position_x: 1000, position_y: 500, reveal_radius: 400, reveal_full_radius: 100 };
  assert.equal(revealAmount(spot, 1500, 500), 0);
  assert.equal(revealAmount(spot, 1400, 500), 0);
  assert.equal(revealAmount(spot, 1250, 500), 0.5);
  assert.equal(revealAmount(spot, 1050, 500), 1);
  assert.equal(revealAmount({ position_x: 1000, position_y: 500 }, 9000, 9000), 1, 'no reveal radius: always there');
  assert.equal(revealAmount({ position_x: 1000, position_y: 500, reveal_radius: 400 }, 1300, 500), 0.5, 'full radius defaults to half');
  assert.equal(revealAmount({ position_x: null, position_y: 500, reveal_radius: 200, reveal_full_radius: 0 }, 9000, 600), 0.5, 'an empty coordinate does not count');
});

test('walking speed follows size in a scale area, as much as the area says', () => {
  const area = { x: 0, y: 0, width: 1000, height: 1000, scale_top: 40, scale_bottom: 100 };
  assert.equal(speedFactorAt({ scale_areas: [area] }, 500, 0), 0.4, 'by default, one to one');
  assert.equal(speedFactorAt({ scale_areas: [{ ...area, speed_effect: 0 }] }, 500, 0), 1, 'off');
  assert.equal(speedFactorAt({ scale_areas: [{ ...area, speed_effect: 50 }] }, 500, 0), 0.7, 'half way: small figures move a little faster than their size');
  assert.equal(speedFactorAt({ scale_areas: [area] }, 500, 1000), 1);
  assert.equal(speedFactorAt({ scale_areas: [area] }, 5000, 5000), 1, 'outside every area');
});

test('vehicles are always unique: one object that stays where it is left', () => {
  const scenario = normalizeScenario({ id: 1, scenes: [], items: [{ id: 1, name: 'cart', vehicle: true }, { id: 2, name: 'hat', wearable: true }] } as never);
  assert.deepEqual(scenario.items!.map((i) => Boolean(i.unique)), [true, false]);
});

test('freeze stops the player until unfrozen, and never outlives the event that froze them', async () => {
  const { engine, host } = setup({});
  void engine.trigger(ev(1, [
    { id: 1, type: 'freeze', frozen: true },
    { id: 2, type: 'wait', duration: 1000 },
    { id: 3, type: 'freeze', frozen: false },
    { id: 4, type: 'wait', duration: 1000 },
  ]));
  await host.advance(500);
  assert.equal(host.frozen, true);
  await host.advance(600);
  assert.equal(host.frozen, false, 'the unfreeze action releases the player while the event carries on');

  // An author forgets to unfreeze: the player is released when the event ends.
  void engine.trigger(ev(2, [{ id: 5, type: 'freeze', frozen: true }, { id: 6, type: 'wait', duration: 300 }]));
  await host.advance(200);
  assert.equal(host.frozen, true);
  await host.advance(200);
  assert.equal(host.frozen, false);
});

test('ranks come from XP', () => {
  assert.deepEqual(rankFor(0), { rank: 'Cadet', next_rank_xp: 100 });
  assert.deepEqual(rankFor(99), { rank: 'Cadet', next_rank_xp: 100 });
  assert.deepEqual(rankFor(100), { rank: 'Explorer', next_rank_xp: 300 });
  assert.deepEqual(rankFor(99_999), { rank: 'Admiral', next_rank_xp: null });
  assert.deepEqual(rankFor(50, [{ xp: 0, name: 'New' }, { xp: 40, name: 'Old hand' }]), { rank: 'Old hand', next_rank_xp: null });
});

test('awards and abilities are checked: an award on a button is not given, an ability must be sold somewhere', async () => {
  const { readFileSync } = await import('node:fs');
  const scenario = JSON.parse(readFileSync(new URL('../../../scenarios/starship.json', import.meta.url), 'utf8')) as Scenario;
  const all = (doc: unknown) => [...validateScenario(doc).errors, ...validateScenario(doc).warnings].map((i) => i.message);
  assert.deepEqual(all(scenario), [], 'the demo has no errors or warnings');
  const awards = scenario.scenes.flatMap((s) => [...(s.hotspots ?? []), ...(s.indirect_events ?? [])]).flatMap((e) => e.actions).filter((a) => a.type === 'award');
  assert.equal(awards.length, 17);
  assert.ok(awards.every((a) => !(a as { repeatable?: boolean }).repeatable), 'each is given once per student');

  const room = scenario.scenes.find((s) => s.id === 2)!;
  room.hotspots![0]!.actions.push({ id: 999901, type: 'infobox', content: 'Hi', sequence: 99, call_to_actions: [{ text: 'Claim', action: { type: 'award', stars: 5 } }] } as never);
  room.hotspots![0]!.conditions = [{ variable: 'QL_Ability_stream_map', operator: '=', operand: 1 }, { variable: 'QL_Ability_wings', operator: '=', operand: 1 }];
  const messages = all(scenario);
  assert.equal(messages.length, 2, messages.join('|'));
  assert.match(messages.join('|'), /No item in this scenario's shop gives the ability "wings"/);
  assert.match(messages.join('|'), /An award on a button is not given/);
  assert.equal(new VariableStore([]).get('QL_Ability_wings'), 0, 'an ability nobody has is 0, not unknown');
});

test('an event for the whole scene shares what it shows, and nothing else', async () => {
  const actions = [
    { id: 1, type: 'text_overlay', text: 'Rumble!', duration: 1000, blocking: false },
    { id: 2, type: 'image_fixed', media_id: 1, position_x: 0, position_y: 0, duration: 2000, blocking: false },
    { id: 3, type: 'translate', target_id: 2, position_y: 100, duration: 500 },
    { id: 4, type: 'variable', name: 'n', operator: '+', operand: 1 },
    { id: 5, type: 'infobox', content: 'Only for me', blocking: false },
    { id: 6, type: 'text_overlay', text: 'Hidden', duration: 100, conditions: [{ variable: 'n', operator: '=', operand: 99 }] },
    { id: 7, type: 'cancel', action_id: 2 },
  ];
  const scene = { indirect_events: [ev(10, actions, { audience: 'scene' }), ev(20, [{ id: 21, type: 'text_overlay', text: 'Mine', duration: 100 }])] };
  const vars = [{ variable_name: 'n', default_value: 0 }];

  // The player who sets it off: everything runs, and what others should see is passed on as it happens.
  const actor = setup(scene, vars);
  void actor.engine.triggerById(10);
  await actor.host.advance(600);
  assert.deepEqual(actor.host.shared, [1, 2, 3, 7], 'not the variable, not the infobox, not the action whose condition failed');
  assert.equal(actor.store.get('n'), 1);
  void actor.engine.triggerById(20);
  await actor.host.advance(200);
  assert.deepEqual(actor.host.shared, [1, 2, 3, 7], 'an ordinary event is the player\'s own');

  // Another player in the scene: shown the same things, with nothing of theirs changed.
  const watcher = setup(scene, vars);
  watcher.engine.watch(10, 1, 'ann');
  watcher.engine.watch(10, 2, 'ann');
  watcher.engine.watch(10, 3, 'ann');
  assert.deepEqual(watcher.host.log, ['present:1:from:ann', 'present:2:from:ann']);
  watcher.engine.watch(10, 4, 'ann');
  watcher.engine.watch(10, 5, 'ann');
  assert.equal(watcher.store.get('n'), 0, 'a watcher\'s variables are never touched');
  assert.equal(watcher.host.log.length, 2, 'and they get no infobox');
  watcher.engine.watch(10, 7, 'ann');
  assert.ok(watcher.host.log.includes('cancel:2'), 'a cancel reaches what the watcher was shown');
  watcher.engine.watch(20, 21, 'ann');
  watcher.engine.watch(99, 1, 'ann');
  assert.equal(watcher.host.log.filter((l) => l.startsWith('present')).length, 2, 'actions of private or unknown events are refused');
  assert.equal(watcher.engine.isRunning(10), false, 'watching does not run the event: hotspots stay free');
});

test('story boxes and audiences are validated', () => {
  const doc = (event: Record<string, unknown>, character: Record<string, unknown> = {}) => ({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    assets: [{ id: 1, type: 'image', url: 'a.png' }, { id: 2, type: 'audio', url: 'a.mp3' }],
    characters: [{ id: 5, name: 'Vega', media_id: 1, ...character }],
    avatar_media_ids: [1], avatar_portraits: { '1': 1 },
    scenes: [{ id: 1, width: 100, height: 100, indirect_events: [{ id: 10, actions: [], ...event }] }],
  });
  const problems = (d: unknown) => validateScenario(d).errors.map((e) => `${e.path}: ${e.message}`);
  const say = (extra: Record<string, unknown>) => ({ actions: [{ id: 11, type: 'dialogue', text: 'Hi', speaker: 'character', character_id: 5, ...extra }] });
  assert.deepEqual(problems(doc(say({ style: 'portrait' }), { portrait_media_id: 1 })), [], 'a story box can carry a voice from a character who is not in the scene');
  assert.match(problems(doc(say({})))[0]!, /not placed in this scene/, 'a bubble needs someone to hang over');
  assert.match(problems(doc(say({ style: 'portrait', character_id: 6 })))[0]!, /does not exist/);
  assert.match(problems(doc(say({ style: 'hologram' })))[0]!, /style is "bubble" or "portrait"/);
  assert.match(problems(doc({ audience: 'world' }))[0]!, /audience is "player" or "scene"/);
  assert.match(problems(doc({}, { portrait_media_id: 2 }))[0]!, /Media 2 is audio, expected image/);
  assert.equal(normalizeScenario(doc({}) as never).scenes[0]!.indirect_events![0]!.audience, 'player', 'events are the player\'s own unless they say otherwise');
});

test('sprite sheets: which animation a figure shows, what a sheet may say, and animate actions', () => {
  const sheet = (names: string[]) => ({ sheet: { columns: 4, rows: 2 }, animations: names.map((name, i) => ({ name, frames: [i] })) });
  // Standing shows idle; walking shows the walk, mirrored when the art faces the other way.
  assert.deepEqual(automaticAnimation(sheet(['idle', 'walk']), false, 'right'), { name: 'idle', flip: false });
  assert.deepEqual(automaticAnimation(sheet(['idle', 'walk']), true, 'left'), { name: 'walk', flip: true });
  assert.deepEqual(automaticAnimation(sheet(['idle', 'walk']), true, 'left', 'left'), { name: 'walk', flip: false });
  // A walk drawn for each direction is used as drawn; one drawn for one direction is mirrored for the other.
  assert.deepEqual(automaticAnimation(sheet(['walk_left', 'walk_right']), true, 'left'), { name: 'walk_left', flip: false });
  assert.deepEqual(automaticAnimation(sheet(['walk_right']), true, 'left'), { name: 'walk_right', flip: true });
  // A single picture has nothing to play and is simply mirrored.
  assert.deepEqual(automaticAnimation({}, true, 'left'), { name: null, flip: true });
  assert.equal(animationRepeats({ name: 'walk' }), true);
  assert.equal(animationRepeats({ name: 'jump' }), false);
  assert.equal(animationRepeats({ name: 'dance' }), true);
  assert.equal(animationRepeats({ name: 'dance', repeat: false }), false);

  const doc = (asset: Record<string, unknown>, action?: Record<string, unknown>, moves?: unknown[]) => ({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1, moves,
    assets: [{ id: 1, type: 'image', url: 'a.png', ...asset }],
    items: [{ id: 3, name: 'Rover', media_id: 1 }],
    scenes: [{ id: 1, width: 100, height: 100, spawn_points: [{ name: 'default', position_x: 50, position_y: 50 }], items: [{ item_id: 3, position_x: 1, position_y: 1 }], indirect_events: [{ id: 10, actions: action ? [{ id: 11, type: 'animate', ...action }] : [] }] }],
  });
  const problems = (d: unknown) => [...validateScenario(d).errors, ...validateScenario(d).warnings].map((e) => e.message);
  const good = { sheet: { columns: 4, rows: 2, count: 7 }, animations: [{ name: 'idle', frames: [0, 1] }, { name: 'drive', frames: [4, 5, 6] }] };
  assert.deepEqual(problems(doc(good, { target: 'item', item_id: 3, animation: 'drive' }, [{ animation: 'jump' }])), []);
  assert.match(problems(doc({ animations: good.animations }))[0]!, /need a sprite sheet/);
  assert.match(problems(doc({ ...good, animations: [{ name: 'idle', frames: [7] }] }))[0]!, /numbered 0 to 6/);
  assert.match(problems(doc({ ...good, animations: [{ name: 'Idle!', frames: [0] }] }))[0]!, /lowercase letters/);
  assert.match(problems(doc({ ...good, animations: [good.animations[0], good.animations[0]] }))[0]!, /Duplicate animation "idle"/);
  assert.match(problems(doc(good, { target: 'item', item_id: 3, animation: 'fly' }))[0]!, /no animation called "fly"/);
  assert.deepEqual(problems(doc(good, { target: 'item', item_id: 3, animation: 'jump' })), [], 'a built-in move needs no frames');
  assert.match(problems(doc(good, { target: 'item', item_id: 9, animation: 'drive' }))[0]!, /does not exist/);
  assert.deepEqual(problems(doc(good, { animation: 'anything_at_all' })), [], 'avatars differ from player to player, so a move for the player is not checked against a sheet');
  assert.match(problems(doc(good, undefined, [{ animation: 'Moon Walk' }]))[0]!, /A move names an animation/);
});
