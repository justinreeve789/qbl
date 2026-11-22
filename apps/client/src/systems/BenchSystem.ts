import * as Phaser from 'phaser';
import {
  BENCH_MEASURES, BENCH_TOOLS, BenchSim, benchReadoutUnit, formatBenchReading, parseSeries, roundBenchReading, sceneBench, seriesText, SERIES_MAX, substanceName, toolContains, vesselContains, vesselName,
  type BenchAction, type BenchReadout, type BenchTool, type BenchVessel, type BenchWatch, type Point, type SceneBench,
} from '@qbl/shared';
import { BenchRenderer, type BenchDrawState } from '../bench/BenchRenderer';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { formulasNow, loadFormulas } from '../ui/science/load';
import type { BenchPanelHandle } from '../ui/UiPort';

/** How often a readout's value may be written to its variable. */
const VARIABLE_MS = 250;
/** How long tipping one container into another takes, and when in it what is poured arrives. */
const POUR_MS = 750;
const POUR_AT = 0.4;
/** How often a live graph takes a point. */
const LIVE_MS = 500;
/** Fingers are not precise: things are this much bigger to touch. */
const SLOP = 10;

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/**
 * A close-up bench in the scene (`bench.enabled`): runs it, draws it, and turns taps into picking
 * a container up, tipping it into another, lighting a burner, stirring and emptying down the sink.
 * What it measures is shown on screen and kept in variables; what its watches notice sets
 * variables and runs the scene's events.
 *
 * Each player has their own bench: it runs in their browser, and what comes of it reaches the
 * rest of the game through variables and events, as everything a player does on their own does.
 */
export class BenchSystem implements SceneSystem {
  private def: SceneBench | null = null;
  private sim: BenchSim | null = null;
  private renderer: BenchRenderer | null = null;
  private panel: BenchPanelHandle | null = null;
  private held: string | null = null;
  private pour: { from: string; to: string; color: string; started: number; done: boolean } | null = null;
  private state: BenchDrawState = { held: null, hover: null, pour: null, time: 0 };
  private written = new Map<string, { value: number; at: number }>();
  private points: Array<[number, number]> = [];
  private lastLive = 0;
  private lastToast = '';
  private lastToastAt = 0;
  private clock = 0;

  constructor(private rt: SceneRuntime) {}

  /** The scene has a bench to work. */
  get active(): boolean {
    return this.sim != null;
  }

  create() {
    const def = sceneBench(this.rt.def);
    if (!def) return;
    const { ctx, scene } = this.rt;
    this.def = def;
    // Readouts worked out from others need math.js: until it is here they read nothing.
    if ((def.readouts ?? []).some((r) => r.measure === 'formula')) void loadFormulas().then(() => this.sim?.refresh()).catch(() => {});
    this.sim = new BenchSim(def, { formula: (source, get) => formulasNow()?.evaluateNumber(source, get) ?? null });
    this.renderer = new BenchRenderer(scene, def);
    if (def.graph?.variable) this.points = parseSeries(ctx.vars.get(def.graph.variable));

    const label = (id: string) => (id === 'time' ? 'Time (s)' : this.readoutLabel(def.readouts?.find((r) => r.id === id), true));
    this.panel = ctx.ui.benchPanel({
      readouts: (def.readouts ?? []).filter((r) => !r.hidden).map((r) => ({ id: r.id, label: this.readoutLabel(r, false) })),
      reset: def.controls?.reset !== false,
      graph: def.graph ? { title: def.graph.title ?? '', xLabel: label(def.graph.x), yLabel: label(def.graph.y), button: def.graph.record !== 'live' } : null,
    }, {
      reset: () => this.reset(),
      putDown: () => (this.held = null),
      record: () => this.record(),
      clearGraph: () => {
        this.points = [];
        this.keepGraph();
      },
    });

    scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.on(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
  }

  private readoutLabel(r: BenchReadout | undefined, unit: boolean): string {
    if (!r || !this.def) return '';
    const vessel = this.def.vessels?.find((v) => v.id === r.vessel_id);
    const substance = this.def.substances?.find((s) => s.id === r.substance);
    const base = r.label
      || (r.measure === 'amount' && substance ? substanceName(substance) : BENCH_MEASURES[r.measure]?.label ?? r.measure) + (vessel && (this.def.vessels ?? []).filter((v) => !v.supply).length > 1 ? `, ${lower(vesselName(vessel))}` : '');
    const u = benchReadoutUnit(this.def, r);
    return unit && u ? `${base} (${u})` : base;
  }

  /**
   * Whether a press at this point is the bench's (a container, a tool, or putting down what is
   * held), so the player does not also walk there.
   */
  claims(at: Point): boolean {
    if (!this.sim) return false;
    return this.held != null || this.thingAt(at) != null;
  }

  /** Presses on nothing in particular do not walk the player on a bench without avatars. */
  get blocksWalking(): boolean {
    return this.sim != null && this.rt.def.show_avatars === false;
  }

  /** A bench action of one of the scene's events. */
  run(action: BenchAction) {
    const sim = this.sim;
    if (!sim) return;
    switch (action.op) {
      case 'reset':
        return this.reset();
      case 'add':
        if (action.vessel_id && action.substance && action.amount) sim.add(action.vessel_id, action.substance, action.amount);
        break;
      case 'empty':
        if (action.vessel_id) sim.empty(action.vessel_id);
        break;
      case 'stir':
        if (action.vessel_id) sim.stir(action.vessel_id);
        break;
      case 'burner':
        if (action.tool_id) sim.burner(action.tool_id, action.on ?? undefined);
        break;
    }
    sim.refresh();
  }

  private reset() {
    this.sim?.reset();
    this.held = null;
    this.pour = null;
    this.written.clear();
  }

  update(_time: number, delta: number) {
    const sim = this.sim;
    if (!sim || !this.renderer || !this.def) return;
    this.clock += delta;
    const pour = this.pour;
    if (pour) {
      const t = (this.clock - pour.started) / POUR_MS;
      if (!pour.done && t >= POUR_AT) {
        pour.done = true;
        const result = sim.pour(pour.from, pour.to);
        if (!result.ok) this.say(result.reason);
      }
      if (t >= 1) this.pour = null;
    }
    sim.step(delta / 1000);
    for (const event of sim.takeEvents()) {
      if (event.kind === 'watch') this.noticed(event.watch, event.value);
      else if (event.kind === 'note') this.rt.ctx.ui.toast(event.text, 4000);
    }

    const readings = sim.readings();
    const live = this.def.graph?.record === 'live';
    if (live && this.clock - this.lastLive >= LIVE_MS) {
      this.lastLive = this.clock;
      this.record(true);
    }
    this.state.held = this.held;
    this.state.time = this.clock / 1000;
    this.state.pour = this.pour ? { from: this.pour.from, to: this.pour.to, color: this.pour.color, t: (this.clock - this.pour.started) / POUR_MS } : null;
    this.renderer.draw(sim, this.state, delta);
    this.panel?.update({
      readings: Object.fromEntries((this.def.readouts ?? []).map((r) => [r.id, formatBenchReading({ ...r, unit: benchReadoutUnit(this.def!, r) }, readings[r.id] ?? null)])),
      holding: this.holdingText(),
      points: this.points,
    });
    this.keep(readings);
  }

  /** What is in the hand, and what to do with it. */
  private holdingText(): string | null {
    if (!this.held || !this.sim || !this.def) return null;
    const vessel = this.vessel(this.held);
    // A stock bottle is what its name says; anything else, what it holds just now.
    if (vessel) return `${vesselName(vessel)}${vessel.supply ? '' : ` (${this.sim.describe(vessel.id)})`}: tap a container to pour into it`;
    const tool = this.tool(this.held);
    return tool ? `${tool.name || BENCH_TOOLS[tool.kind].label}: tap a container to stir it` : null;
  }

  /** Readouts with a variable keep it up to date, a few times a second at most. */
  private keep(readings: Record<string, number | null>) {
    const now = this.clock;
    for (const r of this.def?.readouts ?? []) {
      if (!r.variable) continue;
      const raw = readings[r.id];
      if (raw == null || !Number.isFinite(raw)) continue;
      const value = roundBenchReading(r, raw);
      const last = this.written.get(r.id);
      if (last && (last.value === value || now - last.at < VARIABLE_MS)) continue;
      this.written.set(r.id, { value, at: now });
      this.rt.ctx.vars.apply(r.variable, 'set', value);
    }
  }

  /** A watch noticed something: set its variable and run its event. */
  private noticed(watch: BenchWatch, value: number | null) {
    if (this.rt.leaving) return;
    if (watch.variable) {
      const v = watch.set ?? (value != null && Number.isFinite(value) ? Math.round(value * 100) / 100 : 1);
      this.rt.ctx.vars.apply(watch.variable, 'set', v);
    }
    if (watch.event_id != null) void this.rt.engine.triggerById(watch.event_id);
  }

  /** Put a point on the graph for how things are now. */
  private record(quiet = false) {
    const graph = this.def?.graph;
    const sim = this.sim;
    if (!graph || !sim) return;
    const readings = sim.readings();
    const read = (id: string) => (id === 'time' ? sim.time : readings[id]);
    const x = read(graph.x);
    const y = read(graph.y);
    if (x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y)) {
      if (!quiet) this.say('There is nothing to measure yet.');
      return;
    }
    const last = this.points.at(-1);
    // Live, a point that says nothing new is not worth keeping.
    if (quiet && last && Math.abs(last[1] - y) < 1e-6 && this.points.length > 1 && Math.abs(this.points.at(-2)![1] - y) < 1e-6) {
      last[0] = x;
      return;
    }
    this.points = [...this.points, [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as [number, number]].slice(-SERIES_MAX);
    this.keepGraph();
  }

  private keepGraph() {
    const name = this.def?.graph?.variable;
    if (name) this.rt.ctx.vars.apply(name, 'set', seriesText(this.points));
  }

  // ------------------------------------------------------------------ input

  private vessel(id: string): BenchVessel | undefined {
    return this.def?.vessels?.find((v) => v.id === id);
  }

  private tool(id: string): BenchTool | undefined {
    return this.def?.tools?.find((t) => t.id === id);
  }

  private say(message: string) {
    // The same thing over and over (tapping a full beaker) is said once.
    if (message === this.lastToast && this.clock - this.lastToastAt < 2500) return;
    this.lastToast = message;
    this.lastToastAt = this.clock;
    this.rt.ctx.ui.toast(message);
  }

  private point(pointer: Phaser.Input.Pointer): Point {
    const p = this.rt.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    return { x: p.x, y: p.y };
  }

  /** The container or tool at a point: the last drawn wins, as it is on top. */
  private thingAt(at: Point): { vessel?: BenchVessel; tool?: BenchTool } | null {
    const vessels = this.def?.vessels ?? [];
    for (let i = vessels.length - 1; i >= 0; i--) if (vesselContains(vessels[i]!, at, SLOP)) return { vessel: vessels[i] };
    const tools = this.def?.tools ?? [];
    for (let i = tools.length - 1; i >= 0; i--) if (toolContains(tools[i]!, at, SLOP)) return { tool: tools[i] };
    return null;
  }

  private onMove(pointer: Phaser.Input.Pointer) {
    if (!this.sim) return;
    const thing = this.thingAt(this.point(pointer));
    this.state.hover = thing?.vessel?.id ?? thing?.tool?.id ?? null;
    if (thing) this.rt.scene.input.setDefaultCursor('pointer');
  }

  private onDown(pointer: Phaser.Input.Pointer) {
    const sim = this.sim;
    if (!sim || this.rt.ctx.ui.capturesInput || this.rt.leaving || this.pour) return;
    this.tap(this.point(pointer));
  }

  /** A tap at a point of the scene. */
  tap(at: Point) {
    const sim = this.sim;
    if (!sim) return;
    const thing = this.thingAt(at);
    const heldVessel = this.held ? this.vessel(this.held) : undefined;
    const heldTool = this.held ? this.tool(this.held) : undefined;
    if (!thing) {
      this.held = null;
      return;
    }
    const { vessel, tool } = thing;
    if (tool?.kind === 'burner') {
      const on = sim.burner(tool.id);
      return this.say(`The ${lower(tool.name || BENCH_TOOLS.burner.label)} is ${on ? 'lit' : 'out'}.`);
    }
    if (tool?.kind === 'sink') {
      if (!heldVessel) return this.say('Pick a container up first, then tap the sink to empty it.');
      if (!sim.empty(heldVessel.id)) return this.say(`The ${lower(vesselName(heldVessel))} is not for emptying.`);
      this.held = null;
      sim.refresh();
      return this.say(`The ${lower(vesselName(heldVessel))} is empty now.`);
    }
    if (tool?.kind === 'stirrer') {
      this.held = this.held === tool.id ? null : tool.id;
      return;
    }
    if (!vessel) return;
    if (heldTool?.kind === 'stirrer') {
      if (!sim.stir(vessel.id)) this.say('There is nothing in it to stir.');
      return;
    }
    if (heldVessel) {
      if (heldVessel.id === vessel.id) {
        this.held = null;
        return;
      }
      const problem = sim.pourProblem(heldVessel.id, vessel.id);
      if (problem) return this.say(problem);
      this.pour = { from: heldVessel.id, to: vessel.id, color: sim.view(heldVessel.id).layers.at(-1)?.color ?? '#9ec9f5', started: this.clock, done: false };
      return;
    }
    if (vessel.fixed) return this.say(`The ${lower(vesselName(vessel))} stays where it is. Pick something else up and pour it in.`);
    if (sim.volume(vessel.id) <= 0) return this.say(`The ${lower(vesselName(vessel))} is empty.`);
    this.held = vessel.id;
  }

  destroy() {
    const { scene } = this.rt;
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onDown, this);
    scene.input.off(Phaser.Input.Events.POINTER_MOVE, this.onMove, this);
    this.panel?.close();
    this.renderer?.destroy();
    this.sim = null;
  }
}
