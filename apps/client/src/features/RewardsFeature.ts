import { resolveMediaUrl, type RewardMessage } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';
import type { ShopView } from '../ui/UiPort';

/**
 * Stars, XP and rank on screen, the marketplace window, and the link between what the player
 * wears and the room: awards arrive from the server, purchases go to the backend, and a change
 * of outfit is announced to the room so other players see it.
 */
export class RewardsFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const { rewards, ui, connection, vars } = ctx;

    // Scenarios can read these in conditions and show them with {{QBLStars}} and friends.
    vars.provide('QBLStars', () => rewards.progress?.stars ?? 0);
    vars.provide('QBLXp', () => rewards.progress?.xp ?? 0);
    vars.provide('QBLRank', () => rewards.progress?.rank ?? '');
    // An ability the player has equipped: QBLAbility_<key> is 1.
    for (const item of rewards.items.values()) {
      const key = item.ability;
      if (item.kind === 'ability' && key) vars.provide(`QBLAbility_${key}`, () => (rewards.hasAbility(key) ? 1 : 0));
    }

    const view = (): ShopView => ({
      stars: rewards.progress?.stars ?? 0,
      items: rewards.catalogue.map((item) => {
        const media = item.media_id != null ? ctx.index.media.get(item.media_id) : undefined;
        return {
          id: item.id, name: item.name, description: item.description, kind: item.kind, slot: item.slot, price: item.price,
          image: item.image_url ?? (media ? resolveMediaUrl(ctx.scenario, media) : null),
          mission: item.scenario_id != null,
          owned: rewards.progress?.owned.includes(item.id) ?? false,
          equipped: rewards.progress?.equipped.includes(item.id) ?? false,
        };
      }),
    });

    let look = rewards.look;
    const announce = () => {
      // Tell the room when the outfit changed, so everyone's picture of this player follows.
      if (rewards.look !== look) {
        look = rewards.look;
        connection.lookChanged(look);
      }
    };

    rewards.openShop = () => {
      if (!rewards.available) {
        ui.toast('The marketplace needs an account. Sign in to earn and spend stars.');
        return { done: Promise.resolve(), cancel() {} };
      }
      return ui.shop(view, {
        buy: (id) => rewards.buy(id),
        equip: async (id, on) => {
          await rewards.equip(id, on);
          announce();
        },
      });
    };

    const draw = () => {
      const p = rewards.progress;
      ui.rewards(p ? { stars: p.stars, xp: p.xp, rank: p.rank, next_rank_xp: p.next_rank_xp } : null, () => void rewards.openShop());
      vars.touch('QBLStars');
    };
    const tell = (r: RewardMessage) => {
      const parts = [
        r.delta_stars ? `${r.delta_stars > 0 ? '+' : ''}${r.delta_stars} ⭐` : '',
        r.delta_xp ? `${r.delta_xp > 0 ? '+' : ''}${r.delta_xp} XP` : '',
      ].filter(Boolean);
      if (parts.length) ui.toast(`${parts.join('  ')}${r.note ? ` · ${r.note}` : ''}`, 3500);
      if (r.rank_up) ui.toast(`New rank: ${r.rank}!`, 5000);
      if (r.badge) ui.toast(`Badge earned: ${r.badge.name}`, 5000);
    };
    const stop = [
      rewards.onChange(draw),
      connection.on('reward', (r) => {
        rewards.apply(r);
        tell(r);
      }),
    ];
    // Offline (a preview) there is no server to answer: show what the award would give.
    ctx.previewAward = (action) => {
      const r = rewards.simulate(action);
      if (r) tell(r);
    };
    draw();
    // An outfit bought earlier is already known to the server when online; offline, announce it.
    if (!connection.online && look) connection.lookChanged(look);
    return () => stop.forEach((f) => f());
  }
}
