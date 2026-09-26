// Simplified black-oil PVT correlations — accurate enough to feel right, cheap enough for every step.
import type { Reservoir } from '../../core/types';
import { K_TIGHT } from './tuning';
import { clamp } from './util';

/** Reservoir temperature in °Rankine. */
export const tempR = (r: Reservoir) => r.temperature * 1.8 + 32 + 460;

/** Gas deviation factor z(P) — smooth fit valid for ~0..8,000 psi. */
export function zFactor(p: number): number {
  const q = clamp(p, 0, 9000);
  return clamp(1 - 7e-5 * q + 1.2e-8 * q * q, 0.8, 1.15);
}

/** Gas formation volume factor in reservoir bbl per mcf. */
export function bg(p: number, tR: number): number {
  const pp = Math.max(100, p);
  return (5.04 * zFactor(pp) * tR) / pp;
}

/** Initial oil formation volume factor (rb/stb) from solution GOR. */
export const boi = (r: Reservoir) => clamp(1.04 + 0.00045 * Math.max(0, r.gasOilRatio), 1.02, 2.2);

/** Solution GOR (scf/stb) at pressure. */
export function rs(r: Reservoir, p: number): number {
  if (p >= r.bubblePoint || r.bubblePoint <= 0) return Math.max(0, r.gasOilRatio);
  return Math.max(0, r.gasOilRatio) * Math.pow(Math.max(0, p) / r.bubblePoint, 0.9);
}

/** Oil FVF at pressure (shrinks as gas leaves solution). */
export function bo(r: Reservoir, p: number): number {
  const b0 = boi(r);
  const rsi = Math.max(1, r.gasOilRatio);
  return 1 + (b0 - 1) * clamp(rs(r, p) / rsi, 0.2, 1);
}

/** Live-oil viscosity (cp) from API gravity and GOR. */
export function oilViscosity(r: Reservoir): number {
  const api = r.apiGravity > 0 ? r.apiGravity : 32;
  const dead = clamp(20 * Math.exp(-0.09 * (api - 15)), 0.4, 60);
  return clamp(dead / (1 + Math.max(0, r.gasOilRatio) / 400), 0.2, 60);
}

/**
 * Effective permeability for inflow. The huge natural range (0.001–2,000 mD) is compressed so both shale and
 * super-permeable sands stay playable: tight rock (< 10 mD) ∝ √k (natural fractures, desorption), conventional
 * rock ∝ k^0.6 (turbulence / near-well limits).
 */
export function effectivePerm(k: number): number {
  const r = Math.max(1e-6, k) / K_TIGHT;
  return K_TIGHT * (k >= K_TIGHT ? Math.pow(r, 0.6) : Math.sqrt(r));
}

/** Tight-rock flag (shale plays or sub-millidarcy rock). */
export const isTight = (r: Reservoir) => r.trap === 'shale_play' || r.permeability < 1;

/**
 * Near-well recharge ratio r: steady-state rate / initial rate = r / (1 + r).
 * Tight rock recharges slowly (steep decline to a low tail); conventional rock stays near reservoir pressure.
 */
export function rechargeRatio(k: number): number {
  const t = clamp(Math.log10(Math.max(1e-4, k) / 0.1) / 3, 0, 1);
  return 0.14 + 40 * t * t;
}

/** Condensate / liquid yield (bbl per mcf) of a gas or condensate reservoir at initial conditions. */
export function liquidYield(r: Reservoir): number {
  if (r.fluid === 'condensate') return clamp(1000 / Math.max(2000, r.gasOilRatio || 8000), 0.01, 0.3);
  if (r.fluid === 'gas') return r.gasOilRatio > 0 ? clamp(200 / r.gasOilRatio, 0.001, 0.015) : 0.004;
  return 0;
}

/** Newton solve of p from p/z. */
export function pressureFromPz(pz: number, guess: number): number {
  let p = Math.max(50, guess);
  for (let i = 0; i < 6; i++) {
    const z = zFactor(p);
    const dz = -7e-5 + 2.4e-8 * p;
    const f = p / z - pz;
    const df = (z - p * dz) / (z * z);
    const next = p - f / df;
    if (!Number.isFinite(next)) break;
    p = clamp(next, 10, 12000);
    if (Math.abs(f) < 0.5) break;
  }
  return p;
}
