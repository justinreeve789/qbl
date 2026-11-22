import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConversationAction, GameEvent } from '@qbl/shared';
import { OfflineConnection } from '../src/net/Connection';
import { LocalPlayerSystem } from '../src/systems/LocalPlayerSystem';
import { Game, loadScenario } from './harness';

/** The captain, in the control room, with a dialogue tree: a question to answer and a way back to it. */
function captainTalk(style: 'portrait' | 'bubble'): ConversationAction {
  return {
    id: 9001, type: 'conversation', style,
    lines: [
      { id: 'hello', speaker: 'character', character_id: 1, text: 'Ready for your briefing, {{QL_PlayerName}}?', next: 'ask' },
      {
        id: 'ask', speaker: 'character', character_id: 1, text: 'What do plants need to grow?',
        choices: [
          { text: 'Sunlight and water', correct: true, next: 'right', actions: [{ type: 'variable', name: 'samples', operator: '+', operand: 1 }] },
          { text: 'Only soil', next: 'wrong' },
        ],
      },
      { id: 'wrong', speaker: 'character', character_id: 1, text: 'Not quite. Think again.', next: 'ask' },
      { id: 'right', text: 'Sunlight and water!', choices: [{ text: 'Off I go' }] },
    ],
  };
}

async function talkIn(style: 'portrait' | 'bubble') {
  const scenario = loadScenario();
  scenario.session = { scene_id: 2 };
  const scene = scenario.scenes.find((s) => s.id === 2)!;
  const event: GameEvent = { id: 9000, actions: [{ id: 8999, type: 'freeze', frozen: true }, captainTalk(style)] };
  scene.indirect_events = [...(scene.indirect_events ?? []), event];
  const g = new Game(scenario);
  await g.wait(100);
  void (g.scene as any).engine.trigger(event);
  await g.wait(50);
  return g;
}

test('a dialogue tree: the captain asks, a wrong answer comes back round, and the answers go in the activity log', async () => {
  const g = await talkIn('portrait');
  const before = Number(g.var('samples') ?? 0);
  // A line with nothing to choose is a story box the player clicks on from.
  assert.equal(g.ui.stories.length, 1);
  assert.equal(g.ui.stories[0]!.name, 'Captain Vega');
  assert.equal(g.ui.stories[0]!.text, 'Ready for your briefing, Tester?');
  g.ui.stories[0]!.next();
  await g.wait(50);

  // The question is a story box of its own: the answers wait until the captain has finished.
  assert.equal(g.ui.stories.length, 1);
  assert.equal(g.ui.stories[0]!.text, 'What do plants need to grow?');
  assert.deepEqual(g.ui.asks, [], 'no answers under the captain’s line');
  g.ui.stories[0]!.next();
  await g.wait(50);
  assert.deepEqual(g.ui.stories, []);
  assert.equal(g.ui.asks.length, 1);
  assert.equal(g.ui.asks[0]!.style, 'portrait');
  assert.equal(g.ui.asks[0]!.name, 'Tester', 'the answers are the player’s own box');
  assert.deepEqual(g.ui.asks[0]!.answers, ['Sunlight and water', 'Only soil']);
  // Waiting for an answer, the player cannot walk away.
  const at = g.position;
  g.scene.system(LocalPlayerSystem).walkTo({ x: at.x + 300, y: at.y });
  await g.wait(400);
  assert.deepEqual(g.position, at);

  await g.answer('Only soil');
  assert.match(g.ui.stories[0]!.text, /Not quite/);
  g.ui.stories[0]!.next();
  await g.wait(50);
  g.ui.stories[0]!.next();
  await g.wait(50);
  await g.answer('Sunlight');
  assert.equal(Number(g.var('samples')), before + 1, 'the choice set its variable');
  // The player's own line, in their own name, then their answer.
  assert.equal(g.ui.stories[0]!.name, 'Tester');
  g.ui.stories[0]!.next();
  await g.wait(50);
  await g.answer('Off I go');
  assert.deepEqual(g.ui.asks, []);
  assert.deepEqual(g.ui.stories, []);
  assert.equal(g.scene.system(LocalPlayerSystem).frozen, false, 'the freeze ended with the event');

  const answers = (g.ctx.connection as OfflineConnection).tracked.filter((t) => t.type === 'choice');
  assert.deepEqual(answers.map((t) => [t.ref, t.label]), [['9001:ask', 'Only soil'], ['9001:ask', 'Sunlight and water'], ['9001:right', 'Off I go']]);
});

test('as bubbles, the lines hang over the speakers and the answers wait at the bottom of the screen', async () => {
  const g = await talkIn('bubble');
  assert.deepEqual(g.ui.stories, [], 'no story box');
  assert.deepEqual(g.ui.dialogues, ['Captain Vega: Ready for your briefing, Tester?']);
  // A bubble with nothing to choose stays long enough to read, then the talk goes on.
  // The question is a bubble too; the answers come only once it has been read.
  for (let i = 0; i < 400 && !g.ui.dialogues.some((d) => d.includes('What do plants')); i++) await g.wait(25);
  assert.deepEqual(g.ui.dialogues, ['Captain Vega: What do plants need to grow?']);
  assert.deepEqual(g.ui.asks, []);
  await g.wait(8000);
  assert.deepEqual(g.ui.dialogues, []);
  assert.equal(g.ui.asks[0]?.style, 'bubble');
  await g.answer('Sunlight');
  await g.wait(8000);
  await g.answer('Off I go');
  assert.deepEqual(g.ui.asks, []);
});
