import type { Row } from './api';
import { eventLabel, params, sceneLabel } from './describe';
import type { Store } from './store';

/**
 * Where a character can be when an action of a scene runs, worked out from the editor's rows as
 * the publish check works it out from the document (characterPresence in @qbl/shared): `here` (it
 * is only ever in that scene), `maybe` (it is walked to other scenes too), `anywhere` (it walks
 * around on its own) or `never` (it does not start there and no walk takes it there).
 *
 * Characters live in the world, not in scenes, so an action of a scene that makes one speak in a
 * bubble or play an animation may find it elsewhere. The action's card says so as it is written.
 */
export type Presence = 'here' | 'maybe' | 'anywhere' | 'never';

/** Every walk action of the scenario, nested ones (on buttons, in conversation choices) too, with the event each belongs to. */
function walks(store: Store): Array<{ values: Record<string, unknown>; event: Row | undefined }> {
  const out: Array<{ values: Record<string, unknown>; event: Row | undefined }> = [];
  const visit = (values: Record<string, unknown>, type: unknown, event: Row | undefined) => {
    if (type === 'walk') out.push({ values, event });
    for (const cta of (values.call_to_actions as Array<{ action?: Record<string, unknown> }> | undefined) ?? []) if (cta?.action) visit(cta.action, cta.action.type, event);
    for (const line of (values.lines as Array<{ choices?: Array<{ actions?: Array<Record<string, unknown>> }> }> | undefined) ?? []) {
      for (const choice of line?.choices ?? []) for (const inner of choice?.actions ?? []) visit(inner, inner.type, event);
    }
  };
  for (const a of store.rows('actions')) visit(params(a), a.type, store.byId('events', a.event_id as number));
  return out;
}

export function characterScenes(store: Store, characterId: number): Set<number> | null {
  const row = store.byId('characters', characterId);
  if (!row) return new Set();
  const settings = params(row, 'settings');
  if (settings.roams === true) return null;
  const scenes = new Set<number>();
  if (typeof settings.scene_id === 'number') scenes.add(settings.scene_id);
  for (const { values, event } of walks(store)) {
    if ((values.target ?? 'character') !== 'character' || values.character_id !== characterId) continue;
    const to = (values.scene_id as number | null | undefined) ?? (event?.scene_id as number | null | undefined);
    if (typeof to === 'number') scenes.add(to);
  }
  return scenes;
}

export function presence(store: Store, characterId: number, sceneId: number): Presence {
  const scenes = characterScenes(store, characterId);
  if (!scenes) return 'anywhere';
  if (!scenes.has(sceneId)) return 'never';
  return scenes.size === 1 ? 'here' : 'maybe';
}

const nameOf = (store: Store, id: number) => String(store.byId('characters', id)?.name || `Character ${id}`);

/** Why a character may not be in a scene, as the end of a sentence about it. */
function why(store: Store, id: number, p: Presence): string {
  if (p === 'anywhere') return `walks around on its own, so it may not be in this scene when this runs`;
  if (p === 'maybe') return `is walked to other scenes too, so it may not be in this scene when this runs`;
  const start = params(store.byId('characters', id) ?? ({} as Row), 'settings').scene_id as number | undefined;
  return `is never in this scene: it starts in ${start != null ? `“${sceneLabel(store.byId('scenes', start))}”` : 'no scene'} and no walk action brings it here`;
}

/** The characters an action needs in the player's scene: those it has speak in a bubble, or animates. */
function needed(type: string, values: Record<string, unknown>): Array<{ id: number; what: 'speak' | 'animate' }> {
  const out: Array<{ id: number; what: 'speak' | 'animate' }> = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  if (type === 'animate' && values.target === 'character' && num(values.character_id) != null) out.push({ id: values.character_id as number, what: 'animate' });
  if (type === 'dialogue' && values.speaker === 'character' && values.style !== 'portrait' && num(values.character_id) != null) out.push({ id: values.character_id as number, what: 'speak' });
  if (type === 'conversation' && values.style === 'bubble') {
    for (const line of (values.lines as Array<{ speaker?: string; character_id?: number }> | undefined) ?? []) {
      if (line?.speaker === 'character' && num(line.character_id) != null && !out.some((o) => o.id === line.character_id)) out.push({ id: line.character_id!, what: 'speak' });
    }
  }
  return out;
}

const THEN = { speak: 'its lines are then shown in a story box instead of a bubble', animate: 'nobody then sees it animate' };

/**
 * What to say on an action's card when it needs a character that may not be in the player's scene
 * when it runs, or null. Only actions of a scene's events: a character's own event runs wherever
 * it is clicked, or where a run_event starts it (and that run_event is the one told).
 */
export function presenceWarning(store: Store, event: Row | undefined, type: string, values: Record<string, unknown>): string | null {
  const sceneId = event?.scene_id as number | null | undefined;
  if (sceneId == null) return null;
  const lines: string[] = [];
  for (const { id, what } of needed(type, values)) {
    if (!store.byId('characters', id)) continue;
    const p = presence(store, id, sceneId);
    if (p !== 'here') lines.push(`${nameOf(store, id)} ${why(store, id, p)}; ${THEN[what]}.`);
  }
  if (type === 'run_event') {
    const target = store.byId('events', (values.target_event_id ?? values.event_id) as number | null);
    if (target?.character_id != null) {
      const inside = new Map<number, 'speak' | 'animate'>();
      for (const a of store.where('actions', 'event_id', target.id)) for (const n of needed(String(a.type), params(a))) if (!inside.has(n.id)) inside.set(n.id, n.what);
      for (const [id, what] of inside) {
        if (!store.byId('characters', id)) continue;
        const p = presence(store, id, sceneId);
        if (p !== 'here') lines.push(`This runs ${nameOf(store, target.character_id as number)}’s event “${eventLabel(target)}”, in which ${nameOf(store, id)} ${what === 'speak' ? 'speaks in a bubble' : 'plays an animation'}; ${nameOf(store, id)} ${why(store, id, p)}, so ${THEN[what]}.`);
      }
    }
  }
  return lines.length ? lines.join(' ') : null;
}
