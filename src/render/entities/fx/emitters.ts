// Particle emitter presets. All functions are allocation-free: they spawn a stochastic number of
// particles for this frame (rate × dt × quality) into the shared ParticleSystem.
import { PK, rgb, type ParticleSystem, type RGB } from './ParticleSystem';

export const COL = {
  WHITE: rgb(0xffffff),
  FIRE: rgb(0xffffff),
  SMOKE_DARK: rgb(0x2a2724),
  SMOKE_MID: rgb(0x55514d),
  SMOKE_LIGHT: rgb(0x9a968f),
  STEAM: rgb(0xeef0f2),
  OIL: rgb(0x1a120b),
  OIL_MIST: rgb(0x3b2b1e),
  OIL_DROP: rgb(0x3a2614),
  MUD: rgb(0x6b4f36),
  WATER: rgb(0xb8d8ea),
  PRODUCT: rgb(0xd9a13a),
  GAS: rgb(0xd8dde2),
  GAS_DIRTY: rgb(0xb9b1a5),
  DUST: rgb(0xb59a72),
  FOAM: rgb(0xf6f8fa),
  EXHAUST: rgb(0x3a3a3a),
  SPARK: rgb(0xffffff),
  GLOW_FIRE: rgb(0xff8a3a),
  GLOW_WHITE: rgb(0xfff2d8),
  RAIN_SPLASH: rgb(0xcfe2f0),
} as const;

const rnd = Math.random;
const sr = (a: number) => (rnd() - 0.5) * 2 * a;

/** Stochastic particle count for a rate (per second). */
export function count(rate: number, dt: number): number {
  const x = rate * dt;
  const n = Math.floor(x);
  return n + (rnd() < x - n ? 1 : 0);
}

/** Flames over a disc of radius r (intensity 0..1). */
export function flames(ps: ParticleSystem, x: number, y: number, z: number, r: number, intensity: number, dt: number, q: number, height = 1): void {
  const n = count((18 + 50 * r) * intensity * q, dt);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * r;
    const s = (0.5 + rnd() * 0.7) * (0.6 + r * 0.45) * (0.6 + intensity * 0.6);
    ps.emit(PK.FIRE, x + Math.cos(a) * d, y + rnd() * 0.3, z + Math.sin(a) * d, sr(0.5), (1.6 + rnd() * 2.2) * height, sr(0.5), 0.55 + rnd() * 0.6, s, s * 0.35, COL.FIRE, 0.9, 2.5 * height, 1.1, 0.5, sr(1.5));
  }
  if (rnd() < dt * 6 * intensity * q) ps.emit(PK.SPARK, x + sr(r), y + 0.5, z + sr(r), sr(1.5), 3 + rnd() * 4, sr(1.5), 1 + rnd(), 0.06, 0.03, COL.SPARK, 1, -3, 0.6, 0.7);
}

/** Rising smoke column. dark: 0 (grey) .. 1 (black). */
export function smoke(ps: ParticleSystem, x: number, y: number, z: number, r: number, density: number, dark: number, dt: number, q: number, rise = 1): void {
  const n = count(4 * density * q * (0.5 + r), dt);
  for (let i = 0; i < n; i++) {
    // mix shades for depth: dark smoke carries some mid-grey puffs
    const k = dark - rnd() * 0.45;
    const c: RGB = k > 0.45 ? COL.SMOKE_DARK : k > 0.1 ? COL.SMOKE_MID : COL.SMOKE_LIGHT;
    const s = (0.8 + rnd() * 0.7) * (0.6 + r);
    ps.emit(PK.SMOKE, x + sr(r * 0.6), y, z + sr(r * 0.6), sr(0.3), (1.2 + rnd() * 1.2) * rise, sr(0.3), 6 + rnd() * 5, s, s * (3.2 + rnd() * 1.8), c, 0.34 + dark * 0.22, 0.35 * rise, 0.35, 0.9, sr(0.4));
  }
}

/** White steam / vapour plume. */
export function steam(ps: ParticleSystem, x: number, y: number, z: number, r: number, density: number, dt: number, q: number): void {
  const n = count(5 * density * q * (0.5 + r), dt);
  for (let i = 0; i < n; i++) {
    const s = (0.6 + rnd() * 0.5) * (0.5 + r);
    ps.emit(PK.STEAM, x + sr(r * 0.4), y, z + sr(r * 0.4), sr(0.2), 1.6 + rnd() * 1.2, sr(0.2), 3 + rnd() * 2.5, s, s * 3.5, COL.STEAM, 0.42, 0.4, 0.4, 0.8, sr(0.3));
  }
}

/** Diesel exhaust puffs. */
export function exhaust(ps: ParticleSystem, x: number, y: number, z: number, rate: number, dt: number, q: number): void {
  const n = count(rate * q, dt);
  for (let i = 0; i < n; i++) ps.emit(PK.SMOKE, x + sr(0.05), y, z + sr(0.05), sr(0.2), 1.8 + rnd(), sr(0.2), 1.6 + rnd() * 1.4, 0.18, 1.1, COL.EXHAUST, 0.45, 0.3, 0.8, 0.9, sr(1));
}

/** Gas flare flame at a tip; act 0..1 scales size. */
export function flare(ps: ParticleSystem, x: number, y: number, z: number, act: number, dt: number, q: number, scale = 1): void {
  if (act <= 0.01) return;
  const sz = (0.6 + act * 1.9) * scale;
  const n = count((22 + 40 * act) * Math.max(0.5, q), dt);
  for (let i = 0; i < n; i++) {
    const s = sz * (0.6 + rnd() * 0.6);
    ps.emit(PK.FIRE, x + sr(0.15 * scale), y + rnd() * 0.2, z + sr(0.15 * scale), sr(0.4), (2.5 + act * 4) * scale, sr(0.4), 0.45 + rnd() * 0.35, s, s * 0.45, COL.FIRE, 0.95, 2.5, 1.2, 0.9, sr(2));
  }
  if (rnd() < dt * 4) ps.emit(PK.GLOW, x, y + sz * 0.8, z, 0, 0.5, 0, 0.5, sz * 3.2, sz * 3.5, COL.GLOW_FIRE, 0.28, 0, 1, 0.3);
  if (act > 0.6) smoke(ps, x, y + sz * 2.2, z, 0.3 * scale, (act - 0.6) * 2, 0.8, dt, q);
}

/** Burst of sparks (electrical faults, grinding, explosions). */
export function sparks(ps: ParticleSystem, x: number, y: number, z: number, n: number, speed = 5): void {
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const up = rnd();
    ps.emit(PK.SPARK, x, y, z, Math.cos(a) * speed * (0.3 + rnd()), speed * (0.2 + up), Math.sin(a) * speed * (0.3 + rnd()), 0.4 + rnd() * 0.7, 0.05, 0.02, COL.SPARK, 1, -9.8, 0.4, 0);
  }
  ps.emit(PK.GLOW, x, y, z, 0, 0, 0, 0.18, 1.2, 1.6, COL.GLOW_WHITE, 0.7, 0, 1, 0);
}

/** Liquid jet from a point in direction (dx,dy,dz) (normalised), e.g. pipe leak. */
export function jet(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, col: RGB, rate: number, dt: number, q: number, spread = 0.15, size = 0.12): void {
  const n = count(rate * q, dt);
  for (let i = 0; i < n; i++) {
    const v = speed * (0.75 + rnd() * 0.5);
    ps.emit(PK.DROP, x, y, z, (dx + sr(spread)) * v, (dy + sr(spread)) * v, (dz + sr(spread)) * v, 1 + rnd() * 0.8, size, size * 1.6, col, 0.9, -9.8, 0.2, 0.2);
  }
}

/** Gas / vapour jet (fast, widening, transparent). */
export function gasJet(ps: ParticleSystem, x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, rate: number, dt: number, q: number, col: RGB = COL.GAS): void {
  const n = count(rate * q, dt);
  for (let i = 0; i < n; i++) {
    const v = speed * (0.7 + rnd() * 0.6);
    ps.emit(PK.STEAM, x, y, z, (dx + sr(0.25)) * v, (dy + sr(0.25)) * v, (dz + sr(0.25)) * v, 1.2 + rnd(), 0.15, 2.2, col, 0.3, 1, 2.2, 1, sr(1));
  }
}

/** Ring of dust kicked up along the ground (vibroseis thump, vehicles). */
export function dustRing(ps: ParticleSystem, x: number, y: number, z: number, n: number, speed = 3, col: RGB = COL.DUST): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.3;
    ps.emit(PK.DUST, x + Math.cos(a) * 0.4, y + 0.1, z + Math.sin(a) * 0.4, Math.cos(a) * speed, 0.3 + rnd() * 0.6, Math.sin(a) * speed, 1.6 + rnd(), 0.4, 1.8, col, 0.45, -0.2, 2.2, 0.4, sr(1));
  }
}

/** Low drifting dust over an area. */
export function dust(ps: ParticleSystem, x: number, y: number, z: number, r: number, rate: number, dt: number, q: number, col: RGB = COL.DUST): void {
  const n = count(rate * q, dt);
  for (let i = 0; i < n; i++)
    ps.emit(PK.DUST, x + sr(r), y + rnd() * 0.3, z + sr(r), sr(0.6), 0.2 + rnd() * 0.5, sr(0.6), 2.5 + rnd() * 2, 0.5, 2.4, col, 0.3, 0, 0.8, 1, sr(0.5));
}
