/**
 * [ext] A close-up bench: an experiment worked with the hands rather than with the feet. A scene
 * with `bench.enabled` shows containers (test tubes, beakers, flasks, bottles, droppers) standing
 * on its background; the player picks one up and tips it into another, lights a burner, stirs,
 * and watches what happens. What happens is written by the author as reactions: what has to be
 * in a container together, under which conditions, what it turns into and what that looks like.
 *
 * It is a model of a lab for learning, not chemistry worked out from first principles: amounts
 * are in millilitres (a gram of a solid counts as one), a mixture's pH comes from the pH of what
 * is in it, heat spreads at once through a container, and only the reactions that were written
 * happen. That is what makes it safe to give to a class and quick to write.
 *
 * Everything here is free of the DOM and of Phaser: the game, the editor and the validator share it.
 */
import type { Id, Point } from './types.js';

// ------------------------------------------------------------------ the model

export const BENCH_STATES = ['liquid', 'solid', 'gas'] as const;
export type BenchState = (typeof BENCH_STATES)[number];

/** Something that can be in a container. */
export interface BenchSubstance {
  /** Its name in reactions and conditions: letters, digits and _ (`baking_soda`). */
  id: string;
  /** What players read ("Baking soda"). */
  name?: string;
  /** Shown beside the name where there is room ("NaHCO₃"). */
  formula?: string;
  state?: BenchState;
  /** A CSS colour (#rrggbb). */
  color?: string;
  /** How strongly it colours a mixture: 1 as much as anything else, 0.1 hardly (water), 5 a dye. Left out: 1 with a colour, hardly at all without one, strongly for an indicator. */
  strength?: number;
  /** How see-through it is: 0 clear, 1 solid colour (default 0.75 for a liquid, 1 for a solid). */
  opacity?: number;
  /** g/mL: what does not mix floats or sinks by it (default 1). */
  density?: number;
  /** A liquid that keeps to itself (oil): a layer of its own, above or below the rest by density. */
  separate?: boolean;
  /** The pH of this on its own, for acids and bases. Absent: it does not change the pH. */
  ph?: number | null;
  /** An indicator: the colour it has at each pH, between which it blends. Its own colour is not used. */
  indicator?: Array<{ ph: number; color: string }>;
  /** °C: a container holding this liquid gets no hotter. */
  boils_at?: number | null;
}

export const BENCH_SHAPES = {
  tube: { label: 'Test tube', capacity: 25, width: 46, height: 220, pour: 5 },
  beaker: { label: 'Beaker', capacity: 250, width: 190, height: 220, pour: 25 },
  flask: { label: 'Conical flask', capacity: 250, width: 200, height: 250, pour: 25 },
  cylinder: { label: 'Measuring cylinder', capacity: 100, width: 80, height: 300, pour: 10 },
  dish: { label: 'Dish', capacity: 100, width: 220, height: 60, pour: 10 },
  bottle: { label: 'Bottle', capacity: 500, width: 130, height: 260, pour: 10 },
  jar: { label: 'Jar', capacity: 250, width: 140, height: 170, pour: 5 },
  dropper: { label: 'Dropper', capacity: 5, width: 34, height: 170, pour: 1 },
} as const;
export type BenchShape = keyof typeof BENCH_SHAPES;

/** So much of a substance. */
export interface BenchAmount {
  substance: string;
  amount: number;
}

/** A container standing on the bench. */
export interface BenchVessel {
  id: string;
  name?: string;
  shape?: BenchShape;
  /** The middle of its foot, in scene pixels. */
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** How much it holds, in mL. */
  capacity?: number;
  /** What is in it to begin with. */
  contents?: BenchAmount[];
  /** A stock bottle: it never runs out, and nothing can be poured into it. */
  supply?: boolean;
  /** How much one tip pours out of it, in mL (a dropper: a drop). */
  pour?: number;
  /** °C to begin with (default: the room's). */
  temperature?: number;
  /** Draw a scale up its side. */
  marks?: boolean;
  /** It stays where it is: things are poured into it, never out of it. */
  fixed?: boolean;
  /** Show its name under it (default true). */
  label?: boolean;
}

export const BENCH_TOOLS = {
  burner: { label: 'Burner', icon: '🔥' },
  stirrer: { label: 'Stirring rod', icon: '🥄' },
  sink: { label: 'Sink', icon: '🚰' },
} as const;
export type BenchToolKind = keyof typeof BENCH_TOOLS;

/** A tool on the bench: a burner under a container, a stirring rod, a sink to empty things into. */
export interface BenchTool {
  id: string;
  kind: BenchToolKind;
  name?: string;
  x: number;
  y: number;
  /** burner: the container it heats. */
  vessel_id?: string;
  /** burner: degrees a second it warms 100 mL by (default 4). */
  power?: number;
  /** burner: lit to begin with. */
  on?: boolean;
}

export const BENCH_EFFECTS = {
  none: 'Nothing to see',
  bubbles: 'Bubbles',
  fizz: 'Fizzing over',
  smoke: 'Smoke or steam',
  glow: 'A glow',
  flash: 'A flash',
} as const;
export type BenchEffect = keyof typeof BENCH_EFFECTS;

/** Something that happens when the right things are together. */
export interface BenchReaction {
  id: string;
  name?: string;
  /**
   * What has to be in the container, and how much of each one "round" of the reaction uses up.
   * An amount of 0: it has to be there but is not used up (a catalyst, an indicator).
   */
  uses: BenchAmount[];
  /** What a round makes. A gas leaves the container (and is counted as given off). */
  makes?: BenchAmount[];
  /**
   * Conditions it also needs, as in an infobox's `when` block: `temperature >= 60; stirred = 1`.
   * Names: temperature, volume, ph, stirred, time, and any substance (how much of it is there).
   */
  when?: string;
  /** Rounds a second. Absent or 0: all at once. */
  rate?: number;
  /** Degrees one round warms 100 mL by (negative: it cools). */
  heat?: number;
  effect?: BenchEffect;
  effect_color?: string;
  /** Said to the player the first time it happens ("It fizzes!"). */
  note?: string;
}

export const BENCH_MEASURES = {
  volume: { label: 'Volume', unit: 'mL', digits: 1, vessel: true },
  temperature: { label: 'Temperature', unit: '°C', digits: 1, vessel: true },
  ph: { label: 'pH', unit: '', digits: 1, vessel: true },
  amount: { label: 'Amount of a substance', unit: 'mL', digits: 1, vessel: true },
  released: { label: 'Gas given off', unit: 'mL', digits: 1, vessel: true },
  pours: { label: 'Times poured into', unit: '', digits: 0, vessel: true },
  time: { label: 'Time', unit: 's', digits: 0, vessel: false },
  formula: { label: 'Worked out from other readings', unit: '', digits: 2, vessel: false },
} as const;
export type BenchMeasure = keyof typeof BENCH_MEASURES;

/** A number shown beside the bench while it is worked, and kept in a variable if it has one. */
export interface BenchReadout {
  /** Its name in formulas and graphs: letters, digits and _. */
  id: string;
  label?: string;
  measure: BenchMeasure;
  vessel_id?: string;
  /** amount, released: of what. */
  substance?: string;
  /** formula: worked out with math.js from other readouts, by their ids (`mass / volume`). */
  formula?: string;
  unit?: string;
  digits?: number;
  /** Keep it in this variable. */
  variable?: string;
  /** Measure it without showing it. */
  hidden?: boolean;
}

export const BENCH_WATCHES = {
  reaction: 'A reaction happens',
  reading: 'A reading passes a value',
  contains: 'A container holds something',
  overflow: 'A container overflows',
} as const;
export type BenchWatchKind = keyof typeof BENCH_WATCHES;

/** Something to notice while the bench is worked: it sets a variable and runs an event of the scene. */
export interface BenchWatch {
  id: string;
  name?: string;
  when: BenchWatchKind;
  /** reaction: which (absent: any). */
  reaction_id?: string;
  /** reaction, contains, overflow: in which container (absent: any). */
  vessel_id?: string;
  /** reading: which readout, compared with `value`. */
  readout_id?: string;
  operator?: '=' | '!=' | '<' | '>' | '<=' | '>=';
  value?: number;
  /** contains: what, and at least how much (default: any at all). */
  substance?: string;
  amount?: number;
  /** Set this variable (to `set`, or to 1)… */
  variable?: string;
  set?: string | number;
  /** …and run this indirect event of the scene. */
  event_id?: Id | null;
  /** Notice it every time it happens rather than only the first (default false). */
  repeat?: boolean;
}

/** A graph beside the bench: one reading against another (or against time), as the player records it. */
export interface BenchGraph {
  /** A readout's id, or `time`. */
  x: string;
  y: string;
  title?: string;
  /** `button`: a point each time the player presses Record (default). `live`: a point twice a second. */
  record?: 'button' | 'live';
  /** Keep the points in this variable, as "x,y;x,y": a graph block of an infobox can show them later. */
  variable?: string;
}

export interface SceneBench {
  enabled: boolean;
  /** The room's temperature in °C (default 20). */
  ambient?: number;
  /** How fast things come back to the room's temperature: the share of the difference lost each second (default 0.02). */
  cooling?: number;
  substances?: BenchSubstance[];
  vessels?: BenchVessel[];
  tools?: BenchTool[];
  reactions?: BenchReaction[];
  readouts?: BenchReadout[];
  watches?: BenchWatch[];
  graph?: BenchGraph | null;
  /** Buttons offered beside the bench (each default true). */
  controls?: { reset?: boolean };
}

/** What a `bench` action does. */
export const BENCH_OPS = [
  ['reset', 'Put everything back as it started'],
  ['add', 'Add something to a container'],
  ['empty', 'Empty a container'],
  ['burner', 'Light a burner or put it out'],
  ['stir', 'Stir a container'],
] as const;
export type BenchOp = (typeof BENCH_OPS)[number][0];

/** The names a reaction's conditions may read, beside the substances. */
export const BENCH_CONDITION_NAMES = ['temperature', 'volume', 'ph', 'stirred', 'time'] as const;

/** An id that can be written in a condition or a formula. */
export const BENCH_NAME = /^[A-Za-z_]\w*$/;

/** The scene's bench when it has one that is switched on. */
export function sceneBench(scene: { bench?: SceneBench | null } | null | undefined): SceneBench | null {
  const b = scene?.bench;
  return b && typeof b === 'object' && b.enabled === true ? b : null;
}

// ------------------------------------------------------------------ defaults

export const shapeOf = (v: Pick<BenchVessel, 'shape'>) => BENCH_SHAPES[v.shape ?? 'beaker'] ?? BENCH_SHAPES.beaker;
export const vesselWidth = (v: BenchVessel) => (v.width != null && v.width > 0 ? v.width : shapeOf(v).width);
export const vesselHeight = (v: BenchVessel) => (v.height != null && v.height > 0 ? v.height : shapeOf(v).height);
export const vesselCapacity = (v: BenchVessel) => (v.capacity != null && v.capacity > 0 ? v.capacity : shapeOf(v).capacity);
export const vesselPour = (v: BenchVessel) => (v.pour != null && v.pour > 0 ? v.pour : shapeOf(v).pour);
export const vesselName = (v: BenchVessel) => v.name || shapeOf(v).label;
export const substanceName = (s: BenchSubstance | undefined, id = '') => s?.name || s?.id || id;
export const stateOf = (s: BenchSubstance | undefined): BenchState => s?.state ?? 'liquid';

// ------------------------------------------------------------------ shapes

/**
 * The inside of a container as a polygon, in pixels from the middle of its foot with y going UP:
 * (0,0) is the middle of the bottom, (0,height) the middle of the mouth. It starts at the top
 * left and goes round by the bottom to the top right; the mouth is the open side.
 */
export function vesselOutline(shape: BenchShape | undefined, width: number, height: number): Point[] {
  const w = width;
  const h = height;
  const p = (x: number, y: number): Point => ({ x: x * w, y: y * h });
  switch (shape ?? 'beaker') {
    case 'tube': {
      const r = Math.min(w / 2, h / 2);
      const pts: Point[] = [{ x: -w / 2, y: h }];
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        pts.push({ x: r * Math.cos(a) * (w / 2 / r), y: r + r * Math.sin(a) });
      }
      pts.push({ x: w / 2, y: h });
      return pts;
    }
    case 'flask':
      return [p(-0.17, 1), p(-0.17, 0.62), p(-0.5, 0.06), p(-0.46, 0), p(0.46, 0), p(0.5, 0.06), p(0.17, 0.62), p(0.17, 1)];
    case 'dish':
      return [p(-0.5, 1), p(-0.4, 0), p(0.4, 0), p(0.5, 1)];
    case 'bottle':
      return [p(-0.16, 1), p(-0.16, 0.8), p(-0.5, 0.66), p(-0.5, 0.03), p(-0.46, 0), p(0.46, 0), p(0.5, 0.03), p(0.5, 0.66), p(0.16, 0.8), p(0.16, 1)];
    case 'jar':
      return [p(-0.42, 1), p(-0.42, 0.9), p(-0.5, 0.84), p(-0.5, 0.04), p(-0.45, 0), p(0.45, 0), p(0.5, 0.04), p(0.5, 0.84), p(0.42, 0.9), p(0.42, 1)];
    case 'dropper':
      return [p(-0.3, 1), p(-0.3, 0.35), p(-0.09, 0), p(0.09, 0), p(0.3, 0.35), p(0.3, 1)];
    case 'cylinder':
      return [p(-0.5, 1), p(-0.5, 0.02), p(-0.46, 0), p(0.46, 0), p(0.5, 0.02), p(0.5, 1)];
    case 'beaker':
    default:
      return [p(-0.5, 1), p(-0.5, 0.04), p(-0.45, 0), p(0.45, 0), p(0.5, 0.04), p(0.5, 1)];
  }
}

function polygonArea(points: Point[]): number {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) a += points[j]!.x * points[i]!.y - points[i]!.x * points[j]!.y;
  return Math.abs(a) / 2;
}

/** The part of a polygon on one side of a level line: at or below it (`below`), or at or above. */
function clipAt(points: Point[], level: number, below: boolean): Point[] {
  const inside = (p: Point) => (below ? p.y <= level + 1e-9 : p.y >= level - 1e-9);
  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const ain = inside(a);
    const bin = inside(b);
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (level - a.y) / (b.y - a.y);
      out.push({ x: a.x + (b.x - a.x) * t, y: level });
    }
  }
  return out;
}

/** The part of a container's inside between two heights (pixels up from its foot). */
export function outlineBand(outline: Point[], from: number, to: number): Point[] {
  return clipAt(clipAt(outline, to, true), from, false);
}

/** How high (pixels up from the foot) a container is filled when this share of it is full. */
export function fillHeight(outline: Point[], fraction: number): number {
  const top = Math.max(...outline.map((p) => p.y));
  const f = Math.max(0, Math.min(1, fraction));
  if (f <= 0) return 0;
  if (f >= 1) return top;
  const whole = polygonArea(outline);
  if (whole <= 0) return top * f;
  let lo = 0;
  let hi = top;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (polygonArea(clipAt(outline, mid, true)) / whole < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** A container's inside in scene pixels (y down), from its outline. */
export function outlineInScene(v: BenchVessel, outline: Point[] = vesselOutline(v.shape, vesselWidth(v), vesselHeight(v))): Point[] {
  return outline.map((p) => ({ x: v.x + p.x, y: v.y - p.y }));
}

/** Whether a point of the scene is on a container (with a margin, for fingers). */
export function vesselContains(v: BenchVessel, at: Point, slop = 0): boolean {
  const w = vesselWidth(v) / 2 + slop;
  return at.x >= v.x - w && at.x <= v.x + w && at.y <= v.y + slop && at.y >= v.y - vesselHeight(v) - slop;
}

/** Whether a point of the scene is on a tool. */
export function toolContains(t: BenchTool, at: Point, slop = 0): boolean {
  const { w, h } = toolSize(t);
  return at.x >= t.x - w / 2 - slop && at.x <= t.x + w / 2 + slop && at.y <= t.y + slop && at.y >= t.y - h - slop;
}

/** How large a tool is drawn, standing on (x, y). */
export function toolSize(t: Pick<BenchTool, 'kind'>): { w: number; h: number } {
  return t.kind === 'burner' ? { w: 110, h: 70 } : t.kind === 'sink' ? { w: 200, h: 90 } : { w: 40, h: 200 };
}

// ------------------------------------------------------------------ colours

export function parseColor(css: string | undefined | null, fallback: [number, number, number] = [150, 180, 220]): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((css ?? '').trim());
  if (m) {
    const n = parseInt(m[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const s = /^#?([0-9a-f]{3})$/i.exec((css ?? '').trim());
  if (s) return [...s[1]!].map((c) => parseInt(c + c, 16)) as [number, number, number];
  return fallback;
}

export function colorText(rgb: [number, number, number]): string {
  return `#${rgb.map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** An indicator's colour at a pH: between its two nearest stops. */
export function indicatorColor(stops: Array<{ ph: number; color: string }>, ph: number): [number, number, number] {
  const sorted = [...stops].filter((s) => Number.isFinite(s.ph)).sort((a, b) => a.ph - b.ph);
  if (sorted.length === 0) return [200, 200, 200];
  if (ph <= sorted[0]!.ph) return parseColor(sorted[0]!.color);
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1]!;
    const b = sorted[i]!;
    if (ph <= b.ph) {
      const t = b.ph === a.ph ? 1 : (ph - a.ph) / (b.ph - a.ph);
      const ca = parseColor(a.color);
      const cb = parseColor(b.color);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return parseColor(sorted.at(-1)!.color);
}

// ------------------------------------------------------------------ recipes as text

/**
 * Amounts written as a recipe: "50 water + 5 salt". A substance with no number counts as 1.
 * Returns null when a part cannot be read.
 */
export function parseMix(text: string): BenchAmount[] | null {
  const out: BenchAmount[] = [];
  for (const part of text.split('+')) {
    const t = part.trim();
    if (!t) continue;
    const m = /^(\d+(?:\.\d+)?)?\s*([A-Za-z_]\w*)$/.exec(t);
    if (!m) return null;
    out.push({ substance: m[2]!, amount: m[1] != null ? Number(m[1]) : 1 });
  }
  return out;
}

export function mixText(parts: BenchAmount[] | undefined | null): string {
  return (parts ?? []).map((p) => `${Number(p.amount) || 0} ${p.substance}`).join(' + ');
}

/** A reaction written as "2 vinegar + 1 baking_soda -> 2 salty_water + 1 co2". Null when it cannot be read. */
export function parseEquation(text: string): { uses: BenchAmount[]; makes: BenchAmount[] } | null {
  const [left, right, ...rest] = text.split(/->|→|=>/);
  if (left == null || rest.length) return null;
  const uses = parseMix(left);
  const makes = parseMix(right ?? '');
  return uses && makes && uses.length ? { uses, makes } : null;
}

export function equationText(r: Pick<BenchReaction, 'uses' | 'makes'>): string {
  const makes = mixText(r.makes);
  return `${mixText(r.uses)} -> ${makes}`.trim();
}

// ------------------------------------------------------------------ readings as text

/** A reading rounded as its readout shows it. */
export function roundBenchReading(r: Pick<BenchReadout, 'measure' | 'digits'>, value: number): number {
  const d = r.digits != null && r.digits >= 0 ? Math.min(6, Math.floor(r.digits)) : BENCH_MEASURES[r.measure]?.digits ?? 1;
  const f = 10 ** d;
  return Math.round(value * f) / f;
}

/** A reading as it is shown: "12.5 mL", or a dash when there is nothing to measure. */
export function formatBenchReading(r: BenchReadout, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const unit = r.unit ?? BENCH_MEASURES[r.measure]?.unit ?? '';
  return `${roundBenchReading(r, value)}${unit ? ` ${unit}` : ''}`;
}

// ------------------------------------------------------------------ ready-made sets

/** Substances and reactions that go together, to start a bench from. */
export interface BenchKit {
  label: string;
  about: string;
  substances: BenchSubstance[];
  reactions: BenchReaction[];
}

/**
 * Ready-made sets an author can add to a bench and then change: the editor offers them, and the
 * Science Lab demo is built from them.
 */
export const BENCH_KITS: Record<string, BenchKit> = {
  kitchen: {
    label: 'Kitchen fizz: vinegar and baking soda',
    about: 'Vinegar poured on baking soda fizzes, gives off carbon dioxide and gets colder.',
    substances: [
      { id: 'water', name: 'Water', formula: 'H₂O', color: '#bfe0ff', strength: 0.2, opacity: 0.6, boils_at: 100 },
      { id: 'vinegar', name: 'Vinegar', color: '#e3c45c', opacity: 0.7, ph: 2.4 },
      { id: 'baking_soda', name: 'Baking soda', formula: 'NaHCO₃', state: 'solid', color: '#ffffff' },
      { id: 'salty_water', name: 'Salty water', color: '#d3e4ec', strength: 0.4, opacity: 0.65 },
      { id: 'co2', name: 'Carbon dioxide', formula: 'CO₂', state: 'gas' },
    ],
    reactions: [
      {
        id: 'fizz', name: 'Vinegar meets baking soda', uses: [{ substance: 'vinegar', amount: 2 }, { substance: 'baking_soda', amount: 1 }],
        makes: [{ substance: 'salty_water', amount: 2 }, { substance: 'co2', amount: 6 }], rate: 4, heat: -0.15, effect: 'fizz', note: 'It fizzes! A gas is bubbling out.',
      },
    ],
  },
  acids: {
    label: 'Acids and bases, with an indicator',
    about: 'An acid, a base and universal indicator. The pH follows what is mixed, and the indicator changes colour with it: enough for a titration.',
    substances: [
      { id: 'water', name: 'Water', formula: 'H₂O', color: '#bfe0ff', strength: 0.2, opacity: 0.6, boils_at: 100 },
      { id: 'acid', name: 'Dilute acid', formula: 'HCl', opacity: 0.5, ph: 1 },
      { id: 'base', name: 'Dilute base', formula: 'NaOH', opacity: 0.5, ph: 13 },
      { id: 'lemon_juice', name: 'Lemon juice', color: '#f7ee9c', opacity: 0.6, ph: 2.3 },
      { id: 'soapy_water', name: 'Soapy water', color: '#e4f1f5', opacity: 0.6, ph: 10 },
      {
        id: 'indicator', name: 'Universal indicator', opacity: 0.8,
        indicator: [{ ph: 1, color: '#e53935' }, { ph: 4, color: '#fb8c00' }, { ph: 6, color: '#fdd835' }, { ph: 7, color: '#43a047' }, { ph: 9, color: '#1e88e5' }, { ph: 11, color: '#3949ab' }, { ph: 13, color: '#8e24aa' }],
      },
    ],
    reactions: [],
  },
  layers: {
    label: 'Liquids that float on each other',
    about: 'Honey, water and oil do not mix: poured into one container they settle in layers, the densest at the bottom.',
    substances: [
      { id: 'water', name: 'Water', formula: 'H₂O', color: '#bfe0ff', strength: 0.2, opacity: 0.6, density: 1, boils_at: 100 },
      { id: 'oil', name: 'Cooking oil', color: '#f2c94c', opacity: 0.75, density: 0.92, separate: true },
      { id: 'honey', name: 'Honey', color: '#c9861a', opacity: 0.9, density: 1.42, separate: true },
      { id: 'dye', name: 'Blue food dye', color: '#1e63d0', strength: 12, opacity: 0.9, density: 1 },
    ],
    reactions: [],
  },
  dissolve: {
    label: 'Dissolving and boiling dry',
    about: 'Salt dissolves in water when it is stirred. Boil the water away over a burner and the salt comes back.',
    substances: [
      { id: 'water', name: 'Water', formula: 'H₂O', color: '#bfe0ff', strength: 0.2, opacity: 0.6, boils_at: 100 },
      { id: 'salt', name: 'Salt', formula: 'NaCl', state: 'solid', color: '#ffffff' },
      { id: 'dissolved_salt', name: 'Dissolved salt', color: '#e6eef2', strength: 0.3, opacity: 0.5 },
      { id: 'steam', name: 'Steam', state: 'gas' },
    ],
    reactions: [
      { id: 'dissolve', name: 'Salt dissolves', uses: [{ substance: 'salt', amount: 1 }, { substance: 'water', amount: 0 }], makes: [{ substance: 'dissolved_salt', amount: 1 }], when: 'stirred = 1', rate: 3, effect: 'none' },
      { id: 'boil', name: 'Water boils away', uses: [{ substance: 'water', amount: 1 }], makes: [{ substance: 'steam', amount: 1 }], when: 'temperature >= 100', rate: 3, effect: 'smoke' },
      { id: 'dry', name: 'Salt is left behind', uses: [{ substance: 'dissolved_salt', amount: 1 }], makes: [{ substance: 'salt', amount: 1 }], when: 'water < 1; temperature >= 60', rate: 4, effect: 'none', note: 'The water has gone, and the salt is back.' },
    ],
  },
};

/** A copy that shares nothing with what it was made from. (The shared code is built without the browser's or Node's globals.) */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A bench with a kit added: substances and reactions it does not have yet (by id) are put in. */
export function withKit(bench: SceneBench, kit: BenchKit): SceneBench {
  const substances = [...(bench.substances ?? [])];
  for (const s of kit.substances) if (!substances.some((x) => x.id === s.id)) substances.push(copy(s));
  const reactions = [...(bench.reactions ?? [])];
  for (const r of kit.reactions) if (!reactions.some((x) => x.id === r.id)) reactions.push(copy(r));
  return { ...bench, substances, reactions };
}
