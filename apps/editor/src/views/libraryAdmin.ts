import { roleLabel } from '@qbl/shared';
import { ApiError, type Api, type AssetChanges, type ContentAdmin, type LibraryFile, type ManagedAsset, type ScenarioSummary, type User } from '../api';
import { clear, confirmDelete, h, help, toast } from '../dom';
import { openPanel, type Changes } from '../panel';
import { forgetLibrary } from './questlab';

/**
 * The asset library's admin screen (#/library, #/library/{slug}), for content admins and
 * administrators: every asset, withdrawn ones too, as cards to filter and search; each opens in a
 * panel to change what it is called, who drew it, who sees it, its files and what adding it makes
 * (a character's animations, a vehicle's seat and speed). Administrators also choose the content
 * admins here. Teachers meet the same assets under "Add QuestLab Assets".
 */

const KINDS: Array<{ key: ManagedAsset['kind']; label: string; icon: string }> = [
  { key: 'character', label: 'Characters', icon: '🧑' },
  { key: 'vehicle', label: 'Vehicles', icon: '🚙' },
  { key: 'item', label: 'Items', icon: '🎒' },
  { key: 'picture', label: 'Pictures', icon: '🖼️' },
  { key: 'sound', label: 'Sounds', icon: '🔊' },
];
const KIND_NAME: Record<string, string> = { character: 'Character', vehicle: 'Vehicle', item: 'Item', picture: 'Picture', sound: 'Sound' };
const LICENSES = ['CC0', 'CC-BY 3.0', 'CC-BY 4.0', 'CC-BY-SA 3.0', 'CC-BY-SA 4.0', 'OGA-BY 3.0', 'Own work'];
const STYLES = ['pixel', 'cartoon', 'rendered', 'photo', 'painted'];
const ROLES = ['sheet', 'portrait', 'image', 'sound', 'preview', 'thumbnail'];
const SOURCE: Record<string, string> = { pack: 'Shipped with QuestLab', upload: 'Made here', scenario: 'Kept from a scenario' };

/** A small source of changes for the panels, as a scenario's Store is for the editor's. */
class Emitter implements Changes {
  private listeners = new Set<(structural: boolean) => void>();
  onChange(listener: (structural: boolean) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  emit(structural = true) {
    for (const l of [...this.listeners]) l(structural);
  }
}

const fail = (err: unknown, fallback: string) => toast(err instanceof ApiError || err instanceof Error ? err.message : fallback, 'error');

/** "0-3 5 7" → [0, 1, 2, 3, 5, 7]. */
export function parseFrames(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let i = a; a <= b ? i <= b : i >= b; i += a <= b ? 1 : -1) out.push(i);
    } else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return out;
}

/** [0, 1, 2, 3, 5] → "0-3 5". */
export function showFrames(frames: number[] | undefined): string {
  if (!frames?.length) return '';
  const out: string[] = [];
  for (let i = 0; i < frames.length; ) {
    let j = i;
    while (j + 1 < frames.length && frames[j + 1] === frames[j]! + 1) j++;
    out.push(j - i >= 2 ? `${frames[i]}-${frames[j]}` : frames.slice(i, j + 1).join(' '));
    i = j + 1;
  }
  return out.join(' ');
}

export function libraryAdminView(api: Api, me: User, opening: string | null, go: (hash: string) => void): HTMLElement {
  const changes = new Emitter();
  let assets: ManagedAsset[] = [];
  let categories: string[] = [];
  let scenarios: ScenarioSummary[] | null = null;
  const filter = { kind: 'all', status: 'active', q: '' };
  /** Unsaved changes, per asset, kept while its panel redraws. */
  const drafts = new Map<number, AssetChanges & { definition: ManagedAsset['definition'] }>();

  const grid = h('div', { class: 'grid tiles library-grid' });
  const tabs = h('div', { class: 'questlab-groups library-kinds', role: 'group', 'aria-label': 'Kinds' });
  const none = h('p', { class: 'empty', hidden: true }, 'Nothing matches.');
  const people = h('div');

  const load = async () => {
    try {
      const list = await api.libraryAll();
      assets = list.assets as ManagedAsset[];
      categories = list.categories.map((c) => c.name).filter(Boolean);
      drawList();
      changes.emit(true);
    } catch (err) {
      fail(err, 'The library could not be loaded.');
    }
  };
  const replace = (asset: ManagedAsset) => {
    forgetLibrary();
    const at = assets.findIndex((a) => a.id === asset.id);
    const used = at >= 0 ? assets[at]!.used_in : 0;
    asset.used_in ??= used;
    if (at >= 0) assets[at] = asset;
    else assets.push(asset);
    if (asset.category && !categories.includes(asset.category)) categories.push(asset.category);
    drawList();
    changes.emit(true);
  };

  // ------------------------------------------------------------------ the list

  const drawList = () => {
    const words = filter.q.toLowerCase().split(/\s+/).filter(Boolean);
    const shown = assets.filter((a) =>
      (filter.kind === 'all' || a.kind === filter.kind)
      && (filter.status === 'all' || (filter.status === 'active') === a.active)
      && words.every((w) => [a.name, a.slug, a.category, a.description, a.style, a.credit?.author, ...a.tags].join(' ').toLowerCase().includes(w)));
    clear(tabs, ...[{ key: 'all', label: 'All', icon: '📚' }, ...KINDS].map((k) => h('button', {
      type: 'button', class: `chip-button${filter.kind === k.key ? ' on' : ''}`, 'data-kind': k.key,
      onclick: () => { filter.kind = k.key; drawList(); },
    }, `${k.icon} ${k.label}`, h('span', { class: 'count' }, String(assets.filter((a) => k.key === 'all' || a.kind === k.key).length)))));
    clear(grid, ...shown.map(card));
    none.hidden = shown.length > 0;
  };

  const thumbOf = (a: ManagedAsset): string | null => (a.kind === 'character' ? a.file_urls.portrait : null) ?? a.file_urls.preview ?? a.file_urls.thumbnail ?? a.file_urls.portrait ?? a.file_urls[a.definition.file ?? ''] ?? a.file_urls.sheet ?? a.file_urls.image ?? null;

  const card = (a: ManagedAsset): HTMLElement => {
    const thumb = thumbOf(a);
    const open = () => openAsset(a.id);
    const kind = KINDS.find((k) => k.key === a.kind);
    return h('article', { class: `card tile library-tile${a.active ? '' : ' withdrawn'}`, 'data-asset': a.slug, style: '--tone: var(--tone-character)' },
      h('button', { type: 'button', class: 'tile-thumb', title: `Edit ${a.name}`, onclick: open },
        a.kind === 'sound' ? h('span', { class: 'tile-thumb-none' }, '🔊 Sound') : thumb ? h('img', { src: thumb, alt: '', loading: 'lazy' }) : h('span', { class: 'tile-thumb-none' }, 'No picture yet'),
        a.active ? null : h('span', { class: 'library-badge' }, 'Withdrawn')),
      h('div', { class: 'card-title' }, h('strong', { class: 'tile-name', title: a.name }, a.name), h('span', { class: 'muted tile-id' }, a.slug)),
      h('div', { class: 'chips' },
        h('span', { class: 'chip' }, `${kind?.icon ?? ''} ${KIND_NAME[a.kind] ?? a.kind}`),
        a.category ? h('span', { class: 'chip' }, a.category) : null,
        a.credit?.license ? h('span', { class: 'chip muted', title: a.credit.author ? `By ${a.credit.author}` : undefined }, a.credit.license) : h('span', { class: 'chip warn' }, 'No licence'),
        h('span', { class: 'chip muted', title: 'Scenarios that added it' }, `Used in ${a.used_in ?? 0}`),
        a.organization_id != null ? h('span', { class: 'chip', title: 'Only this organization’s teachers see it' }, `Org #${a.organization_id}`) : null),
      h('div', { class: 'row-actions tile-actions' }, h('button', { type: 'button', class: 'primary', 'data-open': 'edit', onclick: open }, '✏️ Edit')));
  };

  // ------------------------------------------------------------------ one asset

  const openAsset = (id: number) => {
    openPanel({
      key: `library-asset-${id}`,
      kind: 'library-asset',
      store: changes,
      size: 'wide',
      tone: 'var(--tone-character)',
      title: () => {
        const a = assets.find((x) => x.id === id);
        return a ? h('span', null, `📚 ${a.name}`, h('small', { class: 'muted' }, ` · ${a.slug}${a.active ? '' : ' · withdrawn'}`)) : null;
      },
      body: () => {
        const a = assets.find((x) => x.id === id);
        return a ? assetBody(a) : null;
      },
    });
  };

  const assetBody = (a: ManagedAsset): HTMLElement => {
    const draft = drafts.get(a.id) ?? { definition: structuredClone(a.definition ?? {}) };
    drafts.set(a.id, draft);
    const value = <K extends keyof ManagedAsset>(key: K): ManagedAsset[K] => (key in draft ? (draft as Record<string, unknown>)[key] : a[key]) as ManagedAsset[K];
    const saveButton = h('button', { type: 'button', class: 'primary', 'data-save': '' }, 'Save changes');
    const discard = h('button', { type: 'button', 'data-discard': '' }, 'Discard');
    const dirty = () => Object.keys(draft).some((k) => k !== 'definition') || JSON.stringify(draft.definition) !== JSON.stringify(a.definition ?? {});
    const mark = () => {
      saveButton.disabled = !dirty();
      discard.hidden = !dirty();
    };
    const set = (key: keyof AssetChanges, v: unknown) => {
      (draft as Record<string, unknown>)[key] = v;
      mark();
    };
    const text = (key: 'name' | 'slug' | 'category' | 'description', label: string, hint?: string, list?: string) =>
      h('label', { class: `field${key === 'description' ? ' wide' : ''}`, 'data-field': key }, h('span', { class: 'field-label' }, label, help(hint ?? null)),
        key === 'description'
          ? h('textarea', { rows: 2, value: String(value(key) ?? ''), oninput: (e: Event) => set(key, (e.target as HTMLTextAreaElement).value) })
          : h('input', { value: String(value(key) ?? ''), list: list ?? null, oninput: (e: Event) => set(key, (e.target as HTMLInputElement).value) }));
    const choose = (label: string, current: string, options: string[][], onchange: (v: string) => void, field = '') =>
      h('label', { class: 'field', 'data-field': field }, h('span', { class: 'field-label' }, label),
        h('select', { onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value) },
          ...options.map(([v, l]) => h('option', { value: v, selected: v === current }, l ?? v))));
    const credit = (): NonNullable<ManagedAsset['credit']> => (value('credit') ?? {}) as NonNullable<ManagedAsset['credit']>;
    const setCredit = (key: string, v: string) => set('credit', { ...credit(), [key]: v });
    const license = credit().license ?? '';

    saveButton.onclick = async () => {
      saveButton.disabled = true;
      try {
        const body: AssetChanges = { ...draft };
        if (JSON.stringify(draft.definition) === JSON.stringify(a.definition ?? {})) delete body.definition;
        if (typeof body.tags === 'string') body.tags = (body.tags as string).split(',').map((t) => t.trim()).filter(Boolean);
        drafts.delete(a.id);
        replace(await api.updateAsset(a.id, body));
        toast(`Saved ${String(body.name ?? a.name)}.`);
      } catch (err) {
        drafts.set(a.id, draft);
        mark();
        fail(err, 'Could not save.');
      }
    };
    discard.onclick = () => {
      drafts.delete(a.id);
      changes.emit(true);
    };

    const about = h('section', { class: 'panel-section', 'data-section': 'about', style: '--tone: var(--tone-all)' }, h('h3', { class: 'section-head' }, '📝 About'),
      h('div', { class: 'form' },
        text('name', 'Name'),
        text('slug', 'Slug', 'How it is referred to: lower-case letters, digits and dashes. Changing it does not affect scenarios that added it.'),
        choose('Kind', String(value('kind')), KINDS.map((k) => [k.key, `${k.icon} ${KIND_NAME[k.key]}`]), (v) => set('kind', v), 'kind'),
        text('category', 'Category', 'How the library groups it: Cars, Squirrels…', 'library-categories'),
        text('description', 'Description', 'One sentence on the card.'),
        h('label', { class: 'field wide', 'data-field': 'tags' }, h('span', { class: 'field-label' }, 'Tags', help('Words to find it by, separated by commas.')),
          h('input', { value: Array.isArray(value('tags')) ? (value('tags') as string[]).join(', ') : String(value('tags') ?? ''), oninput: (e: Event) => set('tags', (e.target as HTMLInputElement).value) })),
        choose('Style', String(value('style') ?? ''), [['', '—'], ...STYLES.map((s) => [s, s[0]!.toUpperCase() + s.slice(1)])], (v) => set('style', v || null), 'style'),
        h('label', { class: 'field', 'data-field': 'sequence' }, h('span', { class: 'field-label' }, 'Order', help('Lower comes first.')),
          h('input', { type: 'number', value: String(value('sequence') ?? 0), oninput: (e: Event) => set('sequence', Number((e.target as HTMLInputElement).value)) }))),
      h('datalist', { id: 'library-categories' }, ...categories.map((c) => h('option', { value: c }))));

    const credits = h('section', { class: 'panel-section', 'data-section': 'credit', style: '--tone: var(--tone-portrait)' }, h('h3', { class: 'section-head' }, '🎨 Who made it'),
      h('div', { class: 'form' },
        h('label', { class: 'field', 'data-field': 'credit-author' }, h('span', { class: 'field-label' }, 'Author'), h('input', { value: credit().author ?? '', oninput: (e: Event) => setCredit('author', (e.target as HTMLInputElement).value) })),
        h('label', { class: 'field', 'data-field': 'credit-title' }, h('span', { class: 'field-label' }, 'Title of the original'), h('input', { value: credit().title ?? '', oninput: (e: Event) => setCredit('title', (e.target as HTMLInputElement).value) })),
        choose('Licence', LICENSES.includes(license) || !license ? license : 'other', [['', '— none —'], ...LICENSES.map((l) => [l]), ['other', 'Other…']], (v) => setCredit('license', v === 'other' ? license : v), 'credit-license'),
        h('label', { class: 'field', 'data-field': 'credit-url' }, h('span', { class: 'field-label' }, 'Where it came from'), h('input', { type: 'url', placeholder: 'https://…', value: credit().url ?? '', oninput: (e: Event) => setCredit('url', (e.target as HTMLInputElement).value) })),
        h('label', { class: 'field wide', 'data-field': 'credit-note' }, h('span', { class: 'field-label' }, 'Note'), h('input', { value: credit().note ?? '', oninput: (e: Event) => setCredit('note', (e.target as HTMLInputElement).value) }))),
      license.startsWith('CC-BY') || license.startsWith('OGA-BY') ? h('p', { class: 'muted small' }, 'Teachers’ scenarios keep this credit on the media it adds; it must stay.') : null,
      !license ? h('p', { class: 'notice small' }, 'Say under which licence it may be used before offering it to teachers.') : null);

    const who = h('section', { class: 'panel-section', 'data-section': 'who', style: '--tone: var(--ok)' }, h('h3', { class: 'section-head' }, '👀 Who sees it'),
      h('label', { class: 'field check', 'data-field': 'active' },
        h('input', { type: 'checkbox', checked: Boolean(value('active')), onchange: (e: Event) => set('active', (e.target as HTMLInputElement).checked) }),
        h('span', { class: 'field-label' }, 'Offered to teachers'),
        h('small', null, 'Unticked, it is withdrawn: the editor no longer offers it. Scenarios that added it keep their copies.')),
      h('label', { class: 'field', 'data-field': 'organization_id' }, h('span', { class: 'field-label' }, 'Only for organization #', help('Empty: every teacher. A number: only the teachers of that school or district.')),
        h('input', { type: 'number', min: 1, value: value('organization_id') == null ? '' : String(value('organization_id')),
          oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; set('organization_id', v === '' ? null : Number(v)); } })),
      h('p', { class: 'muted small' }, `${SOURCE[a.source] ?? a.source}. Used in ${a.used_in ?? 0} scenario${a.used_in === 1 ? '' : 's'}.`));

    const actions = h('div', { class: 'row-actions library-save' }, saveButton, discard, h('span', { class: 'spacer' }),
      h('button', { type: 'button', class: 'danger', 'data-delete': '', onclick: async () => {
        if (!confirmDelete(`“${a.name}” from the library. Scenarios that added it keep their copies`)) return;
        try {
          await api.deleteAsset(a.id);
          drafts.delete(a.id);
          assets = assets.filter((x) => x.id !== a.id);
          forgetLibrary();
          drawList();
          changes.emit(true);
          toast(`Removed ${a.name} from the library.`);
        } catch (err) {
          fail(err, 'Could not remove it.');
        }
      } }, 'Delete'));
    mark();

    return h('div', { class: 'two-panel library-panel' },
      h('div', { class: 'panel-column' }, about, credits, who, actions),
      h('div', { class: 'panel-column' }, filesSection(a), definitionSection(a, draft, mark), tryIt(a)));
  };

  // ------------------------------------------------------------------ files

  const filesSection = (a: ManagedAsset): HTMLElement => {
    const roleInput = h('input', { list: 'library-roles', placeholder: 'role', value: a.files.length ? '' : a.kind === 'sound' ? 'sound' : a.kind === 'picture' ? 'image' : 'sheet', 'aria-label': 'Role' });
    const fileInput = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,audio/mpeg,audio/wav,audio/ogg,video/mp4,video/webm', 'aria-label': 'File' });
    const upload = h('button', { type: 'button', class: 'primary', 'data-upload': '', onclick: async () => {
      const file = fileInput.files?.[0];
      const role = roleInput.value.trim().toLowerCase();
      if (!file || !role) return toast('Choose a role and a file.', 'error');
      upload.disabled = true;
      try {
        replace(await api.uploadAssetFile(a.id, role, file));
        toast(`Added the ${role} file.`);
      } catch (err) {
        fail(err, 'Could not upload it.');
      } finally {
        upload.disabled = false;
      }
    } }, 'Upload');
    return h('section', { class: 'panel-section', 'data-section': 'files', style: '--tone: var(--tone-background)' }, h('h3', { class: 'section-head' }, '🖼️ Files'),
      a.files.length ? h('div', { class: 'library-files' }, ...a.files.map((f) => fileRow(a, f))) : h('p', { class: 'muted' }, 'No files yet.'),
      h('div', { class: 'library-upload' }, roleInput, fileInput, upload),
      h('datalist', { id: 'library-roles' }, ...ROLES.map((r) => h('option', { value: r }))),
      h('p', { class: 'muted small' }, 'A file with the same role replaces the one there. Files called preview or thumbnail only show the asset in the library; the others are copied into scenarios.'));
  };

  const fileRow = (a: ManagedAsset, f: LibraryFile): HTMLElement => {
    const sheet = f.params.sheet;
    const cols = h('input', { type: 'number', min: 1, value: String(sheet?.columns ?? ''), placeholder: '1', 'aria-label': 'Frames across' });
    const rows = h('input', { type: 'number', min: 1, value: String(sheet?.rows ?? ''), placeholder: '1', 'aria-label': 'Frames down' });
    const count = h('input', { type: 'number', min: 1, value: String(sheet?.count ?? ''), placeholder: 'all', 'aria-label': 'Frames used' });
    const anims = h('textarea', { rows: 3, spellcheck: false, 'aria-label': 'Sheet animations (JSON)', value: f.params.animations ? JSON.stringify(f.params.animations, null, 1) : '' });
    const saveParams = async () => {
      let animations: unknown;
      try {
        animations = anims.value.trim() ? JSON.parse(anims.value) : undefined;
      } catch {
        return toast('The animations are not valid JSON.', 'error');
      }
      const params: Record<string, unknown> = { ...f.params };
      if (cols.value || rows.value) params.sheet = { columns: Number(cols.value || 1), rows: Number(rows.value || 1), ...(count.value ? { count: Number(count.value) } : {}) };
      else delete params.sheet;
      if (animations) params.animations = animations;
      else delete params.animations;
      try {
        replace(await api.updateAssetFile(a.id, f.role, params));
        toast(`Saved the ${f.role} file’s settings.`);
      } catch (err) {
        fail(err, 'Could not save.');
      }
    };
    const replaceInput = h('input', { type: 'file', hidden: true, onchange: async () => {
      const file = replaceInput.files?.[0];
      if (!file) return;
      try {
        replace(await api.uploadAssetFile(a.id, f.role, file, f.params));
        toast(`Replaced the ${f.role} file.`);
      } catch (err) {
        fail(err, 'Could not replace it.');
      }
    } });
    const shown = f.type === 'audio' ? h('audio', { controls: true, src: f.url, preload: 'none' }) : f.type === 'video' ? h('video', { controls: true, src: f.url, preload: 'none' }) : h('a', { href: f.url, target: '_blank', rel: 'noopener', class: 'library-file-thumb checker' }, h('img', { src: f.url, alt: f.role, loading: 'lazy' }));
    return h('div', { class: 'library-file', 'data-role': f.role },
      shown,
      h('div', { class: 'library-file-text' },
        h('div', null, h('strong', null, f.role), ' ', h('span', { class: 'muted small' }, [f.width && f.height ? `${f.width}×${f.height}` : null, f.bytes ? `${Math.max(1, Math.round(f.bytes / 1024))} KB` : null].filter(Boolean).join(' · '))),
        f.type === 'image' ? h('div', { class: 'library-grid-fields' },
          h('span', { class: 'small' }, 'Frames across'), cols, h('span', { class: 'small' }, 'down'), rows, h('span', { class: 'small' }, 'used'), count) : null,
        f.type === 'image' ? h('details', { class: 'library-anims' }, h('summary', { class: 'small' }, `Sheet animations${f.params.animations ? ` (${f.params.animations.map((x) => x.name).join(', ')})` : ''}`),
          anims, h('p', { class: 'muted small' }, 'For items and vehicles: idle and walk play by themselves. [{"name": "walk", "frames": [1, 2, 3], "duration": 300}]')) : null,
        h('div', { class: 'row-actions' },
          f.type === 'image' ? h('button', { type: 'button', 'data-save-file': f.role, onclick: () => void saveParams() }, 'Save settings') : null,
          h('button', { type: 'button', onclick: () => replaceInput.click() }, 'Replace…'), replaceInput,
          h('button', { type: 'button', class: 'danger', onclick: async () => {
            if (!confirmDelete(`the ${f.role} file of “${a.name}”`)) return;
            try {
              replace(await api.removeAssetFile(a.id, f.role));
            } catch (err) {
              fail(err, 'Could not remove it.');
            }
          } }, 'Remove'))));
  };

  // ------------------------------------------------------------------ what adding it makes

  const definitionSection = (a: ManagedAsset, draft: { definition: ManagedAsset['definition'] }, mark: () => void): HTMLElement => {
    const def = draft.definition;
    const kind = String(((draft as AssetChanges).kind ?? a.kind));
    const roles = a.files.map((f) => f.role).filter((r) => r !== 'preview' && r !== 'thumbnail');
    const roleSelect = (current: string | undefined, onchange: (v: string) => void, label = 'File') =>
      h('select', { 'aria-label': label, onchange: (e: Event) => { onchange((e.target as HTMLSelectElement).value); mark(); } },
        h('option', { value: '' }, '— choose —'),
        ...[...new Set([...roles, ...(current ? [current] : [])])].map((r) => h('option', { value: r, selected: r === current }, roles.includes(r) ? r : `${r} (missing)`)));
    const json = h('textarea', { rows: 8, spellcheck: false, class: 'library-json', value: JSON.stringify(def, null, 1), 'aria-label': 'Definition (JSON)' });
    const useJson = h('button', { type: 'button', onclick: () => {
      try {
        const parsed = JSON.parse(json.value) as ManagedAsset['definition'];
        for (const key of Object.keys(def)) delete (def as Record<string, unknown>)[key];
        Object.assign(def, parsed);
        mark();
        changes.emit(true);
      } catch {
        toast('That is not valid JSON.', 'error');
      }
    } }, 'Use this');
    let body: HTMLElement;
    if (kind === 'character') {
      const animations = (def.animations ??= {});
      const rowsBox = h('div', { class: 'library-anim-rows' });
      const draw = () => clear(rowsBox,
        h('div', { class: 'library-anim-head small muted' }, h('span', null, 'Name'), h('span', null, 'File'), h('span', null, 'Frames'), h('span', null, 'ms'), h('span', null, 'Repeats'), h('span', null, '')),
        ...Object.entries(animations).map(([name, anim]) => h('div', { class: 'library-anim-row', 'data-animation': name },
          h('input', { value: name, 'aria-label': 'Name', onchange: (e: Event) => {
            const next = (e.target as HTMLInputElement).value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
            if (!next || next === name || animations[next]) return draw();
            const entries = Object.entries(animations).map(([k, v]) => [k === name ? next : k, v] as const);
            for (const k of Object.keys(animations)) delete animations[k];
            for (const [k, v] of entries) animations[k] = v;
            mark();
            draw();
          } }),
          roleSelect(anim.file, (v) => (anim.file = v)),
          h('input', { value: showFrames(anim.frames), placeholder: 'all', 'aria-label': 'Frames', oninput: (e: Event) => { const f = parseFrames((e.target as HTMLInputElement).value); if (f.length) anim.frames = f; else delete anim.frames; mark(); } }),
          h('input', { type: 'number', min: 1, value: anim.duration == null ? '' : String(anim.duration), 'aria-label': 'Milliseconds', oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) anim.duration = Number(v); else delete anim.duration; mark(); } }),
          h('select', { 'aria-label': 'Repeats', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v === '') delete anim.repeat; else anim.repeat = v === 'yes'; mark(); } },
            h('option', { value: '', selected: anim.repeat == null }, 'usual'), h('option', { value: 'yes', selected: anim.repeat === true }, 'loops'), h('option', { value: 'no', selected: anim.repeat === false }, 'once')),
          h('button', { type: 'button', class: 'danger icon', title: 'Remove', 'aria-label': `Remove ${name}`, onclick: () => { delete animations[name]; mark(); draw(); } }, '×'))));
      draw();
      body = h('div', null,
        h('p', { class: 'muted small' }, 'The poses (stand_right, walk_right, stand_left, walk_left, portrait) are drawn by the game by themselves; other names are moves a “Play an animation” action plays. Frames: 0 1 2 or 0-3.'),
        rowsBox,
        h('div', { class: 'row-actions' }, h('button', { type: 'button', onclick: () => {
          let name = 'stand_right';
          for (let n = 1; animations[name]; n++) name = ['stand_right', 'walk_right', 'portrait'].find((p) => !animations[p]) ?? `move_${n}`;
          animations[name] = { file: roles[0] ?? 'sheet' };
          mark();
          draw();
        } }, '+ Add animation')));
    } else if (kind === 'vehicle' || kind === 'item') {
      const item = (def.item ??= {});
      const settings = (item.settings ??= {}) as Record<string, unknown>;
      const flag = (key: string, label: string) => h('label', { class: 'field check', 'data-field': key },
        h('input', { type: 'checkbox', checked: Boolean(item[key]), onchange: (e: Event) => { item[key] = (e.target as HTMLInputElement).checked; mark(); } }), h('span', { class: 'field-label' }, label));
      const num = (key: string, label: string, hint: string, step = 1) => h('label', { class: 'field', 'data-field': key }, h('span', { class: 'field-label' }, label, help(hint)),
        h('input', { type: 'number', step, value: settings[key] == null ? '' : String(settings[key]), oninput: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v === '') delete settings[key]; else settings[key] = Number(v); mark(); } }));
      const pick = (key: string, label: string, options: string[]) => h('label', { class: 'field', 'data-field': key }, h('span', { class: 'field-label' }, label),
        h('select', { onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; if (v) settings[key] = v; else delete settings[key]; mark(); } },
          h('option', { value: '' }, '—'), ...options.map((o) => h('option', { value: o, selected: settings[key] === o }, o))));
      body = h('div', null,
        h('div', { class: 'form' },
          h('label', { class: 'field', 'data-field': 'file' }, h('span', { class: 'field-label' }, 'Picture'), roleSelect(def.file, (v) => (def.file = v || undefined))),
          num('scale', 'Scale', 'How big it is drawn: 1 is the picture’s own size.', 0.05),
          kind === 'item' ? flag('wearable', 'Wearable') : null, flag('physical', 'Physical'), flag('blocking', 'Blocking'), flag('unique', 'Unique')),
        kind === 'vehicle' || item.wearable ? h('div', { class: 'form' },
          num('attach_offset_x', 'Offset across', 'Where it sits beside the rider’s feet, in its picture’s pixels; positive is ahead.'),
          num('attach_offset_y', 'Offset down', 'Positive lowers it below the rider’s feet (a high seat), negative raises it.'),
          pick('attach_layer', 'In front of the rider or behind', ['front', 'behind']),
          pick('art_faces', 'Its picture faces', ['right', 'left']),
          num('hide_rider_below', 'Hide the rider below', 'From 0 (its top) to 1 (its bottom): the rider is not drawn below that line, so they sit in it.', 0.01),
          kind === 'vehicle' ? num('speed_multiplier', 'Speed', 'How much faster than walking.', 0.1) : null) : null);
    } else {
      body = h('div', { class: 'form' }, h('label', { class: 'field', 'data-field': 'file' }, h('span', { class: 'field-label' }, kind === 'sound' ? 'Sound' : 'Picture'), roleSelect(def.file, (v) => (def.file = v || undefined))));
    }
    return h('section', { class: 'panel-section', 'data-section': 'definition', style: '--tone: var(--tone-move)' },
      h('h3', { class: 'section-head' }, kind === 'character' ? '🎬 Animations it comes with' : kind === 'vehicle' ? '🚙 How it is ridden' : kind === 'item' ? '🎒 The item it makes' : '📄 What it adds'),
      body,
      h('details', { class: 'library-json-fold' }, h('summary', { class: 'small' }, 'Advanced: the definition as JSON'), json, h('div', { class: 'row-actions' }, useJson)));
  };

  // ------------------------------------------------------------------ try it

  const tryIt = (a: ManagedAsset): HTMLElement => {
    const select = h('select', { 'aria-label': 'Scenario' }, h('option', { value: '' }, scenarios ? '— a scenario —' : 'Loading…'));
    const fill = () => clear(select, h('option', { value: '' }, '— a scenario —'), ...(scenarios ?? []).map((s) => h('option', { value: String(s.id) }, `${s.title} (#${s.id})`)));
    if (scenarios) fill();
    else void api.list().then((list) => { scenarios = list; fill(); }, () => {});
    const add = h('button', { type: 'button', 'data-try': '', onclick: async () => {
      const id = Number(select.value);
      if (!id) return toast('Choose a scenario.', 'error');
      add.disabled = true;
      try {
        const added = await api.addLibraryAsset(a.id, id);
        toast(`Added ${added.created ? String(added.created.row.name) : a.name} to the scenario.`, 'info', { label: 'Open it', run: () => go(`#/s/${id}/${added.created?.table === 'items' ? 'items' : added.created?.table === 'characters' ? 'characters' : 'media'}`) });
      } catch (err) {
        fail(err, 'Could not add it.');
      } finally {
        add.disabled = false;
      }
    } }, 'Add to it');
    return h('section', { class: 'panel-section', 'data-section': 'try', style: '--tone: var(--ok)' }, h('h3', { class: 'section-head' }, '🧪 Try it'),
      h('p', { class: 'muted small' }, 'Add it to one of your scenarios, as a teacher would (saved changes only), to see it in a scene.'),
      h('div', { class: 'row-actions' }, select, add));
  };

  // ------------------------------------------------------------------ a new asset

  const openNew = () => {
    const draft = { kind: 'picture' as ManagedAsset['kind'], name: '', category: '' };
    const file = h('input', { type: 'file', 'aria-label': 'File' });
    const create = h('button', { type: 'button', class: 'primary', 'data-create': '' }, 'Create');
    const panel = openPanel({
      key: 'library-new', kind: 'library-new', store: changes, size: 'medium', tone: 'var(--tone-character)',
      title: () => '📚 New asset',
      body: () => h('div', null,
        h('div', { class: 'form' },
          h('label', { class: 'field', 'data-field': 'kind' }, h('span', { class: 'field-label' }, 'Kind'),
            h('select', { onchange: (e: Event) => (draft.kind = (e.target as HTMLSelectElement).value as ManagedAsset['kind']) },
              ...KINDS.map((k) => h('option', { value: k.key, selected: k.key === draft.kind }, `${k.icon} ${KIND_NAME[k.key]}`)))),
          h('label', { class: 'field', 'data-field': 'name' }, h('span', { class: 'field-label' }, 'Name'), h('input', { value: draft.name, oninput: (e: Event) => (draft.name = (e.target as HTMLInputElement).value) })),
          h('label', { class: 'field', 'data-field': 'category' }, h('span', { class: 'field-label' }, 'Category'), h('input', { list: 'library-categories-new', value: draft.category, oninput: (e: Event) => (draft.category = (e.target as HTMLInputElement).value) })),
          h('label', { class: 'field', 'data-field': 'file' }, h('span', { class: 'field-label' }, 'Its picture or sound (optional)'), file)),
        h('datalist', { id: 'library-categories-new' }, ...categories.map((c) => h('option', { value: c }))),
        h('p', { class: 'muted small' }, 'It starts withdrawn, so teachers do not see it until you tick “Offered to teachers”. To keep a character or vehicle made in a scenario, use “Keep in library” on its panel there instead: it brings its pictures and animations along.'),
        h('div', { class: 'row-actions' }, create)),
    });
    create.onclick = async () => {
      if (!draft.name.trim()) return toast('Give it a name.', 'error');
      create.disabled = true;
      try {
        const chosen = file.files?.[0];
        const role = chosen ? (chosen.type.startsWith('audio') ? 'sound' : draft.kind === 'picture' || draft.kind === 'sound' ? 'image' : 'sheet') : null;
        let asset = await api.createAsset({ kind: draft.kind, name: draft.name.trim(), category: draft.category.trim() || null, active: false,
          definition: role && draft.kind !== 'character' ? { file: role } : {} });
        if (chosen && role) asset = await api.uploadAssetFile(asset.id, role, chosen);
        asset.used_in = 0;
        replace(asset);
        panel.close();
        openAsset(asset.id);
      } catch (err) {
        fail(err, 'Could not create it.');
        create.disabled = false;
      }
    };
  };

  // ------------------------------------------------------------------ content admins (administrators only)

  const drawPeople = async () => {
    if (me.role !== 'admin') return;
    const email = h('input', { type: 'email', placeholder: 'someone@school.org', 'aria-label': 'Address' });
    const list = h('div', { class: 'library-people' }, h('p', { class: 'muted' }, 'Loading…'));
    const show = (managers: ContentAdmin[]) => clear(list, ...(managers.length ? managers.map((m) => h('div', { class: 'library-person', 'data-person': m.email },
      h('span', null, h('strong', null, m.name), ' ', h('span', { class: 'muted' }, m.email)),
      h('button', { type: 'button', class: 'danger', onclick: async () => {
        try {
          show(await api.removeContentAdmin(m.id));
          toast(`${m.name} is a teacher again.`);
        } catch (err) {
          fail(err, 'Could not change it.');
        }
      } }, 'Make a teacher again'))) : [h('p', { class: 'muted' }, 'No content admins yet.')]));
    const add = h('button', { type: 'button', class: 'primary', 'data-add-person': '', onclick: async () => {
      if (!email.value.trim()) return;
      try {
        show(await api.addContentAdmin(email.value.trim()));
        toast(`${email.value.trim()} is now a content admin.`);
        email.value = '';
      } catch (err) {
        fail(err, 'Could not make them a content admin.');
      }
    } }, 'Make content admin');
    clear(people, h('section', { class: 'card library-admins', 'data-section': 'content-admins' },
      h('h2', null, '👥 Content admins', help(`${roleLabel('content_admin')}s edit every scenario (curricular missions too) and look after this library. They have no billing, district or account powers. The account must have signed in once.`)),
      list, h('div', { class: 'row-actions' }, email, add)));
    try {
      show(await api.contentAdmins());
    } catch (err) {
      fail(err, 'Could not load the content admins.');
    }
  };

  // ------------------------------------------------------------------ the page

  const search = h('input', { type: 'search', class: 'questlab-search', placeholder: 'Search: name, tag, author…', 'aria-label': 'Search the library', oninput: (e: Event) => { filter.q = (e.target as HTMLInputElement).value; drawList(); } });
  const status = h('select', { 'aria-label': 'Which', onchange: (e: Event) => { filter.status = (e.target as HTMLSelectElement).value; drawList(); } },
    h('option', { value: 'active' }, 'Offered to teachers'), h('option', { value: 'withdrawn' }, 'Withdrawn'), h('option', { value: 'all' }, 'All'));
  const page = h('div', { class: 'page library-admin' },
    h('div', { class: 'page-head' },
      h('div', null, h('h1', null, '📚 Asset library'), h('p', { class: 'muted' }, 'Ready-made characters, vehicles, items, pictures and sounds that every teacher can add to their scenarios, under “Add QuestLab Assets”.')),
      h('div', { class: 'row-actions' }, h('button', { type: 'button', class: 'primary', 'data-new': '', onclick: openNew }, '+ New asset'))),
    h('div', { class: 'questlab-tools' }, tabs, status, search),
    grid, none, people);

  void load().then(() => {
    if (opening) {
      const found = assets.find((a) => a.slug === opening);
      if (found) openAsset(found.id);
    }
  });
  void drawPeople();
  return page;
}
