// Tileable noise for the procedural HD material painters (pure, worker-safe). Every function works on
// texture coordinates u, v in [0, 1) and tiles seamlessly because lattices wrap with an integer period.

const GRAD_N = 256;
const GX = new Float32Array(GRAD_N);
const GY = new Float32Array(GRAD_N);
for (let i = 0; i < GRAD_N; i++) {
  const a = (i / GRAD_N) * Math.PI * 2 + 0.37;
  GX[i] = Math.cos(a);
  GY[i] = Math.sin(a);
}

/** 32-bit integer hash of lattice coordinates and a seed → [0, 2^32). */
export function ihash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash → [0, 1). */
export const hash01 = (x: number, y: number, s: number) => ihash(x, y, s) / 4294967296;

const wrap = (i: number, p: number) => ((i % p) + p) % p;
const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Periodic gradient noise, period `p` lattice cells across the tile. Returns ≈ [-1, 1]. */
export function gnoise(u: number, v: number, p: number, seed: number): number {
  const x = u * p;
  const y = v * p;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = wrap(xi, p);
  const y0 = wrap(yi, p);
  const x1 = wrap(xi + 1, p);
  const y1 = wrap(yi + 1, p);
  const g00 = ihash(x0, y0, seed) & 255;
  const g10 = ihash(x1, y0, seed) & 255;
  const g01 = ihash(x0, y1, seed) & 255;
  const g11 = ihash(x1, y1, seed) & 255;
  const n00 = GX[g00] * fx + GY[g00] * fy;
  const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
  const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const sx = quintic(fx);
  const sy = quintic(fy);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return (a + (b - a) * sy) * 1.414;
}

/** Fractal gradient noise mapped to [0, 1]. */
export function fbm(u: number, v: number, p: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let per = p;
  for (let o = 0; o < oct; o++) {
    sum += gnoise(u, v, per, seed + o * 101) * amp;
    norm += amp;
    amp *= gain;
    per *= 2;
  }
  return Math.max(0, Math.min(1, (sum / norm) * 0.5 + 0.5));
}

/** Ridged multifractal in [0, 1] (sharp crests: cracks, veins, bark furrows). */
export function ridged(u: number, v: number, p: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let per = p;
  for (let o = 0; o < oct; o++) {
    const n = 1 - Math.abs(gnoise(u, v, per, seed + o * 131));
    sum += n * n * amp;
    norm += amp;
    amp *= gain;
    per *= 2;
  }
  return sum / norm;
}

/** Anisotropic periodic noise: independent periods along u and v (stretched grain, strata, bark). */
export function gnoise2(u: number, v: number, pu: number, pv: number, seed: number): number {
  const x = u * pu;
  const y = v * pv;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = wrap(xi, pu);
  const y0 = wrap(yi, pv);
  const x1 = wrap(xi + 1, pu);
  const y1 = wrap(yi + 1, pv);
  const g00 = ihash(x0, y0, seed) & 255;
  const g10 = ihash(x1, y0, seed) & 255;
  const g01 = ihash(x0, y1, seed) & 255;
  const g11 = ihash(x1, y1, seed) & 255;
  const n00 = GX[g00] * fx + GY[g00] * fy;
  const n10 = GX[g10] * (fx - 1) + GY[g10] * fy;
  const n01 = GX[g01] * fx + GY[g01] * (fy - 1);
  const n11 = GX[g11] * (fx - 1) + GY[g11] * (fy - 1);
  const sx = quintic(fx);
  const sy = quintic(fy);
  const a = n00 + (n10 - n00) * sx;
  const b = n01 + (n11 - n01) * sx;
  return (a + (b - a) * sy) * 1.414;
}

export function fbm2(u: number, v: number, pu: number, pv: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    const k = 1 << o;
    sum += gnoise2(u, v, pu * k, pv * k, seed + o * 97) * amp;
    norm += amp;
    amp *= gain;
  }
  return Math.max(0, Math.min(1, (sum / norm) * 0.5 + 0.5));
}

export interface Cell {
  /** Distance to the nearest / second nearest feature point (in cell units). */
  f1: number;
  f2: number;
  /** Stable random id of the nearest cell in [0, 1). */
  id: number;
  /** Offset from the pixel to the nearest feature point (cell units). */
  dx: number;
  dy: number;
}

/** Periodic Worley / Voronoi noise with `p` cells across the tile; `jitter` 0..1. */
export function worley(u: number, v: number, p: number, seed: number, out: Cell, jitter = 1): Cell {
  const x = u * p;
  const y = v * p;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 1e9;
  let f2 = 1e9;
  let id = 0;
  let bdx = 0;
  let bdy = 0;
  for (let j = -1; j <= 1; j++)
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i;
      const cy = yi + j;
      const wx = wrap(cx, p);
      const wy = wrap(cy, p);
      const h = ihash(wx, wy, seed);
      const px = cx + 0.5 + ((h & 0xffff) / 65536 - 0.5) * jitter;
      const py = cy + 0.5 + ((h >>> 16) / 65536 - 0.5) * jitter;
      const dx = px - x;
      const dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash01(wx, wy, seed + 7);
        bdx = dx;
        bdy = dy;
      } else if (d < f2) f2 = d;
    }
  out.f1 = f1;
  out.f2 = f2;
  out.id = id;
  out.dx = bdx;
  out.dy = bdy;
  return out;
}

/** Tileable domain warp: returns offsets in texture units. */
export function warp(u: number, v: number, p: number, amount: number, seed: number): [number, number] {
  return [(fbm(u, v, p, 3, seed) - 0.5) * amount, (fbm(u, v, p, 3, seed + 57) - 0.5) * amount];
}

/** Small deterministic PRNG (mulberry32) for scattering strokes/features. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
