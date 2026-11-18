import { ICONS, twemojiClass, type IconName } from '@qbl/shared';

/**
 * Icons. As in the game, every icon is an emoji from the Twemoji set, drawn through the Twemoji
 * Awesome stylesheet (github.com/iamludal/twemoji-awesome): an `<i class="twa twa-…">` that
 * looks the same on every device. The stylesheet is loaded once, in main.ts.
 */

/** An emoji as an icon. A character the stylesheet's map does not hold is shown as the character itself. */
export function emojiIcon(char: string): HTMLElement {
  const name = twemojiClass(char);
  const node = document.createElement(name ? 'i' : 'span');
  node.className = name ? `icon-label twa ${name}` : 'icon-label';
  if (!name) node.textContent = char;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

/** One of the interface's own icons, by what it means (the names in `ICONS`). */
export function icon(name: IconName): HTMLElement {
  const node = emojiIcon(ICONS[name]);
  node.dataset.icon = name;
  return node;
}
