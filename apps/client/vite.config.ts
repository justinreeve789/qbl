import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Connect, type Plugin } from 'vite';

/**
 * Two pages are built:
 *
 *   index.html   the marketing site, at "/" only. Plain HTML and Tailwind; no game code.
 *   play.html    the game, for every other address: /missions, /{code}, /play?preview=…
 *
 * In production Apache does this (DirectoryIndex index.html, FallbackResource /play.html).
 * The plugin below does the same for `vite` and `vite preview`, so development matches.
 */
function gameFallback(): Plugin {
  // Paths that are files or that the proxy below handles are left alone.
  const passThrough = /^\/(@|src\/|node_modules\/|assets\/|api(\/|$)|game(\/|$)|media\/|scenario-assets\/|editor(\/|$)|docs(\/|$))/;
  const rewrite: Connect.NextHandleFunction = (req, _res, next) => {
    const [path, query = ''] = (req.url ?? '/').split(/\?(.*)/s, 2);
    const wantsHtml = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html');
    if (wantsHtml && path !== '/' && path !== '/index.html' && !passThrough.test(path!) && !/\.[a-z0-9]+$/i.test(path!)) {
      req.url = `/play.html${query ? `?${query}` : ''}`;
    }
    next();
  };
  return {
    name: 'qbl-game-fallback',
    configureServer: (server) => void server.middlewares.use(rewrite),
    configurePreviewServer: (server) => void server.middlewares.use(rewrite),
  };
}

/**
 * Two ways to run the game in development:
 *
 *   npm run dev          the game and the game server (file backend). The game server also serves
 *                        the API and scenario media, so everything is proxied to it.
 *   npm run dev:editor   "authoring" mode, for working on the editor: the API is the PHP dev
 *                        server (apps/api/dev/server.php) and the editor is proxied under /editor/,
 *                        so the game and the editor share an address and a sign-in as they do
 *                        in production. Open http://localhost:5173/editor/.
 *
 * Either way the browser only ever talks to one origin.
 */
export default defineConfig(({ mode }) => {
  const authoring = mode === 'authoring';
  const server = process.env.QBL_SERVER_ORIGIN ?? 'http://localhost:2567';
  const api = process.env.QBL_API_ORIGIN ?? (authoring ? 'http://127.0.0.1:8000' : server);
  const editor = process.env.QBL_EDITOR_ORIGIN ?? 'http://localhost:5174';

  return {
    // Multi-page: no single-page fallback to index.html (the marketing page); gameFallback() decides.
    appType: 'mpa',
    plugins: [tailwindcss(), gameFallback()],
    resolve: {
      // Use the shared package's TypeScript source directly: no build step, instant reloads.
      alias: { '@qbl/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
    },
    server: {
      host: true,
      port: 5173,
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/scenario-assets': { target: authoring ? api : server, changeOrigin: true },
        '/game': { target: server, changeOrigin: true, ws: true, rewrite: (p: string) => p.replace(/^\/game/, '') },
        ...(authoring
          ? {
              '/media': { target: api, changeOrigin: true },
              '/editor': { target: editor, changeOrigin: true, ws: true },
            }
          : {}),
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
      chunkSizeWarningLimit: 2500,
      rollupOptions: {
        input: {
          site: fileURLToPath(new URL('index.html', import.meta.url)),
          play: fileURLToPath(new URL('play.html', import.meta.url)),
        },
      },
    },
  };
});
