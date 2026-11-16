import type { GameContext } from './GameContext';

/**
 * A game feature lives for the whole play session, across scene changes:
 * the mission checklist, chat, connection status, saving progress. It talks
 * to the player through ctx.ui and to the game through ctx.
 *
 * To add one, implement this interface and add it to features/index.ts.
 */
export interface GameFeature {
  /** Begin. Return a function that undoes everything (timers, subscriptions). */
  start(ctx: GameContext): () => void;
}
