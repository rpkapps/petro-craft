// Session-scoped (non-persistent) caches and per-step accumulators shared by the upstream systems.
// Everything here can be rebuilt from GameState + IGeology, so nothing in it is saved.
import type { Aquifer, GameContext, Reservoir, Vec3, WellPlan } from '../../core/types';
import { planTrajectory } from './trajectory';

export interface StepFlow {
  /** Reservoir-barrel voidage this step (production, blowouts). */
  voidRb: number;
  /** Reservoir-barrel injection this step. */
  injRb: number;
}

export class UpstreamRuntime {
  private resById = new Map<string, Reservoir>();
  private trajCache = new Map<string, { key: string; pts: Vec3[] }>();
  private aquiferCols = new Map<string, Aquifer[]>();
  readonly flows = new Map<string, StepFlow>();
  /** Offshore production hubs (platform/FPSO ids) refreshed each production tick. */
  hubs: string[] = [];

  constructor(public ctx: GameContext) {
    for (const r of ctx.geology.reservoirs) this.resById.set(r.id, r);
  }

  reservoir(id: string): Reservoir | undefined {
    let r = this.resById.get(id);
    if (!r) {
      r = this.ctx.geology.getReservoir(id);
      if (r) this.resById.set(id, r);
    }
    return r;
  }

  flow(id: string): StepFlow {
    let f = this.flows.get(id);
    if (!f) this.flows.set(id, (f = { voidRb: 0, injRb: 0 }));
    return f;
  }

  resetFlows(): void {
    for (const f of this.flows.values()) {
      f.voidRb = 0;
      f.injRb = 0;
    }
  }

  /** Planned trajectory polyline (1-block MD spacing) for a well, cached by plan. */
  trajectory(wellId: string, x: number, y: number, z: number, plan: WellPlan): Vec3[] {
    const key = `${x},${y},${z}|${plan.kind}|${plan.targetY}|${plan.kickoffY ?? ''}|${plan.azimuth ?? ''}|${plan.offset ?? ''}|${plan.lateralLength ?? ''}`;
    const c = this.trajCache.get(wellId);
    if (c && c.key === key) return c.pts;
    const pts = planTrajectory(x, y, z, plan);
    this.trajCache.set(wellId, { key, pts });
    return pts;
  }

  forgetWell(wellId: string): void {
    this.trajCache.delete(wellId);
  }

  /** Fresh-water aquifers whose outline covers a column. */
  freshAquifersAt(x: number, z: number): Aquifer[] {
    const k = `${x},${z}`;
    let a = this.aquiferCols.get(k);
    if (!a) {
      a = this.ctx.geology.aquifers.filter((q) => q.fresh && ((x - q.center.x) / q.radiusX) ** 2 + ((z - q.center.z) / q.radiusZ) ** 2 <= 1);
      if (this.aquiferCols.size > 512) this.aquiferCols.clear();
      this.aquiferCols.set(k, a);
    }
    return a;
  }
}
