import type { Row } from '../api';
import { h } from '../dom';
import { parseValue, select, type FormContext } from '../fields';
import { OPERATORS } from '../schema';

export interface ConditionValue {
  variable?: unknown;
  operator?: unknown;
  operand?: unknown;
}

interface ConditionSource {
  list: ConditionValue[];
  add(): void;
  change(index: number, attrs: ConditionValue): void;
  remove(index: number): void;
}

/**
 * A list of "variable operator value" rows. All of them must hold. The same control edits
 * conditions kept as database rows (events, actions, items, characters) and conditions kept
 * inline in JSON (infobox buttons, objectives): see the two adapters below.
 */
export function conditionList(source: ConditionSource, ctx: FormContext, title = 'Conditions', empty = 'Always.'): HTMLElement {
  const names = ctx.store.rows('variables').map((v) => String(v.variable_name));
  const rows = source.list.map((c, i) => {
    const current = String(c.variable ?? '');
    const options = names.map((n) => [n, n] as const).concat(current && !names.includes(current) ? [[current, `${current} (not defined)`]] : []);
    const operand = h('input', { type: 'text', value: c.operand ?? '', 'aria-label': 'Value', onchange: () => source.change(i, { operand: parseValue(operand.value) }) });
    return h(
      'div',
      { class: 'condition' },
      select(options, current, (v) => source.change(i, { variable: v }), 'Variable…'),
      select(OPERATORS, String(c.operator ?? '='), (v) => source.change(i, { operator: v })),
      operand,
      h('button', { type: 'button', class: 'icon', title: 'Remove condition', onclick: () => source.remove(i) }, '×'),
    );
  });
  return h(
    'div',
    { class: 'conditions' },
    h('div', { class: 'sub-head' }, h('span', null, title), h('button', { type: 'button', class: 'link', onclick: () => source.add() }, '+ Add condition')),
    rows.length ? h('div', null, ...rows) : h('p', { class: 'muted' }, empty),
  );
}

type Owner = 'event_id' | 'action_id' | 'item_id' | 'character_id';

/** Conditions stored as rows of the conditions table, owned by an event, action, item or character. */
export function rowConditions(ctx: FormContext, owner: Owner, ownerId: number, title?: string, empty?: string): HTMLElement {
  const { store } = ctx;
  const rows: Row[] = store.where('conditions', owner, ownerId);
  const firstVariable = store.rows('variables')[0]?.variable_name ?? 'variable';
  return conditionList(
    {
      list: rows as ConditionValue[],
      add: () => void store.add('conditions', { [owner]: ownerId, variable: firstVariable, operator: '=', operand: 1 }),
      change: (i, attrs) => void store.patch('conditions', rows[i]!.id, attrs),
      remove: (i) => void store.remove('conditions', rows[i]!.id),
    },
    ctx,
    title,
    empty,
  );
}

/**
 * Conditions stored inline in a JSON value. `read` returns the list as it is now (the form may have
 * been drawn before the last change); `write` receives the whole new list.
 */
export function inlineConditions(
  ctx: FormContext,
  read: () => ConditionValue[] | undefined,
  write: (list: ConditionValue[], structural: boolean) => void,
  title?: string,
  empty?: string,
): HTMLElement {
  const now = () => read() ?? [];
  const firstVariable = ctx.store.rows('variables')[0]?.variable_name ?? 'variable';
  return conditionList(
    {
      list: now(),
      add: () => write([...now(), { variable: firstVariable, operator: '=', operand: 1 }], true),
      change: (i, attrs) => write(now().map((c, j) => (j === i ? { ...c, ...attrs } : c)), false),
      remove: (i) => write(now().filter((_, j) => j !== i), true),
    },
    ctx,
    title,
    empty,
  );
}
