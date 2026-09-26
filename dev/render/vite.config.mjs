// Vite config for the render harness: same as the project config but without HMR / file-watch
// reloads, so screenshots are not interrupted while other modules are being edited.
// Usage (from the repo root): npx vite --config dev/render/vite.config.mjs --port 5202 --strictPort
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

export default defineConfig({
  root,
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: true, hmr: false },
  worker: { format: 'es' },
});
