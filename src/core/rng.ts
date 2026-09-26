// Deterministic PRNG utilities (mulberry32) and hashing helpers.

/** Stateless mulberry32 step: returns [value in [0,1), nextState]. */
export function mulberry32Step(state: number): [number, number] {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, a];
}

/** Returns a closure RNG seeded with `seed` (for world generation etc.). */
export function makeRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    const [v, n] = mulberry32Step(s);
    s = n;
    return v;
  };
}

/** Integer hash of up to 4 ints → uint32. Good for per-block/per-column deterministic noise. */
export function hash4(a: number, b = 0, c = 0, d = 0): number {
  let h = 0x811c9dc5 ^ a;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h ^= b + 0x9e3779b9 + (h << 6) + (h >>> 2);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= c + 0x9e3779b9 + (h << 6) + (h >>> 2);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h ^= d + 0x9e3779b9 + (h << 6) + (h >>> 2);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash → float in [0,1). */
export const hashFloat = (a: number, b = 0, c = 0, d = 0) => hash4(a, b, c, d) / 4294967296;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
