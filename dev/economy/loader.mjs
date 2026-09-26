// Node ESM resolve hook: lets `node --experimental-transform-types` run the Vite-style
// extensionless TypeScript imports used throughout src/ (./foo → ./foo.ts or ./foo/index.ts).
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && !/\.[cm]?[jt]s$/.test(specifier)) {
    for (const ext of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + ext, context);
      } catch {
        /* try next candidate */
      }
    }
  }
  return next(specifier, context);
}
