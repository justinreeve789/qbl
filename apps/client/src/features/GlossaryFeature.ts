import type { GameContext } from '../core/GameContext';
import type { GameFeature } from '../core/GameFeature';
import type { GlossaryRow } from '../ui/UiPort';

/** The player's words, as the glossary panel lists them. */
export function glossaryRows(ctx: GameContext): GlossaryRow[] {
  return ctx.glossary.map((e) => ({ id: String(e.id), term: e.term, definition: ctx.text(e.definition), image: e.media_id != null ? ctx.mediaUrl(e.media_id) : null }));
}

/**
 * The glossary: the words a scenario teaches. Some are there from the start; the others are
 * added by `glossary` actions as the player meets them, and stay (they are part of the save).
 * A scenario with read-aloud text also gets the switch for it here.
 */
export class GlossaryFeature implements GameFeature {
  start(ctx: GameContext): () => void {
    const { scenario, ui } = ctx;
    // The switch is offered when anything in the scenario is read aloud.
    const narrated = scenario.narration === 'on' || scenario.scenes.some((scene) =>
      [...(scene.start_events ?? []), ...(scene.end_events ?? []), ...(scene.hotspots ?? []), ...(scene.indirect_events ?? [])]
        .some((event) => event.actions.some((a) => 'narrate' in a && a.narrate === true)));
    ui.narration(narrated);

    if (!(scenario.glossary ?? []).length) return () => {};
    let known = new Set(ctx.glossary.map((e) => String(e.id)));
    ui.glossary(glossaryRows(ctx));
    return ctx.onGlossary(() => {
      const rows = glossaryRows(ctx);
      const fresh = rows.find((r) => !known.has(r.id));
      known = new Set(rows.map((r) => r.id));
      ui.glossary(rows, fresh?.id);
    });
  }
}
