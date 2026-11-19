import type { IconName } from './icons.js';

/** One of the site's main places, as the navigation menus list them. */
export interface SiteLink {
  key: 'missions' | 'editor' | 'classes' | 'docs';
  label: string;
  /** Short explanation, for the menu's second line and the link's tooltip. */
  hint: string;
  /** Same-origin path: the game, the editor and the docs share one address in every deployment. */
  href: string;
  icon: IconName;
}

const LINKS: SiteLink[] = [
  { key: 'missions', label: 'Missions', hint: 'Play the missions open to you', href: '/missions', icon: 'mission' },
  { key: 'editor', label: 'Editor', hint: 'Build and change scenarios', href: '/editor/#/', icon: 'editor' },
  { key: 'classes', label: 'Classes', hint: 'Students, assignments and teams', href: '/editor/#/classes', icon: 'classes' },
  { key: 'docs', label: 'Docs', hint: 'How scenarios and the editor work', href: '/docs/', icon: 'docs' },
];

/**
 * Where a signed-in user can go from any page. Teachers and admins move between playing
 * (Missions), building (Editor), teaching (Classes) and the documentation; everyone else has
 * the missions page only, so a student's menu offers just the way back to it.
 */
export function siteLinks(role: string | undefined): SiteLink[] {
  return role === 'teacher' || role === 'admin' ? LINKS.map((l) => ({ ...l })) : LINKS.filter((l) => l.key === 'missions').map((l) => ({ ...l }));
}
