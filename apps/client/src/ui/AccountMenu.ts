import { DEFAULT_RANKS, type SiteLink } from '@qbl/shared';
import { icon } from './icons';

/** A player's picture: an image, or a sprite sheet whose first frame is shown. */
export interface AvatarPicture {
  url: string | null;
  sheet?: { columns: number; rows: number } | null;
}

/** Stars, XP and rank, as the menu's heading shows them. */
export interface MenuStats {
  stars: number;
  xp: number;
  rank: string;
  next_rank_xp: number | null;
}

/** Something to do from the menu that stays on this page: open the profile, the wardrobe. */
export interface MenuAction {
  key: string;
  label: string;
  icon: Parameters<typeof icon>[0];
  run(): void;
}

export interface AccountMenuOptions {
  name: string;
  /** Under the name: "Teacher", "Playing as a guest". */
  subtitle?: string;
  avatar?: AvatarPicture | null;
  /** The site's places (Missions; for staff also Editor, Classes, Docs). */
  links: SiteLink[];
  /** The place this page is, marked and not linked. */
  current?: SiteLink['key'];
  /**
   * Going to another place. The game saves and leaves its room first; by default the browser
   * simply goes there.
   */
  onNavigate?(href: string): void;
  /** The last line: sign out (or, for a guest, sign in with an account). Absent: not offered. */
  signOut?: { label: string; run(): void } | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * A round picture of the player: the top of their avatar, so the face shows. A sprite sheet's
 * first frame is cut out once the sheet has loaded and its frame size is known.
 */
export function avatarFace(avatar: AvatarPicture | null | undefined, size: number): HTMLElement {
  const face = el('span', 'qbl-face');
  face.style.setProperty('--size', `${size}px`);
  if (!avatar?.url) {
    face.append(icon('account', { size: Math.round(size * 0.62) }));
    face.classList.add('empty');
    return face;
  }
  const url = avatar.url;
  const sheet = avatar.sheet;
  if (sheet && (sheet.columns > 1 || sheet.rows > 1)) {
    const frame = el('span', 'qbl-face-frame');
    frame.style.backgroundImage = `url("${url}")`;
    frame.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    const probe = new Image();
    probe.onload = () => {
      const w = probe.naturalWidth / sheet.columns;
      const h = probe.naturalHeight / sheet.rows;
      if (w > 0 && h > 0) frame.style.aspectRatio = `${w} / ${h}`;
    };
    probe.src = url;
    face.append(frame);
  } else {
    const img = el('img', 'qbl-face-frame');
    img.src = url;
    img.alt = '';
    face.append(img);
  }
  return face;
}

/**
 * The player's own corner: a round button with their face (and their stars, when they have an
 * account) that opens a menu. The menu says who is signed in, their rank and how far they are
 * to the next one, and offers their profile, the wardrobe, the site's other places, and signing
 * out. Nothing about the player takes room on the screen until they ask for it.
 */
export class AccountMenu {
  readonly root = el('div', 'qbl-me');
  private button = el('button', 'qbl-me-button');
  private badge = el('span', 'qbl-me-stars');
  private face: HTMLElement;
  private menu = el('div', 'qbl-me-menu');
  private stats: MenuStats | null = null;
  private actions: MenuAction[] = [];

  constructor(private options: AccountMenuOptions) {
    this.button.type = 'button';
    this.button.setAttribute('aria-haspopup', 'true');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.setAttribute('aria-controls', 'qbl-me-menu');
    this.badge.hidden = true;
    this.face = avatarFace(options.avatar, 44);
    this.button.append(this.face, this.badge);
    this.menu.id = 'qbl-me-menu';
    this.menu.hidden = true;
    this.menu.setAttribute('role', 'dialog');
    this.menu.setAttribute('aria-label', 'Your account');
    this.root.append(this.button, this.menu);
    this.label();

    this.button.addEventListener('click', () => (this.menu.hidden ? this.open() : this.close()));
    this.menu.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      this.close();
      this.button.focus();
    });
    // A press anywhere else puts it away.
    document.addEventListener('pointerdown', (e) => {
      if (!this.menu.hidden && !this.root.contains(e.target as Node)) this.close();
    }, true);
  }

  get isOpen(): boolean {
    return !this.menu.hidden;
  }

  /** Stars, XP and rank; null for an account that has none (a guest). */
  setStats(stats: MenuStats | null) {
    this.stats = stats;
    this.badge.hidden = stats == null;
    this.badge.replaceChildren();
    if (stats) this.badge.append(icon('star', { size: 12 }), el('span', '', compact(stats.stars)));
    this.label();
    if (this.isOpen) this.draw();
  }

  /** A different picture: the player chose another character. */
  setAvatar(avatar: AvatarPicture | null) {
    this.options = { ...this.options, avatar };
    const face = avatarFace(avatar, 44);
    this.face.replaceWith(face);
    this.face = face;
    if (this.isOpen) this.draw();
  }

  /** What can be done from the menu without leaving the page. */
  setActions(actions: MenuAction[]) {
    this.actions = actions;
    if (this.isOpen) this.draw();
  }

  open() {
    this.draw();
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    this.root.classList.add('open');
    (this.menu.querySelector('button, a') as HTMLElement | null)?.focus();
  }

  close() {
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    this.root.classList.remove('open');
  }

  private label() {
    const s = this.stats;
    const about = s ? `, ${s.stars} stars, rank ${s.rank}` : '';
    this.button.setAttribute('aria-label', `${this.options.name}${about}: your account and menu`);
    this.button.title = this.options.name;
  }

  private draw() {
    const o = this.options;
    const head = el('div', 'qbl-me-head');
    const who = el('div', 'qbl-me-who');
    who.append(el('strong', '', o.name));
    if (o.subtitle) who.append(el('small', '', o.subtitle));
    head.append(avatarFace(o.avatar, 48), who);

    const parts: HTMLElement[] = [head];
    const s = this.stats;
    if (s) {
      const progress = el('div', 'qbl-me-progress');
      const line = el('div', 'qbl-me-progress-line');
      const stars = el('span', 'qbl-stars');
      stars.append(icon('star', { size: 16 }), el('span', '', String(s.stars)));
      const rank = el('span', 'qbl-me-rank');
      rank.append(icon('rank', { size: 16 }), el('span', '', s.rank));
      line.append(stars, rank);
      const bar = el('div', 'qbl-me-bar');
      bar.setAttribute('role', 'progressbar');
      const fill = el('span');
      const toNext = s.next_rank_xp == null ? null : Math.max(0, s.next_rank_xp - s.xp);
      // The bar runs from where this rank starts (when it is one of the known ranks) to the next.
      const from = DEFAULT_RANKS.find((r) => r.name === s.rank && r.xp <= s.xp)?.xp ?? 0;
      const span = (s.next_rank_xp ?? 0) - from;
      const share = s.next_rank_xp == null || span <= 0 ? 1 : Math.min(1, Math.max(0, (s.xp - from) / span));
      fill.style.width = `${Math.round(share * 100)}%`;
      bar.append(fill);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-valuenow', String(Math.round(share * 100)));
      const note = el('small', 'qbl-me-xp', toNext == null ? `${s.xp} XP · top rank` : `${s.xp} XP · ${toNext} to next rank`);
      bar.setAttribute('aria-label', note.textContent ?? '');
      progress.append(line, bar, note);
      parts.push(progress);
    }

    const list = (className: string, items: HTMLElement[]) => {
      if (!items.length) return;
      const ul = el('ul', `qbl-me-list ${className}`);
      for (const item of items) {
        const li = el('li');
        li.append(item);
        ul.append(li);
      }
      parts.push(ul);
    };

    list('actions', this.actions.map((a) => {
      const b = el('button', 'qbl-me-item');
      b.type = 'button';
      b.dataset.action = a.key;
      b.append(icon(a.icon, { size: 20 }), el('span', '', a.label));
      b.addEventListener('click', () => {
        this.close();
        a.run();
      });
      return b;
    }));

    list('places', o.links.map((link) => {
      const here = link.key === o.current;
      const a = el('a', `qbl-me-item${here ? ' current' : ''}`);
      a.href = link.href;
      a.dataset.place = link.key;
      a.title = link.hint;
      if (here) a.setAttribute('aria-current', 'page');
      const text = el('span', 'qbl-me-text');
      text.append(el('span', '', link.label), el('small', '', link.hint));
      a.append(icon(link.icon, { size: 20 }), text);
      a.addEventListener('click', (e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        this.close();
        if (here) return;
        if (o.onNavigate) o.onNavigate(link.href);
        else window.location.assign(link.href);
      });
      return a;
    }));

    if (o.signOut) {
      const b = el('button', 'qbl-me-item sign-out');
      b.type = 'button';
      b.append(icon('sign-out', { size: 20 }), el('span', '', o.signOut.label));
      b.addEventListener('click', () => {
        this.close();
        o.signOut?.run();
      });
      list('end', [b]);
    }
    this.menu.replaceChildren(...parts);
  }
}

/** 1234 → "1.2k", so the badge on the button stays small. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(n / 1000)}k`;
}
