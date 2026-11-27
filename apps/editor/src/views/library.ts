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
import { isCategory, isSprite, mediaCategory, MEDIA_TABS, type MediaTab } from '../mediaCategories';
import { emojiIcon } from '../icons';
import { emptyState, listPage } from './kit';
import { audioCropper, cropSummary } from './audioCrop';
import { audioCrop, cropFragment } from '@qbl/shared';

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

/** The sub-tab showing. Kept outside the view so a redraw does not reset it. */
let mediaTab: MediaTab = 'all';

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
        if (isCategory(mediaTab) && mediaTab !== 'audio' && mediaTab !== 'video' && row.type === 'image') void store.patch('media', row.id, { params: { ...params(row), category: mediaTab } });
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

  const categories = new Map(store.rows('media').map((m) => [m.id, mediaCategory(store, m)]));
  const inTab = (media: Row, tab: MediaTab) => (tab === 'all' ? true : tab === 'sprites' ? isSprite(media) : categories.get(media.id) === tab);
  const count = (tab: MediaTab) => store.rows('media').filter((m) => inTab(m, tab)).length;
  const tabs = h('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Kinds of media' }, ...MEDIA_TABS.map(([key, label, icon]) =>
    h('button', {
      type: 'button', role: 'tab', class: mediaTab === key ? 'current' : null, 'aria-selected': String(mediaTab === key), 'data-tab': key,
      onclick: () => {
        mediaTab = key;
        store.emit();
      },
    }, emojiIcon(icon), label, h('small', null, count(key)))));

  const cards = store.rows('media').filter((m) => inTab(m, mediaTab)).map((media) => {
    const id = media.id;
    const url = mediaUrl(store, media);
    const category = categories.get(id)!;
    const [, categoryLabel, categoryIcon] = MEDIA_TABS.find(([key]) => key === category)!;
    const open = (part?: 'sheet' | 'crop') => openMedia(ctx, id, part);
    // An image opens its panel when clicked; a sound or video keeps its player, which needs the clicks.
    const preview =
      !url ? h('div', { class: 'preview none' }, 'No address')
      : media.type === 'image' ? h('button', { type: 'button', class: 'media-thumb', title: 'Open its details', 'aria-label': `Open ${mediaLabel(media)}`, onclick: () => open() }, h('img', { src: url, alt: '', loading: 'lazy' }))
      : media.type === 'audio' ? h('audio', { class: 'preview', src: url + cropFragment(audioCrop(media)), controls: true, preload: 'none' })
      : h('video', { class: 'preview', src: url, controls: true, preload: 'none' });
    const p = params(media);
    const cropped = media.type === 'audio' ? cropSummary(media) : null;
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
        cropped ? h('span', { class: 'chip media-cropped', title: 'Only this part of the sound plays' }, cropped) : null,
        apng ? h('span', { class: 'chip anim media-apng' }, `🎞️ Animated PNG: ${apng.frames} frames, ${apng.duration} ms${sheetAnimations ? ` · ${sheetAnimations} animation${sheetAnimations === 1 ? '' : 's'}` : ''}`) : null,
        sheet ? h('span', { class: 'chip anim' }, `🎞️ Sheet ${sheet.columns}×${sheet.rows} · ${sheetAnimations} animation${sheetAnimations === 1 ? '' : 's'}`) : null),
      h('div', { class: 'row-actions' },
        h('button', { type: 'button', 'data-open': 'details', onclick: () => open() }, '✏️ Details'),
        media.type === 'audio' && url ? h('button', { type: 'button', 'data-open': 'crop', title: 'Keep only part of the sound', onclick: () => open('crop') }, '✂️ Crop') : null,
        media.type === 'image' ? h('button', { type: 'button', 'data-open': 'sheet', title: apng ? 'Make animations of its frames, for characters to play' : 'Cut the picture into frames and make animations of them, for characters, items and vehicles', onclick: () => open('sheet') }, apng ? '🎞️ Animations' : '🎞️ Sprite sheet') : null,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'danger icon media-delete', title: 'Delete', 'aria-label': `Delete ${mediaLabel(media)}`, onclick: () => confirmDelete(`“${mediaLabel(media)}”. Anything using it will be left without it`) && void store.remove('media', id) }, '🗑')),
    );
  });

  return page(
    'Media',
    'The images, sounds and videos the scenario uses. Upload files, or point at files already on the web. Click a picture, or Details, to change it; Sprite sheet cuts a picture into frames and makes its animations, which characters, items and vehicles play; Crop keeps only part of a sound.',
    [h('button', { type: 'button', class: 'primary', onclick: () => file.click() }, 'Upload files'), h('button', { type: 'button', onclick: addByAddress }, 'Add by address'), file],
    h('div', null, tabs, cards.length ? h('div', { class: 'grid media-grid' }, ...cards) : none(mediaTab === 'all' ? 'No media yet. Upload a background image to get started.' : mediaTab === 'sprites' ? 'No sprites yet. Upload an animated PNG, or open a picture and use Sprite sheet to cut it into frames.' : 'Nothing here yet. Upload a file while this tab is open and it is filed here.')),
    categories.size,
  );
}

/**
 * One media file in a pop-up: a large preview and its details on one side, and for a picture
 * the sprite sheet tool on the other, with room for the sheet's grid and its animations.
 */
export function openMedia(ctx: FormContext, id: number, part?: 'sheet' | 'crop') {
  const { store } = ctx;
  const category = (media: Row) => mediaCategory(ctx.store, media);
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
        // A sound is heard (and cropped) in its own section.
        : media.type === 'audio' ? null
        : h('video', { class: 'preview large', src: url, controls: true, preload: 'metadata' });
      const details = h('section', { class: 'panel-section', 'data-section': 'details', style: '--tone: var(--tone-details)' },
        h('h3', { class: 'section-head' }, '📝 Details'),
        preview,
        form(MEDIA_FIELDS, media, (key, value, field) => {
          // A crop is of the file it was made on: another address (another file) plays whole.
          const row = store.byId('media', id);
          const p = row ? params(row) : {};
          if (key === 'url' && row?.type === 'audio' && p.crop) {
            const { crop: _, ...rest } = p;
            void store.patch('media', id, { [key]: value, params: rest }, true);
            return;
          }
          void store.patch('media', id, { [key]: value }, key === 'url' || field.structural === true);
        }, ctx),
        media.type === 'image'
          ? h('label', { class: 'field wide' }, h('span', { class: 'field-label' }, 'Filed under'),
              select(MEDIA_TABS.filter(([key]) => !['all', 'sprites', 'audio', 'video'].includes(key)).map(([key, label]) => [key, label] as const), String(params(media).category ?? ''),
                (v) => void store.patch('media', id, { params: withValue(params(store.byId('media', id)!), 'category', v) }, true), `Automatic (${MEDIA_TABS.find(([key]) => key === category(media))?.[1]})`))
          : null,
        mediaCredit(media),
        h('div', { class: 'row-actions' }, removeButton(ctx, 'media', media, `“${mediaLabel(media)}”. Anything using it will be left without it`)));
      if (media.type === 'audio') return h('div', { class: 'media-panel single' }, audioCropper(ctx, media), details);
      if (media.type !== 'image') return h('div', { class: 'media-panel single' }, details);
      const animation = h('section', { class: 'panel-section', 'data-section': 'sheet', style: '--tone: var(--tone-move)' },
        h('h3', { class: 'section-head' }, apng ? '🎞️ Animated PNG and animations' : '🎞️ Sprite sheet and animations'),
        sheetEditor(ctx, media));
      return h('div', { class: 'media-panel' }, details, animation);
    },
    opened: (dialog) => {
      if (part) dialog.querySelector(`[data-section=${part}]`)?.scrollIntoView({ block: 'start' });
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
