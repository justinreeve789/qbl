import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeScenario, type Scenario } from '@qbl/shared';
import { Game } from './harness';

/**
 * The narration action: the narrator speaks in the story box a portrait dialogue uses, with no
 * close-up and no name. It is read aloud unless it says not to (in the narrator's recording when
 * it has one), and waits for the player to continue.
 */
function scenario(actions: unknown[], extra: Record<string, unknown> = {}): Scenario {
  const floor = [{ x: 0, y: 500 }, { x: 1200, y: 500 }, { x: 1200, y: 800 }, { x: 0, y: 800 }];
  return normalizeScenario({
    id: 41, shortname: 'told', title: 'A Tale', start_scene_id: 1, avatar_media_ids: [9],
    assets: [
      { id: 1, type: 'image', url: 'meadow.png', width: 1200, height: 800 },
      { id: 7, type: 'audio', url: 'narrator-line.mp3', speech: { text: 'And so it began.', voice: 'storyteller', engine: 'kokoro', words: [{ w: 'And', s: 0, e: 200 }], duration: 1200 } },
      { id: 9, type: 'image', url: 'avatar.png' },
    ],
    global_variables: [{ variable_name: 'after', default_value: 0 }],
    scenes: [{
      id: 1, shortname: 'meadow', width: 1200, height: 800, walkable_areas: [floor], background_media: [{ media_id: 1 }],
      spawn_points: [{ name: 'default', position_x: 600, position_y: 600 }],
      start_events: [{ id: 10, actions: [...actions, { id: 99, type: 'variable', name: 'after', operator: 'set', operand: 1 }] }],
    }],
    ...extra,
  } as unknown as Scenario);
}

test('the narrator speaks in a story box with no portrait or name, read in the narrator’s recording, and it waits for the player', async () => {
  const g = new Game(scenario([{ id: 11, type: 'narration', text: 'And so it began.', narration_media_id: 7 }]));
  await g.wait(100);
  const box = g.ui.stories.at(-1);
  assert.ok(box, 'a story box is showing');
  assert.equal(box.narrator, true, 'the narrator’s box');
  assert.equal(box.name, undefined, 'with no name');
  assert.equal(box.portrait, undefined, 'and no close-up');
  assert.equal(box.text, 'And so it began.');
  const said = g.ui.spoken.at(-1);
  assert.equal(said?.text, 'And so it began.', 'read aloud with no setting to say so');
  assert.match(String(said?.speak.audioUrl), /narrator-line\.mp3/, 'from the narrator’s recording');
  assert.equal(said?.speak.timings?.voice, 'storyteller', 'each word lit as the recording says it');
  assert.equal(g.var('after'), 0, 'the event waits');
  box.next();
  await g.wait(50);
  assert.equal(g.var('after'), 1, 'until the player continues');
});

test('a narration can stay for a while instead, or not be read aloud', async () => {
  const g = new Game(scenario([{ id: 11, type: 'narration', text: 'Meanwhile, far away…', duration: 400, narrate: false }]));
  await g.wait(100);
  assert.equal(g.ui.stories.at(-1)?.narrator, true);
  assert.equal(g.ui.spoken.length, 0, 'narrate: false is not read aloud');
  await g.wait(600);
  assert.equal(g.ui.stories.length, 0, 'it closed by itself');
  assert.equal(g.var('after'), 1);
});
