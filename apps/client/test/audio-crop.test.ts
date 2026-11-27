import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import type { FakeSound } from './fakePhaser';
import { Game } from './harness';

/**
 * A cropped sound plays only the part its media keeps (params.crop): an Audio action, scene
 * music and a narrated line's recording all start and stop there, and a sound that loops loops
 * that part. A sound in a box gets a media fragment for its player.
 */
function scenario(actions: unknown[], extra: Record<string, unknown> = {}): Scenario {
  const floor = [{ x: 0, y: 500 }, { x: 1200, y: 500 }, { x: 1200, y: 800 }, { x: 0, y: 800 }];
  return normalizeScenario({
    id: 42, shortname: 'cropped', title: 'Cropped', start_scene_id: 1, avatar_media_ids: [9],
    assets: [
      { id: 1, type: 'image', url: 'meadow.png', width: 1200, height: 800 },
      { id: 5, type: 'audio', url: 'whole.mp3' },
      { id: 6, type: 'audio', url: 'bird.mp3', params: { crop: { start: 2, end: 4.5 } } },
      { id: 7, type: 'audio', url: 'theme.mp3', params: { crop: { start: 3 } } },
      { id: 8, type: 'audio', url: 'line.mp3', params: { crop: { start: 0.5, end: 2 } } },
      { id: 9, type: 'image', url: 'avatar.png' },
    ],
    scenes: [{
      id: 1, shortname: 'meadow', width: 1200, height: 800, walkable_areas: [floor], background_media: [{ media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 600, position_y: 600 }],
      start_events: [{ id: 10, actions }],
      ...extra,
    }],
  } as unknown as Scenario);
}

const sound = (g: Game, id: number) => g.world.sounds.find((s) => (s as unknown as FakeSound).key === `media-${id}`) as unknown as FakeSound | undefined;

test('an Audio action plays only the part of a cropped sound, and loops that part', async () => {
  const g = new Game(scenario([
    { id: 11, type: 'audio', media_id: 6, repeat: true, blocking: false },
    { id: 12, type: 'audio', media_id: 5, blocking: false },
  ]));
  await g.wait(100);
  const bird = sound(g, 6);
  assert.ok(bird, 'the cropped sound plays');
  assert.equal(bird.played?.marker, 'crop', 'as a marker');
  assert.deepEqual([bird.markers.crop?.start, bird.markers.crop?.duration], [2, 2.5], 'from 2 s to 4.5 s');
  assert.equal((bird.played?.config as { loop?: boolean }).loop, true, 'looping that part');
  const whole = sound(g, 5);
  assert.equal(whole?.played?.marker, '', 'a sound that is not cropped plays whole');
  assert.deepEqual(Object.keys(whole?.markers ?? {}), []);
});

test('scene music with only a start plays from there to the end of the file', async () => {
  const g = new Game(scenario([], { music_media_id: 7 }));
  await g.wait(100);
  const theme = sound(g, 7);
  assert.ok(theme, 'the music plays');
  assert.deepEqual([theme.played?.marker, theme.markers.crop?.start, theme.markers.crop?.duration], ['crop', 3, 7]);
});

test('a narrated line’s cropped recording is read from the part kept', async () => {
  const g = new Game(scenario([{ id: 11, type: 'narration', text: 'Listen.', narration_media_id: 8 }]));
  await g.wait(100);
  const said = g.ui.spoken.at(-1);
  assert.match(String(said?.speak.audioUrl), /line\.mp3$/);
  assert.deepEqual(said?.speak.crop, { start: 0.5, end: 2 });
});

test('a cropped sound in a box gets a media fragment, so its player plays only the part kept', async () => {
  const g = new Game(scenario([{ id: 11, type: 'infobox', content: '<audio src="{{media:6}}"></audio><audio src="{{media:5}}"></audio><img src="{{media:1}}">' }]));
  await g.wait(100);
  const html = String(g.ui.boxes.at(-1)?.html ?? '');
  assert.match(html, /bird\.mp3#t=2,4\.5"/);
  assert.match(html, /whole\.mp3"/);
  assert.match(html, /meadow\.png"/);
});
