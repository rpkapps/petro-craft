// Pure path planning for pipe/road runs: an L-shaped route between two cells that follows the terrain surface
// (with vertical risers so every consecutive cell shares a face) or keeps a constant elevation.
import type { Vec3 } from '../core/types';

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
