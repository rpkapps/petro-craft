// Upstream command handlers: registration + planning/spud/mud/casing/skid handlers.
import { BUILDINGS } from '../../content/buildings';
import { addBuilding, clearStructure, createBuildingState, isOperational, RIG_TYPES, removeBuilding, writeStructure } from '../../core/buildingUtil';
import type { Command, CommandResult } from '../../core/commands';
import type { GameContext, WellPurpose, WellState } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { cmdSurveyCancel, cmdSurveyStart } from './exploration';
import { buildMudProgram, clampMud, shoeY, startCasing } from './drilling';
import { cmdCapBlowout, cmdControlKick } from './wellControl';
import { cmdComplete, cmdConvert, cmdFrac, cmdPlugAbandon, cmdRename, cmdSetChoke, cmdSetLift, cmdShutIn } from './completion';
import { nextWellName } from './naming';
import { quoteWell, validatePlan } from './planning';
import { pathLength } from './trajectory';
import { MUD_INITIAL, RIG_SPECS, SKID_BASE_COST, SKID_COST_PER_BLOCK, SKID_RIGUP_PROGRESS } from './tuning';
import { charge, newWellExt, RIG_BUSY_STATUSES, setWellStatus, ux, wellPos, type UpWell } from './wellData';
import { consumeSupply, depthM, fmtMoney, hasFeature, ownsLease, rigWellLocation, setUpstreamBuildingStatus } from './util';

const PURPOSES: WellPurpose[] = ['exploration', 'appraisal', 'development', 'injector_water', 'injector_gas', 'injector_co2', 'disposal'];
const LEASE_ERROR = 'Acquire the mineral lease for this parcel first (Map → Leases)';

function suspended(ctx: GameContext): string | undefined {
  const until = ctx.state.environment.suspendedUntilDay;
  if (until !== undefined && until > ctx.state.time.day) return `Regulators have suspended new drilling until day ${until} (environmental violations)`;
  return undefined;
}

/** The rig's current active (unfinished) well, if any. */
export function rigActiveWell(ctx: GameContext, rigId: string): WellState | undefined {
  const rig = ctx.state.buildings[rigId];
  const w = rig?.wellId ? ctx.state.wells[rig.wellId] : undefined;
  return w && RIG_BUSY_STATUSES.has(w.status) ? w : undefined;
}

function cmdPlan(cmd: Command<'well/plan'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const rig = ctx.state.buildings[cmd.rigId];
  if (!rig || !RIG_TYPES.has(rig.type)) return { ok: false, error: 'Select a drilling rig' };
  if (rig.constructionProgress < 1) return { ok: false, error: 'The rig is still being built / rigged up' };
  if (!isOperational(rig)) return { ok: false, error: `The rig is not operational (${rig.status})` };
  const active = rigActiveWell(ctx, rig.id);
  if (active) return { ok: false, error: `This rig is busy with ${active.name} (${active.status.replace('_', ' ')}). Complete or plug it first.` };
  const sus = suspended(ctx);
  if (sus) return { ok: false, error: sus };
  const { x, z } = rigWellLocation(rig);
  const playerId = cmd.playerId ?? ctx.localPlayerId;
  if (!ownsLease(ctx, x, z, playerId)) return { ok: false, error: LEASE_ERROR };
  for (const w of Object.values(ctx.state.wells)) if (w.x === x && w.z === z) return { ok: false, error: `${w.name} already occupies this spot — skid the rig to a new location` };
  const spec = RIG_SPECS[rig.type];
  const offshore = ctx.geology.isOffshore(x, z);
  if (spec.offshore !== offshore) return { ok: false, error: offshore ? 'Offshore location: use a jack-up or semi-submersible rig' : 'Offshore rigs cannot drill on land' };
  if (offshore) {
    const def = BUILDINGS[rig.type];
    const wd = ctx.geology.waterDepth(x, z);
    const maxWd = (def.waterDepth?.[1] ?? 99) * ctx.modifier('offshore_depth');
    if (def.waterDepth && (wd < def.waterDepth[0] || wd > maxWd)) return { ok: false, error: `Water depth ${wd * 40} m is outside this rig's range` };
  }
  const purpose: WellPurpose = PURPOSES.includes(cmd.purpose) ? cmd.purpose : 'exploration';
  if (purpose === 'injector_water' && !hasFeature(ctx, 'waterflood', 'injector_water')) return { ok: false, error: 'Water injectors require Waterflooding research' };
  if (purpose === 'injector_co2' && !hasFeature(ctx, 'co2_eor', 'injector_co2')) return { ok: false, error: 'CO₂ injectors require CO₂ Enhanced Recovery research' };
  const surfaceY = rig.y;
  const v = validatePlan(ctx, rig.type, x, z, surfaceY, cmd.plan);
  if (!v.plan) return { ok: false, error: v.error ?? 'Invalid plan' };
  const plan = v.plan;
  const pts = rt.trajectory('__plan__', x, surfaceY, z, plan);
  const rawName = typeof cmd.name === 'string' ? cmd.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const w: UpWell = {
    id: ctx.newId('w'), name: rawName || nextWellName(ctx, x, z, plan.kind), x, z, surfaceY, offshore, purpose, status: 'planned', plan,
    trajectory: [], measuredDepth: 0, plannedDepth: pathLength(pts), currentY: surfaceY, rigId: rig.id, casing: [], mudWeight: plan.mudWeight,
    bitCondition: 100, kickVolume: 0, penetrated: [], completedReservoirs: [], reservoirContact: 0, fracStages: 0, choke: 1, lift: 'natural',
    productivity: 1, rates: { oil: 0, gas: 0, water: 0 }, bhp: 0, waterCut: 0, gor: 0, cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [],
    spudDay: 0, cost: 0, owner: playerId, up: newWellExt(),
  };
  ctx.state.wells[w.id] = w;
  rig.wellId = w.id;
  ctx.bus.emit('well:created', { id: w.id });
  const quote = quoteWell(ctx, rt, x, z, plan, rig.type);
  return { ok: true, data: { wellId: w.id, name: w.name, quote } };
}

function cmdSpud(cmd: Command<'well/spud'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (w.status !== 'planned') return { ok: false, error: 'The well has already been spudded' };
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  if (!rig || !isOperational(rig)) return { ok: false, error: 'The rig is not operational' };
  const sus = suspended(ctx);
  if (sus) return { ok: false, error: sus };
  if (!ownsLease(ctx, w.x, w.z, cmd.playerId ?? ctx.localPlayerId)) return { ok: false, error: LEASE_ERROR };
  const spec = RIG_SPECS[rig.type] ?? RIG_SPECS.drilling_rig_land;
  const mob = Math.round(spec.mobilisation * ctx.modifier('drill_cost'));
  if (!charge(ctx, w, mob, 'drilling', `${w.name}: spud & mobilisation`, true)) return { ok: false, error: `Not enough money: spud & mobilisation cost ${fmtMoney(mob)}` };
  const e = ux(w);
  e.mud = buildMudProgram(ctx, w);
  e.nextCasing = 0;
  w.mudWeight = e.mud[0]?.ppg ?? w.plan.mudWeight;
  w.spudDay = ctx.state.time.day;
  w.bitCondition = 100;
  w.casing = [{ name: 'conductor', topY: w.surfaceY - 1, bottomY: w.surfaceY - 3, cemented: true }];
  const pts = rt.trajectory(w.id, w.x, w.surfaceY, w.z, w.plan);
  w.plannedDepth = pathLength(pts);
  w.trajectory = [{ ...pts[0] }];
  consumeSupply(ctx, 'drill_bit', 1, w);
  consumeSupply(ctx, 'drilling_mud', MUD_INITIAL, w);
  setWellStatus(ctx, w, 'drilling');
  setUpstreamBuildingStatus(ctx, rig, true, 1);
  ctx.bus.emit('well:spud', { id: w.id });
  ctx.notify('info', `${w.name} spudded`, `Drilling to ${depthM(w.surfaceY, w.plan.targetY)} m TVD (${Math.round(w.plannedDepth * 40)} m MD) with ${w.mudWeight.toFixed(1)} ppg mud.`, wellPos(w));
  return { ok: true, data: { cost: mob } };
}

function cmdSetMudWeight(cmd: Command<'well/setMudWeight'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (!Number.isFinite(cmd.mudWeight)) return { ok: false, error: 'Invalid mud weight' };
  const mw = clampMud(cmd.mudWeight);
  if (w.status === 'planned') {
    w.plan.mudWeight = mw;
    w.mudWeight = mw;
    return { ok: true, data: { mudWeight: mw } };
  }
  if (!['drilling', 'tripping', 'casing', 'kick'].includes(w.status)) return { ok: false, error: 'Mud weight only matters while drilling' };
  const e = ux(w);
  const d = mw - w.mudWeight;
  if (d > 0) consumeSupply(ctx, 'barite', d * 25, w);
  else if (d < 0) consumeSupply(ctx, 'drilling_mud', -d * 120, w);
  w.mudWeight = mw;
  e.mudOverride = true;
  return { ok: true, data: { mudWeight: mw } };
}

function cmdRunCasing(cmd: Command<'well/runCasing'>, ctx: GameContext, rt: UpstreamRuntime): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  const e = ux(w);
  if (w.status !== 'drilling' || e.op) return { ok: false, error: 'Casing can be run while drilling ahead' };
  const y = Math.ceil(w.currentY);
  if (shoeY(w) - y < 2) return { ok: false, error: 'Drill at least 80 m below the last casing shoe first' };
  const cps = w.plan.casingPoints;
  cps.splice(e.nextCasing, 0, y);
  startCasing(ctx, rt, w, y, false);
  return { ok: true, data: { y } };
}

function cmdSkid(cmd: Command<'rig/skid'>, ctx: GameContext): CommandResult {
  const rig = ctx.state.buildings[cmd.rigId];
  if (!rig || !RIG_TYPES.has(rig.type)) return { ok: false, error: 'Select a drilling rig' };
  if (rig.status === 'destroyed') return { ok: false, error: 'The rig is destroyed' };
  if (rig.constructionProgress < 1) return { ok: false, error: 'The rig is still rigging up' };
  const active = rigActiveWell(ctx, rig.id);
  if (active) return { ok: false, error: `Finish ${active.name} first (complete it or plug & abandon)` };
  if (!Number.isFinite(cmd.x) || !Number.isFinite(cmd.z)) return { ok: false, error: 'Invalid location' };
  const x = Math.round(cmd.x);
  const z = Math.round(cmd.z);
  if (x === rig.x && z === rig.z) return { ok: false, error: 'The rig is already there' };
  // Temporarily lift the rig out of the world so validation doesn't collide with its own footprint (short skids overlap).
  delete ctx.state.buildings[rig.id];
  clearStructure(ctx.world, rig);
  let v: { ok: boolean; reason?: string; y: number; cost: number };
  try {
    v = ctx.services.construction.validate(rig.type, x, z, rig.rotation);
  } finally {
    ctx.state.buildings[rig.id] = rig;
    writeStructure(ctx.world, rig);
  }
  if (!v.ok) return { ok: false, error: v.reason ?? 'Invalid rig location' };
  const dist = Math.hypot(x - rig.x, z - rig.z);
  const cost = Math.round(SKID_BASE_COST + SKID_COST_PER_BLOCK * dist);
  if (!ctx.transact(-cost, 'drilling', `Rig move (${Math.round(dist * 40)} m)`, true)) return { ok: false, error: `Not enough money: moving the rig costs ${fmtMoney(cost)}` };
  const old = { ...rig, workers: rig.workers.slice(), config: { ...rig.config } };
  removeBuilding(ctx, rig.id);
  for (const b of Object.values(ctx.state.buildings)) if (b.data?.underRig === rig.id) delete b.data.underRig;
  const nb = createBuildingState(ctx, old.type, x, v.y, z, old.rotation, { owner: old.owner });
  nb.constructionProgress = SKID_RIGUP_PROGRESS;
  nb.status = 'constructing';
  nb.workers = old.workers;
  nb.condition = old.condition;
  nb.config = old.config;
  nb.enabled = old.enabled;
  nb.builtDay = old.builtDay;
  nb.lastMaintenanceDay = old.lastMaintenanceDay;
  nb.data = { ...old.data, skiddedFrom: old.id };
  for (const wk of ctx.state.workforce.workers) if (wk.assignedTo === old.id) wk.assignedTo = nb.id;
  addBuilding(ctx, nb);
  ctx.notify('info', 'Rig moving', `Skidding to the new location (${fmtMoney(cost)}). Rig-up finishes shortly.`, { x: x + nb.size[0] / 2, y: v.y, z: z + nb.size[1] / 2 });
  return { ok: true, data: { newRigId: nb.id, cost } };
}

/** Register every upstream command. */
export function registerCommands(ctx: GameContext, rt: UpstreamRuntime): void {
  const c = ctx.commands;
  c.register('survey/start', cmdSurveyStart);
  c.register('survey/cancel', cmdSurveyCancel);
  c.register('well/plan', (cmd, cx) => cmdPlan(cmd, cx, rt));
  c.register('well/spud', (cmd, cx) => cmdSpud(cmd, cx, rt));
  c.register('well/setMudWeight', cmdSetMudWeight);
  c.register('well/runCasing', (cmd, cx) => cmdRunCasing(cmd, cx, rt));
  c.register('well/controlKick', cmdControlKick);
  c.register('well/capBlowout', cmdCapBlowout);
  c.register('well/complete', (cmd, cx) => cmdComplete(cmd, cx, rt));
  c.register('well/frac', (cmd, cx) => cmdFrac(cmd, cx, rt));
  c.register('well/plugAbandon', (cmd, cx) => cmdPlugAbandon(cmd, cx, rt));
  c.register('well/setChoke', cmdSetChoke);
  c.register('well/setLift', (cmd, cx) => cmdSetLift(cmd, cx, rt));
  c.register('well/shutIn', cmdShutIn);
  c.register('well/convert', cmdConvert);
  c.register('well/rename', cmdRename);
  c.register('rig/skid', cmdSkid);
}

