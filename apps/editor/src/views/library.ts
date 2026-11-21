import type { Row, Table } from '../api';
import { mediaLabel, mediaUrl, params } from '../describe';
import { confirmDelete, h, toast } from '../dom';
import { openPanel } from '../panel';
import { form, select, withValue, type Field, type FormContext } from '../fields';
import {
  MOVE_FIELDS, SHOP_ABILITY, SHOP_ANIMATION, SHOP_MOVE, SHOP_ITEM_FIELDS, SHOP_SLOT, SHOP_WEARABLE_FIELDS, ITEM_FIELDS, ITEM_SETTINGS_FIELDS, MEDIA_FIELDS, OBJECTIVE_FIELDS, VARIABLE_FIELDS,
} from '../schema';
import { inlineConditions, rowConditions, type ConditionValue } from './conditions';
import { sheetEditor } from './sheet';
import { characterMediaIds } from '../characters';
import { emojiIcon } from '../icons';
import { emptyState, listPage } from './kit';

export { charactersPage } from './characters';
export { itemsPage } from './items';
export { movesPage } from './moves';
export { objectivesPage } from './objectives';
export { shopPage } from './shop';
export { variablesPage } from './variables';

/** The Media page; the other scenario-wide lists each have a file of their own, exported from here too. */

const page = (title: string, about: string, actions: Array<HTMLElement | null>, body: HTMLElement, count?: number) => listPage({ title, about, actions, count }, body);

const none = (text: string) => emptyState('🖼️', text);

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
    categories.size,
  );
}

/**
 * One media file in a pop-up: a large preview and its details on one side, and for a picture
 * the sprite sheet tool on the other, with room for the sheet's grid and its animations.
 */
export function openMedia(ctx: FormContext, id: number, part?: 'sheet') {
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
        mediaCredit(media),
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

/** Who made a picture and under which licence, for one copied from the QuestLab asset library. Keep it with the picture: CC BY art must be credited. */
function mediaCredit(media: Row): HTMLElement | null {
  const credit = params(media).credit as { title?: string; author?: string; license?: string; url?: string } | undefined;
  if (!credit?.author) return null;
  return h('p', { class: 'media-credit' }, '🎨 ',
    credit.url ? h('a', { href: credit.url, target: '_blank', rel: 'noopener' }, credit.title || 'Art') : (credit.title || 'Art'),
    ` by ${credit.author}`, credit.license ? ` · ${credit.license}` : '');
}
