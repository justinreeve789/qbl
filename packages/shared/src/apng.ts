/**
 * Animated PNGs, read byte by byte. Browsers animate an animated PNG in an <img>, but hand only
 * its first frame to a canvas or to the game, so the game and the editor cut the file into its
 * frames themselves: this reads them, and `apngFrameImages` turns each into a small PNG of its
 * own that a browser can decode. Drawing the frames over one another (as the file says to) is
 * left to the caller, which has a canvas.
 */

export interface ApngFrame {
  width: number;
  height: number;
  x: number;
  y: number;
  /** Milliseconds the frame is shown. */
  delay: number;
  /** After the frame: 0 leave it, 1 clear its area, 2 put back what was there before it. */
  dispose: number;
  /** 0 replaces what is under the frame, 1 draws over it. */
  blend: number;
  data: Uint8Array[];
}

export interface ApngFile {
  width: number;
  height: number;
  /** How many times to play: 0 is forever. */
  plays: number;
  header: Uint8Array;
  /** Chunks every frame needs: palette, transparency, colour space. */
  shared: Uint8Array[];
  frames: ApngFrame[];
}

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
export function readApng(buffer: ArrayBuffer | Uint8Array): ApngFile | null {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (bytes.length < 33 || SIGNATURE.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let header: Uint8Array | null = null;
  let animated = false;
  let plays = 0;
  const shared: Uint8Array[] = [];
  const frames: ApngFrame[] = [];
  let current: ApngFrame | null = null;
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4]!, bytes[at + 5]!, bytes[at + 6]!, bytes[at + 7]!);
    const data = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = data.slice();
    else if (type === 'acTL') {
      animated = true;
      if (data.length >= 8) plays = new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4);
    } else if (type === 'fcTL' && data.length >= 26) {
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
  const withData = frames.filter((f) => f.data.length);
  if (!header || !animated || withData.length < 2) return null;
  const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
  return { width: hv.getUint32(0), height: hv.getUint32(4), plays, header, shared, frames: withData };
}

/** How many frames, and how long one pass takes. Null if the file is not an animated PNG. */
export function apngInfo(buffer: ArrayBuffer | Uint8Array): { frames: number; duration: number; plays: number; width: number; height: number } | null {
  const file = readApng(buffer);
  if (!file) return null;
  return { frames: file.frames.length, duration: file.frames.reduce((sum, f) => sum + f.delay, 0), plays: file.plays, width: file.width, height: file.height };
}

/** Each frame as a PNG file of its own: the file's header with the frame's size, then its data. */
export function apngFrameImages(file: ApngFile): Uint8Array[] {
  return file.frames.map((frame) => {
    const head = file.header.slice();
    const hv = new DataView(head.buffer);
    hv.setUint32(0, frame.width);
    hv.setUint32(4, frame.height);
    const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', head), ...file.shared, ...frame.data.map((d) => chunk('IDAT', d)), chunk('IEND', new Uint8Array(0))];
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  });
}
