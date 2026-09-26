// Minimal GameContext for the entity showcase: land for z < COAST_Z, ocean beyond.
// `terrain: 'hills'` adds rolling hills, a lake, a river and a few trees (for traffic pathfinding tests);
// the fake world records block edits (roads) and emits 'world:blockChanged' like the real one.
import { B } from '../../src/core/blocks';
import { CommandBus } from '../../src/core/commands';
import { EventBus } from '../../src/core/EventBus';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { createInitialState } from '../../src/core/state';
import { rotatedSize } from '../../src/core/buildingUtil';
import type { BuildingState, GameContext, IGeology, IWorld, Rotation, Services, WellState } from '../../src/core/types';

export const LAND_Y = 64;
export const SEABED_Y = 49;
export const COAST_Z = 118;
export const WORLD = 512;

export type FakeTerrain = 'flat' | 'hills';

/** Lake & river used by the hills terrain (block coords). */
export const LAKE = { x: 150, z: 52, r: 16 };
export const RIVER_X = 232;

export function fakeGeology(kind: FakeTerrain = 'flat'): IGeology {
  const surface = (x: number, z: number): number => {
    if (z >= COAST_Z) return SEABED_Y;
    if (kind === 'flat') return LAND_Y;
    const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
    if (dl < LAKE.r) return 57;
    if (Math.abs(x - RIVER_X) < 4 && z < COAST_Z) return 58;
    const hills = 2.2 + 3.2 * Math.sin(x / 19) * Math.cos(z / 23) + 2.5 * Math.sin((x + 2 * z) / 41) + (x > 260 && z < 60 ? 7 * Math.sin((x - 260) / 30) ** 2 : 0);
    const shore = Math.min(1, (COAST_Z - z) / 12, dl > LAKE.r ? (dl - LAKE.r) / 8 : 0, Math.abs(x - RIVER_X) >= 4 ? (Math.abs(x - RIVER_X) - 4) / 6 : 0);
    return Math.round(LAND_Y + hills * Math.max(0, shore));
  };
  const water = (x: number, z: number) => Math.max(0, 63 - surface(x, z));
  return {
    seed: 1,
    sizeX: WORLD,
    sizeZ: WORLD,
    reservoirs: [],
    faults: [],
    aquifers: [],
    surfaceHeight: surface,
    waterDepth: (x, z) => (surface(x, z) < 63 ? water(x, z) : 0),
    isOffshore: (_x, z) => z >= COAST_Z,
    biomeAt: (_x, z) => (z < COAST_Z ? 'plains' : 'ocean'),
    rockAt: () => 'sandstone',
    properties: () => ({ rock: 'sandstone', porosity: 0.2, permeability: 100, hardness: 1, impedance: 5, gammaRay: 40, resistivity: 10, density: 2.3, fluid: 'brine' }),
    reservoirAt: () => null,
    aquiferAt: () => null,
    porePressure: () => 3000,
    fracturePressure: () => 5000,
    getReservoir: () => undefined,
  };
}

export interface FakeWorld extends IWorld {
  bus: EventBus | null;
  /** Tree trunks (x,z) → trunk height. */
  trees: Map<number, number>;
}

export function fakeWorld(geology: IGeology): FakeWorld {
  const edits = new Map<string, number>();
  const colTop = new Map<number, number>();
  const trees = new Map<number, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const natural = (x: number, y: number, z: number): number => {
    const s = geology.surfaceHeight(x, z);
    if (y < s) return B.STONE;
    const t = trees.get(x * 4096 + z);
    if (t && y < s + t) return B.LOG_OAK;
    if (t && y < s + t + 2 && y >= s + t - 1) return B.LEAVES_OAK;
    return y <= 62 ? B.WATER : B.AIR;
  };
  const world: FakeWorld = {
    bus: null,
    trees,
    sizeX: WORLD,
    sizeZ: WORLD,
    height: 160,
    seed: 1,
    geology,
    getBlock: (x, y, z) => {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      const e = edits.get(key(x, y, z));
      return e ?? natural(x, y, z);
    },
    setBlock: (x, y, z, id, source = 'system') => {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      const prev = world.getBlock(x, y, z);
      edits.set(key(x, y, z), id);
      if (id !== B.AIR) colTop.set(x * 4096 + z, Math.max(colTop.get(x * 4096 + z) ?? 0, y + 1));
      world.bus?.emit('world:blockChanged', { x, y, z, prev, id, source });
      return true;
    },
    inBounds: (x, y, z) => x >= 0 && z >= 0 && x < WORLD && z < WORLD && y >= 0 && y < 160,
    isSolid: (x, y, z) => {
      const id = world.getBlock(x, y, z);
      return id !== B.AIR && id !== B.WATER;
    },
    getSurfaceY: (x, z) => {
      x = Math.floor(x);
      z = Math.floor(z);
      let y = geology.surfaceHeight(x, z);
      const t = trees.get(x * 4096 + z);
      if (t) y += t + 2;
      return Math.max(y, colTop.get(x * 4096 + z) ?? 0);
    },
    ensureChunk: () => {},
    isChunkGenerated: () => true,
    getChunkData: () => undefined,
    chunksX: WORLD / 16,
    chunksZ: WORLD / 16,
    forEachEdit: (fn) => {
      for (const [k, id] of edits) {
        const [x, y, z] = k.split(',').map(Number);
        fn(x, y, z, id);
      }
    },
    serializeEdits: () => ({ chunks: {} }),
    loadEdits: () => {},
  };
  return world;
}

export function createFakeContext(terrain: FakeTerrain = 'flat'): GameContext & { world: FakeWorld } {
  const geology = fakeGeology(terrain);
  const world = fakeWorld(geology);
  const state = createInitialState(
    { saveName: 'showcase', companyName: 'Blackrock Energy', seed: 1, worldSize: 'medium', difficulty: 'normal', tutorial: false, hazards: true, creative: true },
    'p1',
    { x: 100, y: 70, z: 100 },
  );
  state.company.name = 'Blackrock Energy';
  state.weather.windSpeed = 6;
  state.weather.windDir = 0.5;
  let n = 1;
  const services = {} as Services;
  const bus = new EventBus();
  world.bus = bus;
  const ctx = {
    state,
    world,
    geology,
    bus,
    commands: new CommandBus(),
    services,
    settings: structuredClone(DEFAULT_SETTINGS),
    localPlayerId: 'p1',
    isAuthority: true,
    rng: () => Math.random(),
    newId: (p: string) => `${p}${n++}`,
    notify: () => {},
    transact: () => true,
    hasTech: () => true,
    modifier: () => 1,
  };
  return ctx;
}

export function addBuilding(ctx: GameContext, type: string, x: number, y: number, z: number, rotation: Rotation = 0, patch: Partial<BuildingState> = {}): BuildingState {
  const id = ctx.newId('b');
  const b: BuildingState = {
    id, type, x, y, z, rotation, size: rotatedSize(type, rotation), status: 'active', enabled: true, constructionProgress: 1, condition: 100,
    fire: 0, builtDay: 1, lastMaintenanceDay: 1, storage: {}, throttle: 1, utilization: 0.8, io: {}, workers: [], config: {}, owner: 'p1', data: {},
    ...patch,
  };
  ctx.state.buildings[id] = b;
  ctx.bus.emit('building:placed', { id });
  return b;
}

export function addWell(ctx: GameContext, x: number, y: number, z: number, patch: Partial<WellState> = {}): WellState {
  const id = ctx.newId('w');
  const w: WellState = {
    id, name: `Showcase ${id}`, x, z, surfaceY: y, offshore: false, purpose: 'development', status: 'producing',
    plan: { kind: 'vertical', targetY: 20, casingPoints: [], mudWeight: 9 }, trajectory: [], measuredDepth: 30, plannedDepth: 40, currentY: 30,
    casing: [], mudWeight: 9, bitCondition: 100, kickVolume: 0, penetrated: [], completedReservoirs: [], reservoirContact: 1, fracStages: 0,
    choke: 1, lift: 'natural', productivity: 1, rates: { oil: 250, gas: 400, water: 50 }, bhp: 2000, waterCut: 0.2, gor: 800,
    cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: 1, cost: 0, owner: 'p1',
    ...patch,
  };
  ctx.state.wells[id] = w;
  return w;
}
