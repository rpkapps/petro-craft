// GameSession: owns one running game — state, world, systems, context and the fixed-step sim loop.
// Presentation (render/player/ui/audio) is attached by the App and reads from session.ctx.
import { EventBus } from './EventBus';
import { CommandBus } from './commands';
import { GAME_MINUTES_PER_REAL_SECOND, GAME_SPEEDS, MINUTES_PER_DAY, SIM_STEP_MS } from './constants';
import { mulberry32Step } from './rng';
import { emptyDaily, getModifier, hasTech } from './state';
import type { GameContext, GameState, IGeology, IWorld, LedgerCategory, NotificationLevel, Services, Settings, SimSystem, Vec3 } from './types';

const MAX_NOTIFICATIONS = 120;
const MAX_LEDGER = 600;

/** Services default to safe no-ops until systems install real implementations in init(). */
function defaultServices(): Services {
  const noImg = () => ({ width: 1, height: 1, data: new Float32Array(1), topY: 0, bottomY: 0, columns: [] });
  return {
    seismic: { getSection: noImg, getDepthSlice: noImg, quote: () => ({ cost: 0, days: 0 }) },
    wells: {
      quote: () => ({ cost: 0, days: 0, warnings: ['Drilling system unavailable'] }),
      suggestPlan: (_x, _z, targetY, kind) => ({ kind, targetY, casingPoints: [], mudWeight: 9 }),
      pressureProfile: () => [],
      planTrajectory: () => [],
    },
    construction: {
      validate: () => ({ ok: false, reason: 'Construction system unavailable', y: 0, cost: 0 }),
      buildingAt: () => undefined,
      footprint: () => [1, 1, 1],
    },
    networks: { networkAt: () => undefined, rebuild: () => {} },
    economy: { netWorth: () => 0, leaseKey: (x, z) => `${Math.floor(x / 32)},${Math.floor(z / 32)}`, leaseQuote: () => ({ price: 0, royalty: 0.125, prospectivity: 0 }) },
  };
}

/** Core time system: advances the clock and fires day/hour rollovers. */
class TimeSystem implements SimSystem {
  id = 'time';
  init(ctx: GameContext) {
    ctx.commands.register('time/setSpeed', (cmd, c) => {
      const s = GAME_SPEEDS.includes(cmd.speed as any) ? cmd.speed : 1;
      c.state.time.speed = s;
      return { ok: true };
    });
    ctx.commands.register('time/setPaused', (cmd, c) => {
      c.state.time.paused = cmd.paused;
      c.bus.emit('game:paused', { paused: cmd.paused });
      return { ok: true };
    });
  }
  tick() {}
}

export class GameSession {
  readonly bus = new EventBus();
  readonly commands = new CommandBus();
  readonly ctx: GameContext;
  readonly systems: SimSystem[];
  private acc = 0;
  private readonly timeSystem = new TimeSystem();
  private disposed = false;

  constructor(
    public state: GameState,
    public world: IWorld,
    public geology: IGeology,
    settings: Settings,
    localPlayerId: string,
    systems: SimSystem[],
    isAuthority = true,
  ) {
    const self = this;
    const ctx: GameContext = {
      state,
      world,
      geology,
      bus: this.bus,
      commands: this.commands,
      services: defaultServices(),
      settings,
      localPlayerId,
      isAuthority,
      rng() {
        const [v, next] = mulberry32Step(self.ctx.state.rngState);
        self.ctx.state.rngState = next;
        return v;
      },
      newId(prefix: string) {
        return `${prefix}${(self.ctx.state.nextId++).toString(36)}`;
      },
      notify(level: NotificationLevel, title: string, text?: string, at?: Vec3) {
        const s = self.ctx.state;
        const n = { id: ctx.newId('n'), day: s.time.day, minute: s.time.minuteOfDay, level, title, text, at, read: false };
        s.notifications.push(n);
        if (s.notifications.length > MAX_NOTIFICATIONS) s.notifications.splice(0, s.notifications.length - MAX_NOTIFICATIONS);
        self.bus.emit('notify', n);
      },
      transact(amount: number, category: LedgerCategory, note: string, requireFunds = false) {
        const s = self.ctx.state;
        const c = s.company;
        if (requireFunds && amount < 0 && c.money + amount < 0 && !s.meta.rules.creative) return false;
        c.money += amount;
        c.ledger.push({ day: s.time.day, minute: Math.floor(s.time.minuteOfDay), amount, category, note });
        if (c.ledger.length > MAX_LEDGER) c.ledger.splice(0, c.ledger.length - MAX_LEDGER);
        if (c.today.day !== s.time.day) {
          if (c.today.day < s.time.day) c.history.push(c.today);
          c.today = emptyDaily(s.time.day);
        }
        if (amount >= 0) c.today.revenue += amount;
        else c.today.expenses -= amount;
        c.today.byCategory[category] = (c.today.byCategory[category] ?? 0) + amount;
        if (amount >= 0) s.stats.totalRevenue += amount;
        else s.stats.totalExpenses -= amount;
        self.bus.emit('money:changed', { amount, balance: c.money, category });
        return true;
      },
      hasTech: (id: string) => hasTech(self.ctx.state, id),
      modifier: (key) => getModifier(self.ctx.state, key),
    };
    this.ctx = ctx;
    this.commands.bind(ctx);
    this.systems = [this.timeSystem, ...systems];
  }

  /** Initialise all systems (after new-game creation or load). */
  init() {
    for (const s of this.systems) {
      try {
        s.init(this.ctx);
      } catch (err) {
        console.error(`[Game] system ${s.id} init failed`, err);
      }
    }
  }

  /** Advance the simulation by real elapsed seconds (called every frame). */
  update(realDt: number) {
    if (this.disposed || !this.ctx.isAuthority) return;
    this.acc += Math.min(realDt, 0.5) * 1000;
    let steps = 0;
    while (this.acc >= SIM_STEP_MS && steps < 5) {
      this.acc -= SIM_STEP_MS;
      steps++;
      this.step();
    }
    if (steps >= 5) this.acc = 0; // avoid spiral of death
  }

  /** One fixed simulation step. */
  step() {
    const st = this.ctx.state;
    if (st.time.paused) return;
    const minutes = GAME_MINUTES_PER_REAL_SECOND * (SIM_STEP_MS / 1000) * st.time.speed;
    const t = st.time;
    const prevHour = Math.floor(t.minuteOfDay / 60);
    t.tick++;
    t.totalMinutes += minutes;
    t.minuteOfDay += minutes;
    let newDay = false;
    if (t.minuteOfDay >= MINUTES_PER_DAY) {
      t.minuteOfDay -= MINUTES_PER_DAY;
      t.day++;
      newDay = true;
    }
    const step = { minutes, days: minutes / MINUTES_PER_DAY };
    if (newDay) {
      // Close the previous day's books BEFORE ticking, so transactions on this step land in the new day.
      const c = st.company;
      if (c.today.day !== t.day) {
        c.history.push(c.today);
        if (c.history.length > 400) c.history.shift();
      }
      c.today = emptyDaily(t.day);
    }
    for (const s of this.systems) {
      try {
        s.tick(this.ctx, step);
      } catch (err) {
        console.error(`[Game] system ${s.id} tick failed`, err);
      }
    }
    const hour = Math.floor(t.minuteOfDay / 60);
    if (hour !== prevHour) this.bus.emit('time:newHour', { day: t.day, hour });
    if (newDay) {
      for (const s of this.systems) {
        try {
          s.onNewDay?.(this.ctx, t.day);
        } catch (err) {
          console.error(`[Game] system ${s.id} onNewDay failed`, err);
        }
      }
      this.bus.emit('time:newDay', { day: t.day });
    }
  }

  dispose() {
    this.disposed = true;
    for (const s of this.systems) s.dispose?.();
    this.bus.emit('game:disposed', {});
    this.bus.clear();
    this.commands.clear();
  }
}
