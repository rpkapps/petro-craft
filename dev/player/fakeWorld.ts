// Minimal in-memory IWorld + IGeology for the player dev harness and node unit tests.
// Terrain: gentle hills (or flat), a lake below sea level, a few trees, stratified rock with one oil reservoir.
import { B, BLOCKS, IS_SOLID } from '../../src/core/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../../src/core/constants';
import type { EventBus } from '../../src/core/EventBus';
import type { Aquifer, BiomeId, Fault, IGeology, IWorld, Reservoir, RockProperties, RockType, WorldEditsSave } from '../../src/core/types';

export interface FakeWorldOptions {
  size?: number;
  flat?: boolean;
  /** Ground level for flat worlds / base level for hills. */
  base?: number;
  seed?: number;
  trees?: boolean;
  lake?: boolean;
}

export function createFakeGeology(opts: FakeWorldOptions = {}): IGeology {
  const size = opts.size ?? 128;
  const base = opts.base ?? 70;
  const flat = !!opts.flat;
  const lake = opts.lake ?? !flat;
  const height = (x: number, z: number): number => {
    if (flat) return base;
    let h = base + Math.sin(x * 0.09) * 3 + Math.cos(z * 0.07) * 3 + Math.sin((x + z) * 0.031) * 4;
    if (lake) {
      const d = Math.hypot(x - size * 0.72, z - size * 0.3);
      if (d < 16) h -= (1 - d / 16) * 12;
    }
    return Math.floor(h);
  };
  const reservoir: Reservoir = {
    id: 'r1', name: 'Eagle Sand A', fluid: 'oil', trap: 'anticline', lithology: 'sandstone', center: { x: size / 2, y: 30, z: size / 2 },
    radiusX: 30, radiusZ: 24, topY: 34, bottomY: 26, compartment: 0, offshore: false, porosity: 0.22, permeability: 350,
    netToGross: 0.8, waterSaturation: 0.25, initialPressure: 3200, temperature: 80, bubblePoint: 2100, apiGravity: 36,
    gasOilRatio: 650, h2s: 0.03, co2: 0.01, oilInPlace: 4e7, gasInPlace: 2.6e7, waterDrive: 0.5, gasCap: false, owcY: 27,
  };
  const inRes = (x: number, y: number, z: number) =>
    y <= reservoir.topY && y >= reservoir.bottomY && ((x - reservoir.center.x) / reservoir.radiusX) ** 2 + ((z - reservoir.center.z) / reservoir.radiusZ) ** 2 <= 1;
  const aquifer: Aquifer = { id: 'a1', center: { x: size / 2, y: 55, z: size / 2 }, radiusX: 60, radiusZ: 60, topY: 56, bottomY: 52, salinity: 400, fresh: true };
  const rockAt = (x: number, y: number, z: number): RockType => {
    const s = height(x, z);
    if (y <= 2) return 'bedrock';
    if (y >= s) return 'water';
    if (y >= s - 3) return 'soil';
    if (inRes(x, y, z)) return 'sandstone';
    if (y > 35 && y <= 38) return 'caprock';
    if (y >= 52 && y <= 56) return 'sandstone';
    if (y > 40) return 'shale';
    if (y > 20) return 'limestone';
    return 'granite';
  };
  const geo: IGeology = {
    seed: opts.seed ?? 1, sizeX: size, sizeZ: size, reservoirs: [reservoir], faults: [] as Fault[], aquifers: [aquifer],
    surfaceHeight: (x, z) => Math.max(height(x, z), 1),
    waterDepth: (x, z) => Math.max(0, SEA_LEVEL + 1 - height(x, z)),
    isOffshore: () => false,
    biomeAt: (): BiomeId => 'plains',
    rockAt,
    properties: (x, y, z): RockProperties => {
      const rock = rockAt(x, y, z);
      const res = inRes(x, y, z);
      const aq = y >= 52 && y <= 56 && rock === 'sandstone';
      return {
        rock, porosity: res ? 0.22 : rock === 'sandstone' ? 0.18 : rock === 'shale' ? 0.06 : rock === 'soil' ? 0.35 : 0.08,
        permeability: res ? 350 : 5, hardness: 1, impedance: 5, gammaRay: rock === 'shale' ? 120 : 40,
        resistivity: res ? 60 : 3, density: 2.4, fluid: res ? (y < reservoir.owcY ? 'brine' : 'oil') : aq ? 'fresh' : 'brine',
        reservoirId: res ? reservoir.id : undefined, aquiferId: aq ? aquifer.id : undefined,
      };
    },
    reservoirAt: (x, y, z) => (inRes(x, y, z) ? reservoir : null),
    aquiferAt: (_x, y) => (y >= 52 && y <= 56 ? aquifer : null),
    porePressure: (_x, y) => (WORLD_HEIGHT - y) * 40 * 0.465 * 3.28,
    fracturePressure: (_x, y) => (WORLD_HEIGHT - y) * 40 * 0.8 * 3.28,
    getReservoir: (id) => (id === reservoir.id ? reservoir : undefined),
  };
  return geo;
}

export function createFakeWorld(geology: IGeology, bus: EventBus | null, opts: FakeWorldOptions = {}): IWorld & { generatedCount(): number } {
  const size = geology.sizeX;
  const H = WORLD_HEIGHT;
  const chunksX = Math.ceil(size / CHUNK_SIZE), chunksZ = Math.ceil(size / CHUNK_SIZE);
  const chunks = new Map<string, Uint8Array>();
  const edits = new Map<string, number>();
  const trees = opts.trees ?? !opts.flat;
  const idx = (lx: number, y: number, lz: number) => lx + lz * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE;
  const hash = (x: number, z: number) => {
    let h = (x * 374761393 + z * 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const generate = (cx: number, cz: number): Uint8Array => {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * H);
    for (let lz = 0; lz < CHUNK_SIZE; lz++)
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const x = cx * CHUNK_SIZE + lx, z = cz * CHUNK_SIZE + lz;
        if (x >= size || z >= size) continue;
        const s = geology.surfaceHeight(x, z);
        for (let y = 0; y < H; y++) {
          let id: number = B.AIR;
          if (y === 0) id = B.BEDROCK;
          else if (y < s - 4) {
            const r = geology.rockAt(x, y, z);
            id = r === 'sandstone' ? (geology.reservoirAt(x, y, z) ? B.OIL_SANDSTONE : B.SANDSTONE) : r === 'shale' ? B.SHALE : r === 'limestone' ? B.LIMESTONE
              : r === 'caprock' ? B.CAPROCK : r === 'granite' ? B.GRANITE : r === 'bedrock' ? B.BEDROCK : B.STONE;
          } else if (y < s - 1) id = B.DIRT;
          else if (y === s - 1) id = s - 1 < SEA_LEVEL ? B.SAND : B.GRASS;
          else if (y <= SEA_LEVEL && s - 1 < SEA_LEVEL) id = B.WATER;
          data[idx(lx, y, lz)] = id;
        }
        const r = hash(x, z);
        if (s - 1 >= SEA_LEVEL && r < 0.05) data[idx(lx, s, lz)] = r < 0.02 ? B.FLOWER_RED : B.TALL_GRASS;
      }
    if (trees) {
      for (let lz = 2; lz < CHUNK_SIZE - 2; lz++)
        for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
          const x = cx * CHUNK_SIZE + lx, z = cz * CHUNK_SIZE + lz;
          if (x >= size || z >= size || hash(x + 999, z - 77) > 0.006) continue;
          const s = geology.surfaceHeight(x, z);
          if (s - 1 < SEA_LEVEL + 1 || Math.hypot(x - size / 2, z - size / 2) < 12) continue;
          for (let y = s; y < s + 5; y++) data[idx(lx, y, lz)] = B.LOG_OAK;
          for (let dy = 3; dy <= 6; dy++)
            for (let dz = -2; dz <= 2; dz++)
              for (let dx = -2; dx <= 2; dx++) {
                if (Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - 5) * 2 > 3) continue;
                const i = idx(lx + dx, s + dy, lz + dz);
                if (data[i] === B.AIR) data[i] = B.LEAVES_OAK;
              }
        }
    }
    return data;
  };

  const chunkOf = (x: number, z: number, create: boolean): Uint8Array | undefined => {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const k = `${cx},${cz}`;
    let c = chunks.get(k);
    if (!c && create) {
      c = generate(cx, cz);
      chunks.set(k, c);
      bus?.emit('world:chunkGenerated', { cx, cz });
    }
    return c;
  };

  const world: IWorld & { generatedCount(): number } = {
    sizeX: size, sizeZ: size, height: H, seed: geology.seed, geology, chunksX, chunksZ,
    inBounds: (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < size && z < size && y < H,
    getBlock(x, y, z) {
      if (!world.inBounds(x, y, z)) return B.AIR;
      const c = chunkOf(x, z, true)!;
      return c[idx(((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE, y, ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE)];
    },
    setBlock(x, y, z, id, source = 'system') {
      if (!world.inBounds(x, y, z)) return false;
      const c = chunkOf(x, z, true)!;
      const i = idx(x % CHUNK_SIZE, y, z % CHUNK_SIZE);
      const prev = c[i];
      if (prev === id) return true;
      c[i] = id;
      edits.set(`${x},${y},${z}`, id);
      bus?.emit('world:blockChanged', { x, y, z, prev, id, source });
      return true;
    },
    isSolid: (x, y, z) => IS_SOLID[world.getBlock(x, y, z)] === 1,
    getSurfaceY(x, z) {
      for (let y = H - 1; y > 0; y--) {
        const b = world.getBlock(x, y, z);
        if (b !== B.AIR && BLOCKS[b].shape !== 'liquid' && BLOCKS[b].shape !== 'cross') return y + 1;
      }
      return 1;
    },
    ensureChunk: (cx, cz) => void chunkOf(cx * CHUNK_SIZE, cz * CHUNK_SIZE, true),
    isChunkGenerated: (cx, cz) => chunks.has(`${cx},${cz}`),
    getChunkData: (cx, cz) => chunks.get(`${cx},${cz}`),
    forEachEdit(fn) {
      for (const [k, id] of edits) {
        const [x, y, z] = k.split(',').map(Number);
        fn(x, y, z, id);
      }
    },
    serializeEdits: (): WorldEditsSave => ({ chunks: {} }),
    loadEdits: () => {},
    generatedCount: () => chunks.size,
  };
  return world;
}
