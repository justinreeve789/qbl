import type { Row } from '../api';
import { mediaUrl, params } from '../describe';
import { h } from '../dom';
import { form, withValue, type Field, type FormContext } from '../fields';
import { openPanel } from '../panel';
import { SHOP_ABILITY, SHOP_ANIMATION, SHOP_ITEM_FIELDS, SHOP_MOVE, SHOP_SLOT, SHOP_WEARABLE_FIELDS } from '../schema';
import { chip, emptyState, listPage, removeRow, section, thumbButton, tileActions, tileTitle } from './kit';

/** Each kind of thing for sale: what it is called on a card, its icon, and the heading of its own settings. */
const KINDS: Record<string, { label: string; icon: string; settings: string }> = {
  wearable: { label: 'To wear', icon: '👕', settings: '👕 How it is worn' },
  pet: { label: 'Pet', icon: '🐾', settings: '🐾 How the pet follows' },
  animation: { label: 'Way of standing', icon: '🕺', settings: '🕺 The movement' },
  move: { label: 'Move', icon: '💃', settings: '💃 The move' },
  ability: { label: 'Ability', icon: '✨', settings: '✨ The ability' },
};
const SLOTS: Record<string, string> = Object.fromEntries((SHOP_SLOT.options ?? []).map(([v, l]) => [v, l]));

/** Mission-specific things for sale. The platform's own catalogue is sold alongside in every scenario. */
export function shopPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const add = async () => {
    const row = await store.add('shop_items', { name: 'New item', kind: 'wearable', slot: 'head', price: 10 });
    if (row) openShopItem(ctx, row.id);
  };
  const newButton = () => h('button', { type: 'button', class: 'primary', onclick: () => void add() }, 'New item');
  const cards = store.rows('shop_items').map((row) => shopCard(ctx, row));
  return listPage(
    {
      title: 'Shop', count: cards.length, actions: [newButton()],
      about: 'Things only this scenario sells: a mission badge, a tool for this planet, a pet found here. Players buy them with stars in the marketplace, which also sells the platform’s items everywhere. Add an “Open the marketplace” action to a hotspot to let players in; they can also open it from their stars at any time.',
    },
    cards.length ? h('div', { class: 'grid tiles' }, ...cards) : emptyState('🛍️', 'This scenario sells nothing of its own. Players still see the platform’s items.', newButton()),
  );
}

function shopCard(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const name = String(row.name || 'Unnamed item');
  const kind = KINDS[String(row.kind)] ?? { label: String(row.kind), icon: '🛍️', settings: '' };
  const onSale = row.active !== false && row.active !== 0;
  const open = () => openShopItem(ctx, id);
  return h('div', { class: `card tile${onSale ? '' : ' off'}`, 'data-shop': id, style: '--tone: var(--tone-shop)' },
    thumbButton(mediaUrl(store, store.byId('media', row.media_id as number | null)), name, open),
    tileTitle(name, null, h('span', { class: 'price' }, `⭐ ${row.price ?? 0}`)),
    row.description ? h('p', { class: 'tile-text' }, String(row.description)) : null,
    h('div', { class: 'chips' },
      chip(kind.label, { tone: 'var(--tone-shop)', icon: kind.icon }),
      row.kind === 'wearable' && row.slot ? chip(`On the ${SLOTS[String(row.slot)]?.toLowerCase() ?? row.slot}`) : null,
      onSale ? null : chip('Off sale', { kind: 'warn', icon: '⏸️', title: 'Players who bought it keep it' })),
    tileActions(open, 'Edit', removeRow(ctx, 'shop_items', row, `“${name}”. Players who bought it will lose it, and their stars are not returned`)));
}

export function openShopItem(ctx: FormContext, id: number) {
  const { store } = ctx;
  openPanel({
    key: `shop-${id}`,
    kind: 'shop',
    store,
    tone: 'var(--tone-shop)',
    title: () => {
      const row = store.byId('shop_items', id);
      return row ? h('span', null, String(row.name || 'Unnamed item'), h('small', { class: 'muted' }, ` ⭐ ${row.price ?? 0}`)) : null;
    },
    body: () => {
      const row = store.byId('shop_items', id);
      return row ? shopBody(ctx, row) : null;
    },
  });
}

function shopBody(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const kind = String(row.kind);
  const url = mediaUrl(store, store.byId('media', row.media_id as number | null));
  const column = (key: string, value: unknown, field: Field) => void store.patch('shop_items', id, { [key]: value }, key === 'media_id' || field.structural === true);
  const settings = (key: string, value: unknown, field: Field) => void store.patch('shop_items', id, { settings: withValue(params(store.byId('shop_items', id)!, 'settings'), key, value, field) });
  const own = params(row, 'settings');

  const forSale = section('🛍️ For sale', 'var(--tone-shop)', 'details',
    url ? h('img', { class: 'preview large checker', src: url, alt: '' }) : h('div', { class: 'preview none' }, 'No picture yet: choose one below.'),
    form(SHOP_ITEM_FIELDS, row, column, ctx),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', onclick: removeRow(ctx, 'shop_items', row, `“${row.name}”. Players who bought it will lose it, and their stars are not returned`) }, 'Delete')));

  const kindFields =
    kind === 'wearable' ? [form([SHOP_SLOT], row, column, ctx), form(SHOP_WEARABLE_FIELDS, own, settings, ctx)]
    : kind === 'pet' ? [form(SHOP_WEARABLE_FIELDS, own, settings, ctx)]
    : kind === 'animation' ? [form([SHOP_ANIMATION], own, settings, ctx)]
    : kind === 'ability' ? [form([SHOP_ABILITY], own, settings, ctx)]
    : kind === 'move' ? [form([SHOP_MOVE], own, settings, ctx)]
    : [];
  const kindInfo = KINDS[kind];
  const behaviour = section(kindInfo?.settings ?? '⚙️ Settings', 'var(--tone-move)', 'kind', ...(kindFields.length ? kindFields : [h('p', { class: 'muted' }, 'Choose what kind of thing it is.')]));

  return h('div', { class: 'two-panel' }, forSale, h('div', { class: 'panel-column' }, behaviour));
}
