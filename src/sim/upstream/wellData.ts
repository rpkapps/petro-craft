// Upstream-private runtime data attached to WellState / ReservoirState objects.
//
// The core contract has no free-form `data` bag on wells or reservoirs, so the upstream system stores its
// extra (JSON-serialisable) data under an `up` property on those objects. It persists in saves like any
// other state. UI may read `well.up.op` (label / hoursLeft / hoursTotal) to show operation progress.
import type { CasingString, GameContext, LiftType, ReservoirState, Vec3, WellPurpose, WellState, WellStatus } from '../../core/types';

/** A timed operation in progress on a well (tripping, casing, kill, completion, frac, workover, capping). */
export interface WellOp {
  kind: 'trip' | 'casing' | 'kill' | 'complete' | 'frac' | 'workover' | 'cap' | 'relief';
  /** Player-facing label, e.g. "Running surface casing". */
  label: string;
  hoursLeft: number;
  hoursTotal: number;
  method?: string;
  casingName?: CasingString['name'];
  casingY?: number;
  casingTopY?: number;
  stages?: number;
  stagesDone?: number;
  lift?: LiftType;
  purpose?: WellPurpose;
  reservoirIds?: string[];
  spreadId?: string;
  /** Status to return to when the op finishes (workovers on producing wells). */
  resume?: WellStatus;
}

/** Per-reservoir contact & near-well state for a well. */
export interface ResContact {
  /** Trajectory blocks inside the reservoir (any fluid). */
  contact: number;
  /** Trajectory blocks inside the hydrocarbon column. */
  hc: number;
  /** Effective pay thickness for inflow (blocks): vertical component + 0.3 × horizontal component. */
  hEff: number;
  /** Deepest / shallowest hydrocarbon block y penetrated. */
  minY: number;
  maxY: number;
  /** Near-well drainage pressure (psi). */
  pL: number;
  /** Fracture pressure at the completion (psi) — injection limit. */
  fracPsi: number;
  /** Day the stimulated rock volume was created (completion / last frac) — tight-rock recharge fades with age. */
  srvDay?: number;
}

export interface WellExt {
  op?: WellOp;
  /** Mud program: section top y (casing shoe) → planned mud weight for the open hole below it. */
  mud: { y: number; ppg: number }[];
  mudOverride: boolean;
  /** Next casing point index into plan.casingPoints (sorted high → low y). */
  nextCasing: number;
  res: Record<string, ResContact>;
  /** Integer measured depth already logged/processed. */
  mdDone: number;
  /** Last MD for which a progress event was emitted. */
  progressMd: number;
  /** Casing cells already written (index along planned path at 0.25-block resolution). */
  cellIdx: number;
  kickHours: number;
  kickPpg: number;
  kickFluid: 'oil' | 'gas' | 'water';
  lostCirc: boolean;
  /** Weakest fracture gradient (ppg) seen in the current open-hole section. */
  fracMin?: number;
  contaminated: boolean;
  /** Pending (not yet ledgered) costs by ledger category. */
  bill: { drilling: number; supplies: number; misc: number };
  baseProductivity: number;
  /** Today's volumes [oil, gas, water] (injection negative). */
  day: [number, number, number];
  flags: Record<string, boolean>;
  prevStatus?: WellStatus;
  manualShutIn?: boolean;
  autoShutIn?: boolean;
  /** Unconstrained deliverability at full choke (liquid bbl/d or gas mcf/d) — for UI & utilisation. */
  potential: number;
  /** Why the well is not producing (UI hint), '' when fine. */
  limit: string;
  blowFluid?: 'oil' | 'gas' | 'water';
  blowRes?: string;
  spillId?: string;
  /** Spilled crude not yet placed as OIL_POOL blocks (bbl). */
  spillAcc?: number;
  fireId?: string;
  /** Standby flag for notifications (no crew / no rig). */
  stalled?: string;
}

export interface ReservoirExt {
  /** Multiplicative error of the player's in-place estimate before full knowledge. */
  estError: number;
  firstWell?: string;
  /** Cumulative aquifer influx (reservoir bbl). */
  influx: number;
  /** Cumulative volumes lost to blowouts (stock tank). */
  lostOil: number;
  lostGas: number;
  /** Current ultimate recovery factor (for UI). */
  urf: number;
  belowBubbleNotified?: boolean;
}

export type UpWell = WellState & { up?: WellExt };
export type UpReservoir = ReservoirState & { up?: ReservoirExt };

export function newWellExt(): WellExt {
  return {
    mud: [], mudOverride: false, nextCasing: 0, res: {}, mdDone: 0, progressMd: 0, cellIdx: 0,
    kickHours: 0, kickPpg: 0, kickFluid: 'water', lostCirc: false, contaminated: false,
    bill: { drilling: 0, supplies: 0, misc: 0 }, baseProductivity: 1, day: [0, 0, 0], flags: {}, potential: 0, limit: '',
  };
}

/** Upstream extension of a well (created on demand, e.g. for wells from older saves). */
export function ux(w: WellState): WellExt {
  const u = w as UpWell;
  if (!u.up) u.up = newWellExt();
  const e = u.up;
  if (!e.bill) e.bill = { drilling: 0, supplies: 0, misc: 0 };
  if (!e.res) e.res = {};
  if (!e.flags) e.flags = {};
  if (!e.day) e.day = [0, 0, 0];
  return e;
}

export function rx(r: ReservoirState): ReservoirExt {
  const u = r as UpReservoir;
  if (!u.up) u.up = { estError: 0, influx: 0, lostOil: 0, lostGas: 0, urf: 0 };
  return u.up;
}

/** Change a well's status and emit 'well:statusChanged'. */
export function setWellStatus(ctx: GameContext, w: WellState, status: WellStatus): void {
  if (w.status === status) return;
  const prev = w.status;
  w.status = status;
  ctx.bus.emit('well:statusChanged', { id: w.id, prev, status });
}

/** Accrue a cost against a well (ledgered in batches by flushBills). */
export function accrue(w: WellState, category: 'drilling' | 'supplies' | 'misc', amount: number): void {
  if (!(amount > 0)) return;
  const e = ux(w);
  e.bill[category] += amount;
  w.cost += amount;
}

/** Charge an immediate cost against a well (commands). Returns false if funds are insufficient. */
export function charge(ctx: GameContext, w: WellState, amount: number, category: 'drilling' | 'supplies' | 'misc' | 'fines', note: string, requireFunds: boolean): boolean {
  if (amount <= 0) return true;
  const ok = ctx.transact(-amount, category, note, requireFunds);
  if (ok) w.cost += amount;
  return ok;
}

/** Ledger pending well bills (≥ threshold, or everything when force). */
export function flushBills(ctx: GameContext, w: WellState, force: boolean, threshold = 25_000): void {
  const e = ux(w);
  const b = e.bill;
  if (b.drilling > 0 && (force || b.drilling >= threshold)) {
    ctx.transact(-b.drilling, 'drilling', `${w.name}: rig spread & services`);
    b.drilling = 0;
  }
  if (b.supplies > 0 && (force || b.supplies >= threshold)) {
    ctx.transact(-b.supplies, 'supplies', `${w.name}: oilfield supplies`);
    b.supplies = 0;
  }
  if (b.misc > 0 && (force || b.misc >= threshold)) {
    ctx.transact(-b.misc, 'opex', `${w.name}: well services`);
    b.misc = 0;
  }
}

export const DRILLING_STATUSES = new Set<WellStatus>(['drilling', 'tripping', 'casing', 'kick']);
export const RIG_BUSY_STATUSES = new Set<WellStatus>(['planned', 'drilling', 'tripping', 'casing', 'kick', 'blowout', 'drilled', 'completing']);
export const isInjectorPurpose = (p: WellPurpose) => p === 'injector_water' || p === 'injector_gas' || p === 'injector_co2' || p === 'disposal';

/** Surface position of a well (for notifications / focus). */
export const wellPos = (w: WellState): Vec3 => ({ x: w.x + 0.5, y: w.surfaceY, z: w.z + 0.5 });
