/**
 * The player's notebook: their own notes for one scenario, opened from the 📒 button in the game.
 * A notebook holds pages; a page can hold subpages (up to NOTEBOOK_LIMITS.depth deep) and notecards:
 * sticky notes, flip cards (a front and a back) and things to check off. Pages and cards keep when
 * they were written and last changed, which the notebook shows in small print.
 *
 * Notes belong to the player and to one instance of one scenario (the public game, an assignment's,
 * a team's), like their save: the API keeps them (App\Qbl\NotebookStore) and deletes them when the
 * teacher starts the player's game again. Nobody else reads them in the game.
 *
 * `cleanNotebook` is what the game and the server both apply to a notebook before keeping it. The
 * server has its own copy in App\Qbl\NotebookStore::clean: the two must agree.
 */

export const NOTEBOOK_LIMITS = {
  /** Pages in one notebook, subpages included. */
  pages: 50,
  /** How deep pages go: a page, its subpages, and theirs. */
  depth: 3,
  /** Notecards on one page. */
  cards: 30,
  /** Characters (code points) in a page's title. */
  title: 60,
  /** Characters in what is written on a page. */
  text: 5000,
  /** Characters on one side of a notecard. */
  card: 240,
} as const;

/** The colours a page's tab and a notecard can be. The game draws each name in its own colour. */
export const NOTEBOOK_COLORS = ['sun', 'sky', 'mint', 'rose', 'grape', 'peach'] as const;
export type NotebookColor = (typeof NOTEBOOK_COLORS)[number];

/** The pictures a page can have beside its title (so a page can be found without reading). */
export const NOTEBOOK_ICONS = [
  '📝', '⭐', '❤️', '🌈', '🌻', '🌳', '🐞', '🦋', '🐸', '🐶', '🐱', '🐠',
  '🚀', '🌙', '☀️', '🔬', '🧪', '🧲', '🔢', '🎨', '🎵', '📚', '🗺️', '💡',
  '❓', '✅', '🏆', '🍎',
] as const;

/** A sticky note, a flip card with a front and a back, or something to check off. */
export type NoteCardKind = 'note' | 'flash' | 'check';
export const NOTE_CARD_KINDS: readonly NoteCardKind[] = ['note', 'flash', 'check'];

export interface NoteCard {
  id: string;
  kind: NoteCardKind;
  /** The note; the front of a flip card; the thing to check off. */
  text: string;
  /** The back of a flip card. Only `flash` cards have one. */
  back?: string;
  /** A `check` card that has been checked off. */
  done?: boolean;
  color: NotebookColor;
  /** ISO 8601. */
  created_at: string;
  updated_at: string;
}

export interface NotebookPage {
  id: string;
  /** The page this is a subpage of, or null for a page of its own. */
  parent: string | null;
  title: string;
  icon: string;
  color: NotebookColor;
  /** What is written on the page. Plain text; new lines are kept. */
  text: string;
  cards: NoteCard[];
  /** ISO 8601. */
  created_at: string;
  updated_at: string;
}

/** Pages in order: a page's subpages are the pages naming it as `parent`, in the order they appear here. */
export interface Notebook {
  pages: NotebookPage[];
}

const ID = /^[A-Za-z0-9_-]{1,24}$/;

/** Keep at most `max` characters (code points, as PHP's mb_substr counts them). */
function clip(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  // Control characters other than new lines and tabs are dropped; Windows line ends become plain ones.
  const text = value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** A time as ISO 8601 UTC: a time that cannot be read, or more than a day ahead, is `now`. */
function when(value: unknown, now: number): string {
  const t = typeof value === 'string' ? Date.parse(value) : NaN;
  return new Date(Number.isFinite(t) && t <= now + 86_400_000 ? t : now).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function color(value: unknown, fallback: NotebookColor): NotebookColor {
  return (NOTEBOOK_COLORS as readonly string[]).includes(value as string) ? (value as NotebookColor) : fallback;
}

/**
 * A notebook as it may be kept: anything else is dropped or put right. Ids must be short and
 * unique; a page whose parent is missing (or that would be its own ancestor) becomes a page of
 * its own; one too deep moves up under the deepest page allowed; limits are applied in order, so
 * what is over a limit is what comes last.
 */
export function cleanNotebook(raw: unknown, now: number = Date.now()): Notebook {
  const list = raw && typeof raw === 'object' && Array.isArray((raw as Notebook).pages) ? (raw as Notebook).pages : [];
  const seen = new Set<string>();
  const pages: NotebookPage[] = [];
  for (const p of list) {
    if (pages.length >= NOTEBOOK_LIMITS.pages) break;
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !ID.test(p.id) || seen.has(p.id)) continue;
    seen.add(p.id);
    const cardIds = new Set<string>();
    const cards: NoteCard[] = [];
    for (const c of Array.isArray(p.cards) ? p.cards : []) {
      if (cards.length >= NOTEBOOK_LIMITS.cards) break;
      if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !ID.test(c.id) || cardIds.has(c.id)) continue;
      cardIds.add(c.id);
      const kind: NoteCardKind = NOTE_CARD_KINDS.includes(c.kind) ? c.kind : 'note';
      const card: NoteCard = { id: c.id, kind, text: clip(c.text, NOTEBOOK_LIMITS.card), color: color(c.color, 'sun'), created_at: when(c.created_at, now), updated_at: when(c.updated_at, now) };
      if (kind === 'flash') card.back = clip(c.back, NOTEBOOK_LIMITS.card);
      if (kind === 'check') card.done = c.done === true;
      cards.push(card);
    }
    pages.push({
      id: p.id,
      parent: typeof p.parent === 'string' ? p.parent : null,
      // One line, without spaces at either end (only these three spaces: PHP's copy must count the same).
      title: clip(p.title, NOTEBOOK_LIMITS.title).replace(/[ \t\n]+/g, ' ').replace(/^ | $/g, ''),
      icon: (NOTEBOOK_ICONS as readonly string[]).includes(p.icon) ? p.icon : NOTEBOOK_ICONS[0],
      color: color(p.color, 'sky'),
      text: clip(p.text, NOTEBOOK_LIMITS.text),
      cards,
      created_at: when(p.created_at, now),
      updated_at: when(p.updated_at, now),
    });
  }
  // Parents: one that is missing, or that leads back round to the page, makes it a page of its own.
  const byId = new Map(pages.map((p) => [p.id, p]));
  for (const page of pages) {
    const path = new Set([page.id]);
    for (let up = page.parent; up != null; up = byId.get(up)?.parent ?? null) {
      if (!byId.has(up) || path.has(up)) {
        page.parent = null;
        break;
      }
      path.add(up);
    }
  }
  // Too deep: hang it under the deepest ancestor it may have.
  for (const page of pages) {
    const chain: string[] = [];
    for (let up = page.parent; up != null; up = byId.get(up)!.parent) chain.unshift(up);
    if (chain.length >= NOTEBOOK_LIMITS.depth) page.parent = chain[NOTEBOOK_LIMITS.depth - 2]!;
  }
  return { pages };
}

/** How deep a page is: 0 for a page of its own, 1 for a subpage, and so on. */
export function pageDepth(notebook: Notebook, id: string): number {
  const byId = new Map(notebook.pages.map((p) => [p.id, p]));
  let depth = 0;
  for (let up = byId.get(id)?.parent ?? null; up != null && depth <= NOTEBOOK_LIMITS.depth; up = byId.get(up)?.parent ?? null) depth++;
  return depth;
}

/** A page's subpages, theirs, and so on: every page under it. */
export function pageDescendants(notebook: Notebook, id: string): string[] {
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const p of notebook.pages) {
      if (p.parent === parent) {
        out.push(p.id);
        walk(p.id);
      }
    }
  };
  walk(id);
  return out;
}

/** How tall the tree under a page is: 0 with no subpages, 1 with subpages only, and so on. */
export function pageHeight(notebook: Notebook, id: string): number {
  let most = 0;
  for (const p of notebook.pages) if (p.parent === id) most = Math.max(most, 1 + pageHeight(notebook, p.id));
  return most;
}

/** The pages as the contents lists them: each page followed by its subpages, with how deep each is. */
export function notebookContents(notebook: Notebook): Array<{ page: NotebookPage; depth: number }> {
  const out: Array<{ page: NotebookPage; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const page of notebook.pages) {
      if (page.parent !== parent) continue;
      out.push({ page, depth });
      walk(page.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/**
 * When something was written, in a few words a young reader knows: "just now", "5 minutes ago",
 * "today at 2:41 PM", "yesterday at 9:05 AM", "on Tuesday", "on Nov 3" (with the year when it is
 * not this one). `locale` and `timeZone` are for tests; the game uses the player's own.
 */
export function writtenWhen(iso: string, now: number = Date.now(), o: { locale?: string; timeZone?: string } = {}): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const ago = Math.max(0, now - t);
  if (ago < 60_000) return 'just now';
  if (ago < 3_600_000) {
    const m = Math.floor(ago / 60_000);
    return m === 1 ? '1 minute ago' : `${m} minutes ago`;
  }
  const day = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: o.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const time = new Intl.DateTimeFormat(o.locale, { timeZone: o.timeZone, hour: 'numeric', minute: '2-digit' }).format(t);
  if (day(t) === day(now)) return `today at ${time}`;
  if (day(t) === day(now - 86_400_000)) return `yesterday at ${time}`;
  if (ago < 6 * 86_400_000) return `on ${new Intl.DateTimeFormat(o.locale, { timeZone: o.timeZone, weekday: 'long' }).format(t)}`;
  const sameYear = day(t).slice(0, 4) === day(now).slice(0, 4);
  return `on ${new Intl.DateTimeFormat(o.locale, { timeZone: o.timeZone, month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' }).format(t)}`;
}

/** A new id for a page or a card: short, and unlikely to be used twice. */
export function notebookId(): string {
  const bytes = new Uint8Array(9);
  const crypto = (globalThis as { crypto?: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto;
  if (crypto) crypto.getRandomValues(bytes);
  else bytes.forEach((_, i) => (bytes[i] = Math.floor(Math.random() * 256)));
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'[b & 63]).join('');
}
