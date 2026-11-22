import { storyNext } from '@qbl/shared';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';

/**
 * A story scene (Scene.story) plays by itself; this offers the bar beside it: skip ahead to where the
 * scene's start events jump (its end events still run), or watch the scene again from its beginning.
 * Everything else a story scene is comes from elsewhere: avatars are not shown (normalizeScenario),
 * the player does not walk (LocalPlayerSystem) and the view follows whoever is acting (CameraSystem).
 */
export class StorySystem implements SceneSystem {
  private shown = false;

  constructor(private rt: SceneRuntime) {}

  create() {
    const { def, ctx, engine } = this.rt;
    if (!def.story) return;
    const next = storyNext(def);
    this.shown = true;
    ctx.ui.storyBar({
      skip: next ? () => !this.rt.leaving && void engine.leave(next.scene_id, next.spawn_point) : undefined,
      again: () => !this.rt.leaving && this.rt.restart({ sceneId: def.id }),
    });
  }

  destroy() {
    if (this.shown) this.rt.ctx.ui.storyBar(null);
    this.shown = false;
  }
}
