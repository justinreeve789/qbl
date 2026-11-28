import { isStaff } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/**
 * The player's notebook (core/Notebook.ts): its button on the side rail, and keeping what is
 * written when the page is hidden or left, so nothing waits to be saved when the tab goes away.
 */
export class NotebookFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const book = ctx.notebook;
    if (!book) return () => {};
    ctx.ui.notebook(book, { title: ctx.scenario.title, owner: ctx.user.name, readBy: notebookReader(ctx) });
    // Fetched a moment after the game starts, so that it opens at once when the player wants it.
    const early = setTimeout(() => void book.load(), 2500);
    const leave = () => void book.flush(true);
    const hidden = () => {
      if (document.visibilityState === 'hidden') leave();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', leave);
      document.addEventListener('visibilitychange', hidden);
    }
    return () => {
      clearTimeout(early);
      if (typeof window !== 'undefined') {
        window.removeEventListener('pagehide', leave);
        document.removeEventListener('visibilitychange', hidden);
      }
      ctx.ui.notebook(null);
      void book.flush(true).finally(() => book.dispose());
    };
  }
}

/**
 * Who besides the player can read their notebook here: in an assigned mission's game (an
 * assignment's or a team's), the teacher who assigned it, on the Classes page. Teachers playing
 * are not told; nor is anyone in a public game, where notes are the player's alone.
 */
export function notebookReader(ctx: Pick<GameContext, 'scenario' | 'user'>): string | undefined {
  if (isStaff(ctx.user.role)) return undefined;
  const instance = ctx.scenario.instance;
  if (!instance || !/^[at]\d+$/.test(instance.group)) return undefined;
  return instance.teacher_name?.trim() || 'Your teacher';
}
