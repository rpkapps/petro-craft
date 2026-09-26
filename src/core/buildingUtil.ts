// Shared building helpers used by several systems (construction, upstream, economy, render, player).
import { B } from './blocks';
import { BUILDINGS } from '../content/buildings';
import type { BuildingState, GameContext, GameState, Rotation, IWorld } from './types';

/** Buildings whose 'active'/'idle' status is driven by the upstream (drilling/production) systems. */
export const UPSTREAM_TYPES = new Set(['drilling_rig_land', 'drilling_rig_heavy', 'jackup_rig', 'semi_sub_rig', 'frac_spread', 'wellhead']);
export const RIG_TYPES = new Set(['drilling_rig_land', 'drilling_rig_heavy', 'jackup_rig', 'semi_sub_rig']);

/** Footprint [w, d, h] after rotation. */
export function rotatedSize(type: string, rotation: Rotation): [number, number, number] {
  const [w, d, h] = BUILDINGS[type].size;
  return rotation % 2 === 1 ? [d, w, h] : [w, d, h];
}

/** Create a BuildingState object (does NOT insert into state or write blocks). */
export function createBuildingState(
  ctx: GameContext, type: string, x: number, y: number, z: number, rotation: Rotation,
  opts: { prebuilt?: boolean; owner?: string } = {},
): BuildingState {
  const s = ctx.state;
  return {
    id: ctx.newId('b'), type, x, y, z, rotation, size: rotatedSize(type, rotation),
    status: opts.prebuilt ? 'idle' : 'constructing', enabled: true, constructionProgress: opts.prebuilt ? 1 : 0,
    condition: 100, fire: 0, builtDay: s.time.day, lastMaintenanceDay: s.time.day, storage: {}, throttle: 1,
    utilization: 0, io: {}, workers: [], config: {}, owner: opts.owner ?? ctx.localPlayerId, data: {},
  };
}

/** Insert a building into state, write its structure occupancy, and emit 'building:placed'. */
export function addBuilding(ctx: GameContext, b: BuildingState): BuildingState {
  ctx.state.buildings[b.id] = b;
  writeStructure(ctx.world, b);
  ctx.bus.emit('building:placed', { id: b.id });
  if (b.constructionProgress >= 1) ctx.bus.emit('building:completed', { id: b.id });
  return b;
}

/** Remove a building from state, clear its occupancy (re-writing overlapping buildings), emit event. */
export function removeBuilding(ctx: GameContext, id: string): void {
  const b = ctx.state.buildings[id];
  if (!b) return;
  delete ctx.state.buildings[id];
  clearStructure(ctx.world, b);
  for (const o of Object.values(ctx.state.buildings)) if (overlaps(o, b)) writeStructure(ctx.world, o);
  ctx.bus.emit('building:removed', { id, type: b.type, x: b.x, y: b.y, z: b.z });
}

/** Fill the building volume with STRUCTURE blocks (only replacing air/liquids/plants/structure). */
export function writeStructure(world: IWorld, b: BuildingState): void {
  const [w, d, h] = b.size;
  for (let y = b.y; y < b.y + h; y++)
    for (let z = b.z; z < b.z + d; z++)
      for (let x = b.x; x < b.x + w; x++) {
        const cur = world.getBlock(x, y, z);
        if (cur === B.AIR || cur === B.WATER || cur === B.TALL_GRASS || cur === B.FLOWER_RED || cur === B.FLOWER_YELLOW || cur === B.DEAD_BUSH || cur === B.SEAGRASS || cur === B.KELP || cur === B.REEDS || cur === B.SNOW)
          world.setBlock(x, y, z, B.STRUCTURE, 'system');
      }
}

/** Replace STRUCTURE blocks in the building volume with air (or water below sea level for offshore). */
export function clearStructure(world: IWorld, b: BuildingState, seaLevel = 62): void {
  const [w, d, h] = b.size;
  const offshore = BUILDINGS[b.type]?.placement === 'water' || BUILDINGS[b.type]?.placement === 'coast';
  for (let y = b.y; y < b.y + h; y++)
    for (let z = b.z; z < b.z + d; z++)
      for (let x = b.x; x < b.x + w; x++)
        if (world.getBlock(x, y, z) === B.STRUCTURE) world.setBlock(x, y, z, offshore && y <= seaLevel ? B.WATER : B.AIR, 'system');
}

export function overlaps(a: BuildingState, b: BuildingState): boolean {
  return a.x < b.x + b.size[0] && b.x < a.x + a.size[0] && a.z < b.z + b.size[1] && b.z < a.z + a.size[1] && a.y < b.y + b.size[2] && b.y < a.y + a.size[2];
}

export function containsPoint(b: BuildingState, x: number, y: number, z: number, pad = 0): boolean {
  return x >= b.x - pad && x < b.x + b.size[0] + pad && z >= b.z - pad && z < b.z + b.size[1] + pad && y >= b.y - pad && y < b.y + b.size[2] + pad;
}

/** Smallest building containing the block (smaller wins so wellheads inside rigs are pickable). */
export function findBuildingAt(state: GameState, x: number, y: number, z: number): BuildingState | undefined {
  let best: BuildingState | undefined;
  let bestVol = Infinity;
  for (const b of Object.values(state.buildings)) {
    if (!containsPoint(b, x, y, z)) continue;
    const v = b.size[0] * b.size[1] * b.size[2];
    if (v < bestVol) {
      best = b;
      bestVol = v;
    }
  }
  return best;
}

/** Centre of a building footprint (block coords, floating). */
export function buildingCenter(b: BuildingState): { x: number; y: number; z: number } {
  return { x: b.x + b.size[0] / 2, y: b.y, z: b.z + b.size[1] / 2 };
}

/** Constructed, enabled and not broken/burning/destroyed. */
export function isOperational(b: BuildingState): boolean {
  return b.constructionProgress >= 1 && b.enabled && b.status !== 'broken' && b.status !== 'fire' && b.status !== 'destroyed';
}

/**
 * Crew efficiency 0..1.25: for each required role, assigned/required (skill adds up to +25%).
 * Returns 1 when the building needs no crew.
 */
export function crewFactor(state: GameState, b: BuildingState): number {
  const def = BUILDINGS[b.type];
  const req = Object.entries(def?.crew ?? {}) as [string, number][];
  if (req.length === 0) return 1;
  const byId = new Map(state.workforce.workers.map((w) => [w.id, w]));
  let f = Infinity;
  for (const [role, n] of req) {
    if (!n) continue;
    let have = 0;
    let skill = 0;
    for (const wid of b.workers) {
      const w = byId.get(wid);
      if (w && w.role === role && !(w.injured && w.injured > state.time.day)) {
        have++;
        skill += w.skill;
      }
    }
    const ratio = Math.min(1, have / n);
    const bonus = have > 0 ? ((skill / have - 1) / 4) * 0.25 : 0;
    f = Math.min(f, ratio * (1 + bonus));
  }
  return f === Infinity ? 1 : f;
}

/** Sum of a building's storage for items in a fluid category (uses ITEMS categories). */
export function storageUsed(b: BuildingState, items: string[]): number {
  let t = 0;
  for (const i of items) t += b.storage[i] ?? 0;
  return t;
}
