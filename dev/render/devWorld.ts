// Dev-only fallback world for the render harness (used while src/world is still a stub).
// A compact but varied heightmap world: hills, a mountain with snow, a lake/sea, beaches, forests,
// layered strata with oil & gas reservoir lenses, and an industrial showcase near the centre.
import { createNoise2D } from 'simplex-noise';
import { B } from '../../src/core/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../../src/core/constants';
import type { EventBus } from '../../src/core/EventBus';
import type { Aquifer, BiomeId, Fault, IGeology, IWorld, Reservoir, RockProperties, RockType, WorldEditsSave } from '../../src/core/types';
import { mulberry, hash3 } from '../../src/render/util/noise';

const CS = CHUNK_SIZE;
const H = WORLD_HEIGHT;

function makeReservoir(id: string, name: string, fluid: Reservoir['fluid'], cx: number, cy: number, cz: number, rx: number, rz: number, th: number): Reservoir {
  return {
    id, name, fluid, trap: 'anticline', lithology: 'sandstone',
    center: { x: cx, y: cy, z: cz }, radiusX: rx, radiusZ: rz, topY: cy + th, bottomY: cy - th,
    compartment: 0, offshore: false, porosity: 0.22, permeability: 300, netToGross: 0.8, waterSaturation: 0.25,
    initialPressure: 4200, temperature: 90, bubblePoint: 2400, apiGravity: 34, gasOilRatio: 600, h2s: 0, co2: 0.01,
    oilInPlace: fluid === 'gas' ? 0 : 42e6, gasInPlace: fluid === 'gas' ? 180e6 : 20e6, waterDrive: 0.5,
    gasCap: fluid === 'oil', owcY: cy - th * 0.45, gocY: fluid === 'oil' ? cy + th * 0.55 : undefined,
  };
}

export class DevGeology implements IGeology {
  readonly reservoirs: Reservoir[];
  readonly faults: Fault[];
  readonly aquifers: Aquifer[];
  readonly n1: (x: number, y: number) => number;
  readonly n2: (x: number, y: number) => number;
  readonly n3: (x: number, y: number) => number;
  private hcache = new Map<number, number>();

  constructor(readonly seed: number, readonly sizeX: number, readonly sizeZ: number) {
    const r = mulberry(seed);
    this.n1 = createNoise2D(r);
    this.n2 = createNoise2D(r);
    this.n3 = createNoise2D(r);
    const c = sizeX / 2;
    this.reservoirs = [
      makeReservoir('res-a', 'Eagle Sand A', 'oil', c + 18, 34, c - 6, 26, 18, 4),
      makeReservoir('res-b', 'Heron Gas B', 'gas', c - 30, 22, c + 24, 20, 16, 3),
      makeReservoir('res-c', 'Ridge Condensate', 'condensate', c + 44, 18, c + 40, 14, 12, 3),
    ];
    this.faults = [{ id: 'f1', p0: { x: c - 10, z: 0 }, p1: { x: c + 6, z: sizeZ }, dip: 62, dipSign: 1, throw: 4, sealing: true }];
    this.aquifers = [{ id: 'aq1', center: { x: c - 4, y: 54, z: c + 4 }, radiusX: 40, radiusZ: 34, topY: 56, bottomY: 51, salinity: 400, fresh: true }];
  }

  surfaceHeight(x: number, z: number): number {
    const k = (x | 0) * 4096 + (z | 0);
    const c = this.hcache.get(k);
    if (c !== undefined) return c;
    const cx = this.sizeX / 2;
    const cz = this.sizeZ / 2;
    let h = 66;
    h += this.n1(x / 90, z / 90) * 7 + this.n1(x / 35, z / 35) * 3 + this.n2(x / 14, z / 14) * 1.2;
    // mountain to the north-east
    const md = Math.hypot(x - (cx + 70), z - (cz - 70));
    h += Math.max(0, 1 - md / 70) ** 1.6 * 48 * (0.8 + 0.2 * this.n3(x / 20, z / 20));
    // sea to the south-west
    const sd = Math.hypot(x - (cx - 90), z - (cz + 95));
    h -= Math.max(0, 1 - sd / 95) ** 0.9 * 22;
    // flatten the industrial showcase site
    const pd = Math.max(Math.abs(x - cx), Math.abs(z - cz));
    if (pd < 16) h = h + (67 - h) * Math.min(1, (16 - pd) / 6);
    const v = Math.max(4, Math.min(H - 8, Math.round(h)));
    this.hcache.set(k, v);
    return v;
  }
  waterDepth(x: number, z: number) {
    return Math.max(0, SEA_LEVEL + 1 - this.surfaceHeight(x, z));
  }
  isOffshore(x: number, z: number) {
    return this.waterDepth(x, z) > 2;
  }
  biomeAt(x: number, z: number): BiomeId {
    const h = this.surfaceHeight(x, z);
    if (h <= SEA_LEVEL) return 'ocean';
    if (h <= SEA_LEVEL + 2) return 'beach';
    if (h > 98) return 'mountains';
    const t = this.n3(x / 120, z / 120);
    if (t > 0.35) return 'desert';
    if (t < -0.35) return 'taiga';
    return this.n2(x / 60, z / 60) > 0.1 ? 'forest' : this.n2(x / 60, z / 60) < -0.4 ? 'birch_forest' : 'plains';
  }
  rockAt(x: number, y: number, z: number): RockType {
    const s = this.surfaceHeight(x, z);
    if (y >= s) return 'water';
    if (y > s - 4) return 'soil';
    const band = y + this.n1(x / 80, z / 80) * 3 + (x - this.sizeX / 2) * 0.03;
    const b = ((Math.floor(band / 5) % 6) + 6) % 6;
    return (['sandstone', 'shale', 'limestone', 'shale', 'dolomite', 'mudstone'] as RockType[])[b];
  }
  properties(x: number, y: number, z: number): RockProperties {
    const r = this.reservoirAt(x, y, z);
    return {
      rock: this.rockAt(x, y, z), porosity: 0.15, permeability: 50, hardness: 1, impedance: 6, gammaRay: 60, resistivity: r ? 80 : 4, density: 2.4,
      fluid: r ? (r.fluid === 'gas' ? 'gas' : 'oil') : 'brine', reservoirId: r?.id,
    };
  }
  reservoirAt(x: number, y: number, z: number): Reservoir | null {
    for (const r of this.reservoirs) {
      const dx = (x - r.center.x) / r.radiusX;
      const dz = (z - r.center.z) / r.radiusZ;
      const d = dx * dx + dz * dz;
      if (d > 1) continue;
      const bulge = (1 - d) * (r.topY - r.center.y) + this.n2(x / 9, z / 9) * 0.8;
      if (y <= r.center.y + bulge && y >= r.center.y - bulge * 0.7) return r;
    }
    return null;
  }
  aquiferAt(x: number, y: number, z: number): Aquifer | null {
    for (const a of this.aquifers) {
      const dx = (x - a.center.x) / a.radiusX;
      const dz = (z - a.center.z) / a.radiusZ;
      if (dx * dx + dz * dz <= 1 && y <= a.topY && y >= a.bottomY) return a;
    }
    return null;
  }
  porePressure(_x: number, y: number) {
    return (SEA_LEVEL - y + 20) * 40 * 3.28 * 0.465;
  }
  fracturePressure(x: number, y: number, z: number) {
    return this.porePressure(x, y) * 1.6 + z * 0;
  }
  getReservoir(id: string) {
    return this.reservoirs.find((r) => r.id === id);
  }
}

export class DevWorld implements IWorld {
  readonly height = H;
  readonly chunksX: number;
  readonly chunksZ: number;
  private chunks = new Map<number, Uint8Array>();
  private edits = new Map<number, number>();

  constructor(readonly geology: DevGeology, private bus: EventBus) {
    this.chunksX = geology.sizeX / CS;
    this.chunksZ = geology.sizeZ / CS;
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
  inBounds(x: number, y: number, z: number) {
    return x >= 0 && z >= 0 && y >= 0 && x < this.sizeX && z < this.sizeZ && y < H;
  }
  private key(cx: number, cz: number) {
    return cx * 4096 + cz;
  }
  isChunkGenerated(cx: number, cz: number) {
    return this.chunks.has(this.key(cx, cz));
  }
  getChunkData(cx: number, cz: number) {
    return this.chunks.get(this.key(cx, cz));
  }
  ensureChunk(cx: number, cz: number) {
    if (cx < 0 || cz < 0 || cx >= this.chunksX || cz >= this.chunksZ || this.isChunkGenerated(cx, cz)) return;
    this.chunks.set(this.key(cx, cz), this.generate(cx, cz));
  }
  getBlock(x: number, y: number, z: number) {
    if (!this.inBounds(x, y, z)) return B.AIR;
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    this.ensureChunk(cx, cz);
    return this.chunks.get(this.key(cx, cz))![(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS];
  }
  setBlock(x: number, y: number, z: number, id: number, source: 'player' | 'system' | 'load' = 'system') {
    if (!this.inBounds(x, y, z)) return false;
    const prev = this.getBlock(x, y, z);
    const cx = Math.floor(x / CS);
    const cz = Math.floor(z / CS);
    this.chunks.get(this.key(cx, cz))![(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS] = id;
    this.edits.set((y * this.sizeZ + z) * this.sizeX + x, id);
    this.bus.emit('world:blockChanged', { x, y, z, prev, id, source });
    return true;
  }
  isSolid(x: number, y: number, z: number) {
    const id = this.getBlock(x, y, z);
    return id !== B.AIR && id !== B.WATER && id !== B.TALL_GRASS;
  }
  getSurfaceY(x: number, z: number) {
    for (let y = H - 1; y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== B.AIR && id !== B.WATER) return y + 1;
    }
    return 1;
  }
  forEachEdit(fn: (x: number, y: number, z: number, id: number) => void) {
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
  loadEdits() {}

  // ---- generation -------------------------------------------------------------------------------
  private generate(cx: number, cz: number): Uint8Array {
    const g = this.geology;
    const d = new Uint8Array(CS * CS * H);
    const set = (x: number, y: number, z: number, id: number) => {
      if (x < 0 || z < 0 || x >= CS || z >= CS || y < 0 || y >= H) return;
      d[x + z * CS + y * CS * CS] = id;
    };
    const get = (x: number, y: number, z: number) => d[x + z * CS + y * CS * CS];
    const rockBlock: Record<string, number> = {
      sandstone: B.SANDSTONE, shale: B.SHALE, limestone: B.LIMESTONE, dolomite: B.DOLOMITE, mudstone: B.MUDSTONE, soil: B.DIRT, water: B.AIR,
    };
    for (let z = 0; z < CS; z++)
      for (let x = 0; x < CS; x++) {
        const wx = cx * CS + x;
        const wz = cz * CS + z;
        const s = g.surfaceHeight(wx, wz);
        const biome = g.biomeAt(wx, wz);
        for (let y = 0; y < s; y++) {
          let id: number;
          if (y === 0) id = B.BEDROCK;
          else if (y < 3 && hash3(wx, y, wz) < 0.5) id = B.BEDROCK;
          else if (y >= s - 1) {
            if (s <= SEA_LEVEL + 1) id = s < SEA_LEVEL - 3 ? B.SEABED_SILT : B.SAND;
            else if (biome === 'beach') id = B.SAND;
            else if (biome === 'desert') id = B.SAND;
            else if (s > 100) id = B.SNOW;
            else if (s > 92) id = hash3(wx, y, wz) < 0.5 ? B.STONE : B.GRAVEL;
            else if (biome === 'taiga') id = B.PODZOL;
            else id = B.GRASS;
          } else if (y >= s - 4) {
            id = biome === 'desert' || biome === 'beach' || s <= SEA_LEVEL + 1 ? B.SAND : s > 92 ? B.STONE : B.DIRT;
          } else {
            const res = g.reservoirAt(wx, y, wz);
            if (res) id = res.fluid === 'gas' ? B.GAS_SANDSTONE : y < res.owcY ? B.BRINE_SANDSTONE : B.OIL_SANDSTONE;
            else {
              const r = g.rockAt(wx, y, wz);
              id = rockBlock[r] ?? B.STONE;
              if (y > s - 12 && r !== 'soil') id = B.STONE;
              if (hash3(wx, y, wz) < 0.004) id = hash3(wz, y, wx) < 0.5 ? B.ORE_IRON : B.ORE_COPPER;
              if (y < 12 && hash3(wx, y * 3, wz) < 0.3) id = B.BASALT;
            }
          }
          set(x, y, z, id);
        }
        for (let y = s; y <= SEA_LEVEL; y++) set(x, y, z, B.WATER);
        if (s <= SEA_LEVEL - 2 && hash3(wx, 7, wz) < 0.18) set(x, s, z, hash3(wx, 8, wz) < 0.5 ? B.SEAGRASS : B.KELP);
        // small caves
        for (let y = 20; y < s - 6; y++) {
          const cave = Math.abs(g.n2(wx / 18 + y * 0.05, wz / 18)) < 0.04 && Math.abs(g.n3(wx / 22, y / 10 + wz * 0.01)) < 0.25;
          if (cave) set(x, y, z, B.AIR);
        }
      }
    // vegetation (deterministic per world column so trees cross chunk borders consistently)
    for (let z = -3; z < CS + 3; z++)
      for (let x = -3; x < CS + 3; x++) {
        const wx = cx * CS + x;
        const wz = cz * CS + z;
        if (wx < 0 || wz < 0 || wx >= g.sizeX || wz >= g.sizeZ) continue;
        const s = g.surfaceHeight(wx, wz);
        if (s <= SEA_LEVEL + 1 || s > 94) continue;
        const cxz = g.sizeX / 2;
        if (Math.max(Math.abs(wx - cxz), Math.abs(wz - cxz)) < 20) continue;
        const biome = g.biomeAt(wx, wz);
        const h = hash3(wx, 1, wz);
        const treeP = biome === 'forest' || biome === 'birch_forest' ? 0.03 : biome === 'taiga' ? 0.028 : biome === 'plains' ? 0.004 : 0;
        if (h < treeP) this.tree(set, get, x, s, z, biome, wx, wz);
        else if (x >= 0 && z >= 0 && x < CS && z < CS && get(x, s, z) === B.AIR) {
          if (biome === 'desert') {
            if (h > 0.994) for (let k = 0; k < 3; k++) set(x, s + k, z, B.CACTUS);
            else if (h > 0.985) set(x, s, z, B.DEAD_BUSH);
          } else if (h > 0.7) set(x, s, z, B.TALL_GRASS);
          else if (h > 0.685) set(x, s, z, hash3(wx, 2, wz) < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW);
        }
      }
    this.showcase(cx, cz, set);
    return d;
  }

  private tree(set: (x: number, y: number, z: number, id: number) => void, get: (x: number, y: number, z: number) => number, x: number, s: number, z: number, biome: BiomeId, wx: number, wz: number) {
    const pine = biome === 'taiga';
    const birch = biome === 'birch_forest' || (!pine && hash3(wx, 3, wz) < 0.25);
    const autumn = !pine && !birch && hash3(wx, 4, wz) < 0.2;
    const log = pine ? B.LOG_PINE : birch ? B.BIRCH_LOG : B.LOG_OAK;
    const leaves = pine ? B.LEAVES_PINE : birch ? B.BIRCH_LEAVES : autumn ? B.LEAVES_AUTUMN : B.LEAVES_OAK;
    const th = pine ? 7 + Math.floor(hash3(wx, 5, wz) * 3) : 4 + Math.floor(hash3(wx, 5, wz) * 3);
    if (pine) {
      for (let y = 2; y <= th + 1; y++) {
        const r = y > th ? 0 : Math.max(0, Math.floor((th - y) / 2.5)) + (y % 2 === 0 ? 1 : 0);
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) if (Math.abs(dx) + Math.abs(dz) <= r + 0.5) set(x + dx, s + y, z + dz, leaves);
      }
    } else {
      for (let y = th - 2; y <= th + 1; y++) {
        const r = y > th ? 1 : 2;
        for (let dz = -r; dz <= r; dz++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.abs(dx) === r && Math.abs(dz) === r && hash3(wx + dx, y, wz + dz) < 0.6) continue;
            set(x + dx, s + y, z + dz, leaves);
          }
      }
    }
    for (let y = 0; y < th; y++) set(x, s + y, z, log);
    void get;
  }

  /** Industrial test pad at the map centre: pipes, lamps, containers, glass, stripes, fire, spill. */
  private showcase(cx: number, cz: number, set: (x: number, y: number, z: number, id: number) => void) {
    const c = this.sizeX / 2;
    const ox = cx * CS;
    const oz = cz * CS;
    const put = (x: number, y: number, z: number, id: number) => set(x - ox, y, z - oz, id);
    const y0 = 67;
    for (let z = c - 12; z <= c + 12; z++)
      for (let x = c - 12; x <= c + 12; x++) {
        put(x, y0 - 1, z, Math.abs(x - c) === 12 || Math.abs(z - c) === 12 ? B.GRAVEL_PAD : B.CONCRETE_PAD);
        for (let y = y0; y < y0 + 12; y++) put(x, y, z, B.AIR);
      }
    // road leading west
    for (let x = c - 60; x < c - 12; x++) for (let z = c - 1; z <= c + 1; z++) {
      put(x, y0 - 1, z, B.ASPHALT_ROAD);
      for (let y = y0; y < y0 + 6; y++) put(x, y, z, B.AIR);
    }
    // oil pipe loop with a tee and a riser
    for (let x = c - 9; x <= c + 9; x++) put(x, y0, c - 6, B.PIPE_OIL);
    for (let z = c - 6; z <= c + 2; z++) put(c + 9, y0, z, B.PIPE_OIL);
    for (let y = y0; y <= y0 + 4; y++) put(c - 9, y, c - 6, B.PIPE_OIL);
    for (let x = c - 9; x <= c - 4; x++) put(x, y0 + 4, c - 6, B.PIPE_OIL);
    // gas / water / product racks
    for (let x = c - 9; x <= c + 9; x++) {
      put(x, y0 + 2, c - 3, B.PIPE_GAS);
      put(x, y0, c - 1, B.PIPE_WATER);
      put(x, y0 + 1, c + 4, B.PIPE_PRODUCT);
    }
    // structure block (building occupancy) the pipes connect into
    for (let y = y0; y <= y0 + 2; y++) for (let z = c - 7; z <= c - 5; z++) put(c + 11, y, z, B.STRUCTURE);
    for (let x = c + 10; x <= c + 10; x++) put(x, y0, c - 6, B.PIPE_OIL);
    // well casing going down from the pad
    for (let y = 20; y < y0 + 3; y++) put(c + 5, y, c + 8, B.CASING);
    // lamps & steel platform
    for (const [x, z] of [[c - 11, c - 11], [c + 11, c - 11], [c - 11, c + 11], [c + 11, c + 11]]) {
      put(x, y0, z, B.STEEL_PLATE);
      put(x, y0 + 1, z, B.STEEL_PLATE);
      put(x, y0 + 2, z, B.LAMP);
    }
    for (let x = c - 4; x <= c; x++) for (let z = c + 6; z <= c + 10; z++) put(x, y0 + 3, z, B.STEEL_GRATE);
    for (const [x, z] of [[c - 4, c + 6], [c, c + 6], [c - 4, c + 10], [c, c + 10]]) for (let y = y0; y < y0 + 3; y++) put(x, y, z, B.STEEL_PLATE);
    // containers
    for (let x = c + 2; x <= c + 5; x++) {
      put(x, y0, c + 10, B.CONTAINER_RED);
      put(x, y0, c + 11, B.CONTAINER_RED);
      put(x, y0 + 1, c + 10, B.CONTAINER_BLUE);
      put(x, y0 + 1, c + 11, B.CONTAINER_BLUE);
    }
    // control hut: brick, glass, planks, hazard stripe
    for (let x = c - 11; x <= c - 7; x++)
      for (let z = c + 6; z <= c + 10; z++)
        for (let y = y0; y <= y0 + 3; y++) {
          const wall = x === c - 11 || x === c - 7 || z === c + 6 || z === c + 10;
          if (y === y0 + 3) put(x, y, z, B.PLANKS);
          else if (wall) put(x, y, z, y === y0 + 1 && (x === c - 9 || z === c + 8) ? B.GLASS : y === y0 ? B.HAZARD_STRIPE : B.BRICK);
        }
    put(c - 9, y0 + 1, c + 8, B.LAMP);
    for (let x = c - 10; x <= c - 8; x++) for (let z = c + 7; z <= c + 9; z++) if (!(x === c - 9 && z === c + 8)) put(x, y0 + 1, z, B.AIR);
    // concrete wall, spill and fire
    for (let z = c - 12; z <= c - 8; z++) for (let y = y0; y < y0 + 2; y++) put(c + 12, y, z, B.CONCRETE);
    for (let x = c + 2; x <= c + 5; x++) for (let z = c + 1; z <= c + 3; z++) put(x, y0, z, B.OIL_POOL);
    put(c + 7, y0, c + 5, B.FIRE);
    put(c + 7, y0 - 1, c + 5, B.SCORCHED_EARTH);
    put(c + 8, y0 - 1, c + 5, B.ASH);
    put(c + 6, y0 - 1, c + 5, B.SCORCHED_EARTH);
    // glass & ice showcase
    put(c - 2, y0, c + 1, B.GLASS);
    put(c - 1, y0, c + 1, B.ICE);
  }
}
