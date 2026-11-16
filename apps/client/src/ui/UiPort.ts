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
  clearOverlays(): void;

  chat(mode: ChatMode, send: { text(t: string): void; emote(e: string): void }): void;
  attachments(items: Array<{ id: number; name: string }>, onRemove: (id: number) => void): void;
  objectives(list: ObjectiveStatus[]): void;
  toast(message: string, ms?: number): void;
  /** A persistent message such as "Reconnecting…". Pass null to clear it. */
  status(message: string | null): void;
}
