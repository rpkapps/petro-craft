// Pure path planning for pipe/road runs: an L-shaped route between two cells that follows the terrain surface
// (with vertical risers so every consecutive cell shares a face) or keeps a constant elevation. Terrain-following
// runs lie on the ground *below* vegetation (trees, cacti, plants, snow cover) instead of climbing over canopies.
import type { Vec3 } from '../core/types';
import { B, IS_LIQUID, IS_SOLID } from '../core/blocks';
import { isLeafBlock, isTrunkBlock, isVegetation } from './blockUtil';

export type BlockGetter = (x: number, y: number, z: number) => number;

export interface LinePathOptions {
  /** Run along X first, then Z (false = Z first). */
  xFirst: boolean;
  /** Keep the start elevation for every column (pipe racks). */
  constantY: boolean;
  /** Surface cell (first free y) at a column — used when following terrain. */
  surfaceY(x: number, z: number): number;
  /** Maximum number of cells returned. */
  maxCells: number;
}

/** Columns (x,z) of the L-shaped route from a to b, inclusive, without duplicates. */
export function lColumns(ax: number, az: number, bx: number, bz: number, xFirst: boolean): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const sx = Math.sign(bx - ax), sz = Math.sign(bz - az);
  if (xFirst) {
    for (let x = ax; x !== bx; x += sx) out.push({ x, z: az });
    for (let z = az; z !== bz; z += sz) out.push({ x: bx, z });
  } else {
    for (let z = az; z !== bz; z += sz) out.push({ x: ax, z });
    for (let x = ax; x !== bx; x += sx) out.push({ x, z: bz });
  }
  out.push({ x: bx, z: bz });
  return out;
}

/**
 * Cells of a run from `start` to the column of `end`. The start cell keeps its own y; other columns sit on the
 * surface (or at start.y with constantY). Height changes insert vertical risers in the lower column.
 * Returns `truncated` when the route was cut at maxCells.
 */
export function planLine(start: Vec3, end: Vec3, o: LinePathOptions): { cells: Vec3[]; truncated: boolean } {
  const cols = lColumns(start.x, start.z, end.x, end.z, o.xFirst);
  const cells: Vec3[] = [];
  const seen = new Set<string>();
  const push = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`;
    if (seen.has(k)) return true;
    if (cells.length >= o.maxCells) return false;
    seen.add(k);
    cells.push({ x, y, z });
    return true;
  };
  let prevY = start.y;
  let prev: { x: number; z: number } | null = null;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const y = i === 0 || o.constantY ? start.y : o.surfaceY(c.x, c.z);
    if (prev && y !== prevY) {
      if (y > prevY) {
        // Rise in the previous (lower) column up to the new height.
        for (let yy = prevY + 1; yy <= y; yy++) if (!push(prev.x, yy, prev.z)) return { cells, truncated: true };
      } else {
        // Drop: riser in this (lower) column from the previous height down.
        for (let yy = prevY; yy > y; yy--) if (!push(c.x, yy, c.z)) return { cells, truncated: true };
      }
    }
    if (!push(c.x, y, c.z)) return { cells, truncated: true };
    prev = c;
    prevY = y;
  }
  return { cells, truncated: false };
}

/**
 * First free cell above the *ground* of a column, looking down through vegetation, air gaps under canopies and
 * liquids. `surfaceY` is the world's first free y (which counts tree tops as surface).
 */
export function groundYBelowVegetation(get: BlockGetter, surfaceY: number, x: number, z: number): number {
  let y = surfaceY;
  while (y > 1) {
    const b = get(x, y - 1, z);
    if (b !== B.AIR && IS_LIQUID[b] !== 1 && !isVegetation(b)) break;
    y--;
  }
  return y;
}

const N6: readonly [number, number, number][] = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]];

/**
 * Whether a line cell would be held up by something: solid non-vegetation ground below it, or a face-adjacent
 * block of the same line type (continuing a run / rack) or a building structure.
 */
export function isLineCellSupported(get: BlockGetter, c: Vec3, block: number): boolean {
  const below = get(c.x, c.y - 1, c.z);
  if (IS_SOLID[below] === 1 && !isVegetation(below)) return true;
  for (const [dx, dy, dz] of N6) {
    const n = get(c.x + dx, c.y + dy, c.z + dz);
    if (n === block || n === B.STRUCTURE) return true;
  }
  return false;
}

/**
 * Anchor for a terrain-following run: an unsupported cell (e.g. clicked on a canopy or in mid-air beside a trunk)
 * drops to the ground of its column so the run never starts floating. Supported cells are kept as-is.
 */
export function anchorLineCell(get: BlockGetter, surfaceY: number, c: Vec3, block: number): Vec3 {
  if (isLineCellSupported(get, c, block)) return c;
  const g = groundYBelowVegetation(get, surfaceY, c.x, c.z);
  return g < c.y ? { x: c.x, y: g, z: c.z } : c;
}

const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;

/**
 * Extra cells to clear when a line run cuts through trees, so nothing is left floating: the trunk (or cactus)
 * stacked above every trunk cell on the path, unsupported branch logs, and the canopy leaves belonging to those
 * trees. A leaf is kept when another (untouched) trunk is at least as close — neighbouring trees keep their
 * crowns. Path cells themselves are not included (the line block replaces them). At most `maxCells` are returned.
 */
export function treeClearance(get: BlockGetter, path: readonly Vec3[], maxCells = 1500): Vec3[] {
  const onPath = new Set(path.map((c) => cellKey(c.x, c.y, c.z)));
  /** Log cells of the trees being cut (removed ones + stumps left under the run). */
  const own = new Set<string>();
  const removedLogs: Vec3[] = [];
  const out: Vec3[] = [];
  const remove = (x: number, y: number, z: number): boolean => {
    const k = cellKey(x, y, z);
    if (own.has(k)) return true;
    own.add(k);
    removedLogs.push({ x, y, z });
    if (!onPath.has(k)) {
      if (out.length >= maxCells) return false;
      out.push({ x, y, z });
    }
    return true;
  };
  for (const c of path) {
    if (!isTrunkBlock(get(c.x, c.y, c.z)) || own.has(cellKey(c.x, c.y, c.z))) continue;
    remove(c.x, c.y, c.z);
    for (let y = c.y + 1; y < c.y + 48 && isTrunkBlock(get(c.x, y, c.z)); y++) if (!remove(c.x, y, c.z)) return out;
    // The stump below the run stays but still belongs to this tree (its canopy may be cleared).
    for (let y = c.y - 1; y > c.y - 48 && isTrunkBlock(get(c.x, y, c.z)); y--) own.add(cellKey(c.x, y, c.z));
  }
  if (removedLogs.length === 0) return out;

  // Branches: logs beside a removed trunk that hang in the air (another tree's trunk stands on something).
  for (let i = 0; i < removedLogs.length; i++) {
    const t = removedLogs[i];
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const x = t.x + dx, z = t.z + dz;
      if (own.has(cellKey(x, t.y, z)) || !isTrunkBlock(get(x, t.y, z))) continue;
      const below = get(x, t.y - 1, z);
      if (below === B.AIR || isLeafBlock(below)) if (!remove(x, t.y, z)) return out;
    }
  }

  // Canopy flood fill from the removed logs through leaves.
  const cols = new Map<string, { x: number; z: number; y0: number; y1: number }>();
  for (const t of removedLogs) {
    const k = `${t.x},${t.z}`;
    const c = cols.get(k);
    if (!c) cols.set(k, { x: t.x, z: t.z, y0: t.y, y1: t.y });
    else {
      c.y0 = Math.min(c.y0, t.y);
      c.y1 = Math.max(c.y1, t.y);
    }
  }
  const trunkCols = [...cols.values()];
  const REACH = 3;
  const belongs = (x: number, y: number, z: number): boolean => {
    let d1 = Infinity;
    for (const c of trunkCols) {
      if (y < c.y0 - 1 || y > c.y1 + 3) continue;
      d1 = Math.min(d1, Math.max(Math.abs(c.x - x), Math.abs(c.z - z)));
    }
    if (d1 > REACH) return false;
    for (let dz = -d1; dz <= d1; dz++)
      for (let dx = -d1; dx <= d1; dx++)
        for (let yy = y - 6; yy <= y + 1; yy++) {
          if (isTrunkBlock(get(x + dx, yy, z + dz)) && !own.has(cellKey(x + dx, yy, z + dz))) return false;
        }
    return true;
  };
  const visited = new Set<string>();
  const queue: Vec3[] = removedLogs.slice();
  for (let qi = 0; qi < queue.length; qi++) {
    const q = queue[qi];
    for (const [dx, dy, dz] of N6) {
      const x = q.x + dx, y = q.y + dy, z = q.z + dz;
      const k = cellKey(x, y, z);
      if (visited.has(k) || own.has(k)) continue;
      visited.add(k);
      if (!isLeafBlock(get(x, y, z)) || !belongs(x, y, z)) continue;
      if (!onPath.has(k)) {
        if (out.length >= maxCells) return out;
        out.push({ x, y, z });
      }
      queue.push({ x, y, z });
    }
  }
  return out;
}
