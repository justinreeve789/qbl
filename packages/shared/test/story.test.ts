import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BUILT_IN_SOUNDS, flowSettings, flowSound, isBuiltInSound, SceneEngine, ScenarioIndex, storyNext, validateScenario, VariableStore, weatherSettings,
  resolvedHandle,
  type ActionHandle, type CameraAction, type EngineHost, type Scenario, type WeatherAction,
} from '../src/index.js';

const story: Scenario = {
  id: 1, shortname: 'story', title: 'The Rainy Day', start_scene_id: 1,
  assets: [{ id: 1, type: 'image', url: 'bg.png' }],
  characters: [{ id: 5, name: 'Pip', media_id: 1 }],
  scenes: [
    {
      id: 1, story: true, show_avatars: false, width: 2250, height: 1200, background_media: [{ media_id: 1 }],
      weather: { kind: 'rain', intensity: 0.4 },
      flows: [{ kind: 'river', x: 0, y: 900, width: 2250, height: 200 }],
      // Pip waits off stage, beyond the left edge, until the story walks them on.
      characters: [{ character_id: 5, position_x: -150, position_y: 950 }],
      start_events: [{
        id: 10,
        actions: [
          { id: 11, type: 'audio', sound: 'rain', repeat: true, blocking: false },
          { id: 12, type: 'walk', character_id: 5, to: 'point', position_x: 800, position_y: 950 },
          { id: 13, type: 'camera', target: 'character', character_id: 5 },
          { id: 14, type: 'weather', kind: 'storm', duration: 2000 },
          { id: 15, type: 'walk', character_id: 5, to: 'point', position_x: 2450, position_y: 950 },
          { id: 16, type: 'jump', scene_id: 2 },
        ],
      }],
    },
    { id: 2, story: true, show_avatars: false, width: 2250, height: 1200, background_media: [{ media_id: 1 }], start_events: [{ id: 20, actions: [{ id: 21, type: 'audio', sound: 'bell' }] }] },
  ],
};

test('a story scene with weather, water, the game\'s own sounds, a camera and walks off stage is valid', () => {
  const check = validateScenario(story);
  assert.deepEqual(check.errors, []);
  // Walking off stage is not "outside the walkable area".
  assert.deepEqual(check.warnings.filter((w) => w.path.includes('actions[4]')), []);
});

test('bad weather, water, sounds and cameras are caught', () => {
  const bad = structuredClone(story);
  const s = bad.scenes[0]!;
  s.weather = { kind: 'hail' as never, intensity: 2 };
  s.flows = [{ x: 0, y: 0, width: 0, height: 10, direction: 'sideways' as never, color: 'blue' }];
  s.start_events![0]!.actions = [
    { id: 11, type: 'audio', sound: 'kazoo' as never },
    { id: 12, type: 'audio' },
    { id: 13, type: 'camera', target: 'character', character_id: 99 },
    { id: 14, type: 'weather', kind: 'tornado' as never, wind: 3 },
  ];
  const paths = validateScenario(bad).errors.map((e) => e.path);
  for (const p of [
    'scenes[0].weather.kind', 'scenes[0].weather.intensity', 'scenes[0].flows[0]', 'scenes[0].flows[0].direction', 'scenes[0].flows[0].color',
    'scenes[0].start_events[0].actions[0].sound', 'scenes[0].start_events[0].actions[1].media_id', 'scenes[0].start_events[0].actions[2].character_id',
    'scenes[0].start_events[0].actions[3].kind', 'scenes[0].start_events[0].actions[3].wind',
  ]) assert.ok(paths.includes(p), `${p} in ${paths.join(', ')}`);
});

test('a story scene with nothing to play is warned about', () => {
  const quiet = structuredClone(story);
  quiet.scenes[1]!.start_events = [];
  assert.ok(validateScenario(quiet).warnings.some((w) => w.path === 'scenes[1]' && /nothing will happen/.test(w.message)));
});

test('a story scene skips to where its start events jump; the last one nowhere', () => {
  assert.deepEqual(storyNext(story.scenes[0]!), { scene_id: 2, spawn_point: undefined });
  assert.equal(storyNext(story.scenes[1]!), null);
});

test('weather and water fill in their defaults', () => {
  assert.equal(weatherSettings(null), null);
  assert.equal(weatherSettings({ kind: 'clear' }), null);
  const storm = weatherSettings({ kind: 'storm' })!;
  assert.equal(storm.lightning, true);
  assert.ok(storm.intensity > 0.8 && storm.wind > 0.5 && storm.darken === 0.35 && storm.sound);
  const rain = weatherSettings({ kind: 'rain', intensity: 3, wind: -4, sound: false })!;
  assert.deepEqual([rain.intensity, rain.wind, rain.lightning, rain.sound], [1, -1, false, false]);
  assert.deepEqual(flowSettings({ x: 0, y: 0, width: 1, height: 1 }).direction, 'right');
  assert.deepEqual(flowSettings({ kind: 'waterfall', x: 0, y: 0, width: 1, height: 1 }).direction, 'down');
  assert.deepEqual(flowSettings({ kind: 'sea', x: 0, y: 0, width: 1, height: 1, color: 'nope' }).color, '#2d78b0');
  assert.equal(flowSound('waterfall'), 'river');
  assert.equal(flowSound('lake'), null);
  assert.ok(isBuiltInSound('thunder') && !isBuiltInSound('toString') && BUILT_IN_SOUNDS.rain.loop);
});

test('the engine hands weather and camera actions to the host, and waits for them', async () => {
  const seen: string[] = [];
  let finish!: () => void;
  const slow = (): ActionHandle => ({ done: new Promise<void>((r) => (finish = r)), cancel() {} });
  const host: EngineHost = {
    present: () => resolvedHandle(),
    translate: () => null,
    delay: () => resolvedHandle(),
    jump: () => seen.push('jump'),
    walk: () => resolvedHandle(),
    weather: (a: WeatherAction) => (seen.push(`weather:${a.kind}`), slow()),
    camera: (a: CameraAction) => (seen.push(`camera:${a.target}`), resolvedHandle()),
  };
  const index = new ScenarioIndex(story);
  const engine = new SceneEngine(index.scene(1)!, index, new VariableStore([]), host);
  engine.start();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, ['camera:character', 'weather:storm']);
  finish();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, ['camera:character', 'weather:storm', 'jump']);
});
