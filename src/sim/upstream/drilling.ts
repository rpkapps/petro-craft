// Drilling: rate of penetration, bit wear & trips, casing points, consumables, B.CASING blocks, logs,
// reservoir penetration/discovery and TD. Well-control events are delegated to wellControl.ts.
import { B } from '../../core/blocks';
import { BUILDINGS } from '../../content/buildings';
import { crewFactor, isOperational } from '../../core/buildingUtil';
import type { BuildingState, CasingString, GameContext, Reservoir, RockProperties, Vec3, WellLogSample, WellState } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { inclinationAt, pathLength, posAtMd } from './trajectory';
import { currentPorePsi, mudProgram, pressureProfile } from './planning';
import {
  BARITE_PER_BLOCK_PER_PPG, BIT_LIFE_BLOCKS, BIT_TRIP_THRESHOLD, CASING_HOURS_BASE, CASING_HOURS_PER_BLOCK, CASING_JOINTS_PER_BLOCK,
  CEMENT_SACKS_PER_BLOCK, LOST_CIRC_MUD_PER_HOUR, MUD_MAX_PPG, MUD_MIN_PPG, MUD_PER_BLOCK, MUD_PER_HOUR, PIPE_WEAR_PER_BLOCK, RIG_SPECS,
  STANDBY_SPREAD, AQUIFER_FINE, LATERAL_WEIGHT_CONV, LATERAL_WEIGHT_TIGHT,
} from './tuning';
import { accrue, setWellStatus, ux, type WellExt, rx, wellPos } from './wellData';
import { clamp, consumeSupply, depthM, fmtMoney, fmtVol, hazardsEnabled, psiToPpg, setUpstreamBuildingStatus, severeWeather, tvdFt } from './util';
import { checkKick, tickKickUnattended, finishKill, tickBlowout } from './wellControl';
import { finishOp } from './completion';

const tmp: Vec3 = { x: 0, y: 0, z: 0 };


/** Crew × power efficiency of a rig (0 = cannot work). */
export function rigEfficiency(ctx: GameContext, rig: BuildingState | undefined): { eff: number; reason: string } {
  if (!rig || rig.status === 'destroyed') return { eff: 0, reason: 'Rig lost' };
  if (!isOperational(rig)) return { eff: 0, reason: rig.constructionProgress < 1 ? 'Rigging up' : rig.status === 'fire' ? 'Rig on fire' : rig.status === 'broken' ? 'Rig broken down' : 'Rig disabled' };
  if (rig.status === 'no_power') return { eff: 0, reason: 'No power' };
  const crew = crewFactor(ctx.state, rig);
  if (crew <= 0.01) return { eff: 0, reason: 'No crew assigned' };
  const def = BUILDINGS[rig.type];
  const power = def && def.power > 0 ? clamp(ctx.state.power.satisfaction, 0, 1) : 1;
  if (power <= 0.05) return { eff: 0, reason: 'No power' };
  const spec = RIG_SPECS[rig.type];
  if (spec?.offshore && severeWeather(ctx)) return { eff: 0, reason: 'Waiting on weather' };
  return { eff: crew * (0.35 + 0.65 * power), reason: '' };
}

/** Build the mud program (per casing section) at spud from the player's pressure knowledge. */
export function buildMudProgram(ctx: GameContext, w: WellState): { y: number; ppg: number }[] {
  return mudProgram(pressureProfile(ctx, w.x, w.z), w.surfaceY, w.plan);
}

function sectionPpg(e: WellExt, y: number, fallback: number): number {
  let ppg = fallback;
  for (const s of e.mud) if (y <= s.y) ppg = s.ppg;
  return ppg;
}

/** Deepest cemented casing shoe y (surfaceY if none). */
export function shoeY(w: WellState): number {
  let s = w.surfaceY;
  for (const c of w.casing) if (c.bottomY < s) s = c.bottomY;
  return s;
}

export function casingCovers(w: WellState, y: number): boolean {
  return w.casing.some((c) => c.bottomY <= y && c.topY >= y);
}

/** Start a casing job at y (current bit depth or a planned casing point). */
export function startCasing(ctx: GameContext, rt: UpstreamRuntime, w: WellState, y: number, atTD: boolean): void {
  const e = ux(w);
  const hasSurface = w.casing.some((c) => c.name === 'surface');
  const name: CasingString['name'] = atTD ? 'production' : !hasSurface ? 'surface' : 'intermediate';
  // The surface string runs to surface; deeper strings are liners hung just inside the previous shoe.
  const prevShoe = shoeY(w);
  const newHole = Math.max(1, w.measuredDepth - mdAtY(rt, w, prevShoe));
  const length = hasSurface ? newHole + 1 : w.measuredDepth;
  const topY = hasSurface ? Math.min(w.surfaceY - 1, prevShoe + 1) : w.surfaceY - 1;
  consumeSupply(ctx, 'casing', length * CASING_JOINTS_PER_BLOCK, w);
  consumeSupply(ctx, 'cement', (newHole + 1) * CEMENT_SACKS_PER_BLOCK, w);
  const hours = CASING_HOURS_BASE + CASING_HOURS_PER_BLOCK * length;
  const label = `Running & cementing ${name} casing`;
  e.op = { kind: 'casing', label, hoursLeft: hours, hoursTotal: hours, casingName: name, casingY: y, casingTopY: topY };
  setWellStatus(ctx, w, 'casing');
}

/** Measured depth where the path first reaches y (for casing shoe → hole length). */
export function mdAtY(rt: UpstreamRuntime, w: WellState, y: number): number {
  const pts = rt.trajectory(w.id, w.x, w.surfaceY, w.z, w.plan);
  for (let i = 0; i < pts.length; i++) if (pts[i].y <= y) return i;
  return pathLength(pts);
}

function startTrip(ctx: GameContext, w: WellState, rigType: string): void {
  const e = ux(w);
  const spec = RIG_SPECS[rigType] ?? RIG_SPECS.drilling_rig_land;
  consumeSupply(ctx, 'drill_bit', 1, w);
  const hours = 1 + (w.surfaceY - w.currentY) * spec.tripHoursPerBlock * 2;
  e.op = { kind: 'trip', label: 'Tripping out for a new bit', hoursLeft: hours, hoursTotal: hours };
  setWellStatus(ctx, w, 'tripping');
}

/** Finish a drilling-phase op (trip/casing/kill). Completion-phase ops go to completion.ts. */
function finishDrillOp(ctx: GameContext, rt: UpstreamRuntime, w: WellState, rig: BuildingState | undefined): void {
  const e = ux(w);
  const op = e.op!;
  e.op = undefined;
  if (op.kind === 'trip') {
    w.bitCondition = 100;
    setWellStatus(ctx, w, 'drilling');
    return;
  }
  if (op.kind === 'casing') {
    const y = op.casingY ?? w.currentY;
    w.casing.push({ name: op.casingName ?? 'intermediate', topY: op.casingTopY ?? w.surfaceY - 1, bottomY: y, cemented: true });
    // Advance past every casing point this string covers.
    const cps = w.plan.casingPoints;
    while (e.nextCasing < cps.length && cps[e.nextCasing] >= y - 0.5) e.nextCasing++;
    e.lostCirc = false;
    e.fracMin = Infinity;
    e.mudOverride = false;
    w.mudWeight = sectionPpg(e, y - 1, w.mudWeight);
    if (w.measuredDepth >= w.plannedDepth - 1e-6) {
      reachTD(ctx, rt, w);
      return;
    }
    const m = depthM(w.surfaceY, y);
    if (op.casingName === 'surface' || op.casingName === 'intermediate')
      ctx.notify('info', `${w.name}: ${op.casingName} casing set at ${m} m`, `Drilling ahead with ${w.mudWeight.toFixed(1)} ppg mud.`, wellPos(w));
    setWellStatus(ctx, w, 'drilling');
    return;
  }
  if (op.kind === 'kill') {
    finishKill(ctx, rt, w, rig, op);
    return;
  }
}


/** Advance a well in a drilling-phase status (drilling/tripping/casing/kick) by `hours` of game time. */
export function tickDrillingWell(ctx: GameContext, rt: UpstreamRuntime, w: WellState, hours: number): void {
  const e = ux(w);
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  const spec = RIG_SPECS[rig?.type ?? 'drilling_rig_land'] ?? RIG_SPECS.drilling_rig_land;
  const { eff, reason } = rigEfficiency(ctx, rig);
  // Spread cost: full rate while working, standby otherwise.
  if (rig && rig.status !== 'destroyed') accrue(w, 'drilling', spec.spreadPerDay * ctx.modifier('drill_cost') * (hours / 24) * (eff > 0 ? 1 : STANDBY_SPREAD));
  if (eff <= 0) {
    if (e.stalled !== reason) {
      e.stalled = reason;
      if (reason !== 'Rigging up') ctx.notify('warning', `${w.name}: operations suspended`, `${reason}. The rig is on standby (${fmtMoney(spec.spreadPerDay * STANDBY_SPREAD)}/day).`, wellPos(w));
    }
    if (rig) setUpstreamBuildingStatus(ctx, rig, false, 0);
    if (w.status === 'kick' && !e.op) tickKickUnattended(ctx, rt, w, rig, hours);
    return;
  }
  e.stalled = undefined;
  if (rig) setUpstreamBuildingStatus(ctx, rig, true, eff);
  let budget = hours;
  for (let guard = 0; budget > 1e-7 && guard < 80; guard++) {
    if (e.op) {
      const op = e.op;
      const rate = op.kind === 'kill' ? Math.max(0.4, Math.min(1, eff)) : Math.max(0.2, eff);
      const use = Math.min(budget, op.hoursLeft / rate);
      op.hoursLeft -= use * rate;
      budget -= use;
      if (op.hoursLeft <= 1e-6) {
        if (op.kind === 'trip' || op.kind === 'casing' || op.kind === 'kill') finishDrillOp(ctx, rt, w, rig);
        else finishOp(ctx, rt, w, op);
      }
      continue;
    }
    if (w.status === 'kick') {
      tickKickUnattended(ctx, rt, w, rig, budget);
      return;
    }
    if (w.status !== 'drilling') return;
    budget = drillAhead(ctx, rt, w, rig!, eff, budget);
  }
}

/** Drill forward up to the next block boundary / event. Returns the remaining hour budget. */
function drillAhead(ctx: GameContext, rt: UpstreamRuntime, w: WellState, rig: BuildingState, eff: number, budget: number): number {
  const e = ux(w);
  const g = ctx.geology;
  const pts = rt.trajectory(w.id, w.x, w.surfaceY, w.z, w.plan);
  const spec = RIG_SPECS[rig.type] ?? RIG_SPECS.drilling_rig_land;
  const md = w.measuredDepth;
  // Rock just ahead of the bit.
  posAtMd(pts, Math.min(w.plannedDepth, md + 0.5), tmp);
  const bx = Math.floor(tmp.x), by = Math.floor(tmp.y), bz = Math.floor(tmp.z);
  const props = g.properties(bx, by, bz);
  const hard = Math.max(0.3, props.hardness);
  const tvd = tvdFt(w.surfaceY, by);
  const porePsi = currentPorePsi(ctx, bx, by, bz, props.reservoirId);
  const porePpg = psiToPpg(porePsi, tvd);
  const overbal = tvd > 400 ? Math.max(0, w.mudWeight - porePpg) : 0;
  const inc = inclinationAt(pts, md);
  let rop = (spec.rop * ctx.modifier('drill_speed') * eff * (0.45 + 0.55 * clamp(w.bitCondition / 100, 0, 1))) / Math.pow(hard, 0.8);
  rop *= Math.exp(-overbal * 0.07);
  if (e.lostCirc) rop *= 0.6;
  if (inc > 0.15 && inc < 1.4) rop *= 0.8; // steering the curve
  else if (inc >= 1.4) rop *= 0.9; // lateral
  rop = Math.max(0.02, rop);
  const toBoundary = Math.floor(md) + 1 - md;
  const toTD = w.plannedDepth - md;
  const step = Math.max(0, Math.min(toBoundary, toTD, rop * budget));
  const time = step > 0 ? step / rop : budget;
  // Consumables for this increment.
  const mudBbl = MUD_PER_BLOCK * step + MUD_PER_HOUR * time + (e.lostCirc ? LOST_CIRC_MUD_PER_HOUR * time : 0);
  consumeSupply(ctx, 'drilling_mud', mudBbl, w);
  if (w.mudWeight > 9.5) consumeSupply(ctx, 'barite', (w.mudWeight - 9.5) * BARITE_PER_BLOCK_PER_PPG * step, w);
  consumeSupply(ctx, 'drill_pipe', PIPE_WEAR_PER_BLOCK * hard * step, w);
  w.bitCondition = Math.max(0, w.bitCondition - (step * 100) / ((BIT_LIFE_BLOCKS * ctx.modifier('bit_life')) / Math.pow(hard, 1.2)));
  w.measuredDepth = Math.min(w.plannedDepth, md + step);
  updateTrajectory(ctx, rt, w, pts);
  processBlocks(ctx, rt, w, pts);
  if (w.measuredDepth - e.progressMd >= 2 || w.measuredDepth >= w.plannedDepth) {
    e.progressMd = w.measuredDepth;
    ctx.bus.emit('well:progress', { id: w.id, depth: w.measuredDepth });
  }
  const remaining = budget - time;
  // Well control & hole problems in the open hole below the deepest shoe (hazard events only with hazards on).
  if (tvd > 400 && by < shoeY(w)) {
    checkLosses(ctx, w, bx, by, bz, tvd);
    if (hazardsEnabled(ctx) && checkKick(ctx, rt, w, rig, props, porePpg, time)) return remaining;
  }
  checkAquifers(ctx, rt, w);
  // Casing points (not the TD point — handled at TD).
  const cps = w.plan.casingPoints;
  if (e.nextCasing < cps.length && cps[e.nextCasing] >= w.currentY - 1e-6 && cps[e.nextCasing] > w.plan.targetY + 0.5) {
    startCasing(ctx, rt, w, cps[e.nextCasing], false);
    return remaining;
  }
  if (w.measuredDepth >= w.plannedDepth - 1e-6) {
    // Production casing at TD when planned; otherwise TD immediately (open hole / completion liner).
    if (e.nextCasing < cps.length) {
      startCasing(ctx, rt, w, w.plan.targetY, true);
      return remaining;
    }
    reachTD(ctx, rt, w);
    return remaining;
  }
  if (w.bitCondition < BIT_TRIP_THRESHOLD) startTrip(ctx, w, rig.type);
  return remaining;
}

function updateTrajectory(ctx: GameContext, rt: UpstreamRuntime, w: WellState, pts: Vec3[]): void {
  const e = ux(w);
  const md = w.measuredDepth;
  const k = Math.min(pts.length - 1, Math.floor(md));
  // trajectory = planned points 0..k plus the bit position.
  const tr = w.trajectory;
  while (tr.length > 0 && tr.length > k + 1) tr.pop();
  if (tr.length === k + 1 && md - k > 1e-6) tr.pop();
  for (let i = tr.length; i <= k; i++) tr.push({ ...pts[i] });
  if (md - k > 1e-6) {
    const b = posAtMd(pts, md);
    tr.push({ x: b.x, y: b.y, z: b.z });
  }
  const bit = tr[tr.length - 1];
  w.currentY = bit.y;
  // Casing blocks: sample every 0.25 block of MD; write each new cell below the pad.
  const world = ctx.world;
  const limitY = w.surfaceY - 2;
  const end = Math.floor(md * 4);
  let last = -1;
  for (let i = e.cellIdx; i <= end; i++) {
    posAtMd(pts, i / 4, tmp);
    const cx = Math.floor(tmp.x), cy = Math.floor(tmp.y), cz = Math.floor(tmp.z);
    if (cy > limitY) continue;
    const key = (cy * 4096 + cz) * 4096 + cx;
    if (key === last) continue;
    last = key;
    const cur = world.getBlock(cx, cy, cz);
    if (cur === B.CASING || cur === B.STRUCTURE || cur === B.BEDROCK) continue;
    world.setBlock(cx, cy, cz, B.CASING, 'system');
  }
  e.cellIdx = end + 1;
}

/** Process each newly completed block of measured depth: logs, contacts, penetration. */
function processBlocks(ctx: GameContext, rt: UpstreamRuntime, w: WellState, pts: Vec3[]): void {
  const e = ux(w);
  const atTD = w.measuredDepth >= w.plannedDepth - 1e-6;
  const upto = atTD ? Math.ceil(w.measuredDepth - 1e-6) : Math.floor(w.measuredDepth);
  const logging = ctx.hasTech('well_logging');
  for (let i = e.mdDone + 1; i <= upto; i++) {
    const a = posAtMd(pts, i - 1);
    const b = posAtMd(pts, Math.min(i, w.plannedDepth));
    const mx = Math.floor((a.x + b.x) / 2), my = Math.floor((a.y + b.y) / 2), mz = Math.floor((a.z + b.z) / 2);
    const p = ctx.geology.properties(mx, my, mz);
    w.log.push(logSample(ctx, i, my, p, logging));
    if (p.reservoirId) {
      const R = rt.reservoir(p.reservoirId);
      if (R) {
        const rs = ctx.state.reservoirs[R.id];
        let c = e.res[R.id];
        if (!c) c = e.res[R.id] = { contact: 0, hc: 0, hEff: 0, minY: my, maxY: my, pL: rs?.pressure ?? R.initialPressure, fracPsi: ctx.geology.fracturePressure(mx, my, mz) };
        c.contact++;
        if (p.fluid === 'oil' || p.fluid === 'gas') {
          c.hc++;
          const dv = Math.abs(a.y - b.y);
          const dh = Math.hypot(a.x - b.x, a.z - b.z);
          c.hEff += dv + (R.trap === 'shale_play' || R.permeability < 1 ? LATERAL_WEIGHT_TIGHT : LATERAL_WEIGHT_CONV) * dh;
          c.minY = Math.min(c.minY, my);
          c.maxY = Math.max(c.maxY, my);
          if (!w.penetrated.includes(R.id)) penetrate(ctx, w, R, my);
        }
      }
    }
    w.reservoirContact = Object.entries(e.res).reduce((s, [id, c]) => s + (w.penetrated.includes(id) ? c.contact : 0), 0);
  }
  e.mdDone = Math.max(e.mdDone, upto);
}

function logSample(ctx: GameContext, md: number, y: number, p: RockProperties, logging: boolean): WellLogSample {
  const hc = p.fluid === 'gas' ? 260 : p.fluid === 'oil' ? 95 : p.rock === 'coal' ? 45 : 0;
  const gasShow = Math.round((3 + (hc * clamp(p.porosity / 0.2, 0.2, 1.5) + 4) * (0.75 + 0.5 * ctx.rng())) * 10) / 10;
  if (!logging) return { md, y, gammaRay: NaN, resistivity: NaN, porosity: NaN, density: NaN, fluid: 'none', rock: p.rock, gasShow };
  return { md, y, gammaRay: p.gammaRay, resistivity: p.resistivity, porosity: p.porosity, density: p.density, fluid: p.fluid, rock: p.rock, gasShow };
}

/** First hydrocarbon block of a reservoir in this well: penetration & (maybe) discovery. */
function penetrate(ctx: GameContext, w: WellState, R: Reservoir, y: number): void {
  w.penetrated.push(R.id);
  const rs = ctx.state.reservoirs[R.id];
  if (!rs) return;
  const rext = rx(rs);
  const firstEver = !rext.firstWell;
  rs.discovered = true;
  rs.knowledge = Math.min(0.98, Math.max(rs.knowledge, 0.55) + (firstEver ? 0 : 0.12));
  if (firstEver) {
    rext.firstWell = w.id;
    ctx.bus.emit('well:discovery', { id: w.id, reservoirId: R.id, fluid: R.fluid });
    const f = 1 + rext.estError * Math.pow(1 - rs.knowledge, 1.5);
    const vol = R.fluid === 'oil' ? `~${fmtVol(R.oilInPlace * f, 'bbl')} of oil in place` : `~${fmtVol(R.gasInPlace * f, 'mcf')} of gas in place${R.fluid === 'condensate' ? ' (rich in condensate)' : ''}`;
    const thick = Math.max(1, R.topY - R.bottomY) * 40 * R.netToGross;
    const sour = R.h2s > 0.01 ? ' Warning: sour gas (H₂S) — production needs chemicals.' : '';
    const tight = R.permeability < 1 ? ' Tight rock: plan horizontal wells and hydraulic fracturing.' : '';
    ctx.notify('success', `Discovery! ${w.name} hit ${R.name}`, `${R.fluid === 'oil' ? 'Oil' : R.fluid === 'gas' ? 'Gas' : 'Gas-condensate'} shows at ${depthM(w.surfaceY, y)} m. Estimated ${vol}, ~${Math.round(thick)} m of net reservoir.${tight}${sour}`, wellPos(w));
  } else {
    ctx.notify('info', `${w.name} entered ${R.name}`, `${R.fluid === 'oil' ? 'Oil' : 'Gas'} pay at ${depthM(w.surfaceY, y)} m.`, wellPos(w));
  }
}

/** Mud weight above the weakest fracture gradient in the open hole → lost circulation. */
function checkLosses(ctx: GameContext, w: WellState, bx: number, by: number, bz: number, tvd: number): void {
  const e = ux(w);
  if (tvd < 50) return;
  const fracPpg = psiToPpg(ctx.geology.fracturePressure(bx, by, bz), tvd);
  e.fracMin = Math.min(e.fracMin ?? Infinity, fracPpg);
  const losing = w.mudWeight > e.fracMin + 0.05;
  if (losing && !e.lostCirc) {
    e.lostCirc = true;
    ctx.notify('warning', `${w.name}: lost circulation`, `Mud (${w.mudWeight.toFixed(1)} ppg) is fracturing weak rock (${e.fracMin.toFixed(1)} ppg). Losses cost mud and slow drilling; the falling mud column can trigger a kick. Lower the mud weight or run casing.`, wellPos(w));
  } else if (!losing) e.lostCirc = false;
}

/** Drilling below a fresh-water aquifer without surface casing across it → contamination. */
function checkAquifers(ctx: GameContext, rt: UpstreamRuntime, w: WellState): void {
  const e = ux(w);
  if (e.contaminated || !hazardsEnabled(ctx)) return;
  for (const a of rt.freshAquifersAt(w.x, w.z)) {
    // Exposure becomes contamination once the hole is well below the aquifer (or into pressured pay) uncased.
    if ((w.currentY < a.bottomY - 10 || w.penetrated.length > 0) && w.currentY < a.bottomY && !casingCovers(w, a.bottomY)) {
      e.contaminated = true;
      const env = ctx.state.environment;
      env.score = Math.max(0, env.score - 10);
      env.violations += 1;
      env.finesTotal += AQUIFER_FINE;
      ctx.transact(-AQUIFER_FINE, 'fines', `${w.name}: groundwater contamination`);
      ctx.state.hazards.incidents.push({ day: ctx.state.time.day, kind: 'spill', text: `${w.name} contaminated a fresh-water aquifer (no surface casing)`, x: w.x, z: w.z });
      ctx.state.hazards.daysSinceIncident = 0;
      ctx.notify('danger', `${w.name}: aquifer contaminated`, `Drilling fluids invaded the fresh-water aquifer at ${depthM(w.surfaceY, a.topY)}–${depthM(w.surfaceY, a.bottomY)} m because it was not isolated by surface casing. Fined ${fmtMoney(AQUIFER_FINE)}; community standing fell. Always set surface casing below fresh aquifers.`, wellPos(w));
      return;
    }
  }
}

/** Total depth reached. */
export function reachTD(ctx: GameContext, rt: UpstreamRuntime, w: WellState): void {
  const e = ux(w);
  e.op = undefined;
  w.plannedDepth = Math.max(w.measuredDepth, 0);
  setWellStatus(ctx, w, 'drilled');
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  if (rig) setUpstreamBuildingStatus(ctx, rig, false, 0);
  ctx.bus.emit('well:progress', { id: w.id, depth: w.measuredDepth });
  const injector = w.purpose.startsWith('injector') || w.purpose === 'disposal';
  if (w.penetrated.length === 0) {
    if (!injector) {
      ctx.state.stats.dryHoles++;
      ctx.bus.emit('well:dryHole', { id: w.id });
      ctx.notify('warning', `${w.name}: dry hole`, `TD ${depthM(w.surfaceY, w.currentY)} m with no commercial hydrocarbons. Plug & abandon it (the logs still help map the area).`, wellPos(w));
    } else ctx.notify('info', `${w.name} reached TD`, `Ready to complete as ${w.purpose === 'disposal' ? 'a disposal well' : 'an injector'}.`, wellPos(w));
    return;
  }
  const pays = w.penetrated.map((id) => {
    const R = rt.reservoir(id);
    const c = e.res[id];
    return R && c ? `${R.name}: ${Math.round(c.hc * 40 * R.netToGross)} m net pay` : id;
  });
  ctx.notify('success', `${w.name} reached TD (${fmtInt(depthM(w.surfaceY, w.currentY))} m)`, `${pays.join(', ')}. Well cost so far ${fmtMoney(w.cost)}. Complete the well to start production.`, wellPos(w));
}

const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US');

/** Blowout wells tick here as part of the drilling system. */
export function tickBlowoutWell(ctx: GameContext, rt: UpstreamRuntime, w: WellState, hours: number): void {
  tickBlowout(ctx, rt, w, hours);
}

/** Clamp a mud weight to the allowed window. */
export const clampMud = (v: number) => Math.round(clamp(v, MUD_MIN_PPG, MUD_MAX_PPG) * 10) / 10;
