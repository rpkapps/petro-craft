// Dev server config for long headless entity/game tests: no HMR and no file watching, so concurrent
// edits elsewhere in the repo don't reload the page mid-test. Usage: npx vite --config dev/entities/vite.nohmr.config.mjs --port 5231
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
export default defineConfig({
  root,
  resolve: { alias: { '@': resolve(root, 'src') } },
  server: { host: true, hmr: false, watch: { ignored: ['**/*'] } },
  worker: { format: 'es' },
});
