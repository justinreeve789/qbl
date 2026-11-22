import type { Combination, Condition, GameEvent, Id, Item, Scenario, VarValue } from './types.js';
import { currentName, HOLDING, testConditions } from './variables.js';

/**
 * The player's bag, as in a point-and-click adventure: the things they carry (`Item.carried_when`),
 * which they pick to use on something in the scene or put together with another thing they carry
 * (`Scenario.combinations`). Using a thing works through the reserved variable `QL_Holding`: while
 * the player has picked a thing, it holds that thing's id, and a hotspot (or a character's event)
 * that tests it takes the thing. Everything else about it is ordinary events and variables.
 */

type Get = (name: string) => VarValue | undefined;

/** Whether the player carries this item now. */
export function isCarried(item: Item, get: Get): boolean {
  return Array.isArray(item.carried_when) && item.carried_when.length > 0 && testConditions(item.carried_when, get);
}

/** What the player carries now, in the order the scenario lists the items. */
export function carriedItems(scenario: Pick<Scenario, 'items'>, get: Get): Item[] {
  return (scenario.items ?? []).filter((item) => isCarried(item, get));
}

function mentions(conditions: Condition[] | undefined): boolean {
  return (conditions ?? []).some((c) => currentName(c.variable) === HOLDING);
}

/**
 * Whether an event takes things from the bag: its conditions, or those of one of its own actions,
 * test `QL_Holding`, or (with `find`) an event it runs does. Clicked with a thing picked, only such
 * events run; anything else under the pointer says the thing does not work there.
 */
export function takesItems(event: Pick<GameEvent, 'conditions' | 'actions'>, find?: (id: Id) => Pick<GameEvent, 'conditions' | 'actions'> | undefined, depth = 2): boolean {
  if (mentions(event.conditions) || (event.actions ?? []).some((a) => mentions(a.conditions))) return true;
  if (!find || depth <= 0) return false;
  return (event.actions ?? []).some((a) => {
    if (a.type !== 'run_event') return false;
    const target = a.target_event_id ?? a.event_id;
    const next = target != null ? find(target) : undefined;
    return next != null && takesItems(next, find, depth - 1);
  });
}

/** The combination of two carried things that applies now, if any (in either order). */
export function combinationFor(scenario: Pick<Scenario, 'combinations'>, a: Id, b: Id, get: Get): Combination | null {
  for (const c of scenario.combinations ?? []) {
    const [x, y] = c.items ?? [];
    const pair = (String(x) === String(a) && String(y) === String(b)) || (String(x) === String(b) && String(y) === String(a));
    if (pair && testConditions(c.conditions, get)) return c;
  }
  return null;
}
