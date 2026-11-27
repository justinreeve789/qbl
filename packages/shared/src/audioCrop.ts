/**
 * Cropped sounds. An audio media can keep only part of its file: `params.crop` says where the part
 * that plays starts and ends, in seconds from the start of the file. The file itself is left as it
 * was, so a crop can be widened again or taken off. Everything that plays the sound (an Audio
 * action, scene music, a narrated line's recording, a sound in a box) plays only that part, and
 * a sound that loops loops that part.
 */

/** [ext] On an audio media's params: the part of the file that plays, in seconds. */
export interface AudioCrop {
  /** Where it starts. Default 0, the start of the file. */
  start?: number;
  /** Where it ends. Default the end of the file. */
  end?: number;
}

/** A crop made sense of: `end` is null for "to the end of the file". */
export interface CropRange {
  start: number;
  end: number | null;
}

/** Shortest part a crop keeps, in seconds. */
export const MIN_CROP_SECONDS = 0.05;

const seconds = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * The part of an audio media that plays, or null when it plays all of its file (no crop, or a crop
 * that keeps everything, or one that makes no sense, such as an end before its start).
 */
export function audioCrop(media: object | null | undefined): CropRange | null {
  const m = media as { type?: unknown; params?: unknown } | null | undefined;
  if (!m || (m.type !== undefined && m.type !== 'audio')) return null;
  // The editor's rows can hold params as the JSON the database keeps.
  let p = m.params;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch {
      return null;
    }
  }
  const crop = (p as { crop?: unknown } | null | undefined)?.crop as AudioCrop | null | undefined;
  if (!crop || typeof crop !== 'object') return null;
  const start = seconds(crop.start) ?? 0;
  const end = seconds(crop.end);
  if (end !== null && end - start < MIN_CROP_SECONDS) return null;
  if (start === 0 && end === null) return null;
  return { start: round(start), end: end === null ? null : round(end) };
}

/** How long the part that plays lasts, given the length of the whole file (seconds). */
export function croppedLength(crop: CropRange | null, full: number): number {
  if (!crop) return full;
  const end = crop.end === null ? full : Math.min(crop.end, full);
  return Math.max(0, end - Math.min(crop.start, full));
}

/**
 * A crop to keep on the media, from a start and an end chosen against the file's length: null
 * when it keeps the whole file. Values are clamped to the file and to each other, and rounded to
 * hundredths of a second; an end at the file's end is left out, so it stays "to the end".
 */
export function makeCrop(start: number, end: number, full: number): AudioCrop | null {
  const length = Number.isFinite(full) && full > 0 ? full : Math.max(start, end);
  let s = Math.min(Math.max(0, start), length);
  let e = Math.min(Math.max(0, end), length);
  if (e < s) [s, e] = [e, s];
  if (e - s < MIN_CROP_SECONDS) {
    e = Math.min(length, s + MIN_CROP_SECONDS);
    s = Math.max(0, e - MIN_CROP_SECONDS);
  }
  s = round(s);
  e = round(e);
  const toEnd = length - e < 0.005;
  if (s === 0 && toEnd) return null;
  return toEnd ? { start: s } : s === 0 ? { end: e } : { start: s, end: e };
}

/** A media fragment (`#t=start,end`) for an `<audio>` element's address, so the browser plays only the part kept. */
export function cropFragment(crop: CropRange | null): string {
  if (!crop) return '';
  return crop.end === null ? `#t=${crop.start}` : `#t=${crop.start},${crop.end}`;
}

/** "0:03.5": a time in seconds as a person reads it, to a tenth of a second. */
export function cropClock(s: number): string {
  const tenths = Math.round(Math.max(0, s) * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
