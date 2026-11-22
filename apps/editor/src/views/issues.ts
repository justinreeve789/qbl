import { locateIssue, type ActionType, type Issue, type IssuePlace, type SceneList, type ScenarioList } from '@qbl/shared';
import { CHARACTER_EVENT, EVENT_KINDS, mediaLabel, sceneLabel } from '../describe';
import { h, openFold } from '../dom';
import type { Field, FormContext } from '../fields';
import {
  ACTION_COMMON, ACTIONS, CHARACTER_FIELDS, CHARACTER_PLACEMENT_FIELDS, CHARACTER_SETTINGS_FIELDS, EVENT_FIELDS, HOTSPOT_FIELDS, ITEM_FIELDS,
  ITEM_PLACEMENT_FIELDS, ITEM_SETTINGS_FIELDS, LABEL_FIELDS, LABEL_MEDIA, LABEL_TEXT, LAYER_FIELDS, MEDIA_FIELDS, MOVE_FIELDS, OBJECTIVE_FIELDS,
  SCALE_AREA_FIELDS, SCENARIO_FIELDS, SCENARIO_SETTINGS_FIELDS, SCENE_FIELDS, SCENE_MUSIC_FIELDS, SHADOW_SPOT_FIELDS, LIGHT_FIELDS, SPAWN_FIELDS, VARIABLE_FIELDS,
} from '../schema';
import { openAnimation, openCharacter } from './characters';
import { openCharacterEvent } from './characterWorld';
import { revealAction, sortedActions } from './actions';
import { openMedia } from './library';
import { openItem } from './items';
import { openShopItem } from './shop';
import { openObjective } from './objectives';
import { openWord } from './glossary';
import { openMove } from './moves';
import { showAllVariables } from './variables';
import type { Selection } from './scene/model';
import { selectOnOpen } from './scene/sceneEditor';
import type { Tab } from './workspace';

/** Where an issue is, said for a person, and how to get there from the Publish page. */
export interface IssueWhere {
  /** From the outside in: the scene, the event, the action, the button... */
  trail: string[];
  /** The label of the field the issue is about, as the form shows it. */
  field?: string;
  /** The address to open, and what to do just before opening it so the right thing is shown. */
  go?: { hash: string; prepare(): void };
}

// --------------------------------------------------------------- revealing

/**
 * What to show once the next page is drawn: a panel to open, an element to scroll to and light up,
 * and the field in it to focus. Panels close when the address changes, so they are opened after.
 */
interface Reveal {
  open?: () => void;
  selector: string;
  field?: string;
}
let pending: Reveal | null = null;

/** Called by the workspace after it draws a page or a scene: carries out a pending reveal, if any. */
export function flushReveal() {
  const reveal = pending;
  pending = null;
  if (!reveal) return;
  setTimeout(() => {
    reveal.open?.();
    // The scene editor and panels draw in the next frames; look for a little while.
    let tries = 0;
    const look = () => {
      const target = lastMatch(reveal.selector);
      if (!target) {
        if (++tries < 30) requestAnimationFrame(look);
        return;
      }
      const field = reveal.field ? target.querySelector<HTMLElement>(`[data-field="${CSS.escape(reveal.field)}"]`) : null;
      const shown = field ?? target;
      shown.scrollIntoView({ block: 'center', behavior: 'smooth' });
      shown.classList.remove('flash');
      void shown.offsetWidth; // so lighting up the same element again replays the animation
      shown.classList.add('flash');
      setTimeout(() => shown.classList.remove('flash'), 2600);
      const input = field?.querySelector<HTMLElement>('input, select, textarea, button');
      input?.focus({ preventScroll: true });
    };
    look();
  }, 0);
}

/** The topmost match: a panel opened over the page is the one to look in. */
function lastMatch(selector: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(selector);
  return all.length ? all[all.length - 1]! : null;
}

// ----------------------------------------------------------------- naming

const humanize = (key: string) => key.replace(/_id$/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const labelIn = (fields: Field[], key: string | undefined) => (key ? fields.find((f) => f.key === key)?.label ?? humanize(key) : undefined);
const nth = (n: number) => n + 1;

const LAYOUT: Record<SceneList, { name: string; fields: Field[]; selection: (index: number) => Selection }> = {
  spawn_points: { name: 'Spawn point', fields: SPAWN_FIELDS, selection: (index) => ({ kind: 'spawn', index }) },
  items: { name: 'Item in the scene', fields: ITEM_PLACEMENT_FIELDS, selection: (index) => ({ kind: 'item', index }) },
  characters: { name: 'Character in the scene', fields: CHARACTER_PLACEMENT_FIELDS, selection: (index) => ({ kind: 'character', index }) },
  walkable_areas: { name: 'Walkable area', fields: [], selection: (index) => ({ kind: 'area', which: 'walkable_areas', index }) },
  blocked_areas: { name: 'Blocked area', fields: [], selection: (index) => ({ kind: 'area', which: 'blocked_areas', index }) },
  scale_areas: { name: 'Scale area', fields: SCALE_AREA_FIELDS, selection: (index) => ({ kind: 'scale', index }) },
  shadow_spots: { name: 'Shadow spot', fields: SHADOW_SPOT_FIELDS, selection: (index) => ({ kind: 'shadow', index }) },
  lights: { name: 'Light', fields: LIGHT_FIELDS, selection: (index) => ({ kind: 'light', index }) },
  background_media: { name: 'Background layer', fields: LAYER_FIELDS, selection: (index) => ({ kind: 'layer', which: 'background_media', index }) },
  foreground_media: { name: 'Foreground layer', fields: LAYER_FIELDS, selection: (index) => ({ kind: 'layer', which: 'foreground_media', index }) },
};

/** The scenario's own lists: which page they are on, what one is called, and its fields. */
const ENTRY: Partial<Record<ScenarioList, { tab: Tab; name: string; fields: Field[] }>> = {
  assets: { tab: 'media', name: 'Media', fields: MEDIA_FIELDS },
  items: { tab: 'items', name: 'Item', fields: [...ITEM_FIELDS, ...ITEM_SETTINGS_FIELDS] },
  characters: { tab: 'characters', name: 'Character', fields: [...CHARACTER_FIELDS, ...CHARACTER_SETTINGS_FIELDS] },
  global_variables: { tab: 'variables', name: 'Variable', fields: VARIABLE_FIELDS },
  objectives: { tab: 'objectives', name: 'Objective', fields: OBJECTIVE_FIELDS },
  glossary: { tab: 'glossary', name: 'Glossary word', fields: [] },
  scene_groups: { tab: 'scenes', name: 'Scene group', fields: [] },
  moves: { tab: 'moves', name: 'Move', fields: MOVE_FIELDS },
  shop_items: { tab: 'shop', name: 'Shop item', fields: [] },
};

/** Name the place an issue's path points at, and say how to open it in the editor. */
export function whereIs(ctx: FormContext, doc: unknown, issue: Pick<Issue, 'path'>): IssueWhere {
  const { store } = ctx;
  const place = locateIssue(doc, issue.path);
  const base = `#/s/${store.scenarioId}`;
  const trail: string[] = [];

  if (place.scene) {
    const row = place.scene.id != null ? store.byId('scenes', place.scene.id) : undefined;
    trail.push(`Scene “${row ? sceneLabel(row) : place.scene.name ?? `Scene ${place.scene.id ?? nth(place.scene.index)}`}”`);
    const sceneId = row?.id;
    if (place.event) return { ...eventPlace(ctx, place, trail), go: sceneId != null ? sceneGo(base, sceneId, place) : undefined };
    if (place.layout) {
      const look = LAYOUT[place.layout.list];
      trail.push(place.layout.index != null ? `${look.name} ${nth(place.layout.index)}` : `${look.name}s`);
      const field = labelIn(look.fields, place.field);
      return { trail, field, go: sceneId != null ? sceneGo(base, sceneId, place) : undefined };
    }
    return { trail, field: labelIn([...SCENE_FIELDS, ...SCENE_MUSIC_FIELDS], place.field), go: sceneId != null ? sceneGo(base, sceneId, place) : undefined };
  }

  if (place.entry) {
    const look = ENTRY[place.entry.list];
    const { id, name, index, animation } = place.entry;
    if (!look) {
      // Avatars and their pictures come with the platform, not from a page of this scenario.
      trail.push(place.entry.list === 'avatars' || place.entry.list === 'avatar_media_ids' ? 'Avatars' : humanize(place.entry.list));
      return { trail, field: place.field ? humanize(place.field) : undefined };
    }
    let label = name;
    if (place.entry.list === 'assets' && typeof id === 'number') label = mediaLabel(store.byId('media', id)) || name;
    if (place.entry.list === 'characters' && typeof id === 'number') label = String(store.byId('characters', id)?.name ?? name ?? '');
    trail.push(label ? `${look.name} “${label}”` : `${look.name} ${index != null ? nth(index) : ''}`.trim());
    // One of the character's own events, and what in it.
    if (place.entry.list === 'characters' && place.event) return { ...eventPlace(ctx, place, trail), go: entryGo(ctx, base, look.tab, place) };
    if (animation) trail.push(`Animation “${animation}”`);
    if (place.condition) trail.push(conditionName(place.condition));
    const field = labelIn(look.fields, place.field);
    return { trail, field, go: entryGo(ctx, base, look.tab, place) };
  }

  // The scenario's own settings: its start scene, its title...
  if (place.field) {
    const field = labelIn([...SCENARIO_FIELDS, ...SCENARIO_SETTINGS_FIELDS], place.field);
    trail.push('Settings');
    return { trail, field, go: { hash: `${base}/settings`, prepare: () => (pending = { selector: '.workspace-body', field: place.field }) } };
  }
  return { trail: ['The scenario'] };
}

const clipText = (v: string | number) => { const s = String(v); return s.length > 40 ? `${s.slice(0, 39)}…` : s; };

function conditionName(c: NonNullable<IssuePlace['condition']>): string {
  const which = c.of === 'complete_when' ? ' (ticked off when)' : c.of === 'show_when' ? ' (listed only when)' : '';
  return `Condition ${nth(c.index)}${which}`;
}

function eventPlace(ctx: FormContext, place: IssuePlace, trail: string[]): IssueWhere {
  const { store } = ctx;
  const ev = place.event!;
  const row = ev.id != null ? store.byId('events', ev.id) : undefined;
  const kind = ev.kind === 'character' ? CHARACTER_EVENT : EVENT_KINDS[ev.kind];
  const name = (row?.shortname as string | null | undefined) || ev.name;
  trail.push(name ? `${kind} “${name}”` : `${kind} ${ev.id ?? nth(ev.index)}`);

  if (place.action) {
    const action = place.action;
    const actionRow = action.id != null ? store.byId('actions', action.id) : undefined;
    const type = ((actionRow?.type as string | undefined) ?? action.type) as ActionType | undefined;
    const def = type ? ACTIONS[type] : undefined;
    // Numbered as the event's list numbers them.
    const step = actionRow && ev.id != null ? sortedActions(ctx, ev.id).findIndex((a) => a.id === actionRow.id) : -1;
    trail.push(`Action ${step >= 0 ? step + 1 : nth(action.index)}${def ? ` · ${def.label}` : ''}`);
    if (action.button) {
      trail.push(`Button “${action.button.text ?? nth(action.button.index)}”`);
      if (place.condition) trail.push(conditionName(place.condition));
      // The button's own action has fields of its type; this path does not say which, so look in all.
      const field = place.field ? labelIn(Object.values(ACTIONS).flatMap((a) => a.fields), place.field) : undefined;
      return { trail, field };
    }
    if (action.line) {
      trail.push(`Line “${clipText(action.line.text ?? action.line.id ?? nth(action.line.index))}”`);
      if (action.line.choice) trail.push(`Choice “${clipText(action.line.choice.text ?? nth(action.line.choice.index))}”`);
      if (place.condition) trail.push(conditionName(place.condition));
      return { trail };
    }
    if (place.condition) trail.push(conditionName(place.condition));
    return { trail, field: labelIn([...(def?.fields ?? []), ...ACTION_COMMON], place.field) };
  }
  if (place.label) {
    trail.push(`Label ${nth(place.label.index)}`);
    const key = place.field === 'media' ? 'media_id' : place.field;
    return { trail, field: labelIn([...LABEL_FIELDS, LABEL_TEXT, LABEL_MEDIA], key) };
  }
  if (place.condition) trail.push(conditionName(place.condition));
  return { trail, field: labelIn([...EVENT_FIELDS, ...HOTSPOT_FIELDS], place.field) };
}

// ----------------------------------------------------------------- going

/** Open the scene editor with the event (and its action), or the layout entry, selected. */
function sceneGo(base: string, sceneId: number, place: IssuePlace): IssueWhere['go'] {
  return {
    hash: `${base}/scene/${sceneId}`,
    prepare() {
      const field = place.field === 'media' ? 'media_id' : place.field;
      if (place.event?.id != null) {
        selectOnOpen(sceneId, { kind: 'event', id: place.event.id });
        if (place.action?.id != null) {
          openFold('event-actions');
          revealAction(place.action.id);
          const card = `.inspector [data-action="${place.action.id}"]`;
          // A button's fields are inside its row of the infobox's buttons; a conversation's line is on its map.
          const line = place.action.line?.id;
          pending = place.action.button
            ? { selector: `${card} .ctas .cta:nth-child(${place.action.button.index + 1})`, field }
            : line
              ? { selector: `${card} .talk-map [data-line="${CSS.escape(line)}"]` }
              : { selector: card, field: place.condition ? undefined : field };
          return;
        }
        if (place.label) {
          openFold('event-labels');
          pending = { selector: `.inspector .labels .card:nth-child(${place.label.index + 1})`, field };
          return;
        }
        if (place.condition) {
          openFold('event-conditions');
          pending = { selector: '.inspector [data-fold="event-conditions"]' };
          return;
        }
        openFold('event-settings');
        openFold('event-hotspot');
        pending = { selector: '.inspector .event-panel', field };
        return;
      }
      if (place.layout?.index != null) selectOnOpen(sceneId, LAYOUT[place.layout.list].selection(place.layout.index));
      else selectOnOpen(sceneId, { kind: 'scene' });
      pending = { selector: '.inspector', field };
    },
  };
}

/** Open a page of the scenario at the entry: the entry's own panel where it has one, its line or card otherwise. */
function entryGo(ctx: FormContext, base: string, tab: Tab, place: IssuePlace): IssueWhere['go'] {
  const entry = place.entry!;
  const { store } = ctx;
  const hash = tab === 'scenes' ? base : `${base}/${tab}`;
  const field = place.condition ? undefined : place.field;
  const id = entry.id;
  let reveal: Reveal = { selector: '.workspace-body', field };
  switch (entry.list) {
    case 'assets':
      if (typeof id === 'number' && store.byId('media', id)) reveal = { open: () => openMedia(ctx, id), selector: 'dialog[data-panel="media"]', field };
      break;
    case 'characters':
      if (typeof id === 'number' && store.byId('characters', id)) {
        const eventId = place.event?.kind === 'character' ? place.event.id : undefined;
        const actionId = place.action?.id;
        reveal = eventId != null && store.byId('events', eventId)
          ? {
              open: () => {
                if (actionId != null) revealAction(actionId);
                openCharacter(ctx, id);
                openCharacterEvent(ctx, id, eventId);
              },
              selector: actionId != null ? `dialog[data-panel="character-event"] [data-action="${actionId}"]` : 'dialog[data-panel="character-event"]',
              field,
            }
          : entry.animation
            ? { open: () => { openCharacter(ctx, id); openAnimation(ctx, id, entry.animation!); }, selector: 'dialog[data-panel]', field }
            : { open: () => openCharacter(ctx, id), selector: 'dialog[data-panel="character"]', field };
      }
      break;
    case 'items':
      if (typeof id === 'number' && store.byId('items', id)) reveal = { open: () => openItem(ctx, id), selector: 'dialog[data-panel="item"]', field };
      break;
    case 'global_variables':
      if (entry.name) {
        const name = entry.name;
        // The page's filter could hide the line: show them all when going there.
        reveal = { open: showAllVariables, selector: `[data-variable="${CSS.escape(name)}"]`, field };
        return { hash, prepare: () => { showAllVariables(); pending = reveal; } };
      }
      break;
    case 'objectives': {
      // The document numbers objectives; the editor keeps them by id, in the same order.
      const objective = entry.index != null ? ((store.settings.objectives as Array<{ id: string | number }> | undefined) ?? [])[entry.index] : undefined;
      // An objective's own fields are its text and the bonus tick; anything else is in its
      // conditions, which are lists, not fields: light up the section that holds them.
      const inConditions = place.field != null && place.field !== 'text' && place.field !== 'optional';
      if (objective) reveal = { open: () => openObjective(ctx, objective.id), selector: inConditions ? 'dialog[data-panel="objective"] [data-section="conditions"]' : 'dialog[data-panel="objective"] [data-section="objective"]', field: inConditions ? undefined : field };
      break;
    }
    case 'glossary': {
      const word = ((store.settings.glossary as Array<{ id: string | number }> | undefined) ?? []).find((e) => id != null && String(e.id) === String(id));
      if (word) reveal = { open: () => openWord(ctx, word.id), selector: 'dialog[data-panel="word"]', field };
      break;
    }
    case 'scene_groups':
      reveal = { selector: id != null ? `[data-group="${CSS.escape(String(id))}"]` : '[data-card="scene-groups"]', field };
      break;
    case 'moves': {
      // By its animation's name first: the document's list of moves may not be in the editor's order.
      const moves = (store.settings.moves as Array<{ animation?: string }> | undefined) ?? [];
      const named = entry.name ? moves.findIndex((m) => m.animation === entry.name) : -1;
      const index = named >= 0 ? named : entry.index != null && entry.index < moves.length ? entry.index : -1;
      if (index >= 0) reveal = { open: () => openMove(ctx, index), selector: 'dialog[data-panel="move"]', field };
      else if (entry.name) reveal = { selector: `[data-move="${CSS.escape(entry.name)}"]`, field };
      break;
    }
    case 'shop_items':
      if (typeof id === 'number' && store.byId('shop_items', id)) reveal = { open: () => openShopItem(ctx, id), selector: 'dialog[data-panel="shop"]', field };
      break;
    default:
  }
  return { hash, prepare: () => (pending = reveal) };
}

// ---------------------------------------------------------------- drawing

/** One issue on the Publish page: what is wrong, where, a way there, and the JSON path for those who read it. */
export function issueItem(ctx: FormContext, doc: unknown, issue: Issue): HTMLElement {
  const where = whereIs(ctx, doc, issue);
  const crumbs = [...where.trail, ...(where.field ? [where.field] : [])];
  return h(
    'li',
    { class: `issue ${issue.level}`, 'data-path': issue.path },
    h('span', { class: 'issue-level' }, issue.level === 'error' ? '⛔ Error' : '⚠️ Warning'),
    h(
      'div',
      { class: 'issue-body' },
      h('div', { class: 'issue-message' }, issue.message.endsWith('.') ? issue.message : `${issue.message}.`),
      h('div', { class: 'issue-where' }, ...crumbs.flatMap((c, i) => [i ? h('span', { class: 'sep', 'aria-hidden': 'true' }, '›') : null, h('span', { class: i === crumbs.length - 1 && where.field ? 'crumb field' : 'crumb' }, c)])),
      issue.path ? h('code', { class: 'issue-path', title: 'Where this is in the scenario’s JSON' }, issue.path) : null,
    ),
    where.go
      ? h('a', { class: 'button issue-go', href: where.go.hash, onclick: () => where.go!.prepare() }, 'Go there →')
      : null,
  );
}
