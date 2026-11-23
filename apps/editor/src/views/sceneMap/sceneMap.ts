import { mainLayerIndex } from '@qbl/shared';
import type { Row } from '../../api';
import { previewUrl } from '../../config';
import { eventLabel, mediaUrl, params, sceneLabel } from '../../describe';
import { clear, confirmDelete, h, help, s, toast } from '../../dom';
import type { FormContext } from '../../fields';
import { emojiIcon } from '../../icons';
import { sceneGroupControl } from '../glossary';
import type { Point, Side } from '../scene/model';
import { selectOnOpen } from '../scene/sceneEditor';
import {
  addLink, autoLayout, BOX, freeSpot, positions, reachable, removalNote, removeExit, savePosition, sceneExits, sceneLinks, scenesInOrder, startScene,
  type Exit, type ExitKind, type Link,
} from './graph';

/**
 * The Scenes page as a map: a box for every scene, an arrow for every way from one scene to
 * another. Boxes are dragged to lay the mission out; dragging a box's link handle onto another
 * box makes an exit between them; the pencil on a box opens it in the scene editor. Selecting a
 * box or an arrow shows its details beside the map, where exits can be changed or removed.
 */

type Selected = { kind: 'scene'; id: number } | { kind: 'link'; from: number; to: number } | null;

interface ViewState {
  zoom: number;
  x: number;
  y: number;
  selected: Selected;
  /** Set once the map has been fitted to the screen the first time it is shown. */
  framed: boolean;
  /** A box to give the keyboard focus back to after the page is redrawn. */
  focus: number | null;
}

/** Where each scenario's map was looked at, kept while the editor is open (the page is rebuilt on every change). */
const views = new Map<number, ViewState>();

const TWO_WAY_KEY = 'qbl.editor.map-two-way';
const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private mode: the choice lasts until the page is reloaded */
    }
  },
};

const KIND_TEXT: Record<ExitKind, string> = { walk: 'Walk-in hotspot', click: 'Hotspot players click', story: 'Event', button: 'Button in an infobox' };
const SIDE_TEXT: Record<Side, string> = { left: 'left edge', right: 'right edge', top: 'top edge', bottom: 'bottom edge' };
const ZOOM = { min: 0.25, max: 2 } as const;
const GRID = 20;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const centre = (p: Point): Point => ({ x: p.x + BOX.width / 2, y: p.y + BOX.height / 2 });

/** Where a line from a box's centre towards `towards` leaves the box, a few pixels out. */
function boxEdge(box: Point, towards: Point, gap = 6): Point {
  const c = centre(box);
  const dx = towards.x - c.x;
  const dy = towards.y - c.y;
  const length = Math.hypot(dx, dy) || 1;
  const t = Math.min(dx ? BOX.width / 2 / Math.abs(dx) : Infinity, dy ? BOX.height / 2 / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t + (dx / length) * gap, y: c.y + dy * t + (dy / length) * gap };
}

/** One arrow's path, bending to its own side when there is an arrow back, and the point halfway along it. */
function arrow(from: Point, to: Point, twoWay: boolean): { d: string; mid: Point } {
  const a0 = centre(from);
  const b0 = centre(to);
  const dx = b0.x - a0.x;
  const dy = b0.y - a0.y;
  const length = Math.hypot(dx, dy) || 1;
  // The normal on the right of the direction of travel: the two arrows of a pair sit either side.
  const n = { x: -dy / length, y: dx / length };
  const shift = twoWay ? 12 : 0;
  const bend = twoWay ? 26 : 0;
  const a = boxEdge(from, { x: b0.x + n.x * shift, y: b0.y + n.y * shift });
  const b = boxEdge(to, { x: a0.x + n.x * shift, y: a0.y + n.y * shift });
  const start = { x: a.x + n.x * shift, y: a.y + n.y * shift };
  const end = { x: b.x + n.x * shift, y: b.y + n.y * shift };
  const control = { x: (start.x + end.x) / 2 + n.x * bend, y: (start.y + end.y) / 2 + n.y * bend };
  const mid = { x: (start.x + 2 * control.x + end.x) / 4, y: (start.y + 2 * control.y + end.y) / 4 };
  return { d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`, mid };
}

/** An arrow from a scene back into itself, as a loop over its top-right corner. */
function loop(box: Point): { d: string; mid: Point } {
  const x = box.x + BOX.width - 46;
  const y = box.y - 4;
  return { d: `M ${x} ${y} C ${x - 6} ${y - 56}, ${x + 70} ${y - 56}, ${x + 46} ${y + 2}`, mid: { x: x + 28, y: y - 42 } };
}

function linkKind(link: Link): ExitKind {
  return link.exits[0]!.kind;
}

/** The main background picture of a scene (marked `main`, else the first), to show on its box. */
function thumbnail(ctx: FormContext, scene: Row): string | null {
  const layers = scene.background_media as Array<Record<string, unknown>> | null;
  const first = layers?.[mainLayerIndex(layers)];
  return first ? mediaUrl(ctx.store, ctx.store.byId('media', (first.media_id ?? first.id) as number | null)) : null;
}

export function sceneMap(ctx: FormContext, open: (sceneId: number) => void): HTMLElement {
  const { store } = ctx;
  const view = views.get(store.scenarioId) ?? views.set(store.scenarioId, { zoom: 1, x: 0, y: 0, selected: null, framed: false, focus: null }).get(store.scenarioId)!;

  // ------------------------------------------------------------------ the model
  const scenes = scenesInOrder(store);
  const byId = new Map(scenes.map((sc) => [sc.id, sc]));
  const exits = sceneExits(store);
  const links = sceneLinks(exits);
  const reach = reachable(store, links);
  const start = startScene(store);
  const at = positions(store, links);
  if (view.selected?.kind === 'scene' && !byId.has(view.selected.id)) view.selected = null;
  if (view.selected?.kind === 'link' && !links.some((l) => l.from === (view.selected as { from: number }).from && l.to === (view.selected as { to: number }).to)) view.selected = null;

  const nowhere = (id: number) => exits.filter((e) => e.from === id && e.to == null);
  const hasLink = (from: number, to: number) => links.some((l) => l.from === from && l.to === to);

  // ------------------------------------------------------------------ the page
  const world = h('div', { class: 'map-world' });
  const svg = s('svg', { class: 'map-links', width: 1, height: 1 }) as SVGSVGElement;
  const viewport = h('div', { class: 'map-viewport', 'data-map': '' }, world);
  const panel = h('aside', { class: 'map-panel', 'aria-label': 'Selected on the map', 'aria-live': 'polite' });
  const zoomLabel = h('button', { type: 'button', class: 'zoom-level', title: 'Back to 100%', onclick: () => zoomTo(1) });
  const twoWay = h('input', { type: 'checkbox', checked: storage.get(TWO_WAY_KEY) !== 'false', onchange: () => storage.set(TWO_WAY_KEY, String(twoWay.checked)) });
  const nodes = new Map<number, HTMLElement>();

  function applyView() {
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
    viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
    viewport.style.backgroundSize = `${GRID * view.zoom}px ${GRID * view.zoom}px`;
    viewport.dataset.zoom = String(Math.round(view.zoom * 100));
    zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`;
  }

  /** A point on the screen as a point on the map. */
  function toMap(clientX: number, clientY: number): Point {
    const r = viewport.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.zoom, y: (clientY - r.top - view.y) / view.zoom };
  }

  function zoomTo(zoom: number, around?: Point) {
    const r = viewport.getBoundingClientRect();
    const pivot = around ?? { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const before = toMap(pivot.x, pivot.y);
    view.zoom = clamp(zoom, ZOOM.min, ZOOM.max);
    view.x = pivot.x - r.left - before.x * view.zoom;
    view.y = pivot.y - r.top - before.y * view.zoom;
    applyView();
  }

  /** Show every scene, as large as fits (never above 100%). */
  function fit() {
    const w = viewport.clientWidth;
    const hgt = viewport.clientHeight;
    if (!w || !hgt || !at.size) return;
    const xs = [...at.values()].map((p) => p.x);
    const ys = [...at.values()].map((p) => p.y);
    const box = { x: Math.min(...xs) - 60, y: Math.min(...ys) - 80, w: Math.max(...xs) + BOX.width + 60 - (Math.min(...xs) - 60), h: Math.max(...ys) + BOX.height + 60 - (Math.min(...ys) - 80) };
    view.zoom = clamp(Math.min(w / box.w, hgt / box.h, 1), ZOOM.min, ZOOM.max);
    view.x = (w - box.w * view.zoom) / 2 - box.x * view.zoom;
    view.y = (hgt - box.h * view.zoom) / 2 - box.y * view.zoom;
    view.framed = true;
    applyView();
  }

  /** The middle of what is on the screen, as a place for a new box. */
  function middle(): Point {
    const r = viewport.getBoundingClientRect();
    const c = toMap(r.left + r.width / 2, r.top + r.height / 2);
    return { x: c.x - BOX.width / 2, y: c.y - BOX.height / 2 };
  }

  function select(next: Selected) {
    view.selected = next;
    paint();
  }

  // ------------------------------------------------------------------ arrows
  function drawLinks(linking?: { from: number; to: Point; over: number | null }) {
    const defs = s('defs', null, ...(['walk', 'click', 'story', 'button', 'pending'] as const).map((kind) =>
      s('marker', { id: `map-head-${kind}`, viewBox: '0 0 10 10', refX: 8.5, refY: 5, markerWidth: 13, markerHeight: 13, orient: 'auto', markerUnits: 'userSpaceOnUse' },
        s('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: `head ${kind}` }))));
    const sel = view.selected;
    const groups = links.map((link) => {
      const from = at.get(link.from);
      const to = at.get(link.to);
      if (!from || !to) return null;
      const kind = linkKind(link);
      const gated = link.exits.every((e) => e.gated);
      const isSelected = sel?.kind === 'link' && sel.from === link.from && sel.to === link.to;
      const touches = sel?.kind === 'scene' && (sel.id === link.from || sel.id === link.to);
      const faded = (sel?.kind === 'scene' && !touches) || (sel?.kind === 'link' && !isSelected);
      const path = link.from === link.to ? loop(from) : arrow(from, to, hasLink(link.to, link.from));
      const names = link.exits.map((e) => (e.inButton ? 'button' : e.side ? SIDE_TEXT[e.side] : eventLabel(e.event)));
      const tag = `${gated ? '🔒 ' : ''}${link.exits.length > 1 ? `${link.exits.length} exits` : names[0]}`;
      const title = `${sceneLabel(byId.get(link.from))} → ${sceneLabel(byId.get(link.to))}: ${names.join(', ')}${gated ? ' (only while a condition holds)' : ''}`;
      return s('g', {
        class: `map-link ${kind}${gated ? ' gated' : ''}${isSelected ? ' selected' : ''}${touches ? ' touches' : ''}${faded ? ' faded' : ''}`,
        'data-from': link.from, 'data-to': link.to,
        onpointerdown: (e: PointerEvent) => e.stopPropagation(),
        onclick: (e: MouseEvent) => {
          e.stopPropagation();
          select({ kind: 'link', from: link.from, to: link.to });
        },
      },
      s('title', null, title),
      s('path', { class: 'hit', d: path.d }),
      s('path', { class: 'line', d: path.d, 'marker-end': `url(#map-head-${kind})` }),
      s('text', { class: 'tag', x: path.mid.x, y: path.mid.y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, tag));
    });
    let pending: SVGElement | null = null;
    if (linking) {
      const from = at.get(linking.from)!;
      const target = linking.over != null ? at.get(linking.over) : undefined;
      const end = target ? boxEdge(target, centre(from)) : linking.to;
      const startAt = boxEdge(from, end, 2);
      pending = s('path', { class: 'pending', d: `M ${startAt.x} ${startAt.y} L ${end.x} ${end.y}`, 'marker-end': 'url(#map-head-pending)' });
    }
    clear(svg, defs, ...groups, pending);
  }

  // ------------------------------------------------------------------ boxes
  function node(scene: Row): HTMLElement {
    const id = scene.id;
    const url = thumbnail(ctx, scene);
    const out = exits.filter((e) => e.from === id && e.to != null && e.to !== id).length;
    const into = exits.filter((e) => e.to === id && e.from !== id).length;
    const broken = nowhere(id).length;
    const lost = !reach.has(id);
    const group = ((store.settings.scene_groups as Array<{ id: number; name?: string }> | undefined) ?? []).find((g) => g.id === scene.group_id);

    const port = h('button', {
      type: 'button', class: 'map-port', 'aria-label': `Link ${sceneLabel(scene)} to another scene`,
      title: 'Drag onto another scene to make a way there. Drop on empty space to make a new scene.',
    }, '+');
    const edit = h('button', {
      type: 'button', class: 'map-edit', 'aria-label': `Edit ${sceneLabel(scene)}`, title: 'Edit this scene',
      onclick: (e: MouseEvent) => {
        e.stopPropagation();
        open(id);
      },
    }, emojiIcon('✏️'));
    const box = h('div', {
      class: `map-node${id === start ? ' start' : ''}${lost ? ' lost' : ''}`,
      'data-scene': id, tabindex: 0, role: 'group', 'aria-roledescription': 'scene',
      'aria-label': `${sceneLabel(scene)}${id === start ? ', start scene' : ''}. ${out} way${out === 1 ? '' : 's'} out, ${into} way${into === 1 ? '' : 's'} in.${lost ? ' Players cannot reach it from the start scene.' : ''}`,
    },
    h('div', { class: 'map-thumb' },
      url ? h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }) : h('span', { class: 'map-thumb-none' }, sceneLabel(scene).slice(0, 1).toUpperCase()),
      id === start ? h('span', { class: 'map-start' }, emojiIcon('⭐'), 'Start') : null,
      edit),
    h('div', { class: 'map-node-body' },
      h('strong', { class: 'map-node-name', title: sceneLabel(scene) }, sceneLabel(scene)),
      h('span', { class: 'map-node-meta' }, `${out} out · ${into} in`, group ? h('span', { class: 'map-chip' }, String(group.name ?? `Group ${group.id}`)) : null),
      lost && id !== start ? h('span', { class: 'map-flag warn' }, 'No way in from the start') : null,
      broken ? h('span', { class: 'map-flag danger' }, `${broken} exit${broken === 1 ? '' : 's'} to nowhere`) : null),
    port);
    place(box, at.get(id)!);
    box.addEventListener('pointerdown', (e) => dragBox(e, id, box));
    port.addEventListener('pointerdown', (e) => dragLink(e, id));
    box.addEventListener('dblclick', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      open(id);
    });
    box.addEventListener('keydown', (e) => keyOnBox(e, id, box));
    nodes.set(id, box);
    return box;
  }

  function place(box: HTMLElement, p: Point) {
    box.style.left = `${p.x}px`;
    box.style.top = `${p.y}px`;
  }

  function paintBoxes() {
    const sel = view.selected;
    const near = new Set<number>();
    if (sel?.kind === 'scene') {
      near.add(sel.id);
      for (const l of links) if (l.from === sel.id || l.to === sel.id) near.add(l.from).add(l.to);
    }
    if (sel?.kind === 'link') near.add(sel.from).add(sel.to);
    for (const [id, box] of nodes) {
      box.classList.toggle('selected', sel?.kind === 'scene' && sel.id === id);
      box.classList.toggle('faded', sel != null && !near.has(id));
    }
  }

  function paint() {
    paintBoxes();
    drawLinks();
    drawPanel();
  }

  // ------------------------------------------------------------------ dragging
  /** Follow the pointer from a press until it is let go. Calls `end` with whether it moved. */
  function follow(e: PointerEvent, target: Element, move: (p: PointerEvent) => void, end: (moved: boolean, p: PointerEvent) => void) {
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    target.setPointerCapture(e.pointerId);
    const onMove = (p: PointerEvent) => {
      if (!moved && Math.hypot(p.clientX - x0, p.clientY - y0) < 4) return;
      moved = true;
      move(p);
    };
    const onUp = (p: PointerEvent) => {
      target.removeEventListener('pointermove', onMove as EventListener);
      target.removeEventListener('pointerup', onUp as EventListener);
      target.removeEventListener('pointercancel', onUp as EventListener);
      end(moved, p);
    };
    target.addEventListener('pointermove', onMove as EventListener);
    target.addEventListener('pointerup', onUp as EventListener);
    target.addEventListener('pointercancel', onUp as EventListener);
  }

  function dragBox(e: PointerEvent, id: number, box: HTMLElement) {
    // A press on the box is the box's, never the map's (which would start moving the map).
    e.stopPropagation();
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const grab = toMap(e.clientX, e.clientY);
    const from = { ...at.get(id)! };
    box.classList.add('dragging');
    follow(e, box, (p) => {
      const now = toMap(p.clientX, p.clientY);
      const to = { x: from.x + now.x - grab.x, y: from.y + now.y - grab.y };
      at.set(id, to);
      place(box, to);
      drawLinks();
    }, (moved) => {
      box.classList.remove('dragging');
      if (!moved) return select({ kind: 'scene', id });
      const to = at.get(id)!;
      const snapped = { x: Math.round(to.x / GRID) * GRID, y: Math.round(to.y / GRID) * GRID };
      view.selected = { kind: 'scene', id };
      view.focus = id;
      void savePositions(new Map([[id, snapped]]));
    });
  }

  function dragLink(e: PointerEvent, from: number) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const port = e.currentTarget as HTMLElement;
    viewport.classList.add('linking');
    let over: number | null = null;
    const under = (p: PointerEvent): number | null => {
      const hit = document.elementFromPoint(p.clientX, p.clientY)?.closest<HTMLElement>('.map-node');
      return hit ? Number(hit.dataset.scene) : null;
    };
    follow(e, port, (p) => {
      over = under(p);
      for (const [id, box] of nodes) box.classList.toggle('drop-target', id === over && id !== from);
      drawLinks({ from, to: toMap(p.clientX, p.clientY), over: over === from ? null : over });
    }, (moved, p) => {
      viewport.classList.remove('linking');
      for (const box of nodes.values()) box.classList.remove('drop-target');
      drawLinks();
      if (!moved) return toast('Drag the + onto another scene to make a way there, or onto empty space to make a new scene.');
      const target = under(p);
      if (target === from) return;
      if (target != null) return void link(from, target);
      const drop = toMap(p.clientX, p.clientY);
      void newScene({ x: drop.x - BOX.width / 2, y: drop.y - BOX.height / 2 }, from);
    });
  }

  // Dragging the background moves the map; the wheel scrolls it, and with Ctrl (or a pinch) zooms.
  viewport.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    const x0 = view.x;
    const y0 = view.y;
    viewport.classList.add('panning');
    follow(e, viewport, (p) => {
      view.x = x0 + p.clientX - e.clientX;
      view.y = y0 + p.clientY - e.clientY;
      applyView();
    }, (moved) => {
      viewport.classList.remove('panning');
      if (!moved && view.selected) select(null);
    });
  });
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) return zoomTo(view.zoom * Math.exp(-e.deltaY * 0.0025), { x: e.clientX, y: e.clientY });
    view.x -= e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
    view.y -= e.shiftKey && !e.deltaX ? 0 : e.deltaY;
    applyView();
  }, { passive: false });

  function keyOnBox(e: KeyboardEvent, id: number, box: HTMLElement) {
    if (e.target !== box) return;
    const step = e.shiftKey ? GRID * 5 : GRID;
    const moves: Record<string, Point> = { ArrowLeft: { x: -step, y: 0 }, ArrowRight: { x: step, y: 0 }, ArrowUp: { x: 0, y: -step }, ArrowDown: { x: 0, y: step } };
    const by = moves[e.key];
    if (by) {
      e.preventDefault();
      const p = at.get(id)!;
      view.selected = { kind: 'scene', id };
      view.focus = id;
      void savePositions(new Map([[id, { x: p.x + by.x, y: p.y + by.y }]]));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(id);
    } else if (e.key === ' ') {
      e.preventDefault();
      select({ kind: 'scene', id });
    } else if (e.key === 'Escape') {
      select(null);
    }
  }

  // ------------------------------------------------------------------ changes
  /**
   * Keep where boxes are. Every change is made in the editor at once (so the map is drawn once
   * more with all of them) and then sent in order.
   */
  async function savePositions(moved: Map<number, Point>) {
    // A scene that has never been placed is drawn where the map lays it out. Once one box is
    // placed by hand, the others keep where they were drawn rather than jumping about.
    const unplaced = scenes.filter((sc) => !moved.has(sc.id) && !params(sc).editor_map && at.has(sc.id));
    const all = [...moved, ...unplaced.map((sc) => [sc.id, at.get(sc.id)!] as const)];
    for (const [id, p] of all) void savePosition(store, id, p);
    await store.settled();
  }

  async function link(from: number, to: number) {
    const name = (id: number) => `“${sceneLabel(store.byId('scenes', id))}”`;
    const both = twoWay.checked && from !== to;
    const there = hasLink(from, to);
    const back = !both || hasLink(to, from);
    if (there && back) {
      select({ kind: 'link', from, to });
      return toast(both ? `${name(from)} and ${name(to)} are already linked both ways.` : `${name(from)} already leads to ${name(to)}.`);
    }
    const a = at.get(from)!;
    const b = at.get(to)!;
    view.selected = { kind: 'link', from: there ? to : from, to: there ? from : to };
    const made: string[] = [];
    if (!there) {
      const result = await addLink(store, from, to, { x: b.x - a.x, y: b.y - a.y });
      if (!result) return;
      made.push(`${name(from)} → ${name(to)}${result.side ? ` (${SIDE_TEXT[result.side]})` : ' (a hotspot to click)'}`);
    }
    if (!back) {
      const result = await addLink(store, to, from, { x: a.x - b.x, y: a.y - b.y });
      if (result) made.push(`${name(to)} → ${name(from)}${result.side ? ` (${SIDE_TEXT[result.side]})` : ' (a hotspot to click)'}`);
    }
    await savePositions(new Map());
    toast(`Linked: ${made.join(' and ')}. Select the arrow to change where players arrive.`);
  }

  async function newScene(where: Point | null, linkFrom?: number) {
    const name = window.prompt('Short name for the new scene (for example: forest-path):')?.trim();
    if (name == null) return;
    const spot = freeSpot(where ?? middle(), [...at.values()]);
    const row = await store.add('scenes', { shortname: name || undefined, params: { editor_map: { x: Math.round(spot.x), y: Math.round(spot.y) } } });
    if (!row) return;
    at.set(row.id, spot);
    view.selected = { kind: 'scene', id: row.id };
    if (linkFrom != null) await link(linkFrom, row.id);
    else await savePositions(new Map());
  }

  async function arrange() {
    const placed = scenes.some((sc) => params(sc).editor_map);
    if (placed && !window.confirm('Lay out every scene automatically? Scenes you have placed by hand move too.')) return;
    const layout = autoLayout(store, links);
    for (const [id, p] of layout) at.set(id, p);
    view.framed = false;
    await savePositions(layout);
  }

  // ------------------------------------------------------------------ the panel
  function exitLine(exit: Exit, direction: 'out' | 'in') {
    const other = direction === 'out' ? exit.to : exit.from;
    const how = exit.inButton ? 'button' : exit.side ? SIDE_TEXT[exit.side] : KIND_TEXT[exit.kind].toLowerCase();
    return h('li', null, h('button', {
      type: 'button', class: `link-chip ${exit.kind}`,
      onclick: () => other == null ? openAt(exit) : select({ kind: 'link', from: exit.from, to: exit.to! }),
    }, exit.gated ? emojiIcon('🔒') : null, direction === 'out' ? `→ ${other == null ? 'nowhere yet' : sceneLabel(byId.get(other))}` : `← ${sceneLabel(byId.get(other!))}`, h('small', null, ` ${how}`)));
  }

  function openAt(exit: Exit) {
    selectOnOpen(exit.from, { kind: 'event', id: exit.event.id });
    open(exit.from);
  }

  function scenePanel(scene: Row): Array<HTMLElement | null> {
    const id = scene.id;
    const url = thumbnail(ctx, scene);
    const outs = exits.filter((e) => e.from === id);
    const ins = exits.filter((e) => e.to === id && e.from !== id);
    return [
      url ? h('img', { class: 'map-panel-thumb', src: url, alt: '' }) : null,
      h('h2', null, sceneLabel(scene)),
      scene.subtitle ? h('p', { class: 'muted' }, String(scene.subtitle)) : null,
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', class: 'primary', onclick: () => open(id) }, emojiIcon('✏️'), 'Edit scene'),
        h('a', { class: 'button', href: previewUrl(store.scenarioId, id), target: 'qbl-preview' }, '▶ Test'),
        id === start ? h('span', { class: 'badge' }, 'Start scene') : h('button', { type: 'button', onclick: () => void store.patchScenario({ start_scene_id: id }, true) }, 'Start here')),
      sceneGroupControl(ctx, scene),
      !reach.has(id) ? h('p', { class: 'notice' }, 'No scene players can get to leads here, so players will never see it. Link a scene to it, or make it the start scene.') : null,
      h('h3', null, `Ways out (${outs.length})`),
      outs.length ? h('ul', { class: 'map-list' }, ...outs.map((e) => exitLine(e, 'out'))) : h('p', { class: 'muted' }, 'None. Drag this scene’s + onto another scene to make one.'),
      h('h3', null, `Ways in (${ins.length})`),
      ins.length ? h('ul', { class: 'map-list' }, ...ins.map((e) => exitLine(e, 'in'))) : h('p', { class: 'muted' }, id === start ? 'Players start here.' : 'None yet.'),
      h('div', { class: 'row-actions' }, h('button', {
        type: 'button', class: 'danger', disabled: scenes.length <= 1,
        onclick: () => confirmDelete(`the scene “${sceneLabel(scene)}” and everything in it`) && void store.remove('scenes', id),
      }, 'Delete scene')),
    ];
  }

  function exitCard(exit: Exit): HTMLElement {
    const target = exit.to != null ? store.byId('scenes', exit.to) : undefined;
    const spawns = target ? ((params(target, 'layout').spawn_points as Array<{ name?: string }> | undefined) ?? []).map((p) => p.name).filter((n): n is string => Boolean(n)) : [];
    const setJump = (attrs: Record<string, unknown>) => void store.patch('actions', exit.action.id, { params: { ...params(exit.action), ...attrs } }, true);
    const where = exit.inButton ? 'On a button in an infobox' : exit.side ? `${KIND_TEXT[exit.kind]} along the ${SIDE_TEXT[exit.side]}` : KIND_TEXT[exit.kind];
    const goes = h('select', { 'aria-label': 'Goes to', onchange: () => setJump({ scene_id: Number(goes.value) }) },
      ...scenes.map((sc) => h('option', { value: String(sc.id), selected: sc.id === exit.to }, sceneLabel(sc))));
    const arrive = h('select', { 'aria-label': 'Arrive at', onchange: () => setJump({ spawn_point: arrive.value || undefined }) },
      h('option', { value: '' }, 'Where the scene starts players'),
      ...spawns.map((n) => h('option', { value: n, selected: n === exit.spawn }, n)),
      exit.spawn && !spawns.includes(exit.spawn) ? h('option', { value: exit.spawn, selected: true }, `${exit.spawn} (missing)`) : null);
    return h('div', { class: `map-exit ${exit.kind}`, 'data-exit': exit.inButton ? `b${exit.action.id}` : String(exit.action.id) },
      h('div', { class: 'map-exit-head' }, h('strong', null, eventLabel(exit.event)), h('small', { class: 'muted' }, where)),
      exit.gated ? h('p', { class: 'muted' }, emojiIcon('🔒'), ' Only there while a condition holds.') : null,
      exit.inButton
        ? h('p', { class: 'muted' }, 'Change this button’s jump in the scene editor, with the rest of its infobox.')
        : h('div', { class: 'form' },
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Goes to'), goes),
          h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Arrive at'), arrive)),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', onclick: () => openAt(exit) }, emojiIcon('✏️'), 'Open in the scene'),
        exit.inButton ? null : h('button', {
          type: 'button', class: 'danger',
          onclick: () => confirmDelete(removalNote(store, exit)) && void removeExit(store, exit),
        }, 'Remove')));
  }

  function linkPanel(link: Link): Array<HTMLElement | null> {
    const from = byId.get(link.from)!;
    const to = byId.get(link.to)!;
    const back = hasLink(link.to, link.from);
    return [
      h('h2', null, `${sceneLabel(from)} → ${sceneLabel(to)}`),
      h('p', { class: 'muted' }, link.exits.length === 1 ? 'One way from the first scene to the second:' : `${link.exits.length} ways from the first scene to the second:`),
      ...link.exits.map(exitCard),
      h('div', { class: 'row-actions' },
        back
          ? h('button', { type: 'button', onclick: () => select({ kind: 'link', from: link.to, to: link.from }) }, `See the way back`)
          : h('button', {
            type: 'button',
            onclick: async () => {
              const a = at.get(link.from)!;
              const b = at.get(link.to)!;
              view.selected = { kind: 'link', from: link.to, to: link.from };
              const made = await addLink(store, link.to, link.from, { x: a.x - b.x, y: a.y - b.y });
              if (made) toast(`Added a way back from “${sceneLabel(to)}”${made.side ? ` along its ${SIDE_TEXT[made.side]}` : ''}.`);
            },
          }, 'Add the way back'),
        h('button', { type: 'button', onclick: () => select({ kind: 'scene', id: link.from }) }, `Select ${sceneLabel(from)}`)),
    ];
  }

  function overviewPanel(): Array<HTMLElement | null> {
    const lost = scenes.filter((sc) => !reach.has(sc.id));
    const broken = exits.filter((e) => e.to == null);
    const goTo = (id: number) => h('button', { type: 'button', class: 'link', onclick: () => select({ kind: 'scene', id }) }, sceneLabel(byId.get(id)));
    return [
      h('h2', null, 'How the scenes connect'),
      h('p', { class: 'muted' }, `${scenes.length} scene${scenes.length === 1 ? '' : 's'}, ${links.length} way${links.length === 1 ? '' : 's'} between them.`),
      lost.length ? h('div', { class: 'notice' }, h('strong', null, 'Players can’t reach: '), ...lost.flatMap((sc, i) => [i ? ', ' : null, goTo(sc.id)])) : null,
      broken.length ? h('div', { class: 'notice' }, h('strong', null, 'Exits that go nowhere yet: '), ...broken.flatMap((e, i) => [i ? ', ' : null, h('button', { type: 'button', class: 'link', onclick: () => openAt(e) }, `${sceneLabel(byId.get(e.from))} › ${eventLabel(e.event)}`)])) : null,
      h('ul', { class: 'map-help' },
        h('li', null, h('strong', null, 'Move a scene: '), 'drag its box.'),
        h('li', null, h('strong', null, 'Link two scenes: '), 'drag the ', h('span', { class: 'map-port inline' }, '+'), ' on a box onto another box. The exit goes on the edge that faces it on the map.'),
        h('li', null, h('strong', null, 'New scene: '), 'drag a ', h('span', { class: 'map-port inline' }, '+'), ' onto empty space, or use New scene.'),
        h('li', null, h('strong', null, 'Edit a scene: '), 'its ', emojiIcon('✏️'), ', or double-click it.'),
        h('li', null, h('strong', null, 'Change or remove a way: '), 'click its arrow.'),
        h('li', null, h('strong', null, 'Look around: '), 'drag the background; Ctrl and the mouse wheel zoom.')),
    ];
  }

  function drawPanel() {
    const sel = view.selected;
    const scene = sel?.kind === 'scene' ? byId.get(sel.id) : undefined;
    const link = sel?.kind === 'link' ? links.find((l) => l.from === sel.from && l.to === sel.to) : undefined;
    const close = sel ? h('button', { type: 'button', class: 'icon map-panel-close', 'aria-label': 'Close', title: 'Back to the overview', onclick: () => select(null) }, '×') : null;
    clear(panel, close, ...(scene ? scenePanel(scene) : link ? linkPanel(link) : overviewPanel()));
  }

  // ------------------------------------------------------------------ assembly
  world.append(svg, ...scenes.map(node));
  applyView();
  paint();
  requestAnimationFrame(() => {
    if (!view.framed) fit();
    if (view.focus != null) {
      nodes.get(view.focus)?.focus({ preventScroll: true });
      view.focus = null;
    }
  });

  const zoomBy = (factor: number) => zoomTo(view.zoom * factor);
  return h('div', { class: 'scene-map' },
    h('div', { class: 'map-toolbar' },
      h('button', { type: 'button', class: 'primary', onclick: () => void newScene(null) }, emojiIcon('➕'), 'New scene'),
      h('button', { type: 'button', title: 'Lay the scenes out from the start scene, each beside the edge that leads to it', onclick: () => void arrange() }, emojiIcon('✨'), 'Arrange for me'),
      h('span', { class: 'map-zoom', role: 'group', 'aria-label': 'Zoom' },
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.25) }, '−'),
        zoomLabel,
        h('button', { type: 'button', class: 'icon', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.25) }, '+'),
        h('button', { type: 'button', title: 'Show every scene', onclick: fit }, 'Fit')),
      h('label', { class: 'inline map-two-way' }, twoWay, 'Link both ways',
        help('When you link two scenes, also make the way back: walking off the right edge of the first leads to the second, and walking off the left edge of the second leads back. Untick it for one-way trips, such as a door that locks behind the player.')),
      h('span', { class: 'spacer' }),
      h('span', { class: 'map-legend muted' },
        h('span', { class: 'key walk' }), 'walk-in ',
        h('span', { class: 'key click' }), 'click ',
        h('span', { class: 'key story' }), 'event or button ',
        h('span', { class: 'key gated' }), 'needs a condition')),
    h('div', { class: 'map-body' }, viewport, panel));
}
