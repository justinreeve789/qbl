/**
 * Characters as the editor sees them: a `characters` row's animations, read the way the game
 * reads them (an older row's single picture and close-up become animations), and the pictures
 * those animations are drawn from. No DOM here but small, reusable previews.
 */
import {
  animationDuration, animationFrames, frameCount, normalizeNpc, resolvePose,
  type CharacterAnimation, type Media, type MediaAnimation, type Npc,
} from '@qbl/shared';
import type { Row } from './api';
import { apngStrip } from './apng';
import { mediaUrl, params } from './describe';
import { h } from './dom';
import type { Store } from './store';

/** A media row as the document carries it: its sheet, animated PNG details and sheet animations come from params. */
export function mediaOf(row: Row): Media {
  const p = params(row);
  return {
    id: row.id, type: row.type as Media['type'], url: row.url as string | null, filename: row.filename as string | undefined,
    width: row.width as number | undefined, height: row.height as number | undefined,
    sheet: p.sheet as Media['sheet'], apng: p.apng as Media['apng'], animations: p.animations as Media['animations'],
  };
}

export function mediaLookup(store: Store): (id: number) => Media | undefined {
  return (id) => {
    const row = store.byId('media', id);
    return row ? mediaOf(row) : undefined;
  };
}

/** The animations a row stores itself; null when it is a row of the older shape, with one picture. */
export function storedAnimations(row: Row): Record<string, CharacterAnimation> | null {
  const a = params(row, 'settings').animations;
  return a && typeof a === 'object' && !Array.isArray(a) && Object.keys(a).length ? (a as Record<string, CharacterAnimation>) : null;
}

/** A character as the game will draw it. */
export function characterOf(store: Store, row: Row): Npc {
  const settings = params(row, 'settings');
  return normalizeNpc(
    {
      id: row.id, name: String(row.name ?? ''), scale: settings.scale as number | undefined,
      media_id: (row.media_id as number | null) ?? undefined, portrait_media_id: (settings.portrait_media_id as number | null) ?? undefined,
      animations: storedAnimations(row) ?? undefined,
    },
    mediaLookup(store),
  );
}

/** Every media id a character row draws on, in either shape. */
export function characterMediaIds(store: Store, row: Row): number[] {
  return [...new Set(Object.values(characterOf(store, row).animations ?? {}).map((a) => a.media_id))];
}

/**
 * The frames of a picture, as a sheet to cut them from: a sprite sheet as it is, an animated
 * PNG laid out as one (made in the browser, once). Null for a still picture.
 */
export async function framesOf(store: Store, media: Row | undefined): Promise<{ url: string; columns: number; rows: number; count: number; delays?: number[] } | null> {
  const url = media ? mediaUrl(store, media) : null;
  if (!media || !url) return null;
  const m = mediaOf(media);
  if (m.sheet) return { url, columns: m.sheet.columns, rows: m.sheet.rows, count: frameCount(m) };
  if (m.apng) return apngStrip(url);
  return null;
}

/** Where one frame of a sheet is, as a CSS background position. */
export function framePosition(frame: number, columns: number, rows: number): string {
  const col = frame % columns;
  const row = Math.floor(frame / columns);
  return `${columns > 1 ? (col / (columns - 1)) * 100 : 0}% ${rows > 1 ? (row / (rows - 1)) * 100 : 0}%`;
}

/**
 * A small preview of an animation playing as the game plays it: its frames at their speed,
 * mirrored if it is. A still picture is just shown. It stops by itself once it leaves the page.
 */
export function animationPreview(store: Store, animation: CharacterAnimation | null | undefined, className = 'anim-preview', mirrored = false): HTMLElement {
  const box = h('span', { class: className, 'data-media': animation?.media_id ?? '' });
  const row = animation ? store.byId('media', animation.media_id) : undefined;
  const url = row ? mediaUrl(store, row) : null;
  if (!animation || !row || !url) {
    box.classList.add('none');
    box.textContent = '—';
    return box;
  }
  if ((animation.flip === true) !== mirrored) box.style.transform = 'scaleX(-1)';
  const media = mediaOf(row);
  const frames = animationFrames(animation, media);
  if (!frames) {
    box.append(h('img', { src: url, alt: '' }));
    return box;
  }
  void framesOf(store, row).then((sheet) => {
    if (!sheet) {
      box.append(h('img', { src: url, alt: '' }));
      return;
    }
    const face = h('span', { class: 'anim-frame' });
    face.style.backgroundImage = `url("${sheet.url}")`;
    face.style.backgroundSize = `${sheet.columns * 100}% ${sheet.rows * 100}%`;
    box.append(face);
    const probe = new Image();
    probe.onload = () => (face.style.aspectRatio = `${probe.naturalWidth / sheet.columns} / ${probe.naturalHeight / sheet.rows}`);
    probe.src = sheet.url;
    const each = Math.max(30, animationDuration(animation, media) / frames.length);
    let step = 0;
    const show = () => {
      const frame = frames[step % frames.length]!;
      face.style.backgroundPosition = framePosition(frame, sheet.columns, sheet.rows);
      box.dataset.frame = String(frame);
      step++;
    };
    show();
    if (frames.length > 1) {
      // Started before the box is on the page, so give it a moment to arrive before giving up on it.
      let seen = false;
      const timer = window.setInterval(() => {
        if (box.isConnected) seen = true;
        else if (seen) return window.clearInterval(timer);
        show();
      }, each);
    }
  });
  return box;
}

/** How a placed character looks standing the way it faces, for the scene editor. */
export function standingOf(store: Store, row: Row | undefined, facing: 'left' | 'right'): { media: Row; url: string; frame: number | null; flip: boolean; sheet: { columns: number; rows: number } | null } | null {
  if (!row) return null;
  const pose = resolvePose(characterOf(store, row), false, facing);
  const media = pose ? store.byId('media', pose.animation.media_id) : undefined;
  const url = media ? mediaUrl(store, media) : null;
  if (!pose || !media || !url) return null;
  const m = mediaOf(media);
  const frames = m.sheet ? animationFrames(pose.animation, m) : null;
  return { media, url, frame: frames ? frames[0]! : null, flip: pose.flip, sheet: m.sheet ? { columns: m.sheet.columns, rows: m.sheet.rows } : null };
}

/** "0 1 2 5" or "0-3, 5": frame numbers in order. Ranges can run backwards: "3-0". */
export function parseFrames(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let f = a; a <= b ? f <= b : f >= b; f += a <= b ? 1 : -1) out.push(f);
    } else if (/^\d+$/.test(part)) out.push(Number(part));
  }
  return out.slice(0, 256);
}

// ------------------------------------------------- the picture's own animations

/*
 * Animations are defined on pictures, on the Media page: a sprite sheet's or an animated PNG's
 * named runs of frames. A character's animation plays one of them by name (`sheet_animation`),
 * with its frames, duration and repeat copied onto the character so the game reads them as ever;
 * the copies are kept in step here whenever the picture's animations change.
 */

/** A picture's own animations, as the Media page defines them. */
export function pictureAnimations(row: Row | undefined): MediaAnimation[] {
  const list = row ? params(row).animations : undefined;
  return Array.isArray(list) ? (list as MediaAnimation[]).filter((a) => a && typeof a.name === 'string') : [];
}

/** Whether a picture has frames to make animations of: a sprite sheet or an animated PNG. */
export function hasFrames(row: Row | undefined): boolean {
  const p = row ? params(row) : {};
  return !!(p.sheet || p.apng);
}

/** A character's animation playing one of its picture's: the frames, duration and repeat are the picture's; mirroring stays the character's. */
export function playing(animation: Pick<CharacterAnimation, 'media_id' | 'flip'>, from: MediaAnimation): CharacterAnimation {
  const out: CharacterAnimation = { media_id: animation.media_id };
  if (from.frames?.length) out.frames = [...from.frames];
  if (from.duration && from.duration > 0) out.duration = from.duration;
  if (from.repeat != null) out.repeat = from.repeat;
  if (animation.flip) out.flip = true;
  out.sheet_animation = from.name;
  return out;
}

/** A name for a new animation of a picture, made for a character's: "stand" and "walk" for the poses, else the same name; free on the picture. */
export function freeAnimationName(row: Row | undefined, wanted: string): string {
  const base = wanted.startsWith('stand_') ? 'stand' : wanted.startsWith('walk_') ? 'walk' : wanted === 'portrait' ? 'portrait' : wanted;
  const taken = new Set(pictureAnimations(row).map((a) => a.name));
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 28)}_${n}`;
  return name;
}

/** The picture's animation a character's of this name plays when the picture is first chosen: one named for it, if there is one. */
export function matchingAnimation(row: Row | undefined, name: string): MediaAnimation | undefined {
  const list = pictureAnimations(row);
  const way = name.endsWith('_left') ? 'left' : 'right';
  const wanted = name.startsWith('stand_') ? [name, 'stand', 'idle', `stand_${way === 'left' ? 'right' : 'left'}`]
    : name.startsWith('walk_') ? [name, 'walk', `walk_${way === 'left' ? 'right' : 'left'}`]
    : [name];
  for (const n of wanted) {
    const found = list.find((a) => a.name === n);
    if (found) return found;
  }
  return undefined;
}

/** The characters playing each of a picture's animations: by its name, the character and which of its animations. */
export function playersOf(store: Store, mediaId: number): Map<string, Array<{ row: Row; name: string }>> {
  const out = new Map<string, Array<{ row: Row; name: string }>>();
  for (const row of store.rows('characters')) {
    for (const [name, a] of Object.entries(storedAnimations(row) ?? {})) {
      if (a?.media_id !== mediaId || !a.sheet_animation) continue;
      const list = out.get(a.sheet_animation) ?? out.set(a.sheet_animation, []).get(a.sheet_animation)!;
      list.push({ row, name });
    }
  }
  return out;
}

/**
 * After a picture's animations change, the characters playing them take the change: new frames,
 * duration and repeat, and a new name for one renamed (`renames`, old name to new). One taken away
 * is left as it was, playing the frames it had, until another is chosen.
 */
export function syncPictureAnimations(store: Store, mediaId: number, renames: Record<string, string> = {}): void {
  const media = store.byId('media', mediaId);
  const list = pictureAnimations(media);
  for (const row of store.rows('characters')) {
    const stored = storedAnimations(row);
    if (!stored) continue;
    let changed = false;
    const next: Record<string, CharacterAnimation> = {};
    for (const [name, a] of Object.entries(stored)) {
      next[name] = a;
      if (a?.media_id !== mediaId || !a.sheet_animation) continue;
      const from = list.find((m) => m.name === (renames[a.sheet_animation!] ?? a.sheet_animation));
      if (!from) continue;
      const now = playing(a, from);
      if (JSON.stringify(now) !== JSON.stringify(a)) {
        next[name] = now;
        changed = true;
      }
    }
    if (changed) void store.patch('characters', row.id, { settings: { ...params(row, 'settings'), animations: next } }, true);
  }
}
