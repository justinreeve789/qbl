import * as Phaser from 'phaser';
import {
  beamBody, beamLength, beamProblem, bodyContains, designCost, GRAVITY_PRESETS, isBuildNode, materialOf, PHYSICS_MEASURES, formatReading, physicsUnits,
  roundReading, scenePhysics, snapToGrid,
  type PhysicsAction, type PhysicsBody, type PhysicsInput, type PhysicsLayout, type PhysicsSnapshot, type PhysicsUnits, type PhysicsWatch, type Point, type ScenePhysics,
} from '@qbl/shared';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { PhysicsRenderer, type DrawState } from '../physics/PhysicsRenderer';
import { LocalPhysics, SharedPhysics, type PhysicsSource } from '../physics/sources';
import type { PhysicsPanelHandle, PhysicsTool } from '../ui/UiPort';

/** How often a readout's value may be written to its variable. */
const VARIABLE_MS = 250;
/** How often a drag is sent to the game server in a shared experiment. */
const SEND_MS = 50;
/** Fingers are not precise: bodies are this much bigger to touch. */
const SLOP = 8;

type Gesture =
  | { kind: 'grab' }
  | { kind: 'press' }
  | { kind: 'beam'; from: Point };

/**
 * A physics experiment in the scene (`physics.enabled`): runs it (here, or shows the game
 * server's when it is shared), draws it, and turns presses and drags into grabbing, pressing,
 * taking from the tray and building. What it measures is shown on screen and kept in variables;
 * what its watches notice sets variables and runs the scene's events.
 */
export class PhysicsSystem implements SceneSystem {
  private def: ScenePhysics | null = null;
  private units!: PhysicsUnits;
  private source: PhysicsSource | null = null;
  private renderer: PhysicsRenderer | null = null;
  private panel: PhysicsPanelHandle | null = null;
  private bodies = new Map<string, PhysicsBody>();
  private shownVersion = -1;
  private shownBuilding: boolean | null = null;
  private tool: PhysicsTool = 'move';
  private taking: string | null = null;
  private beamKind = 0;
  private erasing = false;
  private gesture: Gesture | null = null;
  private draw: DrawState = { ghost: null, erasing: false, hover: null };
  private lastSend = 0;
  private written = new Map<string, { value: number; at: number }>();
  private lastToast = '';

  constructor(private rt: SceneRuntime) {}

  /** The scene has an experiment running. */
  get active(): boolean {
    return this.source != null;
  }

  create() {
    const def = scenePhysics(this.rt.def);
    if (!def) return;
    const { ctx, scene, size } = this.rt;
    this.def = def;
    this.units = physicsUnits(def);
    const onWatch = (w: PhysicsWatch, value: number | null) => this.noticed(w, value);
    this.source = def.mode === 'shared' && ctx.connection.online
      ? new SharedPhysics(ctx.connection, this.rt.def.id, onWatch, def)
      : new LocalPhysics(def, size, onWatch);
    this.renderer = new PhysicsRenderer(scene, def, this.units);

    const controls = def.controls ?? {};
    const held = (def.bodies ?? []).some((b) => b.held && !b.fixed);
    this.panel = ctx.ui.physicsPanel({
      readouts: (def.readouts ?? []).filter((r) => !r.hidden).map((r) => ({ id: r.id, label: r.label || PHYSICS_MEASURES[r.measure]?.label || r.measure })),
      play: controls.play !== false,
      reset: controls.reset !== false,
      slow: controls.slow !== false,
      drop: controls.drop ?? held,
      gravity: controls.gravity ? GRAVITY_PRESETS : null,
      press: def.press?.enabled === true,
      tray: (def.tray ?? []).map((e) => ({ id: e.id, label: e.label || materialOf(e.body.material).label, color: e.body.color || materialOf(e.body.material).color })),
      build: def.build
        ? {
            beams: def.build.beams.map((b) => ({
              label: b.label || materialOf(b.material).label,
              color: materialOf(b.material).color,
              cost: b.cost_per_meter ? `${b.cost_per_meter} a metre` : '',
            })),
            budget: def.build.budget ?? null,
          }
        : null,
      shared: this.source.shared,
    }, {
      control: (op, value) => this.send({ op: 'control', control: op, value }),
      tool: (tool) => {
        this.tool = tool;
        this.taking = null;
      },
      take: (entry) => {
        this.taking = this.taking === entry ? null : entry;
        if (this.taking) this.say('Now tap where it should go.');
      },
      beam: (kind) => {
        this.beamKind = kind;
        this.erasing = false;
      },
      erase: (on) => (this.erasing = on),
      clear: () => this.send({ op: 'clear' }),
    });

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.on(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
  }

  /**
   * Whether a press at this point is the experiment's (a body, the tray, building), so the
   * player does not also walk there. In a scene without avatars, every press is.
   */
  claims(at: Point): boolean {
    if (!this.source) return false;
    const frame = this.source.frame();
    if (!frame) return false;
    if (this.taking) return true;
    if (frame.building) return this.inBuildArea(at);
    return this.bodyAt(at, this.tool === 'press' ? 'press' : 'move', frame) != null;
  }

  /** Presses on nothing in particular do not walk the player in an experiment without avatars. */
  get blocksWalking(): boolean {
    return this.source != null && this.rt.def.show_avatars === false;
  }

  private inBuildArea(at: Point): boolean {
    const b = this.def?.build;
    if (!b) return false;
    const m = (b.grid && b.grid > 0 ? b.grid : 25) * 0.75;
    return at.x >= b.x - m && at.y >= b.y - m && at.x <= b.x + b.width + m && at.y <= b.y + b.height + m;
  }

  /** A physics action of one of the scene's events. */
  run(action: PhysicsAction) {
    if (!this.source) return;
    this.send({
      op: 'control', control: action.op, value: action.value, body: action.body_id, entry: action.entry_id,
      x: action.position_x, y: action.position_y,
    });
  }

  update(_time: number, delta: number) {
    const source = this.source;
    if (!source || !this.renderer || !this.def) return;
    source.update(delta);
    const frame = source.frame();
    if (!frame) return;
    const layout = source.layout();
    if (layout.version !== this.shownVersion || frame.building !== this.shownBuilding) this.rebuild(layout, frame.building);
    this.draw.erasing = this.erasing && frame.building;
    this.renderer.draw(this.bodies, layout, frame, this.draw);
    this.panel?.update({
      readings: Object.fromEntries((this.def.readouts ?? []).map((r) => [r.id, formatReading(r, frame.readings[r.id] ?? null)])),
      paused: frame.paused,
      slow: frame.slow,
      gravity: frame.gravity,
      building: frame.building,
      tray: layout.tray,
      tool: this.tool,
      taking: this.taking,
      beam: this.beamKind,
      erasing: this.erasing,
      cost: this.def.build ? designCost(this.def.build, layout.design, this.units.ppm) : null,
      held: frame.held.length > 0,
    });
    this.keep(frame);
  }

  /** The bodies to draw: the scene's, what was taken from the tray, and (while testing) the design's beams. */
  private rebuild(layout: PhysicsLayout, building: boolean) {
    const def = this.def!;
    this.bodies.clear();
    const removed = new Set(layout.removed);
    for (const b of def.bodies ?? []) if (!removed.has(b.id)) this.bodies.set(b.id, b);
    for (const b of layout.spawned) if (!removed.has(b.id)) this.bodies.set(b.id, b);
    if (def.build && !building) {
      for (const beam of layout.design) {
        const kind = def.build.beams[beam.kind];
        if (kind && materialOf(kind.material).tension_only) continue; // a rope is drawn as a line
        const body = beamBody(def.build, beam);
        if (!removed.has(body.id)) this.bodies.set(body.id, body);
      }
    }
    this.shownVersion = layout.version;
    this.shownBuilding = building;
  }

  /** Readouts with a variable keep it up to date, a few times a second at most. */
  private keep(frame: PhysicsSnapshot) {
    const now = performance.now();
    for (const r of this.def?.readouts ?? []) {
      if (!r.variable) continue;
      const raw = frame.readings[r.id];
      if (raw == null || !Number.isFinite(raw)) continue;
      const value = roundReading(r, raw);
      const last = this.written.get(r.id);
      if (last && (last.value === value || now - last.at < VARIABLE_MS)) continue;
      this.written.set(r.id, { value, at: now });
      this.rt.ctx.vars.apply(r.variable, 'set', value);
    }
  }

  /** A watch noticed something: set its variable and run its event. */
  private noticed(watch: PhysicsWatch, value: number | null) {
    if (this.rt.leaving) return;
    if (watch.variable) {
      const v = watch.set ?? (value != null && Number.isFinite(value) ? Math.round(value * 100) / 100 : 1);
      this.rt.ctx.vars.apply(watch.variable, 'set', v);
    }
    if (watch.event_id != null) void this.rt.engine.triggerById(watch.event_id);
  }

  // ------------------------------------------------------------------ input

  private send(msg: PhysicsInput) {
    const problem = this.source?.input(msg);
    if (problem) this.say(problem);
  }

  private say(message: string) {
    // The same refusal over and over (a drag across the scene) is said once.
    if (message === this.lastToast) return;
    this.lastToast = message;
    this.rt.ctx.ui.toast(message);
    window.setTimeout(() => {
      if (this.lastToast === message) this.lastToast = '';
    }, 2500);
  }

  private point(pointer: Phaser.Input.Pointer): Point {
    const p = this.rt.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  private bodyAt(at: Point, mode: 'move' | 'press', frame: PhysicsSnapshot): string | null {
    const poses = new Map(frame.bodies.map((p) => [p[0], p]));
    let found: string | null = null;
    for (const body of this.bodies.values()) {
      if (body.fixed) continue;
      const beam = body.id.startsWith('beam:');
      if (mode === 'move' && (beam || body.draggable === false)) continue;
      const pose = poses.get(body.id);
      if (!pose) continue;
      if (bodyContains(body, pose[1], pose[2], pose[3], at, SLOP)) found = body.id;
    }
    return found;
  }

  private beamAt(at: Point, layout: PhysicsLayout): string | null {
    let best: string | null = null;
    let bestD = 14;
    for (const beam of layout.design) {
      const d = distanceToSegment(at, beam.a, beam.b);
      if (d < bestD) {
        bestD = d;
        best = beam.id;
      }
    }
    return best;
  }

  private onDown(pointer: Phaser.Input.Pointer) {
    const source = this.source;
    if (!source || this.rt.ctx.ui.capturesInput || this.rt.leaving) return;
    const frame = source.frame();
    if (!frame) return;
    const at = this.point(pointer);
    const build = this.def!.build;
    if (frame.building && build) {
      if (!this.inBuildArea(at)) return;
      const layout = source.layout();
      if (this.erasing) {
        const beam = this.beamAt(at, layout);
        if (beam) this.send({ op: 'unbeam', id: beam });
        return;
      }
      const from = snapToGrid(build, at);
      const grid = build.grid && build.grid > 0 ? build.grid : 25;
      if (Math.hypot(from.x - at.x, from.y - at.y) <= grid * 0.75 && isBuildNode(build, layout.design, from)) {
        this.gesture = { kind: 'beam', from };
        this.draw.ghost = { a: from, b: from, ok: false, label: '' };
      } else {
        this.say('Start a beam from a yellow footing, or from the end of a beam you have built.');
      }
      return;
    }
    if (this.taking) {
      const entry = this.taking;
      this.taking = null;
      const problem = source.input({ op: 'take', entry, x: at.x, y: at.y });
      if (problem) this.say(problem);
      else this.gesture = { kind: 'grab' };
      return;
    }
    if (this.tool === 'press' && this.def!.press?.enabled) {
      const body = this.bodyAt(at, 'press', frame);
      if (!body) return;
      this.send({ op: 'press', body, x: at.x, y: at.y });
      this.gesture = { kind: 'press' };
      return;
    }
    const body = this.bodyAt(at, 'move', frame);
    if (!body) return;
    this.send({ op: 'grab', body, x: at.x, y: at.y });
    this.gesture = { kind: 'grab' };
  }

  private onMove(pointer: Phaser.Input.Pointer) {
    const source = this.source;
    if (!source) return;
    const at = this.point(pointer);
    const frame = source.frame();
    if (frame?.building && this.erasing) this.draw.hover = this.beamAt(at, source.layout());
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'grab') {
      const now = performance.now();
      if (source.shared && now - this.lastSend < SEND_MS) return;
      this.lastSend = now;
      source.input({ op: 'drag', x: at.x, y: at.y });
    } else if (g.kind === 'beam' && this.def!.build) {
      const build = this.def!.build;
      const to = snapToGrid(build, at);
      const beam = { a: g.from, b: to, kind: this.beamKind };
      const problem = beamProblem(build, source.layout().design, beam, this.units.ppm);
      this.draw.ghost = { a: g.from, b: to, ok: problem == null, label: `${(beamLength(beam) / this.units.ppm).toFixed(2)} m` };
    }
  }

  private onUp(pointer: Phaser.Input.Pointer) {
    const g = this.gesture;
    this.gesture = null;
    if (!g || !this.source) return;
    if (g.kind === 'grab') {
      this.source.input({ op: 'drag', ...this.point(pointer) });
      this.send({ op: 'drop' });
    } else if (g.kind === 'press') {
      this.send({ op: 'unpress' });
    } else {
      const ghost = this.draw.ghost;
      this.draw.ghost = null;
      if (ghost && (ghost.a.x !== ghost.b.x || ghost.a.y !== ghost.b.y)) this.send({ op: 'beam', a: ghost.a, b: ghost.b, kind: this.beamKind });
    }
  }

  destroy() {
    const { scene } = this.rt;
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    scene.input.off(Phaser.Input.Events.POINTER_UP, this.onUp, this);
    scene.input.off(Phaser.Input.Events.POINTER_UP_OUTSIDE, this.onUp, this);
    this.panel?.close();
    this.renderer?.destroy();
    this.source?.destroy();
    this.source = null;
  }
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
