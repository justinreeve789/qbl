/**
 * The icons the interface uses, by what they mean. The game and the editor draw them from the
 * LordIcon set (animated icons, https://lordicon.com): each name is one icon file, which the
 * deployment supplies. The character beside each name is what is shown until that file has
 * loaded, and when there is none, so nothing is ever left blank.
 */
export const ICONS = {
  // the game's sidebar
  mission: '🎯', bag: '🎒', moves: '🤸', emotes: '😀', players: '👥', messages: '💬', glossary: '📖', narration: '🔊', 'narration-off': '🔇',
  // the heads-up display
  star: '⭐', account: '👤', badge: '🏅', rank: '🎖️', shop: '🛍️', close: '✕', send: '➤', check: '✓', team: '🛡️', profile: '🪪', lock: '🔒',
  // built-in moves
  jump: '⤴️', spin: '🌀', crouch: '⤵️', wave: '👋', dance: '💃', sparkle: '✨',
  // the editor's pages
  scenes: '🗺️', media: '🖼️', variables: '🔢', items: '🎒', characters: '🧑‍🚀', objectives: '✅', settings: '⚙️', publish: '🚀', reports: '📊', groups: '🗂️',
  play: '▶', shadow: '🌑',
} as const;

export type IconName = keyof typeof ICONS;

/** The icon that stands for one of these characters, for data that still names its icon by a character. */
export function iconFor(character: string): IconName | null {
  for (const [name, fallback] of Object.entries(ICONS)) if (fallback === character) return name as IconName;
  return null;
}
