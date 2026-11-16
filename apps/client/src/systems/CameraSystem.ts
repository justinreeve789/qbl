import * as Phaser from 'phaser';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';
import { LocalPlayerSystem } from './LocalPlayerSystem';

/** World pixels of height the camera tries to show. */
const VIEW_HEIGHT = 1000;

/** Follows the local player inside the scene's bounds and keeps the scene covering the window. */
export class CameraSystem implements SceneSystem {
  constructor(private rt: SceneRuntime) {}

  create() {
    const { scene, size } = this.rt;
    const player = this.rt.system(LocalPlayerSystem).avatar;
    const cam = scene.cameras.main;
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
    const cover = Math.max(width / size.width, height / size.height);
    scene.cameras.main.setZoom(Math.max(cover, height / VIEW_HEIGHT));
  }

  destroy() {
    this.rt.scene.scale.off(Phaser.Scale.Events.RESIZE, this.fit, this);
  }
}
