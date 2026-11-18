import { ICONS, twemojiClass, type IconName } from '@qbl/shared';

/**
 * Icons. Every icon in the interface is an emoji from the Twemoji set, drawn through the
 * Twemoji Awesome stylesheet (github.com/iamludal/twemoji-awesome): an `<i class="twa twa-…">`
 * whose picture is the same on every device. The stylesheet is loaded once, in main.ts.
 */

/** An emoji as an icon. A character the stylesheet's map does not hold is shown as the character itself. */
export function emojiIcon(char: string, o: { size?: number; label?: string } = {}): HTMLElement {
  const name = twemojiClass(char);
  const node = document.createElement(name ? 'i' : 'span');
  node.className = name ? `qbl-icon twa ${name}` : 'qbl-icon';
  if (!name) node.textContent = char;
  if (o.size) node.style.fontSize = `${o.size}px`;
  if (o.label) {
    node.setAttribute('role', 'img');
    node.setAttribute('aria-label', o.label);
  } else {
    node.setAttribute('aria-hidden', 'true');
  }
  return node;
}

/** One of the interface's own icons, by what it means (the names in `ICONS`). */
export function icon(name: IconName, o: { size?: number; label?: string } = {}): HTMLElement {
  const node = emojiIcon(ICONS[name], o);
  node.dataset.icon = name;
  return node;
}
