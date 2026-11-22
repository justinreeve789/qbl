import { animationDuration, characterAnimationRepeats, isPose } from './characters.js';
import { inHotspot, isWalkable, nearestWalkable, type WalkContext } from './geometry.js';
import type { ScenarioIndex } from './scenario.js';
import {
  BUILT_IN_MOVES,
  type Action, type Character, type CharacterPlacement, type Condition, type GameEvent, type Hotspot, type Id, type Media, type Npc, type Point,
  type Scenario, type Scene, type VarValue, type WalkAction,
} from './types.js';
import { testConditions } from './variables.js';

/**
 * Walking: the rules shared by the game server (where characters are, and where they walk) and the
 * browser (the player's own avatar walked by an action, and single-player games).
 */

/** Whether a character walks around on its own (see `Npc.roams`). */
export function characterRoams(npc: Pick<Npc, 'roams'> | null | undefined): boolean {
  return npc?.roams === true;
}

/** Where a character starts: a scene, and a spot in it. */
export interface CharacterStart {
  scene: Scene;
  x: number;
  y: number;
  facing?: 'left' | 'right';
}

/**
 * Where a character starts: its own scene and spot, or, for one written before characters had
 * them, its first placement, taking the scenes in order. Null when it is in no scene.
 */
export function characterStart(scenario: Pick<Scenario, 'scenes'>, npc: Pick<Npc, 'id' | 'scene_id' | 'position_x' | 'position_y' | 'facing'>): CharacterStart | null {
  if (npc.scene_id != null) {
    const scene = scenario.scenes.find((s) => s.id === npc.scene_id);
    if (!scene) return null;
    const middle = { x: (scene.width ?? 800) / 2, y: (scene.height ?? 600) * 0.75 };
    return {
      scene,
      x: typeof npc.position_x === 'number' ? npc.position_x : middle.x,
      y: typeof npc.position_y === 'number' ? npc.position_y : middle.y,
      facing: npc.facing === 'left' ? 'left' : npc.facing === 'right' ? 'right' : undefined,
    };
  }
  const placed = firstPlacement(scenario, npc.id);
  return placed ? { scene: placed.scene, x: placed.placement.position_x, y: placed.placement.position_y, facing: placed.placement.facing } : null;
}

/** A character's first placement in the scenes (before characters had a start of their own). */
export function firstPlacement(scenario: Pick<Scenario, 'scenes'>, characterId: Id): { scene: Scene; placement: CharacterPlacement } | null {
  for (const scene of scenario.scenes) {
    const placement = (scene.characters ?? []).find((p) => p.character_id === characterId);
    if (placement) return { scene, placement };
  }
  return null;
}

/** Visit every action of a list, including those on infobox buttons and conversation choices. */
export function eachActionIn(actions: Action[] | undefined, visit: (a: Action) => void): void {
  const walk = (a: Action) => {
    visit(a);
    if (a.type === 'infobox') for (const cta of a.call_to_actions ?? []) if (cta.action) walk(cta.action as Action);
    if (a.type === 'conversation') for (const line of a.lines ?? []) for (const c of line.choices ?? []) for (const inner of c.actions ?? []) walk(inner as Action);
  };
  for (const a of actions ?? []) walk(a);
}

/** Every event of a scenario with where it belongs: a scene's, or a character's own. */
export function allEvents(scenario: Pick<Scenario, 'scenes' | 'characters'>): Array<{ event: GameEvent; scene: Scene | null; character: Npc | null }> {
  const out: Array<{ event: GameEvent; scene: Scene | null; character: Npc | null }> = [];
  for (const scene of scenario.scenes) {
    for (const key of ['start_events', 'end_events', 'hotspots', 'indirect_events'] as const) {
      for (const event of scene[key] ?? []) out.push({ event, scene, character: null });
    }
  }
  for (const character of scenario.characters ?? []) for (const event of character.events ?? []) out.push({ event, scene: null, character });
  return out;
}

/**
 * Where a character can be, as far as the document says: null when anywhere (it walks around on
 * its own), else the scene it starts in and every scene a walk action sends it to.
 */
export function characterScenes(scenario: Pick<Scenario, 'scenes' | 'characters'>, npc: Npc): Set<Id> | null {
  if (characterRoams(npc)) return null;
  const out = new Set<Id>();
  const start = characterStart(scenario, npc);
  if (start) out.add(start.scene.id);
  for (const { event, scene } of allEvents(scenario)) {
    eachActionIn(event.actions, (a) => {
      if (a.type !== 'walk' || (a.target ?? 'character') !== 'character' || a.character_id !== npc.id) return;
      const to = a.scene_id ?? scene?.id;
      if (to != null) out.add(to);
    });
  }
  return out;
}

/**
 * Whether a character is sure to be in a scene when an action of that scene runs: `here` (it is
 * only ever there), `maybe` (it can be there, and elsewhere), `anywhere` (it walks around on its
 * own) or `never` (nothing ever takes it there).
 */
export function characterPresence(scenario: Pick<Scenario, 'scenes' | 'characters'>, npc: Npc, sceneId: Id): 'here' | 'maybe' | 'anywhere' | 'never' {
  const scenes = characterScenes(scenario, npc);
  if (!scenes) return 'anywhere';
  if (!scenes.has(sceneId)) return 'never';
  return scenes.size === 1 ? 'here' : 'maybe';
}

/** How fast a character walks, in scene pixels per second. */
export function walkSpeed(scenario: Pick<Scenario, 'move_speed'>, npc: Pick<Npc, 'walk_speed'> | null | undefined, action?: Pick<WalkAction, 'speed'>): number {
  const pick = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.min(v, 5000) : null);
  return pick(action?.speed) ?? pick(npc?.walk_speed) ?? pick(scenario.move_speed) ?? 420;
}

/**
 * The conditions a character can be held to: those on shared (room) variables. A player's own
 * variables mean nothing to a character walking for everyone, so those conditions are left out.
 */
export function roomConditions(scenario: Pick<Scenario, 'global_variables'>, conditions: Condition[] | null | undefined): Condition[] {
  if (!conditions?.length) return [];
  const room = new Set((scenario.global_variables ?? []).filter((v) => v.scope === 'room').map((v) => v.variable_name));
  return conditions.filter((c) => room.has(c.variable));
}

/** Whether the room-variable conditions in a list hold. */
export function roomConditionsHold(
  scenario: Pick<Scenario, 'global_variables'>, conditions: Condition[] | null | undefined, get: (name: string) => VarValue | undefined,
): boolean {
  return testConditions(roomConditions(scenario, conditions), get);
}

// ------------------------------------------------------------------ doors

/** A way out of a scene: a hotspot whose actions jump to another scene. */
export interface Door {
  hotspot: Hotspot;
  /** The scene it is in. */
  from: Id;
  /** The scene it leads to, and where in it one arrives. */
  to: Id;
  spawn_point?: string;
  /** The hotspot's conditions and the jump action's. */
  conditions: Condition[];
}

/**
 * The doors of a scene: its hotspots with a jump action of their own (not one on an infobox
 * button: a character does not press buttons). The first jump of each hotspot is the one used.
 */
export function doorsOf(scene: Scene): Door[] {
  const out: Door[] = [];
  for (const hotspot of scene.hotspots ?? []) {
    const jump = (hotspot.actions ?? []).find((a) => a.type === 'jump');
    if (!jump || jump.type !== 'jump' || jump.scene_id === scene.id) continue;
    out.push({ hotspot, from: scene.id, to: jump.scene_id, spawn_point: jump.spawn_point, conditions: [...(hotspot.conditions ?? []), ...(jump.conditions ?? [])] });
  }
  // Walk-in doors first: they are the ones meant to be walked through.
  return out.sort((a, b) => Number(a.hotspot.activate_by_trigger === true) - Number(b.hotspot.activate_by_trigger === true));
}

/**
 * The doors to go through, in order, to get from one scene to another: the fewest rooms, through
 * the doors `open` lets through. Empty when already there; null when there is no way.
 */
export function routeBetween(index: ScenarioIndex, from: Id, to: Id, open: (door: Door) => boolean = () => true): Door[] | null {
  if (from === to) return [];
  const came = new Map<Id, Door | null>([[from, null]]);
  const queue: Id[] = [from];
  while (queue.length) {
    const here = queue.shift()!;
    const scene = index.scene(here);
    if (!scene) continue;
    for (const door of doorsOf(scene)) {
      if (came.has(door.to) || !index.scene(door.to) || !open(door)) continue;
      came.set(door.to, door);
      if (door.to === to) {
        const route: Door[] = [];
        for (let d: Door | null | undefined = door; d; d = came.get(d.from)) route.unshift(d);
        return route;
      }
      queue.push(door.to);
    }
  }
  return null;
}

/**
 * Where to walk to go through a door: its centre, or, when that cannot be stood on (a door along
 * the edge of the scene is often half outside it), the nearest spot inside the hotspot that can.
 */
export function doorPoint(ctx: WalkContext, hotspot: Pick<Hotspot, 'position_x' | 'position_y' | 'radius'>, from: Point): Point | null {
  if ((hotspot.radius ?? -1) < 0) return from;
  const centre = { x: hotspot.position_x ?? from.x, y: hotspot.position_y ?? from.y };
  if (isWalkable(ctx, centre.x, centre.y)) return centre;
  const near = nearestWalkable(ctx, centre, Math.max(20, hotspot.radius ?? 0), 8);
  return near && inHotspot(hotspot, near.x, near.y) ? near : null;
}

// --------------------------------------------------------------- wandering

/** How many spots a character walks to in a scene before it leaves, and how long it stops at each (ms). */
export const WANDER_SPOTS = { min: 3, max: 7 } as const;
export const WANDER_PAUSE = { min: 2000, max: 10_000 } as const;

/** A whole number from `min` to `max`, both included. */
export function randomBetween(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/**
 * Spots for a character to walk to in a scene: 3 to 7 of them, in the walkable area, each one it
 * can get to from where it stands (`reachable`). Fewer when the scene has little room. Spots are
 * kept apart, so that it really walks between them.
 */
export function wanderSpots(ctx: WalkContext, from: Point, random: () => number, reachable: (from: Point, to: Point) => boolean): Point[] {
  const wanted = randomBetween(random, WANDER_SPOTS.min, WANDER_SPOTS.max);
  const apart = Math.max(40, Math.min(ctx.width, ctx.height) * 0.08);
  const out: Point[] = [];
  for (let tries = 0; out.length < wanted && tries < wanted * 40; tries++) {
    const at = { x: random() * ctx.width, y: random() * ctx.height };
    if (!isWalkable(ctx, at.x, at.y)) continue;
    const previous = out[out.length - 1] ?? from;
    if (Math.hypot(at.x - previous.x, at.y - previous.y) < apart) continue;
    if (!reachable(from, at)) continue;
    out.push({ x: Math.round(at.x), y: Math.round(at.y) });
  }
  return out;
}

/** The doors a character walking around on its own may leave by: those with no conditions at all, into a scene that exists. */
export function openDoors(index: ScenarioIndex, scene: Scene): Door[] {
  return doorsOf(scene).filter((d) => d.conditions.length === 0 && !!index.scene(d.to));
}

/**
 * How long a character's move lasts, as its own animation of that name says or else the built-in
 * move: 0 when it loops until stopped, or means nothing to this character.
 */
export function moveDuration(character: Pick<Character, 'animations'> | null | undefined, name: string, mediaOf: (id: Id) => Media | undefined): number {
  const drawn = !isPose(name) ? character?.animations?.[name] : undefined;
  if (drawn) return characterAnimationRepeats(name, drawn) ? 0 : Math.max(1, animationDuration(drawn, mediaOf(drawn.media_id)) || 600);
  const builtIn = BUILT_IN_MOVES[name];
  return builtIn && !builtIn.repeat ? builtIn.duration : 0;
}
