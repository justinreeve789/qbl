/**
 * [ext] Physics scenes: experiments with real (2D) physics. A scene whose `physics.enabled` is
 * true simulates its bodies, water, joints and bridge in metres, kilograms and seconds, and lets
 * players drag, drop, press and build. This file holds the document's shape and the plain
 * arithmetic both ends need; the simulation itself (planck.js) is in physics-sim.ts, imported as
 * `@qbl/shared/physics-sim` so that the editor does not carry it.
 */
import type { Id, Point, VarValue } from './types.js';

// ------------------------------------------------------------------ materials

export interface PhysicsMaterial {
  label: string;
  /** kg per cubic metre. */
  density: number;
  /** 0 = stops dead, 1 = bounces back as high as it fell. The coefficient of restitution. */
  bounciness: number;
  /** 0 = slides forever, around 1 = grips. */
  friction: number;
  color: string;
  /** For bridge beams and joints: the force in newtons a joint of this material breaks at. */
  strength: number;
  /** A beam of this material only pulls: it goes slack when pushed (rope, cable). */
  tension_only?: boolean;
}

/**
 * Materials an author can choose. The numbers are textbook values, rounded; restitution is the
 * material bouncing on a hard floor. Strengths are for a 10 cm × 10 cm member, scaled down so a
 * classroom-sized bridge fails at loads students can reach.
 */
export const PHYSICS_MATERIALS: Record<string, PhysicsMaterial> = {
  rubber: { label: 'Rubber', density: 1100, bounciness: 0.85, friction: 0.9, color: '#d9503f', strength: 1500 },
  plastic: { label: 'Plastic', density: 950, bounciness: 0.6, friction: 0.4, color: '#4f8fd9', strength: 2500 },
  wood: { label: 'Wood', density: 600, bounciness: 0.45, friction: 0.5, color: '#b47c48', strength: 4000 },
  steel: { label: 'Steel', density: 7850, bounciness: 0.6, friction: 0.45, color: '#8d99a6', strength: 16000 },
  glass: { label: 'Glass', density: 2500, bounciness: 0.65, friction: 0.3, color: '#9fd3e6', strength: 800 },
  rock: { label: 'Rock', density: 2600, bounciness: 0.2, friction: 0.7, color: '#7d7468', strength: 3000 },
  clay: { label: 'Clay', density: 1800, bounciness: 0.05, friction: 0.8, color: '#c4774f', strength: 300 },
  foam: { label: 'Foam', density: 50, bounciness: 0.3, friction: 0.8, color: '#f0dd8c', strength: 200 },
  ice: { label: 'Ice', density: 920, bounciness: 0.2, friction: 0.03, color: '#cfeefa', strength: 600 },
  cork: { label: 'Cork', density: 240, bounciness: 0.4, friction: 0.6, color: '#c9a26b', strength: 400 },
  lead: { label: 'Lead', density: 11340, bounciness: 0.1, friction: 0.5, color: '#5f6670', strength: 2000 },
  rope: { label: 'Rope', density: 1100, bounciness: 0, friction: 0.6, color: '#c8a46a', strength: 3000, tension_only: true },
};

export const DEFAULT_MATERIAL = 'wood';

export function materialOf(name: string | null | undefined): PhysicsMaterial {
  return PHYSICS_MATERIALS[name ?? ''] ?? PHYSICS_MATERIALS[DEFAULT_MATERIAL]!;
}

/** Gravity on a few worlds, in m/s², for the gravity chooser. */
export const GRAVITY_PRESETS: ReadonlyArray<readonly [name: string, g: number]> = [
  ['Earth', 9.81], ['Moon', 1.62], ['Mars', 3.71], ['Jupiter', 24.79], ['No gravity', 0],
];

// ------------------------------------------------------------------- the document

export type PhysicsShape = 'circle' | 'box' | 'polygon' | 'cup';

export interface PhysicsBody {
  /** Unique within the scene. Joints, water, readouts and watches name bodies by it. */
  id: string;
  name?: string;
  shape: PhysicsShape;
  /** Centre, in scene pixels. A cup's centre is the middle of its outline. */
  x: number;
  y: number;
  /** Degrees, clockwise. */
  angle?: number;
  /** circle */
  radius?: number;
  /** box, cup: outer size in pixels. */
  width?: number;
  height?: number;
  /** cup: wall and floor thickness in pixels (default 12). */
  wall?: number;
  /** polygon: corners relative to x, y. Made convex if they are not. */
  points?: Point[];
  /** A key of PHYSICS_MATERIALS. Default wood. */
  material?: string;
  /** Overrides of the material's numbers. */
  density?: number;
  bounciness?: number;
  friction?: number;
  /** kg. Sets the density so the body weighs this much (it is 2D: see ScenePhysics.depth). */
  mass?: number;
  /**
   * How quickly it loses its motion, by itself: air resistance, a stiff hinge. 0 (default) keeps
   * swinging; around 2 settles in a few swings (a balance beam).
   */
  damping?: number;
  /** Never moves: a floor, a shelf, a cliff, a glass on a table. */
  fixed?: boolean;
  /** Stays where it is put until released (a Drop button, or a physics action). Players may still move it. */
  held?: boolean;
  /** Players may pick it up and move it. Default true for bodies that are not fixed. */
  draggable?: boolean;
  /** Default: the material's colour. */
  color?: string;
  /** Not drawn: the background already shows it (a cliff, a table top). It is still solid. */
  hidden?: boolean;
  /** A picture drawn over the shape, stretched to its size. */
  media_id?: Id;
  /** Text written on the body ("2 kg"). */
  label?: string;
  /** Draw a ruler along it: a tick every 10 cm, numbered from its middle (a seesaw plank). */
  marks?: boolean;
}

export interface PhysicsWater {
  id: string;
  name?: string;
  /**
   * A cup the water fills. Its inside is the container, and the water moves with it. Without one,
   * the container is the box x, y (top left), width, height: a tank drawn in the background.
   */
  body_id?: string | null;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** How deep the water starts, in pixels from the container's floor. */
  level: number;
  /** kg per cubic metre. Default 1000 (fresh water); 1025 for sea water. */
  density?: number;
  color?: string;
  /** Draw a scale up the side, in millilitres. */
  marks?: boolean;
}

export type PhysicsJointType = 'pin' | 'weld' | 'string' | 'spring' | 'rope';

export interface PhysicsJoint {
  id: string;
  name?: string;
  /**
   * pin: the bodies turn about one point (a hinge, a seesaw's pivot). weld: they are stuck
   * together at it. string: a fixed distance from x, y on `body_a` to x2, y2 (a pendulum).
   * spring: as string, but it stretches. rope: at most that distance; it goes slack.
   */
  type: PhysicsJointType;
  body_a: string;
  /** Absent: fixed to the world at the point. */
  body_b?: string | null;
  /** The joint's point on body_a, in scene pixels. */
  x: number;
  y: number;
  /** string, spring, rope: the other end (on body_b, or on the world). */
  x2?: number;
  y2?: number;
  /** Breaks when the force through it goes over this many newtons. Absent: never breaks. */
  strength?: number | null;
  /** pin: how far it may turn, in degrees from where it starts. */
  min_angle?: number | null;
  max_angle?: number | null;
  /** spring: how stiff, as oscillations per second (default 2). */
  stiffness?: number;
  /** spring: 0 bounces for ever, 1 settles at once (default 0.3). */
  damping?: number;
  /** Draw the joint (default true). */
  visible?: boolean;
}

/** A kind of beam students may build with. */
export interface PhysicsBeamType {
  material: string;
  label?: string;
  /** Newtons a joint at either end of the beam takes before it breaks. Default: the material's. */
  strength?: number;
  /** What a metre costs against the budget. Default 0. */
  cost_per_meter?: number;
  /** Loads rest on it: a road or deck. Other beams only hold the structure up and do not touch loads. */
  deck?: boolean;
  /** Pixels. Default: the build area's. */
  max_length?: number;
  /** Thickness in pixels (default 12). */
  thickness?: number;
}

/** A beam of a design: from a to b, both on the build grid. */
export interface PhysicsBeam {
  id: string;
  a: Point;
  b: Point;
  /** Index into PhysicsBuild.beams. */
  kind: number;
}

/** Where students build (a bridge), with what, and what is fixed to the world to build from. */
export interface PhysicsBuild {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Beam ends snap to a grid this many pixels apart (default 25). */
  grid?: number;
  /** Points fixed to the world that beams may start from: the bridge's footings. */
  anchors: Point[];
  beams: PhysicsBeamType[];
  /** The most a design may cost. Absent: no limit. */
  budget?: number | null;
  /** Longest beam, in pixels (default 250). */
  max_length?: number;
  /** A design students start from. */
  preset?: PhysicsBeam[];
}

/** Something players may take out of the tray and drop into the scene: a weight, a ball. */
export interface PhysicsTrayEntry {
  id: string;
  label?: string;
  /** How many may be taken out. Absent: as many as they like. */
  count?: number | null;
  body: Omit<PhysicsBody, 'id' | 'x' | 'y'>;
}

export type PhysicsMeasure =
  | 'height' | 'bounce_height' | 'max_height' | 'speed' | 'mass' | 'angle' | 'period' | 'swings'
  | 'water_level' | 'water_rise' | 'displaced' | 'spilled'
  | 'press_force' | 'break_force' | 'load' | 'max_load' | 'breaks' | 'stress' | 'cost' | 'time';

/** What each measure is, its unit, and what it needs to be told. */
export const PHYSICS_MEASURES: Record<PhysicsMeasure, { label: string; unit: string; needs?: 'body' | 'water'; decimals: number; about: string }> = {
  height: { label: 'Height', unit: 'm', needs: 'body', decimals: 2, about: 'How high the bottom of the body is above the floor, now.' },
  bounce_height: { label: 'Bounce height', unit: 'm', needs: 'body', decimals: 2, about: 'How high the body rose after it first hit the floor, measured from the floor. Picking it up and letting go starts again.' },
  max_height: { label: 'Highest point', unit: 'm', needs: 'body', decimals: 2, about: 'The highest the body has been since it was released or the experiment was reset.' },
  speed: { label: 'Speed', unit: 'm/s', needs: 'body', decimals: 2, about: 'How fast the body is moving.' },
  mass: { label: 'Mass', unit: 'kg', needs: 'body', decimals: 2, about: 'What the body weighs.' },
  angle: { label: 'Tilt', unit: '°', needs: 'body', decimals: 1, about: 'How far the body has turned from where it started: a seesaw’s tilt.' },
  period: { label: 'Swing time', unit: 's', needs: 'body', decimals: 2, about: 'How long one full swing (there and back) of the body takes: a pendulum’s period.' },
  swings: { label: 'Swings', unit: '', needs: 'body', decimals: 0, about: 'How many full swings the body has made.' },
  water_level: { label: 'Water level', unit: 'cm', needs: 'water', decimals: 1, about: 'How deep the water is.' },
  water_rise: { label: 'Water rise', unit: 'cm', needs: 'water', decimals: 1, about: 'How far the water has risen since the start.' },
  displaced: { label: 'Water pushed aside', unit: 'mL', needs: 'water', decimals: 0, about: 'The volume of the parts of bodies under water: the water they push aside.' },
  spilled: { label: 'Spilled', unit: 'mL', needs: 'water', decimals: 0, about: 'Water that has overflowed the container.' },
  press_force: { label: 'Pushing with', unit: 'N', decimals: 0, about: 'How hard the player is pressing down, now.' },
  break_force: { label: 'Broke at', unit: 'N', decimals: 0, about: 'How hard the player was pressing when something first broke.' },
  load: { label: 'Load carried', unit: 'N', decimals: 0, about: 'What the bridge is holding up beyond its own weight, now: the weights on it and any pressing.' },
  max_load: { label: 'Most it held', unit: 'N', decimals: 0, about: 'The greatest load the bridge carried before anything broke.' },
  breaks: { label: 'Broken joints', unit: '', decimals: 0, about: 'How many joints and beams have broken.' },
  stress: { label: 'Most strained', unit: '%', decimals: 0, about: 'How close the most strained joint or beam is to breaking.' },
  cost: { label: 'Cost', unit: '', decimals: 0, about: 'What the design costs, against the budget.' },
  time: { label: 'Time', unit: 's', decimals: 1, about: 'Seconds since the experiment started or was reset.' },
};

/** A number shown on screen while the experiment runs, and optionally kept in a variable. */
export interface PhysicsReadout {
  id: string;
  label?: string;
  measure: PhysicsMeasure;
  body_id?: string | null;
  water_id?: string | null;
  decimals?: number;
  /** Keep the value in this variable, so events, objectives and reports can use it. */
  variable?: string | null;
  /** Do not show it on screen (only keep it in the variable). */
  hidden?: boolean;
}

export type PhysicsWatchWhen = 'break' | 'enter' | 'reading' | 'rest' | 'balanced' | 'spill';

/** Something to notice: when it happens, set a variable and/or run an event of the scene. */
export interface PhysicsWatch {
  id: string;
  name?: string;
  /**
   * break: a joint or beam breaks (`joint_id`, or any). enter: a body (`body_id`, or any that
   * moves) enters `region` or the water `water_id`. reading: the readout `readout_id` passes
   * `value` (`operator`). rest: everything has stopped moving for `hold` seconds. balanced: the
   * body `body_id` stays within `value` degrees of level for `hold` seconds. spill: water
   * overflows (`water_id`, or any). Rest and balanced wait until a player has done something.
   */
  when: PhysicsWatchWhen;
  joint_id?: string | null;
  body_id?: string | null;
  water_id?: string | null;
  readout_id?: string | null;
  operator?: '>' | '>=' | '<' | '<=' | '=';
  value?: number;
  region?: { x: number; y: number; width: number; height: number } | null;
  /** Seconds (rest, balanced). Default 1.5. */
  hold?: number;
  /** Run this indirect event of the scene. */
  event_id?: Id | null;
  /** Set this variable: to `set`, or failing that to the reading (reading), or 1. */
  variable?: string | null;
  set?: VarValue | null;
  /** Fire again after a reset (default true). Within one run a watch fires once. */
  repeat?: boolean;
}

export interface PhysicsControls {
  /** A play/pause button (default true). */
  play?: boolean;
  /** A reset button (default true). */
  reset?: boolean;
  /** A slow-motion button (default true). */
  slow?: boolean;
  /** A Drop button that releases held bodies (default: shown when any body is held). */
  drop?: boolean;
  /** A gravity chooser: Earth, Moon, Mars, Jupiter (default false). */
  gravity?: boolean;
}

export interface PhysicsPress {
  /** A press tool: hold on something to push down on it, harder the longer it is held (default false). */
  enabled?: boolean;
  /** Newtons added per second of holding (default 100). */
  rate?: number;
  /** The most it pushes with (default 5000). */
  max?: number;
}

export interface ScenePhysics {
  enabled?: boolean;
  /**
   * individual: every player runs the experiment in their own browser. shared: the game server
   * runs one for everyone in the scene (of the same team), and they all see and change it.
   */
  mode?: 'individual' | 'shared';
  /** m/s², downwards (default 9.81). */
  gravity?: number;
  /** Scene pixels to a metre (default 100). */
  pixels_per_meter?: number;
  /** How thick everything is, in metres, front to back (default 0.1). Masses and water volumes use it. */
  depth?: number;
  /** A floor across the scene at this height in pixels (default: the bottom of the scene). Null: none. */
  floor_y?: number | null;
  /** Walls up the scene's left and right edges (default true). */
  walls?: boolean;
  /** Start paused: players press play (default false). */
  paused?: boolean;
  controls?: PhysicsControls;
  press?: PhysicsPress;
  bodies?: PhysicsBody[];
  water?: PhysicsWater[];
  joints?: PhysicsJoint[];
  build?: PhysicsBuild | null;
  tray?: PhysicsTrayEntry[];
  readouts?: PhysicsReadout[];
  watches?: PhysicsWatch[];
}

/** The scene's physics when it is switched on, else null. */
export function scenePhysics(scene: { physics?: ScenePhysics | null }): ScenePhysics | null {
  return scene.physics?.enabled ? scene.physics : null;
}

/** [ext] An action that drives the scene's experiment. */
export type PhysicsOp = 'reset' | 'pause' | 'play' | 'release' | 'spawn' | 'remove' | 'gravity' | 'slow' | 'normal' | 'build' | 'test';

export const PHYSICS_OPS: ReadonlyArray<readonly [PhysicsOp, string]> = [
  ['play', 'Play'], ['pause', 'Pause'], ['reset', 'Reset the experiment'], ['release', 'Drop held bodies'],
  ['spawn', 'Add something from the tray'], ['remove', 'Remove a body'], ['gravity', 'Change gravity'],
  ['slow', 'Slow motion'], ['normal', 'Normal speed'], ['test', 'Test the design (bridge)'], ['build', 'Back to building'],
];

// ------------------------------------------------------------------- arithmetic

export interface PhysicsUnits {
  ppm: number;
  depth: number;
  gravity: number;
}

export function physicsUnits(p: ScenePhysics): PhysicsUnits {
  return {
    ppm: p.pixels_per_meter && p.pixels_per_meter > 0 ? p.pixels_per_meter : 100,
    depth: p.depth && p.depth > 0 ? p.depth : 0.1,
    gravity: typeof p.gravity === 'number' && Number.isFinite(p.gravity) ? p.gravity : 9.81,
  };
}

/** Snap a point to the build grid. */
export function snapToGrid(build: PhysicsBuild, at: Point): Point {
  const g = build.grid && build.grid > 0 ? build.grid : 25;
  return { x: build.x + Math.round((at.x - build.x) / g) * g, y: build.y + Math.round((at.y - build.y) / g) * g };
}

export function beamLength(beam: Pick<PhysicsBeam, 'a' | 'b'>): number {
  return Math.hypot(beam.b.x - beam.a.x, beam.b.y - beam.a.y);
}

export function beamCost(build: PhysicsBuild, beam: PhysicsBeam, ppm: number): number {
  const kind = build.beams[beam.kind];
  return ((kind?.cost_per_meter ?? 0) * beamLength(beam)) / ppm;
}

export function designCost(build: PhysicsBuild, design: PhysicsBeam[], ppm: number): number {
  return design.reduce((sum, b) => sum + beamCost(build, b, ppm), 0);
}

const samePoint = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** Is this point one beams may start from: an anchor, or the end of a beam already built? */
export function isBuildNode(build: PhysicsBuild, design: PhysicsBeam[], at: Point): boolean {
  return build.anchors.some((a) => samePoint(a, at)) || design.some((b) => samePoint(b.a, at) || samePoint(b.b, at));
}

export function isAnchor(build: PhysicsBuild, at: Point): boolean {
  return build.anchors.some((a) => samePoint(a, at));
}

/**
 * Why a beam may not be added to a design, or null when it may. Both ends are snapped first by
 * the caller. One end must already be part of the structure: an anchor or a beam's end.
 */
export function beamProblem(build: PhysicsBuild, design: PhysicsBeam[], beam: Omit<PhysicsBeam, 'id'>, ppm: number): string | null {
  const kind = build.beams[beam.kind];
  if (!kind) return 'That kind of beam is not offered here.';
  const length = beamLength(beam);
  if (length < 1) return 'A beam needs two different ends.';
  const max = kind.max_length ?? build.max_length ?? 250;
  if (length > max + 0.5) return `That beam is too long: the longest is ${(max / ppm).toFixed(1)} m.`;
  const inside = (p: Point) => p.x >= build.x - 0.5 && p.y >= build.y - 0.5 && p.x <= build.x + build.width + 0.5 && p.y <= build.y + build.height + 0.5;
  if (!inside(beam.a) || !inside(beam.b)) return 'Beams have to stay inside the building area.';
  if (!isBuildNode(build, design, beam.a) && !isBuildNode(build, design, beam.b)) return 'Start a beam from a footing or from the end of another beam.';
  const dup = design.some((d) => (samePoint(d.a, beam.a) && samePoint(d.b, beam.b)) || (samePoint(d.a, beam.b) && samePoint(d.b, beam.a)));
  if (dup) return 'There is already a beam there.';
  if (build.budget != null && build.budget >= 0) {
    const cost = designCost(build, design, ppm) + beamCost(build, { ...beam, id: '' }, ppm);
    if (cost > build.budget + 1e-6) return `That would go over the budget of ${Math.round(build.budget)}.`;
  }
  return null;
}

/** The convex hull of a set of points, anticlockwise in screen terms. Used for polygon bodies. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** The pieces of a body's outline, relative to its centre and before it turns: what is drawn and simulated. */
export type BodyPart =
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'polygon'; points: Point[] };

export function bodyParts(body: PhysicsBody): BodyPart[] {
  const w = Math.max(1, body.width ?? 80);
  const h = Math.max(1, body.height ?? 80);
  const rect = (cx: number, cy: number, rw: number, rh: number): BodyPart => ({
    kind: 'polygon',
    points: [{ x: cx - rw / 2, y: cy - rh / 2 }, { x: cx + rw / 2, y: cy - rh / 2 }, { x: cx + rw / 2, y: cy + rh / 2 }, { x: cx - rw / 2, y: cy + rh / 2 }],
  });
  switch (body.shape) {
    case 'circle':
      return [{ kind: 'circle', x: 0, y: 0, r: Math.max(1, body.radius ?? 40) }];
    case 'polygon': {
      const hull = convexHull(body.points ?? []);
      return hull.length >= 3 ? [{ kind: 'polygon', points: hull.slice(0, 12) }] : [rect(0, 0, w, h)];
    }
    case 'cup': {
      const t = Math.min(cupWall(body), w / 3, h / 2);
      return [rect(0, h / 2 - t / 2, w, t), rect(-w / 2 + t / 2, -t / 2, t, h - t), rect(w / 2 - t / 2, -t / 2, t, h - t)];
    }
    default:
      return [rect(0, 0, w, h)];
  }
}

export function cupWall(body: PhysicsBody): number {
  return body.wall && body.wall > 0 ? body.wall : 12;
}

/** A cup's inside, relative to its centre: the box water in it fills. */
export function cupInside(body: PhysicsBody): { x: number; y: number; width: number; height: number } {
  const w = Math.max(1, body.width ?? 80);
  const h = Math.max(1, body.height ?? 80);
  const t = Math.min(cupWall(body), w / 3, h / 2);
  return { x: -w / 2 + t, y: -h / 2, width: w - 2 * t, height: h - t };
}

/** The body a beam of a design becomes: a thin box from end to end. */
export function beamBody(build: PhysicsBuild, beam: PhysicsBeam): PhysicsBody {
  const kind = build.beams[beam.kind] ?? build.beams[0];
  const material = kind?.material ?? DEFAULT_MATERIAL;
  const thickness = kind?.thickness && kind.thickness > 0 ? kind.thickness : materialOf(material).tension_only ? 5 : 12;
  return {
    id: beamBodyId(beam.id),
    name: kind?.label ?? materialOf(material).label,
    shape: 'box',
    x: (beam.a.x + beam.b.x) / 2,
    y: (beam.a.y + beam.b.y) / 2,
    angle: (Math.atan2(beam.b.y - beam.a.y, beam.b.x - beam.a.x) * 180) / Math.PI,
    width: Math.max(2, beamLength(beam)),
    height: thickness,
    material,
    draggable: false,
  };
}

export const beamBodyId = (beamId: string) => `beam:${beamId}`;

/** Compare a reading with a watch's threshold. */
export function passes(value: number, operator: PhysicsWatch['operator'], threshold: number): boolean {
  switch (operator ?? '>=') {
    case '>': return value > threshold;
    case '>=': return value >= threshold;
    case '<': return value < threshold;
    case '<=': return value <= threshold;
    case '=': return Math.abs(value - threshold) < 1e-9;
  }
}

/** A reading as it is shown: rounded, with its unit. */
export function formatReading(readout: PhysicsReadout, value: number | null): string {
  const m = PHYSICS_MEASURES[readout.measure];
  if (value == null || !Number.isFinite(value)) return '—';
  const decimals = readout.decimals ?? m?.decimals ?? 2;
  const unit = m?.unit ?? '';
  return `${value.toFixed(decimals)}${unit ? (unit === '°' || unit === '%' ? unit : ` ${unit}`) : ''}`;
}

/** A reading rounded as the readout says, for a variable. */
export function roundReading(readout: PhysicsReadout, value: number): number {
  const decimals = readout.decimals ?? PHYSICS_MEASURES[readout.measure]?.decimals ?? 2;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** A body's outline in scene pixels, at a pose: polygons (a circle as 32 corners). */
export function outlineAt(body: PhysicsBody, x: number, y: number, angle: number): Point[][] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const place = (p: Point): Point => ({ x: x + p.x * cos - p.y * sin, y: y + p.x * sin + p.y * cos });
  return bodyParts(body).map((part) =>
    part.kind === 'circle'
      ? Array.from({ length: 32 }, (_, i) => place({ x: part.x + part.r * Math.cos((i / 32) * Math.PI * 2), y: part.y + part.r * Math.sin((i / 32) * Math.PI * 2) }))
      : part.points.map(place));
}

/** Whether a point (scene pixels) is on a body at a pose. `slop` widens it, for fingers. */
export function bodyContains(body: PhysicsBody, x: number, y: number, angle: number, at: Point, slop = 0): boolean {
  const dx = at.x - x;
  const dy = at.y - y;
  // Into the body's own frame.
  const lx = dx * Math.cos(-angle) - dy * Math.sin(-angle);
  const ly = dx * Math.sin(-angle) + dy * Math.cos(-angle);
  for (const part of bodyParts(body)) {
    if (part.kind === 'circle') {
      if (Math.hypot(lx - part.x, ly - part.y) <= part.r + slop) return true;
      continue;
    }
    const xs = part.points.map((p) => p.x);
    const ys = part.points.map((p) => p.y);
    if (part.points.length === 4 && lx >= Math.min(...xs) - slop && lx <= Math.max(...xs) + slop && ly >= Math.min(...ys) - slop && ly <= Math.max(...ys) + slop) return true;
    if (part.points.length !== 4 && insidePolygon(part.points, { x: lx, y: ly })) return true;
  }
  return false;
}

function insidePolygon(points: Point[], p: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The box a water fills, in scene pixels: its cup's inside where the cup is now, or its own box. */
export function waterContainer(water: PhysicsWater, cup: { def: PhysicsBody; x: number; y: number } | null): { x: number; y: number; width: number; height: number } | null {
  if (water.body_id) {
    if (!cup || cup.def.shape !== 'cup') return null;
    const inside = cupInside(cup.def);
    return { x: cup.x + inside.x, y: cup.y + inside.y, width: inside.width, height: inside.height };
  }
  if (water.width == null || water.height == null) return null;
  return { x: water.x ?? 0, y: water.y ?? 0, width: water.width, height: water.height };
}

/** Millilitres in a pixel of depth of this container (for the scale up the side). */
export function millilitresPerPixel(width: number, units: PhysicsUnits): number {
  return (width / units.ppm / units.ppm) * units.depth * 1e6;
}

// ------------------------------------------------------------------ the network

/** One body's pose: id, x and y in scene pixels, angle in radians. */
export type PhysicsPose = [id: string, x: number, y: number, angle: number];

/** How the experiment stands, as the game server sends it to players in a shared physics scene. */
export interface PhysicsSnapshot {
  /** Seconds of simulated time since the last reset. */
  t: number;
  paused: boolean;
  slow: boolean;
  gravity: number;
  /** A bridge: true while players build, false while it is tested. */
  building: boolean;
  /** Poses of every body that can move. */
  bodies: PhysicsPose[];
  /** Water: id, depth in pixels, millilitres spilled. */
  water: Array<[id: string, level: number, spilled: number]>;
  /** Joints and beams that have broken. */
  broken: string[];
  /** Strain of joints and beams with a strength, 0 to 1 and over. */
  stress: Array<[id: string, ratio: number]>;
  /** Strings, springs, ropes and pins to draw: id, from, to, kind. */
  links: Array<[id: string, x1: number, y1: number, x2: number, y2: number, kind: string]>;
  /** Bodies still held in place, waiting for Drop. */
  held: string[];
  /** Presses going on: where and how hard. */
  presses: Array<{ x: number; y: number; force: number }>;
  readings: Record<string, number | null>;
}

/** What has changed in a shared experiment beyond poses: what was added and the design. */
export interface PhysicsLayout {
  /** Bumped whenever bodies are added or removed or the design changes. */
  version: number;
  spawned: PhysicsBody[];
  removed: string[];
  design: PhysicsBeam[];
  /** How many of each tray entry are left. */
  tray: Record<string, number | null>;
}

export interface PhysicsStateMessage extends PhysicsLayout {
  scene_id: Id;
  snap: PhysicsSnapshot;
}

export interface PhysicsTickMessage {
  scene_id: Id;
  version: number;
  snap: PhysicsSnapshot;
}

export interface PhysicsWatchMessage {
  scene_id: Id;
  watch_id: string;
  value: number | null;
}

/** What a player does to the experiment. Points are scene pixels. */
export type PhysicsInput =
  | { op: 'grab'; body: string; x: number; y: number }
  | { op: 'drag'; x: number; y: number }
  | { op: 'drop' }
  | { op: 'press'; body: string; x: number; y: number }
  | { op: 'unpress' }
  | { op: 'take'; entry: string; x: number; y: number }
  | { op: 'beam'; a: Point; b: Point; kind: number }
  | { op: 'unbeam'; id: string }
  | { op: 'clear' }
  /** Send me the experiment as it stands (a shared experiment, on arriving in its scene). */
  | { op: 'sync' }
  | { op: 'control'; control: PhysicsOp; value?: number; body?: string; entry?: string; x?: number; y?: number };
