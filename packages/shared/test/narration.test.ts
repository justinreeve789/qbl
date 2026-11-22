import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNarrated, isShownToScene, normalizeActionType, validateScenario, type Action, type Scenario } from '../src/index.js';

/** The narration action: the narrator speaks, in a story box with no portrait. */
const told = (action: Record<string, unknown>, assets: unknown[] = []): Scenario => ({
  id: 1, shortname: 'told', title: 'A Tale', start_scene_id: 1,
  assets: [{ id: 1, type: 'image', url: 'bg.png' }, ...assets],
  scenes: [{ id: 1, width: 800, height: 600, background_media: [{ media_id: 1 }], start_events: [{ id: 10, actions: [{ id: 11, type: 'narration', ...action }] }] }],
} as unknown as Scenario);

const problems = (s: Scenario) => {
  const r = validateScenario(s);
  return [...r.errors, ...r.warnings].map((p) => `${p.level}: ${p.path}: ${p.message}`);
};

test('a narration is a known action, needs words, and is valid with them', () => {
  assert.equal(normalizeActionType('Narration'), 'narration');
  assert.deepEqual(problems(told({ text: 'Once upon a time…' })).filter((p) => p.startsWith('error')), []);
  assert.match(problems(told({ text: '  ' })).join('\n'), /error: .*text: text is required/);
  assert.match(problems(told({ text: 'Hi', duration: -5 })).join('\n'), /error: .*duration/);
});

test('a narration is read aloud unless it says not to, whatever the scenario’s setting', () => {
  const narration = { type: 'narration' as const };
  assert.equal(isNarrated({}, narration), true);
  assert.equal(isNarrated({ narration: 'off' }, narration), true);
  assert.equal(isNarrated({ narration: 'on' }, { ...narration, narrate: false }), false);
  // Other actions are unchanged: the setting decides.
  assert.equal(isNarrated({}, { type: 'text_overlay' }), false);
  assert.equal(isNarrated({ narration: 'on' }, { type: 'text_overlay' }), true);
  assert.equal(isShownToScene({ id: 1, type: 'narration', text: 'x' } as Action), true, 'an event shown to the scene shows its narration to everyone');
});

test('a narrator’s recording of other words is stale', () => {
  const recording = { id: 7, type: 'audio', url: 'n.mp3', speech: { text: 'Once upon a time.', line: 'Once upon a time.', voice: 'storyteller', engine: 'kokoro', words: [], duration: 900 } };
  assert.deepEqual(problems(told({ text: 'Once upon a time.', narration_media_id: 7 }, [recording])).filter((p) => /recording says/.test(p)), []);
  assert.match(problems(told({ text: 'Twice upon a time.', narration_media_id: 7 }, [recording])).join('\n'), /warning.*recording says something else/);
});
