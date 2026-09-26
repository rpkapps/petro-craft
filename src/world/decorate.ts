// Chunk decoration: ground cover, trees, cacti, aquatic plants, ores and small caves.
//
// Every feature that can cross a chunk border (trees, ore blobs, caves) is derived from a global hashed
// cell grid: each chunk enumerates all cells whose feature could reach it and writes only the voxels that
// fall inside it. Write rules are order-independent (logs beat leaves, leaves only fill air/plants), so a
// feature straddling chunks is identical no matter which chunk is generated first.
import { B } from '../core/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { hash4 } from '../core/rng';
import { BI } from './biomes';
import type { Geology } from './geology';
import { ColumnCtx } from './model';
import { subSeed } from './noise';
import { TF } from './terrain';

const CS = CHUNK_SIZE;
const LAYER = CS * CS;
const TREE_CELL = 5;
const TREE_REACH = 3;
const CACTUS_CELL = 7;
const ORE_CELL = 8;
const CAVE_CELL = 24;
const CAVE_BASE_Y = 60;

const PLANT = new Uint8Array(256);
for (const b of [B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.DEAD_BUSH, B.REEDS, B.SEAGRASS, B.KELP, B.SNOW]) PLANT[b] = 1;
const LEAF = new Uint8Array(256);
for (const b of [B.LEAVES_OAK, B.LEAVES_PINE, B.LEAVES_AUTUMN, B.BIRCH_LEAVES]) LEAF[b] = 1;
const ORE_HOST = new Uint8Array(256);
for (const b of [B.STONE, B.GRANITE, B.SANDSTONE, B.MUDSTONE, B.LIMESTONE, B.SHALE, B.DOLOMITE, B.TERRACOTTA, B.CHALK, B.BASALT]) ORE_HOST[b] = 1;
const CARVABLE = new Uint8Array(256);
for (const b of [B.STONE, B.GRANITE, B.SANDSTONE, B.MUDSTONE, B.LIMESTONE, B.SHALE, B.DOLOMITE, B.CHALK, B.TERRACOTTA, B.DIRT, B.CLAY, B.COAL_SEAM, B.BASALT]) CARVABLE[b] = 1;
const TREE_SOIL = new Uint8Array(256);
for (const b of [B.GRASS, B.PODZOL, B.DIRT, B.SNOW, B.MUD]) TREE_SOIL[b] = 1;

/** Tree acceptance probability per 5×5 cell, by biome index. */
const TREE_DENSITY = [0.045, 0.62, 0.58, 0.52, 0, 0, 0.24, 0.035, 0.12, 0, 0, 0, 0];

const T_OAK = 0;
const T_BIG_OAK = 1;
const T_BIRCH = 2;
const T_SPRUCE = 3;
const T_PINE = 4;
const T_SWAMP = 5;
const T_SMALL_SPRUCE = 6;

interface Seeds {
  deco: number;
  tree: number;
  leaf: number;
  ore: number;
  cave: number;
}
const seedCache = new WeakMap<Geology, Seeds>();
const auxCtx = new WeakMap<Geology, ColumnCtx>();

function seedsOf(geo: Geology): Seeds {
  let s = seedCache.get(geo);
  if (!s) {
    s = { deco: subSeed(geo.seed, 700), tree: subSeed(geo.seed, 701), leaf: subSeed(geo.seed, 702), ore: subSeed(geo.seed, 703), cave: subSeed(geo.seed, 704) };
    seedCache.set(geo, s);
  }
  return s;
}

function ctxOf(geo: Geology): ColumnCtx {
  let c = auxCtx.get(geo);
  if (!c) {
    c = new ColumnCtx();
    auxCtx.set(geo, c);
  }
  return c;
}

export function decorateChunk(geo: Geology, cx: number, cz: number, data: Uint8Array): void {
  const seeds = seedsOf(geo);
  groundCover(geo, seeds, cx, cz, data);
  caves(geo, seeds, cx, cz, data);
  ores(geo, seeds, cx, cz, data);
  trees(geo, seeds, cx, cz, data);
  cacti(geo, seeds, cx, cz, data);
}

// ------------------------------------------------------------------------------------------------
// Ground cover (single column → no cross-chunk concerns)
// ------------------------------------------------------------------------------------------------

function groundCover(geo: Geology, seeds: Seeds, cx: number, cz: number, data: Uint8Array): void {
  const t = geo.terrain;
  const size = t.size;
  for (let lz = 0; lz < CS; lz++) {
    for (let lx = 0; lx < CS; lx++) {
      const x = cx * CS + lx;
      const z = cz * CS + lz;
      const i = x + z * size;
      const li = lx + lz * CS;
      const g = t.ground[i];
      if (g >= WORLD_HEIGHT - 4) continue;
      const f = t.flags[i];
      const b = t.biome[i];
      const top = data[li + (g - 1) * LAYER];
      const h = hash4(seeds.deco, x, z);
      const r1 = (h & 0xffff) / 65536;
      const r2 = (h >>> 16) / 65536;
      const at = li + g * LAYER;

      if (f & TF.WATER) {
        const wd = SEA_LEVEL + 1 - g;
        if (f & TF.OCEAN) {
          const warm = t.temp[i] > 150;
          const soft = top === B.SAND || top === B.GRAVEL || top === B.SEABED_SILT || top === B.CLAY;
          if (warm && wd >= 3 && wd <= 11 && t.patch[i] > 140 && r1 < 0.24) {
            data[at] = B.CORAL;
            if (r2 < 0.45 && wd > 4) data[at + LAYER] = B.CORAL;
            if (r2 < 0.12 && wd > 6) data[at + 2 * LAYER] = B.CORAL;
          } else if (soft && wd >= 5 && wd <= 24 && r1 < 0.075) {
            const kh = Math.max(1, Math.min(wd - 2, 2 + Math.floor(r2 * (wd - 3))));
            for (let k = 0; k < kh; k++) data[at + k * LAYER] = B.KELP;
          } else if (soft && wd >= 2 && wd <= 14 && r1 < 0.26) {
            data[at] = B.SEAGRASS;
          }
        } else {
          if (t.temp[i] < 56) data[li + SEA_LEVEL * LAYER] = B.ICE;
          else if (wd >= 2 && wd <= 4 && r1 < 0.14 && (top === B.SAND || top === B.CLAY || top === B.MUD)) data[at] = B.SEAGRASS;
        }
        continue;
      }
      if (data[at] !== B.AIR) continue;

      // reeds on land right at the water's edge
      if (g === SEA_LEVEL + 1 && r2 < 0.4 && (top === B.GRASS || top === B.SAND || top === B.DIRT || top === B.MUD) && t.temp[i] > 70) {
        const wet = (x > 0 && t.flags[i - 1] & TF.WATER) || (x < size - 1 && t.flags[i + 1] & TF.WATER) || (z > 0 && t.flags[i - size] & TF.WATER) || (z < size - 1 && t.flags[i + size] & TF.WATER);
        if (wet) {
          const rh = 1 + Math.floor(r1 * 3);
          for (let k = 0; k < rh; k++) data[at + k * LAYER] = B.REEDS;
          continue;
        }
      }
      const grassy = top === B.GRASS || top === B.PODZOL;
      switch (b) {
        case BI.PLAINS:
          if (!grassy) break;
          if (r1 < 0.3) data[at] = B.TALL_GRASS;
          else if (r1 < 0.345) data[at] = r2 < 0.5 ? B.FLOWER_RED : B.FLOWER_YELLOW;
          break;
        case BI.FOREST:
          if (!grassy) break;
          if (r1 < 0.14) data[at] = B.TALL_GRASS;
          else if (r1 < 0.16) data[at] = r2 < 0.6 ? B.FLOWER_RED : B.FLOWER_YELLOW;
          break;
        case BI.BIRCH:
          if (!grassy) break;
          if (r1 < 0.18) data[at] = B.TALL_GRASS;
          else if (r1 < 0.225) data[at] = r2 < 0.35 ? B.FLOWER_RED : B.FLOWER_YELLOW;
          break;
        case BI.TAIGA:
          if (grassy && r1 < 0.08) data[at] = B.TALL_GRASS;
          break;
        case BI.SWAMP:
          if (grassy && r1 < 0.24) data[at] = B.TALL_GRASS;
          break;
        case BI.MOUNTAINS:
          if (top === B.GRASS && r1 < 0.1) data[at] = B.TALL_GRASS;
          break;
        case BI.DESERT:
          if (top === B.SAND && r1 < 0.012) data[at] = B.DEAD_BUSH;
          break;
        case BI.BADLANDS:
          if ((top === B.RED_SAND || top === B.TERRACOTTA) && r1 < 0.02) data[at] = B.DEAD_BUSH;
          break;
        default:
          break;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Trees
// ------------------------------------------------------------------------------------------------

interface TreeSpot {
  x: number;
  z: number;
  y: number;
  kind: number;
  h: number;
  leaves: number;
  log: number;
}

/** Tree rooted in cell (gx, gz), or null. Pure function of the geology — used by chunks and spawn search. */
export function treeAt(geo: Geology, gx: number, gz: number): TreeSpot | null {
  const seeds = seedsOf(geo);
  const t = geo.terrain;
  const h = hash4(seeds.tree, gx, gz);
  const x = gx * TREE_CELL + (h & 3);
  const z = gz * TREE_CELL + ((h >>> 2) & 3);
  if (x < 0 || z < 0 || x >= t.size || z >= t.size) return null;
  const i = x + z * t.size;
  const b = t.biome[i];
  const p = ((h >>> 8) & 0xffff) / 65536;
  if (p >= TREE_DENSITY[b]) return null;
  if (t.flags[i] & (TF.WATER | TF.BEACH) || t.slope[i] > 2) return null;
  const g = t.ground[i];
  if (g > WORLD_HEIGHT - 16 || (b === BI.MOUNTAINS && g > 112)) return null;
  const ctx = ctxOf(geo);
  geo.prepareColumn(ctx, x, z);
  const top = geo.classify(ctx, g - 1);
  if (!TREE_SOIL[top]) return null;
  const r = (h >>> 24) / 256;
  const autumn = t.patch[i] > 196 && (b === BI.FOREST || b === BI.BIRCH);
  let kind: number;
  switch (b) {
    case BI.PLAINS:
      kind = r < 0.8 ? T_OAK : T_BIRCH;
      break;
    case BI.FOREST:
      kind = r < 0.55 ? T_OAK : r < 0.75 ? T_BIG_OAK : T_BIRCH;
      break;
    case BI.BIRCH:
      kind = r < 0.85 ? T_BIRCH : T_OAK;
      break;
    case BI.TAIGA:
      kind = r < 0.82 ? T_SPRUCE : T_PINE;
      break;
    case BI.SWAMP:
      kind = T_SWAMP;
      break;
    case BI.TUNDRA:
      kind = T_SMALL_SPRUCE;
      break;
    default:
      kind = r < 0.7 ? T_SPRUCE : T_SMALL_SPRUCE;
  }
  const conifer = kind === T_SPRUCE || kind === T_PINE || kind === T_SMALL_SPRUCE;
  const leaves = conifer ? B.LEAVES_PINE : kind === T_BIRCH ? (autumn && r > 0.93 ? B.LEAVES_AUTUMN : B.BIRCH_LEAVES) : autumn ? B.LEAVES_AUTUMN : B.LEAVES_OAK;
  const log = conifer ? B.LOG_PINE : kind === T_BIRCH ? B.BIRCH_LOG : B.LOG_OAK;
  return { x, z, y: g, kind, h, leaves, log };
}

/** True if any tree trunk stands within `r` blocks of (x, z). */
export function treeNear(geo: Geology, x: number, z: number, r: number): boolean {
  const g0x = Math.floor((x - r - 4) / TREE_CELL);
  const g1x = Math.floor((x + r) / TREE_CELL);
  const g0z = Math.floor((z - r - 4) / TREE_CELL);
  const g1z = Math.floor((z + r) / TREE_CELL);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const tr = treeAt(geo, gx, gz);
      if (tr && Math.abs(tr.x - x) <= r && Math.abs(tr.z - z) <= r) return true;
    }
  }
  return false;
}

function trees(geo: Geology, seeds: Seeds, cx: number, cz: number, data: Uint8Array): void {
  const x0 = cx * CS;
  const z0 = cz * CS;
  const g0x = Math.floor((x0 - TREE_REACH - 3) / TREE_CELL);
  const g1x = Math.floor((x0 + CS - 1 + TREE_REACH) / TREE_CELL);
  const g0z = Math.floor((z0 - TREE_REACH - 3) / TREE_CELL);
  const g1z = Math.floor((z0 + CS - 1 + TREE_REACH) / TREE_CELL);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const tr = treeAt(geo, gx, gz);
      if (!tr) continue;
      if (tr.x + TREE_REACH < x0 || tr.x - TREE_REACH >= x0 + CS || tr.z + TREE_REACH < z0 || tr.z - TREE_REACH >= z0 + CS) continue;
      placeTree(tr, seeds.leaf, x0, z0, data);
    }
  }
}

function placeTree(tr: TreeSpot, leafSeed: number, x0: number, z0: number, data: Uint8Array): void {
  const { x, y, z, h } = tr;
  const setLog = (px: number, py: number, pz: number) => {
    const lx = px - x0;
    const lz = pz - z0;
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || py < 1 || py >= WORLD_HEIGHT) return;
    const i = lx + lz * CS + py * LAYER;
    const cur = data[i];
    if (cur === B.AIR || PLANT[cur] || LEAF[cur]) data[i] = tr.log;
  };
  const setLeaf = (px: number, py: number, pz: number) => {
    const lx = px - x0;
    const lz = pz - z0;
    if (lx < 0 || lz < 0 || lx >= CS || lz >= CS || py < 1 || py >= WORLD_HEIGHT) return;
    const i = lx + lz * CS + py * LAYER;
    const cur = data[i];
    if (cur === B.AIR || (PLANT[cur] && cur !== B.SNOW)) data[i] = tr.leaves;
  };
  const rnd = (a: number, b: number, c: number) => hash4(leafSeed, a, b, c) / 4294967296;
  const r = (h >>> 24) / 256;

  switch (tr.kind) {
    case T_OAK:
    case T_BIRCH: {
      const H = (tr.kind === T_BIRCH ? 5 : 4) + Math.floor(r * 3);
      const top = y + H - 1;
      for (let k = 0; k < H; k++) setLog(x, y + k, z);
      for (let py = top - 2; py <= top + 1; py++) {
        const rad = py <= top - 1 ? 2 : 1;
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx === 0 && dz === 0 && py <= top) continue;
            const corner = Math.abs(dx) === rad && Math.abs(dz) === rad;
            if (corner && (py === top + 1 || rnd(x + dx, py, z + dz) < 0.55)) continue;
            setLeaf(x + dx, py, z + dz);
          }
        }
      }
      break;
    }
    case T_BIG_OAK: {
      const H = 6 + Math.floor(r * 2);
      const top = y + H - 1;
      for (let k = 0; k < H; k++) setLog(x, y + k, z);
      // a couple of stubby branches
      if (r > 0.3) setLog(x + 1, top - 2, z);
      if (r > 0.6) setLog(x - 1, top - 1, z);
      const cyy = top - 0.5;
      for (let py = top - 3; py <= top + 2; py++) {
        for (let dz = -3; dz <= 3; dz++) {
          for (let dx = -3; dx <= 3; dx++) {
            const dy = (py - cyy) * 1.35;
            const d2 = dx * dx + dz * dz + dy * dy;
            if (d2 > 10.5 + rnd(x + dx, py, z + dz) * 2.5) continue;
            setLeaf(x + dx, py, z + dz);
          }
        }
      }
      break;
    }
    case T_SPRUCE:
    case T_SMALL_SPRUCE: {
      const small = tr.kind === T_SMALL_SPRUCE;
      const H = small ? 4 + Math.floor(r * 3) : 7 + Math.floor(r * 4);
      const top = y + H - 1;
      for (let k = 0; k < H; k++) setLog(x, y + k, z);
      const maxR = small ? 2 : 3;
      const start = y + (small ? 1 : 2);
      for (let py = start; py <= top + 1; py++) {
        const fromTop = top + 1 - py;
        let rad = Math.min(maxR, Math.floor((fromTop + 1) / 2));
        if (fromTop % 2 === 1 && rad > 1) rad--;
        if (py === top + 1) rad = 0;
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) + Math.abs(dz) > rad + (rad >= 2 ? 1 : 0)) continue;
            if (dx === 0 && dz === 0 && py <= top) continue;
            setLeaf(x + dx, py, z + dz);
          }
        }
      }
      break;
    }
    case T_PINE: {
      const H = 9 + Math.floor(r * 4);
      const top = y + H - 1;
      for (let k = 0; k < H; k++) setLog(x, y + k, z);
      for (let py = top - 3; py <= top + 1; py++) {
        const rad = py === top + 1 ? 0 : py >= top - 1 ? 1 : 2;
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
            if (dx === 0 && dz === 0 && py <= top) continue;
            setLeaf(x + dx, py, z + dz);
          }
        }
      }
      break;
    }
    default: {
      // swamp oak: short trunk, wide flat drooping canopy
      const H = 4 + Math.floor(r * 2);
      const top = y + H - 1;
      for (let k = 0; k < H; k++) setLog(x, y + k, z);
      for (let py = top - 1; py <= top + 1; py++) {
        const rad = py === top + 1 ? 1 : 3;
        for (let dz = -rad; dz <= rad; dz++) {
          for (let dx = -rad; dx <= rad; dx++) {
            const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
            if (Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
            if (edge && py === top && rnd(x + dx, py, z + dz) < 0.3) continue;
            if (dx === 0 && dz === 0 && py <= top) continue;
            setLeaf(x + dx, py, z + dz);
            // hanging vines of leaves at the rim
            if (edge && py === top - 1 && rnd(x + dx, py - 1, z + dz) < 0.25) setLeaf(x + dx, py - 1, z + dz);
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Cacti (single column; spacing guaranteed by the cell grid)
// ------------------------------------------------------------------------------------------------

function cacti(geo: Geology, seeds: Seeds, cx: number, cz: number, data: Uint8Array): void {
  const t = geo.terrain;
  const x0 = cx * CS;
  const z0 = cz * CS;
  const g0x = Math.floor(x0 / CACTUS_CELL);
  const g1x = Math.floor((x0 + CS - 1) / CACTUS_CELL);
  const g0z = Math.floor(z0 / CACTUS_CELL);
  const g1z = Math.floor((z0 + CS - 1) / CACTUS_CELL);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const h = hash4(seeds.deco ^ 0x5a5a, gx, gz);
      if ((h & 1023) > 330) continue;
      const x = gx * CACTUS_CELL + ((h >>> 10) % 5);
      const z = gz * CACTUS_CELL + ((h >>> 14) % 5);
      const lx = x - x0;
      const lz = z - z0;
      if (lx < 0 || lz < 0 || lx >= CS || lz >= CS) continue;
      const i = x + z * t.size;
      if (t.biome[i] !== BI.DESERT || t.slope[i] > 1 || t.flags[i] & TF.WATER) continue;
      const g = t.ground[i];
      const li = lx + lz * CS;
      if (data[li + (g - 1) * LAYER] !== B.SAND) continue;
      const ch = 1 + ((h >>> 20) % 3);
      for (let k = 0; k < ch; k++) data[li + (g + k) * LAYER] = B.CACTUS;
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Ores
// ------------------------------------------------------------------------------------------------

function ores(geo: Geology, seeds: Seeds, cx: number, cz: number, data: Uint8Array): void {
  const x0 = cx * CS;
  const z0 = cz * CS;
  const g0x = Math.floor((x0 - 3) / ORE_CELL);
  const g1x = Math.floor((x0 + CS + 2) / ORE_CELL);
  const g0z = Math.floor((z0 - 3) / ORE_CELL);
  const g1z = Math.floor((z0 + CS + 2) / ORE_CELL);
  const gyMax = Math.floor((WORLD_HEIGHT - 1) / ORE_CELL);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      for (let gy = 0; gy <= gyMax; gy++) {
        const h = hash4(seeds.ore, gx, gy, gz);
        if ((h & 1023) > 175) continue;
        const ox = gx * ORE_CELL + ((h >>> 10) & 7);
        const oy = gy * ORE_CELL + ((h >>> 13) & 7);
        const oz = gz * ORE_CELL + ((h >>> 16) & 7);
        const rad = 1.0 + (((h >>> 19) & 7) / 7) * 0.95;
        const copper = ((h >>> 22) & 3) === 0 || (oy < 24 && ((h >>> 24) & 1) === 0);
        const ore = copper ? B.ORE_COPPER : B.ORE_IRON;
        const R = Math.ceil(rad);
        const r2 = rad * rad;
        for (let dy = -R; dy <= R; dy++) {
          const py = oy + dy;
          if (py < 2 || py >= WORLD_HEIGHT) continue;
          for (let dz = -R; dz <= R; dz++) {
            const lz = oz + dz - z0;
            if (lz < 0 || lz >= CS) continue;
            for (let dx = -R; dx <= R; dx++) {
              const lx = ox + dx - x0;
              if (lx < 0 || lx >= CS) continue;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 > r2) continue;
              const idx = lx + lz * CS + py * LAYER;
              if (ORE_HOST[data[idx]] && (d2 < r2 * 0.5 || hash4(h, dx, dy, dz) & 1)) data[idx] = ore;
            }
          }
        }
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------
// Caves: a few small two-lobed pockets in hills & mountains, always above sea level and well below ground
// ------------------------------------------------------------------------------------------------

function caves(geo: Geology, seeds: Seeds, cx: number, cz: number, data: Uint8Array): void {
  const t = geo.terrain;
  const x0 = cx * CS;
  const z0 = cz * CS;
  const reach = 12;
  const g0x = Math.floor((x0 - reach) / CAVE_CELL);
  const g1x = Math.floor((x0 + CS + reach) / CAVE_CELL);
  const g0z = Math.floor((z0 - reach) / CAVE_CELL);
  const g1z = Math.floor((z0 + CS + reach) / CAVE_CELL);
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      for (let gy = 0; gy < 4; gy++) {
        const h = hash4(seeds.cave, gx, gy, gz);
        if ((h & 255) > 34) continue;
        const bx = gx * CAVE_CELL + ((h >>> 8) % CAVE_CELL);
        const bz = gz * CAVE_CELL + ((h >>> 13) % CAVE_CELL);
        const by = CAVE_BASE_Y + gy * CAVE_CELL + ((h >>> 18) % CAVE_CELL);
        const rx = 3 + ((h >>> 23) & 3);
        const ry = 2 + ((h >>> 25) & 1) * 1.5;
        const rz = 3 + ((h >>> 26) & 3);
        const ang = (((h >>> 28) & 15) / 16) * Math.PI * 2;
        const ox = Math.round(Math.cos(ang) * (rx + 1));
        const oz = Math.round(Math.sin(ang) * (rz + 1));
        carveEllipsoid(t.ground, t.size, bx, by, bz, rx, ry, rz, x0, z0, data);
        carveEllipsoid(t.ground, t.size, bx + ox, by - 1, bz + oz, rx - 1, ry, rz - 1, x0, z0, data);
      }
    }
  }
}

function carveEllipsoid(
  ground: Uint8Array, size: number, ex: number, ey: number, ez: number, rx: number, ry: number, rz: number, x0: number, z0: number, data: Uint8Array,
): void {
  const Rx = Math.ceil(rx);
  const Ry = Math.ceil(ry);
  const Rz = Math.ceil(rz);
  for (let dz = -Rz; dz <= Rz; dz++) {
    const lz = ez + dz - z0;
    if (lz < 0 || lz >= CS) continue;
    for (let dx = -Rx; dx <= Rx; dx++) {
      const lx = ex + dx - x0;
      if (lx < 0 || lx >= CS) continue;
      const g = ground[(ex + dx) + (ez + dz) * size];
      const q0 = (dx * dx) / (rx * rx) + (dz * dz) / (rz * rz);
      if (q0 > 1) continue;
      for (let dy = -Ry; dy <= Ry; dy++) {
        const py = ey + dy;
        if (py <= SEA_LEVEL + 1 || py >= g - 4) continue;
        if (q0 + (dy * dy) / (ry * ry) > 1) continue;
        const idx = lx + lz * CS + py * LAYER;
        if (CARVABLE[data[idx]]) data[idx] = B.AIR;
      }
    }
  }
}
