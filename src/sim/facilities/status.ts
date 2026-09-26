// End-of-step pass: utilisation of passive buildings, IO rate smoothing (b.io) and the status machine.
//
// Status priority: destroyed > fire > constructing > broken > disabled > unstaffed > no_power > active|idle.
// For UPSTREAM_TYPES the 'active'/'idle' decision belongs to the upstream module; facilities only moves them
// out of a generic status (→ 'idle').
import { BUILDINGS } from '../../content/buildings';
import type { BuildingState, BuildingStatus, SimStep } from '../../core/types';
import { ALWAYS_ACTIVE, BOOSTER_TYPES, GENERATOR_TYPES, OFFSHORE_HUB_TYPES, PROCESSING_TYPES, TANK_TYPES, TERMINAL_TYPES, emaAlpha } from './catalog';
import { FLARE_CAPACITY, boosterUtilization } from './networks/flow';
import type { FacilityRuntime } from './runtime';
import { fillFraction } from './storage';

const GENERIC = new Set<BuildingStatus>(['constructing', 'disabled', 'unstaffed', 'no_power', 'fire', 'broken', 'destroyed']);
/** Types whose utilisation is maintained by their own subsystem. */
const SELF_UTIL = new Set(['water_pit', 'disposal_well', 'ccs_unit', 'maintenance_depot']);

export class StatusSystem {
  private readonly burning = new Set<string>();
  constructor(private readonly rt: FacilityRuntime) {}

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const alpha = emaAlpha(step.minutes);
    this.burning.clear();
    for (const f of ctx.state.hazards.fires) if (f.buildingId) this.burning.add(f.buildingId);
    for (const b of rt.list) {
      if (b.fire > 0 && !this.burning.has(b.id)) b.fire = 0;
      if (!rt.isUpstream(b)) this.updateUtilization(b, alpha);
      this.finalizeIo(b, step.days, alpha);
      const next = this.compute(b);
      if (next !== b.status) {
        const prev = b.status;
        b.status = next;
        ctx.bus.emit('building:statusChanged', { id: b.id, prev, status: next });
      }
    }
  }

  private updateUtilization(b: BuildingState, alpha: number): void {
    const rt = this.rt;
    const t = b.type;
    if (PROCESSING_TYPES.has(t) || GENERATOR_TYPES.has(t) || SELF_UTIL.has(t)) return;
    if (b.constructionProgress < 1 || b.status === 'destroyed') {
      b.utilization = 0;
      return;
    }
    if (TANK_TYPES.has(t) || TERMINAL_TYPES.has(t) || OFFSHORE_HUB_TYPES.has(t)) b.utilization = fillFraction(rt.ctx, b);
    else if (BOOSTER_TYPES[t]) b.utilization += ((rt.operational(b) ? boosterUtilization(rt, b) : 0) - b.utilization) * alpha;
    else if (t === 'flare_stack') b.utilization = Math.min(1, -(b.io.natural_gas ?? 0) / FLARE_CAPACITY);
    else if (ALWAYS_ACTIVE.has(t)) b.utilization = rt.canRun(b) ? Math.min(1, rt.crew(b)) : 0;
    else b.utilization = rt.canRun(b) ? b.utilization : 0;
  }

  /** Turn this step's IO accumulators into smoothed per-day rates. Upstream types keep their own b.io. */
  private finalizeIo(b: BuildingState, days: number, alpha: number): void {
    const acc = this.rt.rtOf(b).ioAcc;
    if (this.rt.isUpstream(b) || days <= 0) {
      for (const k in acc) acc[k] = 0;
      return;
    }
    const io = b.io;
    for (const k in io) {
      const target = (acc[k] ?? 0) / days;
      const v = io[k] + (target - io[k]) * alpha;
      if (Math.abs(v) < 0.05 && !acc[k]) delete io[k];
      else io[k] = v;
    }
    for (const k in acc) {
      if (acc[k] !== 0 && io[k] === undefined) io[k] = (acc[k] / days) * alpha;
      acc[k] = 0;
    }
  }

  compute(b: BuildingState): BuildingStatus {
    const rt = this.rt;
    if (b.status === 'destroyed') return 'destroyed';
    if (b.fire > 0) return 'fire';
    if (b.constructionProgress < 1) return 'constructing';
    if (b.status === 'broken') return 'broken';
    if (!b.enabled) return 'disabled';
    if (rt.needsCrew(b) && rt.crew(b) <= 0) return 'unstaffed';
    if ((BUILDINGS[b.type]?.power ?? 0) > 0 && rt.powerFactor < 0.3) return 'no_power';
    if (rt.isUpstream(b)) return GENERIC.has(b.status) ? 'idle' : b.status;
    if (ALWAYS_ACTIVE.has(b.type)) return 'active';
    return b.utilization > 0.02 ? 'active' : 'idle';
  }
}
