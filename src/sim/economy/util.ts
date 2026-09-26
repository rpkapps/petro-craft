// Small shared helpers for the economy systems (deterministic randomness, calendar, formatting,
// a per-tick building index).
import type { BuildingState, GameContext, GameState } from '../../core/types';
import { DIFFICULTY_SETTINGS } from '../../core/constants';
import { DAYS_PER_SEASON, DAYS_PER_YEAR, SEASONS, type Season } from './constants';

// ---- Deterministic randomness (ONLY via ctx.rng) --------------------------------------------------

export function rand(ctx: GameContext, a = 0, b = 1): number {
  return a + (b - a) * ctx.rng();
}

export function randInt(ctx: GameContext, a: number, b: number): number {
  return Math.min(b, Math.floor(a + (b - a + 1) * ctx.rng()));
}

export function chance(ctx: GameContext, p: number): boolean {
  return p > 0 && ctx.rng() < p;
}

/** Standard normal sample (Box–Muller). */
export function gauss(ctx: GameContext): number {
  const u = Math.max(1e-12, ctx.rng());
  const v = ctx.rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(ctx: GameContext, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(ctx.rng() * arr.length))];
}

export function weightedPick<T>(ctx: GameContext, items: readonly T[], weight: (t: T) => number): T | undefined {
  let total = 0;
  for (const it of items) total += Math.max(0, weight(it));
  if (total <= 0) return undefined;
  let r = ctx.rng() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}

/**
 * Exact Ornstein–Uhlenbeck update for x over dt (days): mean-reverting to mu at rate theta with
 * instantaneous volatility sigma (per sqrt(day)). Stable for any dt.
 */
export function ouStep(x: number, mu: number, theta: number, sigma: number, dt: number, z: number): number {
  const e = Math.exp(-theta * dt);
  const sd = sigma * Math.sqrt((1 - e * e) / (2 * theta));
  return mu + (x - mu) * e + sd * z;
}

// ---- Difficulty & calendar ------------------------------------------------------------------------

export function difficulty(state: GameState) {
  return DIFFICULTY_SETTINGS[state.meta.difficulty] ?? DIFFICULTY_SETTINGS.normal;
}

/** Fractional game day since the calendar start (day 1 00:00 = 0). */
export function fractionalDay(state: GameState): number {
  return state.time.day - 1 + state.time.minuteOfDay / 1440;
}

/** Day of the 120-day game year, 0-based (spring starts at 0). */
export function dayOfYear(day: number): number {
  return (((day - 1) % DAYS_PER_YEAR) + DAYS_PER_YEAR) % DAYS_PER_YEAR;
}

export function seasonOfDay(day: number): Season {
  return SEASONS[Math.floor(dayOfYear(day) / DAYS_PER_SEASON)];
}

/** Day within the current season, 0..29. */
export function dayOfSeason(day: number): number {
  return dayOfYear(day) % DAYS_PER_SEASON;
}

// ---- Formatting (ledger notes, notifications) -----------------------------------------------------

export function fmtMoney(v: number): string {
  const s = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}k`;
  return `${s}$${a.toFixed(a < 100 ? 2 : 0)}`;
}

export function fmtQty(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(1)}k`;
  return Math.round(v).toLocaleString('en-US');
}

export function pct(mult: number): string {
  const p = Math.round((mult - 1) * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** Round to a "nice" business number (2 significant digits). */
export function roundNice(n: number): number {
  if (n <= 0) return 0;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(n)) - 1));
  return Math.round(n / mag) * mag;
}

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---- Building index -------------------------------------------------------------------------------

/** Groups buildings by type once per sim tick (or after invalidation) for cheap repeated lookups. */
export class BuildingIndex {
  private tick = -1;
  private dirty = true;
  private byType = new Map<string, BuildingState[]>();
  private list: BuildingState[] = [];

  invalidate() {
    this.dirty = true;
  }

  private refresh(state: GameState) {
    if (!this.dirty && state.time.tick === this.tick) return;
    this.tick = state.time.tick;
    this.dirty = false;
    this.byType.clear();
    this.list = Object.values(state.buildings);
    for (const b of this.list) {
      let arr = this.byType.get(b.type);
      if (!arr) this.byType.set(b.type, (arr = []));
      arr.push(b);
    }
  }

  all(state: GameState): BuildingState[] {
    this.refresh(state);
    return this.list;
  }

  ofType(state: GameState, type: string): BuildingState[] {
    this.refresh(state);
    return this.byType.get(type) ?? EMPTY;
  }

  count(state: GameState, type: string, pred?: (b: BuildingState) => boolean): number {
    const arr = this.ofType(state, type);
    if (!pred) return arr.length;
    let n = 0;
    for (const b of arr) if (pred(b)) n++;
    return n;
  }
}
const EMPTY: BuildingState[] = [];

/** Constructed & running for economic purposes (not broken/burning/destroyed/disabled/unpowered). */
export function isWorking(b: BuildingState): boolean {
  return b.constructionProgress >= 1 && b.enabled && b.status !== 'broken' && b.status !== 'fire' && b.status !== 'destroyed' && b.status !== 'no_power' && b.status !== 'disabled';
}
