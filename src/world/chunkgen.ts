// Chunk voxel generation. `generateChunk` fills a 16×16×160 column chunk from the geology classifier and
// then decorates it. `generateChunkData` is a pure (seed, size, cx, cz) → Uint8Array entry point suitable
// for a Web Worker: it builds (and caches) the deterministic Geology for the seed/size on first use.
import { B } from '../core/blocks';
import { CHUNK_SIZE, SEA_LEVEL, WORLD_HEIGHT, type WorldSizeKey } from '../core/constants';
import { decorateChunk } from './decorate';
import { Geology } from './geology';
import { ColumnCtx } from './model';

export const CHUNK_LAYER = CHUNK_SIZE * CHUNK_SIZE;
export const CHUNK_VOLUME = CHUNK_LAYER * WORLD_HEIGHT;

const genCtx = new WeakMap<Geology, ColumnCtx>();

/** Generate the voxels of chunk (cx, cz). Writes into `out` when given (must be CHUNK_VOLUME long). */
export function generateChunk(geo: Geology, cx: number, cz: number, out?: Uint8Array): Uint8Array {
  const data = out ?? new Uint8Array(CHUNK_VOLUME);
  if (out) data.fill(0);
  let ctx = genCtx.get(geo);
  if (!ctx) {
    ctx = new ColumnCtx();
    genCtx.set(geo, ctx);
  }
  const x0 = cx * CHUNK_SIZE;
  const z0 = cz * CHUNK_SIZE;
  const size = geo.sizeX;
  for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    const z = z0 + lz;
    if (z < 0 || z >= size) continue;
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      const x = x0 + lx;
      if (x < 0 || x >= size) continue;
      geo.prepareColumn(ctx, x, z);
      const g = ctx.ground;
      let idx = lx + lz * CHUNK_SIZE;
      for (let y = 0; y < g; y++, idx += CHUNK_LAYER) data[idx] = geo.classify(ctx, y);
      if (g <= SEA_LEVEL) for (let y = g; y <= SEA_LEVEL; y++, idx += CHUNK_LAYER) data[idx] = B.WATER;
    }
  }
  decorateChunk(geo, cx, cz, data);
  return data;
}

const geoCache: { key: string; geo: Geology }[] = [];

/** Deterministic Geology for (seed, size), cached (keeps the two most recent). */
export function geologyFor(seed: number, size: WorldSizeKey): Geology {
  const key = `${seed | 0}:${size}`;
  const hit = geoCache.find((e) => e.key === key);
  if (hit) return hit.geo;
  const geo = new Geology(seed, size);
  geoCache.unshift({ key, geo });
  if (geoCache.length > 2) geoCache.pop();
  return geo;
}

/**
 * Pure chunk generator: (seed, size, cx, cz) → voxel data (index = x + z*16 + y*256).
 * Intended for Web Workers — the worker builds its own Geology once (≈0.5–1.5 s) and then generates
 * chunks independently of the main thread. Output is byte-identical to IWorld chunk generation
 * (player edits are NOT applied; the world applies them on the main thread).
 */
export function generateChunkData(seed: number, size: WorldSizeKey, cx: number, cz: number): Uint8Array {
  return generateChunk(geologyFor(seed, size), cx, cz);
}
