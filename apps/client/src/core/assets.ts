import type * as Phaser from 'phaser';
import {
  collectGlobalMediaIds, collectSceneMediaIds, resolveMediaUrl,
  type Id, type Media, type Scene, type Spritemap, type ShopItem } from '@qbl/shared';
import type { GameContext } from './GameContext';

export const mediaKey = (id: Id) => `media-${id}`;
export const DEFAULT_AVATAR = 'avatar-default';

function isLoaded(scene: Phaser.Scene, media: Media): boolean {
  const key = mediaKey(media.id);
  if (media.type === 'image') return scene.textures.exists(key);
  if (media.type === 'audio') return scene.cache.audio.exists(key);
  return true; // video is streamed by a <video> element when its action runs
}

/** Queue any of these media that are not loaded yet. Returns how many were queued. */
export function queueMedia(scene: Phaser.Scene, ctx: GameContext, ids: Id[]): number {
  let queued = 0;
  for (const id of ids) {
    const media = ctx.index.media.get(id);
    if (!media || isLoaded(scene, media)) continue;
    const url = resolveMediaUrl(ctx.scenario, media);
    if (!url) continue;
    if (media.type === 'image') scene.load.image(mediaKey(id), url);
    else if (media.type === 'audio') scene.load.audio(mediaKey(id), url);
    queued++;
  }
  return queued;
}

/** Queue what a scene needs to be shown, plus media that travels with players. */
/** The texture a shop item is drawn with: one of the scenario's media, or its own picture. */
export function shopTexture(item: ShopItem): string | null {
  if (item.media_id != null) return mediaKey(item.media_id);
  return item.image_url ? `shop:${item.id}` : null;
}

/** Pictures of everything the marketplace sells, so avatars can wear them in any scene. */
function queueShop(scene: Phaser.Scene, ctx: GameContext): number {
  let queued = 0;
  for (const item of ctx.rewards.items.values()) {
    if (item.media_id != null || !item.image_url || scene.textures.exists(`shop:${item.id}`)) continue;
    scene.load.image(`shop:${item.id}`, item.image_url);
    queued++;
  }
  return queued;
}

export function queueScene(scene: Phaser.Scene, ctx: GameContext, target: Scene): number {
  return queueShop(scene, ctx) + queueMedia(scene, ctx, [...collectGlobalMediaIds(ctx.scenario), ...collectSceneMediaIds(ctx.scenario, target)]);
}

/** Load in the background everything reachable from a scene, so the next jump is instant. */
export function preloadJumpTargets(scene: Phaser.Scene, ctx: GameContext, from: Scene): void {
  let queued = 0;
  for (const id of ctx.index.jumpTargets(from.id)) {
    const target = ctx.index.scene(id);
    if (target) queued += queueScene(scene, ctx, target);
  }
  if (queued > 0 && !scene.load.isLoading()) scene.load.start();
}

/**
 * Register a sprite sheet over an already-loaded image and return its
 * texture key. The same image can back several sheets with different grids.
 */
export function ensureSpritesheet(scene: Phaser.Scene, mediaId: Id, map: Spritemap): string | null {
  const cols = map.spritemap_tiles_horizontal ?? 1;
  const rows = map.spritemap_tiles_vertical ?? 1;
  const base = mediaKey(mediaId);
  const key = `${base}-ss-${cols}x${rows}`;
  if (scene.textures.exists(key)) return key;
  if (!scene.textures.exists(base)) return null;
  const image = scene.textures.get(base).getSourceImage() as HTMLImageElement;
  const width = map.spritemap_width ?? image.width;
  const height = map.spritemap_height ?? image.height;
  scene.textures.addSpriteSheet(key, image, {
    frameWidth: Math.floor(width / cols),
    frameHeight: Math.floor(height / rows),
    endFrame: (map.spritemap_tiles_num ?? cols * rows) - 1,
  });
  return key;
}

/** Create (once) and return the key of an animation for a spritemap definition. */
export function ensureAnimation(scene: Phaser.Scene, sheetKey: string, map: Spritemap): string {
  const total = map.spritemap_tiles_num ?? (map.spritemap_tiles_horizontal ?? 1) * (map.spritemap_tiles_vertical ?? 1);
  const sequence = map.spritemap_tile_sequence?.length ? map.spritemap_tile_sequence : Array.from({ length: total }, (_, i) => i);
  const duration = map.spritemap_duration && map.spritemap_duration > 0 ? map.spritemap_duration : sequence.length * 100;
  const repeat = map.spritemap_repeat !== false;
  const key = `${sheetKey}-${sequence.join('.')}-${duration}-${repeat ? 'loop' : 'once'}`;
  if (!scene.anims.exists(key)) {
    scene.anims.create({
      key,
      frames: sequence.map((frame) => ({ key: sheetKey, frame })),
      duration,
      repeat: repeat ? -1 : 0,
    });
  }
  return key;
}

/** A simple stand-in figure for scenarios that define no avatar images. */
export function ensureDefaultAvatar(scene: Phaser.Scene): string {
  if (!scene.textures.exists(DEFAULT_AVATAR)) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x4f7cff, 1);
    g.fillRoundedRect(20, 70, 80, 130, 30);
    g.fillStyle(0xffd9b3, 1);
    g.fillCircle(60, 45, 40);
    g.fillStyle(0x1c172e, 1);
    g.fillCircle(46, 40, 5);
    g.fillCircle(74, 40, 5);
    g.generateTexture(DEFAULT_AVATAR, 120, 200);
    g.destroy();
  }
  return DEFAULT_AVATAR;
}
