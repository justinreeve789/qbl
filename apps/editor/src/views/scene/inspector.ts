import { mainLayerIndex, type Condition, type SceneLight, type SceneWaterLight } from '@qbl/shared';
import { mediaLabel, mediaUrl, params, sceneLabel } from '../../describe';
import { confirmDelete, h, help, toast } from '../../dom';
import { form, withValue, type Field, type FormContext, type SpotRequest } from '../../fields';
import { ATMOSPHERE_FIELDS, CHARACTER_PLACEMENT_FIELDS, FLOW_FIELDS, ITEM_PLACEMENT_FIELDS, LAYER_FIELDS, LIGHT_FIELDS, SCALE_AREA_FIELDS, WATER_LIGHT_FIELDS, SCENE_FIELDS, SCENE_MUSIC_FIELDS, SHADOW_SPOT_FIELDS, SKY_FIELDS, SPAWN_FIELDS, WEATHER_FIELDS } from '../../schema';
import { duplicateScene } from '../../clipboard';
import { inlineConditions, type ConditionValue } from '../conditions';
import { eventPanel } from '../eventPanel';
import { benchSettingsPanel, benchToolPanel, benchVesselPanel } from './benchPanels';
import { buildingPanel } from './buildingPanel';
import type { Bag, LayerList, LayoutList, Point, SceneModel, Selection } from './model';

export interface InspectorHost {
  select(selection: Selection): void;
  /** The pixel size of an image, when it has loaded. */
  natural(url: string): Point | null;
  /** Leave the scene editor after the scene was deleted. */
  closed(): void;
  /** Open another scene in the scene editor (a duplicate just made). */
  openScene(sceneId: number): void;
  /** Choose a spot by clicking the canvas. Returns a function that stops choosing. */
  pickSpot(request: SpotRequest): () => void;
}

/**
 * The form for whatever is selected in the scene. `refresh` collects functions that update
 * text derived from values (action summaries) when a value changes without a rebuild.
 */
export function inspector(model: SceneModel, selection: Selection, host: InspectorHost, refresh: Array<() => void>): HTMLElement {
  const ctx: FormContext = { store: model.store, sceneId: model.sceneId, pickSpot: (request) => host.pickSpot(request) };
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
    case 'shadow':
      return listPanel(model, ctx, 'shadow_spots', selection.index, 'Shadow spot',
        'A patch of shade on the floor. A figure walking through it darkens as if shade were cast over it: most at the centre of the spot, fading to nothing at its edge. Drag the spot to move it and its handle to resize it.',
        SHADOW_SPOT_FIELDS, host);
    case 'light':
      return listPanel(model, ctx, 'lights', selection.index, 'Light',
        'A soft glow drawn over the scene: put it on a lantern, a campfire, a lit window or a beacon in the picture. It flickers, burns with embers rising, breathes slowly, blinks or twinkles. With a living sky it shines fully at night and only a little by day. Give it conditions to switch it on and off as the story goes: it fades in and out as they start or stop holding. Drag it to move it and its handle to change how far it reaches.',
        LIGHT_FIELDS, host, lightConditions(model, ctx, selection.index));
    case 'flow':
      return listPanel(model, ctx, 'flows', selection.index, 'Flowing water',
        'Water that moves: a river or stream carried along, a waterfall pouring down, the sea or a lake lapping. Behind the picture, it shows wherever the scene’s last background layer is see-through: cut the water out of the picture and it flows between the painted banks. Over the picture, only ripples and glints move. Drag the box to move it and its corners to resize it.',
        FLOW_FIELDS, host);
    case 'water_light':
      return listPanel(model, ctx, 'water_lights', selection.index, 'Underwater light',
        'Light under water, drawn live by the game. Rippling light is the bright web that dances on the floor of a pool or the sea bed: put its box on the floor, and it lies behind everyone standing there. Shafts are beams of light slanting down from the surface, in front of everyone. It fades out softly at the edges of its box (or in an oval). Give it conditions to switch it on and off as the story goes. Drag the box to move it and its corners to resize it; “Test this scene” shows it moving.',
        WATER_LIGHT_FIELDS, host, layoutConditions(model, ctx, 'water_lights', selection.index));
    case 'area':
      return areaPanel(model, selection.which, selection.index, host);
    case 'bench':
      return benchSettingsPanel(model, ctx, host);
    case 'bench-vessel':
      return benchVesselPanel(model, ctx, selection.index, host);
    case 'bench-tool':
      return benchToolPanel(model, ctx, selection.index, host);
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
    form(SCENE_MUSIC_FIELDS, params(scene), (key, value, field) => void store.patch('scenes', scene.id, { params: withValue(params(store.byId('scenes', scene.id)!), key, value, field) }, key === 'music_media_id'), ctx),
    livingPanel(model, ctx),
    buildingPanel(model, ctx),
    mismatch
      ? h(
          'p',
          { class: 'notice' },
          `The first background image is ${image.x} × ${image.y} px. `,
          h('button', { type: 'button', class: 'link', onclick: () => void model.resize(model.size(host.natural), image.x, image.y) }, 'Make the scene that size'),
          ' Everything in the scene is moved to match.',
        )
      : null,
    benchSection(model, host),
    layerList(model, 'background_media', 'Background layers', 'Drawn behind the avatars, first at the back.', host),
    layerList(model, 'foreground_media', 'Foreground layers', 'Drawn in front of the avatars.', host),
    h(
      'div',
      { class: 'row-actions' },
      isStart ? null : h('button', { type: 'button', onclick: () => void store.patchScenario({ start_scene_id: scene.id }, true) }, 'Make this the start scene'),
      h('button', {
        type: 'button', 'data-duplicate-scene': '', title: 'Make a copy of this scene and everything in it',
        onclick: async () => {
          const id = await duplicateScene(store, scene.id);
          if (id != null) toast(`Made “${sceneLabel(store.byId('scenes', id))}”, a copy of this scene.`, 'info', { label: 'Open it', run: () => host.openScene(id) });
        },
      }, 'Duplicate scene'),
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

/**
 * The living sky and what is in the air: kept in the scene's params as `sky` (an object) and
 * `atmosphere` (a list, edited here as one kind). Lights are placed on the canvas.
 */
function livingPanel(model: SceneModel, ctx: FormContext): HTMLElement {
  const { store } = model;
  const current = () => params(store.byId('scenes', model.sceneId)!);
  const save = (next: Bag, structural = false) => void store.patch('scenes', model.sceneId, { params: next }, structural);
  const sky = (current().sky as Bag | undefined) ?? {};
  const air = ((current().atmosphere as Bag[] | undefined) ?? [])[0] ?? {};
  const setSky = (key: string, value: unknown, field: Field) => {
    const next = withValue({ ...((current().sky as Bag | undefined) ?? {}) }, key, value, field);
    // A sky needs a time of day; without one there is no sky.
    save(withValue(current(), 'sky', next.time ? next : null), key === 'time');
  };
  const weather = (current().weather as Bag | undefined) ?? {};
  const setWeather = (key: string, value: unknown, field: Field) => {
    const next = withValue({ ...((current().weather as Bag | undefined) ?? {}) }, key, value, field);
    // Weather needs a kind; without one there is none.
    save(withValue(current(), 'weather', next.kind ? next : null), key === 'kind');
  };
  const story = { story: current().story === true };
  const setStory = (_key: string, value: unknown, field: Field) => save(withValue(current(), 'story', value === true ? true : null, field), true);
  // Stored as true or false. Before the setting, a scene with a travel action was one: it shows ticked.
  const own = current().launcher;
  const events = new Set(store.rows('events').filter((e) => e.scene_id === model.sceneId).map((e) => e.id));
  const travels = store.rows('actions').some((a) => a.type === 'travel' && events.has(a.event_id as number));
  const launcher = { launcher: own != null ? own === true : travels };
  const setLauncher = (_key: string, value: unknown) => save({ ...current(), launcher: value === true }, true);
  const setAir = (key: string, value: unknown, field: Field) => {
    const first = withValue({ ...((((current().atmosphere as Bag[] | undefined) ?? [])[0]) ?? {}) }, key, value, field);
    const rest = ((current().atmosphere as Bag[] | undefined) ?? []).slice(1);
    const list = first.kind ? [first, ...rest] : rest;
    save(withValue(current(), 'atmosphere', list.length ? list : null), key === 'kind');
  };
  return h(
    'section',
    null,
    h('div', { class: 'sub-head' }, h('span', null, '🌅 Living sky', help('A sky drawn behind every background, for the time of day: the sun or the moon and stars, and it can change slowly while players are here, as in a sunset. The backgrounds must be see-through where the sky shows. Mark cloud and far-view layers as part of the sky and they take on its light.'))),
    form(SKY_FIELDS, sky, setSky, ctx),
    h('div', { class: 'sub-head' }, h('span', null, '🍃 In the air', help('Fireflies, falling leaves, snow, rain, dust in the light or bubbles, drawn over the scene wherever players look. Nothing moves for players whose system asks for reduced motion.'))),
    form(ATMOSPHERE_FIELDS, air, setAir, ctx),
    h('div', { class: 'sub-head' }, h('span', null, '🌧️ Weather', help('Rain splashing on the floor, snow, a storm with lightning and thunder, a blizzard, fog drifting by: drawn over the scene with its own sound. A Weather action changes it while players are here.'))),
    form(WEATHER_FIELDS, weather, setWeather, ctx),
    h('div', { class: 'sub-head' }, h('span', null, '📖 Story', help('A story scene plays by itself, like a page of a picture book: put what happens in its start events (characters walk on, talk, the rain starts) and end them with a jump to the next scene. Avatars are hidden, players do not walk, the view follows whoever acts, and a bar offers to skip ahead or watch it again. Characters can wait off stage: place them beyond the left or right edge and walk them on.'))),
    form([{ key: 'story', label: 'This scene plays by itself (a story)', kind: 'bool', wide: true }], story, setStory, ctx),
    h('div', { class: 'sub-head' }, h('span', null, '🚀 Scenario launcher', help('When a teacher launches another scenario for their class from this one, they choose one of these scenes (or none): every student of theirs here is taken to it first, so it can play the departure (into the time portal, aboard the shuttle). End its events with an Open URL action to {{QL_SCENARIO_LAUNCH_URL}}, which opens the launched scenario. A story scene suits it well.'))),
    form([{ key: 'launcher', label: 'Use as a scenario launcher scene', kind: 'bool', wide: true }], launcher, setLauncher, ctx),
  );
}

/** Give the scene a close-up bench, or go to the one it has. */
function benchSection(model: SceneModel, host: InspectorHost): HTMLElement {
  const bench = model.bench();
  const about = 'A close-up experiment worked with the hands: players pour from one container into another, heat, stir, and watch what happens. Usually with the avatars hidden, so the whole scene is the bench.';
  if (!bench) {
    return h('section', { 'data-section': 'bench' },
      h('div', { class: 'sub-head' }, h('span', null, 'Close-up bench', help(about))),
      h('button', { type: 'button', 'data-bench-on': '', onclick: () => void startBench(model).then(() => host.select({ kind: 'bench' })) }, '🧪 Make this a close-up bench'));
  }
  const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  return h('section', { 'data-section': 'bench' },
    h('div', { class: 'sub-head' }, h('span', null, 'Close-up bench', help(about)), h('button', { type: 'button', class: 'link', onclick: () => host.select({ kind: 'bench' }) }, 'Settings')),
    h('p', { class: 'muted' }, bench.enabled
      ? `${count(bench.vessels?.length ?? 0, 'container')}, ${count(bench.substances?.length ?? 0, 'substance')}, ${count(bench.reactions?.length ?? 0, 'reaction')}, ${count(bench.readouts?.length ?? 0, 'readout')}.`
      : 'Switched off.'));
}

/**
 * Switch a bench on in a scene that has none: with water to start from, and with the avatars
 * hidden, since a bench is worked with the pointer and a figure walking about only gets in the way.
 */
export async function startBench(model: SceneModel): Promise<void> {
  if (model.bench()) return;
  await model.setBench({ enabled: true, substances: [{ id: 'water', name: 'Water', formula: 'H₂O', color: '#bfe0ff', strength: 0.2, opacity: 0.6, boils_at: 100 }] }, true);
  if (model.row.show_avatars !== false) {
    await model.store.patch('scenes', model.sceneId, { show_avatars: false }, true);
    toast('The bench is on, and avatars are hidden in this scene. Show them again in the scene settings if you want them.');
  }
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
    h('div', { class: 'sub-head' }, h('span', null, title, help(about)), h('button', { type: 'button', class: 'link', onclick: add }, '+ Add layer')),
    layers.length
      ? h('ul', { class: 'pick-list' }, ...layers.map((layer, index) =>
          h('li', null, h('button', { type: 'button', class: 'link', onclick: () => host.select({ kind: 'layer', which, index }) },
            `${index + 1}. ${layer.media_id ? mediaLabel(model.store.byId('media', layer.media_id as number)) : '(no image yet)'}${layer.tile ? ' · repeated' : ''}${which === 'background_media' && index === mainLayerIndex(layers) ? ' · main picture' : ''}`))))
      : h('p', { class: 'muted' }, 'None yet.'),
  );
}

/**
 * "Main picture" for a background layer: the picture shown for the scene in lists (the scenario
 * list's card when this is the start scene, the scene cards and the scene map). Only one layer can
 * be main, so ticking it unticks any other; unticking leaves none marked, and the first layer is
 * the main picture again.
 */
function mainToggle(layers: Bag[], index: number, write: (next: Bag[]) => void): HTMLElement {
  const marked = layers[index]?.main === true;
  const isMain = mainLayerIndex(layers) === index;
  const box = h('input', { type: 'checkbox', checked: isMain, disabled: isMain && !marked }) as HTMLInputElement;
  box.addEventListener('change', () =>
    write(layers.map((l, i) => {
      const { main: _drop, ...rest } = l;
      return i === index && box.checked ? { ...rest, main: true } : rest;
    })));
  return h(
    'div',
    { class: 'form' },
    h('label', { class: 'field check wide', 'data-field': 'main' }, box, h('span', null, 'Main picture: show this layer for the scene in lists'),
      help('The picture shown for this scene on its card in the scenario list (when this is the start scene), on the scene cards and on the scene map. With no layer ticked, the first background layer is used.')),
    isMain && !marked ? h('p', { class: 'muted wide' }, 'No layer is ticked, so the first one is the main picture. Tick another layer to use it instead.') : null,
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
    h('div', { class: 'panel-head' }, h('h2', null, which === 'background_media' ? 'Background layer' : 'Foreground layer', help('An image the size of the scene by default. Make the scene larger than the screen and it scrolls as players walk; repeat an image and give it a drift for moving clouds or water; lower the parallax for distant scenery.'))),
    form(LAYER_FIELDS, layer, commit, ctx),
    which === 'background_media' ? mainToggle(layers(), index, (next) => void write(next, true)) : null,
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
/**
 * When a light is on (`conditions` inline in the scene's layout): a beacon that comes on once the ship
 * is repaired, a campfire that goes out in the rain.
 */
function lightConditions(model: SceneModel, ctx: FormContext, index: number): HTMLElement {
  return layoutConditions(model, ctx, 'lights', index);
}

/** The conditions of something placed in the scene that is on only while they hold (a light, underwater light). */
function layoutConditions(model: SceneModel, ctx: FormContext, key: 'lights' | 'water_lights', index: number): HTMLElement {
  const now = () => model.layout<SceneLight | SceneWaterLight>(key)[index];
  return h('div', { 'data-section': 'conditions' }, inlineConditions(
    ctx,
    () => (now()?.conditions ?? undefined) as ConditionValue[] | undefined,
    (list, structural) => void model.setLayout(key, model.layout<SceneLight | SceneWaterLight>(key).map((l, i) => {
      if (i !== index) return l;
      const { conditions: _, ...rest } = l;
      return list.length ? { ...rest, conditions: list as Condition[] } : rest;
    }), structural),
    'On only when',
    'Always on.',
  ));
}

function listPanel(model: SceneModel, ctx: FormContext, key: LayoutList, index: number, title: string, about: string, fields: Field[], host: InspectorHost, extra?: HTMLElement): HTMLElement {
  const entry = model.layout(key)[index];
  if (!entry) return gone();
  const commit = (name: string, value: unknown, field: Field) =>
    void model.setLayout(key, model.layout(key).map((e, i) => (i === index ? withValue(e, name, value, field) : e)), field.kind === 'item' || field.kind === 'character' || !!field.structural);
  return h(
    'div',
    { class: 'panel' },
    h('div', { class: 'panel-head' }, h('h2', null, title, help(about))),
    form(fields, entry, commit, ctx),
    extra ?? null,
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
    h('div', { class: 'panel-head' }, h('h2', null, walkable ? 'Walkable area' : 'Blocked area', walkable ? null : help(
      'A part of a walkable area that avatars cannot enter: a rock, a table, a pond. Drag a corner to move it. Drag the small dot on a side to add a corner. Double-click a corner to remove it.'))),
    h('p', { class: 'muted' }, `${area.length} corners.`),
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
