// Processing recipes (OWNED BY the Facilities module).
// Rates are per game day at 100% efficiency (full crew, power, condition and throttle = 1).
//
// Balance notes (at ITEMS base prices, before opex/wages/power):
//   gas_plant   ~ +$45k/day vs selling the same raw gas (+$68k vs the 30% raw-gas meter discount)
//   refinery    ~ +$340k/day on 20,000 bbl/d of crude (~$17/bbl margin) — needs a big field & logistics
//   fcc / lube  ~ +$60–70k/day upgrading residue
//   lng_plant   ~ +$440k/day but needs 60,000 mcf/d dry gas, 25 MW and a marine export terminal
//   petrochem   ~ +$150–270k/day on large, power-hungry plants
// Yield modifiers (refinery_yield / petrochem_yield) scale outputs; process_speed scales throughput.
export interface Recipe {
  id: string;
  name: string;
  /** BuildingDef.id that runs this recipe. */
  building: string;
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  /** Extra power draw (MW) beyond the building's base draw. */
  power?: number;
  description?: string;
}

export const RECIPES: Record<string, Recipe> = {};
const r = (d: Recipe) => (RECIPES[d.id] = d);

// ---- Gas processing -----------------------------------------------------------------------------
r({ id: 'gas_cryo', name: 'Cryogenic NGL Recovery', building: 'gas_plant',
  inputs: { natural_gas: 30000 }, outputs: { dry_gas: 25500, ngl: 900, condensate: 150, sulfur: 6 },
  description: 'Amine sweetening, dehydration and turbo-expander: pipeline gas plus a stream of NGLs and condensate.' });
r({ id: 'gas_deep_ethane', name: 'Deep Ethane Recovery', building: 'gas_plant',
  inputs: { natural_gas: 30000 }, outputs: { dry_gas: 24000, ngl: 1400, condensate: 150, sulfur: 6 }, power: 2,
  description: 'Colder demethanizer strips more ethane into the NGL stream. More liquids, more power.' });

// ---- Refining -----------------------------------------------------------------------------------
r({ id: 'refinery_atmospheric', name: 'Atmospheric Distillation', building: 'refinery',
  inputs: { crude_oil: 20000 }, outputs: { gasoline: 8000, diesel: 5200, jet_fuel: 2000, lpg: 1000, asphalt: 450, dry_gas: 1200 },
  description: 'Balanced crude slate: gasoline, diesel, jet, LPG, asphalt residue and refinery fuel gas.' });
r({ id: 'refinery_diesel_max', name: 'Diesel-Max Mode', building: 'refinery',
  inputs: { crude_oil: 20000 }, outputs: { gasoline: 6400, diesel: 7200, jet_fuel: 2400, lpg: 800, asphalt: 450, dry_gas: 1200 }, power: 3,
  description: 'Deeper middle-distillate cut with a hydrocracker pass. Favours diesel and jet over gasoline.' });
r({ id: 'refinery_condensate', name: 'Condensate Splitter', building: 'refinery',
  inputs: { condensate: 20000 }, outputs: { gasoline: 9500, jet_fuel: 2600, lpg: 2400, diesel: 1800 },
  description: 'Splits light condensate into naphtha-rich gasoline, kerosene and LPG. No residue.' });

r({ id: 'fcc_gasoline', name: 'Gasoline Mode', building: 'fcc_unit',
  inputs: { asphalt: 600 }, outputs: { gasoline: 2250, lpg: 450, propylene: 90 },
  description: 'Zeolite catalyst cracks heavy residue into high-octane gasoline.' });
r({ id: 'fcc_propylene', name: 'Max Propylene', building: 'fcc_unit',
  inputs: { asphalt: 600 }, outputs: { gasoline: 1500, lpg: 600, propylene: 160 }, power: 1.5,
  description: 'ZSM-5 additive and severe riser conditions push olefin yields for petrochemicals.' });

r({ id: 'lube_base_oils', name: 'Lube Base Oils', building: 'lube_plant',
  inputs: { asphalt: 400, dry_gas: 1500 }, outputs: { lubricants: 1500, sulfur: 12 },
  description: 'Hydrocracks vacuum residue into premium base oils and greases; hydrogen from dry gas.' });
r({ id: 'lube_jet_hydrotreat', name: 'Diesel → Jet Hydrotreating', building: 'lube_plant',
  inputs: { diesel: 4000, dry_gas: 1000 }, outputs: { jet_fuel: 3950, sulfur: 14 },
  description: 'Desulfurizes and dewaxes diesel into jet fuel. A swing unit for when jet prices spike.' });

r({ id: 'lng_liquefaction', name: 'Liquefaction', building: 'lng_plant',
  inputs: { dry_gas: 60000 }, outputs: { lng: 1150 },
  description: 'Mixed-refrigerant cycle chills methane to −162 °C. LNG sells only at a marine export terminal.' });

// ---- Petrochemicals -----------------------------------------------------------------------------
r({ id: 'cracker_ngl', name: 'NGL Cracking', building: 'steam_cracker',
  inputs: { ngl: 6000 }, outputs: { ethylene: 340, propylene: 130, dry_gas: 2000 },
  description: 'Ethane/propane furnaces make ethylene with propylene and fuel-gas by-products.' });
r({ id: 'cracker_lpg', name: 'LPG Cracking', building: 'steam_cracker',
  inputs: { lpg: 5000 }, outputs: { ethylene: 200, propylene: 170, dry_gas: 1500 },
  description: 'Heavier propane/butane feed: less ethylene, more propylene.' });

r({ id: 'poly_pe', name: 'Polyethylene', building: 'polymer_plant',
  inputs: { ethylene: 400 }, outputs: { polyethylene: 390 },
  description: 'Gas-phase reactors polymerize ethylene into PE pellets.' });
r({ id: 'poly_pp', name: 'Polypropylene', building: 'polymer_plant',
  inputs: { propylene: 400 }, outputs: { polypropylene: 390 },
  description: 'Ziegler–Natta catalysts turn propylene into PP pellets.' });

r({ id: 'ammonia_smr', name: 'Ammonia Synthesis', building: 'ammonia_plant',
  inputs: { dry_gas: 18000 }, outputs: { ammonia: 420 },
  description: 'Steam-methane reforming and Haber–Bosch loop.' });
r({ id: 'methanol_smr', name: 'Methanol Synthesis', building: 'ammonia_plant',
  inputs: { dry_gas: 18000 }, outputs: { methanol: 560 },
  description: 'Syngas over copper catalyst makes methanol.' });

// ---- Environment --------------------------------------------------------------------------------
r({ id: 'water_treat', name: 'Produced Water Treatment', building: 'water_treatment',
  inputs: { produced_water: 6000 }, outputs: { fresh_water: 5400 },
  description: 'De-oiling, softening and reverse osmosis. Reject brine is 10% of feed.' });

r({ id: 'ccs_capture', name: 'Post-Combustion Capture', building: 'ccs_unit',
  inputs: {}, outputs: { co2: 1000 },
  description: 'Amine scrubbers capture up to 1,000 t/day of CO₂ from plants within 64 blocks. Captured CO₂ earns carbon credits, or feeds CO₂ injectors through a gas line (config mode "eor").' });

/** Recipes available for a building type (first one is the default). */
export function recipesFor(buildingType: string): Recipe[] {
  return Object.values(RECIPES).filter((r) => r.building === buildingType);
}

/** Default recipe id for a building type, if it processes anything. */
export function defaultRecipeId(buildingType: string): string | undefined {
  return recipesFor(buildingType)[0]?.id;
}
