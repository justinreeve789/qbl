import type { Row, Table } from '../api';
import { mediaLabel, mediaUrl, params } from '../describe';
import { confirmDelete, h, toast, help } from '../dom';
import { openPanel } from '../panel';
import { form, select, withValue, type Field, type FormContext } from '../fields';
import {
  MOVE_FIELDS, SHOP_ABILITY, SHOP_ANIMATION, SHOP_MOVE, SHOP_ITEM_FIELDS, SHOP_SLOT, SHOP_WEARABLE_FIELDS, ITEM_FIELDS, ITEM_SETTINGS_FIELDS, MEDIA_FIELDS, OBJECTIVE_FIELDS, VARIABLE_FIELDS,
} from '../schema';
import { inlineConditions, rowConditions, type ConditionValue } from './conditions';
import { sheetEditor } from './sheet';
import { characterMediaIds } from '../characters';
import { emojiIcon } from '../icons';

export { charactersPage } from './characters';

/** The scenario-wide lists: media, variables, items, characters and objectives. */

const page = (title: string, about: string, actions: Array<HTMLElement | null>, body: HTMLElement) =>
  h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('div', null, h('h1', null, title, help(about))), h('div', { class: 'row-actions' }, ...actions)), body);

const none = (text: string) => h('p', { class: 'empty' }, text);

const removeButton = (ctx: FormContext, table: Table, row: Row, what: string) =>
  h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete(what) && void ctx.store.remove(table, row.id) }, 'Delete');

// --------------------------------------------------------------------- media

const MEDIA_TABS = [
  ['all', 'All', '🗂️'], ['background', 'Backgrounds', '🏞️'], ['character', 'NPCs', '🧑‍🚀'],
  ['item', 'Items', '🎒'], ['vehicle', 'Vehicles', '🚙'], ['audio', 'Sounds and music', '🔊'], ['video', 'Video', '🎬'], ['shop', 'Shop items', '🛍️'], ['other', 'Other images', '🖼️'],
] as const;
type MediaTab = (typeof MEDIA_TABS)[number][0];
/** The sub-tab showing. Kept outside the view so a redraw does not reset it. */
let mediaTab: MediaTab = 'all';

/**
 * Which sub-tab a file belongs under. By default this follows how it is used (a scene layer is a
 * background, a character's picture is an NPC, and so on); a file can also be filed by hand,
 * which is what puts a fresh upload under the tab it was uploaded from.
 */
function mediaCategory(ctx: FormContext, media: Row): Exclude<MediaTab, 'all'> {
  const { store } = ctx;
  const chosen = params(media).category as string | undefined;
  if (chosen && MEDIA_TABS.some(([key]) => key === chosen && key !== 'all')) return chosen as Exclude<MediaTab, 'all'>;
  if (media.type === 'audio') return 'audio';
  if (media.type === 'video') return 'video';
  const id = media.id;
  const layers = store.rows('scenes').flatMap((s) => [...((s.background_media as Array<Record<string, unknown>> | null) ?? []), ...((s.foreground_media as Array<Record<string, unknown>> | null) ?? [])]);
  if (layers.some((l) => (l.media_id ?? l.id) === id)) return 'background';
  if (store.rows('characters').some((c) => characterMediaIds(store, c).includes(id))) return 'character';
  const item = store.rows('items').find((i) => i.media_id === id);
  if (item) return item.vehicle ? 'vehicle' : 'item';
  if (store.rows('shop_items').some((i) => i.media_id === id)) return 'shop';
  return 'other';
}

export function mediaPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const file = h('input', { type: 'file', multiple: true, hidden: true, accept: 'image/png,image/jpeg,image/webp,image/gif,audio/*,video/mp4,video/webm' });
  file.addEventListener('change', async () => {
    for (const picked of [...(file.files ?? [])]) {
      try {
        const row = await store.api.upload(store.scenarioId, picked);
        store.bundle.media.push(row);
        // The server notes an animated PNG as one; the game plays it, and characters can use its frames.
        const apng = params(row).apng as { frames: number; duration: number } | undefined;
        if (apng) toast(`${picked.name} is an animated PNG with ${apng.frames} frames. It plays by itself, and a character can use all of its frames or some of them.`);
        // File it under the tab it was uploaded from, until how it is used says otherwise.
        if (mediaTab !== 'all' && mediaTab !== 'audio' && mediaTab !== 'video' && row.type === 'image') void store.patch('media', row.id, { params: { ...params(row), category: mediaTab } });
      } catch (err) {
        toast(`${picked.name}: ${err instanceof Error ? err.message : 'upload failed'}`, 'error');
      }
    }
    file.value = '';
    store.emit();
  });

  const addByAddress = () => {
    const url = window.prompt('Address of the image, sound or video:')?.trim();
    if (!url) return;
    const ext = url.split(/[?#]/)[0]!.split('.').pop()?.toLowerCase() ?? '';
    const type = ['mp3', 'wav', 'ogg', 'm4a'].includes(ext) ? 'audio' : ['mp4', 'webm'].includes(ext) ? 'video' : 'image';
    void store.add('media', { type, url, filename: url.split(/[?#]/)[0]!.split('/').pop() });
  };

  const categories = new Map(store.rows('media').map((m) => [m.id, mediaCategory(ctx, m)]));
  const count = (tab: MediaTab) => (tab === 'all' ? categories.size : [...categories.values()].filter((c) => c === tab).length);
  const tabs = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Kinds of media' }, ...MEDIA_TABS.map(([key, label, icon]) =>
    h('button', {
      type: 'button', role: 'tab', class: mediaTab === key ? 'current' : null, 'aria-selected': String(mediaTab === key), 'data-tab': key,
      onclick: () => {
        mediaTab = key;
        store.emit();
      },
    }, emojiIcon(icon), label, h('small', null, count(key)))));

  const cards = store.rows('media').filter((m) => mediaTab === 'all' || categories.get(m.id) === mediaTab).map((media) => {
    const id = media.id;
    const url = mediaUrl(store, media);
    const category = categories.get(id)!;
    const [, categoryLabel, categoryIcon] = MEDIA_TABS.find(([key]) => key === category)!;
    const open = (part?: 'sheet') => openMedia(ctx, id, part);
    // An image opens its panel when clicked; a sound or video keeps its player, which needs the clicks.
    const preview =
      !url ? h('div', { class: 'preview none' }, 'No address')
      : media.type === 'image' ? h('button', { type: 'button', class: 'media-thumb', title: 'Open its details', 'aria-label': `Open ${mediaLabel(media)}`, onclick: () => open() }, h('img', { src: url, alt: '', loading: 'lazy' }))
      : media.type === 'audio' ? h('audio', { class: 'preview', src: url, controls: true, preload: 'none' })
      : h('video', { class: 'preview', src: url, controls: true, preload: 'none' });
    const p = params(media);
    const sheet = p.sheet as { columns: number; rows: number } | undefined;
    const apng = p.apng as { frames: number; duration: number } | undefined;
    const sheetAnimations = ((p.animations as unknown[] | undefined) ?? []).length;
    return h(
      'div',
      { class: 'card media-card', 'data-media': id, 'data-category': category, style: `--tone: var(--tone-${category})` },
      preview,
      h('div', { class: 'card-title' }, h('strong', { class: 'media-name', title: mediaLabel(media) }, mediaLabel(media)), h('span', { class: 'muted' }, `#${id}`)),
      h('div', { class: 'chips' },
        h('span', { class: 'chip tone' }, emojiIcon(categoryIcon), categoryLabel),
        media.width && media.height ? h('span', { class: 'chip' }, `${media.width}×${media.height}`) : null,
        apng ? h('span', { class: 'chip anim media-apng' }, `🎞️ Animated PNG: ${apng.frames} frames, ${apng.duration} ms`) : null,
        sheet ? h('span', { class: 'chip anim' }, `🎞️ Sheet ${sheet.columns}×${sheet.rows} · ${sheetAnimations} animation${sheetAnimations === 1 ? '' : 's'}`) : null),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', 'data-open': 'details', onclick: () => open() }, '✏️ Details'),
        media.type === 'image' && !apng ? h('button', { type: 'button', 'data-open': 'sheet', title: 'Cut the picture into frames and make animations of them', onclick: () => open('sheet') }, '🎞️ Sprite sheet') : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'danger icon media-delete', title: 'Delete', 'aria-label': `Delete ${mediaLabel(media)}`, onclick: () => confirmDelete(`“${mediaLabel(media)}”. Anything using it will be left without it`) && void store.remove('media', id) }, '🗑')),
    );
  });

  return page(
    'Media',
    'The images, sounds and videos the scenario uses. Upload files, or point at files already on the web. Click a picture, or Details, to change it; Sprite sheet cuts a picture into frames for animations.',
    [h('button', { type: 'button', class: 'primary', onclick: () => file.click() }, 'Upload files'), h('button', { type: 'button', onclick: addByAddress }, 'Add by address'), file],
    h('div', null, tabs, cards.length ? h('div', { class: 'grid media-grid' }, ...cards) : none(mediaTab === 'all' ? 'No media yet. Upload a background image to get started.' : 'Nothing here yet. Upload a file while this tab is open and it is filed here.')),
  );
}

/**
 * One media file in a pop-up: a large preview and its details on one side, and for a picture
 * the sprite sheet tool on the other, with room for the sheet's grid and its animations.
 */
function openMedia(ctx: FormContext, id: number, part?: 'sheet') {
  const { store } = ctx;
  const category = (media: Row) => mediaCategory(ctx, media);
  openPanel({
    key: `media-${id}`,
    kind: 'media',
    store,
    tone: `var(--tone-${(() => { const m = store.byId('media', id); return m ? category(m) : 'other'; })()})`,
    title: () => {
      const media = store.byId('media', id);
      return media ? h('span', null, mediaLabel(media), h('small', { class: 'muted' }, ` #${id} · ${media.type}`)) : null;
    },
    body: () => {
      const media = store.byId('media', id);
      if (!media) return null;
      const url = mediaUrl(store, media);
      const apng = params(media).apng as { frames: number; duration: number } | undefined;
      const preview =
        !url ? h('div', { class: 'preview none' }, 'No address')
        : media.type === 'image' ? h('img', { class: 'preview large checker', src: url, alt: '' })
        : media.type === 'audio' ? h('audio', { class: 'preview', src: url, controls: true, preload: 'metadata' })
        : h('video', { class: 'preview large', src: url, controls: true, preload: 'metadata' });
      const details = h('section', { class: 'panel-section', 'data-section': 'details', style: '--tone: var(--tone-details)' },
        h('h3', { class: 'section-head' }, '📝 Details'),
        preview,
        form(MEDIA_FIELDS, media, (key, value, field) => void store.patch('media', id, { [key]: value }, key === 'url' || field.structural === true), ctx),
        media.type === 'image'
          ? h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Filed under'),
              select(MEDIA_TABS.filter(([key]) => !['all', 'audio', 'video'].includes(key)).map(([key, label]) => [key, label] as const), String(params(media).category ?? ''),
                (v) => void store.patch('media', id, { params: withValue(params(store.byId('media', id)!), 'category', v) }, true), `Automatic (${MEDIA_TABS.find(([key]) => key === category(media))?.[1]})`))
          : null,
        h('div', { class: 'row-actions' }, removeButton(ctx, 'media', media, `“${mediaLabel(media)}”. Anything using it will be left without it`)));
      if (media.type !== 'image') return h('div', { class: 'media-panel single' }, details);
      const animation = h('section', { class: 'panel-section', 'data-section': 'sheet', style: '--tone: var(--tone-move)' },
        h('h3', { class: 'section-head' }, apng ? '🎞️ Animated PNG' : '🎞️ Sprite sheet and animations'),
        apng
          ? h('p', { class: 'media-apng' }, `Animated PNG: ${apng.frames} frames, ${apng.duration} ms. It plays by itself wherever it is used; on the Characters page an animation can take some of its frames.`)
          : sheetEditor(ctx, media));
      return h('div', { class: 'media-panel' }, details, animation);
    },
    opened: (dialog) => {
      if (part === 'sheet') dialog.querySelector('[data-section=sheet]')?.scrollIntoView({ block: 'start' });
    },
  });
}

// ----------------------------------------------------------------- variables

export function variablesPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const add = () => {
    const name = window.prompt('Name of the new variable (letters, digits and underscores):')?.trim();
    if (name) void store.add('variables', { variable_name: name, default_value: 0 });
  };
  const rows = store.rows('variables').map((variable) =>
    h(
      'div',
      { class: 'card row-card', 'data-variable': String(variable.variable_name) },
      h('span', { class: `badge scope-${variable.scope === 'room' ? 'room' : 'player'}` }, variable.scope === 'room' ? '🌐 Shared' : '👤 Each player'),
      form(VARIABLE_FIELDS, variable, (key, value, field) => void store.patch('variables', variable.id, { [key]: value ?? (key === 'default_value' ? 0 : value) }, field.structural === true), ctx),
      h('div', { class: 'row-actions' }, removeButton(ctx, 'variables', variable, `the variable “${variable.variable_name}”`)),
    ),
  );
  return page(
    'Variables',
    'What the scenario remembers. Conditions test variables and “Variable” actions change them. Each one is either a player’s own or shared. A player’s own: every player has a separate value, so one player’s progress does not move another’s (how many animals this player has petted, which step of the quest they are on). Shared: one value for everyone playing together, so when one player changes it, it changes for all of them (the boulders have fallen and the path is blocked for everybody).',
    [h('button', { type: 'button', class: 'primary', onclick: add }, 'New variable')],
    rows.length ? h('div', { class: 'stack' }, ...rows) : none('No variables yet.'),
  );
}

// ------------------------------------------------------- items and characters

function thingsPage(ctx: FormContext, table: 'items', title: string, about: string, fields: Field[], settings: Field[], owner: 'item_id'): HTMLElement {
  const { store } = ctx;
  const noun = 'item';
  const cards = store.rows(table).map((thing) => {
    const id = thing.id;
    const url = mediaUrl(store, store.byId('media', thing.media_id as number | null));
    return h(
      'div',
      { class: 'card', 'data-thing': `${table}-${id}` },
      h('div', { class: 'card-title' }, h('strong', null, String(thing.name)), h('span', { class: 'muted' }, `#${id}`)),
      url ? h('img', { class: 'preview small', src: url, alt: '' }) : null,
      form(fields, thing, (key, value) => void store.patch(table, id, { [key]: value }, key === 'media_id'), ctx),
      form(settings, params(thing, 'settings'), (key, value, field) => void store.patch(table, id, { settings: withValue(params(store.byId(table, id)!, 'settings'), key, value, field) }, field.structural === true), ctx),
      rowConditions(ctx, owner, id, 'Present only when', 'Always present.'),
      h('div', { class: 'row-actions' }, removeButton(ctx, table, thing, `the ${noun} “${thing.name}”`)),
    );
  });
  return page(
    title,
    about,
    [h('button', { type: 'button', class: 'primary', onclick: () => void store.add(table, { name: `New ${noun}` }) }, `New ${noun}`)],
    cards.length ? h('div', { class: 'grid' }, ...cards) : none(`No ${table} yet.`),
  );
}

export const itemsPage = (ctx: FormContext) =>
  thingsPage(ctx, 'items', 'Items', 'Things players can pick up, wear or ride. Define them here, then place them in scenes.', ITEM_FIELDS, ITEM_SETTINGS_FIELDS, 'item_id');

// ---------------------------------------------------------------- objectives

interface Objective {
  id: string | number;
  text?: string;
  optional?: boolean;
  show_when?: ConditionValue[];
  complete_when?: ConditionValue[];
}

/** The mission checklist players see. It is kept in the scenario's settings, in order. */
export function objectivesPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const read = () => (store.settings.objectives as Objective[] | undefined) ?? [];
  const write = (list: Objective[], structural: boolean) => void store.patchSettings({ objectives: list }, structural);
  const at = (index: number): Objective => read()[index] ?? { id: '' };
  const replace = (index: number, objective: Objective, structural = false) => write(read().map((o, i) => (i === index ? objective : o)), structural);

  const add = () => {
    const ids = new Set(read().map((o) => String(o.id)));
    let n = read().length + 1;
    while (ids.has(`objective-${n}`)) n++;
    write([...read(), { id: `objective-${n}`, text: 'New objective', complete_when: [] }], true);
  };
  const move = (index: number, by: number) => {
    const list = [...read()];
    const [moved] = list.splice(index, 1);
    list.splice(index + by, 0, moved!);
    write(list, true);
  };

  const cards = read().map((objective, index) =>
    h(
      'div',
      { class: 'card' },
      form(OBJECTIVE_FIELDS, objective as unknown as Record<string, unknown>, (key, value, field) => replace(index, withValue({ ...at(index) }, key, value, field) as unknown as Objective), ctx),
      inlineConditions(ctx, () => at(index).show_when, (list, structural) => replace(index, withValue({ ...at(index) }, 'show_when', list.length ? list : null) as unknown as Objective, structural), 'Listed only when', 'Always listed.'),
      inlineConditions(ctx, () => at(index).complete_when, (list, structural) => replace(index, { ...at(index), complete_when: list }, structural), 'Ticked off when', 'Add a condition, or it is never ticked off.'),
      h(
        'div',
        { class: 'row-actions' },
        h('button', { type: 'button', disabled: index === 0, onclick: () => move(index, -1) }, '↑ Earlier'),
        h('button', { type: 'button', disabled: index === read().length - 1, onclick: () => move(index, 1) }, '↓ Later'),
        h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete('this objective') && write(read().filter((_, i) => i !== index), true) }, 'Delete'),
      ),
    ),
  );
  return page(
    'Objectives',
    'The checklist players see during the mission. Each line is ticked off by variables, so events move the mission along simply by changing them.',
    [h('button', { type: 'button', class: 'primary', onclick: add }, 'New objective')],
    cards.length ? h('div', { class: 'stack' }, ...cards) : none('No objectives: players see no checklist.'),
  );
}

// ---------------------------------------------------------------------- shop

/** Mission-specific things for sale. The platform's own catalogue is sold alongside in every scenario. */
export function shopPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const cards = store.rows('shop_items').map((item) => {
    const id = item.id;
    const kind = item.kind as string;
    const url = mediaUrl(store, store.byId('media', item.media_id as number | null));
    const settings = (key: string, value: unknown, field: Field) => void store.patch('shop_items', id, { settings: withValue(params(store.byId('shop_items', id)!, 'settings'), key, value, field) });
    const column = (key: string, value: unknown, field: Field) => void store.patch('shop_items', id, { [key]: value }, key === 'media_id' || field.structural === true);
    return h(
      'div',
      { class: 'card', 'data-shop': id },
      h('div', { class: 'card-title' }, h('strong', null, String(item.name)), h('span', { class: 'badge' }, `⭐ ${item.price}`)),
      url ? h('img', { class: 'preview small', src: url, alt: '' }) : null,
      form(SHOP_ITEM_FIELDS, item, column, ctx),
      kind === 'wearable' ? form([SHOP_SLOT], item, column, ctx) : null,
      kind === 'wearable' || kind === 'pet' ? form(SHOP_WEARABLE_FIELDS, params(item, 'settings'), settings, ctx) : null,
      kind === 'animation' ? form([SHOP_ANIMATION], params(item, 'settings'), settings, ctx) : null,
      kind === 'ability' ? form([SHOP_ABILITY], params(item, 'settings'), settings, ctx) : null,
      kind === 'move' ? form([SHOP_MOVE], params(item, 'settings'), settings, ctx) : null,
      h('div', { class: 'row-actions' }, removeButton(ctx, 'shop_items', item, `“${item.name}”. Players who bought it will lose it, and their stars are not returned`)),
    );
  });
  return page(
    'Shop',
    'Things only this scenario sells: a mission badge, a tool for this planet, a pet found here. Players buy them with stars in the marketplace, which also sells the platform’s items everywhere. Add an “Open the marketplace” action to a hotspot to let players in; they can also open it from their stars at any time.',
    [h('button', { type: 'button', class: 'primary', onclick: () => void store.add('shop_items', { name: 'New item', kind: 'wearable', slot: 'head', price: 10 }) }, 'New item')],
    cards.length ? h('div', { class: 'grid' }, ...cards) : none('This scenario sells nothing of its own. Players still see the platform’s items.'),
  );
}

// --------------------------------------------------------------------- moves

interface MoveRow { animation: string; label?: string; icon?: string; conditions?: ConditionValue[] | null }

/** What players can do from buttons on their screen: jump, crouch, dance. Kept in the scenario's settings. */
export function movesPage(ctx: FormContext): HTMLElement {
  const { store } = ctx;
  const read = () => (store.settings.moves as MoveRow[] | undefined) ?? [];
  const write = (list: MoveRow[], structural: boolean) => void store.patchSettings({ moves: list.length ? list : null }, structural);
  const at = (index: number): MoveRow => read()[index] ?? { animation: '' };
  const replace = (index: number, move: MoveRow, structural = false) => write(read().map((m, i) => (i === index ? move : m)), structural);
  const cards = read().map((move, index) =>
    h(
      'div',
      { class: 'card', 'data-move': move.animation },
      form(MOVE_FIELDS, move as unknown as Record<string, unknown>, (key, value, field) => replace(index, withValue({ ...at(index) }, key, value, field) as unknown as MoveRow, key === 'animation'), ctx),
      inlineConditions(ctx, () => at(index).conditions ?? undefined, (list, structural) => replace(index, withValue({ ...at(index) }, 'conditions', list.length ? list : null) as unknown as MoveRow, structural), 'Offered only when', 'Every player can do this, any time.'),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'danger', onclick: () => confirmDelete('this move') && write(read().filter((_, i) => i !== index), true) }, 'Delete')),
    ),
  );
  return page(
    'Moves',
    'What players can do whenever they like, from buttons on their screen: jump, crouch, dance. A move with a condition appears once the condition holds, so an event can teach one by setting one of the player’s own variables. Moves bought in the marketplace are added to these and follow the player into every scenario. To play an animation at a point in the story instead, use the “Play an animation” action.',
    [h('button', { type: 'button', class: 'primary', onclick: () => write([...read(), { animation: ['jump', 'crouch', 'dance', 'wave', 'spin'].find((n) => !read().some((m) => m.animation === n)) ?? 'jump' }], true) }, 'New move')],
    cards.length ? h('div', { class: 'grid' }, ...cards) : none('No moves: players walk, and that is all.'),
  );
}
