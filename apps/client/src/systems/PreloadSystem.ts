import { preloadJumpTargets } from '../core/assets';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';

/** Loads, in the background, the media of every scene reachable from this one, so jumps are instant. */
export class PreloadSystem implements SceneSystem {
  constructor(private rt: SceneRuntime) {}

  create() {
    preloadJumpTargets(this.rt.scene, this.rt.ctx, this.rt.def);
  }
}
