import { h, redraw } from './dom';

/**
 * A pop-up panel over the page, for editing one thing (a media file, a character, one of its
 * animations) with room to do it, instead of folding groups open inside a card. It is a modal
 * <dialog>: Escape, the × or a click outside closes it, and one can open over another.
 *
 * The panel lives on the document, not in the page, so the page redrawing underneath does not
 * close it. It redraws itself the same way pages do: its body when rows come or go or a change
 * alters which fields show (a structural change), its title on every change. It closes by itself
 * when what it edits is deleted (its title or body comes back null) and when the address changes.
 */
/** Something that says when what a panel shows has changed. */
export interface Changes {
  onChange(listener: (structural: boolean) => void): () => void;
  emit(structural?: boolean): void;
}

export interface PanelOptions {
  /** Names the panel. Opening one that is already open brings it back instead of opening another. */
  key: string;
  /** What kind of panel it is, as `data-panel`: "media", "character", "animation". */
  kind: string;
  /** What it redraws with: a scenario's Store, or any other source of changes (the library's admin screen has its own). */
  store: Changes;
  /** The heading. Null when the thing it edits is gone, which closes the panel. */
  title: () => Node | string | null;
  /** The content. Null closes the panel. */
  body: () => HTMLElement | null;
  /** A colour for the panel's top edge and heading bar, as any CSS colour. */
  tone?: string;
  size?: 'medium' | 'wide';
  /** After the panel is drawn the first time: to scroll a part of it into view, say. */
  opened?: (dialog: HTMLDialogElement) => void;
  /** Nothing the page shows changes in it (a picker): the page is not redrawn when it closes. */
  quiet?: boolean;
}

export interface Panel {
  dialog: HTMLDialogElement;
  close(): void;
}

const open = new Map<string, Panel>();

export function openPanel(o: PanelOptions): Panel {
  const existing = open.get(o.key);
  if (existing) {
    o.opened?.(existing.dialog);
    return existing;
  }

  const heading = h('h2', { class: 'panel-title', id: `panel-${o.key}` });
  const body = h('div', { class: 'panel-body' });
  const dialog = h('dialog', { class: `modal panel ${o.size ?? 'wide'}`, 'data-panel': o.kind, 'data-key': o.key, 'aria-labelledby': `panel-${o.key}` });
  if (o.tone) dialog.style.setProperty('--tone', o.tone);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (dialog.open) dialog.close();
    else finish();
  };
  const closeButton = h('button', { type: 'button', class: 'panel-close', 'aria-label': 'Close', title: 'Close (Esc)', onclick: close }, '×');
  dialog.append(h('div', { class: 'panel-bar' }, heading, closeButton), body);

  const drawTitle = (): boolean => {
    if (closed) return false;
    const title = o.title();
    if (title == null) {
      close();
      return false;
    }
    heading.replaceChildren(title);
    return true;
  };
  const draw = () => {
    if (!drawTitle()) return;
    const content = o.body();
    if (!content) return close();
    redraw(body, content);
  };
  const stop = o.store.onChange((structural) => (structural ? draw() : drawTitle()));

  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    closed = true;
    stop();
    open.delete(o.key);
    window.removeEventListener('hashchange', close);
    dialog.remove();
    // Values changed in the panel (a name typed, a number) are not structural, so the page behind
    // has not redrawn for them yet: bring it up to date now that it can be seen again.
    if (!o.quiet) o.store.emit();
  }
  dialog.addEventListener('close', finish);
  window.addEventListener('hashchange', close);

  // A click on the backdrop closes the panel; one that starts inside it (selecting text, dragging
  // a slider) and ends outside does not.
  let downOnBackdrop = false;
  dialog.addEventListener('pointerdown', (e) => (downOnBackdrop = e.target === dialog));
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog && downOnBackdrop) close();
    downOnBackdrop = false;
  });

  const panel: Panel = { dialog, close };
  open.set(o.key, panel);
  document.body.append(dialog);
  dialog.showModal();
  draw();
  // Start at the top, not on the first field, which may be far down a long panel.
  closeButton.focus({ preventScroll: true });
  if (!closed) o.opened?.(dialog);
  return panel;
}

/** Close the panel of this key, if it is open. */
export function closePanel(key: string) {
  open.get(key)?.close();
}
