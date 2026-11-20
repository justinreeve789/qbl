import { CHAT_MAX_LENGTH, EMOTES, type ActionHandle, type Alignment, type CharacterPicture, type ChatMode, type ObjectiveStatus } from '@qbl/shared';
import { sanitizeHtml } from './sanitize';
import { placeBubble, type BubbleAnchor } from './bubble';
import { AccountMenu, type MenuStats } from './AccountMenu';
import { emojiIcon, icon } from './icons';
import { pictureNode } from './picture';
import { narratable, Narrator, type SpeakOptions } from './Narrator';
import { Sidebar } from './Sidebar';
import type { AccountActions, AccountView, ChatLine, GlossaryRow, InfoboxHandle, OverlayHandle, PlayerRow, ProfileView, TeamRow, ShopView, UiPort } from './UiPort';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function handle(remove: () => void): ActionHandle & { finish(): void } {
  let settled = false;
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const finish = () => {
    if (settled) return;
    settled = true;
    remove();
    resolve();
  };
  return { done, cancel: finish, finish };
}

const ALIGN_CLASS = (a: Alignment | undefined) => `align-${(a ?? 'center center').replace(' ', '-')}`;

/**
 * Everything drawn in HTML on top of the canvas: screen-space overlays
 * (text, images, video), infoboxes, chat, and status messages. Keeping
 * these in the DOM gives crisp text, real buttons and screen-reader access,
 * and keeps them unaffected by camera zoom.
 */
export class Ui implements UiPort {
  readonly root: HTMLElement;
  private overlays = el('div', 'qbl-overlays');
  private hud = el('div', 'qbl-hud');
  /** The side panel: mission, inventory, moves and emotes, players, messages, glossary. */
  readonly sidebar = new Sidebar();
  readonly narrator = new Narrator();
  private toasts = el('div', 'qbl-toasts');
  private banner = el('div', 'qbl-banner');
  private modals = 0;
  private video: HTMLVideoElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'qbl-ui');
    this.banner.hidden = true;
    this.root.append(this.overlays, this.corner, this.sidebar.root, this.hud, this.toasts, this.banner);
    parent.appendChild(this.root);
    this.followKeyboard();
  }

  /**
   * On a phone the on-screen keyboard covers the bottom of the page without resizing it (iOS
   * Safari, and Chrome on Android by default). `--qbl-keyboard` is how much of the page it
   * covers, so the chat bar can sit on top of the keyboard instead of behind it.
   */
  private followKeyboard() {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      this.root.style.setProperty('--qbl-keyboard', `${covered}px`);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    update();
  }

  /** True while something modal is open or a text field has focus; the game ignores movement input meanwhile. */
  get capturesInput(): boolean {
    const active = document.activeElement;
    return this.modals > 0 || active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  }

  get videoPlaying(): boolean {
    return !!this.video && !this.video.paused && !this.video.ended;
  }

  get videoTime(): number {
    return this.video ? Math.floor(this.video.currentTime) : 0;
  }

  // ------------------------------------------------------------ overlays

  /**
   * Read an element's text aloud, if this text is to be read and the player has reading aloud
   * on. Each word is marked as it is spoken. `over` settles when the reading ends or is stopped.
   */
  private read(node: HTMLElement, speak: SpeakOptions | undefined): { active: boolean; over: Promise<void>; stop(): void } {
    if (!speak || !this.narrator.enabled || (!speak.audioUrl && !this.narrator.supported)) return { active: false, over: Promise.resolve(), stop() {} };
    const words = narratable(node);
    node.classList.add('qbl-narrated');
    let done!: () => void;
    const over = new Promise<void>((r) => (done = r));
    const stop = this.narrator.speak(words.text, speak, (i) => words.mark(i), () => {
      words.clear();
      done();
    });
    return { active: true, over, stop };
  }

  textOverlay(text: string, o: { alignment?: Alignment; size?: number; color?: string; style?: string; duration?: number; speak?: SpeakOptions }): OverlayHandle {
    const node = el('div', `qbl-overlay qbl-text ${ALIGN_CLASS(o.alignment)}`, text);
    node.style.fontSize = `${o.size ?? 24}px`;
    node.style.color = o.color || 'white';
    if (o.style === 'italic') node.style.fontStyle = 'italic';
    const h = this.overlay(node, o.duration);
    const reading = this.read(node, o.speak);
    void h.done.then(reading.stop);
    return h;
  }

  dialogue(text: string, o: { name?: string; duration: number; anchor: () => BubbleAnchor | null; speak?: SpeakOptions }): ActionHandle {
    const node = el('div', 'qbl-bubble');
    if (o.name) node.append(el('strong', 'qbl-bubble-name', o.name));
    const words = el('span', '', text);
    node.append(words);
    node.setAttribute('role', 'status');
    this.root.append(node);

    let frame = 0;
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const follow = () => {
      const at = o.anchor();
      node.style.visibility = at ? 'visible' : 'hidden';
      if (at) {
        const p = placeBubble(at, { width: node.offsetWidth, height: node.offsetHeight }, { width: window.innerWidth, height: window.innerHeight });
        node.style.left = `${p.left}px`;
        node.style.top = `${p.top}px`;
        node.dataset.side = p.side;
        node.style.setProperty('--tail', `${p.tail}px`);
      }
      frame = requestAnimationFrame(follow);
    };
    const end = () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
      reading.stop();
      node.remove();
      finish();
    };
    // Read aloud, the bubble stays until the voice has finished, however long that takes.
    const reading = this.read(words, o.speak);
    const timer = window.setTimeout(() => void reading.over.then(end), o.duration);
    // A click closes it early, for readers who are done.
    node.addEventListener('click', end);
    follow();
    return { done, cancel: end };
  }

  portraitDialogue(text: string, o: { name?: string; portrait?: CharacterPicture; duration: number; watching?: boolean; speak?: SpeakOptions }): ActionHandle {
    const node = el('div', `qbl-story${o.watching ? ' watching' : ''}`);
    const frame = el('div', 'qbl-story-portrait');
    if (o.portrait?.url) {
      frame.append(pictureNode(o.portrait, 'qbl-story-picture'));
    } else {
      frame.append(el('span', '', (o.name ?? '?').slice(0, 1).toUpperCase()));
    }
    const body = el('div', 'qbl-story-body');
    if (o.name) body.append(el('strong', 'qbl-story-name', o.name));
    const line = el('p', 'qbl-story-text');
    body.append(line);
    const more = el('span', 'qbl-story-more', o.duration > 0 ? '' : '▶');
    body.append(more);
    node.append(frame, body);
    node.setAttribute('role', o.watching ? 'status' : 'dialog');
    node.setAttribute('aria-label', o.name ? `${o.name} says` : 'Dialogue');
    this.root.append(node);

    // Read aloud, the whole line is there at once and each word lights up as it is spoken.
    line.textContent = text;
    const reading = this.read(line, o.speak);
    if (!reading.active) line.textContent = '';
    // Otherwise the words arrive a few at a time. A first click shows them all; the next one continues.
    let shown = reading.active ? text.length : 0;
    const reveal = window.setInterval(() => {
      if (reading.active) return window.clearInterval(reveal);
      shown = Math.min(text.length, shown + 2);
      line.textContent = text.slice(0, shown);
      if (shown >= text.length) window.clearInterval(reveal);
    }, 24);
    // Screen readers get the whole line at once.
    line.setAttribute('aria-label', text);

    let timer = 0;
    const modal = !o.watching;
    if (modal) this.modals++;
    const h = handle(() => {
      window.clearInterval(reveal);
      window.clearTimeout(timer);
      reading.stop();
      window.removeEventListener('keydown', onKey, true);
      if (modal) this.modals--;
      node.remove();
    });
    const next = () => {
      if (shown < text.length) {
        shown = text.length;
        line.textContent = text;
        window.clearInterval(reveal);
      } else {
        h.finish();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      next();
    };
    node.addEventListener('click', next);
    if (modal) window.addEventListener('keydown', onKey, true);
    if (o.duration > 0) timer = window.setTimeout(() => void reading.over.then(h.finish), o.duration);
    return h;
  }

  imageOverlay(url: string, o: { alignment?: Alignment; scaleX?: number; scaleY?: number; duration?: number }): OverlayHandle {
    const node = el('img', `qbl-overlay qbl-image ${ALIGN_CLASS(o.alignment)}`);
    node.src = url;
    node.alt = '';
    node.style.setProperty('--sx', String(o.scaleX ?? 1));
    node.style.setProperty('--sy', String(o.scaleY ?? 1));
    return this.overlay(node, o.duration);
  }

  videoOverlay(url: string, o: { alignment?: Alignment; volume?: number }): OverlayHandle {
    const node = el('video', `qbl-overlay qbl-video ${ALIGN_CLASS(o.alignment)}`);
    node.src = url;
    node.controls = true;
    node.playsInline = true;
    node.volume = Math.min(1, Math.max(0, o.volume ?? 1));
    const h = this.overlay(node);
    this.video = node;
    node.addEventListener('ended', () => h.cancel());
    node.addEventListener('error', () => h.cancel());
    void node.play().catch(() => {
      /* autoplay refused: the controls let the player start it */
    });
    void h.done.then(() => {
      if (this.video === node) this.video = null;
    });
    return h;
  }

  private overlay(node: HTMLElement, duration?: number): OverlayHandle {
    this.overlays.appendChild(node);
    let timer: number | undefined;
    const h = handle(() => {
      window.clearTimeout(timer);
      node.remove();
    });
    if (duration && duration > 0) timer = window.setTimeout(h.finish, duration);
    return {
      done: h.done,
      cancel: h.cancel,
      transition: (to, ms) => {
        node.style.transition = `opacity ${ms}ms linear, transform ${ms}ms linear`;
        if (to.alpha != null) node.style.opacity = String(to.alpha);
        if (to.scaleX != null) node.style.setProperty('--sx', String(to.scaleX));
        if (to.scaleY != null) node.style.setProperty('--sy', String(to.scaleY));
      },
    };
  }

  // ------------------------------------------------------------- infobox

  /**
   * A modal box with author-written content and buttons. `choice` resolves with the
   * index of the button chosen, or null if the box was dismissed. A box that is not
   * dismissible has no close button and ignores Escape and clicks outside it.
   */
  infobox(html: string, buttons: string[], o: { dismissible: boolean; speak?: SpeakOptions }): InfoboxHandle {
    const backdrop = el('div', 'qbl-backdrop');
    const box = el('div', 'qbl-infobox');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const body = el('div', 'qbl-infobox-body');
    body.appendChild(sanitizeHtml(html.includes('<') ? html : html.replace(/\n/g, '<br>')));
    const actions = el('div', 'qbl-infobox-actions');
    if (buttons.length > 2) actions.classList.add('stacked');
    const previous = document.activeElement as HTMLElement | null;

    let result: number | null = null;
    let settle!: (index: number | null) => void;
    const choice = new Promise<number | null>((r) => (settle = r));
    this.modals++;
    const h = handle(() => {
      this.modals--;
      reading.stop();
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
      settle(result);
    });
    const reading = this.read(body, o.speak);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && o.dismissible) {
        e.stopPropagation();
        h.finish();
      }
    };
    buttons.forEach((label, index) => {
      const b = el('button', 'qbl-button primary', label);
      b.addEventListener('click', () => {
        result = index;
        h.finish();
      });
      actions.appendChild(b);
    });
    if (o.dismissible) {
      const close = el('button', 'qbl-button', buttons.length ? 'Not now' : 'Close');
      close.addEventListener('click', h.finish);
      actions.appendChild(close);
      backdrop.addEventListener('pointerdown', (e) => {
        if (e.target === backdrop) h.finish();
      });
    }
    document.addEventListener('keydown', onKey, true);

    box.append(body, actions);
    backdrop.appendChild(box);
    this.root.appendChild(backdrop);
    (actions.firstElementChild as HTMLElement | null)?.focus();
    return { choice, close: h.finish };
  }

  // ---------------------------------------------------------------- chat

  private chatCleanup: (() => void) | null = null;

  /**
   * The chat bar, for a scenario where players talk freely: a round button in the corner that
   * opens into a bar across the bottom of the screen while the player types, and closes again
   * when they send or leave it. Enter opens it from anywhere in the game; Escape puts it away
   * (a draft is kept, and the button shows a dot while there is one).
   */
  chat(mode: ChatMode, send: { text(t: string): void; emote(e: string): void }) {
    this.chatCleanup?.();
    this.chatCleanup = null;
    this.hud.replaceChildren();
    // Emotes are in the side panel, with the moves.
    this.sidebar.setEmotes(mode === 'off' ? [] : EMOTES, send.emote);
    if (mode !== 'free') return;

    const form = el('form', 'qbl-chat');
    form.setAttribute('aria-label', 'Chat');
    const mark = el('span', 'qbl-chat-icon');
    mark.append(icon('chat', { size: 24 }));
    const input = el('input');
    input.type = 'text';
    input.name = 'chat';
    input.maxLength = CHAT_MAX_LENGTH;
    input.placeholder = 'Say something…';
    input.autocomplete = 'off';
    input.enterKeyHint = 'send';
    input.setAttribute('aria-label', 'Chat message. Press Enter to send, Escape to close.');
    input.title = 'Chat (Enter)';
    const left = el('span', 'qbl-chat-left');
    left.setAttribute('aria-live', 'polite');
    const emotes = el('button', 'qbl-chat-tool');
    emotes.type = 'button';
    emotes.setAttribute('aria-label', 'Emotes');
    emotes.title = 'Emotes';
    emotes.append(emojiIcon('😀', { size: 22 }));
    const go = el('button', 'qbl-chat-send');
    go.type = 'submit';
    go.setAttribute('aria-label', 'Send');
    go.title = 'Send';
    go.append(icon('send', { size: 20 }));
    form.append(mark, input, left, emotes, go);
    this.hud.appendChild(form);

    const refresh = () => {
      const value = input.value;
      const remaining = CHAT_MAX_LENGTH - value.length;
      left.textContent = remaining <= 20 ? String(remaining) : '';
      go.disabled = value.trim() === '';
      form.classList.toggle('draft', value.trim() !== '');
    };
    const open = () => {
      form.classList.add('open');
      if (document.activeElement !== input) input.focus({ preventScroll: true });
    };
    const close = () => {
      form.classList.remove('open');
      if (document.activeElement === input) input.blur();
    };
    input.addEventListener('focus', () => form.classList.add('open'));
    input.addEventListener('blur', () => {
      // Clicking the bar's own buttons keeps it open (they keep the focus; see below).
      window.setTimeout(() => {
        if (!form.contains(document.activeElement)) form.classList.remove('open');
      });
    });
    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
    });
    // The bar's buttons must not take the focus from the text: on a phone that would close the keyboard.
    for (const b of [go, emotes]) b.addEventListener('pointerdown', (e) => e.preventDefault());
    mark.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (form.classList.contains('open')) close();
      else open();
    });
    emotes.addEventListener('click', () => {
      close();
      this.sidebar.open('moves', true);
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (text) send.text(text);
      input.value = '';
      refresh();
      // Back to walking about.
      close();
    });
    // Enter, with nothing else taking the keyboard, starts typing.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || this.capturesInput) return;
      const active = document.activeElement;
      if (active && active !== document.body && !(active instanceof HTMLCanvasElement)) return;
      e.preventDefault();
      open();
    };
    window.addEventListener('keydown', onKey);
    refresh();
    this.chatCleanup = () => window.removeEventListener('keydown', onKey);
  }

  // --------------------------------------------------------------- status

  /** Small buttons for things the player is wearing or riding. */
  attachments(items: Array<{ id: number; name: string }>, onRemove: (id: number) => void) {
    this.sidebar.setAttachments(items, onRemove);
  }

  /** The mission checklist, in the side panel. An empty list takes its tab away. */
  objectives(list: ObjectiveStatus[]) {
    this.sidebar.setObjectives(list);
  }

  moves(list: Array<{ animation: string; label: string; icon: string }>, onDo: (animation: string) => void) {
    this.sidebar.setMoves(list, onDo);
  }

  players(list: PlayerRow[], on: { profile(id: string): void; message?(id: string): void }) {
    this.sidebar.setPlayers(list, on);
  }

  teams(list: TeamRow[] | null, onFollow: (group: string) => void) {
    this.sidebar.setTeams(list, onFollow);
  }

  messaging(o: { scene: boolean; private: boolean; send(thread: string, text: string): void } | null) {
    this.sidebar.setMessaging(o);
  }

  message(line: ChatLine) {
    this.sidebar.addMessage(line);
  }

  openMessages(thread: string, name: string) {
    this.sidebar.openThread(thread, name);
  }

  glossary(list: GlossaryRow[], fresh?: string) {
    this.sidebar.setGlossary(list, fresh);
  }

  private narrationToggle: HTMLButtonElement | null = null;

  /** The read-aloud switch, at the foot of the side rail. The player's choice is kept in this browser. */
  narration(available: boolean) {
    if (!available || this.narrationToggle || !this.narrator.supported) return;
    const toggle = (this.narrationToggle = el('button', 'qbl-sidebar-tab qbl-narration-toggle'));
    toggle.type = 'button';
    const draw = () => {
      const on = this.narrator.enabled;
      toggle.replaceChildren(icon(on ? 'narration' : 'narration-off', { size: 26 }));
      toggle.setAttribute('aria-pressed', String(on));
      toggle.setAttribute('aria-label', 'Read text aloud');
      toggle.title = on ? 'Reading aloud is on. Click to turn it off.' : 'Reading aloud is off. Click to turn it on.';
    };
    toggle.addEventListener('click', () => {
      this.narrator.enabled = !this.narrator.enabled;
      draw();
      this.toast(this.narrator.enabled ? 'Text will be read aloud.' : 'Reading aloud is off.', 2000);
    });
    draw();
    this.sidebar.addControl(toggle);
  }

  /** A player's profile: their avatar as it is dressed, rank, stars, XP and badges. */
  profile(view: ProfileView, on: { message?(): void } = {}): { update(view: ProfileView): void; close(): void } {
    const backdrop = el('div', 'qbl-backdrop');
    const card = el('div', 'qbl-profile');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    backdrop.append(card);
    this.root.append(backdrop);
    this.modals++;
    const previous = document.activeElement as HTMLElement | null;
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      this.modals--;
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      previous?.focus?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const draw = (v: ProfileView) => {
      card.setAttribute('aria-label', `${v.name}'s profile`);
      const figure = el('div', 'qbl-profile-avatar');
      if (v.avatar.url) {
        figure.append(pictureNode(v.avatar, 'qbl-profile-frame'));
      } else {
        figure.append(icon('account', { size: 96 }));
      }
      for (const w of v.worn) {
        const img = el('img', `qbl-profile-worn ${w.kind === 'pet' ? 'pet' : `slot-${w.slot ?? 'body'}`}`);
        img.src = w.url;
        img.alt = w.name;
        img.title = w.name;
        figure.append(img);
      }
      const head = el('div', 'qbl-profile-head');
      const title = el('div', 'qbl-profile-title');
      title.append(el('h2', '', v.name));
      if (v.rank) {
        const rank = el('span', 'qbl-rank');
        rank.append(icon('rank', { size: 16 }), el('span', '', v.rank));
        title.append(rank);
      }
      if (v.team) {
        const team = el('span', 'qbl-profile-team');
        team.append(icon('team', { size: 16 }), el('span', '', v.team));
        title.append(team);
      }
      head.append(figure, title);

      const body = el('div', 'qbl-profile-body');
      if (v.guest) {
        body.append(el('p', 'qbl-sidebar-empty', 'Playing as a guest. Stars, ranks and badges are kept for players with an account.'));
      } else if (v.loading) {
        body.append(el('p', 'qbl-sidebar-empty', 'Loading…'));
      } else {
        const stats = el('div', 'qbl-profile-stats');
        const stars = el('div');
        stars.append(icon('star', { size: 22 }), el('strong', '', String(v.stars ?? 0)), el('small', '', 'stars'));
        const xp = el('div');
        xp.append(el('strong', '', String(v.xp ?? 0)), el('small', '', v.nextRankXp == null ? 'XP · top rank' : `XP · ${v.nextRankXp - (v.xp ?? 0)} to next rank`));
        stats.append(stars, xp);
        body.append(stats, el('h3', '', `Badges${v.badges?.length ? ` (${v.badges.length})` : ''}`));
        if (v.badges?.length) {
          const grid = el('ul', 'qbl-profile-badges');
          for (const b of v.badges) {
            const li = el('li');
            li.title = [b.description, b.scenario].filter(Boolean).join(' · ');
            if (b.image_url) {
              const img = el('img');
              img.src = b.image_url;
              img.alt = '';
              li.append(img);
            } else {
              li.append(icon('badge', { size: 40 }));
            }
            li.append(el('strong', '', b.name));
            if (b.scenario) li.append(el('small', '', b.scenario));
            grid.append(li);
          }
          body.append(grid);
        } else {
          body.append(el('p', 'qbl-sidebar-empty', 'No badges yet.'));
        }
      }

      const actions = el('div', 'qbl-infobox-actions');
      if (on.message) {
        const say = el('button', 'qbl-button primary', 'Send a message');
        say.type = 'button';
        say.addEventListener('click', () => {
          close();
          on.message?.();
        });
        actions.append(say);
      }
      const shut = el('button', 'qbl-button', 'Close');
      shut.type = 'button';
      shut.addEventListener('click', close);
      actions.append(shut);
      card.replaceChildren(head, body, actions);
      shut.focus();
    };
    backdrop.addEventListener('pointerdown', (e) => e.target === backdrop && close());
    document.addEventListener('keydown', onKey, true);
    draw(view);
    return { update: (v) => open && draw(v), close };
  }

  /** Top right: the player's own button and menu. The top left belongs to the buttons for leaving a vehicle or taking something off. */
  private corner = el('div', 'qbl-corner');
  private me: AccountMenu | null = null;
  private meActions: AccountActions = {};
  private stats: MenuStats | null = null;
  private onShop: (() => void) | null = null;

  account(who: AccountView | null, on: AccountActions) {
    this.me?.root.remove();
    this.me = null;
    this.meActions = on;
    if (!who) return;
    this.me = new AccountMenu({
      name: who.name,
      subtitle: who.subtitle ?? (who.guest ? 'Playing as a guest' : undefined),
      avatar: who.avatar,
      links: who.links,
      onNavigate: on.leave ? (href) => on.leave!(href) : undefined,
      signOut: on.signOut ? { label: who.guest ? 'Sign in with an account' : 'Sign out', run: on.signOut } : null,
    });
    this.me.setStats(this.stats);
    this.menuActions();
    this.corner.append(this.me.root);
  }

  rewards(state: { stars: number; xp: number; rank: string; next_rank_xp: number | null } | null, onOpen: () => void) {
    // The wardrobe is also reached from the inventory in the side panel.
    this.sidebar.setWardrobe(state ? onOpen : null);
    this.stats = state ? { stars: state.stars, xp: state.xp, rank: state.rank, next_rank_xp: state.next_rank_xp } : null;
    this.onShop = state ? onOpen : null;
    this.me?.setStats(this.stats);
    this.menuActions();
  }

  private menuActions() {
    if (!this.me) return;
    const actions: Parameters<AccountMenu['setActions']>[0] = [];
    const profile = this.meActions.profile;
    if (profile) actions.push({ key: 'profile', label: 'My profile and badges', icon: 'profile', run: profile });
    const shop = this.onShop;
    if (shop) actions.push({ key: 'shop', label: 'Wardrobe and marketplace', icon: 'shop', run: shop });
    this.me.setActions(actions);
  }

  shop(view: () => ShopView, on: { buy(id: number): Promise<void>; equip(id: number, on: boolean): Promise<void> }): ActionHandle {
    const backdrop = el('div', 'qbl-backdrop');
    const box = el('div', 'qbl-shop');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Marketplace');
    backdrop.append(box);
    this.root.append(backdrop);
    this.modals++;
    let tab: 'shop' | 'mine' = 'shop';
    let message = '';
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    let open = true;
    const close = () => {
      if (!open) return;
      open = false;
      this.modals--;
      backdrop.remove();
      finish();
    };
    const act = async (work: () => Promise<void>) => {
      message = '';
      try {
        await work();
      } catch (err) {
        message = err instanceof Error ? err.message : 'That did not work.';
      }
      if (open) draw();
    };
    const KINDS: Record<string, string> = { wearable: 'To wear', pet: 'Pets', animation: 'Moves', ability: 'Abilities' };
    const draw = () => {
      const v = view();
      box.replaceChildren();
      const head = el('div', 'qbl-shop-head');
      const closeButton = el('button', 'qbl-shop-close', '×');
      closeButton.type = 'button';
      closeButton.setAttribute('aria-label', 'Close');
      closeButton.addEventListener('click', close);
      head.append(el('h2', '', tab === 'shop' ? 'Marketplace' : 'My things'), el('span', 'qbl-stars', `⭐ ${v.stars}`), closeButton);
      const tabs = el('div', 'qbl-shop-tabs');
      for (const [key, label] of [['shop', 'Shop'], ['mine', `My things (${v.items.filter((i) => i.owned).length})`]] as const) {
        const b = el('button', tab === key ? 'current' : '', label);
        b.type = 'button';
        b.addEventListener('click', () => {
          tab = key;
          draw();
        });
        tabs.append(b);
      }
      box.append(head, tabs);
      if (message) box.append(el('p', 'qbl-shop-message', message));
      const shown = v.items.filter((i) => (tab === 'mine' ? i.owned : true));
      if (!shown.length) box.append(el('p', 'qbl-shop-empty', tab === 'mine' ? 'Nothing yet. Earn stars in missions and spend them in the shop.' : 'Nothing is for sale right now.'));
      for (const kind of Object.keys(KINDS)) {
        const group = shown.filter((i) => i.kind === kind);
        if (!group.length) continue;
        box.append(el('h3', '', KINDS[kind]));
        const grid = el('div', 'qbl-shop-grid');
        for (const item of group) {
          const card = el('div', `qbl-shop-item${item.equipped ? ' on' : ''}`);
          if (item.image) {
            const img = el('img');
            img.src = item.image;
            img.alt = '';
            card.append(img);
          }
          card.append(el('strong', '', item.name));
          if (item.mission) card.append(el('span', 'qbl-shop-tag', 'This mission'));
          if (item.description) card.append(el('small', '', item.description));
          const button = el('button');
          button.type = 'button';
          if (!item.owned) {
            button.textContent = `Buy · ⭐ ${item.price}`;
            button.disabled = v.stars < item.price;
            if (button.disabled) button.title = `You need ${item.price - v.stars} more stars`;
            button.addEventListener('click', () => void act(() => on.buy(item.id)));
          } else {
            const verbs = item.kind === 'wearable' ? ['Wear', 'Take off'] : ['Use', 'Stop using'];
            button.textContent = item.equipped ? verbs[1]! : verbs[0]!;
            button.addEventListener('click', () => void act(() => on.equip(item.id, !item.equipped)));
          }
          card.append(button);
          grid.append(card);
        }
        box.append(grid);
      }
    };
    backdrop.addEventListener('click', (e) => e.target === backdrop && close());
    draw();
    return { done, cancel: close };
  }

  toast(message: string, ms = 3000) {
    const node = el('div', 'qbl-toast', message);
    node.setAttribute('role', 'status');
    this.toasts.appendChild(node);
    window.setTimeout(() => node.remove(), ms);
  }

  /** A persistent message such as "Reconnecting…". Pass null to clear it. */
  status(message: string | null) {
    this.banner.hidden = message == null;
    this.banner.textContent = message ?? '';
  }

  clearOverlays() {
    this.overlays.replaceChildren();
    this.video = null;
  }
}
