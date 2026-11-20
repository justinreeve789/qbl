import type { ConversationAction, ConversationChoice, ConversationLine, VarValue } from './types.js';
import { testConditions } from './variables.js';

/**
 * The rules of a conversation (a dialogue tree), kept apart from the engine that runs it so the
 * editor can use them to draw the tree and say which lines are never reached.
 */

/** How many lines in a row may be passed over (conditions not holding) before giving up: a loop of them would never end. */
const MAX_SKIPS = 64;

/** A line id is short: letters, digits, `_` and `-`. */
export const LINE_ID = /^[A-Za-z0-9_-]{1,32}$/;

export function conversationLines(action: Pick<ConversationAction, 'lines'>): ConversationLine[] {
  return Array.isArray(action.lines) ? action.lines : [];
}

export function findLine(action: Pick<ConversationAction, 'lines'>, id: string | null | undefined): ConversationLine | undefined {
  if (id == null || id === '') return undefined;
  return conversationLines(action).find((l) => l.id === id);
}

/** The id of the line a conversation starts with: `start` when it names a line, otherwise the first. */
export function startLineId(action: Pick<ConversationAction, 'lines' | 'start'>): string | undefined {
  return findLine(action, action.start)?.id ?? conversationLines(action)[0]?.id;
}

/**
 * The line to say, starting from `id`: lines whose conditions do not hold are passed over to
 * their `next`. Undefined when that leads nowhere, and the conversation is over.
 */
export function lineToSay(action: Pick<ConversationAction, 'lines'>, id: string | null | undefined, get: (name: string) => VarValue | undefined): ConversationLine | undefined {
  let line = findLine(action, id);
  for (let skips = 0; line && skips < MAX_SKIPS; skips++) {
    if (testConditions(line.conditions, get)) return line;
    line = findLine(action, line.next);
  }
  return undefined;
}

/** The choices of a line the player is offered right now. */
export function offeredChoices(line: ConversationLine, get: (name: string) => VarValue | undefined): ConversationChoice[] {
  return (line.choices ?? []).filter((c) => testConditions(c.conditions, get));
}

/** Where each line can lead: its choices' lines, or its `next` (also taken when it is passed over). */
export function lineTargets(line: ConversationLine): string[] {
  const out = new Set<string>();
  for (const c of line.choices ?? []) if (c.next) out.add(c.next);
  if (line.next) out.add(line.next);
  return [...out];
}

/** The ids of the lines that can be reached from the start, by any choice. */
export function reachableLines(action: Pick<ConversationAction, 'lines' | 'start'>): Set<string> {
  const seen = new Set<string>();
  const queue = [startLineId(action)];
  while (queue.length) {
    const id = queue.shift();
    if (id == null || seen.has(id)) continue;
    const line = findLine(action, id);
    if (!line) continue;
    seen.add(id);
    queue.push(...lineTargets(line));
  }
  return seen;
}

/** An id for a new line, not used by any line yet: l1, l2, … */
export function newLineId(lines: ReadonlyArray<{ id?: unknown }>): string {
  const used = new Set(lines.map((l) => String(l.id)));
  let n = lines.length + 1;
  while (used.has(`l${n}`)) n++;
  return `l${n}`;
}

/** The activity-log reference of an answer to a line: the action and the line. */
export function conversationRef(actionId: unknown, lineId: string): string {
  return `${String(actionId)}:${lineId}`;
}
