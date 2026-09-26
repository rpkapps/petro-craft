// Rich mock GameState for the UI dev harness: every building/well status, 200 days of history, markets,
// workforce, contracts, surveys, leases, research, hazards, notifications and objectives.
import { createInitialState } from '../../src/core/state';
import { makeRng } from '../../src/core/rng';
import { ITEMS, TRADABLE_IDS, SUPPLY_IDS } from '../../src/content/items';
import { STARTING_TECHS } from '../../src/content/tech';
import { rotatedSize } from '../../src/core/buildingUtil';
import { B, blockItemId } from '../../src/core/blocks';
import type {
  BuildingState, BuildingStatus, CasingString, Contract, DailyFinance, GameState, IGeology, LedgerCategory, Notification,
  Rotation, Vec3, WellLogSample, WellPlan, WellPurpose, WellState, WellStatus, Worker, WorkerRole,
} from '../../src/core/types';

const R = makeRng(4242);
const rnd = (a: number, b: number) => a + R() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(R() * arr.length)];

let nextId = 100;
const id = (p: string) => `${p}${(nextId++).toString(36)}`;

export function createMockState(geo: IGeology): GameState {
  const spawn = { x: 214, y: geo.surfaceHeight(214, 236), z: 236 };
  const st = createInitialState(
    { saveName: 'Permian Dreams', companyName: 'Black Mesa Petroleum', seed: 12345, worldSize: 'medium', difficulty: 'normal', tutorial: true, hazards: true, creative: false },
    'p1', spawn,
  );
  const DAY = 214;
  st.time = { tick: 900000, totalMinutes: DAY * 1440 + 14 * 60 + 25, day: DAY, minuteOfDay: 14 * 60 + 25, speed: 2, paused: false, startYear: 2026 };
  st.meta.playTimeSec = 5 * 3600 + 23 * 60;
  const c = st.company;
  c.money = 12_437_820;
  c.reputation = 64;

  // ---- buildings ---------------------------------------------------------------------------------
  const mk = (type: string, x: number, z: number, status: BuildingStatus, extra: Partial<BuildingState> = {}): BuildingState => {
    const rot: Rotation = 0;
    const b: BuildingState = {
      id: id('b'), type, x, y: geo.surfaceHeight(x, z), z, rotation: rot, size: rotatedSize(type, rot), status, enabled: status !== 'disabled',
      constructionProgress: status === 'constructing' ? 0.45 : 1, condition: rnd(55, 98), fire: status === 'fire' ? 0.7 : 0,
      builtDay: Math.floor(rnd(10, 200)), lastMaintenanceDay: Math.floor(rnd(150, 210)), storage: {}, throttle: 1, utilization: status === 'active' ? rnd(0.55, 0.95) : 0,
      io: {}, workers: [], config: {}, owner: 'p1', data: {}, ...extra,
    };
    st.buildings[b.id] = b;
    return b;
  };
  mk('field_office', 200, 214, 'active');
  mk('worker_camp', 188, 214, 'active');
  const yard = mk('warehouse', 180, 222, 'active');
  const lab = mk('research_lab', 206, 205, 'active', { utilization: 0.82 });
  const rig = mk('drilling_rig_land', 226, 248, 'active', { utilization: 0.9 });
  mk('drilling_rig_heavy', 262, 300, 'idle');
  const tank1 = mk('oil_tank_small', 236, 226, 'active', { storage: { crude_oil: 3820 } });
  const tank2 = mk('oil_tank_small', 241, 226, 'active', { storage: { crude_oil: 1260, gasoline: 900 } });
  const tankL = mk('oil_tank_large', 246, 214, 'idle', { storage: { crude_oil: 41200 } });
  const sphere = mk('gas_sphere', 256, 214, 'active', { storage: { natural_gas: 22_400, dry_gas: 8_100 } });
  const truck = mk('truck_terminal', 236, 206, 'active', { storage: { crude_oil: 1180 }, data: { soldToday: 2240, revenueToday: 161_000 } });
  const meter = mk('gas_sales_meter', 262, 206, 'active', { storage: { dry_gas: 5200 }, data: { soldToday: 31_000 } });
  const gasPlant = mk('gas_plant', 270, 226, 'active', { recipeId: 'gas_cryo', storage: { natural_gas: 6400, dry_gas: 2100, ngl: 1300, condensate: 340 }, throttle: 0.85, io: { natural_gas: -18_000, dry_gas: 14_600, ngl: 820, condensate: 160, sulfur: 12 } });
  mk('refinery', 282, 240, 'constructing');
  mk('flare_stack', 222, 228, 'active', { config: {} });
  const pit = mk('water_pit', 214, 260, 'active', { storage: { produced_water: 3900 } });
  const disposal = mk('disposal_well', 205, 262, 'broken', { condition: 12 });
  mk('compressor_station', 250, 232, 'no_power');
  mk('diesel_generator', 196, 228, 'active', { utilization: 0.7 });
  const turbine = mk('gas_turbine_power', 280, 206, 'active', { utilization: 0.94 });
  mk('solar_farm', 170, 236, 'active', { utilization: 0.62 });
  mk('pump_station', 246, 244, 'unstaffed');
  const fireSt = mk('fire_station', 196, 244, 'fire', { condition: 38 });
  mk('maintenance_depot', 186, 232, 'disabled');
  mk('weather_station', 214, 198, 'active');
  const jack = mk('jackup_rig', 420, 250, 'active');
  const plat = mk('production_platform', 436, 272, 'active', { storage: { crude_oil: 8200, natural_gas: 9400, produced_water: 1200 } });

  // ---- wells -----------------------------------------------------------------------------------
  const wellHeads: BuildingState[] = [];
  const mkWell = (name: string, x: number, z: number, status: WellStatus, purpose: WellPurpose, planKind: WellPlan['kind'], targetY: number, opts: Partial<WellState> = {}): WellState => {
    const surfaceY = geo.surfaceHeight(x, z);
    const plan: WellPlan = { kind: planKind, targetY, kickoffY: planKind !== 'vertical' ? targetY + 14 : undefined, azimuth: 0.6, offset: planKind === 'directional' ? 18 : undefined, lateralLength: planKind === 'horizontal' ? 34 : undefined, casingPoints: [surfaceY - 6, surfaceY - 22, targetY], mudWeight: 10.2 };
    const full = trajectory(x, surfaceY, z, plan);
    const doneFrac = ['planned'].includes(status) ? 0 : ['drilling', 'tripping', 'kick'].includes(status) ? 0.62 : status === 'casing' ? 0.4 : 1;
    const nPts = Math.max(1, Math.floor(full.length * doneFrac));
    const traj = full.slice(0, nPts);
    const cur = traj[traj.length - 1] ?? { x, y: surfaceY, z };
    const casing: CasingString[] = [{ name: 'conductor', topY: surfaceY, bottomY: surfaceY - 2, cemented: true }];
    if (cur.y < surfaceY - 6) casing.push({ name: 'surface', topY: surfaceY, bottomY: surfaceY - 6, cemented: true });
    if (cur.y < surfaceY - 22) casing.push({ name: 'intermediate', topY: surfaceY, bottomY: surfaceY - 22, cemented: true });
    if (doneFrac === 1 && !['dry_hole'].includes(status)) casing.push({ name: 'production', topY: surfaceY, bottomY: targetY, cemented: true });
    const log: WellLogSample[] = traj.map((p, i) => {
      const pr = geo.properties(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      return { md: i, y: p.y, gammaRay: pr.gammaRay, resistivity: pr.resistivity, porosity: pr.porosity, density: pr.density, fluid: pr.fluid, rock: pr.rock, gasShow: pr.fluid === 'gas' ? 80 : pr.fluid === 'oil' ? 35 : rnd(0, 6) };
    });
    const penetrated = [...new Set(traj.map((p) => geo.reservoirAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))?.id).filter(Boolean) as string[])];
    const producing = status === 'producing' || status === 'shut_in';
    const qi = opts.rates?.oil ?? rnd(300, 1400);
    const history: [number, number, number, number][] = [];
    if (producing || status === 'injecting') {
      const start = DAY - 200;
      for (let d = 0; d < 200; d++) {
        const decline = Math.exp(-d / 260);
        const wc = Math.min(0.8, 0.05 + d * 0.0022);
        const oil = qi * decline * (0.92 + R() * 0.16) * (1 - wc * 0.4);
        history.push([start + d, oil, oil * rnd(0.6, 0.9), oil * wc * 1.3]);
      }
    }
    const last = history[history.length - 1];
    const w: WellState = {
      id: id('w'), name, x, z, surfaceY, offshore: geo.isOffshore(x, z), purpose, status, plan, trajectory: traj, measuredDepth: traj.length - 1, plannedDepth: full.length - 1,
      currentY: cur.y, casing, mudWeight: 10.2, bitCondition: rnd(35, 90), kickVolume: status === 'kick' ? 24 : 0,
      blowout: status === 'blowout' ? { startedDay: DAY - 1, onFire: true, flowRate: 5200, capProgress: 0.35 } : undefined,
      penetrated, completedReservoirs: producing ? penetrated : [], reservoirContact: planKind === 'horizontal' ? 30 : 4, fracStages: planKind === 'horizontal' && producing ? 12 : 0,
      choke: 0.65, lift: producing ? pick(['natural', 'pumpjack', 'esp']) : 'natural', productivity: 1,
      rates: status === 'producing' && last ? { oil: last[1], gas: last[2], water: last[3] } : status === 'injecting' ? { oil: 0, gas: 0, water: -4200 } : { oil: 0, gas: 0, water: 0 },
      bhp: 1800, waterCut: last ? last[3] / Math.max(1, last[1] + last[3]) : 0, gor: 720,
      cumulative: { oil: history.reduce((a, r) => a + r[1], 0), gas: history.reduce((a, r) => a + r[2], 0), water: history.reduce((a, r) => a + r[3], 0) },
      history, log, spudDay: DAY - Math.floor(rnd(20, 230)), completedDay: producing ? DAY - 200 : undefined, cost: rnd(1.2e6, 6.5e6), owner: 'p1', ...opts,
    };
    st.wells[w.id] = w;
    if (producing || status === 'injecting' || status === 'drilled' || status === 'blowout') {
      const wh = mk('wellhead', x - 1, z - 1, status === 'producing' ? 'active' : status === 'blowout' ? 'fire' : 'idle', { wellId: w.id, storage: status === 'producing' ? { crude_oil: rnd(40, 380), natural_gas: rnd(200, 1800), produced_water: rnd(20, 300) } : {}, config: { flareExcessGas: true } });
      w.wellheadId = wh.id;
      wellHeads.push(wh);
    }
    return w;
  };
  const wDrill = mkWell('Eagle 7-H', 228, 250, 'drilling', 'development', 'horizontal', 36);
  wDrill.rigId = rig.id;
  rig.wellId = wDrill.id;
  mkWell('Eagle 1', 204, 238, 'producing', 'exploration', 'vertical', 36, { rates: { oil: 1180, gas: 820, water: 140 } });
  mkWell('Eagle 2', 218, 232, 'producing', 'appraisal', 'vertical', 36);
  mkWell('Eagle 3-H', 196, 250, 'producing', 'development', 'horizontal', 37);
  mkWell('Coyote 1', 300, 170, 'producing', 'exploration', 'directional', 26);
  mkWell('Mesa 1', 150, 330, 'shut_in', 'exploration', 'vertical', 50);
  mkWell('Eagle 4', 232, 262, 'kick', 'development', 'vertical', 36);
  mkWell('Eagle 5', 240, 238, 'blowout', 'development', 'vertical', 36);
  mkWell('Eagle 6', 212, 224, 'drilled', 'development', 'vertical', 36);
  mkWell('Coyote 2', 312, 182, 'casing', 'appraisal', 'vertical', 26);
  mkWell('Bravo 1-H', 262, 300, 'fracking', 'exploration', 'horizontal', 18);
  mkWell('Eagle 8', 190, 226, 'completing', 'development', 'vertical', 36);
  mkWell('Eagle WI-1', 186, 246, 'injecting', 'injector_water', 'vertical', 35);
  mkWell('Dry Creek 1', 120, 180, 'dry_hole', 'exploration', 'vertical', 30);
  mkWell('Old Mesa 2', 160, 320, 'plugged', 'exploration', 'vertical', 48);
  mkWell('Gulf A-1', 424, 254, 'tripping', 'exploration', 'directional', 22, { rigId: jack.id });
  mkWell('Coyote 3', 290, 160, 'planned', 'development', 'vertical', 26);

  // ---- fires & hazards ---------------------------------------------------------------------------
  const blow = Object.values(st.wells).find((w) => w.status === 'blowout')!;
  st.hazards.fires = [
    { id: 'fire1', x: fireSt.x + 2, y: fireSt.y, z: fireSt.z + 2, intensity: 0.7, buildingId: fireSt.id, startedMinute: st.time.totalMinutes - 90, spreadTimer: 0 },
    { id: 'fire2', x: blow.x, y: blow.surfaceY, z: blow.z, intensity: 1, wellId: blow.id, startedMinute: st.time.totalMinutes - 400, spreadTimer: 0 },
  ];
  st.hazards.incidents = [
    { day: DAY, kind: 'blowout', text: 'Eagle 5 blew out while drilling into the Eagle Sand', x: blow.x, z: blow.z },
    { day: DAY, kind: 'fire', text: 'Fire at the Fire Station (electrical fault)' },
    { day: DAY - 3, kind: 'spill', text: '120 bbl crude spill at Storage Tank #2' },
    { day: DAY - 9, kind: 'injury', text: 'Roughneck injured on Land Drilling Rig' },
    { day: DAY - 14, kind: 'lightning', text: 'Lightning strike near the Gas Sphere' },
  ];
  st.hazards.daysSinceIncident = 0;

  // ---- workforce ----------------------------------------------------------------------------------
  const FIRST = ['Jake', 'Maria', 'Tom', 'Aisha', 'Luis', 'Ben', 'Sofia', 'Ray', 'Kenji', 'Olga', 'Dale', 'Priya', 'Hank', 'Nadia', 'Cody', 'Elena', 'Wes', 'Mei', 'Troy', 'Ines', 'Buck', 'Zara', 'Colt', 'Rosa', 'Earl', 'Lena'];
  const LAST = ['Walker', 'Garcia', 'Reyes', 'Okafor', 'Novak', 'Haines', 'Brooks', 'Tanaka', 'Duval', 'Ivanova', 'McCoy', 'Singh', 'Barrett', 'Holt', 'Ramos', 'Keller'];
  const mkWorker = (role: WorkerRole, assigned?: BuildingState): Worker => {
    const w: Worker = { id: id('k'), name: `${pick(FIRST)} ${pick(LAST)}`, role, skill: Math.ceil(rnd(0.01, 5)), xp: rnd(0, 900), wage: Math.round(rnd(280, 720)), morale: rnd(28, 96), fatigue: rnd(5, 85), assignedTo: assigned?.id, hiredDay: Math.floor(rnd(1, 200)), portraitSeed: Math.floor(R() * 1e9) };
    if (assigned) assigned.workers.push(w.id);
    return w;
  };
  const workers: Worker[] = [
    mkWorker('driller', rig), mkWorker('roughneck', rig), mkWorker('roughneck', rig), mkWorker('roughneck', rig), mkWorker('roughneck', rig),
    mkWorker('driller', jack), mkWorker('roughneck', jack), mkWorker('roughneck', jack), mkWorker('engineer', jack),
    mkWorker('engineer', lab), mkWorker('geoscientist', lab), mkWorker('geoscientist', lab),
    mkWorker('operator', gasPlant), mkWorker('operator', gasPlant), mkWorker('operator', gasPlant), mkWorker('engineer', gasPlant),
    mkWorker('trucker', truck), mkWorker('trucker', truck), mkWorker('trucker', truck), mkWorker('trucker', yard),
    mkWorker('operator', turbine), mkWorker('operator', disposal), mkWorker('firefighter', fireSt), mkWorker('firefighter', fireSt),
    mkWorker('operator', plat), mkWorker('operator', plat), mkWorker('technician', plat),
    mkWorker('technician'), mkWorker('driller'), mkWorker('operator'),
  ];
  workers[3].injured = DAY + 4;
  st.workforce = { workers, candidates: ['roughneck', 'technician', 'operator', 'geoscientist', 'firefighter', 'engineer', 'driller'].map((r) => ({ ...mkWorker(r as WorkerRole), hiredDay: 0 })), lastRefreshDay: DAY - 2, autoAssign: true, housing: 32 };

  // ---- research -----------------------------------------------------------------------------------
  st.research = { completed: [...STARTING_TECHS, 'well_logging', 'pdc_bits', 'directional_drilling', 'pumpjacks', 'bop_upgrade', 'leak_detection', 'telemetry', 'compression', 'large_storage', 'gas_processing', 'seismic_3d', 'hr_training', 'fire_response'], current: 'horizontal_drilling', progress: 262, queue: ['hydraulic_fracturing', 'esp_pumps'], pointsPerDay: 18.5, totalPoints: 2400 };

  // ---- market -------------------------------------------------------------------------------------
  for (const cid of TRADABLE_IDS) {
    const base = ITEMS[cid].basePrice;
    const vol = (ITEMS[cid].volatility ?? 1) * 0.022;
    const hist: number[] = [];
    let p = base * rnd(0.85, 1.1);
    for (let d = 0; d < 365; d++) {
      p *= 1 + (R() - 0.5) * vol * 2 + (base - p) / base * 0.02;
      if (cid === 'crude_oil' && d > 300 && d < 320) p *= 0.985;
      hist.push(Math.max(base * 0.3, p));
    }
    st.market.history[cid] = hist;
    st.market.prices[cid] = hist[hist.length - 1];
    st.market.demand[cid] = rnd(0.7, 1.3);
  }
  st.market.events = [
    { id: 'me1', title: 'OPEC+ production cut', description: 'Cartel members agreed to trim output by 1.2 million barrels per day. Crude prices firm.', startDay: DAY - 4, endDay: DAY + 18, effects: { crude_oil: 1.12, condensate: 1.08 }, severity: 'major' },
    { id: 'me2', title: 'Cold snap in the Midwest', description: 'Heating demand surges across the region — gas and propane prices spike.', startDay: DAY - 1, endDay: DAY + 6, effects: { dry_gas: 1.35, lpg: 1.2 }, severity: 'minor' },
    { id: 'me3', title: 'Refinery outage on the Gulf Coast', description: 'A hurricane knocked out 800 kbbl/d of refining capacity. Gasoline and diesel cracks explode.', startDay: DAY - 2, endDay: DAY + 10, effects: { gasoline: 1.25, diesel: 1.3, jet_fuel: 1.2 }, severity: 'crisis' },
  ];
  st.market.hedges = [{ id: 'h1', commodity: 'crude_oil', volume: 30000, price: 74.2, expiryDay: DAY + 40, remaining: 21000 }];
  c.autoSell = { crude_oil: { enabled: true, minPrice: 62, keepReserve: 2000 }, dry_gas: { enabled: true, minPrice: 2.8, keepReserve: 0 }, gasoline: { enabled: false, minPrice: 90, keepReserve: 0 } };
  c.warehouse = { drill_pipe: 240, casing: 180, cement: 4200, drilling_mud: 1600, barite: 38, drill_bit: 6, proppant: 1200, chemicals: 90, spare_parts: 14, steel: 60, crude_oil: 500 };
  for (const s of SUPPLY_IDS) c.warehouse[s] ??= 0;

  // ---- contracts --------------------------------------------------------------------------------
  const ct = (status: Contract['status'], title: string, client: string, commodity: string, qty: number, prem: number, days: number, delivered = 0, minRep = 30): Contract => ({
    id: id('c'), client, title, commodity, quantity: qty, delivered, pricePerUnit: (st.market.prices[commodity] ?? 50) * prem, bonus: Math.round(qty * 3), penalty: Math.round(qty * 5),
    offeredDay: DAY - 3, deadlineDay: DAY + days, status, minReputation: minRep,
  });
  st.contracts = {
    offers: [
      ct('offered', 'Winter crude supply', 'Gulfstream Refining', 'crude_oil', 25000, 1.08, 20),
      ct('offered', 'Power plant feedgas', 'Lone Star Utilities', 'dry_gas', 400000, 1.12, 30),
      ct('offered', 'Premium gasoline blendstock', 'Apex Fuels', 'gasoline', 8000, 1.15, 14, 0, 70),
      ct('offered', 'Petrochemical feed', 'Nova Chemicals', 'ngl', 12000, 1.05, 25),
    ],
    active: [
      ct('active', 'Pipeline nomination', 'Midland Midstream', 'crude_oil', 40000, 1.06, 12, 26400),
      ct('active', 'Municipal heating gas', 'City of Red River', 'dry_gas', 250000, 1.1, 3, 118000),
      ct('active', 'NGL export cargo', 'Harbor Trading', 'ngl', 5000, 1.04, 22, 900),
    ],
    completed: [
      { ...ct('completed', 'First oil offtake', 'Gulfstream Refining', 'crude_oil', 10000, 1.05, -30, 10000), deadlineDay: DAY - 30 },
      { ...ct('failed', 'Rush delivery', 'Apex Fuels', 'crude_oil', 15000, 1.2, -12, 9100), deadlineDay: DAY - 12 },
      { ...ct('completed', 'Gas sales agreement', 'Lone Star Utilities', 'dry_gas', 120000, 1.08, -5, 120000), deadlineDay: DAY - 5 },
      { ...ct('expired', 'Asphalt for highway', 'State DOT', 'asphalt', 2000, 1.1, -40), deadlineDay: DAY - 40 },
    ],
  };

  // ---- finance history ----------------------------------------------------------------------------
  const hist: DailyFinance[] = [];
  for (let d = DAY - 200; d < DAY; d++) {
    const t = (d - (DAY - 200)) / 200;
    const sales = Math.max(0, 60_000 + t * 420_000 + rnd(-40_000, 40_000));
    const byCategory: Partial<Record<LedgerCategory, number>> = {
      sales, contracts: R() > 0.8 ? rnd(40_000, 200_000) : 0,
      drilling: -rnd(40_000, 160_000), opex: -rnd(30_000, 60_000), wages: -rnd(10_000, 16_000), construction: R() > 0.7 ? -rnd(100_000, 900_000) : 0,
      royalties: -sales * 0.125, research: -rnd(1000, 5000), supplies: -rnd(3000, 30_000), interest: -rnd(800, 2400), fuel: -rnd(2000, 9000),
      fines: R() > 0.93 ? -rnd(20_000, 120_000) : 0, transport: -rnd(4000, 16000),
    };
    let revenue = 0;
    let expenses = 0;
    for (const v of Object.values(byCategory)) (v! >= 0 ? (revenue += v!) : (expenses -= v!));
    hist.push({ day: d, revenue, expenses, byCategory, production: { crude_oil: 2000 + t * 4200, natural_gas: 1400 + t * 5000, produced_water: 300 + t * 2000 } });
  }
  c.history = hist;
  c.today = { day: DAY, revenue: 312_400, expenses: 188_900, byCategory: { sales: 302_400, contracts: 10_000, drilling: -92_000, opex: -41_000, wages: -13_800, royalties: -37_800, supplies: -4300 }, production: { crude_oil: 4680, natural_gas: 5100 } };
  const notes: [LedgerCategory, string, number][] = [
    ['sales', 'Crude sold at Truck Loading Rack', 161_000], ['sales', 'Dry gas via Gas Sales Meter', 104_600], ['drilling', 'Eagle 7-H day rate', -38_000],
    ['wages', 'Daily payroll (30 workers)', -13_800], ['royalties', 'Royalty — parcel 6,7', -12_400], ['supplies', 'Drilling mud (120 bbl)', -7200],
    ['construction', 'Crude Distillation Unit progress', -410_000], ['contracts', 'Delivery — Midland Midstream', 88_000], ['opex', 'Facility operating costs', -41_000],
    ['fines', 'Venting violation — Eagle 2', -45_000], ['research', 'Research lab consumables', -2500], ['leases', 'Lease parcel 8,6', -380_000], ['loan', 'Loan drawdown', 2_000_000],
  ];
  for (let i = 0; i < 60; i++) {
    const [cat, note, amt] = notes[i % notes.length];
    c.ledger.push({ day: DAY - Math.floor((60 - i) / 5), minute: Math.floor(rnd(0, 1439)), amount: amt * rnd(0.8, 1.2), category: cat, note });
  }
  c.loans = [
    { id: 'l1', principal: 5_000_000, balance: 3_620_000, rate: 0.07, takenDay: 60, termDays: 365, dailyPayment: 14_800 },
    { id: 'l2', principal: 2_000_000, balance: 1_950_000, rate: 0.08, takenDay: DAY - 5, termDays: 180, dailyPayment: 12_100 },
  ];
  st.stats.companyValueHistory = hist.map((h, i) => 8e6 + i * 90_000 + rnd(-3e5, 3e5));
  st.stats.totalOil = 1_240_000;
  st.stats.totalGas = 2_100_000;
  st.stats.wellsDrilled = 16;
  st.stats.dryHoles = 1;
  st.stats.blowouts = 1;

  // ---- leases, surveys, reservoirs --------------------------------------------------------------
  for (const [px, pz] of [[5, 6], [6, 6], [6, 7], [7, 7], [5, 7], [7, 6], [8, 6], [8, 7], [9, 5], [4, 10], [5, 10], [8, 9], [13, 7], [13, 8]]) {
    st.leases[`${px},${pz}`] = { px, pz, owner: 'p1', acquiredDay: Math.floor(rnd(1, 200)), price: rnd(1e5, 6e5), royalty: 0.125 };
  }
  const sv = (kind: '2d' | '3d', x0: number, z0: number, x1: number, z1: number, status: 'in_progress' | 'processing' | 'complete', progress: number, name: string) => {
    const s = { id: id('s'), kind, x0, z0, x1, z1, status, progress, quality: 1.2, fluidIndicators: kind === '3d', startedDay: DAY - 40, completedDay: status === 'complete' ? DAY - 20 : undefined, cost: kind === '3d' ? 2.4e6 : 380_000, name };
    st.surveys[s.id] = s;
  };
  sv('2d', 120, 240, 330, 240, 'complete', 1, 'Line EW-1');
  sv('2d', 210, 140, 210, 380, 'complete', 1, 'Line NS-2');
  sv('3d', 180, 200, 260, 290, 'complete', 1, 'Eagle 3D');
  sv('2d', 380, 180, 500, 320, 'in_progress', 0.42, 'Gulf Line G-1');
  st.reservoirs = {
    r1: { id: 'r1', discovered: true, knowledge: 0.9, pressure: 3420, cumulative: { oil: 1.1e6, gas: 1.4e6, water: 2e5 }, injected: { water: 3e5, gas: 0, co2: 0 }, remainingOil: 12e6, remainingGas: 8e6, waterFrontY: 36 },
    r2: { id: 'r2', discovered: true, knowledge: 0.55, pressure: 2980, cumulative: { oil: 1.4e5, gas: 9e4, water: 1e4 }, injected: { water: 0, gas: 0, co2: 0 }, remainingOil: 6e6, remainingGas: 2e6, waterFrontY: 24 },
    r3: { id: 'r3', discovered: true, knowledge: 0.35, pressure: 4100, cumulative: { oil: 0, gas: 0, water: 0 }, injected: { water: 0, gas: 0, co2: 0 }, remainingOil: 0, remainingGas: 60e6, waterFrontY: 47 },
    r4: { id: 'r4', discovered: false, knowledge: 0.1, pressure: 5200, cumulative: { oil: 0, gas: 0, water: 0 }, injected: { water: 0, gas: 0, co2: 0 }, remainingOil: 20e6, remainingGas: 10e6, waterFrontY: 16 },
  };

  // ---- networks -----------------------------------------------------------------------------------
  st.networks = {
    n1: { id: 'n1', category: 'oil', pipeCount: 84, buildings: [tank1.id, tank2.id, tankL.id, truck.id, ...wellHeads.map((w) => w.id)], linepack: { crude_oil: 640 }, capacity: 12000, flow: 5200, boosters: 1, anchor: { x: 230, y: 70, z: 230 } },
    n2: { id: 'n2', category: 'gas', pipeCount: 66, buildings: [sphere.id, gasPlant.id, meter.id, turbine.id], linepack: { natural_gas: 2400, dry_gas: 800 }, capacity: 60000, flow: 21000, boosters: 0, anchor: { x: 250, y: 70, z: 220 } },
  };

  // ---- environment, weather, power -------------------------------------------------------------
  st.environment = { score: 58, emissionsToday: 412, emissionsTotal: 38_400, flaredToday: 2300, ventedToday: 180, spills: [
    { id: 'sp1', x: tank2.x, y: tank2.y, z: tank2.z, volume: 120, cleaned: 80, day: DAY - 3, kind: 'oil' },
    { id: 'sp2', x: pit.x, y: pit.y, z: pit.z, volume: 400, cleaned: 400, day: DAY - 22, kind: 'water' },
    { id: 'sp3', x: blow.x, y: blow.surfaceY, z: blow.z, volume: 1800, cleaned: 150, day: DAY, kind: 'oil' },
  ], finesTotal: 185_000, carbonCredits: 1200, violations: 1 };
  st.weather = { current: 'rain', intensity: 0.6, temperature: 14, windSpeed: 9, windDir: 2.2, cloudCover: 0.85, precipitation: 0.6, season: 'autumn', nextChangeMinute: 0,
    forecast: [
      { day: DAY + 1, kind: 'storm', tempHigh: 16, tempLow: 9, wind: 16 }, { day: DAY + 2, kind: 'cloudy', tempHigh: 18, tempLow: 8, wind: 6 },
      { day: DAY + 3, kind: 'clear', tempHigh: 21, tempLow: 10, wind: 4 }, { day: DAY + 4, kind: 'fog', tempHigh: 15, tempLow: 7, wind: 2 },
    ] };
  st.power = { generation: 31.2, demand: 26.4, satisfaction: 1, gridImport: 0 };

  // ---- objectives ---------------------------------------------------------------------------------
  st.objectives = {
    chapter: 2, tutorialStep: 6, tutorialDone: false, achievements: ['first_oil', 'wildcatter', 'gas_man', 'first_contract', 'safety_first'],
    list: [
      { id: 'o1', chapter: 1, title: 'Shoot your first seismic line', description: 'Open the map and survey a 2D seismic line.', progress: 1, target: 1, reward: 50_000, done: true, claimed: true },
      { id: 'o2', chapter: 1, title: 'Drill an exploration well', description: 'Plan and spud a well from your land rig.', progress: 1, target: 1, reward: 100_000, done: true, claimed: true },
      { id: 'o3', chapter: 2, title: 'Produce 50,000 bbl of crude', description: 'Complete wells and connect them to storage with crude pipelines.', progress: 50_000, target: 50_000, reward: 250_000, done: true, claimed: false },
      { id: 'o4', chapter: 2, title: 'Build a gas processing plant', description: 'Turn raw gas into pipeline-quality dry gas and NGLs. Research Gas Processing first.', progress: 1, target: 1, reward: 150_000, done: true, claimed: true },
      { id: 'o5', chapter: 2, title: 'Reach 5,000 bbl/d oil production', description: 'Drill more development wells or install artificial lift on declining wells.', progress: 3680, target: 5000, reward: 400_000, done: false, claimed: false },
      { id: 'o6', chapter: 2, title: 'Complete 3 delivery contracts', description: 'Accept contracts in the Contracts panel and deliver on time.', progress: 2, target: 3, reward: 300_000, done: false, claimed: false },
      { id: 'o7', chapter: 2, title: 'Keep environment score above 60', description: 'Build flares, avoid venting and clean up spills.', progress: 58, target: 60, reward: 200_000, done: false, claimed: false },
      { id: 'o8', chapter: 3, title: 'Build a refinery', description: 'Research Crude Distillation and build a refinery.', progress: 0, target: 1, reward: 500_000, done: false, claimed: false },
    ],
  };

  // ---- notifications ------------------------------------------------------------------------------
  const N: [Notification['level'], string, string][] = [
    ['danger', 'Blowout at Eagle 5', 'Uncontrolled flow — the well is on fire.'],
    ['danger', 'Fire at Fire Station', 'Firefighters are responding.'],
    ['warning', 'Kick detected on Eagle 4', 'Pit gain 24 bbl. Choose a well-control method.'],
    ['success', 'Discovery! Eagle Sand A', 'Eagle 6 encountered 22 m of oil pay.'],
    ['info', 'New contract offer', 'Gulfstream Refining wants 25,000 bbl of crude.'],
    ['success', 'Research complete: Gas Compression', 'Compressor stations are now available.'],
    ['warning', 'Compressor Station has no power', 'Build more generation or reduce demand.'],
    ['info', 'Market event: OPEC+ cut', 'Crude prices firm on supply cut.'],
    ['warning', 'Disposal well broken', 'Produced water is backing up.'],
    ['success', 'Contract completed', 'Gas sales agreement delivered. Bonus paid.'],
  ];
  st.notifications = [];
  for (let i = 0; i < 30; i++) {
    const [level, title, text] = N[i % N.length];
    st.notifications.push({ id: `n${i}`, day: DAY - Math.floor((30 - i) / 4), minute: Math.floor(rnd(0, 1439)), level, title, text, read: i < 24, at: i % 3 === 0 ? { x: 230, y: 70, z: 240 } : undefined });
  }

  // ---- player -------------------------------------------------------------------------------------
  const p = st.players.p1;
  p.health = 82;
  p.selectedSlot = 2;
  p.yaw = -0.7;
  p.inventory[15] = { item: blockItemId(B.STEEL_PLATE), count: 48 };
  p.inventory[16] = { item: blockItemId(B.HAZARD_STRIPE), count: 22 };
  p.inventory[18] = { item: blockItemId(B.BRICK), count: 64 };
  p.inventory[20] = { item: blockItemId(B.GLASS), count: 12 };
  p.inventory[22] = { item: blockItemId(B.GRASS), count: 5 };
  p.inventory[23] = { item: blockItemId(B.SANDSTONE), count: 30 };
  p.inventory[25] = { item: blockItemId(B.OIL_SANDSTONE), count: 3 };
  p.inventory[27] = { item: blockItemId(B.CONTAINER_RED), count: 2 };
  p.inventory[29] = { item: blockItemId(B.FLOWER_RED), count: 7 };
  return st;
}

/** Simple trajectory generator shared with the mock wells service. */
export function trajectory(x: number, surfaceY: number, z: number, plan: WellPlan): Vec3[] {
  const pts: Vec3[] = [];
  const az = plan.azimuth ?? 0;
  const ko = plan.kind === 'vertical' ? plan.targetY : Math.max(plan.targetY + 2, plan.kickoffY ?? plan.targetY + 12);
  for (let y = surfaceY; y >= ko; y--) pts.push({ x, y, z });
  if (plan.kind === 'directional') {
    const off = plan.offset ?? 15;
    const steps = ko - plan.targetY;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const d = off * (1 - Math.cos((t * Math.PI) / 2));
      pts.push({ x: x + Math.cos(az) * d, y: ko - i, z: z + Math.sin(az) * d });
    }
  } else if (plan.kind === 'horizontal') {
    const rad = ko - plan.targetY;
    for (let i = 1; i <= 12; i++) {
      const a = (i / 12) * (Math.PI / 2);
      const d = rad * (1 - Math.cos(a));
      pts.push({ x: x + Math.cos(az) * Math.sin(a) * rad, y: ko - rad * Math.sin(a) + 0 * d, z: z + Math.sin(az) * Math.sin(a) * rad });
    }
    const last = pts[pts.length - 1];
    for (let i = 1; i <= (plan.lateralLength ?? 30); i++) pts.push({ x: last.x + Math.cos(az) * i, y: plan.targetY, z: last.z + Math.sin(az) * i });
  }
  return pts;
}
