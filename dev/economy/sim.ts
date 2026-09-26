// Headless 365-day economy simulation using the real core (GameSession, createInitialState) with a
// fake world/geology and a fake "operations" system standing in for upstream & facilities.
//
// Run: node --experimental-transform-types --no-warnings --import ./dev/economy/register.mjs dev/economy/sim.ts [days]
import { GameSession } from '../../src/core/Game';
import { createInitialState } from '../../src/core/state';
import { DEFAULT_SETTINGS } from '../../src/core/settings';
import { addBuilding, createBuildingState } from '../../src/core/buildingUtil';
import type { BuildingState, GameContext, SimSystem, WellState } from '../../src/core/types';
import { TECHS } from '../../src/content/tech';
import { BUILDINGS } from '../../src/content/buildings';
import { createEconomySystems, economyState, CHAPTERS, WEATHER_LABEL, netWorthBreakdown, maxLoan } from '../../src/sim/economy';
import { createFakeGeology, createFakeWorld, fakeWell } from './fakes';

const argv = (globalThis as { process?: { argv: string[] } }).process?.argv ?? [];
const DAYS = Number(argv[2] ?? 365);
const SEED = 1337;
const geology = createFakeGeology(SEED);
const world = createFakeWorld(geology);
const state = createInitialState(
  { saveName: 'test', companyName: 'Prairie Wildcat Oil', seed: SEED, worldSize: 'medium', difficulty: 'normal', tutorial: true, hazards: true, creative: false },
  'p1', { x: 200, y: 71, z: 200 },
);

// ---- Fake upstream/facilities ---------------------------------------------------------------------
const ids: Record<string, string> = {};
function place(ctx: GameContext, key: string, type: string, x: number, z: number) {
  const b = createBuildingState(ctx, type, x, 70, z, 0, { prebuilt: true });
  addBuilding(ctx, b);
  b.status = 'active';
  ids[key] = b.id;
  return b;
}
const B = (key: string): BuildingState | undefined => (ids[key] ? state.buildings[ids[key]] : undefined);
function fill(b: BuildingState | undefined, item: string, amount: number, cap: number) {
  if (!b) return 0;
  const cur = b.storage[item] ?? 0;
  const add = Math.max(0, Math.min(amount, cap - cur));
  b.storage[item] = cur + add;
  return add;
}

const wells: WellState[] = [];
const fakeOps: SimSystem = {
  id: 'fake.ops',
  init() {},
  tick(ctx, step) {
    const s = ctx.state;
    const day = s.time.day;
    const dt = step.days;
    // Production & flow into terminals.
    let oil = 0, gas = 0;
    for (const w of wells) {
      if (w.status !== 'producing') continue;
      const age = day - (w.completedDay ?? day);
      const decline = Math.exp(-age / 400);
      const base = w.id === 'w3' ? 0 : w.id === 'w2' ? 380 : 450;
      w.rates.oil = base * decline;
      w.rates.gas = w.id === 'w3' ? 9000 * decline : w.rates.oil * 0.65;
      w.rates.water = w.rates.oil * 0.1;
      oil += w.rates.oil * dt;
      gas += w.rates.gas * dt;
      w.cumulative.oil += w.rates.oil * dt;
      w.cumulative.gas += w.rates.gas * dt;
      s.stats.totalOil += w.rates.oil * dt;
      s.stats.totalGas += w.rates.gas * dt;
    }
    const rail = B('rail');
    const toRail = rail ? oil * 0.7 : 0;
    fill(rail, 'crude_oil', toRail, 20_000);
    fill(B('truck'), 'crude_oil', oil - toRail, 1_500);
    const meter = B('meter');
    if (meter) fill(meter, day >= 100 ? 'dry_gas' : 'natural_gas', day >= 100 ? gas * 0.85 : gas, 8_000);
    else s.environment.flaredToday += gas;
    if (day >= 150 && rail) {
      fill(rail, 'gasoline', 900 * dt, 20_000);
      fill(rail, 'diesel', 700 * dt, 20_000);
    }
    if (day >= 170 && B('export')) {
      fill(B('export'), 'crude_oil', 4_000 * dt, 100_000); // offshore tie-in
      fill(B('export'), 'lng', 150 * dt, 100_000);
    }
    // Emissions, venting, credits.
    const nb = Object.keys(s.buildings).length;
    s.environment.emissionsToday += (18 + 2.2 * nb) * dt;
    s.environment.emissionsTotal += (18 + 2.2 * nb) * dt;
    if (day >= 100 && day < 110) s.environment.ventedToday += 9_000 * dt;
    if (day >= 280 && day < 300) s.environment.ventedToday += 40_000 * dt; // reckless venting → suspension
    if (day >= 250) s.environment.carbonCredits += 40 * dt;
    // Mark all constructed buildings active (facilities would do this).
    for (const b of Object.values(s.buildings)) if (b.constructionProgress >= 1 && b.status === 'idle') b.status = 'active';
  },
  onNewDay(ctx, day) {
    const s = ctx.state;
    for (const w of wells) if (w.status === 'producing') {
      w.history.push([day - 1, w.rates.oil, w.rates.gas, w.rates.water]);
      if (w.history.length > 720) w.history.shift();
    }
    const add = (key: string, type: string, x: number, z: number) => !ids[key] && place(ctx, key, type, x, z);
    if (day === 2) add('office', 'field_office', 190, 185);
    if (day === 2) {
      s.surveys.sv1 = { id: 'sv1', kind: '2d', x0: 170, z0: 190, x1: 250, z1: 195, status: 'in_progress', progress: 0.3, quality: 1, fluidIndicators: false, startedDay: 2, cost: 150_000, name: 'Line 1' };
    }
    if (day === 4) {
      s.surveys.sv1.status = 'complete';
      s.surveys.sv1.progress = 1;
      ctx.bus.emit('survey:completed', { id: 'sv1' });
      add('rig', 'drilling_rig_land', 202, 196);
    }
    if (day === 5) add('truck', 'truck_terminal', 212, 205);
    if (day === 6) {
      const w = fakeWell('w1', 204, 198, 'r1');
      w.completedDay = 6;
      wells.push(w);
      s.wells[w.id] = w;
      s.reservoirs.r1 = { id: 'r1', discovered: true, knowledge: 0.5, pressure: 3800, cumulative: { oil: 0, gas: 0, water: 0 }, injected: { water: 0, gas: 0, co2: 0 }, remainingOil: 9e6, remainingGas: 6e6, waterFrontY: 27 };
      ctx.bus.emit('well:discovery', { id: 'w1', reservoirId: 'r1', fluid: 'oil' });
      add('tank', 'oil_tank_small', 208, 200);
      s.networks.n1 = { id: 'n1', category: 'oil', pipeCount: 8, buildings: [ids.tank, 'wh1'], linepack: { crude_oil: 40 }, capacity: 10_000, flow: 0, boosters: 0, anchor: { x: 206, y: 70, z: 200 } };
      const wh = createBuildingState(ctx, 'wellhead', 203, 70, 197, 0, { prebuilt: true });
      wh.id = 'wh1';
      wh.wellId = 'w1';
      addBuilding(ctx, wh);
    }
    if (day === 9) add('meter', 'gas_sales_meter', 216, 196);
    if (day === 25) add('lab', 'research_lab', 180, 210);
    if (day === 30) {
      const w = fakeWell('w2', 214, 188, 'r1');
      w.completedDay = 30;
      wells.push(w);
      s.wells[w.id] = w;
    }
    if (day === 35) add('camp', 'worker_camp', 175, 180);
    if (day === 46 && s.leases['10,3']) {
      const w = fakeWell('w3', 330, 120, 'r3');
      w.completedDay = 46;
      wells.push(w);
      s.wells[w.id] = w;
    }
    if (day === 60) add('rail', 'rail_terminal', 170, 220);
    if (day === 90) add('wx', 'weather_station', 185, 175);
    if (day === 165) add('export', 'export_terminal', 395, 220);
    if (day === 200) {
      s.environment.spills.push({ id: 'sp1', x: 210, y: 70, z: 205, volume: 320, cleaned: 0, day: 200, kind: 'oil' });
      s.hazards.incidents.push({ day: 200, kind: 'spill', text: 'Tank overflow spilled 320 bbl of crude', x: 210, z: 205 });
    }
    if (day === 207) s.environment.spills[0].cleaned = 320;
    if (day === 180) s.hazards.incidents.push({ day: 180, kind: 'spill', text: 'Brine leak contaminated a fresh-water aquifer', x: 200, z: 200 });
  },
};

// ---- Session --------------------------------------------------------------------------------------
const economy = createEconomySystems();
const session = new GameSession(state, world, geology, { ...DEFAULT_SETTINGS }, 'p1', [fakeOps, ...economy]);
session.init();
const ctx = session.ctx;
ctx.state.time.speed = 25;

const notes: { day: number; level: string; title: string; text?: string }[] = [];
ctx.bus.on('notify', (n) => notes.push({ day: n.day, level: n.level, title: n.title, text: n.text }));
const events: string[] = [];
ctx.bus.on('market:event', (e) => events.push(`d${ctx.state.time.day} ${e.title}`));
let strikes = 0;
ctx.bus.on('weather:lightning', () => strikes++);
const fires: string[] = [];
ctx.bus.on('hazard:fireStarted', (e) => fires.push(`d${ctx.state.time.day} fire ${e.id} @${e.x},${e.z}`));
const weatherSeq: string[] = [];
ctx.bus.on('weather:changed', (e) => weatherSeq.push(`d${ctx.state.time.day} ${String(Math.floor(ctx.state.time.minuteOfDay / 60)).padStart(2, '0')}h ${e.kind}`));
const errors: string[] = [];
ctx.bus.on('ui:error', (e) => errors.push(`d${ctx.state.time.day} ${e.text}`));

const dispatch = (cmd: Parameters<typeof ctx.commands.dispatch>[0]) => {
  const r = ctx.commands.dispatch(cmd);
  log(`  cmd ${cmd.type} → ${r.ok ? 'ok' : 'ERR ' + r.error}${r.data ? ' ' + JSON.stringify(r.data) : ''}`);
  return r;
};
const out: string[] = [];
const log = (s: string) => out.push(s);
const $ = (v: number) => (Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : `$${Math.round(v).toLocaleString()}`);

// Initial state checks.
const s = ctx.state;
log(`=== New game: ${s.company.name}, ${s.meta.difficulty}, money ${$(s.company.money)}`);
log(`Leases: ${Object.keys(s.leases).join(' ')}  quote(10,3)=${JSON.stringify(ctx.services.economy.leaseQuote(10, 3))} quote(14,9 offshore)=${JSON.stringify(ctx.services.economy.leaseQuote(14, 9))} quote(1,1)=${JSON.stringify(ctx.services.economy.leaseQuote(1, 1))}`);
log(`Crew: ${s.workforce.workers.map((w) => `${w.name} (${w.role} s${w.skill} $${w.wage})`).join('; ')}`);
log(`Candidates (${s.workforce.candidates.length}): ${s.workforce.candidates.map((w) => `${w.name}/${w.role}/s${w.skill}/$${w.wage}`).join('; ')}`);
log(`Offers: ${s.contracts.offers.map((c) => `${c.client}: ${c.quantity} ${c.commodity} @${c.pricePerUnit} window ${c.deadlineDay - c.offeredDay}d rep≥${c.minReputation}`).join(' | ')}`);
log(`Price history pre-seed: crude ${s.market.history.crude_oil.length} days, first ${s.market.history.crude_oil[0]} last ${s.market.history.crude_oil.at(-1)} now ${s.market.prices.crude_oil.toFixed(2)}`);
log(`Weather: ${s.weather.current} ${s.weather.temperature.toFixed(1)}°C, forecast ${s.weather.forecast.map((f) => `${f.day}:${f.kind} ${f.tempLow}/${f.tempHigh}`).join(', ')}`);
log(`Objectives ch${s.objectives.chapter}: ${s.objectives.list.map((o) => o.id).join(', ')}; tutorialStep ${s.objectives.tutorialStep}`);
log(`Net worth: ${$(ctx.services.economy.netWorth())}`);

ctx.bus.emit('ui:open', { panel: 'map' });
ctx.bus.emit('ui:overlay', { overlay: 'leases' });

const track = ['crude_oil', 'dry_gas', 'natural_gas', 'gasoline', 'diesel', 'polyethylene', 'lng'];
const t0 = performance.now();
let steps = 0;
let lastDay = s.time.day;
let hedged = false;

function daily(day: number) {
  // Driver: accept good offers.
  // A sensible player: one contract per commodity at a time, only for what we produce now.
  const producing = new Set(Object.keys(economyState(s).sales.totals));
  if (day < 8) producing.add('crude_oil');
  for (const c of [...s.contracts.offers]) {
    if (s.contracts.active.length >= 2 + Math.floor(s.company.reputation / 25)) break;
    if (!producing.has(c.commodity) || s.contracts.active.some((a) => a.commodity === c.commodity)) continue;
    if (s.company.reputation >= c.minReputation) dispatch({ type: 'contract/accept', contractId: c.id });
  }
  // Fill open positions every 5 days.
  if (day % 5 === 0) {
    const need: Record<string, number> = {};
    for (const b of Object.values(s.buildings)) for (const [r, n] of Object.entries(BUILDINGS[b.type].crew)) need[r] = (need[r] ?? 0) + (n ?? 0);
    for (const w of s.workforce.workers) need[w.role] = (need[w.role] ?? 0) - 1;
    for (const c of [...s.workforce.candidates]) if ((need[c.role] ?? 0) > 0 && dispatch({ type: 'worker/hire', candidateId: c.id }).ok) need[c.role]--;
  }
  for (const o of s.objectives.list) if (o.done && !o.claimed) dispatch({ type: 'objective/claim', objectiveId: o.id });
  if (day === 2) {
    dispatch({ type: 'research/start', techId: 'pumpjacks' });
    dispatch({ type: 'research/queue', techIds: ['well_logging', 'hr_training', 'bop_upgrade', 'trading_desk', 'large_storage', 'rail_logistics', 'compression', 'gas_processing', 'refining', 'marine_export'] });
  }
  if (day === 3 || day === 40) {
    let need = 4 - s.workforce.workers.filter((w) => w.role === 'trucker').length;
    for (const c of [...s.workforce.candidates]) if (need > 0 && c.role === 'trucker' && dispatch({ type: 'worker/hire', candidateId: c.id }).ok) need--;
  }
  if (day === 26 || day === 61) {
    for (const role of ['engineer', 'engineer', 'geoscientist', 'operator', 'operator'] as const) {
      const c = s.workforce.candidates.find((x) => x.role === role);
      if (c) dispatch({ type: 'worker/hire', candidateId: c.id });
    }
  }
  if (day === 10) {
    dispatch({ type: 'market/buy', item: 'drill_pipe', quantity: 20 });
    dispatch({ type: 'market/buy', item: 'block:pipe_oil', quantity: 100 });
    dispatch({ type: 'market/buy', item: 'block:bedrock', quantity: 1 });
  }
  if (day === 12) dispatch({ type: 'lease/buy', px: 10, pz: 3 });
  if (day === 13) dispatch({ type: 'lease/buy', px: 10, pz: 3 });
  if (day === 20) {
    log(`  max loan ${$(maxLoan(s, ctx.services.economy.netWorth()))}`);
    dispatch({ type: 'finance/takeLoan', amount: 1_000_000, termDays: 180 });
  }
  if (day === 40 && s.company.loans[0]) dispatch({ type: 'finance/repayLoan', loanId: s.company.loans[0].id, amount: 300_000 });
  if (day === 30) dispatch({ type: 'company/rename', name: '  Prairie Wildcat Oil & Gas  ' });
  if (day === 50) {
    s.company.warehouse.crude_oil = 500;
    dispatch({ type: 'market/sell', commodity: 'crude_oil', quantity: 500, source: 'warehouse' });
    dispatch({ type: 'market/sell', commodity: 'crude_oil', quantity: 300 });
  }
  if (day === 90) dispatch({ type: 'market/setAutoSell', commodity: 'crude_oil', enabled: true, minPrice: 55, keepReserve: 100 });
  if (!hedged && ctx.hasTech('trading_desk')) {
    hedged = true;
    dispatch({ type: 'market/hedge', commodity: 'crude_oil', volume: 8_000, days: 30 });
  }
  if (day === 200) dispatch({ type: 'worker/fire', workerId: s.workforce.workers[s.workforce.workers.length - 1].id });
  if (day === 210) dispatch({ type: 'lease/sell', px: 10, pz: 3 });
  if (day === 211) dispatch({ type: 'lease/sell', px: 0, pz: 0 });
  if (day === 15) {
    dispatch({ type: 'worker/assign', workerId: s.workforce.workers[0].id, buildingId: ids.truck });
    const tr = s.workforce.workers.find((w) => w.role === 'trucker');
    if (tr) dispatch({ type: 'worker/assign', workerId: tr.id, buildingId: ids.truck });
  }
}

function summary(day: number) {
  const px = track.map((id) => `${id.split('_')[0]} ${s.market.prices[id].toFixed(id === 'dry_gas' || id === 'natural_gas' ? 2 : 1)}`).join(' | ');
  const morale = s.workforce.workers.reduce((a, w) => a + w.morale, 0) / Math.max(1, s.workforce.workers.length);
  const nw = netWorthBreakdown(s);
  log(`D${String(day).padStart(3)} ${s.weather.season.padEnd(6)} ${WEATHER_LABEL[s.weather.current].padEnd(13)} ${s.weather.temperature.toFixed(0).padStart(3)}°C wind ${s.weather.windSpeed.toFixed(0).padStart(2)} | cash ${$(s.company.money)} NW ${$(nw.total)} rep ${s.company.reputation.toFixed(0)} env ${s.environment.score.toFixed(0)} | crew ${s.workforce.workers.length}/${s.workforce.housing} mor ${morale.toFixed(0)} | R&D ${s.research.current ?? '-'} ${s.research.progress.toFixed(0)} (${s.research.pointsPerDay.toFixed(1)}/d, ${s.research.completed.length} done) | ${px}`);
}

while (s.time.day <= DAYS) {
  session.step();
  steps++;
  if (s.time.day !== lastDay) {
    lastDay = s.time.day;
    daily(s.time.day);
    if (s.time.day % 15 === 0 || s.time.day <= 3) summary(s.time.day);
    for (const [k, v] of Object.entries(s.market.prices)) if (!Number.isFinite(v) || v <= 0) throw new Error(`bad price ${k}=${v}`);
    if (!Number.isFinite(s.company.money)) throw new Error('money NaN');
  }
}
const ms = performance.now() - t0;

// ---- Report ---------------------------------------------------------------------------------------
log(`\n=== ${steps} steps in ${ms.toFixed(0)} ms (${((ms / steps) * 1000).toFixed(1)} µs/step)`);
log(`\nMarket events (${events.length}): ${events.join('; ')}`);
log(`\nPrice paths (every 30 days, from history):`);
for (const id of ['crude_oil', 'condensate', 'dry_gas', 'natural_gas', 'gasoline', 'diesel', 'jet_fuel', 'ethylene', 'polyethylene', 'ammonia', 'lng']) {
  const h = s.market.history[id];
  const pts = h.filter((_, i) => i % 30 === 0).map((v) => v.toFixed(v < 10 ? 2 : 0));
  const lo = Math.min(...h), hi = Math.max(...h);
  log(`  ${id.padEnd(13)} ${pts.join(' ')}  [min ${lo.toFixed(2)} max ${hi.toFixed(2)} n=${h.length}]`);
}
const ext = economyState(s);
log(`\nSales totals: ${Object.entries(ext.sales.totals).map(([k, v]) => `${k} ${Math.round(v).toLocaleString()}`).join(', ')}; revenue ${$(ext.sales.totalRevenue)}`);
log(`Terminal data: ${Object.entries(ids).filter(([k]) => ['truck', 'rail', 'meter', 'export'].includes(k)).map(([k, id]) => `${k}: ${JSON.stringify({ cap: Math.round(Number(s.buildings[id].data.salesCapacity)), util: Number(s.buildings[id].data.salesUtil).toFixed(2), today: Math.round(Number(s.buildings[id].data.salesToday)) })}`).join(' ')}`);
log(`\nContracts: completed ${ext.contracts.completed}, failed ${ext.contracts.failed}, active ${s.contracts.active.length}, offers ${s.contracts.offers.length}`);
for (const c of s.contracts.completed.slice(-12)) log(`  [${c.status}] ${c.client} — ${c.title}: ${c.delivered.toFixed(0)}/${c.quantity} ${c.commodity} @${c.pricePerUnit} bonus ${$(c.bonus)} penalty ${$(c.penalty)}`);
log(`history len ${s.company.history.length}, first day ${s.company.history[0]?.day}, revenue sum ${$(s.company.history.reduce((a, d) => a + d.revenue, 0))}, totalRevenue stat ${$(s.stats.totalRevenue)}`);
const byCat: Record<string, number> = {};
for (const d of [...s.company.history, s.company.today]) for (const [k, v] of Object.entries(d.byCategory)) byCat[k] = (byCat[k] ?? 0) + (v ?? 0);
log(`\nP&L by category (all days): ${Object.entries(byCat).sort((a, b) => a[1] - b[1]).map(([k, v]) => `${k} ${$(v)}`).join(', ')}`);
log(`Ledger entries kept: ${s.company.ledger.length}; last: ${s.company.ledger.slice(-4).map((l) => `${l.category} ${$(l.amount)} "${l.note}"`).join(' | ')}`);
log(`Loans: ${JSON.stringify(s.company.loans.map((l) => ({ bal: Math.round(l.balance), pay: Math.round(l.dailyPayment), rate: l.rate })))}`);
log(`Company value history: ${s.stats.companyValueHistory.filter((_, i) => i % 30 === 0).map((v) => $(v)).join(' ')}`);
log(`\nWorkforce: ${s.workforce.workers.length} workers, housing ${s.workforce.housing}, hires ${ext.workforce.hires}, quits ${ext.workforce.quits}, injuries ${ext.workforce.injuries}, autoAssign ${s.workforce.autoAssign}`);
for (const w of s.workforce.workers) log(`  ${w.name.padEnd(28)} ${w.role.padEnd(12)} s${w.skill} xp${w.xp.toFixed(0).padStart(3)} $${w.wage} mor ${w.morale.toFixed(0)} fat ${w.fatigue.toFixed(0)} @${w.assignedTo ? s.buildings[w.assignedTo]?.type : '-'}${w.injured && w.injured > s.time.day ? ' INJURED' : ''}`);
log(`Staffing: ${Object.values(s.buildings).filter((b) => Object.keys(BUILDINGS[b.type].crew).length).map((b) => `${b.type}[${b.workers.length}/${Object.values(BUILDINGS[b.type].crew).reduce((a, n) => a + (n ?? 0), 0)}]`).join(' ')}`);
log(`\nResearch: completed ${s.research.completed.filter((t) => TECHS[t].cost > 0).join(', ')}; current ${s.research.current}; total pts ${s.research.totalPoints.toFixed(0)}`);
log(`\nWeather changes (${weatherSeq.length}); first 40: ${weatherSeq.slice(0, 40).join(', ')}`);
const kinds: Record<string, number> = {};
for (const w of weatherSeq) kinds[w.split(' ')[2]] = (kinds[w.split(' ')[2]] ?? 0) + 1;
log(`Weather kind counts: ${JSON.stringify(kinds)}; lightning strikes ${strikes}; fires ${fires.length}: ${fires.join(', ')}`);
log(`Forecast (${s.weather.forecast.length}d): ${s.weather.forecast.map((f) => `${f.day}:${f.kind} ${f.tempLow}/${f.tempHigh}°C w${f.wind}`).join(', ')}`);
log(`\nEnvironment: score ${s.environment.score.toFixed(1)}, fines total ${$(s.environment.finesTotal)}, violations ${s.environment.violations}, suspendedUntil ${s.environment.suspendedUntilDay}, emissions total ${s.environment.emissionsTotal.toFixed(0)} t, carbon sold ${ext.environment.carbonSold.toFixed(0)} t`);
log(`Leases: ${Object.entries(s.leases).map(([k, l]) => `${k}(${(l.royalty * 100).toFixed(1)}%)`).join(' ')}`);
log(`\nObjectives: chapter ${s.objectives.chapter}, tutorialStep ${s.objectives.tutorialStep}, tutorialDone ${s.objectives.tutorialDone}`);
for (const o of s.objectives.list) log(`  ${o.done ? '✔' : ' '} ${o.claimed ? '$' : ' '} ${o.id.padEnd(18)} ${o.progress.toFixed(0)}/${o.target} ${o.title}`);
log(`Achievements: ${s.objectives.achievements.join(', ')}`);
log(`Chapters available: ${CHAPTERS.map((c) => c.title).join(' → ')}`);
log(`\nErrors (${errors.length}): ${errors.join(' | ')}`);
const levels: Record<string, number> = {};
for (const n of notes) levels[n.level] = (levels[n.level] ?? 0) + 1;
log(`Notifications: ${notes.length} ${JSON.stringify(levels)}`);
const titles: Record<string, number> = {};
for (const n of notes) {
  const t = n.title.replace(/:.*$/, '').replace(/\d+/g, '#');
  titles[t] = (titles[t] ?? 0) + 1;
}
log(`Notification titles: ${Object.entries(titles).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}×${n}`).join(', ')}`);
log(`Sample danger/warning notes: ${notes.filter((n) => n.level !== 'info' && n.level !== 'success').slice(0, 14).map((n) => `d${n.day} ${n.title}: ${n.text ?? ''}`).join('\n    ')}`);
log(`Inventory slot sample: ${JSON.stringify(s.players.p1.inventory.slice(0, 20))}`);
log(`State JSON size: ${(JSON.stringify(s).length / 1024).toFixed(0)} KB`);

// ---- Save/load round trip ---------------------------------------------------------------------------
const saved = JSON.parse(JSON.stringify(s));
const s2 = new GameSession(saved, world, geology, { ...DEFAULT_SETTINGS }, 'p1', [...createEconomySystems()]);
s2.init();
const before = { leases: Object.keys(saved.leases).length, workers: saved.workforce.workers.length, offers: saved.contracts.offers.length, money: saved.company.money };
for (let i = 0; i < 2400; i++) s2.step();
const st2 = s2.ctx.state;
log(`\nReload: leases ${before.leases}→${Object.keys(st2.leases).length}, workers ${before.workers}→${st2.workforce.workers.length}, offers ${before.offers}→${st2.contracts.offers.length}, money ${$(before.money)}→${$(st2.company.money)}, day ${st2.time.day}, netWorth svc ${$(s2.ctx.services.economy.netWorth())}`);
console.log(out.join('\n'));
