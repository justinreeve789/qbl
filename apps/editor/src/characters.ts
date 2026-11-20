/**
 * Characters as the editor sees them: a `characters` row's animations, read the way the game
 * reads them (an older row's single picture and close-up become animations), and the pictures
 * those animations are drawn from. No DOM here but small, reusable previews.
 */
import {
  animationDuration, animationFrames, frameCount, normalizeNpc, resolvePose,
  type CharacterAnimation, type Media, type Npc,
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
