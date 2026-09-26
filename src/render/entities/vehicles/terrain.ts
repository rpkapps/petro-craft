// Ground height sampling for vehicles, NPCs, avatars and dropped items: the terrain surface ignoring
// the invisible STRUCTURE occupancy blocks of buildings (vehicles drive "through" footprints rather
// than over roofs) and vegetation (tree canopies, trunks, grass tufts), with a small per-cell cache
// refreshed every couple of seconds. Never forces chunk generation.
import { B, IS_SOLID } from '../../../core/blocks';
import { CHUNK_SIZE, SEA_LEVEL } from '../../../core/constants';
import type { GameContext } from '../../../core/types';

/** Blocks a ground probe passes through (buildings' occupancy, plants, trees). */
export const SKIP_GROUND = new Uint8Array(256);
for (let i = 0; i < 256; i++) SKIP_GROUND[i] = IS_SOLID[i] ? 0 : 1;
for (const id of [B.STRUCTURE, B.LOG_OAK, B.LOG_PINE, B.BIRCH_LOG, B.LEAVES_OAK, B.LEAVES_PINE, B.LEAVES_AUTUMN, B.BIRCH_LEAVES, B.CACTUS]) SKIP_GROUND[id] = 1;
/** Tree trunks / cacti: obstacles for ground vehicles. */
export const TRUNK = new Uint8Array(256);
for (const id of [B.LOG_OAK, B.LOG_PINE, B.BIRCH_LOG, B.CACTUS]) TRUNK[id] = 1;

export class Terrain {
  private readonly cache = new Map<number, number>();
  private age = 0;

  constructor(private readonly ctx: GameContext) {}

  tick(dt: number): void {
    this.age += dt;
    if (this.age > 2 || this.cache.size > 20000) {
      this.age = 0;
      this.cache.clear();
    }
  }

  /** Whether the chunk holding block column (ix, iz) exists (in-bounds only). */
  generated(ix: number, iz: number): boolean {
    return this.ctx.world.isChunkGenerated(Math.floor(ix / CHUNK_SIZE), Math.floor(iz / CHUNK_SIZE));
  }

  /** Uncached ground probe for an in-bounds block column. `trunk` receives whether a trunk stands on it. */
  probe(ix: number, iz: number, out?: { trunk: boolean }): number {
    const w = this.ctx.world;
    if (out) out.trunk = false;
    if (!this.generated(ix, iz)) return this.ctx.geology.surfaceHeight(ix, iz);
    let y = w.getSurfaceY(ix, iz);
    let guard = 64;
    while (y > 1 && guard-- > 0) {
      const id = w.getBlock(ix, y - 1, iz);
      if (!SKIP_GROUND[id]) break;
      if (out && TRUNK[id]) out.trunk = true;
      y--;
    }
    return y;
  }

  /** First free y above solid ground at (x, z) (block coords, floats floored). */
  ground(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const key = ix * 100003 + iz;
    const c = this.cache.get(key);
    if (c !== undefined) return c;
    const w = this.ctx.world;
    const y = ix < 0 || iz < 0 || ix >= w.sizeX || iz >= w.sizeZ ? SEA_LEVEL + 1 : this.probe(ix, iz);
    this.cache.set(key, y);
    return y;
  }

  /** Ground height, bilinearly smoothed between cell centres (for gentle vehicle motion). */
  smooth(x: number, z: number): number {
    const fx = x - 0.5;
    const fz = z - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const a = this.ground(x0 + 0.5, z0 + 0.5);
    const b = this.ground(x0 + 1.5, z0 + 0.5);
    const c = this.ground(x0 + 0.5, z0 + 1.5);
    const d = this.ground(x0 + 1.5, z0 + 1.5);
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Solid block at a point (false for unloaded chunks / out of bounds; never generates chunks). */
  solidAt(x: number, y: number, z: number): boolean {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const w = this.ctx.world;
    if (ix < 0 || iz < 0 || ix >= w.sizeX || iz >= w.sizeZ || !this.generated(ix, iz)) return false;
    return IS_SOLID[w.getBlock(ix, Math.floor(y), iz)] === 1;
  }

  /** Ground or water surface (whichever is higher) — for things that float. */
  surface(x: number, z: number): number {
    return this.isWater(x, z) ? SEA_LEVEL + 1 : this.ground(x, z);
  }

  /** Open water at (x, z); beyond the map edge counts as open sea. */
  isWater(x: number, z: number): boolean {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const w = this.ctx.world;
    if (ix < 0 || iz < 0 || ix >= w.sizeX || iz >= w.sizeZ) return true;
    return this.ctx.geology.waterDepth(ix, iz) > 0.5 && this.ground(x, z) <= SEA_LEVEL;
  }
}
