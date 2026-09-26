// Test harness: builds a real GameSession (core loop, EventBus, CommandBus, state) with the facilities systems
// on a fake world, plus helpers that emulate what upstream/economy would do.
import { GameSession } from '../../src/core/Game';
import { createInitialState } from '../../src/core/state';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { addBuilding, createBuildingState } from '../../src/core/buildingUtil';
import { BUILDINGS } from '../../src/content/buildings';
import type { BuildingState, GameContext, IWorld, Rotation, Vec3, WellPurpose, WellState, Worker, WorkerRole } from '../../src/core/types';
import type { Difficulty } from '../../src/core/constants';
import { buildPlaceCommand, createFacilitySystems } from '../../src/sim/facilities';
import { FakeGeology, FakeWorld } from './fakeWorld';

export interface Harness {
  session: GameSession;
  ctx: GameContext;
  world: FakeWorld;
  geo: FakeGeology;
  events: Record<string, number>;
  log: Array<{ type: string; payload: unknown }>;
}

export function newHarness(opts: { hazards?: boolean; creative?: boolean; difficulty?: Difficulty; spawn?: Vec3; state?: ReturnType<typeof createInitialState>; edits?: ReturnType<FakeWorld['serializeEdits']> } = {}): Harness {
  const geo = new FakeGeology(7, 256, 256);
  const state =
    opts.state ??
    createInitialState(
      { saveName: 'test', companyName: 'Test Petroleum', seed: 7, worldSize: 'small', difficulty: opts.difficulty ?? 'normal', tutorial: false, hazards: opts.hazards ?? true, creative: opts.creative ?? false },
      'p1',
      opts.spawn ?? { x: 100, y: 70, z: 100 },
    );
  if (!opts.state) {
    state.company.money = 500_000_000;
    state.time.speed = 25;
  }
  const session = new GameSession(state, null as unknown as IWorld, geo, structuredClone(DEFAULT_SETTINGS), 'p1', createFacilitySystems());
  const world = new FakeWorld(geo, session.bus);
  session.world = world;
  session.ctx.world = world;
  if (opts.edits) world.loadEdits(opts.edits);
  const events: Record<string, number> = {};
  const log: Harness['log'] = [];
  for (const t of ['hazard:explosion', 'hazard:fireStarted', 'hazard:fireOut', 'hazard:spill', 'network:leak', 'network:rebuilt', 'building:completed', 'building:statusChanged', 'building:placed', 'building:removed'] as const) {
    session.bus.on(t, (p) => {
      events[t] = (events[t] ?? 0) + 1;
      if (t !== 'building:statusChanged' && t !== 'network:rebuilt') log.push({ type: t, payload: p });
    });
  }
  session.init();
  return { session, ctx: session.ctx, world, geo, events, log };
}

/** Run n steps, calling `before` (upstream/economy emulation) ahead of each. */
export function run(h: Harness, n: number, before?: (days: number) => void): void {
  const days = (2.4 * 0.1 * h.ctx.state.time.speed) / 1440;
  for (let i = 0; i < n; i++) {
    before?.(days);
    h.session.step();
  }
}
/** Steps per game hour at the harness speed. */
export const stepsPerHour = (h: Harness) => Math.round(60 / (0.24 * h.ctx.state.time.speed));

export function grantTech(h: Harness, ...ids: string[]) {
  for (const id of ids) if (!h.ctx.state.research.completed.includes(id)) h.ctx.state.research.completed.push(id);
}

let workerSeq = 0;
/** Hire & assign a full crew for the building. */
export function staff(h: Harness, b: BuildingState, skill = 3): void {
  const d = BUILDINGS[b.type];
  for (const [role, n] of Object.entries(d.crew) as [WorkerRole, number][]) {
    for (let i = 0; i < n; i++) {
      const w: Worker = { id: `wk${++workerSeq}`, name: `Worker ${workerSeq}`, role, skill, xp: 0, wage: 300, morale: 80, fatigue: 0, assignedTo: b.id, hiredDay: 1, portraitSeed: workerSeq };
      h.ctx.state.workforce.workers.push(w);
      b.workers.push(w.id);
    }
  }
}

/** Place through the command bus; throws with the reason if it fails. */
export function placeCmd(h: Harness, type: string, x: number, z: number, rotation: Rotation = 0): BuildingState {
  const res = h.ctx.commands.dispatch(buildPlaceCommand(type, x, z, rotation));
  if (!res.ok) throw new Error(`place ${type} @${x},${z}: ${res.error}`);
  return h.ctx.state.buildings[(res.data as { buildingId: string }).buildingId];
}

/** Emulate upstream: a completed well + its wellhead (3×3) with the min corner at (x, z). */
export function addWellhead(h: Harness, x: number, z: number, purpose: WellPurpose = 'development'): BuildingState {
  const ctx = h.ctx;
  const y = h.world.getSurfaceY(x + 1, z + 1);
  const wellId = ctx.newId('w');
  const well = {
    id: wellId, name: `Test ${wellId}`, x: x + 1, z: z + 1, surfaceY: y, offshore: false, purpose, status: purpose === 'development' ? 'producing' : 'injecting',
    plan: { kind: 'vertical', targetY: 20, casingPoints: [], mudWeight: 9 }, trajectory: [], measuredDepth: 50, plannedDepth: 50, currentY: 20,
    casing: [], mudWeight: 9, bitCondition: 100, kickVolume: 0, penetrated: [], completedReservoirs: [], reservoirContact: 1, fracStages: 0,
    choke: 1, lift: 'natural', productivity: 1, rates: { oil: 0, gas: 0, water: 0 }, bhp: 1000, waterCut: 0, gor: 500,
    cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: 1, cost: 0, owner: 'p1',
  } as WellState;
  ctx.state.wells[wellId] = well;
  const b = createBuildingState(ctx, 'wellhead', x, y, z, 0, { prebuilt: true });
  b.wellId = wellId;
  // Tests exercise pipeline/pit water handling; water hauling has its own dedicated test.
  b.config.truckWater = false;
  well.wellheadId = b.id;
  addBuilding(ctx, b);
  return b;
}

/** Upstream emulation: deposit produced fluids into wellhead storage (respecting def capacity). */
export function produce(b: BuildingState, days: number, rates: { crude_oil?: number; natural_gas?: number; produced_water?: number }) {
  const cap = BUILDINGS.wellhead.storage!;
  const catOf: Record<string, 'oil' | 'gas' | 'water'> = { crude_oil: 'oil', natural_gas: 'gas', produced_water: 'water' };
  for (const [item, rate] of Object.entries(rates)) {
    const c = cap[catOf[item]] ?? 0;
    b.storage[item] = Math.min(c, (b.storage[item] ?? 0) + rate * days);
  }
}

/** Straight pipe runs: along x first, then z (both at height y). */
export function pipe(h: Harness, block: number, x0: number, y: number, z0: number, x1: number, z1: number): number {
  let n = 0;
  const sx = Math.sign(x1 - x0) || 1;
  for (let x = x0; x !== x1 + sx; x += sx) {
    h.world.setBlock(x, y, z0, block, 'player');
    n++;
  }
  const sz = Math.sign(z1 - z0) || 1;
  for (let z = z0 + (z1 === z0 ? 0 : sz); z1 !== z0 && z !== z1 + sz; z += sz) {
    h.world.setBlock(x1, y, z, block, 'player');
    n++;
  }
  return n;
}

export function completeAll(h: Harness) {
  for (const b of Object.values(h.ctx.state.buildings)) if (b.constructionProgress < 1) b.constructionProgress = 0.99999;
  run(h, 1);
}
