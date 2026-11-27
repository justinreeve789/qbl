import {
  cleanNotebook, notebookContents, notebookId, pageDepth, pageDescendants, pageHeight, NOTEBOOK_COLORS, NOTEBOOK_ICONS, NOTEBOOK_LIMITS,
  type NoteCard, type NoteCardKind, type Notebook, type NotebookColor, type NotebookPage,
} from '@qbl/shared';

/** Where a notebook is kept: the API (App\Qbl\Notebooks), the browser for offline play, or memory for a preview. */
export interface NotebookBackend {
  load(): Promise<Notebook>;
  /** `leaving`: the page is being left, so the request must outlive it. */
  save(notebook: Notebook, o: { leaving: boolean }): Promise<void>;
}

/**
 * What the notebook can say about keeping what was written: `loading` until it is open,
 * `unloaded` when it could not be fetched (nothing can be written then, so that nothing is lost),
 * `saved`, `waiting` (changed, to be kept in a moment), `saving`, and `failed` (it tries again).
 */
export type NotebookState = 'loading' | 'unloaded' | 'saved' | 'waiting' | 'saving' | 'failed';

/** Where a dragged page lands: before or after another, or as that page's last subpage. */
export type PagePlace = 'before' | 'after' | 'inside';

type PagePatch = Partial<Pick<NotebookPage, 'title' | 'text' | 'icon' | 'color'>>;
type CardPatch = Partial<Pick<NoteCard, 'text' | 'back' | 'done' | 'color'>>;

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const RETRY_MS = [3000, 8000, 20_000, 45_000];
/** The pictures new pages take in turn (all among NOTEBOOK_ICONS). */
const FIRST_ICONS = ['📝', '⭐', '🌈', '🚀', '🌻', '🐸', '💡', '🎨'] as const;

/**
 * The player's notebook for this scenario (see packages/shared/src/notebook.ts): what is written
 * in it, the changes the notebook's pages make, and keeping them. Changes are kept a moment after
 * the last one (so typing is not sent letter by letter), all at once, one request at a time; one
 * that fails is tried again. `flush` keeps what is waiting at once, as when the page is left.
 *
 * Session-long, on GameContext as `notebook`. The view (ui/notebook) only draws it and calls these.
 */
export class NotebookModel {
  doc: Notebook = { pages: [] };
  state: NotebookState = 'loading';
  /** Why it could not be opened or kept, for the player. */
  problem = '';
  private loading: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private changedSinceSave = false;
  private failures = 0;
  private listeners = new Set<(what: 'doc' | 'state') => void>();

  constructor(
    private backend: NotebookBackend,
    private o: { delayMs?: number; now?: () => number } = {},
  ) {}

  private get now(): number {
    return (this.o.now ?? Date.now)();
  }

  /** Fetch the notebook, once (again after a failure). */
  load(): Promise<void> {
    if (this.state !== 'loading' && this.state !== 'unloaded') return Promise.resolve();
    if (this.loading) return this.loading;
    this.setState('loading');
    this.loading = this.backend.load().then(
      (raw) => {
        this.doc = cleanNotebook(raw, this.now);
        this.loading = null;
        this.problem = '';
        this.setState('saved');
        this.emit('doc');
      },
      (e: unknown) => {
        this.loading = null;
        this.problem = e instanceof Error ? e.message : String(e);
        this.setState('unloaded');
      },
    );
    return this.loading;
  }

  /** Whether the player may write: only once what was kept before is here. */
  get ready(): boolean {
    return this.state !== 'loading' && this.state !== 'unloaded';
  }

  onChange(listener: (what: 'doc' | 'state') => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(what: 'doc' | 'state') {
    for (const l of [...this.listeners]) l(what);
  }

  private setState(state: NotebookState) {
    if (this.state === state) return;
    this.state = state;
    this.emit('state');
  }

  // ------------------------------------------------------------------ reading

  page(id: string | null | undefined): NotebookPage | undefined {
    return id == null ? undefined : this.doc.pages.find((p) => p.id === id);
  }

  contents() {
    return notebookContents(this.doc);
  }

  depth(id: string): number {
    return pageDepth(this.doc, id);
  }

  /** The pages directly under a page (or the pages of their own, for null), in order. */
  children(parent: string | null): NotebookPage[] {
    return this.doc.pages.filter((p) => p.parent === parent);
  }

  /** How many pages would go if this one were thrown away: it and every page under it. */
  family(id: string): number {
    return 1 + pageDescendants(this.doc, id).length;
  }

  get full(): boolean {
    return this.doc.pages.length >= NOTEBOOK_LIMITS.pages;
  }

  /** Whether a subpage can be added under this page. */
  canAddUnder(id: string): boolean {
    return !this.full && this.depth(id) < NOTEBOOK_LIMITS.depth - 1;
  }

  // ------------------------------------------------------------------ pages

  /**
   * A new page: of its own (`parent` null), at the end, or as the last subpage of a page.
   * Null when the notebook is full or the page would be too deep. With `quiet`, the change is not
   * kept until something else changes (the first page of an empty notebook, made on opening it).
   */
  addPage(parent: string | null = null, o: { title?: string; icon?: string; quiet?: boolean } = {}): NotebookPage | null {
    if (!this.ready || this.full || (parent != null && !this.canAddUnder(parent))) return null;
    const at = iso(this.now);
    const siblings = this.children(parent).length;
    const page: NotebookPage = {
      id: notebookId(),
      parent,
      title: o.title ?? '',
      // A page of its own gets a picture of its own, so pages can be told apart without reading.
      icon: o.icon ?? (parent ? this.page(parent)!.icon : FIRST_ICONS[this.children(null).length % FIRST_ICONS.length]!),
      // Pages of their own take the next colour round, so the tabs differ; subpages share their page's.
      color: parent ? this.page(parent)!.color : NOTEBOOK_COLORS[(siblings + 1) % NOTEBOOK_COLORS.length]!,
      text: '',
      cards: [],
      created_at: at,
      updated_at: at,
    };
    // After the last page under the parent (its subpages' subpages too), so the contents read in order.
    const under = parent ? [parent, ...pageDescendants(this.doc, parent)] : null;
    let index = this.doc.pages.length;
    if (under) {
      const last = Math.max(...under.map((id) => this.doc.pages.findIndex((p) => p.id === id)));
      index = last + 1;
    }
    this.doc.pages.splice(index, 0, page);
    this.changed(!o.quiet);
    return page;
  }

  updatePage(id: string, patch: PagePatch): void {
    const page = this.page(id);
    if (!page || !this.ready) return;
    let any = false;
    for (const key of Object.keys(patch) as Array<keyof PagePatch>) {
      const value = patch[key];
      if (value == null || page[key] === value) continue;
      if (key === 'color' && !(NOTEBOOK_COLORS as readonly string[]).includes(value)) continue;
      if (key === 'icon' && !(NOTEBOOK_ICONS as readonly string[]).includes(value)) continue;
      const max = key === 'title' ? NOTEBOOK_LIMITS.title : key === 'text' ? NOTEBOOK_LIMITS.text : Infinity;
      const chars = Array.from(value);
      (page as unknown as Record<string, string>)[key] = chars.length > max ? chars.slice(0, max).join('') : value;
      any = true;
    }
    if (!any) return;
    page.updated_at = iso(this.now);
    // A subpage follows its page's colour.
    if (patch.color) for (const sub of pageDescendants(this.doc, id)) this.page(sub)!.color = patch.color;
    this.changed();
  }

  /** Throw a page away, and every page under it. Returns the page to show instead, if any. */
  deletePage(id: string): string | null {
    const page = this.page(id);
    if (!page || !this.ready) return null;
    const gone = new Set([id, ...pageDescendants(this.doc, id)]);
    const siblings = this.children(page.parent);
    const at = siblings.findIndex((p) => p.id === id);
    const next = siblings[at + 1] ?? siblings[at - 1] ?? this.page(page.parent) ?? null;
    this.doc.pages = this.doc.pages.filter((p) => !gone.has(p.id));
    this.changed();
    return next?.id ?? this.doc.pages[0]?.id ?? null;
  }

  /** Swap a page with the one before (-1) or after (+1) it among its siblings, subpages and all. */
  movePage(id: string, by: -1 | 1): boolean {
    const page = this.page(id);
    if (!page || !this.ready) return false;
    const siblings = this.children(page.parent);
    const other = siblings[siblings.findIndex((p) => p.id === id) + by];
    if (!other) return false;
    return this.placePage(id, other.id, by < 0 ? 'before' : 'after');
  }

  /** Make a page a subpage of the page before it (its last subpage). */
  indentPage(id: string): boolean {
    const page = this.page(id);
    if (!page || !this.ready) return false;
    const siblings = this.children(page.parent);
    const before = siblings[siblings.findIndex((p) => p.id === id) - 1];
    return before ? this.placePage(id, before.id, 'inside') : false;
  }

  /** Make a subpage a page beside its parent, just after it. */
  outdentPage(id: string): boolean {
    const page = this.page(id);
    return page?.parent ? this.placePage(id, page.parent, 'after') : false;
  }

  /** Whether a page can go there: not into itself or a page under it, and not too deep. */
  canPlace(id: string, target: string, where: PagePlace): boolean {
    const page = this.page(id);
    const to = this.page(target);
    if (!page || !to || id === target || pageDescendants(this.doc, id).includes(target)) return false;
    const depth = where === 'inside' ? this.depth(target) + 1 : this.depth(target);
    return depth + pageHeight(this.doc, id) < NOTEBOOK_LIMITS.depth;
  }

  /** Move a page, with its subpages, before or after another page, or into it as its last subpage. */
  placePage(id: string, target: string, where: PagePlace): boolean {
    if (!this.ready || !this.canPlace(id, target, where)) return false;
    const page = this.page(id)!;
    const moving = new Set([id, ...pageDescendants(this.doc, id)]);
    const block = this.doc.pages.filter((p) => moving.has(p.id));
    const rest = this.doc.pages.filter((p) => !moving.has(p.id));
    const to = this.page(target)!;
    page.parent = where === 'inside' ? target : to.parent;
    let index: number;
    if (where === 'before') {
      index = rest.findIndex((p) => p.id === target);
    } else {
      // After the target and everything under it (into it: as its last subpage, which is the same place).
      const under = new Set([target, ...pageDescendants({ pages: rest }, target)]);
      index = Math.max(...rest.map((p, i) => (under.has(p.id) ? i : -1))) + 1;
    }
    rest.splice(index, 0, ...block);
    this.doc.pages = rest;
    // Into another page: it takes that page's colour, as subpages do.
    if (page.parent) for (const p of block) p.color = this.page(page.parent)!.color;
    this.changed();
    return true;
  }

  // ------------------------------------------------------------------ notecards

  addCard(pageId: string, kind: NoteCardKind, color?: NotebookColor): NoteCard | null {
    const page = this.page(pageId);
    if (!page || !this.ready || page.cards.length >= NOTEBOOK_LIMITS.cards) return null;
    const at = iso(this.now);
    const card: NoteCard = {
      id: notebookId(), kind, text: '',
      // Each new card takes the next colour round, so a page of them is cheerful.
      color: color ?? NOTEBOOK_COLORS[page.cards.length % NOTEBOOK_COLORS.length]!,
      created_at: at, updated_at: at,
    };
    if (kind === 'flash') card.back = '';
    if (kind === 'check') card.done = false;
    page.cards.push(card);
    page.updated_at = at;
    this.changed();
    return card;
  }

  card(pageId: string, cardId: string): NoteCard | undefined {
    return this.page(pageId)?.cards.find((c) => c.id === cardId);
  }

  updateCard(pageId: string, cardId: string, patch: CardPatch): void {
    const page = this.page(pageId);
    const card = this.card(pageId, cardId);
    if (!page || !card || !this.ready) return;
    let any = false;
    if (patch.text != null && patch.text !== card.text) {
      card.text = Array.from(patch.text).slice(0, NOTEBOOK_LIMITS.card).join('');
      any = true;
    }
    if (patch.back != null && card.kind === 'flash' && patch.back !== card.back) {
      card.back = Array.from(patch.back).slice(0, NOTEBOOK_LIMITS.card).join('');
      any = true;
    }
    if (patch.done != null && card.kind === 'check' && patch.done !== card.done) {
      card.done = patch.done;
      any = true;
    }
    if (patch.color && (NOTEBOOK_COLORS as readonly string[]).includes(patch.color) && patch.color !== card.color) {
      card.color = patch.color;
      any = true;
    }
    if (!any) return;
    card.updated_at = page.updated_at = iso(this.now);
    this.changed();
  }

  deleteCard(pageId: string, cardId: string): void {
    const page = this.page(pageId);
    if (!page || !this.ready || !page.cards.some((c) => c.id === cardId)) return;
    page.cards = page.cards.filter((c) => c.id !== cardId);
    page.updated_at = iso(this.now);
    this.changed();
  }

  /** Move a card one place earlier (-1) or later (+1) on its page. */
  moveCard(pageId: string, cardId: string, by: -1 | 1): boolean {
    const cards = this.page(pageId)?.cards;
    const at = cards?.findIndex((c) => c.id === cardId) ?? -1;
    if (!cards || at < 0 || !cards[at + by] || !this.ready) return false;
    [cards[at], cards[at + by]] = [cards[at + by]!, cards[at]!];
    this.changed();
    return true;
  }

  /** Put a card before another (or last, with null), on the same page or another one. */
  placeCard(fromPage: string, cardId: string, toPage: string, before: string | null = null): boolean {
    const from = this.page(fromPage);
    const to = this.page(toPage);
    const card = this.card(fromPage, cardId);
    if (!from || !to || !card || !this.ready || before === cardId) return false;
    if (from !== to && to.cards.length >= NOTEBOOK_LIMITS.cards) return false;
    from.cards = from.cards.filter((c) => c.id !== cardId);
    const index = before ? to.cards.findIndex((c) => c.id === before) : -1;
    to.cards.splice(index < 0 ? to.cards.length : index, 0, card);
    if (from !== to) from.updated_at = to.updated_at = iso(this.now);
    this.changed();
    return true;
  }

  // ------------------------------------------------------------------ keeping

  /** Something changed: draw it, and keep it in a moment (`keep` false: draw it only). */
  private changed(keep = true) {
    this.emit('doc');
    if (!keep) return;
    this.changedSinceSave = true;
    if (this.state !== 'saving' && this.state !== 'failed') this.setState('waiting');
    this.schedule(this.o.delayMs ?? 1200);
  }

  private schedule(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.save(false);
    }, ms);
  }

  /** Keep what is waiting now: when the notebook is closed, or (`leaving`) the page is left. */
  flush(leaving = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    return this.save(leaving);
  }

  /** Whether something written is not kept yet. */
  get unsaved(): boolean {
    return this.changedSinceSave || this.state === 'saving';
  }

  private async save(leaving: boolean): Promise<void> {
    if (this.inFlight) {
      // One at a time: what changed meanwhile goes in the next one.
      await this.inFlight.catch(() => undefined);
      if (this.inFlight) return this.inFlight;
    }
    if (!this.changedSinceSave || !this.ready) return;
    this.changedSinceSave = false;
    this.setState('saving');
    const snapshot = JSON.parse(JSON.stringify(this.doc)) as Notebook;
    this.inFlight = this.backend.save(snapshot, { leaving }).then(
      () => {
        this.inFlight = null;
        this.failures = 0;
        this.problem = '';
        if (this.changedSinceSave) {
          this.setState('waiting');
          this.schedule(this.o.delayMs ?? 1200);
        } else {
          this.setState('saved');
        }
      },
      (e: unknown) => {
        this.inFlight = null;
        this.changedSinceSave = true;
        this.problem = e instanceof Error ? e.message : String(e);
        this.setState('failed');
        this.schedule(RETRY_MS[Math.min(this.failures++, RETRY_MS.length - 1)]!);
      },
    );
    return this.inFlight;
  }

  /** Stop trying: the game is over. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}

/** A notebook kept in memory: a preview's, where nothing is saved. */
export function memoryNotebook(start: Notebook = { pages: [] }): NotebookBackend {
  let kept = JSON.stringify(start);
  return {
    load: async () => JSON.parse(kept) as Notebook,
    save: async (nb) => void (kept = JSON.stringify(nb)),
  };
}

/** A notebook kept in this browser: offline play, with no API to keep it. */
export function browserNotebook(key: string): NotebookBackend {
  const storeKey = `qbl.notebook.${key}`;
  return {
    load: async () => {
      try {
        return JSON.parse(localStorage.getItem(storeKey) ?? '{"pages":[]}') as Notebook;
      } catch {
        return { pages: [] };
      }
    },
    save: async (nb) => {
      try {
        localStorage.setItem(storeKey, JSON.stringify(nb));
      } catch {
        throw new Error('This browser has no room to keep the notebook.');
      }
    },
  };
}
