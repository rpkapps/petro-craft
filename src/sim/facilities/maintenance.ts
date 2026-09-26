// Condition decay, random failures, maintenance depots & inspection drones, manual/dispatched repairs, daily opex.
import { BUILDINGS } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import { TECHS } from '../../content/tech';
import type { BuildingState, SimStep } from '../../core/types';
import type { CommandResult } from '../../core/commands';
import { ALWAYS_ACTIVE, OFFSHORE_HUB_TYPES } from './catalog';
import { centerDist, centerOf, type FacilityRuntime } from './runtime';

export const DEPOT_RANGE = 64;
const DEPOT_TECHS = 4;
const REPAIR_HOURS = 4; // technician-hours to fix a broken unit
const SERVICE_RATE = 12; // condition points per technician-hour
const SERVICE_BELOW = 72; // depots service anything under this condition
const PART_PER_CONDITION = 25; // one spare part per this many condition points restored
const DRONE_JOBS = 2;

export class MaintenanceSystem {
  /** Called when a failure ignites a flammable unit. */
  ignite: (b: BuildingState, intensity: number, cause: string) => void = () => {};
  /** Inspection-drone jobs (building ids), re-planned hourly. */
  private droneJobs: string[] = [];
  private readonly claimed = new Set<string>();

  constructor(private readonly rt: FacilityRuntime) {}

  /** Mechanical load used for wear & failure probability. */
  private load(b: BuildingState): number {
    if (this.rt.isUpstream(b)) return b.status === 'active' ? 1 : 0.15;
    if (ALWAYS_ACTIVE.has(b.type)) return 0.4;
    if (!b.enabled) return 0;
    return Math.min(1, b.utilization);
  }

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const st = ctx.state;
    const w = st.weather;
    let weatherMul = 1;
    switch (w.current) {
      case 'storm': weatherMul = 1.8; break;
      case 'hurricane': weatherMul = 3; break;
      case 'blizzard': weatherMul = 2; break;
      case 'heatwave': weatherMul = 1.4; break;
      case 'snow': weatherMul = 1.2; break;
    }
    if (w.temperature < -15) weatherMul *= 1.6;
    else if (w.temperature > 38) weatherMul *= 1.3;
    const day = st.time.day;
    for (const b of rt.list) {
      if (b.constructionProgress < 1 || b.status === 'destroyed') continue;
      const load = this.load(b);
      const age = 1 + Math.min(1, Math.max(0, day - b.builtDay) / 400) * 0.6;
      const offshore = OFFSHORE_HUB_TYPES.has(b.type) || BUILDINGS[b.type]?.placement === 'water' ? 1.2 : 1;
      const rate = (0.2 + 0.9 * load) * weatherMul * age * offshore * (b.enabled ? 1 : 0.5);
      b.condition = Math.max(0, b.condition - rate * step.days);
      if (b.condition <= 0 && b.status !== 'broken' && !(b.fire > 0)) this.fail(b, 'worn out');
      // Dispatched crew repairs
      const cr = b.data.crewRepair as { doneAt: number } | undefined;
      if (cr && st.time.totalMinutes >= cr.doneAt) {
        delete b.data.crewRepair;
        b.condition = Math.max(b.condition, 90);
        b.lastMaintenanceDay = day;
        if (b.status === 'broken') this.fix(b);
        const c = centerOf(b);
        ctx.notify('success', `${BUILDINGS[b.type]?.name ?? b.type} serviced`, 'The repair crew finished their work.', { x: c.x, y: b.y, z: c.z });
      }
    }
    if (rt.newHour) {
      if (rt.hazardsOn) this.rollFailures();
      this.planJobs();
    }
    this.workJobs(step);
  }

  /** Hourly failure roll: p/day = (0.35 + 3·(1−c)²)/mtbf × failure modifiers × load. */
  private rollFailures(): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const mods = ctx.modifier('failure_rate') * rt.failureRate;
    for (const b of rt.list) {
      if (b.constructionProgress < 1 || !b.enabled || b.status === 'broken' || b.status === 'destroyed' || b.fire > 0) continue;
      const d = BUILDINGS[b.type];
      if (!d) continue;
      const c = b.condition / 100;
      const pDay = ((0.35 + 3 * (1 - c) * (1 - c)) / (d.mtbf ?? 300)) * mods * (0.3 + 0.7 * this.load(b));
      if (ctx.rng() < pDay / 24) this.fail(b, 'equipment failure');
    }
  }

  /** Put a building into 'broken' (+ possible ignition). */
  fail(b: BuildingState, cause: string): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const d = BUILDINGS[b.type];
    const prev = b.status;
    b.status = 'broken';
    b.data.manualRepairs = 0;
    delete b.data.repairProgress;
    if (prev !== 'broken') ctx.bus.emit('building:statusChanged', { id: b.id, prev, status: 'broken' });
    const c = centerOf(b);
    rt.incident('failure', `${d?.name ?? b.type}: ${cause}`, c.x, c.z);
    ctx.notify('warning', `${d?.name ?? b.type} broke down`, `Cause: ${cause}. Repair it with the wrench, dispatch a crew, or build a Maintenance Depot nearby.`, { x: c.x, y: b.y, z: c.z });
    if (rt.hazardsOn && d?.flammability && ctx.rng() < d.flammability * rt.hazardRate * 0.25) this.ignite(b, 0.2, 'failure');
  }

  /** Clear 'broken'. */
  fix(b: BuildingState): void {
    const ctx = this.rt.ctx;
    delete b.data.repairProgress;
    delete b.data.manualRepairs;
    b.condition = Math.max(b.condition, 60);
    b.lastMaintenanceDay = ctx.state.time.day;
    if (b.status === 'broken') {
      b.status = 'idle';
      ctx.bus.emit('building:statusChanged', { id: b.id, prev: 'broken', status: 'idle' });
    }
  }

  private needsWork(b: BuildingState): boolean {
    if (b.constructionProgress < 1 || b.status === 'destroyed' || b.fire > 0 || b.data.crewRepair) return false;
    return b.status === 'broken' || b.condition < SERVICE_BELOW;
  }

  /** A job in progress continues until the unit is fixed and back near full condition. */
  private stillNeeds(b: BuildingState): boolean {
    if (b.constructionProgress < 1 || b.status === 'destroyed' || b.fire > 0 || b.data.crewRepair) return false;
    return b.status === 'broken' || b.condition < 98;
  }

  /** Assign depot technicians (and drones) to the most urgent jobs in range. */
  private planJobs(): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    this.claimed.clear();
    const priority = (b: BuildingState) => (b.status === 'broken' ? -1000 : 0) + b.condition;
    for (const depot of rt.list) {
      if (depot.type !== 'maintenance_depot') continue;
      if (!rt.canRun(depot)) {
        if (depot.data.jobs) delete depot.data.jobs;
        continue;
      }
      const techs = Math.max(1, Math.round(DEPOT_TECHS * Math.min(1, rt.crew(depot))));
      // Jobs in progress continue; free technicians pick the most urgent new work in range.
      const jobs: string[] = [];
      for (const id of (depot.data.jobs as string[] | undefined) ?? []) {
        const b = ctx.state.buildings[id];
        if (b && jobs.length < techs && !this.claimed.has(id) && this.stillNeeds(b)) {
          jobs.push(id);
          this.claimed.add(id);
        }
      }
      if (jobs.length < techs) {
        const cands: BuildingState[] = [];
        for (const b of rt.list) if (b !== depot && !this.claimed.has(b.id) && this.needsWork(b) && centerDist(b, depot) <= DEPOT_RANGE) cands.push(b);
        cands.sort((a, b) => priority(a) - priority(b));
        for (const b of cands) {
          if (jobs.length >= techs) break;
          jobs.push(b.id);
          this.claimed.add(b.id);
        }
      }
      depot.data.jobs = jobs;
    }
    if (ctx.hasTech('drones') || this.hasFeature('auto_repair')) {
      const keep = this.droneJobs.filter((id) => {
        const b = ctx.state.buildings[id];
        return !!b && !this.claimed.has(id) && this.stillNeeds(b);
      });
      const cands: BuildingState[] = [];
      if (keep.length < DRONE_JOBS) for (const b of rt.list) if (!this.claimed.has(b.id) && !keep.includes(b.id) && this.needsWork(b)) cands.push(b);
      cands.sort((a, b) => priority(a) - priority(b));
      this.droneJobs = keep.concat(cands.slice(0, DRONE_JOBS - keep.length).map((b) => b.id));
    } else this.droneJobs = [];
  }

  private hasFeature(f: string): boolean {
    const ctx = this.rt.ctx;
    for (const id of ctx.state.research.completed) {
      const feats = TECH_FEATURES[id];
      if (feats && feats.includes(f)) return true;
    }
    return false;
  }

  private workJobs(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const speed = ctx.modifier('repair_speed');
    const hours = step.minutes / 60;
    for (const depot of rt.list) {
      if (depot.type !== 'maintenance_depot') continue;
      const jobs = depot.data.jobs as string[] | undefined;
      if (!jobs || jobs.length === 0) {
        depot.utilization = 0;
        continue;
      }
      if (!rt.canRun(depot)) continue;
      const f = Math.min(1.25, rt.crew(depot));
      let busy = 0;
      for (let i = jobs.length - 1; i >= 0; i--) {
        const b = ctx.state.buildings[jobs[i]];
        if (!b || !this.stillNeeds(b)) {
          jobs.splice(i, 1);
          continue;
        }
        busy++;
        if (this.work(b, hours * speed * f)) jobs.splice(i, 1);
      }
      depot.utilization = Math.min(1, busy / DEPOT_TECHS);
    }
    for (let i = this.droneJobs.length - 1; i >= 0; i--) {
      const b = ctx.state.buildings[this.droneJobs[i]];
      if (!b || !this.stillNeeds(b)) {
        this.droneJobs.splice(i, 1);
        continue;
      }
      if (this.work(b, hours * speed * 0.75)) this.droneJobs.splice(i, 1);
    }
  }

  /** Apply technician-hours to a building. Returns true when the job is complete. */
  private work(b: BuildingState, techHours: number): boolean {
    const ctx = this.rt.ctx;
    b.lastMaintenanceDay = ctx.state.time.day;
    if (b.status === 'broken') {
      const p = ((b.data.repairProgress as number | undefined) ?? 0) + techHours / REPAIR_HOURS;
      if (p >= 1) {
        this.consumeParts(1);
        this.fix(b);
        b.condition = Math.max(b.condition, 70);
        return false; // keep servicing condition
      }
      b.data.repairProgress = p;
      return false;
    }
    const gain = Math.min(100 - b.condition, SERVICE_RATE * techHours);
    b.condition += gain;
    const debt = ((b.data.partDebt as number | undefined) ?? 0) + gain / PART_PER_CONDITION;
    const whole = Math.floor(debt);
    if (whole > 0) this.consumeParts(whole);
    b.data.partDebt = debt - whole;
    return b.condition >= 98;
  }

  /** Take spare parts from the warehouse; buy the shortfall at a 25% premium (billed hourly). */
  consumeParts(n: number): void {
    const ctx = this.rt.ctx;
    const wh = ctx.state.company.warehouse;
    const have = wh.spare_parts ?? 0;
    const use = Math.min(have, n);
    if (use > 0) {
      wh.spare_parts = have - use;
      if (wh.spare_parts <= 0) delete wh.spare_parts;
    }
    const buy = n - use;
    if (buy > 0) {
      const price = (ctx.state.market.prices.spare_parts ?? ITEMS.spare_parts.basePrice) * 1.25;
      this.rt.pending.parts += buy * price;
      this.rt.pending.partsQty += buy;
    }
  }

  /** 'building/repair' for buildings. */
  repair(b: BuildingState, manual: boolean): CommandResult {
    const ctx = this.rt.ctx;
    const d = BUILDINGS[b.type];
    if (b.constructionProgress < 1) return { ok: false, error: 'Still under construction' };
    if (b.status === 'destroyed') return { ok: false, error: 'Destroyed beyond repair — demolish and rebuild' };
    if (b.fire > 0) return { ok: false, error: 'Put out the fire first!' };
    if (manual) {
      if (b.status !== 'broken' && b.condition >= 99.5) return { ok: false, error: 'Already in perfect condition' };
      const wh = ctx.state.company.warehouse;
      if ((wh.spare_parts ?? 0) < 1) {
        const price = (ctx.state.market.prices.spare_parts ?? ITEMS.spare_parts.basePrice) * 1.25;
        if (!ctx.transact(-price, 'repairs', 'Spare part (field purchase)', true)) return { ok: false, error: 'No spare parts and not enough money to buy one' };
      } else {
        wh.spare_parts -= 1;
        if (wh.spare_parts <= 0) delete wh.spare_parts;
      }
      b.condition = Math.min(100, b.condition + 25);
      b.lastMaintenanceDay = ctx.state.time.day;
      if (b.status === 'broken') {
        const n = ((b.data.manualRepairs as number | undefined) ?? 0) + 1;
        b.data.manualRepairs = n;
        if (n >= 2) {
          this.fix(b);
          return { ok: true, data: { fixed: true, condition: b.condition } };
        }
        return { ok: true, data: { fixed: false, remaining: 2 - n, condition: b.condition } };
      }
      return { ok: true, data: { condition: b.condition } };
    }
    if (b.data.crewRepair) return { ok: false, error: 'A repair crew is already on the way' };
    if (b.status !== 'broken' && b.condition >= 95) return { ok: false, error: 'No repairs needed' };
    const cost = Math.round(Math.min(250_000, Math.max(5_000, (d?.cost ?? 100_000) * 0.015)));
    if (!ctx.transact(-cost, 'repairs', `Repair crew: ${d?.name ?? b.type}`, true)) return { ok: false, error: `Not enough money (repair crew costs $${cost.toLocaleString('en-US')})` };
    const hours = (b.status === 'broken' ? 6 : 3) / ctx.modifier('repair_speed');
    b.data.crewRepair = { doneAt: ctx.state.time.totalMinutes + hours * 60 };
    this.consumeParts(b.status === 'broken' ? 2 : 1);
    return { ok: true, data: { cost, hours } };
  }

  /** Daily fixed operating costs, one ledger entry. */
  chargeOpex(): void {
    const rt = this.rt;
    let total = 0;
    let n = 0;
    for (const b of rt.list) {
      if (b.constructionProgress < 1 || b.status === 'destroyed') continue;
      const opex = BUILDINGS[b.type]?.opex ?? 0;
      if (opex <= 0) continue;
      total += b.enabled ? opex : opex * 0.5;
      n++;
    }
    if (total > 0) rt.ctx.transact(-Math.round(total), 'opex', `Facility operating costs (${n} sites)`);
  }
}

const TECH_FEATURES: Record<string, string[] | undefined> = Object.fromEntries(Object.values(TECHS).map((t) => [t.id, t.features]));
