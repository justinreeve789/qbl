import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * The editor is served under /editor/, in production (its own container, behind Apache) and in
 * development. `npm run dev:editor` at the repository root starts this, the PHP dev API and the
 * game together; open http://localhost:5173/editor/ so the editor and the game share an address
 * and a sign-in, as they do in production. Opened directly on port 5174 it works too, with the
 * API proxied below, but "Test this scene" then needs VITE_GAME_URL=http://localhost:5173/.
 */
const api = process.env.QBL_API_ORIGIN ?? 'http://127.0.0.1:8000';

export default defineConfig({
  base: '/editor/',
  resolve: {
    alias: [
      { find: /^@qbl\/shared\/formula$/, replacement: fileURLToPath(new URL('../../packages/shared/src/formula.ts', import.meta.url)) },
      { find: /^@qbl\/shared$/, replacement: fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
    ],
  },
  server: {
    host: true,
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: true },
      '/media': { target: api, changeOrigin: true },
      '/scenario-assets': { target: api, changeOrigin: true },
    },
  },
  build: { target: 'es2022', sourcemap: true },
});
