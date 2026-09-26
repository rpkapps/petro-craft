// Minimal GameContext for the entity showcase: flat land for z < COAST_Z, ocean beyond.
import { CommandBus } from '../../src/core/commands';
import { EventBus } from '../../src/core/EventBus';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { createInitialState } from '../../src/core/state';
import { rotatedSize } from '../../src/core/buildingUtil';
import type { BuildingState, GameContext, IGeology, IWorld, Rotation, Services, WellState } from '../../src/core/types';

export const LAND_Y = 64;
export const SEABED_Y = 49;
export const COAST_Z = 118;

export function fakeGeology(): IGeology {
  const surface = (_x: number, z: number) => (z < COAST_Z ? LAND_Y : SEABED_Y);
  return {
    seed: 1,
    sizeX: 512,
    sizeZ: 512,
    reservoirs: [],
    faults: [],
    aquifers: [],
    surfaceHeight: surface,
    waterDepth: (x, z) => (z < COAST_Z ? 0 : 63 - surface(x, z)),
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

export function fakeWorld(geology: IGeology): IWorld {
  return {
    sizeX: 512,
    sizeZ: 512,
    height: 160,
    seed: 1,
    geology,
    getBlock: (x, y, z) => (y < geology.surfaceHeight(x, z) ? 3 : z >= COAST_Z && y <= 62 ? 9 : 0),
    setBlock: () => true,
    inBounds: (x, y, z) => x >= 0 && z >= 0 && x < 512 && z < 512 && y >= 0 && y < 160,
    isSolid: (x, y, z) => y < geology.surfaceHeight(x, z),
    getSurfaceY: (x, z) => geology.surfaceHeight(x, z),
    ensureChunk: () => {},
    isChunkGenerated: () => true,
    getChunkData: () => undefined,
    chunksX: 32,
    chunksZ: 32,
    forEachEdit: () => {},
    serializeEdits: () => ({ chunks: {} }),
    loadEdits: () => {},
  };
}

export function createFakeContext(): GameContext {
  const geology = fakeGeology();
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
  const ctx: GameContext = {
    state,
    world,
    geology,
    bus: new EventBus(),
    commands: new CommandBus(),
    services,
    settings: structuredClone(DEFAULT_SETTINGS),
    localPlayerId: 'p1',
    isAuthority: true,
    rng: () => Math.random(),
    newId: (p) => `${p}${n++}`,
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
