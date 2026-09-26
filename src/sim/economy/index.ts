// Economy module entry: markets, sales, contracts, workforce, research, finance, leases, weather,
// environment and objectives.
//
// createEconomySystems() returns several SimSystems sharing one per-session runtime. The first
// ('economy') performs setup in init(): fills state slices, installs ctx.services.economy,
// registers commands, subscribes to events and — for a new game — grants starting leases, hires
// the starting crew and posts the first contract offers.
import type { GameContext, SimStep, SimSystem } from '../../core/types';
import { DISCOVERY_RESEARCH_BONUS, SURVEY_RESEARCH_BONUS } from './constants';
import { contractsNewDay, initContracts } from './contracts';
import { registerEconomyCommands } from './commands';
import { environmentNewDay, takeNewIncidents } from './environment';
import { EconomyRuntime, economyState } from './ext';
import { computeNetWorth, financeNewDay } from './finance';
import { createLeaseQuoter, grantStartingLeases } from './leases';
import { initMarket, marketNewDay, tickMarket } from './market';
import { bumpCounter, evaluateObjectives, initObjectives } from './objectives';
import { grantResearch, tickResearch } from './research';
import { salesNewDay, tickSales } from './sales';
import { installEconomyServices } from './services';
import { initWeather, tickWeather, weatherNewDay } from './weather';
import { housingCapacity, initWorkforce, sanitizeAssignments, updateIncidentClock, workforceHourly, workforceNewDay } from './workforce';

// ---- Public data & helpers for the UI -------------------------------------------------------------
export { economyState, type EconomyContract, type EconomyWorker, type EconomyExtState } from './ext';
export * from './constants';
export { CLIENTS, CLIENT_KIND_LABEL, type ClientDef, type ClientKind } from './clients';
export { MARKET_EVENTS, type MarketEventDef } from './marketEvents';
export { PRICE_MODELS, marketEventDef, eventMultiplier, priceImpact, priceChange, formatPrice } from './market';
export { SHOP_BLOCKS, blockPrice, supplyPrice, netbackPrice, terminalCapacity, type TerminalSalesData } from './sales';
export { contractWindowDays, offerExpiresDay, contractValue, maxActiveContracts, recentDailySales } from './contracts';
export { ALL_ROLES, crewPriority, housingCapacity, staffing } from './workforce';
export { prereqsMet, researchEta } from './research';
export { buildingBookValue, netWorthBreakdown, loanRate, maxLoan, amortisedPayment, type NetWorthBreakdown } from './finance';
export { leaseKey, parcelKey, parcelCount, parcelInBounds, activeWellsOnParcel, ownsLeaseAt, type LeaseQuote } from './leases';
export { WEATHER_LABEL, seasonalMeanTemp } from './weather';
export { operationsSuspended } from './environment';
export { CHAPTERS, TUTORIAL_STEPS, OBJECTIVE_DEFS, type ChapterDef, type ObjectiveDef, type TutorialStep } from './objectives';
export { ACHIEVEMENTS, ACHIEVEMENT_BY_ID, type AchievementDef } from './achievements';
export { ECONOMY_COMMANDS } from './commands';
export { seasonOfDay, dayOfSeason, dayOfYear } from './util';

/** Objectives are re-evaluated at most every N ticks (1 s real time) unless something changed. */
const OBJECTIVE_INTERVAL_TICKS = 10;

export function createEconomySystems(): SimSystem[] {
  const rt = new EconomyRuntime();
  const hourOf = (ctx: GameContext) => Math.floor(ctx.state.time.totalMinutes / 60);
  let weatherHour = -1;
  let workforceHour = -1;
  let lastObjectiveTick = -1;

  const core: SimSystem = {
    id: 'economy',
    init(ctx) {
      rt.dispose();
      rt.ctx = ctx;
      rt.index.invalidate();
      const s = ctx.state;
      const ext = economyState(s);
      const isNew = s.time.tick === 0 && !ext.setupDone;

      const quote = createLeaseQuoter(() => rt.ctx);
      installEconomyServices(ctx, rt, quote);
      registerEconomyCommands(ctx, rt, quote);
      initMarket(ctx, isNew);
      s.leases ??= {};
      s.workforce.workers ??= [];
      s.workforce.candidates ??= [];
      s.research.queue ??= [];
      if (isNew) {
        grantStartingLeases(ctx, quote);
        initWorkforce(ctx, rt);
        initContracts(ctx);
        // Past incidents (none in a new game) must not count against the environment.
        takeNewIncidents(s, ext.environment);
      }
      initWeather(ctx, rt, isNew);
      initObjectives(ctx, isNew);
      sanitizeAssignments(s);
      s.workforce.housing = housingCapacity(s, rt);
      updateIncidentClock(s);
      ext.setupDone = true;
      if (ext.hourIdx < 0) ext.hourIdx = hourOf(ctx);
      weatherHour = workforceHour = hourOf(ctx);
      rt.assignDirty = true;
      rt.objectivesDirty = true;
      subscribe(ctx);
    },
    tick() {},
    dispose() {
      rt.dispose();
    },
  };

  function subscribe(ctx: GameContext) {
    const bus = ctx.bus;
    const auth = () => ctx.isAuthority;
    const structural = () => {
      rt.index.invalidate();
      rt.assignDirty = true;
      rt.objectivesDirty = true;
      rt.invalidateNetWorth();
    };
    rt.unsubs.push(
      bus.on('building:placed', structural),
      bus.on('building:completed', structural),
      bus.on('building:removed', structural),
      bus.on('building:statusChanged', (e) => {
        if (e.status === 'destroyed' || e.prev === 'destroyed' || e.status === 'disabled' || e.prev === 'disabled') structural();
      }),
      bus.on('well:discovery', () => auth() && grantResearch(ctx, DISCOVERY_RESEARCH_BONUS)),
      bus.on('survey:completed', () => {
        if (!auth()) return;
        grantResearch(ctx, SURVEY_RESEARCH_BONUS);
        rt.objectivesDirty = true;
      }),
      bus.on('well:blowoutControlled', () => auth() && bumpCounter(ctx, 'blowoutsControlled')),
      bus.on('well:statusChanged', () => (rt.objectivesDirty = true)),
      bus.on('ui:open', (e) => {
        if (!auth()) return;
        if (e.panel === 'map') bumpCounter(ctx, 'mapOpened');
        if (e.panel === 'leases') bumpCounter(ctx, 'leasesViewed');
        rt.objectivesDirty = true;
      }),
      bus.on('ui:overlay', (e) => {
        if (!auth() || e.overlay !== 'leases') return;
        bumpCounter(ctx, 'leasesViewed');
        rt.objectivesDirty = true;
      }),
      bus.on('research:started', () => auth() && bumpCounter(ctx, 'researchStarted')),
      ctx.commands.observe((cmd, res) => {
        // Movement/block spam must not force objective re-evaluation every tick.
        if (!res.ok || !auth() || cmd.type.startsWith('player/') || cmd.type.startsWith('world/') || cmd.type.startsWith('time/')) return;
        if (cmd.type === 'worker/hire') bumpCounter(ctx, 'hires');
        else if (cmd.type === 'lease/buy') bumpCounter(ctx, 'leasesBought');
        else if (cmd.type === 'well/setMudWeight') bumpCounter(ctx, 'mudWeightSet');
        rt.objectivesDirty = true;
      }),
    );
  }

  const weather: SimSystem = {
    id: 'economy.weather',
    init() {},
    tick(ctx, step: SimStep) {
      const h = hourOf(ctx);
      const newHour = h !== weatherHour;
      weatherHour = h;
      tickWeather(ctx, rt, step.minutes, newHour);
    },
    onNewDay: (ctx, day) => weatherNewDay(ctx, day),
  };

  const market: SimSystem = {
    id: 'economy.market',
    init() {},
    tick: (ctx, step) => tickMarket(ctx, step.days),
    onNewDay: (ctx, day) => marketNewDay(ctx, day),
  };

  const sales: SimSystem = {
    id: 'economy.sales',
    init() {},
    tick: (ctx, step) => tickSales(ctx, rt, step.days),
    onNewDay(ctx, day) {
      salesNewDay(ctx, day);
      contractsNewDay(ctx, day);
    },
  };

  const workforce: SimSystem = {
    id: 'economy.workforce',
    init() {},
    tick(ctx) {
      const h = hourOf(ctx);
      if (h !== workforceHour || rt.assignDirty) {
        workforceHour = h;
        workforceHourly(ctx, rt);
      }
    },
    onNewDay: (ctx, day) => workforceNewDay(ctx, rt, day),
  };

  const research: SimSystem = {
    id: 'economy.research',
    init() {},
    tick: (ctx, step) => tickResearch(ctx, rt, step.days),
  };

  const finance: SimSystem = {
    id: 'economy.finance',
    init() {},
    tick() {},
    onNewDay: (ctx, day) => financeNewDay(ctx, rt, day),
  };

  const environment: SimSystem = {
    id: 'economy.environment',
    init() {},
    tick() {},
    onNewDay: (ctx, day) => environmentNewDay(ctx, rt, day),
  };

  const objectives: SimSystem = {
    id: 'economy.objectives',
    init() {},
    tick(ctx) {
      const t = ctx.state.time.tick;
      if (!rt.objectivesDirty && t - lastObjectiveTick < OBJECTIVE_INTERVAL_TICKS) return;
      lastObjectiveTick = t;
      rt.objectivesDirty = false;
      evaluateObjectives(ctx, rt.cachedNetWorth(ctx.state, () => computeNetWorth(ctx.state)));
    },
    onNewDay() {
      rt.objectivesDirty = true;
    },
  };

  return [core, weather, market, sales, workforce, research, finance, environment, objectives];
}
