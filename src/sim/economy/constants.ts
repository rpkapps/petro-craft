// Economy balancing constants. Exported so the UI can show the same numbers the sim uses.
import type { WorkerRole } from '../../core/types';
import { ITEMS } from '../../content/items';

// ---- Terminals & logistics ------------------------------------------------------------------------

export type TransportMode = 'truck' | 'rail' | 'marine' | 'pipeline';

export interface TerminalSpec {
  /** Daily throughput at full crew, in volume-equivalent units (bbl-eq for liquids/solids, mcf for gas). */
  capacity: number;
  /** Freight cost per volume-equivalent unit (USD), before the `transport_cost` modifier. */
  transport: number;
  mode: TransportMode;
  /** Sells into the world market (deeper liquidity: only 25% of volume counts toward local price impact). */
  worldMarket: boolean;
  /** Human-readable name of the sale channel (ledger notes, UI). */
  label: string;
}

export const TERMINALS: Record<string, TerminalSpec> = {
  truck_terminal: { capacity: 3_000, transport: 4, mode: 'truck', worldMarket: false, label: 'Truck rack' },
  rail_terminal: { capacity: 25_000, transport: 2, mode: 'rail', worldMarket: false, label: 'Rail terminal' },
  export_terminal: { capacity: 150_000, transport: 1, mode: 'marine', worldMarket: true, label: 'Marine export' },
  gas_sales_meter: { capacity: 60_000, transport: 0.08, mode: 'pipeline', worldMarket: false, label: 'Gas sales meter' },
  fpso: { capacity: 80_000, transport: 1, mode: 'marine', worldMarket: true, label: 'FPSO offload' },
};

/** Which commodities a terminal type can sell. */
export function terminalAccepts(type: string, itemId: string): boolean {
  const it = ITEMS[itemId];
  if (!it || !it.tradable) return false;
  switch (type) {
    case 'gas_sales_meter':
      return itemId === 'dry_gas' || itemId === 'natural_gas';
    case 'fpso':
      return itemId === 'crude_oil' || itemId === 'condensate';
    case 'export_terminal':
      return it.category === 'oil' || it.category === 'product';
    case 'truck_terminal':
    case 'rail_terminal':
      return (it.category === 'oil' || it.category === 'product') && itemId !== 'lng';
    default:
      return false;
  }
}

/** Tonne-denominated products occupy ~6 bbl of tanker/railcar volume. */
export const TONNE_VOLUME_BBL = 6;
export function unitVolume(itemId: string): number {
  return ITEMS[itemId]?.unit === 't' ? TONNE_VOLUME_BBL : 1;
}

/** Raw (wet) gas realises this fraction of the dry-gas price at the sales meter. */
export const RAW_GAS_FACTOR = 0.7;

/** Regional market depth (units/day) — selling a large share of this in a day depresses the price. */
export const MARKET_DEPTH: Record<string, number> = {
  crude_oil: 60_000, condensate: 25_000, natural_gas: 250_000, dry_gas: 500_000, ngl: 20_000, lpg: 18_000,
  gasoline: 35_000, diesel: 35_000, jet_fuel: 20_000, asphalt: 4_000, lubricants: 5_000, sulfur: 3_000,
  ethylene: 3_000, propylene: 3_000, polyethylene: 4_000, polypropylene: 4_000, ammonia: 4_000, methanol: 4_000, lng: 30_000,
};
/** Max price depression from dumping volume (fraction). */
export const MAX_PRICE_IMPACT = 0.3;
/** Price impact slope: fraction of price lost per 100% of market depth sold "today". */
export const PRICE_IMPACT_SLOPE = 0.2;
/** Half-life (days) of the soldToday counter. */
export const SOLD_HALF_LIFE_DAYS = 0.5;

/** Sales from the company warehouse (off-network) go by third-party truck at a small discount. */
export const WAREHOUSE_SALE_DISCOUNT = 0.05;
export const WAREHOUSE_SALE_FREIGHT = 4;

// ---- Buying ---------------------------------------------------------------------------------------

/** Discount on supplies when an operational Supply Yard ('warehouse' building) exists. */
export const SUPPLY_YARD_DISCOUNT = 0.2;
export const STACK_SIZE = 64;

/** Block shop prices (USD per block) keyed by block key. Unlisted placeable blocks cost DEFAULT_BLOCK_PRICE. */
export const BLOCK_PRICES: Record<string, number> = {
  pipe_oil: 350, pipe_gas: 400, pipe_water: 250, pipe_product: 450,
  concrete: 30, asphalt_road: 60, steel_plate: 80, steel_grate: 60, glass: 20, lamp: 150, hazard_stripe: 40,
  brick: 25, planks: 10, gravel_pad: 15, container_red: 500, container_blue: 500,
};
export const DEFAULT_BLOCK_PRICE = 20;

// ---- Hedging --------------------------------------------------------------------------------------
export const HEDGE_FEE = 0.02;
export const HEDGE_MIN_DAYS = 7;
export const HEDGE_MAX_DAYS = 180;

// ---- Contracts ------------------------------------------------------------------------------------
/** Days an offer stays on the board before it expires. */
export const OFFER_EXPIRY_DAYS = 5;
export const MAX_OFFERS = 6;
export const MAX_COMPLETED_CONTRACTS = 40;
/** Contracts a company can hold at once: base + 1 per 25 reputation. */
export const BASE_ACTIVE_CONTRACTS = 2;

// ---- Workforce ------------------------------------------------------------------------------------

export const WAGE_BASE: Record<WorkerRole, number> = {
  roughneck: 350, driller: 700, operator: 450, engineer: 900, technician: 500, geoscientist: 850, firefighter: 450, trucker: 380,
};

export const ROLE_INFO: Record<WorkerRole, { name: string; plural: string; description: string }> = {
  roughneck: { name: 'Roughneck', plural: 'Roughnecks', description: 'Floor hands who trip pipe and keep the rig turning.' },
  driller: { name: 'Driller', plural: 'Drillers', description: 'Runs the drawworks and watches the well for kicks.' },
  operator: { name: 'Operator', plural: 'Operators', description: 'Runs plants, terminals and production facilities.' },
  engineer: { name: 'Engineer', plural: 'Engineers', description: 'Process, reservoir and drilling engineering.' },
  technician: { name: 'Technician', plural: 'Technicians', description: 'Instrument, electrical and mechanical maintenance.' },
  geoscientist: { name: 'Geoscientist', plural: 'Geoscientists', description: 'Interprets seismic and logs; staffs research labs.' },
  firefighter: { name: 'Firefighter', plural: 'Firefighters', description: 'Industrial fire and rescue crews.' },
  trucker: { name: 'Trucker', plural: 'Truckers', description: 'Drives tankers and runs loading racks.' },
};

/** Market wage for a role at a skill level (USD/day, before the `wages` modifier). */
export function marketWage(role: WorkerRole, skill: number): number {
  return WAGE_BASE[role] * (0.8 + 0.1 * skill);
}

export const SIGNING_FEE_DAYS = 1;
export const SEVERANCE_DAYS = 3;
export const CANDIDATE_REFRESH_DAYS = 3;
export const HOUSING_PER_BUILDING: Record<string, number> = { field_office: 10, worker_camp: 16 };
/** Rooms rented in the nearest town — a small allowance before morale suffers. */
export const BASE_HOUSING = 4;
/** XP (worker-days on shift) needed to go from skill s to s+1 is XP_PER_SKILL × s. */
export const XP_PER_SKILL = 45;

export const STARTING_CREW: Partial<Record<WorkerRole, number>> = {
  driller: 1, roughneck: 4, operator: 2, geoscientist: 1, trucker: 1, technician: 1,
};

// ---- Research -------------------------------------------------------------------------------------
export const RESEARCH_BASE_POINTS = 2;
export const RESEARCH_LAB_POINTS = 14;
export const DISCOVERY_RESEARCH_BONUS = 12;
export const SURVEY_RESEARCH_BONUS = 4;

// ---- Finance --------------------------------------------------------------------------------------
/** Annual insurance premium as a fraction of building book value. */
export const INSURANCE_RATE_ANNUAL = 0.018;
export const PROPERTY_TAX_ANNUAL = 0.011;
/** Straight-line depreciation to salvage over this many days. */
export const DEPRECIATION_DAYS = 1825;
export const SALVAGE_FRACTION = 0.3;
/** Reserves in the ground count at this fraction of their market value. */
export const RESERVES_VALUE_FACTOR = 0.1;
/** Reserves counted per reservoir are capped at this many days of current production (PDP-style). */
export const PDP_DAYS = 1825;
export const MIN_LOAN_TERM = 30;
export const MAX_LOAN_TERM = 1095;
export const BANKRUPTCY_WARNING_DAYS = 7;
export const INSOLVENCY_THRESHOLD = -2_000_000;
export const INSOLVENCY_DAYS = 30;

// ---- Leases ---------------------------------------------------------------------------------------
export const LEASE_BASE_ONSHORE = 40_000;
export const LEASE_BASE_OFFSHORE = 180_000;
export const LEASE_RESALE_FRACTION = 0.5;
export const LEASE_MIN_ROYALTY = 0.125;
export const LEASE_MAX_ROYALTY = 0.25;
/** Parcels granted around the spawn at new game: (2r+1)² */
export const STARTING_LEASE_RADIUS = 1;

// ---- Environment ----------------------------------------------------------------------------------
export const CARBON_CREDIT_PRICE = 25;
export const ENV_NEUTRAL_SCORE = 70;
export const ENV_VIOLATION_SCORE = 30;
export const ENV_VIOLATIONS_TO_SUSPEND = 3;
export const ENV_SUSPENSION_DAYS = 5;
export const ENV_VIOLATION_COOLDOWN_DAYS = 4;
/** Vented gas above this per day (mcf) draws a fine. */
export const VENTING_FINE_THRESHOLD = 3_000;
export const VENTING_FINE_PER_MCF = 3;
/** Spills older than this (days) and not cleaned are fined daily per uncleaned bbl. */
export const SPILL_GRACE_DAYS = 3;
export const SPILL_FINE_PER_BBL = 40;
export const SPILL_FINE_MIN = 5_000;
export const AQUIFER_FINE = 250_000;

// ---- Calendar -------------------------------------------------------------------------------------
export const DAYS_PER_SEASON = 30;
export const DAYS_PER_YEAR = 120;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;
export type Season = (typeof SEASONS)[number];
