import { evaluateObjectives, type ObjectiveStatus } from '@qbl/shared';
import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';

/**
 * The mission checklist. Objectives are defined in the scenario and driven
 * by variables, so this feature only has to re-evaluate them when a variable
 * changes and tell the player when one is newly complete.
 */
export class ObjectivesFeature implements GameFeature {
  private shown = '';
  private completed = new Set<string>();
  private first = true;

  start(ctx: GameContext): () => void {
    if ((ctx.scenario.objectives ?? []).length === 0) return () => {};
    const refresh = () => this.refresh(ctx);
    refresh();
    const off = ctx.vars.onChange(refresh);
    // Room-scoped and time-based values can change without a local variable action.
    const timer = setInterval(refresh, 1000);
    return () => {
      off();
      clearInterval(timer);
    };
  }

  refresh(ctx: GameContext): ObjectiveStatus[] {
    const list = evaluateObjectives(ctx.scenario.objectives, ctx.vars.get);
    const key = JSON.stringify(list);
    if (key !== this.shown) {
      this.shown = key;
      ctx.ui.objectives(list);
    }
    for (const o of list) {
      const id = String(o.id);
      if (!o.complete || this.completed.has(id)) continue;
      this.completed.add(id);
      // Objectives already complete when the game starts (from a save) are not announced again.
      if (!this.first) ctx.ui.toast(`Objective complete: ${o.text}`, 4000);
    }
    this.first = false;
    return list;
  }
}
