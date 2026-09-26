// Technology tree. Tech ids are stable save keys.
// Effects are expressed two ways so systems stay decoupled:
//  - `modifiers`: multiplicative numeric modifiers (see ModifierKey). Systems call getModifier(state, key).
//  - `unlocks`: building types / features that require this tech (checked with hasTech()).

export type TechBranch =
  | 'exploration' | 'drilling' | 'production' | 'midstream' | 'refining'
  | 'petrochem' | 'safety' | 'environment' | 'automation' | 'offshore' | 'management';

/** Numeric modifier keys. Every value is a multiplier (1 = no change). */
export type ModifierKey =
  | 'seismic_resolution' | 'seismic_cost' | 'seismic_speed'
  | 'drill_speed' | 'bit_life' | 'kick_risk' | 'drill_cost' | 'max_depth' | 'max_lateral'
  | 'production_rate' | 'recovery_factor' | 'decline_rate' | 'lift_efficiency' | 'water_cut'
  | 'pipeline_capacity' | 'compressor_efficiency' | 'storage_capacity' | 'transport_cost'
  | 'refinery_yield' | 'process_speed' | 'petrochem_yield'
  | 'failure_rate' | 'fire_spread' | 'blowout_risk' | 'accident_rate' | 'repair_speed'
  | 'emissions' | 'spill_risk' | 'flare_emissions' | 'water_treatment'
  | 'worker_efficiency' | 'wages' | 'research_speed' | 'construction_speed' | 'construction_cost'
  | 'sale_price' | 'power_efficiency' | 'offshore_depth';

export interface TechDef {
  id: string;
  name: string;
  branch: TechBranch;
  tier: number; // 1..5 (column in the tree UI)
  cost: number; // research points
  requires: string[];
  description: string;
  modifiers?: Partial<Record<ModifierKey, number>>;
  /** Building type ids unlocked. (Buildings also declare `requiresTech`; this is for display.) */
  unlocks?: string[];
  /** Named feature flags checked by systems via hasTech(state, techId). */
  features?: string[];
}

export const TECHS: Record<string, TechDef> = {};
const t = (d: TechDef) => (TECHS[d.id] = d);

// Exploration
t({ id: 'seismic_2d', name: '2D Seismic Surveys', branch: 'exploration', tier: 1, cost: 0, requires: [], description: 'Shoot 2D seismic lines to image the subsurface along a cross-section.', features: ['survey_2d'] });
t({ id: 'well_logging', name: 'Wireline Logging', branch: 'exploration', tier: 1, cost: 40, requires: [], description: 'Run gamma-ray, resistivity and porosity logs in every well you drill.', features: ['well_logs'] });
t({ id: 'seismic_3d', name: '3D Seismic', branch: 'exploration', tier: 2, cost: 180, requires: ['seismic_2d'], description: 'Image whole areas in 3D. Reveals reservoir outlines on the map.', features: ['survey_3d'], modifiers: { seismic_resolution: 1.5 } });
t({ id: 'avo_analysis', name: 'AVO & Direct Hydrocarbon Indicators', branch: 'exploration', tier: 3, cost: 420, requires: ['seismic_3d', 'well_logging'], description: 'Bright spots reveal fluid type (oil vs gas vs brine) in seismic.', features: ['seismic_fluid'], modifiers: { seismic_resolution: 1.3 } });
t({ id: 'seismic_4d', name: '4D Time-Lapse Seismic', branch: 'exploration', tier: 4, cost: 900, requires: ['avo_analysis'], description: 'Monitor depletion and water fronts over time. Shows remaining oil.', features: ['seismic_4d'], modifiers: { recovery_factor: 1.05 } });
t({ id: 'ai_geoscience', name: 'AI Geoscience', branch: 'exploration', tier: 5, cost: 1800, requires: ['seismic_4d', 'scada'], description: 'Machine-learning interpretation: cheaper, faster, sharper surveys.', modifiers: { seismic_cost: 0.5, seismic_speed: 2, seismic_resolution: 1.4 } });

// Drilling
t({ id: 'rotary_drilling', name: 'Rotary Drilling', branch: 'drilling', tier: 1, cost: 0, requires: [], description: 'Vertical wells with a conventional land rig.', unlocks: ['drilling_rig_land'] });
t({ id: 'pdc_bits', name: 'PDC Bits', branch: 'drilling', tier: 2, cost: 120, requires: ['rotary_drilling'], description: 'Polycrystalline diamond cutters drill faster and last longer.', modifiers: { drill_speed: 1.35, bit_life: 1.6 } });
t({ id: 'directional_drilling', name: 'Directional Drilling', branch: 'drilling', tier: 2, cost: 200, requires: ['rotary_drilling'], description: 'Steer deviated wells toward offset targets with mud motors.', features: ['directional'] });
t({ id: 'horizontal_drilling', name: 'Horizontal Drilling', branch: 'drilling', tier: 3, cost: 450, requires: ['directional_drilling', 'pdc_bits'], description: 'Drill long laterals through thin reservoirs for massive contact area.', features: ['horizontal'], modifiers: { max_lateral: 1.0 } });
t({ id: 'heavy_rigs', name: 'Heavy Rigs', branch: 'drilling', tier: 3, cost: 380, requires: ['pdc_bits'], description: 'High-horsepower rigs for deep, hot wells.', unlocks: ['drilling_rig_heavy'], modifiers: { max_depth: 1.3 } });
t({ id: 'managed_pressure', name: 'Managed Pressure Drilling', branch: 'drilling', tier: 4, cost: 800, requires: ['horizontal_drilling', 'bop_upgrade'], description: 'Closed-loop control of bottom-hole pressure. Kicks become rare.', modifiers: { kick_risk: 0.35, drill_speed: 1.1 } });
t({ id: 'extended_reach', name: 'Extended Reach Drilling', branch: 'drilling', tier: 5, cost: 1500, requires: ['managed_pressure', 'heavy_rigs'], description: 'Laterals twice as long. Reach reservoirs kilometres away.', modifiers: { max_lateral: 2.0, max_depth: 1.2 } });

// Production
t({ id: 'pumpjacks', name: 'Beam Pumps', branch: 'production', tier: 1, cost: 0, requires: [], description: 'Pumpjacks lift oil once natural pressure fades.', features: ['lift_pumpjack'] });
t({ id: 'hydraulic_fracturing', name: 'Hydraulic Fracturing', branch: 'production', tier: 2, cost: 350, requires: ['pumpjacks', 'directional_drilling'], description: 'Frac tight rock to unlock shale oil & gas.', unlocks: ['frac_spread'], features: ['fracking'] });
t({ id: 'waterflood', name: 'Waterflooding', branch: 'production', tier: 2, cost: 260, requires: ['pumpjacks'], description: 'Convert wells to water injectors to maintain reservoir pressure.', features: ['injector_water'], modifiers: { recovery_factor: 1.1 } });
t({ id: 'esp_pumps', name: 'Electric Submersible Pumps', branch: 'production', tier: 3, cost: 500, requires: ['pumpjacks'], description: 'High-rate downhole pumps for big wells.', features: ['lift_esp'], modifiers: { lift_efficiency: 1.25 } });
t({ id: 'gas_lift', name: 'Gas Lift', branch: 'production', tier: 3, cost: 420, requires: ['pumpjacks', 'compression'], description: 'Inject gas into tubing to lighten the fluid column.', features: ['lift_gaslift'] });
t({ id: 'co2_eor', name: 'CO₂ Enhanced Recovery', branch: 'production', tier: 4, cost: 900, requires: ['waterflood', 'carbon_capture'], description: 'Inject CO₂ to swell and mobilize trapped oil.', features: ['injector_co2'], modifiers: { recovery_factor: 1.2 } });
t({ id: 'smart_completions', name: 'Smart Completions', branch: 'production', tier: 5, cost: 1400, requires: ['esp_pumps', 'scada'], description: 'Downhole valves choke back watered-out zones automatically.', modifiers: { water_cut: 0.75, decline_rate: 0.85 } });

// Midstream
t({ id: 'pipelines', name: 'Pipelines', branch: 'midstream', tier: 1, cost: 0, requires: [], description: 'Crude, gas, water and product pipelines.' });
t({ id: 'compression', name: 'Gas Compression', branch: 'midstream', tier: 2, cost: 200, requires: ['pipelines'], description: 'Compressor stations push gas through long lines.', unlocks: ['compressor_station'] });
t({ id: 'large_storage', name: 'Tank Farms', branch: 'midstream', tier: 2, cost: 180, requires: ['pipelines'], description: 'Large floating-roof tanks and gas spheres.', unlocks: ['oil_tank_large', 'gas_sphere'] });
t({ id: 'rail_logistics', name: 'Rail Logistics', branch: 'midstream', tier: 3, cost: 450, requires: ['large_storage'], description: 'Unit trains move crude and products cheaply.', unlocks: ['rail_terminal'], modifiers: { transport_cost: 0.9 } });
t({ id: 'marine_export', name: 'Marine Export', branch: 'midstream', tier: 4, cost: 800, requires: ['rail_logistics'], description: 'Load tankers at a coastal terminal. Best prices, huge volumes.', unlocks: ['export_terminal'] });
t({ id: 'high_pressure_lines', name: 'High-Pressure Pipelines', branch: 'midstream', tier: 4, cost: 700, requires: ['compression'], description: 'X80 steel lines double throughput.', modifiers: { pipeline_capacity: 2, compressor_efficiency: 1.2 } });

// Refining
t({ id: 'gas_processing', name: 'Gas Processing', branch: 'refining', tier: 2, cost: 250, requires: ['pipelines'], description: 'Strip NGLs and sulfur from raw gas.', unlocks: ['gas_plant'] });
t({ id: 'refining', name: 'Crude Distillation', branch: 'refining', tier: 2, cost: 400, requires: ['pipelines'], description: 'Atmospheric distillation turns crude into fuels.', unlocks: ['refinery'] });
t({ id: 'catalytic_cracking', name: 'Catalytic Cracking', branch: 'refining', tier: 3, cost: 700, requires: ['refining'], description: 'Crack heavy residue into gasoline and propylene.', unlocks: ['fcc_unit'], modifiers: { refinery_yield: 1.1 } });
t({ id: 'hydrotreating', name: 'Hydrotreating', branch: 'refining', tier: 3, cost: 600, requires: ['refining', 'gas_processing'], description: 'Remove sulfur from fuels for premium prices.', unlocks: ['lube_plant'], modifiers: { sale_price: 1.04 } });
t({ id: 'lng', name: 'Liquefied Natural Gas', branch: 'refining', tier: 4, cost: 1100, requires: ['gas_processing', 'marine_export'], description: 'Chill gas to −162 °C and ship it worldwide.', unlocks: ['lng_plant'] });

// Petrochemicals
t({ id: 'petrochemicals', name: 'Steam Cracking', branch: 'petrochem', tier: 3, cost: 800, requires: ['gas_processing'], description: 'Crack NGLs into ethylene and propylene.', unlocks: ['steam_cracker'] });
t({ id: 'gas_to_chemicals', name: 'Gas-to-Chemicals', branch: 'petrochem', tier: 3, cost: 650, requires: ['gas_processing'], description: 'Convert methane into ammonia and methanol.', unlocks: ['ammonia_plant'] });
t({ id: 'polymers', name: 'Polymerization', branch: 'petrochem', tier: 4, cost: 1200, requires: ['petrochemicals'], description: 'Turn olefins into polyethylene and polypropylene pellets.', unlocks: ['polymer_plant'] });
t({ id: 'catalysts', name: 'Advanced Catalysts', branch: 'petrochem', tier: 5, cost: 1600, requires: ['polymers', 'catalytic_cracking'], description: 'Higher yields everywhere downstream.', modifiers: { refinery_yield: 1.12, petrochem_yield: 1.15, process_speed: 1.15 } });

// Safety
t({ id: 'bop_upgrade', name: 'Blowout Preventers', branch: 'safety', tier: 1, cost: 80, requires: [], description: 'Annular + ram BOP stacks shut in kicks before they become blowouts.', modifiers: { blowout_risk: 0.4 } });
t({ id: 'fire_response', name: 'Fire Response', branch: 'safety', tier: 2, cost: 160, requires: ['bop_upgrade'], description: 'Fire stations and deluge systems.', unlocks: ['fire_station'], modifiers: { fire_spread: 0.6 } });
t({ id: 'predictive_maintenance', name: 'Predictive Maintenance', branch: 'safety', tier: 3, cost: 520, requires: ['fire_response'], description: 'Vibration monitoring catches failures early.', modifiers: { failure_rate: 0.6, repair_speed: 1.3 } });
t({ id: 'process_safety', name: 'Process Safety Management', branch: 'safety', tier: 4, cost: 900, requires: ['predictive_maintenance'], description: 'HAZOPs, permits and training. Far fewer accidents.', modifiers: { accident_rate: 0.5, fire_spread: 0.6, blowout_risk: 0.6 } });

// Environment
t({ id: 'leak_detection', name: 'Leak Detection', branch: 'environment', tier: 1, cost: 90, requires: [], description: 'Pressure-point analysis flags pipeline leaks fast.', modifiers: { spill_risk: 0.6 } });
t({ id: 'flare_recovery', name: 'Flare Gas Recovery', branch: 'environment', tier: 2, cost: 240, requires: ['leak_detection'], description: 'Capture most flared gas. Cleaner air, better reputation.', modifiers: { flare_emissions: 0.4 } });
t({ id: 'water_recycling', name: 'Water Recycling', branch: 'environment', tier: 2, cost: 220, requires: ['leak_detection'], description: 'Treat produced water for reuse.', unlocks: ['water_treatment'], modifiers: { water_treatment: 1.5 } });
t({ id: 'renewables', name: 'Renewable Power', branch: 'environment', tier: 3, cost: 480, requires: ['flare_recovery'], description: 'Solar farms and wind turbines electrify operations.', unlocks: ['solar_farm', 'wind_turbine'] });
t({ id: 'carbon_capture', name: 'Carbon Capture', branch: 'environment', tier: 4, cost: 1000, requires: ['renewables', 'gas_processing'], description: 'Capture CO₂ from plants for EOR or storage credits.', unlocks: ['ccs_unit'], modifiers: { emissions: 0.8 } });

// Automation
t({ id: 'telemetry', name: 'Remote Telemetry', branch: 'automation', tier: 1, cost: 100, requires: [], description: 'Live well data from anywhere. Enables alerts.', features: ['telemetry'] });
t({ id: 'scada', name: 'SCADA', branch: 'automation', tier: 3, cost: 700, requires: ['telemetry', 'compression'], description: 'Central control room. Auto-chokes, auto-shut-in on hazards.', unlocks: ['scada_center'], features: ['auto_choke', 'auto_shutin'], modifiers: { worker_efficiency: 1.1 } });
t({ id: 'drones', name: 'Inspection Drones', branch: 'automation', tier: 4, cost: 900, requires: ['scada', 'predictive_maintenance'], description: 'Drones inspect assets and dispatch repairs automatically.', features: ['auto_repair'], modifiers: { repair_speed: 1.5, failure_rate: 0.85 } });
t({ id: 'autonomous_field', name: 'Autonomous Oilfield', branch: 'automation', tier: 5, cost: 2200, requires: ['drones', 'smart_completions'], description: 'Robotic operations: fewer crew needed everywhere.', modifiers: { worker_efficiency: 1.35, wages: 0.8 } });

// Offshore
t({ id: 'offshore_shallow', name: 'Shallow-Water Offshore', branch: 'offshore', tier: 3, cost: 650, requires: ['directional_drilling', 'bop_upgrade'], description: 'Jack-up rigs and fixed platforms on the continental shelf.', unlocks: ['jackup_rig', 'production_platform', 'helipad'] });
t({ id: 'offshore_deep', name: 'Deepwater', branch: 'offshore', tier: 4, cost: 1300, requires: ['offshore_shallow', 'managed_pressure'], description: 'Semi-submersibles and FPSOs for deep water.', unlocks: ['semi_sub_rig', 'fpso'], modifiers: { offshore_depth: 3 } });
t({ id: 'subsea_tiebacks', name: 'Subsea Tiebacks', branch: 'offshore', tier: 5, cost: 1700, requires: ['offshore_deep', 'scada'], description: 'Long subsea flowlines. Offshore production +20%.', modifiers: { production_rate: 1.08, pipeline_capacity: 1.2 } });

// Management
t({ id: 'field_operations', name: 'Field Operations', branch: 'management', tier: 1, cost: 0, requires: [], description: 'Field office, workers camp, warehouses and trucking.' });
t({ id: 'hr_training', name: 'Crew Training Programs', branch: 'management', tier: 2, cost: 150, requires: ['field_operations'], description: 'Workers gain experience 50% faster and have fewer accidents.', modifiers: { accident_rate: 0.8, worker_efficiency: 1.08 } });
t({ id: 'lean_construction', name: 'Modular Construction', branch: 'management', tier: 2, cost: 200, requires: ['field_operations'], description: 'Prefabricated modules: faster, cheaper builds.', modifiers: { construction_speed: 1.5, construction_cost: 0.9 } });
t({ id: 'trading_desk', name: 'Trading Desk', branch: 'management', tier: 3, cost: 450, requires: ['hr_training'], description: 'Hedge prices and access premium contracts.', features: ['hedging', 'premium_contracts'], modifiers: { sale_price: 1.03 } });
t({ id: 'rd_campus', name: 'R&D Campus', branch: 'management', tier: 4, cost: 900, requires: ['trading_desk'], description: 'Research 40% faster.', modifiers: { research_speed: 1.4 } });

export const TECH_BRANCHES: TechBranch[] = ['exploration', 'drilling', 'production', 'midstream', 'refining', 'petrochem', 'safety', 'environment', 'automation', 'offshore', 'management'];
/** Techs every new company starts with (cost 0 roots). */
export const STARTING_TECHS = Object.values(TECHS).filter((d) => d.cost === 0).map((d) => d.id);
