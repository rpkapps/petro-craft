// Headless facilities simulation test.
//   node --experimental-transform-types --no-warnings --import ./dev/facilities/register.mjs dev/facilities/sim.test.ts
import { B } from '../../src/core/blocks';
import { BUILDINGS } from '../../src/content/buildings';
import type { BuildingState } from '../../src/core/types';
import { addWellhead, completeAll, grantTech, newHarness, pipe, placeCmd, produce, run, staff, stepsPerHour, type Harness } from './harness';

let failures = 0;
let passes = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) passes++;
  else failures++;
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}
const f0 = (v: number | undefined) => Math.round(v ?? 0).toLocaleString('en-US');
const section = (t: string) => console.log(`\n=== ${t} ===`);
const netOf = (h: Harness, b: BuildingState, cat: string) => Object.values(h.ctx.state.networks).find((n) => n.category === cat && n.buildings.includes(b.id));

// -------------------------------------------------------------------------------------------------
section('1. New game: starting Field Office');
{
  const h = newHarness();
  const offices = Object.values(h.ctx.state.buildings).filter((b) => b.type === 'field_office');
  check('exactly one field office placed', offices.length === 1);
  const o = offices[0];
  const d = Math.hypot(o.x + o.size[0] / 2 - 100, o.z + o.size[1] / 2 - 100);
  check('office 6–14 blocks from spawn', d >= 5.5 && d <= 15, `dist ${d.toFixed(1)}`);
  check('office prebuilt & free', o.constructionProgress === 1 && o.data.cost === 0 && h.ctx.state.company.money === 500_000_000);
  check('concrete pad under office', h.world.getBlock(o.x, o.y - 1, o.z) === B.CONCRETE_PAD);
  check('structure written', h.world.getBlock(o.x, o.y, o.z) === B.STRUCTURE);
  check('services.buildingAt finds it', h.ctx.services.construction.buildingAt(o.x + 1, o.y + 1, o.z + 1) === o.id);
  run(h, 3);
  check('office active', o.status === 'active', o.status);
}

// -------------------------------------------------------------------------------------------------
section('2. Placement validation');
{
  const h = newHarness();
  const v = (t: string, x: number, z: number, r: 0 | 1 = 0) => h.ctx.services.construction.validate(t, x, z, r);
  let r = v('oil_tank_small', 60, 60);
  check('flat land ok', r.ok && r.y === 70 && r.cost === 90_000, JSON.stringify(r));
  r = v('worker_camp', 32, 32); // 6×4 on the 1:1 hill → 5-block spread > 4 allowed
  check('steep hill rejected', !r.ok && /steep/.test(r.reason ?? ''), r.reason);
  r = v('oil_tank_small', 36, 60);
  check('hill edge outside slope ok', r.ok, r.reason);
  r = v('field_office', 215, 100);
  check('land building over water rejected', !r.ok && /dry land/.test(r.reason ?? ''), r.reason);
  r = v('gas_plant', 60, 60);
  check('tech required', !r.ok && /Requires research/.test(r.reason ?? ''), r.reason);
  r = v('wellhead', 60, 60);
  check('wellhead not placeable', !r.ok, r.reason);
  r = v('oil_tank_small', 254, 100);
  check('out of map rejected', !r.ok && /Outside/.test(r.reason ?? ''), r.reason);
  grantTech(h, 'offshore_shallow', 'marine_export', 'hydraulic_fracturing');
  r = v('production_platform', 212, 100);
  check('platform over 13-deep water ok', r.ok && r.y === 63, JSON.stringify(r));
  r = v('jackup_rig', 240, 100);
  check('jack-up in 23-deep water rejected (max 14)', !r.ok && /too deep/.test(r.reason ?? ''), r.reason);
  r = v('production_platform', 201, 100);
  check('platform on the beach rejected', !r.ok, r.reason);
  r = v('export_terminal', 200, 100);
  check('export terminal straddling shore ok', r.ok, JSON.stringify(r));
  r = v('export_terminal', 150, 100);
  check('export terminal inland rejected', !r.ok && /shoreline/.test(r.reason ?? ''), r.reason);
  r = v('frac_spread', 60, 60);
  check('frac spread needs a wellhead', !r.ok && /wellhead/.test(r.reason ?? ''), r.reason);
  addWellhead(h, 70, 60);
  r = v('frac_spread', 74, 60);
  check('frac spread next to wellhead ok', r.ok, r.reason);
  const tank = placeCmd(h, 'oil_tank_small', 60, 60);
  check('tank placed & charged', tank.status === 'constructing' && h.ctx.state.company.money === 500_000_000 - 90_000);
  check('gravel pad under tank', h.world.getBlock(60, 69, 60) === B.GRAVEL_PAD);
  r = v('oil_tank_small', 62, 62);
  check('overlap rejected', !r.ok && /Overlaps/.test(r.reason ?? ''), r.reason);
  h.world.setBlock(90, 70, 90, B.PIPE_OIL, 'player');
  r = v('oil_tank_small', 88, 88);
  check('pipe inside footprint rejected', !r.ok && /Pipes/.test(r.reason ?? ''), r.reason);
  h.world.setBlock(40, 60, 90, B.CASING, 'system');
  h.world.setBlock(40, 69, 90, B.CASING, 'system');
  r = v('oil_tank_small', 39, 89);
  check('casing under pad rejected', !r.ok && /wellbore/.test(r.reason ?? ''), r.reason);
  // Levelling on a gentle slope: hill edge (x 30..33 → heights 70,70,71,71)
  const t2 = placeCmd(h, 'oil_tank_small', 30, 52);
  check('placement outside hill ok', !!t2);
  const office = placeCmd(h, 'weather_station', 32, 40); // 1:1 slope: surfaces 72,73 → cut & fill to one level
  check('levelled on hill: pad at y-1, volume clear', h.world.getBlock(32, office.y - 1, 40) === B.CONCRETE_PAD && h.world.getBlock(33, office.y, 41) === B.STRUCTURE, `y=${office.y}`);
  const res = h.ctx.commands.dispatch({ type: 'build/place', buildingType: 'not_a_building', x: 0, z: 0, rotation: 0 });
  check('build/place without building type fails cleanly', !res.ok);
  h.ctx.state.company.money = 10;
  r = v('oil_tank_small', 120, 120);
  check('insufficient money reported', !r.ok && /money/.test(r.reason ?? ''), r.reason);
}

// -------------------------------------------------------------------------------------------------
section('3. Oil chain: wellhead → crude pipeline → truck terminal + tank; gas flared at wellhead');
let oilH: Harness;
{
  const h = (oilH = newHarness());
  const wh = addWellhead(h, 60, 60);
  const tank = placeCmd(h, 'oil_tank_small', 66, 62);
  const term = placeCmd(h, 'truck_terminal', 76, 59);
  const n = pipe(h, B.PIPE_OIL, 63, 70, 61, 75, 61);
  check('pipe run built', n === 13);
  const sph = stepsPerHour(h);
  run(h, sph * 13);
  check('construction completes in ~12 h (truck rack)', term.constructionProgress === 1 && tank.constructionProgress === 1, `${term.status}/${tank.status}`);
  const net = netOf(h, wh, 'oil');
  check('one oil network with wellhead, tank & terminal', !!net && net.buildings.length === 3 && net.pipeCount === 13, JSON.stringify(net && { b: net.buildings.length, p: net.pipeCount }));
  check('services.networkAt resolves pipe', h.ctx.services.networks.networkAt(70, 70, 61) === net?.id);
  const rates = { crude_oil: 2000, natural_gas: 3000, produced_water: 500 };
  run(h, sph * 48, (d) => produce(wh, d, rates));
  const n2 = netOf(h, wh, 'oil')!;
  console.log(`    network ${n2.id}: flow ${f0(n2.flow)} bbl/d, capacity ${f0(n2.capacity)}, linepack ${f0(n2.linepack.crude_oil)}`);
  console.log(`    terminal crude ${f0(term.storage.crude_oil)}, tank crude ${f0(tank.storage.crude_oil)}, wellhead crude ${f0(wh.storage.crude_oil)}`);
  check('terminal filled to its 1,500 bbl', Math.abs((term.storage.crude_oil ?? 0) - 1500) < 1);
  check('tank receives the rest', (tank.storage.crude_oil ?? 0) > 2000);
  check('flow ≈ production (2,000 bbl/d)', Math.abs(n2.flow - 2000) < 150, f0(n2.flow));
  check('mass balance', Math.abs((term.storage.crude_oil ?? 0) + (tank.storage.crude_oil ?? 0) + (wh.storage.crude_oil ?? 0) + (n2.linepack.crude_oil ?? 0) - 4000) < 5);
  const env = h.ctx.state.environment;
  check('excess gas flared at wellhead (no gas line)', env.flaredToday > 5000 && (wh.data.flareRate as number) > 2500, `flared ${f0(env.flaredToday)} mcf, rate ${wh.data.flareRate}`);
  check('flaring counted as emissions', env.emissionsTotal > 200, f0(env.emissionsTotal));
  check('water with no outlet stays in wellhead (≤ cap)', (wh.storage.produced_water ?? 0) <= 400.001 && (wh.storage.produced_water ?? 0) > 390);
  {
    // With water hauling enabled (the default), trucks drain the wellhead at a cost.
    wh.config.truckWater = true;
    const m0 = h.ctx.state.company.money;
    run(h, sph * 6, (d) => produce(wh, d, { ...rates, produced_water: 800 }));
    const spent = m0 - h.ctx.state.company.money;
    check('water hauled by truck when no water line', (wh.storage.produced_water ?? 0) <= 200 && spent > 0, `water ${f0(wh.storage.produced_water)}, spent ${f0(spent)}`);
    wh.config.truckWater = false;
  }
  check('tank io shows inflow', (tank.io.crude_oil ?? 0) > 100, JSON.stringify(tank.io));
  check('tank utilization = fill', Math.abs(tank.utilization - (tank.storage.crude_oil ?? 0) / 10000) < 0.01, tank.utilization.toFixed(3));
  // economy emulation: sell 3,000 bbl/d from the rack → tank discharges to terminal
  const before = tank.storage.crude_oil ?? 0;
  run(h, sph * 24, (d) => {
    produce(wh, d, { crude_oil: 1000 });
    term.storage.crude_oil = Math.max(0, (term.storage.crude_oil ?? 0) - 3000 * d);
  });
  check('tank discharges to terminal when trucks load', (tank.storage.crude_oil ?? 0) < before - 1500, `${f0(before)} → ${f0(tank.storage.crude_oil)}`);
  // venting when flaring disabled
  const res = h.ctx.commands.dispatch({ type: 'building/configure', buildingId: wh.id, key: 'flareExcessGas', value: false });
  check('configure flareExcessGas', res.ok);
  const v0 = env.ventedToday;
  run(h, sph * 4, (d) => produce(wh, d, { natural_gas: 3000 }));
  check('gas vented when flaring off', env.ventedToday - v0 > 300, f0(env.ventedToday - v0));
  const bad = h.ctx.commands.dispatch({ type: 'building/configure', buildingId: wh.id, key: 'flareExcessGas', value: 'yes' });
  check('configure validates types', !bad.ok);
  // Opex: a day boundary has been crossed → one opex ledger entry per day
  const opex = h.ctx.state.company.ledger.filter((l) => l.category === 'opex');
  check('daily opex charged in one entry per day', opex.length >= 2 && opex.every((l) => l.amount < 0), opex.map((l) => `${l.day}:${l.amount}`).join(' '));
}

// -------------------------------------------------------------------------------------------------
section('4. Gas chain: wellhead → gas plant → dry gas → sales meter & gas turbine; NGL → product tank');
{
  const h = newHarness();
  grantTech(h, 'gas_processing');
  // raw-gas gathering line (z=101) into the plant; separate sales-gas line (z=95) out to the meter & turbine
  const wh = addWellhead(h, 60, 100);
  const plant = placeCmd(h, 'gas_plant', 66, 102);
  const meter = placeCmd(h, 'gas_sales_meter', 78, 93);
  const turb = placeCmd(h, 'gas_turbine_power', 83, 90);
  const ptank = placeCmd(h, 'oil_tank_small', 76, 111);
  pipe(h, B.PIPE_GAS, 63, 70, 101, 70, 101);
  pipe(h, B.PIPE_GAS, 75, 70, 102, 75, 96);
  pipe(h, B.PIPE_GAS, 75, 70, 95, 90, 95);
  pipe(h, B.PIPE_PRODUCT, 66, 70, 110, 80, 110);
  completeAll(h);
  staff(h, plant);
  staff(h, turb);
  const sph = stepsPerHour(h);
  let sold = 0;
  run(h, sph * 36, (d) => {
    produce(wh, d, { natural_gas: 30000 });
    // economy emulation: meter sells everything each step
    sold += (meter.storage.dry_gas ?? 0) + (meter.storage.natural_gas ?? 0);
    meter.storage = {};
  });
  const gnet = netOf(h, wh, 'gas')!;
  const snet = netOf(h, meter, 'gas')!;
  console.log(`    raw gas net: flow ${f0(gnet.flow)} mcf/d cap ${f0(gnet.capacity)}; sales net: flow ${f0(snet.flow)} cap ${f0(snet.capacity)} buildings ${snet.buildings.length}`);
  check('plant bridges raw & sales networks', gnet.id !== snet.id && snet.buildings.includes(plant.id) && gnet.buildings.includes(plant.id));
  console.log(`    plant util ${plant.utilization.toFixed(2)} io ${JSON.stringify(Object.fromEntries(Object.entries(plant.io).map(([k, v]) => [k, Math.round(v)])))}`);
  console.log(`    turbine ${turb.data.outputMW} MW io ${JSON.stringify(turb.io)}; power ${JSON.stringify(h.ctx.state.power)}`);
  console.log(`    meter sold ${f0(sold)} mcf in 36 h; product tank ${JSON.stringify(ptank.storage)}`);
  check('gas plant running near full rate', plant.utilization > 0.9 && plant.status === 'active', `${plant.utilization.toFixed(2)} ${plant.status}`);
  check('plant consumes ~30,000 mcf/d', Math.abs((plant.io.natural_gas ?? 0) + 30000) < 2500, f0(plant.io.natural_gas));
  check('plant produces dry gas ~25,500', Math.abs((plant.io.dry_gas ?? 0) - 25500) < 2500, f0(plant.io.dry_gas));
  check('dry gas reaches the sales meter', sold > 25000);
  check('turbine burns gas & generates ~25 MW', (turb.data.outputMW as number) > 24 && (turb.io.dry_gas ?? 0) < -4000, `${turb.data.outputMW} MW, ${f0(turb.io.dry_gas)}`);
  check('power satisfied with surplus exported', h.ctx.state.power.satisfaction === 1 && h.ctx.state.company.ledger.some((l) => l.note.startsWith('Surplus power')));
  check('NGL & sulfur piped to product tank', (ptank.storage.ngl ?? 0) > 800 && (ptank.storage.sulfur ?? 0) > 5, JSON.stringify(ptank.storage));
  check('condensate buffered in plant (no oil line)', (plant.storage.condensate ?? 0) > 100);
  check('no flaring when gas has buyers', (h.ctx.state.environment.flaredToday ?? 0) < 1, f0(h.ctx.state.environment.flaredToday));
  const emis = h.ctx.state.environment.emissionsTotal;
  check('plant + turbine emissions accumulate', emis > 150, f0(emis));
  const setR = h.ctx.commands.dispatch({ type: 'building/setRecipe', buildingId: plant.id, recipeId: 'gas_deep_ethane' });
  const badR = h.ctx.commands.dispatch({ type: 'building/setRecipe', buildingId: plant.id, recipeId: 'refinery_atmospheric' });
  check('setRecipe validates building', setR.ok && !badR.ok);
  // Long gas line without compressor: > 120 blocks
  pipe(h, B.PIPE_GAS, 66, 70, 100, 66, 20);
  pipe(h, B.PIPE_GAS, 67, 70, 20, 140, 20);
  run(h, 4, (d) => produce(wh, d, { natural_gas: 30000 }));
  const g2 = netOf(h, wh, 'gas')! as unknown as { capacity: number; pipeCount: number; needsCompression?: boolean };
  check('long uncompressed gas line throttled ×0.3', !!g2.needsCompression && g2.capacity < 10000, `pipes ${g2.pipeCount} cap ${f0(g2.capacity)}`);
  grantTech(h, 'compression');
  const comp = placeCmd(h, 'compressor_station', 100, 21);
  completeAll(h);
  staff(h, comp);
  run(h, 4, (d) => produce(wh, d, { natural_gas: 30000 }));
  const g3 = netOf(h, wh, 'gas')! as unknown as { capacity: number; boosters: number; needsCompression?: boolean };
  check('compressor restores capacity', g3.boosters === 1 && !g3.needsCompression && g3.capacity > 25000, `boosters ${g3.boosters} cap ${f0(g3.capacity)}`);
}

// -------------------------------------------------------------------------------------------------
section('5. Refinery chain & power deficit');
{
  const h = newHarness();
  grantTech(h, 'refining', 'large_storage', 'lng', 'gas_processing', 'marine_export');
  const crudeTank = placeCmd(h, 'oil_tank_large', 110, 60);
  const ref = placeCmd(h, 'refinery', 120, 60);
  const rack = placeCmd(h, 'truck_terminal', 130, 71);
  const ptank = placeCmd(h, 'oil_tank_small', 136, 71);
  pipe(h, B.PIPE_OIL, 118, 70, 64, 119, 64);
  pipe(h, B.PIPE_OIL, 118, 70, 65, 118, 74);
  const pumps = [placeCmd(h, 'pump_station', 115, 70), placeCmd(h, 'pump_station', 119, 72)];
  pipe(h, B.PIPE_PRODUCT, 120, 70, 70, 140, 70);
  completeAll(h);
  staff(h, ref);
  staff(h, rack);
  crudeTank.storage.crude_oil = 60000;
  const sph = stepsPerHour(h);
  run(h, sph * 24);
  const p = h.ctx.state.power;
  console.log(`    power: demand ${p.demand} MW, import ${p.gridImport} MW, satisfaction ${p.satisfaction.toFixed(2)}`);
  console.log(`    refinery util ${ref.utilization.toFixed(2)} status ${ref.status}; rack ${JSON.stringify(Object.fromEntries(Object.entries(rack.storage).map(([k, v]) => [k, Math.round(v)])))}`);
  console.log(`    product tank ${JSON.stringify(Object.fromEntries(Object.entries(ptank.storage).map(([k, v]) => [k, Math.round(v)])))}`);
  check('grid import capped at 5 MW', p.gridImport === 5 && p.satisfaction < 0.7 && p.satisfaction > 0.45);
  const onet = netOf(h, ref, 'oil')!;
  console.log(`    crude line: ${onet.boosters} pumps, capacity ${f0(onet.capacity)} bbl/d, flow ${f0(onet.flow)}`);
  check('pump stations boost the crude line', onet.boosters === 2 && onet.capacity > 20000 && pumps.every((p) => p.status === 'no_power' || p.status === 'active' || p.status === 'idle'));
  check('refinery throttled by power (~55–70%)', ref.utilization > 0.45 && ref.utilization < 0.75, ref.utilization.toFixed(2));
  check('crude pulled from large tank', (crudeTank.storage.crude_oil ?? 0) < 55000, f0(crudeTank.storage.crude_oil));
  const prod = (i: string) => (rack.storage[i] ?? 0) + (ptank.storage[i] ?? 0) + (ref.storage[i] ?? 0);
  check('gasoline/diesel/jet produced', prod('gasoline') > 4000 && prod('diesel') > 2500 && prod('jet_fuel') > 900, `gas ${f0(prod('gasoline'))} dsl ${f0(prod('diesel'))} jet ${f0(prod('jet_fuel'))}`);
  check('rack fills with products (1,500)', Math.abs(Object.values(rack.storage).reduce((a, b) => a + b, 0) - 1500) < 2);
  check('grid import billed hourly', h.ctx.state.company.ledger.some((l) => l.category === 'fuel' && l.note.startsWith('Grid')));
  // Big deficit: LNG train 25 MW
  const lng = placeCmd(h, 'lng_plant', 150, 60);
  completeAll(h);
  staff(h, lng);
  run(h, sph);
  check('deficit < 30% → consumers no_power', h.ctx.state.power.satisfaction < 0.3 && ref.status === 'no_power' && lng.status === 'no_power', `${h.ctx.state.power.satisfaction.toFixed(2)} ${ref.status}`);
  const gen = placeCmd(h, 'diesel_generator', 110, 80);
  completeAll(h);
  run(h, sph);
  check('diesel genset runs on trucked diesel', (gen.data.outputMW as number) > 1.9 && h.ctx.state.company.ledger.some((l) => l.note.startsWith('Trucked diesel')), `${gen.data.outputMW}`);
  h.ctx.commands.dispatch({ type: 'building/toggle', buildingId: lng.id, enabled: false });
  run(h, 2);
  check('toggle off → disabled, demand drops', lng.status === 'disabled' && h.ctx.state.power.demand < 14, `${lng.status} ${h.ctx.state.power.demand}`);
  check('refinery back to active', ref.status === 'active', ref.status);
  h.ctx.commands.dispatch({ type: 'building/setThrottle', buildingId: ref.id, throttle: 0.25 });
  run(h, sph * 3);
  check('throttle lowers throughput', ref.utilization < 0.4, ref.utilization.toFixed(2));
}

// -------------------------------------------------------------------------------------------------
section('6. Failures, repairs & maintenance depot');
{
  const h = newHarness();
  const tank = placeCmd(h, 'oil_tank_small', 60, 60);
  const pump = placeCmd(h, 'pump_station', 70, 60);
  completeAll(h);
  tank.condition = 0.001;
  run(h, 2);
  check('worn-out equipment breaks', tank.status === 'broken', tank.status);
  const r1 = h.ctx.commands.dispatch({ type: 'building/repair', buildingId: tank.id, manual: true });
  check('first wrench repair: still broken', r1.ok && tank.status === 'broken', JSON.stringify(r1.data));
  h.ctx.commands.dispatch({ type: 'building/repair', buildingId: tank.id, manual: true });
  run(h, 1);
  check('second wrench repair fixes it', tank.status !== 'broken', tank.status);
  check('spare parts bought when warehouse empty', h.ctx.state.company.ledger.some((l) => l.category === 'repairs'));
  pump.condition = 40;
  const r3 = h.ctx.commands.dispatch({ type: 'building/repair', buildingId: pump.id });
  check('dispatch crew costs money', r3.ok && (r3.data as { cost: number }).cost >= 5000, JSON.stringify(r3.data));
  const sph = stepsPerHour(h);
  run(h, sph * 4);
  check('crew repair completes after hours', pump.condition >= 89 && !pump.data.crewRepair, pump.condition.toFixed(1));
  const depot = placeCmd(h, 'maintenance_depot', 80, 60);
  completeAll(h);
  staff(h, depot);
  h.ctx.state.company.warehouse.spare_parts = 10;
  tank.condition = 35;
  pump.status = 'broken';
  run(h, sph * 10);
  check('depot services low-condition tank', tank.condition > 90, tank.condition.toFixed(1));
  check('depot fixes broken pump', pump.status !== 'broken', pump.status);
  check('depot consumed warehouse parts', (h.ctx.state.company.warehouse.spare_parts ?? 0) < 10, String(h.ctx.state.company.warehouse.spare_parts));
  // Random failures happen over time with hazards on (many fragile buildings, poor condition)
  let broke = 0;
  h.session.bus.on('building:statusChanged', (e) => e.status === 'broken' && broke++);
  const extra: BuildingState[] = [];
  for (let i = 0; i < 60; i++) extra.push(placeCmd(h, 'pump_station', 60 + (i % 15) * 4, 150 + Math.floor(i / 15) * 4));
  completeAll(h);
  for (const b of extra) b.condition = 10;
  run(h, sph * 24 * 5);
  check('random failures occur (hazards on)', broke > 0, `${broke} failures in 5 days (60 idle pumps @ 10%)`);
  const inc = h.ctx.state.hazards.incidents.filter((i) => i.kind === 'failure').length;
  check('failures logged as incidents', inc > 0, String(inc));
}

// -------------------------------------------------------------------------------------------------
section('7. Fires, spread, gas sphere explosion, fire station & extinguisher');
{
  const h = newHarness();
  grantTech(h, 'large_storage', 'fire_response');
  const sphere = placeCmd(h, 'gas_sphere', 60, 60);
  const tankA = placeCmd(h, 'oil_tank_small', 68, 60);
  const tankB = placeCmd(h, 'oil_tank_small', 60, 68);
  completeAll(h);
  sphere.storage.natural_gas = 50000;
  tankA.storage.crude_oil = 4000;
  h.ctx.state.hazards.fires.push({ id: 'fire_test', x: 63, y: 72, z: 63, intensity: 0.8, buildingId: sphere.id, startedMinute: 0, spreadTimer: 0 });
  const sph = stepsPerHour(h);
  let hours = 0;
  while (!h.events['hazard:explosion'] && hours < 72) {
    run(h, sph);
    hours++;
  }
  check('burning sphere status = fire → explosion', !!h.events['hazard:explosion'], `after ${hours} h`);
  const ex = h.log.find((l) => l.type === 'hazard:explosion')?.payload as { power: number } | undefined;
  console.log(`    explosion power ${ex?.power}; sphere ${sphere.status}; tankA ${tankA.status} cond ${tankA.condition.toFixed(0)}; tankB ${tankB.status} cond ${tankB.condition.toFixed(0)}`);
  check('sphere destroyed', sphere.status === 'destroyed');
  check('neighbours damaged', tankA.condition < 60 && tankB.condition < 60);
  let scorched = 0;
  let ash = 0;
  for (let x = 45; x < 85; x++)
    for (let z = 45; z < 85; z++)
      for (let y = 60; y < 75; y++) {
        const id = h.world.getBlock(x, y, z);
        if (id === B.SCORCHED_EARTH) scorched++;
        if (id === B.ASH) ash++;
      }
  check('scorched earth & ash around blast', scorched > 20 && ash > 3, `scorched ${scorched}, ash ${ash}`);
  check('fires counted in stats', h.ctx.state.stats.fires >= 1, String(h.ctx.state.stats.fires));
  // fire station puts out remaining fires
  const station = placeCmd(h, 'fire_station', 90, 60);
  completeAll(h);
  staff(h, station);
  run(h, sph * 12);
  check('fire station extinguishes fires within 80 blocks', h.ctx.state.hazards.fires.length === 0, `${h.ctx.state.hazards.fires.length} left`);
  // extinguisher command
  const tankC = placeCmd(h, 'oil_tank_small', 150, 150);
  completeAll(h);
  h.ctx.state.hazards.fires.push({ id: 'fire_c', x: 151, y: 71, z: 151, intensity: 0.2, buildingId: tankC.id, startedMinute: 0, spreadTimer: 0 });
  run(h, 1);
  check('building on fire has status fire', tankC.status === 'fire' && tankC.fire > 0, tankC.status);
  for (let i = 0; i < 10; i++) h.ctx.commands.dispatch({ type: 'building/extinguish', buildingId: tankC.id, amount: 0.06 });
  run(h, 1);
  check('extinguisher puts out small fire → broken', h.ctx.state.hazards.fires.length === 0 && tankC.status === 'broken', tankC.status);
  // well fire persists during a burning blowout
  const wh = addWellhead(h, 180, 180);
  const well = h.ctx.state.wells[wh.wellId!];
  well.status = 'blowout';
  well.blowout = { startedDay: 1, onFire: true, flowRate: 5000, capProgress: 0 };
  h.ctx.state.hazards.fires.push({ id: 'fire_w', x: 181, y: 71, z: 181, intensity: 0.5, wellId: well.id, startedMinute: 0, spreadTimer: 0 });
  for (let i = 0; i < 30; i++) h.ctx.commands.dispatch({ type: 'building/extinguish', fireId: 'fire_w', amount: 0.1 });
  run(h, sph * 2);
  const wf = h.ctx.state.hazards.fires.find((f) => f.id === 'fire_w');
  check('blowout fire cannot be put out while the well flows', !!wf && wf.intensity >= 0.3, wf?.intensity.toFixed(2));
  well.blowout.onFire = false;
  run(h, sph * 4);
  check('fire dies once blowout capped', !h.ctx.state.hazards.fires.some((f) => f.id === 'fire_w'));
}

// -------------------------------------------------------------------------------------------------
section('8. Leak & spill, cleanup, repair');
{
  const h = oilH;
  const wh = Object.values(h.ctx.state.buildings).find((b) => b.type === 'wellhead')!;
  const net = netOf(h, wh, 'oil')!;
  const sph = stepsPerHour(h);
  net.leak = { x: 70, y: 70, z: 61, rate: 600, startedDay: h.ctx.state.time.day, detectAt: h.ctx.state.time.totalMinutes + 10 * 60 } as typeof net.leak;
  const term = Object.values(h.ctx.state.buildings).find((b) => b.type === 'truck_terminal')!;
  run(h, sph * 12, (d) => {
    produce(wh, d, { crude_oil: 2000 });
    term.storage = {};
  });
  const spill = h.ctx.state.environment.spills.find((s) => s.kind === 'oil');
  let pools = 0;
  for (let x = 60; x < 80; x++) for (let z = 52; z < 70; z++) if (h.world.getBlock(x, 70, z) === B.OIL_POOL) pools++;
  console.log(`    spill volume ${f0(spill?.volume)} bbl, pools ${pools}, leak ${JSON.stringify(net.leak)}`);
  check('leak spills oil into environment.spills', !!spill && spill.volume > 100);
  check('OIL_POOL blocks placed around the leak', pools >= 2, String(pools));
  check('leak detected after delay', !!(net.leak as { detected?: boolean })?.detected);
  check('hazard:spill emitted', (h.events['hazard:spill'] ?? 0) >= 1);
  const r = h.ctx.commands.dispatch({ type: 'building/repair', buildingId: net.id, manual: true });
  check('wrench repair of network leak', r.ok && !h.ctx.state.networks[net.id].leak);
  grantTech(h, 'leak_detection');
  net.leak = { x: 65, y: 70, z: 61, rate: 600, startedDay: h.ctx.state.time.day, detectAt: 0 } as typeof net.leak;
  run(h, sph * 3, (d) => produce(wh, d, { crude_oil: 2000 }));
  check('leak_detection: auto-isolation within hours', !!(net.leak as { isolated?: boolean })?.isolated);
  const rc = h.ctx.commands.dispatch({ type: 'building/repair', buildingId: net.id });
  run(h, sph * 4, (d) => produce(wh, d, { crude_oil: 2000 }));
  check('dispatched crew repairs the leak', rc.ok && !h.ctx.state.networks[net.id].leak);
  const sr = placeCmd(h, 'spill_response', 80, 66);
  completeAll(h);
  staff(h, sr);
  run(h, sph * 24);
  const s2 = h.ctx.state.environment.spills.find((s) => s.id === spill?.id);
  let pools2 = 0;
  for (let x = 60; x < 80; x++) for (let z = 52; z < 70; z++) if (h.world.getBlock(x, 70, z) === B.OIL_POOL) pools2++;
  check('spill response cleans the spill', !s2 || s2.cleaned >= s2.volume, s2 ? `${f0(s2.cleaned)}/${f0(s2.volume)}` : 'removed');
  check('oil pools removed after cleanup', pools2 === 0, String(pools2));
  // Random leaks on a long network
  const h2 = newHarness({ difficulty: 'hard' });
  const w2 = addWellhead(h2, 20, 20);
  const t2 = placeCmd(h2, 'truck_terminal', 60, 97);
  // ~2,000-block serpentine gathering line
  for (let row = 0; row < 10; row++) {
    const z = 60 + row * 4;
    pipe(h2, B.PIPE_OIL, 60, 70, z, 250, z);
    if (row < 9) pipe(h2, B.PIPE_OIL, row % 2 ? 60 : 250, 70, z + 1, row % 2 ? 60 : 250, z + 3);
  }
  pipe(h2, B.PIPE_OIL, 23, 70, 21, 60, 21);
  pipe(h2, B.PIPE_OIL, 60, 70, 22, 60, 59);
  completeAll(h2);
  staff(h2, t2);
  let leaks = 0;
  h2.session.bus.on('network:leak', () => leaks++);
  run(h2, stepsPerHour(h2) * 24 * 12, (d) => {
    produce(w2, d, { crude_oil: 1500 });
    t2.storage = {};
    for (const n of Object.values(h2.ctx.state.networks)) if (n.leak && (n.leak as { detected?: boolean }).detected) delete n.leak;
  });
  check('random leaks occur on long lines', leaks > 0, `${leaks} leaks in 12 days on ${netOf(h2, w2, 'oil')?.pipeCount} pipes, flow ${f0(netOf(h2, w2, 'oil')?.flow)}`);
}

// -------------------------------------------------------------------------------------------------
section('9. Water: pit, disposal well, injector');
{
  const h = newHarness();
  grantTech(h, 'waterflood');
  const wh = addWellhead(h, 60, 60);
  const pit = placeCmd(h, 'water_pit', 66, 62);
  const disp = placeCmd(h, 'disposal_well', 74, 62);
  const inj = addWellhead(h, 80, 62, 'injector_water');
  pipe(h, B.PIPE_WATER, 63, 70, 61, 85, 61);
  completeAll(h);
  staff(h, disp);
  const sph = stepsPerHour(h);
  let injected = 0;
  run(h, sph * 24, (d) => {
    produce(wh, d, { produced_water: 6000 });
    const q = Math.min(inj.storage.produced_water ?? 0, 1500 * d); // upstream injects
    inj.storage.produced_water = (inj.storage.produced_water ?? 0) - q;
    injected += q;
  });
  console.log(`    injected ${f0(injected)} bbl in a day`);
  console.log(`    disposal io ${JSON.stringify(disp.io)} util ${disp.utilization.toFixed(2)}; pit ${f0(pit.storage.produced_water)} bbl; injector ${f0(inj.storage.produced_water)}`);
  check('injector wellhead fed from the water line', injected > 500);
  check('disposal well injects water', (disp.io.produced_water ?? 0) < -3000, f0(disp.io.produced_water));
  check('pit stores the remainder', (pit.storage.produced_water ?? 0) >= 0);
  pit.storage.produced_water = 6000;
  h.ctx.state.weather.current = 'storm';
  h.ctx.state.weather.precipitation = 1;
  h.ctx.commands.dispatch({ type: 'building/toggle', buildingId: disp.id, enabled: false });
  run(h, sph * 6, (d) => produce(wh, d, { produced_water: 6000 }));
  check('pit overflows in heavy rain → brine spill', h.ctx.state.environment.spills.some((s) => s.kind === 'water'));
}

// -------------------------------------------------------------------------------------------------
section('10. Demolish rules & refunds');
{
  const h = newHarness();
  const m0 = h.ctx.state.company.money;
  const tank = placeCmd(h, 'oil_tank_small', 60, 60);
  const c1 = h.ctx.commands.dispatch({ type: 'build/cancel', buildingId: tank.id });
  check('cancel refunds 90%', c1.ok && Math.abs(h.ctx.state.company.money - (m0 - 90000 * 0.1)) < 1, f0(h.ctx.state.company.money - m0));
  check('structure cleared', h.world.getBlock(61, 70, 61) === B.AIR);
  const t2 = placeCmd(h, 'oil_tank_small', 60, 60);
  completeAll(h);
  const m1 = h.ctx.state.company.money;
  const c2 = h.ctx.commands.dispatch({ type: 'build/cancel', buildingId: t2.id });
  check('cancel of completed building refused', !c2.ok);
  t2.storage.crude_oil = 1000;
  const d1 = h.ctx.commands.dispatch({ type: 'build/demolish', buildingId: t2.id });
  check('demolish refunds 30% & salvages stock', d1.ok && Math.round(h.ctx.state.company.money - m1) === 27000 && h.ctx.state.company.warehouse.crude_oil === 1000);
  const wh = addWellhead(h, 80, 80);
  const d2 = h.ctx.commands.dispatch({ type: 'build/demolish', buildingId: wh.id });
  check('producing wellhead cannot be demolished', !d2.ok, d2.error);
  h.ctx.state.wells[wh.wellId!].status = 'plugged';
  const d3 = h.ctx.commands.dispatch({ type: 'build/demolish', buildingId: wh.id });
  check('plugged wellhead can be demolished', d3.ok);
  const rig = placeCmd(h, 'drilling_rig_land', 100, 60);
  completeAll(h);
  const w = addWellhead(h, 150, 150);
  h.ctx.state.wells[w.wellId!].rigId = rig.id;
  h.ctx.state.wells[w.wellId!].status = 'drilling';
  const d4 = h.ctx.commands.dispatch({ type: 'build/demolish', buildingId: rig.id });
  check('drilling rig cannot be demolished', !d4.ok, d4.error);
  // pipes connected to a demolished building drop the reference
  const t3 = placeCmd(h, 'oil_tank_small', 60, 90);
  pipe(h, B.PIPE_OIL, 64, 70, 91, 70, 91);
  completeAll(h);
  run(h, 4);
  const nid = h.ctx.services.networks.networkAt(66, 70, 91)!;
  check('tank on network', h.ctx.state.networks[nid].buildings.includes(t3.id));
  h.ctx.commands.dispatch({ type: 'build/demolish', buildingId: t3.id });
  run(h, 4);
  check('network forgets demolished tank', !h.ctx.state.networks[nid].buildings.includes(t3.id));
  // stable ids across topology edits
  h.world.setBlock(71, 70, 91, B.PIPE_OIL, 'player');
  run(h, 4);
  check('network id stable when extended', h.ctx.services.networks.networkAt(71, 70, 91) === nid);
  h.world.setBlock(67, 70, 91, B.AIR, 'player');
  run(h, 4);
  const a = h.ctx.services.networks.networkAt(66, 70, 91);
  const b = h.ctx.services.networks.networkAt(70, 70, 91);
  check('split keeps id on anchor side, new id on the other', !!a && !!b && a !== b && (a === nid || b === nid), `${a} ${b}`);
  h.world.setBlock(70, 70, 91, B.AIR, 'player');
  h.world.setBlock(64, 70, 91, B.AIR, 'player'); // anchor of the original network
  run(h, 4);
  check('network id survives removal of its anchor pipe', [h.ctx.services.networks.networkAt(65, 70, 91), h.ctx.services.networks.networkAt(71, 70, 91)].includes(nid), `${h.ctx.services.networks.networkAt(65, 70, 91)} ${h.ctx.services.networks.networkAt(71, 70, 91)}`);
  check('CASING never forms networks', h.ctx.services.networks.networkAt(40, 60, 90) === undefined);
}

// -------------------------------------------------------------------------------------------------
section('11. Emissions & carbon capture');
{
  const h = newHarness();
  grantTech(h, 'carbon_capture', 'renewables');
  const turb = placeCmd(h, 'gas_turbine_power', 60, 60);
  const ccs = placeCmd(h, 'ccs_unit', 70, 60);
  const solar = placeCmd(h, 'solar_farm', 60, 80);
  completeAll(h);
  staff(h, turb);
  staff(h, ccs);
  const sph = stepsPerHour(h);
  run(h, sph * 12, () => (turb.storage.dry_gas = 3000));
  const env = h.ctx.state.environment;
  console.log(`    turbine util ${turb.utilization.toFixed(2)} emissions ${f0(env.emissionsTotal)} t, credits ${f0(env.carbonCredits)} t, ccs ${ccs.data.capturedRate} t/d, solar ${solar.data.outputMW} MW`);
  check('CCS captures turbine CO2 → carbon credits', env.carbonCredits > 10 && (ccs.data.capturedRate as number) > 50);
  check('net emissions reduced', env.emissionsTotal < 90 * 0.5 * 0.9);
  check('solar produces in daytime', h.ctx.state.time.minuteOfDay > 8 * 60 && h.ctx.state.time.minuteOfDay < 17 * 60 ? (solar.data.outputMW as number) > 0.5 : true, `${solar.data.outputMW} @ ${Math.round(h.ctx.state.time.minuteOfDay / 60)}h`);
}

// -------------------------------------------------------------------------------------------------
section('12. Save / load round trip');
{
  const h = oilH;
  const state = JSON.parse(JSON.stringify(h.ctx.state));
  const edits = h.world.serializeEdits();
  const ids = Object.keys(state.networks).sort();
  const h2 = newHarness({ state, edits });
  check('networks keep ids after reload', JSON.stringify(Object.keys(h2.ctx.state.networks).sort()) === JSON.stringify(ids), `${ids} → ${Object.keys(h2.ctx.state.networks)}`);
  check('no duplicate starting office on load', Object.values(h2.ctx.state.buildings).filter((b) => b.type === 'field_office').length === 1);
  run(h2, 10);
  check('sim continues after load', h2.ctx.state.time.tick > h.ctx.state.time.tick);
}

// -------------------------------------------------------------------------------------------------
section('13. Performance: 400 buildings, ~6,000 pipe blocks');
{
  const h = newHarness({ hazards: true });
  grantTech(h, 'gas_processing', 'refining', 'large_storage');
  let n = 0;
  const wells: BuildingState[] = [];
  for (let gz = 0; gz < 20; gz++) {
    for (let gx = 0; gx < 10; gx++) {
      const x = 4 + gx * 19;
      const z = 4 + gz * 12;
      if (x > 190) continue;
      if (x < 52 && x + 12 > 28 && z < 52 && z + 12 > 28) continue; // skip the hill
      wells.push(addWellhead(h, x, z));
      placeCmd(h, 'oil_tank_small', x + 6, z);
      n += 2;
      pipe(h, B.PIPE_OIL, x + 3, 70, z + 1, x + 5, z + 1);
      pipe(h, B.PIPE_GAS, x + 1, 70, z + 3, x + 1, z + 9);
    }
  }
  // trunk lines
  let pipes = 0;
  for (let gz = 0; gz < 20; gz++) pipes += pipe(h, B.PIPE_OIL, 2, 71, 4 + gz * 12 + 1, 195, 4 + gz * 12 + 1);
  for (let gx = 0; gx < 10; gx++) pipes += pipe(h, B.PIPE_GAS, 4 + gx * 19 + 1, 71, 2, 4 + gx * 19 + 1, 245);
  completeAll(h);
  h.ctx.services.networks.rebuild();
  let t0 = performance.now();
  for (let i = 0; i < 5; i++) h.ctx.services.networks.rebuild();
  const tr = (performance.now() - t0) / 5;
  // incremental: extend one trunk line by 40 blocks, one block per step (player laying pipe)
  const idBefore = h.ctx.services.networks.networkAt(190, 71, 5); // (gas trunks cut the oil trunk into segments)
  t0 = performance.now();
  for (let i = 0; i < 40; i++) {
    h.world.setBlock(196 + (i % 40 < 3 ? i : 2), 71, 5 + (i < 3 ? 0 : i - 2), B.PIPE_OIL, 'player');
    h.ctx.services.networks.networkAt(2, 71, 5);
  }
  const ti = (performance.now() - t0) / 40;
  check('incremental pipe additions keep the network id', h.ctx.services.networks.networkAt(198, 71, 42) === idBefore, `${h.ctx.services.networks.networkAt(198, 71, 42)} vs ${idBefore}`);
  const nets = Object.keys(h.ctx.state.networks).length;
  let pipeTotal = 0;
  for (const nn of Object.values(h.ctx.state.networks)) pipeTotal += nn.pipeCount;
  const steps = 600;
  const t1 = performance.now();
  run(h, steps, (d) => {
    for (const w of wells) produce(w, d, { crude_oil: 300, natural_gas: 800, produced_water: 100 });
  });
  const per = (performance.now() - t1) / steps;
  console.log(`    ${Object.keys(h.ctx.state.buildings).length} buildings, ${pipeTotal} pipe blocks, ${nets} networks; full rebuild ${tr.toFixed(1)} ms, incremental add ${ti.toFixed(3)} ms; ${per.toFixed(2)} ms/step (incl. upstream emulation)`);
  check('full topology rebuild < 60 ms', tr < 60, `${tr.toFixed(1)} ms`);
  check('incremental pipe add < 1 ms', ti < 1, `${ti.toFixed(3)} ms`);
  check('step < 4 ms', per < 4, `${per.toFixed(2)} ms`);
}

// -------------------------------------------------------------------------------------------------
section('14. Hazards off: no random failures / leaks');
{
  const h = newHarness({ hazards: false });
  const extra: BuildingState[] = [];
  for (let i = 0; i < 20; i++) extra.push(placeCmd(h, 'pump_station', 20 + (i % 10) * 4, 150 + Math.floor(i / 10) * 4));
  completeAll(h);
  for (const b of extra) b.condition = 30;
  run(h, stepsPerHour(h) * 24 * 2);
  check('no random failures when hazards are off', extra.every((b) => b.status !== 'broken'));
  check('condition still decays', extra.every((b) => b.condition < 30));
}

// -------------------------------------------------------------------------------------------------
section('15. Offshore: platform → subsea crude line → onshore tank; flaring & overboard water');
{
  const h = newHarness();
  grantTech(h, 'offshore_shallow');
  const plat = placeCmd(h, 'production_platform', 212, 100);
  const tank = placeCmd(h, 'oil_tank_small', 186, 103);
  completeAll(h);
  staff(h, plat);
  check('platform deck at sea level + 1', plat.y === 63 && h.world.getBlock(213, 64, 101) === B.STRUCTURE && h.world.getBlock(213, 60, 101) === B.WATER, `y=${plat.y}`);
  // subsea line along z=104 at the deck level, rising at x=190 to the tank level
  for (let x = 211; x >= 190; x--) h.world.setBlock(x, 63, 104, B.PIPE_OIL, 'player');
  for (let y = 64; y <= 70; y++) h.world.setBlock(190, y, 104, B.PIPE_OIL, 'player');
  const sph = stepsPerHour(h);
  run(h, sph * 24, (d) => {
    // upstream deposits offshore well output into the platform
    plat.storage.crude_oil = Math.min(20000, (plat.storage.crude_oil ?? 0) + 3000 * d);
    plat.storage.natural_gas = Math.min(20000, (plat.storage.natural_gas ?? 0) + 8000 * d);
    plat.storage.produced_water = Math.min(5000, (plat.storage.produced_water ?? 0) + 4000 * d);
  });
  const n = netOf(h, plat, 'oil');
  console.log(`    subsea line ${n?.pipeCount} pipes, flow ${f0(n?.flow)}; tank ${f0(tank.storage.crude_oil)}; platform ${JSON.stringify(Object.fromEntries(Object.entries(plat.storage).map(([k, v]) => [k, Math.round(v)])))}; flare ${plat.data.flareRate}`);
  check('platform exports crude through the subsea line', (tank.storage.crude_oil ?? 0) > 2500 && n?.buildings.includes(tank.id) === true);
  check('platform flares gas without a gas line', (plat.data.flareRate as number) > 5000);
  check('treated water discharged overboard (≤ half tank)', (plat.storage.produced_water ?? 0) <= 2501);
}

console.log(`\n${passes} passed, ${failures} failed`);
console.log(`building types covered: ${Object.keys(BUILDINGS).length}`);
if (failures > 0) (globalThis as unknown as { process: { exitCode: number } }).process.exitCode = 1;
