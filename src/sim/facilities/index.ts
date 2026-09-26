// Facilities module entry: construction, pipe networks, processing, storage, power, logistics hand-off,
// maintenance, fires, spills and emissions. All systems share one FacilityRuntime (non-persistent caches).
//
// Step order (after upstream has filled wellhead storage):
//   facilities       caches, construction progress, topology rebuild (when dirty)
//   facilities.power       grid dispatch → power factor
//   facilities.processing  recipes
//   facilities.networks    pipeline flow, wellhead flaring
//   facilities.environment water pits / disposal, emissions & CCS
//   facilities.maintenance wear, failures, depots, repairs
//   facilities.hazards     fires, explosions, leaks & spills
//   facilities.status      utilisation, IO smoothing, status machine, hourly money settlement
import type { GameContext, SimStep, SimSystem } from '../../core/types';
import { ConstructionSystem } from './construction';
import { EmissionsSystem } from './emissions';
import { FireSystem } from './fires';
import { MaintenanceSystem } from './maintenance';
import { FlowEngine } from './networks/flow';
import { PowerSystem } from './power';
import { ProcessingSystem } from './processing';
import { FacilityRuntime } from './runtime';
import { SpillSystem } from './spills';
import { StatusSystem } from './status';
import { WaterSystem } from './water';
import { registerFacilityCommands } from './commands';
export { buildPlaceCommand, placeType } from './commands';
import { installFacilityServices } from './services';

export { CONFIG_SCHEMA, type ConfigSpec } from './config';
export { capacityOf, fillFraction, usedOf } from './storage';
export { daylight, windCurve } from './power';
export { FLARE_CAPACITY, type LeakExt, type NetworkExt } from './networks/flow';
export { REFUND_COMPLETE, REFUND_CONSTRUCTING } from './construction';
export { FacilityRuntime } from './runtime';

export function createFacilitySystems(): SimSystem[] {
  const rt = new FacilityRuntime();
  const construction = new ConstructionSystem(rt);
  const power = new PowerSystem(rt);
  const processing = new ProcessingSystem(rt);
  const flow = new FlowEngine(rt);
  const spills = new SpillSystem(rt);
  const water = new WaterSystem(rt, spills);
  const emissions = new EmissionsSystem(rt);
  const maintenance = new MaintenanceSystem(rt);
  const fires = new FireSystem(rt);
  const status = new StatusSystem(rt);
  flow.leakSink = (net, item, qty) => spills.onLeakLoss(net, item, qty);
  maintenance.ignite = (b, intensity, cause) => void fires.igniteBuilding(b, intensity, cause);

  const core: SimSystem = {
    id: 'facilities',
    init(ctx: GameContext) {
      rt.dispose();
      rt.attach(ctx);
      rt.refreshBuildings();
      rt.topology.initFromWorld();
      rt.disposers.push(
        ctx.bus.on('world:blockChanged', (e) => rt.topology.onBlockChanged(e.x, e.y, e.z, e.prev, e.id)),
        ctx.bus.on('building:placed', () => rt.markBuildingsDirty()),
        ctx.bus.on('building:removed', () => rt.markBuildingsDirty()),
              );
      installFacilityServices(ctx, rt);
      registerFacilityCommands(ctx, { rt, construction, maintenance, fires, spills });
      if (ctx.isAuthority && ctx.state.time.tick === 0 && Object.keys(ctx.state.buildings).length === 0) construction.placeStartingOffice();
      rt.topology.rebuild();
    },
    tick(ctx: GameContext, step: SimStep) {
      rt.refreshBuildings();
      rt.beginStep(step.minutes);
      construction.tick(step);
      rt.topology.maybeRebuild();
    },
    onNewDay(ctx: GameContext, day: number) {
      maintenance.chargeOpex();
      spills.onNewDay(day);
      // daysSinceIncident is derived daily by the economy's workforce system.
    },
    dispose() {
      rt.dispose();
    },
  };

  const sys = (id: string, fn: (step: SimStep) => void): SimSystem => ({ id, init() {}, tick: (_ctx, step) => fn(step) });
  return [
    core,
    sys('facilities.power', (s) => power.tick(s)),
    sys('facilities.processing', (s) => processing.tick(s)),
    sys('facilities.networks', (s) => flow.tick(s)),
    sys('facilities.environment', (s) => {
      water.tick(s);
      emissions.tick(s);
    }),
    sys('facilities.maintenance', (s) => maintenance.tick(s)),
    sys('facilities.hazards', (s) => {
      fires.tick(s);
      spills.tick(s);
    }),
    sys('facilities.status', (s) => {
      status.tick(s);
      if (rt.newHour) rt.flushMoney();
    }),
  ];
}
