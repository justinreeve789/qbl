import type { CopyRows, Row } from './api';
import { params, sceneLabel } from './describe';
import { clone } from './history';
import type { Store } from './store';

/**
 * The editor's own clipboard, for Ctrl+C, Ctrl+X and Ctrl+V (and the Copy, Cut and Paste buttons).
 *
 * It holds one thing at a time, within one scenario: what was copied points at that scenario's
 * media, items, characters and scenes, so it is pasted only there. It is a copy of the rows (or the
 * JSON) as they were when copied, so changing or deleting the original afterwards does not change
 * what is pasted. What was cut is deleted at once; pasting it the first time puts it back under its
 * own ids (a move, so whatever named it still does), and any later paste is a copy.
 */
export type Clip =
  /** Events of a scene (hotspots, start, end and indirect events), with their actions, conditions and labels. */
  | { kind: 'events'; sceneId: number; rows: CopyRows }
  /** Actions of an event, in order, with their own conditions. */
  | { kind: 'actions'; eventId: number; rows: CopyRows }
  /** A whole scene, with everything in it: pasted, it is duplicated. */
  | { kind: 'scene'; sceneId: number; rows: CopyRows }
  /** An entry of a list kept in a scene's JSON: a spawn point, a placed item, an area, a light... */
  | { kind: 'json'; sceneId: number; list: string; entry: unknown };

interface Held {
  scenarioId: number;
  clip: Clip;
  /** What it is, for messages ("the hotspot “door”", "3 actions"). */
  what: string;
  /** True until what was cut has been pasted once. */
  cut: boolean;
}

let held: Held | null = null;
const listeners = new Set<() => void>();

/** Put something on the clipboard. */
export function hold(scenarioId: number, clip: Clip, what: string, cut = false) {
  held = { scenarioId, clip: clone(clip), what, cut };
  for (const l of [...listeners]) l();
}

/** What the clipboard holds for this scenario, if anything. */
export function holding(scenarioId: number): Held | null {
  return held?.scenarioId === scenarioId ? held : null;
}

/** True when the clipboard holds something from another scenario. */
export function holdsOther(scenarioId: number): boolean {
  return held != null && held.scenarioId !== scenarioId;
}

/** What was cut has been pasted: from now on pasting it makes copies. */
export function pasted() {
  if (held) held.cut = false;
}

/** Be told when the clipboard changes (to show a Paste button). */
export function onClipboard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forget what is held (tests). */
export function clearClipboard() {
  held = null;
}

// ------------------------------------------------------------------ rows

const byOrder = (a: Row, b: Row) => Number(a.sequence) - Number(b.sequence) || a.id - b.id;

/** Events with everything that belongs to them: their actions, conditions (theirs and their actions') and labels. */
export function eventRows(store: Store, eventIds: number[]): CopyRows {
  const ids = new Set(eventIds);
  const events = store.rows('events').filter((e) => ids.has(e.id));
  const actions = store.rows('actions').filter((a) => ids.has(a.event_id as number)).sort(byOrder);
  const actionIds = new Set(actions.map((a) => a.id));
  return clone({
    events,
    actions,
    conditions: store.rows('conditions').filter((c) => ids.has(c.event_id as number) || actionIds.has(c.action_id as number)),
    labels: store.rows('labels').filter((l) => ids.has(l.event_id as number)),
  });
}

/** Actions, in the order they run, with their own conditions. */
export function actionRows(store: Store, actionIds: number[]): CopyRows {
  const ids = new Set(actionIds);
  return clone({
    actions: store.rows('actions').filter((a) => ids.has(a.id)).sort(byOrder),
    conditions: store.rows('conditions').filter((c) => ids.has(c.action_id as number)),
  });
}

/** A scene and everything in it. */
export function sceneRows(store: Store, sceneId: number): CopyRows {
  const scene = store.byId('scenes', sceneId);
  return { scenes: scene ? [clone(scene)] : [], ...eventRows(store, store.where('events', 'scene_id', sceneId).map((e) => e.id)) };
}

/** `name`, or if that is taken, `name-2`, `name-3`... */
export function freeName(name: string, taken: Iterable<unknown>): string {
  const used = new Set([...taken].map((t) => String(t ?? '')));
  if (!used.has(name)) return name;
  for (let n = 2; ; n++) if (!used.has(`${name}-${n}`)) return `${name}-${n}`;
}

/** How far a copy pasted beside its original is moved, so both can be seen (px). */
export const NUDGE = 40;

/**
 * Paste events into a scene. A copy pasted into the scene it came from is moved a little, so it is
 * not hidden under its original, and gets a name of its own. Answers with the id of the first event.
 */
export async function pasteEvents(store: Store, rows: CopyRows, sceneId: number, keepIds: boolean, sameScene: boolean): Promise<number | undefined> {
  const copy = clone(rows);
  const taken = store.where('events', 'scene_id', sceneId).map((e) => e.shortname);
  const nudge = sameScene && !keepIds;
  for (const event of copy.events ?? []) {
    event.scene_id = sceneId;
    if (nudge && event.kind === 'hotspot') {
      if (event.position_x != null) event.position_x = Number(event.position_x) + NUDGE;
      if (event.position_y != null) event.position_y = Number(event.position_y) + NUDGE;
    }
    if (event.shortname) {
      event.shortname = freeName(String(event.shortname), taken);
      taken.push(event.shortname);
    }
  }
  if (nudge) {
    for (const label of copy.labels ?? []) {
      label.position_x = Number(label.position_x ?? 0) + NUDGE;
      label.position_y = Number(label.position_y ?? 0) + NUDGE;
    }
  }
  const first = copy.events?.[0]?.id;
  const made = await store.paste(copy, keepIds);
  return made && first != null ? made('events', first) : undefined;
}

/** Paste actions at the end of an event, in the order they were copied. Answers with their ids now. */
export async function pasteActions(store: Store, rows: CopyRows, eventId: number, keepIds: boolean): Promise<number[] | undefined> {
  const copy = clone(rows);
  let sequence = store.where('actions', 'event_id', eventId).reduce((max, a) => Math.max(max, Number(a.sequence) || 0), 0);
  for (const action of copy.actions ?? []) {
    action.event_id = eventId;
    action.sequence = ++sequence;
  }
  const made = await store.paste(copy, keepIds);
  if (!made) return undefined;
  return (copy.actions ?? []).map((a) => made('actions', a.id)).filter((id): id is number => id != null);
}

/**
 * Duplicate a scene, with everything in it: its hotspots and other events, their actions,
 * conditions and labels, and what is kept in the scene itself (layers, areas, spawn points,
 * placed items and characters). Jumps and events that pointed into the scene point into the copy;
 * jumps to other scenes still go there. The copy goes last in the list, beside the original on
 * the map, and is never the intro scene. `rows` are what was copied (sceneRows), if not the scene
 * as it is now. Answers with the new scene's id.
 */
export async function duplicateScene(store: Store, sceneId: number, rows: CopyRows = sceneRows(store, sceneId), at?: { x: number; y: number }): Promise<number | undefined> {
  const copy = clone(rows);
  const scene = copy.scenes?.[0];
  if (!scene) return undefined;
  delete scene.sequence;
  scene.is_intro_scene = false;
  scene.shortname = freeName(`${sceneLabel(scene)}-copy`, store.rows('scenes').map((s) => s.shortname));
  const p = { ...params(scene) };
  const was = p.editor_map as { x?: number; y?: number } | undefined;
  if (at) p.editor_map = { x: Math.round(at.x), y: Math.round(at.y) };
  else if (was && typeof was.x === 'number' && typeof was.y === 'number') p.editor_map = { x: was.x + NUDGE, y: was.y + NUDGE };
  scene.params = p;
  const made = await store.paste(copy);
  return made?.('scenes', scene.id);
}
