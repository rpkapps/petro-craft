// Well control: kicks (underbalance in permeable rock), kill methods, blowouts (flow, spills, ignition, rig
// damage) and capping / relief wells.
import { B, IS_SOLID } from '../../core/blocks';
import { crewFactor } from '../../core/buildingUtil';
import type { Command, CommandResult } from '../../core/commands';
import type { BuildingState, Fire, GameContext, RockProperties, WellState } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { blowoutRate } from './production';
import { derived } from './reservoir';
import { CAP_METHODS, FIRE_STATION_RANGE, KICK_METHODS, KICK_UNATTENDED_HOURS, MUD_MAX_PPG } from './tuning';
import { charge, rx, setWellStatus, ux, wellPos, type WellOp } from './wellData';
import { clamp, consumeSupply, fmtInt, fmtMoney, hazardRate, hazardsEnabled, nearestOperational } from './util';

// ---- Kicks ----------------------------------------------------------------------------------------------

/** Roll for a kick while drilling `time` hours through rock with pore pressure porePpg. Returns true if one starts. */
export function checkKick(ctx: GameContext, rt: UpstreamRuntime, w: WellState, rig: BuildingState | undefined, props: RockProperties, porePpg: number, time: number): boolean {
  const e = ux(w);
  const permeable = props.permeability > 0.3 || !!props.reservoirId || props.fluid === 'gas';
  if (!permeable || time <= 0) return false;
  const mwEff = w.mudWeight - (e.lostCirc ? 0.5 : 0);
  const under = porePpg - mwEff;
  if (under < -0.2) return false;
  const permF = clamp(Math.log10(props.permeability + 1) / 2, 0.25, 1.5);
  const crew = rig ? crewFactor(ctx.state, rig) : 1;
  const crewMult = clamp(1.5 - 0.5 * crew, 0.85, 1.5);
  const lambda = (under > 0 ? 0.5 + 3 * under : 0.02) * permF * ctx.modifier('kick_risk') * hazardRate(ctx) * crewMult;
  if (ctx.rng() >= 1 - Math.exp(-lambda * time)) return false;
  startKick(ctx, w, porePpg, props);
  return true;
}

export function startKick(ctx: GameContext, w: WellState, porePpg: number, props: RockProperties): void {
  const e = ux(w);
  const under = Math.max(0, porePpg - w.mudWeight);
  e.kickPpg = Math.max(porePpg, w.mudWeight + 0.2);
  e.kickFluid = props.fluid === 'gas' ? 'gas' : props.fluid === 'oil' ? 'oil' : 'water';
  e.blowRes = props.reservoirId;
  e.kickHours = 0;
  e.flags.kickWarn = false;
  w.kickVolume = Math.round(10 + 25 * under);
  setWellStatus(ctx, w, 'kick');
  ctx.bus.emit('well:kick', { id: w.id });
  // Emergencies drop the game to normal speed so the player can react (6 game hours ≈ 2.5 real minutes at 1×).
  const slowed = ctx.state.time.speed > 1;
  if (slowed) ctx.state.time.speed = 1;
  ctx.notify(
    'danger',
    `KICK on ${w.name}!`,
    `${e.kickFluid === 'gas' ? 'Gas' : e.kickFluid === 'oil' ? 'Oil' : 'Formation water'} influx of ${w.kickVolume} bbl — pore pressure ~${e.kickPpg.toFixed(1)} ppg vs ${w.mudWeight.toFixed(1)} ppg mud. The BOP is closed. Kill the well within ~${KICK_UNATTENDED_HOURS} h (Well panel): Driller's method (fast, can fail on big kicks), Wait & Weight (slower, safest, uses barite) or Bullheading (quick but risky).${slowed ? ' Game speed set to 1×.' : ''}`,
    wellPos(w),
  );
}

/** A kick nobody is dealing with: influx grows, and after ~6 h a blowout becomes likely. */
export function tickKickUnattended(ctx: GameContext, rt: UpstreamRuntime, w: WellState, rig: BuildingState | undefined, hours: number): void {
  const e = ux(w);
  e.kickHours += hours;
  const under = Math.max(0, e.kickPpg - w.mudWeight);
  w.kickVolume = Math.round(Math.min(500, w.kickVolume + (6 + 30 * under) * (e.kickFluid === "gas" ? 1.8 : 1) * hours) * 10) / 10;
  if (e.kickHours > KICK_UNATTENDED_HOURS - 2 && !e.flags.kickWarn) {
    e.flags.kickWarn = true;
    ctx.notify('danger', `${w.name}: kick still uncontrolled`, `Influx now ${Math.round(w.kickVolume)} bbl. Choose a kill method now or risk a blowout.`, wellPos(w));
  }
  if (!hazardsEnabled(ctx)) return;
  const risk = ctx.modifier('blowout_risk') * hazardRate(ctx);
  const lambda = risk * (e.kickHours < KICK_UNATTENDED_HOURS ? 0.01 * (w.kickVolume / 50) : 0.3 + w.kickVolume / 1000);
  if (ctx.rng() < 1 - Math.exp(-lambda * hours)) startBlowout(ctx, rt, w, rig, 'The uncontrolled kick broke through the BOP.');
}

export function cmdControlKick(cmd: Command<'well/controlKick'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (w.status !== 'kick') return { ok: false, error: 'There is no kick to control on this well' };
  const e = ux(w);
  if (e.op) return { ok: false, error: `${e.op.label} already in progress` };
  const m = KICK_METHODS[cmd.method];
  if (!m) return { ok: false, error: 'Unknown kill method' };
  const kill = clamp(e.kickPpg + m.margin, w.mudWeight, MUD_MAX_PPG);
  // Kill operations are safety-critical: they always proceed (debt if needed).
  charge(ctx, w, m.cost * ctx.modifier('drill_cost'), 'drilling', `${w.name}: ${m.label} well kill`, false);
  if (cmd.method === 'wait_weight') consumeSupply(ctx, 'barite', Math.max(5, (kill - w.mudWeight) * 40), w);
  const hours = m.hours * (1 + w.kickVolume / 200);
  e.op = { kind: 'kill', label: `Killing the well (${m.label})`, hoursLeft: hours, hoursTotal: hours, method: cmd.method };
  return { ok: true, data: { hours, killWeight: kill } };
}

/** Kill operation finished: success, or a worse situation. */
export function finishKill(ctx: GameContext, rt: UpstreamRuntime, w: WellState, rig: BuildingState | undefined, op: WellOp): void {
  const e = ux(w);
  const method = (op.method ?? 'drillers') as keyof typeof KICK_METHODS;
  const m = KICK_METHODS[method];
  const crew = rig ? Math.min(1, crewFactor(ctx.state, rig)) : 0.5;
  let p: number;
  if (method === 'drillers') p = clamp(0.95 - w.kickVolume / 250, 0.25, 0.95) * (0.8 + 0.2 * crew);
  else if (method === 'wait_weight') p = clamp(0.99 - w.kickVolume / 2500, 0.9, 0.99);
  else p = e.kickFluid === 'gas' ? 0.55 : 0.65;
  if (!hazardsEnabled(ctx) || ctx.rng() < p) {
    w.mudWeight = Math.round(clamp(Math.max(w.mudWeight, e.kickPpg + m.margin), 8.4, MUD_MAX_PPG) * 10) / 10;
    e.mudOverride = true;
    w.kickVolume = 0;
    e.kickHours = 0;
    setWellStatus(ctx, w, 'drilling');
    ctx.notify('success', `${w.name}: well killed`, `${m.label} circulated the influx out. Drilling ahead with ${w.mudWeight.toFixed(1)} ppg mud.`, wellPos(w));
    return;
  }
  if (method === 'bullhead') {
    e.lostCirc = true;
    if (ctx.rng() < 0.35 * ctx.modifier('blowout_risk') * hazardRate(ctx)) {
      startBlowout(ctx, rt, w, rig, 'Bullheading fractured the formation and the well broached.');
      return;
    }
  }
  // Even a failed circulation leaves heavier mud in the hole.
  if (method === 'wait_weight') w.mudWeight = Math.round(clamp((w.mudWeight + e.kickPpg + m.margin) / 2, 8.4, MUD_MAX_PPG) * 10) / 10;
  w.kickVolume = Math.min(500, w.kickVolume * 1.5 + 20);
  e.kickHours = Math.max(0, e.kickHours - 2);
  if (w.kickVolume > 300 && ctx.rng() < 0.4 * ctx.modifier('blowout_risk') * hazardRate(ctx)) {
    startBlowout(ctx, rt, w, rig, `${m.label} failed on a very large influx.`);
    return;
  }
  ctx.notify('danger', `${w.name}: kill attempt failed`, `${m.label} did not control the well. Influx now ${Math.round(w.kickVolume)} bbl — try Wait & Weight.`, wellPos(w));
}

// ---- Blowouts --------------------------------------------------------------------------------------------

export function startBlowout(ctx: GameContext, rt: UpstreamRuntime, w: WellState, rig: BuildingState | undefined, cause: string): void {
  const e = ux(w);
  e.op = undefined;
  e.blowFluid = e.kickFluid;
  setWellStatus(ctx, w, 'blowout');
  const day = ctx.state.time.day + ctx.state.time.minuteOfDay / 1440;
  w.blowout = { startedDay: day, onFire: false, flowRate: 0, capProgress: 0 };
  w.blowout.flowRate = Math.round(blowoutRate(ctx, rt, w));
  ctx.state.stats.blowouts++;
  const hz = ctx.state.hazards;
  hz.incidents.push({ day: ctx.state.time.day, kind: 'blowout', text: `Blowout at ${w.name}`, x: w.x, z: w.z });
  if (hz.incidents.length > 200) hz.incidents.splice(0, hz.incidents.length - 200);
  hz.daysSinceIncident = 0;
  if (rig) damageRig(ctx, rig, 35);
  ctx.bus.emit('well:blowout', { id: w.id });
  const unit = e.blowFluid === 'gas' ? 'mcf/d of gas' : e.blowFluid === 'oil' ? 'bbl/d of oil' : 'bbl/d of brine';
  ctx.notify('danger', `BLOWOUT at ${w.name}!`, `${cause} Uncontrolled flow of ~${fmtInt(w.blowout.flowRate)} ${unit}. Order a capping stack (fast, $$$) or a relief well (slow, certain) from the Well panel. Fire stations nearby speed up capping.`, wellPos(w));
  const pIgnite = (e.blowFluid === 'gas' ? 0.5 : e.blowFluid === 'oil' ? 0.35 : 0) * hazardRate(ctx);
  if (ctx.rng() < pIgnite) ignite(ctx, w, rig);
}

function damageRig(ctx: GameContext, rig: BuildingState, amount: number): void {
  rig.condition = Math.max(0, rig.condition - amount);
  if (rig.condition <= 0 && rig.status !== 'destroyed') {
    const prev = rig.status;
    rig.status = 'destroyed';
    rig.enabled = false;
    ctx.bus.emit('building:statusChanged', { id: rig.id, prev, status: 'destroyed' });
    ctx.notify('danger', 'Rig destroyed', 'The drilling rig was destroyed by the blowout fire. Demolish the wreck to clear the site.', { x: rig.x + rig.size[0] / 2, y: rig.y, z: rig.z + rig.size[1] / 2 });
  }
}

function ignite(ctx: GameContext, w: WellState, rig: BuildingState | undefined): void {
  const e = ux(w);
  if (!w.blowout) return;
  const f: Fire = { id: ctx.newId('f'), x: w.x, y: w.surfaceY, z: w.z, intensity: 1, wellId: w.id, startedMinute: ctx.state.time.totalMinutes, spreadTimer: 0 };
  ctx.state.hazards.fires.push(f);
  e.fireId = f.id;
  w.blowout.onFire = true;
  ctx.state.stats.fires++;
  ctx.bus.emit('hazard:explosion', { x: w.x + 0.5, y: w.surfaceY + 2, z: w.z + 0.5, power: 4 });
  ctx.bus.emit('hazard:fireStarted', { id: f.id, x: f.x, y: f.y, z: f.z });
  if (rig) damageRig(ctx, rig, 25);
  ctx.notify('danger', `${w.name} blowout is on fire`, 'The wellstream ignited. Capping cannot finish until the fire is knocked down — fire crews and the capping team will fight it.', wellPos(w));
}

function removeFire(ctx: GameContext, w: WellState): void {
  const e = ux(w);
  const fires = ctx.state.hazards.fires;
  for (let i = fires.length - 1; i >= 0; i--) {
    if (fires[i].wellId === w.id) {
      const id = fires[i].id;
      fires.splice(i, 1);
      ctx.bus.emit('hazard:fireOut', { id });
    }
  }
  e.fireId = undefined;
  if (w.blowout) w.blowout.onFire = false;
}

/** Place spilled crude as OIL_POOL blocks around the well and record the spill. */
function spillOil(ctx: GameContext, w: WellState, bbl: number): void {
  const e = ux(w);
  const env = ctx.state.environment;
  let sp = e.spillId ? env.spills.find((s) => s.id === e.spillId) : undefined;
  if (!sp) {
    sp = { id: ctx.newId('sp'), x: w.x, y: w.surfaceY, z: w.z, volume: 0, cleaned: 0, day: ctx.state.time.day, kind: 'oil' };
    env.spills.push(sp);
    e.spillId = sp.id;
  }
  sp.volume += bbl;
  e.spillAcc = (e.spillAcc ?? 0) + bbl;
  let placed = 0;
  while (e.spillAcc >= 250 && placed < 4) {
    e.spillAcc -= 250;
    placed++;
    const a = ctx.rng() * Math.PI * 2;
    const r = 3 + ctx.rng() * 6;
    const x = Math.floor(w.x + 0.5 + Math.cos(a) * r);
    const z = Math.floor(w.z + 0.5 + Math.sin(a) * r);
    if (!ctx.world.inBounds(x, 1, z)) continue;
    const y = ctx.world.getSurfaceY(x, z);
    const here = ctx.world.getBlock(x, y, z);
    const below = ctx.world.getBlock(x, y - 1, z);
    if (here !== B.AIR || !IS_SOLID[below] || below === B.STRUCTURE || below === B.CASING) continue;
    ctx.world.setBlock(x, y, z, B.OIL_POOL, 'system');
    ctx.bus.emit('hazard:spill', { x, y, z, volume: 250 });
  }
}

/** Blowout step: flow, losses, spills/emissions, fire, rig damage, capping progress, natural bridging. */
export function tickBlowout(ctx: GameContext, rt: UpstreamRuntime, w: WellState, hours: number): void {
  const e = ux(w);
  const bo = w.blowout;
  if (!bo) return;
  const dt = hours / 24;
  const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
  // Fire bookkeeping (facilities may extinguish / reduce intensity).
  let fire = e.fireId ? ctx.state.hazards.fires.find((f) => f.id === e.fireId) : undefined;
  if (e.fireId && !fire) {
    e.fireId = undefined;
    bo.onFire = false;
    ctx.notify('success', `${w.name}: fire out`, 'The blowout fire is out. The well is still flowing — finish capping.', wellPos(w));
  }
  const capping = e.op && (e.op.kind === 'cap' || e.op.kind === 'relief') ? e.op : undefined;
  if (fire) {
    if (capping) {
      const fs = nearestOperational(ctx, 'fire_station', w.x, w.z, FIRE_STATION_RANGE);
      fire.intensity -= (fs ? 0.1 : 0.03) * hours;
    } else fire.intensity = Math.min(1, fire.intensity + 0.08 * hours);
    if (fire.intensity <= 0.02) {
      removeFire(ctx, w);
      fire = undefined;
      ctx.notify('success', `${w.name}: fire knocked down`, 'Capping crews extinguished the blowout fire.', wellPos(w));
    } else if (rig) damageRig(ctx, rig, 4 * hours);
  }
  // Flow & losses
  const rate = blowoutRate(ctx, rt, w);
  bo.flowRate = Math.round(rate);
  const vol = rate * dt;
  const env = ctx.state.environment;
  const R = e.blowRes ? rt.reservoir(e.blowRes) : undefined;
  const rs = R ? ctx.state.reservoirs[R.id] : undefined;
  if (R && rs) {
    const rext = rx(rs);
    if (R.fluid === 'oil') {
      const gas = (vol * Math.max(0, R.gasOilRatio)) / 1000;
      rs.cumulative.oil += vol;
      rs.cumulative.gas += gas;
      rext.lostOil += vol;
      rext.lostGas += gas;
      rt.flow(R.id).voidRb += vol * derived(R).boi;
    } else {
      rs.cumulative.gas += vol;
      rext.lostGas += vol;
    }
  }
  if (e.blowFluid === 'oil') {
    if (bo.onFire) env.emissionsToday += vol * 0.43;
    spillOil(ctx, w, vol * (bo.onFire ? 0.05 : 0.35));
  } else if (e.blowFluid === 'gas') {
    if (bo.onFire) env.emissionsToday += vol * 0.055;
    else env.ventedToday += vol;
  }
  if (!bo.onFire && e.blowFluid !== 'water' && hazardsEnabled(ctx)) {
    const lam = (e.blowFluid === 'gas' ? 0.07 : 0.04) * hazardRate(ctx);
    if (ctx.rng() < 1 - Math.exp(-lam * hours)) ignite(ctx, w, rig);
  }
  // Capping / relief well progress (specialist contractors; no rig crew needed).
  if (capping) {
    capping.hoursLeft -= hours;
    if (capping.kind === 'cap' && bo.onFire && (fire?.intensity ?? 0) > 0.35) capping.hoursLeft = Math.max(capping.hoursLeft, 0.1 * capping.hoursTotal);
    bo.capProgress = clamp(1 - capping.hoursLeft / capping.hoursTotal, 0, 1);
    if (capping.hoursLeft <= 0) {
      finishCap(ctx, w, capping);
      return;
    }
  }
  // Natural bridging after a long blowout (the hole collapses / reservoir depletes).
  const now = ctx.state.time.day + ctx.state.time.minuteOfDay / 1440;
  if (now - bo.startedDay > 12 && ctx.rng() < 1 - Math.exp(-0.03 * dt)) {
    controlled(ctx, w, 'plugged', 'The wellbore bridged over and the flow stopped on its own. The well is lost.');
  }
}

function finishCap(ctx: GameContext, w: WellState, op: WellOp): void {
  const e = ux(w);
  if (op.kind === 'relief') {
    controlled(ctx, w, 'plugged', 'The relief well intersected the wellbore and killed it with heavy mud and cement. The original well is plugged.');
    return;
  }
  const p = op.method === 'cap_fs' ? 0.95 : 0.85;
  if (ctx.rng() < p) {
    controlled(ctx, w, 'drilled', 'The capping stack is latched and the well is shut in. It can be completed (if it found pay) or plugged.');
  } else {
    op.hoursLeft = op.hoursTotal * 0.4;
    if (w.blowout) w.blowout.capProgress = 0.6;
    ctx.notify('warning', `${w.name}: capping attempt failed`, 'The stack could not be latched. The team is trying again.', wellPos(w));
    e.op = op;
  }
}

function controlled(ctx: GameContext, w: WellState, status: 'drilled' | 'plugged', text: string): void {
  const e = ux(w);
  removeFire(ctx, w);
  e.op = undefined;
  w.kickVolume = 0;
  w.blowout = undefined;
  w.rates = { oil: 0, gas: 0, water: 0 };
  w.plannedDepth = w.measuredDepth;
  if (status === 'plugged') {
    const rig = w.rigId ? ctx.state.buildings[w.rigId] : undefined;
    if (rig && rig.wellId === w.id) rig.wellId = undefined;
  } else {
    w.mudWeight = Math.min(MUD_MAX_PPG, Math.max(w.mudWeight, e.kickPpg + 0.5));
  }
  setWellStatus(ctx, w, status);
  ctx.bus.emit('well:blowoutControlled', { id: w.id });
  ctx.notify('success', `${w.name} blowout controlled`, text, wellPos(w));
}

export function cmdCapBlowout(cmd: Command<'well/capBlowout'>, ctx: GameContext): CommandResult {
  const w = ctx.state.wells[cmd.wellId];
  if (!w) return { ok: false, error: 'Well not found' };
  if (w.status !== 'blowout' || !w.blowout) return { ok: false, error: 'This well is not blowing out' };
  const e = ux(w);
  if (e.op && (e.op.kind === 'cap' || e.op.kind === 'relief')) return { ok: false, error: `${e.op.label} is already underway` };
  const m = CAP_METHODS[cmd.method];
  if (!m) return { ok: false, error: 'Unknown method' };
  const fs = nearestOperational(ctx, 'fire_station', w.x, w.z, FIRE_STATION_RANGE);
  const cost = fs ? m.fireStationCost : m.cost;
  const days = fs ? m.fireStationDays : m.days;
  // Relief wells are regulator-mandated and proceed on credit; a capping stack must be paid up front.
  const ok = charge(ctx, w, cost, 'drilling', `${w.name}: ${m.label}`, cmd.method === 'cap');
  if (!ok) return { ok: false, error: `Not enough money for a capping stack (${fmtMoney(cost)}). A relief well can be ordered on credit.` };
  const hours = days * 24;
  e.op = { kind: cmd.method === 'cap' ? 'cap' : 'relief', label: cmd.method === 'cap' ? 'Capping the blowout' : 'Drilling a relief well', hoursLeft: hours, hoursTotal: hours, method: cmd.method === 'cap' && fs ? 'cap_fs' : cmd.method };
  ctx.notify('info', `${w.name}: ${m.label} ordered`, `${fmtMoney(cost)}, about ${days} days${fs ? ' (fire station support)' : ''}.${cmd.method === 'cap' && w.blowout.onFire ? ' The fire must be knocked down before the stack can be latched.' : ''}`, wellPos(w));
  return { ok: true, data: { cost, days } };
}
