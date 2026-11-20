import { confirmDelete, h } from '../dom';
import { form, withValue, type FormContext } from '../fields';
import { emojiIcon } from '../icons';
import { closePanel, openPanel } from '../panel';
import { MOVE_FIELDS } from '../schema';
import { inlineConditions, type ConditionValue } from './conditions';
import { chip, conditionChip, emptyState, listPage, section, tileActions } from './kit';

interface MoveRow { animation: string; label?: string; icon?: string; conditions?: ConditionValue[] | null }

const read = (ctx: FormContext) => (ctx.store.settings.moves as MoveRow[] | undefined) ?? [];
const write = (ctx: FormContext, list: MoveRow[], structural: boolean) => void ctx.store.patchSettings({ moves: list.length ? list : null }, structural);

/**
 * What players can do from buttons on their screen: jump, crouch, dance. Kept in the scenario's
 * settings. Each move is a card drawn like its button; it opens in a pop-up panel to change it.
 */
export function movesPage(ctx: FormContext): HTMLElement {
  const list = read(ctx);
  const add = () => {
    const animation = ['jump', 'crouch', 'dance', 'wave', 'spin'].find((n) => !list.some((m) => m.animation === n)) ?? 'jump';
    write(ctx, [...read(ctx), { animation }], true);
    openMove(ctx, read(ctx).length - 1);
  };
  const newButton = () => h('button', { type: 'button', class: 'primary', onclick: add }, 'New move');
  const remove = (index: number) => () => confirmDelete('this move') && write(ctx, read(ctx).filter((_, i) => i !== index), true);

  const cards = list.map((move, index) => h('div', { class: 'card tile move-card', 'data-move': move.animation, style: '--tone: var(--tone-move)' },
    h('button', { type: 'button', class: 'move-button-preview', title: 'Edit this move', onclick: () => openMove(ctx, index) },
      h('span', { class: 'move-icon' }, emojiIcon(move.icon || '✨')),
      h('span', { class: 'move-label' }, move.label || move.animation || 'Move')),
    h('div', { class: 'chips' },
      chip(h('code', null, move.animation || '?'), { tone: 'var(--tone-move)', icon: '🎬', title: 'The animation it plays' }),
      conditionChip(move.conditions, 'When', '🔒', { text: 'Everyone, any time', kind: 'muted' })),
    tileActions(() => openMove(ctx, index), 'Edit', remove(index))));

  return listPage(
    {
      title: 'Moves', count: list.length, actions: [newButton()],
      about: 'What players can do whenever they like, from buttons on their screen: jump, crouch, dance. A move with a condition appears once the condition holds, so an event can teach one by setting one of the player’s own variables. Moves bought in the marketplace are added to these and follow the player into every scenario. To play an animation at a point in the story instead, use the “Play an animation” action.',
    },
    cards.length ? h('div', { class: 'grid tiles small-tiles' }, ...cards) : emptyState('🤸', 'No moves: players walk, and that is all.', newButton()),
  );
}

/** One move in a pop-up. Moves have no id of their own, so the panel follows the move's place in the list. */
export function openMove(ctx: FormContext, index: number) {
  const at = () => read(ctx)[index];
  const replace = (move: MoveRow, structural = false) => write(ctx, read(ctx).map((m, i) => (i === index ? move : m)), structural);
  openPanel({
    key: `move-${index}`,
    kind: 'move',
    store: ctx.store,
    size: 'medium',
    tone: 'var(--tone-move)',
    title: () => (at() ? h('span', null, at()!.label || at()!.animation || 'Move', h('code', { class: 'title-code' }, at()!.animation)) : null),
    body: () => {
      const move = at();
      if (!move) return null;
      return h('div', { class: 'panel-column' },
        section('🤸 The button', 'var(--tone-move)', 'move',
          form(MOVE_FIELDS, move as unknown as Record<string, unknown>, (key, value, field) => replace(withValue({ ...at()! }, key, value, field) as unknown as MoveRow, key === 'animation' || key === 'icon'), ctx)),
        section('🔒 Who can do it', 'var(--warn)', 'conditions',
          inlineConditions(ctx, () => at()?.conditions ?? undefined, (list, structural) => replace(withValue({ ...at()! }, 'conditions', list.length ? list : null) as unknown as MoveRow, structural), 'Offered only when', 'Every player can do this, any time.')),
        h('div', { class: 'row-actions' }, h('button', {
          type: 'button', class: 'danger',
          onclick: () => {
            if (!confirmDelete('this move')) return;
            closePanel(`move-${index}`);
            write(ctx, read(ctx).filter((_, i) => i !== index), true);
          },
        }, 'Delete move')));
    },
  });
}
