// Resolve extension-less relative imports ('../core/rng', '../../src/world') to .ts files or index.ts.
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    if (!(specifier.startsWith('.') || specifier.startsWith('/')) || /\.[cm]?[jt]s$/.test(specifier)) throw err;
    try {
      return await next(`${specifier}.ts`, context);
    } catch {
      return next(`${specifier}/index.ts`, context);
    }
  }
}
