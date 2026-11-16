import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

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
    build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 2500 },
  };
});
