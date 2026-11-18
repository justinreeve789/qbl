/**
 * The marketing page at "/". No game code: just its styles, the characters' entrances and the
 * log-in button. Signing in itself happens on /missions (the game's sign-in screen).
 */
import './site.css';

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
}

document.getElementById('year')!.textContent = String(new Date().getFullYear());
