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
