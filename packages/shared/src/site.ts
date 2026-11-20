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
 * Each role's dashboard: where the marketing page's log-in button takes someone already signed
 * in. Teachers and admins work in the editor, so that is theirs; everyone else plays, so theirs
 * is the missions page. Signing in is different: it lands everyone, teachers too, on the missions
 * page (their assignments, "Look in", missions to try), whose menu has the Editor and Classes.
 */
export function homePath(role: string | undefined): string {
  return role === 'teacher' || role === 'admin' ? '/editor/#/' : '/missions';
}

/**
 * Where a signed-in user can go from any page. Teachers and admins move between playing
 * (Missions), building (Editor), teaching (Classes) and the documentation; everyone else has
 * the missions page only, so a student's menu offers just the way back to it.
 */
export function siteLinks(role: string | undefined): SiteLink[] {
  return role === 'teacher' || role === 'admin' ? LINKS.map((l) => ({ ...l })) : LINKS.filter((l) => l.key === 'missions').map((l) => ({ ...l }));
}

// ------------------------------------------------------------------ scenario codes

/**
 * Players open a scenario at /{code}. A new scenario gets 16 random lowercase letters; its
 * editor can change that to something easier to type. The old code then stops working.
 *
 * A code is 4 to 32 characters: lowercase letters, digits and single hyphens, starting with a
 * letter and not ending with a hyphen. It may not be one of the site's own addresses.
 * The API checks the same rules (App\Qbl\ScenarioStore::codeProblem); keep the two in step.
 */
export const SCENARIO_CODE_MIN = 4;
export const SCENARIO_CODE_MAX = 32;
const CODE_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** The site's own first path segments. A scenario code may not be one of them. */
export const RESERVED_CODES: readonly string[] = [
  'about', 'admin', 'api', 'app', 'assets', 'auth', 'billing', 'classes', 'district', 'docs', 'editor', 'game', 'help', 'home', 'index',
  'login', 'logout', 'media', 'missions', 'new', 'play', 'plans', 'pricing', 'profile', 'register', 'scenario-assets', 'scenarios',
  'settings', 'shop', 'signin', 'signout', 'signup', 'sso', 'static', 'teach', 'wardrobe',
];

/** A code as it is stored: trimmed and lowercase. */
export function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

/** Why `code` cannot be a scenario code, in a sentence for the editor; null when it can. Pass it normalized. */
export function codeProblem(code: string): string | null {
  if (code.length < SCENARIO_CODE_MIN) return `A code needs at least ${SCENARIO_CODE_MIN} characters.`;
  if (code.length > SCENARIO_CODE_MAX) return `A code can have at most ${SCENARIO_CODE_MAX} characters.`;
  if (!/^[a-z0-9-]+$/.test(code)) return 'Use only lowercase letters, digits and hyphens.';
  if (!/^[a-z]/.test(code)) return 'A code starts with a letter.';
  if (!CODE_SHAPE.test(code)) return 'A hyphen goes between letters or digits: not at the end, and not two in a row.';
  if (RESERVED_CODES.includes(code)) return `“${code}” is one of the site’s own addresses.`;
  return null;
}

/** The scenario code in a page's path (`/{code}` or `/{code}/`), or null for any other address. */
export function codeFromPath(pathname: string): string | null {
  const raw = /^\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (raw === undefined) return null;
  let segment: string;
  try {
    segment = normalizeCode(decodeURIComponent(raw));
  } catch {
    return null;
  }
  return codeProblem(segment) === null ? segment : null;
}
