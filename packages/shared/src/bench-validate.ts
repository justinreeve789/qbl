import {
  BENCH_CONDITION_NAMES, BENCH_EFFECTS, BENCH_MEASURES, BENCH_NAME, BENCH_OPS, BENCH_SHAPES, BENCH_STATES, BENCH_TOOLS, BENCH_WATCHES, stateOf, vesselCapacity,
  type BenchAmount, type SceneBench,
} from './bench.js';
import { formulaGlance, formulaNames, parseWhen } from './infobox.js';
import type { Id } from './types.js';

export interface BenchCheck {
  err(path: string, message: string): void;
  warn(path: string, message: string): void;
  /** The scenario's variables, by name. */
  variables: Set<string>;
  /** The scene's size, when it is known. */
  size: { width: number; height: number } | null;
  /** Whether an event is an indirect event of this scene. */
  indirect(id: Id): boolean;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter(isObject) : []);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The publish check of a scene's close-up bench. */
export function checkBench(bench: unknown, path: string, c: BenchCheck): void {
  if (!isObject(bench)) return c.err(path, 'The bench must be an object');
  const b = bench as unknown as SceneBench;
  if (typeof b.enabled !== 'boolean') c.err(`${path}.enabled`, 'enabled must be true or false');

  const ids = (items: Array<Record<string, unknown>>, at: string, what: string, name = false, taken: readonly string[] = []): Set<string> => {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const id = item.id;
      if (typeof id !== 'string' || !id) c.err(`${at}[${i}].id`, `Every ${what} needs an id`);
      else if (seen.has(id)) c.err(`${at}[${i}].id`, `Two ${what}s are called "${id}"`);
      else if (name && !BENCH_NAME.test(id)) c.err(`${at}[${i}].id`, `"${id}" cannot be written in a condition or a formula: use letters, digits and _, starting with a letter`);
      else if (taken.includes(id)) c.err(`${at}[${i}].id`, `"${id}" already means something in a condition or a formula: choose another name`);
      if (typeof id === 'string') seen.add(id);
    });
    return seen;
  };

  const substances = ids(list(b.substances), `${path}.substances`, 'substance', true, BENCH_CONDITION_NAMES);
  const vessels = ids(list(b.vessels), `${path}.vessels`, 'container');
  const tools = ids(list(b.tools), `${path}.tools`, 'tool');
  const reactions = ids(list(b.reactions), `${path}.reactions`, 'reaction');
  const readouts = ids(list(b.readouts), `${path}.readouts`, 'readout', true, ['time']);
  ids(list(b.watches), `${path}.watches`, 'watch');
  void tools;

  const needVariable = (name: unknown, at: string, what: string) => {
    if (name == null || name === '') return;
    if (typeof name !== 'string' || !c.variables.has(name)) c.err(at, `${what} is kept in the variable "${String(name)}", which is not defined`);
  };
  const amounts = (parts: unknown, at: string, what: string, needSome: boolean) => {
    const items = Array.isArray(parts) ? (parts as BenchAmount[]) : [];
    if (needSome && items.length === 0) c.err(at, `${what} needs at least one substance`);
    items.forEach((p, i) => {
      if (!isObject(p) || typeof p.substance !== 'string' || !substances.has(p.substance)) c.err(`${at}[${i}].substance`, `${what} names "${String((p as BenchAmount | null)?.substance ?? '')}", which is not one of the bench's substances`);
      if (!isObject(p) || !num(p.amount) || p.amount < 0) c.err(`${at}[${i}].amount`, 'An amount is a number, 0 or more');
    });
    return items;
  };

  (b.substances ?? []).forEach((s, i) => {
    const at = `${path}.substances[${i}]`;
    if (s.state != null && !(BENCH_STATES as readonly string[]).includes(s.state)) c.err(`${at}.state`, 'state is liquid, solid or gas');
    if (s.ph != null && (!num(s.ph) || s.ph < 0 || s.ph > 14)) c.err(`${at}.ph`, 'pH is a number from 0 to 14');
    if (s.color != null && !/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s.color).trim())) c.warn(`${at}.color`, 'The colour should be written like #3d9be0');
    if (s.indicator != null && (!Array.isArray(s.indicator) || s.indicator.some((stop) => !isObject(stop) || !num(stop.ph) || typeof stop.color !== 'string'))) {
      c.err(`${at}.indicator`, 'An indicator is a list of colours, each with the pH it has that colour at');
    }
  });

  (b.vessels ?? []).forEach((v, i) => {
    const at = `${path}.vessels[${i}]`;
    if (v.shape != null && !(v.shape in BENCH_SHAPES)) c.err(`${at}.shape`, `"${String(v.shape)}" is not a kind of container`);
    if (!num(v.x) || !num(v.y)) c.err(at, 'A container needs a place (x and y)');
    else if (c.size && (v.x < 0 || v.y < 0 || v.x > c.size.width || v.y > c.size.height)) c.warn(at, 'This container is outside the scene');
    if (v.capacity != null && (!num(v.capacity) || v.capacity <= 0)) c.err(`${at}.capacity`, 'A container holds more than 0 mL');
    if (v.pour != null && (!num(v.pour) || v.pour <= 0)) c.err(`${at}.pour`, 'What one tip pours is more than 0 mL');
    const contents = amounts(v.contents, `${at}.contents`, 'A container', false);
    const held = contents.reduce((sum, p) => sum + (num(p?.amount) ? p.amount : 0), 0);
    if (num(v.capacity ?? 1) && held > vesselCapacity(v) + 1e-9) c.warn(`${at}.contents`, `This container starts with ${held} mL in it but holds only ${vesselCapacity(v)} mL: the rest runs over at once`);
    if (v.supply && contents.length === 0) c.warn(`${at}.contents`, 'A stock bottle with nothing in it has nothing to pour');
    if (v.supply && v.fixed) c.warn(at, 'A stock bottle that stays where it is can never be poured from');
    for (const p of contents) if (isObject(p) && stateOf(b.substances?.find((s) => s.id === p.substance)) === 'gas') c.warn(`${at}.contents`, `"${p.substance}" is a gas: it will not stay in an open container`);
  });

  (b.tools ?? []).forEach((t, i) => {
    const at = `${path}.tools[${i}]`;
    if (!(t.kind in BENCH_TOOLS)) c.err(`${at}.kind`, `"${String(t.kind)}" is not a kind of tool`);
    if (!num(t.x) || !num(t.y)) c.err(at, 'A tool needs a place (x and y)');
    if (t.kind === 'burner') {
      if (!t.vessel_id) c.warn(`${at}.vessel_id`, 'This burner heats nothing: choose the container that stands on it');
      else if (!vessels.has(t.vessel_id)) c.err(`${at}.vessel_id`, `This burner heats "${t.vessel_id}", which is not one of the bench's containers`);
      if (t.power != null && (!num(t.power) || t.power <= 0)) c.err(`${at}.power`, 'How fast a burner heats is more than 0');
    }
  });

  const made = new Set<string>();
  for (const v of b.vessels ?? []) for (const p of v.contents ?? []) if (isObject(p)) made.add(String(p.substance));
  for (const r of b.reactions ?? []) for (const p of r.makes ?? []) if (isObject(p)) made.add(String(p.substance));

  (b.reactions ?? []).forEach((r, i) => {
    const at = `${path}.reactions[${i}]`;
    const uses = amounts(r.uses, `${at}.uses`, 'A reaction', true);
    amounts(r.makes, `${at}.makes`, 'A reaction', false);
    for (const p of uses) if (isObject(p) && substances.has(p.substance) && !made.has(p.substance)) c.warn(`${at}.uses`, `This reaction needs "${p.substance}", but no container starts with any and no reaction makes it: it can never happen`);
    if (r.effect != null && !(r.effect in BENCH_EFFECTS)) c.err(`${at}.effect`, `"${String(r.effect)}" is not something a reaction can look like`);
    if (r.rate != null && (!num(r.rate) || r.rate < 0)) c.err(`${at}.rate`, 'How fast a reaction goes is 0 or more');
    if (r.heat != null && !num(r.heat)) c.err(`${at}.heat`, 'The heat of a reaction is a number');
    const when = typeof r.when === 'string' ? r.when.trim() : '';
    if (when) {
      const parts = when.split(/[;,]/).filter((p) => p.trim() !== '');
      const read = parseWhen(when);
      if (read.length !== parts.length || read.some((cond) => /^[<>=!]/.test(String(cond.operand)))) c.err(`${at}.when`, 'A condition could not be read. Write them like "temperature >= 60; stirred = 1"');
      for (const cond of read) {
        if (!(BENCH_CONDITION_NAMES as readonly string[]).includes(cond.variable) && !substances.has(cond.variable)) {
          c.err(`${at}.when`, `A condition reads "${cond.variable}", which is neither a substance nor one of ${BENCH_CONDITION_NAMES.join(', ')}`);
        }
      }
    }
  });

  (b.readouts ?? []).forEach((r, i) => {
    const at = `${path}.readouts[${i}]`;
    const measure = BENCH_MEASURES[r.measure];
    if (!measure) return c.err(`${at}.measure`, `"${String(r.measure)}" is not something the bench measures`);
    if (measure.vessel) {
      if (!r.vessel_id) c.err(`${at}.vessel_id`, 'Choose the container this is measured in');
      else if (!vessels.has(r.vessel_id)) c.err(`${at}.vessel_id`, `"${r.vessel_id}" is not one of the bench's containers`);
    }
    if (r.measure === 'amount' && !r.substance) c.err(`${at}.substance`, 'Choose the substance this measures');
    if (r.substance && !substances.has(r.substance)) c.err(`${at}.substance`, `"${r.substance}" is not one of the bench's substances`);
    if (r.measure === 'formula') {
      const formula = (r.formula ?? '').trim();
      if (!formula) c.err(`${at}.formula`, 'This readout is worked out from others, but has no formula');
      else {
        const problem = formulaGlance(formula);
        if (problem) c.err(`${at}.formula`, `The formula cannot be read: ${problem}`);
        for (const name of formulaNames(formula)) {
          if (name === r.id) c.err(`${at}.formula`, 'A formula cannot read its own readout');
          else if (name !== 'time' && !readouts.has(name)) c.warn(`${at}.formula`, `The formula reads "${name}", which is not one of the bench's readouts`);
        }
      }
    }
    needVariable(r.variable, `${at}.variable`, 'This readout');
  });

  (b.watches ?? []).forEach((w, i) => {
    const at = `${path}.watches[${i}]`;
    if (!(w.when in BENCH_WATCHES)) return c.err(`${at}.when`, `"${String(w.when)}" is not something a watch can notice`);
    if (w.vessel_id && !vessels.has(w.vessel_id)) c.err(`${at}.vessel_id`, `"${w.vessel_id}" is not one of the bench's containers`);
    if (w.reaction_id && !reactions.has(w.reaction_id)) c.err(`${at}.reaction_id`, `"${w.reaction_id}" is not one of the bench's reactions`);
    if (w.when === 'reading') {
      if (!w.readout_id || !readouts.has(w.readout_id)) c.err(`${at}.readout_id`, 'Choose the readout this watches');
      if (!num(w.value)) c.err(`${at}.value`, 'Give the value the reading has to pass');
    }
    if (w.when === 'contains' && (!w.substance || !substances.has(w.substance))) c.err(`${at}.substance`, 'Choose the substance this watches for');
    if (w.variable == null && w.event_id == null) c.warn(at, 'This watch sets no variable and runs no event: nothing will come of it');
    needVariable(w.variable, `${at}.variable`, 'What this watch notices');
    if (w.event_id != null && !c.indirect(w.event_id)) c.err(`${at}.event_id`, `Event ${w.event_id} is not an indirect event of this scene`);
  });

  if (b.graph != null) {
    const at = `${path}.graph`;
    if (!isObject(b.graph)) c.err(at, 'The graph must be an object');
    else {
      for (const axis of ['x', 'y'] as const) {
        const id = b.graph[axis];
        if (!id || (id !== 'time' && !readouts.has(id))) c.err(`${at}.${axis}`, `The graph's ${axis} axis needs one of the bench's readouts${axis === 'x' ? ' (or time)' : ''}`);
      }
      needVariable(b.graph.variable, `${at}.variable`, 'The graph');
    }
  }
  if (b.enabled && (b.vessels ?? []).length === 0) c.warn(path, 'The bench has no containers yet');
}

/** The publish check of a `bench` action, against the bench of the scene it is in. */
export function checkBenchAction(a: Record<string, unknown>, path: string, bench: SceneBench | null | undefined, c: Pick<BenchCheck, 'err' | 'warn'>): void {
  const op = a.op;
  if (!BENCH_OPS.some(([key]) => key === op)) return c.err(`${path}.op`, `"${String(op)}" is not something a bench action does`);
  if (!bench) return c.warn(path, 'This scene has no close-up bench, so this action does nothing');
  const vessels = new Set((bench.vessels ?? []).map((v) => v.id));
  const needVessel = () => {
    if (typeof a.vessel_id !== 'string' || !vessels.has(a.vessel_id)) c.err(`${path}.vessel_id`, 'Choose one of the bench’s containers');
  };
  if (op === 'add') {
    needVessel();
    if (typeof a.substance !== 'string' || !(bench.substances ?? []).some((s) => s.id === a.substance)) c.err(`${path}.substance`, 'Choose one of the bench’s substances');
    if (!num(a.amount) || a.amount <= 0) c.err(`${path}.amount`, 'Give how much to add (more than 0)');
  } else if (op === 'empty' || op === 'stir') needVessel();
  else if (op === 'burner') {
    if (typeof a.tool_id !== 'string' || !(bench.tools ?? []).some((t) => t.id === a.tool_id && t.kind === 'burner')) c.err(`${path}.tool_id`, 'Choose one of the bench’s burners');
  }
}
