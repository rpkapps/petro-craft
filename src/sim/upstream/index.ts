// Upstream: exploration (seismic), drilling & well control, completions, reservoirs and production.
//
// createUpstreamSystems() returns three systems sharing one session runtime:
//   upstream.exploration — reservoir state init, services (seismic, wells), command registration, surveys
//   upstream.drilling    — drilling, trips, casing, kicks, blowouts, completion/frac/workover ops, rig status
//   upstream.production  — deliverability, injection, reservoir material balance, daily histories & estimates
import { RIG_TYPES } from '../../core/buildingUtil';
import { MINUTES_PER_DAY } from '../../core/constants';
import type { GameContext, SimStep, SimSystem } from '../../core/types';
import { registerCommands } from './commands';
import { tickDrillingWell, tickBlowoutWell } from './drilling';
import { tickSurveys } from './exploration';
import { tickWellOp } from './completion';
import { rollWellHistory, tickProduction } from './production';
import { createReservoirState, refreshEstimates } from './reservoir';
import { UpstreamRuntime } from './runtime';
import { installServices } from './services';
import { MAX_SUBSTEP_MINUTES } from './tuning';
import { DRILLING_STATUSES, flushBills, isInjectorPurpose, setWellStatus, ux, wellPos } from './wellData';
import { setUpstreamBuildingStatus } from './util';

export { UpstreamRuntime } from './runtime';
export { SeismicService } from './seismic';
export { planTrajectory, designTrajectory } from './trajectory';
export { pressureProfile, suggestPlan, quoteWell, rigLimits, pressureConfidence } from './planning';
export { surveyQuote, estimateText } from './exploration';
export { fracMultiplier } from './completion';
export { ultimateRecovery, effectiveWaterDrive } from './reservoir';
export { ux as wellExt, rx as reservoirExt } from './wellData';
export type { WellExt, WellOp, ReservoirExt, ResContact } from './wellData';
export { RIG_SPECS, LIFT_SPECS } from './tuning';

interface Shared {
  rt?: UpstreamRuntime;
  unsub: (() => void)[];
}

class ExplorationSystem implements SimSystem {
  id = 'upstream.exploration';
  constructor(private sh: Shared) {}

  init(ctx: GameContext): void {
    const rt = new UpstreamRuntime(ctx);
    this.sh.rt = rt;
    for (const R of ctx.geology.reservoirs) {
      if (!ctx.state.reservoirs[R.id]) ctx.state.reservoirs[R.id] = createReservoirState(ctx, R);
    }
    installServices(ctx, rt);
    registerCommands(ctx, rt);
    this.sh.unsub.push(ctx.bus.on('building:removed', ({ id, type }) => onBuildingRemoved(ctx, id, type)));
  }

  tick(ctx: GameContext, step: SimStep): void {
    tickSurveys(ctx, step.days);
  }

  dispose(): void {
    for (const u of this.sh.unsub.splice(0)) u();
  }
}

/** A rig or wellhead was demolished by the player / destroyed. */
function onBuildingRemoved(ctx: GameContext, id: string, type: string): void {
  if (RIG_TYPES.has(type)) {
    for (const b of Object.values(ctx.state.buildings)) if (b.data?.underRig === id) delete b.data.underRig;
    return;
  }
  if (type !== 'wellhead') return;
  for (const w of Object.values(ctx.state.wells)) {
    if (w.wellheadId !== id) continue;
    w.wellheadId = undefined;
    w.rates = { oil: 0, gas: 0, water: 0 };
    if (w.status === 'producing' || w.status === 'injecting') {
      const e = ux(w);
      e.prevStatus = w.status;
      e.manualShutIn = true;
      setWellStatus(ctx, w, 'shut_in');
      ctx.notify('warning', `${w.name} shut in`, 'Its wellhead was removed. Plug & abandon the well, or it stays shut in.', wellPos(w));
    }
  }
}

class DrillingSystem implements SimSystem {
  id = 'upstream.drilling';
  constructor(private sh: Shared) {}
  init(): void {}

  tick(ctx: GameContext, step: SimStep): void {
    const rt = this.sh.rt;
    if (!rt) return;
    const hours = step.minutes / 60;
    const busyRigs = new Set<string>();
    for (const w of Object.values(ctx.state.wells)) {
      const s = w.status;
      if (DRILLING_STATUSES.has(s)) {
        tickDrillingWell(ctx, rt, w, hours);
        if (w.rigId) busyRigs.add(w.rigId);
      } else if (s === 'blowout') {
        tickBlowoutWell(ctx, rt, w, hours);
        if (w.rigId) busyRigs.add(w.rigId);
      } else if (ux(w).op) {
        tickWellOp(ctx, rt, w, hours);
        if (w.status === 'completing' && w.rigId) busyRigs.add(w.rigId);
      }
      if (s !== 'planned' && s !== 'plugged' && s !== 'dry_hole') flushBills(ctx, w, false);
    }
    // Rigs without work go idle; frac spreads idle when not pumping.
    for (const b of Object.values(ctx.state.buildings)) {
      if (b.status !== 'active') continue;
      if (RIG_TYPES.has(b.type) && !busyRigs.has(b.id)) setUpstreamBuildingStatus(ctx, b, false, 0);
      else if (b.type === 'frac_spread' && !(b.wellId && ctx.state.wells[b.wellId]?.status === 'fracking')) setUpstreamBuildingStatus(ctx, b, false, 0);
    }
  }

  onNewDay(ctx: GameContext): void {
    for (const w of Object.values(ctx.state.wells)) flushBills(ctx, w, true);
  }
}

class ProductionSystem implements SimSystem {
  id = 'upstream.production';
  constructor(private sh: Shared) {}
  init(): void {}

  tick(ctx: GameContext, step: SimStep): void {
    const rt = this.sh.rt;
    if (!rt) return;
    const n = Math.max(1, Math.ceil(step.minutes / MAX_SUBSTEP_MINUTES));
    const dt = step.minutes / MINUTES_PER_DAY / n;
    for (let i = 0; i < n; i++) tickProduction(ctx, rt, dt);
  }

  onNewDay(ctx: GameContext, day: number): void {
    const rt = this.sh.rt;
    rollWellHistory(ctx, day);
    if (!rt) return;
    for (const s of Object.values(ctx.state.reservoirs)) {
      const R = rt.reservoir(s.id);
      if (R) refreshEstimates(ctx, R, s);
    }
  }
}

export function createUpstreamSystems(): SimSystem[] {
  const sh: Shared = { unsub: [] };
  return [new ExplorationSystem(sh), new DrillingSystem(sh), new ProductionSystem(sh)];
}

/** True for injector / disposal purposes (UI helper). */
export { isInjectorPurpose };
