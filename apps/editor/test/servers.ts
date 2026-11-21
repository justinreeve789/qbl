import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { build } from 'esbuild';

const repo = fileURLToPath(new URL('../../../', import.meta.url));

export interface TestSite {
  /** Address of the site: the editor is at `${url}/editor/`. */
  url: string;
  close(): Promise<void>;
}

/**
 * Everything the editor needs, on one address, as in production (`env`: more for the dev API, such
 * as QBL_TTS_URL):
 *   /editor/                 the editor, bundled from source
 *   /api, /media, ...        the dev API (apps/api/dev/server.php): the same PHP classes Laravel uses, over SQLite
 */
export async function startSite(env: Record<string, string> = {}): Promise<TestSite> {
  const data = mkdtempSync(join(tmpdir(), 'qbl-editor-test-'));
  const dist = join(data, 'dist');
  await build({
    entryPoints: [join(repo, 'apps/editor/src/main.ts')],
    bundle: true,
    format: 'esm',
    target: 'es2022',
    outdir: dist,
    alias: { '@qbl/shared': join(repo, 'packages/shared/src/index.ts') },
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
  });
  const page = '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>QuestLab</title><link rel="stylesheet" href="/editor/main.css"></head><body><div id="app"></div><script type="module" src="/editor/main.js"></script></body></html>';

  const apiPort = await freePort();
  const php = spawn('php', ['-S', `127.0.0.1:${apiPort}`, join(repo, 'apps/api/dev/server.php')], { env: { ...process.env, QBL_DEV_DATA: join(data, 'api'), ...env }, stdio: 'ignore' });
  await waitFor(`http://127.0.0.1:${apiPort}/api/me`);

  const types: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css' };
  const server = createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!;
    if (path === '/editor' || path === '/editor/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(page);
    } else if (/^\/editor\/main\.(js|css)$/.test(path)) {
      res.writeHead(200, { 'Content-Type': types[extname(path)] }).end(readFileSync(join(dist, path.slice('/editor/'.length))));
    } else {
      // Everything else belongs to the API server.
      const upstream = request({ host: '127.0.0.1', port: apiPort, path: req.url, method: req.method, headers: req.headers }, (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.pipe(res);
      });
      upstream.on('error', () => res.writeHead(502).end());
      req.pipe(upstream);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    async close() {
      await stop(server, php);
      rmSync(data, { recursive: true, force: true });
    },
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(url: string) {
  for (let i = 0; i < 100; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`Nothing answered at ${url}. Is PHP installed?`);
}

function stop(server: Server, php: ChildProcess): Promise<void> {
  php.kill();
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

/** A PNG of one flat color, built by hand so the tests need no image library. */
export function png(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type), body]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(typed));
    return Buffer.concat([head, typed, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8 bits per channel, RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, Buffer.from([r, g, b]))]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

/** A short silent WAV file. */
export function wav(seconds = 0.2): Buffer {
  const rate = 8000;
  const samples = Math.round(rate * seconds);
  const out = Buffer.alloc(44 + samples * 2);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + samples * 2, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(1, 22); // mono
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate * 2, 28);
  out.writeUInt16LE(2, 32);
  out.writeUInt16LE(16, 34);
  out.write('data', 36);
  out.writeUInt32LE(samples * 2, 40);
  return out;
}
