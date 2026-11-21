import { isPose, type CharacterAnimation } from '@qbl/shared';
import type { LibraryAsset, LibraryList, Row } from '../api';
import { params } from '../describe';
import { h, toast } from '../dom';
import type { FormContext } from '../fields';
import { openPanel } from '../panel';

/**
 * "Add QuestLab Assets": the asset library as a pop-up of cards, on the Characters page (animals)
 * and the Items page (vehicles and items). Each card shows the asset moving, what it can do and who
 * drew it; "Add to scenario" asks the server to copy its pictures into the scenario's media (once:
 * a second Red Squirrel shares the first one's sheet) and make the character or item, ready to
 * place in a scene. The library itself lives on the server (/api/editor/library, App\Qbl\Library).
 */

export interface QuestLabOptions {
  /** The kinds to offer: ['character'] on the Characters page, ['vehicle', 'item'] on the Items page. */
  kinds: LibraryAsset['kind'][];
  /** What one made is opened with, from the toast. */
  open?: (row: Row) => void;
}

/** The library, per set of kinds, fetched once a session (again after a failure). */
const lists = new Map<string, Promise<LibraryList>>();

export function loadLibrary(kinds: string[], store: FormContext['store']): Promise<LibraryList> {
  const key = kinds.join(',');
  let list = lists.get(key);
  if (!list) {
    list = store.api.library({ kind: key });
    lists.set(key, list);
    list.catch(() => lists.delete(key));
  }
  return list;
}

/** What each pop-up remembers between redraws: the category picked and the words searched. */
const state = new Map<string, { category: string; search: string }>();
/** Assets being added right now, so their buttons stay busy through redraws. */
const busy = new Set<string>();

const POSE_WORDS: Record<string, string> = { stand_right: 'stands', walk_right: 'walks' };
const LICENSE_NAMES: Record<string, string> = { CC0: 'CC0 (public domain)', 'CC-BY 3.0': 'CC BY 3.0', 'CC-BY 4.0': 'CC BY 4.0' };
const STYLE_NAMES: Record<string, string> = { pixel: 'Pixel art', cartoon: 'Cartoon', rendered: 'Rendered' };

export function openQuestLab(ctx: FormContext, options: QuestLabOptions) {
  const vehicles = options.kinds.includes('vehicle');
  openPanel({
    key: `questlab-${options.kinds.join('-')}`,
    kind: 'questlab-assets',
    store: ctx.store,
    size: 'wide',
    tone: vehicles ? 'var(--tone-vehicle)' : 'var(--tone-character)',
    title: () => h('span', null, '🐾 QuestLab Assets', h('small', { class: 'muted' }, vehicles ? ' · ready-made vehicles' : ' · ready-made characters')),
    body: () => libraryBody(ctx, options),
  });
}

function libraryBody(ctx: FormContext, options: QuestLabOptions): HTMLElement {
  const vehicles = options.kinds.includes('vehicle');
  const box = h('div', { class: 'questlab', 'data-kinds': options.kinds.join(',') });
  box.append(
    h('p', { class: 'questlab-intro' }, vehicles
      ? 'Cars, bikes, horses and more, ready to ride: each comes with its picture, wheels or legs that move while it is ridden, and a seat for the rider. '
      : 'Animals ready to drop into your scenario, each with its pictures, a close-up for story boxes and its animations already set up. ',
    'Adding one copies its pictures into this scenario’s media; change anything afterwards on its own panel, then place it in a scene.'),
    h('p', { class: 'muted questlab-loading' }, 'Loading the library…'),
  );
  loadLibrary(options.kinds, ctx.store).then(
    (list) => {
      box.querySelector('.questlab-loading')?.remove();
      box.append(...gallery(ctx, list, options));
    },
    (e: Error) => {
      box.querySelector('.questlab-loading')?.remove();
      box.append(h('p', { class: 'notice error' }, `The library could not be loaded: ${e.message}`));
    },
  );
  return box;
}

function gallery(ctx: FormContext, list: LibraryList, options: QuestLabOptions): HTMLElement[] {
  const key = options.kinds.join(',');
  const remembered = state.get(key) ?? { category: 'all', search: '' };
  state.set(key, remembered);
  if (!list.assets.length) return [h('p', { class: 'empty' }, 'The library has nothing of this kind yet.')];
  const cards = list.assets.map((asset) => assetCard(ctx, asset, options));
  const empty = h('p', { class: 'empty questlab-none', hidden: true }, 'Nothing matches. Try another word.');
  const tabs = h('div', { class: 'questlab-groups', role: 'group', 'aria-label': 'Kinds' });
  const filter = () => {
    const words = remembered.search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    list.assets.forEach((asset, i) => {
      const text = [asset.name, asset.slug, asset.category, asset.description, asset.style, ...asset.tags, ...moves(asset)].join(' ').toLowerCase();
      const show = (remembered.category === 'all' || asset.category === remembered.category) && words.every((w) => text.includes(w));
      cards[i]!.hidden = !show;
      if (show) shown++;
    });
    empty.hidden = shown > 0;
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.group === remembered.category);
  };
  tabs.append(...[{ name: 'all', count: list.assets.length }, ...list.categories].map(({ name, count }) => h('button', {
    type: 'button', class: 'chip-button', 'data-group': name,
    onclick: () => { remembered.category = name; filter(); },
  }, name === 'all' ? 'All' : name || 'Other', h('span', { class: 'count' }, String(count)))));
  const search = h('input', {
    type: 'search', class: 'questlab-search', value: remembered.search, 'aria-label': 'Search the library',
    placeholder: options.kinds.includes('vehicle') ? 'Search: horse, city, race…' : 'Search: bird, farm, jump…',
    oninput: () => { remembered.search = search.value; filter(); },
  });
  filter();
  return [h('div', { class: 'questlab-tools' }, tabs, search), h('div', { class: 'questlab-grid' }, ...cards), empty,
    h('p', { class: 'muted small questlab-credits' }, 'All the art is free to use: public domain (CC0) or CC BY, credited on each card and kept on the media it adds. ',
      h('a', { href: '/scenario-assets/library/CREDITS.md', target: '_blank', rel: 'noopener' }, 'All credits'))];
}

/** What an asset can do besides standing and moving: a character's own animations, a vehicle's sheet animations. */
function moves(asset: LibraryAsset): string[] {
  if (asset.kind === 'character') return Object.keys(asset.definition.animations ?? {}).filter((n) => !isPose(n));
  const sheet = asset.files.find((f) => f.role === asset.definition.file);
  return (sheet?.params.animations ?? []).map((a) => a.name).filter((n) => n !== 'idle' && n !== 'walk');
}

function assetCard(ctx: FormContext, asset: LibraryAsset, options: QuestLabOptions): HTMLElement {
  const used = madeFrom(ctx, asset);
  const credit = asset.credit;
  const vehicle = asset.kind === 'vehicle';
  const speed = Number(asset.definition.item?.settings?.speed_multiplier ?? 0);
  const preview = asset.file_urls.preview ?? asset.file_urls[asset.definition.file ?? ''] ?? asset.file_urls.sheet;
  const portrait = asset.kind === 'character' ? asset.file_urls.portrait : undefined;
  const button = h('button', { type: 'button', class: 'primary questlab-add', 'data-add': asset.slug, disabled: busy.has(asset.slug) },
    busy.has(asset.slug) ? 'Adding…' : used ? '+ Add another' : '+ Add to scenario');
  button.onclick = async () => {
    busy.add(asset.slug);
    button.disabled = true;
    button.textContent = 'Adding…';
    try {
      const added = await ctx.store.addFromLibrary(asset.slug);
      const row = added?.created?.row;
      if (row) {
        const what = vehicle || asset.kind === 'item' ? 'items' : 'characters';
        toast(`${String(row.name)} is now one of your ${what}. Place it in a scene${vehicle ? ' to ride it' : ''}.`, 'info',
          options.open ? { label: 'Open it', run: () => options.open!(row) } : undefined);
      }
    } finally {
      busy.delete(asset.slug);
      ctx.store.emit(true); // redraw the cards: this one now counts what was added
    }
  };
  const chips = asset.kind === 'character'
    ? Object.keys(POSE_WORDS).filter((n) => asset.definition.animations?.[n]).map((n) => h('span', { class: 'chip pose set', 'data-tone': n.startsWith('walk') ? 'walk' : 'stand' }, POSE_WORDS[n]!))
    : [h('span', { class: 'chip pose set', 'data-tone': 'walk' }, vehicle ? 'rides' : 'item'),
      speed ? h('span', { class: 'chip pose set', 'data-tone': 'stand', title: 'How much faster than walking' }, `×${speed} speed`) : null];
  return h('article', { class: `questlab-card style-${asset.style ?? 'other'} kind-${asset.kind}`, 'data-asset': asset.slug, 'data-group': asset.category ?? '' },
    h('div', { class: 'questlab-photo' },
      preview ? h('img', { class: 'questlab-walk', src: preview, alt: `${asset.name}, moving`, loading: 'lazy', decoding: 'async' }) : null,
      portrait ? h('img', { class: 'questlab-portrait', src: portrait, alt: `${asset.name}, close-up`, loading: 'lazy', decoding: 'async' }) : null,
      used ? h('span', { class: 'questlab-used', title: 'Made from it in this scenario' }, `✓ ${used} in this scenario`) : null),
    h('div', { class: 'questlab-text' },
      h('div', { class: 'questlab-name' }, h('strong', null, asset.name), asset.category ? h('span', { class: 'chip' }, asset.category) : null),
      asset.description ? h('p', { class: 'questlab-about' }, asset.description) : null,
      h('div', { class: 'chips questlab-moves' },
        ...chips,
        ...moves(asset).map((n) => h('span', { class: 'chip pose set', 'data-tone': 'move', title: `Play it with a “Play an animation” action: ${n}` }, n)),
        asset.style ? h('span', { class: 'chip muted' }, STYLE_NAMES[asset.style] ?? asset.style) : null),
      credit?.author ? h('p', { class: 'questlab-credit' }, 'Art: ',
        credit.url ? h('a', { href: credit.url, target: '_blank', rel: 'noopener' }, credit.author) : credit.author,
        credit.license ? ` · ${LICENSE_NAMES[credit.license] ?? credit.license}` : '') : null,
      button));
}

/** How many of the scenario's characters or items were made from this asset (they use its copied pictures). */
export function madeFrom(ctx: FormContext, asset: LibraryAsset): number {
  const { store } = ctx;
  const copies = new Set(store.rows('media').filter((m) => (params(m).library as { asset?: string } | undefined)?.asset === asset.slug).map((m) => m.id));
  if (!copies.size) return 0;
  if (asset.kind === 'character') {
    return store.rows('characters').filter((row) => {
      const animations = params(row, 'settings').animations as Record<string, CharacterAnimation> | undefined;
      return !!animations && Object.values(animations).some((a) => copies.has(a?.media_id));
    }).length;
  }
  if (asset.kind === 'vehicle' || asset.kind === 'item') return store.rows('items').filter((row) => copies.has(Number(row.media_id))).length;
  return copies.size;
}
