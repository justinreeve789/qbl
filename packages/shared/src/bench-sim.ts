import {
  BENCH_MEASURES, colorText, fillHeight, indicatorColor, parseColor, stateOf, substanceName, vesselCapacity, vesselHeight, vesselName, vesselOutline, vesselPour, vesselWidth,
  type BenchEffect, type BenchReaction, type BenchReadout, type BenchSubstance, type BenchTool, type BenchVessel, type BenchWatch, type SceneBench,
} from './bench.js';
import { parseWhen, testWhen, type WhenCondition } from './infobox.js';

/**
 * A close-up bench as it is worked (see bench.ts): what is in each container, how warm it is,
 * which reactions are going, what has been given off. The game steps it and draws what it says;
 * nothing here knows about the screen.
 */

/** Less than this of something is none of it. */
const TRACE = 1e-6;
/** How long a stir counts as stirred, in seconds. */
export const STIR_SECONDS = 6;
/** °C: as hot as a burner makes anything. */
export const HOTTEST = 300;
/** A liquid given no colour: nearly clear. */
const CLEAR: [number, number, number] = [220, 236, 251];
/** How long a reaction that happens all at once still shows, in seconds. */
const SHOW_SECONDS = 1.6;

/** A container as it is now. */
export interface VesselState {
  /** How much of each substance, in mL. */
  contents: Record<string, number>;
  temperature: number;
  /** Seconds of "stirred" left. */
  stirred: number;
  /** Reactions going on: seconds left to show each. */
  active: Record<string, number>;
  /** Gas given off so far, by substance. */
  released: Record<string, number>;
  /** How many times something was poured in. */
  pours: number;
  /** How much has run over. */
  spilled: number;
}

/** A band of what is in a container, to draw: shares of its capacity from the bottom up. */
export interface BenchLayer {
  from: number;
  to: number;
  color: string;
  alpha: number;
  solid: boolean;
}

/** A container as it looks now. */
export interface VesselView {
  layers: BenchLayer[];
  /** The share of the container that is full. */
  fill: number;
  volume: number;
  temperature: number;
  ph: number | null;
  stirred: boolean;
  effects: Array<{ kind: BenchEffect; color: string; strength: number }>;
}

/** Something the bench noticed, for the game to act on. */
export type BenchEvent =
  | { kind: 'watch'; watch: BenchWatch; value: number | null }
  | { kind: 'note'; text: string; vessel: string }
  | { kind: 'reaction'; reaction: string; vessel: string };

export interface BenchSimOptions {
  /** Works out a readout's formula from the other readings (math.js; see formula.ts). Without it, formula readouts read nothing. */
  formula?: (source: string, get: (name: string) => unknown) => number | null;
}

/** What a pour did, or why it could not be done (in words for the player). */
export type PourResult = { ok: true; moved: number; color: string } | { ok: false; reason: string };

export class BenchSim {
  time = 0;
  private vessels = new Map<string, VesselState>();
  private burners = new Map<string, boolean>();
  private substances = new Map<string, BenchSubstance>();
  private conditions = new Map<string, WhenCondition[]>();
  private happened = new Set<string>();
  private noted = new Set<string>();
  private fired = new Set<string>();
  private holding = new Map<string, boolean>();
  private began: Array<{ reaction: string; vessel: string }> = [];
  private overflowed = new Set<string>();
  private queue: BenchEvent[] = [];
  private lastReadings: Record<string, number | null> = {};

  constructor(readonly def: SceneBench, private options: BenchSimOptions = {}) {
    for (const s of def.substances ?? []) this.substances.set(s.id, s);
    for (const r of def.reactions ?? []) this.conditions.set(r.id, parseWhen(r.when ?? ''));
    this.reset();
  }

  get ambient(): number {
    return Number.isFinite(this.def.ambient) ? Number(this.def.ambient) : 20;
  }

  /** Put everything back as it started. */
  reset() {
    this.time = 0;
    this.vessels.clear();
    this.burners.clear();
    this.happened.clear();
    this.noted.clear();
    this.fired.clear();
    this.holding.clear();
    this.began = [];
    this.overflowed.clear();
    this.queue = [];
    for (const v of this.def.vessels ?? []) {
      const contents: Record<string, number> = {};
      for (const c of v.contents ?? []) if (c.amount > 0 && this.substances.has(c.substance)) contents[c.substance] = (contents[c.substance] ?? 0) + c.amount;
      this.vessels.set(v.id, { contents, temperature: Number.isFinite(v.temperature) ? Number(v.temperature) : this.ambient, stirred: 0, active: {}, released: {}, pours: 0, spilled: 0 });
    }
    for (const t of this.def.tools ?? []) if (t.kind === 'burner') this.burners.set(t.id, t.on === true);
    this.lastReadings = this.measure();
    // What already holds at the start is not something that happened.
    for (const w of this.def.watches ?? []) this.holding.set(w.id, this.holds(w));
  }

  private vesselDef(id: string): BenchVessel | undefined {
    return this.def.vessels?.find((v) => v.id === id);
  }

  private toolDef(id: string): BenchTool | undefined {
    return this.def.tools?.find((t) => t.id === id);
  }

  state(id: string): VesselState | undefined {
    return this.vessels.get(id);
  }

  substance(id: string): BenchSubstance | undefined {
    return this.substances.get(id);
  }

  burnerOn(id: string): boolean {
    return this.burners.get(id) === true;
  }

  /** How much is in a container: everything but gas. */
  volume(id: string): number {
    const s = this.vessels.get(id);
    return s ? total(s.contents) : 0;
  }

  // ------------------------------------------------------------------ what the player does

  /** Tip one container into another: `amount` mL, or as much as one tip of it pours. */
  pour(fromId: string, toId: string, amount?: number): PourResult {
    const reason = this.pourProblem(fromId, toId);
    if (reason) return { ok: false, reason };
    const from = this.vesselDef(fromId)!;
    const to = this.vesselDef(toId)!;
    const a = this.vessels.get(fromId)!;
    const b = this.vessels.get(toId)!;
    const have = total(a.contents);
    const room = vesselCapacity(to) - total(b.contents);
    const wanted = amount != null && amount > 0 ? amount : vesselPour(from);
    const moved = Math.min(wanted, room, from.supply ? Infinity : have);
    const share = moved / have;
    const before = total(b.contents);
    const color = this.view(fromId).layers.at(-1)?.color ?? '#9ec9f5';
    for (const [id, amt] of Object.entries(a.contents)) {
      const part = amt * share;
      b.contents[id] = (b.contents[id] ?? 0) + part;
      if (!from.supply) a.contents[id] = amt - part;
    }
    tidy(a.contents);
    b.temperature = before + moved > 0 ? (b.temperature * before + a.temperature * moved) / (before + moved) : a.temperature;
    b.pours++;
    return { ok: true, moved, color };
  }

  /** Why one container cannot be tipped into another right now, in words for the player. Null when it can. */
  pourProblem(fromId: string, toId: string): string | null {
    const from = this.vesselDef(fromId);
    const to = this.vesselDef(toId);
    const a = this.vessels.get(fromId);
    const b = this.vessels.get(toId);
    if (!from || !to || !a || !b || fromId === toId) return 'That cannot be poured there.';
    if (from.fixed) return `The ${lower(vesselName(from))} stays where it is.`;
    if (to.supply) return `Nothing goes back into the ${lower(vesselName(to))}.`;
    if (total(a.contents) <= TRACE) return `The ${lower(vesselName(from))} is empty.`;
    if (vesselCapacity(to) - total(b.contents) <= TRACE) return `The ${lower(vesselName(to))} is full.`;
    return null;
  }

  /** Put so much of something straight into a container (an action of the scene's events does this). */
  add(vesselId: string, substance: string, amount: number): boolean {
    const v = this.vesselDef(vesselId);
    const s = this.vessels.get(vesselId);
    if (!v || !s || !this.substances.has(substance) || !(amount > 0)) return false;
    const room = vesselCapacity(v) - total(s.contents);
    const moved = Math.min(amount, Math.max(0, room));
    if (moved <= TRACE) return false;
    const before = total(s.contents);
    s.contents[substance] = (s.contents[substance] ?? 0) + moved;
    s.temperature = (s.temperature * before + this.ambient * moved) / (before + moved);
    return true;
  }

  /** Empty a container (down the sink). A stock bottle cannot be emptied. */
  empty(vesselId: string): boolean {
    const v = this.vesselDef(vesselId);
    const s = this.vessels.get(vesselId);
    if (!v || !s || v.supply) return false;
    s.contents = {};
    s.active = {};
    s.stirred = 0;
    s.temperature = this.ambient;
    return true;
  }

  stir(vesselId: string): boolean {
    const s = this.vessels.get(vesselId);
    if (!s || total(s.contents) <= TRACE) return false;
    s.stirred = STIR_SECONDS;
    return true;
  }

  /** Light a burner or put it out. Without `on`, it changes over. Returns whether it is lit now. */
  burner(toolId: string, on?: boolean): boolean {
    if (this.toolDef(toolId)?.kind !== 'burner') return false;
    const next = on ?? !this.burnerOn(toolId);
    this.burners.set(toolId, next);
    return next;
  }

  // ------------------------------------------------------------------ time passing

  /** Let `dt` seconds pass. */
  step(dt: number) {
    const step = Math.max(0, Math.min(0.25, dt));
    if (step <= 0) return;
    this.time += step;
    this.began = [];
    for (const v of this.def.vessels ?? []) {
      const s = this.vessels.get(v.id);
      if (!s) continue;
      s.stirred = Math.max(0, s.stirred - step);
      for (const key of Object.keys(s.active)) {
        s.active[key] = s.active[key]! - step;
        if (s.active[key]! <= 0) delete s.active[key];
      }
      if (v.supply) continue;
      this.warm(v, s, step);
      for (const r of this.def.reactions ?? []) this.react(v, s, r, step);
      this.spill(v, s);
    }
    this.lastReadings = this.measure();
    this.watch();
  }

  private warm(v: BenchVessel, s: VesselState, dt: number) {
    const amount = total(s.contents);
    if (amount > TRACE) {
      for (const t of this.def.tools ?? []) {
        if (t.kind !== 'burner' || t.vessel_id !== v.id || !this.burnerOn(t.id)) continue;
        s.temperature += ((t.power != null && t.power > 0 ? t.power : 4) * dt * 100) / Math.max(20, amount);
      }
    }
    const cooling = this.def.cooling != null && this.def.cooling >= 0 ? this.def.cooling : 0.02;
    s.temperature += (this.ambient - s.temperature) * Math.min(1, cooling * dt);
    let boil = Infinity;
    for (const id of Object.keys(s.contents)) {
      const sub = this.substances.get(id);
      if (stateOf(sub) === 'liquid' && sub?.boils_at != null && Number.isFinite(sub.boils_at)) boil = Math.min(boil, sub.boils_at);
    }
    // Nothing on a school bench gets hotter than a flame makes a dry dish.
    if (s.temperature > Math.min(boil, HOTTEST)) s.temperature = Math.min(boil, HOTTEST);
  }

  private react(v: BenchVessel, s: VesselState, r: BenchReaction, dt: number) {
    const uses = r.uses ?? [];
    if (uses.length === 0) return;
    for (const u of uses) if ((s.contents[u.substance] ?? 0) <= TRACE) return;
    const conditions = this.conditions.get(r.id) ?? [];
    if (conditions.length && !testWhen(conditions, (name) => this.conditionValue(v.id, s, name))) return;
    const consumed = uses.filter((u) => u.amount > 0);
    let rounds = 0;
    if (consumed.length) {
      rounds = Math.min(...consumed.map((u) => (s.contents[u.substance] ?? 0) / u.amount));
      if (r.rate != null && r.rate > 0) rounds = Math.min(rounds, r.rate * dt);
      if (rounds <= TRACE) return;
      const amount = total(s.contents);
      for (const u of consumed) s.contents[u.substance] = (s.contents[u.substance] ?? 0) - u.amount * rounds;
      for (const m of r.makes ?? []) {
        if (!(m.amount > 0)) continue;
        if (stateOf(this.substances.get(m.substance)) === 'gas') s.released[m.substance] = (s.released[m.substance] ?? 0) + m.amount * rounds;
        else s.contents[m.substance] = (s.contents[m.substance] ?? 0) + m.amount * rounds;
      }
      tidy(s.contents);
      if (r.heat) s.temperature += (r.heat * rounds * 100) / Math.max(20, amount);
    }
    // One that uses nothing up goes on for as long as its conditions hold.
    s.active[r.id] = consumed.length && !(r.rate != null && r.rate > 0) ? SHOW_SECONDS : Math.max(s.active[r.id] ?? 0, 0.5);
    const key = `${r.id}@${v.id}`;
    if (!this.happened.has(key)) {
      this.happened.add(key);
      this.began.push({ reaction: r.id, vessel: v.id });
      this.queue.push({ kind: 'reaction', reaction: r.id, vessel: v.id });
      if (r.note && !this.noted.has(r.id)) {
        this.noted.add(r.id);
        this.queue.push({ kind: 'note', text: r.note, vessel: v.id });
      }
    }
  }

  private spill(v: BenchVessel, s: VesselState) {
    const amount = total(s.contents);
    const capacity = vesselCapacity(v);
    if (amount <= capacity + TRACE) return;
    const keep = capacity / amount;
    for (const id of Object.keys(s.contents)) s.contents[id] = s.contents[id]! * keep;
    s.spilled += amount - capacity;
    this.overflowed.add(v.id);
  }

  /** A name of a reaction's conditions, for a container. */
  private conditionValue(vesselId: string, s: VesselState, name: string): unknown {
    switch (name) {
      case 'temperature': return s.temperature;
      case 'volume': return total(s.contents);
      case 'ph': return this.ph(s) ?? '';
      case 'stirred': return s.stirred > 0 ? 1 : 0;
      case 'time': return this.time;
      default: return this.substances.has(name) ? s.contents[name] ?? 0 : undefined;
    }
  }

  // ------------------------------------------------------------------ what there is to see

  /** The pH of what is in a container, from the pH of each liquid in it. Null when nothing in it has one. */
  private ph(s: VesselState): number | null {
    let liquid = 0;
    let excess = 0;
    let any = false;
    for (const [id, amount] of Object.entries(s.contents)) {
      const sub = this.substances.get(id);
      if (stateOf(sub) !== 'liquid') continue;
      liquid += amount;
      if (sub?.ph == null || !Number.isFinite(sub.ph)) continue;
      any = true;
      // How much more acid than base a litre of it holds (negative for a base).
      excess += amount * (10 ** -sub.ph - 10 ** -(14 - sub.ph));
    }
    if (!any || liquid <= TRACE) return null;
    const net = excess / liquid;
    const h = (net + Math.sqrt(net * net + 4e-14)) / 2;
    return Math.max(0, Math.min(14, -Math.log10(h)));
  }

  phOf(vesselId: string): number | null {
    const s = this.vessels.get(vesselId);
    return s ? this.ph(s) : null;
  }

  /** A container as it looks now: its layers from the bottom up, and what is going on in it. */
  view(vesselId: string): VesselView {
    const v = this.vesselDef(vesselId);
    const s = this.vessels.get(vesselId);
    if (!v || !s) return { layers: [], fill: 0, volume: 0, temperature: this.ambient, ph: null, stirred: false, effects: [] };
    const capacity = vesselCapacity(v);
    const ph = this.ph(s);
    const colorOf = (sub: BenchSubstance | undefined): [number, number, number] =>
      sub?.indicator?.length && ph != null ? indicatorColor(sub.indicator, ph) : parseColor(sub?.color, stateOf(sub) === 'solid' ? [235, 235, 235] : CLEAR);

    interface Band { amount: number; density: number; color: [number, number, number]; alpha: number; solid: boolean }
    const bands: Band[] = [];
    const blend = (parts: Array<[BenchSubstance | undefined, number]>, solid: boolean): Band | null => {
      let amount = 0;
      let weight = 0;
      let mass = 0;
      let alpha = 0;
      const rgb: [number, number, number] = [0, 0, 0];
      for (const [sub, amt] of parts) {
        // A few drops of indicator colour the lot; a liquid given no colour is clear and hardly colours anything.
        const strength = sub?.strength != null && sub.strength >= 0 ? sub.strength : sub?.indicator?.length ? 20 : sub?.color || solid ? 1 : 0.15;
        const w = amt * strength;
        const c = colorOf(sub);
        rgb[0] += c[0] * w;
        rgb[1] += c[1] * w;
        rgb[2] += c[2] * w;
        weight += w;
        amount += amt;
        mass += amt * (sub?.density != null && sub.density > 0 ? sub.density : 1);
        alpha += w * (sub?.opacity != null ? Math.max(0, Math.min(1, sub.opacity)) : solid ? 1 : 0.75);
      }
      if (amount <= TRACE) return null;
      const colour: [number, number, number] = weight > 0 ? [rgb[0] / weight, rgb[1] / weight, rgb[2] / weight] : CLEAR;
      return { amount, density: mass / amount, color: colour, alpha: weight > 0 ? alpha / weight : solid ? 1 : 0.75, solid };
    };
    const solids: Array<[BenchSubstance | undefined, number]> = [];
    const mixed: Array<[BenchSubstance | undefined, number]> = [];
    for (const [id, amount] of Object.entries(s.contents)) {
      if (amount <= TRACE) continue;
      const sub = this.substances.get(id);
      if (stateOf(sub) === 'solid') solids.push([sub, amount]);
      else if (sub?.separate) {
        const own = blend([[sub, amount]], false);
        if (own) bands.push(own);
      } else mixed.push([sub, amount]);
    }
    const mixture = blend(mixed, false);
    if (mixture) bands.push(mixture);
    // The heaviest liquid at the bottom; what has settled out lies under them all.
    bands.sort((a, b) => b.density - a.density);
    const sediment = blend(solids, true);
    if (sediment) bands.unshift(sediment);

    const layers: BenchLayer[] = [];
    let at = 0;
    for (const b of bands) {
      const to = Math.min(1, at + b.amount / capacity);
      layers.push({ from: at, to, color: colorText(b.color), alpha: b.alpha, solid: b.solid });
      at = to;
    }
    const effects: VesselView['effects'] = [];
    for (const [id, left] of Object.entries(s.active)) {
      const r = this.def.reactions?.find((x) => x.id === id);
      const kind = r?.effect ?? 'bubbles';
      if (kind === 'none') continue;
      effects.push({ kind, color: r?.effect_color || (kind === 'smoke' ? '#b9c4ce' : kind === 'glow' || kind === 'flash' ? '#ffd76a' : '#ffffff'), strength: Math.max(0.15, Math.min(1, left / 0.8)) });
    }
    return { layers, fill: at, volume: total(s.contents), temperature: s.temperature, ph, stirred: s.stirred > 0, effects };
  }

  /** What a container's surface is, in pixels up from its foot: where a stream being poured in lands. */
  surface(vesselId: string): number {
    const v = this.vesselDef(vesselId);
    if (!v) return 0;
    return fillHeight(vesselOutline(v.shape, vesselWidth(v), vesselHeight(v)), this.view(vesselId).fill);
  }

  /** What is in a container, in words: "40 mL water, 5 g salt". */
  describe(vesselId: string): string {
    const s = this.vessels.get(vesselId);
    if (!s) return '';
    const parts = Object.entries(s.contents)
      .filter(([, amount]) => amount >= 0.05)
      .sort((a, b) => b[1] - a[1])
      .map(([id, amount]) => {
        const sub = this.substances.get(id);
        return `${Math.round(amount * 10) / 10} ${stateOf(sub) === 'solid' ? 'g' : 'mL'} ${lower(substanceName(sub, id))}`;
      });
    return parts.length ? parts.join(', ') : 'empty';
  }

  // ------------------------------------------------------------------ readings and watches

  private measure(): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    const later: BenchReadout[] = [];
    for (const r of this.def.readouts ?? []) {
      if (r.measure === 'formula') {
        later.push(r);
        continue;
      }
      out[r.id] = this.reading(r);
    }
    for (const r of later) {
      const get = (name: string) => (name === 'time' ? this.time : out[name] ?? undefined);
      out[r.id] = r.formula && this.options.formula ? this.options.formula(r.formula, get) : null;
    }
    return out;
  }

  private reading(r: BenchReadout): number | null {
    if (r.measure === 'time') return this.time;
    const s = r.vessel_id ? this.vessels.get(r.vessel_id) : undefined;
    if (!s) return null;
    switch (r.measure) {
      case 'volume': return total(s.contents);
      case 'temperature': return s.temperature;
      case 'ph': return this.ph(s);
      case 'amount': return r.substance ? s.contents[r.substance] ?? 0 : null;
      case 'released': return r.substance ? s.released[r.substance] ?? 0 : Object.values(s.released).reduce((a, b) => a + b, 0);
      case 'pours': return s.pours;
      default: return null;
    }
  }

  /** Every readout's value now, by its id. Null where there is nothing to measure. */
  readings(): Record<string, number | null> {
    return this.lastReadings;
  }

  /** Measure again without time passing: after a pour, so what is shown is what is there. */
  refresh() {
    this.lastReadings = this.measure();
    this.began = [];
    this.watch();
  }

  /** Whether what a watch looks for is so right now. */
  private holds(w: BenchWatch): boolean {
    const vessels = w.vessel_id ? [w.vessel_id] : [...this.vessels.keys()];
    switch (w.when) {
      case 'reaction':
        return this.began.some((b) => (!w.reaction_id || b.reaction === w.reaction_id) && (!w.vessel_id || b.vessel === w.vessel_id));
      case 'overflow':
        return vessels.some((id) => this.overflowed.has(id));
      case 'contains': {
        if (!w.substance) return false;
        const least = w.amount != null && w.amount > 0 ? w.amount : TRACE * 10;
        return vessels.some((id) => !this.vesselDef(id)?.supply && (this.vessels.get(id)?.contents[w.substance!] ?? 0) >= least - 1e-9);
      }
      case 'reading': {
        const value = w.readout_id ? this.lastReadings[w.readout_id] : null;
        if (value == null || !Number.isFinite(value) || w.value == null) return false;
        return testWhen([{ variable: 'v', operator: w.operator ?? '>=', operand: w.value }], () => value);
      }
      default:
        return false;
    }
  }

  private watch() {
    for (const w of this.def.watches ?? []) {
      const now = this.holds(w);
      const before = this.holding.get(w.id) === true;
      this.holding.set(w.id, now);
      if (!now || before) continue;
      if (!w.repeat && this.fired.has(w.id)) continue;
      this.fired.add(w.id);
      const value = w.when === 'reading' && w.readout_id ? this.lastReadings[w.readout_id] ?? null : null;
      this.queue.push({ kind: 'watch', watch: w, value });
    }
    this.overflowed.clear();
  }

  /** What was noticed since this was last asked. */
  takeEvents(): BenchEvent[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }
}

function total(contents: Record<string, number>): number {
  let sum = 0;
  for (const v of Object.values(contents)) sum += v;
  return sum;
}

function tidy(contents: Record<string, number>) {
  for (const key of Object.keys(contents)) if (!(contents[key]! > TRACE)) delete contents[key];
}

const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/** The units a readout shows by default, given what it measures (a solid is weighed, not poured). */
export function benchReadoutUnit(def: SceneBench, r: BenchReadout): string {
  if (r.unit != null) return r.unit;
  if (r.measure === 'amount' && stateOf(def.substances?.find((s) => s.id === r.substance)) === 'solid') return 'g';
  return BENCH_MEASURES[r.measure]?.unit ?? '';
}
