import { BENCH_SHAPES, BENCH_TOOLS, vesselName } from '@qbl/shared';
import { emojiIcon } from '../../icons';
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
  | 'spawn' | 'item' | 'character' | 'walkable_areas' | 'blocked_areas' | 'scale_areas' | 'shadow_spots' | 'lights' | 'flows'
  | 'bench-vessel' | 'bench-supply' | 'bench-dropper' | 'bench-burner' | 'bench-stirrer' | 'bench-sink';

/** An icon and a colour for each kind of thing a scene holds. */
const LOOK: Record<string, readonly [icon: string, tone: string]> = {
  'Background layers': ['🏞️', '#8e5bd6'], 'Foreground layers': ['🌿', '#8e5bd6'],
  'Start events': ['▶️', '#c77b12'], 'Hotspots': ['🎯', '#2f6fed'], 'Indirect events': ['🔁', '#c77b12'], 'End events': ['⏹️', '#c77b12'],
  'Spawn points': ['🚩', '#d9a400'], 'Items here': ['🎒', '#d6457a'], 'Characters here': ['🧑‍🚀', '#d6457a'],
  'Containers': ['🧪', '#0f7a9d'], 'Tools': ['🔥', '#0f7a9d'],
  'Walkable areas': ['🟩', '#3b8f4a'], 'Scale areas': ['📐', '#d9a400'], 'Shadow spots': ['🌑', '#5b6b8c'], 'Blocked areas': ['🟥', '#c0392b'],
};

/** Sections the author has folded away. Kept outside the view so a redraw does not open them again. */
const folded = new Set<string>();

/** A to Z by what is shown, numbers in number order ("Area 2" before "Area 10"). */
const byName = (a: { text: string }, b: { text: string }) => a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: 'base' });

/** Everything in the scene as a list: the way to find and select things that are hard to click. */
export function outline(model: SceneModel, host: OutlineHost): HTMLElement {
  const { store } = model;
  const selected = host.selection();
  interface Entry { text: string; node: HTMLElement }
  const entry = (selection: Selection, text: string, note?: string): Entry => ({
    text,
    node: h('li', null, h('button', { type: 'button', class: `outline-item${sameSelection(selection, selected) ? ' selected' : ''}`, onclick: () => host.select(selection) }, h('span', null, text), note ? h('small', null, note) : null)),
  });
  /**
   * One kind of thing in the scene, as a list that folds away. Lists are shown A to Z so a name
   * is easy to find; layers are the exception, because their order is the order they are drawn in.
   */
  const section = (title: string, add: Addable | null, items: Entry[], sort = true) => {
    const list = sort ? [...items].sort(byName) : items;
    const node = h(
      'details',
      { class: 'outline-section', open: !folded.has(title), 'data-section': title },
      h(
        'summary',
        { style: `--tone:${LOOK[title]?.[1] ?? ''}` },
        h('span', { class: 'outline-title' }, LOOK[title] ? emojiIcon(LOOK[title][0]) : null, title, h('small', null, String(items.length))),
        add
          ? h('button', {
              type: 'button', class: 'icon', title: `Add: ${title.toLowerCase()}`,
              onclick: (e: Event) => {
                e.preventDefault(); // the button is inside the heading that folds the list
                folded.delete(title);
                host.add(add);
              },
            }, '+')
          : null,
      ),
      list.length ? h('ul', null, ...list.map((i) => i.node)) : null,
    );
    node.addEventListener('toggle', () => (node.open ? folded.delete(title) : folded.add(title)));
    return node;
  };
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
    h('ul', null, entry({ kind: 'scene' }, '⚙️ Scene settings').node),
    section('Background layers', 'background_media', layers('background_media'), false),
    section('Foreground layers', 'foreground_media', layers('foreground_media'), false),
    section('Start events', 'start', events('start')),
    section('Hotspots', 'hotspot-click', events('hotspot')),
    section('Indirect events', 'indirect', events('indirect')),
    section('End events', 'end', events('end')),
    section('Spawn points', 'spawn', model.layout('spawn_points').map((p, index) => entry({ kind: 'spawn', index }, String(p.name ?? '')))),
    section('Items here', 'item', model.layout('items').map((p, index) => entry({ kind: 'item', index }, name('items', p.item_id)))),
    section('Characters here', 'character', model.layout('characters').map((p, index) => entry({ kind: 'character', index }, name('characters', p.character_id)))),
    ...benchSections(model, entry, section),
    section('Walkable areas', 'walkable_areas', model.layout<Point[]>('walkable_areas').map((a, index) => entry({ kind: 'area', which: 'walkable_areas', index }, `Area ${index + 1}`, `${a.length} corners`))),
    section('Scale areas', 'scale_areas', model.layout('scale_areas').map((a, index) => entry({ kind: 'scale', index }, String(a.name || `Scale area ${index + 1}`), `${a.scale_top}% → ${a.scale_bottom}%`))),
    section('Shadow spots', 'shadow_spots', model.layout('shadow_spots').map((a, index) => entry({ kind: 'shadow', index }, String(a.name || `Shadow ${index + 1}`), `${a.strength ?? 60}%`))),
    section('Lights', 'lights', model.layout('lights').map((a, index) => entry({ kind: 'light', index }, String(a.name || `Light ${index + 1}`), String(a.kind ?? 'flicker')))),
    section('Flowing water', 'flows', model.layout('flows').map((a, index) => entry({ kind: 'flow', index }, String(a.name || `Water ${index + 1}`), String(a.kind ?? 'river')))),
    section('Blocked areas', 'blocked_areas', model.layout<Point[]>('blocked_areas').map((a, index) => entry({ kind: 'area', which: 'blocked_areas', index }, `Area ${index + 1}`, `${a.length} corners`))),
  );
}

/** The close-up bench's things, when the scene has one. */
function benchSections(
  model: SceneModel,
  entry: (selection: Selection, text: string, note?: string) => { text: string; node: HTMLElement },
  section: (title: string, add: Addable | null, items: Array<{ text: string; node: HTMLElement }>, sort?: boolean) => HTMLElement,
): HTMLElement[] {
  const bench = model.bench();
  if (!bench) return [];
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return [
    h('ul', null, entry({ kind: 'bench' }, `🧪 Close-up bench${bench.enabled ? '' : ' (off)'}`, count(bench.reactions?.length ?? 0, 'reaction')).node),
    section('Containers', 'bench-vessel', (bench.vessels ?? []).map((v, index) => entry({ kind: 'bench-vessel', index }, vesselName(v), `${BENCH_SHAPES[v.shape ?? 'beaker']?.label ?? v.shape}${v.supply ? ' · stock' : v.fixed ? ' · stays put' : ''}`))),
    section('Tools', 'bench-burner', (bench.tools ?? []).map((t, index) => entry({ kind: 'bench-tool', index }, t.name || BENCH_TOOLS[t.kind]?.label || t.kind, t.kind === 'burner' ? `under ${t.vessel_id ?? 'nothing'}` : ''))),
  ];
}
