// Static tables used by the facilities simulation (derived once from the content catalogues).
import { B, BLOCKS } from '../../core/blocks';
import { BUILDINGS, type BuildingDef } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import { RECIPES } from '../../content/recipes';
import type { BuildingState, FluidCat } from '../../core/types';

export const CATS: readonly FluidCat[] = ['oil', 'gas', 'water', 'product'];
export const CAT_INDEX: Record<FluidCat, number> = { oil: 0, gas: 1, water: 2, product: 3 };

/** Pipe category index (0..3) per block id, −1 for non-network blocks (CASING never forms networks). */
export const PIPE_CAT = new Int8Array(256).fill(-1);
for (const d of BLOCKS) {
  if (d.shape === 'pipe' && d.pipe && d.pipe !== 'casing') PIPE_CAT[d.id] = CAT_INDEX[d.pipe];
}
export const PIPE_BLOCK_OF_CAT: Record<FluidCat, number> = { oil: B.PIPE_OIL, gas: B.PIPE_GAS, water: B.PIPE_WATER, product: B.PIPE_PRODUCT };

/** Network commodities per category, in a stable order. */
export const ITEMS_BY_CAT: Record<FluidCat, string[]> = { oil: [], gas: [], water: [], product: [] };
for (const it of Object.values(ITEMS)) if (it.category && (it.kind === 'fluid' || it.kind === 'product')) ITEMS_BY_CAT[it.category].push(it.id);

export function itemCat(item: string): FluidCat | undefined {
  return ITEMS[item]?.category;
}

/** Base pipeline throughput per day (before modifiers/boosters/length penalty). */
export const NETWORK_BASE_CAPACITY: Record<FluidCat, number> = { oil: 8000, gas: 40000, water: 8000, product: 6000 };
/** Fluid held in one pipe block (line pack). */
export const LINEPACK_PER_BLOCK: Record<FluidCat, number> = { oil: 12, gas: 60, water: 12, product: 12 };
/** Gas lines longer than this need a compressor station. */
export const GAS_COMPRESSION_THRESHOLD = 120;
export const GAS_UNCOMPRESSED_FACTOR = 0.3;

export const TANK_TYPES = new Set(['oil_tank_small', 'oil_tank_large', 'gas_sphere', 'water_pit']);
export const TERMINAL_TYPES = new Set(['truck_terminal', 'rail_terminal', 'export_terminal', 'gas_sales_meter']);
export const PRODUCER_TYPES = new Set(['wellhead', 'production_platform', 'fpso']);
export const OFFSHORE_HUB_TYPES = new Set(['production_platform', 'fpso']);
export const GENERATOR_TYPES = new Set(['gas_turbine_power', 'diesel_generator', 'solar_farm', 'wind_turbine']);
export const BOOSTER_TYPES: Record<string, FluidCat[]> = {
  pump_station: ['oil', 'water', 'product'],
  compressor_station: ['gas'],
};
/** Buildings whose status is 'active' whenever they are operational (services, not throughput). */
export const ALWAYS_ACTIVE = new Set([
  'field_office', 'worker_camp', 'warehouse', 'research_lab', 'maintenance_depot', 'fire_station', 'scada_center',
  'weather_station', 'helipad', 'spill_response',
]);
/** Pad material. */
export const GRAVEL_PAD_TYPES = new Set([
  'drilling_rig_land', 'drilling_rig_heavy', 'wellhead', 'frac_spread', 'water_pit', 'oil_tank_small', 'oil_tank_large',
  'gas_sphere', 'flare_stack', 'pump_station', 'disposal_well',
]);
/** Types that can explode when burning hard. Value = base blast power (radius-ish, blocks). */
export const EXPLOSIVE_TYPES: Record<string, number> = {
  gas_sphere: 9, lng_plant: 10, refinery: 8, oil_tank_small: 4, oil_tank_large: 7, gas_plant: 6, steam_cracker: 7,
};

/** Internal buffers for buildings that have no catalogue storage but need a feed buffer. */
export const INTERNAL_STORAGE: Record<string, Partial<Record<FluidCat, number>>> = {
  disposal_well: { water: 2500 },
  frac_spread: { water: 12000 },
  gas_turbine_power: { gas: 3000 },
  diesel_generator: { product: 300 },
  ccs_unit: { gas: 3000 },
  flare_stack: {},
};

/** What each consumer/terminal type accepts from networks (in addition to recipe inputs). */
export const TERMINAL_ACCEPTS: Record<string, (item: string) => boolean> = {
  truck_terminal: (i) => i !== 'lng' && isLiquidOrProduct(i),
  rail_terminal: (i) => i !== 'lng' && isLiquidOrProduct(i),
  export_terminal: (i) => isLiquidOrProduct(i),
  gas_sales_meter: (i) => i === 'dry_gas' || i === 'natural_gas',
};
function isLiquidOrProduct(i: string) {
  const c = ITEMS[i]?.category;
  return c === 'oil' || c === 'product';
}

/** Types running recipes. */
export const PROCESSING_TYPES = new Set(Object.values(RECIPES).filter((r) => r.building !== 'ccs_unit').map((r) => r.building));

export function def(b: BuildingState | string): BuildingDef {
  return BUILDINGS[typeof b === 'string' ? b : b.type];
}

/** Hourly EMA smoothing factor for a step of `minutes`. */
export function emaAlpha(minutes: number, tauMinutes = 60): number {
  return 1 - Math.exp(-minutes / tauMinutes);
}

/** Emission factors. */
export const CO2_PER_MCF_BURNED = 0.055; // t CO2 per mcf combusted
export const MCF_PER_MWH = 8.5; // gas turbine heat rate (≈ 25 MW → 5,100 mcf/day)
export const BBL_DIESEL_PER_MWH = 1.7;
export const GRID_IMPORT_PRICE = 120; // $/MWh
export const GRID_IMPORT_MAX = 5; // MW
export const GRID_EXPORT_PRICE = 55; // $/MWh for surplus generation
export const TRUCKED_DIESEL_PREMIUM = 1.5;
