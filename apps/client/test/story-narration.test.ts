import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Window } from 'happy-dom';
import type { MediaSpeech } from '@qbl/shared';

/**
 * A line read aloud in a story box (a portrait dialogue, or a line of a conversation): its words
 * light up in the box on screen as the recording says them. The box once set its text again right
 * after wrapping the words for lighting, so the lit words were ones no longer on the page.
 */

/** Stands in for an <audio>: its clock is moved by the test. */
class FakeAudio extends EventTarget {
  static last: FakeAudio | null = null;
  currentTime = 0;
  duration = 3;
  constructor(readonly src: string) {
    super();
    FakeAudio.last = this;
  }
  play(): Promise<void> {
    queueMicrotask(() => {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('playing'));
    });
    return Promise.resolve();
  }
  pause() {}
  removeAttribute() {}
}

const GLOBALS = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'NodeFilter', 'KeyboardEvent', 'Audio', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage'];
const saved: Record<string, unknown> = {};
let win: Window;
let Ui: typeof import('../src/ui/Ui').Ui;

before(async () => {
  for (const k of GLOBALS) saved[k] = (globalThis as Record<string, unknown>)[k];
  win = new Window({ url: 'http://localhost/' });
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    HTMLElement: win.HTMLElement,
    HTMLInputElement: win.HTMLInputElement,
    HTMLTextAreaElement: win.HTMLTextAreaElement,
    NodeFilter: win.NodeFilter,
    KeyboardEvent: win.KeyboardEvent,
    Audio: FakeAudio,
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 1) as unknown as number,
    cancelAnimationFrame: (id: number) => clearTimeout(id),
    localStorage: { getItem: () => null, setItem: () => {} },
  });
  ({ Ui } = await import('../src/ui/Ui'));
});
after(async () => {
  await win.happyDOM.close();
  Object.assign(globalThis, saved);
});

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms));

const timings: MediaSpeech = {
  text: 'The reactor needs you, explorer.',
  words: [
    { w: 'The', s: 0, e: 200 }, { w: 'reactor', s: 200, e: 700 }, { w: 'needs', s: 700, e: 1000 },
    { w: 'you', s: 1000, e: 1300 }, { w: 'explorer', s: 1400, e: 2100 },
  ],
  duration: 2100,
};

/** The words on screen in the story box, and which one is lit. */
function onScreen() {
  const line = document.querySelector('.qbl-story-text')!;
  const words = [...line.querySelectorAll('.qbl-word')];
  return { text: line.textContent, words: words.map((w) => w.textContent), lit: words.findIndex((w) => w.classList.contains('speaking')) };
}

test('a story box read from a recording lights each word on screen as it is said', async () => {
  const ui = new Ui(document.body as unknown as HTMLElement);
  const h = ui.portraitDialogue('The reactor needs you, Sam.', { name: 'Captain', duration: 0, speak: { audioUrl: '/media/7/line.mp3', timings } });
  const audio = FakeAudio.last!;
  await tick();
  assert.deepEqual(onScreen().words, ['The', 'reactor', 'needs', 'you,', 'Sam.'], 'the whole line is showing, a word at a time');
  assert.equal(onScreen().lit, 0);
  audio.currentTime = 0.75;
  await tick(40);
  assert.equal(onScreen().lit, 2, '“needs”');
  audio.currentTime = 1.5;
  await tick(40);
  assert.equal(onScreen().lit, 4, 'the player’s name where “explorer” is said');
  h.finish();
});

test('clicking a story box that is being read leaves its words in place', async () => {
  const ui = new Ui(document.body as unknown as HTMLElement);
  ui.choose('The reactor needs you, Sam.', ['On my way!'], { style: 'portrait', name: 'Captain', speak: { audioUrl: '/media/7/line.mp3', timings } });
  const audio = FakeAudio.last!;
  await tick();
  (document.querySelector('.qbl-story') as unknown as HTMLElement).click();
  audio.currentTime = 1.05;
  await tick(40);
  assert.equal(onScreen().words.length, 5);
  assert.equal(onScreen().lit, 3, '“you,”');
  audio.dispatchEvent(new Event('ended'));
});

test('a line not read aloud still arrives a few letters at a time', async () => {
  const ui = new Ui(document.body as unknown as HTMLElement);
  const h = ui.portraitDialogue('The reactor needs you.', { name: 'Captain', duration: 0 });
  const line = () => document.querySelectorAll('.qbl-story-text').item(document.querySelectorAll('.qbl-story-text').length - 1)!;
  assert.equal(line().textContent, '');
  await tick(400);
  assert.equal(line().textContent, 'The reactor needs you.');
  assert.equal(line().querySelectorAll('.qbl-word').length, 0);
  h.finish();
});

test('the narrator’s story box has no close-up and no name, and its words light up as the recording says them', async () => {
  const ui = new Ui(document.body as unknown as HTMLElement);
  const h = ui.portraitDialogue('The reactor needs you, Sam.', { narrator: true, duration: 0, speak: { audioUrl: '/media/8/narrator.mp3', timings } });
  const audio = FakeAudio.last!;
  await tick();
  const box = [...document.querySelectorAll('.qbl-story')].at(-1)!;
  assert.ok(box.classList.contains('narration'));
  assert.equal(box.querySelector('.qbl-story-portrait'), null, 'no close-up');
  assert.equal(box.querySelector('.qbl-story-name'), null, 'no name');
  assert.equal(box.getAttribute('aria-label'), 'The narrator says');
  audio.currentTime = 0.75;
  await tick(40);
  const words = [...box.querySelectorAll('.qbl-word')];
  assert.equal(words.findIndex((w) => w.classList.contains('speaking')), 2, '“needs”');
  h.finish();
  assert.equal(box.isConnected, false);
});
