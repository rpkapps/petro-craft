// Market event catalogue: world news that moves commodity prices and regional demand.
import type { MarketEvent } from '../../core/types';
import type { Season } from './constants';

export const CRUDE_GROUP = ['crude_oil', 'condensate'];
export const FUELS = ['gasoline', 'diesel', 'jet_fuel'];
export const GAS_GROUP = ['natural_gas', 'dry_gas'];
export const OLEFINS = ['ethylene', 'propylene'];
export const POLYMERS = ['polyethylene', 'polypropylene'];

export interface MarketEventDef {
  id: string;
  title: string;
  description: string;
  severity: MarketEvent['severity'];
  /** Duration range (days). */
  duration: [number, number];
  /** Relative likelihood. */
  weight: number;
  /** Seasons in which the event can happen (all if omitted). */
  seasons?: Season[];
  /** Price multipliers (commodity → ×). */
  effects: Record<string, number>;
  /** Regional demand multipliers (how much volume the market absorbs). */
  demand?: Record<string, number>;
  /** Headline icon hint for the UI. */
  icon: string;
}

const each = (ids: string[], m: number): Record<string, number> => Object.fromEntries(ids.map((i) => [i, m]));

export const MARKET_EVENTS: MarketEventDef[] = [
  {
    id: 'opec_cut', title: 'OPEC+ Production Cut', icon: 'barrel', severity: 'major', duration: [20, 45], weight: 1.0,
    description: 'The cartel surprises traders with a deep supply cut. Crude and fuel prices surge.',
    effects: { ...each(CRUDE_GROUP, 1.18), ...each(FUELS, 1.1), lpg: 1.06, ngl: 1.05 },
  },
  {
    id: 'price_war', title: 'Producer Price War', icon: 'down', severity: 'crisis', duration: [20, 40], weight: 0.6,
    description: 'Two major exporters open the taps to grab market share. Crude collapses.',
    effects: { ...each(CRUDE_GROUP, 0.72), ...each(FUELS, 0.86), lpg: 0.9, ngl: 0.88, asphalt: 0.92 },
    demand: each(CRUDE_GROUP, 0.85),
  },
  {
    id: 'gulf_hurricane', title: 'Hurricane Shuts Gulf Refineries', icon: 'storm', severity: 'major', duration: [7, 14], weight: 1.0, seasons: ['summer', 'autumn'],
    description: 'A major hurricane knocks coastal refineries offline. Fuel prices spike while crude buyers step back.',
    effects: { gasoline: 1.25, diesel: 1.2, jet_fuel: 1.22, ...each(CRUDE_GROUP, 0.95), dry_gas: 1.08, natural_gas: 1.08 },
    demand: { ...each(CRUDE_GROUP, 0.8), ...each(FUELS, 1.3) },
  },
  {
    id: 'cold_snap', title: 'Polar Vortex Cold Snap', icon: 'snow', severity: 'major', duration: [5, 12], weight: 1.4, seasons: ['winter'],
    description: 'Arctic air freezes the region. Utilities scramble for every molecule of gas.',
    effects: { ...each(GAS_GROUP, 1.5), lpg: 1.22, lng: 1.15, diesel: 1.06 },
    demand: { ...each(GAS_GROUP, 1.6), lpg: 1.4 },
  },
  {
    id: 'mild_winter', title: 'Mild Winter', icon: 'sun', severity: 'minor', duration: [18, 30], weight: 1.0, seasons: ['winter'],
    description: 'Balmy temperatures leave gas storage brimming. Heating fuel prices sag.',
    effects: { ...each(GAS_GROUP, 0.75), lpg: 0.88, lng: 0.9 },
    demand: { ...each(GAS_GROUP, 0.8) },
  },
  {
    id: 'refinery_outage', title: 'Major Refinery Outage', icon: 'fire', severity: 'minor', duration: [5, 15], weight: 1.2,
    description: 'A fire at a large regional refinery tightens fuel supply.',
    effects: { gasoline: 1.14, diesel: 1.15, jet_fuel: 1.12, ...each(CRUDE_GROUP, 0.96) },
    demand: { ...each(FUELS, 1.2), ...each(CRUDE_GROUP, 0.9) },
  },
  {
    id: 'recession', title: 'Global Recession', icon: 'down', severity: 'crisis', duration: [40, 80], weight: 0.5,
    description: 'Factories idle and freight volumes plunge. Demand for nearly everything falls.',
    effects: { ...each(CRUDE_GROUP, 0.8), ...each(FUELS, 0.84), ...each(OLEFINS, 0.8), ...each(POLYMERS, 0.8), ...each(GAS_GROUP, 0.9), ammonia: 0.9, methanol: 0.85, asphalt: 0.85, lubricants: 0.88 },
    demand: { ...each(CRUDE_GROUP, 0.8), ...each(FUELS, 0.8), ...each(POLYMERS, 0.75) },
  },
  {
    id: 'boom', title: 'Economic Boom', icon: 'up', severity: 'major', duration: [30, 60], weight: 0.8,
    description: 'Strong growth lifts energy and materials demand across the board.',
    effects: { ...each(CRUDE_GROUP, 1.12), ...each(FUELS, 1.1), ...each(POLYMERS, 1.15), ...each(OLEFINS, 1.1), ...each(GAS_GROUP, 1.08), asphalt: 1.1 },
    demand: { ...each(CRUDE_GROUP, 1.15), ...each(FUELS, 1.15), ...each(POLYMERS, 1.2) },
  },
  {
    id: 'plastics_boom', title: 'Packaging & Plastics Boom', icon: 'up', severity: 'major', duration: [20, 40], weight: 0.8,
    description: 'Consumer goods makers are buying resin hand over fist.',
    effects: { ...each(POLYMERS, 1.3), ...each(OLEFINS, 1.2), ngl: 1.1 },
    demand: { ...each(POLYMERS, 1.4), ...each(OLEFINS, 1.3) },
  },
  {
    id: 'lng_shortage', title: 'Global LNG Shortage', icon: 'ship', severity: 'major', duration: [10, 25], weight: 0.8,
    description: 'Outages at two export trains leave Asian and European buyers short of cargoes.',
    effects: { lng: 1.4, dry_gas: 1.15, natural_gas: 1.12, ammonia: 1.08, methanol: 1.06 },
    demand: { lng: 1.5 },
  },
  {
    id: 'sanctions', title: 'Sanctions on a Major Exporter', icon: 'flag', severity: 'major', duration: [25, 50], weight: 0.7,
    description: 'New sanctions strand millions of barrels a day. Buyers turn to domestic supply.',
    effects: { ...each(CRUDE_GROUP, 1.22), diesel: 1.15, gasoline: 1.08, jet_fuel: 1.1, lng: 1.1 },
    demand: { ...each(CRUDE_GROUP, 1.2) },
  },
  {
    id: 'pipeline_explosion', title: 'Pipeline Explosion in Neighbouring Basin', icon: 'fire', severity: 'minor', duration: [4, 10], weight: 1.0,
    description: 'A rival’s trunk line ruptured. Regional gas and crude supply is tight until repairs finish.',
    effects: { ...each(GAS_GROUP, 1.25), crude_oil: 1.06, condensate: 1.06 },
    demand: { ...each(GAS_GROUP, 1.3), ...each(CRUDE_GROUP, 1.1) },
  },
  {
    id: 'driving_season', title: 'Summer Driving Season', icon: 'car', severity: 'minor', duration: [20, 30], weight: 1.2, seasons: ['summer'],
    description: 'Record road-trip traffic drains gasoline inventories.',
    effects: { gasoline: 1.12, jet_fuel: 1.05 },
    demand: { gasoline: 1.3 },
  },
  {
    id: 'fertilizer_demand', title: 'Planting Season Fertilizer Rush', icon: 'leaf', severity: 'minor', duration: [15, 30], weight: 1.2, seasons: ['spring'],
    description: 'Farmers stock up on nitrogen before planting.',
    effects: { ammonia: 1.25, sulfur: 1.15, methanol: 1.05 },
    demand: { ammonia: 1.4, sulfur: 1.2 },
  },
  {
    id: 'shale_glut', title: 'Shale Glut', icon: 'down', severity: 'major', duration: [25, 45], weight: 0.8,
    description: 'Too many rigs, too many barrels. Storage hubs are overflowing.',
    effects: { ...each(CRUDE_GROUP, 0.85), ...each(GAS_GROUP, 0.8), ngl: 0.85, lpg: 0.9 },
    demand: { ...each(CRUDE_GROUP, 0.85), ...each(GAS_GROUP, 0.85) },
  },
  {
    id: 'airline_strike', title: 'Airline Pilots Strike', icon: 'plane', severity: 'minor', duration: [5, 10], weight: 0.8,
    description: 'Grounded fleets leave jet fuel piling up in storage.',
    effects: { jet_fuel: 0.84 },
    demand: { jet_fuel: 0.6 },
  },
  {
    id: 'road_building', title: 'Infrastructure Bill Passes', icon: 'road', severity: 'minor', duration: [25, 40], weight: 0.9, seasons: ['spring', 'summer'],
    description: 'A wave of paving projects needs asphalt and diesel.',
    effects: { asphalt: 1.25, diesel: 1.05 },
    demand: { asphalt: 1.5 },
  },
  {
    id: 'shipping_crunch', title: 'Tanker Shortage', icon: 'ship', severity: 'minor', duration: [8, 16], weight: 0.8,
    description: 'Freight rates soar as tankers are tied up on long voyages. Inland barrels trade at a discount.',
    effects: { ...each(CRUDE_GROUP, 0.93), lng: 1.12, diesel: 1.04 },
  },
  {
    id: 'chemical_outage', title: 'Cracker Outage on the Coast', icon: 'fire', severity: 'minor', duration: [8, 20], weight: 0.8,
    description: 'Two steam crackers trip offline. Olefin buyers are desperate.',
    effects: { ...each(OLEFINS, 1.28), ...each(POLYMERS, 1.1), ngl: 0.92 },
    demand: { ...each(OLEFINS, 1.4) },
  },
];

export const MARKET_EVENT_BY_ID: Record<string, MarketEventDef> = Object.fromEntries(MARKET_EVENTS.map((e) => [e.id, e]));
