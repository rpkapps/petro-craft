// Item & commodity catalogue. Item ids are stable strings used in saves.
// - 'fluid'/'product': commodities that flow through networks/tanks and are traded.
// - 'supply': oilfield consumables kept in the company warehouse (drilling/maintenance).
// - 'tool': hand-held tools in the player hotbar.
// Block items use ids "block:<blockKey>" and are derived from the block registry (not listed here).

export type ItemKind = 'fluid' | 'product' | 'supply' | 'tool';
/** Pipe network category a commodity travels in. */
export type FluidCategory = 'oil' | 'gas' | 'water' | 'product';

export interface ItemDef {
  id: string;
  name: string;
  kind: ItemKind;
  unit: string; // bbl, mcf, t, ea, sk, MWh
  /** Reference market price per unit in USD (markets fluctuate around this). */
  basePrice: number;
  /** Network category (fluids/products only). */
  category?: FluidCategory;
  /** Swatch colour for UI & pipe/tank tints. */
  color: string;
  description: string;
  /** Whether it can be sold on the open market. */
  tradable: boolean;
  /** Tool properties. */
  tool?: { toolClass: 'pickaxe' | 'shovel' | 'axe' | 'wrench' | 'extinguisher' | 'scanner' | 'detector' | 'tablet'; speed: number };
  /** Price volatility factor (1 = normal). */
  volatility?: number;
}

export const ITEMS: Record<string, ItemDef> = {};
const def = (d: ItemDef) => (ITEMS[d.id] = d);

// ---- Upstream fluids ------------------------------------------------------------------------
def({ id: 'crude_oil', name: 'Crude Oil', kind: 'fluid', unit: 'bbl', basePrice: 72, category: 'oil', color: '#2a1d10', tradable: true, volatility: 1.0, description: 'Unrefined petroleum from the reservoir. Sell at terminals or refine into fuels.' });
def({ id: 'condensate', name: 'Condensate', kind: 'fluid', unit: 'bbl', basePrice: 66, category: 'oil', color: '#c9a44a', tradable: true, volatility: 1.0, description: 'Light liquid hydrocarbons that drop out of rich gas. Blends with crude.' });
def({ id: 'natural_gas', name: 'Raw Natural Gas', kind: 'fluid', unit: 'mcf', basePrice: 2.6, category: 'gas', color: '#9fd3ff', tradable: true, volatility: 1.4, description: 'Wet, unprocessed wellhead gas. Sells at a discount; process it into pipeline-quality dry gas.' });
def({ id: 'produced_water', name: 'Produced Water', kind: 'fluid', unit: 'bbl', basePrice: -1.5, category: 'water', color: '#4a7a8c', tradable: false, description: 'Brine co-produced with oil. Must be disposed of, treated, or reinjected.' });
def({ id: 'fresh_water', name: 'Treated Water', kind: 'fluid', unit: 'bbl', basePrice: 0.5, category: 'water', color: '#5ab8e6', tradable: false, description: 'Treated water for waterflooding, fracking and process use.' });
def({ id: 'co2', name: 'CO₂', kind: 'fluid', unit: 't', basePrice: 15, category: 'gas', color: '#c8c8c8', tradable: false, description: 'Captured carbon dioxide. Inject for enhanced oil recovery or sequestration credits.' });

// ---- Midstream / downstream products ---------------------------------------------------------
def({ id: 'dry_gas', name: 'Dry Gas (Methane)', kind: 'product', unit: 'mcf', basePrice: 3.4, category: 'gas', color: '#6fc3ff', tradable: true, volatility: 1.5, description: 'Pipeline-quality natural gas. Feeds power plants, LNG trains and ammonia plants.' });
def({ id: 'ngl', name: 'Natural Gas Liquids', kind: 'product', unit: 'bbl', basePrice: 28, category: 'product', color: '#e0c060', tradable: true, description: 'Ethane, propane and butane mix. Crack it into olefins.' });
def({ id: 'lpg', name: 'LPG', kind: 'product', unit: 'bbl', basePrice: 38, category: 'product', color: '#f0a060', tradable: true, description: 'Liquefied petroleum gas — propane & butane for heating and cooking.' });
def({ id: 'gasoline', name: 'Gasoline', kind: 'product', unit: 'bbl', basePrice: 98, category: 'product', color: '#f2d94e', tradable: true, description: 'Motor gasoline. High-value refinery product.' });
def({ id: 'diesel', name: 'Diesel', kind: 'product', unit: 'bbl', basePrice: 105, category: 'product', color: '#d9a13a', tradable: true, description: 'Ultra-low sulfur diesel. Also powers generators and trucks.' });
def({ id: 'jet_fuel', name: 'Jet Fuel', kind: 'product', unit: 'bbl', basePrice: 110, category: 'product', color: '#b0d0f0', tradable: true, description: 'Kerosene-type aviation fuel.' });
def({ id: 'asphalt', name: 'Asphalt', kind: 'product', unit: 't', basePrice: 420, category: 'product', color: '#1a1a1a', tradable: true, description: 'Heavy residue. Paves roads — or crack it into lighter products.' });
def({ id: 'lubricants', name: 'Lubricants', kind: 'product', unit: 'bbl', basePrice: 160, category: 'product', color: '#8a6a2a', tradable: true, description: 'Base oils and greases.' });
def({ id: 'sulfur', name: 'Sulfur', kind: 'product', unit: 't', basePrice: 110, category: 'product', color: '#f2e21e', tradable: true, description: 'Recovered from sour gas. Fertilizer and chemical feedstock.' });
def({ id: 'ethylene', name: 'Ethylene', kind: 'product', unit: 't', basePrice: 900, category: 'product', color: '#d0f0d0', tradable: true, description: 'The building block of plastics.' });
def({ id: 'propylene', name: 'Propylene', kind: 'product', unit: 't', basePrice: 950, category: 'product', color: '#f0d0f0', tradable: true, description: 'Olefin feedstock for polypropylene.' });
def({ id: 'polyethylene', name: 'Polyethylene', kind: 'product', unit: 't', basePrice: 1350, category: 'product', color: '#ffffff', tradable: true, description: 'The world’s most common plastic.' });
def({ id: 'polypropylene', name: 'Polypropylene', kind: 'product', unit: 't', basePrice: 1400, category: 'product', color: '#e8e0ff', tradable: true, description: 'Tough engineering plastic.' });
def({ id: 'ammonia', name: 'Ammonia', kind: 'product', unit: 't', basePrice: 520, category: 'product', color: '#a0f0e0', tradable: true, description: 'Made from methane. The basis of nitrogen fertilizers.' });
def({ id: 'methanol', name: 'Methanol', kind: 'product', unit: 't', basePrice: 380, category: 'product', color: '#c0e0ff', tradable: true, description: 'Gas-derived chemical and fuel.' });
def({ id: 'lng', name: 'LNG', kind: 'product', unit: 't', basePrice: 560, category: 'product', color: '#9ae0ff', tradable: true, volatility: 1.3, description: 'Liquefied natural gas for export by ship. Sold only at marine terminals.' });

// ---- Oilfield supplies (company warehouse) ----------------------------------------------------
def({ id: 'drill_pipe', name: 'Drill Pipe', kind: 'supply', unit: 'jt', basePrice: 1800, color: '#8b9299', tradable: false, description: 'Joints of drill pipe. Worn and lost over time.' });
def({ id: 'casing', name: 'Casing', kind: 'supply', unit: 'jt', basePrice: 2400, color: '#9aa1a8', tradable: false, description: 'Steel casing joints cemented into the wellbore.' });
def({ id: 'cement', name: 'Cement', kind: 'supply', unit: 'sk', basePrice: 22, color: '#c8c8c8', tradable: false, description: 'Oilwell cement for casing jobs.' });
def({ id: 'drilling_mud', name: 'Drilling Mud', kind: 'supply', unit: 'bbl', basePrice: 60, color: '#8a6a4a', tradable: false, description: 'Weighted drilling fluid. Controls formation pressure.' });
def({ id: 'barite', name: 'Barite', kind: 'supply', unit: 't', basePrice: 240, color: '#d0c8c0', tradable: false, description: 'Weighting agent to raise mud density during a kick.' });
def({ id: 'drill_bit', name: 'Drill Bit', kind: 'supply', unit: 'ea', basePrice: 28000, color: '#c0a060', tradable: false, description: 'PDC and tricone bits. Wear out faster in hard rock.' });
def({ id: 'proppant', name: 'Frac Sand', kind: 'supply', unit: 't', basePrice: 45, color: '#e0c890', tradable: false, description: 'Proppant that holds hydraulic fractures open.' });
def({ id: 'chemicals', name: 'Production Chemicals', kind: 'supply', unit: 'bbl', basePrice: 150, color: '#70c070', tradable: false, description: 'Corrosion inhibitors, demulsifiers, H₂S scavengers.' });
def({ id: 'spare_parts', name: 'Spare Parts', kind: 'supply', unit: 'ea', basePrice: 3500, color: '#f0a030', tradable: false, description: 'Valves, seals, bearings. Consumed by maintenance and repairs.' });
def({ id: 'steel', name: 'Structural Steel', kind: 'supply', unit: 't', basePrice: 900, color: '#707880', tradable: false, description: 'Used in construction of large facilities.' });

// ---- Tools --------------------------------------------------------------------------------------
def({ id: 'tool:pickaxe', name: 'Steel Pickaxe', kind: 'tool', unit: 'ea', basePrice: 0, color: '#9aa1a8', tradable: false, tool: { toolClass: 'pickaxe', speed: 4 }, description: 'Breaks stone and rock.' });
def({ id: 'tool:shovel', name: 'Shovel', kind: 'tool', unit: 'ea', basePrice: 0, color: '#9aa1a8', tradable: false, tool: { toolClass: 'shovel', speed: 4 }, description: 'Digs dirt, sand and gravel.' });
def({ id: 'tool:axe', name: 'Axe', kind: 'tool', unit: 'ea', basePrice: 0, color: '#9aa1a8', tradable: false, tool: { toolClass: 'axe', speed: 4 }, description: 'Chops wood.' });
def({ id: 'tool:wrench', name: 'Pipe Wrench', kind: 'tool', unit: 'ea', basePrice: 0, color: '#d04a2a', tradable: false, tool: { toolClass: 'wrench', speed: 1 }, description: 'Hold on equipment to perform hands-on repairs.' });
def({ id: 'tool:extinguisher', name: 'Fire Extinguisher', kind: 'tool', unit: 'ea', basePrice: 0, color: '#e02a2a', tradable: false, tool: { toolClass: 'extinguisher', speed: 1 }, description: 'Spray on fires to put them out.' });
def({ id: 'tool:scanner', name: 'Geo Scanner', kind: 'tool', unit: 'ea', basePrice: 0, color: '#2ad0e0', tradable: false, tool: { toolClass: 'scanner', speed: 1 }, description: 'Handheld gravity/magnetic scanner. Reveals shallow anomalies under the cursor.' });
def({ id: 'tool:detector', name: 'Gas Detector', kind: 'tool', unit: 'ea', basePrice: 0, color: '#f0d020', tradable: false, tool: { toolClass: 'detector', speed: 1 }, description: 'Detects gas leaks and H₂S. Beeps faster near danger.' });
def({ id: 'tool:tablet', name: 'Field Tablet', kind: 'tool', unit: 'ea', basePrice: 0, color: '#303a48', tradable: false, tool: { toolClass: 'tablet', speed: 1 }, description: 'Right-click any building or well to inspect it remotely.' });

export const COMMODITY_IDS = Object.values(ITEMS).filter((i) => i.kind === 'fluid' || i.kind === 'product').map((i) => i.id);
export const TRADABLE_IDS = Object.values(ITEMS).filter((i) => i.tradable).map((i) => i.id);
export const SUPPLY_IDS = Object.values(ITEMS).filter((i) => i.kind === 'supply').map((i) => i.id);
