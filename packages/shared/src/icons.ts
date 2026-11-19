import { TWEMOJI } from './twemoji.js';

/**
 * The icons the interface uses, by what they mean. Every icon is an emoji from one set,
 * Twemoji, drawn through the Twemoji Awesome stylesheet (github.com/iamludal/twemoji-awesome,
 * MIT; vendored in packages/shared/assets): `<i class="twa twa-rocket"></i>`. That makes them
 * look the same on every device, where plain emoji characters differ from one system to the next.
 *
 * Each name here is an emoji character; `twemojiClass` gives its class. To add an icon, add its
 * character here (or use it anywhere an icon is drawn) and run tools/make-twemoji-map.mjs.
 */
export const ICONS = {
  // the game's side panel
  mission: '🎯', bag: '🎒', moves: '🤸', emotes: '😀', players: '👥', messages: '💬', glossary: '📖', narration: '🔊', 'narration-off': '🔇',
  // the heads-up display
  star: '⭐', account: '👤', badge: '🏅', rank: '🎖️', shop: '🛍️', close: '❌', send: '📨', check: '✔️', team: '🛡️', profile: '📇', lock: '🔒',
  // built-in moves
  jump: '⤴️', spin: '🌀', crouch: '⤵️', wave: '👋', dance: '💃', sparkle: '✨',
  // the editor's pages
  scenes: '🗺️', media: '🖼️', variables: '🔢', items: '🎒', characters: '🧑‍🚀', objectives: '✅', settings: '⚙️', publish: '🚀', reports: '📊', groups: '🗂️',
  play: '▶️', shadow: '🌑',
  // the site's places (site.ts) and the account menu
  editor: '✏️', classes: '🏫', docs: '📚', 'sign-out': '🚪', chat: '💬',
} as const;

export type IconName = keyof typeof ICONS;

/**
 * The Twemoji Awesome class for an emoji character (`twa-rocket` for 🚀), or null for a
 * character the interface's map does not hold, which is then drawn as the character itself.
 */
export function twemojiClass(char: string): string | null {
  const name = TWEMOJI[char] ?? TWEMOJI[char.replace(/️/g, '')];
  return name ? `twa-${name}` : null;
}
