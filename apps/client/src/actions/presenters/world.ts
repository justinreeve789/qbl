import * as Phaser from 'phaser';
import type { ActionHandle, Id } from '@qbl/shared';
import { ensureAnimation, ensureSpritesheet, mediaKey } from '../../core/assets';
import { Depth } from '../../core/depth';
import { Figure } from '../../entities/Figure';
import { deferred, type Presenter, type PresenterContext } from '../Presenter';

/** A handle for a display object in the scene: destroys it on cancel or after `duration`. */
function worldHandle(
  pc: PresenterContext,
  id: Id,
  object: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite,
  duration?: number,
  figure?: Figure,
): ActionHandle & { finish(): void } {
  const d = deferred();
  let timer: Phaser.Time.TimerEvent | undefined;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    timer?.remove();
    ticker?.remove();
    pc.scene.tweens.killTweensOf(object);
    object.destroy();
    d.resolve();
  };
  if (duration && duration > 0) timer = pc.scene.time.delayedCall(duration, finish);
  // A picture whose media is a sprite sheet keeps its own time, so an animate action can play a move on it.
  const ticker = figure ? pc.scene.time.addEvent({ delay: 33, loop: true, callback: () => figure.tick(33) }) : undefined;
  const handle = { done: d.done, cancel: finish, finish };
  pc.track(id, { kind: 'world', object, figure }, handle);
  return handle;
}

export const imageFixed: Presenter<'image_fixed'> = (action, pc) => {
  const key = action.media_id != null ? mediaKey(action.media_id) : '';
  if (!pc.scene.textures.exists(key)) return pc.missing(action);
  const media = pc.ctx.index.media.get(action.media_id!);
  // If the picture is a sprite sheet with named animations, its idle plays, and an animate action can change it.
  const figure = new Figure(pc.scene, media, key, action.position_x, action.position_y);
  figure.auto(false, 'right');
  const image = figure.object
    .setScale((action.scale_x ?? 1) * (media?.scale_x ?? 1), (action.scale_y ?? 1) * (media?.scale_y ?? 1))
    .setDepth(action.layer === 'sorted' ? action.position_y : Depth.fixed);
  return worldHandle(pc, action.id, image, action.duration, media?.sheet ? figure : undefined);
};

export const spritemap: Presenter<'spritemap'> = (action, pc) => {
  const sheet = action.media_id != null ? ensureSpritesheet(pc.scene, action.media_id, action) : null;
  if (!sheet) return pc.missing(action);
  const sprite = pc.scene.add
    .sprite(action.position_x ?? 0, action.position_y ?? 0, sheet, action.spritemap_tile_sequence?.[0] ?? 0)
    .setScale(action.scale_x ?? 1, action.scale_y ?? 1)
    .setDepth(action.layer === 'sorted' ? (action.position_y ?? 0) : Depth.fixed);
  const handle = worldHandle(pc, action.id, sprite);
  sprite.play(ensureAnimation(pc.scene, sheet, action));
  // A non-repeating spritemap disappears after its final tile.
  if (action.spritemap_repeat === false) sprite.once(Phaser.Animations.Events.ANIMATION_COMPLETE, handle.finish);
  return handle;
};
