// Physical sales: terminals sell from their storage each step (contracts first, then spot under the
// company's auto-sell rules), manual sales, supply/block purchases, hedging and royalties.
import type { BuildingState, GameContext, GameState, Hedge, PlayerState } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { ITEMS, TRADABLE_IDS } from '../../content/items';
import { BLOCK_BY_KEY, BLOCK_DEFS, blockItemId, type BlockDef } from '../../core/blocks';
import { crewFactor } from '../../core/buildingUtil';
import {
  BLOCK_PRICES, DEFAULT_BLOCK_PRICE, HEDGE_FEE, HEDGE_MAX_DAYS, HEDGE_MIN_DAYS, STACK_SIZE, SUPPLY_YARD_DISCOUNT, TERMINALS,
  WAREHOUSE_SALE_DISCOUNT, WAREHOUSE_SALE_FREIGHT, terminalAccepts, unitVolume, type TerminalSpec,
} from './constants';
import { deliverToContract } from './contracts';
import { economyState, type EconomyExtState, type EconomyRuntime } from './ext';
import { leaseKey } from './leases';
import { priceImpact } from './market';
import { fmtMoney, fmtQty, isWorking } from './util';

// ---- Terminal bookkeeping (b.data) ----------------------------------------------------------------

/**
 * Sales telemetry written to terminal `building.data` for the UI:
 *  salesDay, salesToday (volume-eq units sold today), revenueToday (USD), salesCapacity (effective
 *  units/day incl. crew), salesUtil (0..1 smoothed), salesByItem (units today per commodity).
 */
export interface TerminalSalesData {
  salesDay: number;
  salesToday: number;
  revenueToday: number;
  salesCapacity: number;
  salesUtil: number;
  salesByItem: Record<string, number>;
}

export function terminalData(b: BuildingState, day: number): TerminalSalesData {
  const d = b.data as Partial<TerminalSalesData>;
  if (d.salesDay !== day) {
    d.salesDay = day;
    d.salesToday = 0;
    d.revenueToday = 0;
    d.salesByItem = {};
  }
  d.salesCapacity ??= 0;
  d.salesUtil ??= 0;
  d.salesByItem ??= {};
  return d as TerminalSalesData;
}

/** Effective daily capacity (volume-eq units) of a terminal now. */
export function terminalCapacity(s: GameState, b: BuildingState): number {
  const spec = TERMINALS[b.type];
  if (!spec || !isWorking(b)) return 0;
  return spec.capacity * crewFactor(s, b);
}

// ---- Pricing --------------------------------------------------------------------------------------

/**
 * Sell `qty` of a commodity into the market: hedged volume first at the locked price, the rest at
 * spot × local price impact. Applies the sale_price modifier. Updates soldToday & hedges.
 */
function realise(ctx: GameContext, id: string, qty: number, worldMarket: boolean): number {
  const s = ctx.state;
  const saleMod = ctx.modifier('sale_price');
  let left = qty;
  let revenue = 0;
  for (const h of s.market.hedges) {
    if (left <= 0) break;
    if (h.commodity !== id || h.remaining <= 0 || h.expiryDay <= s.time.day) continue;
    const q = Math.min(left, h.remaining);
    h.remaining -= q;
    left -= q;
    revenue += q * h.price * saleMod;
  }
  if (left > 0) {
    const impactUnits = left * (worldMarket ? 0.25 : 1);
    const px = s.market.prices[id] * priceImpact(s, id, impactUnits / 2);
    revenue += left * px * saleMod;
  }
  s.market.soldToday[id] = (s.market.soldToday[id] ?? 0) + qty * (worldMarket ? 0.25 : 1);
  return revenue;
}

/** Indicative net price per unit at a terminal type (spot × modifiers − freight), for the UI. */
export function netbackPrice(ctx: GameContext, terminalType: string, id: string): number {
  const spec = TERMINALS[terminalType];
  const s = ctx.state;
  if (!spec) return 0;
  return s.market.prices[id] * priceImpact(s, id) * ctx.modifier('sale_price') - spec.transport * unitVolume(id) * ctx.modifier('transport_cost');
}

function recordSale(ext: EconomyExtState, day: number, id: string, qty: number, revenue: number) {
  ext.sales.totals[id] = (ext.sales.totals[id] ?? 0) + qty;
  ext.sales.totalRevenue += revenue;
  let rec = ext.sales.daily[ext.sales.daily.length - 1];
  if (!rec || rec.day !== day) {
    rec = { day, sold: {}, revenue: 0 };
    ext.sales.daily.push(rec);
    if (ext.sales.daily.length > 30) ext.sales.daily.splice(0, ext.sales.daily.length - 30);
  }
  rec.sold[id] = (rec.sold[id] ?? 0) + qty;
  rec.revenue += revenue;
}

// ---- Per-step terminal sales ----------------------------------------------------------------------

/** Book pending sales at least every N game hours (hourly when the amount is large). */
const FLUSH_HOURS = 4;
const FLUSH_LARGE = 50_000;

export function tickSales(ctx: GameContext, rt: EconomyRuntime, dt: number) {
  const s = ctx.state;
  const ext = economyState(s);
  const hourIdx = Math.floor(s.time.totalMinutes / 60);
  // Never transact on the day-rollover step: the core pushes company.today into history *after*
  // the ticks, so money booked now would be mixed into the new day's record.
  const rollover = s.time.minuteOfDay < dt * 1440 + 1e-6;
  if (hourIdx !== ext.hourIdx && !rollover) {
    const p = ext.sales.pending;
    if (hourIdx - ext.hourIdx >= FLUSH_HOURS || p.sales + p.contracts >= FLUSH_LARGE || ext.hourIdx < 0) {
      flushPendingSales(ctx);
      ext.hourIdx = hourIdx;
    }
  }
  const freightMod = ctx.modifier('transport_cost');
  for (const type in TERMINALS) {
    const list = rt.index.ofType(s, type);
    for (let i = 0; i < list.length; i++) sellAtTerminal(ctx, ext, list[i], TERMINALS[type], dt, freightMod);
  }
}

const itemsScratch: string[] = [];

function sellAtTerminal(ctx: GameContext, ext: EconomyExtState, b: BuildingState, spec: TerminalSpec, dt: number, freightMod: number) {
  const s = ctx.state;
  const d = terminalData(b, s.time.day);
  const dailyCap = terminalCapacity(s, b);
  d.salesCapacity = dailyCap;
  const stepCap = Math.min(dailyCap * dt, Math.max(0, dailyCap - d.salesToday));
  let capLeft = stepCap;
  if (capLeft > 1e-9) {
    itemsScratch.length = 0;
    for (const id in b.storage) if (b.storage[id] > 1e-6 && terminalAccepts(b.type, id)) itemsScratch.push(id);
    if (itemsScratch.length > 1) itemsScratch.sort((a, c) => s.market.prices[c] / unitVolume(c) - s.market.prices[a] / unitVolume(a));
    for (const id of itemsScratch) {
      if (capLeft <= 1e-9) break;
      capLeft = sellItem(ctx, ext, b, spec, d, id, capLeft, freightMod);
    }
  }
  const used = stepCap - capLeft;
  const inst = dailyCap * dt > 0 ? used / (dailyCap * dt) : 0;
  const k = 1 - Math.exp(-dt * 24); // ~1 game hour smoothing
  d.salesUtil += (inst - d.salesUtil) * k;
}

function sellItem(ctx: GameContext, ext: EconomyExtState, b: BuildingState, spec: TerminalSpec, d: TerminalSalesData, id: string, capLeft: number, freightMod: number): number {
  const s = ctx.state;
  const vol = unitVolume(id);
  const pend = ext.sales.pending;
  pend.contractUnits ??= {};
  let avail = b.storage[id];
  // 1) Contracts for this commodity, earliest deadline first.
  const active = s.contracts.active;
  if (active.length) {
    const due = active.filter((c) => c.status === 'active' && c.commodity === id && c.delivered < c.quantity);
    if (due.length > 1) due.sort((a, c) => a.deadlineDay - c.deadlineDay);
    for (const c of due) {
      const q = Math.min(avail, capLeft / vol, c.quantity - c.delivered);
      if (q <= 1e-9) continue;
      avail -= q;
      capLeft -= q * vol;
      const rev = q * c.pricePerUnit;
      const freight = q * vol * spec.transport * freightMod;
      pend.contracts += rev;
      pend.transport += freight;
      pend.contractUnits[id] = (pend.contractUnits[id] ?? 0) + q;
      s.market.soldToday[id] = (s.market.soldToday[id] ?? 0) + q * (spec.worldMarket ? 0.1 : 0.3); // contracted volume barely moves spot
      d.salesToday += q * vol;
      d.revenueToday += rev - freight;
      d.salesByItem[id] = (d.salesByItem[id] ?? 0) + q;
      recordSale(ext, s.time.day, id, q, rev);
      deliverToContract(ctx, c, q);
      if (avail <= 1e-9 || capLeft <= 1e-9) break;
    }
  }
  // 2) Spot sales under the auto-sell rule.
  const rule = s.company.autoSell[id];
  if (rule?.enabled && avail > 1e-9 && capLeft > 1e-9 && s.market.prices[id] >= rule.minPrice) {
    const q = Math.min(avail - Math.max(0, rule.keepReserve), capLeft / vol);
    if (q > 1e-9) {
      avail -= q;
      capLeft -= q * vol;
      const rev = realise(ctx, id, q, spec.worldMarket);
      const freight = q * vol * spec.transport * freightMod;
      pend.sales += rev;
      pend.transport += freight;
      pend.units[id] = (pend.units[id] ?? 0) + q;
      d.salesToday += q * vol;
      d.revenueToday += rev - freight;
      d.salesByItem[id] = (d.salesByItem[id] ?? 0) + q;
      recordSale(ext, s.time.day, id, q, rev);
    }
  }
  b.storage[id] = Math.max(0, avail);
  return capLeft;
}

function unitsNote(units: Record<string, number>): string {
  return Object.entries(units)
    .filter(([, q]) => q > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([id, q]) => `${fmtQty(q)} ${ITEMS[id]?.unit ?? ''} ${ITEMS[id]?.name ?? id}`)
    .join(', ');
}

/** Book the accumulated sales of the last game hour as ledger entries. */
export function flushPendingSales(ctx: GameContext) {
  const pend = economyState(ctx.state).sales.pending;
  if (pend.sales > 0.005) ctx.transact(pend.sales, 'sales', `Spot sales: ${unitsNote(pend.units)}`);
  if (pend.contracts > 0.005) ctx.transact(pend.contracts, 'contracts', `Contract deliveries: ${unitsNote(pend.contractUnits ?? {})}`);
  if (pend.transport > 0.005) ctx.transact(-pend.transport, 'transport', 'Freight & loading');
  pend.sales = 0;
  pend.contracts = 0;
  pend.transport = 0;
  pend.units = {};
  pend.contractUnits = {};
}

// ---- Daily: royalties, hedge settlement -----------------------------------------------------------

export function salesNewDay(ctx: GameContext, day: number) {
  const s = ctx.state;
  payRoyalties(ctx, day);
  settleHedges(ctx, day);
  // Start today's record so gaps show as zero-sales days.
  const ext = economyState(s);
  const last = ext.sales.daily[ext.sales.daily.length - 1];
  if (!last || last.day !== day) {
    ext.sales.daily.push({ day, sold: {}, revenue: 0 });
    if (ext.sales.daily.length > 30) ext.sales.daily.splice(0, ext.sales.daily.length - 30);
  }
}

function payRoyalties(ctx: GameContext, day: number) {
  const s = ctx.state;
  let total = 0;
  let oilTot = 0;
  let gasTot = 0;
  const crude = s.market.prices.crude_oil ?? ITEMS.crude_oil.basePrice;
  const cond = s.market.prices.condensate ?? ITEMS.condensate.basePrice;
  const gasPx = s.market.prices.natural_gas ?? ITEMS.natural_gas.basePrice;
  for (const w of Object.values(s.wells)) {
    if (w.purpose.startsWith('injector') || w.purpose === 'disposal') continue;
    const lease = s.leases[leaseKey(w.x, w.z)];
    if (!lease || lease.royalty <= 0) continue;
    let oil = 0;
    let gas = 0;
    let found = false;
    const h = w.history;
    for (let i = h.length - 1; i >= 0 && i >= h.length - 3; i--) {
      if (h[i][0] === day - 1) {
        oil = h[i][1];
        gas = h[i][2];
        found = true;
        break;
      }
    }
    if (!found && w.status === 'producing') {
      oil = Math.max(0, w.rates.oil);
      gas = Math.max(0, w.rates.gas);
    }
    if (oil <= 0 && gas <= 0) continue;
    const res = w.completedReservoirs[0] ? ctx.geology.getReservoir(w.completedReservoirs[0]) : undefined;
    const liquidPx = res?.fluid === 'condensate' ? cond : crude;
    total += (Math.max(0, oil) * liquidPx + Math.max(0, gas) * gasPx) * lease.royalty;
    oilTot += Math.max(0, oil);
    gasTot += Math.max(0, gas);
  }
  if (total >= 1) ctx.transact(-total, 'royalties', `Lease royalties on ${fmtQty(oilTot)} bbl & ${fmtQty(gasTot)} mcf`);
}

function settleHedges(ctx: GameContext, day: number) {
  const s = ctx.state;
  const keep: Hedge[] = [];
  for (const h of s.market.hedges) {
    if (h.expiryDay > day) {
      keep.push(h);
      continue;
    }
    const it = ITEMS[h.commodity];
    if (h.remaining > 0) {
      const spot = s.market.prices[h.commodity];
      const pnl = (h.price - spot) * h.remaining;
      ctx.transact(pnl, pnl >= 0 ? 'sales' : 'misc', `Hedge settlement: ${fmtQty(h.remaining)} ${it?.unit} ${it?.name} undelivered`);
      ctx.notify(pnl >= 0 ? 'info' : 'warning', `Hedge expired: ${it?.name}`, `${fmtQty(h.remaining)} ${it?.unit} were not delivered and settled financially for ${fmtMoney(pnl)}.`);
    } else {
      ctx.notify('info', `Hedge fulfilled: ${it?.name}`, `All ${fmtQty(h.volume)} ${it?.unit} sold at the locked $${h.price.toFixed(2)}.`);
    }
  }
  s.market.hedges = keep;
}

// ---- Manual sales ---------------------------------------------------------------------------------

export function cmdSell(cmd: Command<'market/sell'>, ctx: GameContext, rt: EconomyRuntime): CommandResult {
  const s = ctx.state;
  const id = cmd.commodity;
  const it = ITEMS[id];
  if (!it || !it.tradable) return { ok: false, error: `${it?.name ?? id} cannot be sold` };
  const want = Math.floor(Number(cmd.quantity));
  if (!(want > 0)) return { ok: false, error: 'Enter a quantity to sell' };
  const ext = economyState(s);
  const freightMod = ctx.modifier('transport_cost');
  const vol = unitVolume(id);
  let sold = 0;
  let revenue = 0;
  let freight = 0;
  if (cmd.source === 'warehouse') {
    const have = s.company.warehouse[id] ?? 0;
    const q = Math.min(want, have);
    if (q <= 0) return { ok: false, error: `No ${it.name} in the warehouse` };
    revenue = realise(ctx, id, q, false) * (1 - WAREHOUSE_SALE_DISCOUNT);
    freight = q * vol * WAREHOUSE_SALE_FREIGHT * freightMod;
    s.company.warehouse[id] = have - q;
    if (s.company.warehouse[id] <= 0) delete s.company.warehouse[id];
    sold = q;
    recordSale(ext, s.time.day, id, q, revenue);
  } else {
    let left = want;
    for (const type in TERMINALS) {
      if (!terminalAccepts(type, id)) continue;
      const spec = TERMINALS[type];
      for (const b of rt.index.ofType(s, type)) {
        if (left <= 0) break;
        const stock = b.storage[id] ?? 0;
        if (stock <= 0) continue;
        const d = terminalData(b, s.time.day);
        const capLeft = Math.max(0, terminalCapacity(s, b) - d.salesToday);
        const q = Math.min(left, stock, capLeft / vol);
        if (q <= 1e-6) continue;
        const rev = realise(ctx, id, q, spec.worldMarket);
        const fr = q * vol * spec.transport * freightMod;
        b.storage[id] = stock - q;
        d.salesToday += q * vol;
        d.revenueToday += rev - fr;
        d.salesByItem[id] = (d.salesByItem[id] ?? 0) + q;
        left -= q;
        sold += q;
        revenue += rev;
        freight += fr;
        recordSale(ext, s.time.day, id, q, rev);
      }
    }
    if (sold <= 0) {
      const anyStock = TRADABLE_IDS.includes(id) && Object.values(s.buildings).some((b) => TERMINALS[b.type] && terminalAccepts(b.type, id) && (b.storage[id] ?? 0) > 0);
      return { ok: false, error: anyStock ? 'Terminals have no loading capacity left today' : `No ${it.name} at an operational sales terminal` };
    }
  }
  ctx.transact(revenue, 'sales', `Manual sale: ${fmtQty(sold)} ${it.unit} ${it.name}`);
  if (freight > 0) ctx.transact(-freight, 'transport', `Freight: ${it.name}`);
  return { ok: true, data: { sold, revenue: revenue - freight } };
}

// ---- Buying: supplies & blocks --------------------------------------------------------------------

/** Price per unit of a supply item now (with the Supply Yard discount if applicable). */
export function supplyPrice(s: GameState, itemId: string): number {
  const it = ITEMS[itemId];
  if (!it || it.kind !== 'supply') return 0;
  const yard = Object.values(s.buildings).some((b) => b.type === 'warehouse' && isWorking(b));
  return it.basePrice * (yard ? 1 - SUPPLY_YARD_DISCOUNT : 1);
}

function shoppable(d: BlockDef | undefined): d is BlockDef {
  return !!d && d.placeable === true && Number.isFinite(d.hardness) && d.shape !== 'none' && d.shape !== 'liquid';
}

/** Shop price of a block item ('block:<key>' or bare key); 0 if it cannot be bought. */
export function blockPrice(itemOrKey: string): number {
  const key = itemOrKey.startsWith('block:') ? itemOrKey.slice(6) : itemOrKey;
  const d = BLOCK_BY_KEY[key];
  if (!shoppable(d)) return 0;
  return BLOCK_PRICES[key] ?? DEFAULT_BLOCK_PRICE;
}

/** Block shop catalogue for the UI: industrial blocks first, then natural blocks. */
export const SHOP_BLOCKS: { item: string; key: string; name: string; price: number; industrial: boolean }[] = BLOCK_DEFS
  .filter(shoppable)
  .map((d) => ({ item: blockItemId(d.id), key: d.key, name: d.name, price: BLOCK_PRICES[d.key] ?? DEFAULT_BLOCK_PRICE, industrial: d.key in BLOCK_PRICES }))
  .sort((a, b) => Number(b.industrial) - Number(a.industrial) || a.name.localeCompare(b.name));

/** Add items to a player's inventory (fill stacks, then empty slots). Returns how many fit. */
export function addToInventory(p: PlayerState, item: string, qty: number): number {
  let left = qty;
  for (const slot of p.inventory) {
    if (left <= 0) break;
    if (slot && slot.item === item && slot.count < STACK_SIZE) {
      const n = Math.min(left, STACK_SIZE - slot.count);
      slot.count += n;
      left -= n;
    }
  }
  for (let i = 0; i < p.inventory.length && left > 0; i++) {
    if (p.inventory[i]) continue;
    const n = Math.min(left, STACK_SIZE);
    p.inventory[i] = { item, count: n };
    left -= n;
  }
  return qty - left;
}

function inventorySpace(p: PlayerState, item: string): number {
  let n = 0;
  for (const slot of p.inventory) n += !slot ? STACK_SIZE : slot.item === item ? Math.max(0, STACK_SIZE - slot.count) : 0;
  return n;
}

export function cmdBuy(cmd: Command<'market/buy'>, ctx: GameContext): CommandResult {
  const s = ctx.state;
  const qty = Math.floor(Number(cmd.quantity));
  if (!(qty > 0) || qty > 1_000_000) return { ok: false, error: 'Invalid quantity' };
  if (cmd.item.startsWith('block:')) {
    const price = blockPrice(cmd.item);
    if (price <= 0) return { ok: false, error: 'That block is not for sale' };
    const p = s.players[cmd.playerId ?? ctx.localPlayerId];
    if (!p) return { ok: false, error: 'Unknown player' };
    const n = Math.min(qty, inventorySpace(p, cmd.item));
    if (n <= 0) return { ok: false, error: 'Inventory full' };
    const cost = n * price;
    if (!ctx.transact(-cost, 'supplies', `Bought ${n} × ${BLOCK_BY_KEY[cmd.item.slice(6)]?.name}`, true)) return { ok: false, error: `Not enough money (${fmtMoney(cost)})` };
    addToInventory(p, cmd.item, n);
    return { ok: true, data: { bought: n, cost } };
  }
  const it = ITEMS[cmd.item];
  if (!it || it.kind !== 'supply') return { ok: false, error: `${it?.name ?? cmd.item} is not sold here` };
  const unit = supplyPrice(s, cmd.item);
  const cost = unit * qty;
  if (!ctx.transact(-cost, 'supplies', `Bought ${fmtQty(qty)} ${it.unit} ${it.name}`, true)) return { ok: false, error: `Not enough money (${fmtMoney(cost)})` };
  s.company.warehouse[cmd.item] = (s.company.warehouse[cmd.item] ?? 0) + qty;
  return { ok: true, data: { bought: qty, cost } };
}

// ---- Trading desk: hedges -------------------------------------------------------------------------

export function cmdHedge(cmd: Command<'market/hedge'>, ctx: GameContext, netWorth: () => number): CommandResult {
  const s = ctx.state;
  if (!ctx.hasTech('trading_desk')) return { ok: false, error: 'Hedging requires the Trading Desk research' };
  const it = ITEMS[cmd.commodity];
  if (!it || !it.tradable) return { ok: false, error: 'Not a tradable commodity' };
  const volume = Math.floor(Number(cmd.volume));
  const days = Math.floor(Number(cmd.days));
  if (!(volume > 0)) return { ok: false, error: 'Enter a volume to hedge' };
  if (!(days >= HEDGE_MIN_DAYS && days <= HEDGE_MAX_DAYS)) return { ok: false, error: `Hedge tenor must be ${HEDGE_MIN_DAYS}–${HEDGE_MAX_DAYS} days` };
  const price = s.market.prices[cmd.commodity];
  const notional = price * volume;
  const open = s.market.hedges.reduce((a, h) => a + h.remaining * h.price, 0);
  const limit = Math.max(5_000_000, netWorth());
  if (open + notional > limit) return { ok: false, error: `Hedge book limit is ${fmtMoney(limit)} (open: ${fmtMoney(open)})` };
  const fee = notional * HEDGE_FEE;
  if (!ctx.transact(-fee, 'misc', `Hedge fee: ${fmtQty(volume)} ${it.unit} ${it.name}`, true)) return { ok: false, error: `Not enough money for the ${fmtMoney(fee)} fee` };
  const h: Hedge = { id: ctx.newId('hg'), commodity: cmd.commodity, volume, price, expiryDay: s.time.day + days, remaining: volume };
  s.market.hedges.push(h);
  ctx.notify('info', `Hedge placed: ${it.name}`, `${fmtQty(volume)} ${it.unit} locked at $${price.toFixed(2)} for ${days} days (fee ${fmtMoney(fee)}).`);
  return { ok: true, data: { hedgeId: h.id } };
}

export function cmdSetAutoSell(cmd: Command<'market/setAutoSell'>, ctx: GameContext): CommandResult {
  const it = ITEMS[cmd.commodity];
  if (!it || !it.tradable) return { ok: false, error: 'Not a tradable commodity' };
  ctx.state.company.autoSell[cmd.commodity] = {
    enabled: !!cmd.enabled,
    minPrice: Math.max(0, Number(cmd.minPrice) || 0),
    keepReserve: Math.max(0, Number(cmd.keepReserve) || 0),
  };
  return { ok: true };
}
