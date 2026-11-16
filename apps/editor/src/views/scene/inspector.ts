import { mediaLabel, mediaUrl, sceneLabel } from '../../describe';
import { confirmDelete, h } from '../../dom';
import { form, withValue, type Field, type FormContext } from '../../fields';
import { CHARACTER_PLACEMENT_FIELDS, ITEM_PLACEMENT_FIELDS, LAYER_FIELDS, SCALE_AREA_FIELDS, SCENE_FIELDS, SPAWN_FIELDS } from '../../schema';
import { eventPanel } from '../eventPanel';
import type { Bag, LayerList, LayoutList, Point, SceneModel, Selection } from './model';

export interface InspectorHost {
  select(selection: Selection): void;
  /** The pixel size of an image, when it has loaded. */
  natural(url: string): Point | null;
  /** Leave the scene editor after the scene was deleted. */
  closed(): void;
}

/**
 * The form for whatever is selected in the scene. `refresh` collects functions that update
 * text derived from values (action summaries) when a value changes without a rebuild.
 */
export function inspector(model: SceneModel, selection: Selection, host: InspectorHost, refresh: Array<() => void>): HTMLElement {
  const ctx: FormContext = { store: model.store, sceneId: model.sceneId };
  switch (selection.kind) {
    case 'scene':
      return scenePanel(model, ctx, host);
    case 'layer':
      return layerPanel(model, ctx, selection.which, selection.index, host);
    case 'event': {
      const event = model.store.byId('events', selection.id);
      return event ? eventPanel(ctx, event, refresh, () => host.select({ kind: 'scene' })) : gone();
    }
    case 'spawn':
      return listPanel(model, ctx, 'spawn_points', selection.index, 'Spawn point', 'Where players appear when they arrive. Jump actions name the spawn point to arrive at.', SPAWN_FIELDS, host);
    case 'item':
      return listPanel(model, ctx, 'items', selection.index, 'Item in this scene', 'An item from the scenario’s Items list, placed here. Its position is where it stands: the middle of its bottom edge.', ITEM_PLACEMENT_FIELDS, host);
    case 'character':
      return listPanel(model, ctx, 'characters', selection.index, 'Character in this scene', 'A character from the scenario’s Characters list, placed here. Clicking it can run an indirect event.', CHARACTER_PLACEMENT_FIELDS, host);
    case 'scale':
      return listPanel(model, ctx, 'scale_areas', selection.index, 'Scale area',
        'A box in which avatars, what they wear or ride, items and characters are drawn smaller or larger depending on how far up the box they stand. Use it for depth: a path or corridor leading away from the viewer. It is separate from walkable areas, so it also sizes things placed where nobody can walk. Click the box again to drag it; drag its corners to resize it. Where boxes overlap, the first in the list applies.',
        SCALE_AREA_FIELDS, host);
    case 'area':
      return areaPanel(model, selection.which, selection.index, host);
  }
}

const gone = () => h('div', { class: 'panel' }, h('p', { class: 'muted' }, 'This no longer exists.'));

function scenePanel(model: SceneModel, ctx: FormContext, host: InspectorHost): HTMLElement {
  const { store } = model;
  const scene = model.row;
  const isStart = store.scenario.start_scene_id === scene.id;
  const commit = (key: string, value: unknown) => void store.patch('scenes', scene.id, { [key]: value });

  // Offer to size the scene to its first background, which is what makes a wide image scroll.
  const first = model.layers('background_media')[0];
  const url = first ? mediaUrl(store, store.byId('media', first.media_id as number | null)) : null;
  const image = url ? host.natural(url) : null;
  const mismatch = image && (image.x !== Number(scene.width) || image.y !== Number(scene.height));

  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, 'Scene'), isStart ? h('span', { class: 'badge' }, 'Start scene') : null),
    form(SCENE_FIELDS, scene, commit, ctx),
    mismatch
      ? h(
          'p',
          { class: 'notice' },
          `The first background image is ${image.x} × ${image.y} px. `,
          h('button', { type: 'button', class: 'link', onclick: () => void model.resize(model.size(host.natural), image.x, image.y) }, 'Make the scene that size'),
          ' Everything in the scene is moved to match.',
        )
      : null,
    layerList(model, 'background_media', 'Background layers', 'Drawn behind the avatars, first at the back.', host),
    layerList(model, 'foreground_media', 'Foreground layers', 'Drawn in front of the avatars.', host),
    h(
      'div',
      { class: 'row-actions' },
      isStart ? null : h('button', { type: 'button', onclick: () => void store.patchScenario({ start_scene_id: scene.id }, true) }, 'Make this the start scene'),
      h('button', {
        type: 'button', class: 'danger', disabled: store.rows('scenes').length <= 1,
        onclick: async () => {
          if (!confirmDelete(`the scene “${sceneLabel(scene)}” and everything in it`)) return;
          host.closed();
          await store.remove('scenes', scene.id);
        },
      }, 'Delete scene'),
    ),
  );
}

function layerList(model: SceneModel, which: LayerList, title: string, about: string, host: InspectorHost): HTMLElement {
  const layers = model.layers(which);
  const add = async () => {
    await model.setLayers(which, [...layers, {}], true);
    host.select({ kind: 'layer', which, index: layers.length });
  };
  return h(
    'section',
    null,
    h('div', { class: 'sub-head' }, h('span', null, title), h('button', { type: 'button', class: 'link', onclick: add }, '+ Add layer')),
    layers.length
      ? h('ul', { class: 'pick-list' }, ...layers.map((layer, index) =>
          h('li', null, h('button', { type: 'button', class: 'link', onclick: () => host.select({ kind: 'layer', which, index }) },
            `${index + 1}. ${layer.media_id ? mediaLabel(model.store.byId('media', layer.media_id as number)) : '(no image yet)'}${layer.tile ? ' · repeated' : ''}`))))
      : h('p', { class: 'muted' }, about),
  );
}

function layerPanel(model: SceneModel, ctx: FormContext, which: LayerList, index: number, host: InspectorHost): HTMLElement {
  const layers = () => model.layers(which);
  const layer = layers()[index];
  if (!layer) return gone();
  const write = (next: Bag[], structural: boolean) => model.setLayers(which, next, structural);
  const commit = (key: string, value: unknown, field: Field) =>
    void write(layers().map((l, i) => (i === index ? withValue(l, key, value, field) : l)), key === 'media_id');
  const move = async (by: number) => {
    const next = [...layers()];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    await write(next, true);
    host.select({ kind: 'layer', which, index: index + by });
  };
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, which === 'background_media' ? 'Background layer' : 'Foreground layer')),
    h('p', { class: 'muted' }, 'An image the size of the scene by default. Make the scene larger than the screen and it scrolls as players walk; repeat an image and give it a drift for moving clouds or water; lower the parallax for distant scenery.'),
    form(LAYER_FIELDS, layer, commit, ctx),
    h(
      'div',
      { class: 'row-actions' },
      h('button', { type: 'button', disabled: index === 0, onclick: () => void move(-1) }, '↑ Further back'),
      h('button', { type: 'button', disabled: index === layers().length - 1, onclick: () => void move(1) }, '↓ Further forward'),
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete('this layer')) return;
          host.select({ kind: 'scene' });
          await write(layers().filter((_, i) => i !== index), true);
        },
      }, 'Delete layer'),
    ),
  );
}

/** Spawn points and placed items and characters: entries of a JSON list in the scene's layout. */
function listPanel(model: SceneModel, ctx: FormContext, key: LayoutList, index: number, title: string, about: string, fields: Field[], host: InspectorHost): HTMLElement {
  const entry = model.layout(key)[index];
  if (!entry) return gone();
  const commit = (name: string, value: unknown, field: Field) =>
    void model.setLayout(key, model.layout(key).map((e, i) => (i === index ? withValue(e, name, value, field) : e)), field.kind === 'item' || field.kind === 'character');
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, title)),
    h('p', { class: 'muted' }, about),
    form(fields, entry, commit, ctx),
    h(
      'div',
      { class: 'row-actions' },
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete(`this ${title.toLowerCase()}`)) return;
          host.select({ kind: 'scene' });
          await model.setLayout(key, model.layout(key).filter((_, i) => i !== index), true);
        },
      }, 'Delete'),
    ),
  );
}

function areaPanel(model: SceneModel, which: 'walkable_areas' | 'blocked_areas', index: number, host: InspectorHost): HTMLElement {
  const area = model.layout<Point[]>(which)[index];
  if (!area) return gone();
  const walkable = which === 'walkable_areas';
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, walkable ? 'Walkable area' : 'Blocked area')),
    h('p', { class: 'muted' }, walkable
      ? 'Avatars can only stand inside walkable areas. With none, the whole scene is walkable.'
      : 'A part of a walkable area that avatars cannot enter: a rock, a table, a pond.'),
    h('p', null, `${area.length} corners. Drag a corner to move it. Drag the small dot on a side to add a corner. Double-click a corner to remove it.`),
    h(
      'div',
      { class: 'row-actions' },
      h('button', {
        type: 'button', class: 'danger',
        onclick: async () => {
          if (!confirmDelete('this area')) return;
          host.select({ kind: 'scene' });
          await model.setLayout(which, model.layout(which).filter((_, i) => i !== index), true);
        },
      }, 'Delete area'),
    ),
  );
}
