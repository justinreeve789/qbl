import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { askForSound, resetSoundLock, setSoundPrompt, soundBlocked } from '../src/audio/soundLock';

afterEach(() => resetSoundLock());

/** A stand-in for document, enough for the listeners soundLock adds. */
function fakeDocument() {
  const listeners = new Map<string, Set<() => void>>();
  const doc = {
    addEventListener: (type: string, fn: () => void) => void (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(fn),
    removeEventListener: (type: string, fn: () => void) => void listeners.get(type)?.delete(fn),
    fire: (type: string) => [...(listeners.get(type) ?? [])].forEach((fn) => fn()),
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  };
  (globalThis as { document?: unknown }).document = doc;
  return doc;
}

test('a page that may not make sounds yet asks once, and the first click turns sound on', async () => {
  const doc = fakeDocument();
  let shown = 0;
  setSoundPrompt(() => shown++);
  let resumed = 0;
  const context = { state: 'suspended', resume: async () => void resumed++ } as unknown as AudioContext;
  const manager = { locked: false, context };

  assert.equal(soundBlocked(manager), true);
  askForSound(manager);
  askForSound(manager);
  assert.equal(shown, 1, 'asked once, not for every sound');

  doc.fire('pointerdown');
  assert.equal(resumed, 1);
  assert.equal(doc.count(), 0, 'the listeners go once used');

  // Blocked again later (an iPad sent to the background): it asks again.
  askForSound(manager);
  assert.equal(shown, 2);
});

test('nothing is asked when sounds already play', () => {
  fakeDocument();
  let shown = 0;
  setSoundPrompt(() => shown++);
  const manager = { locked: false, context: { state: 'running' } as AudioContext };
  assert.equal(soundBlocked(manager), false);
  askForSound(manager);
  assert.equal(shown, 0);
});

test('a refused recording (the narrator) asks too', () => {
  fakeDocument();
  let shown = 0;
  setSoundPrompt(() => shown++);
  askForSound(null, true);
  assert.equal(shown, 1);
});
