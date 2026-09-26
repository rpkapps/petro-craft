// Minimal in-memory IWorld / IGeology for headless facilities tests.
// Terrain: flat grass at surface 70, a 1:1 slope (x,z ∈ [30,50)), a shore from x=200 sloping into an
// ocean strip (x ≥ 208, 13 blocks deep; x ≥ 236, 23 blocks deep).
import { B, IS_LIQUID } from '../../src/core/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../../src/core/constants';
import type { EventBus } from '../../src/core/EventBus';
import type { BiomeId, IGeology, IWorld, RockProperties, RockType, WorldEditsSave } from '../../src/core/types';

export const LAND_Y = 70;

export function groundHeight(x: number, z: number): number {
  if (x >= 236) return 40;
  if (x >= 208) return 50;
  if (x >= 200) return LAND_Y - (x - 199) * 2;
  if (x >= 30 && x < 50 && z >= 30 && z < 50) return LAND_Y + (x - 30);
  return LAND_Y;
}

export class FakeGeology implements IGeology {
  readonly reservoirs = [];
  readonly faults = [];
  readonly aquifers = [];
  constructor(readonly seed: number, readonly sizeX: number, readonly sizeZ: number) {}
  surfaceHeight(x: number, z: number) {
    return groundHeight(x, z);
  }
  waterDepth(x: number, z: number) {
    return Math.max(0, SEA_LEVEL + 1 - groundHeight(x, z));
  }
  isOffshore(x: number, z: number) {
    return this.waterDepth(x, z) > 0;
  }
  biomeAt(x: number, z: number): BiomeId {
    return this.isOffshore(x, z) ? 'ocean' : 'plains';
  }
  rockAt(): RockType {
    return 'shale';
  }
  properties(): RockProperties {
    return { rock: 'shale', porosity: 0.05, permeability: 0.01, hardness: 1, impedance: 6, gammaRay: 100, resistivity: 5, density: 2.5, fluid: 'brine' };
  }
  reservoirAt() {
    return null;
  }
  aquiferAt() {
    return null;
  }
  porePressure(_x: number, y: number) {
    return (80 - y) * 40 * 1.42;
  }
  fracturePressure(_x: number, y: number) {
    return (80 - y) * 40 * 2.2;
  }
  getReservoir() {
    return undefined;
  }
}

export class FakeWorld implements IWorld {
  readonly height = WORLD_HEIGHT;
  readonly chunksX: number;
  readonly chunksZ: number;
  private readonly chunks = new Map<number, Uint8Array>();
  private readonly edits = new Map<number, number>();
  setCount = 0;

  constructor(readonly geology: IGeology, private readonly bus: EventBus | null) {
    this.chunksX = Math.ceil(geology.sizeX / CHUNK_SIZE);
    this.chunksZ = Math.ceil(geology.sizeZ / CHUNK_SIZE);
  }
  get sizeX() {
    return this.geology.sizeX;
  }
  get sizeZ() {
    return this.geology.sizeZ;
  }
  get seed() {
    return this.geology.seed;
  }

  private generated(x: number, y: number, z: number): number {
    const g = groundHeight(x, z);
    if (y === 0) return B.BEDROCK;
    if (y < g - 4) return B.STONE;
    const underwater = g <= SEA_LEVEL;
    if (y < g - 1) return underwater ? B.SAND : B.DIRT;
    if (y === g - 1) return underwater || x >= 200 ? B.SAND : B.GRASS;
    if (y <= SEA_LEVEL && underwater) return B.WATER;
    return B.AIR;
  }

  ensureChunk(cx: number, cz: number) {
    const k = cx + cz * this.chunksX;
    if (this.chunks.has(k)) return;
    const d = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT);
    for (let y = 0; y < WORLD_HEIGHT; y++)
      for (let z = 0; z < CHUNK_SIZE; z++)
        for (let x = 0; x < CHUNK_SIZE; x++) d[x + z * CHUNK_SIZE + y * 256] = this.generated(cx * CHUNK_SIZE + x, y, cz * CHUNK_SIZE + z);
    this.chunks.set(k, d);
  }
  isChunkGenerated(cx: number, cz: number) {
    return this.chunks.has(cx + cz * this.chunksX);
  }
  getChunkData(cx: number, cz: number) {
    return this.chunks.get(cx + cz * this.chunksX);
  }
  inBounds(x: number, y: number, z: number) {
    return x >= 0 && z >= 0 && y >= 0 && x < this.sizeX && z < this.sizeZ && y < WORLD_HEIGHT;
  }
  getBlock(x: number, y: number, z: number): number {
    if (!this.inBounds(x, y, z)) return B.AIR;
    const cx = x >> 4;
    const cz = z >> 4;
    this.ensureChunk(cx, cz);
    return this.chunks.get(cx + cz * this.chunksX)![(x & 15) + (z & 15) * 16 + y * 256];
  }
  setBlock(x: number, y: number, z: number, id: number, source: 'player' | 'system' | 'load' = 'system'): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const prev = this.getBlock(x, y, z);
    if (prev === id) return true;
    this.chunks.get((x >> 4) + (z >> 4) * this.chunksX)![(x & 15) + (z & 15) * 16 + y * 256] = id;
    const k = x + this.sizeX * (z + this.sizeZ * y);
    if (this.generated(x, y, z) === id) this.edits.delete(k);
    else this.edits.set(k, id);
    this.setCount++;
    this.bus?.emit('world:blockChanged', { x, y, z, prev, id, source });
    return true;
  }
  isSolid(x: number, y: number, z: number) {
    const id = this.getBlock(x, y, z);
    return id !== B.AIR && !IS_LIQUID[id];
  }
  getSurfaceY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && !IS_LIQUID[id]) return y + 1;
    }
    return 0;
  }
  forEachEdit(fn: (x: number, y: number, z: number, id: number) => void) {
    for (const [k, id] of this.edits) {
      const x = k % this.sizeX;
      const t = (k - x) / this.sizeX;
      const z = t % this.sizeZ;
      fn(x, (t - z) / this.sizeZ, z, id);
    }
  }
  serializeEdits(): WorldEditsSave {
    return { chunks: { all: JSON.stringify(Array.from(this.edits.entries())) } };
  }
  loadEdits(save: WorldEditsSave) {
    const list = JSON.parse(save.chunks.all ?? '[]') as [number, number][];
    for (const [k, id] of list) {
      const x = k % this.sizeX;
      const t = (k - x) / this.sizeX;
      const z = t % this.sizeZ;
      this.setBlock(x, (t - z) / this.sizeZ, z, id, 'load');
    }
  }
}
