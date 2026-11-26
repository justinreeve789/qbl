import type * as Phaser from 'phaser';
import {
  animationDuration, animationFrames, animationRepeats, apngFrameImages, characterAnimationRepeats, collectGlobalMediaIds, collectSceneMediaIds, findAnimation, layerMediaId, readApng, resolveMediaUrl,
  type CharacterAnimation, type Id, type Media, type Scenario, type Scene, type Spritemap, type ShopItem } from '@qbl/shared';
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
    // An animated PNG shows its first frame at once, and plays once its frames are cut out.
    if (media.type === 'image' && media.apng) void prepareApng(scene, media, url);
    queued++;
  }
  return queued;
}

// ------------------------------------------------------------- failed loads

/** Phaser.Loader.Events.FILE_LOAD_ERROR (this file imports Phaser's types only). */
const FILE_LOAD_ERROR = 'loaderror';

/** Media whose failed load has been shown on screen already: once per file per game. */
const reported = new Set<string>();

/** What in the scenario uses a media file, for a message: "background layer 2 of “Crew quarters”". */
export function mediaUses(scenario: Scenario, id: Id): string[] {
  const uses: string[] = [];
  for (const scene of scenario.scenes ?? []) {
    const name = scene.subtitle || scene.shortname || `scene ${scene.id}`;
    for (const [which, list] of [['background', scene.background_media], ['foreground', scene.foreground_media]] as const) {
      (list ?? []).forEach((layer, i) => {
        if (layerMediaId(layer) === id) uses.push(`${which} layer ${i + 1} of “${name}”`);
      });
    }
  }
  return uses;
}

/**
 * Say when one of the scenario's files cannot be loaded, instead of leaving it out without a word:
 * in the console always, and on screen in a preview, so whoever is testing a draft sees which
 * picture is missing and where it is used. Listeners go when the scene shuts down, so this is
 * called each time a scene starts.
 */
export function reportLoadErrors(scene: Phaser.Scene, ctx: GameContext): void {
  scene.load.on(FILE_LOAD_ERROR, (file: Phaser.Loader.File) => {
    const match = /^media-(\d+)$/.exec(file.key);
    const media = match ? ctx.index.media.get(Number(match[1])) : undefined;
    const uses = media ? mediaUses(ctx.scenario, media.id) : [];
    const what = media ? `“${media.filename ?? file.key}”` : file.key;
    const where = uses.length ? ` (${uses.join(', ')})` : '';
    console.warn(`[qbl] could not load ${what}${where} from ${String(file.url)}`);
    if (!ctx.options.preview || reported.has(file.key)) return;
    reported.add(file.key);
    const kind = media?.type === 'audio' ? 'sound' : media?.type === 'video' ? 'video' : 'picture';
    ctx.ui.toast(`Could not load the ${kind} ${what}${where}. It is left out. Check that the file opens, and try uploading it again.`, 9000);
  });
}

// ------------------------------------------------------------ animated PNGs

export const apngKey = (id: Id) => `media-${id}-apng`;
/** Each animated PNG's frame delays, once its frames are cut out. */
const apngDelays = new Map<Id, number[]>();
const apngPending = new Set<Id>();

/**
 * Cut an animated PNG into its frames, side by side on a canvas that becomes a texture of its
 * own (`apngKey`), each frame drawn over the last as the file says. The browser's image decoder
 * gives a page only the first frame, so the file is read here. Done once per game; a file that
 * cannot be read stays a still picture.
 */
async function prepareApng(scene: Phaser.Scene, media: Media, url: string): Promise<void> {
  const key = apngKey(media.id);
  if (apngPending.has(media.id) || scene.textures.exists(key)) return;
  apngPending.add(media.id);
  try {
    const response = await fetch(url);
    const file = readApng(await response.arrayBuffer());
    if (!file) return;
    const { width, height } = file;
    const stage = document.createElement('canvas');
    stage.width = width;
    stage.height = height;
    const strip = document.createElement('canvas');
    strip.width = width * file.frames.length;
    strip.height = height;
    const draw = stage.getContext('2d')!;
    const out = strip.getContext('2d')!;
    const images = apngFrameImages(file);
    for (const [i, frame] of file.frames.entries()) {
      const picture = await createImageBitmap(new Blob([images[i]! as BlobPart], { type: 'image/png' }));
      const before = frame.dispose === 2 ? draw.getImageData(0, 0, width, height) : null;
      if (frame.blend === 0) draw.clearRect(frame.x, frame.y, frame.width, frame.height);
      draw.drawImage(picture, frame.x, frame.y);
      picture.close();
      out.drawImage(stage, i * width, 0);
      // What the next frame is drawn over: this one, nothing where this one was, or what was there before it.
      if (frame.dispose === 1) draw.clearRect(frame.x, frame.y, frame.width, frame.height);
      else if (before) draw.putImageData(before, 0, 0);
    }
    if (scene.textures.exists(key)) return;
    const texture = scene.textures.addCanvas(key, strip);
    if (!texture) return;
    for (let i = 0; i < file.frames.length; i++) texture.add(i, 0, i * width, 0, width, height);
    apngDelays.set(media.id, file.frames.map((f) => f.delay));
    // Figures waiting for it change to the animated version.
    scene.game.events.emit(`${key}-ready`);
  } catch {
    /* a still picture, then */
  } finally {
    apngPending.delete(media.id);
  }
}

/** Run `then` once an animated PNG's frames are ready, unless they already are (returns true). */
export function whenApngReady(scene: Phaser.Scene, media: Media, then: () => void): boolean {
  if (!media.apng || scene.textures.exists(apngKey(media.id))) return true;
  scene.game.events.once(`${apngKey(media.id)}-ready`, then);
  return false;
}

// ------------------------------------------------------- character animations

/**
 * How one of a character's animations is drawn: the texture (and frame) of a still picture, or
 * a Phaser animation over a sheet's or an animated PNG's frames. An animated PNG whose frames are
 * not cut out yet is drawn as its first frame.
 */
export function characterAnimation(scene: Phaser.Scene, media: Media, name: string, animation: CharacterAnimation): { texture: string; frame?: number; anim?: string } {
  const base = mediaKey(media.id);
  const frames = animationFrames(animation, media);
  if (!frames) return { texture: base };
  const repeat = characterAnimationRepeats(name, animation);
  if (media.sheet) {
    const sheet = mediaSheet(scene, media);
    if (!sheet) return { texture: base };
    if (frames.length === 1) return { texture: sheet, frame: frames[0] };
    const key = ensureAnimation(scene, sheet, {
      spritemap_tiles_horizontal: media.sheet.columns, spritemap_tiles_vertical: media.sheet.rows, spritemap_tiles_num: media.sheet.count,
      spritemap_tile_sequence: frames, spritemap_duration: animationDuration(animation, media), spritemap_repeat: repeat,
    });
    return { texture: sheet, anim: key };
  }
  // An animated PNG: its own delays, stretched to the animation's duration when it sets one.
  const strip = apngKey(media.id);
  const delays = apngDelays.get(media.id);
  if (!delays || !scene.textures.exists(strip)) return { texture: base };
  if (frames.length === 1) return { texture: strip, frame: frames[0] };
  const own = frames.map((f) => delays[f] ?? 100);
  const total = own.reduce((a, b) => a + b, 0);
  const wanted = animation.duration && animation.duration > 0 ? animation.duration : total;
  const key = `${strip}-${frames.join('.')}-${wanted}-${repeat ? 'loop' : 'once'}`;
  if (!scene.anims.exists(key)) {
    scene.anims.create({
      key,
      frames: frames.map((frame, i) => ({ key: strip, frame, duration: Math.max(10, Math.round((own[i]! * wanted) / Math.max(1, total))) })),
      frameRate: 10,
      repeat: repeat ? -1 : 0,
    });
  }
  return { texture: strip, anim: key };
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

/** The sprite sheet of a media that is one (it says how many frames across and down), or null. */
export function mediaSheet(scene: Phaser.Scene, media: Media): string | null {
  if (!media.sheet) return null;
  return ensureSpritesheet(scene, media.id, { spritemap_tiles_horizontal: media.sheet.columns, spritemap_tiles_vertical: media.sheet.rows, spritemap_tiles_num: media.sheet.count });
}

/** The Phaser animation for one of a media's named animations, created on first use. Null if it has none of that name. */
export function mediaAnimation(scene: Phaser.Scene, media: Media, name: string): string | null {
  const animation = findAnimation(media, name);
  const sheet = animation ? mediaSheet(scene, media) : null;
  if (!animation || !sheet) return null;
  return ensureAnimation(scene, sheet, {
    spritemap_tiles_horizontal: media.sheet!.columns, spritemap_tiles_vertical: media.sheet!.rows, spritemap_tiles_num: media.sheet!.count,
    spritemap_tile_sequence: animation.frames, spritemap_duration: animation.duration, spritemap_repeat: animationRepeats(animation),
  });
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
