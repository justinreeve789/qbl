import type { Condition, VarValue, Variable, VariableOperator, VariableScope } from './types.js';

export const RESERVED_PREFIX = 'QBL';

/** Reserved variables. Values are supplied by the runtime through providers. */
export const RESERVED_VARIABLES = [
  'QBLHotspotCoordinates',
  'QBLScenarioLanguage',
  'QBLTimeElapsed',
  'QBLVideoPlaying',
  'QBLVideoTimeIndex',
  // [ext]
  'QBLSceneId',
  'QBLPlayerName',
  'QBLPlayerCount',
] as const;
export type ReservedVariable = (typeof RESERVED_VARIABLES)[number];

export function isReserved(name: string): boolean {
  return name.startsWith(RESERVED_PREFIX);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export const RANDOM_MAX = 1_000_000_000;

/**
 * Apply a variable action operator. Arithmetic on non-numeric operands or
 * values is a no-op, as the docs specify. Division/modulo by zero is a no-op.
 */
export function applyOperator(
  current: VarValue | undefined,
  operator: VariableOperator,
  operand: VarValue | undefined,
  random: () => number = Math.random,
): VarValue {
  const fallback: VarValue = current ?? '';
  if (operator === 'set') return operand ?? '';
  if (operator === 'random') return Math.floor(random() * RANDOM_MAX) + 1;

  const a = toNumber(current ?? 0);
  const b = toNumber(operand);
  if (a === null || b === null) return fallback;
  switch (operator) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? fallback : a / b;
    case '%': return b === 0 ? fallback : a % b;
    default: return fallback;
  }
}

/** Evaluate one condition against a value lookup. */
export function testCondition(cond: Condition, get: (name: string) => VarValue | undefined): boolean {
  const value = get(cond.variable);
  const a = toNumber(value);
  const b = toNumber(cond.operand);
  const bothNumeric = a !== null && b !== null;
  const sa = String(value ?? '').toLowerCase();
  const sb = String(cond.operand ?? '').toLowerCase();
  switch (cond.operator) {
    case '=': return bothNumeric ? a === b : sa === sb;
    case '!=': return bothNumeric ? a !== b : sa !== sb;
    case '>': return bothNumeric && a > b;
    case '<': return bothNumeric && a < b;
    case '>=': return bothNumeric && a >= b;
    case '<=': return bothNumeric && a <= b;
    default: return false;
  }
}

/** All conditions must hold. An empty or missing list passes. */
export function testConditions(
  conds: Condition[] | undefined | null,
  get: (name: string) => VarValue | undefined,
): boolean {
  if (!conds || conds.length === 0) return true;
  return conds.every((c) => testCondition(c, get));
}

export type VariableListener = (name: string, value: VarValue, previous: VarValue | undefined) => void;

/**
 * Holds variable values for one player's view of a scenario.
 *
 * Room-scoped variables are owned by the game server: when a `remote` hook is
 * installed, changes to them are forwarded instead of applied, and the server
 * echoes the result back through `setFromRemote`.
 */
export class VariableStore {
  private values = new Map<string, VarValue>();
  private defs = new Map<string, Variable>();
  private providers = new Map<string, () => VarValue>();
  private listeners = new Set<VariableListener>();
  remote: ((name: string, operator: VariableOperator, operand: VarValue | undefined) => void) | null = null;

  constructor(definitions: Variable[] = [], saved: Record<string, VarValue> = {}) {
    for (const def of definitions) {
      if (isReserved(def.variable_name)) continue;
      this.defs.set(def.variable_name, def);
      this.values.set(def.variable_name, def.default_value);
    }
    for (const [name, value] of Object.entries(saved)) {
      const def = this.defs.get(name);
      if (def && def.persist !== false && this.scopeOf(name) === 'player') this.values.set(name, value);
    }
  }

  scopeOf(name: string): VariableScope {
    return this.defs.get(name)?.scope ?? 'player';
  }

  has(name: string): boolean {
    return this.defs.has(name) || this.providers.has(name);
  }

  /** Supply a reserved variable's value. */
  provide(name: string, fn: () => VarValue): void {
    this.providers.set(name, fn);
  }

  get = (name: string): VarValue | undefined => {
    const provider = this.providers.get(name);
    if (provider) return provider();
    return this.values.get(name);
  };

  /** Run a variable action. Unknown and reserved names are ignored. */
  apply(name: string, operator: VariableOperator, operand?: VarValue): void {
    if (!this.defs.has(name)) return;
    if (this.scopeOf(name) === 'room' && this.remote) {
      this.remote(name, operator, operand);
      return;
    }
    this.write(name, applyOperator(this.values.get(name), operator, operand));
  }

  /** Accept a room-scoped value pushed by the server. */
  setFromRemote(name: string, value: VarValue): void {
    if (this.defs.has(name)) this.write(name, value);
  }

  private write(name: string, value: VarValue): void {
    const previous = this.values.get(name);
    if (previous === value) return;
    this.values.set(name, value);
    for (const l of this.listeners) l(name, value, previous);
  }

  onChange(listener: VariableListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Tell listeners that provider-backed values may have changed. */
  touch(name: string): void {
    const v = this.get(name);
    if (v !== undefined) for (const l of this.listeners) l(name, v, v);
  }

  /** Values worth saving: persistent variables of the given scope. */
  snapshot(scope: VariableScope = 'player'): Record<string, VarValue> {
    const out: Record<string, VarValue> = {};
    for (const [name, def] of this.defs) {
      if ((def.scope ?? 'player') !== scope || def.persist === false) continue;
      const v = this.values.get(name);
      if (v !== undefined) out[name] = v;
    }
    return out;
  }
}
