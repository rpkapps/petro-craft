// Node loader shim for running the world module's TypeScript directly:
//   node --experimental-strip-types --import ./dev/world/register.mjs dev/world/test.ts
// Resolves extension-less relative imports ('../core/rng') to their .ts files.
import { register } from 'node:module';
register('./ts-resolve.mjs', import.meta.url);
