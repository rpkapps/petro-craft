// IWorld implementation: lazily generated 16×16×160 column chunks + a per-chunk edit journal.
import { B, IS_LIQUID, IS_SOLID } from '../core/blocks';
import { CHUNK_SIZE, WORLD_HEIGHT } from '../core/constants';
import type { EventBus } from '../core/EventBus';
import type { IGeology, IWorld, WorldEditsSave } from '../core/types';
import { CHUNK_LAYER, CHUNK_VOLUME, generateChunk } from './chunkgen';
import { decodeEdits, encodeEdits } from './edits';
import type { Geology } from './geology';

type EditSource = 'player' | 'system' | 'load';

export class VoxelWorld implements IWorld {
  readonly sizeX: number;
  readonly sizeZ: number;
  readonly height = WORLD_HEIGHT;
  readonly seed: number;
  readonly geology: IGeology;
  readonly chunksX: number;
  readonly chunksZ: number;

  private readonly geo: Geology;
  private readonly bus: EventBus;
  private readonly chunks: (Uint8Array | undefined)[];
  /** Per chunk: first free y (highest non-air, non-liquid + 1) per column. */
  private readonly heights: (Uint8Array | undefined)[];
  private readonly edits = new Map<number, Map<number, number>>();
  /** Edits loaded for chunks that have not been generated yet. */
  private readonly pending = new Map<number, Map<number, number>>();
  private generatedCount = 0;

  constructor(geo: Geology, bus: EventBus) {
    this.geo = geo;
    this.geology = geo;
    this.bus = bus;
    this.seed = geo.seed;
    this.sizeX = geo.sizeX;
    this.sizeZ = geo.sizeZ;
    this.chunksX = Math.ceil(this.sizeX / CHUNK_SIZE);
    this.chunksZ = Math.ceil(this.sizeZ / CHUNK_SIZE);
    this.chunks = new Array(this.chunksX * this.chunksZ);
    this.heights = new Array(this.chunksX * this.chunksZ);
  }

  /** Number of chunks generated so far. */
  get generatedChunks(): number {
    return this.generatedCount;
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && z >= 0 && y >= 0 && x < this.sizeX && z < this.sizeZ && y < WORLD_HEIGHT;
  }

  isChunkGenerated(cx: number, cz: number): boolean {
    if (cx < 0 || cz < 0 || cx >= this.chunksX || cz >= this.chunksZ) return false;
    return this.chunks[cx + cz * this.chunksX] !== undefined;
  }

  getChunkData(cx: number, cz: number): Uint8Array | undefined {
    if (cx < 0 || cz < 0 || cx >= this.chunksX || cz >= this.chunksZ) return undefined;
    return this.chunks[cx + cz * this.chunksX];
  }

  ensureChunk(cx: number, cz: number): void {
    if (cx < 0 || cz < 0 || cx >= this.chunksX || cz >= this.chunksZ) return;
    const ci = cx + cz * this.chunksX;
    if (this.chunks[ci]) return;
    this.generate(ci, cx, cz);
  }

  private generate(ci: number, cx: number, cz: number): Uint8Array {
    const data = generateChunk(this.geo, cx, cz, new Uint8Array(CHUNK_VOLUME));
    const pend = this.pending.get(ci);
    if (pend) {
      this.pending.delete(ci);
      let map = this.edits.get(ci);
      if (!map) this.edits.set(ci, (map = new Map()));
      for (const [idx, id] of pend) {
        data[idx] = id;
        map.set(idx, id);
      }
    }
    this.chunks[ci] = data;
    this.heights[ci] = computeHeights(data);
    this.generatedCount++;
    this.bus.emit('world:chunkGenerated', { cx, cz });
    return data;
  }

  private chunkFor(x: number, z: number): Uint8Array {
    const cx = x >> 4;
    const cz = z >> 4;
    const ci = cx + cz * this.chunksX;
    return this.chunks[ci] ?? this.generate(ci, cx, cz);
  }

  getBlock(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_HEIGHT || x < 0 || z < 0 || x >= this.sizeX || z >= this.sizeZ) return B.AIR;
    return this.chunkFor(x, z)[(x & 15) + ((z & 15) << 4) + y * CHUNK_LAYER];
  }

  isSolid(x: number, y: number, z: number): boolean {
    return IS_SOLID[this.getBlock(x, y, z)] === 1;
  }

  setBlock(x: number, y: number, z: number, id: number, source: EditSource = 'system'): boolean {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (!this.inBounds(x, y, z)) return false;
    id &= 255;
    const cx = x >> 4;
    const cz = z >> 4;
    const ci = cx + cz * this.chunksX;
    const data = this.chunks[ci] ?? this.generate(ci, cx, cz);
    const li = (x & 15) + ((z & 15) << 4);
    const idx = li + y * CHUNK_LAYER;
    const prev = data[idx];
    if (prev === id) return true;
    data[idx] = id;
    let map = this.edits.get(ci);
    if (!map) this.edits.set(ci, (map = new Map()));
    map.set(idx, id);
    this.updateHeight(ci, data, li, y, id);
    this.bus.emit('world:blockChanged', { x, y, z, prev, id, source });
    return true;
  }

  private updateHeight(ci: number, data: Uint8Array, li: number, y: number, id: number): void {
    const hm = this.heights[ci]!;
    const h = hm[li];
    if (id !== B.AIR && !IS_LIQUID[id]) {
      if (y + 1 > h) hm[li] = y + 1;
    } else if (y + 1 === h) {
      let yy = y - 1;
      while (yy >= 0) {
        const b = data[li + yy * CHUNK_LAYER];
        if (b !== B.AIR && !IS_LIQUID[b]) break;
        yy--;
      }
      hm[li] = yy + 1;
    }
  }

  getSurfaceY(x: number, z: number): number {
    x = Math.min(this.sizeX - 1, Math.max(0, Math.floor(x)));
    z = Math.min(this.sizeZ - 1, Math.max(0, Math.floor(z)));
    const cx = x >> 4;
    const cz = z >> 4;
    const ci = cx + cz * this.chunksX;
    if (!this.chunks[ci]) this.generate(ci, cx, cz);
    return this.heights[ci]![(x & 15) + ((z & 15) << 4)];
  }

  forEachEdit(fn: (x: number, y: number, z: number, id: number) => void): void {
    const visit = (ci: number, map: Map<number, number>) => {
      const bx = (ci % this.chunksX) * CHUNK_SIZE;
      const bz = Math.floor(ci / this.chunksX) * CHUNK_SIZE;
      for (const [idx, id] of map) {
        const y = Math.floor(idx / CHUNK_LAYER);
        const r = idx - y * CHUNK_LAYER;
        fn(bx + (r & 15), y, bz + (r >> 4), id);
      }
    };
    for (const [ci, map] of this.edits) visit(ci, map);
    for (const [ci, map] of this.pending) visit(ci, map);
  }

  serializeEdits(): WorldEditsSave {
    const chunks: Record<string, string> = {};
    const all = new Map<number, Map<number, number>>();
    for (const [ci, map] of this.pending) all.set(ci, map);
    for (const [ci, map] of this.edits) {
      const p = all.get(ci);
      if (p) {
        const merged = new Map(p);
        for (const [k, v] of map) merged.set(k, v);
        all.set(ci, merged);
      } else all.set(ci, map);
    }
    for (const [ci, map] of all) {
      if (!map.size) continue;
      chunks[`${ci % this.chunksX},${Math.floor(ci / this.chunksX)}`] = encodeEdits(map);
    }
    return { chunks };
  }

  loadEdits(save: WorldEditsSave): void {
    if (!save || !save.chunks) return;
    for (const key of Object.keys(save.chunks)) {
      const [sx, sz] = key.split(',');
      const cx = Number(sx);
      const cz = Number(sz);
      if (!Number.isInteger(cx) || !Number.isInteger(cz) || cx < 0 || cz < 0 || cx >= this.chunksX || cz >= this.chunksZ) continue;
      const ci = cx + cz * this.chunksX;
      const entries = new Map<number, number>();
      decodeEdits(save.chunks[key], entries, CHUNK_VOLUME);
      if (!entries.size) continue;
      const data = this.chunks[ci];
      if (!data) {
        let p = this.pending.get(ci);
        if (!p) this.pending.set(ci, (p = new Map()));
        for (const [k, v] of entries) p.set(k, v);
        continue;
      }
      let map = this.edits.get(ci);
      if (!map) this.edits.set(ci, (map = new Map()));
      for (const [idx, id] of entries) {
        const prev = data[idx];
        map.set(idx, id);
        if (prev === id) continue;
        data[idx] = id;
        const y = Math.floor(idx / CHUNK_LAYER);
        const li = idx - y * CHUNK_LAYER;
        this.updateHeight(ci, data, li, y, id);
        this.bus.emit('world:blockChanged', { x: cx * CHUNK_SIZE + (li & 15), y, z: cz * CHUNK_SIZE + (li >> 4), prev, id, source: 'load' });
      }
    }
  }
}

function computeHeights(data: Uint8Array): Uint8Array {
  const hm = new Uint8Array(CHUNK_LAYER);
  for (let li = 0; li < CHUNK_LAYER; li++) {
    let y = WORLD_HEIGHT - 1;
    while (y >= 0) {
      const b = data[li + y * CHUNK_LAYER];
      if (b !== B.AIR && !IS_LIQUID[b]) break;
      y--;
    }
    hm[li] = y + 1;
  }
  return hm;
}
