// Ground height sampling for vehicles and NPCs: terrain surface ignoring the invisible STRUCTURE
// occupancy blocks of buildings (vehicles drive "through" footprints rather than over roofs),
// with a small per-cell cache refreshed every couple of seconds.
import { B } from '../../../core/blocks';
import { SEA_LEVEL } from '../../../core/constants';
import type { GameContext } from '../../../core/types';

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

  /** First free y above solid ground at (x, z) (block coords, floats floored). */
  ground(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const key = ix * 100003 + iz;
    const c = this.cache.get(key);
    if (c !== undefined) return c;
    const w = this.ctx.world;
    let y: number;
    if (ix < 0 || iz < 0 || ix >= w.sizeX || iz >= w.sizeZ) y = SEA_LEVEL + 1;
    else {
      y = w.getSurfaceY(ix, iz);
      let guard = 48;
      while (y > 1 && guard-- > 0 && w.getBlock(ix, y - 1, iz) === B.STRUCTURE) y--;
    }
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

  isWater(x: number, z: number): boolean {
    return this.ctx.geology.waterDepth(Math.floor(x), Math.floor(z)) > 0.5 && this.ground(x, z) <= SEA_LEVEL;
  }
}
