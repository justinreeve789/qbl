/**
 * Draws the app's icons (apps/client/public/icons/) from the QuestLab mark on the marketing page:
 * "QL" in Fredoka on a pink → purple → cyan tile. Run it after changing the mark:
 *
 *   node tools/make-app-icons.mjs
 *
 * Needs Playwright's Chromium (npx playwright install chromium-headless-shell).
 *
 *   icon-192.png, icon-512.png          "any": the rounded tile on a clear background
 *   maskable-192.png, maskable-512.png   Android's adaptive icons: the tile fills the square and
 *                                        the letters stay inside the middle 80% (the safe zone)
 *   apple-touch-icon.png                 180 px, filled (iOS rounds the corners itself)
 *   favicon-32.png                       the browser tab
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'apps/client/public/icons');
mkdirSync(out, { recursive: true });
const font = readFileSync(join(root, 'node_modules/@fontsource/fredoka/files/fredoka-latin-700-normal.woff2')).toString('base64');

// Tailwind's pink-500, purple-500 and cyan-400, as in the page's "bg-gradient-to-tr".
const gradient = 'linear-gradient(to top right, #ec4899, #a855f7, #22d3ee)';

function page(size, { filled, text }) {
  const inset = filled ? 0 : Math.round(size * 0.04);
  const radius = filled ? 0 : Math.round(size * 0.22);
  return `<!doctype html><html><head><style>
    @font-face { font-family: Fredoka; font-weight: 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }
    html, body { margin: 0; width: ${size}px; height: ${size}px; background: transparent; overflow: hidden; }
    .tile { position: absolute; inset: ${inset}px; border-radius: ${radius}px; background: ${gradient};
      display: grid; place-items: center; }
    .ql { font: 700 ${Math.round(size * text)}px/1 Fredoka, sans-serif; color: #fff; letter-spacing: 0.01em;
      text-shadow: 0 ${Math.max(1, Math.round(size * 0.012))}px ${Math.round(size * 0.03)}px rgba(60, 10, 80, 0.35);
      transform: translateY(-0.03em); }
  </style></head><body><div class="tile"><span class="ql">QL</span></div></body></html>`;
}

const icons = [
  ['icon-192.png', 192, { filled: false, text: 0.46 }],
  ['icon-512.png', 512, { filled: false, text: 0.46 }],
  ['maskable-192.png', 192, { filled: true, text: 0.36 }],
  ['maskable-512.png', 512, { filled: true, text: 0.36 }],
  ['apple-touch-icon.png', 180, { filled: true, text: 0.42 }],
  ['favicon-32.png', 32, { filled: false, text: 0.5 }],
];

const browser = await chromium.launch();
try {
  for (const [name, size, look] of icons) {
    const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await tab.setContent(page(size, look));
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({ path: join(out, name), omitBackground: true });
    await tab.close();
    console.log(`icons/${name}`);
  }
} finally {
  await browser.close();
}
