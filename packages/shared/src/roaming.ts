import { distance, inHotspot, nearestWalkable, speedFactorAt, stepToward, type WalkContext } from './geometry.js';
import { Pathfinder, walkSignature } from './pathfinder.js';
import type { ScenarioIndex } from './scenario.js';
import type { Id, Npc, Point, Scenario, Scene, VarValue, WalkAction } from './types.js';
import {
  characterRoams, characterStart, doorPoint, openDoors, randomBetween, roomConditionsHold, routeBetween, walkSpeed, wanderSpots,
  WANDER_PAUSE, type Door,
} from './walking.js';

/**
 * Where a character is, as the room state carries it to every player. Keyed by the character's
 * id (within the team's part of the room, like unique items).
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
  /** While it walks because a player's walk action asked: that request's ticket. Empty otherwise. */
  trip: string;
}

/** Where a character is to walk: a walk action, without who walks. */
export type WalkSpec = Pick<WalkAction, 'to' | 'position_x' | 'position_y' | 'spawn_point' | 'scene_id' | 'speed' | 'facing' | 'wander'>;

/** Where a character was left, kept with the instance between sessions. */
export interface SavedNpc {
  scene_id: Id;
  x: number;
  y: number;
  facing?: string;
  /** Whether it was walking around on its own, when that is not what the character does by itself (a walk action stopped it, or set it off). */
  wanders?: boolean;
}

/** What Walkers needs from the World that owns it. */
export interface WalkerHost {
  scenario: Scenario;
  index: ScenarioIndex;
  /** The room state's map of characters (or a plain Map). */
  npcs: { get(key: string): NpcRec | undefined; set(key: string, value: NpcRec): unknown; forEach(cb: (value: NpcRec, key: string) => void): void };
  newNpc(): NpcRec;
  now(): number;
  /** A number from 0 up to 1: where it wanders, and for how long it stops. */
  random(): number;
  /** Where feet may be in a scene right now. */
  walkContext(sceneId: Id): WalkContext;
  /** A shared (room) variable's value: doors with conditions on one open as it says. */
  roomVariable(name: string): VarValue | undefined;
  /** Something worth saving changed (a character stopped somewhere new). */
  changed(): void;
}

/** A walk under way: the doors still to go through, and the corners to the next one. */
interface Journey {
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

/**
 * What a character walking around on its own is doing: standing still for a while (`pause`),
 * walking to one of the spots it chose in this scene (`spot`), or heading out through a door
 * (`door`). `idle`: it is not walking around on its own.
 */
type Phase = 'idle' | 'pause' | 'spot' | 'door';

interface Mind {
  npc: Npc;
  /** Walking around on its own: what the character does, unless a walk action said otherwise. */
  wanders: boolean;
  phase: Phase;
  /** `pause`: when it sets off again. */
  until: number;
  /** The spots in this scene it has still to walk to before it leaves. */
  spots: Point[];
  /** The walk it is on: to a spot or a door of its own, or where a player's walk action sends it. */
  journey: Journey | null;
  /** The walk is a player's walk action: its ticket, and whether to walk around again on arriving. */
  command: { ticket: string; wander: boolean } | null;
}

/** The longest time one tick may cover: after a pause, characters do not leap. */
const MAX_TICK_MS = 250;
/** How close counts as there. */
const ARRIVED = 2;

/**
 * The characters of one instance: where each is, and where it is walking. Every character that
 * starts in a scene is here, once per instance, so every player sees it in the same place. Ones
 * that walk around on their own (`Npc.roams`) choose 3 to 7 spots they can reach in the scene they
 * are in, walk to each in turn and stop at each for 2 to 10 seconds, then leave through a door that
 * has no conditions, and do the same in the next scene. Any character walks where a player's walk
 * action sends it.
 *
 * The game server ticks it a few times a second; so does the browser in single-player mode. It
 * changes only the records in `host.npcs`, which the room state carries to every player.
 */
export class Walkers {
  private minds = new Map<Id, Mind>();
  private finders = new Map<Id, { signature: string; finder: Pathfinder }>();
  private last: number;

  constructor(private host: WalkerHost, saved: Record<string, SavedNpc> | undefined) {
    this.last = host.now();
    for (const npc of host.scenario.characters ?? []) {
      const start = characterStart(host.scenario, npc);
      if (!start) continue;
      const key = String(npc.id);
      const kept = saved?.[key];
      const keptOk = !!kept && !!host.index.scene(kept.scene_id) && Number.isFinite(kept.x) && Number.isFinite(kept.y);
      let rec = host.npcs.get(key);
      if (!rec) {
        rec = host.newNpc();
        rec.character_id = npc.id;
        const sceneId = keptOk ? kept.scene_id : start.scene.id;
        const wanted = keptOk ? { x: kept.x, y: kept.y } : { x: start.x, y: start.y };
        const at = nearestWalkable(host.walkContext(sceneId), wanted) ?? wanted;
        rec.scene_id = sceneId;
        rec.x = at.x;
        rec.y = at.y;
        rec.facing = (keptOk ? kept.facing : start.facing) === 'left' ? 'left' : 'right';
        rec.moving = false;
        rec.trip = '';
        host.npcs.set(key, rec);
      }
      const wanders = keptOk && typeof kept.wanders === 'boolean' ? kept.wanders : characterRoams(npc);
      const mind: Mind = { npc, wanders, phase: 'idle', until: 0, spots: [], journey: null, command: null };
      this.minds.set(npc.id, mind);
      // Not all at once: each stands a moment before it first sets off.
      if (wanders) this.freshRound(mind, rec, host.now());
    }
  }

  /** Whether a character is in this instance's world (it starts in a scene). */
  has(characterId: Id): boolean {
    return this.minds.has(characterId);
  }

  record(characterId: Id): NpcRec | undefined {
    return this.host.npcs.get(String(characterId));
  }

  /** Whether a character is walking around on its own right now. */
  wandering(characterId: Id): boolean {
    return this.minds.get(characterId)?.wanders === true;
  }

  /**
   * A player's walk action: walk the character there now, whatever it was doing. Returns false
   * when it cannot go (no way there); the record's `trip` carries the ticket until it arrives, or
   * until another walk takes over.
   */
  command(characterId: Id, spec: WalkSpec, ticket: string): boolean {
    const mind = this.minds.get(characterId);
    const rec = this.record(characterId);
    if (!mind || !rec) return false;
    const journey = this.plan(mind, rec, spec);
    if (!journey) return false;
    mind.journey = journey;
    mind.command = { ticket, wander: characterRoams(mind.npc) && spec.wander !== false };
    mind.phase = 'idle';
    mind.spots = [];
    rec.trip = ticket;
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
      if (!rec) continue;
      const own = characterRoams(mind.npc);
      out[String(id)] = { scene_id: rec.scene_id, x: Math.round(rec.x), y: Math.round(rec.y), facing: rec.facing, ...(mind.wanders !== own ? { wanders: mind.wanders } : {}) };
    }
    return out;
  }

  // ------------------------------------------------------------ thinking

  private think(mind: Mind, rec: NpcRec, now: number, dt: number): void {
    if (mind.journey && !mind.journey.done) {
      this.advance(rec, mind.journey, dt);
      if (!mind.journey.done) return;
      this.arrived(mind, rec, now);
    }
    if (mind.phase === 'pause' && now >= mind.until) this.onward(mind, rec, now);
  }

  /** The walk it was on is over: what next. */
  private arrived(mind: Mind, rec: NpcRec, now: number): void {
    mind.journey = null;
    const command = mind.command;
    if (command) {
      mind.command = null;
      if (rec.trip === command.ticket) rec.trip = '';
      // Walking around again, or staying here until another walk sends it on.
      mind.wanders = command.wander;
      this.host.changed();
      if (mind.wanders) this.freshRound(mind, rec, now);
      else mind.phase = 'idle';
      return;
    }
    if (!mind.wanders) {
      mind.phase = 'idle';
      return;
    }
    if (mind.phase === 'door') {
      // Through the door, into the next scene: a new round of spots there, setting off at once.
      mind.spots = this.chooseSpots(rec);
      this.onward(mind, rec, now);
    } else if (mind.spots.length) {
      this.pause(mind, now);
    } else {
      this.leave(mind, rec, now);
    }
  }

  /** Walk to the next spot, or, with none left, out of the scene. */
  private onward(mind: Mind, rec: NpcRec, now: number): void {
    while (mind.spots.length) {
      const spot = mind.spots.shift()!;
      const journey = this.journeyTo(mind, rec, [], spot);
      if (journey) {
        mind.journey = journey;
        mind.phase = 'spot';
        return;
      }
    }
    this.leave(mind, rec, now);
  }

  /**
   * Out through a door with no conditions, one it can walk to, chosen at random. A scene with no
   * such door keeps it: it chooses new spots here and goes on walking around.
   */
  private leave(mind: Mind, rec: NpcRec, now: number): void {
    const scene = this.host.index.scene(rec.scene_id);
    const ctx = this.host.walkContext(rec.scene_id);
    const from = { x: rec.x, y: rec.y };
    const doors = scene ? openDoors(this.host.index, scene).filter((d) => {
      const at = doorPoint(ctx, d.hotspot, from);
      return !!at && (inHotspot(d.hotspot, from.x, from.y) || !!this.finder(rec.scene_id, ctx).find(from, at));
    }) : [];
    if (doors.length) {
      const door = doors[Math.floor(this.host.random() * doors.length)] ?? doors[0]!;
      const journey = this.journeyTo(mind, rec, [door], null);
      if (journey) {
        mind.journey = journey;
        mind.phase = 'door';
        return;
      }
    }
    mind.spots = this.chooseSpots(rec);
    this.pause(mind, now);
  }

  /** Begin walking around here: a moment's pause, then 3 to 7 spots of this scene. */
  private freshRound(mind: Mind, rec: NpcRec, now: number): void {
    mind.spots = this.chooseSpots(rec);
    this.pause(mind, now);
  }

  private pause(mind: Mind, now: number): void {
    mind.phase = 'pause';
    mind.until = now + randomBetween(() => this.host.random(), WANDER_PAUSE.min, WANDER_PAUSE.max);
  }

  /** 3 to 7 spots of the scene the character is in, each one it can walk to from where it stands. */
  private chooseSpots(rec: NpcRec): Point[] {
    const ctx = this.host.walkContext(rec.scene_id);
    const finder = this.finder(rec.scene_id, ctx);
    return wanderSpots(ctx, { x: rec.x, y: rec.y }, () => this.host.random(), (from, to) => !!finder.find(from, to));
  }

  // ------------------------------------------------------------- walking

  /** Work out how to get where a walk action says from where the character is. Null: there is no way. */
  private plan(mind: Mind, rec: NpcRec, spec: WalkSpec): Journey | null {
    const to = spec.to ?? 'point';
    const target = this.host.index.scene(spec.scene_id ?? rec.scene_id);
    if (!target) return null;
    let end: Point | null = null;
    let facing = spec.facing === 'left' || spec.facing === 'right' ? spec.facing : undefined;
    if (to === 'point') {
      if (typeof spec.position_x !== 'number' || typeof spec.position_y !== 'number') return null;
      end = { x: spec.position_x, y: spec.position_y };
    } else if (to === 'spawn') {
      const spawn = (target.spawn_points ?? []).find((p) => p.name === spec.spawn_point);
      if (!spawn) return null;
      end = { x: spawn.position_x, y: spawn.position_y };
      facing ??= spawn.facing;
    } else if (to !== 'scene') {
      return null;
    }
    const doors = routeBetween(this.host.index, rec.scene_id, target.id, (door) => this.open(door));
    if (!doors) return null;
    return this.journeyTo(mind, rec, doors, end, walkSpeed(this.host.scenario, mind.npc, spec), facing);
  }

  private journeyTo(mind: Mind, rec: NpcRec, doors: Door[], end: Point | null, speed = walkSpeed(this.host.scenario, mind.npc), facing?: 'left' | 'right'): Journey | null {
    const journey: Journey = { doors, path: [], end, speed, facing, done: false };
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
  private advance(rec: NpcRec, journey: Journey, dt: number): void {
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
    this.host.changed();
  }

  private arrive(rec: NpcRec, journey: Journey): void {
    journey.done = true;
    rec.moving = false;
    if (journey.facing) rec.facing = journey.facing;
    this.host.changed();
  }

  private middle(scene: Scene): Point {
    const ctx = this.host.walkContext(scene.id);
    return { x: ctx.width / 2, y: ctx.height / 2 };
  }
}
