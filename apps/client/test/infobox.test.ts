import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent, InfoboxAction, Variable } from '@qbl/shared';
import { OfflineConnection } from '../src/net/Connection';
import { Game, loadScenario } from './harness';

/** A quiz in the control room: an answer box, a try-again button, a right answer and a glossary word. */
async function quiz(box: Omit<InfoboxAction, 'id' | 'type'>, vars: Variable[] = []) {
  const scenario = loadScenario();
  scenario.session = { scene_id: 2 };
  scenario.global_variables = [...(scenario.global_variables ?? []), { variable_name: 'guess', default_value: '' }, { variable_name: 'tries', default_value: 0 }, ...vars];
  scenario.glossary = [...(scenario.glossary ?? []), { id: 'acid', term: 'Acid', definition: 'Water with a pH below 7.' }];
  const scene = scenario.scenes.find((s) => s.id === 2)!;
  const event: GameEvent = {
    id: 9100,
    actions: [
      { id: 9101, type: 'infobox', narrate: false, ...box } as InfoboxAction,
      { id: 9102, type: 'variable', name: 'tries', operator: '+', operand: 100 },
    ],
  };
  scene.indirect_events = [...(scene.indirect_events ?? []), event];
  const g = new Game(scenario);
  await g.wait(100);
  const run = (g.scene as any).engine.trigger(event) as Promise<void>;
  await g.wait(30);
  return { g, run };
}

test('what is typed in an answer box is saved in its variable before the button\'s action runs, and goes in the report', async () => {
  const { g } = await quiz({
    content: '<p>What pH is pure water?</p><input data-qbl="answer" data-var="guess" placeholder="A number">',
    dismissible: false,
    call_to_actions: [{ text: 'Check', action: { type: 'text_overlay', text: 'You said {{guess}}', duration: 500 } }],
  });
  await g.choose('Check', { guess: ' 7 ' });
  assert.equal(g.var('guess'), 7, 'a number is saved as a number');
  assert.ok(g.ui.texts.includes('You said 7'), 'the button\'s action sees it');
  const tracked = (g.ctx.connection as OfflineConnection).tracked.filter((t) => t.type === 'choice');
  assert.deepEqual(tracked.map((t) => [t.ref, t.label]), [['9101', '“7” (Check)']]);
});

test('a try-again button keeps the box open and runs its action; a right one closes it and the event goes on', async () => {
  const { g, run } = await quiz({
    content: '<p>Which is an acid?</p>',
    dismissible: false,
    call_to_actions: [
      { text: 'Baking soda', mark: 'try_again', action: { type: 'variable', name: 'tries', operator: '+', operand: 1 } },
      { text: 'Lemon juice', mark: 'right' },
    ],
  });
  const box = g.box!;
  assert.deepEqual(box.marks, ['try_again', 'right']);
  await g.choose('Baking soda');
  assert.equal(g.box, box, 'still open');
  assert.equal(g.var('tries'), 1, 'its action ran');
  await g.choose('Lemon juice');
  await run;
  assert.equal(g.box, undefined);
  assert.equal(g.var('tries'), 101, 'the event went on after the box');
  const tracked = (g.ctx.connection as OfflineConnection).tracked.filter((t) => t.type === 'choice');
  assert.deepEqual(tracked.map((t) => t.label), ['Baking soda', 'Lemon juice'], 'the first answer is the one the report counts');
});

test('a glossary word in a box says what it means, and looking it up puts it in the player\'s glossary', async () => {
  const { g } = await quiz({ content: '<p>Lemon juice is an <span data-qbl="word" data-word="acid">acid</span>.</p>{{media:1}}' });
  const box = g.box!;
  assert.deepEqual(box.options.word?.('acid'), { term: 'Acid', definition: 'Water with a pH below 7.', image: null });
  assert.equal(box.options.word?.('nothing'), null);
  assert.equal(box.options.learn?.('acid'), true, 'new to the player');
  assert.equal(box.options.learn?.('acid'), false, 'and then theirs');
  assert.ok(g.ctx.glossary.some((e) => e.id === 'acid'));
  // A placeholder on its own in the text shows the picture rather than its address.
  assert.match(box.html, /<img src="[^"]+" alt="">/);
});

test('a picture or video at the top, the size and the accent reach the box', async () => {
  const scenario = loadScenario();
  const picture = scenario.assets!.find((m) => m.type === 'image')!;
  const { g } = await quiz({ content: '<p>Hi</p>', media_id: picture.id, size: 'large', accent: '#ff7a00' });
  const o = g.box!.options;
  assert.equal(o.hero?.type, 'image');
  assert.ok(o.hero?.url.endsWith(String(picture.url).split('/').pop()!));
  assert.deepEqual([o.size, o.accent], ['large', '#ff7a00']);
});
