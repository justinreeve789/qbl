import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { AtmosphereSystem } from '../src/systems/AtmosphereSystem';
import { FlowSystem } from '../src/systems/FlowSystem';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { PropsSystem } from '../src/systems/PropsSystem';
import { WeatherSystem } from '../src/systems/WeatherSystem';
import { Game } from './harness';

/** A two-page story: Pip walks on in the rain, says something, the storm blows up, Pip walks off; then the end. */
function story(): Scenario {
  const floor = [{ x: 0, y: 700 }, { x: 2250, y: 700 }, { x: 2250, y: 1200 }, { x: 0, y: 1200 }];
  return normalizeScenario({
    id: 31, shortname: 'rainy-day', title: 'The Rainy Day', start_scene_id: 1, avatar_media_ids: [9],
    assets: [
      { id: 1, type: 'image', url: 'riverbank.png', width: 2250, height: 1200 },
      { id: 2, type: 'image', url: 'pip.png' },
      { id: 9, type: 'image', url: 'avatar.png' },
    ],
    global_variables: [{ variable_name: 'story_done', default_value: 0 }],
    characters: [{ id: 5, name: 'Pip', media_id: 2 }],
    scenes: [
      {
        id: 1, shortname: 'riverbank', story: true, width: 2250, height: 1200, walkable_areas: [floor], background_media: [{ media_id: 1 }],
        spawn_points: [{ name: 'default', position_x: 1125, position_y: 900 }],
        weather: { kind: 'rain', intensity: 0.4 },
        atmosphere: [{ kind: 'rain' }, { kind: 'leaves' }],
        flows: [{ kind: 'river', x: 0, y: 1000, width: 2250, height: 200 }],
        // Pip waits off stage, beyond the left edge.
        characters: [{ character_id: 5, position_x: -160, position_y: 900, facing: 'right' }],
        start_events: [{
          id: 10,
          actions: [
            { id: 11, type: 'audio', sound: 'river', repeat: true, blocking: false },
            { id: 12, type: 'walk', character_id: 5, to: 'point', position_x: 900, position_y: 900 },
            { id: 13, type: 'dialogue', speaker: 'character', character_id: 5, text: 'What a lot of rain!', duration: 1500 },
            { id: 14, type: 'weather', kind: 'storm', duration: 1000 },
            { id: 15, type: 'audio', sound: 'thunder' },
            { id: 16, type: 'walk', character_id: 5, to: 'point', position_x: 2420, position_y: 900 },
            { id: 17, type: 'jump', scene_id: 2 },
          ],
        }],
      },
      {
        id: 2, shortname: 'home', story: true, width: 2250, height: 1200, walkable_areas: [floor], background_media: [{ media_id: 1 }],
        spawn_points: [{ name: 'default', position_x: 1125, position_y: 900 }],
        start_events: [{ id: 20, actions: [{ id: 21, type: 'text_overlay', text: 'The End', duration: 2000 }, { id: 22, type: 'variable', name: 'story_done', operator: 'set', operand: 1 }] }],
      },
    ],
  } as unknown as Scenario);
}

test('a story scene plays by itself: no avatar, no walking, its cast walks on and off, the weather turns, then the next page', async () => {
  const g = new Game(story());
  await g.wait(100);
  const me = g.scene.system(LocalPlayerSystem);
  assert.equal(g.scene.def.show_avatars, false, 'a story scene shows no avatars');
  assert.equal(me.frozen, true, 'and the player does not walk');
  const before = g.position;
  await g.click(400, 900);
  await g.wait(300);
  assert.deepEqual(g.position, before, 'clicking the floor walks nobody');
  assert.ok(g.ui.story?.skip && g.ui.story.again, 'the story bar offers to skip and to watch again');

  // The rain is weather now (with splashes), not something in the air; the river flows.
  assert.equal(g.scene.system(WeatherSystem).current?.kind, 'rain');
  assert.deepEqual((g.scene.system(AtmosphereSystem) as any).layers.map((l: any) => l.def.kind), ['leaves']);
  assert.ok((g.scene.system(FlowSystem) as any).waters[0].ripples.length > 20);

  // Pip comes on from off stage and the view follows.
  const props = g.scene.system(PropsSystem);
  let pip = props.characterAt(5)!;
  assert.ok(pip.x > 0, `Pip walks on from beyond the edge (${pip.x})`);
  for (let i = 0; i < 400 && !g.ui.dialogues.length; i++) await g.wait(50);
  pip = props.characterAt(5)!;
  assert.ok(Math.abs(pip.x - 900) < 30, `Pip stops where the story says (${pip.x})`);
  assert.deepEqual(g.ui.dialogues, ['Pip: What a lot of rain!']);
  const cam = (g.scene as any).cameras.main;
  assert.equal(cam.following, false, 'the view is not on the (hidden) player');
  assert.ok(Math.abs(cam.centre.x - 900) < 120, `it is on Pip (${cam.centre.x})`);

  // The storm blows up.
  for (let i = 0; i < 100 && g.scene.system(WeatherSystem).current?.kind !== 'storm'; i++) await g.wait(50);
  assert.equal(g.scene.system(WeatherSystem).current?.kind, 'storm');
  assert.equal(g.scene.system(WeatherSystem).current?.lightning, true);

  // Pip walks off the far side, out of sight, and the story turns the page.
  for (let i = 0; i < 600 && g.sceneName !== 'home'; i++) await g.wait(50);
  assert.equal(g.sceneName, 'home');
  await g.wait(2300);
  assert.equal(g.var('story_done'), 1);
  assert.equal(g.ui.story?.skip, undefined, 'the last page has nowhere to skip to');
  assert.ok(g.ui.story?.again);
});

test('skip goes straight to the next page; again starts this one over', async () => {
  const g = new Game(story());
  await g.wait(200);
  g.ui.story!.again!();
  await g.wait(100);
  assert.equal(g.sceneName, 'riverbank');
  assert.ok(g.scene.system(PropsSystem).characterAt(5)!.x < 200, 'Pip is back at the start');
  g.ui.story!.skip!();
  await g.wait(800);
  assert.equal(g.sceneName, 'home');
});

test('a camera action can follow a character or glide to a spot, outside stories too', async () => {
  const s = story();
  const scene = s.scenes[0]!;
  scene.story = false;
  scene.show_avatars = true;
  scene.characters = [{ character_id: 5, position_x: 1600, position_y: 900 }];
  scene.start_events = [{ id: 10, actions: [{ id: 11, type: 'camera', target: 'point', position_x: 1800, position_y: 600, duration: 500 }, { id: 12, type: 'wait', duration: 300 }, { id: 13, type: 'camera', target: 'player' }] }] as never;
  const g = new Game(s);
  const cam = (g.scene as any).cameras.main;
  assert.equal(cam.following, false);
  await g.wait(600);
  assert.ok(Math.abs(cam.centre.x - 1800) < 2 && Math.abs(cam.centre.y - 600) < 2, JSON.stringify(cam.centre));
  await g.wait(500);
  assert.equal(cam.following, true, 'and back to the player');
});

/** How far the view has been jolted since `from` (an index into the camera's positions), in screen pixels. */
function jolt(cam: { positions: Array<[number, number]> }, from = 0): number {
  return Math.max(0, ...cam.positions.slice(from).map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
}

test('a shake action jolts the whole view, as hard as asked, and the event waits for it', async () => {
  const s = story();
  const scene = s.scenes[0]!;
  scene.story = false;
  scene.show_avatars = true;
  scene.characters = [];
  scene.start_events = [{ id: 10, actions: [
    { id: 11, type: 'shake', intensity: 8, duration: 600 },
    { id: 12, type: 'shake', intensity: 1, duration: 500 },
    { id: 13, type: 'variable', name: 'story_done', operator: 'set', operand: 1 },
  ] }] as never;
  const g = new Game(s);
  const cam = (g.scene as any).cameras.main;
  await g.wait(550);
  const hard = jolt(cam);
  // Screen pixels whatever the zoom: 8/10 is up to 2.4% of the 1280 by 720 window.
  assert.ok(hard >= 10 && hard <= Math.ceil(0.024 * 1280), `a hard shake moves the view well (${hard}px)`);
  assert.equal(g.ctx.vars.get('story_done'), 0, 'the next action waits');
  await g.wait(100);
  const at = cam.positions.length;
  await g.wait(450);
  const faint = jolt(cam, at);
  assert.ok(faint > 0 && faint < hard, `then the faint one (${faint}px)`);
  await g.wait(600);
  assert.deepEqual([cam.x, cam.y], [0, 0], 'and the view is put back');
  assert.equal(g.ctx.vars.get('story_done'), 1, 'and the event goes on');
});

test('a shake with no duration shakes until it is cancelled, and the event goes on meanwhile', async () => {
  const s = story();
  const scene = s.scenes[0]!;
  scene.story = false;
  scene.show_avatars = true;
  scene.characters = [];
  scene.start_events = [{ id: 10, actions: [
    { id: 11, type: 'shake', intensity: 3 },
    { id: 13, type: 'variable', name: 'story_done', operator: 'set', operand: 1 },
  ] }] as never;
  scene.indirect_events = [{ id: 90, actions: [{ id: 91, type: 'cancel', action_id: 11 }] }] as never;
  const g = new Game(s);
  const cam = (g.scene as any).cameras.main;
  await g.wait(100);
  assert.equal(g.ctx.vars.get('story_done'), 1, 'the next action did not wait for it');
  await g.wait(10_000);
  const at = cam.positions.length;
  await g.wait(300);
  assert.ok(jolt(cam, at) > 0, 'still shaking long after');
  await g.scene.engine.triggerById(90);
  assert.deepEqual([cam.x, cam.y], [0, 0], 'a cancel stops it and puts the view back');
  const after = cam.positions.length;
  await g.wait(300);
  assert.equal(jolt(cam, after), 0, 'and it stays still');
});

test('on an ultrawide window the view is raised, so the top is not cut off', async () => {
  const s = story();
  const scene = s.scenes[0]!;
  scene.story = false;
  scene.show_avatars = true;
  scene.start_events = [{ id: 10, actions: [{ id: 11, type: 'camera', target: 'point', position_x: 1800, position_y: 600, duration: 0 }] }] as never;
  const g = new Game(s);
  const cam = (g.scene as any).cameras.main;
  await g.wait(100);
  assert.ok(Math.abs(cam.centre.y - 600) < 2, `16:9 is not raised (${cam.centre.y})`);
  const scale = (g.scene as any).scale;
  scale.gameSize = { width: 3440, height: 1000 };
  scale.emit('resize');
  await g.wait(100);
  const { height } = g.scene.size;
  const shown = 1000 / Math.max(3440 / g.scene.size.width, 1000 / height, 1000 / 1000);
  const lift = (Math.min(height, 1000) - shown) / 2;
  assert.ok(lift > 0, 'the test window is wide enough to lose height');
  assert.ok(Math.abs(cam.centre.y - (600 - lift)) < 2, `raised by half the height lost (${cam.centre.y}, lift ${lift})`);
});
