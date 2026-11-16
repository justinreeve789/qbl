/**
 * Animated PNGs. The game plays sprite sheets, so an animated PNG is turned into one when it is
 * uploaded: its frames are drawn out side by side, and one animation that plays them all at the
 * file's own speed is defined on the sheet. Nothing but the editor ever sees the original.
 *
 * The file is read here rather than by the browser's own decoder, which only gives the first
 * frame to a page (and its frame-by-frame decoder is not available on plain http).
 */
export interface ApngSheet { blob: Blob; columns: number; rows: number; count: number; duration: number; frameWidth: number; frameHeight: number }

interface Frame { width: number; height: number; x: number; y: number; delay: number; dispose: number; blend: number; data: Uint8Array[] }

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}

/** Read an animated PNG's frames. Null if the file is not a PNG or is not animated. */
export function readApng(buffer: ArrayBuffer): { width: number; height: number; header: Uint8Array; shared: Uint8Array[]; frames: Frame[] } | null {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(buffer);
  let header: Uint8Array | null = null;
  let animated = false;
  const shared: Uint8Array[] = [];
  const frames: Frame[] = [];
  let current: Frame | null = null;
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = data.slice();
    else if (type === 'acTL') animated = true;
    else if (type === 'fcTL') {
      const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const den = v.getUint16(22) || 100;
      current = { width: v.getUint32(4), height: v.getUint32(8), x: v.getUint32(12), y: v.getUint32(16), delay: Math.max(10, Math.round((v.getUint16(20) / den) * 1000) || 100), dispose: data[24]!, blend: data[25]!, data: [] };
      frames.push(current);
    } else if (type === 'IDAT') {
      // The default image is a frame only if a frame header came before it.
      current?.data.push(data);
    } else if (type === 'fdAT') current?.data.push(data.subarray(4));
    else if (type === 'IEND') break;
    // Palette, transparency, colour space: every frame needs them. They come before the first image data.
    else if (!frames.length || !frames[0]!.data.length) shared.push(bytes.slice(at, at + 12 + length));
    at += 12 + length;
  }
  if (!header || !animated || frames.length < 2) return null;
  const hv = new DataView(header.buffer);
  return { width: hv.getUint32(0), height: hv.getUint32(4), header, shared, frames: frames.filter((f) => f.data.length) };
}

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

  for (const [i, frame] of frames.entries()) {
    // Each frame is a small PNG of its own: the file's header with this frame's size, then its data.
    const head = file.header.slice();
    const hv = new DataView(head.buffer);
    hv.setUint32(0, frame.width);
    hv.setUint32(4, frame.height);
    const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', head), ...file.shared, ...frame.data.map((d) => chunk('IDAT', d)), chunk('IEND', new Uint8Array(0))];
    const picture = await createImageBitmap(new Blob(parts as BlobPart[], { type: 'image/png' }));
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
  return { blob, columns, rows, count: frames.length, duration: frames.reduce((sum, f) => sum + f.delay, 0), frameWidth: width, frameHeight: height };
}
