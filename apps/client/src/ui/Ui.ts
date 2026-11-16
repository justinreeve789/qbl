import { CHAT_MAX_LENGTH, EMOTES, type ActionHandle, type Alignment, type ChatMode, type ObjectiveStatus } from '@qbl/shared';
import { sanitizeHtml } from './sanitize';
import { placeBubble, type BubbleAnchor } from './bubble';
import type { InfoboxHandle, OverlayHandle, ShopView, UiPort } from './UiPort';

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
  private chips = el('div', 'qbl-chips');
  private checklist = el('div', 'qbl-objectives');
  private toasts = el('div', 'qbl-toasts');
  private banner = el('div', 'qbl-banner');
  private modals = 0;
  private video: HTMLVideoElement | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'qbl-ui');
    this.banner.hidden = true;
    this.checklist.hidden = true;
    this.root.append(this.overlays, this.chips, this.checklist, this.hud, this.toasts, this.banner);
    parent.appendChild(this.root);
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

  textOverlay(text: string, o: { alignment?: Alignment; size?: number; color?: string; style?: string; duration?: number }): OverlayHandle {
    const node = el('div', `qbl-overlay qbl-text ${ALIGN_CLASS(o.alignment)}`, text);
    node.style.fontSize = `${o.size ?? 24}px`;
    node.style.color = o.color || 'white';
    if (o.style === 'italic') node.style.fontStyle = 'italic';
    return this.overlay(node, o.duration);
  }

  dialogue(text: string, o: { name?: string; duration: number; anchor: () => BubbleAnchor | null }): ActionHandle {
    const node = el('div', 'qbl-bubble');
    if (o.name) node.append(el('strong', 'qbl-bubble-name', o.name));
    node.append(el('span', '', text));
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
      node.remove();
      finish();
    };
    const timer = window.setTimeout(end, o.duration);
    // A click closes it early, for readers who are done.
    node.addEventListener('click', end);
    follow();
    return { done, cancel: end };
  }

  portraitDialogue(text: string, o: { name?: string; portrait?: string; duration: number; watching?: boolean }): ActionHandle {
    const node = el('div', `qbl-story${o.watching ? ' watching' : ''}`);
    const frame = el('div', 'qbl-story-portrait');
    if (o.portrait) {
      const img = el('img');
      img.src = o.portrait;
      img.alt = '';
      frame.append(img);
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

    // The words arrive a few at a time. A first click shows them all; the next one continues.
    let shown = 0;
    const reveal = window.setInterval(() => {
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
    if (o.duration > 0) timer = window.setTimeout(h.finish, o.duration);
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
  infobox(html: string, buttons: string[], o: { dismissible: boolean }): InfoboxHandle {
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
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
      settle(result);
    });
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

  /** Build the chat controls for a scenario's chat mode. */
  chat(mode: ChatMode, send: { text(t: string): void; emote(e: string): void }) {
    this.hud.replaceChildren();
    if (mode === 'off') return;

    const pad = el('div', 'qbl-emotes');
    pad.hidden = true;
    for (const emoji of EMOTES) {
      const b = el('button', 'qbl-emote', emoji);
      b.type = 'button';
      b.setAttribute('aria-label', `Send ${emoji}`);
      b.addEventListener('click', () => {
        send.emote(emoji);
        pad.hidden = true;
      });
      pad.appendChild(b);
    }
    const toggle = el('button', 'qbl-button round', '😀');
    toggle.type = 'button';
    toggle.setAttribute('aria-label', 'Emotes');
    toggle.addEventListener('click', () => (pad.hidden = !pad.hidden));
    this.hud.append(pad, toggle);

    if (mode === 'free') {
      const form = el('form', 'qbl-chat');
      const input = el('input');
      input.type = 'text';
      input.maxLength = CHAT_MAX_LENGTH;
      input.placeholder = 'Say something…';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Chat message');
      form.appendChild(input);
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (text) send.text(text);
        input.value = '';
        input.blur();
      });
      this.hud.appendChild(form);
    }
  }

  // --------------------------------------------------------------- status

  /** Small buttons for things the player is wearing or riding. */
  attachments(items: Array<{ id: number; name: string }>, onRemove: (id: number) => void) {
    this.chips.replaceChildren(
      ...items.map((item) => {
        const b = el('button', 'qbl-chip', `✕ ${item.name}`);
        b.type = 'button';
        b.setAttribute('aria-label', `Leave ${item.name}`);
        b.addEventListener('click', () => onRemove(item.id));
        return b;
      }),
    );
  }

  /** The mission checklist. An empty list hides the panel. */
  objectives(list: ObjectiveStatus[]) {
    this.checklist.hidden = list.length === 0;
    const title = el('div', 'qbl-objectives-title', 'Mission');
    const ul = el('ul');
    for (const o of list) {
      const li = el('li', o.complete ? 'done' : '');
      const mark = el('span', 'qbl-objectives-mark', o.complete ? '✓' : '');
      mark.setAttribute('aria-hidden', 'true');
      const text = el('span', '', o.optional ? `Bonus: ${o.text}` : o.text);
      li.append(mark, text);
      li.setAttribute('aria-label', `${o.text}${o.complete ? ' (done)' : ''}`);
      ul.appendChild(li);
    }
    this.checklist.replaceChildren(title, ul);
  }

  private rewardsNode: HTMLElement | null = null;

  rewards(state: { stars: number; xp: number; rank: string; next_rank_xp: number | null } | null, onOpen: () => void) {
    this.rewardsNode?.remove();
    this.rewardsNode = null;
    if (!state) return;
    const node = el('button', 'qbl-rewards');
    node.type = 'button';
    node.title = 'Open the marketplace and your wardrobe';
    const toNext = state.next_rank_xp == null ? 'top rank' : `${state.next_rank_xp - state.xp} XP to next rank`;
    node.append(el('span', 'qbl-stars', `⭐ ${state.stars}`), el('span', 'qbl-rank', state.rank), el('span', 'qbl-xp', `${state.xp} XP · ${toNext}`));
    node.setAttribute('aria-label', `${state.stars} stars. Rank: ${state.rank}. ${state.xp} XP, ${toNext}. Open the marketplace.`);
    node.addEventListener('click', onOpen);
    this.root.append(node);
    this.rewardsNode = node;
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
