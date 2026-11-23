import { CloseCodes } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** Tells the player about connection trouble and messages from the server. */
export class ConnectionFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const { connection, ui } = ctx;
    const off = [
      connection.on('drop', () => ui.status('Connection lost. Reconnecting…')),
      connection.on('reconnect', () => ui.status(null)),
      connection.on('notice', (m) => ui.toast(m.message)),
      connection.on('leave', (code) => {
        ui.status(
          code === CloseCodes.ReplacedByNewSession
            ? 'You opened this scenario in another tab. This one has been disconnected.'
            : code === CloseCodes.ProgressReset
              ? 'Your teacher has reset your progress in this mission. Reload the page to start again.'
              : 'Disconnected from the game. Reload the page to rejoin.',
        );
      }),
    ];
    return () => off.forEach((f) => f());
  }
}
