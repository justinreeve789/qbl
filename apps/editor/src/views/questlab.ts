import { isPose, type CharacterAnimation } from '@qbl/shared';
import type { Row } from '../api';
import { params } from '../describe';
import { h, toast } from '../dom';
import type { FormContext } from '../fields';
import { openPanel } from '../panel';

/**
 * The QuestLab asset library: ready-made characters (animals, for now) that anyone can add to a
 * scenario from the Characters page. The pictures are part of the editor's own files
 * (public/questlab-assets, built by tools/make-questlab-assets.py from openly licensed art); adding
 * one copies its sprite sheet and close-up into the scenario's media, so the scenario stays whole
 * when it is exported, and makes a character whose animations are already picked. Everything can
 * be changed afterwards like any other character.
 *
 * A picture already copied into the scenario (its media says which asset it came from) is used
 * again rather than copied twice, so adding a second squirrel shares the first one's sheet.
 */

export interface QuestLabAnimation {
  frames: number[];
  duration: number;
  repeat?: boolean;
}

export interface QuestLabCredit {
  title: string;
  author: string;
  license: string;
  url: string;
  note?: string;
}

export interface QuestLabCharacter {
  id: string;
  name: string;
  group: string;
  about: string;
  style: 'pixel' | 'cartoon';
  tags: string[];
  sheet: { file: string; columns: number; rows: number; count: number; frame_width: number; frame_height: number };
  portrait: string;
  preview: string;
  animations: Record<string, QuestLabAnimation>;
  credit: QuestLabCredit;
}

export interface QuestLabLibrary {
  version: number;
  groups: string[];
  characters: QuestLabCharacter[];
}

/** Where the library is served: beside the editor (Vite's base, /editor/). */
const BASE = `${((import.meta.env ?? {}) as { BASE_URL?: string }).BASE_URL ?? '/editor/'}questlab-assets/`;
export const questLabUrl = (file: string) => BASE + file;

let library: Promise<QuestLabLibrary> | null = null;

export function loadQuestLab(): Promise<QuestLabLibrary> {
  library ??= fetch(questLabUrl('index.json'), { cache: 'no-cache' }).then(async (res) => {
    if (!res.ok) throw new Error(`The asset library could not be loaded (${res.status}).`);
    return (await res.json()) as QuestLabLibrary;
  });
  library.catch(() => (library = null)); // try again next time
  return library;
}

/** What the library pop-up remembers between redraws. */
const state = { group: 'all', search: '' };
/** Assets being added right now, so their buttons stay busy through redraws. */
const busy = new Set<string>();

const POSE_WORDS: Record<string, string> = { stand_right: 'stands', walk_right: 'walks' };
const LICENSE_NAMES: Record<string, string> = { CC0: 'CC0 (public domain)', 'CC-BY 4.0': 'CC BY 4.0' };

/** Open the library. `added` is told about each character made, to open it, say. */
export function openQuestLab(ctx: FormContext, added?: (row: Row) => void) {
  openPanel({
    key: 'questlab-assets',
    kind: 'questlab-assets',
    store: ctx.store,
    size: 'wide',
    tone: 'var(--tone-character)',
    title: () => h('span', null, '🐾 QuestLab Assets', h('small', { class: 'muted' }, ' · ready-made characters')),
    body: () => libraryBody(ctx, added),
  });
}

function libraryBody(ctx: FormContext, added?: (row: Row) => void): HTMLElement {
  const box = h('div', { class: 'questlab' });
  const intro = h('p', { class: 'questlab-intro' },
    'Animals ready to drop into your scenario, each with its pictures, a close-up for story boxes and its animations already set up. ',
    'Adding one copies its pictures into this scenario’s media; change anything afterwards on its own panel, then place it in a scene.');
  box.append(intro, h('p', { class: 'muted questlab-loading' }, 'Loading the library…'));
  loadQuestLab().then(
    (lib) => {
      box.querySelector('.questlab-loading')?.remove();
      box.append(...gallery(ctx, lib, added));
    },
    (e: Error) => {
      box.querySelector('.questlab-loading')?.remove();
      box.append(h('p', { class: 'notice error' }, e.message));
    },
  );
  return box;
}

function gallery(ctx: FormContext, lib: QuestLabLibrary, added?: (row: Row) => void): HTMLElement[] {
  const cards = lib.characters.map((asset) => assetCard(ctx, asset, added));
  const empty = h('p', { class: 'empty questlab-none', hidden: true }, 'Nothing matches. Try another word.');
  const filter = () => {
    const words = state.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    lib.characters.forEach((asset, i) => {
      const text = [asset.name, asset.group, asset.about, asset.style, ...asset.tags, ...Object.keys(asset.animations)].join(' ').toLowerCase();
      const show = (state.group === 'all' || asset.group === state.group) && words.every((w) => text.includes(w));
      cards[i]!.hidden = !show;
      if (show) shown++;
    });
    empty.hidden = shown > 0;
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.group === state.group);
  };
  const count = (group: string) => lib.characters.filter((c) => group === 'all' || c.group === group).length;
  const tabs = h('div', { class: 'questlab-groups', role: 'group', 'aria-label': 'Kinds of character' },
    ...['all', ...lib.groups].map((group) => h('button', {
      type: 'button', class: 'chip-button', 'data-group': group,
      onclick: () => { state.group = group; filter(); },
    }, group === 'all' ? 'All' : group, h('span', { class: 'count' }, String(count(group))))));
  const search = h('input', {
    type: 'search', class: 'questlab-search', placeholder: 'Search: bird, farm, jump…', value: state.search, 'aria-label': 'Search the library',
    oninput: () => { state.search = search.value; filter(); },
  });
  const grid = h('div', { class: 'questlab-grid' }, ...cards);
  filter();
  return [h('div', { class: 'questlab-tools' }, tabs, search), grid, empty,
    h('p', { class: 'muted small questlab-credits' }, 'All the art is free to use: public domain (CC0) or CC BY, credited on each card and kept on the media it adds. ',
      h('a', { href: questLabUrl('CREDITS.md'), target: '_blank', rel: 'noopener' }, 'All credits'))];
}

function assetCard(ctx: FormContext, asset: QuestLabCharacter, added?: (row: Row) => void): HTMLElement {
  const used = charactersFrom(ctx, asset.id);
  const moves = Object.keys(asset.animations).filter((n) => !isPose(n));
  const credit = asset.credit;
  const button = h('button', { type: 'button', class: 'primary questlab-add', 'data-add': asset.id, disabled: busy.has(asset.id) },
    busy.has(asset.id) ? 'Adding…' : used ? '+ Add another' : '+ Add to scenario');
  button.onclick = async () => {
    busy.add(asset.id);
    button.disabled = true;
    button.textContent = 'Adding…';
    try {
      const row = await addQuestLabCharacter(ctx, asset);
      if (row) {
        toast(`${row.name} is now one of your characters. Place it in a scene to meet it.`, 'info', added ? { label: 'Open it', run: () => added(row) } : undefined);
      }
    } catch (e) {
      toast(`${asset.name} could not be added: ${(e as Error).message}`, 'error');
    } finally {
      busy.delete(asset.id);
      ctx.store.emit(true); // redraw the cards: this one now counts what was added
    }
  };
  return h('article', { class: `questlab-card style-${asset.style}`, 'data-asset': asset.id, 'data-group': asset.group },
    h('div', { class: 'questlab-photo' },
      h('img', { class: 'questlab-walk', src: questLabUrl(asset.preview), alt: `${asset.name}, moving`, loading: 'lazy', decoding: 'async' }),
      h('img', { class: 'questlab-portrait', src: questLabUrl(asset.portrait), alt: `${asset.name}, close-up`, loading: 'lazy', decoding: 'async' }),
      used ? h('span', { class: 'questlab-used', title: 'Characters made from it in this scenario' }, `✓ ${used} in this scenario`) : null),
    h('div', { class: 'questlab-text' },
      h('div', { class: 'questlab-name' }, h('strong', null, asset.name), h('span', { class: 'chip' }, asset.group)),
      h('p', { class: 'questlab-about' }, asset.about),
      h('div', { class: 'chips questlab-moves' },
        ...Object.keys(POSE_WORDS).filter((n) => asset.animations[n]).map((n) => h('span', { class: 'chip pose set', 'data-tone': n.startsWith('walk') ? 'walk' : 'stand' }, POSE_WORDS[n]!)),
        ...moves.map((n) => h('span', { class: 'chip pose set', 'data-tone': 'move', title: `Play it with a “Play an animation” action: ${n}` }, n)),
        h('span', { class: 'chip muted' }, asset.style === 'pixel' ? 'Pixel art' : 'Cartoon')),
      h('p', { class: 'questlab-credit' }, 'Art: ',
        h('a', { href: credit.url, target: '_blank', rel: 'noopener' }, credit.author), ` · ${LICENSE_NAMES[credit.license] ?? credit.license}`),
      button));
}

// ---------------------------------------------------------------------------- adding

/** The key a copied picture carries in its media params, naming the asset and which picture of it. */
const pictureKey = (asset: QuestLabCharacter, part: 'sheet' | 'portrait') => `${asset.id}/${part}`;

/** How many of the scenario's characters were made from this asset (they draw on its sheet). */
export function charactersFrom(ctx: FormContext, assetId: string): number {
  const { store } = ctx;
  const sheets = new Set(store.rows('media').filter((m) => params(m).questlab === `${assetId}/sheet`).map((m) => m.id));
  if (!sheets.size) return 0;
  return store.rows('characters').filter((row) => {
    const animations = params(row, 'settings').animations as Record<string, CharacterAnimation> | undefined;
    return !!animations && Object.values(animations).some((a) => sheets.has(a?.media_id));
  }).length;
}

/**
 * Add one of the library's characters to the scenario: its pictures (copied once) and a new
 * character drawn from them, named after it ("Red Squirrel 2" when the name is taken).
 */
export async function addQuestLabCharacter(ctx: FormContext, asset: QuestLabCharacter): Promise<Row | undefined> {
  const { store } = ctx;
  const sheet = await picture(ctx, asset, 'sheet');
  const portrait = await picture(ctx, asset, 'portrait');
  const animations: Record<string, CharacterAnimation> = {};
  for (const [name, a] of Object.entries(asset.animations)) {
    animations[name] = { media_id: sheet.id, frames: [...a.frames], duration: a.duration, ...(a.repeat != null ? { repeat: a.repeat } : {}) };
  }
  animations.portrait = { media_id: portrait.id };
  const taken = new Set(store.rows('characters').map((r) => String(r.name ?? '').toLowerCase()));
  let name = asset.name;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${asset.name} ${n}`;
  return store.add('characters', { name, settings: { animations } });
}

/** The scenario's copy of one of an asset's pictures: the one already there, or a new upload. */
async function picture(ctx: FormContext, asset: QuestLabCharacter, part: 'sheet' | 'portrait'): Promise<Row> {
  const { store } = ctx;
  const key = pictureKey(asset, part);
  const existing = store.rows('media').find((m) => m.type === 'image' && params(m).questlab === key);
  if (existing) return existing;
  const res = await fetch(questLabUrl(part === 'sheet' ? asset.sheet.file : asset.portrait));
  if (!res.ok) throw new Error(`its ${part === 'sheet' ? 'pictures' : 'close-up'} could not be fetched (${res.status})`);
  const file = new File([await res.blob()], `${asset.id}-${part}.png`, { type: 'image/png' });
  const row = await store.api.upload(store.scenarioId, file);
  store.bundle.media.push(row);
  const extra: Record<string, unknown> = {
    category: 'character',
    questlab: key,
    credit: { ...asset.credit },
  };
  if (part === 'sheet') extra.sheet = { columns: asset.sheet.columns, rows: asset.sheet.rows, count: asset.sheet.count };
  await store.patch('media', row.id, { params: { ...params(row), ...extra } });
  return store.byId('media', row.id) ?? row;
}
