import { testConditions } from '@qbl/shared';
import type { Presenter } from '../Presenter';

/**
 * A modal box with author-written content and buttons. The action is not
 * finished until the box is closed AND the chosen button's action has run to
 * its end, so a sequence such as "ask a question, then show the next step"
 * waits for the feedback that the answer triggers.
 */
export const infobox: Presenter<'infobox'> = (action, pc) => {
  const { ctx } = pc;
  // Buttons can be conditional: only those whose conditions hold right now are offered.
  const buttons = (action.call_to_actions ?? []).filter((cta) => testConditions(cta.conditions, ctx.vars.get));
  const box = ctx.ui.infobox(
    ctx.html(action.content),
    buttons.map((cta) => ctx.text(cta.text)),
    { dismissible: action.dismissible !== false },
  );
  let cancelled = false;
  const done = box.choice.then(async (index) => {
    if (cancelled || index == null) return;
    const chosen = buttons[index]?.action;
    if (chosen) await pc.engine.runAction(chosen);
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      box.close();
    },
  };
};
