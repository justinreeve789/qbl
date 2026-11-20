/**
 * Animated PNGs in the editor. An <img> plays one by itself, but to show its frames one by one
 * (for picking which a character's animation uses, and for previews of those) the file is cut
 * into a strip of frames here, drawn over one another as the file says. The reading is
 * @qbl/shared's, the same the game uses.
 */
import { apngFrameImages, readApng } from '@qbl/shared';

/** An animated PNG laid out as a sprite sheet: a picture of its frames in a grid, and their timing. */
export interface ApngSheet { blob: Blob; columns: number; rows: number; count: number; duration: number; delays: number[]; frameWidth: number; frameHeight: number }

/** Lay an animated PNG's frames out as a sprite sheet. Null if the file is not an animated PNG. */
export async function apngToSheet(buffer: ArrayBuffer): Promise<ApngSheet | null> {
  const file = readApng(buffer);
  if (!file || file.frames.length < 2) return null;
  const { width, height, frames } = file;
  const columns = Math.ceil(Math.sqrt(frames.length));
  const rows = Math.ceil(frames.length / columns);
  const stage = document.createElement('canvas');
  stage.width = width;
  stage.height = height;
  const sheet = document.createElement('canvas');
  sheet.width = width * columns;
  sheet.height = height * rows;
  const draw = stage.getContext('2d')!;
  const out = sheet.getContext('2d')!;
  const images = apngFrameImages(file);

  for (const [i, frame] of frames.entries()) {
    const picture = await createImageBitmap(new Blob([images[i]! as BlobPart], { type: 'image/png' }));
    const before = frame.dispose === 2 ? draw.getImageData(0, 0, width, height) : null;
    if (frame.blend === 0) draw.clearRect(frame.x, frame.y, frame.width, frame.height);
    draw.drawImage(picture, frame.x, frame.y);
    picture.close();
    out.drawImage(stage, (i % columns) * width, Math.floor(i / columns) * height);
    // What the next frame is drawn over: this one, nothing where this one was, or what was there before it.
    if (frame.dispose === 1) draw.clearRect(frame.x, frame.y, frame.width, frame.height);
    else if (before) draw.putImageData(before, 0, 0);
  }
  const blob = await new Promise<Blob | null>((resolve) => sheet.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const delays = frames.map((f) => f.delay);
  return { blob, columns, rows, count: frames.length, duration: delays.reduce((a, b) => a + b, 0), delays, frameWidth: width, frameHeight: height };
}

/** An animated PNG's frames as a sheet at an address of its own, made once per file. */
const strips = new Map<string, Promise<{ url: string; columns: number; rows: number; count: number; delays: number[] } | null>>();

export function apngStrip(url: string): Promise<{ url: string; columns: number; rows: number; count: number; delays: number[] } | null> {
  let strip = strips.get(url);
  if (!strip) {
    strip = fetch(url)
      .then((r) => r.arrayBuffer())
      .then(apngToSheet)
      .then((s) => (s ? { url: URL.createObjectURL(s.blob), columns: s.columns, rows: s.rows, count: s.count, delays: s.delays } : null))
      .catch(() => null);
    strips.set(url, strip);
  }
  return strip;
}
