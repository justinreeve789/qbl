/**
 * Recorded speech: when each word of a recording is said.
 *
 * A recorded line (media of type audio) can carry `speech`: the text that was recorded and when each
 * of its words starts and ends, in milliseconds from the start of the file. Recordings made by
 * `php artisan qbl:voice`, the editor's "Record voices" and the mission generator have it, from the
 * text-to-speech service's own word timings. The game then lights each word on screen as the recording reaches it,
 * instead of pacing the words evenly over the recording's length.
 */
import { speechWords } from './text.js';

/** One word of a recording: its text and when it is said, in milliseconds from the start. */
export interface SpeechWord {
  w: string;
  s: number;
  e: number;
}

/** [ext] On an audio media: what it says, in which voice, and when each word is said. */
export interface MediaSpeech {
  /** What was said: the line, with the player's name said as a stand-in word ("explorer"). */
  text: string;
  /** The line as it was written when it was recorded, placeholders and all: a different line now means the recording is out of date. */
  line?: string;
  /** The voice it was recorded in: a key of the server's voice catalog, e.g. "heart" (see Character.tts_voice). */
  voice?: string;
  /** The text-to-speech service that recorded it, e.g. "kokoro". Recordings without one were uploaded by someone. */
  engine?: string;
  words: SpeechWord[];
  /** Milliseconds; the length of the speech (the recording may be a little longer). */
  duration?: number;
}

/** A word as compared: lower case, letters and digits only. */
function normal(word: string): string {
  return word.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * When each word of `text` (as `speechWords` counts them) is said in a recording with these timings,
 * in milliseconds; or null when the recording does not match the text well enough to follow it.
 *
 * The text shown need not be exactly what was recorded: a player's name stands where the recording
 * said "explorer", punctuation or capitals differ, a number was said in words. The words are matched
 * in order; words with no match take the time of what was said between their neighbours (so a name
 * shown in the place of "explorer" lights up when "explorer" is said). At least half the words must match.
 */
export function alignWordTimes(text: string, speech: MediaSpeech | null | undefined): number[] | null {
  const recorded = (speech?.words ?? []).filter((w) => Number.isFinite(w.s));
  const shown = speechWords(text).map((w) => normal(text.slice(w.start, w.end)));
  if (!recorded.length || !shown.length) return null;
  const said = recorded.map((w) => normal(w.w));

  // In order, looking a few words ahead in the recording for each word shown.
  const at: (number | null)[] = []; // the recorded word each shown word matched
  let j = 0;
  let matched = 0;
  for (const word of shown) {
    let found = -1;
    if (word) {
      for (let k = j; k < Math.min(said.length, j + 4); k++) {
        if (said[k] === word) {
          found = k;
          break;
        }
      }
    }
    if (found >= 0) {
      at.push(found);
      matched++;
      j = found + 1;
    } else {
      at.push(null);
    }
  }
  if (matched * 2 < shown.length) return null;

  // Words with no match, a run at a time, take the time of the recorded words between the same two
  // matches: one for one when there are as many ("Sam" where "explorer" was said, "42" where "forty-two"
  // was), otherwise spread over them, or between the two matches when nothing was said there.
  const end = speech?.duration ?? recorded[recorded.length - 1]!.e;
  const out: number[] = [];
  for (let i = 0; i < at.length; ) {
    if (at[i] != null) {
      out.push(recorded[at[i]!]!.s);
      i++;
      continue;
    }
    let b = i;
    while (b < at.length && at[b] == null) b++;
    const n = b - i;
    const before = i > 0 ? at[i - 1]! : -1;
    const after = b < at.length ? at[b]! : recorded.length;
    const gap = recorded.slice(before + 1, after);
    const next = after < recorded.length ? recorded[after]!.s : Math.max(end, before >= 0 ? recorded[before]!.e : 0);
    if (gap.length === n) {
      for (const w of gap) out.push(w.s);
    } else {
      const from = gap.length ? gap[0]!.s : before >= 0 ? recorded[before]!.s : 0;
      const step = (next - from) / (gap.length ? n : n + 1);
      for (let m = 0; m < n; m++) out.push(Math.round(from + step * (gap.length ? m : m + 1)));
    }
    i = b;
  }
  // Never backwards.
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]!);
  return out;
}

/** The word being said at `ms` into a recording: the last one that has started, or -1 before the first. */
export function wordAtTime(times: number[], ms: number): number {
  let found = -1;
  for (let i = 0; i < times.length; i++) {
    if (times[i]! <= ms) found = i;
    else break;
  }
  return found;
}
