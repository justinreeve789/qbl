import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  computeJumpTargets, locateIssue, newLineId, normalizeScenario, reachableLines, ScenarioIndex, SceneEngine, validateScenario, VariableStore,
  type Action, type ActionHandle, type ChoiceHandle, type ConversationAction, type ConversationChoice, type ConversationLine, type EngineHost, type GameEvent, type Scenario, type Scene,
} from '../src/index.js';

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

/** A host that shows conversation lines as a list the test answers, one at a time. */
class TalkHost implements EngineHost {
  log: string[] = [];
  jumps: number[] = [];
  /** The line on screen now: what is said, what can be chosen, and how to answer. */
  open: { line: ConversationLine; choices: string[]; pick(i: number | null): void } | null = null;

  converse(_a: ConversationAction, line: ConversationLine, choices: ConversationChoice[]): ChoiceHandle {
    let settle!: (i: number | null) => void;
    const choice = new Promise<number | null>((r) => (settle = r));
    const entry = {
      line,
      choices: choices.map((c) => c.text),
      pick: (i: number | null) => {
        if (this.open === entry) this.open = null;
        settle(i);
      },
    };
    this.open = entry;
    this.log.push(`say:${line.id}`);
    return { choice, cancel: () => { this.log.push(`close:${line.id}`); entry.pick(null); } };
  }
  present(action: Action): ActionHandle {
    this.log.push(`present:${action.type}`);
    return { done: Promise.resolve(), cancel() {} };
  }
  freeze(frozen: boolean) {
    this.log.push(frozen ? 'freeze' : 'unfreeze');
  }
  translate() {
    return null;
  }
  delay(): ActionHandle {
    return { done: new Promise(() => {}), cancel() {} };
  }
  jump(sceneId: number) {
    this.jumps.push(sceneId);
  }
  warn(m: string) {
    this.log.push(`warn:${m}`);
  }
  /** Answer the line on screen, then let the engine get on to the next one. */
  async answer(i: number | null) {
    await flush();
    assert.ok(this.open, 'a line is showing');
    this.open.pick(i);
    await flush();
  }
}

const talk: ConversationAction = {
  id: 10, type: 'conversation', style: 'portrait',
  lines: [
    { id: 'hi', speaker: 'character', character_id: 1, text: 'Hello! What do you want to know?', next: 'stranger', conditions: [{ variable: 'met', operator: '=', operand: 1 }] },
    { id: 'stranger', speaker: 'character', character_id: 1, text: 'Who are you?', next: 'hub' },
    {
      id: 'hub', speaker: 'character', character_id: 1, text: 'Ask away.',
      choices: [
        { text: 'What is a reactor?', next: 'reactor', actions: [{ type: 'variable', name: 'asked', operator: '+', operand: 1 }], conditions: [{ variable: 'asked', operator: '<', operand: 1 }] },
        { text: 'Where is the lab?', next: 'lab' },
        { text: 'Bye!', actions: [{ type: 'variable', name: 'met', operator: 'set', operand: 1 }] },
      ],
    },
    { id: 'reactor', speaker: 'character', character_id: 1, text: 'It makes power.', next: 'hub' },
    { id: 'lab', text: 'I will go to the lab.', choices: [{ text: 'Go now', actions: [{ type: 'jump', scene_id: 2 }], next: 'hub' }, { text: 'Not yet', next: 'hub' }] },
  ],
};

function setup(actions: Array<Record<string, unknown>>, scene: Partial<Scene> = {}) {
  const scenario = normalizeScenario({
    id: 1, shortname: 't', title: 'T', start_scene_id: 1,
    global_variables: [{ variable_name: 'met', default_value: 0 }, { variable_name: 'asked', default_value: 0 }, { variable_name: 'after', default_value: 0 }],
    characters: [{ id: 1, name: 'Mira' }],
    scenes: [{ id: 1, width: 1000, height: 600, characters: [{ character_id: 1, position_x: 100, position_y: 100 }], ...scene }, { id: 2, width: 100, height: 100 }],
  } as Scenario);
  const index = new ScenarioIndex(scenario);
  const vars = new VariableStore(scenario.global_variables);
  const host = new TalkHost();
  const engine = new SceneEngine(index.scene(1)!, index, vars, host);
  const event: GameEvent = { id: 1, actions: actions as unknown as Action[] };
  return { scenario, vars, host, engine, event };
}

test('a conversation branches on the player’s choices, loops back and ends on a choice that leads nowhere', async () => {
  const { host, engine, event, vars } = setup([{ ...talk }, { id: 11, type: 'variable', name: 'after', operator: 'set', operand: 1 }]);
  const run = engine.trigger(event);
  await flush();
  // Not met yet: "hi" is passed over to the line it stands in for.
  assert.equal(host.open?.line.id, 'stranger');
  assert.deepEqual(host.open?.choices, []);
  await host.answer(null);
  assert.equal(host.open?.line.id, 'hub');
  assert.deepEqual(host.open?.choices, ['What is a reactor?', 'Where is the lab?', 'Bye!']);
  await host.answer(0);
  assert.equal(vars.get('asked'), 1, 'the choice’s actions ran');
  assert.equal(host.open?.line.id, 'reactor');
  await host.answer(null);
  // Back at the hub, the question already asked is no longer offered.
  assert.equal(host.open?.line.id, 'hub');
  assert.deepEqual(host.open?.choices, ['Where is the lab?', 'Bye!']);
  assert.equal(vars.get('after'), 0, 'the event waits for the conversation');
  await host.answer(1);
  await run;
  assert.equal(vars.get('met'), 1);
  assert.equal(vars.get('after'), 1, 'the event goes on once the conversation is over');
  assert.equal(host.open, null);
  assert.deepEqual(host.log.filter((l) => l.startsWith('say:')), ['say:stranger', 'say:hub', 'say:reactor', 'say:hub']);
});

test('a line whose conditions hold is said; a second visit starts differently', async () => {
  const { host, engine, event, vars } = setup([{ ...talk }]);
  vars.apply('met', 'set', 1);
  void engine.trigger(event);
  await flush();
  assert.equal(host.open?.line.id, 'hi');
  await host.answer(null);
  // "hi" goes on to its next, which is said even though it was what "hi" stood in for.
  assert.equal(host.open?.line.id, 'stranger');
});

test('a jump in a choice ends the conversation and the rest of the event', async () => {
  const { host, engine, event, vars } = setup([{ ...talk, start: 'lab' }, { id: 11, type: 'variable', name: 'after', operator: 'set', operand: 1 }]);
  const run = engine.trigger(event);
  await flush();
  assert.equal(host.open?.line.id, 'lab');
  await host.answer(0);
  await run;
  await flush();
  assert.deepEqual(host.jumps, [2]);
  assert.equal(host.open, null, 'it did not go on to the hub');
  assert.equal(vars.get('after'), 0, 'the event stopped at the jump');
});

test('a cancel action ends the whole conversation, not just the line showing', async () => {
  const { host, engine, event } = setup([{ ...talk, start: 'hub' }]);
  const run = engine.trigger(event);
  await flush();
  assert.equal(host.open?.line.id, 'hub');
  engine.cancelAction(10);
  await run;
  assert.equal(host.open, null);
  assert.ok(host.log.includes('close:hub'));
});

test('lines that lead round in a circle with nothing to choose are stopped', async () => {
  const circle = { id: 10, type: 'conversation', lines: [{ id: 'a', text: 'A', next: 'b' }, { id: 'b', text: 'B', next: 'a' }] };
  const { host, engine, event } = setup([circle]);
  const run = engine.trigger(event);
  for (let i = 0; i < 205 && host.open; i++) await host.answer(null);
  await run;
  assert.equal(host.open, null);
  assert.ok(host.log.some((l) => l.includes('go round in a circle')));
});

test('a freeze in a choice lasts to the end of the event, as one of its own would', async () => {
  const freezing = { id: 10, type: 'conversation', lines: [{ id: 'a', text: 'Stay a moment?', choices: [{ text: 'Sure', actions: [{ type: 'freeze', frozen: true }], next: 'b' }] }, { id: 'b', text: 'Thanks.' }] };
  const { host, engine, event } = setup([freezing]);
  const run = engine.trigger(event);
  await host.answer(0);
  assert.equal(host.open?.line.id, 'b');
  assert.deepEqual(host.log.filter((l) => l.endsWith('freeze')), ['freeze'], 'still frozen while the conversation goes on');
  await host.answer(null);
  await run;
  assert.deepEqual(host.log.filter((l) => l.endsWith('freeze')), ['freeze', 'unfreeze']);
});

test('the scenario lists jumps made in choices, and the validator checks the tree', () => {
  const { scenario } = setup([{ ...talk }]);
  const withEvent = normalizeScenario({ ...scenario, scenes: [{ ...scenario.scenes[0]!, hotspots: [{ id: 5, position_x: 10, position_y: 10, radius: 20, actions: [talk] }] }, scenario.scenes[1]!] } as Scenario);
  assert.deepEqual(computeJumpTargets(withEvent)['1'], [2]);
  const ok = validateScenario(withEvent);
  assert.deepEqual(ok.errors.filter((e) => e.path.includes('lines')), []);

  const broken: ConversationAction = {
    id: 10, type: 'conversation', style: 'bubble',
    lines: [
      { id: 'a', text: 'Hi', speaker: 'character', character_id: 99, choices: [{ text: 'Go', next: 'gone' }, { text: '', actions: [{ type: 'award', stars: 1 }] }] },
      { id: 'a', text: 'Again' },
      { id: 'lonely', text: 'Nobody gets here' },
    ],
  };
  const bad = validateScenario({ ...withEvent, scenes: [{ ...withEvent.scenes[0]!, hotspots: [{ id: 5, position_x: 10, position_y: 10, radius: 20, actions: [broken] }] }, withEvent.scenes[1]!] } as Scenario);
  const messages = [...bad.errors, ...bad.warnings].map((i) => `${i.path}: ${i.message}`);
  const has = (part: string) => assert.ok(messages.some((m) => m.includes(part)), `expected “${part}” in:\n${messages.join('\n')}`);
  has('lines[0].choices[0].next: There is no line "gone"');
  has('lines[0].choices[1].text: A choice needs something to say');
  has('lines[0].character_id: The speaking character is not placed in this scene');
  has('lines[1].id: Two lines are called "a"');
  has('lines[2]: Line "lonely" is never said');
  has('choices[1].actions[0]: An award in a conversation choice is not given');

  const place = locateIssue(withEvent, 'scenes[0].hotspots[0].actions[0].lines[2].choices[1].actions[0].scene_id');
  assert.equal(place.action?.line?.id, 'hub');
  assert.equal(place.action?.line?.choice?.text, 'Where is the lab?');
  assert.equal(place.field, 'scene_id');
});

test('which lines can be reached, and ids for new lines', () => {
  assert.deepEqual([...reachableLines(talk)].sort(), ['hi', 'hub', 'lab', 'reactor', 'stranger']);
  assert.deepEqual([...reachableLines({ ...talk, start: 'reactor' })].sort(), ['hub', 'lab', 'reactor']);
  assert.equal(newLineId([{ id: 'l1' }, { id: 'l3' }]), 'l4');
  assert.equal(newLineId([{ id: 'l2' }, { id: 'l3' }]), 'l4');
  assert.equal(newLineId([]), 'l1');
});
