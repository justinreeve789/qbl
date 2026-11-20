import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { MediaSpeech } from '@qbl/shared';
import { Narrator } from '../src/ui/Narrator';

/**
 * Reading a line with a recording: with word timings (a character's text-to-speech voice), each
 * word is lit when the recording reaches it, following the recording's own clock; without, the
 * words are paced evenly over its length.
 */

/** Stands in for an <audio>: its clock is moved by the test. */
class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  currentTime = 0;
  duration = 3;
  paused = true;
  constructor(readonly src: string) {
    super();
    FakeAudio.last = this;
  }
  play(): Promise<void> {
    this.paused = false;
    queueMicrotask(() => {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('playing'));
    });
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {}
}

const saved: Record<string, unknown> = {};
before(() => {
  for (const k of ['window', 'Audio', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) saved[k] = (globalThis as Record<string, unknown>)[k];
  Object.assign(globalThis, {
    window: globalThis,
    Audio: FakeAudio,
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 1) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    localStorage: { getItem: () => null, setItem: () => {} },
  });
});
after(() => Object.assign(globalThis, saved));

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

const timings: MediaSpeech = {
  text: 'Hello, explorer! The reactor needs you.',
  words: [
    { w: 'Hello', s: 0, e: 400 }, { w: 'explorer', s: 500, e: 1200 }, { w: 'The', s: 1500, e: 1600 },
    { w: 'reactor', s: 1600, e: 2100 }, { w: 'needs', s: 2100, e: 2400 }, { w: 'you', s: 2400, e: 2800 },
  ],
  duration: 2800,
};

test('with word timings, each word lights as the recording reaches it, the player’s name where “explorer” is said', async () => {
  const lit: number[] = [];
  let ended = false;
  new Narrator().speak('Hello, Sam! The reactor needs you.', { audioUrl: '/media/1/a.mp3', timings }, (i) => lit.push(i), () => (ended = true));
  const audio = FakeAudio.last!;
  await tick();
  assert.deepEqual(lit, [0], 'the first word at the start');
  // The recording is slow to get going: nothing moves on until its clock does.
  await tick(40);
  assert.deepEqual(lit, [0]);
  audio.currentTime = 0.55;
  await tick();
  assert.deepEqual(lit, [0, 1], '“Sam” while “explorer” is said');
  audio.currentTime = 1.65;
  await tick();
  assert.deepEqual(lit, [0, 1, 3], 'a word passed between two frames is skipped, not lit late');
  audio.currentTime = 2.5;
  await tick();
  assert.deepEqual(lit, [0, 1, 3, 5]);
  audio.dispatchEvent(new Event('ended'));
  assert.equal(ended, true);
  assert.equal(audio.paused, true, 'the recording is released when the line ends');
});

test('without timings, or with timings for other words, the words are paced over the recording', async () => {
  for (const t of [undefined, { ...timings, words: [{ w: 'Completely', s: 0, e: 100 }, { w: 'different', s: 100, e: 200 }] }]) {
    const lit: number[] = [];
    const stop = new Narrator().speak('One two three.', { audioUrl: '/x.mp3', timings: t }, (i) => lit.push(i), () => {});
    await tick();
    assert.equal(lit[0], 0, 'the first word at once');
    FakeAudio.last!.currentTime = 99; // its clock is not followed
    await tick(20);
    assert.ok(!lit.includes(2), 'the rest follow an even pace over its three seconds');
    stop();
  }
});
