import { CloseCodes } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** The bits of `window` the rejoin needs, so tests can pass their own. */
export interface PageWindow {
  addEventListener(type: 'pageshow', listener: (e: { persisted?: boolean }) => void): void;
  removeEventListener(type: 'pageshow', listener: (e: { persisted?: boolean }) => void): void;
  location: { reload(): void };
}

/** Tells the player about connection trouble and messages from the server. */
export class ConnectionFeature implements GameFeature {
  constructor(private page: PageWindow | null = typeof window !== 'undefined' ? (window as unknown as PageWindow) : null) {}

  start(ctx: GameContext): () => void {
    const { connection, ui } = ctx;
    let rejoining = false;
    const off = [
      connection.on('drop', () => ui.status('Connection lost. Reconnecting…')),
      connection.on('reconnect', () => ui.status(null)),
      connection.on('notice', (m) => ui.toast(m.message)),
      connection.on('leave', (code) => {
        if (rejoining) return;
        ui.status(
          code === CloseCodes.ReplacedByNewSession
            ? 'You opened this scenario in another tab. This one has been disconnected.'
            : code === CloseCodes.ProgressReset
              ? 'Your teacher has reset your progress in this mission. Reload the page to start again.'
              : 'Disconnected from the game. Reload the page to rejoin.',
        );
      }),
    ];
    // Back (or Forward) to this page can bring it out of the browser's back/forward cache as it
    // was, frozen, with the room it left when the player went on. Load it again instead: that
    // joins the game afresh, with the progress saved on the way out.
    const page = this.page;
    if (connection.online && page) {
      const onShow = (e: { persisted?: boolean }) => {
        if (!e.persisted) return;
        rejoining = true;
        ui.status('Rejoining the game…');
        connection.leave();
        page.location.reload();
      };
      page.addEventListener('pageshow', onShow);
      off.push(() => page.removeEventListener('pageshow', onShow));
    }
    return () => off.forEach((f) => f());
  }
}
