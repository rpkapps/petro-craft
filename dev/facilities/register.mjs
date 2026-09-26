// Node loader registration for headless facilities tests:
//   node --experimental-transform-types --no-warnings --import ./dev/facilities/register.mjs dev/facilities/sim.test.ts
import { register } from 'node:module';
register('./resolve-hooks.mjs', import.meta.url);
