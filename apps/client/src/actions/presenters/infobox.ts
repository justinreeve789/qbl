import { answerValue, embedBareMedia, isNarrated, testConditions } from '@qbl/shared';
import { speech } from './dialogue';
import type { Presenter } from '../Presenter';

/**
 * A modal box with author-written content and buttons. The action is not
 * finished until the box is closed AND the chosen button's action has run to
 * its end, so a sequence such as "ask a question, then show the next step"
 * waits for the feedback that the answer triggers.
 *
 * What the player typed in the box's answer boxes is saved in their variables
 * when they choose a button, before its action runs, so the action (or a later
 * condition) can use it.
 */
export const infobox: Presenter<'infobox'> = (action, pc) => {
  const { ctx } = pc;
  // Buttons can be conditional: only those whose conditions hold right now are offered.
  const buttons = (action.call_to_actions ?? []).filter((cta) => testConditions(cta.conditions, ctx.vars.get));
  const mediaOf = (id: number) => ctx.index.media.get(id);
  const top = action.media_id != null ? mediaOf(action.media_id) : undefined;
  const topUrl = top ? ctx.mediaUrl(top.id) : null;
  const words = new Map((ctx.scenario.glossary ?? []).map((e) => [String(e.id), e]));

  const box = ctx.ui.infobox(
    ctx.html(embedBareMedia(action.content ?? '', (id) => mediaOf(id)?.type)),
    buttons.map((cta) => ({ label: ctx.text(cta.text), mark: cta.mark })),
    {
      dismissible: action.dismissible !== false,
      speak: isNarrated(ctx.scenario, action) ? speech(pc, action) : undefined,
      hero: top && topUrl && (top.type === 'image' || top.type === 'video') ? { url: topUrl, type: top.type } : null,
      size: action.size,
      accent: action.accent,
      word: (id) => {
        const e = words.get(id);
        return e ? { term: e.term, definition: ctx.text(e.definition), image: e.media_id != null ? ctx.mediaUrl(e.media_id) : null } : null;
      },
      learn: (id) => ctx.learn(id) != null,
      vars: ctx.vars.get,
      chosen: async (index, answers) => {
        const cta = buttons[index];
        for (const [name, typed] of Object.entries(answers)) ctx.vars.apply(name, 'set', answerValue(typed));
        // Which answer was chosen, for the teacher's report: the first choice per question is what the student thought unaided.
        const typed = Object.values(answers).map((a) => `“${a.trim()}”`).join(', ');
        const label = ctx.text(cta?.text ?? '');
        ctx.track({ type: 'choice', ref: String(action.id), label: typed ? `${typed} (${label})` : label, value: index });
        // "Try again": its action runs while the box stays open.
        if (cta?.mark === 'try_again' && cta.action && !cancelled) await pc.engine.runAction(cta.action);
      },
    },
  );
  let cancelled = false;
  const done = box.choice.then(async (index) => {
    if (cancelled || index == null) return;
    const chosen = buttons[index];
    if (chosen?.action && chosen.mark !== 'try_again') await pc.engine.runAction(chosen.action);
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      box.close();
    },
  };
};
