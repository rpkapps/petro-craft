// Seeded noise helpers shared by terrain & geology generation.
// All noise is created from deterministic PRNG streams so the whole world is a pure function of (seed, size).
import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import { hash4, makeRng } from '../core/rng';

export type Noise2 = NoiseFunction2D;

/** Derive an independent 32-bit stream seed from the world seed and a salt. */
export function subSeed(seed: number, salt: number): number {
  return hash4(seed | 0, salt | 0, 0x5eed, 0x77) | 0;
}

/** Seeded simplex 2D noise in [-1, 1]. */
export function noise2(seed: number, salt: number): Noise2 {
  return createNoise2D(makeRng(subSeed(seed, salt)));
}

/** Fractal Brownian motion, normalised to roughly [-1, 1]. */
export function fbm(n: Noise2, x: number, z: number, octaves: number, lacunarity = 2.03, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * freq + i * 31.7, z * freq - i * 17.3);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1] (sharp crests at 1). */
export function ridged(n: Noise2, x: number, z: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    let v = 1 - Math.abs(n(x * freq + i * 13.1, z * freq + i * 7.9));
    v *= v;
    v *= weight;
    weight = Math.min(1, v * 1.6);
    sum += v * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum / norm;
}

/** Hash of integer coords → float in [0,1). Seeded. */
export function hash01(seed: number, a: number, b: number, c = 0): number {
  return hash4(seed, a, b, c) / 4294967296;
}

/** Gaussian-ish random in [-1,1] from an rng (sum of uniforms). */
export function randSym(rng: () => number): number {
  return (rng() + rng() + rng() - 1.5) / 1.5;
}

export function randRange(rng: () => number, lo: number, hi: number): number {
  return lo + (hi - lo) * rng();
}

export function randInt(rng: () => number, lo: number, hiInclusive: number): number {
  return lo + Math.floor(rng() * (hiInclusive - lo + 1));
}

export function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/** Deterministic Fisher–Yates shuffle (returns a copy). */
export function shuffled<T>(rng: () => number, arr: readonly T[]): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i];
    out[i] = out[j];
    out[j] = t;
  }
  return out;
}
