import { previewUrl } from '../../config';
import { sceneLabel } from '../../describe';
import { h, redraw, toast } from '../../dom';
import { select } from '../../fields';
import type { Store } from '../../store';
import { SceneCanvas } from './canvas';
import { inspector } from './inspector';
import { SceneModel, type Point, type Selection, type Side } from './model';
import { outline, type Addable } from './outline';
import { freshId } from './physicsPanels';

const ADD_MENU: ReadonlyArray<readonly [Addable, string]> = [
  ['hotspot-click', 'Hotspot players click'],
  ['hotspot-walk', 'Hotspot players walk into'],
  ['edge-left', 'Exit along the left edge'],
  ['edge-right', 'Exit along the right edge'],
  ['edge-top', 'Exit along the top edge'],
  ['edge-bottom', 'Exit along the bottom edge'],
  ['start', 'Start event (runs on arrival)'],
  ['end', 'End event (runs on leaving)'],
  ['indirect', 'Indirect event (run by other events)'],
  ['spawn', 'Spawn point'],
  ['item', 'Item'],
  ['character', 'Character'],
  ['walkable_areas', 'Walkable area'],
  ['blocked_areas', 'Blocked area'],
  ['scale_areas', 'Scale area (depth)'],
  ['shadow_spots', 'Shadow spot (shade)'],
  ['background_media', 'Background layer'],
  ['foreground_media', 'Foreground layer'],
  ['physics-body', 'Physics: a ball or block'],
  ['physics-cup', 'Physics: a glass of water'],
  ['physics-water', 'Physics: a tank of water'],
  ['physics-joint', 'Physics: a joint (pin, string, spring)'],
  ['physics-build', 'Physics: an area to build a bridge in'],
];

const ZOOMS: ReadonlyArray<readonly [string, string]> = [['0', 'Fit'], ['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.5', '150%'], ['2', '200%']];

/** What the next scene editor opened for a scene starts with selected (set by the scene map). */
let opening: { sceneId: number; selection: Selection } | null = null;

/** Make the scene editor, when it next opens this scene, start with something selected. */
export function selectOnOpen(sceneId: number, selection: Selection) {
  opening = { sceneId, selection };
}

/**
 * The scene editor: a list of what is in the scene, the scene itself, and a form for whatever
 * is selected. Returns the element and a function that stops it listening to the store.
 */
export function sceneEditor(store: Store, sceneId: number, leave: () => void): { element: HTMLElement; dispose(): void } {
  const model = new SceneModel(store, sceneId);
  let selection: Selection = opening?.sceneId === sceneId ? opening.selection : { kind: 'scene' };
  opening = null;
  let refreshers: Array<() => void> = [];

  const outlineHost = h('div', { class: 'outline-host' });
  const inspectorHost = h('aside', { class: 'inspector', 'aria-label': 'Selected item' });
  const coords = h('span', { class: 'coords muted' });
  const sizeNote = h('span', { class: 'muted' });

  const select_ = (next: Selection) => {
    // A spot being chosen belongs to the form of what was selected.
    canvas.cancelPick();
    selection = next;
    inspectorHost.scrollTop = 0;
    drawAll();
  };

  const canvas = new SceneCanvas(model, {
    selection: () => selection,
    select: select_,
    dragged: () => drawInspector(),
    pointer: (at) => (coords.textContent = at ? `x ${at.x}, y ${at.y}` : ''),
  });
  // The canvas loads images to learn their sizes; the scene panel asks it for them.
  const natural = (url: string): Point | null => canvas.natural(url);

  const drawOutline = () => redraw(outlineHost, outline(model, { selection: () => selection, select: select_, add }));
  const drawInspector = () => {
    refreshers = [];
    redraw(inspectorHost, inspector(model, selection, { select: select_, natural, closed: leave, pickSpot: (request) => canvas.pick(request) }, refreshers));
  };
  const drawCanvas = () => {
    canvas.draw();
    const { width, height } = canvas.size();
    sizeNote.textContent = `${width} × ${height} px`;
  };
  function drawAll() {
    if (!model.exists) return;
    drawOutline();
    drawCanvas();
    drawInspector();
  }

  // ------------------------------------------------------------ adding things

  async function addEvent(kind: string, attrs: object): Promise<number | undefined> {
    const row = await store.add('events', { scene_id: sceneId, kind, ...attrs });
    if (row) select_({ kind: 'event', id: row.id });
    return row?.id;
  }

  async function addEdge(side: Side) {
    const id = await addEvent('hotspot', model.edgeHotspot(side, canvas.size()));
    if (id == null) return;
    const target = store.rows('scenes').find((s) => s.id !== sceneId);
    await store.add('actions', { event_id: id, type: 'jump', params: target ? { scene_id: target.id } : {} });
    toast(target ? `Players who walk off the ${side} edge go to “${sceneLabel(target)}”. Change the scene and arrival point in the jump action.` : 'Add another scene, then choose it in the jump action.');
  }

  async function addToLayout(key: 'spawn_points' | 'items' | 'characters' | 'walkable_areas' | 'blocked_areas' | 'scale_areas' | 'shadow_spots', entry: unknown, kind: Selection['kind']) {
    const list = model.layout(key);
    await model.setLayout(key, [...list, entry], true);
    const index = list.length;
    select_(kind === 'area' ? { kind: 'area', which: key as 'walkable_areas' | 'blocked_areas', index } : ({ kind, index } as Selection));
  }

  function add(what: Addable) {
    const at = canvas.center();
    const position = { position_x: at.x, position_y: at.y };
    switch (what) {
      case 'start':
      case 'end':
      case 'indirect':
        return void addEvent(what, {});
      case 'hotspot-click':
        return void addEvent('hotspot', { ...position, radius: 80, activate_by_trigger: true });
      case 'hotspot-walk':
        return void addEvent('hotspot', { ...position, radius: 80, activate_by_trigger: false });
      case 'edge-left':
      case 'edge-right':
      case 'edge-top':
      case 'edge-bottom':
        return void addEdge(what.slice(5) as Side);
      case 'spawn': {
        const names = new Set(model.layout('spawn_points').map((p) => p.name));
        let name = names.has('default') ? 'spawn' : 'default';
        for (let n = 2; names.has(name); n++) name = `spawn-${n}`;
        return void addToLayout('spawn_points', { name, ...position }, 'spawn');
      }
      case 'item': {
        const first = store.rows('items')[0];
        if (!first) return toast('Create an item on the scenario’s Items page first.', 'error');
        return void addToLayout('items', { item_id: first.id, ...position }, 'item');
      }
      case 'character': {
        const first = store.rows('characters')[0];
        if (!first) return toast('Create a character on the scenario’s Characters page first.', 'error');
        return void addToLayout('characters', { character_id: first.id, ...position }, 'character');
      }
      case 'walkable_areas':
      case 'blocked_areas': {
        const half = what === 'walkable_areas' ? 300 : 100;
        const corners = [[-half, -half / 2], [half, -half / 2], [half, half / 2], [-half, half / 2]].map(([dx, dy]) => ({ x: at.x + dx!, y: at.y + dy! }));
        return void addToLayout(what, corners, 'area');
      }
      case 'scale_areas': {
        // By default: the walkable part of the scene, half size at the top and full size at the bottom.
        const { width, height } = canvas.size();
        const ys = model.layout<Point[]>('walkable_areas').flat().map((p) => p.y);
        const y0 = ys.length ? Math.min(...ys) : Math.round(height / 2);
        return void addToLayout('scale_areas', { name: 'depth', x: 0, y: y0, width, height: height - y0, scale_top: 50, scale_bottom: 100 }, 'scale');
      }
      case 'shadow_spots':
        // Flattened, as a shadow lying on a floor seen at an angle usually is.
        return void addToLayout('shadow_spots', { name: 'shade', x: Math.round(at.x), y: Math.round(at.y), radius: 160, radius_y: 70, strength: 60 }, 'shadow');
      case 'background_media':
      case 'foreground_media': {
        const layers = model.layers(what);
        return void model.setLayers(what, [...layers, {}], true).then(() => select_({ kind: 'layer', which: what, index: layers.length }));
      }
      case 'physics-body':
      case 'physics-cup':
      case 'physics-water':
      case 'physics-joint':
      case 'physics-build':
        return void addPhysics(what, { x: Math.round(at.x), y: Math.round(at.y) });
    }
  }

  /** Something for the scene's physics experiment, switching physics on (and avatars off) if it was not on yet. */
  async function addPhysics(what: Addable, at: Point) {
    if (!model.physics()) {
      await model.setPhysics({ enabled: true, mode: 'individual' }, true);
      if (model.row.show_avatars !== false) {
        await store.patch('scenes', sceneId, { show_avatars: false }, true);
        toast('Physics is on, and avatars are hidden in this scene. Show them again in the scene settings if you want them.');
      }
    }
    const physics = model.physics();
    const bodies = model.physicsList('bodies');
    if (what === 'physics-body') {
      await model.setPhysicsPart('bodies', [...bodies, { id: freshId(physics, 'ball'), name: 'Ball', shape: 'circle', x: at.x, y: at.y, radius: 30, material: 'rubber' }], true);
      return select_({ kind: 'physics-body', index: bodies.length });
    }
    if (what === 'physics-cup') {
      const id = freshId(physics, 'glass');
      await model.setPhysics({
        ...model.physics()!,
        bodies: [...bodies, { id, name: 'Glass', shape: 'cup', x: at.x, y: at.y, width: 240, height: 320, wall: 12, fixed: true, material: 'glass' }],
        water: [...model.physicsList('water'), { id: freshId(physics, 'water'), name: 'Water', body_id: id, level: 140, marks: true }],
      }, true);
      return select_({ kind: 'physics-body', index: bodies.length });
    }
    if (what === 'physics-water') {
      const water = model.physicsList('water');
      await model.setPhysicsPart('water', [...water, { id: freshId(physics, 'tank'), name: 'Tank', x: at.x - 200, y: at.y - 150, width: 400, height: 300, level: 200 }], true);
      return select_({ kind: 'physics-water', index: water.length });
    }
    if (what === 'physics-joint') {
      const body = bodies.find((b) => !b.fixed);
      if (!body) return toast('Add a body that can move first: the joint holds it.', 'error');
      const joints = model.physicsList('joints');
      // A string from the body up to a point above it: a pendulum.
      await model.setPhysicsPart('joints', [...joints, { id: freshId(physics, 'string'), type: 'string', body_a: body.id, x: body.x, y: body.y, x2: body.x, y2: Math.max(0, body.y - 200) }], true);
      return select_({ kind: 'physics-joint', index: joints.length });
    }
    if (what === 'physics-build') {
      if (model.physics()?.build) return select_({ kind: 'physics-build' });
      const grid = 40;
      const x = Math.round((at.x - 400) / grid) * grid;
      const y = Math.round((at.y - 200) / grid) * grid;
      await model.setPhysicsPart('build', {
        x, y, width: 800, height: 400, grid, max_length: 200, budget: 3000,
        anchors: [{ x: x + grid, y: y + 240 }, { x: x + 800 - grid, y: y + 240 }],
        beams: [
          { material: 'wood', label: 'Road', deck: true, cost_per_meter: 100 },
          { material: 'wood', label: 'Wood', cost_per_meter: 50 },
          { material: 'steel', label: 'Steel', cost_per_meter: 200 },
        ],
      }, true);
      return select_({ kind: 'physics-build' });
    }
  }

  // ------------------------------------------------------------------- layout

  const addMenu = select(ADD_MENU, '', (what) => {
    addMenu.value = '';
    if (what) add(what as Addable);
  }, '+ Add to scene…');
  addMenu.classList.add('add-menu');
  const zoom = select(ZOOMS, '0', (value) => {
    canvas.zoom = Number(value);
    drawCanvas();
  });
  zoom.setAttribute('aria-label', 'Zoom');
  const debug = h('input', { type: 'checkbox' });
  const test = h('a', { class: 'button primary', target: 'qbl-preview', href: previewUrl(store.scenarioId, sceneId) }, '▶ Test this scene');
  debug.addEventListener('change', () => (test.href = previewUrl(store.scenarioId, sceneId, debug.checked)));

  const element = h(
    'div',
    { class: 'scene-editor' },
    h('aside', { class: 'outline-pane' }, outlineHost),
    h(
      'section',
      { class: 'canvas-pane' },
      h(
        'div',
        { class: 'toolbar' },
        addMenu,
        h('label', { class: 'inline' }, 'Zoom', zoom),
        sizeNote,
        coords,
        h('span', { class: 'spacer' }),
        h('label', { class: 'inline', title: 'Draws hotspots, walkable areas and positions over the game while testing.' }, debug, 'with outlines'),
        test,
      ),
      canvas.element,
      h('p', { class: 'legend muted' },
        h('span', { class: 'key click' }), 'click hotspot ',
        h('span', { class: 'key walk' }), 'walk-in hotspot ',
        h('span', { class: 'key exit' }), 'exit to another scene ',
        h('span', { class: 'key walkable' }), 'walkable ',
        h('span', { class: 'key blocked' }), 'blocked'),
    ),
    inspectorHost,
  );

  const stop = store.onChange((structural) => {
    if (!model.exists) return;
    drawOutline();
    drawCanvas();
    if (structural) drawInspector();
    else for (const update of refreshers) update();
  });
  // The canvas measures itself, so it is first drawn once it is in the page.
  queueMicrotask(drawAll);

  return { element, dispose: stop };
}
