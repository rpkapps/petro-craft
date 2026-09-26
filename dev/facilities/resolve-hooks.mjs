// Resolve extension-less relative imports (bundler-style, as used in src/) to .ts files.
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('./') || specifier.startsWith('../')) && !/\.(m?[jt]s|json)$/.test(specifier)) {
    for (const suffix of ['.ts', '/index.ts']) {
      try {
        return await next(specifier + suffix, context);
      } catch {
        /* try next */
      }
    }
  }
  return next(specifier, context);
}
