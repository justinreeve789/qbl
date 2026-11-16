import * as Phaser from 'phaser';
import { resolvedHandle } from '@qbl/shared';
import { mediaKey } from '../../core/assets';
import type { GameContext } from '../../core/GameContext';
import { deferred, type Presenter } from '../Presenter';

/** Stop the background music, if any. */
export function stopMusic(ctx: GameContext): void {
  const music = ctx.music;
  if (!music) return;
  ctx.music = null;
  music.sound.stop();
  music.sound.destroy();
}

export const audio: Presenter<'audio'> = (action, pc) => {
  const key = action.media_id != null ? mediaKey(action.media_id) : '';
  if (!pc.scene.cache.audio.exists(key)) return pc.missing(action);
  const config = { volume: action.volume ?? 1, loop: action.repeat === true };

  if (action.persist) {
    // Background music. The same track carries on across scenes; a different one replaces it.
    const current = pc.ctx.music;
    if (current && current.mediaId === action.media_id && current.sound.isPlaying) {
      current.actionIds.add(action.id);
      return resolvedHandle();
    }
    stopMusic(pc.ctx);
    const sound = pc.scene.sound.add(key, config);
    const music = { sound, mediaId: action.media_id!, actionIds: new Set([action.id]) };
    pc.ctx.music = music;
    sound.once(Phaser.Sound.Events.COMPLETE, () => {
      if (pc.ctx.music === music) stopMusic(pc.ctx);
    });
    sound.play();
    // Not tied to this scene: leaving does not stop it. A cancel action reaches it through ActionHost.cancelPersistent().
    return resolvedHandle();
  }

  const sound = pc.scene.sound.add(key, config);
  pc.sounds.add(sound);
  const d = deferred();
  const end = () => {
    pc.sounds.delete(sound);
    d.resolve();
  };
  sound.once(Phaser.Sound.Events.COMPLETE, () => {
    end();
    sound.destroy();
  });
  sound.once(Phaser.Sound.Events.DESTROY, end);
  sound.play();
  return {
    done: d.done,
    cancel: () => {
      sound.stop();
      sound.destroy();
    },
  };
};
