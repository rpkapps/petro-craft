// Supply contracts: offers from fictional clients, acceptance, delivery (via terminal sales),
// completion bonuses, deadline penalties and reputation effects.
import type { Contract, GameContext, GameState } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { ITEMS } from '../../content/items';
import { CLIENTS, CONTRACT_TITLES, type ClientDef } from './clients';
import { BASE_ACTIVE_CONTRACTS, MAX_COMPLETED_CONTRACTS, MAX_OFFERS, OFFER_EXPIRY_DAYS } from './constants';
import { economyState, type EconomyContract } from './ext';
import { chance, fmtMoney, fmtQty, pick, rand, randInt, roundNice, weightedPick } from './util';

/** Typical daily volumes used to size offers before the company has a sales record. */
const TYPICAL_DAILY: Record<string, number> = {
  crude_oil: 400, condensate: 200, natural_gas: 4_000, dry_gas: 6_000, ngl: 300, lpg: 300, gasoline: 800, diesel: 800,
  jet_fuel: 500, asphalt: 60, lubricants: 100, sulfur: 30, ethylene: 80, propylene: 60, polyethylene: 80, polypropylene: 60,
  ammonia: 60, methanol: 80, lng: 300,
};

/** Commodities the company could plausibly supply given its research ("aspirational" offers). */
const ASPIRATIONAL_BY_TECH: Record<string, string[]> = {
  rotary_drilling: ['crude_oil', 'natural_gas', 'condensate'],
  gas_processing: ['dry_gas', 'ngl'],
  refining: ['gasoline', 'diesel', 'jet_fuel', 'lpg', 'asphalt'],
  hydrotreating: ['lubricants', 'sulfur'],
  petrochemicals: ['ethylene', 'propylene'],
  polymers: ['polyethylene', 'polypropylene'],
  gas_to_chemicals: ['ammonia', 'methanol'],
  lng: ['lng'],
};

export const contractWindowDays = (c: Contract) => Math.max(1, c.deadlineDay - c.offeredDay);
export const offerExpiresDay = (c: Contract) => c.offeredDay + OFFER_EXPIRY_DAYS;
export const contractValue = (c: Contract) => c.quantity * c.pricePerUnit;

export function maxActiveContracts(state: GameState): number {
  return BASE_ACTIVE_CONTRACTS + Math.floor(Math.max(0, state.company.reputation) / 25);
}

export function adjustReputation(state: GameState, delta: number) {
  const c = state.company;
  c.reputation = Math.max(0, Math.min(100, c.reputation + delta));
}

/** Recent average daily sales per commodity (units/day over the last n days). */
export function recentDailySales(state: GameState, days = 14): Record<string, number> {
  const out: Record<string, number> = {};
  const daily = economyState(state).sales.daily;
  const from = state.time.day - days;
  for (const d of daily) {
    if (d.day <= from) continue;
    for (const [id, q] of Object.entries(d.sold)) out[id] = (out[id] ?? 0) + q / days;
  }
  // Production recorded by upstream/facilities (DailyFinance.production) also counts.
  const hist = state.company.history;
  const prod: Record<string, number> = {};
  for (let i = Math.max(0, hist.length - days); i < hist.length; i++) {
    for (const [id, q] of Object.entries(hist[i].production ?? {})) {
      if (ITEMS[id]?.tradable && q > 0) prod[id] = (prod[id] ?? 0) + q / days;
    }
  }
  for (const [id, q] of Object.entries(prod)) out[id] = Math.max(out[id] ?? 0, q);
  return out;
}

function aspirational(ctx: GameContext): string[] {
  const out = new Set<string>();
  for (const [tech, ids] of Object.entries(ASPIRATIONAL_BY_TECH)) if (ctx.hasTech(tech)) ids.forEach((i) => out.add(i));
  if (out.size === 0) ['crude_oil', 'natural_gas'].forEach((i) => out.add(i));
  return [...out];
}

/** Create one offer (not inserted). Returns null if no suitable client exists. */
export function generateOffer(ctx: GameContext, opts: { commodity?: string; premium?: boolean } = {}): EconomyContract | null {
  const s = ctx.state;
  const day = s.time.day;
  const recent = recentDailySales(s);
  const premiumOk = ctx.hasTech('trading_desk');
  const premium = opts.premium ?? (premiumOk && chance(ctx, 0.25));

  let commodity = opts.commodity;
  let daily = 0;
  if (!commodity) {
    const asp = aspirational(ctx);
    const pool = [...new Set([...Object.keys(recent).filter((k) => ITEMS[k]?.tradable), ...asp])];
    const totalValue = pool.reduce((a, id) => a + (recent[id] ?? 0) * (s.market.prices[id] ?? 0), 0);
    commodity = weightedPick(ctx, pool, (id) => {
      const v = (recent[id] ?? 0) * (s.market.prices[id] ?? 0);
      if (v > 0) return v;
      // Aspirational: modest share of the total (or crude-first when nothing is produced yet).
      if (totalValue <= 0) return id === 'crude_oil' ? 3 : id === 'natural_gas' ? 1 : 0.6;
      return (totalValue * 0.15) / Math.max(1, asp.length);
    });
    if (!commodity) return null;
  }
  daily = recent[commodity] ?? 0;

  const clients = CLIENTS.filter((c) => c.commodities.includes(commodity!) && !!c.premium === premium);
  const client: ClientDef | undefined = clients.length ? pick(ctx, clients) : CLIENTS.find((c) => c.commodities.includes(commodity!));
  if (!client) return null;
  const isPremium = !!client.premium;
  if (isPremium && !premiumOk) return null;

  const window = randInt(ctx, 7, 30);
  const baseDaily = daily > 0 ? daily : TYPICAL_DAILY[commodity] ?? 100;
  let qty = baseDaily * window * rand(ctx, 0.3, 0.8);
  if (isPremium) qty *= rand(ctx, 1.8, 3);
  qty = Math.max(10, roundNice(qty));

  const spot = s.market.prices[commodity] ?? ITEMS[commodity].basePrice;
  const markup = isPremium ? rand(ctx, 0.15, 0.35) : rand(ctx, 0.05, 0.25);
  const price = Math.round(spot * (1 + markup) * 100) / 100;
  const value = qty * price;
  const bonus = Math.round(value * rand(ctx, 0.03, 0.1));
  const penalty = Math.round(value * rand(ctx, 0.15, 0.3));
  const valueRep = Math.max(0, Math.log10(Math.max(1, value) / 1e5) * 15);
  const minRep = Math.min(80, Math.round(Math.max(client.minRep, valueRep) / 5) * 5);

  const it = ITEMS[commodity];
  const flavour = pick(ctx, client.flavour)
    .replace('{qty}', fmtQty(qty))
    .replace('{unit}', it.unit)
    .replace('{item}', it.name.toLowerCase())
    .replace('{days}', String(window))
    .replace('{client}', client.name);
  return {
    id: ctx.newId('ct'),
    client: client.name,
    title: pick(ctx, CONTRACT_TITLES[commodity] ?? [`${it.name} supply`]),
    commodity,
    quantity: qty,
    delivered: 0,
    pricePerUnit: price,
    bonus,
    penalty,
    offeredDay: day,
    deadlineDay: day + window,
    status: 'offered',
    minReputation: minRep,
    description: flavour,
    clientKind: client.kind,
    premium: isPremium,
  };
}

function offerLine(c: Contract): string {
  const it = ITEMS[c.commodity];
  return `${c.client}: ${fmtQty(c.quantity)} ${it.unit} of ${it.name} at $${c.pricePerUnit.toFixed(2)}/${it.unit} within ${contractWindowDays(c)} days (bonus ${fmtMoney(c.bonus)})`;
}

function pushOffer(ctx: GameContext, c: EconomyContract) {
  const s = ctx.state;
  s.contracts.offers.push(c);
  while (s.contracts.offers.length > MAX_OFFERS) s.contracts.offers.shift();
  ctx.bus.emit('contract:offered', { id: c.id });
}

/** New game: 2–3 starter offers, crude-weighted, low reputation requirements. */
export function initContracts(ctx: GameContext) {
  const s = ctx.state;
  s.contracts.offers ??= [];
  s.contracts.active ??= [];
  s.contracts.completed ??= [];
  const n = randInt(ctx, 2, 3);
  const commodities = ['crude_oil', 'crude_oil', 'natural_gas'];
  for (let i = 0; i < n; i++) {
    const c = generateOffer(ctx, { commodity: commodities[i], premium: false });
    if (!c) continue;
    c.minReputation = Math.min(c.minReputation, 30);
    c.deadlineDay = c.offeredDay + Math.max(contractWindowDays(c), 20); // starters give time to drill
    pushOffer(ctx, c);
  }
  economyState(s).contracts.nextOfferDay = s.time.day + randInt(ctx, 2, 4);
}

/** Record a delivery (called by sales). Completes the contract when filled. */
export function deliverToContract(ctx: GameContext, c: Contract, qty: number) {
  c.delivered += qty;
  if (c.delivered >= c.quantity - 1e-6) completeContract(ctx, c);
}

function archive(s: GameState, c: Contract) {
  const i = s.contracts.active.indexOf(c);
  if (i >= 0) s.contracts.active.splice(i, 1);
  s.contracts.completed.push(c);
  if (s.contracts.completed.length > MAX_COMPLETED_CONTRACTS) s.contracts.completed.splice(0, s.contracts.completed.length - MAX_COMPLETED_CONTRACTS);
}

function recordOutcome(s: GameState, ok: boolean) {
  const ext = economyState(s).contracts;
  if (ok) ext.completed++;
  else ext.failed++;
  ext.history.push({ day: s.time.day, ok });
  if (ext.history.length > 60) ext.history.splice(0, ext.history.length - 60);
}

function completeContract(ctx: GameContext, c: Contract) {
  const s = ctx.state;
  if (c.status !== 'active') return;
  c.status = 'completed';
  c.delivered = Math.min(c.delivered, c.quantity);
  archive(s, c);
  // Booked with the next sales settlement (never mid-step, see sales.tickSales).
  if (c.bonus > 0) economyState(s).sales.pending.contracts += c.bonus;
  const value = contractValue(c);
  adjustReputation(s, 2 + 3 * (value / (value + 2_000_000)));
  recordOutcome(s, true);
  ctx.bus.emit('contract:completed', { id: c.id });
  ctx.notify('success', `Contract fulfilled: ${c.client}`, `${fmtQty(c.quantity)} ${ITEMS[c.commodity]?.unit} of ${ITEMS[c.commodity]?.name} delivered. Bonus ${fmtMoney(c.bonus)} paid.`);
}

function failContract(ctx: GameContext, c: Contract, reason: 'deadline' | 'abandoned') {
  const s = ctx.state;
  const undelivered = Math.max(0, 1 - c.delivered / c.quantity);
  const penalty = Math.round(c.penalty * (reason === 'abandoned' ? undelivered : Math.max(0.3, undelivered)));
  c.status = 'failed';
  archive(s, c);
  if (penalty > 0) ctx.transact(-penalty, 'contracts', `Contract penalty: ${c.client}`);
  adjustReputation(s, reason === 'abandoned' ? -3 : -(4 + 4 * undelivered));
  recordOutcome(s, false);
  ctx.bus.emit('contract:failed', { id: c.id });
  ctx.notify(reason === 'abandoned' ? 'warning' : 'danger', reason === 'abandoned' ? `Contract abandoned: ${c.client}` : `Contract failed: ${c.client}`,
    `${fmtQty(c.delivered)} of ${fmtQty(c.quantity)} ${ITEMS[c.commodity]?.unit} delivered. Penalty ${fmtMoney(penalty)}; reputation damaged.`);
}

/** Daily: deadlines, offer expiry, new offers. */
export function contractsNewDay(ctx: GameContext, day: number) {
  const s = ctx.state;
  for (const c of [...s.contracts.active]) {
    if (c.status === 'active' && c.delivered >= c.quantity - 1e-6) completeContract(ctx, c);
    else if (c.status === 'active' && day > c.deadlineDay) failContract(ctx, c, 'deadline');
    else if (c.status === 'active' && c.deadlineDay - day === 2 && c.delivered < c.quantity * 0.7) {
      ctx.notify('warning', `Contract deadline in 2 days`, `${c.client}: ${fmtQty(c.quantity - c.delivered)} ${ITEMS[c.commodity]?.unit} of ${ITEMS[c.commodity]?.name} still to deliver.`);
    }
  }
  s.contracts.offers = s.contracts.offers.filter((c) => {
    if (day < offerExpiresDay(c)) return true;
    c.status = 'expired';
    return false;
  });
  const ext = economyState(s).contracts;
  if (day >= ext.nextOfferDay) {
    const n = chance(ctx, 0.35) ? 2 : 1;
    const fresh: Contract[] = [];
    for (let i = 0; i < n; i++) {
      const c = generateOffer(ctx);
      if (!c) continue;
      pushOffer(ctx, c);
      fresh.push(c);
    }
    if (fresh.length === 1) ctx.notify('info', 'New contract offer', offerLine(fresh[0]) + '.');
    else if (fresh.length > 1) ctx.notify('info', `${fresh.length} new contract offers`, fresh.map(offerLine).join('; ') + '.');
    ext.nextOfferDay = day + randInt(ctx, 2, 4);
  }
}

// ---- Commands -------------------------------------------------------------------------------------

export function cmdAccept(cmd: Command<'contract/accept'>, ctx: GameContext): CommandResult {
  const s = ctx.state;
  const c = s.contracts.offers.find((o) => o.id === cmd.contractId) as EconomyContract | undefined;
  if (!c) return { ok: false, error: 'That offer is no longer available' };
  if (s.company.reputation < c.minReputation) return { ok: false, error: `Requires reputation ${c.minReputation} (you have ${Math.floor(s.company.reputation)})` };
  if (c.premium && !ctx.hasTech('trading_desk')) return { ok: false, error: 'Premium contracts require the Trading Desk' };
  if (s.contracts.active.length >= maxActiveContracts(s)) return { ok: false, error: `You can hold at most ${maxActiveContracts(s)} contracts (raise reputation for more)` };
  const window = contractWindowDays(c);
  s.contracts.offers.splice(s.contracts.offers.indexOf(c), 1);
  c.status = 'active';
  c.acceptedDay = s.time.day;
  c.deadlineDay = s.time.day + window;
  s.contracts.active.push(c);
  return { ok: true, data: { deadlineDay: c.deadlineDay } };
}

export function cmdAbandon(cmd: Command<'contract/abandon'>, ctx: GameContext): CommandResult {
  const c = ctx.state.contracts.active.find((o) => o.id === cmd.contractId);
  if (!c) return { ok: false, error: 'No such active contract' };
  failContract(ctx, c, 'abandoned');
  return { ok: true };
}
