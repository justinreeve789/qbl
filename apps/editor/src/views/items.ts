import type { Row } from '../api';
import { mediaUrl, params } from '../describe';
import { h } from '../dom';
import { form, withValue, type Field, type FormContext } from '../fields';
import { openPanel } from '../panel';
import { ITEM_FIELDS, ITEM_SETTINGS_FIELDS } from '../schema';
import { rowConditions } from './conditions';
import { chip, emptyState, listPage, pick, removeRow, section, thumbButton, tileActions, tileTitle } from './kit';

/**
 * The Items page: things players can pick up, wear or ride. Each is a card saying what kind of
 * thing it is; everything about one opens in a pop-up panel.
 */
export function itemsPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const add = async () => {
    const row = await store.add('items', { name: 'New item' });
    if (row) openItem(ctx, row.id);
  };
  const newButton = () => h('button', { type: 'button', class: 'primary', onclick: () => void add() }, 'New item');
  const cards = store.rows('items').map((row) => itemCard(ctx, row));
  return listPage(
    { title: 'Items', count: cards.length, about: 'Things players can pick up, wear or ride. Define them here, then place them in scenes. Click an item to change it.', actions: [newButton()] },
    cards.length ? h('div', { class: 'grid tiles' }, ...cards) : emptyState('🎒', 'No items yet. An item can be picked up, worn, or ridden like a vehicle.', newButton()),
  );
}

/** What an item is, as a word and an icon, and the colour that goes with it. */
function kindOf(row: Row): { label: string; icon: string; tone: string } {
  if (row.vehicle) return { label: 'Vehicle', icon: '🚙', tone: 'var(--tone-vehicle)' };
  if (row.wearable) return { label: 'Wearable', icon: '👕', tone: 'var(--tone-character)' };
  return { label: 'Item', icon: '🎒', tone: 'var(--tone-item)' };
}

function itemCard(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const name = String(row.name || 'Unnamed item');
  const kind = kindOf(row);
  const settings = params(row, 'settings');
  const conditions = store.where('conditions', 'item_id', id).length;
  const open = () => openItem(ctx, id);
  return h('div', { class: 'card tile', 'data-thing': `items-${id}`, style: `--tone: ${kind.tone}` },
    thumbButton(mediaUrl(store, store.byId('media', row.media_id as number | null)), name, open),
    tileTitle(name, id),
    h('div', { class: 'chips' },
      chip(kind.label, { tone: kind.tone, icon: kind.icon }),
      row.unique ? chip('Unique', { icon: '☝️', title: 'Only one player can hold it' }) : null,
      row.physical ? chip('In the scene', { icon: '📍', title: 'It sits in the scene' }) : null,
      row.blocking ? chip('Blocking', { icon: '🧱', title: 'Avatars walk around it' }) : null,
      settings.scale != null ? chip(`× ${settings.scale}`, { title: 'Image scale' }) : null,
      conditions ? chip(`${conditions} condition${conditions === 1 ? '' : 's'}`, { kind: 'cond', icon: '🔒', title: 'Only present while its conditions hold' }) : null),
    tileActions(open, 'Edit item', removeRow(ctx, 'items', row, `the item “${name}”`)));
}

/** The item's settings, in groups; a group shows only when it applies (the worn or ridden offsets for something worn or ridden). */
const IN_SCENE = pick(ITEM_SETTINGS_FIELDS, ['scale', 'placement']).map((f) => (f.key === 'placement' ? { ...f, wide: true } : f));
const BLOCKING = pick(ITEM_SETTINGS_FIELDS, ['blocking_radius']);
const CARRIED = pick(ITEM_SETTINGS_FIELDS, ['attach_offset_x', 'attach_offset_y', 'attach_layer', 'art_faces', 'hide_rider_below'], { attach_offset_x: 'Offset X', attach_offset_y: 'Offset Y' });
const VEHICLE = pick(ITEM_SETTINGS_FIELDS, ['speed_multiplier'], { speed_multiplier: 'Speed multiplier' });
/** Ticking these shows or hides a group of settings. */
const SHAPING = new Set(['wearable', 'vehicle', 'blocking', 'media_id']);

export function openItem(ctx: FormContext, id: number) {
  const { store } = ctx;
  openPanel({
    key: `item-${id}`,
    kind: 'item',
    store,
    tone: (() => { const row = store.byId('items', id); return row ? kindOf(row).tone : 'var(--tone-item)'; })(),
    title: () => {
      const row = store.byId('items', id);
      return row ? h('span', null, String(row.name || 'Unnamed item'), h('small', { class: 'muted' }, ` #${id}`)) : null;
    },
    body: () => {
      const row = store.byId('items', id);
      return row ? itemBody(ctx, row) : null;
    },
  });
}

function itemBody(ctx: FormContext, row: Row): HTMLElement {
  const { store } = ctx;
  const id = row.id;
  const kind = kindOf(row);
  const url = mediaUrl(store, store.byId('media', row.media_id as number | null));
  const settingsForm = (fields: Field[]) => form(fields, params(row, 'settings'), (key, value, field) =>
    void store.patch('items', id, { settings: withValue(params(store.byId('items', id)!, 'settings'), key, value, field) }, field.structural === true), ctx);

  const about = section(`${kind.icon} Item`, kind.tone, 'item',
    url ? h('img', { class: 'preview large checker', src: url, alt: '' }) : h('div', { class: 'preview none' }, 'No picture yet: choose an image below.'),
    form(ITEM_FIELDS, row, (key, value) => void store.patch('items', id, { [key]: value }, SHAPING.has(key)), ctx),
    h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', onclick: removeRow(ctx, 'items', row, `the item “${row.name}”`) }, 'Delete item')));

  const behaviour = h('div', { class: 'panel-column' },
    section('📍 In the scene', 'var(--tone-background)', 'scene', settingsForm(row.blocking ? [...IN_SCENE, ...BLOCKING] : IN_SCENE)),
    row.wearable || row.vehicle ? section(row.vehicle && !row.wearable ? '🧍 Ridden' : row.wearable && !row.vehicle ? '🧍 Worn' : '🧍 Worn or ridden', 'var(--tone-character)', 'carried', settingsForm(CARRIED)) : null,
    row.vehicle ? section('🚙 Vehicle', 'var(--tone-vehicle)', 'vehicle', settingsForm(VEHICLE)) : null,
    section('🔒 When it is there', 'var(--warn)', 'conditions', rowConditions(ctx, 'item_id', id, 'Present only when', 'Always present.')));

  return h('div', { class: 'two-panel' }, about, behaviour);
}
