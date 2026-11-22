import { dialogue } from './dialogue';
import type { PresenterMap } from '../Presenter';
import { audio } from './audio';
import { infobox } from './infobox';
import { narration } from './narration';
import { imageOverlay, textOverlay, video } from './overlays';
import { imageFixed, spritemap } from './world';

/**
 * One presenter per action type that shows or plays something. Actions that
 * are pure logic (wait, variable, repeat, run_event, cancel, jump) are
 * handled by the shared SceneEngine and need no presenter.
 */
export const presenters: PresenterMap = {
  audio,
  dialogue,
  image_fixed: imageFixed,
  image_overlay: imageOverlay,
  infobox,
  narration,
  // The marketplace window. The action ends when the player closes it.
  shop: (_action, pc) => pc.ctx.rewards.openShop(),
  spritemap,
  text_overlay: textOverlay,
  video,
};
