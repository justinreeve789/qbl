import * as Phaser from 'phaser';
import { scenePhysics } from '@qbl/shared';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

/** World pixels of height the camera tries to show. */
const VIEW_HEIGHT = 1000;

/**
 * Follows the local player inside the scene's bounds and keeps the scene covering the window. A
 * physics experiment is shown whole instead, in the middle of the window: nothing of it may be
 * cut off, and there is nobody to follow.
 */
export class CameraSystem implements SceneSystem {
  private whole = false;

  constructor(private rt: SceneRuntime) {}

  create() {
    const { scene, size } = this.rt;
    const player = this.rt.system(LocalPlayerSystem).avatar;
    const cam = scene.cameras.main;
    this.whole = scenePhysics(this.rt.def) != null;
    if (this.whole) {
      cam.fadeIn(350, 0, 0, 0);
      this.fit();
      scene.scale.on(Phaser.Scale.Events.RESIZE, this.fit, this);
      return;
    }
    cam.setBounds(0, 0, size.width, size.height);
    cam.centerOn(player.x, player.y);
    cam.startFollow(player, true, 0.12, 0.12);
    cam.fadeIn(350, 0, 0, 0);
    this.fit();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.fit, this);
  }

  private fit() {
    const { scene, size } = this.rt;
    const { width, height } = scene.scale.gameSize;
    if (this.whole) {
      const cam = scene.cameras.main;
      cam.setZoom(Math.min(width / size.width, height / size.height));
      cam.centerOn(size.width / 2, size.height / 2);
      return;
    }
    const cover = Math.max(width / size.width, height / size.height);
    scene.cameras.main.setZoom(Math.max(cover, height / VIEW_HEIGHT));
  }

  destroy() {
    this.rt.scene.scale.off(Phaser.Scale.Events.RESIZE, this.fit, this);
  }
}
