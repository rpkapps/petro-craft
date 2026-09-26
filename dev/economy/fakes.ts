// Minimal fake IWorld / IGeology for headless economy tests. Land for x < 400, ocean beyond.
import type { Aquifer, BiomeId, IGeology, IWorld, Reservoir, RockProperties, RockType, WellState, WorldEditsSave } from '../../src/core/types';
import { B } from '../../src/core/blocks';

function reservoir(id: string, name: string, fluid: Reservoir['fluid'], cx: number, cz: number, r: number, oil: number, gas: number, offshore = false): Reservoir {
  return {
    id, name, fluid, trap: 'anticline', lithology: 'sandstone', center: { x: cx, y: 30, z: cz }, radiusX: r, radiusZ: r * 0.8, topY: 34, bottomY: 26,
    compartment: 0, offshore, porosity: 0.22, permeability: 150, netToGross: 0.8, waterSaturation: 0.25, initialPressure: 3800, temperature: 85,
    bubblePoint: 2200, apiGravity: 36, gasOilRatio: 650, h2s: 0, co2: 0.01, oilInPlace: oil, gasInPlace: gas, waterDrive: 0.5, gasCap: false, owcY: 27,
  };
}

export function createFakeGeology(seed: number, size = 512): IGeology {
  const reservoirs = [
    reservoir('r1', 'Eagle Sand A', 'oil', 210, 190, 30, 40e6, 26e6),
    reservoir('r2', 'Hawk Dolomite', 'oil', 90, 380, 22, 12e6, 8e6),
    reservoir('r3', 'Kestrel Gas', 'gas', 330, 120, 26, 0, 180e6),
    reservoir('r4', 'Marlin Deep', 'oil', 460, 300, 35, 150e6, 90e6, true),
  ];
  const aquifers: Aquifer[] = [];
  const props = (): RockProperties => ({ rock: 'sandstone', porosity: 0.2, permeability: 100, hardness: 1, impedance: 6, gammaRay: 40, resistivity: 10, density: 2.4, fluid: 'brine' });
  return {
    seed, sizeX: size, sizeZ: size, reservoirs, faults: [], aquifers,
    surfaceHeight: (x) => (x >= 400 ? 50 : 70),
    waterDepth: (x) => (x >= 400 ? 12 : 0),
    isOffshore: (x) => x >= 400,
    biomeAt: (x): BiomeId => (x >= 400 ? 'ocean' : 'plains'),
    rockAt: (): RockType => 'sandstone',
    properties: props,
    reservoirAt: () => null,
    aquiferAt: () => null,
    porePressure: (_x, y) => (70 - y) * 40 * 3.28 * 0.465,
    fracturePressure: (_x, y) => (70 - y) * 40 * 3.28 * 0.8,
    getReservoir: (id) => reservoirs.find((r) => r.id === id),
  };
}

export function createFakeWorld(geology: IGeology): IWorld {
  const edits = new Map<string, number>();
  const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const w: IWorld = {
    sizeX: geology.sizeX, sizeZ: geology.sizeZ, height: 160, seed: geology.seed, geology, chunksX: geology.sizeX / 16, chunksZ: geology.sizeZ / 16,
    getBlock: (x, y, z) => edits.get(k(x, y, z)) ?? (y < geology.surfaceHeight(x, z) ? B.STONE : B.AIR),
    setBlock: (x, y, z, id) => {
      edits.set(k(x, y, z), id);
      return true;
    },
    inBounds: (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < geology.sizeX && z < geology.sizeZ && y < 160,
    isSolid: (x, y, z) => w.getBlock(x, y, z) !== B.AIR,
    getSurfaceY: (x, z) => geology.surfaceHeight(x, z),
    ensureChunk: () => {},
    isChunkGenerated: () => true,
    getChunkData: () => undefined,
    forEachEdit: () => {},
    serializeEdits: (): WorldEditsSave => ({ chunks: {} }),
    loadEdits: () => {},
  };
  return w;
}

export function fakeWell(id: string, x: number, z: number, reservoirId: string, offshore = false): WellState {
  return {
    id, name: `Eagle ${id}`, x, z, surfaceY: 70, offshore, purpose: 'development', status: 'producing',
    plan: { kind: 'vertical', targetY: 30, casingPoints: [60, 40], mudWeight: 10 }, trajectory: [], measuredDepth: 40, plannedDepth: 40, currentY: 30,
    casing: [], mudWeight: 10, bitCondition: 80, kickVolume: 0, penetrated: [reservoirId], completedReservoirs: [reservoirId], reservoirContact: 4,
    fracStages: 0, choke: 1, lift: 'natural', productivity: 1, rates: { oil: 0, gas: 0, water: 0 }, bhp: 2000, waterCut: 0.05, gor: 650,
    cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: 3, completedDay: 6, cost: 2_400_000, owner: 'p1',
  };
}
