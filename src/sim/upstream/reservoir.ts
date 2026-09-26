// Reservoir "tank" model (material balance) — one pressure per reservoir, numerically stable for large steps.
//
// Oil: P_new = (P·C + dt·(inj − void) + dt·a·Pi) / (C + dt·a), C = N·Boi·ce(P) (+ gas-cap term), a = aquifer
//      productivity. Implicit in the aquifer term, per-substep change limited to 15 %.
// Gas / condensate: p/z = (pi/zi)·(1 − Gp/G) / (1 − We/(G·Bgi)), solved for p by Newton iteration.
import type { GameContext, Reservoir, ReservoirState } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { bg, boi, isTight, liquidYield, pressureFromPz, tempR, zFactor, bo, rs as rsAt } from './pvt';
import {
  AQUIFER_TAU_DAYS, GAS_CAP_RATIO, MCF_PER_TONNE_CO2, MIN_RESERVOIR_PSI, SAT_COMPRESSIBILITY, UNDERSAT_COMPRESSIBILITY,
} from './tuning';
import { clamp, lerp, smooth01 } from './util';
import { rx, type ResContact } from './wellData';

export interface ResDerived {
  boi: number;
  tR: number;
  /** Stock-tank in-place volumes (guarded minimums). */
  N: number;
  G: number;
  bgi: number;
  pzi: number;
  /** Tank capacity at initial conditions (rb/psi) and aquifer productivity (rb/day/psi). */
  cI: number;
  aq: number;
  tight: boolean;
  liquidYield: number;
}

const derivedCache = new WeakMap<Reservoir, ResDerived>();

export function derived(R: Reservoir): ResDerived {
  let d = derivedCache.get(R);
  if (d) return d;
  const tR = tempR(R);
  const b0 = boi(R);
  const N = Math.max(1_000, R.oilInPlace || 0);
  const G = Math.max(10_000, R.gasInPlace || 0);
  const bgi = bg(R.initialPressure, tR);
  const isOil = R.fluid === 'oil';
  const cI = isOil ? N * b0 * UNDERSAT_COMPRESSIBILITY : (G * bgi) / Math.max(200, R.initialPressure);
  const aq = (clamp(R.waterDrive, 0, 1) * cI * 2) / AQUIFER_TAU_DAYS;
  d = { boi: b0, tR, N, G, bgi, pzi: R.initialPressure / zFactor(R.initialPressure), cI, aq, tight: isTight(R), liquidYield: liquidYield(R) };
  derivedCache.set(R, d);
  return d;
}

/** Create the dynamic state for a reservoir. */
export function createReservoirState(ctx: GameContext, R: Reservoir): ReservoirState {
  const s: ReservoirState = {
    id: R.id, discovered: false, knowledge: 0, pressure: R.initialPressure,
    cumulative: { oil: 0, gas: 0, water: 0 }, injected: { water: 0, gas: 0, co2: 0 },
    remainingOil: 0, remainingGas: 0, waterFrontY: R.owcY,
  };
  const e = rx(s);
  // The player's volumetric estimate is off by up to ±45 % until the reservoir is well known.
  e.estError = (ctx.rng() * 2 - 1) * 0.45;
  refreshEstimates(ctx, R, s);
  return s;
}

/** Injection-enhanced effective water drive 0..1. */
export function effectiveWaterDrive(R: Reservoir, s: ReservoirState): number {
  const d = derived(R);
  const winjRb = s.injected.water * 1.02;
  const pv = R.fluid === 'oil' ? d.N * d.boi : d.G * d.bgi;
  return clamp(R.waterDrive + 0.7 * (1 - Math.exp(-winjRb / Math.max(1, 0.15 * pv))), 0, 1);
}

/** Ultimate recovery factor by drive mechanism, EOR and research. */
export function ultimateRecovery(ctx: GameContext, R: Reservoir, s: ReservoirState): number {
  const d = derived(R);
  const mod = ctx.modifier('recovery_factor');
  if (R.fluid === 'oil') {
    const pv = d.N * d.boi;
    let base = d.tight ? 0.08 : 0.12 + 0.3 * clamp(R.waterDrive, 0, 1) + (R.gasCap ? 0.07 : 0);
    const w = s.injected.water * 1.02;
    const gRb = s.injected.gas * bg(s.pressure, d.tR);
    const cRb = s.injected.co2 * MCF_PER_TONNE_CO2 * bg(s.pressure, d.tR) * 0.6;
    base += 0.12 * (1 - Math.exp(-w / (0.3 * pv)));
    base += 0.05 * (1 - Math.exp(-gRb / (0.2 * pv)));
    base += 0.1 * (1 - Math.exp(-cRb / (0.15 * pv)));
    return clamp(base * mod, 0.03, 0.72);
  }
  const base = d.tight ? 0.3 : (R.fluid === 'condensate' ? 0.75 : 0.83) - 0.12 * clamp(R.waterDrive, 0, 1);
  return clamp(base * mod, 0.1, 0.93);
}

/** 0..1 fraction of the reservoir's pressure below the bubble/dew point. */
export const belowSat = (R: Reservoir, p: number) => (R.bubblePoint > 0 && p < R.bubblePoint ? clamp((R.bubblePoint - p) / R.bubblePoint, 0, 1) : 0);

/** Relative oil mobility: falls as recovery approaches the ultimate RF and below the bubble point. */
export function oilMobility(R: Reservoir, s: ReservoirState, urf: number): number {
  const d = derived(R);
  const rn = clamp(s.cumulative.oil / (d.N * urf), 0, 1);
  return Math.pow(1 - rn, 0.6) * (1 - 0.35 * belowSat(R, s.pressure));
}

export function gasMobility(R: Reservoir, s: ReservoirState, urf: number): number {
  const d = derived(R);
  const rn = clamp(s.cumulative.gas / (d.G * urf), 0, 1);
  return Math.pow(1 - rn, 0.4) * (R.fluid === 'condensate' ? 1 - 0.3 * belowSat(R, s.pressure) : 1);
}

/** Water cut (0..1) for an oil completion: fractional-flow curve on normalised recovery + coning near the OWC. */
export function oilWaterCut(ctx: GameContext, R: Reservoir, s: ReservoirState, c: ResContact, urf: number, qLiq: number): number {
  const d = derived(R);
  const wd = effectiveWaterDrive(R, s);
  const rn = clamp(s.cumulative.oil / (d.N * urf), 0, 1);
  const bt = lerp(0.7, 0.12, wd);
  const fwMax = lerp(0.3, 0.97, wd);
  const fw = fwMax * Math.pow(smooth01((rn - bt) / Math.max(0.05, 1 - bt)), 0.8);
  const base = clamp((R.waterSaturation - 0.18) * 0.25, 0.005, 0.08);
  const dist = c.minY - s.waterFrontY;
  const cone = clamp(1 - dist / 3, 0, 1) * clamp(qLiq / 1500, 0.3, 1) * (0.35 + 0.5 * wd);
  const total = 1 - (1 - base) * (1 - fw) * (1 - cone);
  return clamp(total * ctx.modifier('water_cut'), 0, 0.99);
}

/** Producing GOR (scf/bbl): solution gas, free gas below the bubble point, gas-cap coning. */
export function producingGor(R: Reservoir, s: ReservoirState, c: ResContact): number {
  const x = belowSat(R, s.pressure);
  let gor = Math.max(0, R.gasOilRatio) * (1 + 7 * Math.pow(x, 1.2));
  if (R.gasCap && R.gocY !== undefined) {
    const gcone = clamp(1 - (R.gocY - c.maxY) / 2, 0, 1);
    gor *= 1 + 4 * gcone;
  }
  return gor;
}

/** Water-gas ratio (bbl/mcf) for gas completions. */
export function gasWaterRatio(ctx: GameContext, R: Reservoir, s: ReservoirState, c: ResContact, urf: number): number {
  const d = derived(R);
  const wd = effectiveWaterDrive(R, s);
  const rn = clamp(s.cumulative.gas / (d.G * urf), 0, 1);
  const bt = smooth01((rn - lerp(0.8, 0.3, wd)) / 0.4) * wd;
  const cone = clamp(1 - (c.minY - s.waterFrontY) / 2, 0, 1) * 0.5;
  return (0.003 + 0.12 * bt + 0.08 * cone) * ctx.modifier('water_cut');
}

/** Condensate yield (bbl/mcf) after liquid drop-out below the dew point. */
export function condensateYield(R: Reservoir, s: ReservoirState): number {
  const d = derived(R);
  return d.liquidYield * (1 - 0.6 * belowSat(R, s.pressure));
}

/** Oil-tank capacity (rb/psi) at pressure p. */
function oilCapacity(R: Reservoir, p: number): number {
  const d = derived(R);
  const pb = R.bubblePoint;
  const ce = pb > 0 && p < pb ? lerp(UNDERSAT_COMPRESSIBILITY, SAT_COMPRESSIBILITY, smooth01((pb - p) / (0.1 * pb))) : UNDERSAT_COMPRESSIBILITY;
  let c = d.N * d.boi * ce;
  if (R.gasCap) c += (GAS_CAP_RATIO * d.N * d.boi) / Math.max(200, p);
  return c;
}

/** Reservoir-barrel voidage for produced surface volumes from an oil reservoir. */
export function oilVoidage(R: Reservoir, p: number, oil: number, gas: number, water: number): number {
  const d = derived(R);
  const free = Math.max(0, gas - (oil * rsAt(R, p)) / 1000);
  return oil * bo(R, p) + water * 1.02 + free * bg(p, d.tR);
}

/** Advance one reservoir's pressure by dt days given this step's accumulated flows. */
export function updateReservoir(ctx: GameContext, rt: UpstreamRuntime, R: Reservoir, s: ReservoirState, dt: number): void {
  const d = derived(R);
  const e = rx(s);
  const f = rt.flows.get(R.id);
  const Pi = R.initialPressure;
  const P = s.pressure;
  const aq = d.aq;
  if (R.fluid === 'oil') {
    const voidRb = f?.voidRb ?? 0;
    const injRb = f?.injRb ?? 0;
    if (voidRb === 0 && injRb === 0 && Math.abs(P - Pi) < 0.01) return;
    const C = oilCapacity(R, P);
    let pn = (P * C + (injRb - voidRb) + dt * aq * Pi) / (C + dt * aq);
    pn = clamp(pn, P * 0.85, P * 1.15);
    pn = clamp(pn, MIN_RESERVOIR_PSI, Pi * 1.25);
    e.influx += Math.max(0, dt * aq * (Pi - pn));
    s.pressure = pn;
  } else {
    const injW = (f?.injRb ?? 0) > 0 ? f!.injRb : 0;
    e.influx += Math.max(0, dt * aq * (Pi - P)) + injW;
    e.influx = Math.min(e.influx, 0.8 * d.G * d.bgi);
    const gpNet = s.cumulative.gas - s.injected.gas - s.injected.co2 * MCF_PER_TONNE_CO2;
    const pz = (d.pzi * Math.max(0.01, 1 - gpNet / d.G)) / Math.max(0.2, 1 - e.influx / (d.G * d.bgi));
    let pn = pressureFromPz(pz, P);
    pn = clamp(pn, P * 0.85, P * 1.15);
    s.pressure = clamp(pn, MIN_RESERVOIR_PSI, Pi * 1.25);
  }
}

/** Daily refresh of UI estimates (remaining recoverable, water front, URF). */
export function refreshEstimates(ctx: GameContext, R: Reservoir, s: ReservoirState): void {
  const d = derived(R);
  const e = rx(s);
  const urf = ultimateRecovery(ctx, R, s);
  e.urf = urf;
  const estF = 1 + e.estError * Math.pow(1 - clamp(s.knowledge, 0, 1), 1.5);
  if (R.fluid === 'oil') {
    s.remainingOil = Math.max(0, urf * (R.oilInPlace || 0) * estF - s.cumulative.oil);
    s.remainingGas = (s.remainingOil * Math.max(0, R.gasOilRatio)) / 1000;
    const top = R.gocY ?? R.topY;
    const swept = clamp((e.influx + s.injected.water * 1.02) / (0.45 * d.N * d.boi), 0, 1);
    s.waterFrontY = R.owcY + (top - R.owcY) * swept;
  } else {
    s.remainingGas = Math.max(0, urf * (R.gasInPlace || 0) * estF - s.cumulative.gas);
    s.remainingOil = s.remainingGas * d.liquidYield;
    const swept = clamp(e.influx / (0.6 * d.G * d.bgi), 0, 1);
    s.waterFrontY = R.owcY + (R.topY - R.owcY) * swept;
  }
}
