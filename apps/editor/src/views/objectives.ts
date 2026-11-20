import { confirmDelete, h } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { closePanel, openPanel } from '../panel';
import { OBJECTIVE_FIELDS } from '../schema';
import { inlineConditions, type ConditionValue } from './conditions';
import { chip, conditionChip, deleteIcon, emptyState, listPage, section } from './kit';

interface Objective {
  id: string | number;
  text?: string;
  optional?: boolean;
  show_when?: ConditionValue[];
  complete_when?: ConditionValue[];
}

const read = (ctx: FormContext) => (ctx.store.settings.objectives as Objective[] | undefined) ?? [];
const write = (ctx: FormContext, list: Objective[], structural: boolean) => void ctx.store.patchSettings({ objectives: list }, structural);

/**
 * The mission checklist players see, kept in the scenario's settings, in order. The page lists
 * it as players will see it, numbered, with when each line shows and when it is ticked off;
 * an objective opens in a pop-up panel to change it.
 */
export function objectivesPage(ctx: FormContext): HTMLElement {
  const list = read(ctx);
  const add = () => {
    const ids = new Set(list.map((o) => String(o.id)));
    let n = list.length + 1;
    while (ids.has(`objective-${n}`)) n++;
    const id = `objective-${n}`;
    write(ctx, [...read(ctx), { id, text: 'New objective', complete_when: [] }], true);
    openObjective(ctx, id);
  };
  const move = (index: number, by: number) => {
    const next = [...read(ctx)];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    write(ctx, next, true);
  };
  const newButton = () => h('button', { type: 'button', class: 'primary', onclick: add }, 'New objective');

  const rows = list.map((objective, index) => {
    const open = () => openObjective(ctx, objective.id);
    return h('li', { class: `card objective-row${objective.optional ? ' bonus' : ''}`, 'data-objective': String(objective.id) },
      h('span', { class: 'objective-number', 'aria-hidden': 'true' }, String(index + 1)),
      h('div', { class: 'objective-main' },
        h('button', { type: 'button', class: 'objective-text', title: 'Edit this objective', onclick: open }, ...withVariables(objective.text || 'No text yet')),
        h('div', { class: 'chips' },
          objective.optional ? chip('Bonus', { tone: 'var(--tone-shop)', icon: '⭐', title: 'Not needed to finish the mission' }) : null,
          conditionChip(objective.show_when, 'Listed when', '👁️'),
          conditionChip(objective.complete_when, 'Ticked off when', '✅', { text: 'Never ticked off: give it a condition', kind: 'warn' }))),
      h('div', { class: 'row-actions objective-buttons' },
        h('button', { type: 'button', class: 'icon', disabled: index === 0, title: 'Move earlier', 'aria-label': 'Move earlier', onclick: () => move(index, -1) }, '↑'),
        h('button', { type: 'button', class: 'icon', disabled: index === list.length - 1, title: 'Move later', 'aria-label': 'Move later', onclick: () => move(index, 1) }, '↓'),
        h('button', { type: 'button', class: 'primary', 'data-open': 'edit', onclick: open }, '✏️ Edit'),
        deleteIcon(() => confirmDelete('this objective') && write(ctx, read(ctx).filter((o) => o.id !== objective.id), true))));
  });

  return listPage(
    { title: 'Objectives', count: list.length, actions: [newButton()], about: 'The checklist players see during the mission, in this order. Each line is ticked off by variables, so events move the mission along simply by changing them. Click an objective to change it.' },
    rows.length ? h('ol', { class: 'objective-list' }, ...rows) : emptyState('🎯', 'No objectives: players see no checklist.', newButton()),
  );
}

/** Text with each {{variable}} shown as a small code label, as players will see a number there. */
export function withVariables(text: string): Array<Node | string> {
  return text.split(/(\{\{[^}]+\}\})/).filter(Boolean).map((part) => (/^\{\{[^}]+\}\}$/.test(part) ? h('code', { class: 'var-ref' }, part.slice(2, -2)) : part));
}

/** One objective in a pop-up: its text and whether it is a bonus, then when it is listed and when it is ticked off. */
export function openObjective(ctx: FormContext, id: string | number) {
  const indexOf = () => read(ctx).findIndex((o) => o.id === id);
  const at = () => read(ctx)[indexOf()];
  const replace = (objective: Objective, structural = false) => write(ctx, read(ctx).map((o) => (o.id === id ? objective : o)), structural);
  openPanel({
    key: `objective-${id}`,
    kind: 'objective',
    store: ctx.store,
    size: 'medium',
    tone: 'var(--ok)',
    title: () => (at() ? h('span', null, `Objective ${indexOf() + 1}`, h('small', { class: 'muted' }, at()!.optional ? ' · bonus' : '')) : null),
    body: () => {
      const objective = at();
      if (!objective) return null;
      return h('div', { class: 'panel-column' },
        section('🎯 What players see', 'var(--ok)', 'objective',
          form(OBJECTIVE_FIELDS, objective as unknown as Record<string, unknown>, (key, value, field) => replace(withValue({ ...at()! }, key, value, field) as unknown as Objective, key === 'optional'), ctx)),
        section('🚦 When', 'var(--warn)', 'conditions',
          h('div', { class: 'condition-pair' },
            inlineConditions(ctx, () => at()?.show_when, (list, structural) => replace(withValue({ ...at()! }, 'show_when', list.length ? list : null) as unknown as Objective, structural), 'Listed only when', 'Always listed.'),
            inlineConditions(ctx, () => at()?.complete_when, (list, structural) => replace({ ...at()!, complete_when: list }, structural), 'Ticked off when', 'Add a condition, or it is never ticked off.'))),
        h('div', { class: 'row-actions' }, h('button', {
          type: 'button', class: 'danger',
          onclick: () => {
            if (!confirmDelete('this objective')) return;
            closePanel(`objective-${id}`);
            write(ctx, read(ctx).filter((o) => o.id !== id), true);
          },
        }, 'Delete objective')));
    },
  });
}
