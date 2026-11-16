import * as Phaser from 'phaser';
import { queueScene } from '../core/assets';
import { getContext } from '../core/GameContext';
import type { PlaySceneData } from '../core/SceneRuntime';

/** Loads what the first scene needs, with a progress bar, then hands over to PlayScene. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    const ctx = getContext(this);
    const { width, height } = this.scale.gameSize;
    const track = this.add.rectangle(width / 2, height / 2, 320, 14, 0xffffff, 0.15);
    const bar = this.add.rectangle(track.x - 160, track.y, 0, 14, 0x7aa2ff).setOrigin(0, 0.5);
    this.add
      .text(width / 2, height / 2 - 40, ctx.scenario.title, { fontFamily: 'Montserrat, system-ui, sans-serif', fontSize: '24px', color: '#ffffff' })
      .setOrigin(0.5);
    this.load.on(Phaser.Loader.Events.PROGRESS, (p: number) => (bar.width = 320 * p));
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
      console.warn(`[qbl] could not load ${file.key} from ${String(file.url)}`);
    });

    const sceneId = ctx.connection.me?.scene_id ?? ctx.scenario.start_scene_id;
    const scene = ctx.index.scene(sceneId) ?? ctx.index.startScene();
    queueScene(this, ctx, scene);
  }

  create() {
    const ctx = getContext(this);
    const me = ctx.connection.me;
    const data: PlaySceneData = { sceneId: me?.scene_id ?? ctx.scenario.start_scene_id };
    this.scene.start('play', data);
  }
}
