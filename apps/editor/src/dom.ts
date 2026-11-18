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

/** A short message at the bottom of the screen. */
export function toast(message: string, kind: 'info' | 'error' = 'info') {
  toastHost ??= document.body.appendChild(h('div', { class: 'toasts', role: 'status' }));
  const node = h('div', { class: `toast ${kind}` }, message);
  toastHost.append(node);
  window.setTimeout(() => node.remove(), kind === 'error' ? 7000 : 3000);
}

/** Ask before something that cannot be undone. */
export function confirmDelete(what: string): boolean {
  return window.confirm(`Delete ${what}? This cannot be undone.`);
}

/** Which folding groups the author has changed from how they start, so a redraw keeps them that way. */
const foldState = new Map<string, boolean>();

/**
 * A group that folds away under its heading, to keep long panels easy to move around in.
 * `key` names the group across redraws: folding "Labels" on one hotspot keeps it folded on the next.
 */
export function fold(key: string, title: Child, openByDefault: boolean, ...children: Child[]): HTMLDetailsElement {
  const node = h('details', { class: 'fold', open: foldState.get(key) ?? openByDefault, 'data-fold': key }, h('summary', null, title), h('div', { class: 'fold-body' }, ...children));
  node.addEventListener('toggle', () => foldState.set(key, node.open));
  return node;
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
  const button = h('button', { type: 'button', class: 'help-button', 'aria-label': 'Help', 'aria-expanded': 'false', title: text }, '?');
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
