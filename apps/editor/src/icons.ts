import { ICONS, type IconName } from '@qbl/shared';

/**
 * Icons from the LordIcon set (https://lordicon.com), drawn by its own `<lord-icon>` element.
 *
 * LordIcon icons are files: one small animation (JSON) per icon, which a site downloads from
 * its LordIcon account, or addresses on LordIcon's CDN. This module does not contain them. It
 * looks for a **manifest** at `<base>/manifest.json`, which says where the file for each icon
 * name is:
 *
 *     { "mission": "mission.json", "players": "https://cdn.lordicon.com/abcdefgh.json", ... }
 *
 * `base` is `icons/lordicon` beside the editor's page unless the build sets `VITE_LORDICON_BASE`. Names are those in
 * `ICONS` (packages/shared/src/icons.ts); a name the manifest leaves out keeps its fallback
 * character. The manifest shipped here is empty, so every icon is its character until one is listed.
 */
// Beside the editor's own page (it is served under /editor/), unless the build says where.
const BASE = ((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_LORDICON_BASE ?? new URL('icons/lordicon', document.baseURI).pathname).replace(/\/+$/, '');

type Manifest = Partial<Record<IconName, string>>;
let manifest: Promise<Manifest | null> | null = null;

/** The manifest, fetched once. The LordIcon player is loaded with it, and only when there is one. */
function loadManifest(): Promise<Manifest | null> {
  manifest ??= (async () => {
    try {
      const res = await fetch(`${BASE}/manifest.json`, { headers: { Accept: 'application/json' } });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      const data = (await res.json()) as Manifest;
      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) return null;
      const { defineElement } = await import('@lordicon/element');
      if (!customElements.get('lord-icon')) defineElement();
      return data;
    } catch {
      return null;
    }
  })();
  return manifest;
}

function address(file: string): string {
  return /^(https?:)?\/\//.test(file) || file.startsWith('/') ? file : `${BASE}/${file}`;
}

/**
 * An icon, as an element to put in a button or a heading. It shows the icon's fallback
 * character at once and swaps in the LordIcon animation when that has loaded. The animation
 * plays when the pointer is over `target` (a CSS selector for an ancestor, usually the tab the
 * icon is in), or over the icon itself. (The game has the same loader in apps/client/src/ui/icons.ts.)
 */
export function icon(name: IconName, target?: string): HTMLElement {
  const node = document.createElement('span');
  node.className = 'icon-label lord';
  node.dataset.icon = name;
  node.setAttribute('aria-hidden', 'true');
  const fallback = document.createElement('span');
  fallback.className = 'lord-fallback';
  fallback.textContent = ICONS[name];
  node.append(fallback);

  void loadManifest().then((files) => {
    const file = files?.[name];
    if (!file) return;
    const animated = document.createElement('lord-icon');
    animated.setAttribute('src', address(file));
    animated.setAttribute('trigger', 'hover');
    if (target) animated.setAttribute('target', target);
    animated.className = 'lord-animated';
    // The character stays until the animation is ready, and for good if its file never arrives.
    animated.addEventListener('ready', () => node.classList.add('ready'), { once: true });
    node.append(animated);
  });
  return node;
}
