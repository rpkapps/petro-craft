// Completion, hydraulic fracturing, artificial lift & conversion workovers, shut-in, plug & abandon.
import { addBuilding, createBuildingState, crewFactor, isOperational, removeBuilding } from '../../core/buildingUtil';
import type { Command, CommandResult } from '../../core/commands';
import type { GameContext, LiftType, WellPurpose, WellState } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { mdAtY, rigEfficiency, shoeY } from './drilling';
import {
  CASING_JOINTS_PER_BLOCK, COMPLETION_BASE_COST, COMPLETION_COST_PER_CONTACT, COMPLETION_HOURS_BASE, COMPLETION_HOURS_PER_CONTACT,
  CONVERT_COST, CONVERT_HOURS, FRAC_COST_PER_STAGE, FRAC_HOURS_PER_STAGE, FRAC_PROPPANT_PER_STAGE, FRAC_RANGE, FRAC_WATER_PER_STAGE,
  LIFT_SPECS, LINER_COST_PER_BLOCK, MAX_FRAC_STAGES, PLUG_COST_BASE, PLUG_COST_PER_BLOCK, WATER_TRUCKING_PER_BBL,
} from './tuning';
import { accrue, charge, isInjectorPurpose, setWellStatus, ux, wellPos, type WellOp } from './wellData';
import { clamp, consumeSupply, distTo, fmtMoney, fmtInt, hasFeature, setUpstreamBuildingStatus, techName } from './util';

const PURPOSES: WellPurpose[] = ['exploration', 'appraisal', 'development', 'injector_water', 'injector_gas', 'injector_co2', 'disposal'];

// ---- Completion ------------------------------------------------------------------------------------------

export function cmdComplete(cmd: Command<'well/complete'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (w.status !== 'drilled') return { ok: false, error: w.status === 'completing' ? 'Completion already in progress' : 'Only wells that reached TD can be completed' };
  const e = ux(w);
  const injector = isInjectorPurpose(w.purpose);
  const candidates = injector ? Object.keys(e.res).filter((id) => e.res[id].contact > 0) : w.penetrated.slice();
  let ids = candidates;
  if (Array.isArray(cmd.reservoirIds) && cmd.reservoirIds.length) ids = candidates.filter((id) => cmd.reservoirIds!.includes(id));
  if (!injector && ids.length === 0) return { ok: false, error: w.penetrated.length ? 'Select at least one penetrated reservoir to perforate' : 'No hydrocarbons penetrated — plug & abandon this dry hole' };
  if (injector && ids.length === 0 && w.purpose !== 'disposal') return { ok: false, error: 'Injectors must be completed in a reservoir (the well did not reach one)' };
  const contact = ids.reduce((s, id) => s + (e.res[id]?.contact ?? 0), 0);
  // Liner through any open hole below the deepest casing shoe.
  const shoe = shoeY(w);
  const openHole = shoe > w.currentY + 0.5 ? Math.max(0, w.measuredDepth - mdAtY(rt, w, shoe)) : 0;
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  const noRig = !rig || rig.status === 'destroyed';
  const cost = Math.round((COMPLETION_BASE_COST + COMPLETION_COST_PER_CONTACT * contact + LINER_COST_PER_BLOCK * openHole) * (noRig ? 1.3 : 1));
  if (!charge(ctx, w, cost, 'drilling', `${w.name}: completion`, true)) return { ok: false, error: `Not enough money: completion costs ${fmtMoney(cost)}` };
  if (openHole > 0) consumeSupply(ctx, 'casing', openHole * CASING_JOINTS_PER_BLOCK, w);
  const hours = COMPLETION_HOURS_BASE + COMPLETION_HOURS_PER_CONTACT * contact;
  e.op = { kind: 'complete', label: injector ? 'Completing injector' : 'Perforating & running tubing', hoursLeft: hours, hoursTotal: hours, reservoirIds: ids };
  if (openHole > 0) e.op.casingY = w.currentY;
  setWellStatus(ctx, w, 'completing');
  return { ok: true, data: { cost, hours } };
}

function finishComplete(ctx: GameContext, rt: UpstreamRuntime, w: WellState, op: WellOp): void {
  const e = ux(w);
  const ids = op.reservoirIds ?? w.penetrated;
  w.completedReservoirs = ids.slice();
  w.reservoirContact = ids.reduce((s, id) => s + (e.res[id]?.contact ?? 0), 0);
  for (const id of ids) {
    const c = e.res[id];
    const s = ctx.state.reservoirs[id];
    if (c && s) {
      c.pL = s.pressure;
      c.srvDay = ctx.state.time.day;
    }
  }
  if (op.casingY !== undefined) w.casing.push({ name: 'liner', topY: shoeY(w) + 1, bottomY: op.casingY, cemented: true });
  // Completion quality (skin) varies a little from job to job.
  e.baseProductivity = Math.round((0.85 + 0.3 * ctx.rng()) * 100) / 100;
  w.productivity = e.baseProductivity;
  w.lift = 'natural';
  w.choke = w.choke > 0 ? w.choke : 1;
  w.completedDay = ctx.state.time.day;
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  if (!w.offshore) {
    const wh = createBuildingState(ctx, 'wellhead', w.x - 1, w.surfaceY, w.z - 1, 0, { prebuilt: true, owner: w.owner });
    wh.wellId = w.id;
    if (rig && rig.status !== 'destroyed') wh.data.underRig = rig.id;
    wh.data.lift = w.lift;
    wh.data.wellStatus = w.status;
    addBuilding(ctx, wh);
    w.wellheadId = wh.id;
  }
  if (rig && rig.wellId === w.id) {
    rig.wellId = undefined;
    setUpstreamBuildingStatus(ctx, rig, false, 0);
  }
  const injector = isInjectorPurpose(w.purpose);
  setWellStatus(ctx, w, injector ? 'injecting' : 'producing');
  ctx.state.stats.wellsDrilled++;
  ctx.bus.emit('well:completed', { id: w.id });
  const where = w.offshore ? 'Production flows to the nearest platform (≤24 blocks) or FPSO (≤40 blocks).' : 'Connect oil, gas and water pipelines to the wellhead.';
  ctx.notify('success', `${w.name} completed`, `${injector ? 'Injector ready — supply it with water/gas through the wellhead.' : where} The rig is free to skid to the next location. All-in well cost ${fmtMoney(w.cost)}.`, wellPos(w));
}

// ---- Frac --------------------------------------------------------------------------------------------------

/** Productivity multiplier of hydraulic fracturing for rock permeability k (mD) and stage density. */
export function fracMultiplier(k: number, stages: number, contact: number): number {
  const t = clamp((Math.log10(Math.max(1e-4, k)) + 2) / 3, 0, 1); // k=0.01 → 0, k=10 → 1
  const M = 15 * (1 - t) + 1.6 * t;
  const effect = 1 - Math.exp((-1.2 * stages) / Math.max(1, contact));
  return 1 + (M - 1) * effect;
}

export function cmdFrac(cmd: Command<'well/frac'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (!hasFeature(ctx, 'hydraulic_fracturing', 'fracking')) return { ok: false, error: 'Requires Hydraulic Fracturing research' };
  if (w.offshore) return { ok: false, error: 'Offshore wells cannot be fracked from a land frac spread' };
  if (!['producing', 'shut_in', 'injecting'].includes(w.status)) return { ok: false, error: 'Complete the well before fracturing it' };
  const e = ux(w);
  if (e.op) return { ok: false, error: `${e.op.label} in progress` };
  if (w.completedReservoirs.length === 0) return { ok: false, error: 'No perforated reservoir to fracture' };
  const wh = w.wellheadId ? ctx.state.buildings[w.wellheadId] : undefined;
  const cx = wh ? wh.x + wh.size[0] / 2 : w.x + 0.5;
  const cz = wh ? wh.z + wh.size[1] / 2 : w.z + 0.5;
  let spread;
  let bd = FRAC_RANGE;
  for (const b of Object.values(ctx.state.buildings)) {
    if (b.type !== 'frac_spread' || !isOperational(b)) continue;
    const d = distTo(b, cx, cz);
    if (d <= bd) {
      bd = d;
      spread = b;
    }
  }
  if (!spread) return { ok: false, error: `Place an operational Frac Spread within ${FRAC_RANGE} blocks of the wellhead` };
  if (spread.wellId && spread.wellId !== w.id && ctx.state.wells[spread.wellId]?.status === 'fracking') return { ok: false, error: 'That frac spread is busy on another well' };
  const maxStages = Math.min(MAX_FRAC_STAGES, Math.max(2, Math.ceil(w.reservoirContact * 2)));
  const stages = Math.round(Number(cmd.stages));
  if (!(stages >= 1)) return { ok: false, error: 'Choose at least one frac stage' };
  if (stages > maxStages) return { ok: false, error: `At most ${maxStages} stages for ${w.reservoirContact * 40} m of reservoir contact` };
  const cost = FRAC_COST_PER_STAGE * stages;
  if (!charge(ctx, w, cost, 'drilling', `${w.name}: ${stages}-stage frac`, true)) return { ok: false, error: `Not enough money: pumping services cost ${fmtMoney(cost)} (+ sand & water)` };
  const hours = FRAC_HOURS_PER_STAGE * stages;
  e.op = { kind: 'frac', label: `Fracturing (${stages} stages)`, hoursLeft: hours, hoursTotal: hours, stages, stagesDone: 0, spreadId: spread.id, resume: w.status };
  spread.wellId = w.id;
  setWellStatus(ctx, w, 'fracking');
  ctx.notify('info', `${w.name}: frac job started`, `${stages} stages, ~${Math.round(hours)} h. Needs ${fmtInt(stages * FRAC_PROPPANT_PER_STAGE)} t sand and ${fmtInt(stages * FRAC_WATER_PER_STAGE)} bbl water (trucked at $${WATER_TRUCKING_PER_BBL}/bbl if the spread's water tank runs dry).`, wellPos(w));
  return { ok: true, data: { cost, hours, stages } };
}

/** Consume sand & water for each finished stage. */
function fracStageMaterials(ctx: GameContext, w: WellState, op: WellOp): void {
  const spread = op.spreadId ? ctx.state.buildings[op.spreadId] : undefined;
  const total = op.stages ?? 1;
  const done = Math.min(total, Math.floor(((op.hoursTotal - op.hoursLeft) / op.hoursTotal) * total + 1e-6));
  while ((op.stagesDone ?? 0) < done) {
    op.stagesDone = (op.stagesDone ?? 0) + 1;
    consumeSupply(ctx, 'proppant', FRAC_PROPPANT_PER_STAGE, w);
    let need = FRAC_WATER_PER_STAGE;
    if (spread) {
      for (const it of ['fresh_water', 'produced_water']) {
        const have = spread.storage[it] ?? 0;
        const t = Math.min(have, need);
        if (t > 0) {
          spread.storage[it] = have - t;
          need -= t;
        }
      }
    }
    if (need > 0) accrue(w, 'supplies', need * WATER_TRUCKING_PER_BBL);
  }
}

function finishFrac(ctx: GameContext, rt: UpstreamRuntime, w: WellState, op: WellOp): void {
  const e = ux(w);
  fracStageMaterials(ctx, w, op);
  w.fracStages += op.stages ?? 0;
  let k = Infinity;
  for (const id of w.completedReservoirs) k = Math.min(k, rt.reservoir(id)?.permeability ?? Infinity);
  if (!Number.isFinite(k)) k = 1;
  const before = w.productivity;
  w.productivity = Math.round(e.baseProductivity * fracMultiplier(k, w.fracStages, Math.max(1, w.reservoirContact)) * 100) / 100;
  // New fractures reach fresh rock: near-well pressure recovers toward the reservoir's.
  for (const id of w.completedReservoirs) {
    const c = e.res[id];
    const s = ctx.state.reservoirs[id];
    if (c && s) {
      c.pL += 0.6 * (s.pressure - c.pL);
      c.srvDay = ctx.state.time.day;
    }
  }
  const spread = op.spreadId ? ctx.state.buildings[op.spreadId] : undefined;
  if (spread) {
    if (spread.wellId === w.id) spread.wellId = undefined;
    setUpstreamBuildingStatus(ctx, spread, false, 0);
  }
  setWellStatus(ctx, w, op.resume ?? 'producing');
  ctx.notify('success', `${w.name}: frac complete`, `${op.stages} stages pumped. Productivity ×${(w.productivity / Math.max(0.01, before)).toFixed(1)} (index ${w.productivity.toFixed(2)}).`, wellPos(w));
}

// ---- Lift, choke, shut-in, conversion, rename --------------------------------------------------------------

export function cmdSetLift(cmd: Command<'well/setLift'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  const lift = cmd.lift as LiftType;
  const spec = LIFT_SPECS[lift];
  if (!spec) return { ok: false, error: 'Unknown lift type' };
  if (w.status !== 'producing' && w.status !== 'shut_in') return { ok: false, error: 'Artificial lift can only be installed on producing or shut-in wells' };
  if (isInjectorPurpose(w.purpose)) return { ok: false, error: 'Injectors do not need artificial lift' };
  const e = ux(w);
  if (e.op) return { ok: false, error: `${e.op.label} in progress` };
  if (w.lift === lift) return { ok: false, error: 'That lift is already installed' };
  if (spec.tech && !ctx.hasTech(spec.tech)) return { ok: false, error: `Requires ${techName(spec.tech)} research` };
  if (w.offshore && lift === 'pumpjack') return { ok: false, error: 'Pumpjacks cannot be used offshore — use an ESP or gas lift' };
  const gasWell = w.completedReservoirs.some((id) => rt.reservoir(id)?.fluid !== 'oil');
  if (gasWell && lift === 'esp') return { ok: false, error: 'ESPs are for oil wells — gas wells use a pumpjack (dewatering) or gas lift' };
  if (!charge(ctx, w, spec.cost, 'drilling', `${w.name}: install ${lift === 'natural' ? 'natural-flow completion' : lift}`, true)) return { ok: false, error: `Not enough money (${fmtMoney(spec.cost)})` };
  const label = lift === 'natural' ? 'Pulling artificial lift' : `Installing ${lift === 'esp' ? 'an ESP' : lift === 'gaslift' ? 'gas lift' : 'a pumpjack'}`;
  e.op = { kind: 'workover', label, hoursLeft: spec.hours, hoursTotal: spec.hours, lift, resume: w.status };
  return { ok: true, data: { cost: spec.cost, hours: spec.hours } };
}

export function cmdSetChoke(cmd: Command<'well/setChoke'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (!Number.isFinite(cmd.choke)) return { ok: false, error: 'Invalid choke setting' };
  w.choke = clamp(cmd.choke, 0, 1);
  return { ok: true };
}

export function cmdShutIn(cmd: Command<'well/shutIn'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  const e = ux(w);
  if (cmd.shutIn) {
    if (w.status === 'shut_in') {
      e.manualShutIn = true;
      return { ok: true };
    }
    if (w.status !== 'producing' && w.status !== 'injecting') return { ok: false, error: 'Only producing or injecting wells can be shut in' };
    e.prevStatus = w.status;
    e.manualShutIn = true;
    setWellStatus(ctx, w, 'shut_in');
    return { ok: true };
  }
  if (w.status !== 'shut_in') return { ok: false, error: 'The well is not shut in' };
  e.manualShutIn = false;
  if (e.autoShutIn) return { ok: false, error: 'Offshore wells stay shut in until the storm passes' };
  setWellStatus(ctx, w, e.prevStatus ?? (isInjectorPurpose(w.purpose) ? 'injecting' : 'producing'));
  return { ok: true };
}

export function cmdConvert(cmd: Command<'well/convert'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  const p = cmd.purpose;
  if (!PURPOSES.includes(p)) return { ok: false, error: 'Unknown well purpose' };
  if (p === w.purpose) return { ok: false, error: 'The well already has that purpose' };
  if (p === 'injector_water' && !hasFeature(ctx, 'waterflood', 'injector_water')) return { ok: false, error: 'Water injection requires Waterflooding research' };
  if (p === 'injector_co2' && !hasFeature(ctx, 'co2_eor', 'injector_co2')) return { ok: false, error: 'CO₂ injection requires CO₂ Enhanced Recovery research' };
  const e = ux(w);
  if (e.op) return { ok: false, error: `${e.op.label} in progress` };
  if (['planned', 'drilling', 'tripping', 'casing', 'drilled'].includes(w.status)) {
    w.purpose = p;
    return { ok: true };
  }
  if (!['producing', 'shut_in', 'injecting'].includes(w.status)) return { ok: false, error: 'This well cannot be converted in its current state' };
  if (isInjectorPurpose(p) && p !== 'disposal' && w.completedReservoirs.length === 0) return { ok: false, error: 'Injectors must be completed in a reservoir' };
  if (!charge(ctx, w, CONVERT_COST, 'drilling', `${w.name}: conversion workover`, true)) return { ok: false, error: `Not enough money (${fmtMoney(CONVERT_COST)})` };
  e.op = { kind: 'workover', label: isInjectorPurpose(p) ? 'Converting to injector' : 'Converting to producer', hoursLeft: CONVERT_HOURS, hoursTotal: CONVERT_HOURS, purpose: p, resume: isInjectorPurpose(p) ? 'injecting' : 'producing' };
  return { ok: true, data: { cost: CONVERT_COST, hours: CONVERT_HOURS } };
}

export function cmdRename(cmd: Command<'well/rename'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  const name = String(cmd.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (!name) return { ok: false, error: 'Enter a name' };
  w.name = name;
  return { ok: true };
}

function finishWorkover(ctx: GameContext, w: WellState, op: WellOp): void {
  const e = ux(w);
  if (op.lift) {
    w.lift = op.lift;
    e.flags.loaded = false;
    ctx.notify('success', `${w.name}: ${op.lift === 'natural' ? 'lift removed' : `${op.lift === 'esp' ? 'ESP' : op.lift === 'gaslift' ? 'gas lift' : 'pumpjack'} installed`}`, op.lift === 'pumpjack' || op.lift === 'esp' ? 'Artificial lift needs electric power.' : undefined, wellPos(w));
  }
  if (op.purpose) {
    w.purpose = op.purpose;
    if (isInjectorPurpose(op.purpose)) w.lift = 'natural';
    w.rates = { oil: 0, gas: 0, water: 0 };
    ctx.notify('success', `${w.name} converted`, isInjectorPurpose(op.purpose) ? 'Now injecting — feed it through the wellhead water/gas ports.' : 'Back on production.', wellPos(w));
  }
  if (op.purpose) {
    const target = op.resume ?? (isInjectorPurpose(op.purpose) ? 'injecting' : 'producing');
    if (w.status === 'shut_in' && e.manualShutIn) e.prevStatus = target;
    else setWellStatus(ctx, w, target);
  }
}

// ---- Plug & abandon -----------------------------------------------------------------------------------------

export function cmdPlugAbandon(cmd: Command<'well/plugAbandon'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  const e = ux(w);
  if (w.status === 'plugged' || w.status === 'dry_hole') return { ok: false, error: 'Already plugged' };
  if (w.status === 'kick' || w.status === 'blowout') return { ok: false, error: 'Bring the well under control first' };
  if (e.op && (e.op.kind === 'complete' || e.op.kind === 'frac' || e.op.kind === 'workover')) return { ok: false, error: `${e.op.label} in progress` };
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  if (w.status === 'planned') {
    if (rig && rig.wellId === w.id) rig.wellId = undefined;
    delete ctx.state.wells[w.id];
    rt.forgetWell(w.id);
    return { ok: true, data: { cancelled: true } };
  }
  const cost = Math.round(PLUG_COST_BASE + PLUG_COST_PER_BLOCK * w.measuredDepth);
  // Abandonment is a legal obligation: it always proceeds (on credit if necessary).
  charge(ctx, w, cost, 'drilling', `${w.name}: plug & abandon`, false);
  e.op = undefined;
  if (rig && rig.wellId === w.id) {
    rig.wellId = undefined;
    setUpstreamBuildingStatus(ctx, rig, false, 0);
  }
  if (w.wellheadId) {
    for (const b of Object.values(ctx.state.buildings)) if (b.type === 'frac_spread' && b.wellId === w.id) b.wellId = undefined;
    removeBuilding(ctx, w.wellheadId);
    w.wellheadId = undefined;
  }
  w.rates = { oil: 0, gas: 0, water: 0 };
  w.kickVolume = 0;
  const dry = w.penetrated.length === 0 && w.cumulative.oil <= 0 && w.cumulative.gas <= 0;
  setWellStatus(ctx, w, dry ? 'dry_hole' : 'plugged');
  ctx.notify('info', `${w.name} plugged & abandoned`, `Cement plugs set; site restored. Cost ${fmtMoney(cost)}.`, wellPos(w));
  return { ok: true, data: { cost } };
}

// ---- Op ticking --------------------------------------------------------------------------------------------

/** Progress completion / frac / workover ops (wells not in drilling statuses). */
export function tickWellOp(ctx: GameContext, rt: UpstreamRuntime, w: WellState, hours: number): void {
  const e = ux(w);
  const op = e.op;
  if (!op) return;
  let rate = 1;
  if (op.kind === 'complete') {
    const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
    if (rig && rig.status !== 'destroyed') {
      const { eff } = rigEfficiency(ctx, rig);
      rate = Math.max(0.25, eff);
      setUpstreamBuildingStatus(ctx, rig, eff > 0, eff);
    }
  } else if (op.kind === 'frac') {
    const spread = op.spreadId ? ctx.state.buildings[op.spreadId] : undefined;
    if (!spread || !isOperational(spread)) rate = 0;
    else {
      rate = Math.min(1.2, crewFactor(ctx.state, spread));
      setUpstreamBuildingStatus(ctx, spread, rate > 0, rate);
    }
    e.limit = rate > 0 ? op.label : 'Frac spread not operational or unstaffed';
  }
  if (rate <= 0) return;
  op.hoursLeft -= hours * rate;
  if (op.kind === 'frac') fracStageMaterials(ctx, w, op);
  if (op.hoursLeft <= 1e-6) finishOp(ctx, rt, w, op);
}

/** Finish a completion-phase op. */
export function finishOp(ctx: GameContext, rt: UpstreamRuntime, w: WellState, op: WellOp): void {
  const e = ux(w);
  e.op = undefined;
  if (op.kind === 'complete') finishComplete(ctx, rt, w, op);
  else if (op.kind === 'frac') finishFrac(ctx, rt, w, op);
  else if (op.kind === 'workover') finishWorkover(ctx, w, op);
}
