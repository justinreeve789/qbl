import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { normalizeScenario, S2C, type Id, type PhysicsStateMessage, type PhysicsTickMessage, type Scenario } from '@qbl/shared';
import { SharedExperiments } from '../src/rooms/physics.js';

/** The Physics Lab demo: its bridge is shared, the other experiments are each player's own. */
const scenario = normalizeScenario(JSON.parse(readFileSync(new URL('../../../scenarios/physics-lab.json', import.meta.url), 'utf8')) as Scenario);
const scene = (name: string) => scenario.scenes.find((s) => s.shortname === name)!.id;

function room() {
  const where = new Map<string, { team: string; sceneId: Id }>();
  const sent: Array<{ to: string[]; type: string; message: unknown }> = [];
  let now = 0;
  const experiments = new SharedExperiments(scenario, {
    members: (team, sceneId) => [...where].filter(([, w]) => w.team === team && w.sceneId === sceneId).map(([sid]) => sid),
    whereIs: (sid) => where.get(sid) ?? null,
    send: (to, type, message) => sent.push({ to, type, message }),
  }, () => now);
  const run = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) {
      now += 1000 / 60;
      experiments.tick(1 / 60);
    }
  };
  return { experiments, where, sent, run };
}

test('only scenes whose physics is shared are run by the game server', () => {
  const { experiments, where, sent } = room();
  assert.equal(experiments.any, true);
  where.set('ann', { team: 't1', sceneId: scene('bounce') });
  experiments.input('ann', { op: 'sync', scene_id: scene('bounce') });
  assert.equal(sent.length, 0, 'the bounce lab is each player’s own');
});

test('a team builds one bridge together; another team has its own', () => {
  const { experiments, where, sent, run } = room();
  const bridge = scene('bridge');
  where.set('ann', { team: 't1', sceneId: bridge });
  where.set('ben', { team: 't1', sceneId: bridge });
  where.set('cat', { team: 't2', sceneId: bridge });
  experiments.input('ann', { op: 'sync', scene_id: bridge });
  const first = sent.at(-1)!;
  assert.deepEqual(first.to, ['ann']);
  assert.equal(first.type, S2C.PhysicsState);
  assert.equal((first.message as PhysicsStateMessage).snap.building, true);

  experiments.input('ann', { op: 'beam', a: { x: 560, y: 600 }, b: { x: 720, y: 600 }, kind: 0, scene_id: bridge });
  run(0.1);
  const state = sent.filter((m) => m.type === S2C.PhysicsState && m.to.includes('ben')).at(-1)!;
  assert.deepEqual(state.to.sort(), ['ann', 'ben'], 'both builders hear of the new beam, the other team does not');
  assert.equal((state.message as PhysicsStateMessage).design.length, 1);

  sent.length = 0;
  experiments.input('cat', { op: 'sync', scene_id: bridge });
  assert.equal((sent[0]!.message as PhysicsStateMessage).design.length, 0, 'team 2 has a bridge of its own');
});

test('ticks carry where things are, about twenty times a second; inputs for another scene are ignored', () => {
  const { experiments, where, sent, run } = room();
  const bridge = scene('bridge');
  where.set('ann', { team: 't1', sceneId: bridge });
  experiments.input('ann', { op: 'sync', scene_id: bridge });
  experiments.input('ann', { op: 'control', control: 'test', scene_id: bridge });
  sent.length = 0;
  run(1);
  const ticks = sent.filter((m) => m.type === S2C.PhysicsTick);
  assert.ok(ticks.length >= 17 && ticks.length <= 21, `${ticks.length} ticks in a second`);
  assert.equal((ticks.at(-1)!.message as PhysicsTickMessage).snap.building, false);

  // A message naming a scene the player is not in changes nothing.
  where.set('ann', { team: 't1', sceneId: scene('hall') });
  sent.length = 0;
  experiments.input('ann', { op: 'control', control: 'build', scene_id: bridge });
  where.set('ann', { team: 't1', sceneId: bridge });
  run(0.1);
  assert.equal((sent.filter((m) => m.type === S2C.PhysicsTick).at(-1)!.message as PhysicsTickMessage).snap.building, false);
});

test('a player who leaves lets go of what they held', () => {
  const { experiments, where, sent, run } = room();
  const bridge = scene('bridge');
  where.set('ann', { team: 't1', sceneId: bridge });
  experiments.input('ann', { op: 'control', control: 'test', scene_id: bridge });
  experiments.input('ann', { op: 'take', entry: 'weight', x: 960, y: 300, scene_id: bridge });
  run(0.5);
  const held = () => {
    const snap = (sent.filter((m) => m.type !== S2C.PhysicsWatch).at(-1)!.message as PhysicsTickMessage).snap;
    return snap.bodies.find(([id]) => id.startsWith('weight'))!;
  };
  assert.ok(Math.abs(held()[2] - 300) < 5, 'held where the pointer is');
  experiments.release('ann');
  run(1);
  assert.ok(held()[2] > 600, 'let go of, it fell');
});
