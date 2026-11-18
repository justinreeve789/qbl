import { isNarrated } from '@qbl/shared';
import type { Presenter } from '../Presenter';
import { speech } from './dialogue';

// Screen-space actions are drawn by the UI layer, not by Phaser, so they stay
// sharp and are unaffected by camera zoom.

export const textOverlay: Presenter<'text_overlay'> = (action, pc) => {
  const overlay = pc.ctx.ui.textOverlay(pc.ctx.text(action.text), {
    alignment: action.alignment,
    size: action.text_font_size,
    color: action.text_font_color,
    style: action.text_font_style,
    duration: action.duration,
    speak: isNarrated(pc.ctx.scenario, action) ? speech(pc, action) : undefined,
  });
  pc.track(action.id, { kind: 'overlay', overlay }, overlay);
  return overlay;
};

export const imageOverlay: Presenter<'image_overlay'> = (action, pc) => {
  const url = action.media_id != null ? pc.ctx.mediaUrl(action.media_id) : null;
  if (!url) return pc.missing(action);
  const overlay = pc.ctx.ui.imageOverlay(url, {
    alignment: action.alignment,
    scaleX: action.scale_x,
    scaleY: action.scale_y,
    duration: action.duration,
  });
  pc.track(action.id, { kind: 'overlay', overlay }, overlay);
  return overlay;
};

export const video: Presenter<'video'> = (action, pc) => {
  const url = action.media_id != null ? pc.ctx.mediaUrl(action.media_id) : null;
  if (!url) return pc.missing(action);
  const overlay = pc.ctx.ui.videoOverlay(url, { alignment: action.alignment, volume: action.volume });
  pc.track(action.id, { kind: 'overlay', overlay }, overlay);
  return overlay;
};
