import { parseIds } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** Buttons for taking off whatever the player is wearing or riding. */
export class AttachmentsFeature implements GameFeature {
  private shown = '\u0000';

  start(ctx: GameContext): () => void {
    const refresh = () => this.refresh(ctx);
    refresh();
    const timer = setInterval(refresh, 200);
    return () => clearInterval(timer);
  }

  refresh(ctx: GameContext): void {
    const csv = ctx.connection.me?.attachments ?? '';
    if (csv === this.shown) return;
    this.shown = csv;
    const items = parseIds(csv).map((id) => ctx.index.items.get(id)).filter((i) => i != null);
    ctx.ui.attachments(
      items.map((i) => ({ id: i.id, name: i.name })),
      (id) => ctx.connection.item({ item_id: id, action: 'detach' }),
    );
  }
}
