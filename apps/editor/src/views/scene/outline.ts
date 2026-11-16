import { EVENT_KINDS, eventLabel, mediaLabel } from '../../describe';
import { h } from '../../dom';
import { sameSelection, type Point, type SceneModel, type Selection } from './model';

export interface OutlineHost {
  selection(): Selection;
  select(selection: Selection): void;
  add(what: Addable): void;
}

export type Addable =
  | 'background_media' | 'foreground_media'
  | 'start' | 'end' | 'indirect' | 'hotspot-click' | 'hotspot-walk'
  | 'edge-left' | 'edge-right' | 'edge-top' | 'edge-bottom'
  | 'spawn' | 'item' | 'character' | 'walkable_areas' | 'blocked_areas' | 'scale_areas';

/** An icon and a colour for each kind of thing a scene holds. */
const LOOK: Record<string, readonly [icon: string, tone: string]> = {
  'Background layers': ['🏞️', '#8e5bd6'], 'Foreground layers': ['🌿', '#8e5bd6'],
  'Start events': ['▶️', '#c77b12'], 'Hotspots': ['🎯', '#2f6fed'], 'Indirect events': ['🔁', '#c77b12'], 'End events': ['⏹️', '#c77b12'],
  'Spawn points': ['🚩', '#d9a400'], 'Items here': ['🎒', '#d6457a'], 'Characters here': ['🧑‍🚀', '#d6457a'],
  'Walkable areas': ['🟩', '#3b8f4a'], 'Scale areas': ['📐', '#d9a400'], 'Blocked areas': ['🟥', '#c0392b'],
};

/** Everything in the scene as a list: the way to find and select things that are hard to click. */
export function outline(model: SceneModel, host: OutlineHost): HTMLElement {
  const { store } = model;
  const selected = host.selection();
  const entry = (selection: Selection, text: string, note?: string) =>
    h('li', null, h('button', { type: 'button', class: `outline-item${sameSelection(selection, selected) ? ' selected' : ''}`, onclick: () => host.select(selection) }, h('span', null, text), note ? h('small', null, note) : null));
  const section = (title: string, add: Addable | null, items: HTMLElement[]) =>
    h(
      'section',
      null,
      h('h3', { style: `--tone:${LOOK[title]?.[1] ?? ''}` }, h('span', null, h('span', { class: 'icon-label', 'aria-hidden': 'true' }, LOOK[title]?.[0] ?? ''), title), add ? h('button', { type: 'button', class: 'icon', title: `Add: ${title.toLowerCase()}`, onclick: () => host.add(add) }, '+') : null),
      items.length ? h('ul', null, ...items) : null,
    );
  const layers = (which: 'background_media' | 'foreground_media') =>
    model.layers(which).map((layer, index) => entry({ kind: 'layer', which, index }, layer.media_id ? mediaLabel(store.byId('media', layer.media_id as number)) : '(no image yet)'));
  const events = (kind: keyof typeof EVENT_KINDS) =>
    model.events(kind).map((event) => {
      const actions = store.where('actions', 'event_id', event.id).length;
      const how = kind === 'hotspot' ? (event.activate_by_trigger ? 'click · ' : 'walk-in · ') : '';
      return entry({ kind: 'event', id: event.id }, eventLabel(event), `${how}${actions} action${actions === 1 ? '' : 's'}`);
    });
  const name = (table: 'items' | 'characters', id: unknown) => String(store.byId(table, id as number | null)?.name ?? '(missing)');

  return h(
    'nav',
    { class: 'outline', 'aria-label': 'Scene contents' },
    h('ul', null, entry({ kind: 'scene' }, '⚙️ Scene settings')),
    section('Background layers', 'background_media', layers('background_media')),
    section('Foreground layers', 'foreground_media', layers('foreground_media')),
    section('Start events', 'start', events('start')),
    section('Hotspots', 'hotspot-click', events('hotspot')),
    section('Indirect events', 'indirect', events('indirect')),
    section('End events', 'end', events('end')),
    section('Spawn points', 'spawn', model.layout('spawn_points').map((p, index) => entry({ kind: 'spawn', index }, String(p.name ?? '')))),
    section('Items here', 'item', model.layout('items').map((p, index) => entry({ kind: 'item', index }, name('items', p.item_id)))),
    section('Characters here', 'character', model.layout('characters').map((p, index) => entry({ kind: 'character', index }, name('characters', p.character_id)))),
    section('Walkable areas', 'walkable_areas', model.layout<Point[]>('walkable_areas').map((a, index) => entry({ kind: 'area', which: 'walkable_areas', index }, `Area ${index + 1}`, `${a.length} corners`))),
    section('Scale areas', 'scale_areas', model.layout('scale_areas').map((a, index) => entry({ kind: 'scale', index }, String(a.name || `Scale area ${index + 1}`), `${a.scale_top}% → ${a.scale_bottom}%`))),
    section('Blocked areas', 'blocked_areas', model.layout<Point[]>('blocked_areas').map((a, index) => entry({ kind: 'area', which: 'blocked_areas', index }, `Area ${index + 1}`, `${a.length} corners`))),
  );
}
