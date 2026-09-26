// Fake layered geology + sparse voxel world for headless upstream tests (independent of src/world).
//
// Section (land surface at y≈80, ocean for x ≥ 224):
//   y 77..79 soil/clay · 70..74 FRESH aquifer sandstone · 55..69 shale · 50..54 limestone · 46..49 caprock
//   y 40..45 "Eagle Sand" (oil, anticline, water drive 0.55) · 37..39 shale
//   y 30..36 overpressured shale around the "Falcon" gas sand (y 32..35, 0.68 psi/ft)
//   y 26..29 mudstone · y 20..24 "Osage Shale" tight-oil play · y 3..19 granite · y 0..2 bedrock
import { B } from '../../src/core/blocks';
import { SEA_LEVEL } from '../../src/core/constants';
import type { EventBus } from '../../src/core/EventBus';
import type { Aquifer, BiomeId, Fault, IGeology, IWorld, Reservoir, RockProperties, RockType, WorldEditsSave } from '../../src/core/types';

const FT = 40 * 3.28084;

const ROCK_BLOCK: Record<RockType, number> = {
  soil: B.DIRT, sand: B.SAND, clay: B.CLAY, sandstone: B.SANDSTONE, shale: B.SHALE, limestone: B.LIMESTONE, dolomite: B.DOLOMITE,
  salt: B.SALT, granite: B.GRANITE, basalt: B.BASALT, chalk: B.CHALK, coal: B.COAL_SEAM, mudstone: B.MUDSTONE, caprock: B.CAPROCK,
  bedrock: B.BEDROCK, water: B.WATER, silt: B.SEABED_SILT,
};

interface RockDef { rock: RockType; por: number; perm: number; hard: number; imp: number; gr: number; res: number; den: number }
const ROCKS: Record<string, RockDef> = {
  soil: { rock: 'soil', por: 0.35, perm: 50, hard: 0.35, imp: 2.2, gr: 60, res: 20, den: 1.9 },
  clay: { rock: 'clay', por: 0.3, perm: 0.01, hard: 0.5, imp: 2.8, gr: 110, res: 5, den: 2.1 },
  sandstone: { rock: 'sandstone', por: 0.22, perm: 180, hard: 0.9, imp: 5.4, gr: 35, res: 8, den: 2.3 },
  shale: { rock: 'shale', por: 0.08, perm: 0.001, hard: 1.1, imp: 6.4, gr: 125, res: 3, den: 2.5 },
  limestone: { rock: 'limestone', por: 0.1, perm: 5, hard: 1.5, imp: 8.8, gr: 20, res: 60, den: 2.65 },
  caprock: { rock: 'caprock', por: 0.02, perm: 0.0001, hard: 1.8, imp: 10.5, gr: 15, res: 150, den: 2.9 },
  mudstone: { rock: 'mudstone', por: 0.1, perm: 0.01, hard: 1.0, imp: 6.2, gr: 100, res: 4, den: 2.45 },
  granite: { rock: 'granite', por: 0.01, perm: 0.0001, hard: 2.8, imp: 11.5, gr: 150, res: 200, den: 2.7 },
  bedrock: { rock: 'bedrock', por: 0, perm: 0, hard: 3, imp: 12, gr: 50, res: 500, den: 3 },
};

export class FakeGeology implements IGeology {
  readonly faults: Fault[] = [];
  readonly reservoirs: Reservoir[];
  readonly aquifers: Aquifer[];
  constructor(readonly seed: number, readonly sizeX = 256, readonly sizeZ = 256) {
    this.reservoirs = [
      {
        id: 'r_eagle', name: 'Eagle Sand', fluid: 'oil', trap: 'anticline', lithology: 'sandstone', center: { x: 64, y: 43, z: 64 }, radiusX: 30, radiusZ: 24,
        topY: 45, bottomY: 40, compartment: 0, offshore: false, porosity: 0.22, permeability: 150, netToGross: 0.75, waterSaturation: 0.25,
        initialPressure: 2750, temperature: 70, bubblePoint: 2000, apiGravity: 36, gasOilRatio: 550, h2s: 0, co2: 0.01,
        oilInPlace: 8_000_000, gasInPlace: 4_400_000, waterDrive: 0.55, gasCap: false, owcY: 41,
      },
      {
        id: 'r_falcon', name: 'Falcon Gas Sand', fluid: 'gas', trap: 'fault', lithology: 'sandstone', center: { x: 170, y: 33, z: 64 }, radiusX: 20, radiusZ: 20,
        topY: 35, bottomY: 32, compartment: 1, offshore: false, porosity: 0.18, permeability: 25, netToGross: 0.8, waterSaturation: 0.3,
        initialPressure: 4300, temperature: 95, bubblePoint: 0, apiGravity: 55, gasOilRatio: 60000, h2s: 0.02, co2: 0.02,
        oilInPlace: 0, gasInPlace: 60_000_000, waterDrive: 0.2, gasCap: false, owcY: 32,
      },
      {
        id: 'r_osage', name: 'Osage Shale', fluid: 'oil', trap: 'shale_play', lithology: 'shale', center: { x: 110, y: 22, z: 150 }, radiusX: 90, radiusZ: 60,
        topY: 24, bottomY: 20, compartment: 2, offshore: false, porosity: 0.07, permeability: 0.004, netToGross: 0.9, waterSaturation: 0.3,
        initialPressure: 5100, temperature: 105, bubblePoint: 2600, apiGravity: 42, gasOilRatio: 900, h2s: 0, co2: 0,
        oilInPlace: 900_000_000, gasInPlace: 810_000_000, waterDrive: 0.05, gasCap: false, owcY: 19,
      },
    ];
    this.aquifers = [
      { id: 'aq1', center: { x: 128, y: 72, z: 128 }, radiusX: 140, radiusZ: 140, topY: 74, bottomY: 70, salinity: 500, fresh: true },
    ];
  }

  surfaceHeight(x: number, z: number): number {
    if (this.isOffshore(x, z)) return 48;
    return 80 + Math.round(Math.sin(x * 0.05) * 1.2 + Math.cos(z * 0.04) * 1.2);
  }
  waterDepth(x: number, z: number): number {
    return this.isOffshore(x, z) ? SEA_LEVEL + 1 - this.surfaceHeight(x, z) : 0;
  }
  isOffshore(x: number, _z: number): boolean {
    return x >= 224;
  }
  biomeAt(x: number, z: number): BiomeId {
    return this.isOffshore(x, z) ? 'ocean' : 'plains';
  }
  private inLens(r: Reservoir, x: number, y: number, z: number): boolean {
    if (y > r.topY || y < r.bottomY) return false;
    const dx = (x - r.center.x) / r.radiusX;
    const dz = (z - r.center.z) / r.radiusZ;
    const d2 = dx * dx + dz * dz;
    // Anticline: the reservoir thins toward the flanks.
    const crest = r.trap === 'shale_play' ? r.topY : r.topY - Math.floor(d2 * 2);
    return d2 <= 1 && y <= crest;
  }
  reservoirAt(x: number, y: number, z: number): Reservoir | null {
    for (const r of this.reservoirs) if (this.inLens(r, x, y, z)) return r;
    return null;
  }
  aquiferAt(x: number, y: number, z: number): Aquifer | null {
    for (const a of this.aquifers) {
      if (y > a.topY || y < a.bottomY) continue;
      if (((x - a.center.x) / a.radiusX) ** 2 + ((z - a.center.z) / a.radiusZ) ** 2 <= 1) return a;
    }
    return null;
  }
  private rockName(x: number, y: number, z: number): string {
    const s = this.surfaceHeight(x, z);
    if (y <= 2) return 'bedrock';
    if (y < 20) return 'granite';
    if (y <= 24) return 'shale';
    if (y <= 29) return 'mudstone';
    if (y <= 36) return y >= 32 && y <= 35 && Math.hypot(x - 170, z - 64) < 26 ? 'sandstone' : 'shale';
    if (y <= 39) return 'shale';
    if (y <= 45) return 'sandstone';
    if (y <= 49) return 'caprock';
    if (y <= 54) return 'limestone';
    if (y <= 69) return 'shale';
    if (y <= 74) return 'sandstone';
    if (y >= s - 3) return 'soil';
    return 'clay';
  }
  rockAt(x: number, y: number, z: number): RockType {
    return ROCKS[this.rockName(x, y, z)].rock;
  }
  properties(x: number, y: number, z: number): RockProperties {
    const d = ROCKS[this.rockName(x, y, z)];
    const r = this.reservoirAt(x, y, z);
    const aq = this.aquiferAt(x, y, z);
    let fluid: RockProperties['fluid'] = 'none';
    let por = d.por, perm = d.perm, imp = d.imp, res = d.res, gr = d.gr, den = d.den;
    if (r) {
      por = r.porosity;
      perm = r.permeability;
      gr = r.trap === 'shale_play' ? 140 : 30;
      const hc = y > r.owcY;
      fluid = hc ? (r.fluid === 'oil' ? 'oil' : 'gas') : 'brine';
      imp = hc ? (r.fluid === 'oil' ? d.imp * 0.85 : d.imp * 0.62) : d.imp;
      res = hc ? (r.trap === 'shale_play' ? 40 : 90) : 1.2;
      den = hc && r.fluid !== 'oil' ? 2.1 : 2.25;
    } else if (aq) {
      fluid = aq.fresh ? 'fresh' : 'brine';
      res = aq.fresh ? 45 : 1.5;
    } else if (d.por > 0.15) fluid = 'brine';
    return { rock: d.rock, porosity: por, permeability: perm, hardness: d.hard, impedance: imp, gammaRay: gr, resistivity: res, density: den, fluid, reservoirId: r?.id, aquiferId: aq?.id };
  }
  porePressure(x: number, y: number, z: number): number {
    const s = this.isOffshore(x, z) ? SEA_LEVEL + 1 : this.surfaceHeight(x, z);
    const tvd = Math.max(0, s - y) * FT;
    const r = this.reservoirAt(x, y, z);
    if (r) {
      const mid = (r.topY + r.bottomY) / 2;
      return r.initialPressure + (mid - y) * FT * (r.fluid === 'oil' ? 0.33 : 0.1);
    }
    // Overpressured shale around the Falcon gas sand and in the Osage source rock.
    if (y >= 30 && y <= 36 && Math.hypot(x - 170, z - 64) < 34) return 0.68 * tvd;
    if (y >= 19 && y <= 25) return 0.62 * tvd;
    return 0.465 * tvd;
  }
  fracturePressure(x: number, y: number, z: number): number {
    const s = this.isOffshore(x, z) ? SEA_LEVEL + 1 : this.surfaceHeight(x, z);
    const tvd = Math.max(1, s - y) * FT;
    const grad = y > 60 ? 0.7 : 0.8;
    return Math.max(grad * tvd, this.porePressure(x, y, z) * 1.12);
  }
  getReservoir(id: string): Reservoir | undefined {
    return this.reservoirs.find((r) => r.id === id);
  }
}

/** Sparse voxel world: generated from FakeGeology plus an edit map. */
export class FakeWorld implements IWorld {
  readonly height = 160;
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly seed: number;
  readonly chunksX: number;
  readonly chunksZ: number;
  private edits = new Map<number, number>();
  setCount = 0;
  constructor(readonly geology: FakeGeology, private bus: EventBus) {
    this.sizeX = geology.sizeX;
    this.sizeZ = geology.sizeZ;
    this.seed = geology.seed;
    this.chunksX = this.sizeX / 16;
    this.chunksZ = this.sizeZ / 16;
  }
  private key(x: number, y: number, z: number) {
    return (y * this.sizeZ + z) * this.sizeX + x;
  }
  private generated(x: number, y: number, z: number): number {
    const g = this.geology;
    const s = g.surfaceHeight(x, z);
    if (y >= s) return g.isOffshore(x, z) && y <= SEA_LEVEL ? B.WATER : B.AIR;
    if (y === s - 1 && !g.isOffshore(x, z)) return B.GRASS;
    const p = g.properties(x, y, z);
    if (p.reservoirId && (p.fluid === 'oil' || p.fluid === 'gas')) return p.fluid === 'oil' ? (p.rock === 'shale' ? B.TIGHT_OIL_SHALE : B.OIL_SANDSTONE) : B.GAS_SANDSTONE;
    return ROCK_BLOCK[p.rock] ?? B.STONE;
  }
  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && z >= 0 && y >= 0 && x < this.sizeX && z < this.sizeZ && y < this.height;
  }
  getBlock(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return B.AIR;
    const e = this.edits.get(this.key(x, y, z));
    return e ?? this.generated(x, y, z);
  }
  setBlock(x: number, y: number, z: number, id: number, source: 'player' | 'system' | 'load' = 'system'): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const prev = this.getBlock(x, y, z);
    this.edits.set(this.key(x, y, z), id);
    this.setCount++;
    this.bus.emit('world:blockChanged', { x, y, z, prev, id, source });
    return true;
  }
  isSolid(x: number, y: number, z: number): boolean {
    const b = this.getBlock(x, y, z);
    return b !== B.AIR && b !== B.WATER && b !== B.OIL_POOL;
  }
  getSurfaceY(x: number, z: number): number {
    for (let y = this.height - 1; y >= 0; y--) {
      const b = this.getBlock(x, y, z);
      if (b !== B.AIR && b !== B.WATER && b !== B.OIL_POOL) return y + 1;
    }
    return 0;
  }
  ensureChunk(): void {}
  isChunkGenerated(): boolean {
    return true;
  }
  getChunkData(): Uint8Array | undefined {
    return undefined;
  }
  forEachEdit(fn: (x: number, y: number, z: number, id: number) => void): void {
    for (const [k, id] of this.edits) {
      const x = k % this.sizeX;
      const z = Math.floor(k / this.sizeX) % this.sizeZ;
      const y = Math.floor(k / (this.sizeX * this.sizeZ));
      fn(x, y, z, id);
    }
  }
  serializeEdits(): WorldEditsSave {
    return { chunks: {} };
  }
  loadEdits(): void {}
}
