import { emojiIcon } from '../icons';
import type { ActionType } from '@qbl/shared';
import type { Row } from '../api';
import { actionSummary, actionValues, params } from '../describe';
import { confirmDelete, h, help } from '../dom';
import { form, select, withValue, type Field, type FormContext, type Values } from '../fields';
import { ACTION_COMMON, ACTION_LOOK, ACTION_TYPES, ACTIONS, actionDefaults } from '../schema';
import { inlineConditions, rowConditions, type ConditionValue } from './conditions';

/** Which action cards are open. Kept outside the view so a redraw does not close them. */
const open = new Set<number>();

/** The action being dragged to a new place in its event, if any. */
let dragging: number | null = null;

/** Columns of the actions table; every other attribute of an action lives in `params`. */
const COLUMNS = new Set(['media_id', 'blocking']);

/** Yes/no attributes that are shown as a choice between two named states. */
function choice(type: string, values: Record<string, unknown>): Record<string, string> {
  if (type === 'avatar') return { visible: String(values.visible !== false) };
  if (type === 'freeze') return { frozen: String(values.frozen !== false) };
  return {};
}

const typeOptions = ACTION_TYPES.map((t) => [t, `${ACTION_LOOK[t][0]} ${ACTIONS[t].label}`] as const);

export function sortedActions(ctx: FormContext, eventId: number): Row[] {
  return ctx.store.where('actions', 'event_id', eventId).sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id);
}

/**
 * The actions of one event, in the order they run. `refresh` collects functions that bring the
 * one-line summaries up to date after a value changes without the form being rebuilt.
 */
export function actionList(ctx: FormContext, eventId: number, refresh: Array<() => void>): HTMLElement {
  const { store } = ctx;
  const actions = sortedActions(ctx, eventId);

  const add = select(ACTION_TYPES.map((t) => [t, `${ACTION_LOOK[t][0]} ${ACTIONS[t].label}: ${ACTIONS[t].about}`] as const), '', async (type) => {
    add.value = '';
    if (!type) return;
    const sequence = actions.reduce((max, a) => Math.max(max, Number(a.sequence)), 0) + 1;
    const row = await store.add('actions', { event_id: eventId, type, sequence, blocking: true, params: actionDefaults(type as ActionType) });
    if (row) {
      open.add(row.id);
      store.emit();
    }
  }, '+ Add action…');
  add.classList.add('add-action');

  /** Put the actions in a new order by rewriting their sequence numbers. */
  const reorder = (order: Row[]) => {
    order.forEach((a, i) => {
      if (a.sequence !== i + 1) void store.patch('actions', a.id, { sequence: i + 1 }, true);
    });
  };

  const cards = actions.map((action, index) => {
    const id = action.id;
    const type = action.type as ActionType;
    const def = ACTIONS[type];
    const current = () => store.byId('actions', id)!;

    const summary = h('span', { class: 'summary-text' });
    const describe = () => {
      const row = store.byId('actions', id);
      if (row) summary.textContent = actionSummary(store, row.type as string, actionValues(row));
    };
    describe();
    refresh.push(describe);

    const commit = (key: string, value: unknown, field: Field) => {
      if ((type === 'avatar' && key === 'visible') || (type === 'freeze' && key === 'frozen')) value = value === 'true';
      if (COLUMNS.has(key)) void store.patch('actions', id, { [key]: value }, key === 'media_id');
      else void store.patch('actions', id, { params: withValue(params(current()), key, value, field) }, field.structural === true);
    };

    const move = (by: number) => {
      const order = [...actions];
      const [moved] = order.splice(index, 1);
      order.splice(index + by, 0, moved!);
      reorder(order);
    };

    const body = h(
      'div',
      { class: 'card-body' },
      h(
        'div',
        { class: 'form' },
        h(
          'label',
          { class: 'field wide' },
          h('span', { class: 'field-label' }, 'Type', help(def.about)),
          select(typeOptions, type, (next) => void store.patch('actions', id, { type: next, media_id: null, params: actionDefaults(next as ActionType) }, true)),
        ),
      ),
      form(def.fields, { ...actionValues(action), ...choice(type, params(action)) }, commit, ctx),
      type === 'infobox'
        ? buttonsEditor(
            ctx,
            () => (params(current()).call_to_actions as Cta[] | null | undefined) ?? [],
            (list, structural) => void store.patch('actions', id, { params: withValue(params(current()), 'call_to_actions', list.length ? list : null) }, structural),
          )
        : null,
      form(ACTION_COMMON, actionValues(action), commit, ctx),
      rowConditions(ctx, 'action_id', id, 'Only when', 'Always runs.'),
      h(
        'div',
        { class: 'row-actions' },
        h('span', { class: 'muted' }, `Action #${id}`),
        h('button', { type: 'button', disabled: index === 0, onclick: () => move(-1) }, '↑ Earlier'),
        h('button', { type: 'button', disabled: index === actions.length - 1, onclick: () => move(1) }, '↓ Later'),
        h('button', {
          type: 'button',
          onclick: async () => {
            const copy = await store.add('actions', { event_id: eventId, type, sequence: actions.length + 1, blocking: action.blocking, media_id: action.media_id, params: params(current()) });
            if (copy) open.add(copy.id);
            store.emit();
          },
        }, 'Duplicate'),
        h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete('this action') && void store.remove('actions', id) }, 'Delete'),
      ),
    );

    // The grip is what is dragged; the card follows it. Dropping on another card puts this action
    // before or after it, whichever half of that card the pointer is over.
    const grip = h('span', { class: 'grip', draggable: 'true', title: 'Drag to change the order', 'aria-hidden': 'true' }, '⠿');
    const card = h('details', { class: 'card action', 'data-action': id, open: open.has(id), style: `--tone:${ACTION_LOOK[type][1]}` }, h('summary', null, grip, h('span', { class: 'step' }, index + 1), h('span', { class: 'tag' }, emojiIcon(ACTION_LOOK[type][0]), ` ${def.label}`), summary), body);
    card.addEventListener('toggle', () => (card.open ? open.add(id) : open.delete(id)));
    grip.addEventListener('click', (e) => e.preventDefault());
    grip.addEventListener('dragstart', (e) => {
      dragging = id;
      e.dataTransfer?.setData('text/plain', String(id));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer?.setDragImage(card, 12, 12);
      card.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => {
      dragging = null;
      card.classList.remove('dragging');
      for (const el of card.parentElement?.querySelectorAll('.drop-before, .drop-after') ?? []) el.classList.remove('drop-before', 'drop-after');
    });
    const half = (e: DragEvent) => (e.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2 ? 'before' : 'after');
    card.addEventListener('dragover', (e) => {
      if (dragging == null || dragging === id) return;
      e.preventDefault();
      card.classList.toggle('drop-before', half(e) === 'before');
      card.classList.toggle('drop-after', half(e) === 'after');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drop-before', 'drop-after'));
    card.addEventListener('drop', (e) => {
      if (dragging == null || dragging === id) return;
      e.preventDefault();
      const moved = actions.find((a) => a.id === dragging);
      const order = actions.filter((a) => a.id !== dragging);
      if (moved) order.splice(order.indexOf(action) + (half(e) === 'after' ? 1 : 0), 0, moved);
      dragging = null;
      reorder(order);
    });
    return card;
  });

  return h(
    'section',
    { class: 'actions' },
    h('div', { class: 'sub-head' }, h('span', null, 'Run in this order'), add),
    cards.length ? h('div', null, ...cards) : h('p', { class: 'muted' }, 'This event does nothing yet. Add an action.'),
  );
}

// ------------------------------------------------------------ infobox buttons

interface Cta {
  text?: string;
  action?: Values & { type?: string };
  conditions?: ConditionValue[];
}

/**
 * The buttons of an infobox ("call to actions"). Each has a label, optionally an action to perform
 * when chosen, and optionally conditions for offering it. The action is stored inside the infobox,
 * so it is edited here rather than as a row; an infobox inside a button can have buttons of its own.
 *
 * `read` returns the buttons as they are now, which may be newer than what is drawn.
 */
function buttonsEditor(ctx: FormContext, read: () => Cta[], write: (list: Cta[], structural: boolean) => void): HTMLElement {
  const at = (index: number): Cta => read()[index] ?? {};
  const replace = (index: number, cta: Cta, structural = false) => write(read().map((c, i) => (i === index ? cta : c)), structural);

  const rows = read().map((cta, index) => {
    const type = (cta.action?.type as ActionType | undefined) ?? '';
    const def = type ? ACTIONS[type] : null;
    const label = h('input', { type: 'text', value: cta.text ?? '', placeholder: 'Button text', 'aria-label': 'Button text', onchange: () => replace(index, { ...at(index), text: label.value }) });
    const commit = (key: string, value: unknown, field: Field) => {
      if ((type === 'avatar' && key === 'visible') || (type === 'freeze' && key === 'frozen')) value = value === 'true';
      replace(index, { ...at(index), action: { ...withValue(at(index).action ?? {}, key, value, field), type } }, key === 'media_id' || field.structural === true);
    };

    return h(
      'div',
      { class: 'cta' },
      h(
        'div',
        { class: 'cta-head' },
        label,
        select(typeOptions, type, (next) => {
          const action = next ? { type: next, ...actionDefaults(next as ActionType) } : undefined;
          replace(index, withValue({ ...at(index) }, 'action', action) as Cta, true);
        }, 'Just close the box'),
        h('button', { type: 'button', class: 'icon', title: 'Remove button', onclick: () => write(read().filter((_, i) => i !== index), true) }, '×'),
      ),
      def ? form(def.fields, { ...cta.action, ...choice(type, cta.action ?? {}) }, commit, ctx) : null,
      type === 'infobox'
        ? buttonsEditor(
            ctx,
            () => (at(index).action?.call_to_actions as Cta[] | undefined) ?? [],
            (inner, structural) => replace(index, { ...at(index), action: { ...withValue(at(index).action ?? {}, 'call_to_actions', inner.length ? inner : null), type } }, structural),
          )
        : null,
      inlineConditions(
        ctx,
        () => at(index).conditions,
        (conditions, structural) => replace(index, withValue({ ...at(index) }, 'conditions', conditions.length ? conditions : null) as Cta, structural),
        'Offered only when',
        'Always offered.',
      ),
    );
  });

  return h(
    'div',
    { class: 'ctas wide' },
    h('div', { class: 'sub-head' }, h('span', null, 'Buttons'), h('button', { type: 'button', class: 'link', onclick: () => write([...read(), { text: 'OK' }], true) }, '+ Add button')),
    rows.length ? h('div', null, ...rows) : h('p', { class: 'muted' }, 'No buttons: the box has only a close button.'),
  );
}
