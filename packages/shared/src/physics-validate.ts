import {
  GRAVITY_PRESETS, PHYSICS_MATERIALS, PHYSICS_MEASURES, PHYSICS_OPS, isAnchor,
  type PhysicsBody, type ScenePhysics,
} from './physics.js';
import type { Id } from './types.js';

export interface PhysicsCheck {
  err(path: string, message: string): void;
  warn(path: string, message: string): void;
  /** Report a media id that is not in the scenario (or not of this type). */
  needMedia(id: Id, path: string): void;
  variables: Set<string>;
  /** Whether an event is one of this scene's. */
  inScene(eventId: Id): boolean;
  /** The scene's size, for warnings about things placed outside it. */
  size: { width: number; height: number } | null;
}

const SHAPES = ['circle', 'box', 'polygon', 'cup'];
const JOINTS = ['pin', 'weld', 'string', 'spring', 'rope'];
const WHENS = ['break', 'enter', 'reading', 'rest', 'balanced', 'spill'];
const OPERATORS = ['>', '>=', '<', '<=', '='];

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Check a scene's `physics`. `path` is the scene's path ("scenes[2]"). */
export function checkPhysics(p: ScenePhysics, path: string, c: PhysicsCheck): void {
  const pp = `${path}.physics`;
  if (typeof p !== 'object' || p === null) return c.err(pp, 'physics is an object');
  if (p.mode != null && p.mode !== 'individual' && p.mode !== 'shared') c.err(`${pp}.mode`, 'mode is "individual" or "shared"');
  if (p.gravity != null && (!num(p.gravity) || p.gravity < 0 || p.gravity > 100)) c.err(`${pp}.gravity`, 'gravity is between 0 and 100 m/s²');
  if (p.pixels_per_meter != null && (!num(p.pixels_per_meter) || p.pixels_per_meter <= 0)) c.err(`${pp}.pixels_per_meter`, 'pixels_per_meter is a number greater than 0');
  if (p.depth != null && (!num(p.depth) || p.depth <= 0)) c.err(`${pp}.depth`, 'depth is a number of metres greater than 0');
  if (p.press?.rate != null && (!num(p.press.rate) || p.press.rate <= 0)) c.err(`${pp}.press.rate`, 'rate is newtons per second, greater than 0');

  const ids = new Map<string, string>();
  const claim = (id: unknown, at: string, what: string) => {
    if (typeof id !== 'string' || id.trim() === '') return c.err(`${at}.id`, `A ${what} needs an id`);
    if (ids.has(id)) c.err(`${at}.id`, `Duplicate id "${id}" (also at ${ids.get(id)})`);
    ids.set(id, at);
  };
  const bodies = new Map<string, PhysicsBody>();
  const checkMaterial = (m: unknown, at: string) => {
    if (m != null && !(String(m) in PHYSICS_MATERIALS)) c.err(at, `Unknown material "${String(m)}"`);
  };
  const checkShape = (b: Partial<PhysicsBody>, at: string) => {
    if (!SHAPES.includes(String(b.shape))) return c.err(`${at}.shape`, `shape is one of: ${SHAPES.join(', ')}`);
    if (b.shape === 'circle' && !(num(b.radius) && b.radius > 0)) c.err(`${at}.radius`, 'A circle needs a radius greater than 0');
    if ((b.shape === 'box' || b.shape === 'cup') && !(num(b.width) && b.width > 0 && num(b.height) && b.height > 0)) c.err(at, `A ${b.shape} needs a width and a height`);
    if (b.shape === 'polygon' && !(Array.isArray(b.points) && b.points.length >= 3)) c.err(`${at}.points`, 'A polygon needs at least three corners');
    checkMaterial(b.material, `${at}.material`);
    for (const key of ['density', 'mass'] as const) if (b[key] != null && !(num(b[key]) && b[key] > 0)) c.err(`${at}.${key}`, `${key} is a number greater than 0`);
    if (b.bounciness != null && !(num(b.bounciness) && b.bounciness >= 0 && b.bounciness <= 1.2)) c.err(`${at}.bounciness`, 'bounciness is from 0 to 1');
    if (b.media_id != null) c.needMedia(b.media_id, `${at}.media_id`);
  };

  (p.bodies ?? []).forEach((b, i) => {
    const at = `${pp}.bodies[${i}]`;
    claim(b.id, at, 'body');
    bodies.set(b.id, b);
    checkShape(b, at);
    if (!num(b.x) || !num(b.y)) c.err(at, 'A body needs x and y');
    else if (c.size && (b.x < -200 || b.y < -2000 || b.x > c.size.width + 200 || b.y > c.size.height + 200)) c.warn(at, `"${b.name ?? b.id}" is outside the scene`);
    if (b.fixed && b.held) c.warn(`${at}.held`, 'A fixed body never moves, so holding it changes nothing');
  });

  (p.water ?? []).forEach((w, i) => {
    const at = `${pp}.water[${i}]`;
    claim(w.id, at, 'water');
    if (!num(w.level) || w.level < 0) c.err(`${at}.level`, 'level is a depth in pixels, 0 or more');
    if (w.body_id) {
      const cup = bodies.get(w.body_id);
      if (!cup) c.err(`${at}.body_id`, `There is no body "${w.body_id}"`);
      else if (cup.shape !== 'cup') c.err(`${at}.body_id`, `"${cup.name ?? cup.id}" is not a cup`);
      else if (!cup.fixed) c.warn(`${at}.body_id`, 'Water stays level in its cup even if the cup tips over: fix the cup in place');
    } else if (!(num(w.width) && w.width > 0 && num(w.height) && w.height > 0 && num(w.x) && num(w.y))) {
      c.err(at, 'Water needs a cup to fill, or x, y, width and height');
    } else if (w.level > w.height) c.warn(`${at}.level`, 'The water starts deeper than its container');
    if (w.density != null && !(num(w.density) && w.density > 0)) c.err(`${at}.density`, 'density is kg per cubic metre, greater than 0');
  });

  (p.joints ?? []).forEach((j, i) => {
    const at = `${pp}.joints[${i}]`;
    claim(j.id, at, 'joint');
    if (!JOINTS.includes(String(j.type))) c.err(`${at}.type`, `type is one of: ${JOINTS.join(', ')}`);
    if (!bodies.has(j.body_a)) c.err(`${at}.body_a`, j.body_a ? `There is no body "${j.body_a}"` : 'No body is chosen');
    if (j.body_b && !bodies.has(j.body_b)) c.err(`${at}.body_b`, `There is no body "${j.body_b}"`);
    if (j.body_b && j.body_b === j.body_a) c.err(`${at}.body_b`, 'A joint joins two different bodies');
    if (!num(j.x) || !num(j.y)) c.err(at, 'A joint needs x and y');
    if ((j.type === 'string' || j.type === 'spring' || j.type === 'rope') && !(num(j.x2) && num(j.y2))) c.err(at, `A ${j.type} needs its other end (x2, y2)`);
    if (j.strength != null && !(num(j.strength) && j.strength > 0)) c.err(`${at}.strength`, 'strength is newtons, greater than 0');
    if (bodies.get(j.body_a)?.fixed && (!j.body_b || bodies.get(j.body_b)?.fixed)) c.warn(at, 'Both ends are fixed, so the joint does nothing');
  });

  if (p.build) {
    const b = p.build;
    const at = `${pp}.build`;
    if (!(num(b.width) && b.width > 0 && num(b.height) && b.height > 0 && num(b.x) && num(b.y))) c.err(at, 'The building area needs x, y, width and height');
    if (!Array.isArray(b.anchors) || b.anchors.length === 0) c.err(`${at}.anchors`, 'Students need at least one footing to build from');
    if (!Array.isArray(b.beams) || b.beams.length === 0) c.err(`${at}.beams`, 'Offer at least one kind of beam');
    (b.beams ?? []).forEach((k, i) => checkMaterial(k.material, `${at}.beams[${i}].material`));
    if (b.budget != null && !(num(b.budget) && b.budget >= 0)) c.err(`${at}.budget`, 'budget is a number, 0 or more');
    (b.preset ?? []).forEach((beam, i) => {
      if (!b.beams?.[beam.kind]) c.err(`${at}.preset[${i}].kind`, 'That kind of beam is not offered');
      if (!isAnchor(b, beam.a) && !isAnchor(b, beam.b) && !(b.preset ?? []).some((o) => o !== beam && (same(o.a, beam.a) || same(o.b, beam.a) || same(o.a, beam.b) || same(o.b, beam.b)))) {
        c.warn(`${at}.preset[${i}]`, 'This beam is not joined to anything');
      }
    });
    if (p.floor_y !== null && num(b.y) && num(b.height) && c.size && (p.floor_y ?? c.size.height) < b.y + b.height) {
      c.warn(`${pp}.floor_y`, 'The floor runs through the building area: a bridge usually spans a gap with no floor (switch the floor off)');
    }
  }

  (p.tray ?? []).forEach((e, i) => {
    const at = `${pp}.tray[${i}]`;
    claim(e.id, at, 'tray entry');
    if (!e.body || typeof e.body !== 'object') c.err(`${at}.body`, 'A tray entry needs a body to take out');
    else checkShape(e.body, `${at}.body`);
    if (e.count != null && !(Number.isInteger(e.count) && e.count >= 0)) c.err(`${at}.count`, 'count is a whole number, 0 or more');
  });

  const readouts = new Set<string>();
  (p.readouts ?? []).forEach((r, i) => {
    const at = `${pp}.readouts[${i}]`;
    claim(r.id, at, 'readout');
    readouts.add(r.id);
    const m = PHYSICS_MEASURES[r.measure];
    if (!m) return c.err(`${at}.measure`, `Unknown measure "${String(r.measure)}"`);
    if (m.needs === 'body' && !(r.body_id && bodies.has(r.body_id))) c.err(`${at}.body_id`, r.body_id ? `There is no body "${r.body_id}"` : `${m.label} needs a body to measure`);
    if (m.needs === 'water' && r.water_id && !(p.water ?? []).some((w) => w.id === r.water_id)) c.err(`${at}.water_id`, `There is no water "${r.water_id}"`);
    if (m.needs === 'water' && !r.water_id && !(p.water ?? []).length) c.err(`${at}.water_id`, `${m.label} needs water to measure`);
    if (['load', 'max_load', 'cost'].includes(r.measure) && !p.build) c.warn(`${at}.measure`, `${m.label} measures a bridge, and there is no building area`);
    if (['press_force', 'break_force'].includes(r.measure) && !p.press?.enabled) c.warn(`${at}.measure`, `${m.label} needs the press tool switched on`);
    if (r.variable && !c.variables.has(r.variable)) c.err(`${at}.variable`, `Variable "${r.variable}" is not declared in global_variables`);
  });

  (p.watches ?? []).forEach((w, i) => {
    const at = `${pp}.watches[${i}]`;
    claim(w.id, at, 'watch');
    if (!WHENS.includes(String(w.when))) return c.err(`${at}.when`, `when is one of: ${WHENS.join(', ')}`);
    if (w.when === 'reading' && !(w.readout_id && readouts.has(w.readout_id))) c.err(`${at}.readout_id`, w.readout_id ? `There is no readout "${w.readout_id}"` : 'No readout is chosen');
    if (w.when === 'reading' && !num(w.value)) c.err(`${at}.value`, 'A reading watch needs a value to compare with');
    if (w.operator != null && !OPERATORS.includes(w.operator)) c.err(`${at}.operator`, `operator is one of: ${OPERATORS.join(' ')}`);
    if (w.when === 'balanced' && !(w.body_id && bodies.has(w.body_id))) c.err(`${at}.body_id`, 'Choose the body that should balance');
    if (w.when === 'enter' && !w.region && !w.water_id) c.err(at, 'Choose a region or water to watch');
    if (w.body_id && !bodies.has(w.body_id) && w.when !== 'enter') c.err(`${at}.body_id`, `There is no body "${w.body_id}"`);
    if (w.water_id && !(p.water ?? []).some((x) => x.id === w.water_id)) c.err(`${at}.water_id`, `There is no water "${w.water_id}"`);
    if (w.joint_id && !(p.joints ?? []).some((j) => j.id === w.joint_id)) c.err(`${at}.joint_id`, `There is no joint "${w.joint_id}"`);
    if (w.event_id != null && !c.inScene(w.event_id)) c.err(`${at}.event_id`, `Event ${w.event_id} is not in this scene`);
    if (w.variable && !c.variables.has(w.variable)) c.err(`${at}.variable`, `Variable "${w.variable}" is not declared in global_variables`);
    if (w.event_id == null && !w.variable) c.warn(at, 'The watch neither sets a variable nor runs an event');
  });

  if (!(p.bodies ?? []).length && !(p.tray ?? []).length && !p.build) c.warn(pp, 'The experiment has nothing in it yet');
}

const same = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5;

/** Check a physics action. */
export function checkPhysicsAction(a: { op?: unknown; value?: unknown; body_id?: unknown; entry_id?: unknown }, path: string, physics: ScenePhysics | null | undefined, c: Pick<PhysicsCheck, 'err' | 'warn'>): void {
  if (!PHYSICS_OPS.some(([op]) => op === a.op)) return c.err(`${path}.op`, `op is one of: ${PHYSICS_OPS.map(([op]) => op).join(', ')}`);
  if (!physics?.enabled) c.warn(path, 'This scene has no physics switched on, so the action does nothing');
  if (a.op === 'gravity' && !(num(a.value) && a.value >= 0 && a.value <= 100)) c.err(`${path}.value`, `Gravity is between 0 and 100 m/s² (Earth ${GRAVITY_PRESETS[0]![1]})`);
  if (a.op === 'spawn' && !(physics?.tray ?? []).some((e) => e.id === a.entry_id)) c.err(`${path}.entry_id`, a.entry_id ? `The tray has no "${String(a.entry_id)}"` : 'Choose what to add from the tray');
  if (a.op === 'remove' && !(physics?.bodies ?? []).some((b) => b.id === a.body_id)) c.err(`${path}.body_id`, a.body_id ? `There is no body "${String(a.body_id)}"` : 'Choose the body to remove');
  if ((a.op === 'test' || a.op === 'build') && !physics?.build) c.warn(`${path}.op`, 'There is no building area in this scene');
}
