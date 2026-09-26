// Well deliverability & injection each step: IPR (Vogel / gas backpressure), artificial lift, choke,
// near-well drainage (local tank), storage back-pressure, offshore hubs, H2S chemicals, weather shut-ins.
import { ITEMS } from '../../content/items';
import { BUILDINGS } from '../../content/buildings';
import { isOperational, storageUsed } from '../../core/buildingUtil';
import type { BuildingState, GameContext, Reservoir, ReservoirState, WellState } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { bg, bo, effectivePerm, oilViscosity, rechargeRatio } from './pvt';
import {
  belowSat, condensateYield, derived, gasMobility, gasWaterRatio, oilMobility, oilVoidage, oilWaterCut, producingGor, ultimateRecovery,
  updateReservoir,
} from './reservoir';
import {
  CONV_DECLINE, FT_PER_BLOCK, SRV_AGE_DAYS, GAS_LIFT_GAS_PER_BBL, GAS_N, K_G, K_J, LIFT_POWER_MW, MCF_PER_TONNE_CO2, TIGHT_DECLINE, TUBING_CAP_GAS,
  TUBING_CAP_OIL, WELLHEAD_PRESSURE_GAS, WELLHEAD_PRESSURE_OIL,
} from './tuning';
import { clamp, consumeSupply, distTo, fmtInt, setUpstreamBuildingStatus, severeWeather } from './util';
import { rx, setWellStatus, ux, wellPos, type ResContact, type WellExt } from './wellData';

const CAT_ITEMS: Record<'oil' | 'gas' | 'water', string[]> = { oil: [], gas: [], water: [] };
for (const it of Object.values(ITEMS)) {
  const c = it.category;
  if ((it.kind === 'fluid' || it.kind === 'product') && (c === 'oil' || c === 'gas' || c === 'water')) CAT_ITEMS[c].push(it.id);
}
const HUB_RANGE: Record<string, number> = { production_platform: 24, fpso: 40 };

/** Where a well's fluids go: its wellhead (onshore) or the nearest operational platform/FPSO (offshore). */
export function findSink(ctx: GameContext, rt: UpstreamRuntime, w: WellState): BuildingState | undefined {
  if (!w.offshore) {
    const b = w.wellheadId ? ctx.state.buildings[w.wellheadId] : undefined;
    return b && isOperational(b) ? b : undefined;
  }
  let best: BuildingState | undefined;
  let bd = Infinity;
  for (const id of rt.hubs) {
    const b = ctx.state.buildings[id];
    if (!b || !isOperational(b)) continue;
    const d = distTo(b, w.x + 0.5, w.z + 0.5);
    if (d <= HUB_RANGE[b.type] && d < bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

/** Free storage for a category in a building (Infinity = discharged, e.g. FPSO produced water). */
function freeSpace(b: BuildingState, cat: 'oil' | 'gas' | 'water'): number {
  const cap = BUILDINGS[b.type]?.storage?.[cat];
  if (cap === undefined) return cat === 'water' && b.type !== 'wellhead' ? Infinity : 0;
  return Math.max(0, cap - storageUsed(b, CAT_ITEMS[cat]));
}

/** Completion mid-depth TVD (ft) for a reservoir contact. */
const compTvd = (w: WellState, c: ResContact) => Math.max(200, (w.surfaceY - (c.minY + c.maxY) / 2 - 0.5) * FT_PER_BLOCK);

/** Net effective k·h (mD·ft) of a completion. */
function khEff(R: Reservoir, c: ResContact): number {
  return effectivePerm(R.permeability) * Math.max(0.5, c.hEff) * FT_PER_BLOCK * clamp(R.netToGross || 0.7, 0.05, 1);
}

/** Oil (liquid) productivity index, bbl/d/psi. */
export function oilPI(ctx: GameContext, R: Reservoir, s: ReservoirState, c: ResContact, w: WellState, urf: number): number {
  const mob = oilMobility(R, s, urf);
  return (K_J * khEff(R, c) * w.productivity * mob * ctx.modifier('production_rate')) / (oilViscosity(R) * bo(R, s.pressure));
}

/** Gas deliverability coefficient C (mcf/d/psi^2n). */
export function gasCoef(ctx: GameContext, R: Reservoir, s: ReservoirState, c: ResContact, w: WellState, urf: number): number {
  return K_G * khEff(R, c) * w.productivity * gasMobility(R, s, urf) * ctx.modifier('production_rate');
}

/** Composite Vogel IPR: liquid rate at flowing pressure pwf for average pressure p. */
export function iprLiquid(J: number, p: number, pwf: number, pb: number): number {
  if (pwf >= p || J <= 0) return 0;
  if (pb <= 0) return J * (p - pwf);
  if (p <= pb) {
    const r = pwf / p;
    return ((J * p) / 1.8) * (1 - 0.2 * r - 0.8 * r * r);
  }
  if (pwf >= pb) return J * (p - pwf);
  const r = pwf / pb;
  return J * (p - pb) + ((J * pb) / 1.8) * (1 - 0.2 * r - 0.8 * r * r);
}

export const gasRate = (C: number, p: number, pwf: number) => (p > pwf ? C * Math.pow(p * p - pwf * pwf, GAS_N) : 0);

/** Bottom-hole flowing pressure and liquid (or gas) capacity for the well's lift method. */
export function liftParams(ctx: GameContext, w: WellState, tvd: number, wc: number, gor: number, gasWell: boolean): { pwf: number; cap: number } {
  const eff = ctx.modifier('lift_efficiency');
  const power = clamp(ctx.state.power.satisfaction, 0, 1);
  if (gasWell) {
    switch (w.lift) {
      case 'pumpjack': return { pwf: 150 + 0.05 * tvd, cap: TUBING_CAP_GAS * power };
      case 'gaslift': return { pwf: 200 + 0.05 * tvd, cap: TUBING_CAP_GAS };
      default: return { pwf: WELLHEAD_PRESSURE_GAS + 0.07 * tvd, cap: TUBING_CAP_GAS };
    }
  }
  const grad = clamp((0.36 * (1 - wc) + 0.45 * wc) / (1 + ((1 - wc) * gor) / 1200), 0.12, 0.45);
  switch (w.lift) {
    case 'pumpjack': return { pwf: 80 + 0.02 * tvd, cap: clamp(400 * Math.pow(5000 / tvd, 0.8), 50, 400) * eff * power };
    case 'esp': return { pwf: 250 + 0.03 * tvd, cap: clamp(5000 * Math.pow(4000 / tvd, 0.7), 500, 5000) * eff * power };
    case 'gaslift': return { pwf: WELLHEAD_PRESSURE_OIL + grad * 0.45 * tvd, cap: 4000 * eff };
    default: return { pwf: WELLHEAD_PRESSURE_OIL + grad * tvd, cap: TUBING_CAP_OIL };
  }
}

/** Near-well drainage parameters: decline constant D0 (1/day) and recharge ratio r (fading with SRV age in tight rock). */
function drainage(ctx: GameContext, R: Reservoir, c: ResContact): { d0: number; r: number } {
  const tight = derived(R).tight;
  let r = rechargeRatio(R.permeability);
  if (tight && c.srvDay !== undefined) {
    const age = Math.max(0, ctx.state.time.day + ctx.state.time.minuteOfDay / 1440 - c.srvDay);
    r /= 1 + age / SRV_AGE_DAYS;
  }
  return { d0: (tight ? TIGHT_DECLINE : CONV_DECLINE) * ctx.modifier('decline_rate'), r };
}

/** Implicit near-well pressure update: dpL/dt = D0·[r(P − pL) − s(pL − pwf)]. */
function relaxLocal(c: ResContact, P: number, pwf: number, s: number, d0: number, r: number, dt: number): void {
  const k = dt * d0;
  c.pL = (c.pL + k * (r * P + s * pwf)) / (1 + k * (r + s));
  if (!Number.isFinite(c.pL)) c.pL = P;
}

/** Contact record for a completed reservoir (older saves / edge cases get a minimal one). */
export function contactFor(ctx: GameContext, w: WellState, R: Reservoir): ResContact {
  const e = ux(w);
  let c = e.res[R.id];
  if (!c) {
    const y = Math.round((R.topY + R.bottomY) / 2);
    c = e.res[R.id] = { contact: 1, hc: 1, hEff: 1, minY: y, maxY: y, pL: ctx.state.reservoirs[R.id]?.pressure ?? R.initialPressure, fracPsi: R.initialPressure * 1.6 };
  }
  return c;
}

/** Uncontrolled (open-hole) flow of a blowout: bbl/d of oil/water or mcf/d of gas. */
export function blowoutRate(ctx: GameContext, rt: UpstreamRuntime, w: WellState): number {
  const e = ux(w);
  const R = e.blowRes ? rt.reservoir(e.blowRes) : undefined;
  const s = R ? ctx.state.reservoirs[R.id] : undefined;
  if (R && s) {
    const c = contactFor(ctx, w, R);
    const urf = ultimateRecovery(ctx, R, s);
    if (R.fluid === 'oil') return Math.min(35_000, 2.5 * oilPI(ctx, R, s, c, w, urf) * Math.max(0, s.pressure - 250));
    return Math.min(150_000, 2.5 * gasRate(gasCoef(ctx, R, s, c, w, urf), s.pressure, 250));
  }
  const days = w.blowout ? ctx.state.time.day + ctx.state.time.minuteOfDay / 1440 - w.blowout.startedDay : 0;
  return (e.blowFluid === 'gas' ? 6000 : 2500) * Math.exp(-Math.max(0, days) / 8);
}

interface Totals { oil: number; gas: number; water: number }

/** One production substep of dt days for all wells, then the reservoir tanks. */
export function tickProduction(ctx: GameContext, rt: UpstreamRuntime, dt: number): void {
  rt.hubs = [];
  for (const b of Object.values(ctx.state.buildings)) if (b.type === 'production_platform' || b.type === 'fpso') rt.hubs.push(b.id);
  weatherShutIns(ctx);
  rt.resetFlows();
  const field: Totals = { oil: 0, gas: 0, water: 0 };
  for (const w of Object.values(ctx.state.wells)) {
    if (w.status === 'producing') produceWell(ctx, rt, w, dt, field);
    else if (w.status === 'injecting') injectWell(ctx, rt, w, dt);
    else if (w.status === 'shut_in' || w.status === 'fracking') idleWell(ctx, rt, w, dt);
  }
  for (const s of Object.values(ctx.state.reservoirs)) {
    const R = rt.reservoir(s.id);
    if (!R) continue;
    updateReservoirSafe(ctx, rt, R, s, dt);
  }
  const st = ctx.state.stats;
  if (field.oil > st.peakOilRate) st.peakOilRate = Math.round(field.oil);
}

function updateReservoirSafe(ctx: GameContext, rt: UpstreamRuntime, R: Reservoir, s: ReservoirState, dt: number) {
  updateReservoir(ctx, rt, R, s, dt);
  const e = rx(s);
  if (R.fluid === 'oil' && !e.belowBubbleNotified && s.discovered && R.bubblePoint > 0 && s.pressure < R.bubblePoint && s.cumulative.oil > 0) {
    e.belowBubbleNotified = true;
    ctx.notify('warning', `${R.name} below bubble point`, `Reservoir pressure (${fmtInt(s.pressure)} psi) fell below ${fmtInt(R.bubblePoint)} psi: gas is coming out of solution, GORs will climb and oil rates fall. Water or gas injection maintains pressure.`);
  }
}

function zeroRates(w: WellState, e: WellExt, limit: string, P?: number): void {
  w.rates.oil = 0;
  w.rates.gas = 0;
  w.rates.water = 0;
  if (P !== undefined) w.bhp = P;
  e.limit = limit;
}

function sinkStatus(ctx: GameContext, w: WellState, active: boolean, util: number, io: Record<string, number>): void {
  if (w.offshore || !w.wellheadId) return;
  const b = ctx.state.buildings[w.wellheadId];
  if (!b) return;
  b.io = io;
  b.data.lift = w.lift;
  b.data.choke = w.choke;
  b.data.wellStatus = w.status;
  b.data.liftPowerMW = active ? LIFT_POWER_MW[w.lift] : 0;
  setUpstreamBuildingStatus(ctx, b, active, util);
}

/** Shut-in / fracking wells: near-well pressure builds back toward reservoir pressure. */
function idleWell(ctx: GameContext, rt: UpstreamRuntime, w: WellState, dt: number): void {
  const e = ux(w);
  let P = 0;
  for (const rid of w.completedReservoirs) {
    const R = rt.reservoir(rid);
    const s = ctx.state.reservoirs[rid];
    if (!R || !s) continue;
    const c = contactFor(ctx, w, R);
    const { d0, r } = drainage(ctx, R, c);
    relaxLocal(c, s.pressure, 0, 0, d0, r, dt);
    P = Math.max(P, c.pL);
  }
  zeroRates(w, e, w.status === 'fracking' ? 'Fracturing in progress' : e.autoShutIn ? 'Shut in for severe weather' : 'Shut in', P || w.bhp);
  sinkStatus(ctx, w, false, 0, {});
}

function produceWell(ctx: GameContext, rt: UpstreamRuntime, w: WellState, dt: number, field: Totals): void {
  const e = ux(w);
  if (e.op) {
    zeroRates(w, e, e.op.label);
    sinkStatus(ctx, w, false, 0, {});
    return;
  }
  const sink = findSink(ctx, rt, w);
  if (!sink) {
    zeroRates(w, e, w.offshore ? 'No production platform (≤24 blocks) or FPSO (≤40 blocks) in range' : 'Wellhead unavailable');
    return;
  }
  // ---- Potential per completed reservoir ----
  type Part = { R: Reservoir; s: ReservoirState; c: ResContact; gas: boolean; pot: number; pwf: number; wc: number; gor: number; wgr: number; cgr: number; d0: number; r: number };
  const parts: Part[] = [];
  let liqPot = 0;
  let gasPot = 0;
  let liqCap = Infinity;
  let gasCap = Infinity;
  let loaded = false;
  let bhp = 0;
  const prevLiq = Math.max(0, w.rates.oil + w.rates.water);
  for (const rid of w.completedReservoirs) {
    const R = rt.reservoir(rid);
    const s = ctx.state.reservoirs[rid];
    if (!R || !s) continue;
    const c = contactFor(ctx, w, R);
    const urf = ultimateRecovery(ctx, R, s);
    const tvd = compTvd(w, c);
    const { d0, r } = drainage(ctx, R, c);
    if (c.pL > s.pressure * 1.5 || !(c.pL > 0)) c.pL = s.pressure;
    if (R.fluid === 'oil') {
      const wc = oilWaterCut(ctx, R, s, c, urf, prevLiq);
      const gor = producingGor(R, s, c);
      const lp = liftParams(ctx, w, tvd, wc, gor, false);
      const J = oilPI(ctx, R, s, c, w, urf);
      const pot = iprLiquid(J, c.pL, lp.pwf, R.bubblePoint);
      if (pot <= 0.5 && w.lift === 'natural') loaded = true;
      liqPot += pot;
      liqCap = Math.min(liqCap, lp.cap);
      bhp = Math.max(bhp, lp.pwf);
      parts.push({ R, s, c, gas: false, pot, pwf: lp.pwf, wc, gor, wgr: 0, cgr: 0, d0, r });
    } else {
      const wgr = gasWaterRatio(ctx, R, s, c, urf);
      const cgr = condensateYield(R, s);
      const lp = liftParams(ctx, w, tvd, 0, 0, true);
      const C = gasCoef(ctx, R, s, c, w, urf);
      let pot = gasRate(C, c.pL, lp.pwf);
      // Liquid loading: below the critical rate the well cannot unload water/condensate on natural flow.
      const qCrit = 250 + 0.04 * tvd;
      if (w.lift === 'natural' && (wgr + cgr) > 0.002 && pot < qCrit) {
        pot = 0;
        loaded = true;
      }
      gasPot += pot;
      gasCap = Math.min(gasCap, lp.cap);
      bhp = Math.max(bhp, lp.pwf);
      parts.push({ R, s, c, gas: true, pot, pwf: lp.pwf, wc: 0, gor: 0, wgr, cgr, d0, r });
    }
  }
  e.potential = liqPot + gasPot;
  if (parts.length === 0) {
    zeroRates(w, e, 'No completed reservoir');
    return;
  }
  const choke = clamp(w.choke, 0, 1);
  const sLiq = liqPot > 0 ? Math.min(1, liqCap / liqPot) * choke : 0;
  const sGas = gasPot > 0 ? Math.min(1, gasCap / gasPot) * choke : 0;
  // ---- Surface volumes this substep ----
  let oil = 0, gas = 0, water = 0, liqGasLift = 0;
  for (const p of parts) {
    if (!p.gas) {
      const liq = p.pot * sLiq * dt;
      const o = liq * (1 - p.wc);
      oil += o;
      water += liq * p.wc;
      gas += (o * p.gor) / 1000;
      liqGasLift += liq;
    } else {
      const g = p.pot * sGas * dt;
      gas += g;
      water += g * p.wgr;
      oil += g * p.cgr;
    }
  }
  if (w.lift === 'gaslift') gas = Math.max(0, gas - liqGasLift * GAS_LIFT_GAS_PER_BBL);
  // ---- Storage back-pressure ----
  let frac = 1;
  const fo = freeSpace(sink, 'oil'), fg = freeSpace(sink, 'gas'), fw = freeSpace(sink, 'water');
  if (oil > 0) frac = Math.min(frac, fo / oil);
  if (gas > 0) frac = Math.min(frac, fg / gas);
  if (water > 0) frac = Math.min(frac, fw / water);
  frac = clamp(frac, 0, 1);
  oil *= frac; gas *= frac; water *= frac;
  // ---- Near-well pressure & reservoir accounting ----
  const oilItem = parts.some((p) => !p.gas && p.R.fluid === 'oil') ? 'crude_oil' : 'condensate';
  for (const p of parts) {
    const s = (p.gas ? sGas : sLiq) * frac;
    relaxLocal(p.c, p.s.pressure, p.pwf, s, p.d0, p.r, dt);
    const flow = rt.flow(p.R.id);
    if (p.gas) {
      const g = p.pot * sGas * dt * frac;
      const wv = g * p.wgr;
      const cv = g * p.cgr;
      p.s.cumulative.gas += g;
      p.s.cumulative.water += wv;
      p.s.cumulative.oil += cv;
      flow.voidRb += wv * 1.02;
    } else {
      const liq = p.pot * sLiq * dt * frac;
      const o = liq * (1 - p.wc);
      const wv = liq * p.wc;
      const gv = (o * p.gor) / 1000;
      p.s.cumulative.oil += o;
      p.s.cumulative.water += wv;
      p.s.cumulative.gas += gv;
      flow.voidRb += oilVoidage(p.R, p.s.pressure, o, gv, wv);
    }
  }
  // H2S wells need production chemicals (scavengers & corrosion inhibitor).
  const sour = parts.reduce((m, p) => Math.max(m, p.R.h2s || 0), 0);
  if (sour > 0.01 && gas > 0) consumeSupply(ctx, 'chemicals', (0.5 * dt + gas * sour * 0.02), w);
  // ---- Deposit ----
  const st = sink.storage;
  if (oil > 0) st[oilItem] = (st[oilItem] ?? 0) + oil;
  if (gas > 0) st.natural_gas = (st.natural_gas ?? 0) + gas;
  if (water > 0 && freeSpace(sink, 'water') !== Infinity) st.produced_water = (st.produced_water ?? 0) + water;
  const inv = 1 / dt;
  w.rates.oil = oil * inv;
  w.rates.gas = gas * inv;
  w.rates.water = water * inv;
  w.bhp = Math.round(bhp);
  const liquid = oil + water;
  if (liquid > 0) w.waterCut = water / liquid;
  if (oil > 0) w.gor = (gas * 1000) / oil;
  w.cumulative.oil += oil;
  w.cumulative.gas += gas;
  w.cumulative.water += water;
  e.day[0] += oil;
  e.day[1] += gas;
  e.day[2] += water;
  field.oil += w.rates.oil;
  const stats = ctx.state.stats;
  stats.totalOil += oil;
  stats.totalGas += gas;
  stats.totalWater += water;
  const prod = ctx.state.company.today.production;
  if (oil > 0) prod[oilItem] = (prod[oilItem] ?? 0) + oil;
  if (gas > 0) prod.natural_gas = (prod.natural_gas ?? 0) + gas;
  if (water > 0) prod.produced_water = (prod.produced_water ?? 0) + water;
  // ---- Limits, UI & notifications ----
  const potFull = liqPot + gasPot;
  const util = potFull > 0 ? clamp((liqPot > 0 ? sLiq * frac : sGas * frac) / Math.max(choke, 1e-6), 0, 1) * (choke > 0 ? 1 : 0) : 0;
  const producing = oil + gas + water > 0;
  e.limit = !producing
    ? loaded ? 'Loaded up — install artificial lift' : choke <= 0 ? 'Choke closed' : frac <= 0 ? 'Storage full — connect pipelines' : 'No inflow'
    : frac < 0.999 ? 'Storage full — connect pipelines (back-pressure)'
    : choke < 0.999 ? 'Choked back'
    : (liqPot > 0 && liqCap < liqPot) || (gasPot > 0 && gasCap < gasPot) ? `Lift/tubing limited (${w.lift})` : '';
  sinkStatus(ctx, w, producing, util, producing ? { [oilItem]: w.rates.oil, natural_gas: w.rates.gas, produced_water: w.rates.water } : {});
  notifyProduction(ctx, w, e, loaded, producing, frac);
}

function notifyProduction(ctx: GameContext, w: WellState, e: WellExt, loaded: boolean, producing: boolean, frac: number): void {
  const f = e.flags;
  if (producing && !f.firstOil && (w.rates.oil > 1 || w.rates.gas > 10)) {
    f.firstOil = true;
    const txt = w.rates.oil > 50 ? `${fmtInt(w.rates.oil)} bbl/d of ${w.rates.gas > 0 ? 'oil' : 'liquids'}` : `${fmtInt(w.rates.gas)} mcf/d of gas`;
    ctx.notify('success', `First ${w.rates.oil > 50 ? 'oil' : 'gas'} from ${w.name}`, `Flowing ${txt}${w.rates.oil > 50 && w.rates.gas > 0 ? ` and ${fmtInt(w.rates.gas)} mcf/d gas` : ''}. Pipe it to tanks, a truck rack or a gas meter to get paid.`, wellPos(w));
  }
  if (loaded && !producing && !f.loaded) {
    f.loaded = true;
    const tip = w.lift === 'natural' ? 'Install a pumpjack, ESP or gas lift (Well panel → Artificial lift).' : 'Reservoir pressure is too low even for the current lift — consider water injection nearby.';
    ctx.notify('warning', `${w.name} has loaded up`, `Reservoir pressure can no longer lift the fluid column and the well died. ${tip}`, wellPos(w));
  } else if (producing && f.loaded) f.loaded = false;
  if (w.waterCut > 0.25 && !f.waterBt && w.rates.oil > 0) {
    f.waterBt = true;
    ctx.notify('warning', `Water breakthrough at ${w.name}`, `Water cut ${Math.round(w.waterCut * 100)}%. Produced water must be disposed of (pit, disposal well) or reinjected.`, wellPos(w));
  }
  if (frac < 0.5 && !f.storageTip) {
    f.storageTip = true;
    ctx.notify('info', `${w.name}: wellhead storage full`, 'Production is throttled by back-pressure. Connect oil, gas and water pipelines to the wellhead ports.', wellPos(w));
  }
}

function injectWell(ctx: GameContext, rt: UpstreamRuntime, w: WellState, dt: number): void {
  const e = ux(w);
  if (e.op) {
    zeroRates(w, e, e.op.label);
    sinkStatus(ctx, w, false, 0, {});
    return;
  }
  const b = w.offshore ? findSink(ctx, rt, w) : w.wellheadId ? ctx.state.buildings[w.wellheadId] : undefined;
  if (!b || !isOperational(b)) {
    zeroRates(w, e, 'Wellhead unavailable');
    return;
  }
  const items = w.purpose === 'injector_gas' ? ['natural_gas', 'dry_gas'] : w.purpose === 'injector_co2' ? ['co2'] : ['fresh_water', 'produced_water'];
  let avail = 0;
  for (const it of items) avail += b.storage[it] ?? 0;
  const R = w.completedReservoirs.length ? rt.reservoir(w.completedReservoirs[0]) : undefined;
  const s = R ? ctx.state.reservoirs[R.id] : undefined;
  let qMax: number;
  let bhp = 0;
  const choke = clamp(w.choke, 0, 1);
  if (!R || !s) {
    qMax = w.purpose === 'disposal' ? 6000 : 0;
  } else {
    const c = contactFor(ctx, w, R);
    const pinj = c.fracPsi * 0.92;
    bhp = pinj;
    const kh = khEff(R, c) * w.productivity * ctx.modifier('production_rate');
    if (w.purpose === 'injector_gas' || w.purpose === 'injector_co2') {
      const q = K_G * kh * 1.5 * Math.pow(Math.max(0, pinj * pinj - s.pressure * s.pressure), GAS_N);
      qMax = Math.min(40_000, q);
      if (w.purpose === 'injector_co2') qMax /= MCF_PER_TONNE_CO2;
    } else qMax = Math.min(20_000, (K_J * kh * 1.6 * Math.max(0, pinj - s.pressure)));
  }
  let q = Math.min(avail, qMax * choke * dt);
  let left = q;
  for (const it of items) {
    const have = b.storage[it] ?? 0;
    const t = Math.min(have, left);
    if (t > 0) {
      b.storage[it] = have - t;
      left -= t;
    }
  }
  q -= left;
  if (R && s && q > 0) {
    const d = derived(R);
    const flow = rt.flow(R.id);
    if (w.purpose === 'injector_gas') {
      s.injected.gas += q;
      flow.injRb += q * bg(s.pressure, d.tR);
    } else if (w.purpose === 'injector_co2') {
      s.injected.co2 += q;
      flow.injRb += q * MCF_PER_TONNE_CO2 * bg(s.pressure, d.tR) * 0.6;
    } else {
      s.injected.water += q;
      flow.injRb += q * 1.02;
    }
  }
  const rate = q / dt;
  w.rates.oil = 0;
  w.rates.gas = w.purpose === 'injector_gas' ? -rate : w.purpose === 'injector_co2' ? -rate * MCF_PER_TONNE_CO2 : 0;
  w.rates.water = w.purpose === 'injector_gas' || w.purpose === 'injector_co2' ? 0 : -rate;
  w.bhp = Math.round(bhp);
  if (w.purpose === 'injector_gas') { w.cumulative.gas -= q; e.day[1] -= q; }
  else if (w.purpose === 'injector_co2') { w.cumulative.gas -= q * MCF_PER_TONNE_CO2; e.day[1] -= q * MCF_PER_TONNE_CO2; }
  else { w.cumulative.water -= q; e.day[2] -= q; }
  e.potential = qMax;
  e.limit = q <= 0 ? (avail <= 0 ? `No ${w.purpose === 'injector_gas' ? 'gas' : w.purpose === 'injector_co2' ? 'CO₂' : 'water'} supplied to the wellhead` : 'No injectivity') : '';
  sinkStatus(ctx, w, q > 0, qMax > 0 ? clamp(rate / qMax, 0, 1) : 0, q > 0 ? { [items[0]]: -rate } : {});
}

/** Offshore wells shut in automatically in hurricanes / violent storms and resume afterwards. */
function weatherShutIns(ctx: GameContext): void {
  const severe = severeWeather(ctx);
  let shut = 0;
  let resumed = 0;
  for (const w of Object.values(ctx.state.wells)) {
    if (!w.offshore) continue;
    const e = ux(w);
    if (severe && (w.status === 'producing' || w.status === 'injecting') && !e.op) {
      e.prevStatus = w.status;
      e.autoShutIn = true;
      setWellStatus(ctx, w, 'shut_in');
      shut++;
    } else if (!severe && e.autoShutIn) {
      e.autoShutIn = false;
      if (w.status === 'shut_in' && !e.manualShutIn) {
        setWellStatus(ctx, w, e.prevStatus ?? 'producing');
        resumed++;
      }
    }
  }
  if (shut) ctx.notify('warning', 'Offshore wells shut in', `${shut} offshore well${shut > 1 ? 's were' : ' was'} shut in for severe weather. Production resumes automatically when it passes.`);
  if (resumed) ctx.notify('info', 'Offshore production resumed', `${resumed} well${resumed > 1 ? 's' : ''} back online after the storm.`);
}

/** Push yesterday's volumes into well histories (cap 720). */
export function rollWellHistory(ctx: GameContext, day: number): void {
  for (const w of Object.values(ctx.state.wells)) {
    const e = ux(w);
    const [o, g, wa] = e.day;
    if (o !== 0 || g !== 0 || wa !== 0 || w.status === 'producing' || w.status === 'injecting' || w.status === 'shut_in') {
      w.history.push([day - 1, Math.round(o * 10) / 10, Math.round(g * 10) / 10, Math.round(wa * 10) / 10]);
      if (w.history.length > 720) w.history.splice(0, w.history.length - 720);
    }
    e.day = [0, 0, 0];
  }
}

/** For UI: the belowSat helper re-exported. */
export { belowSat };
