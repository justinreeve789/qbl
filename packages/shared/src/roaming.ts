import { distance, inHotspot, nearestWalkable, speedFactorAt, stepToward, type WalkContext } from './geometry.js';
import { Pathfinder, walkSignature } from './pathfinder.js';
import { dialogueDuration, type ScenarioIndex } from './scenario.js';
import type { Id, Npc, Point, Routine, RoutineStep, Scenario, Scene, VarValue, VariableOperator, WalkAction } from './types.js';
import { characterRoams, doorPoint, moveDuration, roomConditionsHold, routeBetween, startPlacement, walkSpeed, type Door } from './walking.js';

/**
 * Where a roaming character is, as the room state carries it to every player. Keyed by the
 * character's id (within the team's part of the room, like unique items).
 */
export interface NpcRec {
  character_id: number;
  scene_id: number;
  x: number;
  y: number;
  /** "left" or "right" */
  facing: string;
  /** Walking right now: the walking pose plays. */
  moving: boolean;
  /** The animation it was last asked to play, as `name:count` (as for players). Cleared when it walks. */
  anim: string;
  /** The routine line it is saying, as `count:step` (the step's index in its routine), or empty. */
  line: string;
  /** While it walks because a player's walk action asked: that request's ticket. Empty otherwise. */
  trip: string;
}

/** Where a character is to walk: a walk action or routine step, without who walks. */
export type WalkSpec = Pick<WalkAction, 'to' | 'position_x' | 'position_y' | 'spawn_point' | 'scene_id' | 'speed' | 'facing'>;

/** Where a roaming character was left, kept with the instance between sessions. */
export interface SavedNpc {
  scene_id: Id;
  x: number;
  y: number;
  facing?: string;
  /** The routine step it was on. */
  step?: number;
}

/** What Roamers needs from the World that owns it. */
export interface RoamerHost {
  scenario: Scenario;
  index: ScenarioIndex;
  /** The room state's map of characters (or a plain Map). */
  npcs: { get(key: string): NpcRec | undefined; set(key: string, value: NpcRec): unknown; forEach(cb: (value: NpcRec, key: string) => void): void };
  newNpc(): NpcRec;
  now(): number;
  /** Where feet may be in a scene right now. */
  walkContext(sceneId: Id): WalkContext;
  /** A shared (room) variable's value, and changing one. */
  roomVariable(name: string): VarValue | undefined;
  setRoomVariable(name: string, operator: VariableOperator, operand: VarValue | undefined): void;
  /** Something worth saving changed (a character stopped somewhere new). */
  changed(): void;
}

/** A walk under way: the doors still to go through, and the corners to the next one. */
interface Journey {
  spec: WalkSpec;
  doors: Door[];
  /** Corners still to pass in the scene the character is in. */
  path: Point[];
  /** Once through every door: where to stop, if anywhere in particular. */
  end: Point | null;
  speed: number;
  /** Which way to face on arriving. */
  facing?: 'left' | 'right';
  done: boolean;
}

interface Mind {
  npc: Npc;
  routine: Routine | null;
  step: number;
  /** The current step has begun, and is waiting to finish. */
  started: boolean;
  /** For a step that takes time: when it is over. */
  until: number;
  /** The routine's walk (a walk step, or one that goes on while later steps run). */
  journey: Journey | null;
  /** A player's walk action, which comes before the routine. */
  command: { ticket: string; journey: Journey } | null;
  /** The routine's conditions did not hold last time: it has stopped where it was. */
  paused: boolean;
  /** Finished, for a routine that does not loop. */
  finished: boolean;
  count: number;
}

/** How many steps that take no time a routine may run in one tick, so a loop of them cannot hang the server. */
const STEPS_PER_TICK = 20;
/** The longest time one tick may cover: after a pause, characters do not leap. */
const MAX_TICK_MS = 250;
/** How close counts as there. */
const ARRIVED = 2;

/**
 * The roaming characters of one instance: where each is, and what it is doing. The game server
 * ticks it a few times a second; so does the browser in single-player mode. It changes only the
 * records in `host.npcs`, which the room state carries to every player.
 */
export class Roamers {
  private minds = new Map<Id, Mind>();
  private finders = new Map<Id, { signature: string; finder: Pathfinder }>();
  private last: number;

  constructor(private host: RoamerHost, saved: Record<string, SavedNpc> | undefined) {
    this.last = host.now();
    for (const npc of host.scenario.characters ?? []) {
      if (!characterRoams(npc)) continue;
      const start = startPlacement(host.scenario, npc.id);
      if (!start) continue;
      const key = String(npc.id);
      const kept = saved?.[key];
      const keptOk = kept && host.index.scene(kept.scene_id) && Number.isFinite(kept.x) && Number.isFinite(kept.y);
      let rec = host.npcs.get(key);
      if (!rec) {
        rec = host.newNpc();
        rec.character_id = npc.id;
        const sceneId = keptOk ? kept.scene_id : start.scene.id;
        const wanted = keptOk ? { x: kept.x, y: kept.y } : { x: start.placement.position_x, y: start.placement.position_y };
        const at = nearestWalkable(host.walkContext(sceneId), wanted) ?? wanted;
        rec.scene_id = sceneId;
        rec.x = at.x;
        rec.y = at.y;
        rec.facing = (keptOk ? kept.facing : start.placement.facing) === 'left' ? 'left' : 'right';
        rec.moving = false;
        rec.anim = '';
        rec.line = '';
        rec.trip = '';
        host.npcs.set(key, rec);
      }
      const routine = npc.routine ?? null;
      const step = keptOk && routine && Number.isInteger(kept.step) && kept.step! >= 0 && kept.step! < routine.steps.length ? kept.step! : 0;
      this.minds.set(npc.id, { npc, routine, step, started: false, until: 0, journey: null, command: null, paused: false, finished: false, count: 0 });
    }
  }

  /** Whether a character roams in this instance. */
  has(characterId: Id): boolean {
    return this.minds.has(characterId);
  }

  record(characterId: Id): NpcRec | undefined {
    return this.host.npcs.get(String(characterId));
  }

  /**
   * A player's walk action: walk the character there now, before anything its routine wants.
   * Returns false when it cannot go (no way there); the record's `trip` carries the ticket until
   * it arrives, or until another walk takes over.
   */
  command(characterId: Id, spec: WalkSpec, ticket: string): boolean {
    const mind = this.minds.get(characterId);
    const rec = this.record(characterId);
    if (!mind || !rec) return false;
    const journey = this.plan(mind, rec, spec);
    if (!journey) return false;
    mind.command = { ticket, journey };
    rec.trip = ticket;
    rec.anim = '';
    return true;
  }

  /** Advance every character by the time since the last tick. */
  tick(): void {
    const now = this.host.now();
    const dt = Math.min(MAX_TICK_MS, Math.max(0, now - this.last));
    this.last = now;
    for (const [id, mind] of this.minds) {
      const rec = this.record(id);
      if (rec) this.think(mind, rec, now, dt);
    }
  }

  /** Where each character is, to keep with the instance. */
  saved(): Record<string, SavedNpc> {
    const out: Record<string, SavedNpc> = {};
    for (const [id, mind] of this.minds) {
      const rec = this.record(id);
      if (rec) out[String(id)] = { scene_id: rec.scene_id, x: Math.round(rec.x), y: Math.round(rec.y), facing: rec.facing, step: mind.routine ? mind.step : undefined };
    }
    return out;
  }

  // ------------------------------------------------------------ thinking

  private think(mind: Mind, rec: NpcRec, now: number, dt: number): void {
    // A player's walk comes first; the routine waits for it.
    if (mind.command) {
      this.advance(mind, rec, mind.command.journey, dt);
      if (mind.command.journey.done) {
        if (rec.trip === mind.command.ticket) rec.trip = '';
        mind.command = null;
        // The routine's walk was interrupted: it sets off again from wherever the character is now.
        if (mind.journey && !mind.journey.done) mind.journey = this.plan(mind, rec, mind.journey.spec);
      }
      return;
    }
    const routine = mind.routine;
    if (!routine || mind.finished) return;
    if (!roomConditionsHold(this.host.scenario, routine.conditions, (n) => this.host.roomVariable(n))) {
      // Told to stop: it stands where it is, and carries on with this step when allowed again.
      if (!mind.paused) {
        mind.paused = true;
        this.halt(rec);
      }
      return;
    }
    if (mind.paused) {
      mind.paused = false;
      if (mind.journey && !mind.journey.done) mind.journey = this.plan(mind, rec, mind.journey.spec);
    }
    if (mind.journey && !mind.journey.done) this.advance(mind, rec, mind.journey, dt);
    this.runSteps(mind, rec, routine, now);
  }

  private runSteps(mind: Mind, rec: NpcRec, routine: Routine, now: number): void {
    for (let n = 0; n < STEPS_PER_TICK; n++) {
      const step = routine.steps[mind.step];
      if (!step) return;
      if (!mind.started) {
        if (!roomConditionsHold(this.host.scenario, step.conditions, (v) => this.host.roomVariable(v))) {
          if (!this.next(mind, routine)) return;
          continue;
        }
        this.begin(mind, rec, step, now);
        mind.started = true;
        if (step.blocking === false) {
          if (!this.next(mind, routine)) return;
          continue;
        }
      }
      if (!this.over(mind, step, now)) return;
      if (!this.next(mind, routine)) return;
    }
  }

  /** On to the next step. False when the routine has ended. */
  private next(mind: Mind, routine: Routine): boolean {
    mind.started = false;
    mind.step++;
    if (mind.step < routine.steps.length) return true;
    if (routine.loop === false) {
      mind.finished = true;
      mind.step = routine.steps.length - 1;
      return false;
    }
    mind.step = 0;
    return true;
  }

  private begin(mind: Mind, rec: NpcRec, step: RoutineStep, now: number): void {
    switch (step.type) {
      case 'walk':
        mind.journey = this.plan(mind, rec, step);
        break;
      case 'wait':
        mind.until = now + Math.max(0, Number(step.duration) || 0);
        break;
      case 'dialogue': {
        mind.count++;
        rec.line = `${mind.count}:${mind.step}`;
        const text = typeof step.text === 'string' ? step.text : '';
        mind.until = now + (step.duration && step.duration > 0 ? step.duration : dialogueDuration(text));
        break;
      }
      case 'animate': {
        mind.count++;
        const name = typeof step.animation === 'string' ? step.animation : '';
        rec.anim = name ? `${name}:${mind.count}` : '';
        mind.until = now + (name ? moveDuration(mind.npc, name, (id) => this.host.index.media.get(id)) : 0);
        break;
      }
      case 'variable':
        this.host.setRoomVariable(step.name, step.operator, step.operand);
        break;
      default:
    }
  }

  /** Whether a step that has begun is over. */
  private over(mind: Mind, step: RoutineStep, now: number): boolean {
    if (step.type === 'walk') return !mind.journey || mind.journey.done;
    if (step.type === 'dialogue' || step.type === 'wait' || step.type === 'animate') {
      if (now < mind.until) return false;
      // The line has been said: the bubble goes.
      if (step.type === 'dialogue') {
        const rec = this.record(mind.npc.id);
        if (rec) rec.line = '';
      }
      return true;
    }
    return true;
  }

  // ------------------------------------------------------------- walking

  /** Work out how to get there from where the character is. Null: there is no way. */
  private plan(mind: Mind, rec: NpcRec, spec: WalkSpec): Journey | null {
    const to = spec.to ?? 'point';
    const speed = walkSpeed(this.host.scenario, mind.npc, spec);
    const facing = spec.facing === 'left' || spec.facing === 'right' ? spec.facing : undefined;
    let doors: Door[] = [];
    let end: Point | null = null;
    let endFacing = facing;
    const here = this.host.index.scene(rec.scene_id);
    if (!here) return null;
    if (to === 'point') {
      if (typeof spec.position_x !== 'number' || typeof spec.position_y !== 'number') return null;
      end = { x: spec.position_x, y: spec.position_y };
    } else if (to === 'spawn') {
      const spawn = (here.spawn_points ?? []).find((p) => p.name === spec.spawn_point);
      if (!spawn) return null;
      end = { x: spawn.position_x, y: spawn.position_y };
      endFacing ??= spawn.facing;
    } else if (to === 'scene') {
      const target = spec.scene_id != null ? this.host.index.scene(spec.scene_id) : undefined;
      if (!target) return null;
      const route = routeBetween(this.host.index, rec.scene_id, target.id, (door) => this.open(door));
      if (!route) return null;
      doors = route;
      const spawn = spec.spawn_point ? (target.spawn_points ?? []).find((p) => p.name === spec.spawn_point) : undefined;
      if (spawn) {
        end = { x: spawn.position_x, y: spawn.position_y };
        endFacing ??= spawn.facing;
      }
    } else {
      return null;
    }
    const journey: Journey = { spec, doors, path: [], end, speed, facing: endFacing, done: false };
    this.leg(journey, rec);
    return journey;
  }

  /** May a character go through this door now? As far as shared variables say. */
  private open(door: Door): boolean {
    return roomConditionsHold(this.host.scenario, door.conditions, (n) => this.host.roomVariable(n));
  }

  /** The corners to the next door, or to the end, in the scene the character is in. */
  private leg(journey: Journey, rec: NpcRec): void {
    const ctx = this.host.walkContext(rec.scene_id);
    const from = { x: rec.x, y: rec.y };
    let goal: Point | null;
    const door = journey.doors[0];
    if (door) goal = doorPoint(ctx, door.hotspot, from) ?? { x: door.hotspot.position_x ?? from.x, y: door.hotspot.position_y ?? from.y };
    else goal = journey.end ? (nearestWalkable(ctx, journey.end, 300, 10) ?? journey.end) : null;
    journey.path = goal ? (this.finder(rec.scene_id, ctx).find(from, goal) ?? [goal]) : [];
  }

  private finder(sceneId: Id, ctx: WalkContext): Pathfinder {
    const signature = walkSignature(ctx);
    const known = this.finders.get(sceneId);
    if (known?.signature === signature) return known.finder;
    const finder = new Pathfinder(ctx);
    this.finders.set(sceneId, { signature, finder });
    return finder;
  }

  /** Walk on for `dt` milliseconds: along the corners, through doors, and stop on arriving. */
  private advance(mind: Mind, rec: NpcRec, journey: Journey, dt: number): void {
    if (journey.done) return;
    let budget = (journey.speed * dt) / 1000;
    let guard = 0;
    while (!journey.done && guard++ < 50) {
      const door = journey.doors[0];
      // Inside the next door's hotspot: through it, as a player walking in would be.
      if (door && door.from === rec.scene_id && inHotspot(door.hotspot, rec.x, rec.y)) {
        this.through(rec, door);
        journey.doors.shift();
        this.leg(journey, rec);
        continue;
      }
      const corner = journey.path[0];
      if (!corner) {
        // At the door's spot (inside its hotspot, or as near as one can stand): through it.
        if (door) {
          this.through(rec, door);
          journey.doors.shift();
          this.leg(journey, rec);
          continue;
        }
        this.arrive(rec, journey);
        return;
      }
      if (budget <= 0) break;
      const scene = this.host.index.scene(rec.scene_id);
      // Smaller in the distance, slower in the distance, as players are.
      const factor = scene ? speedFactorAt(scene, rec.x, rec.y) : 1;
      const reach = budget * factor;
      const from = { x: rec.x, y: rec.y };
      const to = stepToward(from, corner, reach);
      const moved = distance(from, to);
      if (Math.abs(to.x - from.x) > 0.01) rec.facing = to.x < from.x ? 'left' : 'right';
      rec.x = to.x;
      rec.y = to.y;
      rec.moving = true;
      if (rec.anim) rec.anim = '';
      budget -= factor > 0 ? moved / factor : budget;
      if (distance(to, corner) <= ARRIVED) journey.path.shift();
      else break;
    }
  }

  /** Go through a door: out of this scene, into the next at the spawn point the jump names. */
  private through(rec: NpcRec, door: Door): void {
    const scene = this.host.index.scene(door.to);
    if (!scene) return;
    const spawn = this.host.index.spawn(scene, door.spawn_point);
    const wanted = spawn ? { x: spawn.position_x, y: spawn.position_y } : this.middle(scene);
    const at = nearestWalkable(this.host.walkContext(scene.id), wanted) ?? wanted;
    rec.scene_id = scene.id;
    rec.x = at.x;
    rec.y = at.y;
    if (spawn?.facing) rec.facing = spawn.facing;
    rec.line = '';
    this.host.changed();
  }

  private arrive(rec: NpcRec, journey: Journey): void {
    journey.done = true;
    rec.moving = false;
    if (journey.facing) rec.facing = journey.facing;
    this.host.changed();
  }

  private halt(rec: NpcRec): void {
    rec.moving = false;
  }

  private middle(scene: Scene): Point {
    const ctx = this.host.walkContext(scene.id);
    return { x: ctx.width / 2, y: ctx.height / 2 };
  }
}
