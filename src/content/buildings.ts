// Building catalogue. Ids are stable save keys and are the contract between
// simulation (behaviour), render (3D models keyed by id) and UI (build menu).
//
// Geometry: `size` = [width(x), depth(z), height(y)] in blocks at rotation 0.
// A building's origin (x,y,z) is its min corner at ground level (y = first air block above the pad).
// Rotation r in {0,1,2,3} rotates 90° steps around +Y; for r = 1|3 width and depth swap.

export type BuildingCategory =
  | 'exploration' | 'drilling' | 'production' | 'storage' | 'midstream' | 'processing'
  | 'petrochem' | 'power' | 'logistics' | 'offshore' | 'support' | 'environment';

export type WorkerRole = 'roughneck' | 'driller' | 'operator' | 'engineer' | 'technician' | 'geoscientist' | 'firefighter' | 'trucker';

export type PlacementRule =
  | 'land' // on dry, reasonably flat land
  | 'water' // over water (offshore); legs reach the seabed
  | 'coast' // must touch both land and water (export terminal)
  | 'wellhead' // must be placed centred on an existing wellhead (frac spread)
  | 'auto'; // cannot be placed by players (created by systems, e.g. wellhead)

export interface BuildingDef {
  id: string;
  name: string;
  category: BuildingCategory;
  size: [number, number, number];
  cost: number; // USD
  /** Construction effort in game hours at 1 crew. */
  buildHours: number;
  /** Power draw (MW, positive) or generation (negative). */
  power: number;
  /** Crew required to operate at full efficiency. */
  crew: Partial<Record<WorkerRole, number>>;
  /** Daily fixed operating cost (USD/day), excluding wages & fuel. */
  opex: number;
  requiresTech?: string;
  placement: PlacementRule;
  /** Pipe categories this building connects to (adjacent pipe blocks). */
  ports: Array<'oil' | 'gas' | 'water' | 'product'>;
  /** Storage capacity per network category (units of the commodity). */
  storage?: Partial<Record<'oil' | 'gas' | 'water' | 'product', number>>;
  /** Max water depth in blocks (offshore) or min, when relevant. */
  waterDepth?: [number, number];
  /** Emissions t CO2e/day at full load. */
  emissions?: number;
  /** Mean days between failures at condition 100 (lower = fragile). */
  mtbf?: number;
  /** Flammability 0..1 (fire probability & spread). */
  flammability?: number;
  description: string;
  /** Short gameplay hint shown in build menu tooltip. */
  hint?: string;
  /** Build-menu hotkey sort order inside category. */
  order: number;
}

export const BUILDINGS: Record<string, BuildingDef> = {};
const b = (d: BuildingDef) => (BUILDINGS[d.id] = d);

// ---- Support ------------------------------------------------------------------------------------
b({ id: 'field_office', name: 'Field Office', category: 'support', size: [5, 4, 4], cost: 120_000, buildHours: 12, power: 0.1, crew: {}, opex: 400, placement: 'land', ports: [], mtbf: 400, flammability: 0.1, order: 1,
  description: 'Company headquarters in the field. Hire crews, generate a trickle of research, and store supplies.', hint: 'You start with one. Build more to expand your hiring pool.' });
b({ id: 'worker_camp', name: 'Worker Camp', category: 'support', size: [6, 4, 3], cost: 180_000, buildHours: 16, power: 0.3, crew: {}, opex: 900, placement: 'land', ports: [], mtbf: 400, flammability: 0.2, order: 2,
  description: 'Bunkhouses and a canteen. Each camp houses 16 workers and boosts morale.' });
b({ id: 'warehouse', name: 'Supply Yard', category: 'support', size: [6, 6, 4], cost: 150_000, buildHours: 14, power: 0.1, crew: { trucker: 1 }, opex: 300, placement: 'land', ports: [], mtbf: 500, flammability: 0.15, order: 3,
  description: 'Pipe racks and warehouses. Stocks drilling supplies at bulk discount (−20%) instead of emergency delivery.' });
b({ id: 'research_lab', name: 'Research Lab', category: 'support', size: [6, 5, 4], cost: 450_000, buildHours: 30, power: 1.5, crew: { engineer: 2, geoscientist: 2 }, opex: 2500, placement: 'land', ports: [], mtbf: 300, flammability: 0.15, order: 4,
  description: 'Core analysis and engineering lab. Generates research points each day.' });
b({ id: 'maintenance_depot', name: 'Maintenance Depot', category: 'support', size: [5, 5, 4], cost: 220_000, buildHours: 18, power: 0.4, crew: { technician: 4 }, opex: 700, placement: 'land', ports: [], mtbf: 400, flammability: 0.2, order: 5,
  description: 'Technicians automatically inspect and repair equipment within 64 blocks.' });
b({ id: 'fire_station', name: 'Fire Station', category: 'support', size: [5, 5, 4], cost: 260_000, buildHours: 18, power: 0.2, crew: { firefighter: 4 }, opex: 600, requiresTech: 'fire_response', placement: 'land', ports: [], mtbf: 500, flammability: 0.05, order: 6,
  description: 'Fire crews respond to fires within 80 blocks and help cap blowouts.' });
b({ id: 'scada_center', name: 'SCADA Control Center', category: 'support', size: [5, 5, 5], cost: 900_000, buildHours: 36, power: 2, crew: { engineer: 3, operator: 2 }, opex: 3000, requiresTech: 'scada', placement: 'land', ports: [], mtbf: 300, flammability: 0.1, order: 7,
  description: 'Central automation: auto-choke wells, auto shut-in on hazards, reduce crew needs field-wide.' });
b({ id: 'weather_station', name: 'Weather Station', category: 'support', size: [2, 2, 6], cost: 40_000, buildHours: 4, power: 0.05, crew: {}, opex: 50, placement: 'land', ports: [], mtbf: 600, flammability: 0.05, order: 8,
  description: 'Extends the weather forecast to 7 days and warns of storms.' });
b({ id: 'helipad', name: 'Helipad', category: 'support', size: [5, 5, 1], cost: 150_000, buildHours: 10, power: 0.1, crew: {}, opex: 400, requiresTech: 'offshore_shallow', placement: 'land', ports: [], mtbf: 600, flammability: 0.1, order: 9,
  description: 'Crew-change helicopters. Required to staff offshore rigs and platforms.' });

// ---- Exploration & drilling ------------------------------------------------------------------------
b({ id: 'drilling_rig_land', name: 'Land Drilling Rig', category: 'drilling', size: [5, 5, 16], cost: 650_000, buildHours: 20, power: 1.5, crew: { driller: 1, roughneck: 4 }, opex: 6000, requiresTech: 'rotary_drilling', placement: 'land', ports: [], emissions: 12, mtbf: 60, flammability: 0.35, order: 1,
  description: 'Triple derrick, drawworks, mud pumps and BOP. Drills vertical, directional and horizontal wells up to ~2,800 m.', hint: 'Select the rig and choose a well plan. After completion, skid it to a new location.' });
b({ id: 'drilling_rig_heavy', name: 'Heavy Drilling Rig', category: 'drilling', size: [7, 7, 22], cost: 1_900_000, buildHours: 36, power: 3.5, crew: { driller: 2, roughneck: 6, engineer: 1 }, opex: 14000, requiresTech: 'heavy_rigs', placement: 'land', ports: [], emissions: 25, mtbf: 70, flammability: 0.35, order: 2,
  description: '3,000 hp rig with top drive and automated pipe handling. Faster, deeper, longer laterals.' });
b({ id: 'frac_spread', name: 'Frac Spread', category: 'drilling', size: [7, 5, 4], cost: 900_000, buildHours: 8, power: 0, crew: { operator: 3, roughneck: 3 }, opex: 20000, requiresTech: 'hydraulic_fracturing', placement: 'land', ports: ['water'], emissions: 40, mtbf: 50, flammability: 0.3, order: 3,
  description: 'Pump trucks, blenders and sand kings. Place next to a completed wellhead to fracture tight rock (uses water and proppant).' });
b({ id: 'wellhead', name: 'Wellhead', category: 'production', size: [3, 3, 3], cost: 0, buildHours: 0, power: 0, crew: {}, opex: 150, placement: 'auto', ports: ['oil', 'gas', 'water'], storage: { oil: 400, gas: 2000, water: 400 }, emissions: 0.5, mtbf: 180, flammability: 0.3, order: 0,
  description: 'Christmas tree, choke and test separator. Splits the wellstream into oil, gas and water outlets. Upgrade with a pumpjack or ESP.' });

// ---- Production facilities -------------------------------------------------------------------------
b({ id: 'flare_stack', name: 'Flare Stack', category: 'production', size: [2, 2, 12], cost: 60_000, buildHours: 6, power: 0, crew: {}, opex: 100, placement: 'land', ports: ['gas'], emissions: 0, mtbf: 400, flammability: 0, order: 1,
  description: 'Safely burns gas you cannot sell. Without a flare, excess gas is vented (heavy environmental penalty).' });
b({ id: 'water_pit', name: 'Evaporation Pit', category: 'production', size: [5, 5, 1], cost: 30_000, buildHours: 4, power: 0, crew: {}, opex: 50, placement: 'land', ports: ['water'], storage: { water: 6000 }, mtbf: 999, flammability: 0, order: 2,
  description: 'Lined pit for produced water. Cheap but leaks when overfilled or in heavy rain.' });
b({ id: 'disposal_well', name: 'Saltwater Disposal Well', category: 'production', size: [3, 3, 4], cost: 280_000, buildHours: 12, power: 0.6, crew: { operator: 1 }, opex: 500, placement: 'land', ports: ['water'], mtbf: 200, flammability: 0.05, order: 3,
  description: 'Injects produced water into a deep formation (up to 8,000 bbl/day).' });
b({ id: 'water_treatment', name: 'Water Treatment Plant', category: 'environment', size: [6, 6, 4], cost: 650_000, buildHours: 24, power: 1.2, crew: { operator: 2 }, opex: 1500, requiresTech: 'water_recycling', placement: 'land', ports: ['water'], mtbf: 200, flammability: 0.05, order: 1,
  description: 'Treats produced water into reusable fresh water for waterfloods and fracking.' });

// ---- Storage ---------------------------------------------------------------------------------------
b({ id: 'oil_tank_small', name: 'Storage Tank', category: 'storage', size: [4, 4, 5], cost: 90_000, buildHours: 8, power: 0, crew: {}, opex: 60, placement: 'land', ports: ['oil', 'product'], storage: { oil: 5000, product: 5000 }, mtbf: 800, flammability: 0.5, order: 1,
  description: 'Bolted steel tank. Stores 5,000 bbl of crude and 5,000 bbl of products.' });
b({ id: 'oil_tank_large', name: 'Floating-Roof Tank', category: 'storage', size: [8, 8, 7], cost: 600_000, buildHours: 24, power: 0.05, crew: {}, opex: 200, requiresTech: 'large_storage', placement: 'land', ports: ['oil', 'product'], storage: { oil: 60000, product: 60000 }, mtbf: 900, flammability: 0.6, order: 2,
  description: 'Massive floating-roof tank: 60,000 bbl. Speculate on prices by storing oil.' });
b({ id: 'gas_sphere', name: 'Gas Sphere', category: 'storage', size: [6, 6, 7], cost: 520_000, buildHours: 20, power: 0.05, crew: {}, opex: 150, requiresTech: 'large_storage', placement: 'land', ports: ['gas'], storage: { gas: 50000 }, mtbf: 800, flammability: 0.7, order: 3,
  description: 'Pressurised spherical gas holder: 50,000 mcf.' });

// ---- Midstream ------------------------------------------------------------------------------------
b({ id: 'pump_station', name: 'Pump Station', category: 'midstream', size: [3, 3, 3], cost: 160_000, buildHours: 10, power: 1.0, crew: {}, opex: 200, placement: 'land', ports: ['oil', 'water', 'product'], mtbf: 150, flammability: 0.25, order: 1,
  description: 'Boosts liquid pipeline throughput on its networks.' });
b({ id: 'compressor_station', name: 'Compressor Station', category: 'midstream', size: [5, 4, 4], cost: 420_000, buildHours: 16, power: 2.5, crew: { operator: 1 }, opex: 700, requiresTech: 'compression', placement: 'land', ports: ['gas'], emissions: 6, mtbf: 120, flammability: 0.4, order: 2,
  description: 'Reciprocating compressors restore pressure on gas pipelines. Required for long gas lines.' });
b({ id: 'gas_sales_meter', name: 'Gas Sales Meter', category: 'logistics', size: [3, 2, 2], cost: 80_000, buildHours: 6, power: 0.05, crew: {}, opex: 100, placement: 'land', ports: ['gas'], mtbf: 500, flammability: 0.2, order: 1,
  description: 'Custody-transfer meter into the regional grid. Sells dry gas at market price; raw gas at a 30% discount.' });
b({ id: 'truck_terminal', name: 'Truck Loading Rack', category: 'logistics', size: [6, 4, 4], cost: 220_000, buildHours: 12, power: 0.2, crew: { trucker: 4 }, opex: 800, placement: 'land', ports: ['oil', 'product'], storage: { oil: 1500, product: 1500 }, mtbf: 300, flammability: 0.4, order: 2,
  description: 'Tanker trucks haul liquids to market: up to 3,000 bbl/day. Fulfils contracts.' });
b({ id: 'rail_terminal', name: 'Rail Terminal', category: 'logistics', size: [14, 5, 5], cost: 1_400_000, buildHours: 40, power: 0.8, crew: { trucker: 4, operator: 2 }, opex: 2500, requiresTech: 'rail_logistics', placement: 'land', ports: ['oil', 'product'], storage: { oil: 20000, product: 20000 }, mtbf: 300, flammability: 0.4, order: 3,
  description: 'Unit-train loading: 25,000 bbl/day at lower transport cost.' });
b({ id: 'export_terminal', name: 'Marine Export Terminal', category: 'logistics', size: [10, 14, 6], cost: 4_500_000, buildHours: 80, power: 2, crew: { operator: 4, trucker: 4 }, opex: 6000, requiresTech: 'marine_export', placement: 'coast', ports: ['oil', 'gas', 'product'], storage: { oil: 100000, product: 100000 }, mtbf: 300, flammability: 0.45, order: 4,
  description: 'Jetty and loading arms for supertankers: 150,000 bbl/day at world prices. Only place to sell LNG.' });

// ---- Processing -------------------------------------------------------------------------------------
b({ id: 'gas_plant', name: 'Gas Processing Plant', category: 'processing', size: [9, 8, 9], cost: 3_200_000, buildHours: 60, power: 4, crew: { operator: 4, engineer: 1 }, opex: 5000, requiresTech: 'gas_processing', placement: 'land', ports: ['gas', 'product', 'oil'], storage: { gas: 10000, product: 4000, oil: 2000 }, emissions: 30, mtbf: 110, flammability: 0.55, order: 1,
  description: 'Amine treating, dehydration and cryogenic expansion: raw gas → dry gas + NGLs + condensate + sulfur.' });
b({ id: 'refinery', name: 'Crude Distillation Unit', category: 'processing', size: [10, 10, 16], cost: 9_500_000, buildHours: 120, power: 8, crew: { operator: 8, engineer: 2 }, opex: 14000, requiresTech: 'refining', placement: 'land', ports: ['oil', 'product', 'gas'], storage: { oil: 20000, product: 20000, gas: 5000 }, emissions: 90, mtbf: 90, flammability: 0.7, order: 2,
  description: 'Atmospheric & vacuum towers: crude → gasoline, diesel, jet fuel, LPG and asphalt.' });
b({ id: 'fcc_unit', name: 'Fluid Catalytic Cracker', category: 'processing', size: [7, 7, 18], cost: 6_000_000, buildHours: 90, power: 6, crew: { operator: 4, engineer: 1 }, opex: 9000, requiresTech: 'catalytic_cracking', placement: 'land', ports: ['product'], storage: { product: 10000 }, emissions: 60, mtbf: 80, flammability: 0.7, order: 3,
  description: 'Cracks asphalt residue into gasoline, LPG and propylene.' });
b({ id: 'lube_plant', name: 'Hydrotreater & Lube Plant', category: 'processing', size: [7, 6, 10], cost: 4_200_000, buildHours: 70, power: 4, crew: { operator: 3, engineer: 1 }, opex: 6000, requiresTech: 'hydrotreating', placement: 'land', ports: ['product', 'gas'], storage: { product: 8000 }, emissions: 30, mtbf: 100, flammability: 0.6, order: 4,
  description: 'Hydrotreats diesel for a premium and turns residue into lubricants. Recovers sulfur.' });
b({ id: 'lng_plant', name: 'LNG Train', category: 'processing', size: [12, 10, 14], cost: 22_000_000, buildHours: 200, power: 25, crew: { operator: 8, engineer: 3 }, opex: 30000, requiresTech: 'lng', placement: 'land', ports: ['gas', 'product'], storage: { gas: 40000, product: 30000 }, emissions: 160, mtbf: 90, flammability: 0.75, order: 5,
  description: 'Mixed-refrigerant cryogenic train: dry gas → LNG for export.' });

// ---- Petrochemicals ------------------------------------------------------------------------------------
b({ id: 'steam_cracker', name: 'Steam Cracker', category: 'petrochem', size: [10, 8, 14], cost: 14_000_000, buildHours: 150, power: 12, crew: { operator: 6, engineer: 2 }, opex: 16000, requiresTech: 'petrochemicals', placement: 'land', ports: ['product', 'gas'], storage: { product: 15000 }, emissions: 120, mtbf: 80, flammability: 0.75, order: 1,
  description: 'Furnaces at 850 °C crack NGLs into ethylene and propylene.' });
b({ id: 'polymer_plant', name: 'Polymer Plant', category: 'petrochem', size: [9, 7, 10], cost: 11_000_000, buildHours: 130, power: 8, crew: { operator: 5, engineer: 2 }, opex: 12000, requiresTech: 'polymers', placement: 'land', ports: ['product'], storage: { product: 12000 }, emissions: 40, mtbf: 100, flammability: 0.5, order: 2,
  description: 'Gas-phase reactors: ethylene → polyethylene, propylene → polypropylene.' });
b({ id: 'ammonia_plant', name: 'Ammonia & Methanol Plant', category: 'petrochem', size: [8, 8, 12], cost: 8_000_000, buildHours: 110, power: 6, crew: { operator: 4, engineer: 1 }, opex: 9000, requiresTech: 'gas_to_chemicals', placement: 'land', ports: ['gas', 'product'], storage: { product: 10000 }, emissions: 110, mtbf: 90, flammability: 0.6, order: 3,
  description: 'Steam-methane reforming: dry gas → ammonia and methanol.' });

// ---- Power ------------------------------------------------------------------------------------
b({ id: 'diesel_generator', name: 'Diesel Generator', category: 'power', size: [3, 2, 3], cost: 70_000, buildHours: 4, power: -2, crew: {}, opex: 150, placement: 'land', ports: ['product'], emissions: 20, mtbf: 120, flammability: 0.35, order: 1,
  description: '2 MW genset. Burns diesel from a connected product line — or trucked-in diesel at a premium.' });
b({ id: 'gas_turbine_power', name: 'Gas Turbine Plant', category: 'power', size: [6, 5, 6], cost: 1_800_000, buildHours: 40, power: -25, crew: { operator: 2 }, opex: 1500, placement: 'land', ports: ['gas'], emissions: 90, mtbf: 150, flammability: 0.4, order: 2,
  description: '25 MW turbine burning field gas (raw or dry). Turns stranded gas into power.' });
b({ id: 'solar_farm', name: 'Solar Farm', category: 'power', size: [8, 8, 2], cost: 1_200_000, buildHours: 30, power: -6, crew: {}, opex: 100, requiresTech: 'renewables', placement: 'land', ports: [], mtbf: 900, flammability: 0.05, order: 3,
  description: '6 MW peak; output follows the sun and clouds.' });
b({ id: 'wind_turbine', name: 'Wind Turbine', category: 'power', size: [3, 3, 24], cost: 900_000, buildHours: 24, power: -4, crew: {}, opex: 120, requiresTech: 'renewables', placement: 'land', ports: [], mtbf: 500, flammability: 0.05, order: 4,
  description: '4 MW turbine; output depends on wind speed.' });
b({ id: 'ccs_unit', name: 'Carbon Capture Unit', category: 'environment', size: [6, 6, 10], cost: 5_000_000, buildHours: 80, power: 5, crew: { operator: 2, engineer: 1 }, opex: 4000, requiresTech: 'carbon_capture', placement: 'land', ports: ['gas'], mtbf: 150, flammability: 0.1, order: 2,
  description: 'Captures CO₂ from nearby plants (64 blocks). Earns carbon credits or supplies CO₂ EOR.' });
b({ id: 'spill_response', name: 'Spill Response Base', category: 'environment', size: [5, 4, 3], cost: 200_000, buildHours: 12, power: 0.2, crew: { technician: 3 }, opex: 500, requiresTech: 'leak_detection', placement: 'land', ports: [], mtbf: 500, flammability: 0.05, order: 3,
  description: 'Vac trucks and booms. Cleans spills within 96 blocks and cuts fines.' });

// ---- Offshore ------------------------------------------------------------------------------------
b({ id: 'jackup_rig', name: 'Jack-up Rig', category: 'offshore', size: [9, 9, 22], cost: 6_500_000, buildHours: 60, power: 0, crew: { driller: 2, roughneck: 6, engineer: 1 }, opex: 40000, requiresTech: 'offshore_shallow', placement: 'water', waterDepth: [2, 14], ports: [], emissions: 30, mtbf: 60, flammability: 0.35, order: 1,
  description: 'Self-elevating drilling unit for water depths up to 14 blocks. Wells tie back to a platform.' });
b({ id: 'semi_sub_rig', name: 'Semi-Submersible Rig', category: 'offshore', size: [11, 11, 24], cost: 18_000_000, buildHours: 100, power: 0, crew: { driller: 3, roughneck: 8, engineer: 2 }, opex: 90000, requiresTech: 'offshore_deep', placement: 'water', waterDepth: [8, 60], ports: [], emissions: 45, mtbf: 60, flammability: 0.35, order: 2,
  description: 'Dynamically-positioned deepwater rig.' });
b({ id: 'production_platform', name: 'Production Platform', category: 'offshore', size: [10, 10, 14], cost: 14_000_000, buildHours: 120, power: 0, crew: { operator: 6, technician: 2 }, opex: 35000, requiresTech: 'offshore_shallow', placement: 'water', waterDepth: [2, 20], ports: ['oil', 'gas', 'water'], storage: { oil: 20000, gas: 20000, water: 5000 }, emissions: 60, mtbf: 90, flammability: 0.55, order: 3,
  description: 'Fixed steel jacket with separation, gas turbines and accommodation. Offshore wells within 24 blocks flow here automatically.' });
b({ id: 'fpso', name: 'FPSO', category: 'offshore', size: [8, 22, 12], cost: 40_000_000, buildHours: 180, power: 0, crew: { operator: 8, engineer: 2, technician: 3 }, opex: 80000, requiresTech: 'offshore_deep', placement: 'water', waterDepth: [8, 99], ports: ['oil', 'gas'], storage: { oil: 800000, gas: 30000 }, emissions: 90, mtbf: 90, flammability: 0.55, order: 4,
  description: 'Floating production, storage & offloading vessel. Collects deepwater wells within 40 blocks and offloads crude to shuttle tankers.' });
