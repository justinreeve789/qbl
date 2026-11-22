import { dialogueDuration, isNarrated } from '@qbl/shared';
import type { Presenter } from '../Presenter';
import { speech } from './dialogue';

/**
 * The narrator speaks: the story box a portrait dialogue uses, with no close-up and no name. It is
 * read aloud (in the narrator's recorded voice when it has a recording) unless it says not to, and
 * waits for a click to continue unless it has a duration. Another player's narration, seen in
 * passing, closes by itself.
 */
export const narration: Presenter<'narration'> = (action, pc, actor) =>
  pc.ctx.ui.portraitDialogue(pc.ctx.text(action.text), {
    narrator: true,
    duration: action.duration && action.duration > 0 ? action.duration : actor ? dialogueDuration(action.text) : 0,
    watching: !!actor,
    speak: isNarrated(pc.ctx.scenario, action) ? speech(pc, action) : undefined,
  });
