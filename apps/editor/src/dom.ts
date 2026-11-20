/** Small helpers for building DOM without a framework. */

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown> | null;

/** Create an element: h('button', { class: 'primary', onclick: save }, 'Save'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else if (key === 'class') node.className = String(value);
    else if (key === 'value') (node as unknown as HTMLInputElement).value = String(value);
    else if (key === 'checked' || key === 'disabled' || key === 'selected' || key === 'hidden') (node as unknown as Record<string, unknown>)[key] = Boolean(value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  append(node, children);
  return node;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an SVG element. */
export function s(tag: string, props?: Props, ...children: Child[]): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener);
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(node: Element, children: Child[]) {
  for (const child of children) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
}

export function clear(node: Element, ...children: Child[]) {
  node.replaceChildren();
  append(node, children);
}

const FOCUSABLE = 'input, select, textarea, button, summary';

/**
 * Replace a container's content, keeping the keyboard focus and scroll position where they were
 * when the new content has the same shape as the old.
 */
export function redraw(container: HTMLElement, ...children: Child[]) {
  const active = document.activeElement;
  const index = active && container.contains(active) ? [...container.querySelectorAll(FOCUSABLE)].indexOf(active) : -1;
  const tag = active?.tagName;
  const scroll = container.scrollTop;
  clear(container, ...children);
  container.scrollTop = scroll;
  if (index >= 0) {
    const next = container.querySelectorAll<HTMLElement>(FOCUSABLE)[index];
    if (next && next.tagName === tag) next.focus({ preventScroll: true });
  }
}

let toastHost: HTMLElement | null = null;

/**
 * A short message at the bottom of the screen. While a pop-up panel is open the messages go
 * inside it: a modal dialog sits above everything else on the page, so they would be hidden.
 */
/** A short message in the corner. With `action`, a button beside it (and it stays longer). */
export function toast(message: string, kind: 'info' | 'error' = 'info', action?: { label: string; run: () => void }) {
  toastHost ??= h('div', { class: 'toasts', role: 'status' });
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
  const parent = dialogs[dialogs.length - 1] ?? document.body;
  if (toastHost.parentElement !== parent) parent.append(toastHost);
  const node = h('div', { class: `toast ${kind}${action ? ' with-action' : ''}` }, h('span', null, message),
    action ? h('button', { type: 'button', class: 'toast-action', onclick: () => {
      node.remove();
      action.run();
    } }, action.label) : null);
  toastHost.append(node);
  window.setTimeout(() => node.remove(), action ? 12000 : kind === 'error' ? 7000 : 3000);
}

/** Ask before something that cannot be undone. */
export function confirmDelete(what: string): boolean {
  return window.confirm(`Delete ${what}? This cannot be undone.`);
}

/** Which folding groups the author has changed from how they start, so a redraw keeps them that way. */
const foldState = new Map<string, boolean>();

/** Have the fold with this key open the next time it is drawn (to show something inside it). */
export function openFold(key: string) {
  foldState.set(key, true);
}

/**
 * A group that folds away under its heading, to keep long panels easy to move around in.
 * `key` names the group across redraws: folding "Labels" on one hotspot keeps it folded on the next.
 */
export function fold(key: string, title: Child, openByDefault: boolean, ...children: Child[]): HTMLDetailsElement {
  const node = h('details', { class: 'fold', open: foldState.get(key) ?? openByDefault, 'data-fold': key }, h('summary', null, title), h('div', { class: 'fold-body' }, ...children));
  node.addEventListener('toggle', () => foldState.set(key, node.open));
  return node;
}

/**
 * The help button's question mark, drawn as a small SVG rather than a "?" character: a typed
 * glyph sat wherever the font and the button's flex layout put it (off to one side, clipped by
 * the circle), which read as a broken icon. The circle is the button's own border.
 */
function helpGlyph(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const hook = document.createElementNS(ns, 'path');
  hook.setAttribute('d', 'M5.6 5.9a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.2.9-1.2 1.7v.5');
  hook.setAttribute('fill', 'none');
  hook.setAttribute('stroke', 'currentColor');
  hook.setAttribute('stroke-width', '1.9');
  hook.setAttribute('stroke-linecap', 'round');
  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('cx', '8');
  dot.setAttribute('cy', '13.1');
  dot.setAttribute('r', '1.15');
  dot.setAttribute('fill', 'currentColor');
  svg.append(hook, dot);
  return svg;
}

let openHelp: HTMLElement | null = null;
const closeHelp = () => {
  if (!openHelp) return;
  openHelp.querySelector('.help-text')?.setAttribute('hidden', '');
  openHelp.querySelector('button')?.setAttribute('aria-expanded', 'false');
  openHelp = null;
};
document.addEventListener('click', closeHelp);
document.addEventListener('keydown', (e) => e.key === 'Escape' && closeHelp());

/**
 * A small "?" that shows an explanation when clicked (or focused with the keyboard and
 * pressed), instead of the explanation taking up room on the page. Click anywhere, or press
 * Escape, to put it away. The text is also the button's tooltip.
 */
export function help(text: string | null | undefined): HTMLElement | null {
  if (!text) return null;
  const note = h('span', { class: 'help-text', role: 'note', hidden: true }, text);
  const button = h('button', { type: 'button', class: 'help-button', 'aria-label': 'Help', 'aria-expanded': 'false', title: text });
  button.append(helpGlyph());
  const wrap = h('span', { class: 'help' }, button, note);
  button.addEventListener('click', (e) => {
    // Inside a label or a folding heading, the click is for the help and nothing else.
    e.preventDefault();
    e.stopPropagation();
    const wasOpen = openHelp === wrap;
    closeHelp();
    if (wasOpen) return;
    note.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    openHelp = wrap;
    // Keep the note on the screen: open leftwards when the button is near the right edge.
    wrap.classList.toggle('left', button.getBoundingClientRect().left > window.innerWidth - 320);
  });
  note.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  return wrap;
}
