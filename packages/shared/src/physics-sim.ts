/**
 * The physics of a scene's experiment, with planck.js (Box2D). Used by the browser for scenes in
 * which each player has their own experiment, and by the game server for shared ones, so both
 * behave alike. It knows nothing of drawing or the network: it is stepped, it is told what
 * players do, and it reports poses, readings and what it noticed.
 *
 * Coordinates outside are scene pixels with y downwards, as everywhere else. Inside, planck works
 * in metres (pixels / pixels_per_meter), still with y downwards; gravity points down the screen.
 */
import * as planck from 'planck';
import {
  beamBody, beamBodyId, beamLength, beamProblem, bodyParts, cupInside, designCost, isAnchor, materialOf, passes,
  physicsUnits, snapToGrid,
  type BodyPart, type PhysicsBeam, type PhysicsBody, type PhysicsBuild, type PhysicsInput, type PhysicsJoint, type PhysicsLayout,
  type PhysicsMeasure, type PhysicsOp, type PhysicsPose, type PhysicsReadout, type PhysicsSnapshot, type PhysicsUnits, type PhysicsWatch,
  type ScenePhysics,
} from './physics.js';
import type { Point } from './types.js';

const STEP = 1 / 60;
const VELOCITY_ITERATIONS = 20;
const POSITION_ITERATIONS = 10;
/** At most this many steps are taken per call to advance(), so a slow frame does not snowball. */
const MAX_STEPS = 6;
/** Built beams are hollow sections, not solid bars: they weigh this fraction of a solid one. */
const BEAM_FILL = 0.25;
/** How quickly a joint's measured force follows the real one (smooths out single-step spikes). */
const FORCE_SMOOTHING = 0.35;
/**
 * Water slows what moves through it: a force of this many times the speed and the mass of the
 * water pushed aside. Light things (cork) are damped hard, as the water they move dominates.
 */
const WATER_DRAG = 5;
const SLOW_MOTION = 0.25;
/** How quickly a rolling ball loses its spin, for balls with no damping of their own. */
const ROLLING_RESISTANCE = 0.4;
/** A bridge just put to the test drops onto its footings; loads are not counted for this long. */
const SETTLE_SECONDS = 1;

// What collides with what.
const CAT_STATIC = 0x1;
const CAT_BODY = 0x2;
const CAT_DECK = 0x4;
const CAT_SUPPORT = 0x8;

/** Who is doing something to the experiment: a session id, or 'me' in the browser. */
export type Actor = string;

export interface SimListener {
  /** A joint or beam broke. */
  broke?(id: string): void;
  /** A watch noticed what it watches for. */
  fired?(watch: PhysicsWatch, value: number | null): void;
  /** Bodies were added or removed, or the design changed: the layout's version went up. */
  changed?(): void;
}

interface SimBody {
  def: PhysicsBody;
  body: planck.Body;
  parts: BodyPart[];
  spawned: boolean;
  beam: PhysicsBeam | null;
  held: boolean;
  /** Where the body started, for tilt. */
  startAngle: number;
  // What is measured as it moves.
  track: {
    lastVy: number;
    lastVx: number;
    /** Going up fast enough that its stopping will be the top of a bounce. */
    rising: boolean;
    bounce: number | null;
    maxHeight: number;
    rightAt: number | null;
    peakSpeed: number;
    period: number | null;
    swings: number;
  };
}

interface SimJoint {
  id: string;
  joint: planck.Joint;
  strength: number | null;
  force: number;
  /** A beam's joint is named after the beam, so its breaking breaks the beam. */
  beam: string | null;
  /** An anchor's joint holds the structure up: what it carries is the bridge's load. */
  anchor: boolean;
  kind: 'pin' | 'weld' | 'string' | 'spring' | 'rope';
  visible: boolean;
}

interface Water {
  id: string;
  def: NonNullable<ScenePhysics['water']>[number];
  /** Water in it, as an area in square pixels (it is 2D; volume = area × depth). */
  area: number;
  startLevel: number;
  /** The surface, as a depth in pixels from the floor of the container. */
  level: number;
  /** Area pushed aside by what is in it, square pixels. */
  displaced: number;
  spilled: number;
}

interface Grab {
  body: SimBody;
  joint: planck.MouseJoint | null;
  /** A held body is moved directly; this is where it was picked up, relative to its centre. */
  offset: Point;
}

interface Press {
  body: SimBody;
  local: planck.Vec2;
  since: number;
  force: number;
}

/** The box a container's water fills, in scene pixels. */
interface Box { x: number; y: number; width: number; height: number }

export class PhysicsSim {
  readonly units: PhysicsUnits;
  readonly def: ScenePhysics;
  private world!: planck.World;
  private ground!: planck.Body;
  private bodies = new Map<string, SimBody>();
  private joints = new Map<string, SimJoint>();
  private water: Water[] = [];
  private broken = new Set<string>();
  private grabs = new Map<Actor, Grab>();
  private presses = new Map<Actor, Press>();
  private fired = new Set<string>();
  private watchSince = new Map<string, number>();
  private readingWas = new Map<string, boolean>();
  private trayLeft = new Map<string, number | null>();
  private spawned: PhysicsBody[] = [];
  private removed = new Set<string>();
  private nextSpawn = 1;
  private nextBeam = 1;
  private accumulator = 0;
  /** Seconds simulated since the last reset. */
  time = 0;
  paused: boolean;
  slow = false;
  gravity: number;
  /** A bridge scene: true while the design is being built (nothing moves), false while it is tested. */
  building: boolean;
  design: PhysicsBeam[];
  version = 1;
  /** A player has done something since the last reset: watches for rest and balance wait for it. */
  private armed = false;
  private firstBreakPress: number | null = null;
  private maxLoad = 0;
  private load = 0;

  constructor(def: ScenePhysics, readonly size: { width: number; height: number }, readonly listener: SimListener = {}) {
    this.def = def;
    this.units = physicsUnits(def);
    this.gravity = this.units.gravity;
    this.paused = def.paused === true;
    this.building = !!def.build;
    this.design = (def.build?.preset ?? []).map((b) => ({ ...b, a: { ...b.a }, b: { ...b.b } }));
    for (const b of this.design) this.nextBeam = Math.max(this.nextBeam, Number(String(b.id).replace(/\D/g, '')) + 1 || this.nextBeam);
    this.build();
  }

  // ------------------------------------------------------------------ building the world

  private m(px: number): number {
    return px / this.units.ppm;
  }

  private v(p: Point): planck.Vec2 {
    return planck.Vec2(p.x / this.units.ppm, p.y / this.units.ppm);
  }

  /** (Re)make the world from the document, the bodies taken out of the tray, and — while testing — the design. */
  private build() {
    this.world = new planck.World({ gravity: planck.Vec2(0, this.gravity) });
    this.bodies.clear();
    this.joints.clear();
    this.grabs.clear();
    this.presses.clear();
    this.ground = this.world.createBody({ type: 'static' });
    const { width, height } = this.size;
    const floorY = this.def.floor_y === null ? null : this.def.floor_y ?? height;
    const wide = width * 4;
    const staticFix = { friction: 0.6, restitution: 0, filterCategoryBits: CAT_STATIC, filterMaskBits: 0xffff };
    if (floorY != null) this.ground.createFixture(new planck.Edge(this.v({ x: -wide, y: floorY }), this.v({ x: width + wide, y: floorY })), staticFix);
    if (this.def.walls !== false) {
      const top = -height * 2;
      const bottom = floorY ?? height * 3;
      this.ground.createFixture(new planck.Edge(this.v({ x: 0, y: top }), this.v({ x: 0, y: bottom })), staticFix);
      this.ground.createFixture(new planck.Edge(this.v({ x: width, y: top }), this.v({ x: width, y: bottom })), staticFix);
    }
    for (const b of this.def.bodies ?? []) this.addBody(b, false, null);
    for (const b of this.spawned) if (!this.removed.has(b.id)) this.addBody(b, true, null);
    for (const j of this.def.joints ?? []) this.addJoint(j);
    if (this.def.build && !this.building) this.addDesign(this.def.build);
    this.water = (this.def.water ?? []).map((w) => {
      const box = this.waterBox(w);
      const level = Math.max(0, Math.min(w.level, box?.height ?? w.level));
      return { id: w.id, def: w, area: level * (box?.width ?? 0), startLevel: level, level, displaced: 0, spilled: 0 };
    });
  }

  private addBody(def: PhysicsBody, spawned: boolean, beam: PhysicsBeam | null): SimBody | null {
    if (this.bodies.has(def.id)) return null;
    const material = materialOf(def.material);
    const parts = bodyParts(def);
    const held = def.held === true && !def.fixed;
    const body = this.world.createBody({
      type: def.fixed || held ? 'static' : 'dynamic',
      position: this.v(def),
      angle: ((def.angle ?? 0) * Math.PI) / 180,
      bullet: def.shape === 'circle' && (def.radius ?? 40) < 20,
      // A built structure loses energy in its joints: without this a heavy truss rings for ever.
      linearDamping: beam ? 0.3 : Math.max(0, def.damping ?? 0) * 0.25,
      // Rolling resistance: a ball that would otherwise roll for ever comes to rest.
      angularDamping: beam ? 1.5 : def.damping != null ? Math.max(0, def.damping) : def.shape === 'circle' ? ROLLING_RESISTANCE : 0,
    });
    const area = partsArea(parts) / this.units.ppm ** 2;
    let density = (def.density ?? material.density) * this.units.depth * (beam ? BEAM_FILL : 1);
    if (def.mass && def.mass > 0 && area > 0) density = def.mass / area;
    const deck = beam ? this.def.build?.beams[beam.kind]?.deck === true : false;
    const category = def.fixed ? CAT_STATIC : beam ? (deck ? CAT_DECK : CAT_SUPPORT) : CAT_BODY;
    const mask = def.fixed ? 0xffff : beam ? (deck ? CAT_BODY : 0) : CAT_STATIC | CAT_BODY | CAT_DECK;
    const fixture = {
      density,
      friction: def.friction ?? material.friction,
      restitution: def.bounciness ?? material.bounciness,
      filterCategoryBits: category,
      filterMaskBits: mask,
      // The beams of one structure never collide with each other.
      filterGroupIndex: beam ? -1 : 0,
    };
    for (const part of parts) {
      if (part.kind === 'circle') body.createFixture(new planck.Circle(this.v(part), this.m(part.r)), fixture);
      else body.createFixture(new planck.Polygon(part.points.map((p) => this.v(p))), fixture);
    }
    body.setUserData({ id: def.id });
    const sim: SimBody = {
      def, body, parts, spawned, beam, held, startAngle: body.getAngle(),
      track: { lastVy: 0, lastVx: 0, rising: false, bounce: null, maxHeight: 0, rightAt: null, peakSpeed: 0, period: null, swings: 0 },
    };
    sim.track.maxHeight = this.heightOf(sim) ?? 0;
    this.bodies.set(def.id, sim);
    return sim;
  }

  private addJoint(def: PhysicsJoint) {
    if (this.broken.has(def.id)) return;
    const a = this.bodies.get(def.body_a)?.body;
    const b = def.body_b ? this.bodies.get(def.body_b)?.body : this.ground;
    if (!a || !b || a === b) return;
    const p1 = this.v(def);
    const p2 = this.v({ x: def.x2 ?? def.x, y: def.y2 ?? def.y });
    let joint: planck.Joint | null = null;
    switch (def.type) {
      case 'pin': {
        const limited = def.min_angle != null || def.max_angle != null;
        joint = new planck.RevoluteJoint({
          enableLimit: limited,
          lowerAngle: ((def.min_angle ?? -180) * Math.PI) / 180,
          upperAngle: ((def.max_angle ?? 180) * Math.PI) / 180,
        }, b, a, p1);
        break;
      }
      case 'weld':
        joint = new planck.WeldJoint({}, b, a, p1);
        break;
      case 'string':
        joint = new planck.DistanceJoint({}, a, b, p1, p2);
        break;
      case 'spring':
        joint = new planck.DistanceJoint({ frequencyHz: def.stiffness ?? 2, dampingRatio: def.damping ?? 0.3 }, a, b, p1, p2);
        break;
      case 'rope': {
        const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        joint = new planck.RopeJoint({ bodyA: a, bodyB: b, maxLength: length, localAnchorA: a.getLocalPoint(p1), localAnchorB: b.getLocalPoint(p2) });
        break;
      }
    }
    if (!joint) return;
    this.world.createJoint(joint);
    this.joints.set(def.id, {
      id: def.id, joint, strength: def.strength && def.strength > 0 ? def.strength : null, force: 0, beam: null, anchor: false, kind: def.type, visible: def.visible !== false,
    });
  }

  /** The design as bodies and joints: each beam a body, pinned to the world at footings and to the first beam at every other node. */
  private addDesign(build: PhysicsBuild) {
    const hubs = new Map<string, SimBody>();
    const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;
    const ropes: PhysicsBeam[] = [];
    for (const beam of this.design) {
      const kind = build.beams[beam.kind];
      if (!kind) continue;
      if (materialOf(kind.material).tension_only) {
        ropes.push(beam);
        continue;
      }
      const sim = this.addBody(beamBody(build, beam), false, beam);
      if (!sim) continue;
      const strength = kind.strength ?? materialOf(kind.material).strength;
      for (const [end, which] of [[beam.a, 'a'], [beam.b, 'b']] as const) {
        const at = this.v(end);
        const id = `${beam.id}.${which}`;
        if (isAnchor(build, end)) {
          const joint = this.world.createJoint(new planck.RevoluteJoint({}, this.ground, sim.body, at))!;
          this.joints.set(id, { id, joint, strength, force: 0, beam: beam.id, anchor: true, kind: 'pin', visible: true });
          continue;
        }
        const hub = hubs.get(key(end));
        if (!hub) {
          hubs.set(key(end), sim);
          continue;
        }
        const joint = this.world.createJoint(new planck.RevoluteJoint({}, hub.body, sim.body, at))!;
        const hubStrength = hub.beam ? build.beams[hub.beam.kind]?.strength ?? materialOf(build.beams[hub.beam.kind]?.material).strength : strength;
        this.joints.set(id, { id, joint, strength: Math.min(strength, hubStrength), force: 0, beam: beam.id, anchor: false, kind: 'pin', visible: true });
      }
    }
    // Ropes and cables only pull: a rope joint between whatever is at their two ends.
    for (const beam of ropes) {
      const kind = build.beams[beam.kind]!;
      const strength = kind.strength ?? materialOf(kind.material).strength;
      const endBody = (p: Point): planck.Body => {
        if (isAnchor(build, p)) return this.ground;
        const hub = hubs.get(key(p));
        if (hub) return hub.body;
        // Only ropes meet here: a small knot for them to tie to.
        const knot = this.world.createBody({ type: 'dynamic', position: this.v(p) });
        knot.createFixture(new planck.Circle(this.m(4)), { density: 2 / (Math.PI * this.m(4) ** 2), filterCategoryBits: CAT_SUPPORT, filterMaskBits: 0 });
        hubs.set(key(p), { def: { id: `knot:${key(p)}`, shape: 'circle', x: p.x, y: p.y, radius: 4 }, body: knot, parts: [], spawned: false, beam: null, held: false, startAngle: 0, track: emptyTrack() });
        return knot;
      };
      const a = endBody(beam.a);
      const b = endBody(beam.b);
      if (a === b) continue;
      const pa = this.v(beam.a);
      const pb = this.v(beam.b);
      const joint = this.world.createJoint(new planck.RopeJoint({
        bodyA: a, bodyB: b, maxLength: Math.hypot(pb.x - pa.x, pb.y - pa.y), localAnchorA: a.getLocalPoint(pa), localAnchorB: b.getLocalPoint(pb),
      }))!;
      this.joints.set(`${beam.id}.rope`, { id: `${beam.id}.rope`, joint, strength, force: 0, beam: beam.id, anchor: isAnchor(build, beam.a) || isAnchor(build, beam.b), kind: 'rope', visible: true });
    }
  }

  private waterBox(w: Water['def']): Box | null {
    if (w.body_id) {
      const cup = this.bodies.get(w.body_id);
      if (!cup || cup.def.shape !== 'cup') return null;
      const inside = cupInside(cup.def);
      const centre = cup.body.getPosition();
      return { x: centre.x * this.units.ppm + inside.x, y: centre.y * this.units.ppm + inside.y, width: inside.width, height: inside.height };
    }
    if (w.width == null || w.height == null) return null;
    return { x: w.x ?? 0, y: w.y ?? 0, width: w.width, height: w.height };
  }

  // ------------------------------------------------------------------ running

  /** Move time on by `seconds` of real time (slow motion and pause applied here). */
  advance(seconds: number) {
    if (this.paused || this.building) {
      this.accumulator = 0;
      this.dragHeld();
      return;
    }
    this.accumulator += Math.min(seconds, 0.25) * (this.slow ? SLOW_MOTION : 1);
    let steps = 0;
    while (this.accumulator >= STEP && steps < MAX_STEPS) {
      this.step();
      this.accumulator -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;
  }

  /** One fixed step of the world. */
  step() {
    this.dragHeld();
    for (const press of this.presses.values()) {
      press.force = Math.min(this.def.press?.max ?? 5000, (this.def.press?.rate ?? 100) * (this.time - press.since));
      const at = press.body.body.getWorldPoint(press.local);
      press.body.body.applyForce(planck.Vec2(0, press.force), at, true);
    }
    this.applyWater();
    this.world.step(STEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS);
    this.time += STEP;
    this.measureJoints();
    this.trackBodies();
    this.dropLost();
    this.checkWatches();
  }

  /** Held bodies being moved by a player follow the pointer directly. */
  private dragHeld() {
    for (const grab of this.grabs.values()) {
      if (grab.joint || !grab.body.held) continue;
      const target = (grab as Grab & { target?: planck.Vec2 }).target;
      if (target) grab.body.body.setTransform(planck.Vec2(target.x - grab.offset.x, target.y - grab.offset.y), grab.body.body.getAngle());
    }
  }

  private applyWater() {
    const { ppm, depth } = this.units;
    for (const w of this.water) {
      const box = this.waterBox(w.def);
      if (!box || box.width <= 0) continue;
      const floor = box.y + box.height;
      // The surface stands where the water plus what is pushed aside fills the box, at most to its rim.
      let displaced = 0;
      const surface = floor - w.level;
      const rho = w.def.density ?? 1000;
      for (const sim of this.bodies.values()) {
        if (sim.def.fixed || sim.body.isStatic() || (w.def.body_id && sim.def.id === w.def.body_id)) continue;
        const under = submerged(sim, ppm, { x0: box.x, x1: box.x + box.width, y0: surface, y1: floor });
        if (under.area <= 0) continue;
        displaced += under.area;
        const areaM = under.area / ppm ** 2;
        const centre = planck.Vec2(under.cx / ppm, under.cy / ppm);
        // Archimedes: up by the weight of the water pushed aside.
        sim.body.applyForce(planck.Vec2(0, -rho * this.gravity * areaM * depth), centre, true);
        // Water is thick: it slows what moves through it.
        const fraction = Math.min(1, under.area / Math.max(1, partsArea(sim.parts)));
        const water = rho * areaM * depth;
        const vel = sim.body.getLinearVelocityFromWorldPoint(centre);
        sim.body.applyForce(planck.Vec2(-vel.x * WATER_DRAG * water, -vel.y * WATER_DRAG * water), centre, true);
        sim.body.setAngularVelocity(sim.body.getAngularVelocity() * (1 - 0.05 * fraction));
      }
      w.displaced = displaced;
      const wanted = (w.area + displaced) / box.width;
      if (wanted > box.height) {
        // Over the rim: the extra spills, and is gone.
        const over = (wanted - box.height) * box.width;
        const lost = Math.min(over, w.area);
        w.area -= lost;
        w.spilled += (lost / ppm ** 2) * depth * 1e6;
        w.level = box.height;
      } else {
        // Ease towards the new level, as water does.
        w.level += (wanted - w.level) * 0.25;
      }
    }
  }

  private measureJoints() {
    const inv = 1 / STEP;
    let support = 0;
    let breaking: SimJoint[] = [];
    for (const j of this.joints.values()) {
      const f = j.joint.getReactionForce(inv);
      const force = Math.hypot(f.x, f.y);
      j.force += (force - j.force) * FORCE_SMOOTHING;
      if (j.anchor) support += -f.y;
      if (j.strength != null && j.force > j.strength) breaking.push(j);
    }
    // What the bridge carries beyond its own weight.
    if (this.def.build && !this.building) {
      let own = 0;
      for (const sim of this.bodies.values()) if (sim.beam) own += sim.body.getMass() * this.gravity;
      for (const knot of this.knots()) own += knot.getMass() * this.gravity;
      // Smoothed, and not counted while a new bridge settles onto its footings.
      this.load += (Math.max(0, Math.abs(support) - own) - this.load) * 0.2;
      if (this.broken.size === 0 && this.time > SETTLE_SECONDS) this.maxLoad = Math.max(this.maxLoad, this.load);
    }
    for (const j of breaking) this.breakJoint(j);
    breaking = [];
  }

  private *knots(): Iterable<planck.Body> {
    for (let b = this.world.getBodyList(); b; b = b.getNext()) {
      const data = b.getUserData() as { id?: string } | null;
      if (!data && b.isDynamic()) yield b;
    }
  }

  private breakJoint(j: SimJoint) {
    if (!this.joints.has(j.id)) return;
    this.world.destroyJoint(j.joint);
    this.joints.delete(j.id);
    const name = j.beam ?? j.id;
    // Only a break while someone was pressing says how hard pressing breaks it.
    if (this.broken.size === 0) this.firstBreakPress = this.presses.size ? this.pressForce() : null;
    this.broken.add(j.id);
    if (j.beam) this.broken.add(j.beam);
    this.listener.broke?.(name);
    for (const watch of this.def.watches ?? []) {
      if (watch.when !== 'break' || this.fired.has(watch.id)) continue;
      if (watch.joint_id && watch.joint_id !== j.id && watch.joint_id !== j.beam) continue;
      this.fire(watch, this.pressForce() || this.maxLoad || null);
    }
  }

  private pressForce(): number {
    let f = 0;
    for (const p of this.presses.values()) f = Math.max(f, p.force);
    return f;
  }

  private trackBodies() {
    for (const sim of this.bodies.values()) {
      if (sim.body.isStatic()) continue;
      const v = sim.body.getLinearVelocity();
      const t = sim.track;
      const height = this.heightOf(sim);
      if (height != null) {
        t.maxHeight = Math.max(t.maxHeight, height);
        // At the top of a bounce the body stops rising (y grows downwards: rising is negative vy).
        if (v.y < -0.3) t.rising = true;
        else if (t.rising && v.y >= 0) {
          t.rising = false;
          t.bounce ??= height;
        }
      }
      // A swing: each time it turns back at the right-hand end.
      t.peakSpeed = Math.max(t.peakSpeed, Math.abs(v.x));
      if (t.lastVx > 0 && v.x <= 0 && t.peakSpeed > 0.03) {
        if (t.rightAt != null) {
          t.period = this.time - t.rightAt;
          t.swings++;
        }
        t.rightAt = this.time;
        t.peakSpeed = 0;
      }
      t.lastVy = v.y;
      t.lastVx = v.x;
    }
  }

  /** Bodies that have fallen far out of the scene are taken away. */
  private dropLost() {
    const limit = this.m(this.size.height + 1500);
    for (const sim of [...this.bodies.values()]) {
      if (sim.body.isStatic() || sim.body.getPosition().y < limit) continue;
      for (const [who, grab] of this.grabs) if (grab.body === sim) this.drop(who);
      for (const [who, press] of this.presses) if (press.body === sim) this.presses.delete(who);
      this.world.destroyBody(sim.body);
      this.bodies.delete(sim.def.id);
      this.removed.add(sim.def.id);
      this.bump();
    }
  }

  /** How high the bottom of the body is above the floor, in metres. */
  private heightOf(sim: SimBody): number | null {
    const floorY = this.def.floor_y === null ? this.size.height : this.def.floor_y ?? this.size.height;
    let bottom = -Infinity;
    for (let f = sim.body.getFixtureList(); f; f = f.getNext()) bottom = Math.max(bottom, f.getAABB(0).upperBound.y);
    if (!Number.isFinite(bottom)) return null;
    // AABBs carry a small margin; take it off so a body on the floor reads 0.
    return Math.max(0, (floorY - bottom * this.units.ppm) / this.units.ppm - 0.01);
  }

  // ------------------------------------------------------------------ readings and watches

  reading(r: Pick<PhysicsReadout, 'measure' | 'body_id' | 'water_id'>): number | null {
    const sim = r.body_id ? this.bodies.get(r.body_id) : undefined;
    const water = r.water_id ? this.water.find((w) => w.id === r.water_id) : this.water[0];
    const { ppm, depth } = this.units;
    const m: PhysicsMeasure = r.measure;
    switch (m) {
      case 'height': return sim ? this.heightOf(sim) : null;
      case 'bounce_height': return sim?.track.bounce ?? null;
      case 'max_height': return sim ? sim.track.maxHeight : null;
      case 'speed': return sim ? Math.hypot(sim.body.getLinearVelocity().x, sim.body.getLinearVelocity().y) : null;
      case 'mass': return sim ? this.massOf(sim) : null;
      case 'angle': return sim ? ((sim.body.getAngle() - sim.startAngle) * 180) / Math.PI : null;
      case 'period': return sim?.track.period ?? null;
      case 'swings': return sim ? sim.track.swings : null;
      case 'water_level': return water ? (water.level / ppm) * 100 : null;
      case 'water_rise': return water ? ((water.level - water.startLevel) / ppm) * 100 : null;
      case 'displaced': return water ? (water.displaced / ppm ** 2) * depth * 1e6 : null;
      case 'spilled': return water ? water.spilled : null;
      case 'press_force': return this.pressForce();
      case 'break_force': return this.firstBreakPress;
      case 'breaks': {
        const joints = new Set((this.def.joints ?? []).map((j) => j.id));
        return [...this.broken].filter((id) => joints.has(id) || this.design.some((b) => b.id === id)).length;
      }
      case 'load': return this.def.build ? this.load : null;
      case 'max_load': return this.def.build ? this.maxLoad : null;
      case 'stress': return this.maxStress() * 100;
      case 'cost': return this.def.build ? designCost(this.def.build, this.design, ppm) : null;
      case 'time': return this.time;
    }
    // Measures added later that this build does not know.
    return null;
  }

  /** What the bridge holds up beyond its own weight (N), and the most it held before anything broke. */
  bridgeLoad(): { now: number; max: number } {
    return { now: this.load, max: this.maxLoad };
  }

  private massOf(sim: SimBody): number {
    if (!sim.body.isStatic()) return sim.body.getMass();
    const material = materialOf(sim.def.material);
    if (sim.def.mass) return sim.def.mass;
    return (partsArea(sim.parts) / this.units.ppm ** 2) * (sim.def.density ?? material.density) * this.units.depth;
  }

  private maxStress(): number {
    let most = 0;
    for (const j of this.joints.values()) if (j.strength) most = Math.max(most, j.force / j.strength);
    return most;
  }

  readings(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const r of this.def.readouts ?? []) out[r.id] = this.reading(r);
    return out;
  }

  private checkWatches() {
    const watches = this.def.watches ?? [];
    if (!watches.length) return;
    for (const watch of watches) {
      if (this.fired.has(watch.id)) continue;
      switch (watch.when) {
        case 'reading': {
          const r = (this.def.readouts ?? []).find((x) => x.id === watch.readout_id);
          const value = r ? this.reading(r) : null;
          const now = value != null && passes(value, watch.operator, watch.value ?? 0);
          // It fires when the reading comes to pass, not merely because it already held.
          if (now && this.readingWas.get(watch.id) === false) this.fire(watch, value);
          this.readingWas.set(watch.id, now);
          break;
        }
        case 'enter': {
          const water = watch.water_id ? this.water.find((w) => w.id === watch.water_id) : null;
          const box = water ? this.waterBox(water.def) : null;
          const region = water && box ? { x: box.x, y: box.y + box.height - water.level, width: box.width, height: water.level } : watch.region;
          if (!region) break;
          for (const sim of this.bodies.values()) {
            if (sim.body.isStatic() || sim.beam || (watch.body_id && sim.def.id !== watch.body_id)) continue;
            const p = sim.body.getPosition();
            const x = p.x * this.units.ppm;
            const y = p.y * this.units.ppm;
            if (x >= region.x && x <= region.x + region.width && y >= region.y && y <= region.y + region.height) {
              this.fire(watch, null);
              break;
            }
          }
          break;
        }
        case 'spill': {
          const spilt = this.water.some((w) => (!watch.water_id || w.id === watch.water_id) && w.spilled > 0.5);
          if (spilt) this.fire(watch, this.water.find((w) => !watch.water_id || w.id === watch.water_id)?.spilled ?? null);
          break;
        }
        case 'rest':
        case 'balanced': {
          if (!this.armed) break;
          let ok: boolean;
          if (watch.when === 'rest') {
            ok = [...this.bodies.values()].every((s) => s.body.isStatic() || !s.body.isAwake() || speedOf(s.body) < 0.02);
          } else {
            const sim = watch.body_id ? this.bodies.get(watch.body_id) : undefined;
            ok = !!sim && Math.abs(((sim.body.getAngle() - sim.startAngle) * 180) / Math.PI) <= (watch.value ?? 2) && Math.abs(sim.body.getAngularVelocity()) < 0.05;
            // A balance with a player's hand on it is not balanced by itself.
            if ([...this.grabs.values()].some((g) => g.body === sim)) ok = false;
          }
          if (!ok) {
            this.watchSince.delete(watch.id);
            break;
          }
          const since = this.watchSince.get(watch.id) ?? this.time;
          this.watchSince.set(watch.id, since);
          if (this.time - since >= (watch.hold ?? 1.5)) {
            const sim = watch.body_id ? this.bodies.get(watch.body_id) : undefined;
            this.fire(watch, sim ? ((sim.body.getAngle() - sim.startAngle) * 180) / Math.PI : this.time);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  private fire(watch: PhysicsWatch, value: number | null) {
    this.fired.add(watch.id);
    this.listener.fired?.(watch, value);
  }

  // ------------------------------------------------------------------ what players do

  /** Apply a player's input. Returns why it was refused, or null. */
  input(who: Actor, msg: PhysicsInput): string | null {
    switch (msg.op) {
      case 'grab': return this.grab(who, msg.body, msg);
      case 'drag': this.drag(who, msg); return null;
      case 'drop': this.drop(who); return null;
      case 'press': return this.press(who, msg.body, msg);
      case 'unpress': this.presses.delete(who); return null;
      case 'take': return this.take(who, msg.entry, msg);
      case 'beam': return this.addBeam(msg.a, msg.b, msg.kind);
      case 'unbeam': return this.removeBeam(msg.id);
      case 'clear': return this.clearDesign();
      case 'sync': return null;
      case 'control': return this.control(msg.control, msg);
    }
    return 'Unknown input.';
  }

  /** The body under a point, if any (the topmost one that can be moved, else any). */
  bodyAt(at: Point, movable = true): string | null {
    const p = this.v(at);
    let found: string | null = null;
    for (const sim of this.bodies.values()) {
      if (movable && (sim.def.fixed || sim.beam || sim.def.draggable === false)) continue;
      for (let f = sim.body.getFixtureList(); f; f = f.getNext()) {
        if (f.testPoint(p)) found = sim.def.id;
      }
    }
    return found;
  }

  grab(who: Actor, id: string, at: Point): string | null {
    const sim = this.bodies.get(id);
    if (!sim || sim.def.fixed || sim.beam || sim.def.draggable === false) return 'That cannot be moved.';
    this.drop(who);
    if (this.building) return 'Test the design first.';
    this.armed = true;
    const target = this.v(at);
    if (sim.held) {
      const c = sim.body.getPosition();
      const grab: Grab & { target?: planck.Vec2 } = { body: sim, joint: null, offset: planck.Vec2(target.x - c.x, target.y - c.y), target };
      this.grabs.set(who, grab);
      return null;
    }
    const joint = this.world.createJoint(new planck.MouseJoint({ maxForce: 60 * sim.body.getMass() * Math.max(this.gravity, 9.81), frequencyHz: 5, dampingRatio: 0.7 }, this.ground, sim.body, target)) as planck.MouseJoint;
    sim.body.setAwake(true);
    this.grabs.set(who, { body: sim, joint, offset: planck.Vec2(0, 0) });
    return null;
  }

  drag(who: Actor, at: Point) {
    const grab = this.grabs.get(who) as (Grab & { target?: planck.Vec2 }) | undefined;
    if (!grab) return;
    const target = this.v(at);
    if (grab.joint) grab.joint.setTarget(target);
    else grab.target = target;
    // While paused a held body still follows the pointer, so the drop can be set up.
    if (this.paused || this.building) this.dragHeld();
  }

  drop(who: Actor) {
    const grab = this.grabs.get(who);
    if (!grab) return;
    if (grab.joint) this.world.destroyJoint(grab.joint);
    this.grabs.delete(who);
    // Let go of: what it does from here is a new drop, measured afresh.
    const t = grab.body.track;
    t.bounce = null;
    t.rising = false;
    t.maxHeight = this.heightOf(grab.body) ?? 0;
    t.rightAt = null;
    t.period = null;
    t.swings = 0;
    t.peakSpeed = 0;
  }

  press(who: Actor, id: string, at: Point): string | null {
    if (!this.def.press?.enabled) return 'There is no pressing here.';
    const sim = this.bodies.get(id);
    if (!sim || sim.body.isStatic()) return 'Press on something that can move.';
    this.armed = true;
    this.presses.set(who, { body: sim, local: sim.body.getLocalPoint(this.v(at)), since: this.time, force: 0 });
    return null;
  }

  /** Take something out of the tray, at a point, and hold it there. */
  take(who: Actor, entryId: string, at: Point): string | null {
    const entry = (this.def.tray ?? []).find((e) => e.id === entryId);
    if (!entry) return 'That is not in the tray.';
    if (this.building) return 'Test the design first.';
    const left = this.trayLeft.has(entry.id) ? this.trayLeft.get(entry.id)! : entry.count ?? null;
    if (left != null && left <= 0) return `There are no more ${entry.label ?? 'of those'}.`;
    this.trayLeft.set(entry.id, left == null ? null : left - 1);
    const def: PhysicsBody = { ...entry.body, id: `${entry.id}#${this.nextSpawn++}`, x: at.x, y: at.y, held: false };
    this.spawned.push(def);
    const sim = this.addBody(def, true, null);
    this.bump();
    if (sim) this.grab(who, def.id, at);
    return null;
  }

  removeBody(id: string): string | null {
    const sim = this.bodies.get(id);
    if (!sim || sim.beam) return 'There is no such body.';
    for (const [who, grab] of this.grabs) if (grab.body === sim) this.drop(who);
    for (const [who, press] of this.presses) if (press.body === sim) this.presses.delete(who);
    this.world.destroyBody(sim.body);
    this.bodies.delete(id);
    this.removed.add(id);
    this.bump();
    return null;
  }

  addBeam(a: Point, b: Point, kind: number): string | null {
    const build = this.def.build;
    if (!build) return 'There is nothing to build here.';
    if (!this.building) return 'Go back to building first.';
    const beam = { a: snapToGrid(build, a), b: snapToGrid(build, b), kind };
    const problem = beamProblem(build, this.design, beam, this.units.ppm);
    if (problem) return problem;
    this.design.push({ ...beam, id: `b${this.nextBeam++}` });
    this.armed = true;
    this.bump();
    return null;
  }

  removeBeam(id: string): string | null {
    if (!this.building) return 'Go back to building first.';
    const before = this.design.length;
    this.design = this.design.filter((b) => b.id !== id);
    if (this.design.length === before) return 'There is no such beam.';
    this.bump();
    return null;
  }

  clearDesign(): string | null {
    if (!this.building) return 'Go back to building first.';
    this.design = [];
    this.bump();
    return null;
  }

  control(op: PhysicsOp, opts: { value?: number; body?: string; entry?: string; x?: number; y?: number } = {}): string | null {
    switch (op) {
      case 'play': this.paused = false; this.armed = true; return null;
      case 'pause': this.paused = true; return null;
      case 'slow': this.slow = true; return null;
      case 'normal': this.slow = false; return null;
      case 'reset': this.reset(); return null;
      case 'gravity':
        if (typeof opts.value !== 'number' || !Number.isFinite(opts.value) || opts.value < 0 || opts.value > 100) return 'Gravity is between 0 and 100 m/s².';
        this.gravity = opts.value;
        this.world.setGravity(planck.Vec2(0, opts.value));
        for (const sim of this.bodies.values()) if (!sim.body.isStatic()) sim.body.setAwake(true);
        return null;
      case 'release':
        this.armed = true;
        for (const sim of this.bodies.values()) {
          if (!sim.held || (opts.body && sim.def.id !== opts.body)) continue;
          for (const [who, grab] of this.grabs) if (grab.body === sim) this.drop(who);
          sim.held = false;
          sim.body.setDynamic();
          sim.body.setAwake(true);
          sim.track.maxHeight = this.heightOf(sim) ?? 0;
          sim.track.bounce = null;
        }
        return null;
      case 'spawn':
        if (!opts.entry) return 'No tray entry is named.';
        return this.spawnAt(opts.entry, { x: opts.x ?? this.size.width / 2, y: opts.y ?? this.size.height / 3 });
      case 'remove':
        return opts.body ? this.removeBody(opts.body) : 'No body is named.';
      case 'test':
        if (!this.def.build) return 'There is nothing to test.';
        if (!this.building) return null;
        this.building = false;
        this.armed = true;
        this.resetWorld();
        return null;
      case 'build':
        if (!this.def.build) return null;
        this.building = true;
        this.resetWorld();
        return null;
    }
    return 'Unknown control.';
  }

  /** A tray entry added by an event: it falls from where it is put, held by nobody. */
  private spawnAt(entryId: string, at: Point): string | null {
    const problem = this.take('\u0000event', entryId, at);
    this.drop('\u0000event');
    return problem;
  }

  /** Start again: everything back where it was, the tray full; a bridge goes back to being built, its design kept. */
  reset() {
    this.spawned = [];
    this.trayLeft.clear();
    this.building = !!this.def.build;
    this.paused = this.def.paused === true;
    this.resetWorld();
  }

  private resetWorld() {
    this.removed.clear();
    this.broken.clear();
    this.time = 0;
    this.accumulator = 0;
    this.firstBreakPress = null;
    this.maxLoad = 0;
    this.load = 0;
    this.armed = false;
    this.watchSince.clear();
    this.readingWas.clear();
    for (const watch of this.def.watches ?? []) if (watch.repeat !== false) this.fired.delete(watch.id);
    this.build();
    this.bump();
  }

  private bump() {
    this.version++;
    this.listener.changed?.();
  }

  // ------------------------------------------------------------------ reporting

  layout(): PhysicsLayout {
    const tray: Record<string, number | null> = {};
    for (const e of this.def.tray ?? []) tray[e.id] = this.trayLeft.has(e.id) ? this.trayLeft.get(e.id)! : e.count ?? null;
    return { version: this.version, spawned: this.spawned.map((b) => ({ ...b })), removed: [...this.removed], design: this.design.map((b) => ({ ...b })), tray };
  }

  snapshot(): PhysicsSnapshot {
    const { ppm } = this.units;
    const bodies: PhysicsPose[] = [];
    for (const sim of this.bodies.values()) {
      if (sim.def.fixed) continue;
      const p = sim.body.getPosition();
      bodies.push([sim.def.id, round2(p.x * ppm), round2(p.y * ppm), round4(sim.body.getAngle())]);
    }
    const stress: Array<[string, number]> = [];
    const beamStress = new Map<string, number>();
    for (const j of this.joints.values()) {
      if (!j.strength) continue;
      const ratio = j.force / j.strength;
      if (j.beam) beamStress.set(j.beam, Math.max(beamStress.get(j.beam) ?? 0, ratio));
      else stress.push([j.id, round2(ratio)]);
    }
    for (const [id, ratio] of beamStress) stress.push([id, round2(ratio)]);
    const links: PhysicsSnapshot['links'] = [];
    for (const j of this.joints.values()) {
      if (!j.visible || j.kind === 'weld' || (j.beam && j.kind !== 'rope')) continue;
      const a = j.joint.getAnchorA();
      const b = j.joint.getAnchorB();
      links.push([j.beam ?? j.id, round2(a.x * ppm), round2(a.y * ppm), round2(b.x * ppm), round2(b.y * ppm), j.kind]);
    }
    const presses = [...this.presses.values()].map((p) => {
      const at = p.body.body.getWorldPoint(p.local);
      return { x: round2(at.x * ppm), y: round2(at.y * ppm), force: Math.round(p.force) };
    });
    return {
      t: round2(this.time),
      paused: this.paused,
      slow: this.slow,
      gravity: this.gravity,
      building: this.building,
      bodies,
      water: this.water.map((w) => [w.id, round2(w.level), Math.round(w.spilled)]),
      broken: [...this.broken],
      stress,
      links,
      held: [...this.bodies.values()].filter((b) => b.held).map((b) => b.def.id),
      presses,
      readings: this.readings(),
    };
  }

  /** Where each water's container is now, in scene pixels. */
  waterBoxes(): Record<string, Box | null> {
    const out: Record<string, Box | null> = {};
    for (const w of this.water) out[w.id] = this.waterBox(w.def);
    return out;
  }

  /** The length of the longest beam allowed, and the cost of the design: for the build tool's hints. */
  designSummary(): { cost: number; beams: number; length: number } {
    const build = this.def.build;
    return {
      cost: build ? designCost(build, this.design, this.units.ppm) : 0,
      beams: this.design.length,
      length: this.design.reduce((s, b) => s + beamLength(b), 0) / this.units.ppm,
    };
  }
}

// ------------------------------------------------------------------ geometry helpers

function emptyTrack(): SimBody['track'] {
  return { lastVy: 0, lastVx: 0, rising: false, bounce: null, maxHeight: 0, rightAt: null, peakSpeed: 0, period: null, swings: 0 };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

function speedOf(body: planck.Body): number {
  const v = body.getLinearVelocity();
  return Math.hypot(v.x, v.y) + Math.abs(body.getAngularVelocity()) * 0.1;
}

function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

/** Area of a body's outline in square pixels. */
export function partsArea(parts: BodyPart[]): number {
  return parts.reduce((s, p) => s + (p.kind === 'circle' ? Math.PI * p.r * p.r : polygonArea(p.points)), 0);
}

/** A part's outline in scene pixels, a circle as a 48-sided polygon (its area 0.3% short). */
function worldOutline(part: BodyPart, cx: number, cy: number, angle: number): Point[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const local = part.kind === 'circle'
    ? Array.from({ length: 48 }, (_, i) => ({ x: part.x + part.r * Math.cos((i / 48) * Math.PI * 2), y: part.y + part.r * Math.sin((i / 48) * Math.PI * 2) }))
    : part.points;
  return local.map((p) => ({ x: cx + p.x * cos - p.y * sin, y: cy + p.x * sin + p.y * cos }));
}

/** Cut a polygon down to the part on one side of a line (Sutherland–Hodgman). */
function clip(points: Point[], inside: (p: Point) => boolean, cross: (a: Point, b: Point) => Point): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const ia = inside(a);
    const ib = inside(b);
    if (ia) out.push(a);
    if (ia !== ib) out.push(cross(a, b));
  }
  return out;
}

const atY = (y: number) => (a: Point, b: Point): Point => ({ x: a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y), y });
const atX = (x: number) => (a: Point, b: Point): Point => ({ x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) });

/** The part of a body inside a box (the water), as an area in square pixels and its centre. */
function submerged(sim: SimBody, ppm: number, box: { x0: number; x1: number; y0: number; y1: number }): { area: number; cx: number; cy: number } {
  const p = sim.body.getPosition();
  const angle = sim.body.getAngle();
  let area = 0;
  let sx = 0;
  let sy = 0;
  for (const part of sim.parts) {
    let poly = worldOutline(part, p.x * ppm, p.y * ppm, angle);
    poly = clip(poly, (q) => q.y >= box.y0, atY(box.y0));
    poly = clip(poly, (q) => q.y <= box.y1, atY(box.y1));
    poly = clip(poly, (q) => q.x >= box.x0, atX(box.x0));
    poly = clip(poly, (q) => q.x <= box.x1, atX(box.x1));
    if (poly.length < 3) continue;
    const a = polygonArea(poly);
    const c = centroid(poly);
    area += a;
    sx += c.x * a;
    sy += c.y * a;
  }
  return area > 0 ? { area, cx: sx / area, cy: sy / area } : { area: 0, cx: 0, cy: 0 };
}

function centroid(points: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const q = points[(i + 1) % points.length]!;
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) return points[0]!;
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export { beamBodyId };
