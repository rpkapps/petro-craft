// Read-only helpers over GameState used by several UI components.
import { BUILDINGS, type BuildingDef, type WorkerRole } from '../content/buildings';
import { ITEMS, TRADABLE_IDS } from '../content/items';
import { TECHS } from '../content/tech';
import { RIG_TYPES } from '../core/buildingUtil';
import type { BuildingState, GameContext, GameState, PlayerState, WellState } from '../core/types';

export const ROLES: WorkerRole[] = ['roughneck', 'driller', 'operator', 'engineer', 'technician', 'geoscientist', 'firefighter', 'trucker'];
export const ROLE_NAMES: Record<WorkerRole, string> = {
  roughneck: 'Roughneck', driller: 'Driller', operator: 'Operator', engineer: 'Engineer', technician: 'Technician',
  geoscientist: 'Geoscientist', firefighter: 'Firefighter', trucker: 'Trucker',
};

export function localPlayer(ctx: GameContext): PlayerState | undefined {
  return ctx.state.players[ctx.localPlayerId];
}

export function isRig(type: string) {
  return RIG_TYPES.has(type);
}

/** "Storage Tank #2" — numbered by creation order among buildings of the same type. */
const nameCache = new WeakMap<GameState, { n: number; names: Map<string, string> }>();
export function buildingName(state: GameState, b: BuildingState | undefined): string {
  if (!b) return 'Unknown';
  const count = Object.keys(state.buildings).length;
  let c = nameCache.get(state);
  if (!c || c.n !== count) {
    const byType = new Map<string, BuildingState[]>();
    for (const x of Object.values(state.buildings)) {
      const arr = byType.get(x.type) ?? [];
      arr.push(x);
      byType.set(x.type, arr);
    }
    const names = new Map<string, string>();
    for (const [type, arr] of byType) {
      arr.sort((a, bb) => idNum(a.id) - idNum(bb.id));
      const def = BUILDINGS[type];
      arr.forEach((x, i) => names.set(x.id, arr.length > 1 || type === 'wellhead' ? `${def?.name ?? type} #${i + 1}` : def?.name ?? type));
    }
    c = { n: count, names };
    nameCache.set(state, c);
  }
  if (b.type === 'wellhead' && b.wellId && state.wells[b.wellId]) return `${state.wells[b.wellId].name} Wellhead`;
  return c.names.get(b.id) ?? BUILDINGS[b.type]?.name ?? b.type;
}
function idNum(id: string) {
  const n = parseInt(id.replace(/^[a-z]+/i, ''), 36);
  return Number.isFinite(n) ? n : 0;
}

export function buildingCenter(b: BuildingState) {
  return { x: b.x + b.size[0] / 2, y: b.y, z: b.z + b.size[1] / 2 };
}

/** Is the building type unlocked by research? */
export function isUnlocked(state: GameState, def: BuildingDef): boolean {
  return !def.requiresTech || state.research.completed.includes(def.requiresTech) || state.meta.rules.creative;
}

export function techName(id: string | undefined): string {
  return (id && TECHS[id]?.name) || id || '';
}

export type TechStatus = 'done' | 'current' | 'queued' | 'available' | 'locked';
export function techStatus(state: GameState, id: string): TechStatus {
  const r = state.research;
  if (r.completed.includes(id)) return 'done';
  if (r.current === id) return 'current';
  if (r.queue.includes(id)) return 'queued';
  const t = TECHS[id];
  if (t && t.requires.every((q) => r.completed.includes(q))) return 'available';
  return 'locked';
}

/** Capacity for an item category in a building (from def.storage). */
export function storageCap(b: BuildingState, category: 'oil' | 'gas' | 'water' | 'product', ctx?: GameContext): number {
  const base = BUILDINGS[b.type]?.storage?.[category] ?? 0;
  return base * (ctx ? ctx.modifier('storage_capacity') : 1);
}

/** Total quantity of a commodity held across the warehouse, building storage and pipe linepack. */
export function commodityHoldings(state: GameState, id: string): { total: number; warehouse: number; storage: number; pipes: number } {
  const warehouse = state.company.warehouse[id] ?? 0;
  let storage = 0;
  for (const b of Object.values(state.buildings)) storage += b.storage[id] ?? 0;
  let pipes = 0;
  for (const n of Object.values(state.networks)) pipes += n.linepack[id] ?? 0;
  return { total: warehouse + storage + pipes, warehouse, storage, pipes };
}

export const MARKET_IDS = TRADABLE_IDS;
export const HEADLINE_COMMODITIES = ['crude_oil', 'dry_gas', 'gasoline'];

/** Price change vs previous day (fraction). */
export function priceChange(state: GameState, id: string): number {
  const hist = state.market.history[id] ?? [];
  const cur = state.market.prices[id] ?? ITEMS[id]?.basePrice ?? 0;
  const prev = hist.length >= 2 ? hist[hist.length - 2] : hist.length === 1 ? hist[0] : cur;
  if (!prev) return 0;
  return (cur - prev) / Math.abs(prev);
}

export function priceOf(state: GameState, id: string): number {
  return state.market.prices[id] ?? ITEMS[id]?.basePrice ?? 0;
}

/** Crew requirement vs assignment across all buildings. */
export function crewSummary(state: GameState): Record<WorkerRole, { required: number; assigned: number; employed: number }> {
  const out = Object.fromEntries(ROLES.map((r) => [r, { required: 0, assigned: 0, employed: 0 }])) as Record<WorkerRole, { required: number; assigned: number; employed: number }>;
  for (const b of Object.values(state.buildings)) {
    const def = BUILDINGS[b.type];
    if (!def || b.constructionProgress < 1) continue;
    for (const [role, n] of Object.entries(def.crew) as [WorkerRole, number][]) out[role].required += n ?? 0;
  }
  for (const w of state.workforce.workers) {
    out[w.role].employed++;
    if (w.assignedTo) out[w.role].assigned++;
  }
  return out;
}

/** Workers of a role assigned to a building. */
export function assignedOfRole(state: GameState, b: BuildingState, role: WorkerRole): number {
  let n = 0;
  for (const wid of b.workers) {
    const w = state.workforce.workers.find((x) => x.id === wid);
    if (w && w.role === role) n++;
  }
  return n;
}

export function wellTvd(w: WellState): number {
  return Math.max(0, w.surfaceY - w.currentY);
}

export function wellPlannedTvd(w: WellState): number {
  return Math.max(0, w.surfaceY - w.plan.targetY);
}

/** Wells considered "alive" for dashboards. */
export function activeWellStatuses(): Set<string> {
  return new Set(['drilling', 'tripping', 'casing', 'kick', 'blowout', 'drilled', 'completing', 'fracking', 'producing', 'injecting', 'shut_in']);
}

/** Most recent N values of a series, padded if shorter. */
export function tail<T>(arr: readonly T[] | undefined, n: number): T[] {
  if (!arr) return [];
  return arr.slice(Math.max(0, arr.length - n));
}
