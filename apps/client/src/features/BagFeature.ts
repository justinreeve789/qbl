import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/** The bar of things the player carries (see Bag): kept up to date as variables change. */
export class BagFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const refresh = () => this.refresh(ctx);
    const offVars = ctx.vars.onChange(refresh);
    const offBag = ctx.bag.onChange(refresh);
    refresh();
    return () => {
      offVars();
      offBag();
    };
  }

  refresh(ctx: GameContext): void {
    const items = ctx.bag.items();
    // A picked thing that is no longer carried (used up elsewhere) is put back.
    const picked = ctx.bag.selected;
    if (picked != null && !items.some((i) => i.id === picked)) ctx.bag.drop();
    ctx.ui.bag(
      items.map((i) => ({ id: i.id, name: i.name, image: i.media_id != null ? ctx.mediaUrl(i.media_id) : null, description: i.description })),
      ctx.bag.selected,
      { pick: (id) => ctx.bag.pick(id), drop: () => ctx.bag.drop() },
    );
  }
}
