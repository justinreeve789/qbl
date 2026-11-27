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

test('when what is built cannot be loaded, the player is told once instead of the button silently missing', async () => {
  const scenario = loadScenario();
  scenario.scenes.find((s) => s.id === scenario.start_scene_id)!.building = { enabled: true, tools: ['label'] };
  const api = backend();
  api.load = async () => { throw new Error('Server Error'); };
  const g = new Game(scenario, undefined, (ctx) => {
    ctx.builds = new Builds(api);
  });
  await settle();
  await g.wait(16);
  assert.equal(g.ui.build, null);
  assert.equal(g.ui.toasts.filter((t) => t.startsWith('Building is not available right now: Server Error')).length, 1);
});

test('a hotspot is added, saved tidied, and opens its words and picture when clicked', async () => {
  const { g, api, system } = await game({ enabled: true, tools: ['hotspot'], pieces: [{ media_id: 101 }] });
  g.ui.build!.open();
  const panel = g.ui.builder!;
  assert.deepEqual(panel.spec.tools, ['hotspot']);
  panel.on.addHotspot({ look: 'none', opens: {} });
  assert.equal(system.pieces?.length, 0, 'a hotspot that opens nothing is not added');
  assert.match(g.ui.toasts.at(-1) ?? '', /words or a picture/);
  panel.on.addHotspot({ look: 'none', text: 'ignored', opens: { text: ' Frogs <eat> flies\n\n\n\nThey jump ', upload_id: 7 } });
  const spot = system.pieces![0]!;
  assert.deepEqual([spot.kind, spot.look, spot.text, spot.opens], ['hotspot', 'none', undefined, { text: 'Frogs eat flies\n\nThey jump', upload_id: 7 }], 'its words are cleaned, and only its look’s fields kept');
  assert.equal(panel.view?.selected?.kind, 'hotspot', 'the palette is told a hotspot is picked');
  panel.on.rehotspot({ look: 'label', text: 'Read me', color: '#fde047', opens: { text: 'Hello' } });
  assert.deepEqual([system.pieces![0]!.look, system.pieces![0]!.text, system.pieces![0]!.opens, system.pieces![0]!.x], ['label', 'Read me', { text: 'Hello' }, spot.x], 'changing it keeps where it is');
  panel.on.tryHotspot();
  assert.equal(g.ui.boxes.at(-1)?.html, '<p>Hello</p>', 'Try it shows what players will see');
  g.ui.boxes.at(-1)!.choose(null as never);
  panel.on.rehotspot({ look: 'none', opens: { text: 'Hello\nthere', upload_id: 7 } });
  panel.on.done();
  await settle();
  assert.deepEqual(api.saved[0]!.pieces[0], { id: spot.id, kind: 'hotspot', x: spot.x, y: spot.y, opens: { text: 'Hello\nthere', upload_id: 7 } });

  // Out of build mode, clicking it opens a box; it is not a click to walk.
  const box = g.world.objects.filter((o) => o.kind === 'rectangle' && (o as { input?: unknown }).input).at(-1)!;
  assert.ok(box, 'an invisible hotspot is still something to click');
  box.emit('pointerover');
  assert.equal(system.hovering, true);
  box.emit('pointerdown');
  const opened = g.ui.boxes.at(-1)!;
  assert.equal(opened.html, '<p>Hello<br>there</p>');
  assert.equal(opened.options.hero?.url, 'mine.png', 'with the picture it opens');
  assert.equal(opened.dismissible, true);
});

test('a hotspot can have the narrator say something in the story box, in the recorded voice once there is one', async () => {
  const say = 'Long ago, a river ran here.';
  const recorded: SceneBuild = {
    id: 5, scene_id: 3, mine: false, author: 'Calm Heron', status: 'approved',
    pieces: [{ id: 'n1', kind: 'hotspot', x: 300, y: 300, opens: { say, text: 'Rivers carve valleys.' } }],
    voices: { n1: { url: 'voice-n1.mp3', speech: { text: say, line: say, voice: 'storyteller', engine: 'kokoro', words: [{ w: 'Long', s: 0, e: 200 }] } } },
  };
  const { g, api, system } = await game({ enabled: true, tools: ['hotspot'] }, [recorded]);

  // Someone else's hotspot: the narrator first, in the story box, with the recording; then the box.
  const spot = g.world.objects.filter((o) => o.kind === 'rectangle' && (o as { input?: unknown }).input).at(-1)!;
  spot.emit('pointerdown');
  const story = g.ui.stories.at(-1)!;
  assert.deepEqual([story.text, story.narrator, story.name, story.portrait], [say, true, undefined, undefined], 'the narrator says it, with no name or close-up');
  const spoken = g.ui.spoken.at(-1)!;
  assert.deepEqual([spoken.text, spoken.speak.audioUrl, spoken.speak.timings?.line], [say, 'voice-n1.mp3', say], 'in the narrator’s recorded voice');
  assert.equal(g.ui.boxes.length, 0, 'the box waits for the narrator');
  spot.emit('pointerdown');
  assert.equal(g.ui.stories.length, 1, 'clicking again does not start it twice');
  story.next();
  await settle();
  assert.equal(g.ui.boxes.at(-1)?.html, '<p>Rivers carve valleys.</p>', 'then the words it opens');
  g.ui.boxes.at(-1)!.choose(null as never);
  await settle();

  // Making one: what the narrator says alone is enough; it is cleaned and kept.
  g.ui.build!.open();
  const panel = g.ui.builder!;
  panel.on.addHotspot({ look: 'none', opens: { say: '  Frogs {{sing}}\n at <night.  ' } });
  const mine = system.pieces![0]!;
  assert.deepEqual(mine.opens, { say: 'Frogs sing at night.' }, 'one plain line, with no < > { }');
  panel.on.tryHotspot();
  assert.deepEqual([g.ui.stories.at(-1)?.text, g.ui.spoken.at(-1)?.speak.audioUrl], ['Frogs sing at night.', undefined], 'Try it: the browser’s voice reads it until it is recorded');
  g.ui.stories.at(-1)!.next();
  await settle();
  assert.equal(g.ui.boxes.length, 0, 'with nothing else to open, no box follows');
  panel.on.done();
  await settle();
  assert.deepEqual(api.saved[0]!.pieces[0]!.opens, { say: 'Frogs sing at night.' });
});

test('a teacher changes a student’s build in the game, with the student’s pictures', async () => {
  const theirs: SceneBuild = {
    id: 40, scene_id: 3, mine: false, author: 'Brave Otter', status: 'pending', editable: true,
    uploads: [{ id: 21, url: 'otter.png', width: 100, height: 100 }],
    pieces: [{ id: 'a', kind: 'label', x: 100, y: 100, text: 'Pond' }, { id: 'b', kind: 'picture', x: 200, y: 200, upload_id: 21 }],
  };
  const scenario = loadScenario();
  scenario.scenes.find((s) => s.id === scenario.start_scene_id)!.building = { enabled: true, tools: ['label', 'picture'] };
  const api = backend([theirs]);
  const others: Array<{ id: number; pieces: BuildPiece[] }> = [];
  api.saveOther = async (id, pieces) => {
    others.push({ id, pieces });
    return { ...theirs, pieces };
  };
  let builds!: Builds;
  const g = new Game(scenario, { id: 't1', name: 'Ms Tan', role: 'teacher' }, (ctx) => {
    builds = ctx.builds = new Builds(api);
    builds.openOnArrival = 40;
  });
  await settle();
  await g.wait(16);
  const system = g.scene.system(BuildSystem);
  const panel = g.ui.builder!;
  assert.ok(panel?.open, 'arriving from Change in the game opens the student’s build');
  assert.equal(builds.openOnArrival, null);
  assert.deepEqual(panel.spec.whose?.map((w) => w.name), ['Yours', 'Brave Otter']);
  assert.deepEqual(system.pieces?.map((p) => p.id), ['a', 'b']);
  assert.deepEqual([panel.view?.editingFor?.name, panel.view?.canUpload, panel.view?.pictures.map((p) => p.id), panel.view?.status], ['Brave Otter', false, [21], 'pending']);
  await assert.rejects(panel.on.upload(new File([], 'x.png')), /Only the student/);

  panel.on.addLabel('Nice work', '#ffffff');
  panel.on.switchTo(null);
  assert.match(g.ui.toasts.at(-1) ?? '', /before you change another build/);
  assert.equal(panel.view?.editingFor?.name, 'Brave Otter', 'with changes made, it stays on the student’s build');
  panel.on.done();
  await settle();
  assert.deepEqual([others[0]?.id, others[0]?.pieces.map((p) => p.id).slice(0, 2), api.saved.length], [40, ['a', 'b'], 0], 'the teacher’s change is kept as the student’s build, not their own');
  assert.match(g.ui.toasts.at(-1) ?? '', /Brave Otter’s build/);
  assert.equal(builds.byId(40)?.pieces.length, 3);
  assert.equal(g.ui.build?.label, 'Builds here');

  g.ui.build!.open();
  assert.equal(g.ui.builder?.view?.editingFor, null, 'the Build button opens the teacher’s own build');
  g.ui.builder!.on.switchTo(40);
  assert.equal(g.ui.builder?.view?.editingFor?.name, 'Brave Otter', 'and they can switch to a student’s');
});
