import { CHAT_MAX_LENGTH, type IconName, type ObjectiveStatus } from '@qbl/shared';
import { emojiIcon, icon } from './icons';
import type { ChatLine, GlossaryRow, LaunchChoice, LaunchView, PlayerRow, TeamRow } from './UiPort';

export type SidebarTab = 'mission' | 'bag' | 'moves' | 'players' | 'teams' | 'launch' | 'messages' | 'glossary';

const TABS: Array<{ key: SidebarTab; label: string; icon: IconName }> = [
  { key: 'mission', label: 'Mission', icon: 'mission' },
  { key: 'bag', label: 'Inventory', icon: 'bag' },
  { key: 'moves', label: 'Moves and emotes', icon: 'moves' },
  { key: 'players', label: 'Players', icon: 'players' },
  { key: 'teams', label: 'Team you are following', icon: 'team' },
  { key: 'launch', label: 'Launch a mission', icon: 'launch' },
  { key: 'messages', label: 'Messages', icon: 'messages' },
  { key: 'glossary', label: 'Glossary', icon: 'glossary' },
];

const STORE = 'qbl.sidebar';
/**
 * When the rail is a dock along the bottom of the screen instead of a column on the right: a
 * phone or tablet held upright. ui.css has the same query for the dock's layout.
 */
export const DOCK_QUERY = '(orientation: portrait) and (max-width: 1100px)';
const media = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(DOCK_QUERY) : null);
const docked = () => media()?.matches === true;
/** The thread for what is said out loud in the scene. Every other thread is one other player, by session id. */
export const SCENE_THREAD = 'scene';
const MAX_LINES = 200;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

interface Thread { key: string; name: string; lines: ChatLine[]; unread: number }

/**
 * The panel at the side of the screen that holds what used to float over the scene: the
 * mission checklist, what the player is wearing or riding, moves and emotes, who else is
 * playing, messages and the glossary. A rail of icons is always there; choosing one slides its
 * panel out, choosing it again (or pressing Escape) puts it away, so the scene can be left
 * clear. Which panel was open is remembered between visits.
 *
 * It only draws what it is given; the features decide what that is.
 */
export class Sidebar {
  readonly root = el('aside', 'qbl-sidebar');
  private rail = el('div', 'qbl-sidebar-rail');
  private panel = el('div', 'qbl-sidebar-panel');
  private heading = el('h2', 'qbl-sidebar-title');
  private body = el('div', 'qbl-sidebar-body');
  private buttons = new Map<SidebarTab, { button: HTMLButtonElement; count: HTMLElement }>();
  private available = new Set<SidebarTab>();
  private current: SidebarTab | null = null;
  /** Until the player chooses for themselves, the mission opens when there is one. */
  private chosen = false;

  private objectives: ObjectiveStatus[] = [];
  private worn: Array<{ id: number; name: string }> = [];
  private onRemove: (id: number) => void = () => {};
  private onWardrobe: (() => void) | null = null;
  private moves: Array<{ animation: string; label: string; icon: string }> = [];
  private onMove: (animation: string) => void = () => {};
  private emotes: string[] = [];
  private onEmote: (emoji: string) => void = () => {};
  private playerRows: PlayerRow[] = [];
  private teamRows: TeamRow[] = [];
  private onFollow: (group: string) => void = () => {};
  private launchView: LaunchView | null = null;
  private onLaunch: (choice: LaunchChoice) => void = () => {};
  /**
   * The teacher's choices on the launch tab, kept across redraws: the launcher scene picked before
   * launching ('' for none, the default), staying behind, the mission being confirmed.
   */
  private launchVia = '';
  private launchStay = false;
  private launchArmed: number | null = null;
  private onPlayer: { profile(id: string): void; message?(id: string): void } = { profile() {} };
  private messaging: { scene: boolean; private: boolean; send(thread: string, text: string): void } | null = null;
  private threads = new Map<string, Thread>();
  private thread: string | null = null;
  private words: GlossaryRow[] = [];
  private freshWords = new Set<string>();
  private wordFilter = '';
  private extras: HTMLElement[] = [];
  private controls: HTMLElement[] = [];

  constructor() {
    this.root.setAttribute('aria-label', 'Game menu');
    this.rail.setAttribute('role', 'toolbar');
    this.panel.id = 'qbl-sidebar-panel';
    this.panel.hidden = true;
    const close = el('button', 'qbl-sidebar-close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close the panel');
    close.append(icon('close', { size: 16 }));
    close.addEventListener('click', () => this.open(null, true));
    const head = el('div', 'qbl-sidebar-head');
    head.append(this.heading, close);
    this.panel.append(head, this.body);
    for (const tab of TABS) {
      const button = el('button', 'qbl-sidebar-tab');
      button.type = 'button';
      button.title = tab.label;
      button.dataset.tab = tab.key;
      button.setAttribute('aria-label', tab.label);
      button.setAttribute('aria-controls', this.panel.id);
      button.setAttribute('aria-expanded', 'false');
      button.hidden = true;
      const count = el('span', 'qbl-sidebar-count');
      count.hidden = true;
      button.append(icon(tab.icon, { size: 26 }), count);
      button.addEventListener('click', () => this.open(this.current === tab.key ? null : tab.key, true));
      this.buttons.set(tab.key, { button, count });
      this.rail.append(button);
    }
    this.root.append(this.panel, this.rail);
    // Upright, the rail runs along the bottom: tell assistive technology which way it goes.
    const orient = () => this.rail.setAttribute('aria-orientation', docked() ? 'horizontal' : 'vertical');
    orient();
    media()?.addEventListener?.('change', orient);
    this.root.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || this.current == null) return;
      e.stopPropagation();
      const was = this.current;
      this.open(null, true);
      this.buttons.get(was)?.button.focus();
    });
    try {
      const saved = localStorage.getItem(STORE);
      if (saved != null) {
        this.chosen = true;
        this.current = TABS.some((t) => t.key === saved) ? (saved as SidebarTab) : null;
      }
    } catch {
      /* storage can be unavailable in private modes */
    }
  }

  /** A control that sits at the foot of the rail, under the tabs: the read-aloud switch. */
  addControl(node: HTMLElement) {
    this.extras.push(node);
    this.controls.push(node);
    this.rail.append(node);
  }

  /** A button among the tabs, after them, that opens something of its own instead of a panel: the notebook. */
  addTool(node: HTMLElement) {
    this.extras.push(node);
    this.rail.insertBefore(node, this.controls[0] ?? null);
    this.draw();
  }

  removeTool(node: HTMLElement) {
    this.extras = this.extras.filter((n) => n !== node);
    node.remove();
    this.draw();
  }

  /** Which panel is open, if any. */
  get openTab(): SidebarTab | null {
    return this.current != null && this.available.has(this.current) ? this.current : null;
  }

  /** Open a panel, or close whichever is open (null). `byPlayer`: remember it as the player's choice. */
  open(tab: SidebarTab | null, byPlayer = false) {
    this.current = tab;
    if (byPlayer) {
      this.chosen = true;
      try {
        localStorage.setItem(STORE, tab ?? '');
      } catch {
        /* ignore */
      }
    }
    this.draw();
  }

  // ------------------------------------------------------------- content

  setObjectives(list: ObjectiveStatus[]) {
    this.objectives = list;
    this.offer('mission', list.length > 0);
    // The checklist is in view from the start, as it always was, until the player puts it away.
    // Not on an upright phone, where it would cover half the scene: the dock's count says it is there.
    if (!this.chosen && this.current == null && list.length > 0 && !docked()) this.current = 'mission';
    const left = list.filter((o) => !o.complete && !o.optional).length;
    this.count('mission', left, `${left} to do`);
    this.draw('mission');
  }

  setAttachments(items: Array<{ id: number; name: string }>, onRemove: (id: number) => void) {
    this.worn = items;
    this.onRemove = onRemove;
    this.offer('bag', items.length > 0 || this.onWardrobe != null);
    this.count('bag', items.length, `${items.length} in use`);
    this.draw('bag');
  }

  /** The way into the wardrobe and marketplace, for players who have one. */
  setWardrobe(onOpen: (() => void) | null) {
    this.onWardrobe = onOpen;
    this.offer('bag', this.worn.length > 0 || onOpen != null);
    this.draw('bag');
  }

  setMoves(list: Array<{ animation: string; label: string; icon: string }>, onDo: (animation: string) => void) {
    this.moves = list;
    this.onMove = onDo;
    this.offer('moves', list.length > 0 || this.emotes.length > 0);
    this.draw('moves');
  }

  setEmotes(list: string[], onSend: (emoji: string) => void) {
    this.emotes = list;
    this.onEmote = onSend;
    this.offer('moves', this.moves.length > 0 || list.length > 0);
    this.draw('moves');
  }

  setPlayers(list: PlayerRow[], on: { profile(id: string): void; message?(id: string): void }) {
    this.playerRows = list;
    this.onPlayer = on;
    this.offer('players', list.length > 0);
    const others = list.filter((p) => !p.me).length;
    this.count('players', others, `${others} other player${others === 1 ? '' : 's'}`);
    this.draw('players');
  }

  /**
   * For a teacher: the teams of the assignment, to follow one. The teacher plays in the followed
   * team's game; choosing another moves them into that team's. Null: not offered.
   */
  setTeams(list: TeamRow[] | null, onFollow: (group: string) => void) {
    this.teamRows = list ?? [];
    this.onFollow = onFollow;
    this.offer('teams', list != null);
    this.draw('teams');
  }

  /**
   * For a teacher: their missions, to launch one for the players here, and the scenes they can be
   * sent through first. Null: not offered.
   */
  setLaunches(view: LaunchView | null, launch: (choice: LaunchChoice) => void) {
    this.launchView = view;
    this.onLaunch = launch;
    if (view && this.launchVia && !view.departures.some((d) => String(d.sceneId) === this.launchVia)) this.launchVia = '';
    this.offer('launch', view != null);
    this.draw('launch');
  }

  setMessaging(o: { scene: boolean; private: boolean; send(thread: string, text: string): void } | null) {
    this.messaging = o;
    this.offer('messages', o != null && (o.scene || o.private));
    this.draw('messages');
  }

  addMessage(line: ChatLine) {
    const thread = this.threadFor(line.thread, line.threadName);
    thread.lines.push(line);
    if (thread.lines.length > MAX_LINES) thread.lines.shift();
    const reading = this.openTab === 'messages' && this.thread === line.thread;
    if (!line.mine && !reading) thread.unread++;
    this.countUnread();
    this.draw('messages');
  }

  /** Open the conversation with one player (or the scene's), ready to type in. */
  openThread(key: string, name: string) {
    this.threadFor(key, name);
    this.thread = key;
    this.open('messages', true);
    (this.body.querySelector('.qbl-messages-form input') as HTMLInputElement | null)?.focus();
  }

  setGlossary(list: GlossaryRow[], fresh?: string) {
    this.words = list;
    if (fresh != null && this.openTab !== 'glossary') this.freshWords.add(fresh);
    this.offer('glossary', list.length > 0);
    this.count('glossary', this.freshWords.size, `${this.freshWords.size} new`);
    this.draw('glossary');
  }

  // -------------------------------------------------------------- drawing

  private offer(tab: SidebarTab, available: boolean) {
    if (available) this.available.add(tab);
    else this.available.delete(tab);
    this.buttons.get(tab)!.button.hidden = !available;
  }

  private count(tab: SidebarTab, n: number, spoken: string) {
    const { button, count } = this.buttons.get(tab)!;
    count.hidden = n <= 0;
    count.textContent = n > 99 ? '99+' : String(n);
    const label = TABS.find((t) => t.key === tab)!.label;
    button.setAttribute('aria-label', n > 0 ? `${label} (${spoken})` : label);
  }

  private countUnread() {
    let unread = 0;
    for (const t of this.threads.values()) unread += t.unread;
    this.count('messages', unread, `${unread} unread`);
  }

  private threadFor(key: string, name: string): Thread {
    let thread = this.threads.get(key);
    if (!thread) {
      thread = { key, name, lines: [], unread: 0 };
      this.threads.set(key, thread);
    } else if (name) {
      thread.name = name;
    }
    return thread;
  }

  /** Draw the open panel. With `only`, nothing is done unless that is the panel showing. */
  private draw(only?: SidebarTab) {
    const tab = this.openTab;
    this.rail.hidden = this.available.size === 0 && this.extras.length === 0;
    this.root.classList.toggle('open', tab != null);
    for (const [key, { button }] of this.buttons) {
      button.classList.toggle('current', key === tab);
      button.setAttribute('aria-expanded', String(key === tab));
    }
    if (only && only !== tab) return;
    this.panel.hidden = tab == null;
    if (tab == null) return;
    this.heading.textContent = TABS.find((t) => t.key === tab)!.label;
    // Keep what the player is typing, and where they have scrolled to, across a redraw.
    const typing = this.body.querySelector('input:focus') as HTMLInputElement | null;
    const draft = typing ? { name: typing.name, value: typing.value, choice: typing.type === 'radio' || typing.type === 'checkbox' } : null;
    this.body.dataset.tab = tab;
    this.body.replaceChildren(...this.content(tab));
    if (draft) {
      // A radio or a checkbox gets its focus back (the same one of its group); typed text its text too.
      const inputs = [...this.body.querySelectorAll<HTMLInputElement>('input')].filter((i) => i.name === draft.name);
      const again = draft.choice ? inputs.find((i) => i.value === draft.value) : inputs[0];
      if (again) {
        if (!draft.choice) again.value = draft.value;
        again.focus();
      }
    }
    if (tab === 'messages') {
      const log = this.body.querySelector('.qbl-messages-log');
      if (log) log.scrollTop = log.scrollHeight;
    }
  }

  private content(tab: SidebarTab): HTMLElement[] {
    switch (tab) {
      case 'mission':
        return [this.missionList()];
      case 'bag':
        return this.bag();
      case 'moves':
        return this.movesAndEmotes();
      case 'players':
        return [this.players()];
      case 'teams':
        return this.teams();
      case 'launch':
        return this.launches();
      case 'messages':
        return this.messages();
      case 'glossary':
        return this.glossary();
    }
  }

  private missionList(): HTMLElement {
    const ul = el('ul', 'qbl-objectives');
    for (const o of this.objectives) {
      const li = el('li', o.complete ? 'done' : '');
      const mark = el('span', 'qbl-objectives-mark', o.complete ? '✓' : '');
      mark.setAttribute('aria-hidden', 'true');
      li.append(mark, el('span', '', o.optional ? `Bonus: ${o.text}` : o.text));
      li.setAttribute('aria-label', `${o.text}${o.complete ? ' (done)' : ''}`);
      ul.appendChild(li);
    }
    return ul;
  }

  private bag(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (this.worn.length) {
      const list = el('ul', 'qbl-bag');
      for (const item of this.worn) {
        const li = el('li');
        const off = el('button', 'qbl-chip', 'Leave');
        off.type = 'button';
        off.setAttribute('aria-label', `Leave ${item.name}`);
        off.addEventListener('click', () => this.onRemove(item.id));
        li.append(el('span', '', item.name), off);
        list.append(li);
      }
      out.push(el('h3', '', 'Wearing or riding'), list);
    } else {
      out.push(el('p', 'qbl-sidebar-empty', 'You are not wearing or riding anything from this mission. Click things in the scene to pick them up.'));
    }
    if (this.onWardrobe) {
      const open = el('button', 'qbl-button wide');
      open.type = 'button';
      open.append(icon('shop', { size: 20 }), el('span', '', 'Wardrobe and marketplace'));
      open.addEventListener('click', () => this.onWardrobe?.());
      out.push(open);
    }
    return out;
  }

  private movesAndEmotes(): HTMLElement[] {
    const out: HTMLElement[] = [];
    if (this.moves.length) {
      const row = el('div', 'qbl-moves');
      row.setAttribute('role', 'toolbar');
      row.setAttribute('aria-label', 'Moves');
      for (const move of this.moves) {
        const b = el('button', 'qbl-move');
        b.type = 'button';
        b.title = move.label;
        b.dataset.move = move.animation;
        const picture = el('span', 'qbl-move-icon');
        picture.append(emojiIcon(move.icon));
        b.append(picture, el('span', 'qbl-move-label', move.label));
        b.addEventListener('click', () => this.onMove(move.animation));
        row.append(b);
      }
      out.push(el('h3', '', 'Moves'), row);
    }
    if (this.emotes.length) {
      const pad = el('div', 'qbl-emotes');
      for (const emoji of this.emotes) {
        const b = el('button', 'qbl-emote');
        b.append(emojiIcon(emoji));
        b.type = 'button';
        b.setAttribute('aria-label', `Send ${emoji}`);
        b.addEventListener('click', () => this.onEmote(emoji));
        pad.append(b);
      }
      out.push(el('h3', '', 'Emotes'), pad);
    }
    return out;
  }

  private players(): HTMLElement {
    const list = el('ul', 'qbl-players');
    for (const p of this.playerRows) {
      const li = el('li', `${p.me ? 'me' : ''}${p.connected ? '' : ' away'}`);
      const who = el('button', 'qbl-player');
      who.type = 'button';
      who.title = `See ${p.me ? 'your' : `${p.name}'s`} profile`;
      const name = el('strong', '', p.me ? `${p.name} (you)` : p.name);
      const where = el('small', '', [p.teammate && !p.me ? (p.team ? `${p.team}` : 'Your team') : p.team, p.here ? 'here' : p.where].filter(Boolean).join(' · '));
      who.append(icon(p.teammate ? 'team' : 'account', { size: 18 }), name, where);
      who.addEventListener('click', () => this.onPlayer.profile(p.id));
      li.append(who);
      if (!p.me && this.onPlayer.message) {
        const say = el('button', 'qbl-player-message');
        say.type = 'button';
        say.setAttribute('aria-label', `Message ${p.name}`);
        say.title = `Message ${p.name}`;
        say.append(icon('messages', { size: 18 }));
        say.addEventListener('click', () => this.onPlayer.message?.(p.id));
        li.append(say);
      }
      list.append(li);
    }
    return list;
  }

  private teams(): HTMLElement[] {
    const current = this.teamRows.find((t) => t.current);
    const intro = el('p', 'qbl-sidebar-note', current
      ? `You are following ${current.name}: you are in their game, you see what they see, and they see you. Choose another team to follow it; you join its game where most of its players are.`
      : 'Choose a team to follow: you join its game, where most of its players are.');
    const list = el('ul', 'qbl-teams');
    for (const t of this.teamRows) {
      const li = el('li', t.current ? 'current' : '');
      const pick = el('button', 'qbl-team');
      pick.type = 'button';
      pick.dataset.team = t.group;
      pick.disabled = t.current;
      const what = el('span', 'qbl-team-text');
      const online = t.online ? `${t.online} playing${t.where ? ` · most in ${t.where}` : ''}` : 'Nobody playing now';
      what.append(el('strong', '', t.name), el('small', '', online));
      pick.append(icon('team', { size: 18 }), what, el('span', 'qbl-team-go', t.current ? 'Following' : 'Follow'));
      pick.setAttribute('aria-label', t.current ? `Following ${t.name}` : `Follow ${t.name}`);
      pick.addEventListener('click', () => this.onFollow(t.group));
      li.append(pick);
      list.append(li);
    }
    return [intro, list];
  }

  private launches(): HTMLElement[] {
    const view = this.launchView;
    if (!view) return [];
    const intro = el('p', 'qbl-sidebar-note', 'Send all your students into one of your missions at once, wherever they are playing. A mission that waits for you appears on their missions page once you launch it.');
    const out: HTMLElement[] = [intro];

    const stay = el('label', 'qbl-launch-check');
    const box = el('input');
    box.type = 'checkbox';
    box.name = 'launch-go';
    box.checked = !this.launchStay;
    box.addEventListener('change', () => {
      this.launchStay = !box.checked;
      this.draw('launch');
    });
    stay.append(box, el('span', '', 'Go with them'));
    out.push(stay);

    if (!view.missions.length) {
      out.push(el('p', 'qbl-sidebar-empty', 'You have no other missions assigned. Assign one on the Classes page, then launch it from here.'));
      return out;
    }
    // With launcher scenes in this scenario, where the class goes first is chosen before any Launch.
    if (view.departures.length) out.push(this.launcherPrompt(view));
    const list = el('ul', 'qbl-launches');
    for (const m of view.missions) {
      const li = el('li', m.waiting ? 'waiting' : '');
      li.dataset.assignment = String(m.assignmentId);
      const what = el('span', 'qbl-launch-text');
      const state = el('small', '');
      if (m.waiting) state.append(icon('waiting', { size: 14 }), document.createTextNode(' Waiting for you · '));
      state.append(document.createTextNode(`${m.students === 1 ? '1 student' : `${m.students} students`} assigned${m.here ? `, ${m.here} here` : ''}`));
      what.append(el('strong', '', m.title), state);
      const armed = this.launchArmed === m.assignmentId;
      const go = el('button', `qbl-button${armed ? ' primary' : ''}`);
      go.type = 'button';
      go.dataset.launch = String(m.assignmentId);
      go.append(icon('launch', { size: 18 }), el('span', '', armed ? 'Launch now' : 'Launch'));
      go.setAttribute('aria-label', armed ? `Launch ${m.title} now` : `Launch ${m.title}`);
      // Two presses: the first confirms, the second launches. A launch moves the whole class.
      go.addEventListener('click', () => {
        if (this.launchArmed !== m.assignmentId) {
          this.launchArmed = m.assignmentId;
          this.draw('launch');
          return;
        }
        this.launchArmed = null;
        const via = this.launchVia;
        this.launchVia = '';
        this.onLaunch({ assignmentId: m.assignmentId, sceneId: via ? Number(via) : undefined, stay: this.launchStay });
        // Launched: the panel gets out of the way.
        this.open(null, true);
      });
      li.append(what, go);
      if (armed) {
        const where = view.departures.find((d) => String(d.sceneId) === this.launchVia);
        const way = where ? `to ${where.name} first, and on from there` : 'straight there';
        // Every student of the teacher goes, wherever they are playing, not only those assigned it.
        const plan = `All your students go ${way}, wherever they are playing${this.launchStay ? '; you stay here' : ', and you go with them'}.`;
        const confirm = el('p', 'qbl-launch-confirm', `${plan} Press again to launch.`);
        const cancel = el('button', 'qbl-link', 'Cancel');
        cancel.type = 'button';
        cancel.addEventListener('click', () => {
          this.launchArmed = null;
          this.draw('launch');
        });
        confirm.append(' ', cancel);
        li.append(confirm);
      }
      list.append(li);
    }
    out.push(list);
    return out;
  }

  /** Where the class goes first, chosen before launching: one of this scenario's launcher scenes, or none. */
  private launcherPrompt(view: LaunchView): HTMLElement {
    const ways = el('fieldset', 'qbl-launch-ways');
    ways.append(el('legend', '', 'Before it opens, take them to'));
    const choice = (value: string, text: string) => {
      const label = el('label', '');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'launch-via';
      radio.value = value;
      radio.checked = this.launchVia === value;
      radio.addEventListener('change', () => {
        this.launchVia = value;
        this.draw('launch');
      });
      label.append(radio, el('span', '', text));
      return label;
    };
    for (const d of view.departures) ways.append(choice(String(d.sceneId), d.name));
    ways.append(choice('', 'None: open the mission straight away'));
    return ways;
  }

  private messages(): HTMLElement[] {
    const m = this.messaging;
    if (!m) return [];
    if (m.scene) this.threadFor(SCENE_THREAD, 'Everyone here');
    const threads = [...this.threads.values()].filter((t) => t.key !== SCENE_THREAD || m.scene);
    if (this.thread == null || !this.threads.has(this.thread)) this.thread = threads[0]?.key ?? null;
    const current = this.thread != null ? this.threads.get(this.thread) : undefined;
    if (current) current.unread = 0;
    this.countUnread();

    const tabs = el('div', 'qbl-messages-threads');
    tabs.setAttribute('role', 'tablist');
    for (const t of threads) {
      const b = el('button', t.key === this.thread ? 'current' : '', t.name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t.key === this.thread));
      if (t.unread > 0) b.append(el('span', 'qbl-sidebar-count inline', String(t.unread)));
      b.addEventListener('click', () => {
        this.thread = t.key;
        this.draw('messages');
      });
      tabs.append(b);
    }
    if (!current) {
      return [el('p', 'qbl-sidebar-empty', m.private ? 'No messages yet. Choose someone on the Players tab to write to.' : 'No messages yet.')];
    }
    const log = el('div', 'qbl-messages-log');
    log.setAttribute('role', 'log');
    log.setAttribute('aria-live', 'polite');
    if (!current.lines.length) log.append(el('p', 'qbl-sidebar-empty', current.key === SCENE_THREAD ? 'What is said in the scene shows up here.' : `Say hello to ${current.name}.`));
    for (const line of current.lines) {
      const row = el('p', line.mine ? 'mine' : '');
      row.append(el('strong', '', line.mine ? 'You' : line.from), el('span', '', line.text));
      log.append(row);
    }
    const form = el('form', 'qbl-messages-form');
    const input = el('input');
    input.type = 'text';
    input.name = 'message';
    input.maxLength = CHAT_MAX_LENGTH;
    input.autocomplete = 'off';
    input.placeholder = current.key === SCENE_THREAD ? 'Say something to everyone here…' : `Message ${current.name}…`;
    input.setAttribute('aria-label', input.placeholder);
    const send = el('button', 'qbl-button primary');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send');
    send.append(icon('send', { size: 18 }));
    form.append(input, send);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) m.send(current.key, text);
      input.value = '';
    });
    const note = el('p', 'qbl-sidebar-note', 'Messages are filtered, and kept so that a teacher can read them later.');
    return [tabs, log, form, note];
  }

  private glossary(): HTMLElement[] {
    // Opening the glossary is looking at the new words: they stay marked for this look, and are then no longer new.
    const fresh = new Set(this.freshWords);
    if (this.freshWords.size) {
      this.freshWords.clear();
      this.count('glossary', 0, '');
    }
    const search = el('input', 'qbl-glossary-search');
    search.type = 'search';
    search.name = 'glossary';
    search.placeholder = 'Find a word…';
    search.setAttribute('aria-label', 'Find a word');
    search.value = this.wordFilter;
    const list = el('dl', 'qbl-glossary');
    const fill = () => {
      const q = this.wordFilter.trim().toLowerCase();
      list.replaceChildren();
      for (const w of this.words) {
        if (q && !w.term.toLowerCase().includes(q) && !w.definition.toLowerCase().includes(q)) continue;
        const term = el('dt', fresh.has(w.id) ? 'fresh' : '', w.term);
        if (fresh.has(w.id)) term.append(el('span', 'qbl-glossary-new', 'New'));
        const meaning = el('dd');
        if (w.image) {
          const img = el('img');
          img.src = w.image;
          img.alt = '';
          meaning.append(img);
        }
        meaning.append(el('span', '', w.definition));
        list.append(term, meaning);
      }
      if (!list.childElementCount) list.append(el('p', 'qbl-sidebar-empty', q ? 'No word matches that.' : 'Words you meet on the mission are collected here.'));
    };
    search.addEventListener('input', () => {
      this.wordFilter = search.value;
      fill();
    });
    fill();
    return this.words.length > 6 ? [search, list] : [list];
  }
}
