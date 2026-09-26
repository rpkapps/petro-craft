// Fictional contract clients. Each client buys a set of commodities; flavour templates are filled with
// {qty}, {unit}, {item}, {days} and {client}.

export type ClientKind = 'refiner' | 'utility' | 'airline' | 'chemical' | 'city' | 'shipping' | 'reserve' | 'distributor' | 'agriculture' | 'trader' | 'industrial';

export interface ClientDef {
  name: string;
  kind: ClientKind;
  commodities: string[];
  /** Premium clients (large, high-margin deals) require the Trading Desk. */
  premium?: boolean;
  /** Minimum reputation this client ever asks for. */
  minRep: number;
  flavour: string[];
}

export const CLIENT_KIND_LABEL: Record<ClientKind, string> = {
  refiner: 'Refiner', utility: 'Utility', airline: 'Airline', chemical: 'Chemicals', city: 'Municipal', shipping: 'Shipping line',
  reserve: 'Strategic reserve', distributor: 'Fuel distributor', agriculture: 'Agriculture', trader: 'Trading house', industrial: 'Industrial',
};

export const CLIENTS: ClientDef[] = [
  // Refiners
  { name: 'Gulfhaven Refining Co.', kind: 'refiner', commodities: ['crude_oil', 'condensate'], minRep: 0,
    flavour: ['Gulfhaven’s crude unit is running below capacity. They want {qty} {unit} of {item} within {days} days.', 'A turnaround just finished at Gulfhaven and the tanks are empty. Fill them.'] },
  { name: 'Redstone Petroleum Refinery', kind: 'refiner', commodities: ['crude_oil'], minRep: 10,
    flavour: ['Redstone is blending for a light-sweet slate and will pay a premium for local barrels.', 'Redstone’s pipeline supplier just declared force majeure. They need barrels, fast.'] },
  { name: 'Bayou Crest Refining', kind: 'refiner', commodities: ['crude_oil', 'condensate', 'ngl'], minRep: 20,
    flavour: ['Bayou Crest needs feedstock for their new splitter.', 'Bayou Crest is building inventory ahead of hurricane season.'] },
  { name: 'Prairie Sun Splitter', kind: 'refiner', commodities: ['condensate', 'ngl'], minRep: 0,
    flavour: ['A small condensate splitter on the prairie needs steady feed.'] },
  // Utilities
  { name: 'Northern Plains Power & Light', kind: 'utility', commodities: ['dry_gas', 'natural_gas'], minRep: 10,
    flavour: ['NPP&L is topping up storage before the cold months. {qty} {unit} of {item}, please.', 'A heat wave is straining the grid; NPP&L needs gas for its peaker plants.'] },
  { name: 'Cascadia Gas Utility', kind: 'utility', commodities: ['dry_gas'], minRep: 25,
    flavour: ['Cascadia is diversifying suppliers after a pipeline outage last winter.'] },
  { name: 'Tri-County Electric Cooperative', kind: 'utility', commodities: ['natural_gas', 'dry_gas', 'diesel'], minRep: 0,
    flavour: ['The co-op runs small gas gensets for three rural counties and wants a local supplier.'] },
  { name: 'Harbor City Heating Authority', kind: 'utility', commodities: ['lpg', 'dry_gas'], minRep: 15,
    flavour: ['Harbor City’s district heating plant needs fuel for the season.'] },
  // Airlines
  { name: 'Skyward Airlines', kind: 'airline', commodities: ['jet_fuel'], minRep: 20,
    flavour: ['Skyward is adding routes out of the regional hub and needs jet fuel at the airport farm.'] },
  { name: 'TransPolar Air', kind: 'airline', commodities: ['jet_fuel'], minRep: 35,
    flavour: ['TransPolar’s long-haul fleet burns through {qty} {unit} a month. Can you keep up?'] },
  { name: 'Meridian Air Cargo', kind: 'airline', commodities: ['jet_fuel', 'diesel'], minRep: 10,
    flavour: ['Meridian’s overnight parcel fleet needs fuel at the cargo apron.'] },
  // Chemical companies
  { name: 'Helix Polymers', kind: 'chemical', commodities: ['ethylene', 'propylene', 'polyethylene', 'polypropylene'], minRep: 30,
    flavour: ['Helix is launching a new film line and needs resin by the railcar.', 'Helix’s cracker is down for maintenance. They’ll buy your olefins.'] },
  { name: 'Vantage Chemical', kind: 'chemical', commodities: ['methanol', 'ammonia', 'sulfur', 'ngl'], minRep: 20,
    flavour: ['Vantage makes formaldehyde, acetic acid and a thousand other things. It all starts with your molecules.'] },
  { name: 'NovaCarb Industries', kind: 'chemical', commodities: ['ethylene', 'propylene', 'lpg', 'ngl'], minRep: 25,
    flavour: ['NovaCarb’s derivatives plant is hungry for feedstock.'] },
  { name: 'Lumen Lubricants GmbH', kind: 'chemical', commodities: ['lubricants', 'sulfur'], minRep: 15,
    flavour: ['A European blender wants base oils for its premium motor-oil line.'] },
  // Cities & public bodies
  { name: 'City of Port Aurelia', kind: 'city', commodities: ['asphalt', 'diesel'], minRep: 10,
    flavour: ['Port Aurelia is repaving its waterfront boulevard.', 'The city’s bus fleet needs diesel for the year.'] },
  { name: 'Silver Creek County Roads Dept.', kind: 'city', commodities: ['asphalt'], minRep: 0,
    flavour: ['Potholes everywhere. The county needs asphalt before the frost comes back.'] },
  { name: 'Grand Mesa Transit Authority', kind: 'city', commodities: ['diesel', 'dry_gas'], minRep: 15,
    flavour: ['Grand Mesa runs buses on diesel and CNG. Both are welcome.'] },
  // Shipping lines
  { name: 'Oceanic Blue Line', kind: 'shipping', commodities: ['diesel', 'lng'], minRep: 30,
    flavour: ['Oceanic Blue’s new dual-fuel container ships bunker at the regional port.'] },
  { name: 'Tidewater Container Lines', kind: 'shipping', commodities: ['diesel', 'lubricants'], minRep: 15,
    flavour: ['Tidewater needs marine gasoil and cylinder oil for its feeder vessels.'] },
  { name: 'Kestrel Bulk Shipping', kind: 'shipping', commodities: ['diesel', 'lng'], minRep: 20,
    flavour: ['Kestrel’s bulkers refuel on the way to the grain terminals.'] },
  // Strategic reserves (premium)
  { name: 'National Strategic Petroleum Reserve', kind: 'reserve', commodities: ['crude_oil'], premium: true, minRep: 45,
    flavour: ['The government is refilling the strategic reserve and pays well for reliable delivery.'] },
  { name: 'Federal Energy Security Agency', kind: 'reserve', commodities: ['crude_oil', 'diesel', 'jet_fuel'], premium: true, minRep: 55,
    flavour: ['FESA is building an emergency fuel stockpile for disaster response.'] },
  { name: 'Republic of Karvonia Strategic Reserve', kind: 'reserve', commodities: ['crude_oil', 'lng'], premium: true, minRep: 50,
    flavour: ['A small nation with no oil of its own wants a long-term friend in the business.'] },
  // Distributors
  { name: 'Roadrunner Fuel Stops', kind: 'distributor', commodities: ['gasoline', 'diesel', 'lpg'], minRep: 5,
    flavour: ['Roadrunner runs 140 truck stops along the interstate.', 'Roadrunner’s summer promo is a hit and their tanks are running dry.'] },
  { name: 'Quickfill Distribution', kind: 'distributor', commodities: ['gasoline', 'diesel'], minRep: 0,
    flavour: ['A regional jobber supplying independent gas stations.'] },
  { name: 'Blue Flame Propane', kind: 'distributor', commodities: ['lpg'], minRep: 0,
    flavour: ['Blue Flame delivers propane to farms and cabins across the valley.'] },
  // Agriculture
  { name: 'Prairie Harvest Fertilizers', kind: 'agriculture', commodities: ['ammonia', 'sulfur'], minRep: 10,
    flavour: ['Planting season is coming and Prairie Harvest needs nitrogen.'] },
  { name: 'GreenAcre Cooperative', kind: 'agriculture', commodities: ['ammonia', 'diesel', 'lpg'], minRep: 0,
    flavour: ['Two thousand family farms pool their fuel and fertilizer buying.'] },
  // Trading houses (premium)
  { name: 'Arcturus Commodities Trading', kind: 'trader', commodities: ['crude_oil', 'condensate', 'lng', 'diesel', 'gasoline', 'polyethylene'], premium: true, minRep: 40,
    flavour: ['Arcturus has a cargo to fill for an Asian buyer and will pay up for speed.', 'Arcturus is arbitraging a price gap and needs physical barrels.'] },
  { name: 'Meridian Energy Partners', kind: 'trader', commodities: ['dry_gas', 'lng', 'crude_oil'], premium: true, minRep: 45,
    flavour: ['A Geneva trading house building a book of physical supply.'] },
  // Industrial
  { name: 'Ironvale Steelworks', kind: 'industrial', commodities: ['dry_gas', 'natural_gas', 'sulfur'], minRep: 5,
    flavour: ['Ironvale’s reheat furnaces burn gas around the clock.'] },
  { name: 'Canyon Glass & Ceramics', kind: 'industrial', commodities: ['dry_gas', 'lpg'], minRep: 0,
    flavour: ['Glass furnaces must never go cold. Canyon wants a reliable local supplier.'] },
  { name: 'Summit Mining Co.', kind: 'industrial', commodities: ['diesel', 'sulfur'], minRep: 10,
    flavour: ['Haul trucks at the Summit open-pit burn diesel by the tanker load.'] },
];

/** Contract titles per commodity (varied). */
export const CONTRACT_TITLES: Record<string, string[]> = {
  crude_oil: ['Crude supply agreement', 'Spot crude cargo', 'Feedstock top-up', 'Term crude contract'],
  condensate: ['Condensate supply', 'Diluent contract'],
  natural_gas: ['Wellhead gas purchase', 'Raw gas offtake'],
  dry_gas: ['Firm gas supply', 'Winter storage fill', 'Peaking gas contract'],
  ngl: ['NGL feedstock', 'Y-grade offtake'],
  lpg: ['Propane season supply', 'LPG delivery'],
  gasoline: ['Rack gasoline supply', 'Summer-grade gasoline'],
  diesel: ['ULSD supply', 'Fleet diesel contract'],
  jet_fuel: ['Airport fuel farm supply', 'Jet A delivery'],
  asphalt: ['Paving season asphalt', 'Road-building asphalt'],
  lubricants: ['Base oil supply'],
  sulfur: ['Sulfur offtake', 'Prilled sulfur supply'],
  ethylene: ['Ethylene feedstock'],
  propylene: ['Polymer-grade propylene'],
  polyethylene: ['PE resin supply', 'Film-grade resin'],
  polypropylene: ['PP resin supply'],
  ammonia: ['Anhydrous ammonia supply'],
  methanol: ['Methanol offtake'],
  lng: ['LNG cargo', 'Spot LNG delivery'],
};
