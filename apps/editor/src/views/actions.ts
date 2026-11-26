import { emojiIcon } from '../icons';
import type { ActionType } from '@qbl/shared';
import type { Row } from '../api';
import { actionSummary, actionValues, params } from '../describe';
import { confirmDelete, h, help, openOneAtATime, rememberOpen, toast } from '../dom';
import { actionRows, hold, holding, onClipboard, pasteActions, pasted } from '../clipboard';
import type { Store } from '../store';
import { form, select, tidyAnimate, withValue, type Field, type FormContext, type Values } from '../fields';
import { actionPicker } from '../actionPicker';
import { ACTION_COMMON, ACTION_LOOK, ACTION_TYPES, ACTIONS, actionDefaults, starterConversation, tidyWalk } from '../schema';
import { inlineConditions, rowConditions, type ConditionValue } from './conditions';
import { conversationMap } from './conversation';

/** The action card that is open (at most one). Kept outside the view so a redraw does not close it. */
const open = new Set<number>();

/** The action being dragged to a new place in its event, if any. */
let dragging: number | null = null;

/** The actions ticked, to copy, cut or delete together. Only those of the event shown count. */
const picked = new Set<number>();
/** The last action ticked or unticked, for Shift+click to tick the ones between. */
let lastPicked: number | null = null;

const oneOrMore = (n: number) => (n === 1 ? 'the action' : `${n} actions`);

/** The actions of this event that are ticked, in the order they run. */
export function pickedActions(store: Store, eventId: number): number[] {
  return store.where('actions', 'event_id', eventId)
    .sort((a, b) => Number(a.sequence) - Number(b.sequence) || a.id - b.id)
    .filter((a) => picked.has(a.id))
    .map((a) => a.id);
}

/** Untick every action. */
export function unpickActions() {
  picked.clear();
  lastPicked = null;
}

/** Put actions on the clipboard; to cut them, delete them too (one step for Ctrl+Z). */
export async function copyActions(store: Store, eventId: number, ids: number[], cut: boolean): Promise<boolean> {
  if (!ids.length) return false;
  hold(store.scenarioId, { kind: 'actions', eventId, rows: actionRows(store, ids) }, oneOrMore(ids.length), cut);
  unpickActions();
  if (cut) {
    await Promise.all(ids.map((id) => store.remove('actions', id)));
    toast(`Cut ${oneOrMore(ids.length)}. Open another event and press Ctrl+V to paste ${ids.length === 1 ? 'it' : 'them'} there.`);
  } else {
    toast(`Copied ${oneOrMore(ids.length)}. Open an event and press Ctrl+V to paste.`);
    store.emit(false);
  }
  return true;
}

/** Paste the actions on the clipboard at the end of this event. False when it holds none. */
export async function pasteActionsInto(store: Store, eventId: number): Promise<boolean> {
  const held = holding(store.scenarioId);
  if (held?.clip.kind !== 'actions') return false;
  const ids = await pasteActions(store, held.clip.rows, eventId, held.cut);
  if (!ids) return true;
  pasted();
  unpickActions();
  for (const id of ids) picked.add(id);
  if (ids.length === 1) rememberOpen(open, ids[0]!);
  store.emit();
  toast(`Pasted ${oneOrMore(ids.length)} at the end of this event${ids.length > 1 ? ' (still ticked, to move or copy them on)' : ''}.`);
  return true;
}

/** Delete actions (one step for Ctrl+Z). */
export async function deleteActions(store: Store, ids: number[]): Promise<boolean> {
  if (!ids.length) return false;
  unpickActions();
  await Promise.all(ids.map((id) => store.remove('actions', id)));
  toast(`Deleted ${oneOrMore(ids.length)}.`, 'info', { label: 'Undo', run: () => void store.undo() });
  return true;
}

/** Columns of the actions table; every other attribute of an action lives in `params`. */
const COLUMNS = new Set(['media_id', 'blocking']);
/** An animate action's fields that say what is animated: changing one can leave its animation behind. */
const ANIMATE_SUBJECT = new Set(['target', 'character_id', 'item_id']);

/** Yes/no attributes that are shown as a choice between two named states. */
function choice(type: string, values: Record<string, unknown>): Record<string, string> {
  if (type === 'avatar') return { visible: String(values.visible !== false) };
  if (type === 'freeze') return { frozen: String(values.frozen !== false) };
  return {};
}

/** Actions that cannot be one of a button's or a choice's: a conversation is edited as a row of its own. */
const nestedTypes = ACTION_TYPES.filter((t) => t !== 'conversation');

/**
 * What a choice in a conversation can do. Not repeat (it belongs to an event), not an award
 * (awards are granted for an event's own actions: have the choice run an event that gives it).
 */
const choiceTypes = nestedTypes.filter((t) => t !== 'repeat' && t !== 'award');

/**
 * Starting values for a new action. A new conversation is spoken by the first character placed in
 * this scene, or else the first of the scenario's.
 */
function startingParams(ctx: FormContext, type: ActionType): Record<string, unknown> {
  if (type !== 'conversation') return actionDefaults(type);
  const scene = ctx.sceneId != null ? ctx.store.byId('scenes', ctx.sceneId) : undefined;
  const placed = scene ? ((params(scene, 'layout').characters as Array<{ character_id?: number }> | undefined) ?? [])[0]?.character_id : undefined;
  return starterConversation(placed ?? ctx.store.rows('characters')[0]?.id ?? null);
}

/** Have this action's card open the next time its event is drawn. */
export function revealAction(id: number) {
  rememberOpen(open, id);
}

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
  // Ticks belong to the event shown.
  for (const id of [...picked]) if (!actions.some((a) => a.id === id)) picked.delete(id);

  /** What can be done with the ticked actions, and Paste when the clipboard holds actions. */
  const bar = h('div', { class: 'action-bar', 'aria-live': 'polite' });
  const pickAll = h('input', { type: 'checkbox', class: 'pick-all', 'aria-label': 'Tick every action', title: 'Tick every action (to copy, cut or delete them together)' });
  const checks = new Map<number, HTMLInputElement>();
  const drawBar = () => {
    const ids = pickedActions(store, eventId);
    pickAll.checked = ids.length > 0 && ids.length === actions.length;
    pickAll.indeterminate = ids.length > 0 && ids.length < actions.length;
    for (const [id, box] of checks) {
      box.checked = picked.has(id);
      box.closest('.card')?.classList.toggle('picked', box.checked);
    }
    const held = holding(store.scenarioId);
    const clip = held?.clip.kind === 'actions' ? held.clip : null;
    const count = clip?.rows.actions?.length ?? 0;
    bar.replaceChildren(...[
      ids.length ? h('span', { class: 'muted' }, `${ids.length} ticked`) : null,
      ids.length ? h('button', { type: 'button', 'data-act': 'copy', title: 'Copy the ticked actions (Ctrl+C)', onclick: () => void copyActions(store, eventId, ids, false) }, 'Copy') : null,
      ids.length ? h('button', { type: 'button', 'data-act': 'cut', title: 'Cut the ticked actions, to paste them in another event (Ctrl+X)', onclick: () => void copyActions(store, eventId, ids, true) }, 'Cut') : null,
      ids.length ? h('button', { type: 'button', class: 'danger', 'data-act': 'delete', title: 'Delete the ticked actions (Delete)', onclick: () => void deleteActions(store, ids) }, 'Delete') : null,
      clip ? h('button', { type: 'button', 'data-act': 'paste', title: 'Paste at the end of this event (Ctrl+V)', onclick: () => void pasteActionsInto(store, eventId) }, `📋 Paste ${count === 1 ? '1 action' : `${count} actions`}`) : null,
    ].filter((n): n is HTMLElement => n !== null));
    bar.hidden = !bar.childElementCount;
  };
  pickAll.addEventListener('change', () => {
    if (pickAll.checked) for (const a of actions) picked.add(a.id);
    else unpickActions();
    drawBar();
  });
  const stopListening = onClipboard(() => (bar.isConnected ? drawBar() : stopListening()));

  const add = actionPicker(ACTION_TYPES, '', async (type) => {
    add.value = '';
    if (!type) return;
    const sequence = actions.reduce((max, a) => Math.max(max, Number(a.sequence)), 0) + 1;
    const row = await store.add('actions', { event_id: eventId, type, sequence, blocking: true, params: startingParams(ctx, type as ActionType) });
    if (row) {
      rememberOpen(open, row.id);
      store.emit();
    }
  }, { empty: '+ Add action…', about: true, add: true });
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
      else {
        let next = withValue(params(current()), key, value, field);
        if (type === 'walk' && key === 'to') next = tidyWalk(next);
        if (type === 'animate' && ANIMATE_SUBJECT.has(key)) next = tidyAnimate(next, ctx);
        void store.patch('actions', id, { params: next }, field.structural === true);
      }
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
          actionPicker(ACTION_TYPES, type, (next) => void store.patch('actions', id, { type: next, media_id: null, params: startingParams(ctx, next as ActionType) }, true)),
        ),
      ),
      form(def.fields, { ...actionValues(action), ...choice(type, params(action)) }, commit, ctx),
      type === 'conversation' ? conversationMap(ctx, id) : null,
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
        h('button', {
          type: 'button',
          onclick: async () => {
            const copy = await store.add('actions', { event_id: eventId, type, sequence: actions.length + 1, blocking: action.blocking, media_id: action.media_id, params: params(current()) });
            if (copy) rememberOpen(open, copy.id);
            store.emit();
          },
        }, 'Duplicate'),
        h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete('this action') && void store.remove('actions', id) }, 'Delete'),
      ),
    );

    // The grip is what is dragged; the card follows it. Dropping on another card puts this action
    // before or after it, whichever half of that card the pointer is over.
    const grip = h('span', { class: 'grip', draggable: 'true', title: 'Drag to change the order', 'aria-hidden': 'true' }, '⠿');
    // A tick, to copy, cut or delete several actions together. Shift+click ticks the ones between.
    const check = h('input', { type: 'checkbox', class: 'pick', checked: picked.has(id), 'aria-label': `Tick action ${index + 1}`, title: 'Tick to copy, cut or delete together (Shift+click: the ones between too)' });
    checks.set(id, check);
    check.addEventListener('click', (e) => {
      // A tick in the heading would also open and close the card.
      e.stopPropagation();
      const on = check.checked;
      const from = lastPicked != null ? actions.findIndex((a) => a.id === lastPicked) : -1;
      const span = e.shiftKey && from >= 0 ? actions.slice(Math.min(from, index), Math.max(from, index) + 1) : [action];
      for (const a of span) on ? picked.add(a.id) : picked.delete(a.id);
      lastPicked = id;
      drawBar();
    });
    const card = h('details', { class: `card action${picked.has(id) ? ' picked' : ''}`, 'data-action': id, open: open.has(id), style: `--tone:${ACTION_LOOK[type][1]}` }, h('summary', null, grip, check, h('span', { class: 'step' }, index + 1), h('span', { class: 'tag' }, emojiIcon(ACTION_LOOK[type][0]), ` ${def.label}`), summary), body);
    openOneAtATime(card, id, open);
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

  drawBar();
  return h(
    'section',
    { class: 'actions' },
    h('div', { class: 'sub-head' }, h('span', { class: 'inline' }, actions.length > 1 ? pickAll : null, 'Run in this order'), add),
    bar,
    cards.length ? h('div', null, ...cards) : h('p', { class: 'muted' }, 'This event does nothing yet. Add an action.'),
  );
}

// ------------------------------------------------------------ infobox buttons

interface Cta {
  text?: string;
  action?: Values & { type?: string };
  conditions?: ConditionValue[];
  mark?: 'right' | 'wrong' | 'try_again';
}

/** How a button can show the answer it gives. */
const MARKS = [['right', '✓ Right answer'], ['wrong', '✗ Wrong answer'], ['try_again', '↻ Wrong: try again']] as const;

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
      let action = withValue(at(index).action ?? {}, key, value, field);
      if (type === 'walk' && key === 'to') action = tidyWalk(action);
      if (type === 'animate' && ANIMATE_SUBJECT.has(key)) action = tidyAnimate(action, ctx);
      replace(index, { ...at(index), action: { ...action, type } }, key === 'media_id' || field.structural === true);
    };

    return h(
      'div',
      { class: 'cta' },
      h(
        'div',
        { class: 'cta-head' },
        label,
        actionPicker(nestedTypes, type ?? '', (next) => {
          const action = next ? { type: next, ...actionDefaults(next as ActionType) } : undefined;
          replace(index, withValue({ ...at(index) }, 'action', action) as Cta, true);
        }, { empty: 'Just close the box' }),
        h('button', { type: 'button', class: 'icon', title: 'Remove button', onclick: () => write(read().filter((_, i) => i !== index), true) }, '×'),
      ),
      h('label', { class: 'field cta-mark', 'data-field': 'mark' },
        h('span', { class: 'field-label' }, 'Shows as', help('A right answer turns green with a tick and a burst of stars, a wrong one red with a shake, before the box closes and the action runs. “Try again” shakes, crosses the button out and leaves the box open to choose again; its action, if any (a sound, a variable), runs while the box stays open.')),
        select(MARKS, cta.mark ?? '', (mark) => replace(index, withValue({ ...at(index) }, 'mark', mark || null) as Cta, true), 'Just a button')),
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

// ------------------------------------------------------- actions of a choice

/**
 * A list of actions kept inside another action's JSON (what a conversation's choice does). Each
 * has a type and that type's fields; they run in order. `read` returns the list as it is now.
 */
export function inlineActions(
  ctx: FormContext,
  read: () => Values[],
  write: (list: Values[], structural: boolean) => void,
  title = 'Also do',
  empty = 'Nothing else.',
): HTMLElement {
  const at = (index: number): Values => read()[index] ?? {};
  const replace = (index: number, action: Values, structural = false) => write(read().map((a, i) => (i === index ? action : a)), structural);

  const rows = read().map((action, index) => {
    const type = action.type as ActionType;
    const def = ACTIONS[type];
    const commit = (key: string, value: unknown, field: Field) => {
      if ((type === 'avatar' && key === 'visible') || (type === 'freeze' && key === 'frozen')) value = value === 'true';
      let next = withValue(at(index), key, value, field);
      if (type === 'walk' && key === 'to') next = tidyWalk(next);
      // A new subject has its own animations: keep the one chosen only if it has it.
      if (type === 'animate' && ANIMATE_SUBJECT.has(key)) next = tidyAnimate(next, ctx);
      replace(index, { ...next, type }, key === 'media_id' || field.structural === true);
    };
    return h(
      'div',
      { class: 'cta inline-action', 'data-inline-action': index, style: def ? `--tone:${ACTION_LOOK[type][1]}` : null },
      h(
        'div',
        { class: 'cta-head' },
        actionPicker(choiceTypes, type, (next) => next && replace(index, { type: next, ...actionDefaults(next as ActionType) }, true)),
        h('button', { type: 'button', class: 'icon', title: 'Remove', 'aria-label': 'Remove this action', onclick: () => write(read().filter((_, i) => i !== index), true) }, '×'),
      ),
      def ? form(def.fields, { ...action, ...choice(type, action) }, commit, ctx) : null,
      type === 'infobox'
        ? buttonsEditor(
            ctx,
            () => (at(index).call_to_actions as Cta[] | undefined) ?? [],
            (inner, structural) => replace(index, { ...withValue(at(index), 'call_to_actions', inner.length ? inner : null), type }, structural),
          )
        : null,
    );
  });

  const add = actionPicker(choiceTypes, '', (type) => {
    add.value = '';
    if (type) write([...read(), { type, ...actionDefaults(type as ActionType) }], true);
  }, { empty: '+ Add an action…', about: true, add: true });
  add.classList.add('add-action');

  return h(
    'div',
    { class: 'ctas wide inline-actions' },
    h('div', { class: 'sub-head' }, h('span', null, title, help('Done in order when the player picks this, before the next line: set a variable, add a glossary word, play a sound, walk somewhere, run an event. A jump ends the conversation. To give stars or XP, run an event that has an award in it.')), add),
    rows.length ? h('div', null, ...rows) : h('p', { class: 'muted' }, empty),
  );
}
