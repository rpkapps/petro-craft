// Spawn selection: dry, flat, open land near the map centre (away from water, cliffs & mountains).
import type { IGeology } from '../core/types';
import { BI } from './biomes';
import { treeNear } from './decorate';
import type { Geology } from './geology';
import { TF } from './terrain';

const cache = new WeakMap<object, { x: number; y: number; z: number }>();

const BIOME_BONUS: Record<number, number> = {
  [BI.PLAINS]: 8,
  [BI.BIRCH]: 3,
  [BI.FOREST]: 2,
  [BI.TAIGA]: 1,
  [BI.DESERT]: 1,
  [BI.SWAMP]: -6,
  [BI.BADLANDS]: -3,
  [BI.TUNDRA]: -2,
};

export function spawnFor(geo: Geology): { x: number; y: number; z: number } {
  const hit = cache.get(geo);
  if (hit) return { ...hit };
  const t = geo.terrain;
  const size = t.size;
  const c = size >> 1;
  const R = Math.floor(size * 0.32);
  let best = -Infinity;
  let bx = c;
  let bz = c;
  for (let dz = -R; dz <= R; dz += 4) {
    for (let dx = -R; dx <= R; dx += 4) {
      const x = c + dx;
      const z = c + dz;
      if (x < 12 || z < 12 || x >= size - 12 || z >= size - 12) continue;
      const i = x + z * size;
      const b = t.biome[i];
      if (t.flags[i] & (TF.WATER | TF.BEACH | TF.CLIFF)) continue;
      if (b === BI.MOUNTAINS || b === BI.BEACH || b === BI.RIVER || b === BI.OCEAN || b === BI.DEEP_OCEAN) continue;
      const g = t.ground[i];
      if (g < 64 || g > 92) continue;
      let lo = 255;
      let hi = 0;
      let wet = false;
      for (let sz = -8; sz <= 8; sz += 2) {
        for (let sx = -8; sx <= 8; sx += 2) {
          const j = x + sx + (z + sz) * size;
          if (t.flags[j] & TF.WATER) wet = true;
          if (Math.abs(sx) <= 6 && Math.abs(sz) <= 6) {
            const gg = t.ground[j];
            if (gg < lo) lo = gg;
            if (gg > hi) hi = gg;
          }
        }
      }
      if (wet) continue;
      const relief = hi - lo;
      if (relief > 4) continue;
      const dist = Math.hypot(dx, dz);
      const score = (BIOME_BONUS[b] ?? 0) - relief * 3 - dist * 0.06;
      if (score > best) {
        best = score;
        bx = x;
        bz = z;
      }
    }
  }
  // nudge off any tree trunk
  outer: for (let r = 0; r <= 6; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const x = bx + dx;
        const z = bz + dz;
        const i = t.index(x, z);
        if (t.flags[i] & TF.WATER) continue;
        if (!treeNear(geo, x, z, 2)) {
          bx = x;
          bz = z;
          break outer;
        }
      }
    }
  }
  const out = { x: bx + 0.5, y: t.ground[t.index(bx, bz)], z: bz + 0.5 };
  cache.set(geo, out);
  return { ...out };
}

/** Fallback for foreign IGeology implementations. */
export function spawnGeneric(g: IGeology): { x: number; y: number; z: number } {
  const c = g.sizeX >> 1;
  for (let r = 0; r < g.sizeX / 2; r += 4) {
    for (let a = 0; a < 16; a++) {
      const x = Math.round(c + Math.cos((a / 16) * Math.PI * 2) * r);
      const z = Math.round(c + Math.sin((a / 16) * Math.PI * 2) * r);
      if (g.waterDepth(x, z) === 0 && g.biomeAt(x, z) !== 'mountains') return { x: x + 0.5, y: g.surfaceHeight(x, z), z: z + 0.5 };
    }
  }
  return { x: c + 0.5, y: g.surfaceHeight(c, c), z: c + 0.5 };
}
