import type { Row } from '../../api';
import { params, sceneLabel } from '../../describe';
import type { Store } from '../../store';
import { SceneModel, type Point, type Side } from '../scene/model';

/**
 * The scene map's model: which scenes lead to which, where each scene's box sits on the map, and
 * making and removing the jumps that link two scenes. Nothing here touches the page.
 *
 * A box's place is kept in the scene's own params, as `editor_map: { x, y }`, so it is saved with
 * the scenario, travels in its ZIP, and is the same for everyone who edits it. The game ignores it.
 */

/** How a player takes an exit: walks into it, clicks it, an event sends them, or a button in an infobox. */
export type ExitKind = 'walk' | 'click' | 'story' | 'button';

/** One jump to another scene, and what in the scene holds it. */
export interface Exit {
  from: number;
  /** The scene it goes to: null when none is chosen yet, or that scene was deleted. */
  to: number | null;
  event: Row;
  /** The jump action, or (for a button) the infobox action whose button holds the jump. */
  action: Row;
  /** True for a jump on an infobox button: it is part of that action, not a row of its own. */
  inButton: boolean;
  kind: ExitKind;
  /** True when a condition decides whether it is there (on the event, the action or the button). */
  gated: boolean;
  /** The edge of the scene it sits on, for a hotspot along an edge. */
  side: Side | null;
  /** The spawn point players arrive at in the other scene. */
  spawn: string | null;
}

/** Every exit from one scene to another, drawn as one arrow. */
export interface Link {
  from: number;
  to: number;
  exits: Exit[];
}

/** A scene's box on the map, in map pixels. */
export const BOX = { width: 196, height: 150 } as const;
/** The distance between neighbouring boxes when the map lays them out. */
const STEP = { x: 280, y: 220 } as const;
const MARGIN = 40;

export const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const VECTOR: Record<Side, readonly [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

export function scenesInOrder(store: Store): Row[] {
  return [...store.rows('scenes')].sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);
}

/** The scene players start in: the scenario's start scene, or else the first. */
export function startScene(store: Store): number | null {
  const start = store.scenario.start_scene_id as number | null;
  return store.byId('scenes', start) ? start : (scenesInOrder(store)[0]?.id ?? null);
}

/** Which edge of its scene a hotspot sits on, if it is an edge exit. */
export function hotspotSide(store: Store, event: Row): Side | null {
  if (event.kind !== 'hotspot') return null;
  const named = /^edge-(left|right|top|bottom)\b/.exec(String(event.shortname ?? ''));
  if (named) return named[1] as Side;
  // An edge band has one coordinate: x for the left and right edges, y for the top and bottom.
  const x = event.position_x;
  const y = event.position_y;
  if ((x == null) === (y == null)) return null;
  const { width, height } = new SceneModel(store, event.scene_id as number).size(() => null);
  if (y == null) return Number(x) <= width / 2 ? 'left' : 'right';
  return Number(y) <= height / 2 ? 'top' : 'bottom';
}

/** Jumps inside an action's other attributes (an infobox's buttons), with whether a condition guards each. */
function nestedJumps(value: unknown, gated: boolean, found: Array<{ jump: Record<string, unknown>; gated: boolean }>) {
  if (Array.isArray(value)) {
    for (const v of value) nestedJumps(v, gated, found);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const bag = value as Record<string, unknown>;
  const guarded = gated || (Array.isArray(bag.conditions) && bag.conditions.length > 0);
  if (bag.type === 'jump') {
    found.push({ jump: bag, gated: guarded });
    return;
  }
  for (const v of Object.values(bag)) nestedJumps(v, guarded, found);
}

/** Every jump in the scenario, scene by scene. */
export function sceneExits(store: Store): Exit[] {
  const scenes = new Set(store.rows('scenes').map((s) => s.id));
  const target = (id: unknown): number | null => (id != null && id !== '' && scenes.has(Number(id)) ? Number(id) : null);
  const exits: Exit[] = [];
  const events = [...store.rows('events')].sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || a.id - b.id);
  for (const event of events) {
    const from = event.scene_id as number;
    if (!scenes.has(from)) continue;
    const eventGated = store.where('conditions', 'event_id', event.id).length > 0;
    const kind: ExitKind = event.kind === 'hotspot' ? (event.activate_by_trigger ? 'click' : 'walk') : 'story';
    const side = hotspotSide(store, event);
    const actions = store.where('actions', 'event_id', event.id).sort((a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0) || a.id - b.id);
    for (const action of actions) {
      const values = params(action);
      const actionGated = eventGated || store.where('conditions', 'action_id', action.id).length > 0;
      if (action.type === 'jump') {
        exits.push({ from, to: target(values.scene_id), event, action, inButton: false, kind, gated: actionGated, side, spawn: (values.spawn_point as string | undefined) || null });
        continue;
      }
      const found: Array<{ jump: Record<string, unknown>; gated: boolean }> = [];
      nestedJumps(values, actionGated, found);
      for (const { jump, gated } of found) {
        exits.push({ from, to: target(jump.scene_id), event, action, inButton: true, kind: 'button', gated, side: null, spawn: (jump.spawn_point as string | undefined) || null });
      }
    }
  }
  return exits;
}

/** The exits grouped into one link per pair of scenes and direction. */
export function sceneLinks(exits: Exit[]): Link[] {
  const links = new Map<string, Link>();
  for (const exit of exits) {
    if (exit.to == null) continue;
    const key = `${exit.from}>${exit.to}`;
    const link = links.get(key) ?? links.set(key, { from: exit.from, to: exit.to, exits: [] }).get(key)!;
    link.exits.push(exit);
  }
  return [...links.values()];
}

/** The scenes a player can get to from the start scene by any exit (guarded ones included). */
export function reachable(store: Store, links: Link[]): Set<number> {
  const start = startScene(store);
  const seen = new Set<number>(start == null ? [] : [start]);
  const queue = [...seen];
  while (queue.length) {
    const at = queue.shift()!;
    for (const link of links) {
      if (link.from === at && !seen.has(link.to)) {
        seen.add(link.to);
        queue.push(link.to);
      }
    }
  }
  return seen;
}

/** Where the author put a scene's box, if they have. */
export function savedPosition(scene: Row): Point | null {
  const at = params(scene).editor_map as { x?: unknown; y?: unknown } | undefined;
  return at && Number.isFinite(Number(at.x)) && Number.isFinite(Number(at.y)) && at.x != null && at.y != null ? { x: Number(at.x), y: Number(at.y) } : null;
}

/** Remember where a scene's box is. */
export function savePosition(store: Store, sceneId: number, at: Point) {
  const scene = store.byId('scenes', sceneId);
  if (!scene) return Promise.resolve(undefined);
  return store.patch('scenes', sceneId, { params: { ...params(scene), editor_map: { x: Math.round(at.x), y: Math.round(at.y) } } });
}

/** The direction from one scene to the next that an exit suggests: its edge, or the other scene's edge back. */
function direction(links: Link[], from: number, to: number): readonly [number, number] {
  const out = links.find((l) => l.from === from && l.to === to)?.exits.find((e) => e.side)?.side;
  if (out) return VECTOR[out];
  const back = links.find((l) => l.from === to && l.to === from)?.exits.find((e) => e.side)?.side;
  if (back) return VECTOR[OPPOSITE[back]];
  return VECTOR.right;
}

/** Cells around one, nearest first, out to some distance. */
function* around(c: number, r: number, reach = 12): Generator<readonly [number, number]> {
  for (let ring = 0; ring <= reach; ring++) {
    const cells: Array<readonly [number, number]> = [];
    for (let dc = -ring; dc <= ring; dc++) {
      for (let dr = -ring; dr <= ring; dr++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) === ring) cells.push([c + dc, r + dr]);
      }
    }
    cells.sort((a, b) => Math.hypot(a[0] - c, a[1] - r) - Math.hypot(b[0] - c, b[1] - r));
    yield* cells;
  }
}

/**
 * A layout for every scene, as the map would draw it from nothing: the start scene first, and
 * each scene it leads to beside it on the side its exit is on (a scene reached by walking off
 * the right edge goes to the right), so the map looks like the world it describes. Scenes that
 * nothing connects to the start are laid out the same way underneath.
 */
export function autoLayout(store: Store, links: Link[]): Map<number, Point> {
  const order = scenesInOrder(store).map((s) => s.id);
  const start = startScene(store);
  const cells = new Map<number, readonly [number, number]>();
  const taken = new Set<string>();
  const put = (id: number, c: number, r: number) => {
    for (const [cc, rr] of around(c, r)) {
      if (taken.has(`${cc},${rr}`)) continue;
      taken.add(`${cc},${rr}`);
      cells.set(id, [cc, rr]);
      return;
    }
  };
  const neighbours = (id: number) => {
    const next: number[] = [];
    for (const l of links) {
      if (l.from === id && !next.includes(l.to)) next.push(l.to);
      if (l.to === id && !next.includes(l.from)) next.push(l.from);
    }
    return next.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  };
  const roots = start == null ? order : [start, ...order.filter((id) => id !== start)];
  for (const root of roots) {
    if (cells.has(root)) continue;
    const lowest = Math.max(-2, ...[...cells.values()].map(([, r]) => r));
    put(root, 0, lowest + 2);
    const queue = [root];
    while (queue.length) {
      const at = queue.shift()!;
      const [c, r] = cells.get(at)!;
      for (const next of neighbours(at)) {
        if (cells.has(next)) continue;
        const [dc, dr] = direction(links, at, next);
        put(next, c + dc, r + dr);
        queue.push(next);
      }
    }
  }
  const minC = Math.min(...[...cells.values()].map(([c]) => c));
  const minR = Math.min(...[...cells.values()].map(([, r]) => r));
  return new Map([...cells].map(([id, [c, r]]) => [id, { x: MARGIN + (c - minC) * STEP.x, y: MARGIN + (r - minR) * STEP.y }]));
}

/** True when a box at `at` would overlap one of the others. */
function crowded(at: Point, others: Iterable<Point>): boolean {
  for (const o of others) {
    if (Math.abs(o.x - at.x) < BOX.width + 40 && Math.abs(o.y - at.y) < BOX.height + 40) return true;
  }
  return false;
}

/** The nearest place to `wanted` where a box overlaps none of the others. */
export function freeSpot(wanted: Point, others: Iterable<Point>): Point {
  const list = [...others];
  for (const [c, r] of around(0, 0, 20)) {
    const at = { x: wanted.x + c * (STEP.x / 2), y: wanted.y + r * (STEP.y / 2) };
    if (!crowded(at, list)) return at;
  }
  return wanted;
}

/**
 * Where every box is drawn: where the author put it, or, for a scene not placed yet, beside a
 * placed scene it is linked to, or else under the others. With nothing placed, the whole map is
 * laid out automatically.
 */
export function positions(store: Store, links: Link[]): Map<number, Point> {
  const scenes = scenesInOrder(store);
  const placed = new Map<number, Point>();
  for (const s of scenes) {
    const at = savedPosition(s);
    if (at) placed.set(s.id, at);
  }
  if (!placed.size) return autoLayout(store, links);
  for (const s of scenes) {
    if (placed.has(s.id)) continue;
    const link = links.find((l) => (l.to === s.id && placed.has(l.from)) || (l.from === s.id && placed.has(l.to)));
    let wanted: Point;
    if (link) {
      const other = link.from === s.id ? link.to : link.from;
      const [dc, dr] = direction(links, other, s.id);
      const base = placed.get(other)!;
      wanted = { x: base.x + dc * STEP.x, y: base.y + dr * STEP.y };
    } else {
      const bottom = Math.max(...[...placed.values()].map((p) => p.y));
      wanted = { x: MARGIN, y: bottom + STEP.y };
    }
    placed.set(s.id, freeSpot(wanted, placed.values()));
  }
  return placed;
}

/** The edges to try for an exit towards something that far away, best first. */
export function sidesTowards(dx: number, dy: number): Side[] {
  const across: Side = dx >= 0 ? 'right' : 'left';
  const down: Side = dy >= 0 ? 'bottom' : 'top';
  return Math.abs(dx) >= Math.abs(dy) ? [across, down, OPPOSITE[down], OPPOSITE[across]] : [down, across, OPPOSITE[across], OPPOSITE[down]];
}

/**
 * The spawn point to arrive at when coming in through an edge: the one nearest the edge opposite
 * the exit (walking off the right edge, you arrive on the left). None when the scene has none.
 */
export function arrivalSpawn(store: Store, sceneId: number, exitSide: Side | null): string | null {
  const spawns = new SceneModel(store, sceneId).layout<{ name?: string; x?: number; y?: number }>('spawn_points').filter((p) => p.name);
  if (!spawns.length || !exitSide) return null;
  const score = {
    right: (p: { x?: number }) => Number(p.x ?? 0),
    left: (p: { x?: number }) => -Number(p.x ?? 0),
    bottom: (p: { y?: number }) => Number(p.y ?? 0),
    top: (p: { y?: number }) => -Number(p.y ?? 0),
  }[exitSide];
  return [...spawns].sort((a, b) => score(a) - score(b))[0]!.name!;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';

/**
 * Link one scene to another: a walk-in exit along the edge of `from` that faces `to` on the map,
 * with a jump to `to`. An edge that already has an exit is skipped; with all four taken, the exit
 * is a hotspot players click, in the middle of the scene. Returns the new event's id and its edge.
 */
export async function addLink(store: Store, from: number, to: number, towards: Point): Promise<{ eventId: number; side: Side | null } | undefined> {
  const used = new Set(store.where('events', 'scene_id', from).map((e) => hotspotSide(store, e)).filter(Boolean));
  const side = sidesTowards(towards.x, towards.y).find((s) => !used.has(s)) ?? null;
  const model = new SceneModel(store, from);
  const size = model.size(() => null);
  const attrs = side
    ? model.edgeHotspot(side, size)
    : { shortname: `to-${slug(sceneLabel(store.byId('scenes', to)))}`, activate_by_trigger: true, position_x: Math.round(size.width / 2), position_y: Math.round(size.height / 2), radius: 80 };
  const event = await store.add('events', { scene_id: from, kind: 'hotspot', ...attrs });
  if (!event) return undefined;
  const spawn = arrivalSpawn(store, to, side);
  await store.add('actions', { event_id: event.id, type: 'jump', params: spawn ? { scene_id: to, spawn_point: spawn } : { scene_id: to } });
  return { eventId: event.id, side };
}

/**
 * Remove an exit. A hotspot or event that does nothing but jump goes with it; one that also does
 * other things keeps them and loses only the jump. A jump on an infobox button is changed in the
 * scene editor, with the rest of its infobox.
 */
export async function removeExit(store: Store, exit: Exit): Promise<boolean> {
  if (exit.inButton) return false;
  const others = store.where('actions', 'event_id', exit.event.id).filter((a) => a.id !== exit.action.id);
  return others.length ? store.remove('actions', exit.action.id) : store.remove('events', exit.event.id);
}

/** What removing an exit takes away, in words, for the question asked first. */
export function removalNote(store: Store, exit: Exit): string {
  const others = store.where('actions', 'event_id', exit.event.id).filter((a) => a.id !== exit.action.id);
  const what = exit.event.kind === 'hotspot' ? 'hotspot' : 'event';
  return others.length ? `the jump in the ${what} “${String(exit.event.shortname ?? exit.event.id)}” (its other actions stay)` : `the ${what} “${String(exit.event.shortname ?? exit.event.id)}” and its jump`;
}
