// Persistent economy bookkeeping that has no slot in the core GameState contract.
// Stored as plain JSON under `state.economy` (saved/loaded with the rest of the state) and
// accessed only through economyState(). Also defines the per-session runtime shared by the
// economy systems (caches, never persisted).
import type { Contract, GameContext, GameState, WeatherKind, Worker } from '../../core/types';
import { BuildingIndex } from './util';

/** A planned weather span (the forecast is read from this plan). */
export interface WeatherSpan { kind: WeatherKind; start: number; end: number; intensity: number }

export interface DailySales { day: number; sold: Record<string, number>; revenue: number }

export interface EconomyExtState {
  version: 1;
  /** New-game setup (starting leases, crew, contracts…) has run. */
  setupDone: boolean;
  /** Index of the last processed game hour (floor(totalMinutes / 60)). */
  hourIdx: number;
  market: {
    /** Common log-price factors (Ornstein–Uhlenbeck). */
    crude: number;
    gas: number;
    petchem: number;
    /** Idiosyncratic log deviations per commodity (crack spreads, basis). */
    idio: Record<string, number>;
    nextEventDay: number;
  };
  sales: {
    /** Revenue waiting to be booked at the next game hour (one ledger entry per category per hour). */
    pending: { sales: number; contracts: number; transport: number; units: Record<string, number>; contractUnits: Record<string, number> };
    /** Units sold per day (last ~30 days) — drives contract offers & objectives. */
    daily: DailySales[];
    /** Lifetime units sold per commodity. */
    totals: Record<string, number>;
    totalRevenue: number;
  };
  contracts: { nextOfferDay: number; completed: number; failed: number; history: { day: number; ok: boolean }[] };
  workforce: { lastIncidentDay: number; incidentCursor: string; hires: number; quits: number; injuries: number; lastHousingWarnDay: number };
  research: { partial: Record<string, number>; bank: number };
  finance: { negativeDays: number; deepNegativeDays: number; insolvent: boolean; lastWarnDay: number; peakNetWorth: number };
  weather: { plan: WeatherSpan[]; tempAnomaly: number; warned: Record<string, boolean>; lastHurricaneDay: number; strikes: number; forecastDays: number };
  environment: { lastViolationDay: number; lastComplaintDay: number; carbonSold: number; incidentCursor: string; lastScoreDelta: number; lastFines: number };
  objectives: { counters: Record<string, number>; lastBlowoutControlledDay: number };
}

export function createEconomyExt(): EconomyExtState {
  return {
    version: 1,
    setupDone: false,
    hourIdx: -1,
    market: { crude: 0, gas: 0, petchem: 0, idio: {}, nextEventDay: 12 },
    sales: { pending: { sales: 0, contracts: 0, transport: 0, units: {}, contractUnits: {} }, daily: [], totals: {}, totalRevenue: 0 },
    contracts: { nextOfferDay: 3, completed: 0, failed: 0, history: [] },
    workforce: { lastIncidentDay: 0, incidentCursor: '', hires: 0, quits: 0, injuries: 0, lastHousingWarnDay: -99 },
    research: { partial: {}, bank: 0 },
    finance: { negativeDays: 0, deepNegativeDays: 0, insolvent: false, lastWarnDay: -99, peakNetWorth: 0 },
    weather: { plan: [], tempAnomaly: 0, warned: {}, lastHurricaneDay: -99, strikes: 0, forecastDays: 3 },
    environment: { lastViolationDay: -99, lastComplaintDay: -99, carbonSold: 0, incidentCursor: '', lastScoreDelta: 0, lastFines: 0 },
    objectives: { counters: {}, lastBlowoutControlledDay: -1 },
  };
}

type WithExt = GameState & { economy?: EconomyExtState };

/** Economy bookkeeping for a state (created / upgraded in place on first access). */
export function economyState(state: GameState): EconomyExtState {
  const s = state as WithExt;
  if (!s.economy || typeof s.economy !== 'object') {
    s.economy = createEconomyExt();
    return s.economy;
  }
  // Fill any missing sub-objects/keys from defaults (forward-compatible saves).
  const d = createEconomyExt() as unknown as Record<string, unknown>;
  const cur = s.economy as unknown as Record<string, unknown>;
  for (const k of Object.keys(d)) {
    if (cur[k] === undefined) cur[k] = d[k];
    else if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) {
      const dk = d[k] as Record<string, unknown>;
      const ck = cur[k] as Record<string, unknown>;
      for (const kk of Object.keys(dk)) if (ck[kk] === undefined) ck[kk] = dk[kk];
    }
  }
  return s.economy;
}

/** Contract with economy-only presentation fields (JSON-safe superset of the core Contract). */
export interface EconomyContract extends Contract {
  /** Flavour text for the contract card. */
  description?: string;
  /** Client category (refiner, utility, airline…) for icons. */
  clientKind?: string;
  /** Requires the Trading Desk (premium_contracts). */
  premium?: boolean;
  /** Day the contract was accepted. */
  acceptedDay?: number;
}

/** Worker with economy-only fields (JSON-safe superset of the core Worker). */
export interface EconomyWorker extends Worker {
  /** Manually assigned by the player: auto-assign never moves this worker. */
  pinned?: boolean;
  /** Days worked (for the UI). */
  daysWorked?: number;
}

/** Per-session runtime shared by the economy systems (never saved). */
export class EconomyRuntime {
  readonly index = new BuildingIndex();
  ctx: GameContext | null = null;
  /** Auto-assign should run on the next tick (hire, building completed, etc.). */
  assignDirty = true;
  /** Objectives should be re-evaluated on the next tick. */
  objectivesDirty = true;
  private nwTick = -1;
  private nwValue = 0;
  unsubs: (() => void)[] = [];

  cachedNetWorth(state: GameState, compute: () => number): number {
    if (state.time.tick !== this.nwTick) {
      this.nwTick = state.time.tick;
      this.nwValue = compute();
    }
    return this.nwValue;
  }
  invalidateNetWorth() {
    this.nwTick = -1;
  }

  dispose() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.ctx = null;
  }
}
