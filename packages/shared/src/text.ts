import type { Condition, Objective, VarValue } from './types.js';
import { testConditions } from './variables.js';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w]*)(?::([\w-]+))?\s*\}\}/g;

export interface InterpolateOptions {
  /** Resolves `{{media:ID}}` to a URL. */
  mediaUrl?: (id: number) => string | null;
  /** Applied to variable values before they are inserted. Pass an HTML escaper when the text is HTML. */
  escape?: (value: string) => string;
}

/**
 * Fill `{{variable}}` and `{{media:ID}}` placeholders in author-written text.
 * Unknown names are left as they are, so a typo is visible instead of silently blank.
 */
export function interpolate(
  text: string,
  get: (name: string) => VarValue | undefined,
  options: InterpolateOptions = {},
): string {
  if (!text.includes('{{')) return text;
  return text.replace(PLACEHOLDER, (whole, name: string, arg: string | undefined) => {
    if (name === 'media' && arg !== undefined) {
      return options.mediaUrl?.(Number(arg)) ?? whole;
    }
    if (arg !== undefined) return whole;
    const value = get(name);
    if (value === undefined) return whole;
    const s = String(value);
    return options.escape ? options.escape(s) : s;
  });
}

/** Variable names referenced by `{{name}}` placeholders in a text. */
export function placeholderVariables(text: string): string[] {
  const names = new Set<string>();
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m[2] === undefined && m[1] !== 'media') names.add(m[1]!);
  }
  return [...names];
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export interface ObjectiveStatus {
  id: Objective['id'];
  text: string;
  complete: boolean;
  optional: boolean;
}

/** The checklist as the player should see it right now. */
export function evaluateObjectives(
  objectives: Objective[] | undefined,
  get: (name: string) => VarValue | undefined,
): ObjectiveStatus[] {
  const out: ObjectiveStatus[] = [];
  for (const o of objectives ?? []) {
    if (!testConditions(o.show_when as Condition[] | undefined, get)) continue;
    out.push({
      id: o.id,
      text: interpolate(o.text, get),
      complete: (o.complete_when ?? []).length > 0 && testConditions(o.complete_when, get),
      optional: o.optional === true,
    });
  }
  return out;
}

// -------------------------------------------------------------- narration

/** A word of a text that is read aloud: where it starts and ends in the text. */
export interface SpokenWord { start: number; end: number }

/** The words of a text, in order, as stretches of it. Punctuation stays attached to its word. */
export function speechWords(text: string): SpokenWord[] {
  const out: SpokenWord[] = [];
  for (const m of text.matchAll(/\S+/g)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** The word being spoken when the voice has reached character `charIndex`: the last one that starts at or before it. */
export function wordAt(words: SpokenWord[], charIndex: number): number {
  let found = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i]!.start <= charIndex) found = i;
    else break;
  }
  return found;
}

/**
 * When each word starts if a voice reads the text evenly over `totalMs`: used when the browser's
 * voice does not report its progress, and for recordings. Longer words take longer, and a word
 * that ends a sentence or a clause is followed by a pause.
 */
export function estimateWordTimes(text: string, words: SpokenWord[], totalMs: number): number[] {
  const weights = words.map((w) => {
    const word = text.slice(w.start, w.end);
    return word.length + 2 + (/[.!?…]["')\]]?$/.test(word) ? 6 : /[,;:]$/.test(word) ? 3 : 0);
  });
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  let at = 0;
  return weights.map((weight) => {
    const start = at;
    at += (weight / sum) * totalMs;
    return start;
  });
}

/** Roughly how long a voice takes to read a text at a given rate (1 = normal), in milliseconds. */
export function speechDuration(text: string, rate = 1): number {
  const words = speechWords(text);
  const pauses = (text.match(/[.!?…]/g) ?? []).length * 280 + (text.match(/[,;:]/g) ?? []).length * 140;
  return Math.max(600, (words.length * 330 + text.length * 12 + pauses) / Math.max(0.3, rate));
}

/** Whether an action's text is read aloud: what the action says, or else the scenario's setting. */
export function isNarrated(scenario: { narration?: 'off' | 'on' }, action: { narrate?: boolean }): boolean {
  return action.narrate ?? scenario.narration === 'on';
}
