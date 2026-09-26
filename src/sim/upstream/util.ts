// Shared helpers for the upstream modules: unit conversions, tech features, leases, building lookups
// and oilfield supply consumption.
import { PARCEL_SIZE, DIFFICULTY_SETTINGS } from '../../core/constants';
import { BUILDINGS } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import { TECHS } from '../../content/tech';
import { isOperational, buildingCenter } from '../../core/buildingUtil';
import type { BuildingState, GameContext, WellState } from '../../core/types';
import { FT_PER_BLOCK, SUPPLY_PREMIUM, SUPPLY_YARD_DISCOUNT } from './tuning';
import { accrue } from './wellData';

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth01 = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

/** True vertical depth in feet from a surface y to a block y. */
export const tvdFt = (surfaceY: number, y: number) => Math.max(0, surfaceY - y) * FT_PER_BLOCK;
/** psi → equivalent mud weight (ppg) at a TVD. */
export const psiToPpg = (psi: number, tvd: number) => (tvd > 1 ? psi / (0.052 * tvd) : 8.6);
export const ppgToPsi = (ppg: number, tvd: number) => 0.052 * ppg * tvd;

/** A feature is available when the named tech is researched, or any researched tech lists the feature. */
export function hasFeature(ctx: GameContext, techId: string, feature?: string): boolean {
  if (ctx.hasTech(techId)) return true;
  if (!feature) return false;
  for (const id of ctx.state.research.completed) if (TECHS[id]?.features?.includes(feature)) return true;
  return false;
}

export function techName(id: string): string {
  return TECHS[id]?.name ?? id;
}

export const parcelKey = (x: number, z: number) => `${Math.floor(x / PARCEL_SIZE)},${Math.floor(z / PARCEL_SIZE)}`;

export function ownsLease(ctx: GameContext, x: number, z: number, playerId: string): boolean {
  const l = ctx.state.leases[parcelKey(x, z)];
  return !!l && l.owner === playerId;
}

export function hazardRate(ctx: GameContext): number {
  return DIFFICULTY_SETTINGS[ctx.state.meta.difficulty]?.hazardRate ?? 1;
}
export const hazardsEnabled = (ctx: GameContext) => ctx.state.meta.rules.hazards !== false;

/** Horizontal distance from a point to a building's footprint centre. */
export function distTo(b: BuildingState, x: number, z: number): number {
  const c = buildingCenter(b);
  return Math.hypot(c.x - x, c.z - z);
}

/** Nearest operational building of a type within range (centre distance). */
export function nearestOperational(ctx: GameContext, type: string, x: number, z: number, range: number): BuildingState | undefined {
  let best: BuildingState | undefined;
  let bd = range;
  for (const b of Object.values(ctx.state.buildings)) {
    if (b.type !== type || !isOperational(b)) continue;
    const d = distTo(b, x, z);
    if (d <= bd) {
      bd = d;
      best = b;
    }
  }
  return best;
}

export function hasOperational(ctx: GameContext, type: string): boolean {
  for (const b of Object.values(ctx.state.buildings)) if (b.type === type && isOperational(b)) return true;
  return false;
}

/** Well surface location for a rig: footprint centre (integer block). */
export function rigWellLocation(rig: BuildingState): { x: number; z: number } {
  return { x: rig.x + Math.floor(rig.size[0] / 2), z: rig.z + Math.floor(rig.size[1] / 2) };
}

/** Set an upstream building's active/idle status (only when facilities considers it operational). */
export function setUpstreamBuildingStatus(ctx: GameContext, b: BuildingState, active: boolean, utilization: number): void {
  b.utilization = clamp(utilization, 0, 1);
  if (!isOperational(b)) return;
  if (b.status !== 'active' && b.status !== 'idle') return;
  const next = active ? 'active' : 'idle';
  if (b.status !== next) {
    const prev = b.status;
    b.status = next;
    ctx.bus.emit('building:statusChanged', { id: b.id, prev, status: next });
  }
}

// ---- Supplies -------------------------------------------------------------------------------------------

/** Unit price for emergency auto-buy of a supply item (premium, or bulk price with a supply yard). */
export function supplyPrice(ctx: GameContext, item: string): number {
  const base = ctx.state.market.prices[item] ?? ITEMS[item]?.basePrice ?? 0;
  return base * (hasOperational(ctx, 'warehouse') ? SUPPLY_YARD_DISCOUNT : SUPPLY_PREMIUM);
}

/**
 * Consume `qty` of a supply from the company warehouse; any shortfall is auto-bought (billed to the well,
 * or charged immediately when no well is given). Returns the auto-buy cost.
 */
export function consumeSupply(ctx: GameContext, item: string, qty: number, well?: WellState): number {
  if (!(qty > 0)) return 0;
  const wh = ctx.state.company.warehouse;
  const have = wh[item] ?? 0;
  const take = Math.min(have, qty);
  if (take > 0) {
    const left = have - take;
    if (left <= 1e-9) delete wh[item];
    else wh[item] = left;
  }
  const short = qty - take;
  if (short <= 0) return 0;
  const cost = short * supplyPrice(ctx, item);
  if (well) accrue(well, 'supplies', cost);
  else ctx.transact(-cost, 'supplies', `Emergency delivery: ${ITEMS[item]?.name ?? item}`);
  return cost;
}

/** Cost estimate for supplies (uses warehouse stock first). */
export function estimateSupplyCost(ctx: GameContext, item: string, qty: number): number {
  const have = ctx.state.company.warehouse[item] ?? 0;
  return Math.max(0, qty - have) * supplyPrice(ctx, item);
}

/** Storage capacity of a building for a network category (undefined = none). */
export function capacityOf(b: BuildingState, cat: 'oil' | 'gas' | 'water' | 'product'): number | undefined {
  return BUILDINGS[b.type]?.storage?.[cat];
}

export function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
export function fmtVol(v: number, unit: string): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(2)} B${unit}`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)} MM${unit}`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(0)}k ${unit}`;
  return `${Math.round(v)} ${unit}`;
}
export function fmtMoney(v: number): string {
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
}
/** Depth in metres for display: (surfaceY − y) × 40. */
export const depthM = (surfaceY: number, y: number) => Math.round(Math.max(0, surfaceY - y) * 40);

/** Offshore operations stop in hurricanes / violent storms. */
export function severeWeather(ctx: GameContext): boolean {
  const w = ctx.state.weather;
  return w.current === 'hurricane' || (w.current === 'storm' && w.intensity > 0.8);
}
