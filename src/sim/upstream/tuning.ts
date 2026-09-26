// Upstream tuning numbers. Everything gameplay-relevant lives here so balancing is one-stop.
// Units: blocks (1 block = 40 m), game hours / days, psi, ppg, bbl, mcf, USD.
import { FEET_PER_METER, METERS_PER_BLOCK } from '../../core/constants';

export const FT_PER_BLOCK = METERS_PER_BLOCK * FEET_PER_METER; // ≈ 131.2 ft
/** Normal (hydrostatic) pore-pressure gradient: 0.465 psi/ft ≈ 8.94 ppg. */
export const HYDROSTATIC_PSI_FT = 0.465;
export const MUD_MIN_PPG = 8.4;
export const MUD_MAX_PPG = 18;

// ---- Rigs --------------------------------------------------------------------------------------
export interface RigSpec {
  /** Base rate of penetration in blocks per game hour in medium rock (hardness 1). */
  rop: number;
  /** Max true vertical depth below the rig floor (blocks) before the max_depth modifier. */
  maxDepth: number;
  /** Spud / mobilisation charge. */
  mobilisation: number;
  /** Spread cost (rig day-rate + services) per day while the rig is working. */
  spreadPerDay: number;
  offshore: boolean;
  /** Tripping time per block of hole depth (hours). */
  tripHoursPerBlock: number;
}
export const RIG_SPECS: Record<string, RigSpec> = {
  drilling_rig_land: { rop: 2.5, maxDepth: 70, mobilisation: 110_000, spreadPerDay: 115_000, offshore: false, tripHoursPerBlock: 0.055 },
  drilling_rig_heavy: { rop: 3.6, maxDepth: 110, mobilisation: 200_000, spreadPerDay: 190_000, offshore: false, tripHoursPerBlock: 0.04 },
  jackup_rig: { rop: 3.0, maxDepth: 100, mobilisation: 1_200_000, spreadPerDay: 420_000, offshore: true, tripHoursPerBlock: 0.05 },
  semi_sub_rig: { rop: 3.3, maxDepth: 125, mobilisation: 3_000_000, spreadPerDay: 850_000, offshore: true, tripHoursPerBlock: 0.05 },
};
/** Fraction of the spread rate charged while a rig is on standby (no crew / waiting on weather). */
export const STANDBY_SPREAD = 0.3;
/** Max lateral (horizontal) length in blocks before the max_lateral modifier. */
export const MAX_LATERAL_BLOCKS = 25;
/** Directional build rate: degrees of inclination per block of measured depth (≈ 5.6°/30 m, medium radius). */
export const BUILD_RATE_DEG_PER_BLOCK = 7.5;
export const BUILD_RADIUS = 180 / (Math.PI * BUILD_RATE_DEG_PER_BLOCK); // ≈ 7.6 blocks

// ---- Bits, mud & consumables --------------------------------------------------------------------
/** Blocks a bit lasts in hardness-1 rock (× bit_life). */
export const BIT_LIFE_BLOCKS = 42;
export const BIT_TRIP_THRESHOLD = 10; // % condition
export const MUD_PER_BLOCK = 55; // bbl of mud built/lost per block drilled
export const MUD_PER_HOUR = 3; // bbl/hour circulating losses
export const MUD_INITIAL = 700; // bbl to fill the pits at spud
export const LOST_CIRC_MUD_PER_HOUR = 70;
export const BARITE_PER_BLOCK_PER_PPG = 1.2; // t barite per block per ppg above 9.5
export const PIPE_WEAR_PER_BLOCK = 0.22; // drill-pipe joints per block × hardness
export const CASING_JOINTS_PER_BLOCK = 2; // game-scale joints per block of string
export const CEMENT_SACKS_PER_BLOCK = 110;
export const CASING_HOURS_BASE = 2;
export const CASING_HOURS_PER_BLOCK = 0.1;
export const SUPPLY_PREMIUM = 1.3; // emergency delivery when the warehouse is short
export const SUPPLY_YARD_DISCOUNT = 0.8; // bulk price when an operational supply yard exists

// ---- Well control --------------------------------------------------------------------------------
export const KICK_UNATTENDED_HOURS = 6;
export const KICK_METHODS = {
  drillers: { hours: 3, cost: 60_000, margin: 0.3, label: "Driller's method" },
  wait_weight: { hours: 8, cost: 110_000, margin: 0.5, label: 'Wait & weight' },
  bullhead: { hours: 2, cost: 45_000, margin: 0.4, label: 'Bullheading' },
} as const;
export const CAP_METHODS = {
  cap: { days: 4, cost: 2_000_000, fireStationDays: 2, fireStationCost: 1_500_000, label: 'Capping stack' },
  relief_well: { days: 9, cost: 1_200_000, fireStationDays: 9, fireStationCost: 1_200_000, label: 'Relief well' },
} as const;
export const FIRE_STATION_RANGE = 80;
export const AQUIFER_FINE = 250_000;

// ---- Completion, frac, lift ------------------------------------------------------------------------
export const COMPLETION_BASE_COST = 140_000;
export const COMPLETION_COST_PER_CONTACT = 3_000;
export const COMPLETION_HOURS_BASE = 6;
export const COMPLETION_HOURS_PER_CONTACT = 0.15;
export const LINER_COST_PER_BLOCK = 9_000;
export const FRAC_RANGE = 10;
export const FRAC_HOURS_PER_STAGE = 1.5;
export const FRAC_COST_PER_STAGE = 25_000;
export const FRAC_PROPPANT_PER_STAGE = 100; // t
export const FRAC_WATER_PER_STAGE = 2_000; // bbl
export const WATER_TRUCKING_PER_BBL = 3;
export const MAX_FRAC_STAGES = 60;
export const LIFT_SPECS = {
  natural: { cost: 10_000, hours: 4, tech: null },
  pumpjack: { cost: 85_000, hours: 8, tech: 'pumpjacks' },
  esp: { cost: 260_000, hours: 12, tech: 'esp_pumps' },
  gaslift: { cost: 120_000, hours: 6, tech: 'gas_lift' },
} as const;
/** Electric power draw of artificial lift (MW), published on wellhead.data.liftPowerMW for facilities. */
export const LIFT_POWER_MW = { natural: 0, pumpjack: 0.04, esp: 0.25, gaslift: 0.02 } as const;
export const CONVERT_COST = 60_000;
export const CONVERT_HOURS = 6;
export const PLUG_COST_BASE = 60_000;
export const PLUG_COST_PER_BLOCK = 1_200;
export const SKID_BASE_COST = 25_000;
export const SKID_COST_PER_BLOCK = 500;
export const SKID_RIGUP_PROGRESS = 0.7;

// ---- Reservoir & deliverability ------------------------------------------------------------------
/** Oil productivity constant: J [bbl/d/psi] = K_J · k·h[mD·ft] · productivity / (μ·Bo). */
export const K_J = 1 / 4000;
/** Gas deliverability constant: q [mcf/d] = K_G · k·h · productivity · (Pr² − Pwf²)^n. */
export const K_G = 1.5e-6;
export const GAS_N = 0.85;
/** Permeability below which rock counts as "tight" and uses a compressed effective permeability. */
export const K_TIGHT = 10;
export const UNDERSAT_COMPRESSIBILITY = 1.4e-5; // 1/psi (effective ce above the bubble point)
export const SAT_COMPRESSIBILITY = 2e-4; // 1/psi (solution-gas drive: gas liberation dominates)
export const GAS_CAP_RATIO = 0.25; // m
export const AQUIFER_TAU_DAYS = 14;
export const MIN_RESERVOIR_PSI = 60;
/** Local (near-well) drainage: decline constant (1/day) for tight rock and conventional rock. */
/** Horizontal-section weight in effective pay thickness (tight rock benefits more from long laterals). */
export const LATERAL_WEIGHT_CONV = 0.3;
export const LATERAL_WEIGHT_TIGHT = 0.5;
export const TIGHT_DECLINE = 0.055;
export const CONV_DECLINE = 0.04;
/** Tight rock: matrix recharge of the stimulated volume fades as r / (1 + age / SRV_AGE_DAYS). */
export const SRV_AGE_DAYS = 120;
export const TUBING_CAP_OIL = 6_000; // bbl/d liquid through tubing on natural flow
export const TUBING_CAP_GAS = 40_000; // mcf/d
export const WELLHEAD_PRESSURE_OIL = 120; // psi flowline
export const WELLHEAD_PRESSURE_GAS = 250; // psi sales line (uncompressed)
export const GAS_LIFT_GAS_PER_BBL = 0.06; // mcf consumed per bbl of liquid lifted
export const MCF_PER_TONNE_CO2 = 19;
export const MAX_SUBSTEP_MINUTES = 30;
