import './fakePhaser';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { interpolate, type Scenario } from '@qbl/shared';
import { Game, loadScenario } from './harness';

const PHYSICS = { mode: 'local' } as never;

/** The starship demo, served as it is in a class: assigned by Ms Rivera, and with the lab a physics experiment. */
function scenario(teacher?: string): Scenario {
  const s = loadScenario();
  s.instance = { group: 't4', party: 'a2', team_name: 'Red team', ...(teacher ? { teacher_name: teacher } : {}) };
  (s.scenes.find((sc) => sc.id !== s.start_scene_id) as { physics?: unknown }).physics = PHYSICS;
  return s;
}

test('the QL_ system variables: player, teacher, language, time, scene', async () => {
  const g = new Game(scenario('Ms Rivera'), { id: 'u1', name: 'Sam', role: 'student' });
  await g.wait(50);
  const fill = (text: string) => interpolate(text, g.ctx.vars.get);
  assert.equal(fill('Hi {{QL_PlayerName}}, ask {{ QL_TeacherName }} for help.'), 'Hi Sam, ask Ms Rivera for help.');
  assert.deepEqual([g.var('QL_HasTeacher'), g.var('QL_IsTeacher')], [1, 0]);
  assert.equal(g.var('QL_ScenarioLanguage'), 'en');
  assert.equal(g.var('QL_PhysicsEnabled'), 0, 'the deck is not a physics experiment');
  // The demo greets players with a hotspot where they arrive: its position, while it runs.
  assert.match(String(g.var('QL_HotspotCoordinates')), /^(\d+,\d+)?$/);
  assert.deepEqual([g.var('QL_VideoPlaying'), typeof g.var('QL_VideoTimeIndex')], [0, 'number']);
  assert.equal(typeof g.var('QL_TimeElapsed'), 'number');

  // The old names are gone; the scenario's own variables are untouched.
  for (const old of ['QBLTimeElapsed', 'QBLScenarioLanguage', 'QBLVideoPlaying', 'QBLVideoTimeIndex', 'QBLHotspotCoordinates']) assert.equal(g.var(old), undefined, old);
  // A variable action cannot change them.
  await g.ctx.vars.apply('QL_PlayerName', 'set', 'Someone else');
  assert.equal(g.var('QL_PlayerName'), 'Sam');

  // Each scene says whether it is a physics experiment.
  const lab = g.scenario.scenes.find((sc) => (sc as { physics?: unknown }).physics)!;
  void g.scene.engine.runAction({ type: 'jump', scene_id: lab.id });
  await g.hold([], () => g.scene.def.id === lab.id);
  assert.equal(g.var('QL_PhysicsEnabled'), 1);
});

test('QL_TeacherName is empty, and QL_HasTeacher 0, outside an assigned game', async () => {
  const g = new Game(scenario(), { id: 'u1', name: 'Sam', role: 'student' });
  await g.wait(50);
  assert.deepEqual([g.var('QL_TeacherName'), g.var('QL_HasTeacher'), g.var('QL_IsTeacher')], ['', 0, 0]);
});

test('a teacher is a teacher, and has no teacher of their own', async () => {
  const g = new Game(scenario('Ms Rivera'), { id: 't1', name: 'Ms Rivera', role: 'teacher' });
  await g.wait(50);
  assert.deepEqual([g.var('QL_IsTeacher'), g.var('QL_HasTeacher'), g.var('QL_TeacherName')], [1, 0, '']);
  const admin = new Game(scenario('Ms Rivera'), { id: 'a1', name: 'Ada', role: 'admin' });
  await admin.wait(50);
  assert.deepEqual([admin.var('QL_IsTeacher'), admin.var('QL_HasTeacher')], [1, 0]);
});
