import { isReserved, renameVariable as renamedIn } from '@qbl/shared';
import type { Row, Table } from './api';
import { toast } from './dom';
import type { Store } from './store';

/** Every table whose rows may name a variable. */
const TABLES: Table[] = ['scenes', 'events', 'actions', 'conditions', 'labels', 'items', 'characters', 'shop_items'];
/** Columns of the scenario that are the server's own. */
const SCENARIO_OWN = new Set(['id', 'code', 'shortname', 'user_id', 'created_at', 'updated_at', 'published_at']);

/** Why a variable cannot have this name, or null when it can. */
export function variableNameProblem(store: Store, name: string, self?: number): string | null {
  if (!name) return 'A variable needs a name.';
  if (isReserved(name)) return `“${name}” starts with QBL or QL_, which are kept for the system's own variables.`;
  if (store.rows('variables').some((v) => v.id !== self && v.variable_name === name)) return `Another variable is already called “${name}”.`;
  return null;
}

/**
 * Give a variable a new name, and change everything in the scenario that names it (conditions,
 * Variable actions, `{{name}}` in text, an infobox's rich blocks, bench readings) to the new one.
 * Returns how many rows (and the scenario's settings) changed besides the variable, or null when
 * the name was refused; the reason is shown.
 */
export async function renameVariable(store: Store, variable: Row, value: unknown): Promise<number | null> {
  const from = String(variable.variable_name ?? '');
  const to = String(value ?? '').trim();
  if (to === from) {
    // Only spaces around it were added: show the name as it was.
    store.emit(true);
    return 0;
  }
  const problem = variableNameProblem(store, to, variable.id);
  if (problem) {
    toast(problem, 'error');
    store.emit(true);
    return null;
  }

  // The variable first: the API checks that what a condition or an action names exists.
  const patches: Array<Promise<unknown>> = [store.patch('variables', variable.id, { variable_name: to })];
  let changed = 0;
  if (from) {
    for (const table of TABLES) {
      for (const row of store.rows(table) ?? []) {
        // The whole row, so a column is read as what it is (a condition's `variable`, a Variable action's params).
        const now = renamedIn(row, from, to);
        const attrs: Record<string, unknown> = {};
        for (const [key, before] of Object.entries(row)) if (key !== 'id' && now[key] !== before) attrs[key] = now[key];
        if (Object.keys(attrs).length) {
          changed++;
          patches.push(store.patch(table, row.id, attrs));
        }
      }
    }
    const scenario: Record<string, unknown> = {};
    const now = renamedIn(store.scenario, from, to);
    for (const [key, before] of Object.entries(store.scenario)) if (!SCENARIO_OWN.has(key) && now[key] !== before) scenario[key] = now[key];
    if (Object.keys(scenario).length) {
      changed++;
      patches.push(store.patchScenario(scenario));
    }
  }
  // Every row has its new values here already (they are sent in turn): draw the pages again once.
  store.emit(true);
  await Promise.all(patches);
  if (changed) toast(`Renamed to “${to}”. ${changed} ${changed === 1 ? 'thing that uses it was' : 'things that use it were'} changed to match.`);
  return changed;
}
