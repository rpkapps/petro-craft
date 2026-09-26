// Minimal command handlers so the dev harness UI is interactive (mutates the mock state).
import type { CommandBus } from '../../src/core/commands';
import type { GameContext } from '../../src/core/types';
import { TECHS } from '../../src/content/tech';
import { ITEMS } from '../../src/content/items';
import { BLOCK_BY_KEY } from '../../src/core/blocks';

export function registerMockCommands(cmds: CommandBus) {
  const ok = { ok: true };
  cmds.register('time/setSpeed', (c, ctx) => { ctx.state.time.speed = c.speed; return ok; });
  cmds.register('time/setPaused', (c, ctx) => { ctx.state.time.paused = c.paused; ctx.bus.emit('game:paused', { paused: c.paused }); return ok; });
  cmds.register('player/selectSlot', (c, ctx) => { ctx.state.players[ctx.localPlayerId].selectedSlot = c.slot; return ok; });
  cmds.register('player/moveItem', (c, ctx) => {
    const inv = ctx.state.players[ctx.localPlayerId].inventory;
    const a = inv[c.from];
    const b = inv[c.to];
    if (a && b && a.item === b.item) {
      b.count += a.count;
      inv[c.from] = null;
    } else {
      inv[c.to] = a;
      inv[c.from] = b;
    }
    return ok;
  });
  cmds.register('research/start', (c, ctx) => {
    const r = ctx.state.research;
    if (!TECHS[c.techId]) return { ok: false, error: 'Unknown technology' };
    if (!TECHS[c.techId].requires.every((q) => r.completed.includes(q))) return { ok: false, error: 'Prerequisites not researched' };
    if (r.current && r.current !== c.techId) r.queue.unshift(r.current);
    r.queue = r.queue.filter((q) => q !== c.techId);
    r.current = c.techId;
    r.progress = 0;
    return ok;
  });
  cmds.register('research/queue', (c, ctx) => { ctx.state.research.queue = c.techIds; return ok; });
  cmds.register('market/setAutoSell', (c, ctx) => { ctx.state.company.autoSell[c.commodity] = { enabled: c.enabled, minPrice: c.minPrice, keepReserve: c.keepReserve }; return ok; });
  cmds.register('market/sell', (c, ctx) => {
    const p = ctx.state.market.prices[c.commodity] ?? 0;
    const w = ctx.state.company.warehouse;
    w[c.commodity] = Math.max(0, (w[c.commodity] ?? 0) - c.quantity);
    ctx.transact(p * c.quantity, 'sales', `Sold ${c.quantity} ${ITEMS[c.commodity]?.name}`);
    return ok;
  });
  cmds.register('market/buy', (c, ctx) => {
    const unit = c.item.startsWith('block:') ? (BLOCK_BY_KEY[c.item.slice(6)] ? 25 : 0) : ITEMS[c.item]?.basePrice ?? 0;
    if (!ctx.transact(-unit * c.quantity, 'supplies', `Bought ${c.quantity} × ${c.item}`, true)) return { ok: false, error: 'Not enough money' };
    if (c.item.startsWith('block:')) {
      const inv = ctx.state.players[ctx.localPlayerId].inventory;
      const slot = inv.findIndex((s) => s?.item === c.item);
      if (slot >= 0) inv[slot]!.count += c.quantity;
      else {
        const empty = inv.findIndex((s) => !s);
        if (empty < 0) return { ok: false, error: 'Inventory full' };
        inv[empty] = { item: c.item, count: c.quantity };
      }
    } else ctx.state.company.warehouse[c.item] = (ctx.state.company.warehouse[c.item] ?? 0) + c.quantity;
    return ok;
  });
  cmds.register('market/hedge', (c, ctx) => {
    ctx.state.market.hedges.push({ id: ctx.newId('h'), commodity: c.commodity, volume: c.volume, price: ctx.state.market.prices[c.commodity] ?? 0, expiryDay: ctx.state.time.day + c.days, remaining: c.volume });
    return ok;
  });
  cmds.register('contract/accept', (c, ctx) => {
    const cs = ctx.state.contracts;
    const k = cs.offers.find((x) => x.id === c.contractId);
    if (!k) return { ok: false, error: 'Offer expired' };
    if (ctx.state.company.reputation < k.minReputation) return { ok: false, error: `Requires reputation ${k.minReputation}` };
    cs.offers = cs.offers.filter((x) => x !== k);
    k.status = 'active';
    cs.active.push(k);
    return ok;
  });
  cmds.register('contract/abandon', (c, ctx) => {
    const cs = ctx.state.contracts;
    const k = cs.active.find((x) => x.id === c.contractId);
    if (!k) return { ok: false, error: 'Not active' };
    cs.active = cs.active.filter((x) => x !== k);
    k.status = 'failed';
    cs.completed.unshift(k);
    ctx.transact(-k.penalty, 'contracts', `Abandoned ${k.title}`);
    return ok;
  });
  cmds.register('worker/hire', (c, ctx) => {
    const wf = ctx.state.workforce;
    const w = wf.candidates.find((x) => x.id === c.candidateId);
    if (!w) return { ok: false, error: 'Candidate no longer available' };
    wf.candidates = wf.candidates.filter((x) => x !== w);
    w.hiredDay = ctx.state.time.day;
    wf.workers.push(w);
    return ok;
  });
  cmds.register('worker/fire', (c, ctx) => {
    const wf = ctx.state.workforce;
    const w = wf.workers.find((x) => x.id === c.workerId);
    if (w?.assignedTo) { const b = ctx.state.buildings[w.assignedTo]; if (b) b.workers = b.workers.filter((x) => x !== w.id); }
    wf.workers = wf.workers.filter((x) => x.id !== c.workerId);
    return ok;
  });
  cmds.register('worker/assign', (c, ctx) => {
    const w = ctx.state.workforce.workers.find((x) => x.id === c.workerId);
    if (!w) return { ok: false, error: 'No such worker' };
    if (w.assignedTo) { const b = ctx.state.buildings[w.assignedTo]; if (b) b.workers = b.workers.filter((x) => x !== w.id); }
    w.assignedTo = c.buildingId ?? undefined;
    if (c.buildingId) ctx.state.buildings[c.buildingId]?.workers.push(w.id);
    return ok;
  });
  cmds.register('worker/setAutoAssign', (c, ctx) => { ctx.state.workforce.autoAssign = c.enabled; return ok; });
  cmds.register('finance/takeLoan', (c, ctx) => {
    const rate = 0.07;
    ctx.state.company.loans.push({ id: ctx.newId('l'), principal: c.amount, balance: c.amount, rate, takenDay: ctx.state.time.day, termDays: c.termDays, dailyPayment: (c.amount * (1 + rate * c.termDays / 365)) / c.termDays });
    ctx.transact(c.amount, 'loan', 'Loan drawdown');
    return ok;
  });
  cmds.register('finance/repayLoan', (c, ctx) => {
    const l = ctx.state.company.loans.find((x) => x.id === c.loanId);
    if (!l) return { ok: false, error: 'No such loan' };
    const amt = Math.min(c.amount, l.balance);
    if (!ctx.transact(-amt, 'loan', 'Loan repayment', true)) return { ok: false, error: 'Not enough cash' };
    l.balance -= amt;
    if (l.balance <= 1) ctx.state.company.loans = ctx.state.company.loans.filter((x) => x !== l);
    return ok;
  });
  cmds.register('lease/buy', (c, ctx) => {
    const k = `${c.px},${c.pz}`;
    if (ctx.state.leases[k]) return { ok: false, error: 'Parcel already leased' };
    const q = ctx.services.economy.leaseQuote(c.px, c.pz);
    if (!ctx.transact(-q.price, 'leases', `Lease ${k}`, true)) return { ok: false, error: 'Not enough money' };
    ctx.state.leases[k] = { px: c.px, pz: c.pz, owner: ctx.localPlayerId, acquiredDay: ctx.state.time.day, price: q.price, royalty: q.royalty };
    ctx.bus.emit('lease:acquired', { key: k });
    return ok;
  });
  cmds.register('objective/claim', (c, ctx) => {
    const o = ctx.state.objectives.list.find((x) => x.id === c.objectiveId);
    if (!o || !o.done || o.claimed) return { ok: false, error: 'Nothing to claim' };
    o.claimed = true;
    ctx.transact(o.reward, 'misc', `Objective reward: ${o.title}`);
    return ok;
  });
  cmds.register('building/toggle', (c, ctx) => { const b = ctx.state.buildings[c.buildingId]; if (b) { b.enabled = c.enabled; b.status = c.enabled ? 'active' : 'disabled'; } return ok; });
  cmds.register('building/setThrottle', (c, ctx) => { const b = ctx.state.buildings[c.buildingId]; if (b) b.throttle = c.throttle; return ok; });
  cmds.register('building/setRecipe', (c, ctx) => { const b = ctx.state.buildings[c.buildingId]; if (b) b.recipeId = c.recipeId; return ok; });
  cmds.register('building/configure', (c, ctx) => { const b = ctx.state.buildings[c.buildingId]; if (b) b.config[c.key] = c.value; return ok; });
  cmds.register('building/repair', (c, ctx) => {
    const b = ctx.state.buildings[c.buildingId];
    if (!b) return { ok: false, error: 'Gone' };
    ctx.transact(-(100 - b.condition) * 900, 'repairs', 'Repair');
    b.condition = 100;
    if (b.status === 'broken') b.status = 'active';
    return ok;
  });
  cmds.register('build/demolish', (c, ctx) => { delete ctx.state.buildings[c.buildingId]; return ok; });
  cmds.register('survey/start', (c, ctx) => {
    const q = ctx.services.seismic.quote(c.kind, c.x0, c.z0, c.x1, c.z1);
    if (!ctx.transact(-q.cost, 'survey', 'Seismic survey', true)) return { ok: false, error: 'Not enough money' };
    const id = ctx.newId('s');
    ctx.state.surveys[id] = { id, kind: c.kind, x0: c.x0, z0: c.z0, x1: c.x1, z1: c.z1, status: 'in_progress', progress: 0.02, quality: 1, fluidIndicators: false, startedDay: ctx.state.time.day, cost: q.cost, name: `${c.kind.toUpperCase()} Survey ${Object.keys(ctx.state.surveys).length + 1}` };
    return ok;
  });
  cmds.register('well/setChoke', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.choke = c.choke; return ok; });
  cmds.register('well/setMudWeight', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.mudWeight = c.mudWeight; return ok; });
  cmds.register('well/setLift', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.lift = c.lift; return ok; });
  cmds.register('well/shutIn', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.status = c.shutIn ? 'shut_in' : 'producing'; return ok; });
  cmds.register('well/rename', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.name = c.name; return ok; });
  cmds.register('well/controlKick', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) { w.status = 'drilling'; w.kickVolume = 0; } return ok; });
  cmds.register('well/capBlowout', () => ({ ok: false, error: 'Capping stack is still being mobilised' }));
  cmds.register('well/complete', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.status = 'completing'; return ok; });
  cmds.register('well/plan', (c, ctx) => {
    const rig = ctx.state.buildings[c.rigId];
    const id = ctx.newId('w');
    const cx = Math.floor(rig.x + rig.size[0] / 2);
    const cz = Math.floor(rig.z + rig.size[1] / 2);
    const surfaceY = ctx.geology.surfaceHeight(cx, cz);
    ctx.state.wells[id] = {
      id, name: c.name ?? `Well ${id}`, x: cx, z: cz, surfaceY, offshore: false, purpose: c.purpose, status: 'planned', plan: c.plan, trajectory: [], measuredDepth: 0,
      plannedDepth: surfaceY - c.plan.targetY, currentY: surfaceY, rigId: c.rigId, casing: [], mudWeight: c.plan.mudWeight, bitCondition: 100, kickVolume: 0, penetrated: [],
      completedReservoirs: [], reservoirContact: 0, fracStages: 0, choke: 1, lift: 'natural', productivity: 1, rates: { oil: 0, gas: 0, water: 0 }, bhp: 0, waterCut: 0, gor: 0,
      cumulative: { oil: 0, gas: 0, water: 0 }, history: [], log: [], spudDay: ctx.state.time.day, cost: 0, owner: ctx.localPlayerId,
    };
    return { ok: true, data: { wellId: id } };
  });
  cmds.register('well/spud', (c, ctx) => { const w = ctx.state.wells[c.wellId]; if (w) w.status = 'drilling'; return ok; });
  cmds.register('rig/skid', (c, ctx) => { const b = ctx.state.buildings[c.rigId]; if (b) { b.x = c.x - 2; b.z = c.z - 2; } return ok; });
}

/** Periodic fake sim so the HUD has something to animate (money ticks, time, notifications). */
export function mockTick(ctx: GameContext, dt: number) {
  const st = ctx.state;
  if (st.time.paused) return;
  const minutes = 2.4 * dt * st.time.speed;
  st.time.minuteOfDay += minutes;
  st.time.totalMinutes += minutes;
  if (st.time.minuteOfDay >= 1440) {
    st.time.minuteOfDay -= 1440;
    st.time.day++;
    ctx.bus.emit('time:newDay', { day: st.time.day });
  }
  const r = st.research;
  if (r.current) r.progress += (r.pointsPerDay * minutes) / 1440;
}
