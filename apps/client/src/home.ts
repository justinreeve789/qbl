import { siteLinks, type User } from '@qbl/shared';
import { AccountMenu } from './ui/AccountMenu';
import { icon } from './ui/icons';

/** A scenario the player can play, as `GET /api/missions` lists it. */
export interface Mission {
  id: number;
  code: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  image?: string | null;
  /** public: open to everyone. assigned: given to this player by a teacher. */
  kind: 'public' | 'assigned';
  /** Which instance of the scenario the player joins: "public", an assignment's or a team's. */
  group: string;
  teacher?: string;
  team?: string | null;
  due_at?: string | null;
  note?: string | null;
  started_at?: string | null;
}

/** One of the platform's avatars, as `GET /api/avatars` lists it. */
export interface AvatarChoice {
  media_id: number;
  name: string;
  image_url: string;
  sheet?: { columns: number; rows: number } | null;
}

/** What a mission's card says, worked out apart from the page so it can be tested. */
export interface MissionCard {
  mission: Mission;
  href: string;
  action: 'Start' | 'Continue';
  /** Short labels under the title: who assigned it, the team, when it is due. */
  tags: { text: string; tone: 'plain' | 'team' | 'due' | 'late' }[];
}

/** Times from the API are UTC, written "2026-12-01 15:00:00". */
function parseUtc(value: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
}

export function dueLabel(dueAt: string, now: Date, locale?: string): { text: string; late: boolean } {
  const due = parseUtc(dueAt);
  const late = due.getTime() < now.getTime();
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  const date = due.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  if (late) return { text: `Was due ${date}`, late };
  if (days === 0) return { text: 'Due today', late };
  if (days === 1) return { text: 'Due tomorrow', late };
  return { text: `Due ${date}`, late };
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function missionCard(mission: Mission, now: Date, locale?: string): MissionCard {
  const tags: MissionCard['tags'] = [];
  if (mission.kind === 'assigned') {
    if (mission.teacher) tags.push({ text: `From ${mission.teacher}`, tone: 'plain' });
    if (mission.team) tags.push({ text: `Team ${mission.team}`, tone: 'team' });
    if (mission.due_at) {
      const due = dueLabel(mission.due_at, now, locale);
      tags.push({ text: due.text, tone: due.late ? 'late' : 'due' });
    }
  }
  const query = mission.group === 'public' ? '' : `?group=${encodeURIComponent(mission.group)}`;
  return { mission, href: `/${mission.code}${query}`, action: mission.started_at ? 'Continue' : 'Start', tags };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** A button showing an avatar: the picture, or the first frame of a sprite sheet. */
export function avatarButton(avatar: AvatarChoice, chosen: boolean): HTMLButtonElement {
  const b = el('button');
  b.type = 'button';
  b.setAttribute('aria-label', avatar.name);
  b.setAttribute('aria-pressed', String(chosen));
  b.title = avatar.name;
  if (avatar.sheet) {
    const frame = el('span', 'qbl-avatar-frame');
    frame.style.backgroundImage = `url("${avatar.image_url}")`;
    frame.style.backgroundSize = `${avatar.sheet.columns * 100}% ${avatar.sheet.rows * 100}%`;
    b.appendChild(frame);
  } else {
    const img = el('img');
    img.src = avatar.image_url;
    img.alt = '';
    b.appendChild(img);
  }
  return b;
}

export interface HomeOptions {
  user: User;
  missions: Mission[];
  avatars: AvatarChoice[];
  avatarId: number | null;
  /** Called when the player picks a different avatar. */
  onAvatar(id: number): void;
  onSignOut(): void;
}

/**
 * The page a player lands on: every mission they can play. Assigned ones first (a teacher gave
 * them, perhaps with a due date and a team), then the ones open to everyone.
 */
/** What the missions page says about who is signed in, where it explains what is (not) listed. */
export function whoNotice(role: string): string | null {
  if (role === 'guest') return 'You are playing as a guest. Sign in with your own account to see the missions your teacher assigned you.';
  if (role === 'teacher' || role === 'admin') {
    return 'You are signed in as a teacher. Students see the missions you assign when they sign in with their own accounts; the game and the editor share one sign-in in each browser. To watch a class, use "Look in" on Classes (in the menu at the top).';
  }
  return null;
}

export function buildHome(options: HomeOptions, now = new Date()): HTMLElement {
  const { user, missions, avatars } = options;
  let avatarId = options.avatarId;
  const page = el('div', 'qbl-home');

  // The bar across the top: the site's places for teachers and admins (Missions, Editor, Classes,
  // Docs), and the player's own menu. On a phone the places sit in a row of their own under it.
  const links = siteLinks(user.role);
  const bar = el('header', 'qbl-site');
  const brand = el('a', 'qbl-site-brand', 'QuestLab');
  brand.href = '/';
  const nav = el('nav', 'qbl-site-nav');
  nav.setAttribute('aria-label', 'Site');
  if (links.length > 1) {
    for (const link of links) {
      const a = el('a', `qbl-site-link${link.key === 'missions' ? ' current' : ''}`);
      a.href = link.href;
      a.title = link.hint;
      a.dataset.place = link.key;
      if (link.key === 'missions') a.setAttribute('aria-current', 'page');
      a.append(icon(link.icon, { size: 18 }), el('span', undefined, link.label));
      nav.appendChild(a);
    }
  }
  const avatarOf = (id: number | null) => {
    const mine = avatars.find((a) => a.media_id === id) ?? avatars[0];
    return mine ? { url: mine.image_url, sheet: mine.sheet ?? null } : null;
  };
  const menu = new AccountMenu({
    name: user.name,
    subtitle: user.role === 'guest' ? 'Playing as a guest' : user.role === 'admin' ? 'Administrator' : user.role === 'teacher' ? 'Teacher' : undefined,
    avatar: avatarOf(avatarId),
    links,
    current: 'missions',
    signOut: { label: user.role === 'guest' ? 'Sign in with an account' : 'Sign out', run: () => options.onSignOut() },
  });
  bar.append(brand, nav, menu.root);
  if (links.length > 1) bar.classList.add('staff');
  page.appendChild(bar);

  const header = el('header', 'qbl-home-header');
  const who = el('div', 'qbl-home-who');
  const face = el('button', 'qbl-home-face');
  face.type = 'button';
  face.title = 'Change your character';
  face.setAttribute('aria-label', 'Change your character');
  const drawFace = () => {
    const mine = avatars.find((a) => a.media_id === avatarId) ?? avatars[0];
    face.replaceChildren();
    face.hidden = !mine;
    if (mine) face.append(...avatarButton(mine, false).childNodes);
  };
  drawFace();
  const greeting = el('div');
  greeting.append(el('h1', undefined, `Welcome, ${user.name}`), el('p', undefined, 'Choose a mission to begin.'));
  who.append(face, greeting);
  header.append(who);
  page.appendChild(header);

  // Missions a teacher assigns reach a student's own account. Say so where the page would
  // otherwise look as if they were missing: a guest, or a teacher who opened the game.
  const notice = whoNotice(user.role);
  if (notice) page.appendChild(el('p', 'qbl-home-notice', notice));

  // The character picker opens under the header and closes once one is chosen.
  const picker = el('section', 'qbl-home-picker');
  picker.hidden = true;
  const grid = el('div', 'qbl-avatars');
  const drawPicker = () => {
    grid.replaceChildren(
      ...avatars.map((a) => {
        const b = avatarButton(a, a.media_id === avatarId);
        b.addEventListener('click', () => {
          avatarId = a.media_id;
          options.onAvatar(a.media_id);
          picker.hidden = true;
          drawFace();
          menu.setAvatar(avatarOf(avatarId));
        });
        return b;
      }),
    );
  };
  picker.append(el('h2', undefined, 'Choose your character'), el('p', undefined, 'You keep the same character in every mission.'), grid);
  const togglePicker = () => {
    picker.hidden = !picker.hidden;
    if (!picker.hidden) drawPicker();
  };
  face.addEventListener('click', togglePicker);
  if (avatars.length) {
    menu.setActions([{ key: 'character', label: 'Change your character', icon: 'account', run: () => {
      if (picker.hidden) togglePicker();
      picker.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } }]);
  }
  page.appendChild(picker);

  const section = (title: string, list: Mission[]) => {
    if (!list.length) return;
    const wrap = el('section', 'qbl-home-section');
    wrap.appendChild(el('h2', undefined, title));
    const cards = el('div', 'qbl-missions');
    for (const mission of list) {
      const card = missionCard(mission, now);
      const a = el('a', `qbl-mission ${mission.kind}`);
      a.href = card.href;
      const art = el('div', 'qbl-mission-art');
      if (mission.image) art.style.backgroundImage = `url("${mission.image}")`;
      const body = el('div', 'qbl-mission-body');
      body.appendChild(el('h3', undefined, mission.title));
      const about = mission.subtitle || mission.description;
      if (about) body.appendChild(el('p', 'qbl-mission-about', about));
      if (card.tags.length) {
        const tags = el('div', 'qbl-mission-tags');
        for (const tag of card.tags) tags.appendChild(el('span', `qbl-tag ${tag.tone}`, tag.text));
        body.appendChild(tags);
      }
      if (mission.note) body.appendChild(el('p', 'qbl-mission-note', mission.note));
      body.appendChild(el('span', 'qbl-mission-go', card.action));
      a.append(art, body);
      cards.appendChild(a);
    }
    wrap.appendChild(cards);
    page.appendChild(wrap);
  };
  section('Your assignments', missions.filter((m) => m.kind === 'assigned'));
  section('Open missions', missions.filter((m) => m.kind === 'public'));
  if (!missions.length) page.appendChild(el('p', 'qbl-home-empty', 'There are no missions for you yet. Check back soon.'));
  return page;
}
