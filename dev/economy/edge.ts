// Edge-case checks for the economy module (asserts; exits non-zero on failure).
// Run: node --experimental-transform-types --no-warnings --import ./dev/economy/register.mjs dev/economy/edge.ts
import { GameSession } from '../../src/core/Game';
import { createInitialState } from '../../src/core/state';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { addBuilding, createBuildingState } from '../../src/core/buildingUtil';
import type { GameContext, Notification } from '../../src/core/types';
import { createEconomySystems, economyState, contractWindowDays } from '../../src/sim/economy';
import { createFakeGeology, createFakeWorld } from './fakes';

let failures = 0;
function check(cond: unknown, msg: string) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
}

function newSession(difficulty: 'easy' | 'normal' | 'hard' | 'sandbox', seed = 7) {
  const geology = createFakeGeology(seed);
  const world = createFakeWorld(geology);
  const state = createInitialState(
    { saveName: 't', companyName: 'Edge Co', seed, worldSize: 'medium', difficulty, tutorial: true, hazards: true, creative: false },
    'p1', { x: 200, y: 71, z: 200 },
  );
  const session = new GameSession(state, world, geology, { ...DEFAULT_SETTINGS }, 'p1', createEconomySystems());
  session.init();
  session.ctx.state.time.speed = 25;
  const notes: Notification[] = [];
  session.ctx.bus.on('notify', (n) => notes.push(n));
  return { session, ctx: session.ctx, notes };
}
const runDays = (session: GameSession, days: number) => {
  const target = session.ctx.state.time.day + days;
  while (session.ctx.state.time.day < target) session.step();
};
const place = (ctx: GameContext, type: string, x: number, z: number) => {
  const b = createBuildingState(ctx, type, x, 70, z, 0, { prebuilt: true });
  addBuilding(ctx, b);
  b.status = 'active';
  return b;
};

// 1) Determinism: same seed → same prices & weather after 20 days.
{
  const a = newSession('normal', 99);
  const b = newSession('normal', 99);
  runDays(a.session, 20);
  runDays(b.session, 20);
  check(JSON.stringify(a.ctx.state.market.prices) === JSON.stringify(b.ctx.state.market.prices), 'deterministic prices');
  check(JSON.stringify(a.ctx.state.weather) === JSON.stringify(b.ctx.state.weather), 'deterministic weather');
}

// 2) Bankruptcy warnings & insolvency; spending blocked.
{
  const { session, ctx, notes } = newSession('hard');
  ctx.transact(-5_000_000, 'misc', 'test drain');
  runDays(session, 40);
  const ext = economyState(ctx.state).finance;
  check(notes.some((n) => n.title === 'Creditors are calling'), 'bankruptcy warning issued');
  check(ext.insolvent && notes.some((n) => n.title === 'Company insolvent'), 'insolvency flagged after 30 days below −$2M');
  const loan = ctx.commands.dispatch({ type: 'finance/takeLoan', amount: 100_000, termDays: 90 });
  check(!loan.ok, `loan refused while insolvent (${loan.error})`);
  const buy = ctx.commands.dispatch({ type: 'market/buy', item: 'cement', quantity: 10 });
  check(!buy.ok, `purchases blocked without funds (${buy.error})`);
}

// 3) Morale collapse → quits; injuries respect hazards rule.
{
  const { session, ctx, notes } = newSession('normal');
  for (const w of ctx.state.workforce.workers) {
    w.wage = 50;
    w.morale = 5;
  }
  runDays(session, 30);
  check(notes.some((n) => n.title.endsWith(' quit')), 'underpaid, miserable workers quit');
}

// 4) Research: prerequisites, queue, completion with unlock names.
{
  const { session, ctx, notes } = newSession('normal');
  const bad = ctx.commands.dispatch({ type: 'research/start', techId: 'seismic_4d' });
  check(!bad.ok && /Requires/.test(bad.error ?? ''), `prereq check (${bad.error})`);
  const q = ctx.commands.dispatch({ type: 'research/queue', techIds: ['bop_upgrade', 'fire_response', 'predictive_maintenance'] });
  check(q.ok && ctx.state.research.current === 'bop_upgrade', 'queue starts first valid tech');
  place(ctx, 'research_lab', 180, 210);
  // Staff the lab (2 engineers + 2 geoscientists; the starting crew has one geoscientist).
  for (const role of ['engineer', 'engineer', 'geoscientist'] as const) {
    ctx.state.workforce.workers.push({ id: ctx.newId('w'), name: `Test ${role}`, role, skill: 3, xp: 0, wage: 900, morale: 70, fatigue: 0, hiredDay: 1, portraitSeed: 1 });
  }
  runDays(session, 20);
  check(ctx.state.research.completed.includes('fire_response'), 'queued chain completes');
  check(notes.some((n) => n.title === 'Research complete: Fire Response' && /Fire Station/.test(n.text ?? '')), 'completion lists unlocked building names');
}

// 5) Contracts: accept, abandon penalty, reputation gating, deadlines.
{
  const { session, ctx } = newSession('normal');
  const s = ctx.state;
  const offer = s.contracts.offers[0];
  check(!!offer && contractWindowDays(offer) >= 7, 'starter offers exist with a delivery window');
  s.company.reputation = 0;
  const high = s.contracts.offers.find((o) => o.minReputation > 0);
  if (high) check(!ctx.commands.dispatch({ type: 'contract/accept', contractId: high.id }).ok, 'reputation gate enforced');
  s.company.reputation = 60;
  const acc = ctx.commands.dispatch({ type: 'contract/accept', contractId: offer.id });
  check(acc.ok && s.contracts.active.length === 1, 'accept moves offer to active');
  const money = s.company.money;
  const ab = ctx.commands.dispatch({ type: 'contract/abandon', contractId: offer.id });
  check(ab.ok && s.company.money < money && s.contracts.completed.at(-1)?.status === 'failed', 'abandon charges penalty');
  const t = place(ctx, 'truck_terminal', 212, 205);
  for (let i = 0; i < 4; i++) {
    const c = s.workforce.candidates.find((x) => x.role === 'trucker') ?? null;
    if (c) ctx.commands.dispatch({ type: 'worker/hire', candidateId: c.id });
  }
  const o2 = s.contracts.offers.find((o) => o.commodity === 'crude_oil') ?? s.contracts.offers[0];
  if (o2) {
    ctx.commands.dispatch({ type: 'contract/accept', contractId: o2.id });
    t.storage[o2.commodity] = 1_500;
    runDays(session, 1);
    check(o2.delivered > 0, `terminal delivers to contract first (${o2.delivered.toFixed(0)} ${o2.commodity})`);
  }
  runDays(session, 40);
  check(s.contracts.active.every((c) => c.deadlineDay >= s.time.day), 'no overdue active contracts remain');
}

// 6) Hedge requires trading desk; works once researched.
{
  const { session, ctx } = newSession('normal');
  const s = ctx.state;
  check(!ctx.commands.dispatch({ type: 'market/hedge', commodity: 'crude_oil', volume: 1000, days: 30 }).ok, 'hedge blocked without Trading Desk');
  s.research.completed.push('hr_training', 'trading_desk');
  const h = ctx.commands.dispatch({ type: 'market/hedge', commodity: 'crude_oil', volume: 1000, days: 30 });
  check(h.ok && s.market.hedges.length === 1, 'hedge placed');
  const t = place(ctx, 'truck_terminal', 212, 205);
  t.storage.crude_oil = 400;
  for (const w of s.workforce.workers.filter((x) => x.role === 'trucker')) ctx.commands.dispatch({ type: 'worker/assign', workerId: w.id, buildingId: t.id });
  runDays(session, 2);
  check(s.market.hedges[0].remaining < 1000, `hedged volume consumed by sales (remaining ${s.market.hedges[0]?.remaining.toFixed(0)})`);
}

// 7) Leases: quote stable, offshore costs more, royalty range, sell refund.
{
  const { ctx } = newSession('normal');
  const q1 = ctx.services.economy.leaseQuote(3, 3);
  const q2 = ctx.services.economy.leaseQuote(3, 3);
  check(JSON.stringify(q1) === JSON.stringify(q2), 'lease quote deterministic (no RNG use)');
  const off = ctx.services.economy.leaseQuote(14, 5);
  check(off.price > q1.price, `offshore parcel pricier (${off.price} vs ${q1.price})`);
  let okRoyalty = true;
  for (let px = 0; px < 16; px++) for (let pz = 0; pz < 16; pz++) {
    const q = ctx.services.economy.leaseQuote(px, pz);
    if (q.royalty < 0.125 || q.royalty > 0.25 || q.prospectivity < 0 || q.prospectivity > 1) okRoyalty = false;
  }
  check(okRoyalty, 'royalty 12.5–25% and prospectivity 0..1 everywhere');
  const money = ctx.state.company.money;
  check(ctx.commands.dispatch({ type: 'lease/buy', px: 3, pz: 3 }).ok && ctx.state.company.money === money - q1.price, 'lease bought at quoted price');
  check(ctx.commands.dispatch({ type: 'lease/sell', px: 3, pz: 3 }).ok && Math.abs(ctx.state.company.money - (money - q1.price / 2)) < 1, 'lease sold for 50%');
  check(!ctx.commands.dispatch({ type: 'lease/buy', px: 99, pz: 0 }).ok, 'out-of-bounds parcel rejected');
}

// 8) Weather: seasons progress, hurricanes forecast, forecast length grows with a weather station.
{
  const { session, ctx, notes } = newSession('normal', 4242);
  check(ctx.state.weather.forecast.length === 3, '3-day forecast without station');
  place(ctx, 'weather_station', 180, 180);
  runDays(session, 1);
  check(ctx.state.weather.forecast.length === 7, '7-day forecast with station');
  const seasons = new Set<string>();
  let hurricaneWarned = false;
  for (let d = 0; d < 240; d++) {
    runDays(session, 1);
    seasons.add(ctx.state.weather.season);
    if (notes.some((n) => n.title === 'Hurricane warning')) hurricaneWarned = true;
    const w = ctx.state.weather;
    if (!(w.cloudCover >= 0 && w.cloudCover <= 1 && w.precipitation >= 0 && w.precipitation <= 1 && Number.isFinite(w.temperature))) {
      check(false, 'weather values in range');
      break;
    }
  }
  check(seasons.size === 4, `all seasons seen (${[...seasons].join(',')})`);
  check(hurricaneWarned, 'a hurricane was forecast with a warning within ~2 years');
}

// 9) Block shop & inventory stacking; supplies discount with a Supply Yard.
{
  const { ctx } = newSession('normal');
  const p = ctx.state.players.p1;
  const r = ctx.commands.dispatch({ type: 'market/buy', item: 'block:glass', quantity: 70 });
  const glass = p.inventory.filter((sl) => sl?.item === 'block:glass').map((sl) => sl!.count);
  check(r.ok && glass.join(',') === '64,6', `blocks stack by 64 (${glass.join(',')})`);
  const before = ctx.state.company.money;
  ctx.commands.dispatch({ type: 'market/buy', item: 'cement', quantity: 100 });
  const full = before - ctx.state.company.money;
  const yard = place(ctx, 'warehouse', 170, 170);
  yard.status = 'active';
  const b2 = ctx.state.company.money;
  ctx.commands.dispatch({ type: 'market/buy', item: 'cement', quantity: 100 });
  check(Math.abs(b2 - ctx.state.company.money - full * 0.8) < 0.01, 'Supply Yard gives 20% discount');
  check(ctx.commands.dispatch({ type: 'company/rename', name: '  Black Gold  Ltd ' }).ok && ctx.state.company.name === 'Black Gold Ltd', 'rename trims & collapses spaces');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL PASSED');
if (failures) (globalThis as { process?: { exitCode?: number } }).process!.exitCode = 1;
