// Finance: net worth, loans (amortised daily), insurance & property tax, bankruptcy warnings.
import type { BuildingState, GameContext, GameState, Loan } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { BUILDINGS } from '../../content/buildings';
import { ITEMS } from '../../content/items';
import {
  BANKRUPTCY_WARNING_DAYS, DEPRECIATION_DAYS, INSOLVENCY_DAYS, INSOLVENCY_THRESHOLD, INSURANCE_RATE_ANNUAL, MAX_LOAN_TERM, MIN_LOAN_TERM,
  PDP_DAYS, PROPERTY_TAX_ANNUAL, RESERVES_VALUE_FACTOR, SALVAGE_FRACTION,
} from './constants';
import { economyState, type EconomyRuntime } from './ext';
import { difficulty, fmtMoney } from './util';

/** The incident log is shared; keep it bounded (cursor readers tolerate front trimming). */
const MAX_INCIDENTS = 300;

// ---- Valuation ------------------------------------------------------------------------------------

export function buildingBookValue(b: BuildingState, day: number): number {
  const def = BUILDINGS[b.type];
  if (!def || b.status === 'destroyed') return 0;
  const built = Math.min(1, Math.max(0, b.constructionProgress));
  const age = Math.max(0, day - b.builtDay);
  const dep = Math.max(SALVAGE_FRACTION, 1 - (1 - SALVAGE_FRACTION) * (age / DEPRECIATION_DAYS));
  const cond = 0.4 + 0.6 * Math.max(0, Math.min(100, b.condition)) / 100;
  return def.cost * built * dep * cond;
}

function commodityValue(s: GameState, id: string, qty: number): number {
  if (!(qty > 0)) return 0;
  const it = ITEMS[id];
  if (!it) return 0;
  if (it.tradable) return qty * (s.market.prices[id] ?? it.basePrice);
  if (it.kind === 'supply') return qty * it.basePrice * 0.8;
  return 0;
}

export interface NetWorthBreakdown { cash: number; buildings: number; inventory: number; reserves: number; loans: number; total: number }

export function netWorthBreakdown(s: GameState): NetWorthBreakdown {
  const day = s.time.day;
  let buildings = 0;
  let inventory = 0;
  for (const b of Object.values(s.buildings)) {
    buildings += buildingBookValue(b, day);
    for (const id in b.storage) inventory += commodityValue(s, id, b.storage[id]);
  }
  for (const n of Object.values(s.networks)) for (const id in n.linepack) inventory += commodityValue(s, id, n.linepack[id]);
  for (const id in s.company.warehouse) inventory += commodityValue(s, id, s.company.warehouse[id]);
  // Proved (developed, producing) reserves: remaining recoverable of discovered reservoirs with producing
  // wells, capped at PDP_YEARS of those wells' current output so one discovery doesn't inflate net worth.
  const rates = new Map<string, { oil: number; gas: number }>();
  for (const w of Object.values(s.wells)) {
    if (w.status !== 'producing' || w.completedReservoirs.length === 0) continue;
    const share = 1 / w.completedReservoirs.length;
    for (const r of w.completedReservoirs) {
      const cur = rates.get(r) ?? { oil: 0, gas: 0 };
      cur.oil += Math.max(0, w.rates.oil) * share;
      cur.gas += Math.max(0, w.rates.gas) * share;
      rates.set(r, cur);
    }
  }
  let reserves = 0;
  const oilPx = s.market.prices.crude_oil ?? ITEMS.crude_oil.basePrice;
  const gasPx = s.market.prices.natural_gas ?? ITEMS.natural_gas.basePrice;
  for (const [id, q] of rates) {
    const r = s.reservoirs[id];
    if (!r?.discovered) continue;
    const oil = Math.min(Math.max(0, r.remainingOil), q.oil * PDP_DAYS);
    const gas = Math.min(Math.max(0, r.remainingGas), q.gas * PDP_DAYS);
    reserves += (oil * oilPx + gas * gasPx) * RESERVES_VALUE_FACTOR;
  }
  const loans = s.company.loans.reduce((a, l) => a + l.balance, 0);
  const cash = s.company.money;
  return { cash, buildings, inventory, reserves, loans, total: cash + buildings + inventory + reserves - loans };
}

export function computeNetWorth(s: GameState): number {
  return netWorthBreakdown(s).total;
}

// ---- Loans ----------------------------------------------------------------------------------------

export function loanRate(s: GameState): number {
  const base = difficulty(s).loanRate;
  if (base <= 0) return 0;
  return Math.max(0.01, base + (50 - s.company.reputation) * 0.0006);
}

/** Additional borrowing capacity now. */
export function maxLoan(s: GameState, netWorth: number): number {
  const outstanding = s.company.loans.reduce((a, l) => a + l.balance, 0);
  const capacity = Math.max(1_000_000, netWorth) * (0.3 + 0.5 * (s.company.reputation / 100));
  return Math.max(0, Math.floor((capacity - outstanding) / 10_000) * 10_000);
}

export function amortisedPayment(principal: number, annualRate: number, days: number): number {
  const n = Math.max(1, Math.round(days));
  const r = annualRate / 365;
  if (r <= 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export function cmdTakeLoan(cmd: Command<'finance/takeLoan'>, ctx: GameContext, netWorth: () => number): CommandResult {
  const s = ctx.state;
  const amount = Math.floor(Number(cmd.amount));
  const term = Math.floor(Number(cmd.termDays));
  if (economyState(s).finance.insolvent) return { ok: false, error: 'Banks will not lend to an insolvent company' };
  if (!(amount >= 10_000)) return { ok: false, error: 'Minimum loan is $10k' };
  if (!(term >= MIN_LOAN_TERM && term <= MAX_LOAN_TERM)) return { ok: false, error: `Term must be ${MIN_LOAN_TERM}–${MAX_LOAN_TERM} days` };
  const limit = maxLoan(s, netWorth());
  if (amount > limit) return { ok: false, error: `The bank will lend at most ${fmtMoney(limit)} more` };
  const rate = loanRate(s);
  const loan: Loan = { id: ctx.newId('loan'), principal: amount, balance: amount, rate, takenDay: s.time.day, termDays: term, dailyPayment: amortisedPayment(amount, rate, term) };
  s.company.loans.push(loan);
  ctx.transact(amount, 'loan', `Loan drawn: ${fmtMoney(amount)} over ${term} days at ${(rate * 100).toFixed(1)}%`);
  return { ok: true, data: { loanId: loan.id, dailyPayment: loan.dailyPayment } };
}

export function cmdRepayLoan(cmd: Command<'finance/repayLoan'>, ctx: GameContext): CommandResult {
  const s = ctx.state;
  const loan = s.company.loans.find((l) => l.id === cmd.loanId);
  if (!loan) return { ok: false, error: 'No such loan' };
  const amount = Math.min(loan.balance, Math.max(0, Number(cmd.amount) || 0));
  if (amount <= 0) return { ok: false, error: 'Enter an amount to repay' };
  if (!ctx.transact(-amount, 'loan', `Early repayment: ${fmtMoney(amount)}`, true)) return { ok: false, error: 'Not enough cash' };
  loan.balance -= amount;
  if (loan.balance <= 0.5) {
    s.company.loans = s.company.loans.filter((l) => l !== loan);
    ctx.notify('success', 'Loan repaid', `The ${fmtMoney(loan.principal)} loan is paid off.`);
  } else {
    const remaining = Math.max(1, loan.takenDay + loan.termDays - s.time.day);
    loan.dailyPayment = amortisedPayment(loan.balance, loan.rate, remaining);
  }
  return { ok: true };
}

// ---- Daily ----------------------------------------------------------------------------------------

export function financeNewDay(ctx: GameContext, rt: EconomyRuntime, day: number) {
  const s = ctx.state;
  const ext = economyState(s).finance;

  // Loan service.
  let interest = 0;
  let principal = 0;
  const keep: Loan[] = [];
  for (const l of s.company.loans) {
    const i = l.balance * (l.rate / 365);
    const p = Math.min(l.balance, Math.max(0, l.dailyPayment - i));
    interest += i;
    principal += p;
    l.balance -= p;
    if (l.balance <= 0.5) ctx.notify('success', 'Loan repaid', `The ${fmtMoney(l.principal)} loan taken on day ${l.takenDay} is paid off.`);
    else keep.push(l);
  }
  s.company.loans = keep;
  if (interest > 0.5) ctx.transact(-interest, 'interest', 'Loan interest');
  if (principal > 0.5) ctx.transact(-principal, 'loan', 'Loan principal');

  // Insurance (loaded by recent incidents) & property tax on book value.
  let book = 0;
  for (const b of rt.index.all(s)) book += buildingBookValue(b, day);
  const incidents30 = s.hazards.incidents.filter((i) => i.day >= day - 30 && i.kind !== 'lightning' && i.kind !== 'injury').length;
  const loading = Math.min(2, 1 + 0.1 * incidents30);
  const premium = (book * INSURANCE_RATE_ANNUAL * loading) / 365;
  const tax = (book * PROPERTY_TAX_ANNUAL) / 365;
  if (premium > 0.5) ctx.transact(-premium, 'insurance', loading > 1.05 ? `Insurance premium (+${Math.round((loading - 1) * 100)}% incident loading)` : 'Insurance premium');
  if (tax > 0.5) ctx.transact(-tax, 'misc', 'Property tax');

  // Solvency.
  const money = s.company.money;
  ext.negativeDays = money < 0 ? ext.negativeDays + 1 : 0;
  ext.deepNegativeDays = money < INSOLVENCY_THRESHOLD ? ext.deepNegativeDays + 1 : 0;
  if (ext.negativeDays >= BANKRUPTCY_WARNING_DAYS && day - ext.lastWarnDay >= 3) {
    ext.lastWarnDay = day;
    ctx.notify('danger', 'Creditors are calling', `You have been overdrawn for ${ext.negativeDays} days (${fmtMoney(money)}). Sell inventory, cut costs or take a loan before the company becomes insolvent.`);
  }
  if (ext.deepNegativeDays >= INSOLVENCY_DAYS && !ext.insolvent) {
    ext.insolvent = true;
    ctx.notify('danger', 'Company insolvent', `Over ${fmtMoney(-INSOLVENCY_THRESHOLD)} in debt for ${INSOLVENCY_DAYS} days. Banks have frozen credit and new spending is blocked until you are back in the black.`);
  }
  if (ext.insolvent && money >= 0) {
    ext.insolvent = false;
    ctx.notify('success', 'Back in the black', 'Creditors are satisfied. Credit lines are open again.');
  }

  // Stats bookkeeping (idempotent with anything upstream records).
  let oilRate = 0;
  for (const w of Object.values(s.wells)) if (w.status === 'producing') oilRate += Math.max(0, w.rates.oil);
  s.stats.peakOilRate = Math.max(s.stats.peakOilRate, oilRate);
  if (s.hazards.incidents.length > MAX_INCIDENTS) s.hazards.incidents.splice(0, s.hazards.incidents.length - MAX_INCIDENTS);

  // Company value history.
  rt.invalidateNetWorth();
  const nw = computeNetWorth(s);
  ext.peakNetWorth = Math.max(ext.peakNetWorth, nw);
  const h = s.stats.companyValueHistory;
  h.push(Math.round(nw));
  if (h.length > 365) h.splice(0, h.length - 365);
}
