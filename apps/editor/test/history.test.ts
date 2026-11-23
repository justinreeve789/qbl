import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bundle, Row } from '../src/api';
import { diff, History, HISTORY_LIMIT, nextGesture, undoKey } from '../src/history';

/** The undo history on its own: steps, merging, the limit, and the API steps it sends. */

const patch = (h: History, id: number, before: Record<string, unknown>, after: Record<string, unknown>, typing: string | null = null) =>
  h.record(h.take(typing), { rows: [{ table: 'events', id, before, after }] });

test('each click is one step; undo sends the values from before it, redo those from after', () => {
  const h = new History();
  nextGesture();
  patch(h, 1, { shortname: 'a' }, { shortname: 'b' });
  patch(h, 1, { shortname: 'b' }, { shortname: 'c' });
  nextGesture();
  patch(h, 2, { radius: 10 }, { radius: 20 });
  assert.deepEqual(h.size, { undo: 2, redo: 0 });

  const first = h.undo()!;
  assert.deepEqual(first.steps, [{ op: 'update', table: 'events', id: 2, attrs: { radius: 10 } }]);
  first.done();
  const second = h.undo()!;
  // Two changes in one click: undone together, back to the first value.
  assert.deepEqual(second.steps, [{ op: 'update', table: 'events', id: 1, attrs: { shortname: 'a' } }]);
  second.done();
  assert.equal(h.undo(), null);

  const again = h.redo()!;
  assert.deepEqual(again.steps, [{ op: 'update', table: 'events', id: 1, attrs: { shortname: 'c' } }]);
  again.done();
  assert.deepEqual(h.size, { undo: 1, redo: 1 });

  // A new change after an undo: what was undone can no longer be redone.
  nextGesture();
  patch(h, 3, { radius: 1 }, { radius: 2 });
  assert.equal(h.canRedo, false);
});

test('keys typed into one field are one step; another field starts a new one', () => {
  const h = new History();
  for (const [from, to] of [['', 'H'], ['H', 'Hi'], ['Hi', 'Hi!']]) {
    nextGesture();
    patch(h, 1, { text: from }, { text: to }, 'labels:1:text');
  }
  nextGesture();
  patch(h, 1, { text: 'Hi!' }, { text: 'Hi!?' }, 'labels:1:other');
  assert.equal(h.size.undo, 2);
  h.undo()!.done();
  assert.deepEqual(h.undo()!.steps, [{ op: 'update', table: 'events', id: 1, attrs: { text: '' } }]);
});

test('only the last 50 steps are kept', () => {
  const h = new History();
  for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
    nextGesture();
    patch(h, 1, { sequence: i }, { sequence: i + 1 });
  }
  assert.equal(HISTORY_LIMIT, 50);
  assert.equal(h.size.undo, 50);
  let last;
  for (let pending; (pending = h.undo()); ) {
    pending.done();
    last = pending;
  }
  assert.deepEqual(last!.steps, [{ op: 'update', table: 'events', id: 1, attrs: { sequence: 10 } }]);
  assert.equal(h.size.redo, 50);
});

test('a step that came to nothing is passed over', () => {
  const h = new History();
  nextGesture();
  patch(h, 1, { radius: 1 }, { radius: 2 });
  nextGesture();
  patch(h, 2, { radius: 5 }, { radius: 6 });
  patch(h, 2, { radius: 6 }, { radius: 5 });
  assert.deepEqual(h.undo()!.steps, [{ op: 'update', table: 'events', id: 1, attrs: { radius: 1 } }]);
});

test('a delete and what went with it: undo inserts parents first, redo deletes children first', () => {
  const scene = { id: 1, scenario_id: 9, shortname: 's' };
  const event = { id: 5, scene_id: 1, kind: 'hotspot' };
  const action = { id: 7, event_id: 5, type: 'wait' };
  const empty = { media: [], shop_items: [], variables: [], items: [], characters: [], scenes: [], events: [], actions: [], conditions: [], labels: [] };
  const before = { ...empty, scenario: { id: 9, title: 'T', start_scene_id: 1, updated_at: 'x' }, scenes: [scene], events: [event], actions: [action] } as unknown as Bundle;
  const after = { ...empty, scenario: { id: 9, title: 'T', start_scene_id: null, updated_at: 'y' } } as unknown as Bundle;
  const h = new History();
  nextGesture();
  h.record(h.take(), diff(before, after));
  const undo = h.undo()!;
  assert.deepEqual(undo.steps, [
    { op: 'insert', table: 'scenes', row: scene as Row },
    { op: 'insert', table: 'events', row: event as Row },
    { op: 'insert', table: 'actions', row: action as Row },
    { op: 'scenario', attrs: { start_scene_id: 1 } },
  ]);
  undo.done();
  assert.deepEqual(h.redo()!.steps, [
    { op: 'scenario', attrs: { start_scene_id: null } },
    { op: 'delete', table: 'actions', id: 7 },
    { op: 'delete', table: 'events', id: 5 },
    { op: 'delete', table: 'scenes', id: 1 },
  ]);
});

test('a row added and then deleted in the same click leaves nothing to undo', () => {
  const h = new History();
  nextGesture();
  const step = h.take();
  h.record(step, { rows: [{ table: 'actions', id: 3, before: null, after: { id: 3, type: 'wait' } }] });
  h.record(step, { rows: [{ table: 'actions', id: 3, before: { id: 3, type: 'wait' }, after: null }] });
  assert.equal(h.undo(), null);
});

test('the keys', () => {
  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => undoKey({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods } as KeyboardEvent);
  assert.equal(key('z', { ctrlKey: true }), 'undo');
  assert.equal(key('z', { metaKey: true }), 'undo');
  assert.equal(key('y', { ctrlKey: true }), 'redo');
  assert.equal(key('Z', { ctrlKey: true, shiftKey: true }), 'redo');
  assert.equal(key('z'), null);
  assert.equal(key('z', { ctrlKey: true, altKey: true }), null);
});
