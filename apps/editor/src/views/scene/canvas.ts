import { flowSettings, pictureScale, placeSortLine, sortLineOf, type Item, scaleAt, skyHour, skyLook, type Media, type ScaleArea, type SceneFlow, type SceneLight, type SceneWaterLight, type SceneFog, fogArea, fogRadial, fogSettings, FOG_MAX_CORNERS, waterLightArea, waterLightShaped, WATER_LIGHT_MAX_CORNERS, type SceneSky, type ShadowSpot, BENCH_TOOLS, fillHeight, outlineBand, toolSize, vesselCapacity, vesselHeight, vesselName, vesselOutline, vesselWidth, parseColor, colorText, type BenchSubstance } from '@qbl/shared';
import type { Row } from '../../api';
import { eventLabel, mediaUrl, params, sceneLabel } from '../../describe';
import { h, s } from '../../dom';
import type { SpotRequest } from '../../fields';
import { sortedActions } from '../actions';
import { standingOf } from '../../characters';
import { waterLightPreview } from './waterLightPreview';
import { fogPreview } from './fogPreview';
import { sameSelection, type AreaList, type Bag, type LayerList, type Point, type SceneModel, type Selection } from './model';

interface Host {
  selection(): Selection;
  select(selection: Selection): void;
  /** Called when a drag ends, so forms showing the dragged values are rebuilt. */
  dragged(): void;
  /** Called as the pointer moves, with scene coordinates (or null when it leaves). */
  pointer(at: Point | null): void;
}

interface Drag {
  from: Point;
  moved: boolean;
  move(to: Point, from: Point): void;
  end(): void;
  /**
   * Called on a double click, with `key` naming what was pressed. Presses are captured by the
   * canvas so a drag survives redrawing, which means the browser's own dblclick never reaches
   * the handle; two presses of the same thing in quick succession are counted here instead.
   */
  double?: { key: string; run(): void };
}

const round = (n: number) => Math.round(n);

/**
 * The picture of the scene: its layers as images, and everything placed in it drawn over them
 * as SVG. Hotspots, labels, spawn points, items, characters, area corners and the positions of
 * in-scene images can all be dragged. The canvas only draws; it keeps nothing the store does not have.
 */
export class SceneCanvas {
  readonly element: HTMLElement;
  /** Screen pixels per scene pixel. 0 means "fit the scene in the window". */
  zoom = 0;
  private stage = h('div', { class: 'stage' });
  private images = h('div', { class: 'stage-images' });
  private svg = s('svg', { class: 'stage-overlay' }) as SVGSVGElement;
  private sizes = new Map<string, Point | null>();
  private drag: Drag | null = null;
  private lastPress: { key: string; at: number } | null = null;
  /** Shapes that select something when pressed, with their area (null: measure it when pressed). */
  private bodies = new WeakMap<Element, number | null>();
  /** True while a press is being handed on to a smaller shape under it. */
  private rerouting = false;
  /** Where the selected thing was pressed over something smaller: a click there selects the smaller one. */
  private clickThrough: { x: number; y: number } | null = null;
  private scale = 1;
  /** A spot being chosen by clicking the scene, and where the pointer is meanwhile. */
  private picking: { request: SpotRequest; hover: Point | null } | null = null;
  private banner = h('div', { class: 'pick-banner', hidden: true });
  /** Escape stops choosing a spot (and does not also close a pop-up the canvas is in). */
  private onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.picking) return;
    e.preventDefault();
    e.stopPropagation();
    this.cancelPick();
  };

  constructor(private model: SceneModel, private host: Host) {
    this.stage.append(this.images, this.svg);
    this.element = h('div', { class: 'canvas-scroll', tabindex: '0' }, this.banner, this.stage);

    // While a spot is being chosen, a press anywhere on the scene chooses it: nothing drawn there
    // is selected or dragged, so placing a walk on top of a character or hotspot works.
    this.svg.addEventListener('pointerdown', (e) => {
      if (!this.picking || e.button !== 0) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const { width: W, height: H } = this.size();
      const at = this.point(e);
      const { request } = this.picking;
      this.endPick();
      request.done({ x: Math.max(0, Math.min(W, at.x)), y: Math.max(0, Math.min(H, at.y)) });
    }, { capture: true });

    // When things overlap, a press goes to the smallest of them under the pointer, not the one
    // drawn on top, so a small hotspot inside a big walkable area or scale area can be picked.
    // The selected thing can still be dragged from anywhere on it: a press on it that overlaps
    // something smaller drags it if the pointer moves, and selects the smallest if it does not.
    // Handles of the selected thing are not bodies, so they always get their own presses.
    this.svg.addEventListener('pointerdown', (e) => {
      if (this.rerouting) return;
      this.clickThrough = null;
      if (this.picking || e.button !== 0) return;
      const hit = this.bodyOf(e.target);
      if (!hit) return;
      const under = this.bodiesAt(e.clientX, e.clientY, hit);
      const smallest = this.smallestOf(under)!;
      if (smallest === hit) return;
      const selected = under.find((el) => el.classList.contains('selected'));
      let to = smallest;
      if (selected && selected !== smallest) {
        this.clickThrough = { x: e.clientX, y: e.clientY };
        to = selected;
      }
      if (to === hit) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      this.press(to, e);
    }, { capture: true });

    this.svg.addEventListener('pointerdown', (e) => {
      // Reached only when nothing drawn handled the press: the empty scene.
      if (e.target === this.svg) this.host.select({ kind: 'scene' });
    });
    this.svg.addEventListener('pointermove', (e) => {
      const at = this.point(e);
      this.host.pointer(at);
      if (this.picking) {
        this.picking.hover = at;
        this.draw();
        return;
      }
      if (!this.drag) return;
      this.drag.moved = true;
      this.drag.move(at, this.drag.from);
      this.draw();
    });
    const finish = (e: PointerEvent) => {
      const drag = this.drag;
      const through = this.clickThrough;
      this.drag = null;
      this.clickThrough = null;
      // A click (no drag) on the selected thing where something smaller overlaps it selects that.
      if (through && e.type === 'pointerup' && !drag?.moved) {
        const smallest = this.smallestOf(this.bodiesAt(through.x, through.y));
        if (smallest && !smallest.classList.contains('selected')) {
          this.press(smallest, e);
          this.drag = null;
          if (this.svg.hasPointerCapture(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
          return;
        }
      }
      if (!drag) return;
      if (drag.moved) {
        drag.end();
        this.host.dragged();
        this.lastPress = null;
      } else if (drag.double) {
        const now = performance.now();
        const again = this.lastPress?.key === drag.double.key && now - this.lastPress.at < 450;
        this.lastPress = again ? null : { key: drag.double.key, at: now };
        if (again) drag.double.run();
      }
    };
    this.svg.addEventListener('pointerup', finish);
    this.svg.addEventListener('pointercancel', finish);
    this.svg.addEventListener('pointerleave', () => {
      this.host.pointer(null);
      if (this.picking?.hover) {
        this.picking.hover = null;
        this.draw();
      }
    });
    new ResizeObserver(() => !this.drag && this.zoom === 0 && this.draw()).observe(this.element);
  }

  /**
   * Choose a spot by clicking the scene: the next press on it picks the spot, instead of
   * selecting or dragging. Escape stops. Returns a function that stops it too.
   */
  pick(request: SpotRequest): () => void {
    this.cancelPick();
    this.picking = { request, hover: null };
    this.element.classList.add('picking');
    this.banner.replaceChildren(
      h('span', null, `📍 ${request.prompt}`),
      h('button', { type: 'button', onclick: () => this.cancelPick() }, 'Cancel'),
    );
    this.banner.hidden = false;
    document.addEventListener('keydown', this.onKey, { capture: true });
    // Bring the spot it has now into view, so it is plain what is being changed.
    if (request.at) this.reveal(request.at);
    this.draw();
    return () => {
      if (this.picking?.request === request) this.cancelPick();
    };
  }

  /** Stop choosing a spot without one. */
  cancelPick() {
    const request = this.picking?.request;
    if (!request) return;
    this.endPick();
    request.cancelled?.();
  }

  private endPick() {
    this.picking = null;
    document.removeEventListener('keydown', this.onKey, { capture: true });
    this.element.classList.remove('picking');
    this.banner.hidden = true;
    this.draw();
  }

  /** Scroll so this scene point is visible, if it is not. */
  private reveal(at: Point) {
    const el = this.element;
    const x = at.x * this.scale;
    const y = at.y * this.scale;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth) el.scrollLeft = x - el.clientWidth / 2;
    if (y < el.scrollTop || y > el.scrollTop + el.clientHeight) el.scrollTop = y - el.clientHeight / 2;
  }

  /** Scene coordinates of the middle of what is visible, for placing new things. */
  center(): Point {
    const el = this.element;
    return {
      x: round((el.scrollLeft + el.clientWidth / 2) / this.scale),
      y: round((el.scrollTop + el.clientHeight / 2) / this.scale),
    };
  }

  /**
   * Mark a drawn shape as something that can be pressed to select it, with its size in scene
   * pixels² (left out: measured from its box when pressed). Overlapping presses go to the smallest.
   */
  private body<T extends SVGElement>(el: T, area?: number): T {
    this.bodies.set(el, area ?? null);
    return el;
  }

  /** The selectable shape a pressed element belongs to, if any (handles and markers belong to none). */
  private bodyOf(target: EventTarget | null): SVGElement | null {
    for (let el = target instanceof Element ? target : null; el && el !== this.svg; el = el.parentElement) {
      if (this.bodies.has(el)) return el as SVGElement;
    }
    return null;
  }

  /** Every selectable shape under a screen point (plus `also`, the one pressed). */
  private bodiesAt(clientX: number, clientY: number, also?: SVGElement): SVGElement[] {
    const found = new Set<SVGElement>(also ? [also] : []);
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const body = this.bodyOf(el);
      if (body) found.add(body);
    }
    return [...found];
  }

  /** The smallest of some shapes; on a tie, the first (the one on top). */
  private smallestOf(bodies: SVGElement[]): SVGElement | null {
    let best: SVGElement | null = null;
    let bestArea = Infinity;
    for (const body of bodies) {
      const area = this.areaOf(body);
      if (!best || area < bestArea) {
        best = body;
        bestArea = area;
      }
    }
    return best;
  }

  /** Hand a press on to another shape, as if it had been pressed itself. */
  private press(body: SVGElement, e: PointerEvent) {
    this.rerouting = true;
    try {
      body.dispatchEvent(new PointerEvent('pointerdown', e));
    } finally {
      this.rerouting = false;
    }
  }

  private areaOf(el: SVGElement): number {
    const known = this.bodies.get(el);
    if (known != null && Number.isFinite(known)) return Math.abs(known);
    try {
      const box = (el as SVGGraphicsElement).getBBox();
      return box.width * box.height;
    } catch {
      return Infinity;
    }
  }

  private point(e: PointerEvent): Point {
    const box = this.svg.getBoundingClientRect();
    return { x: round((e.clientX - box.left) / this.scale), y: round((e.clientY - box.top) / this.scale) };
  }

  /** The pixel size of an image, once it has loaded. Asking starts the load; the canvas redraws when it arrives. */
  natural = (url: string): Point | null => {
    const known = this.sizes.get(url);
    if (known !== undefined) return known;
    this.sizes.set(url, null);
    const img = new Image();
    img.onload = () => {
      this.sizes.set(url, { x: img.naturalWidth, y: img.naturalHeight });
      if (this.model.exists) this.draw();
    };
    img.src = url;
    return null;
  };

  size() {
    return this.model.size(this.natural);
  }

  private begin(e: PointerEvent, selection: Selection | null, drag?: Pick<Drag, 'move' | 'end' | 'double'>) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (selection && !sameSelection(selection, this.host.selection())) this.host.select(selection);
    if (drag) {
      this.drag = { from: this.point(e), moved: false, ...drag };
      this.svg.setPointerCapture(e.pointerId);
    }
  }

  draw() {
    if (!this.model.exists) return;
    const { width: W, height: H } = this.size();
    const fit = Math.min((this.element.clientWidth - 24) / W, (this.element.clientHeight - 24) / H);
    this.scale = this.zoom || Math.max(0.05, Math.min(1, fit > 0 ? fit : 1));
    this.stage.style.width = `${W * this.scale}px`;
    this.stage.style.height = `${H * this.scale}px`;
    this.svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.element.style.setProperty('--u', String(1 / this.scale));

    this.images.replaceChildren(...this.skyBehind(H), ...this.layerImages('background_media', W, H), ...this.layerImages('foreground_media', W, H));

    const selected = this.host.selection();
    const u = 1 / this.scale; // one screen pixel, in scene pixels
    const shapes: SVGElement[] = [];
    const top: SVGElement[] = []; // handles of the selected thing, drawn over everything else

    this.drawScaleAreas(selected, u, shapes, top);
    this.drawFlows(selected, u, shapes, top);
    this.drawWaterLights(selected, u, shapes, top);
    const fogInFront: SVGElement[] = [];
    this.drawFogs(selected, u, shapes, top, fogInFront);
    this.drawShadowSpots(selected, u, shapes, top);
    this.drawLights(selected, u, shapes, top);
    this.drawAreas('walkable_areas', selected, u, shapes, top);
    this.drawAreas('blocked_areas', selected, u, shapes, top);
    for (const event of this.model.events('hotspot')) this.drawHotspot(event, selected, u, W, H, shapes, top);
    this.drawSpawns(selected, u, shapes);
    this.drawPlacements('items', selected, u, shapes);
    this.drawPlacements('characters', selected, u, shapes);
    this.drawBench(selected, u, shapes);
    shapes.push(...fogInFront);
    if (selected.kind === 'event' && !this.picking) this.drawActionMarkers(selected.id, u, top);
    if (this.picking) this.drawPicking(u, W, H, top);

    this.svg.replaceChildren(...shapes, ...top);
  }

  // ------------------------------------------------------------------ layers

  /** The living sky as players first see it, behind the backgrounds, so see-through parts show it. */
  private skyBehind(H: number): HTMLElement[] {
    const sky = params(this.model.row).sky as SceneSky | undefined;
    if (!sky?.time) return [];
    const look = skyLook(skyHour(sky, 0));
    const horizon = H * (sky.horizon ?? 0.6) * this.scale;
    return [h('div', {
      class: 'layer sky-preview',
      style: `left:0;top:0;right:0;bottom:0;background:linear-gradient(${look.top} 0px, ${look.middle} ${horizon * 0.55}px, ${look.horizon} ${horizon}px, ${look.horizon} 100%);`,
      title: 'The living sky, as players first see it',
    })];
  }

  private layerImages(which: LayerList, W: number, H: number): HTMLElement[] {
    const selected = this.host.selection();
    return this.model.layers(which).flatMap((layer, index) => {
      const media = this.model.store.byId('media', layer.media_id as number | null);
      const url = mediaUrl(this.model.store, media);
      if (!media || !url) return [];
      const size = this.natural(url);
      // Remember the image's size on its media row: the game server sizes scenes without loading images.
      if (size && !media.width && !media.height) void this.model.store.patch('media', media.id, { width: size.x, height: size.y });
      const x = Number(layer.position_x ?? 0);
      const y = Number(layer.position_y ?? 0);
      const w = Number(layer.display_width ?? W);
      const hgt = Number(layer.display_height ?? H);
      const isSelected = selected.kind === 'layer' && selected.which === which && selected.index === index;
      const style = `left:${x * this.scale}px;top:${y * this.scale}px;width:${w * this.scale}px;height:${hgt * this.scale}px;`;
      const cls = `layer ${which === 'foreground_media' ? 'foreground' : 'background'}${isSelected ? ' selected' : ''}`;
      if (layer.tile) {
        const tile = size ? `background-size:${size.x * this.scale}px ${size.y * this.scale}px;` : '';
        return [h('div', { class: `${cls} tiled`, style: `${style}background-image:url("${encodeURI(url)}");${tile}` })];
      }
      return [h('img', { class: cls, style, src: url, alt: '', draggable: 'false' })];
    });
  }

  // ------------------------------------------------------------------- areas

  private drawAreas(which: AreaList, selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[]) {
    const areas = this.model.layout<Point[]>(which);
    areas.forEach((polygon, index) => {
      const selection: Selection = { kind: 'area', which, index };
      const isSelected = sameSelection(selection, selected);
      shapes.push(
        this.body(s('polygon', {
          class: `area ${which === 'walkable_areas' ? 'walkable' : 'blocked'}${isSelected ? ' selected' : ''}`,
          points: polygon.map((p) => `${p.x},${p.y}`).join(' '),
          onpointerdown: (e: PointerEvent) => this.begin(e, selection),
        }), polygonArea(polygon)),
      );
      if (!isSelected) return;
      const commit = () => void this.model.setLayout(which, areas);
      polygon.forEach((p, i) => {
        const next = polygon[(i + 1) % polygon.length]!;
        // A small handle half way along each side adds a corner there.
        top.push(
          s('circle', {
            class: 'handle add', cx: (p.x + next.x) / 2, cy: (p.y + next.y) / 2, r: 4 * u,
            onpointerdown: (e: PointerEvent) => {
              const at = { x: round((p.x + next.x) / 2), y: round((p.y + next.y) / 2) };
              polygon.splice(i + 1, 0, at);
              this.begin(e, null, { move: (to) => Object.assign(at, to), end: commit });
              if (this.drag) this.drag.moved = true;
              this.draw();
            },
          }, s('title', null, 'Drag to add a corner')),
        );
      });
      polygon.forEach((p, i) => {
        top.push(
          s('circle', {
            class: 'handle', cx: p.x, cy: p.y, r: 6 * u,
            onpointerdown: (e: PointerEvent) =>
              this.begin(e, null, {
                move: (to) => Object.assign(p, to),
                end: commit,
                double: {
                  key: `${which}-${index}-${i}`,
                  run: () => {
                    if (polygon.length <= 3) return;
                    polygon.splice(i, 1);
                    commit();
                    this.host.dragged();
                  },
                },
              }),
          }, s('title', null, 'Drag to move. Double-click to remove this corner.')),
        );
      });
    });
  }

  // ------------------------------------------------------------ shadow spots

  /**
   * Patches of shade. Each is drawn as it darkens a figure: deepest in the middle, fading out to
   * its edge. The selected one can be dragged, and resized by the handles on its right and bottom.
   */
  private drawShadowSpots(selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[]) {
    const spots = this.model.layout<ShadowSpot>('shadow_spots');
    spots.forEach((spot, index) => {
      const selection: Selection = { kind: 'shadow', index };
      const isSelected = sameSelection(selection, selected);
      const commit = () => void this.model.setLayout('shadow_spots', spots);
      const start = { x: spot.x, y: spot.y };
      const ry = Number(spot.radius_y ?? spot.radius);
      const strength = Math.min(1, Math.max(0, Number(spot.strength ?? 60) / 100));
      // Three rings give the look of the falloff without a gradient per spot.
      for (const [k, share] of [[1, 0.3], [0.66, 0.3], [0.33, 0.4]] as const) {
        shapes.push(s('ellipse', { class: 'shadow-spot-shade', cx: spot.x, cy: spot.y, rx: spot.radius * k, ry: ry * k, 'fill-opacity': strength * share * 0.8 }));
      }
      shapes.push(
        this.body(s('ellipse', {
          class: `shadow-spot${isSelected ? ' selected' : ''}`, cx: spot.x, cy: spot.y, rx: spot.radius, ry,
          onpointerdown: (e: PointerEvent) =>
            this.begin(e, selection, isSelected ? { move: (to, from) => Object.assign(spot, { x: Math.round(start.x + to.x - from.x), y: Math.round(start.y + to.y - from.y) }), end: commit } : undefined),
        }, s('title', null, spot.name || `Shadow ${index + 1}`)), Math.PI * spot.radius * ry),
        s('text', { class: 'shape-name', x: spot.x, y: spot.y, 'font-size': 12 * u, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, spot.name || `Shadow ${index + 1}`),
      );
      if (!isSelected) return;
      const handles: Array<[number, number, string, (to: Point) => void]> = [
        [spot.x + spot.radius, spot.y, 'Drag to change how far it reaches across', (to) => Object.assign(spot, { radius: Math.max(10, Math.round(Math.abs(to.x - spot.x))) })],
        [spot.x, spot.y + ry, 'Drag to change how far it reaches up and down', (to) => Object.assign(spot, { radius_y: Math.max(10, Math.round(Math.abs(to.y - spot.y))) })],
      ];
      for (const [hx, hy, title, resize] of handles) {
        top.push(s('rect', {
          class: 'handle', x: hx - 6 * u, y: hy - 6 * u, width: 12 * u, height: 12 * u,
          onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => resize(to), end: commit }),
        }, s('title', null, title)));
      }
    });
  }

  // ------------------------------------------------------------------ lights

  /**
   * Lights, drawn as a marker each. Only the selected one shows its glow (how far it reaches, in its
   * colour), so a scene with many lights stays readable; it can be dragged, and its reach changed.
   * One with conditions (on only some of the time) has a switch badge beside it.
   */
  private drawLights(selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[]) {
    const lights = this.model.layout<SceneLight>('lights');
    lights.forEach((light, index) => {
      const selection: Selection = { kind: 'light', index };
      const isSelected = sameSelection(selection, selected);
      const commit = () => void this.model.setLayout('lights', lights);
      const start = { x: light.x, y: light.y };
      const radius = Number(light.radius ?? 90);
      const color = light.color ?? '#ffc46b';
      const strength = Math.min(1, Math.max(0, Number(light.strength ?? 70) / 100));
      for (const [k, share] of isSelected ? [[1, 0.18], [0.6, 0.3], [0.25, 0.6]] as const : []) {
        shapes.push(s('circle', { class: 'light-glow', cx: light.x, cy: light.y, r: radius * k, fill: color, 'fill-opacity': strength * share }));
      }
      const name = light.name || `Light ${index + 1}`;
      const spotR = Math.max(12 * u, radius * 0.25);
      const switched = (light.conditions ?? []).length > 0;
      shapes.push(
        this.body(s('circle', {
          class: `light-spot${isSelected ? ' selected' : ''}${switched ? ' switched' : ''}`, cx: light.x, cy: light.y, r: spotR,
          onpointerdown: (e: PointerEvent) =>
            this.begin(e, selection, isSelected ? { move: (to, from) => Object.assign(light, { x: Math.round(start.x + to.x - from.x), y: Math.round(start.y + to.y - from.y) }), end: commit } : undefined),
        }, s('title', null, `${name} (${light.kind ?? 'flicker'})${switched ? ': on only when its conditions hold' : ''}`)), Math.PI * spotR * spotR),
      );
      if (switched) {
        top.push(s('text', { class: 'light-switch', x: light.x + spotR * 0.75, y: light.y - spotR * 0.75, 'font-size': 16 * u, 'data-light-switch': String(index) }, '⏻'));
      }
      if (!isSelected) return;
      top.push(s('rect', {
        class: 'handle', x: light.x + radius - 6 * u, y: light.y - 6 * u, width: 12 * u, height: 12 * u,
        onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => Object.assign(light, { radius: Math.max(10, Math.round(Math.abs(to.x - light.x))) }), end: commit }),
      }, s('title', null, 'Drag to change how far it reaches')));
    });
  }

  // ------------------------------------------------------------- scale areas

  /**
   * Boxes in which things are drawn smaller towards one edge. Each shows the size at its top and
   * bottom edges as a pair of figures, so the gradient can be judged against the artwork.
   */
  private drawScaleAreas(selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[]) {
    const areas = this.model.layout<ScaleArea>('scale_areas');
    areas.forEach((area, index) => {
      const selection: Selection = { kind: 'scale', index };
      const isSelected = sameSelection(selection, selected);
      const commit = () => void this.model.setLayout('scale_areas', areas);
      const start = { x: area.x, y: area.y, width: area.width, height: area.height };
      shapes.push(
        this.body(s('rect', {
          class: `scale-area${isSelected ? ' selected' : ''}`, x: area.x, y: area.y, width: area.width, height: area.height,
          onpointerdown: (e: PointerEvent) =>
            this.begin(e, selection, isSelected ? { move: (to, from) => Object.assign(area, { x: start.x + to.x - from.x, y: start.y + to.y - from.y }), end: commit } : undefined),
        }), area.width * area.height),
      );
      // A figure as tall as a typical avatar (160 px at full size) at each edge.
      const figure = (percent: number, feetY: number, cx: number) => {
        const hgt = 160 * (percent / 100);
        return s('g', { class: 'scale-figure' },
          s('rect', { x: cx - hgt * 0.16, y: feetY - hgt * 0.72, width: hgt * 0.32, height: hgt * 0.72, rx: hgt * 0.1 }),
          s('circle', { cx, cy: feetY - hgt * 0.86, r: hgt * 0.14 }),
          s('text', { class: 'shape-name', x: cx + hgt * 0.2 + 6 * u, y: feetY - hgt / 2, 'font-size': 12 * u, 'dominant-baseline': 'middle' }, `${percent}%`));
      };
      const cx = area.x + Math.min(area.width / 2, 90 * u + 60);
      shapes.push(figure(Number(area.scale_top), area.y + Math.max(0, 160 * (Number(area.scale_top) / 100)), cx), figure(Number(area.scale_bottom), area.y + area.height, cx));
      shapes.push(s('text', { class: 'shape-name', x: area.x + area.width - 8 * u, y: area.y + 16 * u, 'font-size': 12 * u, 'text-anchor': 'end' }, area.name || `Scale area ${index + 1}`));
      if (!isSelected) return;
      // Corner handles resize the box.
      const corners: Array<[number, number, (to: Point) => void]> = [
        [area.x, area.y, (to) => Object.assign(area, { x: Math.min(to.x, start.x + start.width - 20), y: Math.min(to.y, start.y + start.height - 20), width: Math.max(20, start.x + start.width - to.x), height: Math.max(20, start.y + start.height - to.y) })],
        [area.x + area.width, area.y + area.height, (to) => Object.assign(area, { width: Math.max(20, to.x - start.x), height: Math.max(20, to.y - start.y) })],
      ];
      for (const [hx, hy, resize] of corners) {
        top.push(s('rect', {
          class: 'handle', x: hx - 6 * u, y: hy - 6 * u, width: 12 * u, height: 12 * u,
          onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => resize(to), end: commit }),
        }, s('title', null, 'Drag to resize')));
      }
    });
  }

  // ---------------------------------------------------------------- flowing water

  /** Boxes of moving water: shown as blue boxes with an arrow the way the water flows. */
  private drawFlows(selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[]) {
    const flows = this.model.layout<SceneFlow>('flows');
    flows.forEach((flow, index) => {
      const selection: Selection = { kind: 'flow', index };
      const isSelected = sameSelection(selection, selected);
      const commit = () => void this.model.setLayout('flows', flows);
      const start = { x: flow.x, y: flow.y, width: flow.width, height: flow.height };
      const s0 = flowSettings(flow);
      shapes.push(
        this.body(s('rect', {
          class: `flow-area${isSelected ? ' selected' : ''}`, x: flow.x, y: flow.y, width: flow.width, height: flow.height, style: `--flow: ${s0.color}`,
          onpointerdown: (e: PointerEvent) =>
            this.begin(e, selection, isSelected ? { move: (to, from) => Object.assign(flow, { x: start.x + to.x - from.x, y: start.y + to.y - from.y }), end: commit } : undefined),
        }), flow.width * flow.height),
      );
      const arrow = { right: '→', left: '←', down: '↓', up: '↑', still: '〰' }[s0.direction];
      shapes.push(s('text', { class: 'shape-name', x: flow.x + 8 * u, y: flow.y + 16 * u, 'font-size': 12 * u }, `${arrow} ${flow.name || s0.kind}${s0.layer === 'over' ? ' (over)' : ''}`));
      if (!isSelected) return;
      const corners: Array<[number, number, (to: Point) => void]> = [
        [flow.x, flow.y, (to) => Object.assign(flow, { x: Math.min(to.x, start.x + start.width - 20), y: Math.min(to.y, start.y + start.height - 20), width: Math.max(20, start.x + start.width - to.x), height: Math.max(20, start.y + start.height - to.y) })],
        [flow.x + flow.width, flow.y + flow.height, (to) => Object.assign(flow, { width: Math.max(20, to.x - start.x), height: Math.max(20, to.y - start.y) })],
      ];
      for (const [hx, hy, resize] of corners) {
        top.push(s('rect', {
          class: 'handle', x: hx - 6 * u, y: hy - 6 * u, width: 12 * u, height: 12 * u,
          onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => resize(to), end: commit }),
        }, s('title', null, 'Drag to resize')));
      }
    });
  }

  // ---------------------------------------------------------------- underwater light

  /**
   * Underwater light: its box, with the light itself moving inside it (the game's own shader, in a
   * small WebGL canvas that lets presses through to the box). Where there is no WebGL, just the box.
   */
  private drawWaterLights(selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[]) {
    const lights = this.model.layout<SceneWaterLight>('water_lights');
    lights.forEach((light, index) => {
      const area = waterLightArea(light);
      if (!(area.width > 0) || !(area.height > 0)) return;
      const selection: Selection = { kind: 'water_light', index };
      const isSelected = sameSelection(selection, selected);
      // An outline keeps the box as its bounds, so the game and the fields agree on where it is.
      const commit = () => {
        if (waterLightShaped(light)) Object.assign(light, boxOf(light.shape!));
        void this.model.setLayout('water_lights', lights);
      };
      const preview = waterLightPreview(`${this.model.sceneId}:${index}`, light);
      if (preview) {
        shapes.push(s('foreignObject', { class: 'water-light-view', x: area.x, y: area.y, width: area.width, height: area.height }, preview));
      }
      const label = light.kind === 'shafts' ? '☀ ' : '〰 ';
      const switched = light.conditions?.length ? ' ⏻' : '';
      const name = `${label}${light.name || (light.kind === 'shafts' ? 'light shafts' : 'rippling light')}${switched}`;
      if (area.corners) this.drawWaterLightShape(light, area.corners, selection, isSelected, u, shapes, top, commit);
      else this.drawWaterLightBox(light, selection, isSelected, u, shapes, top, commit);
      shapes.push(s('text', { class: 'shape-name', x: area.x + 8 * u, y: area.y + 16 * u, 'font-size': 12 * u }, name));
    });
  }

  private drawWaterLightBox(light: SceneWaterLight, selection: Selection, isSelected: boolean, u: number, shapes: SVGElement[], top: SVGElement[], commit: () => void) {
    const start = { x: light.x, y: light.y, width: light.width, height: light.height };
    shapes.push(
      this.body(s('rect', {
        class: `water-light-area${isSelected ? ' selected' : ''}`, x: light.x, y: light.y, width: light.width, height: light.height,
        onpointerdown: (e: PointerEvent) =>
          this.begin(e, selection, isSelected ? { move: (to, from) => Object.assign(light, { x: Math.round(start.x + to.x - from.x), y: Math.round(start.y + to.y - from.y) }), end: commit } : undefined),
      }), light.width * light.height),
    );
    if (!isSelected) return;
    const corners: Array<[number, number, (to: Point) => void]> = [
      [light.x, light.y, (to) => Object.assign(light, { x: Math.min(to.x, start.x + start.width - 20), y: Math.min(to.y, start.y + start.height - 20), width: Math.max(20, start.x + start.width - to.x), height: Math.max(20, start.y + start.height - to.y) })],
      [light.x + light.width, light.y + light.height, (to) => Object.assign(light, { width: Math.max(20, to.x - start.x), height: Math.max(20, to.y - start.y) })],
    ];
    for (const [hx, hy, resize] of corners) {
      top.push(s('rect', {
        class: 'handle', x: hx - 6 * u, y: hy - 6 * u, width: 12 * u, height: 12 * u,
        onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => resize(to), end: commit }),
      }, s('title', null, 'Drag to resize')));
    }
  }

  /**
   * Rippling light with an outline of its own: dragged as a whole, its corners moved, added (from the
   * handle half way along a side) and removed (double-click), as walkable areas are.
   */
  private drawWaterLightShape(light: SceneWaterLight, corners: Point[], selection: Selection, isSelected: boolean, u: number, shapes: SVGElement[], top: SVGElement[], commit: () => void) {
    const index = selection.kind === 'water_light' ? selection.index : 0;
    this.drawOutline(light.shape!, corners, 'water-light-area', `water_lights-${index}`, WATER_LIGHT_MAX_CORNERS, selection, isSelected, u, shapes, top, commit);
  }

  /**
   * An outline that is edited by its corners (rippling light's own shape, fog): dragged as a whole
   * (`moved` is told how far, for anything that should go with it), its corners moved, added (from the
   * handle half way along a side, up to `most`) and removed (double-click, down to three).
   */
  private drawOutline(
    polygon: Point[], corners: Point[], cls: string, key: string, most: number, selection: Selection, isSelected: boolean,
    u: number, shapes: SVGElement[], top: SVGElement[], commit: () => void, moved?: (dx: number, dy: number) => void,
  ) {
    const start = polygon.map((p) => ({ ...p }));
    shapes.push(
      this.body(s('polygon', {
        class: `${cls}${isSelected ? ' selected' : ''}`,
        points: corners.map((p) => `${p.x},${p.y}`).join(' '),
        onpointerdown: (e: PointerEvent) =>
          this.begin(e, selection, isSelected
            ? {
              move: (to, from) => {
                polygon.forEach((p, i) => Object.assign(p, { x: round(start[i]!.x + to.x - from.x), y: round(start[i]!.y + to.y - from.y) }));
                moved?.(round(to.x - from.x), round(to.y - from.y));
              },
              end: commit,
            }
            : undefined),
      }), polygonArea(corners)),
    );
    if (!isSelected) return;
    if (polygon.length < most) {
      polygon.forEach((p, i) => {
        const next = polygon[(i + 1) % polygon.length]!;
        top.push(
          s('circle', {
            class: 'handle add', cx: (p.x + next.x) / 2, cy: (p.y + next.y) / 2, r: 4 * u,
            onpointerdown: (e: PointerEvent) => {
              const at = { x: round((p.x + next.x) / 2), y: round((p.y + next.y) / 2) };
              polygon.splice(i + 1, 0, at);
              this.begin(e, null, { move: (to) => Object.assign(at, to), end: commit });
              if (this.drag) this.drag.moved = true;
              this.draw();
            },
          }, s('title', null, 'Drag to add a corner')),
        );
      });
    }
    polygon.forEach((p, i) => {
      top.push(
        s('circle', {
          class: 'handle', cx: p.x, cy: p.y, r: 6 * u,
          onpointerdown: (e: PointerEvent) =>
            this.begin(e, null, {
              move: (to) => Object.assign(p, to),
              end: commit,
              double: {
                key: `${key}-${i}`,
                run: () => {
                  if (polygon.length <= 3) return;
                  polygon.splice(i, 1);
                  commit();
                  this.host.dragged();
                },
              },
            }),
        }, s('title', null, 'Drag to move. Double-click to remove this corner.')),
      );
    });
  }

  // ---------------------------------------------------------------- fog

  /**
   * Fog: its outline, edited by its corners, with the fog itself drifting inside it (the game's own
   * shader, in a small WebGL canvas that lets presses through). Fog in front of everyone is shown in
   * front of the items and characters placed here (`front`); fog on the floor behind them. Fog that
   * spreads from a point shows the point, to drag, when selected.
   */
  private drawFogs(selected: Selection, u: number, shapes: SVGElement[], top: SVGElement[], front: SVGElement[]) {
    const fogs = this.model.layout<SceneFog>('fogs');
    fogs.forEach((fog, index) => {
      if (!Array.isArray(fog.shape)) return;
      const area = fogArea(fog);
      if (!area.corners) return;
      const selection: Selection = { kind: 'fog', index };
      const isSelected = sameSelection(selection, selected);
      const commit = () => void this.model.setLayout('fogs', fogs);
      const settings = fogSettings(fog);
      const preview = fogPreview(`${this.model.sceneId}:${index}`, fog);
      if (preview && area.width > 0 && area.height > 0) {
        (settings.layer === 'behind' ? shapes : front).push(s('foreignObject', { class: 'fog-view', x: area.x, y: area.y, width: area.width, height: area.height }, preview));
      }
      const origin = fog.origin ? { ...fog.origin } : null;
      this.drawOutline(fog.shape, area.corners, 'fog-area', `fogs-${index}`, FOG_MAX_CORNERS, selection, isSelected, u, shapes, top, commit,
        // A point of its own goes with the fog when the whole of it is dragged.
        origin ? (dx, dy) => { fog.origin = { x: origin.x + dx, y: origin.y + dy }; } : undefined);
      const radial = fogRadial(settings.direction);
      const arrow = radial ? (settings.direction === 'outward' ? '✺ ' : '⊛ ') : ({ right: '→ ', left: '← ', up: '↑ ', down: '↓ ' } as Record<string, string>)[settings.direction] ?? '';
      const name = `☁ ${arrow}${fog.name || 'fog'}${fog.conditions?.length ? ' ⏻' : ''}`;
      shapes.push(s('text', { class: 'shape-name', x: area.x + 8 * u, y: area.y + 16 * u, 'font-size': 12 * u }, name));
      if (isSelected && radial) {
        const at = settings.origin;
        top.push(s('g', {
          class: 'fog-origin',
          // Structural, so the inspector's words about where the point is follow it.
          onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => { fog.origin = { x: round(to.x), y: round(to.y) }; }, end: () => void this.model.setLayout('fogs', fogs, true) }),
        },
        s('circle', { class: 'handle', cx: at.x, cy: at.y, r: 9 * u }),
        s('path', { class: 'fog-origin-cross', d: `M${at.x - 14 * u},${at.y}H${at.x + 14 * u}M${at.x},${at.y - 14 * u}V${at.y + 14 * u}` }),
        s('title', null, settings.direction === 'outward' ? 'The fog spreads out from here. Drag to move.' : 'The fog gathers in to here. Drag to move.')));
      }
    });
  }

  // ---------------------------------------------------------------- hotspots

  private drawHotspot(event: Row, selected: Selection, u: number, W: number, H: number, shapes: SVGElement[], top: SVGElement[]) {
    const selection: Selection = { kind: 'event', id: event.id };
    const isSelected = sameSelection(selection, selected);
    const x = event.position_x as number | null;
    const y = event.position_y as number | null;
    const r = Number(event.radius ?? -1);
    const jump = sortedActions({ store: this.model.store }, event.id).find((a) => a.type === 'jump');
    const cls = `hotspot ${event.activate_by_trigger ? 'click' : 'walk'}${jump ? ' exit' : ''}${isSelected ? ' selected' : ''}`;
    const commit = () => void this.model.store.patch('events', event.id, { position_x: event.position_x, position_y: event.position_y, radius: event.radius });
    const moveBy = (startX: number | null, startY: number | null) => ({
      move: (to: Point, from: Point) => {
        if (startX != null) event.position_x = startX + to.x - from.x;
        if (startY != null) event.position_y = startY + to.y - from.y;
      },
      end: commit,
    });
    const press = (e: PointerEvent) => this.begin(e, selection, moveBy(x, y));
    const name = jump ? `${eventLabel(event)} → ${sceneLabel(this.model.store.byId('scenes', params(jump).scene_id as number | null))}` : eventLabel(event);
    let labelAt: Point;
    let handleAt: Point | null = null;
    let resize: ((to: Point) => void) | null = null;

    if (r < 0 || (x == null && y == null)) {
      // Covers the whole scene: drawn as a frame so it does not swallow every click.
      shapes.push(this.body(s('rect', { class: `${cls} everywhere`, x: 4 * u, y: 4 * u, width: W - 8 * u, height: H - 8 * u, onpointerdown: (e: PointerEvent) => this.begin(e, selection) }), W * H));
      labelAt = { x: W / 2, y: 22 * u };
    } else if (x == null) {
      shapes.push(this.body(s('rect', { class: cls, x: 0, y: y! - r, width: W, height: 2 * r, onpointerdown: press }), W * 2 * r));
      labelAt = { x: W / 2, y: y! };
      handleAt = { x: W / 2, y: y! + r };
      resize = (to) => (event.radius = Math.max(4, Math.abs(to.y - y!)));
    } else if (y == null) {
      shapes.push(this.body(s('rect', { class: cls, x: x - r, y: 0, width: 2 * r, height: H, onpointerdown: press }), 2 * r * H));
      labelAt = { x, y: H / 2 };
      handleAt = { x: x + r, y: H / 2 };
      resize = (to) => (event.radius = Math.max(4, Math.abs(to.x - x)));
    } else {
      // Hotspots that only appear when the avatar is near: the distance at which they start to
      // show, and the distance at which they are fully visible.
      const outer = Number(event.reveal_radius ?? 0);
      if (outer > 0) {
        const inner = Math.min(outer, Number(event.reveal_full_radius ?? outer / 2));
        shapes.push(s('circle', { class: 'reveal-ring', cx: x, cy: y, r: outer }), s('circle', { class: 'reveal-ring full', cx: x, cy: y, r: inner }));
      }
      shapes.push(this.body(s('circle', { class: cls, cx: x, cy: y, r, onpointerdown: press }), Math.PI * r * r));
      // Under the circle, so the name does not sit on top of the hotspot's own label.
      labelAt = { x, y: y + r + 10 * u };
      handleAt = { x: x + r, y };
      resize = (to) => (event.radius = Math.max(4, round(Math.hypot(to.x - x, to.y - y))));
    }
    shapes.push(s('text', { class: 'shape-name', x: labelAt.x, y: labelAt.y, 'font-size': 12 * u, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, name));

    for (const label of this.model.store.where('labels', 'event_id', event.id)) this.drawLabel(label, selection, u, shapes);

    if (isSelected && handleAt && resize) {
      const grow = resize;
      top.push(
        s('circle', {
          class: 'handle', cx: handleAt.x, cy: handleAt.y, r: 6 * u,
          onpointerdown: (e: PointerEvent) => this.begin(e, null, { move: (to) => grow(to), end: commit }),
        }, s('title', null, 'Drag to change the radius')),
      );
    }
  }

  private drawLabel(label: Row, owner: Selection, u: number, shapes: SVGElement[]) {
    const store = this.model.store;
    const x = Number(label.position_x ?? 0);
    const y = Number(label.position_y ?? 0);
    const press = (e: PointerEvent) =>
      this.begin(e, owner, {
        move: (to, from) => {
          label.position_x = x + to.x - from.x;
          label.position_y = y + to.y - from.y;
        },
        end: () => void store.patch('labels', label.id, { position_x: label.position_x, position_y: label.position_y }),
      });
    const media = store.byId('media', label.media_id as number | null);
    const url = label.type === 'text' ? null : mediaUrl(store, media);
    const size = url ? this.natural(url) : null;
    if (url && size) {
      const p = params(label);
      // A spritemap shows one tile; an image shows the whole file at its media scale.
      const tile = label.type === 'spritemap';
      const w = (tile ? Number(p.spritemap_width ?? size.x) : size.x * Number(media?.scale_x ?? 1)) * Number(label.scale_x ?? 1);
      const hgt = (tile ? Number(p.spritemap_height ?? size.y) : size.y * Number(media?.scale_y ?? 1)) * Number(label.scale_y ?? 1);
      if (tile) shapes.push(this.body(s('rect', { class: 'label-box', x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, onpointerdown: press }), w * hgt));
      else shapes.push(this.body(s('image', { class: 'label-image', href: url, x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, preserveAspectRatio: 'none', onpointerdown: press }), w * hgt));
    } else {
      const text = label.type === 'text' ? String(label.text ?? '') : `(${label.type})`;
      shapes.push(this.body(s('text', { class: 'label-text', x, y, 'font-size': 18 * Number(label.scale_y ?? 1), 'text-anchor': 'middle', 'dominant-baseline': 'middle', onpointerdown: press }, text)));
    }
  }

  // ------------------------------------------------- spawn points, placements

  // ------------------------------------------------------------------- bench

  /**
   * A close-up bench as it will start: each container with what is in it to begin with, and the
   * tools. Containers and tools can be dragged; they stand on the point that is dragged.
   */
  private drawBench(selected: Selection, u: number, shapes: SVGElement[]) {
    const bench = this.model.bench();
    if (!bench) return;
    const off = bench.enabled ? '' : ' off';
    const commit = () => void this.model.setBench({ ...bench });
    const substances = new Map((bench.substances ?? []).map((sub) => [sub.id, sub] as [string, BenchSubstance]));

    (bench.tools ?? []).forEach((tool, index) => {
      const selection: Selection = { kind: 'bench-tool', index };
      const start = { x: tool.x, y: tool.y };
      const { w, h: tall } = toolSize(tool);
      shapes.push(this.body(s('g', {
        class: `bench-tool ${tool.kind}${sameSelection(selection, selected) ? ' selected' : ''}${off}`,
        onpointerdown: (e: PointerEvent) => this.begin(e, selection, {
          move: (to, from) => Object.assign(tool, { x: Math.round(start.x + to.x - from.x), y: Math.round(start.y + to.y - from.y) }),
          end: commit,
        }),
      },
      s('rect', { x: tool.x - w / 2, y: tool.y - tall, width: w, height: tall, rx: 8 }),
      s('text', { class: 'shape-name', x: tool.x, y: tool.y - tall / 2, 'font-size': 22 * u, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, BENCH_TOOLS[tool.kind]?.icon ?? '🔧'),
      s('text', { class: 'shape-name', x: tool.x, y: tool.y + 16 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, tool.name || BENCH_TOOLS[tool.kind]?.label || tool.kind),
      s('title', null, `${tool.name || BENCH_TOOLS[tool.kind]?.label || tool.kind}: drag to move`)), w * tall));
    });

    (bench.vessels ?? []).forEach((vessel, index) => {
      const selection: Selection = { kind: 'bench-vessel', index };
      const start = { x: vessel.x, y: vessel.y };
      const outline = vesselOutline(vessel.shape, vesselWidth(vessel), vesselHeight(vessel));
      const at = (points: Array<{ x: number; y: number }>) => points.map((p) => `${vessel.x + p.x},${vessel.y - p.y}`).join(' ');
      // What is in it to begin with, as one band of its blended colour (the game draws the layers).
      const contents = (vessel.contents ?? []).filter((c) => c.amount > 0);
      const amount = contents.reduce((sum, c) => sum + c.amount, 0);
      const parts: SVGElement[] = [s('polygon', { class: 'bench-glass', points: at(outline) })];
      if (amount > 0) {
        let weight = 0;
        const rgb: [number, number, number] = [0, 0, 0];
        for (const c of contents) {
          const sub = substances.get(c.substance);
          const wgt = c.amount * (sub?.strength ?? (sub?.color || sub?.state === 'solid' ? 1 : 0.15));
          const colour = parseColor(sub?.indicator?.length ? sub.indicator[Math.floor(sub.indicator.length / 2)]!.color : sub?.color, sub?.state === 'solid' ? [235, 235, 235] : [220, 236, 251]);
          rgb[0] += colour[0] * wgt;
          rgb[1] += colour[1] * wgt;
          rgb[2] += colour[2] * wgt;
          weight += wgt;
        }
        const level = fillHeight(outline, Math.min(1, amount / vesselCapacity(vessel)));
        const band = outlineBand(outline, 0, level);
        if (band.length >= 3) parts.push(s('polygon', { class: 'bench-liquid', points: at(band), style: `fill:${weight > 0 ? colorText([rgb[0] / weight, rgb[1] / weight, rgb[2] / weight]) : '#dcecfb'}` }));
      }
      parts.push(s('polyline', { class: 'bench-wall', points: at(outline) }));
      shapes.push(this.body(s('g', {
        class: `bench-vessel${sameSelection(selection, selected) ? ' selected' : ''}${vessel.supply ? ' supply' : ''}${off}`,
        onpointerdown: (e: PointerEvent) => this.begin(e, selection, {
          move: (to, from) => Object.assign(vessel, { x: Math.round(start.x + to.x - from.x), y: Math.round(start.y + to.y - from.y) }),
          end: commit,
        }),
      }, ...parts,
      s('text', { class: 'shape-name', x: vessel.x, y: vessel.y + 16 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, `${vesselName(vessel)}${vessel.supply ? ' ∞' : ''}`),
      s('title', null, `${vesselName(vessel)}${vessel.supply ? ' (a stock bottle)' : ''}: drag to move`)), polygonArea(outline)));
    });
  }

  private drawSpawns(selected: Selection, u: number, shapes: SVGElement[]) {
    const spawns = this.model.layout('spawn_points');
    spawns.forEach((spawn, index) => {
      const selection: Selection = { kind: 'spawn', index };
      const x = Number(spawn.position_x ?? 0);
      const y = Number(spawn.position_y ?? 0);
      const dir = spawn.facing === 'left' ? -1 : 1;
      shapes.push(
        this.body(s(
          'g',
          { class: `spawn${sameSelection(selection, selected) ? ' selected' : ''}`, onpointerdown: (e: PointerEvent) => this.begin(e, selection, this.moveBag(spawn, () => this.model.setLayout('spawn_points', spawns))) },
          s('circle', { cx: x, cy: y, r: 9 * u }),
          s('path', { d: `M ${x + dir * 4 * u} ${y - 5 * u} L ${x + dir * 14 * u} ${y} L ${x + dir * 4 * u} ${y + 5 * u} Z` }),
          s('text', { class: 'shape-name', x, y: y + 22 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, `⚑ ${spawn.name ?? ''}`),
        ), Math.PI * 81 * u * u),
      );
    });
  }

  private drawPlacements(which: 'items' | 'characters', selected: Selection, u: number, shapes: SVGElement[]) {
    const store = this.model.store;
    const placements = this.model.layout(which);
    placements.forEach((placement, index) => {
      const selection: Selection = { kind: which === 'items' ? 'item' : 'character', index };
      const thing = store.byId(which, (which === 'items' ? placement.item_id : placement.character_id) as number | null);
      const x = Number(placement.position_x ?? 0);
      const y = Number(placement.position_y ?? 0);
      // A character is drawn standing the way it faces, from its animations; an item by its picture.
      const facing = placement.facing === 'left' ? 'left' : 'right';
      const standing = which === 'characters' ? standingOf(store, thing, facing) : null;
      const url = which === 'characters' ? standing?.url ?? null : mediaUrl(store, store.byId('media', thing?.media_id as number | null));
      const whole = url ? this.natural(url) : null;
      const grid = standing?.sheet;
      const size = whole && grid ? { x: whole.x / grid.columns, y: whole.y / grid.rows } : whole;
      // Drawn at the size the game will draw it: its own scale, times the scale area it stands in.
      const depth = scaleAt({ scale_areas: this.model.layout<ScaleArea>('scale_areas') }, x, y);
      const scale = Number(params(thing ?? ({} as Row), 'settings').scale ?? 1) * depth;
      let area = 1600 * u * u;
      const group = s('g', {
        class: `placement ${which}${sameSelection(selection, selected) ? ' selected' : ''}`,
        onpointerdown: (e: PointerEvent) => this.begin(e, selection, this.moveBag(placement, () => this.model.setLayout(which, placements))),
      });
      if (url && size) {
        // Items and characters stand on their position: it is the middle of their bottom edge.
        // A character's picture is also stretched by its media's Scale X / Y, as in the game.
        const stretch = standing ? pictureScale(standing.media as Pick<Media, 'scale_x' | 'scale_y'>) : { x: 1, y: 1 };
        const w = size.x * scale * stretch.x;
        const hgt = size.y * scale * stretch.y;
        const mirrored = which === 'characters' ? standing!.flip : placement.facing === 'left';
        const flip = mirrored ? `translate(${2 * x} 0) scale(-1 1)` : null;
        // One frame of a sheet: the sheet seen through a window the size of a frame.
        const picture = grid && whole && standing?.frame != null
          ? s('g', { transform: flip }, s('svg', { x: x - w / 2, y: y - hgt, width: w, height: hgt, viewBox: `${(standing.frame % grid.columns) * size.x} ${Math.floor(standing.frame / grid.columns) * size.y} ${size.x} ${size.y}`, preserveAspectRatio: 'none' },
              s('image', { href: url, x: 0, y: 0, width: whole.x, height: whole.y, preserveAspectRatio: 'none' })))
          : s('image', { href: url, x: x - w / 2, y: y - hgt, width: w, height: hgt, preserveAspectRatio: 'none', transform: flip });
        group.append(picture, s('rect', { class: 'outline', x: x - w / 2, y: y - hgt, width: w, height: hgt }));
        // An item's sort line: players below it are drawn in front of the item, above it behind.
        const line = which === 'items' ? sortLineOf(params(thing ?? ({} as Row), 'settings') as Pick<Item, 'sort_line'>) : null;
        if (line) {
          const placed = placeSortLine(line, { x, y, width: w, height: hgt, flipped: mirrored });
          group.append(s('polyline', { class: 'sort-line-on-scene', points: placed.points.map((p) => `${p.x},${p.y}`).join(' ') }));
        }
        area = w * hgt;
      } else {
        group.append(s('rect', { class: 'outline missing', x: x - 20 * u, y: y - 40 * u, width: 40 * u, height: 40 * u }));
      }
      group.append(s('text', { class: 'shape-name', x, y: y + 14 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, String(thing?.name ?? '(missing)')));
      shapes.push(this.body(group, area));
    });
  }

  /** A drag that moves something with position_x and position_y kept in a JSON list. */
  private moveBag(bag: Bag, commit: () => void): Pick<Drag, 'move' | 'end'> {
    const x = Number(bag.position_x ?? 0);
    const y = Number(bag.position_y ?? 0);
    return {
      move: (to, from) => {
        bag.position_x = x + to.x - from.x;
        bag.position_y = y + to.y - from.y;
      },
      end: commit,
    };
  }

  // ------------------------------------------------------------ action markers

  /**
   * For the selected event: where its "image in scene" and spritemap actions will appear, where its
   * walks go and where its translates move things to. Each marker can be dragged.
   */
  private drawActionMarkers(eventId: number, u: number, top: SVGElement[]) {
    const store = this.model.store;
    const actions = sortedActions({ store }, eventId);
    for (const action of actions) {
      const p = params(action);
      const place = this.markerPlace(action, p);
      if (!place) continue;
      const { x, y } = place.at;
      const press = (e: PointerEvent) =>
        this.begin(e, null, {
          move: (to, from) => {
            p.position_x = x + to.x - from.x;
            p.position_y = y + to.y - from.y;
          },
          end: () => void store.patch('actions', action.id, { params: p }),
        });
      // Where it starts from, when that is known: a dashed line shows the way it goes.
      if (place.from) top.push(s('path', { class: `action-route ${place.kind}`, d: `M ${place.from.x} ${place.from.y} L ${x} ${y}` }));
      const group = s('g', { class: `action-marker ${place.kind}`, 'data-marker': action.id, onpointerdown: press });
      const media = store.byId('media', action.media_id as number | null);
      const url = action.type === 'image_fixed' ? mediaUrl(store, media) : null;
      const size = url ? this.natural(url) : null;
      if (url && size) {
        const w = size.x * Number(p.scale_x ?? 1) * Number(media?.scale_x ?? 1);
        const hgt = size.y * Number(p.scale_y ?? 1) * Number(media?.scale_y ?? 1);
        group.append(s('image', { href: url, x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, preserveAspectRatio: 'none', opacity: 0.75 }));
      }
      group.append(
        s('path', { d: `M ${x - 10 * u} ${y} H ${x + 10 * u} M ${x} ${y - 10 * u} V ${y + 10 * u}` }),
        s('circle', { cx: x, cy: y, r: 7 * u }),
        s('text', { class: 'shape-name', x, y: y - 14 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, place.name),
        s('title', null, 'Drag to move'),
      );
      top.push(group);
    }
  }

  /** Where an action's marker goes, what it is called, and where the thing it moves starts. */
  private markerPlace(action: Row, p: Bag): { kind: string; at: Point; from: Point | null; name: string } | null {
    const store = this.model.store;
    const num = (v: unknown) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
    switch (action.type) {
      case 'image_fixed':
      case 'spritemap':
        return { kind: 'shown', at: { x: num(p.position_x) ?? 0, y: num(p.position_y) ?? 0 }, from: null, name: `Action #${action.id}` };
      case 'walk': {
        if ((p.to ?? 'point') !== 'point') return null;
        const x = num(p.position_x);
        const y = num(p.position_y);
        if (x == null || y == null) return null;
        if (p.target === 'player') return { kind: 'walk', at: { x, y }, from: null, name: '🚶 The player walks here' };
        const character = store.byId('characters', p.character_id as number | null);
        const placed = this.model.layout('characters').find((c) => c.character_id === p.character_id);
        const from = placed ? { x: Number(placed.position_x ?? 0), y: Number(placed.position_y ?? 0) } : null;
        return { kind: 'walk', at: { x, y }, from, name: `🚶 ${String(character?.name ?? 'A character')} walks here` };
      }
      case 'translate': {
        // An empty X or Y keeps the target's own, so the marker uses that.
        const target = store.byId('actions', p.target_id as number | null);
        const tp = target ? params(target) : {};
        const from = target && num(tp.position_x) != null && num(tp.position_y) != null ? { x: num(tp.position_x)!, y: num(tp.position_y)! } : null;
        const x = num(p.position_x) ?? from?.x ?? null;
        const y = num(p.position_y) ?? from?.y ?? null;
        if (x == null || y == null || (num(p.position_x) == null && num(p.position_y) == null)) return null;
        return { kind: 'translate', at: { x, y }, from, name: `↗ Action #${target?.id ?? '?'} moves here` };
      }
      default:
        return null;
    }
  }

  /** While a spot is being chosen: the spot as it is now, and crosshairs where the pointer is. */
  private drawPicking(u: number, W: number, H: number, top: SVGElement[]) {
    const { request, hover } = this.picking!;
    if (request.at) {
      const { x, y } = request.at;
      top.push(s('g', { class: 'pick-current' },
        s('circle', { cx: x, cy: y, r: 7 * u }),
        s('text', { class: 'shape-name', x, y: y - 14 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, 'Now'),
      ));
    }
    if (hover) {
      const x = Math.max(0, Math.min(W, hover.x));
      const y = Math.max(0, Math.min(H, hover.y));
      top.push(s('g', { class: 'pick-hover' },
        s('path', { d: `M 0 ${y} H ${W} M ${x} 0 V ${H}` }),
        s('circle', { cx: x, cy: y, r: 7 * u }),
        s('text', { class: 'shape-name', x: x + 12 * u, y: y - 12 * u, 'font-size': 12 * u }, `${x}, ${y}`),
      ));
    }
  }
}

/** The area enclosed by a polygon, in square pixels. */
/** The box around some corners, in whole pixels. */
function boxOf(points: ReadonlyArray<Point>): { x: number; y: number; width: number; height: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const x = Math.round(Math.min(...xs));
  const y = Math.round(Math.min(...ys));
  return { x, y, width: Math.round(Math.max(...xs)) - x, height: Math.round(Math.max(...ys)) - y };
}

function polygonArea(points: ReadonlyArray<{ x: number; y: number }>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
