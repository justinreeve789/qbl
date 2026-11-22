import { previewUrl } from '../../config';
import { sceneLabel } from '../../describe';
import { h, redraw, toast } from '../../dom';
import { select } from '../../fields';
import type { Store } from '../../store';
import { SceneCanvas } from './canvas';
import { freshBenchId } from './benchPanels';
import { inspector, startBench } from './inspector';
import { SceneModel, type Point, type Selection, type Side } from './model';
import { outline, type Addable } from './outline';

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
  ['lights', 'Light (a glow that flickers, breathes or blinks)'],
  ['flows', 'Flowing water (a river, a waterfall, the sea)'],
  ['bench-vessel', 'Bench: a beaker to mix in'],
  ['bench-supply', 'Bench: a stock bottle to pour from'],
  ['bench-dropper', 'Bench: a dropper (a drop at a time)'],
  ['bench-burner', 'Bench: a burner'],
  ['bench-stirrer', 'Bench: a stirring rod'],
  ['bench-sink', 'Bench: a sink'],
  ['background_media', 'Background layer'],
  ['foreground_media', 'Foreground layer'],
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

  async function addToLayout(key: 'spawn_points' | 'items' | 'characters' | 'walkable_areas' | 'blocked_areas' | 'scale_areas' | 'shadow_spots' | 'lights' | 'flows', entry: unknown, kind: Selection['kind']) {
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
      case 'lights':
        return void addToLayout('lights', { name: 'lantern', x: Math.round(at.x), y: Math.round(at.y), radius: 90, kind: 'flicker', color: '#ffc46b', strength: 70 }, 'light');
      case 'flows': {
        // By default: a river across the bottom fifth of the scene.
        const { width, height } = canvas.size();
        return void addToLayout('flows', { name: 'river', kind: 'river', x: 0, y: Math.round(height * 0.8), width, height: Math.round(height * 0.2) }, 'flow');
      }
      case 'background_media':
      case 'foreground_media': {
        const layers = model.layers(what);
        return void model.setLayers(what, [...layers, {}], true).then(() => select_({ kind: 'layer', which: what, index: layers.length }));
      }
      case 'bench-vessel':
      case 'bench-supply':
      case 'bench-dropper':
      case 'bench-burner':
      case 'bench-stirrer':
      case 'bench-sink':
        return void addToBench(what, { x: Math.round(at.x), y: Math.round(at.y) });
    }
  }

  /** Something for the scene's close-up bench, giving the scene a bench if it had none. */
  async function addToBench(what: Addable, at: Point) {
    await startBench(model);
    const bench = model.bench()!;
    const vessels = bench.vessels ?? [];
    const tools = bench.tools ?? [];
    // Things go along the lower third, side by side from the left, rather than on top of each other.
    const size = model.size(() => null);
    void at;
    const room = Math.max(1, size.width - 400);
    const stand = { x: Math.round(200 + ((vessels.length + tools.filter((t) => t.kind !== 'burner').length) * 230) % room), y: Math.round(size.height * 0.7) };
    if (what === 'bench-vessel' || what === 'bench-supply' || what === 'bench-dropper') {
      const first = bench.substances?.[0]?.id;
      const made = what === 'bench-vessel'
        ? { id: freshBenchId(bench, 'vessels', 'beaker'), name: 'Beaker', shape: 'beaker' as const, ...stand, marks: true }
        : what === 'bench-supply'
          ? { id: freshBenchId(bench, 'vessels', 'bottle'), name: bench.substances?.[0]?.name ?? 'Bottle', shape: 'bottle' as const, ...stand, supply: true, contents: first ? [{ substance: first, amount: 500 }] : [] }
          : { id: freshBenchId(bench, 'vessels', 'dropper'), name: 'Dropper', shape: 'dropper' as const, ...stand, y: Math.round(size.height * 0.45), supply: true, contents: first ? [{ substance: first, amount: 5 }] : [] };
      await model.setBenchPart('vessels', [...vessels, made], true);
      return select_({ kind: 'bench-vessel', index: vessels.length });
    }
    const kind = what === 'bench-burner' ? 'burner' : what === 'bench-stirrer' ? 'stirrer' : 'sink';
    // A burner goes under the first container that is mixed in, and heats it.
    const over = kind === 'burner' ? vessels.find((v) => !v.supply) : undefined;
    const made = { id: freshBenchId(bench, 'tools', kind), kind, ...(over ? { x: over.x, y: over.y + 80, vessel_id: over.id } : stand) } as const;
    await model.setBenchPart('tools', [...tools, made], true);
    return select_({ kind: 'bench-tool', index: tools.length });
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
