import type * as Phaser from 'phaser';
import type { Media, SceneLayer } from '@qbl/shared';
import { mediaKey } from '../core/assets';
import { Depth } from '../core/depth';
import type { SceneRuntime, SceneSystem } from '../core/SceneRuntime';

/** Background and foreground layers, including tiled, drifting and parallax ones. */
export class LayerSystem implements SceneSystem {
  private scrolling: Array<{ sprite: Phaser.GameObjects.TileSprite; vx: number; vy: number }> = [];
  private objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private rt: SceneRuntime) {}

  create() {
    this.build(this.rt.def.background_media ?? [], Depth.background);
    this.build(this.rt.def.foreground_media ?? [], Depth.foreground);
  }

  private build(layers: Array<SceneLayer | Media>, depth: number) {
    const { scene, size } = this.rt;
    layers.forEach((entry, i) => {
      const layer: SceneLayer = 'media_id' in entry ? entry : { media_id: entry.id };
      const key = mediaKey(layer.media_id);
      if (!scene.textures.exists(key)) return;
      const x = layer.position_x ?? 0;
      const y = layer.position_y ?? 0;
      const w = layer.display_width ?? size.width;
      const h = layer.display_height ?? size.height;
      let object: Phaser.GameObjects.Image | Phaser.GameObjects.TileSprite;
      if (layer.tile) {
        const sprite = scene.add.tileSprite(x, y, w, h, key).setOrigin(0, 0);
        if (layer.scroll_speed_x || layer.scroll_speed_y) {
          this.scrolling.push({ sprite, vx: layer.scroll_speed_x ?? 0, vy: layer.scroll_speed_y ?? 0 });
        }
        object = sprite;
      } else {
        object = scene.add.image(x, y, key).setOrigin(0, 0).setDisplaySize(w, h);
      }
      object.setDepth(depth + i);
      if (layer.parallax != null) object.setScrollFactor(layer.parallax);
      this.objects.push(object);
    });
  }

  update(_time: number, delta: number) {
    for (const s of this.scrolling) {
      s.sprite.tilePositionX += (s.vx * delta) / 1000;
      s.sprite.tilePositionY += (s.vy * delta) / 1000;
    }
  }

  destroy() {
    for (const o of this.objects) o.destroy();
    this.objects = [];
    this.scrolling = [];
  }
}
