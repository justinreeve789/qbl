import type { Row } from '../../api';
import { eventLabel, mediaUrl, params, sceneLabel } from '../../describe';
import { h, s } from '../../dom';
import { sortedActions } from '../actions';
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
  private scale = 1;

  constructor(private model: SceneModel, private host: Host) {
    this.stage.append(this.images, this.svg);
    this.element = h('div', { class: 'canvas-scroll', tabindex: '0' }, this.stage);

    this.svg.addEventListener('pointerdown', (e) => {
      // Reached only when nothing drawn handled the press: the empty scene.
      if (e.target === this.svg) this.host.select({ kind: 'scene' });
    });
    this.svg.addEventListener('pointermove', (e) => {
      const at = this.point(e);
      this.host.pointer(at);
      if (!this.drag) return;
      this.drag.moved = true;
      this.drag.move(at, this.drag.from);
      this.draw();
    });
    const finish = () => {
      const drag = this.drag;
      this.drag = null;
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
    this.svg.addEventListener('pointerleave', () => this.host.pointer(null));
    new ResizeObserver(() => !this.drag && this.zoom === 0 && this.draw()).observe(this.element);
  }

  /** Scene coordinates of the middle of what is visible, for placing new things. */
  center(): Point {
    const el = this.element;
    return {
      x: round((el.scrollLeft + el.clientWidth / 2) / this.scale),
      y: round((el.scrollTop + el.clientHeight / 2) / this.scale),
    };
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

    this.images.replaceChildren(...this.layerImages('background_media', W, H), ...this.layerImages('foreground_media', W, H));

    const selected = this.host.selection();
    const u = 1 / this.scale; // one screen pixel, in scene pixels
    const shapes: SVGElement[] = [];
    const top: SVGElement[] = []; // handles of the selected thing, drawn over everything else

    this.drawAreas('walkable_areas', selected, u, shapes, top);
    this.drawAreas('blocked_areas', selected, u, shapes, top);
    for (const event of this.model.events('hotspot')) this.drawHotspot(event, selected, u, W, H, shapes, top);
    this.drawSpawns(selected, u, shapes);
    this.drawPlacements('items', selected, u, shapes);
    this.drawPlacements('characters', selected, u, shapes);
    if (selected.kind === 'event') this.drawActionMarkers(selected.id, u, top);

    this.svg.replaceChildren(...shapes, ...top);
  }

  // ------------------------------------------------------------------ layers

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
        s('polygon', {
          class: `area ${which === 'walkable_areas' ? 'walkable' : 'blocked'}${isSelected ? ' selected' : ''}`,
          points: polygon.map((p) => `${p.x},${p.y}`).join(' '),
          onpointerdown: (e: PointerEvent) => this.begin(e, selection),
        }),
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
      shapes.push(s('rect', { class: `${cls} everywhere`, x: 4 * u, y: 4 * u, width: W - 8 * u, height: H - 8 * u, onpointerdown: (e: PointerEvent) => this.begin(e, selection) }));
      labelAt = { x: W / 2, y: 22 * u };
    } else if (x == null) {
      shapes.push(s('rect', { class: cls, x: 0, y: y! - r, width: W, height: 2 * r, onpointerdown: press }));
      labelAt = { x: W / 2, y: y! };
      handleAt = { x: W / 2, y: y! + r };
      resize = (to) => (event.radius = Math.max(4, Math.abs(to.y - y!)));
    } else if (y == null) {
      shapes.push(s('rect', { class: cls, x: x - r, y: 0, width: 2 * r, height: H, onpointerdown: press }));
      labelAt = { x, y: H / 2 };
      handleAt = { x: x + r, y: H / 2 };
      resize = (to) => (event.radius = Math.max(4, Math.abs(to.x - x)));
    } else {
      shapes.push(s('circle', { class: cls, cx: x, cy: y, r, onpointerdown: press }));
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
      if (tile) shapes.push(s('rect', { class: 'label-box', x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, onpointerdown: press }));
      else shapes.push(s('image', { class: 'label-image', href: url, x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, preserveAspectRatio: 'none', onpointerdown: press }));
    } else {
      const text = label.type === 'text' ? String(label.text ?? '') : `(${label.type})`;
      shapes.push(s('text', { class: 'label-text', x, y, 'font-size': 18 * Number(label.scale_y ?? 1), 'text-anchor': 'middle', 'dominant-baseline': 'middle', onpointerdown: press }, text));
    }
  }

  // ------------------------------------------------- spawn points, placements

  private drawSpawns(selected: Selection, u: number, shapes: SVGElement[]) {
    const spawns = this.model.layout('spawn_points');
    spawns.forEach((spawn, index) => {
      const selection: Selection = { kind: 'spawn', index };
      const x = Number(spawn.position_x ?? 0);
      const y = Number(spawn.position_y ?? 0);
      const dir = spawn.facing === 'left' ? -1 : 1;
      shapes.push(
        s(
          'g',
          { class: `spawn${sameSelection(selection, selected) ? ' selected' : ''}`, onpointerdown: (e: PointerEvent) => this.begin(e, selection, this.moveBag(spawn, () => this.model.setLayout('spawn_points', spawns))) },
          s('circle', { cx: x, cy: y, r: 9 * u }),
          s('path', { d: `M ${x + dir * 4 * u} ${y - 5 * u} L ${x + dir * 14 * u} ${y} L ${x + dir * 4 * u} ${y + 5 * u} Z` }),
          s('text', { class: 'shape-name', x, y: y + 22 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, `⚑ ${spawn.name ?? ''}`),
        ),
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
      const url = mediaUrl(store, store.byId('media', thing?.media_id as number | null));
      const size = url ? this.natural(url) : null;
      const scale = Number(params(thing ?? ({} as Row), 'settings').scale ?? 1);
      const group = s('g', {
        class: `placement ${which}${sameSelection(selection, selected) ? ' selected' : ''}`,
        onpointerdown: (e: PointerEvent) => this.begin(e, selection, this.moveBag(placement, () => this.model.setLayout(which, placements))),
      });
      if (url && size) {
        // Items and characters stand on their position: it is the middle of their bottom edge.
        const w = size.x * scale;
        const hgt = size.y * scale;
        const flip = placement.facing === 'left' ? `translate(${2 * x} 0) scale(-1 1)` : null;
        group.append(
          s('image', { href: url, x: x - w / 2, y: y - hgt, width: w, height: hgt, preserveAspectRatio: 'none', transform: flip }),
          s('rect', { class: 'outline', x: x - w / 2, y: y - hgt, width: w, height: hgt }),
        );
      } else {
        group.append(s('rect', { class: 'outline missing', x: x - 20 * u, y: y - 40 * u, width: 40 * u, height: 40 * u }));
      }
      group.append(s('text', { class: 'shape-name', x, y: y + 14 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, String(thing?.name ?? '(missing)')));
      shapes.push(group);
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

  /** For the selected event: where its "image in scene" and spritemap actions will appear. */
  private drawActionMarkers(eventId: number, u: number, top: SVGElement[]) {
    const store = this.model.store;
    for (const action of sortedActions({ store }, eventId)) {
      if (action.type !== 'image_fixed' && action.type !== 'spritemap') continue;
      const p = params(action);
      const x = Number(p.position_x ?? 0);
      const y = Number(p.position_y ?? 0);
      const press = (e: PointerEvent) =>
        this.begin(e, null, {
          move: (to, from) => {
            p.position_x = x + to.x - from.x;
            p.position_y = y + to.y - from.y;
          },
          end: () => void store.patch('actions', action.id, { params: p }),
        });
      const media = store.byId('media', action.media_id as number | null);
      const url = mediaUrl(store, media);
      const size = url ? this.natural(url) : null;
      const group = s('g', { class: 'action-marker', onpointerdown: press });
      if (url && size && action.type === 'image_fixed') {
        const w = size.x * Number(p.scale_x ?? 1) * Number(media?.scale_x ?? 1);
        const hgt = size.y * Number(p.scale_y ?? 1) * Number(media?.scale_y ?? 1);
        group.append(s('image', { href: url, x: x - w / 2, y: y - hgt / 2, width: w, height: hgt, preserveAspectRatio: 'none', opacity: 0.75 }));
      }
      group.append(
        s('path', { d: `M ${x - 10 * u} ${y} H ${x + 10 * u} M ${x} ${y - 10 * u} V ${y + 10 * u}` }),
        s('circle', { cx: x, cy: y, r: 7 * u }),
        s('text', { class: 'shape-name', x, y: y - 14 * u, 'font-size': 12 * u, 'text-anchor': 'middle' }, `Action #${action.id}`),
      );
      top.push(group);
    }
  }
}
