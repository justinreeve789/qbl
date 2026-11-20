import { alignWordTimes, estimateWordTimes, speechDuration, speechWords, wordAt, wordAtTime, type MediaSpeech } from '@qbl/shared';

/** How a line should sound. All optional: the browser's default voice reads at its own pace. */
export interface SpeakOptions {
  /** 0 to 2; 1 is the voice's own pitch. */
  pitch?: number;
  /** 0.5 to 2; 1 is the voice's own pace. */
  rate?: number;
  /** Part of the name of a voice to prefer: "female", "Daniel", "Google UK". */
  voice?: string;
  /** Language of the text, e.g. "en-us". */
  lang?: string;
  /** A recording to play instead of the browser's voice. */
  audioUrl?: string;
  /** When the recording says each word (its media's `speech`): the words are lit as they are said. */
  timings?: MediaSpeech;
}

const PREFERENCE = 'qbl.narration';
/** If the voice has not said where it is this long after starting, its progress is estimated instead. */
const BOUNDARY_GRACE_MS = 700;

/**
 * Reads text aloud and says which word it has reached, so the word can be highlighted.
 *
 * It uses the voice built into the browser (the Web Speech API). That costs nothing, needs no
 * server and no recordings, works offline with a device's own voices, and reports each word as
 * it is spoken ("boundary" events), which is what drives the highlight.
 *
 * A recording (a character's text-to-speech voice, or a teacher's own) is played instead when the
 * line has one. If the recording comes with word timings, the highlight follows the recording's own
 * clock, so it stays with the voice even if the audio is slow to start or stutters. Where there are
 * no timings, or a browser's voice does not report its progress (some Android voices), the words are
 * paced evenly over the time the line takes, weighted by their length and by the pauses
 * punctuation makes.
 *
 * One thing is read at a time: starting a line stops the one before.
 */
export class Narrator {
  private stopCurrent: (() => void) | null = null;
  private listeners = new Set<() => void>();

  /** Whether this browser can read aloud at all. */
  get supported(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  /** The player's own choice, kept in this browser. On unless they switched it off. */
  get enabled(): boolean {
    try {
      return localStorage.getItem(PREFERENCE) !== 'off';
    } catch {
      return true;
    }
  }

  set enabled(on: boolean) {
    try {
      localStorage.setItem(PREFERENCE, on ? 'on' : 'off');
    } catch {
      /* storage can be unavailable in private modes */
    }
    if (!on) this.stop();
    for (const l of [...this.listeners]) l();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Stop whatever is being read. */
  stop() {
    this.stopCurrent?.();
    this.stopCurrent = null;
  }

  /**
   * Read `text`. `onWord` is called with the index of each word (as `speechWords` counts them)
   * when it starts, and `onEnd` once, when the line is over or was stopped. Returns a function
   * that stops it. Nothing is read, and `onEnd` is called at once, when reading aloud is off
   * or the browser cannot do it.
   */
  speak(text: string, o: SpeakOptions, onWord: (index: number) => void, onEnd: () => void): () => void {
    this.stop();
    const words = speechWords(text);
    if (!this.enabled || words.length === 0 || (!o.audioUrl && !this.supported)) {
      onEnd();
      return () => {};
    }
    let over = false;
    let timers: number[] = [];
    let release: () => void = () => {};
    const finish = () => {
      if (over) return;
      over = true;
      for (const t of timers) window.clearTimeout(t);
      timers = [];
      release();
      if (this.stopCurrent === finish) this.stopCurrent = null;
      onEnd();
    };
    /** Step through the words at an even pace over `totalMs`, from `fromIndex`. */
    const pace = (totalMs: number, fromIndex = 0) => {
      const times = estimateWordTimes(text, words, totalMs);
      const offset = times[fromIndex] ?? 0;
      for (let i = fromIndex; i < words.length; i++) timers.push(window.setTimeout(() => !over && onWord(i), times[i]! - offset));
    };

    if (o.audioUrl) {
      const audio = new Audio(o.audioUrl);
      const said = alignWordTimes(text, o.timings);
      let frame = 0;
      release = () => {
        cancelAnimationFrame(frame);
        audio.pause();
        audio.removeAttribute('src');
      };
      if (said) {
        // Each frame, the word the recording has reached.
        let lit = -1;
        const follow = () => {
          if (over) return;
          const i = wordAtTime(said, audio.currentTime * 1000);
          if (i !== lit && i >= 0) {
            lit = i;
            onWord(i);
          }
          frame = requestAnimationFrame(follow);
        };
        audio.addEventListener('playing', () => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(follow);
        });
      } else {
        audio.addEventListener('loadedmetadata', () => pace(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration * 1000 : speechDuration(text)), { once: true });
      }
      audio.addEventListener('ended', finish, { once: true });
      audio.addEventListener('error', finish, { once: true });
      void audio.play().catch(finish);
    } else {
      const synth = window.speechSynthesis;
      const utterance = new SpeechSynthesisUtterance(text);
      const rate = Math.min(2, Math.max(0.5, o.rate ?? 1));
      utterance.rate = rate;
      utterance.pitch = Math.min(2, Math.max(0, o.pitch ?? 1));
      if (o.lang) utterance.lang = o.lang;
      const voice = pickVoice(synth.getVoices(), o.voice, o.lang);
      if (voice) utterance.voice = voice;

      let heard = false;
      utterance.onboundary = (e) => {
        if (over || (e.name && e.name !== 'word')) return;
        if (!heard) {
          // The voice reports its own progress: follow that, not the estimate.
          heard = true;
          for (const t of timers) window.clearTimeout(t);
          timers = [];
        }
        const index = wordAt(words, e.charIndex);
        if (index >= 0) onWord(index);
      };
      utterance.onstart = () => {
        onWord(0);
        timers.push(window.setTimeout(() => {
          if (!heard && !over) pace(speechDuration(text, rate), 1);
        }, BOUNDARY_GRACE_MS));
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      // Chrome stops speaking after about fifteen seconds unless it is nudged.
      const nudge = window.setInterval(() => synth.speaking && !synth.paused && synth.resume(), 10_000);
      release = () => {
        window.clearInterval(nudge);
        utterance.onboundary = utterance.onend = utterance.onerror = utterance.onstart = null;
        synth.cancel();
      };
      synth.cancel();
      synth.speak(utterance);
    }
    this.stopCurrent = finish;
    return finish;
  }
}

/** The voice to use: one whose name contains what was asked for, or else one for the language, or the browser's default. */
function pickVoice(voices: SpeechSynthesisVoice[], wanted: string | undefined, lang: string | undefined): SpeechSynthesisVoice | null {
  const language = (lang ?? '').toLowerCase().replace('_', '-');
  const inLanguage = language ? voices.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith(language.slice(0, 2))) : voices;
  const pool = inLanguage.length ? inLanguage : voices;
  if (wanted) {
    const named = pool.find((v) => v.name.toLowerCase().includes(wanted.toLowerCase()));
    if (named) return named;
  }
  return pool.find((v) => v.lang.toLowerCase().replace('_', '-') === language) ?? (language ? pool[0] ?? null : null);
}

/**
 * Prepare an element's text for reading aloud: every word is wrapped in a span, so that the
 * word being spoken can be marked. Returns the text to speak (the words, single-spaced) and
 * a function that marks word `i`. Markup inside the element (bold, links, lists) is kept.
 */
export function narratable(root: HTMLElement): { text: string; mark(index: number): void; clear(): void } {
  const spans: HTMLElement[] = [];
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  for (const node of nodes) {
    const value = node.nodeValue ?? '';
    if (!value.trim()) continue;
    const fragment = document.createDocumentFragment();
    for (const piece of value.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        fragment.append(piece);
        continue;
      }
      const span = document.createElement('span');
      span.className = 'qbl-word';
      span.textContent = piece;
      fragment.append(span);
      spans.push(span);
      parts.push(piece);
    }
    node.replaceWith(fragment);
  }
  let current = -1;
  return {
    text: parts.join(' '),
    mark(index: number) {
      if (index === current) return;
      spans[current]?.classList.remove('speaking');
      spans[current]?.classList.add('spoken');
      current = index;
      spans[index]?.classList.add('speaking');
    },
    clear() {
      for (const s of spans) s.classList.remove('speaking', 'spoken');
      current = -1;
    },
  };
}
