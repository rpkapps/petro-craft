// Voxel ray traversal (Amanatides & Woo DDA). Pure — usable from node tests.
import type { Vec3 } from '../core/types';

export interface VoxelHit {
  /** Hit block cell. */
  x: number;
  y: number;
  z: number;
  block: number;
  /** Face normal of the entered face (unit axis vector). Zero when the ray starts inside the block. */
  nx: number;
  ny: number;
  nz: number;
  /** Distance along the ray to the entry point and the entry point itself. */
  dist: number;
  point: Vec3;
}

/**
 * Walk the voxel grid from `origin` along `dir` (need not be normalised) up to `maxDist` world units.
 * Returns the first cell whose block satisfies `hit(block)`.
 */
export function raycastVoxels(
  origin: Vec3, dir: Vec3, maxDist: number,
  getBlock: (x: number, y: number, z: number) => number,
  hit: (block: number) => boolean,
  worldHeight = 1e9,
): VoxelHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (len < 1e-9 || !(maxDist > 0)) return null;
  const dx = dir.x / len, dy = dir.y / len, dz = dir.z / len;
  let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;
  const frac = (v: number) => v - Math.floor(v);
  let tMaxX = stepX > 0 ? (1 - frac(origin.x)) * tDeltaX : stepX < 0 ? frac(origin.x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (1 - frac(origin.y)) * tDeltaY : stepY < 0 ? frac(origin.y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (1 - frac(origin.z)) * tDeltaZ : stepZ < 0 ? frac(origin.z) * tDeltaZ : Infinity;
  let nx = 0, ny = 0, nz = 0;
  let t = 0;
  // Guard against pathological loops.
  const maxSteps = Math.ceil(maxDist * 3) + 8;
  for (let i = 0; i < maxSteps; i++) {
    if (y >= 0 && y < worldHeight) {
      const b = getBlock(x, y, z);
      if (hit(b)) {
        return { x, y, z, block: b, nx, ny, nz, dist: t, point: { x: origin.x + dx * t, y: origin.y + dy * t, z: origin.z + dz * t } };
      }
    } else if ((y >= worldHeight && stepY >= 0) || (y < 0 && stepY <= 0)) {
      return null; // left the world vertically and never coming back
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      if (t > maxDist) return null;
      x += stepX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      if (t > maxDist) return null;
      y += stepY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      t = tMaxZ;
      if (t > maxDist) return null;
      z += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }
  return null;
}

/** Intersect a ray with the horizontal plane y = planeY. Returns the distance or null. */
export function rayPlaneY(origin: Vec3, dir: Vec3, planeY: number): number | null {
  if (Math.abs(dir.y) < 1e-9) return null;
  const t = (planeY - origin.y) / dir.y;
  return t > 0 ? t : null;
}

/** Shortest distance from point p to the segment a→b. */
export function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t), p.z - (a.z + abz * t));
}
