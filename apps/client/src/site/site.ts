/**
 * The marketing page at "/". No game code: just its styles, the characters' entrances and the
 * log-in button. Signing in itself happens on /missions (the game's sign-in screen).
 */
import './site.css';
import { setUpApp } from '../pwa';

// No account menu here to offer installing from: the browser's own offer stays.
setUpApp({ menu: false });

// Bubbles pop and peeking characters rise as their part of the page scrolls into view.
const reveal = document.querySelectorAll<HTMLElement>('[data-reveal]');
if ('IntersectionObserver' in window) {
  const seen = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-in');
        seen.unobserve(entry.target);
      }
    },
    { threshold: 0.25, rootMargin: '0px 0px -8% 0px' },
  );
  reveal.forEach((el) => seen.observe(el));
} else {
  reveal.forEach((el) => el.classList.add('is-in'));
}

// Someone already signed in (the game keeps its token under "qbl.token") goes straight to their missions.
let signedIn = false;
try {
  signedIn = !!localStorage.getItem('qbl.token');
} catch {
  /* storage blocked: treat as signed out */
}
if (signedIn) {
  document.querySelectorAll<HTMLElement>('[data-login-label]').forEach((el) => (el.textContent = el.dataset.loginLabel ?? el.textContent));
  void staffDashboard();
} else {
  void offerCreateAccount();
}

/** "Create an account" links stay hidden unless the site lets visitors make their own account. */
async function offerCreateAccount() {
  try {
    const base = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/auth/providers`, { headers: { Accept: 'application/json' } });
    if (!res.ok || !((await res.json()) as { register?: boolean }).register) return;
    document.querySelectorAll<HTMLElement>('[data-create-account]').forEach((el) => (el.hidden = false));
  } catch {
    /* offline: no link */
  }
}

/**
 * A signed-in teacher's or admin's dashboard is the editor, so the log-in buttons take them there
 * (as `homePath` in @qbl/shared has it; not imported, to keep the game's code off this page).
 * Anyone else, or any failure to find out, leaves the buttons going to /missions.
 */
async function staffDashboard() {
  try {
    const base = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '');
    const res = await fetch(`${base}/api/me`, { headers: { Accept: 'application/json', Authorization: `Bearer ${localStorage.getItem('qbl.token')}` } });
    if (!res.ok) return;
    const role = ((await res.json()) as { user?: { role?: string } }).user?.role;
    if (role !== 'teacher' && role !== 'content_admin' && role !== 'admin') return; // isStaff in @qbl/shared
    document.querySelectorAll<HTMLAnchorElement>('a[href="/missions"]').forEach((a) => {
      a.href = '/editor/#/';
      const label = a.querySelector<HTMLElement>('[data-login-label]');
      if (label) label.textContent = 'My dashboard';
      else a.textContent = 'Go to your dashboard →';
    });
  } catch {
    /* offline, or storage blocked: the buttons keep going to /missions */
  }
}

document.getElementById('year')!.textContent = String(new Date().getFullYear());
