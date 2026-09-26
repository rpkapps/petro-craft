// Storage roles & capacities: which items in a building's storage are outputs (to be piped away),
// inputs (filled by networks) or buffers (tanks), and how much room each category has.
import { BUILDINGS } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import { RECIPES, defaultRecipeId, type Recipe } from '../../content/recipes';
import type { BuildingState, FluidCat, GameContext } from '../../core/types';
import { INTERNAL_STORAGE, ITEMS_BY_CAT, PROCESSING_TYPES, TANK_TYPES, TERMINAL_ACCEPTS } from './catalog';

/**
 * Sink priority tiers (lower = served first). Terminals are market exits with effectively unlimited demand, so
 * they are served after the finite internal needs (plant feed, generator fuel, injection/disposal); tanks fill
 * only when terminals are full, and tanks discharge to tiers 1–4.
 */
export const TIER_PLANT = 1;
export const TIER_FUEL = 2;
export const TIER_INJECT = 3;
export const TIER_TERMINAL = 4;
export const TIER_TANK = 5;
export const TIER_FLARE = 6;

/** Source kinds. */
export const SRC_PRODUCER = 0; // wellheads, plant outputs, CCS — push out, may flare
export const SRC_TANK = 1; // tanks: discharge only to tiers 1–4
export const SRC_HUB = 2; // offshore platforms/FPSO gas: producers that also buffer
export const SRC_LINEPACK = 3;

/** Storage capacity of a building for a category (catalogue or internal buffer × storage_capacity modifier). */
export function capacityOf(ctx: GameContext, b: BuildingState, cat: FluidCat): number {
  const d = BUILDINGS[b.type];
  const base = d?.storage?.[cat] ?? INTERNAL_STORAGE[b.type]?.[cat] ?? 0;
  if (base <= 0) return 0;
  return b.type === 'wellhead' ? base : base * ctx.modifier('storage_capacity');
}

/** Total stored in a category. */
export function usedOf(b: BuildingState, cat: FluidCat): number {
  let t = 0;
  const items = ITEMS_BY_CAT[cat];
  for (let i = 0; i < items.length; i++) {
    const v = b.storage[items[i]];
    if (v) t += v;
  }
  return t;
}

/** Fill fraction over all categories with capacity. */
export function fillFraction(ctx: GameContext, b: BuildingState): number {
  let cap = 0;
  let used = 0;
  for (const cat of ['oil', 'gas', 'water', 'product'] as FluidCat[]) {
    const c = capacityOf(ctx, b, cat);
    if (c <= 0) continue;
    cap += c;
    used += usedOf(b, cat);
  }
  return cap > 0 ? Math.min(1, used / cap) : 0;
}

/** Current recipe for a processing building (repairs a missing/invalid recipe id). */
export function recipeOf(b: BuildingState): Recipe | undefined {
  if (!PROCESSING_TYPES.has(b.type) && b.type !== 'ccs_unit') return undefined;
  let r = b.recipeId ? RECIPES[b.recipeId] : undefined;
  if (!r || r.building !== b.type) {
    const id = defaultRecipeId(b.type);
    if (!id) return undefined;
    b.recipeId = id;
    r = RECIPES[id];
  }
  return r;
}

/** Items a wellhead accepts as injection feed, by well purpose. */
function injectorAccepts(ctx: GameContext, b: BuildingState, item: string): boolean {
  const w = b.wellId ? ctx.state.wells[b.wellId] : undefined;
  if (!w) return false;
  switch (w.purpose) {
    case 'injector_water':
      return item === 'produced_water' || item === 'fresh_water';
    case 'disposal':
      return item === 'produced_water';
    case 'injector_gas':
      return item === 'natural_gas' || item === 'dry_gas';
    case 'injector_co2':
      return item === 'co2';
    default:
      return false;
  }
}

export interface SinkSpec {
  tier: number;
  /** Max additional units of this item accepted (item-specific cap; the category room is applied separately). */
  cap: number;
}

const NO_SINK: SinkSpec = { tier: 0, cap: 0 };
const scratch: SinkSpec = { tier: 0, cap: 0 };

/**
 * How a building accepts `item` from a network (returns a shared scratch object — copy fields immediately).
 * `cap` ≤ 0 means it does not accept the item.
 */
export function sinkSpec(ctx: GameContext, b: BuildingState, item: string, cat: FluidCat): SinkSpec {
  const t = b.type;
  const cur = b.storage[item] ?? 0;
  // Processing plants: recipe inputs, buffered up to ~1 day of feed and a share of the category tank.
  if (PROCESSING_TYPES.has(t)) {
    const r = recipeOf(b);
    const rate = r?.inputs[item];
    if (!r || !rate) return NO_SINK;
    const capCat = capacityOf(ctx, b, cat);
    let hasOutInCat = false;
    for (const o in r.outputs) if (ITEMS[o]?.category === cat) hasOutInCat = true;
    const share = hasOutInCat ? 0.5 : 0.95;
    scratch.tier = t === 'water_treatment' ? TIER_INJECT : TIER_PLANT;
    scratch.cap = Math.min(rate * 1.0, capCat * share) - cur;
    return scratch;
  }
  const accept = TERMINAL_ACCEPTS[t];
  if (accept) {
    if (!accept(item)) return NO_SINK;
    const acc = b.config.accept;
    if (acc === 'oil' && cat !== 'oil') return NO_SINK;
    if (acc === 'product' && cat !== 'product') return NO_SINK;
    if (t === 'gas_sales_meter' && item === 'natural_gas' && b.config.acceptRaw === false) return NO_SINK;
    scratch.tier = TIER_TERMINAL;
    scratch.cap = Infinity;
    return scratch;
  }
  switch (t) {
    case 'fpso':
      if (cat === 'oil') {
        scratch.tier = TIER_TERMINAL;
        scratch.cap = Infinity;
        return scratch;
      }
      if (item === 'natural_gas' || item === 'dry_gas') {
        scratch.tier = TIER_TANK;
        scratch.cap = Infinity;
        return scratch;
      }
      return NO_SINK;
    case 'production_platform':
      if (item === 'fresh_water' || item === 'co2') return NO_SINK;
      scratch.tier = TIER_TANK;
      scratch.cap = Infinity;
      return scratch;
    case 'gas_turbine_power':
      if (item !== 'dry_gas' && item !== 'natural_gas') return NO_SINK;
      scratch.tier = TIER_FUEL;
      scratch.cap = Infinity;
      return scratch;
    case 'diesel_generator':
      if (item !== 'diesel') return NO_SINK;
      scratch.tier = TIER_FUEL;
      scratch.cap = Infinity;
      return scratch;
    case 'wellhead':
      if (!injectorAccepts(ctx, b, item)) return NO_SINK;
      scratch.tier = TIER_INJECT;
      scratch.cap = Infinity;
      return scratch;
    case 'frac_spread':
      if (item !== 'fresh_water' && item !== 'produced_water') return NO_SINK;
      scratch.tier = TIER_INJECT;
      scratch.cap = Infinity;
      return scratch;
    case 'disposal_well':
      if (item !== 'produced_water') return NO_SINK;
      scratch.tier = TIER_INJECT;
      scratch.cap = Infinity;
      return scratch;
    case 'flare_stack':
      if (item !== 'natural_gas') return NO_SINK;
      scratch.tier = TIER_FLARE;
      scratch.cap = Infinity; // limited by FLARE_CAPACITY in the flow engine
      return scratch;
  }
  if (TANK_TYPES.has(t)) {
    if (b.config.fill === false) return NO_SINK;
    scratch.tier = TIER_TANK;
    scratch.cap = Infinity;
    return scratch;
  }
  return NO_SINK;
}

/** Source kind of an item in a building's storage, or −1 when it must stay (inputs, terminal stock). */
export function sourceKind(ctx: GameContext, b: BuildingState, item: string, cat: FluidCat): number {
  const t = b.type;
  if (TANK_TYPES.has(t)) return b.config.discharge === false ? -1 : SRC_TANK;
  if (TERMINAL_ACCEPTS[t]) return -1;
  if (t === 'fpso') return cat === 'oil' ? -1 : SRC_HUB;
  if (t === 'production_platform') return SRC_HUB;
  if (t === 'wellhead') return injectorAccepts(ctx, b, item) ? -1 : SRC_PRODUCER;
  if (t === 'gas_turbine_power') return item === 'dry_gas' || item === 'natural_gas' ? -1 : SRC_PRODUCER;
  if (t === 'diesel_generator') return item === 'diesel' ? -1 : SRC_PRODUCER;
  if (t === 'frac_spread' || t === 'disposal_well') return -1;
  if (PROCESSING_TYPES.has(t)) {
    const r = recipeOf(b);
    return r && r.inputs[item] ? -1 : SRC_PRODUCER;
  }
  if (t === 'ccs_unit') return SRC_PRODUCER;
  // Anything else holding stock (e.g. leftovers) drains out.
  return SRC_PRODUCER;
}

/** Add to storage respecting nothing (callers check room). */
export function addStorage(b: BuildingState, item: string, qty: number): void {
  if (qty === 0) return;
  const v = (b.storage[item] ?? 0) + qty;
  if (v <= 1e-6) delete b.storage[item];
  else b.storage[item] = v;
}

/** Remove up to qty; returns removed amount. */
export function takeStorage(b: BuildingState, item: string, qty: number): number {
  const have = b.storage[item] ?? 0;
  const t = Math.min(have, qty);
  if (t <= 0) return 0;
  const v = have - t;
  if (v <= 1e-6) delete b.storage[item];
  else b.storage[item] = v;
  return t;
}
