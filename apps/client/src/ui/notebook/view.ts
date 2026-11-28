import { writtenWhen, NOTEBOOK_COLORS, NOTEBOOK_ICONS, NOTEBOOK_LIMITS, type NoteCard, type NoteCardKind, type NotebookColor, type NotebookPage } from '@qbl/shared';
import type { NotebookModel, PagePlace } from '../../core/Notebook';
import { emojiIcon } from '../icons';
import { keepLook, loadFont, readLook, NOTEBOOK_FONTS, NOTEBOOK_SIZES, type NotebookLook } from './look';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(label: string, emoji: string | null, onClick: (e: MouseEvent) => void, o: { title?: string; className?: string } = {}): HTMLButtonElement {
  const b = el('button', `qbl-nb-button${o.className ? ` ${o.className}` : ''}`);
  b.type = 'button';
  if (emoji) b.append(emojiIcon(emoji, { size: 20 }));
  if (label) b.append(el('span', '', label));
  if (o.title) {
    b.title = o.title;
    b.setAttribute('aria-label', o.title);
  }
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
}

/** Grow a text box to fit what is written in it, so the page scrolls instead of the box. */
function fit(area: HTMLTextAreaElement) {
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight}px`;
}

const COLOR_NAMES: Record<NotebookColor, string> = { sun: 'Yellow', sky: 'Blue', mint: 'Green', rose: 'Pink', grape: 'Purple', peach: 'Orange' };
const CARD_KINDS: Array<{ kind: NoteCardKind; label: string; emoji: string; title: string }> = [
  { kind: 'note', label: 'Sticky note', emoji: '📝', title: 'Add a sticky note' },
  { kind: 'flash', label: 'Flip card', emoji: '🔄', title: 'Add a flip card: a question on the front, the answer on the back' },
  { kind: 'check', label: 'To-do', emoji: '✅', title: 'Add something to check off' },
];
const reduced = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrow = () => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches;

export interface NotebookViewOptions {
  /** The scenario's title, on the cover. */
  title: string;
  /** The player's name, on the cover's label. */
  owner: string;
  /** The page that was open last time, to open again. */
  pageId: string | null;
  /** Where the notebook comes from and goes back to (the rail button): it grows out of it. */
  from: HTMLElement | null;
  /** It has closed, showing this page last. */
  onClosed(pageId: string | null): void;
}

export interface NotebookViewHandle {
  /** Close it, with the cover closing. */
  close(): Promise<void>;
}

/**
 * The notebook, open over the game: a spiral-bound book with the contents on the left page and
 * the page being written on the right, coloured tabs for its pages down the edge, and a cover that
 * swings open when it opens and shut when it closes. On a narrow screen one page shows at a time.
 *
 * It draws what the model holds and calls the model's changes; the model keeps them. Writing is
 * not redrawn as it is typed (that would lose the caret): only the small "last written" notes are.
 */
export function openNotebook(parent: HTMLElement, book: NotebookModel, o: NotebookViewOptions): NotebookViewHandle {
  const look: NotebookLook = readLook();
  let current: string | null = o.pageId;
  let side: 'contents' | 'page' = 'page';
  let closing: Promise<void> | null = null;
  let popover: { node: HTMLElement; close(): void } | null = null;
  /** Cards showing their back. */
  const flipped = new Set<string>();

  const root = el('div', 'qbl-nb');
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'My notebook');
  // Presses here are the notebook's, not the game's.
  root.addEventListener('pointerdown', (e) => e.stopPropagation());
  root.addEventListener('click', (e) => {
    if (e.target === root) void close();
  });

  const stage = el('div', 'qbl-nb-stage');
  const bookEl = el('div', 'qbl-nb-book');
  bookEl.tabIndex = -1;
  const left = el('section', 'qbl-nb-left qbl-nb-paper');
  left.setAttribute('aria-label', 'Contents');
  const spine = el('div', 'qbl-nb-spine');
  spine.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 13; i++) spine.append(el('span', 'qbl-nb-ring'));
  const right = el('section', 'qbl-nb-right qbl-nb-paper');
  right.setAttribute('aria-label', 'Page');
  const tabs = el('nav', 'qbl-nb-tabs');
  tabs.setAttribute('aria-label', 'Pages');

  // The cover: the front, with a label naming whose notebook it is, and the inside of the cover.
  const cover = el('div', 'qbl-nb-cover');
  cover.setAttribute('aria-hidden', 'true');
  const front = el('div', 'qbl-nb-cover-front');
  const label = el('div', 'qbl-nb-label');
  label.append(el('span', 'qbl-nb-label-kind', 'Notebook'), el('strong', 'qbl-nb-label-name', o.owner), el('span', 'qbl-nb-label-title', o.title));
  front.append(emojiIcon('✏️', { size: 44 }), label, el('div', 'qbl-nb-strap'));
  const inside = el('div', 'qbl-nb-cover-back');
  cover.append(front, inside);

  const boardLeft = el('div', 'qbl-nb-board left');
  const boardRight = el('div', 'qbl-nb-board right');
  bookEl.append(boardLeft, boardRight, left, spine, right, tabs, cover);
  /** What a closed book does not show: the left half, under the cover once it is shut. */
  const leftHalf = () => (narrow() ? [] : [boardLeft, left, spine]);
  stage.append(bookEl);

  // The writing's look, outside the book: handwriting and size, and closing.
  const tools = el('div', 'qbl-nb-tools');
  const fontButton = button('Aa', null, () => toggleLookMenu(fontButton), { title: 'Change how the writing looks', className: 'qbl-nb-look' });
  const contentsButton = button('', '📑', () => {
    side = side === 'contents' ? 'page' : 'contents';
    applySide();
  }, { title: 'Show the contents', className: 'qbl-nb-contents-toggle' });
  tools.append(contentsButton, fontButton, button('', '❌', () => void close(), { title: 'Close the notebook', className: 'qbl-nb-close' }));
  bookEl.append(tools);
  root.append(stage);
  parent.append(root);

  const applyLook = () => {
    root.dataset.font = look.font;
    root.dataset.size = look.size;
    root.style.setProperty('--nb-font', NOTEBOOK_FONTS.find((f) => f.key === look.font)!.family);
    void loadFont(look.font).then(() => document.querySelectorAll<HTMLTextAreaElement>('.qbl-nb textarea').forEach(fit));
  };
  const applySide = () => {
    bookEl.dataset.side = side;
    contentsButton.setAttribute('aria-pressed', String(side === 'contents'));
  };
  applyLook();
  applySide();

  // ---------------------------------------------------------------- popovers

  function closePopover() {
    popover?.close();
    popover = null;
  }

  /** A small card of choices beside a button, closed by choosing, pressing elsewhere or Escape. */
  function openPopover(anchor: HTMLElement, fill: (box: HTMLElement) => void, o: { label: string } = { label: 'Choices' }) {
    const again = popover?.node.dataset.anchor === anchor.dataset.popoverId && anchor.dataset.popoverId;
    closePopover();
    if (again) return;
    const box = el('div', 'qbl-nb-popover');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', o.label);
    anchor.dataset.popoverId ||= Math.random().toString(36).slice(2);
    box.dataset.anchor = anchor.dataset.popoverId;
    fill(box);
    root.append(box);
    const a = anchor.getBoundingClientRect();
    const r = root.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    const x = Math.min(Math.max(8, a.left - r.left + a.width / 2 - b.width / 2), r.width - b.width - 8);
    const below = a.bottom - r.top + 8;
    const y = below + b.height > r.height - 8 ? Math.max(8, a.top - r.top - b.height - 8) : below;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    anchor.setAttribute('aria-expanded', 'true');
    const outside = (e: PointerEvent) => {
      if (!box.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) closePopover();
    };
    root.addEventListener('pointerdown', outside, true);
    popover = {
      node: box,
      close: () => {
        root.removeEventListener('pointerdown', outside, true);
        anchor.setAttribute('aria-expanded', 'false');
        box.remove();
      },
    };
    (box.querySelector('button, input, select') as HTMLElement | null)?.focus();
  }

  /** A button that asks once more before it does something that cannot be undone. */
  function sureButton(label: string, ask: string, onSure: () => void): HTMLElement {
    const wrap = el('div', 'qbl-nb-sure');
    const first = button(label, '🗑', () => {
      wrap.replaceChildren(el('span', 'qbl-nb-sure-ask', ask), button('Yes', null, onSure, { className: 'danger' }), button('No', null, () => wrap.replaceChildren(first)));
      (wrap.querySelector('button') as HTMLButtonElement).focus();
    }, { className: 'danger' });
    wrap.append(first);
    return wrap;
  }

  function toggleLookMenu(anchor: HTMLElement) {
    openPopover(anchor, (box) => {
      box.append(el('h3', '', 'Writing'));
      const fonts = el('div', 'qbl-nb-fonts');
      fonts.setAttribute('role', 'radiogroup');
      fonts.setAttribute('aria-label', 'Handwriting');
      for (const f of NOTEBOOK_FONTS) {
        void loadFont(f.key);
        const b = button('', null, () => {
          look.font = f.key;
          keepLook(look);
          applyLook();
          fonts.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        }, { className: 'qbl-nb-font' });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(look.font === f.key));
        const sample = el('span', 'qbl-nb-font-sample', 'The cat sat.');
        sample.style.fontFamily = f.family;
        b.append(sample, el('small', '', f.label + (f.key === 'neat' ? ' (easiest)' : '')));
        fonts.append(b);
      }
      box.append(fonts, el('h3', '', 'Size'));
      const sizes = el('div', 'qbl-nb-sizes');
      sizes.setAttribute('role', 'radiogroup');
      sizes.setAttribute('aria-label', 'Size');
      for (const s of NOTEBOOK_SIZES) {
        const b = button(s.label, null, () => {
          look.size = s.key;
          keepLook(look);
          applyLook();
          sizes.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        }, { className: `qbl-nb-size qbl-nb-size-${s.key}` });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(look.size === s.key));
        sizes.append(b);
      }
      box.append(sizes);
    }, { label: 'How the writing looks' });
  }

  // ---------------------------------------------------------------- the contents (left page)

  const saveNote = el('p', 'qbl-nb-saved');
  saveNote.setAttribute('role', 'status');

  function drawSaved() {
    const s = book.state;
    saveNote.dataset.state = s;
    saveNote.textContent = s === 'saved' ? '✓ Saved'
      : s === 'saving' || s === 'waiting' ? 'Saving…'
      : s === 'failed' ? 'Not saved yet. Trying again…'
      : s === 'loading' ? 'Opening…'
      : '';
  }

  let dragging: { kind: 'page'; id: string } | { kind: 'card'; page: string; id: string } | null = null;

  function zone(e: DragEvent, row: HTMLElement): PagePlace {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / Math.max(1, r.height);
    return y < 0.3 ? 'before' : y > 0.7 ? 'after' : 'inside';
  }

  function drawContents() {
    left.replaceChildren();
    const head = el('header', 'qbl-nb-left-head');
    head.append(el('h2', 'qbl-nb-hand', 'My notebook'), el('p', 'qbl-nb-scenario', o.title));
    left.append(head);
    if (book.state === 'unloaded') return;
    const list = el('ol', 'qbl-nb-list');
    for (const { page, depth } of book.contents()) {
      const item = el('li', 'qbl-nb-entry');
      item.dataset.depth = String(depth);
      item.dataset.color = page.color;
      item.style.setProperty('--depth', String(depth));
      const open = el('button', 'qbl-nb-entry-open');
      open.type = 'button';
      if (page.id === current) open.setAttribute('aria-current', 'page');
      open.append(emojiIcon(page.icon, { size: 22 }), el('span', 'qbl-nb-entry-title', page.title || 'Untitled page'));
      const when = el('small', 'qbl-nb-entry-when');
      when.dataset.stamp = page.id;
      open.append(when);
      open.addEventListener('click', () => show(page.id));
      // Drag a page onto another: above or below it to put it there, onto its middle to make it a subpage.
      item.draggable = true;
      item.addEventListener('dragstart', (e) => {
        dragging = { kind: 'page', id: page.id };
        e.dataTransfer?.setData('text/plain', page.title);
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => {
        dragging = null;
        item.classList.remove('dragging');
        list.querySelectorAll('[data-drop]').forEach((n) => n.removeAttribute('data-drop'));
      });
      item.addEventListener('dragover', (e) => {
        if (!dragging) return;
        const where: PagePlace = dragging.kind === 'card' ? 'inside' : zone(e, item);
        const ok = dragging.kind === 'card' ? dragging.page !== page.id : book.canPlace(dragging.id, page.id, where);
        if (!ok) return item.removeAttribute('data-drop');
        e.preventDefault();
        item.dataset.drop = where;
      });
      item.addEventListener('dragleave', () => item.removeAttribute('data-drop'));
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        const where = item.dataset.drop as PagePlace | undefined;
        item.removeAttribute('data-drop');
        if (!dragging || !where) return;
        if (dragging.kind === 'card') {
          if (book.placeCard(dragging.page, dragging.id, page.id)) drawAll();
        } else if (book.placePage(dragging.id, page.id, where)) {
          drawAll();
        }
      });
      item.append(open);
      list.append(item);
    }
    left.append(list);
    const foot = el('footer', 'qbl-nb-left-foot');
    const add = button('New page', '➕', () => {
      const page = book.addPage(null);
      if (page) show(page.id, { focusTitle: true });
    }, { className: 'qbl-nb-new', title: book.full ? `This notebook is full (${NOTEBOOK_LIMITS.pages} pages)` : 'Add a new page' });
    add.disabled = book.full || !book.ready;
    foot.append(add, saveNote);
    left.append(foot);
    drawSaved();
  }

  function drawTabs() {
    tabs.replaceChildren();
    const tops = book.children(null);
    tabs.style.setProperty('--tabs', String(Math.max(tops.length, 6)));
    for (const page of tops.slice(0, 12)) {
      const tab = el('button', 'qbl-nb-tab');
      tab.type = 'button';
      tab.dataset.color = page.color;
      tab.title = page.title || 'Untitled page';
      tab.setAttribute('aria-label', page.title || 'Untitled page');
      const here = current != null && (current === page.id || pageAncestors(current).includes(page.id));
      if (here) tab.setAttribute('aria-current', 'true');
      tab.append(emojiIcon(page.icon, { size: 18 }));
      tab.addEventListener('click', () => show(page.id));
      tabs.append(tab);
    }
  }

  function pageAncestors(id: string): string[] {
    const out: string[] = [];
    for (let up = book.page(id)?.parent ?? null; up != null; up = book.page(up)?.parent ?? null) out.push(up);
    return out;
  }

  // ---------------------------------------------------------------- the page (right page)

  function drawPage(o: { focusTitle?: boolean } = {}) {
    right.replaceChildren();
    if (book.state === 'loading') {
      right.append(el('p', 'qbl-nb-hand qbl-nb-empty', 'Opening your notebook…'));
      return;
    }
    if (book.state === 'unloaded') {
      const box = el('div', 'qbl-nb-empty');
      box.append(el('p', 'qbl-nb-hand', 'Your notebook did not open.'), el('p', 'qbl-nb-why', book.problem || 'Check the connection.'), button('Try again', '🔄', () => void book.load()));
      right.append(box);
      return;
    }
    const page = book.page(current);
    if (!page) {
      right.append(el('p', 'qbl-nb-hand qbl-nb-empty', 'Choose a page, or make a new one.'));
      return;
    }
    right.dataset.color = page.color;

    // Where this page is: its page, and that page's, above the title.
    const trail = pageAncestors(page.id).reverse();
    if (trail.length) {
      const crumbs = el('nav', 'qbl-nb-crumbs');
      crumbs.setAttribute('aria-label', 'This is a subpage of');
      for (const id of trail) {
        const up = book.page(id)!;
        const b = button(up.title || 'Untitled page', up.icon, () => show(id), { className: 'qbl-nb-crumb' });
        crumbs.append(b, el('span', 'qbl-nb-crumb-sep', '›'));
      }
      right.append(crumbs);
    }

    const head = el('header', 'qbl-nb-head');
    const iconButton = button('', page.icon, () => openPopover(iconButton, (box) => {
      box.append(el('h3', '', 'A picture for this page'));
      const grid = el('div', 'qbl-nb-icons');
      for (const icon of NOTEBOOK_ICONS) {
        const b = button('', icon, () => {
          book.updatePage(page.id, { icon });
          closePopover();
          drawAll();
        }, { title: icon, className: 'qbl-nb-icon-choice' });
        if (icon === page.icon) b.setAttribute('aria-pressed', 'true');
        grid.append(b);
      }
      box.append(grid);
    }, { label: 'Choose a picture' }), { title: 'Choose a picture for this page', className: 'qbl-nb-page-icon' });
    const title = el('input', 'qbl-nb-title');
    title.type = 'text';
    title.value = page.title;
    title.maxLength = NOTEBOOK_LIMITS.title;
    title.placeholder = 'Name this page';
    title.setAttribute('aria-label', 'Page name');
    title.addEventListener('input', () => {
      book.updatePage(page.id, { title: title.value });
      stamps();
      // The contents and tabs show the name: redraw them, not this page.
      drawContents();
      drawTabs();
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        text.focus();
      }
    });
    const more = button('', '⚙️', () => openPopover(more, (box) => pageMenu(box, page), { label: 'Page choices' }), { title: 'Page choices: colour, move, subpage, throw away', className: 'qbl-nb-more' });
    head.append(iconButton, title, more);
    const when = el('p', 'qbl-nb-stamp');
    when.dataset.stamp = page.id;
    when.dataset.long = '1';
    right.append(head, when);

    const text = el('textarea', 'qbl-nb-text');
    text.value = page.text;
    text.maxLength = NOTEBOOK_LIMITS.text;
    text.placeholder = 'Write here…';
    text.setAttribute('aria-label', 'Write on this page');
    text.spellcheck = true;
    text.addEventListener('input', () => {
      fit(text);
      book.updatePage(page.id, { text: text.value });
      stamps();
    });
    right.append(text);

    // Its subpages, as slips of paper to open, and one to add.
    const subs = book.children(page.id);
    const strip = el('div', 'qbl-nb-subpages');
    for (const sub of subs) strip.append(button(sub.title || 'Untitled page', sub.icon, () => show(sub.id), { className: 'qbl-nb-subpage' }));
    if (book.canAddUnder(page.id)) {
      strip.append(button('Subpage', '➕', () => {
        const sub = book.addPage(page.id);
        if (sub) show(sub.id, { focusTitle: true });
      }, { className: 'qbl-nb-subpage add', title: 'Add a subpage under this page' }));
    }
    if (strip.childElementCount) {
      const box = el('section', `qbl-nb-section${subs.length ? '' : ' quiet'}`);
      if (subs.length) box.append(el('h3', 'qbl-nb-hand', 'Subpages'));
      box.append(strip);
      right.append(box);
    }

    // Notecards.
    const cards = el('section', 'qbl-nb-section qbl-nb-cards-section');
    const cardsHead = el('div', 'qbl-nb-cards-head');
    cardsHead.append(el('h3', 'qbl-nb-hand', 'Notecards'));
    const adds = el('div', 'qbl-nb-card-adds');
    for (const k of CARD_KINDS) {
      const b = button(k.label, k.emoji, () => {
        const card = book.addCard(page.id, k.kind);
        if (!card) return;
        drawPage();
        stamps();
        (right.querySelector(`[data-card="${card.id}"] textarea`) as HTMLTextAreaElement | null)?.focus();
      }, { title: k.title, className: 'qbl-nb-card-add' });
      b.disabled = page.cards.length >= NOTEBOOK_LIMITS.cards;
      adds.append(b);
    }
    cardsHead.append(adds);
    const grid = el('div', 'qbl-nb-cards');
    grid.addEventListener('dragover', (e) => {
      if (dragging?.kind === 'card') e.preventDefault();
    });
    grid.addEventListener('drop', (e) => {
      if (dragging?.kind !== 'card' || (e.target as HTMLElement).closest('[data-card]')) return;
      e.preventDefault();
      if (book.placeCard(dragging.page, dragging.id, page.id, null)) drawAll();
    });
    for (const card of page.cards) grid.append(cardView(page, card));
    if (!page.cards.length) grid.append(el('p', 'qbl-nb-cards-empty', 'Add a sticky note, a flip card or a to-do.'));
    cards.append(cardsHead, grid);
    right.append(cards);

    requestAnimationFrame(() => {
      right.querySelectorAll('textarea').forEach((t) => fit(t as HTMLTextAreaElement));
    });
    if (o.focusTitle) title.focus();
  }

  function pageMenu(box: HTMLElement, page: NotebookPage) {
    box.append(el('h3', '', 'Colour'));
    box.append(swatches(page.color, (color) => {
      book.updatePage(page.id, { color });
      drawAll();
      closePopover();
    }));
    box.append(el('h3', '', 'Move'));
    const moves = el('div', 'qbl-nb-menu');
    const siblings = book.children(page.parent);
    const at = siblings.findIndex((p) => p.id === page.id);
    const act = (label: string, emoji: string, ok: boolean, run: () => boolean) => {
      const b = button(label, emoji, () => {
        if (run()) drawAll();
        closePopover();
      });
      b.disabled = !ok;
      moves.append(b);
    };
    act('Move up', '🔼', at > 0, () => book.movePage(page.id, -1));
    act('Move down', '🔽', at < siblings.length - 1, () => book.movePage(page.id, 1));
    act('Put it under the page above', '↪️', at > 0 && book.canPlace(page.id, siblings[at - 1]!.id, 'inside'), () => book.indentPage(page.id));
    act('Take it out from under its page', '↩️', page.parent != null, () => book.outdentPage(page.id));
    box.append(moves);
    const family = book.family(page.id);
    box.append(sureButton('Throw this page away', family > 1 ? `Throw away this page and the ${family - 1} under it?` : 'Throw this page away?', () => {
      closePopover();
      current = book.deletePage(page.id);
      drawAll();
    }));
  }

  function swatches(chosen: NotebookColor, onPick: (c: NotebookColor) => void): HTMLElement {
    const row = el('div', 'qbl-nb-swatches');
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', 'Colour');
    for (const c of NOTEBOOK_COLORS) {
      const b = el('button', 'qbl-nb-swatch');
      b.type = 'button';
      b.dataset.color = c;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', COLOR_NAMES[c]);
      b.title = COLOR_NAMES[c];
      b.setAttribute('aria-checked', String(c === chosen));
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(c);
      });
      row.append(b);
    }
    return row;
  }

  function cardView(page: NotebookPage, card: NoteCard): HTMLElement {
    const node = el('article', 'qbl-nb-card');
    node.dataset.card = card.id;
    node.dataset.kind = card.kind;
    node.dataset.color = card.color;
    if (card.kind === 'check' && card.done) node.classList.add('done');
    if (flipped.has(card.id)) node.classList.add('flipped');
    node.setAttribute('aria-label', card.kind === 'flash' ? 'Flip card' : card.kind === 'check' ? 'To-do' : 'Sticky note');

    const area = (value: string, placeholder: string, label: string, onInput: (v: string) => void) => {
      const t = el('textarea', 'qbl-nb-card-text');
      t.value = value;
      t.placeholder = placeholder;
      t.maxLength = NOTEBOOK_LIMITS.card;
      t.rows = 2;
      t.setAttribute('aria-label', label);
      t.addEventListener('input', () => {
        fit(t);
        onInput(t.value);
        stamps();
      });
      return t;
    };

    const inner = el('div', 'qbl-nb-card-inner');
    const faceFront = el('div', 'qbl-nb-card-face front');
    if (card.kind === 'check') {
      const tick = el('input', 'qbl-nb-check');
      tick.type = 'checkbox';
      tick.checked = card.done === true;
      tick.setAttribute('aria-label', 'Done');
      tick.addEventListener('change', () => {
        book.updateCard(page.id, card.id, { done: tick.checked });
        node.classList.toggle('done', tick.checked);
        stamps();
      });
      faceFront.append(tick, area(card.text, 'Something to do', 'Something to do', (v) => book.updateCard(page.id, card.id, { text: v })));
    } else if (card.kind === 'flash') {
      faceFront.append(el('span', 'qbl-nb-face-label', 'Front'), area(card.text, 'A question', 'The front of the card', (v) => book.updateCard(page.id, card.id, { text: v })));
    } else {
      faceFront.append(area(card.text, 'A note', 'Sticky note', (v) => book.updateCard(page.id, card.id, { text: v })));
    }
    inner.append(faceFront);
    if (card.kind === 'flash') {
      const faceBack = el('div', 'qbl-nb-card-face back');
      faceBack.append(el('span', 'qbl-nb-face-label', 'Back'), area(card.back ?? '', 'The answer', 'The back of the card', (v) => book.updateCard(page.id, card.id, { back: v })));
      inner.append(faceBack);
    }

    const foot = el('footer', 'qbl-nb-card-foot');
    if (card.kind === 'flash') {
      const flip = button('Flip', '🔄', () => {
        if (flipped.has(card.id)) flipped.delete(card.id);
        else flipped.add(card.id);
        node.classList.toggle('flipped');
        flip.setAttribute('aria-pressed', String(flipped.has(card.id)));
      }, { title: 'Turn the card over', className: 'qbl-nb-flip' });
      flip.setAttribute('aria-pressed', String(flipped.has(card.id)));
      foot.append(flip);
    }
    const when = el('small', 'qbl-nb-card-when');
    when.dataset.stamp = `${page.id}/${card.id}`;
    const menu = button('', '⚙️', () => openPopover(menu, (box) => cardMenu(box, page, card), { label: 'Card choices' }), { title: 'Card choices: colour, move, throw away', className: 'qbl-nb-card-more' });
    foot.append(when, menu);
    node.append(inner, foot);

    // Drag a card to put it before another, or onto a page in the contents to move it there.
    node.draggable = true;
    node.addEventListener('dragstart', (e) => {
      if ((e.target as HTMLElement).closest('textarea, input')) return e.preventDefault();
      dragging = { kind: 'card', page: page.id, id: card.id };
      e.dataTransfer?.setData('text/plain', card.text);
      node.classList.add('dragging');
    });
    node.addEventListener('dragend', () => {
      dragging = null;
      node.classList.remove('dragging');
    });
    node.addEventListener('dragover', (e) => {
      if (dragging?.kind === 'card' && dragging.id !== card.id) {
        e.preventDefault();
        node.dataset.drop = 'before';
      }
    });
    node.addEventListener('dragleave', () => node.removeAttribute('data-drop'));
    node.addEventListener('drop', (e) => {
      node.removeAttribute('data-drop');
      if (dragging?.kind !== 'card') return;
      e.preventDefault();
      e.stopPropagation();
      if (book.placeCard(dragging.page, dragging.id, page.id, card.id)) drawAll();
    });
    return node;
  }

  function cardMenu(box: HTMLElement, page: NotebookPage, card: NoteCard) {
    box.append(el('h3', '', 'Colour'));
    box.append(swatches(card.color, (color) => {
      book.updateCard(page.id, card.id, { color });
      const node = right.querySelector(`[data-card="${card.id}"]`) as HTMLElement | null;
      if (node) node.dataset.color = color;
      stamps();
      closePopover();
    }));
    box.append(el('h3', '', 'Move'));
    const moves = el('div', 'qbl-nb-menu');
    const at = page.cards.findIndex((c) => c.id === card.id);
    const back = button('Earlier', '◀️', () => {
      if (book.moveCard(page.id, card.id, -1)) drawPage();
      closePopover();
    });
    back.disabled = at <= 0;
    const on = button('Later', '▶️', () => {
      if (book.moveCard(page.id, card.id, 1)) drawPage();
      closePopover();
    });
    on.disabled = at >= page.cards.length - 1;
    moves.append(back, on);
    const others = book.contents().filter(({ page: p }) => p.id !== page.id);
    if (others.length) {
      const pick = el('select', 'qbl-nb-move-to');
      pick.setAttribute('aria-label', 'Move it to another page');
      pick.append(new Option('Move to another page…', ''));
      for (const { page: p, depth } of others) pick.append(new Option(`${'  '.repeat(depth)}${p.icon} ${p.title || 'Untitled page'}`, p.id));
      pick.addEventListener('change', () => {
        if (pick.value && book.placeCard(page.id, card.id, pick.value)) drawAll();
        closePopover();
      });
      moves.append(pick);
    }
    box.append(moves, sureButton('Throw this card away', 'Throw this card away?', () => {
      closePopover();
      book.deleteCard(page.id, card.id);
      flipped.delete(card.id);
      drawPage();
      drawContents();
    }));
  }

  // ---------------------------------------------------------------- the small "last written" notes

  function stamps() {
    const now = Date.now();
    root.querySelectorAll<HTMLElement>('[data-stamp]').forEach((node) => {
      const [pageId, cardId] = node.dataset.stamp!.split('/');
      const page = book.page(pageId);
      const item = cardId ? page?.cards.find((c) => c.id === cardId) : page;
      if (!item) return;
      const fresh = item.created_at === item.updated_at && (cardId ? !(item as NoteCard).text : !(item as NotebookPage).text && !(item as NotebookPage).title);
      const when = writtenWhen(item.updated_at, now);
      node.textContent = fresh ? (node.dataset.long ? '✏️ A new page' : 'new') : node.dataset.long ? `✏️ Last written ${when}` : when;
      node.title = new Date(item.updated_at).toLocaleString();
    });
  }
  const ticker = setInterval(stamps, 30_000);

  // ---------------------------------------------------------------- drawing it all

  function drawAll(o: { focusTitle?: boolean } = {}) {
    if (current == null || !book.page(current)) current = book.contents()[0]?.page.id ?? null;
    drawContents();
    drawTabs();
    drawPage(o);
    stamps();
  }

  function show(id: string, o: { focusTitle?: boolean } = {}) {
    closePopover();
    const turning = id !== current;
    current = id;
    side = 'page';
    applySide();
    drawAll(o);
    right.scrollTop = 0;
    // A page turning: the new page swings in from the spine.
    if (turning && !reduced() && typeof right.animate === 'function') {
      right.animate([{ transform: 'perspective(1600px) rotateY(-14deg)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(.2,.8,.3,1)' });
    }
  }

  const offModel = book.onChange((what) => {
    if (what === 'state') {
      drawSaved();
      // Opened (or opened at last): draw what was kept. An empty notebook starts with a page to write on.
      if (book.state === 'saved' && right.querySelector('.qbl-nb-empty') != null) {
        if (!book.doc.pages.length) book.addPage(null, { title: 'My notes', quiet: true });
        drawAll();
      } else if (book.state === 'unloaded') {
        drawAll();
      }
    }
  });
  if (book.ready && !book.doc.pages.length) book.addPage(null, { title: 'My notes', quiet: true });
  drawAll();
  if (!book.ready) void book.load();

  // ---------------------------------------------------------------- keys

  root.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Escape') return;
    e.preventDefault();
    if (popover) {
      const anchor = root.querySelector<HTMLElement>(`[data-popover-id="${popover.node.dataset.anchor}"]`);
      closePopover();
      anchor?.focus();
    } else {
      void close();
    }
  });

  // ---------------------------------------------------------------- opening and closing

  const animated = !reduced() && typeof bookEl.animate === 'function';
  /** The book grows out of the button that opened it. */
  const fromButton = (): string => {
    const a = o.from?.getBoundingClientRect();
    const b = bookEl.getBoundingClientRect();
    if (!a || !b.width) return 'translateY(40px) scale(0.6)';
    const dx = a.left + a.width / 2 - (b.left + b.width / 2);
    const dy = a.top + a.height / 2 - (b.top + b.height / 2);
    return `translate(${dx}px, ${dy}px) scale(0.12) rotate(-8deg)`;
  };
  // Closed, the book is only its cover: wide, the right half is in the middle of the screen.
  const shut = () => (narrow() ? 'translateX(0)' : 'translateX(-25%)');

  async function openUp() {
    if (!animated) {
      root.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 150 });
      cover.hidden = true;
      bookEl.focus();
      return;
    }
    root.animate([{ backgroundColor: 'rgba(10, 12, 30, 0)' }, { backgroundColor: 'rgba(10, 12, 30, 0.55)' }], { duration: 350, fill: 'both' });
    const hidden = leftHalf().map((n) => n.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 420, fill: 'both' }));
    const grow = bookEl.animate([{ transform: `${fromButton()}`, opacity: 0 }, { transform: `${shut()} scale(1.04)`, opacity: 1, offset: 0.8 }, { transform: shut(), opacity: 1 }], { duration: 420, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'both' });
    await grow.finished.catch(() => undefined);
    const swing = cover.animate([{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(-180deg)' }], { duration: 760, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'both' });
    const slide = bookEl.animate([{ transform: shut() }, { transform: 'translateX(0)' }], { duration: 760, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'both' });
    // The inside of the cover fades into the left page as it lands.
    const fade = inside.animate([{ opacity: 1 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: 760, fill: 'both' });
    // The left half shows as the cover passes the middle.
    hidden.forEach((a) => a.cancel());
    const shown = leftHalf().map((n) => n.animate([{ opacity: 0 }, { opacity: 0, offset: 0.48 }, { opacity: 1, offset: 0.6 }, { opacity: 1 }], { duration: 760, fill: 'both' }));
    await Promise.all([swing.finished, slide.finished, fade.finished]).catch(() => undefined);
    shown.forEach((a) => a.cancel());
    cover.hidden = true;
    grow.cancel();
    slide.cancel();
    swing.cancel();
    fade.cancel();
    bookEl.focus();
  }

  async function shutDown() {
    if (!animated) return;
    cover.hidden = false;
    inside.animate([{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 1 }], { duration: 620, fill: 'both' });
    const swing = cover.animate([{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], { duration: 620, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'both' });
    const slide = bookEl.animate([{ transform: 'translateX(0)' }, { transform: shut() }], { duration: 620, easing: 'cubic-bezier(.45,.05,.25,1)', fill: 'both' });
    for (const n of leftHalf()) n.animate([{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0, offset: 0.52 }, { opacity: 0 }], { duration: 620, fill: 'both' });
    await Promise.all([swing.finished, slide.finished]).catch(() => undefined);
    const away = bookEl.animate([{ transform: shut(), opacity: 1 }, { transform: fromButton(), opacity: 0 }], { duration: 320, easing: 'cubic-bezier(.5,0,.8,.4)', fill: 'both' });
    root.animate([{ backgroundColor: 'rgba(10, 12, 30, 0.55)' }, { backgroundColor: 'rgba(10, 12, 30, 0)' }], { duration: 320, fill: 'both' });
    await away.finished.catch(() => undefined);
  }

  function close(): Promise<void> {
    if (closing) return closing;
    closePopover();
    void book.flush();
    closing = (async () => {
      root.classList.add('closing');
      await shutDown();
      clearInterval(ticker);
      offModel();
      root.remove();
      o.onClosed(current);
      o.from?.focus();
    })();
    return closing;
  }

  void openUp();
  return { close };
}
