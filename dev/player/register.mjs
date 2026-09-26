// Node loader hook for unit tests: resolves extensionless relative imports to .ts files
// (run with: node --experimental-strip-types --import ./dev/player/register.mjs dev/player/unit.test.mjs).
import { registerHooks } from 'node:module';

registerHooks({
  resolve(specifier, context, next) {
    if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[mc]?[jt]s$/.test(specifier)) {
      for (const ext of ['.ts', '/index.ts']) {
        try {
          return next(specifier + ext, context);
        } catch {
          /* try next */
        }
      }
    }
    return next(specifier, context);
  },
});
