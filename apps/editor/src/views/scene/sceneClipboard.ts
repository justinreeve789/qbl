import type { SceneBench } from '@qbl/shared';
import { duplicateScene, eventRows, freeName, hold, holding, holdsOther, NUDGE, pasteEvents, pasted, sceneRows } from '../../clipboard';
import { eventLabel, sceneLabel } from '../../describe';
import { toast } from '../../dom';
import { clone } from '../../history';
import type { ShortcutTarget } from '../../shortcuts';
import { copyActions, deleteActions, pasteActionsInto, pickedActions } from '../actions';
import { freshBenchId, withoutVessel } from './benchPanels';
import { startBench } from './inspector';
import type { Bag, Point, SceneModel, Selection } from './model';

/** The lists kept in a scene's JSON that hold what can be selected on the canvas. */
type JsonList =
  | 'background_media' | 'foreground_media'
  | 'spawn_points' | 'items' | 'characters' | 'walkable_areas' | 'blocked_areas' | 'scale_areas' | 'shadow_spots' | 'lights' | 'flows' | 'water_lights' | 'fogs'
  | 'bench:vessels' | 'bench:tools';

const NAMES: Record<JsonList, string> = {
  background_media: 'background layer', foreground_media: 'foreground layer', spawn_points: 'spawn point', items: 'placed item',
  characters: 'placed character', walkable_areas: 'walkable area', blocked_areas: 'blocked area', scale_areas: 'scale area',
  shadow_spots: 'shadow spot', lights: 'light', flows: 'flowing water', water_lights: 'underwater light', fogs: 'fog', 'bench:vessels': 'container', 'bench:tools': 'tool',
};

/** Lists whose entries are points or small things: a copy pasted beside its original is moved a little. */
const NUDGED = new Set<JsonList>(['spawn_points', 'items', 'characters', 'walkable_areas', 'blocked_areas', 'shadow_spots', 'lights', 'bench:vessels', 'bench:tools']);

function jsonOf(sel: Selection): { list: JsonList; index: number } | null {
  switch (sel.kind) {
    case 'layer': return { list: sel.which, index: sel.index };
    case 'area': return { list: sel.which, index: sel.index };
    case 'spawn': return { list: 'spawn_points', index: sel.index };
    case 'item': return { list: 'items', index: sel.index };
    case 'character': return { list: 'characters', index: sel.index };
    case 'scale': return { list: 'scale_areas', index: sel.index };
    case 'shadow': return { list: 'shadow_spots', index: sel.index };
    case 'light': return { list: 'lights', index: sel.index };
    case 'flow': return { list: 'flows', index: sel.index };
    case 'water_light': return { list: 'water_lights', index: sel.index };
    case 'fog': return { list: 'fogs', index: sel.index };
    case 'bench-vessel': return { list: 'bench:vessels', index: sel.index };
    case 'bench-tool': return { list: 'bench:tools', index: sel.index };
    default: return null;
  }
}

function selectionOf(list: JsonList, index: number): Selection {
  switch (list) {
    case 'background_media':
    case 'foreground_media': return { kind: 'layer', which: list, index };
    case 'walkable_areas':
    case 'blocked_areas': return { kind: 'area', which: list, index };
    case 'spawn_points': return { kind: 'spawn', index };
    case 'items': return { kind: 'item', index };
    case 'characters': return { kind: 'character', index };
    case 'scale_areas': return { kind: 'scale', index };
    case 'shadow_spots': return { kind: 'shadow', index };
    case 'lights': return { kind: 'light', index };
    case 'flows': return { kind: 'flow', index };
    case 'water_lights': return { kind: 'water_light', index };
    case 'fogs': return { kind: 'fog', index };
    case 'bench:vessels': return { kind: 'bench-vessel', index };
    case 'bench:tools': return { kind: 'bench-tool', index };
  }
}

function readList(model: SceneModel, list: JsonList): unknown[] {
  if (list === 'background_media' || list === 'foreground_media') return model.layers(list);
  if (list === 'bench:vessels') return model.bench()?.vessels ?? [];
  if (list === 'bench:tools') return model.bench()?.tools ?? [];
  return model.layout(list);
}

function writeList(model: SceneModel, list: JsonList, entries: unknown[]) {
  if (list === 'background_media' || list === 'foreground_media') return model.setLayers(list, entries as Bag[], true);
  if (list === 'bench:vessels') return model.setBenchPart('vessels', entries as NonNullable<SceneBench['vessels']>, true);
  if (list === 'bench:tools') return model.setBenchPart('tools', entries as NonNullable<SceneBench['tools']>, true);
  return model.setLayout(list, entries, true);
}

/** A copy of an entry moved a little: corners of an area, or its x and y (position_x and position_y). */
function nudged(entry: unknown): unknown {
  if (Array.isArray(entry)) return entry.map((p: Point) => ({ ...p, x: p.x + NUDGE, y: p.y + NUDGE }));
  const e = { ...(entry as Bag) };
  for (const key of ['x', 'y', 'position_x', 'position_y']) if (typeof e[key] === 'number') e[key] = (e[key] as number) + NUDGE;
  return e;
}

export interface SceneClipboardHost {
  selection(): Selection;
  select(next: Selection): void;
  /** Open another scene (a duplicate). */
  open(sceneId: number): void;
}

/**
 * Delete, Ctrl+C, Ctrl+X and Ctrl+V in the scene editor, for what is selected in the scene: a hotspot
 * or other event (with its actions, conditions and labels), an area, a spawn point, a placed item or
 * character, a layer, a light, a container or tool of the bench. Actions ticked in the event's panel
 * come first: the keys then copy, cut or delete those. With the scene itself selected, Ctrl+C copies
 * the whole scene, and pasting it makes a duplicate.
 */
export function sceneShortcuts(model: SceneModel, host: SceneClipboardHost): ShortcutTarget {
  const { store } = model;
  const ticked = (sel: Selection) => (sel.kind === 'event' ? pickedActions(store, sel.id) : []);

  const copy = async (cut: boolean): Promise<boolean> => {
    const sel = host.selection();
    const actions = ticked(sel);
    if (sel.kind === 'event' && actions.length) return copyActions(store, sel.id, actions, cut);
    if (sel.kind === 'event') {
      const event = store.byId('events', sel.id);
      if (!event) return false;
      const what = `${event.kind === 'hotspot' ? 'the hotspot' : 'the event'} “${eventLabel(event)}”`;
      hold(store.scenarioId, { kind: 'events', sceneId: model.sceneId, rows: eventRows(store, [event.id]) }, what, cut);
      if (cut) {
        host.select({ kind: 'scene' });
        await store.remove('events', event.id);
        toast(`Cut ${what}. Press Ctrl+V here or in another scene to paste it.`);
      } else toast(`Copied ${what}, with its actions. Press Ctrl+V to paste a copy.`);
      return true;
    }
    if (sel.kind === 'scene') {
      if (cut) {
        toast('A scene can be copied (Ctrl+C) but not cut. To move what is in it, select those things and cut them.');
        return false;
      }
      hold(store.scenarioId, { kind: 'scene', sceneId: model.sceneId, rows: sceneRows(store, model.sceneId) }, `the scene “${sceneLabel(model.row)}”`);
      toast('Copied the whole scene. Press Ctrl+V (here or on the Scenes map) to make a duplicate of it.');
      return true;
    }
    const json = jsonOf(sel);
    const entry = json ? readList(model, json.list)[json.index] : undefined;
    if (!json || entry === undefined) {
      toast('Select something in the scene first: a hotspot, an area, a spawn point…');
      return false;
    }
    const what = `the ${NAMES[json.list]}`;
    hold(store.scenarioId, { kind: 'json', sceneId: model.sceneId, list: json.list, entry: clone(entry) }, what, cut);
    if (cut) {
      await remove(false);
      toast(`Cut ${what}. Press Ctrl+V to paste it.`);
    } else toast(`Copied ${what}. Press Ctrl+V to paste a copy.`);
    return true;
  };

  const paste = async (): Promise<boolean> => {
    const held = holding(store.scenarioId);
    if (!held) {
      toast(holdsOther(store.scenarioId) ? 'What you copied is from another scenario. Copy and paste work within one scenario.' : 'Nothing has been copied yet. Select something and press Ctrl+C.');
      return false;
    }
    const { clip } = held;
    if (clip.kind === 'actions') {
      const sel = host.selection();
      if (sel.kind !== 'event' || !store.byId('events', sel.id)) {
        toast(`Select the event to paste ${held.what} into.`);
        return false;
      }
      return pasteActionsInto(store, sel.id);
    }
    if (clip.kind === 'scene') {
      const id = await duplicateScene(store, clip.sceneId, clip.rows);
      if (id != null) toast(`Made a duplicate of ${held.what}.`, 'info', { label: 'Open it', run: () => host.open(id) });
      return id != null;
    }
    if (clip.kind === 'events') {
      const id = await pasteEvents(store, clip.rows, model.sceneId, held.cut, clip.sceneId === model.sceneId);
      if (id == null) return false;
      pasted();
      host.select({ kind: 'event', id });
      return true;
    }
    // An entry of one of the scene's lists.
    const list = clip.list as JsonList;
    let entry = clone(clip.entry);
    if (clip.sceneId === model.sceneId && !held.cut && NUDGED.has(list)) entry = nudged(entry);
    if (list === 'spawn_points') {
      const e = entry as Bag;
      e.name = freeName(String(e.name || 'spawn'), model.layout('spawn_points').map((p) => p.name));
    }
    if (list === 'bench:vessels' || list === 'bench:tools') {
      await startBench(model);
      const bench = model.bench();
      const e = entry as Bag;
      e.id = freshBenchId(bench, list === 'bench:vessels' ? 'vessels' : 'tools', String(e.id || (list === 'bench:vessels' ? 'vessel' : e.kind || 'tool')));
      // A burner under a container that is not on this bench stands on its own.
      if (list === 'bench:tools' && e.vessel_id && !bench?.vessels?.some((v) => v.id === e.vessel_id)) delete e.vessel_id;
    }
    const entries = readList(model, list);
    await writeList(model, list, [...entries, entry]);
    pasted();
    host.select(selectionOf(list, entries.length));
    return true;
  };

  const remove = async (tell = true): Promise<boolean> => {
    const sel = host.selection();
    const actions = ticked(sel);
    if (sel.kind === 'event' && actions.length) return deleteActions(store, actions);
    const undo = { label: 'Undo', run: () => void store.undo() };
    if (sel.kind === 'event') {
      const event = store.byId('events', sel.id);
      if (!event) return false;
      host.select({ kind: 'scene' });
      await store.remove('events', event.id);
      if (tell) toast(`Deleted ${event.kind === 'hotspot' ? 'the hotspot' : 'the event'} “${eventLabel(event)}” and its actions.`, 'info', undo);
      return true;
    }
    const json = jsonOf(sel);
    if (!json) return false;
    const entries = readList(model, json.list);
    if (json.index >= entries.length) return false;
    host.select(json.list.startsWith('bench:') ? { kind: 'bench' } : { kind: 'scene' });
    if (json.list === 'bench:vessels') await model.setBench(withoutVessel(model.bench()!, json.index), true);
    else await writeList(model, json.list, entries.filter((_, i) => i !== json.index));
    if (tell) toast(`Deleted the ${NAMES[json.list]}.`, 'info', undo);
    return true;
  };

  return { copy, paste, remove: () => remove(true) };
}
