// Headless upstream simulation test (real core loop + upstream systems on a fake layered geology).
//   node --experimental-transform-types --no-warnings --import ./dev/upstream/register.mjs dev/upstream/sim.test.ts
import { B } from '../../src/core/blocks';
import type { WellPlan, WellState } from '../../src/core/types';
import { cmd, lease, newHarness, nowDays, place, runDays, runHours, wellOf, OIL_PRICE, type Harness } from './harness';
import { wellExt } from '../../src/sim/upstream';

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const f0 = (v: number) => Math.round(v).toLocaleString('en-US');
const money = (v: number) => `$${(v / 1e6).toFixed(2)}M`;
const section = (t: string) => console.log(`\n=== ${t} ===`);
const finite = (w: WellState) => [w.rates.oil, w.rates.gas, w.rates.water, w.bhp, w.measuredDepth, w.currentY].every(Number.isFinite);

/** Plan + spud a well on a new rig; returns the well. */
function drillWell(h: Harness, rigType: string, cx: number, cz: number, plan: WellPlan, purpose: 'exploration' | 'development' | 'appraisal' = 'exploration') {
  lease(h, cx, cz);
  const rig = place(h, rigType, cx, cz);
  const r = cmd(h, { type: 'well/plan', rigId: rig.id, plan, purpose });
  if (!r.ok) throw new Error(`plan failed: ${r.error}`);
  const id = (r.data as { wellId: string }).wellId;
  const s = cmd(h, { type: 'well/spud', wellId: id });
  if (!s.ok) throw new Error(`spud failed: ${s.error}`);
  return { rig, well: wellOf(h, id), quote: (r.data as { quote: { cost: number; days: number; warnings: string[] } }).quote };
}

// =================================================================================================
section('1. Init: reservoirs, services, commands');
{
  const h = newHarness();
  const rs = h.ctx.state.reservoirs;
  check('3 reservoir states created', Object.keys(rs).length === 3);
  check('initial pressure & undiscovered', rs.r_eagle.pressure === 2750 && !rs.r_eagle.discovered && rs.r_eagle.knowledge === 0);
  const q = h.ctx.services.seismic.quote('2d', 10, 64, 130, 64);
  check('seismic quote installed', q.cost > 0 && q.days > 0, `2D 120 blocks: ${money(q.cost)}, ${q.days} d`);
  const q3 = h.ctx.services.seismic.quote('3d', 40, 40, 100, 100);
  console.log(`    3D 60×60: ${money(q3.cost)}, ${q3.days} d`);
  const plan = h.ctx.services.wells.suggestPlan(62, 62, 42, 'vertical');
  check('suggestPlan: surface casing below fresh aquifer', plan.casingPoints[0] <= 68 && plan.casingPoints.includes(42), JSON.stringify(plan));
  const prof = h.ctx.services.wells.pressureProfile(62, 62);
  check('pressure profile covers surface→y2', prof.length > 70 && prof.every((p) => p.frac > p.pore), `${prof.length} pts`);
  const traj = h.ctx.services.wells.planTrajectory(62, 81, 62, { kind: 'horizontal', targetY: 22, lateralLength: 20, azimuth: 0, casingPoints: [], mudWeight: 10 });
  const end = traj[traj.length - 1];
  check('horizontal trajectory lands at targetY with lateral', Math.abs(end.y - 22) < 1e-6 && end.x - 62.5 > 26, `end ${end.x.toFixed(1)},${end.y.toFixed(1)} pts=${traj.length}`);
}

// =================================================================================================
section('2. Seismic: 2D line, 3D survey, synthetic sections');
{
  const h = newHarness({ techs: ['seismic_3d'] });
  const m0 = h.ctx.state.company.money;
  const r = cmd(h, { type: 'survey/start', kind: '2d', x0: 20, z0: 64, x1: 110, z1: 64 });
  check('2D survey starts & charges', r.ok && h.ctx.state.company.money < m0, `cost ${money(m0 - h.ctx.state.company.money)}`);
  const sid = (r.data as { surveyId: string }).surveyId;
  const s = h.ctx.state.surveys[sid];
  runHours(h, 12);
  const partial = h.ctx.services.seismic.getSection(s);
  const acq = partial.columns.findIndex((_, i) => { let a = 0; for (let row = 0; row < partial.height; row++) a += Math.abs(partial.data[row * partial.width + i]); return a === 0; });
  check('in-progress section shows only the acquired part', s.status === 'in_progress' && acq > 0 && acq < partial.width, `acquired cols ${acq}/${partial.width}, progress ${(s.progress * 100).toFixed(0)}%`);
  const days = runDays(h, 5, () => s.status === 'complete');
  check('2D survey completes', s.status === 'complete', `${days.toFixed(1)} d`);
  check('Eagle discovered by 2D (knowledge > 0.3)', h.ctx.state.reservoirs.r_eagle.discovered, `knowledge ${h.ctx.state.reservoirs.r_eagle.knowledge.toFixed(2)}`);
  check('Falcon not imaged by the Eagle line', !h.ctx.state.reservoirs.r_falcon.discovered);
  const t0 = performance.now();
  const img = h.ctx.services.seismic.getSection(s);
  const t1 = performance.now();
  h.ctx.services.seismic.getSection(s);
  const t2 = performance.now();
  let mn = 1, mx = -1, nz = 0;
  for (const v of img.data) { mn = Math.min(mn, v); mx = Math.max(mx, v); if (v !== 0) nz++; }
  check('section amplitude in [-1,1], dense', mn >= -1 && mx <= 1 && nz > img.data.length * 0.5, `${img.width}×${img.height}, range ${mn.toFixed(2)}..${mx.toFixed(2)}, top ${img.topY}`);
  check('section synthesis fast & cached', t1 - t0 < 120 && t2 - t1 < 2, `${(t1 - t0).toFixed(1)} ms, cached ${(t2 - t1).toFixed(2)} ms`);
  // Reservoir top should be a strong event: mean |amp| at the Eagle top vs shale band.
  const rowOf = (y: number) => Math.round((img.topY - y - 0.5) * (img.height / (img.topY - img.bottomY)));
  const colE = img.columns.findIndex((c) => c.x >= 64);
  let ampTop = 0, ampShale = 0;
  for (let dy = -1; dy <= 1; dy++) { ampTop += Math.abs(img.data[(rowOf(45.5) + dy) * img.width + colE]); ampShale += Math.abs(img.data[(rowOf(62) + dy) * img.width + colE]); }
  console.log(`    |amp| at Eagle top ${ampTop.toFixed(2)} vs mid-shale ${ampShale.toFixed(2)}`);
  // 3D over Falcon with AVO.
  h.ctx.state.research.completed.push('well_logging', 'avo_analysis');
  const r3 = cmd(h, { type: 'survey/start', kind: '3d', x0: 150, z0: 44, x1: 190, z1: 84 });
  check('3D survey starts', r3.ok, r3.error ?? '');
  const s3 = h.ctx.state.surveys[(r3.data as { surveyId: string }).surveyId];
  check('3D has fluid indicators with AVO', s3.fluidIndicators && s3.quality > 1.5, `quality ${s3.quality}`);
  runDays(h, 6, () => s3.status === 'complete');
  check('3D completes & discovers Falcon strongly', s3.status === 'complete' && h.ctx.state.reservoirs.r_falcon.knowledge > 0.6, `knowledge ${h.ctx.state.reservoirs.r_falcon.knowledge.toFixed(2)}`);
  const inl = h.ctx.services.seismic.getSection(s3, { inline: 20 });
  let gasCells = 0;
  for (const f of inl.fluid ?? []) if (f === 3) gasCells++;
  check('3D inline shows gas fluid indicator', gasCells > 20, `${gasCells} gas cells, ${inl.width}×${inl.height}`);
  const tS = performance.now();
  const slice = h.ctx.services.seismic.getDepthSlice(s3, 34);
  const tE = performance.now();
  check('depth slice dims & speed', slice.width === 40 && slice.height === 40 && tE - tS < 200, `${(tE - tS).toFixed(1)} ms`);
  check('survey events', h.events['survey:started'] === 2 && h.events['survey:completed'] === 2);
}

// =================================================================================================
section('3. Vertical oil well: drill, casing, logs, discovery, complete, 200 days + pumpjack');
let eagleRef: { h: Harness; well: WellState } | undefined;
{
  const h = newHarness({ techs: ['pumpjacks', 'well_logging'] });
  const m0 = h.ctx.state.company.money;
  const cx = 64, cz = 64;
  const plan = h.ctx.services.wells.suggestPlan(cx, cz, 42, 'vertical');
  const { rig, well: w, quote } = drillWell(h, 'drilling_rig_land', cx, cz, plan);
  console.log(`    plan ${JSON.stringify(plan)}\n    quote ${money(quote.cost)} / ${quote.days} d  warnings: ${quote.warnings.join(' | ') || 'none'}`);
  check('spud: drilling, conductor, mud program', w.status === 'drilling' && w.casing.length === 1 && wellExt(w).mud.length >= 2, `mud ${JSON.stringify(wellExt(w).mud)}`);
  const t0 = nowDays(h);
  const days = runDays(h, 5, () => w.status === 'drilled');
  const drillCost = w.cost + wellExt(w).bill.drilling + wellExt(w).bill.supplies;
  check('reached TD in 1–2 days', w.status === 'drilled' && days >= 0.8 && days <= 2.2, `${days.toFixed(2)} d, MD ${w.measuredDepth.toFixed(1)} blocks (${f0(w.measuredDepth * 40)} m)`);
  check('casing strings: conductor+surface+production', w.casing.map((c) => c.name).join(',') === 'conductor,surface,production', w.casing.map((c) => `${c.name}@${c.bottomY}`).join(' '));
  let casingBlocks = 0;
  for (let y = w.surfaceY - 2; y >= 42; y--) if (h.world.getBlock(cx, y, cz) === B.CASING) casingBlocks++;
  check('CASING blocks written below the pad', casingBlocks >= w.surfaceY - 2 - 42, `${casingBlocks} blocks; pad level block = ${h.world.getBlock(cx, w.surfaceY - 1, cz)}`);
  check('log sampled every block with full logs', w.log.length >= Math.floor(w.measuredDepth) && Number.isFinite(w.log[w.log.length - 1].resistivity), `${w.log.length} samples`);
  const pay = w.log.filter((l) => l.fluid === 'oil');
  check('oil pay logged & discovery', pay.length >= 3 && h.events['well:discovery'] === 1 && w.penetrated.includes('r_eagle'), `${pay.length} oil samples, gas show ${pay[0]?.gasShow}`);
  check('bit trips happened or bit healthy', w.bitCondition > 0);
  const r = cmd(h, { type: 'well/complete', wellId: w.id });
  check('completion starts', r.ok && w.status === 'completing', r.error ?? JSON.stringify(r.data));
  runHours(h, 24, () => w.status === 'producing');
  const total = w.cost;
  check('producing with wellhead building', w.status === 'producing' && !!w.wellheadId && h.ctx.state.buildings[w.wellheadId!]?.data.underRig === rig.id, `wellhead ${w.wellheadId}`);
  check('rig released', !rig.wellId && rig.status === 'idle', rig.status);
  check('all-in cost $0.8–2M', total >= 800_000 && total <= 2_000_000, `${money(total)} (drilling ${money(drillCost)}), elapsed ${(nowDays(h) - t0).toFixed(2)} d`);
  runHours(h, 3);
  const ip = w.rates.oil;
  check('initial rate 200–1,500 bbl/d', ip >= 200 && ip <= 1500, `oil ${f0(ip)} bbl/d, gas ${f0(w.rates.gas)} mcf/d, water ${f0(w.rates.water)}, bhp ${w.bhp} psi, limit '${wellExt(w).limit}'`);
  const rev0 = h.wellRevenue[w.id] ?? 0;
  let payback = -1;
  const rows: string[] = [];
  let liftDay = -1;
  const startDay = nowDays(h);
  for (let d = 1; d <= 200; d++) {
    runDays(h, 1);
    const rev = (h.wellRevenue[w.id] ?? 0) - rev0;
    if (payback < 0 && rev >= w.cost) payback = d;
    if (liftDay < 0 && w.rates.oil < 5 && w.status === 'producing' && !wellExt(w).op) {
      const lr = cmd(h, { type: 'well/setLift', wellId: w.id, lift: 'pumpjack' });
      liftDay = d;
      console.log(`    day ${d}: well died (${wellExt(w).limit}) → pumpjack: ${lr.ok ? 'ok' : lr.error}`);
    }
    if ([1, 3, 7, 14, 30, 60, 100, 150, 200].includes(d)) {
      const rs = h.ctx.state.reservoirs.r_eagle;
      rows.push(`    day ${String(d).padStart(3)}: oil ${f0(w.rates.oil).padStart(5)} bbl/d  gas ${f0(w.rates.gas).padStart(5)}  water ${f0(w.rates.water).padStart(5)}  wc ${(w.waterCut * 100).toFixed(0).padStart(2)}%  GOR ${f0(w.gor).padStart(5)}  P ${f0(rs.pressure)} psi  pL ${f0(wellExt(w).res.r_eagle?.pL ?? 0)}  lift ${w.lift}  cum ${f0(w.cumulative.oil)}`);
    }
    if (!finite(w)) break;
  }
  console.log(rows.join('\n'));
  check('rates finite all along', finite(w));
  check(`payback in ~10–25 days at $${OIL_PRICE}`, payback > 0 && payback <= 30, `payback day ${payback}`);
  const h7 = w.history.find((x) => x[0] >= startDay + 6)!;
  const h60 = w.history.find((x) => x[0] >= startDay + 59)!;
  check('visible decline over weeks/months', h60 && h7 && h60[1] < h7[1] * 0.95, `day7 ${f0(h7?.[1] ?? 0)} → day60 ${f0(h60?.[1] ?? 0)}`);
  check('history daily, capped', w.history.length >= 199 && w.history.length <= 720, `${w.history.length} entries`);
  check('reservoir cumulative & stats', h.ctx.state.reservoirs.r_eagle.cumulative.oil > 0 && Math.abs(h.ctx.state.stats.totalOil - w.cumulative.oil) < 1, `stats.totalOil ${f0(h.ctx.state.stats.totalOil)}, peak ${f0(h.ctx.state.stats.peakOilRate)}`);
  check('water breakthrough appears (water drive)', w.waterCut > 0.05, `wc ${(w.waterCut * 100).toFixed(0)}%`);
  console.log(`    money: start ${money(m0)} → ${money(h.ctx.state.company.money)} (+ sales ${money(h.sales.revenue)} off-ledger)`);
  eagleRef = { h, well: w };
}

// =================================================================================================
section('4. Water injector supports Eagle pressure');
{
  const run = (inject: boolean) => {
    const h = newHarness({ techs: ['pumpjacks', 'waterflood', 'directional_drilling'] , money: 50_000_000 });
    const prod = drillWell(h, 'drilling_rig_land', 64, 64, h.ctx.services.wells.suggestPlan(64, 64, 42, 'vertical')).well;
    runDays(h, 3, () => prod.status === 'drilled');
    cmd(h, { type: 'well/complete', wellId: prod.id });
    runHours(h, 24, () => prod.status === 'producing');
    const inj = drillWell(h, 'drilling_rig_land', 80, 72, h.ctx.services.wells.suggestPlan(80, 72, 40, 'vertical'), 'appraisal').well;
    runDays(h, 3, () => inj.status === 'drilled');
    const cv = cmd(h, { type: 'well/convert', wellId: inj.id, purpose: 'injector_water' });
    const cp = cmd(h, { type: 'well/complete', wellId: inj.id });
    runHours(h, 24, () => inj.status === 'injecting' || inj.status === 'producing');
    if (!inject) { cmd(h, { type: 'well/shutIn', wellId: inj.id, shutIn: true }); }
    h.waterSupply = 3000;
    runDays(h, 60);
    return { h, prod, inj, cv, cp };
  };
  const a = run(true);
  const b = run(false);
  const pa = a.h.ctx.state.reservoirs.r_eagle.pressure, pb = b.h.ctx.state.reservoirs.r_eagle.pressure;
  check('conversion & completion as injector', a.cv.ok && a.cp.ok && a.inj.status === 'injecting', `${a.cv.error ?? ''} ${a.cp.error ?? ''} status ${a.inj.status}`);
  check('injecting water', a.h.ctx.state.reservoirs.r_eagle.injected.water > 10_000 && a.inj.rates.water < 0, `inj ${f0(-a.inj.rates.water)} bbl/d, cum ${f0(a.h.ctx.state.reservoirs.r_eagle.injected.water)}`);
  check('pressure higher with injection', pa > pb + 5, `P with ${f0(pa)} vs without ${f0(pb)} psi; oil ${f0(a.prod.rates.oil)} vs ${f0(b.prod.rates.oil)} bbl/d`);
}

// =================================================================================================
section('5. Gas well (Falcon, overpressured, sour) with 3D-informed plan');
{
  const h = newHarness({ techs: ['seismic_3d', 'well_logging'], money: 30_000_000 });
  cmd(h, { type: 'survey/start', kind: '3d', x0: 150, z0: 44, x1: 190, z1: 84 });
  runDays(h, 6, () => Object.values(h.ctx.state.surveys)[0].status === 'complete');
  const plan = h.ctx.services.wells.suggestPlan(170, 64, 33, 'vertical');
  const q = h.ctx.services.wells.quote(170, 64, plan, 'drilling_rig_land');
  console.log(`    plan ${JSON.stringify(plan)}\n    quote ${money(q.cost)} ${q.days} d, warnings: ${q.warnings.join(' | ') || 'none'}`);
  check('plan uses heavy mud for overpressure + intermediate casing', plan.mudWeight > 12 && plan.casingPoints.length >= 3, `mw ${plan.mudWeight}`);
  const { well: w } = drillWell(h, 'drilling_rig_land', 170, 64, plan);
  runDays(h, 4, () => w.status === 'drilled' || w.status === 'kick' || w.status === 'blowout');
  check('drilled without kick', w.status === 'drilled', `${w.status}, casing ${w.casing.map((c) => `${c.name}@${c.bottomY}`).join(' ')}, lost circ ${wellExt(w).lostCirc}`);
  cmd(h, { type: 'well/complete', wellId: w.id });
  runHours(h, 24, () => w.status === 'producing');
  runHours(h, 6);
  check('gas rate 2,000–20,000 mcf/d', w.rates.gas >= 2000 && w.rates.gas <= 20000, `gas ${f0(w.rates.gas)} mcf/d, condensate ${f0(w.rates.oil)} bbl/d, water ${f0(w.rates.water)}, bhp ${w.bhp}`);
  const chem0 = w.cost;
  runDays(h, 30);
  const rs = h.ctx.state.reservoirs.r_falcon;
  check('p/z depletion & H2S chemicals cost', rs.pressure < 4300 && w.cost > chem0, `P ${f0(rs.pressure)} psi, gas ${f0(w.rates.gas)} mcf/d, cum ${f0(w.cumulative.gas)} mcf`);
  cmd(h, { type: 'well/setChoke', wellId: w.id, choke: 0.5 });
  const before = w.rates.gas;
  runHours(h, 2);
  check('choke halves the rate', w.rates.gas < before * 0.6 && w.rates.gas > before * 0.35, `${f0(before)} → ${f0(w.rates.gas)}`);
  cmd(h, { type: 'well/shutIn', wellId: w.id, shutIn: true });
  runHours(h, 2);
  check('shut in → zero rate', w.status === 'shut_in' && w.rates.gas === 0);
  cmd(h, { type: 'well/shutIn', wellId: w.id, shutIn: false });
  runHours(h, 1);
  check('reopened', w.status === 'producing' && w.rates.gas > 0);
}

// =================================================================================================
section('6. Kick → wait & weight; then gas kick ignored → blowout → cap');
{
  const h = newHarness({ techs: ['well_logging'], money: 40_000_000 });
  // Overpressured water sand at (170, 88): not surveyed → plan predicts normal pressure.
  const plan = h.ctx.services.wells.suggestPlan(170, 88, 31, 'vertical');
  const { well: w, rig } = drillWell(h, 'drilling_rig_land', 170, 88, plan);
  console.log(`    unsurveyed plan mw ${plan.mudWeight} ppg, casing ${plan.casingPoints.join(',')}`);
  runDays(h, 4, () => w.status === 'kick' || w.status === 'drilled');
  check('kick in overpressured sand', w.status === 'kick' && h.events['well:kick'] === 1, `${w.status} at y ${w.currentY.toFixed(1)}, influx ${w.kickVolume} bbl`);
  const kr = cmd(h, { type: 'well/controlKick', wellId: w.id, method: 'wait_weight' });
  check('wait & weight ordered', kr.ok, kr.error ?? JSON.stringify(kr.data));
  runHours(h, 30, () => w.status !== 'kick');
  check('well killed, mud raised', w.status === 'drilling' && w.mudWeight > 12, `status ${w.status}, mw ${w.mudWeight}`);
  runDays(h, 3, () => w.status === 'drilled' || w.status === 'kick');
  check('drilled to TD after kill', w.status === 'drilled', `${w.status}, lost circ ${wellExt(w).lostCirc}`);
  check('dry hole (brine) detected', h.events['well:dryHole'] === 1 && h.ctx.state.stats.dryHoles === 1);
  const pr = cmd(h, { type: 'well/plugAbandon', wellId: w.id });
  check('plug & abandon dry hole → rig free', pr.ok && w.status === 'dry_hole' && !rig.wellId, w.status);
  const sk = cmd(h, { type: 'rig/skid', rigId: rig.id, x: rig.x + 6, z: rig.z });
  const nr = sk.ok ? h.ctx.state.buildings[(sk.data as { newRigId: string }).newRigId] : undefined;
  check('rig/skid moves the rig (rig-up 0.7, crew kept)', !!nr && nr.constructionProgress === 0.7 && nr.workers.length === 5 && !h.ctx.state.buildings[rig.id], sk.error ?? `new ${nr?.id} at ${nr?.x},${nr?.z}`);

  // Gas kick left alone → blowout.
  const g = newHarness({ techs: ['well_logging'], money: 40_000_000 });
  const gp = g.ctx.services.wells.suggestPlan(170, 64, 33, 'vertical');
  const gw = drillWell(g, 'drilling_rig_land', 170, 64, gp).well;
  runDays(g, 4, () => gw.status === 'kick' || gw.status === 'drilled' || gw.status === 'blowout');
  check('gas kick on unexpected overpressure', gw.status === 'kick', `${gw.status} y ${gw.currentY.toFixed(1)} mw ${gw.mudWeight}`);
  const tk = nowDays(g);
  runDays(g, 3, () => gw.status === 'blowout');
  check('unattended kick → blowout', gw.status === 'blowout' && g.ctx.state.stats.blowouts === 1, `after ${((nowDays(g) - tk) * 24).toFixed(1)} h, flow ${f0(gw.blowout?.flowRate ?? 0)} mcf/d, fire ${gw.blowout?.onFire}`);
  runHours(g, 12);
  const fire = g.ctx.state.hazards.fires.find((f) => f.wellId === gw.id);
  console.log(`    after 12 h: onFire ${gw.blowout?.onFire}, fire ${fire ? fire.intensity.toFixed(2) : 'none'}, vented ${f0(g.ctx.state.environment.ventedToday)} mcf, emissions ${f0(g.ctx.state.environment.emissionsToday)} t, rig condition ${f0(g.ctx.state.buildings[gw.rigId!]?.condition ?? 0)}`);
  const cr = cmd(g, { type: 'well/capBlowout', wellId: gw.id, method: 'cap' });
  check('capping ordered', cr.ok, cr.error ?? JSON.stringify(cr.data));
  runDays(g, 10, () => gw.status !== 'blowout');
  check('blowout controlled by capping', (gw.status === 'drilled' || gw.status === 'plugged') && g.events['well:blowoutControlled'] === 1, `${gw.status}, fires left ${g.ctx.state.hazards.fires.length}`);
  check('incident logged', g.ctx.state.hazards.incidents.some((i) => i.kind === 'blowout'));
  check('reservoir lost gas to blowout', g.ctx.state.reservoirs.r_falcon.cumulative.gas > 0, `${f0(g.ctx.state.reservoirs.r_falcon.cumulative.gas)} mcf`);

  // Oil blowout → spills
  const o = newHarness({ techs: ['well_logging'], money: 40_000_000 });
  const op = o.ctx.services.wells.suggestPlan(60, 60, 42, 'vertical');
  const ow = drillWell(o, 'drilling_rig_land', 60, 60, op).well;
  runDays(o, 3, () => ow.currentY < 47);
  cmd(o, { type: 'well/setMudWeight', wellId: ow.id, mudWeight: 8.4 });
  const ex = wellExt(ow);
  // Force a strongly underbalanced oil sand by simulating a big over-estimate: raise reservoir pressure (e.g. injection).
  o.ctx.state.reservoirs.r_eagle.pressure = 3400;
  runDays(o, 2, () => ow.status === 'kick' || ow.status === 'drilled');
  check('oil kick (underbalanced)', ow.status === 'kick', `${ow.status} influx ${ow.kickVolume}`);
  runDays(o, 2, () => ow.status === 'blowout');
  runHours(o, 24);
  const oilPools = (() => { let n = 0; for (let x = 40; x < 80; x++) for (let z = 40; z < 80; z++) { const y = o.world.getSurfaceY(x, z); if (o.world.getBlock(x, y, z) === B.OIL_POOL) n++; } return n; })();
  const spill = o.ctx.state.environment.spills[0];
  check('oil blowout spills (OIL_POOL + spill record)', ow.status === 'blowout' && (oilPools > 0 || (ow.blowout?.onFire ?? false)) && !!spill, `pools ${oilPools}, spill ${f0(spill?.volume ?? 0)} bbl, fire ${ow.blowout?.onFire}, kickFluid ${ex.kickFluid}`);
  const rr = cmd(o, { type: 'well/capBlowout', wellId: ow.id, method: 'relief_well' });
  runDays(o, 12, () => ow.status !== 'blowout');
  check('relief well kills & plugs', rr.ok && ow.status === 'plugged', ow.status);
}

// =================================================================================================
section('7. Shale: horizontal well + 30-stage frac, 200 days');
{
  const h = newHarness({ techs: ['directional_drilling', 'pdc_bits', 'horizontal_drilling', 'hydraulic_fracturing', 'pumpjacks', 'well_logging'], money: 20_000_000 });
  const cx = 100, cz = 150;
  const plan = h.ctx.services.wells.suggestPlan(cx, cz, 22, 'horizontal');
  plan.lateralLength = 24;
  plan.azimuth = 0;
  const { well: w, quote } = drillWell(h, 'drilling_rig_land', cx, cz, plan, 'development');
  console.log(`    plan ${JSON.stringify(plan)}\n    quote ${money(quote.cost)} ${quote.days} d, warnings: ${quote.warnings.join(' | ') || 'none'}`);
  check('name has -H suffix', / \d+-H$/.test(w.name), w.name);
  const days = runDays(h, 6, () => w.status === 'drilled' || w.status === 'kick');
  check('horizontal drilled', w.status === 'drilled', `${w.status} in ${days.toFixed(2)} d, MD ${f0(w.measuredDepth * 40)} m, contact ${w.reservoirContact} blocks, mw ${w.mudWeight}`);
  const vcontact = 5;
  check('horizontal contact ≫ vertical', w.reservoirContact > vcontact * 3, `${w.reservoirContact} blocks`);
  cmd(h, { type: 'well/complete', wellId: w.id });
  runHours(h, 30, () => w.status === 'producing');
  runHours(h, 3);
  const unfracked = w.rates.oil;
  const drillCost = w.cost;
  const spread = place(h, 'frac_spread', cx, cz + 5);
  spread.storage.fresh_water = 20_000;
  const fr = cmd(h, { type: 'well/frac', wellId: w.id, stages: 30 });
  check('frac job starts', fr.ok && w.status === 'fracking', fr.error ?? JSON.stringify(fr.data));
  runDays(h, 3, () => w.status !== 'fracking');
  runHours(h, 2);
  const ip = w.rates.oil;
  check('frac multiplies productivity ×5–15', w.productivity / wellExt(w).baseProductivity >= 5 && w.productivity / wellExt(w).baseProductivity <= 15, `unfracked ${f0(unfracked)} → ${f0(ip)} bbl/d, index ${w.productivity}`);
  check('shale IP high', ip > 600, `${f0(ip)} bbl/d, gas ${f0(w.rates.gas)} mcf/d, limit '${wellExt(w).limit}', lift ${w.lift}`);
  const rev0 = h.wellRevenue[w.id] ?? 0;
  const rows: string[] = [];
  let payback = -1;
  let liftSet = false;
  const q: number[] = [];
  for (let d = 1; d <= 200; d++) {
    runDays(h, 1);
    q[d] = w.history[w.history.length - 1]?.[1] ?? 0;
    if (!liftSet && w.rates.oil < 5 && !wellExt(w).op) { liftSet = cmd(h, { type: 'well/setLift', wellId: w.id, lift: 'pumpjack' }).ok; console.log(`    day ${d}: loaded up → pumpjack ${liftSet}`); }
    if (payback < 0 && (h.wellRevenue[w.id] ?? 0) - rev0 >= w.cost) payback = d;
    if ([1, 7, 14, 30, 60, 100, 200].includes(d)) rows.push(`    day ${String(d).padStart(3)}: oil ${f0(w.rates.oil).padStart(5)} bbl/d  gas ${f0(w.rates.gas).padStart(5)} mcf/d  wc ${(w.waterCut * 100).toFixed(0)}%  pL ${f0(wellExt(w).res.r_osage?.pL ?? 0)}  P ${f0(h.ctx.state.reservoirs.r_osage.pressure)}  cum ${f0(w.cumulative.oil)}`);
  }
  console.log(rows.join('\n'));
  check('steep hyperbolic-like decline', q[30] < q[1] * 0.6 && q[200] > 0 && q[200] < q[30], `d1 ${f0(q[1])} d30 ${f0(q[30])} d200 ${f0(q[200])}`);
  console.log(`    well cost ${money(w.cost)} (drill+complete ${money(drillCost)}), 200-day revenue ${money((h.wellRevenue[w.id] ?? 0) - rev0)}, payback day ${payback}`);
  check('shale well pays back within 200 days', payback > 0, `payback ${payback}`);
}

// =================================================================================================
section('8. Validation errors');
{
  const h = newHarness();
  const rig = place(h, 'drilling_rig_land', 30, 30);
  const plan = h.ctx.services.wells.suggestPlan(30, 30, 42, 'vertical');
  const r1 = cmd(h, { type: 'well/plan', rigId: rig.id, plan, purpose: 'exploration' });
  check('no lease → helpful error', !r1.ok && /Acquire the mineral lease/.test(r1.error ?? ''), r1.error);
  lease(h, 30, 30);
  const r2 = cmd(h, { type: 'well/plan', rigId: rig.id, plan: { ...plan, kind: 'horizontal', lateralLength: 10 }, purpose: 'exploration' });
  check('horizontal needs tech', !r2.ok && /Horizontal Drilling/.test(r2.error ?? ''), r2.error);
  const r3 = cmd(h, { type: 'well/plan', rigId: rig.id, plan: { ...plan, targetY: 3 }, purpose: 'exploration' });
  check('too deep for land rig', !r3.ok && /Too deep/.test(r3.error ?? ''), r3.error);
  h.ctx.state.environment.suspendedUntilDay = 10;
  const r4 = cmd(h, { type: 'well/plan', rigId: rig.id, plan, purpose: 'exploration' });
  check('regulatory suspension blocks wells', !r4.ok && /suspended/.test(r4.error ?? ''), r4.error);
  h.ctx.state.environment.suspendedUntilDay = undefined;
  const r5 = cmd(h, { type: 'survey/start', kind: '3d', x0: 0, z0: 0, x1: 50, z1: 50 });
  check('3D survey needs tech', !r5.ok, r5.error);
  // Aquifer contamination: plan with no surface casing.
  const ok = cmd(h, { type: 'well/plan', rigId: rig.id, plan: { ...plan, casingPoints: [42] }, purpose: 'exploration' });
  cmd(h, { type: 'well/spud', wellId: (ok.data as { wellId: string }).wellId });
  const cw = wellOf(h, (ok.data as { wellId: string }).wellId);
  const s0 = h.ctx.state.environment.score;
  runDays(h, 1, () => wellExt(cw).contaminated);
  check('no surface casing → aquifer contamination', wellExt(cw).contaminated && h.ctx.state.environment.score < s0, `score ${s0} → ${h.ctx.state.environment.score}`);
  // Crew removal stops drilling.
  const md0 = cw.measuredDepth;
  rig.workers = [];
  runHours(h, 3);
  check('no crew → no progress, rig idle', Math.abs(cw.measuredDepth - md0) < 1e-9 && rig.status === 'idle', `status ${rig.status}`);
}

// =================================================================================================
section('9. Performance & large-step stability');
{
  const ref = eagleRef!;
  const h = ref.h;
  const base = ref.well;
  // Clone the producing well 40× on synthetic wellheads (performance of the production system).
  for (let i = 0; i < 40; i++) {
    const x = 40 + (i % 8) * 6, z = 44 + Math.floor(i / 8) * 6;
    const clone = structuredClone(base);
    clone.id = `wclone${i}`;
    clone.x = x; clone.z = z;
    clone.name = `Clone ${i}`;
    const wh = place(h, 'wellhead', x, z);
    wh.wellId = clone.id;
    clone.wellheadId = wh.id;
    clone.status = 'producing';
    h.ctx.state.wells[clone.id] = clone;
  }
  const n = 200;
  const t0 = performance.now();
  for (let i = 0; i < n; i++) h.session.step();
  const per = (performance.now() - t0) / n;
  check('41 producing wells: step cost < 2 ms', per < 2, `${per.toFixed(3)} ms/step`);
  // Catch-up: one 12-hour step vs 120 six-minute steps.
  const mk = () => {
    const hh = newHarness({ techs: ['pumpjacks'] });
    const w = drillWell(hh, 'drilling_rig_land', 64, 64, hh.ctx.services.wells.suggestPlan(64, 64, 42, 'vertical')).well;
    runDays(hh, 3, () => w.status === 'drilled');
    cmd(hh, { type: 'well/complete', wellId: w.id });
    runHours(hh, 24, () => w.status === 'producing');
    hh.drain = true;
    return { hh, w };
  };
  const A = mk(), Bq = mk();
  const cumA0 = A.w.cumulative.oil, cumB0 = Bq.w.cumulative.oil;
  runHours(A.hh, 12);
  const prodSys = Bq.hh.session.systems.find((s) => s.id === 'upstream.production')!;
  // Big step: drain between halves to avoid storage limits dominating.
  for (let k = 0; k < 24; k++) {
    prodSys.tick(Bq.hh.ctx, { minutes: 30, days: 30 / 1440 });
    for (const b of Object.values(Bq.hh.ctx.state.buildings)) if (b.type === 'wellhead') { b.storage.crude_oil = 0; b.storage.natural_gas = 0; b.storage.produced_water = 0; }
  }
  const dA = A.w.cumulative.oil - cumA0, dB = Bq.w.cumulative.oil - cumB0;
  check('30-min substeps ≈ 6-min steps (±15%)', Math.abs(dA - dB) / Math.max(1, dA) < 0.15, `${f0(dA)} vs ${f0(dB)} bbl`);
  prodSys.tick(Bq.hh.ctx, { minutes: 1440 * 3, days: 3 });
  check('3-day catch-up step stays finite & positive', finite(Bq.w) && Bq.hh.ctx.state.reservoirs.r_eagle.pressure > 0, `P ${f0(Bq.hh.ctx.state.reservoirs.r_eagle.pressure)}`);
  const drillSys = Bq.hh.session.systems.find((s) => s.id === 'upstream.drilling')!;
  const dw = drillWell(Bq.hh, 'drilling_rig_land', 100, 20, Bq.hh.ctx.services.wells.suggestPlan(100, 20, 42, 'vertical')).well;
  drillSys.tick(Bq.hh.ctx, { minutes: 1440 * 2, days: 2 });
  check('2-day catch-up drilling step reaches TD', dw.status === 'drilled', `${dw.status} md ${dw.measuredDepth.toFixed(1)}/${dw.plannedDepth.toFixed(1)}`);
}

// =================================================================================================
section('Notifications sample');
{
  const h = eagleRef!.h;
  for (const n of h.notes.slice(0, 14)) console.log(`    [${n.level}] d${n.day} ${n.title}${n.text ? ` — ${n.text.slice(0, 150)}` : ''}`);
  const errs = h.events['ui:error'] ?? 0;
  console.log(`    ui:error events: ${errs}, total notes ${h.notes.length}`);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
