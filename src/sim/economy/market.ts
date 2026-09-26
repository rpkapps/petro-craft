// Commodity market: correlated mean-reverting prices, seasonal premia, world events, regional
// demand and price impact from the company's own sales.
//
// Log price of commodity i:
//   ln P_i = ln base_i + vol_i · (cC_i·F_crude + cG_i·F_gas + cP_i·F_petchem) + e_i + season_i(t)
//   P_i   ×= Π active event multipliers (eased in/out)
// F_* are Ornstein–Uhlenbeck factors shared across commodities (crude drives crude/condensate and
// refined products; gas drives gas, LNG and gas-derived chemicals; the petchem factor drives olefins
// and polymers, which also track crude loosely). e_i are idiosyncratic OU terms (crack spreads/basis).
// Raw natural gas is quoted at RAW_GAS_FACTOR × dry gas × basis.
import type { GameContext, GameState, MarketEvent } from '../../core/types';
import { ITEMS, TRADABLE_IDS } from '../../content/items';
import { MARKET_EVENTS, MARKET_EVENT_BY_ID, type MarketEventDef } from './marketEvents';
import { DAYS_PER_YEAR, MARKET_DEPTH, MAX_PRICE_IMPACT, PRICE_IMPACT_SLOPE, RAW_GAS_FACTOR, SOLD_HALF_LIFE_DAYS } from './constants';
import { economyState, type EconomyExtState } from './ext';
import { difficulty, fmtMoney, fractionalDay, gauss, ouStep, pct, randInt, seasonOfDay, weightedPick } from './util';

interface PriceModel {
  crude?: number;
  gas?: number;
  petchem?: number;
  /** Idiosyncratic volatility (per sqrt(day)) and mean-reversion rate (1/day). */
  sigma: number;
  theta: number;
  /** Seasonal log premium: amplitude and peak day-of-year (0..119; winter peaks at 105). */
  season?: [number, number];
  /** Price derived from another commodity × factor (basis noise from sigma/theta). */
  derived?: [string, number];
}

const WINTER_PEAK = 105;
const SUMMER_PEAK = 45;
const SPRING_PEAK = 15;

export const PRICE_MODELS: Record<string, PriceModel> = {
  crude_oil: { crude: 1, sigma: 0.004, theta: 0.2 },
  condensate: { crude: 1, sigma: 0.007, theta: 0.15 },
  dry_gas: { gas: 1, sigma: 0.008, theta: 0.2, season: [0.14, WINTER_PEAK] },
  natural_gas: { sigma: 0.006, theta: 0.3, derived: ['dry_gas', RAW_GAS_FACTOR] },
  ngl: { crude: 0.6, gas: 0.3, sigma: 0.012, theta: 0.06 },
  lpg: { crude: 0.7, gas: 0.2, sigma: 0.012, theta: 0.06, season: [0.07, WINTER_PEAK] },
  gasoline: { crude: 0.9, sigma: 0.012, theta: 0.05, season: [0.05, SUMMER_PEAK] },
  diesel: { crude: 0.95, sigma: 0.011, theta: 0.05, season: [0.03, WINTER_PEAK] },
  jet_fuel: { crude: 0.95, sigma: 0.012, theta: 0.05 },
  asphalt: { crude: 0.4, sigma: 0.01, theta: 0.04, season: [0.06, SUMMER_PEAK] },
  lubricants: { crude: 0.5, sigma: 0.008, theta: 0.04 },
  sulfur: { crude: 0.1, sigma: 0.02, theta: 0.04, season: [0.04, SPRING_PEAK] },
  ethylene: { crude: 0.4, gas: 0.1, petchem: 1, sigma: 0.012, theta: 0.05 },
  propylene: { crude: 0.45, petchem: 1, sigma: 0.012, theta: 0.05 },
  polyethylene: { crude: 0.3, petchem: 0.9, sigma: 0.009, theta: 0.04 },
  polypropylene: { crude: 0.3, petchem: 0.9, sigma: 0.009, theta: 0.04 },
  ammonia: { gas: 0.6, sigma: 0.012, theta: 0.05, season: [0.06, SPRING_PEAK] },
  methanol: { gas: 0.5, crude: 0.2, sigma: 0.012, theta: 0.05 },
  lng: { gas: 0.6, crude: 0.3, sigma: 0.012, theta: 0.05, season: [0.1, WINTER_PEAK] },
};
const DEFAULT_MODEL: PriceModel = { crude: 0.3, sigma: 0.012, theta: 0.05 };

/** Common factors: [theta (1/day), sigma (per sqrt(day))]. */
const FACTORS = { crude: [1 / 45, 0.021], gas: [1 / 30, 0.028], petchem: [1 / 60, 0.016] } as const;

const modelOf = (id: string) => PRICE_MODELS[id] ?? DEFAULT_MODEL;
/** Commodities in dependency order (derived prices after their source). */
const ORDERED: string[] = [...TRADABLE_IDS.filter((i) => !modelOf(i).derived), ...TRADABLE_IDS.filter((i) => !!modelOf(i).derived)];

function seasonal(m: PriceModel, yearPos: number): number {
  if (!m.season) return 0;
  const [amp, peak] = m.season;
  return amp * Math.cos((2 * Math.PI * (yearPos - peak)) / DAYS_PER_YEAR);
}

/** Current event multiplier for a commodity (events ease in over 1.5 days and out over the last 2). */
export function eventMultiplier(events: MarketEvent[], id: string, t: number): number {
  let m = 1;
  for (const ev of events) {
    const eff = ev.effects[id];
    if (eff === undefined || eff === 1) continue;
    const rampIn = Math.min(1, Math.max(0, (t - ev.startDay + 1) / 1.5));
    const rampOut = Math.min(1, Math.max(0, (ev.endDay - 1 - t) / 2));
    m *= 1 + (eff - 1) * Math.min(rampIn, rampOut);
  }
  return m;
}

/** The catalogue entry for an active event instance (ids are `${defId}:${startDay}`). */
export function marketEventDef(ev: MarketEvent): MarketEventDef | undefined {
  return MARKET_EVENT_BY_ID[ev.id.split(':')[0]];
}

/** Fundamental price (without events) from factor state. */
function fundamental(ext: EconomyExtState['market'], id: string, yearPos: number, prices: Record<string, number>): number {
  const it = ITEMS[id];
  const m = modelOf(id);
  const idio = ext.idio[id] ?? 0;
  if (m.derived) {
    const [src, f] = m.derived;
    return (prices[src] ?? ITEMS[src].basePrice) * f * Math.exp(idio);
  }
  const vol = it.volatility ?? 1;
  const common = (m.crude ?? 0) * ext.crude + (m.gas ?? 0) * ext.gas + (m.petchem ?? 0) * ext.petchem;
  return it.basePrice * Math.exp(vol * common + idio + seasonal(m, yearPos));
}

function recomputePrices(state: GameState, ext: EconomyExtState['market']) {
  const t = fractionalDay(state);
  const yearPos = ((t % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
  const prices = state.market.prices;
  const fund: Record<string, number> = {};
  for (const id of ORDERED) {
    // Derived commodities follow the source's fundamental price, then apply their own events.
    const base = fundamental(ext, id, yearPos, fund);
    fund[id] = base;
    prices[id] = Math.max(0.01, base * eventMultiplier(state.market.events, id, t));
  }
}

function evolve(ctx: GameContext, ext: EconomyExtState['market'], dt: number, volMult: number) {
  ext.crude = ouStep(ext.crude, 0, FACTORS.crude[0], FACTORS.crude[1] * volMult, dt, gauss(ctx));
  ext.gas = ouStep(ext.gas, 0, FACTORS.gas[0], FACTORS.gas[1] * volMult, dt, gauss(ctx));
  ext.petchem = ouStep(ext.petchem, 0, FACTORS.petchem[0], FACTORS.petchem[1] * volMult, dt, gauss(ctx));
  for (const id of ORDERED) {
    const m = modelOf(id);
    const v = (ITEMS[id].volatility ?? 1) * volMult;
    ext.idio[id] = ouStep(ext.idio[id] ?? 0, 0, m.theta, m.sigma * v, dt, gauss(ctx));
  }
}

/** Fill missing market slices; pre-seed history for a new game. */
export function initMarket(ctx: GameContext, isNew: boolean) {
  const s = ctx.state;
  const mk = s.market;
  mk.prices ??= {};
  mk.history ??= {};
  mk.events ??= [];
  mk.demand ??= {};
  mk.soldToday ??= {};
  mk.hedges ??= [];
  const ext = economyState(s).market;
  for (const id of TRADABLE_IDS) {
    if (!(mk.prices[id] > 0)) mk.prices[id] = ITEMS[id].basePrice;
    if (!Array.isArray(mk.history[id])) mk.history[id] = [];
    if (!(mk.demand[id] > 0)) mk.demand[id] = 1;
    if (!(mk.soldToday[id] >= 0)) mk.soldToday[id] = 0;
  }
  const c = s.company;
  c.autoSell ??= {};
  for (const id of TRADABLE_IDS) c.autoSell[id] ??= { enabled: true, minPrice: 0, keepReserve: 0 };

  if (isNew && mk.history.crude_oil.length === 0) preseedHistory(ctx, ext);
  else recomputePrices(s, ext);
}

/**
 * 60 days of history so charts look alive. The stationary OU process is time-reversible, so we
 * start from today's state (all factors 0 → reference prices) and simulate *backwards*.
 */
function preseedHistory(ctx: GameContext, ext: EconomyExtState['market']) {
  const s = ctx.state;
  const volMult = difficulty(s).priceVolatility;
  const DAYS = 60;
  ext.crude = 0;
  ext.gas = 0;
  ext.petchem = 0;
  ext.idio = {};
  const back = { crude: 0, gas: 0, petchem: 0, idio: {} as Record<string, number>, nextEventDay: 0 };
  const series: Record<string, number[]> = {};
  for (const id of TRADABLE_IDS) series[id] = [];
  for (let d = 0; d < DAYS; d++) {
    const yearPos = (((-d) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
    const fund: Record<string, number> = {};
    for (const id of ORDERED) {
      fund[id] = fundamental(back, id, yearPos, fund);
      series[id].push(round(fund[id]));
    }
    evolve(ctx, back, 1, volMult);
  }
  for (const id of TRADABLE_IDS) s.market.history[id] = series[id].reverse().slice(0, DAYS - 1);
  recomputePrices(s, ext);
}

const round = (v: number) => (v >= 100 ? Math.round(v * 100) / 100 : Math.round(v * 1000) / 1000);

/** Per-step market update. */
export function tickMarket(ctx: GameContext, dt: number) {
  const s = ctx.state;
  const ext = economyState(s).market;
  evolve(ctx, ext, dt, difficulty(s).priceVolatility);
  recomputePrices(s, ext);
  // Our own sales depress the local price; the effect decays with a half-life.
  const decay = Math.pow(0.5, dt / SOLD_HALF_LIFE_DAYS);
  const sold = s.market.soldToday;
  for (const id in sold) sold[id] = sold[id] < 1e-3 ? 0 : sold[id] * decay;
  // Regional demand eases toward the event-driven target.
  const t = fractionalDay(s);
  const k = 1 - Math.exp(-dt * 1.5);
  for (const id of TRADABLE_IDS) {
    const target = demandTarget(s, id, t);
    const cur = s.market.demand[id] ?? 1;
    s.market.demand[id] = cur + (target - cur) * k;
  }
}

function demandTarget(s: GameState, id: string, t: number): number {
  let m = 1;
  for (const ev of s.market.events) {
    const def = marketEventDef(ev);
    const d = def?.demand?.[id];
    if (d !== undefined && t >= ev.startDay && t < ev.endDay) m *= d;
  }
  if ((id === 'dry_gas' || id === 'natural_gas' || id === 'lpg') && seasonOfDay(s.time.day) === 'winter') m *= 1.25;
  return m;
}

/** Local realised-price factor after our recent sales volume (1 = no impact). */
export function priceImpact(s: GameState, id: string, extraUnits = 0): number {
  const depth = (MARKET_DEPTH[id] ?? 5_000) * (s.market.demand[id] ?? 1);
  const load = ((s.market.soldToday[id] ?? 0) + extraUnits) / Math.max(1, depth);
  return Math.max(1 - MAX_PRICE_IMPACT, 1 - PRICE_IMPACT_SLOPE * load);
}

/** Daily: close prices into history, expire & spawn events. */
export function marketNewDay(ctx: GameContext, day: number) {
  const s = ctx.state;
  const ext = economyState(s).market;
  const mk = s.market;
  for (const id of TRADABLE_IDS) {
    const h = (mk.history[id] ??= []);
    h.push(round(mk.prices[id]));
    if (h.length > 365) h.splice(0, h.length - 365);
  }
  // Expire events.
  for (let i = mk.events.length - 1; i >= 0; i--) {
    const ev = mk.events[i];
    if (ev.endDay <= day) {
      mk.events.splice(i, 1);
      ctx.notify('info', `Market: ${ev.title} is over`, 'Prices are drifting back toward fundamentals.');
    }
  }
  if (day >= ext.nextEventDay) {
    if (mk.events.length < 3) startRandomEvent(ctx, day);
    ext.nextEventDay = day + randInt(ctx, 10, 30);
  }
}

export function startMarketEvent(ctx: GameContext, def: MarketEventDef, day: number, durationDays?: number): MarketEvent {
  const s = ctx.state;
  const dur = durationDays ?? randInt(ctx, def.duration[0], def.duration[1]);
  const ev: MarketEvent = {
    id: `${def.id}:${day}`,
    title: def.title,
    description: def.description,
    startDay: day,
    endDay: day + dur,
    effects: { ...def.effects },
    severity: def.severity,
  };
  s.market.events.push(ev);
  ctx.bus.emit('market:event', { id: ev.id, title: ev.title });
  const top = Object.entries(def.effects)
    .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
    .slice(0, 3)
    .map(([id, m]) => `${ITEMS[id]?.name ?? id} ${pct(m)}`)
    .join(', ');
  const level = def.severity === 'crisis' ? 'danger' : def.severity === 'major' ? 'warning' : 'info';
  ctx.notify(level, `Market: ${def.title}`, `${def.description} ${top} for ~${dur} days.`);
  return ev;
}

function startRandomEvent(ctx: GameContext, day: number) {
  const s = ctx.state;
  const season = seasonOfDay(day);
  const active = new Set(s.market.events.map((e) => e.id.split(':')[0]));
  const def = weightedPick(ctx, MARKET_EVENTS, (d) => (active.has(d.id) || (d.seasons && !d.seasons.includes(season)) ? 0 : d.weight));
  if (def) startMarketEvent(ctx, def, day);
}

/** Summary for the UI: % change of a price over the last n days of history. */
export function priceChange(s: GameState, id: string, days = 1): number {
  const h = s.market.history[id];
  if (!h || h.length < days) return 0;
  const ref = h[h.length - days];
  return ref > 0 ? s.market.prices[id] / ref - 1 : 0;
}

/** Format a price with its unit (e.g. "$72.40/bbl"). */
export function formatPrice(id: string, price: number): string {
  const it = ITEMS[id];
  return `${price >= 100 ? fmtMoney(price) : `$${price.toFixed(2)}`}/${it?.unit ?? 'unit'}`;
}
