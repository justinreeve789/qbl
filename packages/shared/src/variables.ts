import type { Condition, VarValue, Variable, VariableOperator, VariableScope } from './types.js';

/** Names a scenario's own variables may not start with: they belong to the system. */
export const RESERVED_PREFIXES = ['QBL', 'QL_'] as const;

/**
 * The system variables authors use in dialogue, infoboxes, conditions and other actions, shown
 * as `{{QL_PlayerName}}`. The game keeps their values; a variable action cannot change them.
 * The editor offers them in this order, with these explanations.
 */
export const SYSTEM_VARIABLES = [
  { name: 'QL_HotspotCoordinates', about: 'While a hotspot’s event is running: where the hotspot is, as "x,y".' },
  { name: 'QL_ScenarioLanguage', about: 'The scenario’s language as a two-letter code, such as "en".' },
  { name: 'QL_TimeElapsed', about: 'How many seconds the player has spent in this scenario.' },
  { name: 'QL_VideoPlaying', about: '1 while the scene’s video is playing, 0 otherwise.' },
  { name: 'QL_VideoTimeIndex', about: 'How many seconds into the scene’s video it is.' },
  { name: 'QL_PlayerName', about: 'The player’s name.' },
  { name: 'QL_TeacherName', about: 'The name of the player’s teacher in this game, if they have one; empty otherwise.' },
  { name: 'QL_HasTeacher', about: '1 if the player has a teacher in this game (it was assigned to their class), 0 otherwise.' },
  { name: 'QL_IsTeacher', about: '1 if the player is a teacher (or an administrator), 0 for students.' },
  { name: 'QL_PhysicsEnabled', about: '1 if the current scene is a physics experiment, 0 otherwise.' },
  { name: 'QL_PlayerStars', about: 'How many stars the player has.' },
  { name: 'QL_PlayerXP', about: 'The player’s experience points (XP).' },
  { name: 'QL_PlayerRank', about: 'The name of the player’s rank.' },
  { name: 'QL_PlayerCount', about: 'How many players are playing together (the player’s team, when there are teams).' },
  { name: 'QL_SceneId', about: 'The id of the scene the player is in.' },
  { name: 'QL_Holding', about: 'The id of the thing the player is using from their bag (while they use it), 0 otherwise.' },
  { name: 'QL_NextMission', about: 'The title of the mission the player’s teacher has just launched for them, until they go to it; empty otherwise. A departure scene plays only when it is not empty.' },
] as const;
export type SystemVariable = (typeof SYSTEM_VARIABLES)[number]['name'];

/** Reserved variables. Values are supplied by the runtime through providers. */
export const RESERVED_VARIABLES = SYSTEM_VARIABLES.map((v) => v.name);
/** The variable a hotspot or a character's event tests to take something from the player's bag. */
export const HOLDING = 'QL_Holding';
/** `QL_Ability_<key>` is 1 while the player has a marketplace ability with that key equipped, else 0. */
export const ABILITY_PREFIX = 'QL_Ability_';
export type ReservedVariable = SystemVariable;

/**
 * Names the system's variables had before they were called QL_…. Scenarios saved with them still
 * play (the game reads them as the new names); the publish check asks for the new name.
 */
export const LEGACY_VARIABLES: Readonly<Record<string, SystemVariable>> = {
  QBLPlayerName: 'QL_PlayerName',
  QBLPlayerCount: 'QL_PlayerCount',
  QBLStars: 'QL_PlayerStars',
  QBLXp: 'QL_PlayerXP',
  QBLRank: 'QL_PlayerRank',
  QBLSceneId: 'QL_SceneId',
  QBLHolding: 'QL_Holding',
};
const LEGACY_ABILITY_PREFIX = 'QBLAbility_';

/** A variable's current name: an old system name (`QBLStars`, `QBLAbility_<key>`) as it is called now. */
export function currentName(name: string): string {
  if (name.startsWith(LEGACY_ABILITY_PREFIX)) return ABILITY_PREFIX + name.slice(LEGACY_ABILITY_PREFIX.length);
  return LEGACY_VARIABLES[name] ?? name;
}

export function isReserved(name: string): boolean {
  return RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix));
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
  if (operator === 'random') {
    // A whole number from 0 up to and including the operand. With no usable operand (older scenarios
    // that narrow the result with "%" afterwards) it is 1 to RANDOM_MAX as before.
    const top = toNumber(operand);
    if (top === null) return Math.floor(random() * RANDOM_MAX) + 1;
    return Math.floor(random() * (Math.max(0, Math.floor(top)) + 1));
  }

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

/**
 * Whether `a` divides by `b` with no remainder. False when `b` is 0. A tiny tolerance lets
 * decimals that should divide (0.3 by 0.1) do so.
 */
export function isMultiple(a: number, b: number): boolean {
  if (b === 0) return false;
  const r = Math.abs(a % b);
  const eps = 1e-9 * Math.max(1, Math.abs(b));
  return r < eps || Math.abs(b) - r < eps;
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
    case '%': return bothNumeric && isMultiple(a, b);
    case '!%': return bothNumeric && b !== 0 && !isMultiple(a, b);
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

  get = (asked: string): VarValue | undefined => {
    const name = currentName(asked);
    const provider = this.providers.get(name);
    if (provider) return provider();
    // An ability nobody sells here is simply one the player does not have.
    if (name.startsWith(ABILITY_PREFIX)) return 0;
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
