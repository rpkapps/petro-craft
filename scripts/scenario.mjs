// Scripted end-to-end gameplay scenario against the real game (all modules), fast-forwarding the sim.
// Usage: node scripts/scenario.mjs [baseUrl=http://localhost:5190/] [seed=12345]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const [base = 'http://localhost:5190/', seed = '12345'] = process.argv.slice(2);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const seen = new Map();
page.on('console', (m) => {
  const t = m.text();
  if (t.startsWith('[sc]')) return console.log(t);
  if (!['error', 'warning'].includes(m.type()) || t.includes('ERR_CERT')) return;
  const k = t.slice(0, 120); const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); if (n <= 2) console.log(`[${m.type()}]`, t.slice(0, 600));
});
page.on('pageerror', (e) => console.log('[pageerror]', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
await page.goto(base + (process.env.SOAK ? '?soak=' + process.env.SOAK : ''));
await page.waitForTimeout(1500);
await page.evaluate((seed) => window.petrocraft.newGame({ saveName: 'Scenario', companyName: 'Scenario Oil', seed: Number(seed), worldSize: 'small', difficulty: 'normal', tutorial: true, hazards: true, creative: false }), seed);
await page.waitForTimeout(500);

const result = await page.evaluate(async () => {
  const app = window.petrocraft;
  const session = app.session;
  const ctx = app.ctx;
  const s = ctx.state;
  const L = (...a) => console.log('[sc]', ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
  const d = (cmd) => { const r = ctx.commands.dispatch(cmd); if (!r.ok) L('CMD FAIL', cmd.type, r.error); return r; };
  const run = (hours) => { const steps = Math.ceil((hours * 60) / (0.24 * s.time.speed)); for (let i = 0; i < steps; i++) session.step(); };
  const runUntil = (pred, maxHours, chunkH = 1) => { let h = 0; while (!pred() && h < maxHours) { run(chunkH); h += chunkH; } return h; };
  const money = () => Math.round(s.company.money);
  const P = 32;
  const key = (x, z) => `${Math.floor(x / P)},${Math.floor(z / P)}`;
  L('start money', money(), 'leases', Object.keys(s.leases).length, 'workers', s.workforce.workers.length, 'buildings', Object.values(s.buildings).map((b) => b.type));
  const spawn = s.players[ctx.localPlayerId].position;
  // pick the nearest onshore oil reservoir
  const res = ctx.geology.reservoirs.filter((r) => !r.offshore && r.fluid === 'oil' && r.trap !== 'shale_play')
    .sort((a, b) => Math.hypot(a.center.x - spawn.x, a.center.z - spawn.z) - Math.hypot(b.center.x - spawn.x, b.center.z - spawn.z))[0];
  L('target reservoir', res.name, res.center, 'top', res.topY, 'owc', res.owcY, 'OOIP', Math.round(res.oilInPlace));
  // find a rig site near the reservoir centre
  let site = null;
  for (let r = 0; r < 20 && !site; r++) for (let dx = -r; dx <= r && !site; dx++) for (let dz = -r; dz <= r && !site; dz++) {
    const x = Math.round(res.center.x) - 2 + dx, z = Math.round(res.center.z) - 2 + dz;
    const wx = x + 2, wz = z + 2;
    if (!ctx.geology.reservoirAt(wx, res.topY - 1, wz) && !ctx.geology.reservoirAt(wx, Math.floor((res.topY + res.bottomY) / 2), wz)) continue;
    const v = ctx.services.construction.validate('drilling_rig_land', x, z, 0);
    if (v.ok) site = { x, z, y: v.y };
  }
  if (!site) return 'no rig site';
  L('rig site', site);
  const k = key(site.x + 2, site.z + 2);
  if (!s.leases[k]) { const q = ctx.services.economy.leaseQuote(...k.split(',').map(Number)); L('lease quote', q); d({ type: 'lease/buy', px: +k.split(',')[0], pz: +k.split(',')[1] }); }
  d({ type: 'survey/start', kind: '2d', x0: site.x - 40, z0: site.z + 2, x1: site.x + 40, z1: site.z + 2 });
  const rb = d({ type: 'build/place', buildingType: 'drilling_rig_land', x: site.x, z: site.z, rotation: 0 });
  const rigId = rb.data?.buildingId;
  L('rig placed', rb.ok, rigId, 'money', money());
  const hb = runUntil(() => s.buildings[rigId]?.constructionProgress >= 1, 72);
  L('rig built after h', hb, 'status', s.buildings[rigId].status, 'crew', s.buildings[rigId].workers.length);
  const wx = site.x + 2, wz = site.z + 2;
  const targetY = Math.max(res.bottomY + 1, Math.min(res.owcY + 1, res.topY - 1));
  const plan = ctx.services.wells.suggestPlan(wx, wz, targetY, 'vertical');
  L('plan', plan, 'quote', ctx.services.wells.quote(wx, wz, plan, 'drilling_rig_land'));
  const pr = d({ type: 'well/plan', rigId, plan, purpose: 'exploration' });
  const wellId = pr.data?.wellId;
  d({ type: 'well/spud', wellId });
  const w = () => s.wells[wellId];
  let h = 0; let lastStatus = '';
  while (h < 24 * 8) {
    run(1); h++;
    if (w().status !== lastStatus) { L(`h${h} well`, w().status, 'md', w().measuredDepth.toFixed(1), 'y', w().currentY?.toFixed?.(1), 'mw', w().mudWeight?.toFixed?.(2)); lastStatus = w().status; }
    if (w().status === 'kick') d({ type: 'well/controlKick', wellId, method: 'wait_weight' });
    if (['drilled', 'dry_hole', 'blowout', 'plugged'].includes(w().status)) break;
  }
  L('drilled after h', h, 'penetrated', w().penetrated, 'money', money(), 'cost', Math.round(w().cost));
  if (w().status !== 'drilled') return { status: w().status };
  d({ type: 'well/complete', wellId });
  runUntil(() => w().status === 'producing', 48);
  L('well status', w().status, 'rates', w().rates, 'wellhead', w().wellheadId, 'limit', w().up?.limit);
  L('set lift', d({ type: 'well/setLift', wellId, lift: 'pumpjack' }).ok);
  const wh = s.buildings[w().wellheadId];
  L('demolish rig', d({ type: 'build/demolish', buildingId: rigId }).ok);
  // pipe from wellhead to a tank + truck terminal 12 blocks east
  const tx = wh.x + 14, tz = wh.z - 1;
  let tank = null, term = null;
  for (let off = 0; off < 30 && !(tank && term); off++) {
    if (!tank) { const v = ctx.services.construction.validate('oil_tank_small', tx + off, tz, 0); if (v.ok) { const r = d({ type: 'build/place', buildingType: 'oil_tank_small', x: tx + off, z: tz, rotation: 0 }); tank = s.buildings[r.data.buildingId]; } }
    if (tank && !term) { const v = ctx.services.construction.validate('truck_terminal', tank.x + 5, tank.z, 0); if (v.ok) { const r = d({ type: 'build/place', buildingType: 'truck_terminal', x: tank.x + 5, z: tank.z, rotation: 0 }); term = s.buildings[r.data.buildingId]; } }
  }
  L('tank', tank?.id, tank && [tank.x, tank.y, tank.z], 'terminal', term?.id);
  runUntil(() => tank.constructionProgress >= 1 && term.constructionProgress >= 1, 48);
  // pipe: from east face of wellhead to west face of tank at ground level along z = wh.z+1
  const pts = [];
  const pz = wh.z + 1;
  for (let x = wh.x + 3; x < tank.x; x++) pts.push({ x, y: wh.y, z: pz });
  for (let x = tank.x + 4; x < term.x; x++) pts.push({ x, y: tank.y, z: tank.z + 1 });
  const lr = d({ type: 'world/placeLine', block: 58 /* PIPE_OIL */, points: pts });
  L('pipe placed', lr.ok, pts.length, 'networks', Object.values(s.networks).map((n) => ({ c: n.category, pipes: n.pipeCount, b: n.buildings.length })));
  const m0 = money();
  run(24 * 5);
  const day = s.time.day;
  L('after 5 days: day', day, 'money', money(), 'delta', money() - m0, 'well rates', w().rates, 'wh storage', wh.storage, 'tank', tank.storage, 'term', term.storage, 'term data', term.data);
  L('ledger last', s.company.ledger.slice(-8).map((e) => `${e.category}:${Math.round(e.amount)} ${e.note}`));
  L('objectives', s.objectives.list.map((o) => `${o.title} ${o.progress}/${o.target}${o.done ? ' ✓' : ''}`));
  L('notifications', s.notifications.slice(-12).map((n) => n.title));
  L('power', s.power, 'env', { score: s.environment.score, flared: s.environment.flaredToday });
  // drop & pickup round trip
  const inv0 = JSON.stringify(s.players[ctx.localPlayerId].inventory[8]);
  const dr = d({ type: 'player/dropItem', slot: 8, count: 5 });
  for (let i = 0; i < 30; i++) session.step();
  const drop = (s.drops ?? []).find((x) => x.id === dr.data?.dropId);
  const pk = drop ? d({ type: 'player/pickup', dropId: drop.id }) : { ok: false };
  L('drop/pickup', dr.ok, drop && { item: drop.item, count: drop.count, y: +drop.y.toFixed(2) }, 'pickup', pk.ok, 'slot before', inv0, 'after', JSON.stringify(s.players[ctx.localPlayerId].inventory[8]));
  const soak = Number(new URLSearchParams(location.search).get('soak') ?? 0);
  if (soak > 0) {
    const t0 = performance.now();
    d({ type: 'time/setSpeed', speed: 25 });
    for (let day = 0; day < soak; day++) {
      run(24);
      if (day % 10 === 9) L(`soak day ${s.time.day}`, 'money', money(), 'oil', Math.round(w().rates.oil), 'res', ctx.state.research.current, 'fires', s.hazards.fires.length, 'incidents', s.hazards.incidents.length, 'env', Math.round(s.environment.score), 'weather', s.weather.current, 'contracts', s.contracts.active.length);
    }
    L('soak ms/day', ((performance.now() - t0) / soak).toFixed(1), 'incidents', s.hazards.incidents.slice(-5).map((i) => i.text), 'market events', s.market.events.map((e) => e.title));
  }
  const before = { day: s.time.day, money: Math.round(s.company.money), b: Object.keys(s.buildings).length, w: Object.keys(s.wells).length, nets: Object.keys(s.networks).length, pipe: ctx.world.getBlock(pts[0].x, pts[0].y, pts[0].z) };
  await app.saveGame('scenario-test');
  await app.loadGame('scenario-test');
  const c2 = app.ctx, s2 = c2.state;
  for (let i = 0; i < 50; i++) app.session.step();
  const after = { day: s2.time.day, money: Math.round(s2.company.money), b: Object.keys(s2.buildings).length, w: Object.keys(s2.wells).length, nets: Object.keys(s2.networks).length, pipe: c2.world.getBlock(pts[0].x, pts[0].y, pts[0].z) };
  L('save/load before', before, 'after', after, 'well after', s2.wells[wellId].status, s2.wells[wellId].rates);
  const saves = await app.listSaves();
  L('saves', saves.map((x) => x.slot + ':' + (x.thumbnail ? 'thumb' : 'nothumb')));
  return 'ok';
});
console.log('[sc] result', JSON.stringify(result));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'dev-screens/scenario.png' });
await browser.close();
