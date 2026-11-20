import { CALLOUT_TONES } from '@qbl/shared';
import { emojiIcon } from '../icons';
import { sanitizeHtml } from '../sanitize';

/** What a glossary word says when it is tapped. */
export interface WordInfo {
  term: string;
  definition: string;
  image?: string | null;
}

export interface ContentEnv {
  /** Covers the screen: where zoomed pictures and word cards are drawn. */
  layer: HTMLElement;
  /** A glossary word's entry, or null when the scenario has no such word (it is then plain text). */
  word?: (id: string) => WordInfo | null;
  /** The player has looked a word up: put it in their glossary. True when it is new to them. */
  learn?: (id: string) => boolean;
  /** Enter was pressed in an answer box. */
  submit?: () => void;
  /** False when the player prefers reduced motion: things change at once. */
  motion: boolean;
}

/** An infobox's content, ready to show: its pages, its answer boxes, and its videos and sounds. */
export interface RichContent {
  pages: HTMLElement[];
  answers: HTMLInputElement[];
  /** A page is now showing: start whatever on it starts by itself. */
  shown(page: HTMLElement): void;
  /** Pause every video and sound. */
  quiet(): void;
  /** Close the top pop-up (a zoomed picture or a word's card). True if there was one. */
  closeTop(): boolean;
  destroy(): void;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** Whether a page has anything on it worth a page of its own. */
const hasContent = (page: HTMLElement) => (page.textContent ?? '').trim() !== '' || page.querySelector('img, video, audio, input') != null;

/**
 * Turn an infobox's HTML into what the player sees: sanitised, split into pages at each
 * `<hr data-qbl="page">`, and with its slideshows, cards, callouts, answer boxes, glossary words
 * and pictures made into things to play with.
 */
export function buildContent(html: string, env: ContentEnv): RichContent {
  const holder = el('div');
  holder.append(sanitizeHtml(html.includes('<') ? html : html.replace(/\n/g, '<br>')));

  const all: HTMLElement[] = [el('section', 'qbl-page')];
  for (const node of Array.from(holder.childNodes)) {
    if (node instanceof HTMLHRElement && node.dataset.qbl === 'page') {
      all.push(el('section', 'qbl-page'));
      continue;
    }
    all.at(-1)!.append(node);
  }
  const pages = all.filter(hasContent);
  if (pages.length === 0) pages.push(all[0]!);

  const cleanups: Array<() => void> = [];
  const popups: Array<{ close(): void }> = [];
  const media: HTMLMediaElement[] = [];

  for (const page of pages) {
    for (const g of page.querySelectorAll<HTMLElement>('div[data-qbl="gallery"]')) cleanups.push(gallery(g, env));
    for (const d of page.querySelectorAll('details')) reveal(d, env);
    for (const f of page.querySelectorAll<HTMLElement>('div[data-qbl="flip"]')) flipCard(f);
    for (const c of page.querySelectorAll<HTMLElement>('div[data-qbl="callout"]')) {
      c.classList.add('qbl-callout');
      const inside = el('div', 'qbl-callout-body');
      inside.append(...c.childNodes);
      c.append(inside);
      const icon = el('span', 'qbl-callout-icon');
      icon.append(emojiIcon(CALLOUT_TONES[c.dataset.tone as keyof typeof CALLOUT_TONES] ?? CALLOUT_TONES.tip, { size: 22 }));
      icon.setAttribute('aria-hidden', 'true');
      c.prepend(icon);
    }
    for (const w of page.querySelectorAll<HTMLElement>('span[data-qbl="word"]')) word(w, env, popups);
    for (const img of page.querySelectorAll('img')) {
      if (img.closest('.qbl-flip')) continue;
      img.classList.add('qbl-zoomable');
      img.addEventListener('click', (e) => {
        if ((e as PointerEvent & { qblDragged?: boolean }).qblDragged) return;
        zoom(img, env, popups);
      });
    }
    media.push(...page.querySelectorAll<HTMLMediaElement>('video, audio'));
  }
  const answers = pages.flatMap((p) => [...p.querySelectorAll<HTMLInputElement>('input[data-qbl="answer"]')]);
  for (const input of answers) {
    input.classList.add('qbl-answer-box');
    if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', input.placeholder || 'Your answer');
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      env.submit?.();
    });
    input.addEventListener('input', () => input.classList.remove('qbl-missing'));
  }

  const quiet = () => {
    for (const m of media) if (!m.paused) m.pause();
  };
  const closeTop = () => {
    const top = popups.pop();
    if (!top) return false;
    top.close();
    return true;
  };
  return {
    pages,
    answers,
    shown(page) {
      for (const m of page.querySelectorAll<HTMLMediaElement>('video[autoplay], audio[autoplay]')) {
        if (m.closest('.qbl-slide:not(.current)')) continue;
        if (m instanceof HTMLVideoElement) m.muted = true;
        void m.play().catch(() => {});
      }
    },
    quiet,
    closeTop,
    destroy() {
      quiet();
      while (closeTop());
      for (const c of cleanups) c();
    },
  };
}

// ------------------------------------------------------------------ slideshow

/**
 * A slideshow: its pictures side by side on a strip that slides. Swipe or drag it, use the
 * arrows, tap a dot, or press ← and → when it has focus.
 */
function gallery(root: HTMLElement, env: ContentEnv): () => void {
  const items = [...root.children].filter((c) => c.matches('img, figure, video')) as HTMLElement[];
  const rest = [...root.childNodes].filter((n) => !items.includes(n as HTMLElement));
  root.replaceChildren();
  root.classList.add('qbl-gallery');
  root.tabIndex = 0;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-roledescription', 'slideshow');

  const viewport = el('div', 'qbl-gallery-viewport');
  const track = el('div', 'qbl-gallery-track');
  const slides = items.map((item) => {
    const slide = el('div', 'qbl-slide');
    slide.append(item);
    track.append(slide);
    return slide;
  });
  viewport.append(track);
  const prev = el('button', 'qbl-gallery-arrow prev', '‹');
  const next = el('button', 'qbl-gallery-arrow next', '›');
  prev.type = next.type = 'button';
  prev.setAttribute('aria-label', 'Previous picture');
  next.setAttribute('aria-label', 'Next picture');
  const dots = el('div', 'qbl-gallery-dots');
  dots.dataset.unread = '';
  const count = el('span', 'qbl-gallery-count');
  count.setAttribute('aria-live', 'polite');
  const dotButtons = slides.map((_, i) => {
    const d = el('button', 'qbl-dot');
    d.type = 'button';
    d.setAttribute('aria-label', `Picture ${i + 1}`);
    d.addEventListener('click', () => go(i));
    dots.append(d);
    return d;
  });
  root.append(viewport);
  if (slides.length > 1) {
    viewport.append(prev, next);
    root.append(dots);
  }
  root.append(count, ...rest);

  let index = 0;
  const go = (i: number, animate = true) => {
    index = Math.max(0, Math.min(slides.length - 1, i));
    track.style.transition = animate && env.motion ? `transform 0.42s ${EASE}` : 'none';
    track.style.transform = `translateX(${-index * 100}%)`;
    slides.forEach((s, n) => {
      s.classList.toggle('current', n === index);
      s.setAttribute('aria-hidden', String(n !== index));
      if (n !== index) for (const m of s.querySelectorAll('video')) m.pause();
    });
    dotButtons.forEach((d, n) => d.setAttribute('aria-current', String(n === index)));
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    count.textContent = slides.length > 1 ? `${index + 1} / ${slides.length}` : '';
  };
  prev.addEventListener('click', () => go(index - 1));
  next.addEventListener('click', () => go(index + 1));
  root.addEventListener('keydown', (e) => {
    if (e.target !== root) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopPropagation();
      e.preventDefault();
      go(index + (e.key === 'ArrowRight' ? 1 : -1));
    }
  });

  // Dragging: the strip follows the finger, then settles on the nearest picture, or the next
  // one if it was flicked. A press that barely moves is a tap, and zooms the picture.
  let start: { x: number; y: number; t: number; id: number } | null = null;
  let dx = 0;
  let dragged = false;
  const down = (e: PointerEvent) => {
    if (slides.length < 2 || (e.target as Element).closest('button, video')) return;
    start = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
    dx = 0;
    dragged = false;
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    dx = e.clientX - start.x;
    if (!dragged && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(e.clientY - start.y)) {
      dragged = true;
      viewport.setPointerCapture(e.pointerId);
    }
    if (!dragged) return;
    const edge = (index === 0 && dx > 0) || (index === slides.length - 1 && dx < 0) ? 0.35 : 1;
    track.style.transition = 'none';
    track.style.transform = `translateX(calc(${-index * 100}% + ${dx * edge}px))`;
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const fast = Math.abs(dx) / Math.max(1, performance.now() - start.t) > 0.5;
    if (dragged) go(index + (Math.abs(dx) > viewport.clientWidth / 5 || (fast && Math.abs(dx) > 20) ? (dx < 0 ? 1 : -1) : 0));
    start = null;
  };
  // A drag is not a tap: the click that ends it does not zoom.
  const click = (e: MouseEvent) => {
    if (dragged) {
      (e as MouseEvent & { qblDragged?: boolean }).qblDragged = true;
      dragged = false;
    }
  };
  viewport.addEventListener('pointerdown', down);
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('click', click, true);
  for (const img of viewport.querySelectorAll('img')) img.draggable = false;
  go(0, false);
  return () => {
    start = null;
  };
}

// ------------------------------------------------------------- reveal cards

/** `<details>`: a card that opens smoothly to show what it hides. What it hides is not read aloud with the rest. */
function reveal(d: HTMLDetailsElement, env: ContentEnv) {
  d.classList.add('qbl-reveal');
  let summary = d.querySelector(':scope > summary') as HTMLElement | null;
  if (!summary) {
    summary = el('summary', '', 'Tap to reveal');
    d.prepend(summary);
  }
  const body = el('div', 'qbl-reveal-body');
  body.dataset.unread = '';
  for (const n of [...d.childNodes]) if (n !== summary) body.append(n);
  d.append(body);
  let running: Animation | null = null;
  summary.addEventListener('click', (e) => {
    e.preventDefault();
    running?.cancel();
    const opening = !d.open;
    if (opening) d.open = true;
    if (opening) delete body.dataset.unread;
    if (!env.motion || !body.animate) {
      d.open = opening;
      return;
    }
    const h = body.scrollHeight;
    running = body.animate(
      opening ? [{ height: '0px', opacity: 0 }, { height: `${h}px`, opacity: 1 }] : [{ height: `${h}px`, opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: opening ? 320 : 220, easing: EASE },
    );
    running.onfinish = () => {
      running = null;
      if (!opening) d.open = false;
    };
  });
}

// --------------------------------------------------------------- flip cards

/** A card that turns over when tapped: its first child is the front, its second the back. */
function flipCard(card: HTMLElement) {
  const faces = [...card.children] as HTMLElement[];
  const front = el('div', 'qbl-flip-face front');
  const back = el('div', 'qbl-flip-face back');
  if (faces[0]) front.append(...faces[0].childNodes);
  if (faces[1]) back.append(...faces[1].childNodes);
  for (const extra of faces.slice(2)) back.append(extra);
  back.dataset.unread = '';
  back.setAttribute('aria-hidden', 'true');
  const hint = el('span', 'qbl-flip-hint', '↻ Tap to turn over');
  hint.dataset.unread = '';
  hint.setAttribute('aria-hidden', 'true');
  front.append(hint);
  const inner = el('div', 'qbl-flip-inner');
  inner.append(front, back);
  card.replaceChildren(inner);
  card.classList.add('qbl-flip');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-pressed', 'false');
  const turn = () => {
    const over = card.classList.toggle('flipped');
    card.setAttribute('aria-pressed', String(over));
    back.setAttribute('aria-hidden', String(!over));
    front.setAttribute('aria-hidden', String(over));
  };
  card.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a, video, audio')) return;
    turn();
  });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      turn();
    }
  });
}

// ------------------------------------------------------------ glossary words

/** A glossary word in the text. Tapped, a card says what it means, and the word goes into the player's glossary. */
function word(w: HTMLElement, env: ContentEnv, popups: Array<{ close(): void }>) {
  const id = w.dataset.word ?? '';
  const info = env.word?.(id) ?? null;
  if (!info) return;
  w.classList.add('qbl-term');
  w.tabIndex = 0;
  w.setAttribute('role', 'button');
  w.setAttribute('aria-label', `${w.textContent ?? info.term}: what it means`);
  const open = () => {
    const card = el('div', 'qbl-word-card');
    card.setAttribute('role', 'note');
    card.dataset.unread = '';
    if (info.image) {
      const pic = el('img');
      pic.src = info.image;
      pic.alt = '';
      card.append(pic);
    }
    card.append(el('strong', '', info.term), el('p', '', info.definition));
    const fresh = env.learn?.(id);
    if (fresh != null) card.append(el('small', 'qbl-word-status', fresh ? '📘 Added to your glossary' : '📘 In your glossary'));
    env.layer.append(card);
    // Under the word, or over it when there is no room below; kept inside the layer.
    const area = env.layer.getBoundingClientRect();
    const at = w.getBoundingClientRect();
    const size = card.getBoundingClientRect();
    const left = Math.min(Math.max(8, at.left - area.left + at.width / 2 - size.width / 2), area.width - size.width - 8);
    const below = at.bottom + 10 + size.height < area.bottom;
    card.style.left = `${left}px`;
    card.style.top = `${(below ? at.bottom + 10 : at.top - size.height - 10) - area.top}px`;
    card.dataset.side = below ? 'below' : 'above';
    card.style.setProperty('--tail', `${at.left - area.left + at.width / 2 - left}px`);
    w.classList.add('open');
    const outside = (e: PointerEvent) => {
      if (!card.contains(e.target as Node) && e.target !== w) handle.close();
    };
    const handle = {
      close: () => {
        document.removeEventListener('pointerdown', outside, true);
        w.classList.remove('open');
        const i = popups.indexOf(handle);
        if (i >= 0) popups.splice(i, 1);
        if (env.motion && card.animate) card.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateY(4px) scale(0.97)' }], { duration: 120 }).onfinish = () => card.remove();
        else card.remove();
      },
    };
    document.addEventListener('pointerdown', outside, true);
    popups.push(handle);
  };
  w.addEventListener('click', (e) => {
    e.stopPropagation();
    if (w.classList.contains('open')) return;
    for (const p of [...popups]) p.close();
    open();
  });
  w.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      w.click();
    }
  });
}

// ----------------------------------------------------------------- zooming

/** A picture tapped: it grows from where it is to fill the screen. Tapping again or Escape puts it back. */
function zoom(img: HTMLImageElement, env: ContentEnv, popups: Array<{ close(): void }>) {
  const shade = el('div', 'qbl-zoom');
  shade.setAttribute('role', 'dialog');
  shade.setAttribute('aria-label', img.alt || 'Picture');
  shade.dataset.unread = '';
  const big = el('img');
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  shade.append(big);
  const caption = img.closest('figure')?.querySelector('figcaption')?.textContent?.trim();
  if (caption) shade.append(el('p', 'qbl-zoom-caption', caption));
  env.layer.append(shade);

  const from = img.getBoundingClientRect();
  const fly = (reverse: boolean) => {
    const to = big.getBoundingClientRect();
    if (!env.motion || !big.animate || !to.width || !from.width) return null;
    const scale = from.width / to.width;
    const moved = `translate(${from.left + from.width / 2 - (to.left + to.width / 2)}px, ${from.top + from.height / 2 - (to.top + to.height / 2)}px) scale(${scale})`;
    shade.animate([{ backgroundColor: 'rgba(5, 8, 20, 0)' }, { backgroundColor: 'rgba(5, 8, 20, 0.88)' }], { duration: 300, direction: reverse ? 'reverse' : 'normal', fill: 'both' });
    return big.animate([{ transform: moved }, { transform: 'none' }], { duration: reverse ? 240 : 360, easing: EASE, direction: reverse ? 'reverse' : 'normal', fill: 'both' });
  };
  fly(false);
  let closed = false;
  const handle = {
    close: () => {
      if (closed) return;
      closed = true;
      const i = popups.indexOf(handle);
      if (i >= 0) popups.splice(i, 1);
      const back = fly(true);
      if (back) back.onfinish = () => shade.remove();
      else shade.remove();
    },
  };
  shade.addEventListener('click', handle.close);
  popups.push(handle);
}
