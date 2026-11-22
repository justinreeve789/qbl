import { MARK_MS, type ButtonMark, type InfoboxSize } from '@qbl/shared';
import { buildContent, type ContentEnv, type WordInfo } from './content';

export type { WordInfo };

/** A button of an infobox, as drawn. */
export interface BoxButton {
  label: string;
  mark?: ButtonMark;
}

export interface BoxOptions {
  dismissible: boolean;
  /** A picture or a video across the top of the box. */
  hero?: { url: string; type: 'image' | 'video' } | null;
  size?: InfoboxSize | null;
  /** A CSS colour for the edge and the main buttons. */
  accent?: string | null;
  word?: ContentEnv['word'];
  learn?: ContentEnv['learn'];
  /** A game variable's value, for what the box shows or tests. */
  vars?: ContentEnv['vars'];
  /** Covers the screen: where zoomed pictures and word cards are drawn. */
  layer: HTMLElement;
  /**
   * A button was chosen, with what was typed in the answer boxes. For a `try_again` button the
   * box stays open, and its buttons wait, until this settles.
   */
  chosen?: (index: number, answers: Record<string, string>) => void | Promise<void>;
  /** A page is showing (the first one included), to be read aloud. */
  onPage?: (page: HTMLElement, index: number) => void;
  /** Appear without the opening animation, on this page: the editor's preview, redrawn as the author types. */
  still?: boolean;
  page?: number;
}

/** One infobox on the page. The caller puts `node` somewhere and calls `start()`. */
export interface BoxView {
  node: HTMLElement;
  /** Settles with the button chosen, once its mark has shown, or null when the box is closed without one. */
  result: Promise<number | null>;
  /** Show the first page and focus the box. */
  start(): void;
  /** Close it as the player would (only if it may be closed that way). */
  dismiss(): void;
  /** Close it whatever it allows (the game took it away). */
  close(): void;
  /** A key pressed while this is the top box. True if the box used it. */
  key(e: KeyboardEvent): boolean;
  /** Animate away and take the node off the page. */
  leave(): Promise<void>;
}

const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function prefersMotion(): boolean {
  return !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

/**
 * An infobox: optional picture or video at the top, the content in pages, and its buttons. A
 * box with several pages steps through them with Next and Back (or ← and →), its dots showing
 * where the player is; its own buttons are offered on the last page. Buttons marked right or
 * wrong say so before the box goes on; a "try again" one shakes and is crossed out, and the box
 * stays open.
 */
export function infoboxView(html: string, buttons: BoxButton[], o: BoxOptions): BoxView {
  const motion = prefersMotion();
  let settle!: (index: number | null) => void;
  let settled = false;
  const result = new Promise<number | null>((r) => (settle = r));
  const finish = (index: number | null) => {
    if (settled) return;
    settled = true;
    content.quiet();
    settle(index);
  };

  const box = el('div', 'qbl-infobox');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.dataset.size = o.size ?? 'medium';
  if (o.still) box.classList.add('still');
  if (o.accent) box.style.setProperty('--qbl-box-accent', o.accent);

  const content = buildContent(html, { layer: o.layer, word: o.word, learn: o.learn, vars: o.vars, motion, submit: () => submit() });
  const { pages } = content;
  const multi = pages.length > 1;
  box.dataset.pages = String(pages.length);

  if (o.hero) {
    const hero = el('div', 'qbl-infobox-hero');
    if (o.hero.type === 'video') {
      const v = el('video');
      v.src = o.hero.url;
      v.controls = true;
      v.playsInline = true;
      v.preload = 'metadata';
      hero.append(v);
    } else {
      const img = el('img');
      img.src = o.hero.url;
      img.alt = '';
      img.decoding = 'async';
      hero.append(img);
    }
    box.append(hero);
  }
  if (o.dismissible && multi) {
    const x = el('button', 'qbl-infobox-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close');
    x.addEventListener('click', () => finish(null));
    box.append(x);
  }

  const body = el('div', 'qbl-infobox-body');
  for (const p of pages) {
    p.hidden = true;
    body.append(p);
  }
  // A fade along the bottom while there is more to scroll to.
  const more = () => body.classList.toggle('more', body.scrollHeight - body.scrollTop - body.clientHeight > 4);
  body.addEventListener('scroll', more, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(more).observe(body);
  const foot = el('div', 'qbl-infobox-foot');
  const nav = el('div', 'qbl-infobox-nav');
  const back = el('button', 'qbl-button ghost qbl-back', '← Back');
  back.type = 'button';
  back.addEventListener('click', () => show(page - 1));
  const steps = el('div', 'qbl-steps');
  steps.setAttribute('aria-hidden', 'true');
  const dots = pages.map(() => steps.appendChild(el('span', 'qbl-step')));
  const sr = el('span', 'qbl-sr');
  sr.setAttribute('aria-live', 'polite');
  const next = el('button', 'qbl-button primary qbl-next', 'Next →');
  next.type = 'button';
  next.addEventListener('click', () => show(page + 1));
  nav.append(back, steps, sr, next);
  const actions = el('div', 'qbl-infobox-actions');
  if (buttons.length > 2 || (multi && buttons.length === 2 && o.dismissible)) actions.classList.add('stacked');
  if (multi) foot.append(nav);
  // One or two buttons sit beside the page dots on the last page; more go in a list under them.
  if (multi && buttons.length + (o.dismissible ? 1 : 0) <= 2) nav.append(actions);
  else foot.append(actions);
  box.append(body, foot);

  // The box's own buttons, and its close button: on the last page.
  const tried = new Set<number>();
  let busy = false;
  const choices = buttons.map((b, index) => {
    const node = el('button', 'qbl-button primary qbl-choice');
    node.type = 'button';
    node.append(el('span', 'qbl-choice-label', b.label));
    if (b.mark) node.dataset.mark = b.mark;
    node.addEventListener('click', () => void choose(index));
    actions.append(node);
    return node;
  });
  if (o.dismissible) {
    const close = el('button', 'qbl-button qbl-close', buttons.length ? 'Not now' : 'Close');
    close.type = 'button';
    close.addEventListener('click', () => finish(null));
    actions.append(close);
  }

  /**
   * What is typed in the answer boxes. The first button (the one Enter presses: "Check") waits
   * until each box has something in it; the others ("I don't know", "Hint") take what is there.
   */
  const answersNow = (index: number): Record<string, string> | null => {
    const out: Record<string, string> = {};
    const missing = index === 0 ? content.answers.find((a) => a.value.trim() === '') : undefined;
    if (missing) {
      // Where it is, if on another page; then a shake.
      const at = pages.findIndex((p) => p.contains(missing));
      if (at >= 0 && at !== page) show(at);
      missing.classList.remove('qbl-missing');
      void missing.offsetWidth;
      missing.classList.add('qbl-missing');
      missing.focus();
      return null;
    }
    for (const a of content.answers) {
      const name = a.dataset.var;
      if (name) out[name] = a.value;
    }
    // Sliders, switches, wheels and graph points as they are set now (a wheel not spun yet, as
    // nothing), what is worked out from them, and whether each checked answer is right.
    return { ...content.controls.values(), ...out, ...content.checks() };
  };

  const sparkle = (button: HTMLElement) => {
    if (!motion) return;
    const burst = el('span', 'qbl-burst');
    burst.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 12; i++) {
      const s = el('i');
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4;
      const far = 46 + Math.random() * 34;
      s.style.setProperty('--dx', `${Math.cos(angle) * far}px`);
      s.style.setProperty('--dy', `${Math.sin(angle) * far}px`);
      s.style.setProperty('--hue', String(Math.round(Math.random() * 360)));
      burst.append(s);
    }
    button.append(burst);
    setTimeout(() => burst.remove(), 900);
  };

  const choose = async (index: number) => {
    if (busy || settled || tried.has(index)) return;
    // What is worked out with math.js has to be there before it is saved; it nearly always is.
    busy = true;
    await content.ready;
    busy = false;
    if (settled) return;
    const answers = answersNow(index);
    if (!answers) return;
    const mark = buttons[index]?.mark;
    const node = choices[index]!;
    busy = true;
    box.classList.add('choosing');
    for (const c of choices) c.disabled = true;
    node.classList.add('chosen');
    if (mark === 'try_again') {
      node.classList.add('is-wrong');
      await Promise.all([Promise.resolve(o.chosen?.(index, answers)).catch(() => {}), wait(motion ? MARK_MS : 0)]);
      if (settled) return;
      tried.add(index);
      node.classList.remove('is-wrong', 'chosen');
      node.classList.add('tried');
      node.setAttribute('aria-label', `${buttons[index]!.label} (not this one)`);
      choices.forEach((c, i) => (c.disabled = tried.has(i)));
      box.classList.remove('choosing');
      busy = false;
      choices.find((_, i) => !tried.has(i))?.focus();
      return;
    }
    void Promise.resolve(o.chosen?.(index, answers)).catch(() => {});
    if (mark === 'right') {
      node.classList.add('is-right');
      sparkle(node);
    } else if (mark === 'wrong') node.classList.add('is-wrong');
    if (mark && motion) await wait(MARK_MS);
    finish(index);
  };

  /** Enter in an answer box: on to the next page, or the first button not yet tried. */
  const submit = () => {
    if (page < pages.length - 1) return show(page + 1);
    const first = buttons.findIndex((_, i) => !tried.has(i));
    if (first >= 0) void choose(first);
  };

  let page = -1;
  const show = (i: number) => {
    if (i < 0 || i >= pages.length || i === page) return;
    const from = pages[page];
    const dir = i > page ? 1 : -1;
    const before = body.getBoundingClientRect().height;
    if (from) from.hidden = true;
    content.quiet();
    const to = pages[i]!;
    to.hidden = false;
    page = i;
    body.scrollTop = 0;
    const last = i === pages.length - 1;
    back.hidden = i === 0;
    next.hidden = last;
    actions.hidden = multi && !last;
    dots.forEach((d, n) => {
      d.classList.toggle('current', n === i);
      d.classList.toggle('seen', n < i);
    });
    sr.textContent = multi ? `Page ${i + 1} of ${pages.length}` : '';
    if (motion && to.animate) {
      if (from) {
        const after = body.getBoundingClientRect().height;
        if (Math.abs(after - before) > 1) body.animate([{ height: `${before}px` }, { height: `${after}px` }], { duration: 300, easing: EASE });
        to.animate([{ opacity: 0, transform: `translateX(${dir * 36}px)` }, { opacity: 1, transform: 'none' }], { duration: 340, easing: EASE });
      } else if (!o.still) {
        to.classList.add('qbl-enter');
        setTimeout(() => to.classList.remove('qbl-enter'), 900);
      }
    }
    content.shown(to);
    o.onPage?.(to, i);
    if (from) (last ? choices.find((_, n) => !tried.has(n)) ?? next : next).focus({ preventScroll: true });
  };

  const leave = async () => {
    box.classList.add('leaving');
    content.destroy();
    if (motion && box.animate) {
      await box.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-6px) scale(0.97)' }], { duration: 170, easing: 'ease-in', fill: 'forwards' }).finished.catch(() => {});
    }
    box.remove();
  };

  return {
    node: box,
    result,
    start() {
      show(Math.min(Math.max(0, o.page ?? 0), pages.length - 1));
      if (o.still) return;
      const field = pages[page]?.querySelector<HTMLInputElement>('input[data-qbl="answer"]');
      (field ?? (multi ? next : (choices[0] ?? actions.querySelector('button'))))?.focus({ preventScroll: true });
    },
    dismiss() {
      if (o.dismissible) finish(null);
    },
    close: () => finish(null),
    key(e) {
      if (e.key === 'Escape') {
        if (content.closeTop()) return true;
        if (o.dismissible) finish(null);
        return o.dismissible;
      }
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (multi && !typing && !busy && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        show(page + (e.key === 'ArrowRight' ? 1 : -1));
        return true;
      }
      return false;
    },
    leave,
  };
}
