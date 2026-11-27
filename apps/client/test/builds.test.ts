import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { BuildPiece, Id, SceneBuild } from '@qbl/shared';
import { Builds, type BuildBackend } from '../src/core/Builds';
import { BuildSystem } from '../src/systems/BuildSystem';
import { Game, loadScenario } from './harness';

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A backend that keeps builds like the API: pending until approved, others' approved ones shown. */
function backend(start: SceneBuild[] = []) {
  const saved: Array<{ sceneId: Id; pieces: BuildPiece[] }> = [];
  let builds = [...start];
  const api: BuildBackend & { saved: typeof saved; approve(): void; fail: string | null } = {
    saved,
    fail: null,
    approve() {
      builds = builds.map((b) => ({ ...b, status: 'approved' }));
    },
    load: async () => ({ may_build: true, builds: builds.map((b) => ({ ...b })), uploads: [{ id: 7, url: 'mine.png', width: 800, height: 400 }], pictures: {} }),
    save: async (sceneId, pieces) => {
      if (api.fail) throw new Error(api.fail);
      saved.push({ sceneId, pieces });
      builds = builds.filter((b) => !(b.mine && b.scene_id === sceneId));
      if (!pieces.length) return null;
      const b: SceneBuild = { id: 99, scene_id: sceneId, mine: true, author: 'Tester', status: 'pending', pieces };
      builds.push(b);
      return b;
    },
    upload: async () => ({ id: 8, url: 'new.png', width: 100, height: 100 }),
    removeUpload: async () => undefined,
  };
  return api;
}

async function game(building: object | null = { enabled: true, tools: ['place', 'label', 'picture'], pieces: [{ media_id: 101 }], max_pieces: 3, prompt: 'Make a landing pad' }, start: SceneBuild[] = []) {
  const scenario = loadScenario();
  const scene = scenario.scenes.find((s) => s.id === scenario.start_scene_id)!;
  scene.building = building as never;
  const api = backend(start);
  const g = new Game(scenario, undefined, (ctx) => {
    ctx.builds = new Builds(api);
  });
  await settle();
  await g.wait(16);
  return { g, api, system: g.scene.system(BuildSystem) };
}

test('a scene that lets students build shows a Build button, and others’ approved builds', async () => {
  const theirs: SceneBuild = { id: 1, scene_id: 3, mine: false, author: 'Calm Heron', status: 'approved', pieces: [{ id: 'a', kind: 'label', x: 100, y: 100, text: 'Hello' }] };
  const { g } = await game(undefined, [theirs]);
  assert.equal(g.ui.build?.label, 'Build here');
  const none = await game(null, [theirs]);
  assert.equal(none.g.ui.build, null, 'no button where the author did not allow building');
});

test('building: add, pick, change, undo and redo, then Done saves and waits for the teacher', async () => {
  const { g, api, system } = await game();
  g.ui.build!.open();
  const panel = g.ui.builder!;
  assert.ok(panel.open);
  assert.equal(panel.spec.prompt, 'Make a landing pad');
  assert.deepEqual(panel.spec.tools, ['place', 'label', 'picture']);
  assert.equal(panel.spec.pieces[0]?.mediaId, 101);
  assert.equal(g.ui.build, null, 'the button goes while the palette is open');
  assert.ok(g.ui.capturesInput, 'the game ignores walking while building');

  panel.on.addSticker(101);
  panel.on.addLabel('  Landing <pad>  ', '#fde047');
  assert.equal(system.pieces?.length, 2);
  const label = system.pieces![1]!;
  assert.deepEqual([label.kind, label.text, label.color, system.selected], ['label', 'Landing pad', '#fde047', label.id], 'a new piece is picked, its words cleaned');
  assert.equal(panel.view?.count, 2);
  assert.equal(panel.view?.selected?.kind, 'label');

  panel.on.resize(2);
  panel.on.turn(-15);
  assert.deepEqual([system.pieces![1]!.scale, system.pieces![1]!.angle], [2, -15]);
  system.move(label.id, 400, 300, true);
  assert.deepEqual([system.pieces![1]!.x, system.pieces![1]!.y], [400, 300]);
  system.move(label.id, 99_999, -50, true);
  assert.deepEqual([system.pieces![1]!.x, system.pieces![1]!.y], [2250, 0], 'nothing is dragged outside the scene');
  panel.on.undo();
  assert.deepEqual([system.pieces![1]!.x, system.pieces![1]!.y], [400, 300]);
  panel.on.redo();
  assert.equal(system.pieces![1]!.x, 2250);
  panel.on.undo();

  panel.on.addPicture(7);
  panel.on.addLabel('One too many', '#ffffff');
  assert.equal(system.pieces?.length, 3, 'no more than the scene allows');
  assert.match(g.ui.toasts.at(-1) ?? '', /up to 3/);

  panel.on.done();
  await settle();
  assert.equal(api.saved.length, 1);
  const kept = api.saved[0]!.pieces;
  assert.deepEqual(kept.map((p) => p.kind), ['sticker', 'label', 'picture']);
  assert.deepEqual(kept[1], { id: label.id, kind: 'label', x: 400, y: 300, scale: 2, angle: -15, text: 'Landing pad', color: '#fde047' }, 'what is saved is tidied');
  assert.equal(panel.open, false, 'Done closes the palette');
  assert.ok(!g.ui.capturesInput);
  assert.match(g.ui.toasts.at(-1) ?? '', /teacher will look/);
  assert.equal(g.ui.build?.label, 'Change what you built');
});

test('opening again starts from what was saved; Cancel puts it back', async () => {
  const mine: SceneBuild = { id: 5, scene_id: 3, mine: true, author: 'Tester', status: 'hidden', pieces: [{ id: 'a', kind: 'label', x: 100, y: 100, text: 'Old' }] };
  const { g, api, system } = await game(undefined, [mine]);
  g.ui.build!.open();
  assert.deepEqual(system.pieces?.map((p) => p.text), ['Old']);
  assert.equal(g.ui.builder?.view?.status, 'hidden', 'the palette says the teacher took it down');
  g.ui.builder!.on.clear();
  assert.equal(system.pieces?.length, 0);
  g.ui.builder!.on.cancel();
  assert.equal(system.active, false);
  assert.equal(api.saved.length, 0, 'Cancel saves nothing');
  g.ui.build!.open();
  assert.deepEqual(system.pieces?.map((p) => p.text), ['Old'], 'and what was saved is there again');
});

test('a build that breaks the rules, or a save that fails, keeps the palette open', async () => {
  const { g, api, system } = await game({ enabled: true, tools: ['label'] });
  g.ui.build!.open();
  const panel = g.ui.builder!;
  panel.on.addLabel('Hi', '#ffffff');
  // A piece of a kind the scene does not allow (as an old save might hold).
  system.pieces && (system as unknown as { editing: { pieces: BuildPiece[] } }).editing.pieces.push({ id: 'zz', kind: 'sticker', x: 1, y: 1, media_id: 101 });
  panel.on.done();
  await settle();
  assert.equal(api.saved.length, 0);
  assert.match(g.ui.toasts.at(-1) ?? '', /not allowed/);
  assert.ok(panel.open);
  (system as unknown as { editing: { pieces: BuildPiece[] } }).editing.pieces.pop();
  api.fail = 'The server said no.';
  panel.on.done();
  await settle();
  assert.ok(panel.open);
  assert.equal(g.ui.toasts.at(-1), 'The server said no.');
  assert.equal(panel.view?.saving, false);
});

test('leaving the scene while building closes the palette without saving', async () => {
  const { g, api, system } = await game();
  g.ui.build!.open();
  g.ui.builder!.on.addLabel('Bye', '#ffffff');
  system.destroy();
  assert.equal(g.ui.builder?.open, false);
  assert.equal(g.ui.build, null);
  assert.equal(api.saved.length, 0);
});
