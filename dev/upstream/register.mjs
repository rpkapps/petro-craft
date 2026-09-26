// Node loader registration for the headless upstream test:
//   node --experimental-transform-types --no-warnings --import ./dev/upstream/register.mjs dev/upstream/sim.test.ts
import { register } from 'node:module';
register('./resolve-hooks.mjs', import.meta.url);
