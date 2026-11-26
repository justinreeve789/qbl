import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScenarioIndex, type Scenario } from '@qbl/shared';
import { mediaUses, reportLoadErrors } from '../src/core/assets';

const scenario = {
  id: 1,
  title: 'Ship',
  start_scene_id: 1,
  assets: [
    { id: 5, type: 'image', filename: 'room.jpg', url: '/media/1/a.jpg' },
    { id: 7, type: 'image', filename: 'crew-quarters.png', url: '/media/1/b.png' },
  ],
  scenes: [
    { id: 1, subtitle: 'Crew quarters', background_media: [{ media_id: 5 }, { media_id: 7 }], foreground_media: [{ media_id: 7 }] },
    { id: 2, shortname: 'deck', background_media: [{ media_id: 5 }] },
  ],
} as unknown as Scenario;

/** The parts of a Phaser scene and the game context that reportLoadErrors uses. */
function harness(preview: boolean) {
  const handlers: Record<string, (file: { key: string; url: string }) => void> = {};
  const toasts: string[] = [];
  const scene = { load: { on: (event: string, fn: (file: { key: string; url: string }) => void) => (handlers[event] = fn) } };
  const ctx = { scenario, index: new ScenarioIndex(scenario), options: { debug: false, preview }, ui: { toast: (m: string) => toasts.push(m) } };
  reportLoadErrors(scene as never, ctx as never);
  return { fail: (key: string, url: string) => handlers.loaderror!({ key, url }), toasts };
}

test('mediaUses names every layer that shows a file', () => {
  assert.deepEqual(mediaUses(scenario, 7), ['background layer 2 of “Crew quarters”', 'foreground layer 1 of “Crew quarters”']);
  assert.deepEqual(mediaUses(scenario, 5), ['background layer 1 of “Crew quarters”', 'background layer 1 of “deck”']);
  assert.deepEqual(mediaUses(scenario, 99), []);
});

test('a picture that cannot be loaded is reported in the console, and once on screen in a preview', (t) => {
  const warned: string[] = [];
  t.mock.method(console, 'warn', (m: string) => warned.push(m));
  const { fail, toasts } = harness(true);
  fail('media-7', '/media/1/b.png');
  fail('media-7', '/media/1/b.png');
  assert.equal(warned.length, 2);
  assert.match(warned[0]!, /“crew-quarters\.png” \(background layer 2 of “Crew quarters”, foreground layer 1 of “Crew quarters”\) from \/media\/1\/b\.png/);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0]!, /Could not load the picture “crew-quarters\.png”/);
});

test('players outside a preview only get the console line', (t) => {
  t.mock.method(console, 'warn', () => undefined);
  const { fail, toasts } = harness(false);
  fail('media-5', '/media/1/a.jpg');
  assert.equal(toasts.length, 0);
});
