// Emissions accounting (t CO2e/day × load × emissions modifier) and carbon capture units.
// Flaring emissions are added where gas is flared (flow engine); this covers combustion/process emissions.
import { BUILDINGS } from '../../content/buildings';
import type { BuildingState, SimStep } from '../../core/types';
import { OFFSHORE_HUB_TYPES, emaAlpha } from './catalog';
import { centerDist, type FacilityRuntime } from './runtime';
import { addStorage, capacityOf, usedOf } from './storage';

export const CCS_CAPACITY = 1000; // t/day
export const CCS_RANGE = 64;
const CCS_CAPTURE_FRACTION = 0.9;

export class EmissionsSystem {
  private readonly ccs: BuildingState[] = [];
  constructor(private readonly rt: FacilityRuntime) {}

  /** Load 0..1 used to scale def.emissions. */
  load(b: BuildingState): number {
    if (b.constructionProgress < 1 || b.status === 'destroyed') return 0;
    if (this.rt.isUpstream(b)) return b.status === 'active' ? 1 : 0;
    if (OFFSHORE_HUB_TYPES.has(b.type)) return this.rt.operational(b) ? 0.8 : 0;
    return this.rt.operational(b) ? b.utilization : 0;
  }

  tick(step: SimStep): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const mod = ctx.modifier('emissions');
    let total = 0; // t/day
    this.ccs.length = 0;
    for (const b of rt.list) {
      const e = BUILDINGS[b.type]?.emissions ?? 0;
      const r = rt.rtOf(b);
      r.emitRate = e > 0 ? e * this.load(b) * mod : 0;
      total += r.emitRate;
      if (b.type === 'ccs_unit' && b.constructionProgress >= 1) this.ccs.push(b);
    }
    const alpha = emaAlpha(step.minutes);
    for (const c of this.ccs) {
      const eff = rt.efficiency(c);
      let captured = 0; // t/day
      if (eff > 0) {
        const capRate = CCS_CAPACITY * eff;
        let avail = 0;
        for (const b of rt.list) {
          if (b === c) continue;
          const r = rt.rtOf(b);
          if (r.emitRate > 0 && centerDist(b, c) <= CCS_RANGE) avail += r.emitRate * CCS_CAPTURE_FRACTION;
        }
        captured = Math.min(capRate, avail);
        if (captured > 0) {
          const f = captured / avail;
          for (const b of rt.list) {
            if (b === c) continue;
            const r = rt.rtOf(b);
            if (r.emitRate > 0 && centerDist(b, c) <= CCS_RANGE) r.emitRate -= r.emitRate * CCS_CAPTURE_FRACTION * f;
          }
          total -= captured;
          this.route(c, captured * step.days);
        }
      }
      c.utilization += (Math.min(1, captured / CCS_CAPACITY) - c.utilization) * alpha;
      c.data.capturedRate = Math.round(captured);
    }
    const env = ctx.state.environment;
    const t = Math.max(0, total) * step.days;
    env.emissionsToday += t;
    env.emissionsTotal += t;
  }

  /** Captured CO2 → pipeline (EOR) or carbon credits. */
  private route(c: BuildingState, tonnes: number): void {
    const rt = this.rt;
    const ctx = rt.ctx;
    const mode = (c.config.mode as string) ?? 'auto';
    let toPipe = mode === 'eor';
    if (mode === 'auto') {
      for (const id of rt.rtOf(c).networks) {
        const n = rt.topology.byId.get(id);
        if (!n || n.cat !== 'gas') continue;
        for (const b of n.buildings) {
          const w = b.type === 'wellhead' && b.wellId ? ctx.state.wells[b.wellId] : undefined;
          if (w && w.purpose === 'injector_co2') toPipe = true;
        }
      }
    }
    let credits = tonnes;
    if (toPipe) {
      const room = Math.max(0, capacityOf(ctx, c, 'gas') - usedOf(c, 'gas'));
      const put = Math.min(room, tonnes);
      addStorage(c, 'co2', put);
      rt.io(c, 'co2', put);
      credits -= put;
    }
    if (credits > 0) ctx.state.environment.carbonCredits += credits;
  }
}
