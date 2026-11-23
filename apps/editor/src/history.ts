import type { Bundle, RestoreStep, Row, Table } from './api';

/**
 * Undo and redo for the scenario being edited (Ctrl+Z, Ctrl+Y).
 *
 * Every change the Store makes is noted here as what its rows were before and after it. Changes are
 * grouped into steps: everything done from one click or key press to the next is one step (adding
 * a hotspot and the actions that come with it, dragging a slider from start to end), and a run of
 * keys typed into one field is one step too. The last 50 steps are kept.
 *
 * Undoing a step sends the rows as they were before it to the API in one request
 * (ScenarioStore::restore): rows it added are deleted, rows it deleted are put back under their own
 * ids, and changed columns get their old values. Redoing sends them as they were after it.
 */

/** Order of the content tables, parents before children (as ScenarioStore::CONTENT). */
const ORDER: Table[] = ['media', 'shop_items', 'variables', 'items', 'characters', 'scenes', 'events', 'actions', 'conditions', 'labels'];
/** Columns of the scenario that are not the author's to undo. */
const SCENARIO_META = new Set(['id', 'code', 'user_id', 'published_at', 'updated_at', 'created_at']);
/** How many steps are kept. */
export const HISTORY_LIMIT = 50;
/** Keys typed into one field this soon after the last are part of the same step (ms). */
const TYPING_GAP = 1500;

type Values = Record<string, unknown>;

/** One row before and after: null when it did not exist. Both hold the same columns, or the whole row when one side is null. */
interface RowChange {
  table: Table;
  id: number;
  before: Values | null;
  after: Values | null;
}

export interface Change {
  rows: RowChange[];
  scenario?: { before: Values; after: Values };
}

interface Step {
  gesture: number;
  rows: Map<string, RowChange>;
  scenario: { before: Values; after: Values } | null;
  /** Set while the step is only typing into one field: which row and columns. */
  typing: string | null;
  at: number;
}

// ------------------------------------------------------------------ gestures

/** Counts clicks, key presses and moves to another field: changes made between two of them are one step. */
let gesture = 0;
/** A new click or key press: the next change starts a new step. */
export function nextGesture() {
  gesture++;
}
const isUndoKey = (e: KeyboardEvent) => undoKey(e) !== null;
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', nextGesture, true);
  window.addEventListener('drop', nextGesture, true);
  // Moving to another field, with Tab or otherwise.
  window.addEventListener('focusin', nextGesture, true);
  window.addEventListener('keydown', (e) => {
    if (!MODIFIERS.has(e.key) && !isUndoKey(e)) nextGesture();
  }, true);
}

/** Which of the two a key press asks for: Ctrl+Z (Cmd+Z) undoes; Ctrl+Y and Ctrl+Shift+Z (Cmd+Shift+Z) redo. */
export function undoKey(e: KeyboardEvent): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && !e.shiftKey) return 'redo';
  return null;
}

// ------------------------------------------------------------------ helpers

export const clone = <T>(value: T): T => (value === undefined ? value : (structuredClone(value) as T));

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function pick(row: Values, keys: string[]): Values {
  const out: Values = {};
  for (const key of keys) out[key] = clone(row[key] ?? null);
  return out;
}

/** Everything that differs between two copies of a scenario: for a change the API made on its own (a delete and what went with it). */
export function diff(before: Bundle, after: Bundle): Change {
  const rows: RowChange[] = [];
  for (const table of ORDER) {
    const old = new Map(before[table].map((r) => [r.id, r]));
    const now = new Map(after[table].map((r) => [r.id, r]));
    for (const [id, row] of old) {
      const next = now.get(id);
      if (!next) {
        rows.push({ table, id, before: clone(row), after: null });
        continue;
      }
      const keys = [...new Set([...Object.keys(row), ...Object.keys(next)])].filter((k) => k !== 'id' && !same(row[k], next[k]));
      if (keys.length) rows.push({ table, id, before: pick(row, keys), after: pick(next, keys) });
    }
    for (const [id, row] of now) if (!old.has(id)) rows.push({ table, id, before: null, after: clone(row) });
  }
  const keys = [...new Set([...Object.keys(before.scenario), ...Object.keys(after.scenario)])].filter((k) => !SCENARIO_META.has(k) && !same(before.scenario[k], after.scenario[k]));
  return { rows, scenario: keys.length ? { before: pick(before.scenario, keys), after: pick(after.scenario, keys) } : undefined };
}

// ------------------------------------------------------------------ history

export class History {
  private undone: Step[] = [];
  private done: Step[] = [];
  /** The step changes are going into now; it joins `done` with its first change. */
  private open: Step | null = null;
  /** Bumped by clear(): steps taken before it are not recorded. */
  private era = 0;

  get canUndo() {
    return this.done.length > 0;
  }

  get canRedo() {
    return this.undone.length > 0;
  }

  /** How many steps can be undone, and redone. */
  get size() {
    return { undo: this.done.length, redo: this.undone.length };
  }

  /**
   * The step a change made now belongs to. Taken when the change is made, and passed to record()
   * once the API has accepted it. `typing` names the row and columns of a patch: a patch of the
   * same ones soon after the last joins its step even after a key press.
   */
  take(typing: string | null = null): { step: Step; era: number } {
    const last = this.done[this.done.length - 1];
    if (this.open?.gesture === gesture) {
      if (this.open.typing !== typing) this.open.typing = null;
    } else if (typing && last && last === this.open && last.typing === typing && Date.now() - last.at < TYPING_GAP) {
      last.gesture = gesture;
    } else {
      this.open = { gesture, rows: new Map(), scenario: null, typing, at: Date.now() };
    }
    return { step: this.open, era: this.era };
  }

  /** Note a change the API accepted, in the step taken when it was made. */
  record(taken: { step: Step; era: number }, change: Change) {
    if (taken.era !== this.era) return;
    const { step } = taken;
    for (const c of change.rows) merge(step, c);
    if (change.scenario) {
      const s = step.scenario ?? (step.scenario = { before: {}, after: {} });
      for (const [k, v] of Object.entries(change.scenario.before)) if (!(k in s.before)) s.before[k] = v;
      Object.assign(s.after, change.scenario.after);
    }
    step.at = Date.now();
    if (!this.done.includes(step)) {
      this.done.push(step);
      if (this.done.length > HISTORY_LIMIT) this.done.shift();
      this.undone = [];
    }
  }

  /**
   * The next step to undo, as what to send. The step moves to the redo list once it is done; if it
   * could not be done, call `dropped`.
   */
  undo(): Pending | null {
    return this.move(this.done, this.undone, 'before');
  }

  redo(): Pending | null {
    return this.move(this.undone, this.done, 'after');
  }

  private move(from: Step[], to: Step[], side: 'before' | 'after'): Pending | null {
    this.open = null;
    let step: Step | undefined;
    let steps: RestoreStep[] = [];
    // Steps that came to nothing (a value typed and typed back) are passed over.
    while ((step = from.pop()) && !(steps = toRestore(step, side)).length);
    if (!step) return null;
    const found = step;
    return {
      steps,
      done: () => {
        to.push(found);
        if (to.length > HISTORY_LIMIT) to.shift();
      },
    };
  }

  /** Forget everything: after a change that cannot be undone, such as deleting a file. */
  clear() {
    this.done = [];
    this.undone = [];
    this.open = null;
    this.era++;
  }
}

export interface Pending {
  steps: RestoreStep[];
  /** Call once the API has made it. */
  done(): void;
}

function merge(step: Step, c: RowChange) {
  const key = `${c.table}:${c.id}`;
  const had = step.rows.get(key);
  if (!had) {
    step.rows.set(key, { table: c.table, id: c.id, before: clone(c.before), after: clone(c.after) });
    return;
  }
  // The earliest "before" wins; columns it lacks are taken from this change's.
  if (had.before !== null) had.before = c.before === null ? had.before : { ...clone(c.before), ...had.before };
  // The latest "after" wins.
  had.after = c.after === null ? null : had.after === null ? clone(c.after) : { ...had.after, ...clone(c.after) };
  // Columns now in "after" that "before" lacks (a row deleted and its columns changed after): keep both sides alike.
  if (had.before && had.after) for (const k of Object.keys(had.after)) if (!(k in had.before)) delete had.after[k];
  if (had.before === null && had.after === null) step.rows.delete(key);
}

/** The API steps that bring the rows of a step to one side of it: parents put back before their children, and deleted after them. */
function toRestore(step: Step, side: 'before' | 'after'): RestoreStep[] {
  const inserts: RestoreStep[] = [];
  const updates: RestoreStep[] = [];
  const deletes: RestoreStep[] = [];
  const rank = (t: Table) => ORDER.indexOf(t);
  const rows = [...step.rows.values()].sort((a, b) => rank(a.table) - rank(b.table) || a.id - b.id);
  for (const r of rows) {
    const from = side === 'before' ? r.after : r.before;
    const to = side === 'before' ? r.before : r.after;
    if (from === null && to !== null) inserts.push({ op: 'insert', table: r.table, row: { ...clone(to), id: r.id } as Row });
    else if (from !== null && to === null) deletes.unshift({ op: 'delete', table: r.table, id: r.id });
    else if (from && to && !same(from, to)) {
      const attrs: Values = {};
      for (const k of Object.keys(to)) if (!same(from[k], to[k])) attrs[k] = clone(to[k]);
      if (Object.keys(attrs).length) updates.push({ op: 'update', table: r.table, id: r.id, attrs });
    }
  }
  const scenario: RestoreStep[] = [];
  if (step.scenario) {
    const from = side === 'before' ? step.scenario.after : step.scenario.before;
    const to = side === 'before' ? step.scenario.before : step.scenario.after;
    const attrs: Values = {};
    for (const k of Object.keys(to)) if (!same(from[k], to[k])) attrs[k] = clone(to[k]);
    if (Object.keys(attrs).length) scenario.push({ op: 'scenario', attrs });
  }
  return [...inserts, ...updates, ...scenario, ...deletes];
}
