// Test harness: real GameSession + createInitialState + upstream systems on the fake geology/world,
// with small emulations of what facilities/economy would do (staffing, leases, draining wellhead storage).
import { GameSession } from '../../src/core/Game';
import { createInitialState } from '../../src/core/state';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { addBuilding, createBuildingState } from '../../src/core/buildingUtil';
import { BUILDINGS } from '../../src/content/buildings';
import { PARCEL_SIZE } from '../../src/core/constants';
import type { BuildingState, GameContext, GameState, IWorld, Rotation, WellState, Worker, WorkerRole } from '../../src/core/types';
import type { Command, CommandResult, CommandType } from '../../src/core/commands';
import { createUpstreamSystems } from '../../src/sim/upstream';
import { FakeGeology, FakeWorld } from './fakeGeo';

export interface Sales { oil: number; gas: number; water: number; revenue: number }

export interface Harness {
  session: GameSession;
  ctx: GameContext;
  world: FakeWorld;
  geo: FakeGeology;
  events: Record<string, number>;
  notes: { level: string; title: string; text?: string; day: number }[];
  sales: Sales;
  /** Per-well revenue (net of 12.5 % royalty) at $70/bbl and $2.6/mcf. */
  wellRevenue: Record<string, number>;
  /** Water supplied to injector wellheads per step (bbl/day). */
  waterSupply: number;
  drain: boolean;
}

export const OIL_PRICE = 70;
export const GAS_PRICE = 2.6;
export const ROYALTY = 0.125;

export function newHarness(opts: { money?: number; hazards?: boolean; techs?: string[]; state?: GameState } = {}): Harness {
  const geo = new FakeGeology(7);
  const state = opts.state ?? createInitialState(
    { saveName: 'upstream-test', companyName: 'Lone Star Petroleum', seed: 7, worldSize: 'small', difficulty: 'normal', tutorial: false, hazards: opts.hazards ?? true, creative: false },
    'p1',
    { x: 64, y: 82, z: 64 },
  );
  if (opts.money !== undefined) state.company.money = opts.money;
  state.time.speed = 25;
  for (const t of opts.techs ?? []) if (!state.research.completed.includes(t)) state.research.completed.push(t);
  const session = new GameSession(state, null as unknown as IWorld, geo, structuredClone(DEFAULT_SETTINGS), 'p1', createUpstreamSystems());
  const world = new FakeWorld(geo, session.bus);
  session.world = world;
  session.ctx.world = world;
  const events: Record<string, number> = {};
  const notes: Harness['notes'] = [];
  const h: Harness = { session, ctx: session.ctx, world, geo, events, notes, sales: { oil: 0, gas: 0, water: 0, revenue: 0 }, wellRevenue: {}, waterSupply: 0, drain: true };
  const evs = ['well:created', 'well:spud', 'well:progress', 'well:discovery', 'well:dryHole', 'well:kick', 'well:blowout', 'well:blowoutControlled', 'well:completed', 'well:statusChanged',
    'survey:started', 'survey:completed', 'hazard:fireStarted', 'hazard:fireOut', 'hazard:spill', 'hazard:explosion', 'building:placed', 'building:removed', 'building:statusChanged', 'ui:error'] as const;
  for (const t of evs) session.bus.on(t, () => (events[t] = (events[t] ?? 0) + 1));
  session.bus.on('notify', (n) => notes.push({ level: n.level, title: n.title, text: n.text, day: n.day }));
  session.init();
  // Minimal construction service (facilities is not part of this test) for rig/skid validation.
  session.ctx.services.construction = {
    validate: (type, x, z, rotation) => {
      const [w, d] = rotation % 2 ? [BUILDINGS[type].size[1], BUILDINGS[type].size[0]] : [BUILDINGS[type].size[0], BUILDINGS[type].size[1]];
      if (x < 0 || z < 0 || x + w > geo.sizeX || z + d > geo.sizeZ) return { ok: false, reason: 'Out of bounds', y: 0, cost: 0 };
      return { ok: true, y: world.getSurfaceY(x + (w >> 1), z + (d >> 1)), cost: BUILDINGS[type].cost };
    },
    buildingAt: () => undefined,
    footprint: (type) => BUILDINGS[type].size,
  };
  return h;
}

export function cmd<K extends CommandType>(h: Harness, c: Command<K>): CommandResult {
  return h.ctx.commands.dispatch(c);
}

let workerSeq = 0;
export function staff(h: Harness, b: BuildingState): void {
  const crew = BUILDINGS[b.type].crew;
  for (const [role, n] of Object.entries(crew) as [WorkerRole, number][]) {
    for (let i = 0; i < n; i++) {
      const w: Worker = { id: `wk${++workerSeq}`, name: `Worker ${workerSeq}`, role, skill: 3, xp: 0, wage: 350, morale: 80, fatigue: 0, assignedTo: b.id, hiredDay: 1, portraitSeed: workerSeq };
      h.ctx.state.workforce.workers.push(w);
      b.workers.push(w.id);
    }
  }
}

/** Place a prebuilt, staffed building with its footprint centred on (cx, cz). */
export function place(h: Harness, type: string, cx: number, cz: number, rotation: Rotation = 0): BuildingState {
  const [w, d] = BUILDINGS[type].size;
  const x = cx - (w >> 1);
  const z = cz - (d >> 1);
  const y = BUILDINGS[type].placement === 'water' ? 63 : h.world.getSurfaceY(cx, cz);
  const b = createBuildingState(h.ctx, type, x, y, z, rotation, { prebuilt: true });
  addBuilding(h.ctx, b);
  staff(h, b);
  return b;
}

export function lease(h: Harness, x: number, z: number): void {
  const px = Math.floor(x / PARCEL_SIZE);
  const pz = Math.floor(z / PARCEL_SIZE);
  h.ctx.state.leases[`${px},${pz}`] = { px, pz, owner: 'p1', acquiredDay: h.ctx.state.time.day, price: 0, royalty: ROYALTY };
}

/** Emulate facilities: sell everything in wellhead/hub storage and feed water to injectors. */
function emulateFacilities(h: Harness): void {
  const st = h.ctx.state;
  for (const b of Object.values(st.buildings)) {
    if (b.type !== 'wellhead' && b.type !== 'production_platform') continue;
    const well = b.wellId ? st.wells[b.wellId] : undefined;
    const injector = well && (well.purpose.startsWith('injector') || well.purpose === 'disposal');
    if (injector) {
      const add = (h.waterSupply * 2.4 * 0.1 * st.time.speed) / 1440;
      b.storage.fresh_water = Math.min(400, (b.storage.fresh_water ?? 0) + add);
      continue;
    }
    if (!h.drain) continue;
    const oil = (b.storage.crude_oil ?? 0) + (b.storage.condensate ?? 0);
    const gas = b.storage.natural_gas ?? 0;
    const water = b.storage.produced_water ?? 0;
    b.storage.crude_oil = 0;
    b.storage.condensate = 0;
    b.storage.natural_gas = 0;
    b.storage.produced_water = 0;
    const rev = (oil * OIL_PRICE + gas * GAS_PRICE) * (1 - ROYALTY);
    h.sales.oil += oil;
    h.sales.gas += gas;
    h.sales.water += water;
    h.sales.revenue += rev;
    if (well) h.wellRevenue[well.id] = (h.wellRevenue[well.id] ?? 0) + rev;
  }
}

export const STEPS_PER_HOUR = 10; // at 25×: 6 game minutes per 100 ms step

export function runHours(h: Harness, hours: number, until?: () => boolean): number {
  const n = Math.round(hours * STEPS_PER_HOUR);
  for (let i = 0; i < n; i++) {
    h.ctx.state.time.speed = 25; // kicks drop the speed to 1×; the test keeps its fixed time base
    h.session.step();
    emulateFacilities(h);
    if (until?.()) return (i + 1) / STEPS_PER_HOUR;
  }
  return hours;
}
export const runDays = (h: Harness, days: number, until?: () => boolean) => runHours(h, days * 24, until) / 24;

export function nowDays(h: Harness): number {
  return h.ctx.state.time.day + h.ctx.state.time.minuteOfDay / 1440;
}

export function wellOf(h: Harness, id: string): WellState {
  return h.ctx.state.wells[id];
}
