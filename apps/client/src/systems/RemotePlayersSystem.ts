import { scaleAt, shadeAt } from '@qbl/shared';
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

  private pointerOver = 0;

  get(sessionId: string): Avatar | undefined {
    return this.avatars.get(sessionId);
  }

  /** Where the other players in this scene stand (their feet). */
  feet(): Array<{ x: number; y: number }> {
    return [...this.avatars.values()].map((a) => ({ x: a.x, y: a.y }));
  }

  /** True while the pointer is over another player: a click then opens their profile instead of walking there. */
  get hovering(): boolean {
    return this.pointerOver > 0;
  }

  update(_time: number, delta: number) {
    const { ctx, def, scene, zoom } = this.rt;
    if (def.show_avatars === false) return;
    const { state, sessionId } = ctx.connection;
    const seen = new Set<string>();
    state.players.forEach((rec, id) => {
      // Others in this scene, and only teammates where the scene (or its group) is limited to teams.
      if (id === sessionId || rec.scene_id !== def.id || !ctx.sees(rec)) return;
      seen.add(id);
      let avatar = this.avatars.get(id);
      if (!avatar) {
        avatar = new Avatar(scene, ctx, rec, zoom, false, (x, y) => scaleAt(def, x, y), (x, y) => shadeAt(def, x, y));
        this.avatars.set(id, avatar);
        avatar.onPointer(
          () => {
            if (!ctx.ui.capturesInput && !this.rt.leaving) ctx.showProfile?.(id);
          },
          (over) => (this.pointerOver = Math.max(0, this.pointerOver + (over ? 1 : -1))),
        );
      }
      avatar.approach(rec.x, rec.y, delta);
      avatar.setFacing(rec.facing === 'left' ? 'left' : 'right');
      avatar.setAttachments(rec.attachments);
      avatar.setConnected(rec.connected);
      avatar.setLook(rec.look ?? '');
      avatar.setAnimation(rec.anim ?? '');
      // An avatar action on their side: the hidden flag arrives through the room state.
      avatar.setShown(!rec.hidden);
      avatar.tick(delta);
    });
    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) {
        avatar.destroy();
        this.avatars.delete(id);
        // It may have gone from under the pointer, and would then never report the pointer leaving.
        this.pointerOver = 0;
      }
    }
  }

  destroy() {
    for (const a of this.avatars.values()) a.destroy();
    this.avatars.clear();
  }
}
