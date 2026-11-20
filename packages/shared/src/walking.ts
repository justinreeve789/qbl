import { animationDuration, characterAnimationRepeats, isPose } from './characters.js';
import { inHotspot, isWalkable, nearestWalkable, type WalkContext } from './geometry.js';
import type { ScenarioIndex } from './scenario.js';
import {
  BUILT_IN_MOVES,
  type Character, type CharacterPlacement, type Condition, type Hotspot, type Id, type Media, type Npc, type Point,
  type Routine, type RoutineStep, type Scenario, type Scene, type VarValue, type WalkAction,
} from './types.js';
import { testConditions } from './variables.js';

/**
 * Walking: the rules shared by the game server (characters that roam) and the browser (characters
 * walking on one player's screen, and the player's own avatar walked by an action).
 */

/** Whether a character lives in the world and walks around it on its own (see `Npc.roams`). */
export function characterRoams(npc: Pick<Npc, 'roams' | 'routine'> | null | undefined): boolean {
  return npc?.roams === true || (npc?.routine?.steps?.length ?? 0) > 0;
}

/** Where a roaming character starts: its first placement, taking the scenes in order. */
export function startPlacement(scenario: Pick<Scenario, 'scenes'>, characterId: Id): { scene: Scene; placement: CharacterPlacement } | null {
  for (const scene of scenario.scenes) {
    const placement = (scene.characters ?? []).find((p) => p.character_id === characterId);
    if (placement) return { scene, placement };
  }
  return null;
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

// --------------------------------------------------------------- routines

/** A routine as it should be: its steps' types checked, and loop on unless it says otherwise. */
export function normalizeRoutine(raw: unknown): Routine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<Routine>;
  const steps = (Array.isArray(r.steps) ? r.steps : []).filter(
    (s): s is RoutineStep => !!s && typeof s === 'object' && ['walk', 'wait', 'dialogue', 'animate', 'variable'].includes((s as RoutineStep).type),
  );
  if (!steps.length) return null;
  return { steps, loop: r.loop !== false, conditions: Array.isArray(r.conditions) ? r.conditions : [] };
}

/**
 * How long a character's move lasts, as its own animation of that name says or else the built-in
 * move: 0 when it loops until stopped, or means nothing to this character. The game server uses
 * this to wait for an animation in a routine, as the browser does in an event.
 */
export function moveDuration(character: Pick<Character, 'animations'> | null | undefined, name: string, mediaOf: (id: Id) => Media | undefined): number {
  const drawn = !isPose(name) ? character?.animations?.[name] : undefined;
  if (drawn) return characterAnimationRepeats(name, drawn) ? 0 : Math.max(1, animationDuration(drawn, mediaOf(drawn.media_id)) || 600);
  const builtIn = BUILT_IN_MOVES[name];
  return builtIn && !builtIn.repeat ? builtIn.duration : 0;
}
