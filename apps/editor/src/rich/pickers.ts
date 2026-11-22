import { SYSTEM_VARIABLES } from '@qbl/shared';
import type { Row } from '../api';
import { mediaLabel, mediaUrl } from '../describe';
import { h, toast } from '../dom';
import type { FormContext } from '../fields';
import { emojiIcon } from '../icons';
import { openPanel } from '../panel';

/** Kinds of media file, as the media library stores them. */
export type MediaKind = 'image' | 'video' | 'audio';

const KIND_ICON: Record<string, string> = { image: '🖼️', video: '🎬', audio: '🔊' };
const KIND_NAME: Record<MediaKind, string> = { image: 'picture', video: 'video', audio: 'sound' };

/** Upload a file to the scenario's media library. The new row is added to the store without redrawing the page. */
export async function upload(ctx: FormContext, file: File): Promise<Row | null> {
  try {
    const row = await ctx.store.api.upload(ctx.store.scenarioId, file);
    ctx.store.bundle.media.push(row);
    ctx.store.emit(false);
    return row;
  } catch (err) {
    toast(`${file.name}: ${err instanceof Error ? err.message : 'upload failed'}`, 'error');
    return null;
  }
}

/** A tile's picture: the image itself, the first frame of a video, or the sound's icon. */
export function mediaThumb(ctx: FormContext, row: Row | undefined, className = 'rt-thumb'): HTMLElement {
  const url = mediaUrl(ctx.store, row);
  if (row?.type === 'image' && url) return h('img', { class: className, src: url, alt: '', loading: 'lazy', draggable: 'false' });
  if (row?.type === 'video' && url) return h('video', { class: className, src: `${url}#t=0.5`, preload: 'metadata', muted: true });
  return h('span', { class: `${className} rt-thumb-icon` }, emojiIcon(KIND_ICON[String(row?.type)] ?? '📄'));
}

/**
 * The scenario's media of some kinds, as tiles to choose from, with a search box and an upload
 * button; files can also be dropped on it. `multi` lets several be ticked.
 */
export function mediaGrid(ctx: FormContext, kinds: MediaKind[], o: { selected?: number[]; multi?: boolean; onPick(ids: number[]): void }): HTMLElement {
  const chosen = new Set(o.selected ?? []);
  const search = h('input', { type: 'search', placeholder: 'Search by name', class: 'rt-search', 'aria-label': 'Search media' });
  const grid = h('div', { class: 'rt-grid', role: 'listbox', 'aria-multiselectable': o.multi ? 'true' : null });
  const accept = kinds.map((k) => `${k}/*`).join(',');
  const file = h('input', { type: 'file', accept, multiple: true, hidden: true });
  const uploading = new Set<string>();

  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = ctx.store.rows('media').filter((m) => kinds.includes(m.type as MediaKind) && (!q || mediaLabel(m).toLowerCase().includes(q))).reverse();
    const tiles = rows.map((row) =>
      h('button', {
        type: 'button', class: `rt-tile${chosen.has(row.id) ? ' chosen' : ''}`, role: 'option', 'aria-selected': String(chosen.has(row.id)), 'data-media-pick': row.id, title: mediaLabel(row),
        onclick: () => {
          if (o.multi) {
            if (chosen.has(row.id)) chosen.delete(row.id);
            else chosen.add(row.id);
            draw();
            o.onPick([...chosen]);
          } else {
            chosen.clear();
            chosen.add(row.id);
            draw();
            o.onPick([row.id]);
          }
        },
      }, mediaThumb(ctx, row), h('span', { class: 'rt-tile-name' }, mediaLabel(row)), h('span', { class: 'rt-tick', 'aria-hidden': 'true' }, '✓')),
    );
    const pending = [...uploading].map((name) => h('div', { class: 'rt-tile uploading' }, h('span', { class: 'rt-spinner' }), h('span', { class: 'rt-tile-name' }, name)));
    grid.replaceChildren(
      h('button', { type: 'button', class: 'rt-tile rt-upload', onclick: () => file.click() }, h('span', { class: 'rt-thumb rt-thumb-icon' }, '⬆'), h('span', { class: 'rt-tile-name' }, `Upload ${kinds.length > 1 ? 'files' : `a ${KIND_NAME[kinds[0]!]}`}…`)),
      ...pending,
      ...tiles,
    );
    if (!rows.length && !pending.length) grid.append(h('p', { class: 'muted rt-none' }, q ? 'Nothing by that name.' : `No ${kinds.map((k) => KIND_NAME[k] + 's').join(' or ')} yet. Upload one, or drop files here.`));
  };

  const take = async (files: File[]) => {
    const wanted = files.filter((f) => kinds.some((k) => f.type.startsWith(`${k}/`)));
    if (wanted.length < files.length) toast(`Only ${kinds.map((k) => KIND_NAME[k] + 's').join(' and ')} can go here.`, 'error');
    const added: number[] = [];
    await Promise.all(wanted.map(async (f) => {
      uploading.add(f.name);
      draw();
      const row = await upload(ctx, f);
      uploading.delete(f.name);
      if (row && kinds.includes(row.type as MediaKind)) added.push(row.id);
    }));
    if (!o.multi) chosen.clear();
    for (const id of o.multi ? added : added.slice(-1)) chosen.add(id);
    draw();
    if (added.length) o.onPick([...chosen]);
  };
  file.addEventListener('change', () => {
    void take([...(file.files ?? [])]);
    file.value = '';
  });
  search.addEventListener('input', draw);
  const node = h('div', { class: 'rt-media-grid' }, h('div', { class: 'rt-grid-head' }, search), grid, file);
  node.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    node.classList.add('dropping');
  });
  node.addEventListener('dragleave', (e) => {
    if (!node.contains(e.relatedTarget as Node)) node.classList.remove('dropping');
  });
  node.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files.length) return;
    e.preventDefault();
    node.classList.remove('dropping');
    void take([...e.dataTransfer.files]);
  });
  draw();
  return node;
}

/**
 * Choose media from the library (or upload it) in a pop-up. Settles with the ids chosen, or
 * null when it is closed without choosing.
 */
export function pickMedia(ctx: FormContext, kinds: MediaKind[], o: { multi?: boolean; title?: string } = {}): Promise<number[] | null> {
  return new Promise((resolve) => {
    let picked: number[] = [];
    let done = false;
    const finish = (ids: number[] | null) => {
      if (done) return;
      done = true;
      resolve(ids);
      panel.close();
    };
    const add = h('button', { type: 'button', class: 'primary', disabled: true, onclick: () => finish(picked) }, 'Add');
    const panel = openPanel({
      key: 'rt-media-pick', kind: 'media-pick', store: ctx.store, quiet: true, size: 'medium', tone: '#3e9b5c',
      title: () => o.title ?? `Choose ${o.multi ? 'pictures' : `a ${KIND_NAME[kinds[0]!]}`}`,
      body: () => h('div', { class: 'rt-pick' },
        mediaGrid(ctx, kinds, {
          multi: o.multi, selected: picked,
          onPick: (ids) => {
            picked = ids;
            if (!o.multi) return finish(ids);
            add.disabled = ids.length === 0;
            add.textContent = ids.length ? `Add ${ids.length} ${ids.length === 1 ? 'picture' : 'pictures'}` : 'Add';
          },
        }),
        o.multi ? h('div', { class: 'row-actions' }, add) : null,
      ),
    });
    panel.dialog.addEventListener('close', () => finish(null));
  });
}

/** Choose one of the scenario's variables, or make a new one. */
export function pickVariable(ctx: FormContext, title = 'Choose a variable'): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (name: string | null) => {
      if (done) return;
      done = true;
      resolve(name);
      panel.close();
    };
    const panel = openPanel({
      key: 'rt-variable-pick', kind: 'variable-pick', store: ctx.store, quiet: true, size: 'medium', tone: '#4c9aff', title: () => title,
      body: () => {
        const rows = ctx.store.rows('variables');
        return h('div', { class: 'rt-pick-list' },
          ...rows.map((v) => h('button', { type: 'button', class: 'rt-pick-row', 'data-variable-pick': v.variable_name, onclick: () => finish(String(v.variable_name)) },
            h('code', null, `{{${v.variable_name}}}`), h('span', { class: 'muted' }, v.default_value == null || v.default_value === '' ? '' : `starts at ${v.default_value}`))),
          // The system's own variables: always there, kept up to date by the game.
          h('p', { class: 'rt-pick-head muted' }, 'Built in'),
          ...SYSTEM_VARIABLES.map((v) => h('button', { type: 'button', class: 'rt-pick-row', 'data-variable-pick': v.name, onclick: () => finish(v.name) },
            h('code', null, `{{${v.name}}}`), h('span', { class: 'muted' }, v.about))),
          h('button', {
            type: 'button', class: 'rt-pick-row rt-new',
            onclick: async () => {
              const name = window.prompt('Name of the new variable (letters, digits and underscores):')?.trim();
              if (!name) return;
              if (!/^[A-Za-z_]\w*$/.test(name)) return toast('A variable name is letters, digits and underscores, and does not start with a digit.', 'error');
              const row = await ctx.store.add('variables', { variable_name: name, default_value: '' });
              if (row) finish(String(row.variable_name));
            },
          }, '＋ New variable…'),
        );
      },
    });
    panel.dialog.addEventListener('close', () => finish(null));
  });
}

interface WordEntry { id: string | number; term?: string; definition?: string; media_id?: number | null }

/** Choose one of the scenario's glossary words. Those that match `hint` come first. */
export function pickWord(ctx: FormContext, hint: string): Promise<WordEntry | null> {
  const entries = (ctx.store.settings.glossary as WordEntry[] | undefined) ?? [];
  if (!entries.length) {
    toast('This scenario has no glossary words yet. Add some on the Glossary page first.', 'error');
    return Promise.resolve(null);
  }
  const want = hint.trim().toLowerCase();
  const sorted = [...entries].sort((a, b) => Number(String(b.term ?? '').toLowerCase().startsWith(want) && want !== '') - Number(String(a.term ?? '').toLowerCase().startsWith(want) && want !== ''));
  return new Promise((resolve) => {
    let done = false;
    const finish = (e: WordEntry | null) => {
      if (done) return;
      done = true;
      resolve(e);
      panel.close();
    };
    const panel = openPanel({
      key: 'rt-word-pick', kind: 'word-pick', store: ctx.store, quiet: true, size: 'medium', tone: '#c98500', title: () => 'Which glossary word?',
      body: () => h('div', { class: 'rt-pick-list' },
        ...sorted.map((e) => h('button', { type: 'button', class: 'rt-pick-row', 'data-word-pick': e.id, onclick: () => finish(e) },
          h('strong', null, String(e.term ?? e.id)), h('span', { class: 'muted' }, String(e.definition ?? '')))),
      ),
    });
    panel.dialog.addEventListener('close', () => finish(null));
  });
}
