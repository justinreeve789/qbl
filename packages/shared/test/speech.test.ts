import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alignWordTimes, normalizeScenario, validateScenario, wordAtTime, type MediaSpeech, type Scenario } from '../src/index.js';

/** What Kokoro reported for "Welcome aboard, explorer! The reactor is at 42 percent, and Dr. Ruiz needs help." (punctuation dropped). */
const recorded: MediaSpeech = {
  text: 'Welcome aboard, explorer! The reactor is at 42 percent, and Dr. Ruiz needs help.',
  voice: 'captain',
  engine: 'kokoro',
  words: [
    ['Welcome', 30, 420], ['aboard', 420, 900], ['explorer', 950, 1600], ['The', 1750, 1850], ['reactor', 1850, 2350], ['is', 2350, 2470],
    ['at', 2470, 2630], ['forty-two', 2630, 3150], ['percent', 3150, 3750], ['and', 3820, 3950], ['Doctor', 3950, 4300], ['Ruiz', 4300, 4700],
    ['needs', 4700, 4950], ['help', 4950, 5570],
  ].map(([w, s, e]) => ({ w: w as string, s: s as number, e: e as number })),
  duration: 5570,
};

test('a recording is followed word by word, the player\'s name lit where "explorer" is said', () => {
  const times = alignWordTimes('Welcome aboard, Sam! The reactor is at 42 percent, and Dr. Ruiz needs help.', recorded);
  assert.ok(times);
  assert.equal(times.length, 14);
  assert.deepEqual(times.slice(0, 2), [30, 420]);
  // "Sam!" has no match: it lights when "explorer" is said, in its place.
  assert.equal(times[2], 950);
  // "42" was said as "forty-two" and "Dr." as "Doctor": they light when those are said.
  assert.equal(times[7], 2630);
  assert.equal(times[10], 3950);
  assert.deepEqual(times.slice(11), [4300, 4700, 4950]);
  for (let i = 1; i < times.length; i++) assert.ok(times[i]! >= times[i - 1]!, 'never backwards');
});

test('a name of two words, and capitals and punctuation that differ, still follow', () => {
  const times = alignWordTimes('WELCOME aboard, Sam Lee! the reactor is at 42 percent and Dr Ruiz needs help', recorded);
  assert.ok(times);
  assert.equal(times.length, 15);
  assert.equal(times[0], 30);
  // Two words where one was said: spread over it, up to the next word.
  assert.deepEqual(times.slice(2, 5), [950, 1350, 1750]);
  assert.equal(times[14], 4950);
});

test('a recording of something else is not followed', () => {
  assert.equal(alignWordTimes('Something entirely different is being shown here now.', recorded), null);
  assert.equal(alignWordTimes('Hello', { text: '', words: [] }), null);
  assert.equal(alignWordTimes('Hello', undefined), null);
});

test('the word being said at a moment', () => {
  const times = [0, 400, 900, 1500];
  assert.equal(wordAtTime(times, -5), -1);
  assert.equal(wordAtTime(times, 0), 0);
  assert.equal(wordAtTime(times, 899), 1);
  assert.equal(wordAtTime(times, 900), 2);
  assert.equal(wordAtTime(times, 99999), 3);
});

test('the publish check warns when a line was changed after it was recorded', () => {
  const doc = (text: string): Scenario => ({
    id: 1, shortname: 'v', title: 'Voices', start_scene_id: 1,
    assets: [{ id: 5, type: 'audio', filename: 'a.mp3', url: '/media/1/a.mp3', speech: { ...recorded, line: 'Welcome aboard, {{QBLPlayerName}}!' } }],
    characters: [{ id: 2, name: 'Vega', tts_voice: 'captain' }],
    scenes: [{
      id: 1, shortname: 'deck', title: 'Deck', width: 1200, height: 600, start_events: [], indirect_events: [],
      hotspots: [{ id: 3, shortname: 'talk', position_x: 100, position_y: 100, radius: 50, actions: [
        { id: 4, type: 'dialogue', style: 'portrait', speaker: 'character', character_id: 2, text, narrate: true, narration_media_id: 5 },
      ] }],
    }],
  }) as unknown as Scenario;
  const stale = (text: string) => validateScenario(normalizeScenario(doc(text))).warnings.filter((i) => i.path.endsWith('narration_media_id'));
  assert.equal(stale('Welcome aboard, {{QBLPlayerName}}!').length, 0);
  const issues = stale('Welcome back, {{QBLPlayerName}}!');
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.level, 'warning');
  assert.match(issues[0]!.message, /Record the voices again/);
});
