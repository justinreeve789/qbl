import type { Row } from './api';
import { mediaLabel, mediaUrl, params } from './describe';
import { h, toast } from './dom';
import { emojiIcon } from './icons';
import { inTab, isCategory, mediaCategory, MEDIA_TABS, tabLabel, type MediaTab } from './mediaCategories';
import { openPanel } from './panel';
import type { Store } from './store';

/**
 * Choosing a picture (or a video) for a field: a button that shows the one chosen, and a pop-up of
 * the scenario's files as large tiles, opened on the kind the field wants (backgrounds for a scene
 * layer, sprite sheets for a spritemap), with the other kinds a click away.
 */

export type VisualType = 'image' | 'video';

export interface MediaChoice {
  /** Which types of file may be chosen. */
  types: VisualType[];
  /** The tab the pop-up opens on: the kind of file the field is for. Default: all of them. */
  category?: MediaTab;
  /** The file chosen now. */
  selected?: number | null;
  /** The pop-up's heading. */
  title?: string;
  /** What choosing nothing means ("No image"). Without it there is no way to choose nothing. */
  none?: string;
}

interface Sheet { columns: number; rows: number; count?: number }

const sizeOf = (row: Row): string => {
  const w = Number(row.width);
  const hgt = Number(row.height);
  return w > 0 && hgt > 0 ? `${w} × ${hgt}` : '';
};

/** What a file is, beyond its name: its size, and whether it is cut into frames or plays by itself. */
function facts(row: Row): string[] {
  const p = params(row);
  const sheet = p.sheet as Sheet | undefined;
  const apng = p.apng as { frames: number } | undefined;
  return [
    sizeOf(row),
    sheet ? `🎞️ ${sheet.count ?? sheet.columns * sheet.rows} frames` : '',
    apng ? `▶ animated, ${apng.frames} frames` : '',
    row.type === 'video' ? '🎬 video' : '',
  ].filter(Boolean);
}

/**
 * A file's picture, at any size: a sprite sheet shows its first frame (the whole sheet is in its
 * tooltip), a video its first moments, anything else the image itself, on a checkerboard so
 * see-through parts show as such.
 */
export function mediaPreview(store: Store, row: Row | undefined, className: string): HTMLElement {
  const url = mediaUrl(store, row);
  const box = h('span', { class: `${className} media-preview` });
  if (!row || !url) {
    box.append(h('span', { class: 'media-preview-icon' }, emojiIcon(row ? '📄' : '🖼️')));
    return box;
  }
  if (row.type === 'video') {
    box.append(h('video', { src: `${url}#t=0.5`, preload: 'metadata', muted: true, playsinline: true }));
    return box;
  }
  const sheet = params(row).sheet as Sheet | undefined;
  if (sheet && sheet.columns > 0 && sheet.rows > 0) {
    const frame = h('span', { class: 'media-frame' });
    frame.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
    frame.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    const w = Number(row.width);
    const hgt = Number(row.height);
    frame.style.aspectRatio = w > 0 && hgt > 0 ? `${w / sheet.columns} / ${hgt / sheet.rows}` : '1';
    box.append(frame);
    return box;
  }
  box.append(h('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }));
  return box;
}

/**
 * Choose a file in a pop-up. Settles with its id, null when "nothing" was chosen, or undefined
 * when the pop-up was closed without a choice.
 */
export function chooseMedia(store: Store, o: MediaChoice): Promise<number | null | undefined> {
  const opening = o.category ?? 'all';
  const allowed = () => store.rows('media').filter((m) => o.types.includes(m.type as VisualType));
  // A field whose kind has no files yet opens on all of them rather than on an empty page.
  let tab: MediaTab = opening === 'all' || allowed().some((m) => inTab(store, m, opening)) ? opening : 'all';
  let query = '';
  const uploading = new Set<string>();
  const noun = o.types.includes('image') ? (o.types.includes('video') ? 'picture or video' : 'picture') : 'video';

  return new Promise((resolve) => {
    let done = false;
    const finish = (id: number | null | undefined) => {
      if (done) return;
      done = true;
      resolve(id);
      panel.close();
    };

    const file = h('input', { type: 'file', multiple: true, hidden: true, accept: o.types.map((t) => `${t}/*`).join(',') });
    const search = h('input', { type: 'search', class: 'mp-search', placeholder: 'Search by name', 'aria-label': 'Search by name' });
    const tabs = h('div', { class: 'mp-tabs', role: 'tablist', 'aria-label': 'Kinds of file' });
    const grid = h('div', { class: 'mp-grid', role: 'listbox', 'aria-label': `Choose a ${noun}` });
    const note = h('p', { class: 'mp-note muted' });

    const draw = () => {
      const rows = allowed();
      const categories = new Map(rows.map((m) => [m.id, mediaCategory(store, m)]));
      const within = (m: Row, t: MediaTab) => inTab(store, m, t, categories.get(m.id));
      // The tabs that have any of the allowed files, and always the one the field is for and the one showing.
      const shown = MEDIA_TABS.filter(([key]) => key === 'all' || key === opening || key === tab || rows.some((m) => within(m, key)));
      tabs.replaceChildren(...shown.map(([key, label, icon]) => {
        const count = rows.filter((m) => within(m, key)).length;
        return h('button', {
          type: 'button', role: 'tab', class: `mp-tab${key === tab ? ' active' : ''}${key === opening && key !== 'all' ? ' wanted' : ''}`,
          'aria-selected': String(key === tab), 'data-media-tab': key,
          title: key === opening && key !== 'all' ? 'The kind of file this is for' : undefined,
          onclick: () => { tab = key; draw(); },
        }, emojiIcon(icon), ` ${label} `, h('span', { class: 'mp-count' }, String(count)));
      }));

      const q = query.trim().toLowerCase();
      const list = rows.filter((m) => within(m, tab) && (!q || mediaLabel(m).toLowerCase().includes(q))).reverse();
      const tiles = list.map((row) => {
        const current = row.id === o.selected;
        const where = tab === 'all' || tab === 'sprites' ? tabLabel(categories.get(row.id)!) : null;
        return h('button', {
          type: 'button', role: 'option', class: `mp-tile${current ? ' current' : ''}`, 'aria-selected': String(current),
          'data-media-pick': row.id, 'data-name': mediaLabel(row), title: mediaLabel(row),
          onclick: () => finish(row.id),
        },
        mediaPreview(store, row, 'mp-thumb'),
        current ? h('span', { class: 'mp-current' }, '✓ Chosen') : null,
        h('span', { class: 'mp-name' }, mediaLabel(row)),
        h('span', { class: 'mp-facts' }, ...facts(row).map((f) => h('span', null, f)), where ? h('span', { class: 'mp-where' }, emojiIcon(where[2]), ` ${where[1]}`) : null));
      });
      const pending = [...uploading].map((name) => h('div', { class: 'mp-tile uploading' }, h('span', { class: 'mp-thumb media-preview' }, h('span', { class: 'rt-spinner' })), h('span', { class: 'mp-name' }, name)));
      const nothing = o.none != null
        ? h('button', { type: 'button', class: `mp-tile mp-none${o.selected == null ? ' current' : ''}`, 'data-media-pick': '', onclick: () => finish(null) },
          h('span', { class: 'mp-thumb media-preview' }, h('span', { class: 'media-preview-icon' }, '∅')), h('span', { class: 'mp-name' }, o.none))
        : null;
      const upload = h('button', { type: 'button', class: 'mp-tile mp-upload', onclick: () => file.click() },
        h('span', { class: 'mp-thumb media-preview' }, h('span', { class: 'media-preview-icon' }, '⬆')),
        h('span', { class: 'mp-name' }, `Upload a ${noun}…`),
        h('span', { class: 'mp-facts' }, h('span', null, isCategory(tab) ? `Filed under ${tabLabel(tab)[1]}` : 'or drop files here')));
      grid.replaceChildren(upload, ...(q ? [] : nothing ? [nothing] : []), ...pending, ...tiles);

      const [, wantedLabel] = tabLabel(opening);
      const others = rows.length - list.length;
      if (!list.length && !pending.length) {
        note.replaceChildren(q ? `Nothing here is named like “${query.trim()}”.` : `No ${tabLabel(tab)[1].toLowerCase()} yet. Upload one, or drop files here.`,
          ...(tab !== 'all' && others ? [h('button', { type: 'button', class: 'link', onclick: () => { tab = 'all'; draw(); } }, ` Show all ${rows.length}`)] : []));
      } else if (tab === 'all' && opening !== 'all' && !rows.some((m) => within(m, opening))) {
        note.replaceChildren(`Nothing is filed under ${wantedLabel} yet, so every ${noun} is shown. Whatever you choose is filed there once it is used.`);
      } else note.replaceChildren();
      note.hidden = !note.childNodes.length;
      grid.querySelector<HTMLElement>('.mp-tile.current')?.scrollIntoView({ block: 'nearest' });
    };

    const take = async (files: File[]) => {
      const wanted = files.filter((f) => o.types.some((t) => f.type.startsWith(`${t}/`)));
      if (wanted.length < files.length) toast(`Only ${o.types.map((t) => (t === 'image' ? 'pictures' : 'videos')).join(' and ')} can go here.`, 'error');
      const added: Row[] = [];
      await Promise.all(wanted.map(async (f) => {
        uploading.add(f.name);
        draw();
        try {
          const row = await store.api.upload(store.scenarioId, f);
          store.bundle.media.push(row);
          // Filed under the tab it was uploaded from, as the Media page does.
          if (isCategory(tab) && row.type === 'image' && tab !== 'audio' && tab !== 'video') {
            row.params = { ...params(row), category: tab };
            void store.patch('media', row.id, { params: row.params });
          }
          if (o.types.includes(row.type as VisualType)) added.push(row);
        } catch (err) {
          toast(`${f.name}: ${err instanceof Error ? err.message : 'upload failed'}`, 'error');
        } finally {
          uploading.delete(f.name);
        }
      }));
      store.emit(false);
      // One file uploaded is the one chosen; several stay in the list to choose from.
      if (wanted.length === 1 && added.length === 1) return finish(added[0]!.id);
      draw();
    };
    file.addEventListener('change', () => {
      void take([...(file.files ?? [])]);
      file.value = '';
    });
    search.addEventListener('input', () => { query = search.value; draw(); });

    const body = h('div', { class: 'mp' }, h('div', { class: 'mp-head' }, tabs, search), note, grid, file);
    body.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      body.classList.add('dropping');
    });
    body.addEventListener('dragleave', (e) => {
      if (!body.contains(e.relatedTarget as Node)) body.classList.remove('dropping');
    });
    body.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      body.classList.remove('dropping');
      void take([...e.dataTransfer.files]);
    });

    const panel = openPanel({
      key: 'media-choose', kind: 'media-choose', store, quiet: true, tone: '#3e9b5c',
      title: () => o.title ?? `Choose a ${noun}`,
      // Drawn once: the pop-up keeps its own tab and search, and redraws itself.
      body: () => body,
      opened: () => search.focus({ preventScroll: true }),
    });
    panel.dialog.addEventListener('close', () => finish(undefined));
    draw();
    requestAnimationFrame(() => search.focus({ preventScroll: true }));
  });
}

/** What a field of each kind asks for, in its button and the pop-up's heading. */
const WANTED: Partial<Record<MediaTab, string>> = {
  background: 'background', sprites: 'sprite sheet', character: 'character picture', item: 'picture of the item',
  vehicle: 'picture of the vehicle', shop: 'picture for the shop', video: 'video',
};

/**
 * The control a field shows: the chosen file's picture and name, which opens the pop-up, and a
 * × to choose nothing where nothing is allowed.
 */
export function mediaChoiceButton(store: Store, o: MediaChoice & { label: string; onChoose(id: number | null): void }): HTMLElement {
  const chosen = store.byId('media', o.selected ?? null);
  const kind = tabLabel(o.category ?? 'all');
  const wanted = WANTED[o.category ?? 'all'] ?? (o.types.includes('video') ? (o.types.includes('image') ? 'picture or video' : 'video') : 'picture');
  const open = async () => {
    const id = await chooseMedia(store, { ...o, title: o.title ?? `${o.label}: choose a ${wanted}` });
    if (id !== undefined && id !== (o.selected ?? null)) o.onChoose(id);
  };
  const button = h('button', {
    type: 'button', class: `media-choice-open${chosen ? '' : ' empty'}`, 'data-media-choice': chosen?.id ?? '', 'aria-label': `${o.label}: ${chosen ? mediaLabel(chosen) : o.none ?? 'none chosen'}. Choose…`,
    onclick: (e: Event) => { e.preventDefault(); void open(); },
  },
  chosen || o.selected != null ? mediaPreview(store, chosen, 'media-choice-thumb') : h('span', { class: 'media-choice-thumb media-preview' }, h('span', { class: 'media-preview-icon' }, emojiIcon(kind[2]))),
  h('span', { class: 'media-choice-text' },
    h('span', { class: 'media-choice-name' }, chosen ? mediaLabel(chosen) : o.selected != null ? '(missing file)' : o.none ?? 'No picture yet'),
    h('span', { class: 'media-choice-sub' }, ...(chosen ? facts(chosen).slice(0, 2).map((f) => h('span', null, f)) : []), h('span', { class: 'media-choice-cta' }, chosen ? 'Change…' : `Choose ${/^[aeiou]/.test(wanted) ? 'an' : 'a'} ${wanted}…`))));
  const clear = o.none != null && o.selected != null
    ? h('button', { type: 'button', class: 'icon media-choice-clear', title: `Clear: ${o.none}`, 'aria-label': `Clear ${o.label}`, onclick: (e: Event) => { e.preventDefault(); o.onChoose(null); } }, '×')
    : null;
  return h('div', { class: 'media-choice' }, button, clear);
}
