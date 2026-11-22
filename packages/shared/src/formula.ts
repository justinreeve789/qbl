/**
 * [ext] Formulas, worked out with math.js: what a `calc` block of an infobox shows, the curves of
 * a `graph` block, an answer checked against what it should be (units and all), and the readouts
 * of a close-up bench that are worked out from others.
 *
 * This is its own entry (`@qbl/shared/formula`), not part of the package's index: math.js is
 * large, so only what works a formula out loads it, and only when it has one to work out.
 *
 * Formulas are written by authors, and answers are typed by players, so the parts of math.js
 * that could reach outside a formula (importing, defining units, evaluating text) are switched
 * off, as its documentation advises for expressions that are not trusted.
 */
import { all, create, type EvalFunction, type MathNode } from 'mathjs';

const math = create(all!, {});
const parse = math.parse.bind(math);
const refuse = (name: string) => () => {
  throw new Error(`${name} is not available in a formula`);
};
math.import(
  {
    import: refuse('import'), createUnit: refuse('createUnit'), reviver: refuse('reviver'), evaluate: refuse('evaluate'), parse: refuse('parse'),
    simplify: refuse('simplify'), derivative: refuse('derivative'), resolve: refuse('resolve'),
  },
  { override: true },
);

/** The longest formula read. Longer ones are refused: nothing an author writes by hand is longer. */
export const FORMULA_MAX = 500;

/** Reads a name's value: a game variable, a control of the box, a reading. Undefined when there is none. */
export type Lookup = (name: string) => unknown;

/** A formula read once, to be worked out many times. */
export interface Formula {
  /** The names it reads that are not functions or constants of math.js (variables, units). */
  names: string[];
  /** Its value with these names, or null when it has none (a name is missing, a division went wrong). */
  value(get?: Lookup): unknown;
  /** Its value as a number: of a quantity with a unit, the number in `unit` (or as it was written). */
  number(get?: Lookup, unit?: string): number | null;
}

interface Compiled {
  code: EvalFunction;
  names: string[];
}

const cache = new Map<string, Compiled | string>();

function compile(source: string): Compiled | string {
  const src = source.trim();
  if (!src) return 'The formula is empty';
  if (src.length > FORMULA_MAX) return `The formula is longer than ${FORMULA_MAX} characters`;
  const known = cache.get(src);
  if (known) return known;
  let made: Compiled | string;
  try {
    const node: MathNode = parse(src);
    const names = new Set<string>();
    node.traverse((n) => {
      const s = n as unknown as { isSymbolNode?: boolean; name?: string };
      if (s.isSymbolNode && s.name) names.add(s.name);
    });
    made = { code: node.compile(), names: [...names] };
  } catch (e) {
    made = e instanceof Error ? e.message : 'The formula could not be read';
  }
  if (cache.size > 500) cache.clear();
  cache.set(src, made);
  return made;
}

/** A value from the game as math.js takes it: text that reads as a number is one, true and false are 1 and 0. */
function asMath(value: unknown): unknown {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const t = value.trim();
    // A variable nothing has been put in yet counts as 0, as it does in a condition.
    if (t === '') return 0;
    return Number.isFinite(Number(t)) ? Number(t) : t;
  }
  return undefined;
}

function scopeOf(names: string[], get?: Lookup): Map<string, unknown> {
  const scope = new Map<string, unknown>();
  if (!get) return scope;
  for (const name of names) {
    const v = asMath(get(name));
    if (v !== undefined) scope.set(name, v);
  }
  return scope;
}

type UnitLike = { toNumber(unit?: string): number; formatUnits(): string; equalBase(other: unknown): boolean; toJSON(): { value: number } };
const isUnit = (v: unknown): v is UnitLike => !!v && typeof v === 'object' && (v as { isUnit?: boolean }).isUnit === true;

function toNumber(value: unknown, unit?: string): number | null {
  let n: unknown = value;
  if (isUnit(value)) {
    try {
      n = unit ? value.toNumber(unit) : value.toNumber(value.formatUnits());
    } catch {
      try {
        n = value.toJSON().value;
      } catch {
        return null;
      }
    }
  } else if (typeof value === 'boolean') n = value ? 1 : 0;
  else if (value && typeof value === 'object' && typeof (value as { toNumber?: unknown }).toNumber === 'function') n = (value as { toNumber(): number }).toNumber();
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/** Why a formula cannot be read, or null when it can. For the editor, as the author types. */
export function formulaProblem(source: string): string | null {
  const c = compile(source);
  return typeof c === 'string' ? c : null;
}

/** A formula ready to be worked out, or null when it cannot be read. */
export function formula(source: string): Formula | null {
  const c = compile(source);
  if (typeof c === 'string') return null;
  const value = (get?: Lookup) => {
    try {
      return c.code.evaluate(scopeOf(c.names, get));
    } catch {
      return null;
    }
  };
  return { names: c.names, value, number: (get, unit) => toNumber(value(get), unit) };
}

/** A formula's value as a number, or null. */
export function evaluateNumber(source: string, get?: Lookup, unit?: string): number | null {
  return formula(source)?.number(get, unit) ?? null;
}

/**
 * A formula as a function of one name (`x` unless told otherwise), for a curve: its other names
 * are read with `get` each time, so the curve follows sliders as they move. Gives NaN where the
 * formula has no value.
 */
export function formulaFunction(source: string, get?: Lookup, variable = 'x'): ((x: number) => number) | null {
  const c = compile(source);
  if (typeof c === 'string') return null;
  const others = c.names.filter((n) => n !== variable);
  return (x: number) => {
    try {
      const scope = scopeOf(others, get);
      scope.set(variable, x);
      const n = toNumber(c.code.evaluate(scope));
      return n == null ? NaN : n;
    } catch {
      return NaN;
    }
  };
}

/** A number as it is shown: to so many decimal places at most, without trailing zeros. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return '–';
  const d = Math.max(0, Math.min(10, Math.floor(digits)));
  const text = value.toFixed(d);
  return d > 0 ? text.replace(/\.?0+$/, '') : text;
}

/** How close an answer has to be: "5%" of what is expected, or a plain amount. Nothing: equal but for rounding. */
function within(diff: number, expected: number, tolerance: string | number | null | undefined): boolean {
  const t = typeof tolerance === 'number' ? String(tolerance) : (tolerance ?? '').trim();
  if (t.endsWith('%')) {
    const pct = Number(t.slice(0, -1));
    return Number.isFinite(pct) && diff <= (Math.abs(expected) * Math.abs(pct)) / 100 + 1e-12;
  }
  const abs = Number(t);
  if (t !== '' && Number.isFinite(abs)) return diff <= Math.abs(abs) + 1e-12;
  return diff <= Math.abs(expected) * 1e-9 + 1e-12;
}

const plain = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Whether what a player typed is the answer. `accept` is what it should be: a number, a quantity
 * with a unit ("9.8 m/s^2"), a formula (it may read variables with `get`), or words. Several
 * answers may be accepted, separated by `|`.
 *
 * A quantity is right in any unit of the same kind: 980 cm/s^2 is 9.8 m/s^2. Where a unit is
 * expected, a bare number is wrong, and so is a number with a unit where none is expected.
 * `tolerance` says how close a number has to be: "5%" or a plain amount.
 */
export function checkAnswer(typed: string, accept: string, tolerance?: string | number | null, get?: Lookup): boolean {
  const answer = typed.trim().slice(0, 200);
  if (answer === '') return false;
  return accept.split('|').some((one) => checkOne(answer, one.trim(), tolerance, get));
}

function checkOne(answer: string, accept: string, tolerance: string | number | null | undefined, get?: Lookup): boolean {
  if (accept === '') return false;
  if (plain(answer) === plain(accept)) return true;
  const expected = formula(accept)?.value(get);
  // What is typed is worked out with no variables: a player cannot type a variable's name for its value.
  const given = formula(answer.replace(/,/g, '.'))?.value();
  if (expected == null || given == null) return false;
  if (isUnit(expected)) {
    if (!isUnit(given) || !expected.equalBase(given)) return false;
    try {
      const unit = expected.formatUnits();
      const e = expected.toNumber(unit);
      const g = given.toNumber(unit);
      return Number.isFinite(e) && Number.isFinite(g) && within(Math.abs(g - e), e, tolerance);
    } catch {
      return false;
    }
  }
  if (isUnit(given)) return false;
  const e = toNumber(expected);
  const g = toNumber(given);
  if (e == null || g == null) return typeof expected === 'string' && typeof given === 'string' && plain(expected) === plain(given);
  return within(Math.abs(g - e), e, tolerance);
}
