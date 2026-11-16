import type { PresenterMap } from '../Presenter';
import { audio } from './audio';
import { infobox } from './infobox';
import { imageOverlay, textOverlay, video } from './overlays';
import { imageFixed, spritemap } from './world';

/**
 * One presenter per action type that shows or plays something. Actions that
 * are pure logic (wait, variable, repeat, run_event, cancel, jump) are
 * handled by the shared SceneEngine and need no presenter.
 */
export const presenters: PresenterMap = {
  audio,
  image_fixed: imageFixed,
  image_overlay: imageOverlay,
  infobox,
  spritemap,
  text_overlay: textOverlay,
  video,
};
