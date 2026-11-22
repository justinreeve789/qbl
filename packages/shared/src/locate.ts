import type { Id } from './types.js';

/** The event lists of a scene, by their key in the document. */
export const EVENT_LISTS = {
  start_events: 'start',
  end_events: 'end',
  hotspots: 'hotspot',
  indirect_events: 'indirect',
} as const;
export type EventList = keyof typeof EVENT_LISTS;
export type EventKind = (typeof EVENT_LISTS)[EventList];

/** Lists inside a scene that are not events: where things stand, areas, layers. */
export const SCENE_LISTS = [
  'spawn_points', 'items', 'characters', 'walkable_areas', 'blocked_areas', 'scale_areas', 'shadow_spots', 'lights', 'background_media', 'foreground_media',
] as const;
export type SceneList = (typeof SCENE_LISTS)[number];

/** Lists at the top of a scenario, beside its scenes. */
export const SCENARIO_LISTS = [
  'assets', 'items', 'characters', 'avatars', 'avatar_media_ids', 'global_variables', 'objectives', 'glossary', 'scene_groups', 'moves', 'shop_items',
] as const;
export type ScenarioList = (typeof SCENARIO_LISTS)[number];

/**
 * Where in a scenario an issue's path points, with the ids of what it passes through, so a tool can
 * name the place for a person and take them there. Every part is optional: a path only goes so deep.
 */
export interface IssuePlace {
  scene?: { index: number; id?: Id; name?: string };
  /** An event of the scene, or (list `events`, kind `character`) one of a character's own, with the character in `entry`. */
  event?: { list: EventList | 'events'; kind: EventKind | 'character'; index: number; id?: Id; name?: string };
  /**
   * An action of the event. `button` is set when the path goes on into one of an infobox's buttons,
   * `line` when it goes into a line of a conversation (and `line.choice` into one of its choices).
   */
  action?: {
    index: number; id?: Id; type?: string;
    button?: { index: number; text?: string };
    line?: { index: number; id?: string; text?: string; choice?: { index: number; text?: string } };
  };
  /** A label, or a condition, of the event or action. */
  label?: { index: number };
  condition?: { index: number; of?: string };
  /** An entry in one of the scene's own lists (a spawn point, a placed item, an area, a layer...). */
  layout?: { list: SceneList; index?: number };
  /** An entry in one of the scenario's lists (media, items, characters, variables...). */
  entry?: { list: ScenarioList; index?: number; id?: Id; name?: string; animation?: string };
  /** The attribute the path ends on, such as `target_id`, when it ends on one. */
  field?: string;
}

type Token = string | number;

/** `scenes[3].start_events[0].actions[0].target_id` → ['scenes', 3, 'start_events', 0, 'actions', 0, 'target_id']. */
export function pathTokens(path: string): Token[] {
  const tokens: Token[] = [];
  // Objectives write which list of conditions as `objectives[0](complete_when)`; that is a name too.
  for (const m of path.matchAll(/\[(\d+)\]|\(([^)]*)\)|([^.[\]()]+)/g)) {
    if (m[1] !== undefined) tokens.push(Number(m[1]));
    else tokens.push((m[2] ?? m[3])!);
  }
  return tokens;
}

const obj = (v: unknown): Record<string, unknown> | undefined => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
const at = (list: unknown, i: Token | undefined): Record<string, unknown> | undefined => (Array.isArray(list) && typeof i === 'number' ? obj(list[i]) : undefined);
const idOf = (v: Record<string, unknown> | undefined): Id | undefined => (typeof v?.id === 'number' ? v.id : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);

/**
 * Follow an issue's path (as `validateScenario` writes it) through the document it was found in.
 * Unknown paths are not an error: what could be followed is returned.
 */
export function locateIssue(doc: unknown, path: string): IssuePlace {
  const place: IssuePlace = {};
  const root = obj(doc);
  const t = pathTokens(path);
  let i = 0;
  const name = () => (typeof t[i] === 'string' ? (t[i] as string) : undefined);
  const index = () => (typeof t[i] === 'number' ? (t[i] as number) : undefined);
  /** Whatever is left is an attribute: the last name in it is the one to point at. */
  const finish = () => {
    const rest = t.slice(i).filter((x): x is string => typeof x === 'string');
    if (rest.length) place.field = rest[rest.length - 1];
    return place;
  };
  /** At `actions[n]` of an event: the action, and the button, line or choice the path goes on into. Returns where the path goes on. */
  const followAction = (event: Record<string, unknown> | undefined, from: number): number => {
    let j = from;
    const actionIndex = t[j + 1] as number;
    const action = at(event?.actions, actionIndex);
    const found: NonNullable<IssuePlace['action']> = { index: actionIndex, id: idOf(action), type: str(action?.type) };
    place.action = found;
    j += 2;
    const word = () => (typeof t[j] === 'string' ? (t[j] as string) : undefined);
    if (word() === 'call_to_actions' && typeof t[j + 1] === 'number') {
      const buttonIndex = t[j + 1] as number;
      found.button = { index: buttonIndex, text: str(at(action?.call_to_actions, buttonIndex)?.text) };
      j += 2;
      // A button's own action is part of the button.
      if (word() === 'action') j += 1;
    } else if (word() === 'lines' && typeof t[j + 1] === 'number') {
      const lineIndex = t[j + 1] as number;
      const line = obj(at(action?.lines, lineIndex));
      found.line = { index: lineIndex, id: str(line?.id), text: str(line?.text) };
      j += 2;
      if (word() === 'choices' && typeof t[j + 1] === 'number') {
        const choiceIndex = t[j + 1] as number;
        found.line.choice = { index: choiceIndex, text: str(at(line?.choices, choiceIndex)?.text) };
        j += 2;
        // What a choice does is part of the choice.
        if (word() === 'actions' && typeof t[j + 1] === 'number') j += 2;
      }
    }
    return j;
  };

  if (name() === 'scenes' && typeof t[1] === 'number') {
    const sceneIndex = t[1];
    const scene = at(root?.scenes, sceneIndex);
    place.scene = { index: sceneIndex, id: idOf(scene), name: str(scene?.shortname) ?? str(scene?.subtitle) };
    i = 2;
    const key = name();
    if (key && key in EVENT_LISTS && index() === undefined && typeof t[i + 1] === 'number') {
      const list = key as EventList;
      const eventIndex = t[i + 1] as number;
      const event = at(scene?.[list], eventIndex);
      place.event = { list, kind: EVENT_LISTS[list], index: eventIndex, id: idOf(event), name: str(event?.shortname) };
      i += 2;
      if (name() === 'actions' && typeof t[i + 1] === 'number') {
        i = followAction(event, i);      } else if (name() === 'labels' && typeof t[i + 1] === 'number') {
        place.label = { index: t[i + 1] as number };
        i += 2;
      }
    } else if (key && (SCENE_LISTS as readonly string[]).includes(key)) {
      place.layout = { list: key as SceneList, index: typeof t[i + 1] === 'number' ? (t[i + 1] as number) : undefined };
      i += place.layout.index === undefined ? 1 : 2;
    }
  } else if (name() && (SCENARIO_LISTS as readonly string[]).includes(name()!)) {
    const list = name() as ScenarioList;
    const entryIndex = typeof t[1] === 'number' ? t[1] : undefined;
    const entry = at(root?.[list], entryIndex);
    place.entry = {
      list,
      index: entryIndex,
      id: list === 'avatar_media_ids' ? undefined : idOf(entry),
      name: list === 'global_variables' ? str(entry?.variable_name) : list === 'moves' ? str(entry?.animation) : str(entry?.name) ?? str(entry?.term) ?? str(entry?.text),
    };
    // Glossary entries and objectives have ids that are words.
    if (place.entry.id === undefined && entry && (typeof entry.id === 'string' || typeof entry.id === 'number')) place.entry.id = entry.id as Id;
    i = entryIndex === undefined ? 1 : 2;
    if (name() === 'animations' && typeof t[i + 1] === 'string') {
      place.entry.animation = t[i + 1] as string;
      i += 2;
    } else if (list === 'characters' && name() === 'events' && typeof t[i + 1] === 'number') {
      // One of the character's own events.
      const eventIndex = t[i + 1] as number;
      const event = at(entry?.events, eventIndex);
      place.event = { list: 'events', kind: 'character', index: eventIndex, id: idOf(event), name: str(event?.shortname) };
      i += 2;
      if (name() === 'actions' && typeof t[i + 1] === 'number') i = followAction(event, i);
    }
  }

  // Conditions can hang off any of the above.
  for (let j = i; j < t.length; j++) {
    if (t[j] === 'conditions' && typeof t[j + 1] === 'number') {
      const of = typeof t[j - 1] === 'string' && t[j - 1] !== 'conditions' && j > i ? (t[j - 1] as string) : undefined;
      place.condition = { index: t[j + 1] as number, of };
      i = j + 2;
      break;
    }
  }
  return finish();
}
