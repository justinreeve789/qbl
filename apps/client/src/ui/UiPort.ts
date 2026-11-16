import type { BubbleAnchor } from './bubble';
import type { ActionHandle, Alignment, ChatMode, ObjectiveStatus } from '@qbl/shared';

export interface OverlayHandle extends ActionHandle {
  /** Animate the overlay (used by translate actions). */
  transition(to: { alpha?: number; scaleX?: number; scaleY?: number }, durationMs: number): void;
}

export interface InfoboxHandle {
  /** Resolves with the index of the button chosen, or null if the box was dismissed or closed. */
  choice: Promise<number | null>;
  close(): void;
}

/**
 * Everything the game asks of the on-screen UI. The real implementation
 * (Ui) draws HTML over the canvas; tests supply a headless one. Game code
 * depends on this interface only, never on the DOM.
 */
export interface UiPort {
  /** True while something modal is open or a text field has focus; the game ignores movement input meanwhile. */
  readonly capturesInput: boolean;
  readonly videoPlaying: boolean;
  readonly videoTime: number;

  textOverlay(text: string, o: { alignment?: Alignment; size?: number; color?: string; style?: string; duration?: number }): OverlayHandle;
  imageOverlay(url: string, o: { alignment?: Alignment; scaleX?: number; scaleY?: number; duration?: number }): OverlayHandle;
  videoOverlay(url: string, o: { alignment?: Alignment; volume?: number }): OverlayHandle;
  /** `html` is trusted only as far as the sanitiser allows. */
  infobox(html: string, buttons: string[], o: { dismissible: boolean }): InfoboxHandle;
  /**
   * A speech bubble that follows a speaker. `anchor` is asked every frame where the speaker is on
   * the page (null while they are off screen); the bubble places itself so it stays in view.
   */
  dialogue(text: string, o: { name?: string; duration: number; anchor: () => BubbleAnchor | null }): ActionHandle;
  /**
   * A dialogue box across the bottom of the screen with the speaker's close-up portrait and name.
   * With `duration` 0 it stays until the player clicks or presses Enter or Space to continue.
   * `watching`: it comes from another player's event, so it never takes this player's input.
   */
  portraitDialogue(text: string, o: { name?: string; portrait?: string; duration: number; watching?: boolean }): ActionHandle;
  /** The stars, XP and rank display, with a button that opens the marketplace. Null hides it (guests). */
  rewards(state: { stars: number; xp: number; rank: string; next_rank_xp: number | null } | null, onOpen: () => void): void;
  /** What the player can do from their screen: one button per move. An empty list hides the row. */
  moves(list: Array<{ animation: string; label: string; icon: string }>, onDo: (animation: string) => void): void;
  /** Who is playing, top right, with the way to sign out (or, for a guest, to sign in with an account). Null hides it. */
  account(who: { name: string; guest: boolean } | null, onSignOut: () => void): void;
  /**
   * The marketplace and wardrobe. `view` is asked again after every purchase or change, so the
   * window always shows the current stars and what is owned and worn.
   */
  shop(view: () => ShopView, on: { buy(id: number): Promise<void>; equip(id: number, on: boolean): Promise<void> }): ActionHandle;
  clearOverlays(): void;

  chat(mode: ChatMode, send: { text(t: string): void; emote(e: string): void }): void;
  attachments(items: Array<{ id: number; name: string }>, onRemove: (id: number) => void): void;
  objectives(list: ObjectiveStatus[]): void;
  toast(message: string, ms?: number): void;
  /** A persistent message such as "Reconnecting…". Pass null to clear it. */
  status(message: string | null): void;
}

export interface ShopView {
  stars: number;
  items: Array<{ id: number; name: string; description?: string; kind: string; slot?: string; price: number; image: string | null; mission: boolean; owned: boolean; equipped: boolean }>;
}
