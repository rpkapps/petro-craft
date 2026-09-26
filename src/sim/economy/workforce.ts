// Workforce: candidate pool, hiring/firing, crew auto-assignment, housing, morale, fatigue,
// experience & promotions, injuries and payroll.
import type { BuildingState, GameContext, GameState, WorkerRole } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { BUILDINGS } from '../../content/buildings';
import { RIG_TYPES } from '../../core/buildingUtil';
import {
  BASE_HOUSING, CANDIDATE_REFRESH_DAYS, HOUSING_PER_BUILDING, ROLE_INFO, SEVERANCE_DAYS, SIGNING_FEE_DAYS, STARTING_CREW, TERMINALS,
  XP_PER_SKILL, marketWage,
} from './constants';
import { economyState, type EconomyRuntime, type EconomyWorker } from './ext';
import { FIRST_NAMES, LAST_NAMES, NICKNAMES } from './names';
import { chance, difficulty, fmtMoney, isWorking, pick, rand, randInt, weightedPick } from './util';

export const ALL_ROLES: WorkerRole[] = ['roughneck', 'driller', 'operator', 'engineer', 'technician', 'geoscientist', 'firefighter', 'trucker'];
const OFFSHORE_TYPES = new Set(['jackup_rig', 'semi_sub_rig', 'production_platform', 'fpso']);

// ---- Generation -----------------------------------------------------------------------------------

function workerName(ctx: GameContext, skill: number): string {
  const first = pick(ctx, FIRST_NAMES);
  const last = pick(ctx, LAST_NAMES);
  if (skill >= 4 && chance(ctx, 0.3)) return `${first} "${pick(ctx, NICKNAMES)}" ${last}`;
  return `${first} ${last}`;
}

export function generateWorker(ctx: GameContext, role: WorkerRole, opts: { skill?: number; idPrefix?: string } = {}): EconomyWorker {
  const skill = opts.skill ?? weightedPick(ctx, [1, 2, 3, 4, 5], (s) => [30, 32, 22, 11, 5][s - 1])!;
  const wage = Math.round(marketWage(role, skill) * rand(ctx, 0.92, 1.1));
  return {
    id: ctx.newId(opts.idPrefix ?? 'w'),
    name: workerName(ctx, skill),
    role,
    skill,
    xp: opts.skill ? 0 : Math.floor(rand(ctx, 0, 0.5) * XP_PER_SKILL * skill),
    wage,
    morale: randInt(ctx, 62, 82),
    fatigue: 0,
    hiredDay: 0,
    portraitSeed: randInt(ctx, 0, 0x7fffffff),
    daysWorked: 0,
  };
}

/** Roles buildings need but the company lacks (for weighting the candidate pool). */
function roleShortage(s: GameState, rt: EconomyRuntime): Record<WorkerRole, number> {
  const need = Object.fromEntries(ALL_ROLES.map((r) => [r, 0])) as Record<WorkerRole, number>;
  for (const b of rt.index.all(s)) {
    if (b.status === 'destroyed') continue;
    for (const [role, n] of Object.entries(BUILDINGS[b.type]?.crew ?? {})) need[role as WorkerRole] += n ?? 0;
  }
  for (const w of s.workforce.workers) need[w.role] -= 1;
  return need;
}

export function refreshCandidates(ctx: GameContext, rt: EconomyRuntime) {
  const s = ctx.state;
  const offices = rt.index.count(s, 'field_office', isWorking);
  const n = Math.min(16, randInt(ctx, 6, 12) + 2 * Math.max(0, offices - 1));
  const short = roleShortage(s, rt);
  const base: Record<WorkerRole, number> = { roughneck: 3, operator: 3, trucker: 2, technician: 2, driller: 1.2, engineer: 1.2, geoscientist: 1, firefighter: ctx.hasTech('fire_response') ? 1.5 : 0.5 };
  const list: EconomyWorker[] = [];
  for (let i = 0; i < n; i++) {
    const role = weightedPick(ctx, ALL_ROLES, (r) => base[r] + Math.max(0, short[r]) * 1.5)!;
    list.push(generateWorker(ctx, role, { idPrefix: 'w' }));
  }
  // Keep the pool readable: grouped by role, best first.
  list.sort((a, b) => ALL_ROLES.indexOf(a.role) - ALL_ROLES.indexOf(b.role) || b.skill - a.skill);
  s.workforce.candidates = list;
  s.workforce.lastRefreshDay = s.time.day;
}

/** New game: starting crew (no signing cost) + candidate pool. */
export function initWorkforce(ctx: GameContext, rt: EconomyRuntime) {
  const s = ctx.state;
  for (const [role, n] of Object.entries(STARTING_CREW) as [WorkerRole, number][]) {
    for (let i = 0; i < n; i++) {
      const w = generateWorker(ctx, role, { skill: randInt(ctx, 2, 3) });
      w.wage = Math.round(marketWage(role, w.skill));
      w.morale = 75;
      w.hiredDay = s.time.day;
      s.workforce.workers.push(w);
    }
  }
  refreshCandidates(ctx, rt);
  rt.assignDirty = true;
}

// ---- Assignment -----------------------------------------------------------------------------------

export function crewPriority(type: string): number {
  if (RIG_TYPES.has(type)) return 100;
  if (type === 'frac_spread') return 95;
  if (type === 'production_platform' || type === 'fpso') return 92;
  if (TERMINALS[type]) return 85;
  if (type === 'fire_station') return 75;
  const cat = BUILDINGS[type]?.category;
  if (cat === 'processing' || cat === 'petrochem') return 70;
  if (type === 'maintenance_depot') return 65;
  if (cat === 'production' || cat === 'midstream' || cat === 'environment' || cat === 'power') return 60;
  if (type === 'scada_center') return 55;
  if (type === 'research_lab') return 50;
  return 40;
}

function unassign(s: GameState, w: EconomyWorker) {
  if (w.assignedTo) {
    const b = s.buildings[w.assignedTo];
    if (b) {
      const i = b.workers.indexOf(w.id);
      if (i >= 0) b.workers.splice(i, 1);
    }
  }
  w.assignedTo = undefined;
}

function assign(s: GameState, w: EconomyWorker, b: BuildingState) {
  unassign(s, w);
  if (!b.workers.includes(w.id)) b.workers.push(w.id);
  w.assignedTo = b.id;
}

const isInjured = (s: GameState, w: EconomyWorker) => !!w.injured && w.injured > s.time.day;

/** Crew-eligible: built (or nearly built) and not a ruin. */
function crewEligible(b: BuildingState): boolean {
  if (b.status === 'destroyed') return false;
  if (b.constructionProgress >= 1) return true;
  return b.constructionProgress >= 0.85;
}

/** Keep worker ↔ building links consistent; free workers from removed/destroyed buildings. */
export function sanitizeAssignments(s: GameState) {
  const byId = new Map<string, EconomyWorker>();
  for (const w of s.workforce.workers as EconomyWorker[]) byId.set(w.id, w);
  for (const b of Object.values(s.buildings)) {
    if (b.workers.length === 0) continue;
    const keep = b.workers.filter((id) => byId.get(id)?.assignedTo === b.id && b.status !== 'destroyed');
    if (keep.length !== b.workers.length) b.workers = keep;
  }
  for (const w of byId.values()) {
    if (!w.assignedTo) continue;
    const b = s.buildings[w.assignedTo];
    if (!b || b.status === 'destroyed') {
      w.assignedTo = undefined;
      w.pinned = false;
    } else if (!b.workers.includes(w.id)) b.workers.push(w.id);
  }
}

/** Fill crew requirements from the unassigned pool by building priority. */
export function autoAssign(ctx: GameContext, rt: EconomyRuntime) {
  const s = ctx.state;
  const workers = s.workforce.workers as EconomyWorker[];
  const byId = new Map(workers.map((w) => [w.id, w]));
  const buildings = rt.index.all(s).filter((b) => Object.keys(BUILDINGS[b.type]?.crew ?? {}).length > 0 || b.workers.length > 0);

  // 1) Release: disabled buildings, injured, surplus and wrong-role workers (never pinned ones).
  for (const b of buildings) {
    const crew = BUILDINGS[b.type]?.crew ?? {};
    const eligible = crewEligible(b) && b.enabled;
    const count: Partial<Record<WorkerRole, number>> = {};
    // Pinned (manually assigned) healthy workers occupy positions first.
    for (const id of b.workers) {
      const w = byId.get(id);
      if (w?.pinned && !isInjured(s, w)) count[w.role] = (count[w.role] ?? 0) + 1;
    }
    const ids = [...b.workers].sort((a, c) => (byId.get(c)?.skill ?? 0) - (byId.get(a)?.skill ?? 0));
    for (const id of ids) {
      const w = byId.get(id);
      if (!w || w.pinned) continue;
      const need = crew[w.role] ?? 0;
      const have = count[w.role] ?? 0;
      if (!eligible || need === 0 || have >= need || isInjured(s, w)) unassign(s, w);
      else count[w.role] = have + 1;
    }
  }

  // 2) Fill shortfalls from the free pool, highest priority first.
  const free = new Map<WorkerRole, EconomyWorker[]>();
  for (const w of workers) {
    if (w.assignedTo || w.pinned || isInjured(s, w)) continue;
    let arr = free.get(w.role);
    if (!arr) free.set(w.role, (arr = []));
    arr.push(w);
  }
  for (const arr of free.values()) arr.sort((a, b) => b.skill - a.skill || b.morale - a.morale);
  const ranked = buildings.filter((b) => crewEligible(b) && b.enabled).sort((a, b) => crewPriority(b.type) - crewPriority(a.type));
  for (const b of ranked) {
    const crew = BUILDINGS[b.type]?.crew ?? {};
    for (const [role, n] of Object.entries(crew) as [WorkerRole, number][]) {
      if (!n) continue;
      let have = 0;
      for (const id of b.workers) {
        const w = byId.get(id);
        if (w && w.role === role && !isInjured(s, w)) have++;
      }
      let short = n - have;
      const pool = free.get(role);
      while (short > 0 && pool && pool.length) {
        assign(s, pool.shift()!, b);
        short--;
      }
      // 3) High-priority sites may borrow from much lower-priority ones.
      if (short > 0) {
        const pb = crewPriority(b.type);
        const donors = ranked.filter((d) => d !== b && crewPriority(d.type) + 20 <= pb).reverse();
        for (const d of donors) {
          if (short <= 0) break;
          for (const id of [...d.workers]) {
            const w = byId.get(id);
            if (!w || w.pinned || w.role !== role || isInjured(s, w)) continue;
            assign(s, w, b);
            if (--short <= 0) break;
          }
        }
      }
    }
  }
}

export function housingCapacity(s: GameState, rt: EconomyRuntime): number {
  let cap = BASE_HOUSING;
  for (const [type, n] of Object.entries(HOUSING_PER_BUILDING)) cap += n * rt.index.count(s, type, isWorking);
  return cap;
}

/** Hourly: links, auto-assign, housing. */
export function workforceHourly(ctx: GameContext, rt: EconomyRuntime) {
  const s = ctx.state;
  sanitizeAssignments(s);
  if (s.workforce.autoAssign) autoAssign(ctx, rt);
  s.workforce.housing = housingCapacity(s, rt);
  rt.assignDirty = false;
}

// ---- Daily ----------------------------------------------------------------------------------------

function injuryRisk(type: string): number {
  if (RIG_TYPES.has(type)) return 0.0035;
  if (type === 'frac_spread') return 0.004;
  if (OFFSHORE_TYPES.has(type)) return 0.003;
  const cat = BUILDINGS[type]?.category;
  if (cat === 'processing' || cat === 'petrochem') return 0.002;
  if (TERMINALS[type]) return 0.0015;
  return 0.0008;
}

function isHazardousPost(type: string): boolean {
  return RIG_TYPES.has(type) || type === 'frac_spread' || OFFSHORE_TYPES.has(type);
}

/** Incident kinds that count as safety incidents (same rule facilities uses to reset the clock). */
export const isSafetyIncident = (kind: string) => kind !== 'failure' && kind !== 'leak' && kind !== 'lightning';

/** Days since the last safety incident (written to state.hazards.daysSinceIncident, which facilities/upstream reset to 0). */
export function updateIncidentClock(s: GameState) {
  const ext = economyState(s).workforce;
  for (const inc of s.hazards.incidents) if (isSafetyIncident(inc.kind) && inc.day > ext.lastIncidentDay) ext.lastIncidentDay = inc.day;
  s.hazards.daysSinceIncident = Math.max(0, s.time.day - Math.max(1, ext.lastIncidentDay));
}

export function workforceNewDay(ctx: GameContext, rt: EconomyRuntime, day: number) {
  const s = ctx.state;
  const ext = economyState(s).workforce;
  const workers = s.workforce.workers as EconomyWorker[];
  const wagesMod = ctx.modifier('wages');
  const housing = housingCapacity(s, rt);
  s.workforce.housing = housing;
  const over = Math.max(0, workers.length - housing);
  const camps = rt.index.count(s, 'worker_camp', isWorking);
  updateIncidentClock(s);
  const recentIncidents = s.hazards.incidents.filter((i) => i.day >= day - 7 && isSafetyIncident(i.kind)).length;
  const accidentMod = ctx.modifier('accident_rate') * difficulty(s).hazardRate;
  const xpRate = ctx.hasTech('hr_training') ? 1.5 : 1;
  const harshWeather = s.weather.current === 'heatwave' || s.weather.current === 'blizzard' || s.weather.current === 'hurricane' ? 10 : 0;

  // Payroll (yesterday's shift).
  const payroll = workers.reduce((a, w) => a + w.wage, 0) * wagesMod;
  if (payroll > 0) ctx.transact(-payroll, 'wages', `Payroll: ${workers.length} crew`);

  const quitters: EconomyWorker[] = [];
  const promoted: string[] = [];
  for (const w of workers) {
    const b = w.assignedTo ? s.buildings[w.assignedTo] : undefined;
    const injured = isInjured(s, w);
    const working = !!b && !injured && isWorking(b) && b.status !== 'idle';
    // Fatigue.
    const fTarget = (working ? (isHazardousPost(b!.type) ? 55 : 35) + harshWeather : 8) + (over > 0 ? 18 : 0);
    w.fatigue = Math.max(0, Math.min(100, w.fatigue + (fTarget - w.fatigue) * 0.3));
    // Experience & promotions.
    if (working) {
      w.daysWorked = (w.daysWorked ?? 0) + 1;
      w.xp += xpRate;
      if (w.skill < 5 && w.xp >= XP_PER_SKILL * w.skill) {
        w.xp = 0;
        w.skill++;
        const raise = Math.round(marketWage(w.role, w.skill));
        if (raise > w.wage) w.wage = raise;
        promoted.push(`${w.name} → skill ${w.skill} ${ROLE_INFO[w.role].name.toLowerCase()} ($${w.wage}/day)`);
      }
    }
    // Injuries.
    if (working && s.meta.rules.hazards && chance(ctx, injuryRisk(b!.type) * accidentMod * (1 + w.fatigue / 100) * (1.3 - 0.1 * w.skill))) {
      w.injured = day + randInt(ctx, 3, 14);
      ext.injuries++;
      const site = BUILDINGS[b!.type]?.name ?? b!.type;
      const text = `${w.name} (${ROLE_INFO[w.role].name}) injured at the ${site}`;
      s.hazards.incidents.push({ day, kind: 'injury', text, x: b!.x, z: b!.z });
      ext.lastIncidentDay = day;
      ctx.notify('warning', 'Worker injured', `${text}. Out for ${w.injured - day} days.`, { x: b!.x + b!.size[0] / 2, y: b!.y, z: b!.z + b!.size[1] / 2 });
      if (!w.pinned) unassign(s, w);
      rt.assignDirty = true;
    }
    // Morale.
    let target = 68;
    target += Math.max(-20, Math.min(15, (w.wage / marketWage(w.role, w.skill) - 1) * 100));
    if (over > 0) target -= Math.min(30, 5 + (25 * over) / Math.max(1, workers.length));
    if (camps > 0) target += 4;
    target -= Math.max(0, w.fatigue - 45) * 0.4;
    target -= Math.min(15, recentIncidents * 3);
    target += Math.min(8, s.hazards.daysSinceIncident / 4);
    if (injured) target -= 5;
    w.morale = Math.max(0, Math.min(100, w.morale + (target - w.morale) * 0.25));
    if (w.morale < 25 && chance(ctx, (25 - w.morale) * 0.004)) quitters.push(w);
  }
  if (promoted.length === 1) ctx.notify('info', 'Promotion', `${promoted[0]}.`);
  else if (promoted.length > 1) ctx.notify('info', `${promoted.length} promotions`, `${promoted.join('; ')}.`);
  for (const w of quitters) {
    unassign(s, w);
    s.workforce.workers = s.workforce.workers.filter((x) => x.id !== w.id);
    ext.quits++;
    ctx.notify('warning', `${w.name} quit`, `Morale was too low (${Math.round(w.morale)}). Check wages, housing and safety.`);
    rt.assignDirty = true;
  }
  if (over > 0 && day - ext.lastHousingWarnDay >= 10) {
    ext.lastHousingWarnDay = day;
    ctx.notify('warning', 'Crew housing full', `${workers.length} workers but beds for ${housing}. Build a Worker Camp (16 beds) or Field Office (10).`);
  }
  if (day - s.workforce.lastRefreshDay >= CANDIDATE_REFRESH_DAYS) refreshCandidates(ctx, rt);
}

// ---- Commands -------------------------------------------------------------------------------------

export function cmdHire(cmd: Command<'worker/hire'>, ctx: GameContext, rt: EconomyRuntime): CommandResult {
  const s = ctx.state;
  const i = s.workforce.candidates.findIndex((c) => c.id === cmd.candidateId);
  if (i < 0) return { ok: false, error: 'That candidate is no longer available' };
  const w = s.workforce.candidates[i] as EconomyWorker;
  const fee = w.wage * SIGNING_FEE_DAYS * ctx.modifier('wages');
  if (!ctx.transact(-fee, 'wages', `Signing bonus: ${w.name}`, true)) return { ok: false, error: `Not enough money for the ${fmtMoney(fee)} signing bonus` };
  s.workforce.candidates.splice(i, 1);
  w.hiredDay = s.time.day;
  w.fatigue = 0;
  w.pinned = false;
  s.workforce.workers.push(w);
  economyState(s).workforce.hires++;
  rt.assignDirty = true;
  return { ok: true, data: { workerId: w.id } };
}

export function cmdFire(cmd: Command<'worker/fire'>, ctx: GameContext, rt: EconomyRuntime): CommandResult {
  const s = ctx.state;
  const w = s.workforce.workers.find((x) => x.id === cmd.workerId) as EconomyWorker | undefined;
  if (!w) return { ok: false, error: 'No such worker' };
  const severance = w.wage * SEVERANCE_DAYS * ctx.modifier('wages');
  ctx.transact(-severance, 'wages', `Severance: ${w.name}`);
  unassign(s, w);
  s.workforce.workers = s.workforce.workers.filter((x) => x.id !== w.id);
  // Firing hurts the remaining crew's morale a little.
  for (const o of s.workforce.workers) o.morale = Math.max(0, o.morale - 1.5);
  rt.assignDirty = true;
  return { ok: true };
}

export function cmdAssign(cmd: Command<'worker/assign'>, ctx: GameContext, rt: EconomyRuntime): CommandResult {
  const s = ctx.state;
  const w = s.workforce.workers.find((x) => x.id === cmd.workerId) as EconomyWorker | undefined;
  if (!w) return { ok: false, error: 'No such worker' };
  if (cmd.buildingId === null) {
    unassign(s, w);
    w.pinned = false;
    rt.assignDirty = true;
    return { ok: true };
  }
  const b = s.buildings[cmd.buildingId];
  if (!b || b.status === 'destroyed') return { ok: false, error: 'No such building' };
  const need = BUILDINGS[b.type]?.crew?.[w.role] ?? 0;
  if (need <= 0) return { ok: false, error: `The ${BUILDINGS[b.type]?.name ?? b.type} has no ${ROLE_INFO[w.role].name.toLowerCase()} positions` };
  if (isInjured(s, w)) return { ok: false, error: `${w.name} is injured until day ${w.injured}` };
  assign(s, w, b);
  w.pinned = true;
  rt.assignDirty = true;
  return { ok: true };
}

export function cmdSetAutoAssign(cmd: Command<'worker/setAutoAssign'>, ctx: GameContext, rt: EconomyRuntime): CommandResult {
  ctx.state.workforce.autoAssign = !!cmd.enabled;
  rt.assignDirty = true;
  return { ok: true };
}

/** UI helper: staffing summary for a building type's crew requirement. */
export function staffing(s: GameState, b: BuildingState): { role: WorkerRole; required: number; assigned: number; healthy: number }[] {
  const crew = BUILDINGS[b.type]?.crew ?? {};
  const byId = new Map(s.workforce.workers.map((w) => [w.id, w]));
  return (Object.entries(crew) as [WorkerRole, number][]).map(([role, required]) => {
    let assigned = 0;
    let healthy = 0;
    for (const id of b.workers) {
      const w = byId.get(id);
      if (w?.role !== role) continue;
      assigned++;
      if (!(w.injured && w.injured > s.time.day)) healthy++;
    }
    return { role, required, assigned, healthy };
  });
}
