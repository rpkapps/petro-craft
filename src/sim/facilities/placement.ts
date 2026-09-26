// Placement validation (tech, cost, bounds, terrain rules, overlaps, pipes in the way) and terrain levelling.
import { BUILDINGS } from '../../content/buildings';
import { TECHS } from '../../content/tech';
import { B, IS_LIQUID, IS_SOLID } from '../../core/blocks';
import { SEA_LEVEL } from '../../core/constants';
import { rotatedSize } from '../../core/buildingUtil';
import type { GameContext, Rotation } from '../../core/types';
import { GRAVEL_PAD_TYPES, PIPE_CAT } from './catalog';
import { distToFootprint, type FacilityRuntime } from './runtime';

export interface PlacementResult {
  ok: boolean;
  reason?: string;
  y: number;
  cost: number;
}

export interface ValidateOpts {
  /** Skip tech & money checks (starting buildings). */
  free?: boolean;
}

export const MAX_SLOPE = 3;
/** Coastal buildings may cut the shore down this many blocks above the deck. */
const MAX_COAST_CUT = 6;
const FRAC_WELLHEAD_RANGE = 8;
/** Soft blocks cleared freely by levelling (vegetation & snow). */
const SOFT = new Set<number>([B.TALL_GRASS, B.FLOWER_RED, B.FLOWER_YELLOW, B.DEAD_BUSH, B.REEDS, B.SEAGRASS, B.KELP, B.SNOW]);

/** Cost of building `type` now (construction_cost modifier; free in creative). */
export function buildCost(ctx: GameContext, type: string): number {
  const d = BUILDINGS[type];
  if (!d || ctx.state.meta.rules.creative) return 0;
  return Math.round(d.cost * ctx.modifier('construction_cost'));
}

interface Column {
  surf: number;
  water: number; // water depth in blocks (0 = dry)
  spill: boolean;
}

function scanColumn(ctx: GameContext, x: number, z: number): Column {
  const w = ctx.world;
  const surf = w.getSurfaceY(x, z);
  const top = w.getBlock(x, surf, z);
  let water = 0;
  if (top === B.WATER) {
    let y = surf;
    while (y < w.height && w.getBlock(x, y, z) === B.WATER) {
      water++;
      y++;
    }
  }
  return { surf, water, spill: top === B.OIL_POOL };
}

export function validatePlacement(rt: FacilityRuntime, type: string, x: number, z: number, rotation: Rotation, opts: ValidateOpts = {}): PlacementResult {
  const ctx = rt.ctx;
  const d = BUILDINGS[type];
  const fail = (reason: string, y = 0, cost = 0): PlacementResult => ({ ok: false, reason, y, cost });
  if (!d) return fail('Unknown building');
  const cost = opts.free ? 0 : buildCost(ctx, type);
  if (d.placement === 'auto') return fail(`${d.name}s are created automatically when a well is completed`, 0, cost);
  if (d.placement === 'wellhead') return fail(`${d.name} cannot be placed by hand`, 0, cost);
  const creative = ctx.state.meta.rules.creative;
  if (!opts.free && !creative && d.requiresTech && !ctx.hasTech(d.requiresTech))
    return fail(`Requires research: ${TECHS[d.requiresTech]?.name ?? d.requiresTech}`, 0, cost);
  x = Math.floor(x);
  z = Math.floor(z);
  const [w, dp, h] = rotatedSize(type, (((rotation | 0) % 4) + 4) % 4 as Rotation);
  const world = ctx.world;
  if (x < 0 || z < 0 || x + w > world.sizeX || z + dp > world.sizeZ) return fail('Outside the map', 0, cost);

  // --- terrain
  const cols: Column[] = [];
  for (let zz = z; zz < z + dp; zz++) for (let xx = x; xx < x + w; xx++) cols.push(scanColumn(ctx, xx, zz));
  let y = 0;
  let terrainError: string | undefined;
  const landSurfs: number[] = [];
  let waterCols = 0;
  let spill = false;
  for (const c of cols) {
    if (c.spill) spill = true;
    if (c.water > 0) waterCols++;
    else landSurfs.push(c.surf);
  }
  landSurfs.sort((a, b) => a - b);
  // Terrain problems are reported after the overlap check (a building standing there is the clearer reason).
  if (d.placement === 'land') {
    y = landSurfs.length ? landSurfs[landSurfs.length >> 1] : SEA_LEVEL + 1;
    const spread = landSurfs.length ? landSurfs[landSurfs.length - 1] - landSurfs[0] : 0;
    if (waterCols > 0) terrainError = 'Must be built on dry land';
    else if (spread > MAX_SLOPE) terrainError = `Ground is too steep (${spread}-block slope, max ${MAX_SLOPE})`;
  } else if (d.placement === 'water') {
    y = SEA_LEVEL + 1;
    if (waterCols < cols.length) terrainError = 'Must be placed over open water';
    const [minD, maxD0] = d.waterDepth ?? [1, 99];
    const maxD = Math.round(maxD0 * ctx.modifier('offshore_depth'));
    let lo = Infinity;
    let hi = 0;
    for (const c of cols) {
      lo = Math.min(lo, c.water);
      hi = Math.max(hi, c.water);
    }
    if (!terrainError && lo < minD) terrainError = `Water too shallow (needs ${minD}+ blocks deep)`;
    else if (!terrainError && hi > maxD) terrainError = `Water too deep (max ${maxD} blocks)`;
  } else if (d.placement === 'coast') {
    y = SEA_LEVEL + 1;
    const n = cols.length;
    if (waterCols < n * 0.15 || landSurfs.length < n * 0.15) terrainError = 'Must straddle the shoreline (both land and water)';
    else if (landSurfs[landSurfs.length - 1] > y + MAX_COAST_CUT) terrainError = 'The shore is too steep here';
  }
  if (y + h >= world.height - 1) return fail('Too high', y, cost);

  // --- overlaps with other buildings (their pad layer included)
  const bs = ctx.state.buildings;
  const seen = new Set<string>();
  for (let zz = z; zz < z + dp; zz++)
    for (let xx = x; xx < x + w; xx++)
      for (const id of rt.idsAtColumn(xx, zz)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const o = bs[id];
        if (!o) continue;
        if (y - 1 < o.y + o.size[2] && o.y - 1 < y + h) return fail(`Overlaps ${BUILDINGS[o.type]?.name ?? 'another building'}`, y, cost);
      }

  if (terrainError) return fail(terrainError, y, cost);
  if (spill) return fail('Clean up the oil spill here first', y, cost);

  // --- pipes / wellbores inside the pad + volume
  const yTop = y + h - 1;
  for (let zz = z; zz < z + dp; zz++)
    for (let xx = x; xx < x + w; xx++)
      for (let yy = y - 1; yy <= yTop; yy++) {
        const id = world.getBlock(xx, yy, zz);
        if (PIPE_CAT[id] >= 0) return fail('Pipes are in the way', y, cost);
        if (id === B.CASING) return fail('A wellbore is in the way', y, cost);
        if (id === B.STRUCTURE) return fail('Something is in the way', y, cost);
      }

  // --- special rules
  if (type === 'frac_spread') {
    let near = false;
    const cx = x + w / 2;
    const cz = z + dp / 2;
    for (const o of rt.list) {
      if (o.type !== 'wellhead') continue;
      if (distToFootprint(o, cx, cz) <= FRAC_WELLHEAD_RANGE + Math.max(w, dp) / 2) {
        near = true;
        break;
      }
    }
    if (!near) return fail(`Place next to a wellhead (within ${FRAC_WELLHEAD_RANGE} blocks)`, y, cost);
  }
  if (!opts.free && !creative && ctx.state.company.money < cost) return fail(`Not enough money ($${cost.toLocaleString('en-US')} needed)`, y, cost);
  return { ok: true, y, cost };
}

/**
 * Level terrain for a building: clear the volume (and any hill above it) to air, lay the pad at y−1 and fill
 * below it down to solid ground (dirt, stone when deep). Water columns of offshore/coast buildings are left as-is.
 */
export function levelSite(rt: FacilityRuntime, type: string, x: number, y: number, z: number, rotation: Rotation): void {
  const ctx = rt.ctx;
  const world = ctx.world;
  const d = BUILDINGS[type];
  const [w, dp, h] = rotatedSize(type, rotation);
  const pad = GRAVEL_PAD_TYPES.has(type) ? B.GRAVEL_PAD : B.CONCRETE_PAD;
  for (let zz = z; zz < z + dp; zz++)
    for (let xx = x; xx < x + w; xx++) {
      const col = scanColumn(ctx, xx, zz);
      if (d.placement === 'water' || col.water > 0) continue;
      const upper = Math.max(y + h - 1, col.surf);
      for (let yy = y; yy <= upper && yy < world.height; yy++) {
        const id = world.getBlock(xx, yy, zz);
        if (id !== B.AIR && id !== B.STRUCTURE && PIPE_CAT[id] < 0 && id !== B.CASING) world.setBlock(xx, yy, zz, B.AIR, 'system');
      }
      world.setBlock(xx, y - 1, zz, pad, 'system');
      for (let yy = y - 2, depth = 1; yy > 0; yy--, depth++) {
        const id = world.getBlock(xx, yy, zz);
        if (IS_SOLID[id] && !IS_LIQUID[id] && !SOFT.has(id)) break;
        world.setBlock(xx, yy, zz, depth <= 3 ? B.DIRT : B.STONE, 'system');
      }
    }
}
