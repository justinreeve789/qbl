/**
 * The site as an installable app (a PWA): the service worker (public/sw.js) and the browser's
 * offer to install. The manifest is public/manifest.webmanifest, linked from both pages.
 *
 * Browsers that can install a site (Chrome, Edge, Samsung Internet on Android and desktop) say so
 * with a `beforeinstallprompt` event. It is kept here, and the account menu shows "Install the
 * app" while there is one. Safari has no such event (on an iPhone: Share → Add to Home Screen),
 * and inside the installed app, or the Android app (a Trusted Web Activity), nothing is offered.
 */

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

/** True when the page is running as the installed app rather than in a browser tab. */
export function runningAsApp(): boolean {
  if (typeof window === 'undefined') return false;
  const standalone = ['standalone', 'fullscreen', 'minimal-ui'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches);
  // The Android app opens the site with this referrer (see tools/android).
  return standalone || document.referrer.startsWith('android-app://');
}

/** Installing, when the browser offers it right now; else null. */
export function installOffer(): (() => Promise<boolean>) | null {
  if (!offer || runningAsApp()) return null;
  const event = offer;
  return async () => {
    offer = null;
    changed();
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  };
}

/** Told when an offer to install comes or goes. Returns a function that stops it. */
export function onInstallOffer(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Registers the service worker and, on pages with the account menu (`menu`), keeps the offer to
 * install for it. Without the menu (the marketing page) the browser shows its own. Once per page.
 */
export function setUpApp({ menu = true }: { menu?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  if (menu) {
    window.addEventListener('beforeinstallprompt', (e) => {
      // Keep it for the menu instead of the browser's own banner.
      e.preventDefault();
      offer = e as InstallPromptEvent;
      changed();
    });
  }
  window.addEventListener('appinstalled', () => {
    offer = null;
    changed();
  });
  // Not under `vite` (development): the worker would serve yesterday's files to a page that reloads itself.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => console.warn('qbl: no service worker', err));
  });
}
