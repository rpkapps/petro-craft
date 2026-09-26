// Analytic mock geology for the UI dev harness: rolling land with a mountain, a river, a desert,
// an ocean to the east, layered strata with anticline traps, two faults and a fresh-water aquifer.
import type { Aquifer, BiomeId, Fault, IGeology, Reservoir, RockProperties, RockType } from '../../src/core/types';
import { SEA_LEVEL } from '../../src/core/constants';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

function mkRes(p: Partial<Reservoir> & Pick<Reservoir, 'id' | 'name' | 'fluid' | 'center' | 'radiusX' | 'radiusZ' | 'topY' | 'bottomY'>): Reservoir {
  return {
    trap: 'anticline', lithology: 'sandstone', compartment: 0, offshore: false, porosity: 0.22, permeability: 180, netToGross: 0.7,
    waterSaturation: 0.28, initialPressure: 3900, temperature: 82, bubblePoint: 2400, apiGravity: 36, gasOilRatio: 650, h2s: 0.002, co2: 0.01,
    oilInPlace: 48_000_000, gasInPlace: 30_000_000, waterDrive: 0.4, gasCap: false, owcY: p.bottomY + 1, ...p,
  } as Reservoir;
}

export function createMockGeology(size = 512): IGeology {
  const reservoirs: Reservoir[] = [
    mkRes({ id: 'r1', name: 'Eagle Sand A', fluid: 'oil', center: { x: 210, y: 38, z: 240 }, radiusX: 46, radiusZ: 30, topY: 42, bottomY: 34, owcY: 36, gasCap: true, gocY: 41 }),
    mkRes({ id: 'r2', name: 'Coyote Limestone', fluid: 'oil', lithology: 'limestone', trap: 'fault', center: { x: 300, y: 28, z: 170 }, radiusX: 34, radiusZ: 26, topY: 31, bottomY: 24, permeability: 60, porosity: 0.14 }),
    mkRes({ id: 'r3', name: 'Mesa Gas Sand', fluid: 'gas', center: { x: 150, y: 50, z: 330 }, radiusX: 30, radiusZ: 38, topY: 53, bottomY: 47, gasInPlace: 120_000_000, oilInPlace: 0 }),
    mkRes({ id: 'r4', name: 'Bravo Shale Play', fluid: 'oil', lithology: 'shale', trap: 'shale_play', center: { x: 260, y: 18, z: 300 }, radiusX: 90, radiusZ: 70, topY: 20, bottomY: 16, permeability: 0.02, porosity: 0.07 }),
    mkRes({ id: 'r5', name: 'Gulf Deep Turbidite', fluid: 'condensate', offshore: true, center: { x: 450, y: 22, z: 250 }, radiusX: 38, radiusZ: 44, topY: 26, bottomY: 18 }),
  ];
  const faults: Fault[] = [
    { id: 'f1', p0: { x: 270, z: 0 }, p1: { x: 330, z: 512 }, dip: 60, dipSign: 1, throw: 4, sealing: true },
    { id: 'f2', p0: { x: 0, z: 420 }, p1: { x: 512, z: 380 }, dip: 70, dipSign: -1, throw: 3, sealing: false },
  ];
  const aquifers: Aquifer[] = [{ id: 'a1', center: { x: 200, y: 66, z: 220 }, radiusX: 140, radiusZ: 120, topY: 70, bottomY: 62, salinity: 400, fresh: true }];

  const coast = (z: number) => size * 0.76 + 26 * Math.sin(z / 57) + 12 * Math.sin(z / 23 + 1);
  const riverZ = (x: number) => size * 0.5 + 38 * Math.sin(x / 50) + 12 * Math.sin(x / 17);
  const rawHeight = (x: number, z: number) => {
    const d = coast(z) - x;
    if (d < 0) return SEA_LEVEL - Math.min(-d, 70) * 0.45 - 1;
    const hills = 7 * Math.sin(x / 37) * Math.cos(z / 41) + 4 * Math.sin((x + z) / 19) + 3 * Math.cos((x - z) / 13);
    const mountain = 42 * Math.exp(-((x - 95) ** 2 + (z - 110) ** 2) / 2600);
    const base = SEA_LEVEL + 3 + Math.min(d, 90) * 0.1;
    return base + (hills + mountain) * clamp(d / 30, 0, 1);
  };
  const surfaceHeight = (x: number, z: number) => {
    let hgt = rawHeight(x, z);
    const rz = Math.abs(z - riverZ(x));
    if (x < coast(z) - 4 && rz < 6) hgt = Math.min(hgt, SEA_LEVEL - 2 + rz * 0.6);
    return Math.floor(hgt);
  };
  const waterDepth = (x: number, z: number) => Math.max(0, SEA_LEVEL + 1 - surfaceHeight(x, z));
  const biomeAt = (x: number, z: number): BiomeId => {
    const d = coast(z) - x;
    const hgt = surfaceHeight(x, z);
    if (d < -40) return 'deep_ocean';
    if (d < 0) return 'ocean';
    if (waterDepth(x, z) > 0) return 'river';
    if (d < 7) return 'beach';
    if (hgt > SEA_LEVEL + 34) return 'mountains';
    if (x < 170 && z > 360) return 'desert';
    if (x < 90 && z > 300) return 'badlands';
    if (z < 90) return 'taiga';
    if (Math.sin(x / 31) * Math.cos(z / 27) > 0.35) return 'forest';
    if (Math.sin(x / 23 + 2) * Math.cos(z / 19) > 0.55) return 'birch_forest';
    if (x > 300 && z > 400) return 'swamp';
    return 'plains';
  };
  const uplift = (x: number, z: number) => {
    let u = 0;
    for (const r of reservoirs) {
      const dx = (x - r.center.x) / (r.radiusX * 1.4);
      const dz = (z - r.center.z) / (r.radiusZ * 1.4);
      u += 5 * Math.exp(-(dx * dx + dz * dz) * 2);
    }
    for (const f of faults) {
      const side = (f.p1.x - f.p0.x) * (z - f.p0.z) - (f.p1.z - f.p0.z) * (x - f.p0.x);
      if (side * f.dipSign > 0) u -= f.throw;
    }
    return u;
  };
  const reservoirAt = (x: number, y: number, z: number) => {
    for (const r of reservoirs) {
      const dx = (x - r.center.x) / r.radiusX;
      const dz = (z - r.center.z) / r.radiusZ;
      if (dx * dx + dz * dz <= 1 && y <= r.topY && y >= r.bottomY) return r;
    }
    return null;
  };
  const aquiferAt = (x: number, y: number, z: number) => {
    for (const a of aquifers) {
      const dx = (x - a.center.x) / a.radiusX;
      const dz = (z - a.center.z) / a.radiusZ;
      if (dx * dx + dz * dz <= 1 && y <= a.topY && y >= a.bottomY) return a;
    }
    return null;
  };
  const LAYERS: RockType[] = ['sandstone', 'shale', 'limestone', 'shale', 'mudstone', 'sandstone', 'shale', 'dolomite', 'shale', 'salt', 'shale', 'sandstone'];
  const rockAt = (x: number, y: number, z: number): RockType => {
    const s = surfaceHeight(x, z);
    if (y <= 1) return 'bedrock';
    if (y >= s - 3) return y >= s - 1 ? 'soil' : 'clay';
    const r = reservoirAt(x, y, z);
    if (r) return r.lithology;
    const yy = y - uplift(x, z);
    if (Math.abs(yy - 44) < 1.2) return 'caprock';
    return LAYERS[Math.floor(Math.abs(yy) / 5) % LAYERS.length];
  };
  const properties = (x: number, y: number, z: number): RockProperties => {
    const rock = rockAt(x, y, z);
    const r = reservoirAt(x, y, z);
    const aq = aquiferAt(x, y, z);
    const base: Record<string, [number, number, number, number]> = {
      sandstone: [0.2, 45, 8, 2.35], shale: [0.06, 120, 3, 2.55], limestone: [0.12, 25, 25, 2.6], dolomite: [0.1, 20, 40, 2.75],
      salt: [0.01, 10, 150, 2.1], mudstone: [0.08, 105, 4, 2.5], caprock: [0.02, 15, 90, 2.9], soil: [0.35, 60, 20, 1.9], clay: [0.3, 95, 5, 2.0],
      bedrock: [0.01, 30, 200, 2.8],
    };
    const [por, gr, res, den] = base[rock] ?? [0.1, 60, 10, 2.4];
    const fluid: RockProperties['fluid'] = r ? (r.fluid === 'gas' ? 'gas' : 'oil') : aq ? 'fresh' : por > 0.15 ? 'brine' : 'none';
    return {
      rock, porosity: r ? r.porosity : por, permeability: r ? r.permeability : por * 100, hardness: rock === 'dolomite' || rock === 'caprock' ? 2.2 : 1,
      impedance: den * 3 + (fluid === 'gas' ? -1.5 : fluid === 'oil' ? -0.6 : 0), gammaRay: gr + Math.sin(y * 3.1 + x * 0.1) * 8,
      resistivity: fluid === 'oil' ? 60 + Math.sin(y) * 15 : fluid === 'gas' ? 140 : fluid === 'fresh' ? 30 : res, density: den - (fluid === 'gas' ? 0.25 : 0),
      fluid, reservoirId: r?.id, aquiferId: aq?.id,
    };
  };
  const psiFt = (y: number, x: number, z: number) => (surfaceHeight(x, z) - y) * 40 * 3.28084;
  return {
    seed: 12345,
    sizeX: size,
    sizeZ: size,
    reservoirs,
    faults,
    aquifers,
    surfaceHeight,
    waterDepth,
    isOffshore: (x, z) => coast(z) - x < 0,
    biomeAt,
    rockAt,
    properties,
    reservoirAt,
    aquiferAt,
    porePressure: (x, y, z) => psiFt(y, x, z) * (0.452 + (y < 40 ? (40 - y) * 0.006 : 0)),
    fracturePressure: (x, y, z) => psiFt(y, x, z) * (0.72 + (y < 40 ? (40 - y) * 0.004 : 0)),
    getReservoir: (id) => reservoirs.find((r) => r.id === id),
  };
}
