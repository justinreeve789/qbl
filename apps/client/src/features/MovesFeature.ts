import { BUILT_IN_MOVES, characterAnimationRepeats, isPose, testConditions } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

export interface MoveButton { animation: string; label: string; icon: string }

/** "victory_dance" reads as "Victory dance". */
const readable = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).replace(/_/g, ' ');

/**
 * What the player can do right now from their screen: the scenario's moves whose conditions
 * hold (a move is taught by setting a variable), and the moves they have bought and switched
 * on in the marketplace, which belong to their account and so work in every scenario.
 */
export function availableMoves(ctx: GameContext): MoveButton[] {
  const out = new Map<string, MoveButton>();
  const add = (animation: string, label?: string, icon?: string) => {
    if (!animation || out.has(animation)) return;
    const known = BUILT_IN_MOVES[animation];
    out.set(animation, { animation, label: label || known?.label || readable(animation), icon: icon || known?.icon || '✨' });
  };
  for (const move of ctx.scenario.moves ?? []) {
    if (testConditions(move.conditions, ctx.vars.get)) add(move.animation, move.label, move.icon);
  }
  for (const item of ctx.rewards.equipped('move')) add(item.move ?? '', item.name);
  return [...out.values()];
}

/**
 * The move buttons. Pressing one asks the room to play that animation on the player's avatar,
 * which is how everyone in the scene, the player included, comes to see it.
 */
export class MovesFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    let shown = '';
    const draw = () => {
      const moves = availableMoves(ctx);
      const key = moves.map((m) => `${m.animation}|${m.label}|${m.icon}`).join(',');
      if (key === shown) return;
      shown = key;
      ctx.ui.moves(moves, (animation) => {
        // Pressing the move that is already going on (a dance) ends it.
        const going = (ctx.connection.me?.anim ?? '').split(':')[0];
        ctx.connection.animate(going === animation && isLooping(ctx, animation) ? '' : animation);
      });
    };
    const stops = [ctx.vars.onChange(draw), ctx.rewards.onChange(draw)];
    draw();
    return () => stops.forEach((stop) => stop());
  }
}

/** Whether a move keeps going until stopped, on this player's avatar. */
function isLooping(ctx: GameContext, animation: string): boolean {
  const avatar = ctx.index.avatars.get(ctx.connection.me?.avatar ?? -1);
  const drawn = isPose(animation) ? undefined : avatar?.animations?.[animation];
  if (drawn) return characterAnimationRepeats(animation, drawn);
  return BUILT_IN_MOVES[animation]?.repeat === true;
}
