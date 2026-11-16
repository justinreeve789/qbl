import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** Reports the player's progress to the server regularly, and when the page is being left. */
export class ProgressFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const timer = setInterval(() => ctx.saveProgress(), 5000);
    const onHide = () => ctx.saveProgress(true);
    if (typeof window !== 'undefined') window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(timer);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', onHide);
    };
  }
}
