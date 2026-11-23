/**
 * Makes a walk from a standing picture, for `php artisan qbl:walk` (apps/api, WalkMaker): the same
 * six-frame walk the editor's "Make walk" button makes (src/walkCycle.ts), from the command line.
 *
 *   node packages/shared/bin/walk.ts --in standing.rgba --width 278 --height 511 --out walk.png [--stride 0.72]
 *
 * The standing picture comes in as raw pixels (RGBA, 4 bytes a pixel, row by row, facing right),
 * so the caller decodes whatever kind of image it has. The walk goes out as a PNG sprite sheet of
 * one row, and what was made is printed as JSON: whether the legs were used or the figure bobs
 * (and why), the frame size, and how the feet came out (checkFeet).
 *
 * Plain TypeScript with nothing to install: Node 22.18 and later run it as it is (it strips the
 * types), and older ones with `node --import tsx`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { checkFeet, sheetOf, walkCycle, WALK_DURATION, WALK_FRAMES, type Bitmap } from '../src/walkCycle.ts';

function option(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at > 0 ? process.argv[at + 1] : undefined;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** An RGBA PNG, each row with whichever filter leaves it smallest (as most encoders guess it). */
function png({ width, height, data }: Bitmap): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    let best: Buffer | null = null;
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let filter = 0; filter < 5; filter++) {
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const v = data[y * stride + x]!;
        const a = x >= 4 ? data[y * stride + x - 4]! : 0;
        const b = y ? data[(y - 1) * stride + x]! : 0;
        const c = x >= 4 && y ? data[(y - 1) * stride + x - 4]! : 0;
        let predicted = 0;
        if (filter === 1) predicted = a;
        else if (filter === 2) predicted = b;
        else if (filter === 3) predicted = (a + b) >> 1;
        else if (filter === 4) {
          const p = a + b - c;
          predicted = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        }
        const out = (v - predicted) & 255;
        row[x] = out;
        score += out < 128 ? out : 256 - out;
      }
      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best = Buffer.from(row);
      }
    }
    raw[y * (stride + 1)] = bestFilter;
    best!.copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, adaptive filtering, not interlaced
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const input = option('in');
const output = option('out');
const width = Number(option('width'));
const height = Number(option('height'));
const stride = option('stride') === undefined ? undefined : Number(option('stride'));
if (!input || !output || !(width > 0) || !(height > 0)) fail('Usage: walk.ts --in <raw RGBA> --width <px> --height <px> --out <sheet.png> [--stride 0.72]');
if (stride !== undefined && !(stride >= 0.3 && stride <= 1.2)) fail('--stride is a share of the leg\'s length, from 0.3 to 1.2 (0.72 by default).');

const pixels = readFileSync(input);
if (pixels.length !== width * height * 4) fail(`${input} has ${pixels.length} bytes; a ${width} × ${height} RGBA picture has ${width * height * 4}.`);
const cycle = walkCycle({ width, height, data: new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.length) }, stride === undefined ? {} : { stride });
writeFileSync(output, png(sheetOf(cycle)));
const feet = checkFeet(cycle);

process.stdout.write(`${JSON.stringify({
  mode: cycle.mode,
  why: cycle.why ?? null,
  frames: WALK_FRAMES,
  duration: WALK_DURATION,
  width: cycle.width,
  height: cycle.height,
  left: cycle.left,
  arms: cycle.rig?.arms.length ?? 0,
  feet: cycle.mode === 'legs' ? { ok: feet.ok, problems: feet.problems, step_share: Math.round(feet.stepShare * 1000) / 1000, together: feet.together.map((f) => f + 1), apart: feet.apart.map((f) => f + 1) } : null,
})}\n`);
