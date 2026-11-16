import { scaleAt } from '@qbl/shared';
import { Avatar } from '../entities/Avatar';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';

/**
 * Other players in this scene. Avatars are created, moved and removed by
 * comparing against the room state every frame, so the code is the same
 * whether the state comes from the game server or from offline mode.
 */
export class RemotePlayersSystem implements SceneSystem {
  private avatars = new Map<string, Avatar>();

  constructor(private rt: SceneRuntime) {}

  get(sessionId: string): Avatar | undefined {
    return this.avatars.get(sessionId);
  }

  update(_time: number, delta: number) {
    const { ctx, def, scene, zoom } = this.rt;
    if (def.show_avatars === false) return;
    const { state, sessionId } = ctx.connection;
    const seen = new Set<string>();
    state.players.forEach((rec, id) => {
      if (id === sessionId || rec.scene_id !== def.id) return;
      seen.add(id);
      let avatar = this.avatars.get(id);
      if (!avatar) {
        avatar = new Avatar(scene, ctx, rec, zoom, false, (x, y) => scaleAt(def, x, y));
        this.avatars.set(id, avatar);
      }
      avatar.approach(rec.x, rec.y, delta);
      avatar.setFacing(rec.facing === 'left' ? 'left' : 'right');
      avatar.setAttachments(rec.attachments);
      avatar.setConnected(rec.connected);
      // An avatar action on their side: the hidden flag arrives through the room state.
      avatar.setShown(!rec.hidden);
      avatar.tick(delta);
    });
    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) {
        avatar.destroy();
        this.avatars.delete(id);
      }
    }
  }

  destroy() {
    for (const a of this.avatars.values()) a.destroy();
    this.avatars.clear();
  }
}
