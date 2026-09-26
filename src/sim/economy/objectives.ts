// Campaign objectives (5 chapters) and the chapter-1 guided tutorial. Data exports are imported
// by the UI (CHAPTERS, TUTORIAL_STEPS); progress is tracked here from state, events and commands.
import type { GameContext, Objective } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import type { UiPanelId } from '../../core/EventBus';
import { checkAchievements } from './achievements';
import { economyState } from './ext';
import { builtOf, soldOf, takeSnapshot, type Snapshot } from './snapshot';
import { fmtMoney } from './util';

export interface ObjectiveDef {
  id: string;
  chapter: number;
  title: string;
  description: string;
  /** Short actionable hint (UI tooltip). */
  hint?: string;
  target: number;
  /** Cash reward (claim with 'objective/claim'). */
  reward: number;
  /** Unit label for progress display, e.g. 'bbl'. */
  unit?: string;
  measure(sn: Snapshot): number;
}

export interface ChapterDef {
  id: number;
  title: string;
  subtitle: string;
  description: string;
  objectives: ObjectiveDef[];
}

const tech = (id: string) => (sn: Snapshot) => (sn.s.research.completed.includes(id) ? 1 : 0);
const has = (...types: string[]) => (sn: Snapshot) => Math.min(1, builtOf(sn, ...types));

export const CHAPTERS: ChapterDef[] = [
  {
    id: 1, title: 'Wildcatter', subtitle: 'Chapter 1',
    description: 'A patch of leased prairie, a small crew and a lot of hope. Find oil, drill it, and sell your first barrels.',
    objectives: [
      { id: 'c1_map', chapter: 1, title: 'Get your bearings', target: 1, reward: 25_000,
        description: 'Look around your camp, then open the map to see the basin, your leases and the terrain.', hint: 'Press N to open the map.',
        measure: (sn) => sn.counters.mapOpened ?? 0 },
      { id: 'c1_lease', chapter: 1, title: 'Confirm your lease', target: 1, reward: 25_000,
        description: 'The county granted your company mineral rights on the nine parcels around camp. Review them in the Leases view — or buy an extra parcel.', hint: 'Open the map and switch on the Leases overlay.',
        measure: (sn) => Math.min(1, (sn.counters.leasesViewed ?? 0) + (sn.counters.leasesBought ?? 0)) },
      { id: 'c1_seismic', chapter: 1, title: 'Shoot a 2D seismic line', target: 1, reward: 50_000,
        description: 'Seismic sends sound into the ground and listens for echoes. Shoot a line across your lease and look for bright, arched reflectors — traps.', hint: 'Open the Seismic panel and drag a line across your lease.',
        measure: (sn) => sn.surveyProgress },
      { id: 'c1_rig', chapter: 1, title: 'Raise a derrick', target: 1, reward: 75_000,
        description: 'Build a Land Drilling Rig on your lease, above the structure you found on seismic.', hint: 'Build menu (B) → Drilling → Land Drilling Rig.',
        measure: (sn) => sn.rigOnLease },
      { id: 'c1_spud', chapter: 1, title: 'Spud your first well', target: 1, reward: 50_000,
        description: 'Select the rig, plan a well down to the target and spud it. The planner suggests casing points and a starting mud weight.', hint: 'Click the rig, then Plan Well.',
        measure: (sn) => Math.min(1, sn.wellsSpudded) },
      { id: 'c1_drill', chapter: 1, title: 'Drill to total depth', target: 1, reward: 100_000,
        description: 'Keep the mud weight between pore pressure and fracture pressure: too light and the well kicks, too heavy and you lose returns. Reach TD.', hint: 'Watch the pressure window in the well panel and adjust mud weight.',
        measure: (sn) => (sn.wellsReachedTD > 0 ? 1 : sn.bestDrillFraction) },
      { id: 'c1_complete', chapter: 1, title: 'Complete the well', target: 1, reward: 150_000,
        description: 'Perforate the pay zone and bring the well on production. A wellhead will appear at the surface.', hint: 'In the well panel choose Complete Well.',
        measure: (sn) => Math.min(1, sn.wellsProducing) },
      { id: 'c1_tank', chapter: 1, title: 'Store your crude', target: 2, reward: 75_000,
        description: 'Build a Storage Tank and connect it to the wellhead with a crude pipeline, so the well can keep flowing.', hint: 'Build → Storage → Storage Tank, then place Crude Pipeline blocks (P) between them.',
        measure: (sn) => (sn.tankBuilt ? 1 : 0) + (sn.tankConnected ? 1 : 0) },
      { id: 'c1_sell', chapter: 1, title: 'First sale', target: 500, reward: 150_000, unit: 'bbl',
        description: 'Build a Truck Loading Rack, pipe crude into it and sell 500 barrels. Trucks sell automatically at market price.', hint: 'Build → Logistics → Truck Loading Rack. Check auto-sell in the Market panel (M).',
        measure: (sn) => soldOf(sn, 'crude_oil', 'condensate') },
      { id: 'c1_hire', chapter: 1, title: 'Hire more hands', target: 1, reward: 25_000,
        description: 'Your loading rack needs four truckers to run at full speed. Hire more crew from the candidate pool.', hint: 'Open Workforce (H) and hire a trucker.',
        measure: (sn) => sn.counters.hires ?? 0 },
      { id: 'c1_research', chapter: 1, title: 'Invest in knowledge', target: 1, reward: 50_000,
        description: 'Start a research project. Beam Pumps keep old wells flowing; Wireline Logging shows you what you drilled through.', hint: 'Open Research (T) and pick a technology.',
        measure: (sn) => Math.min(1, (sn.counters.researchStarted ?? 0) + (sn.s.research.current ? 1 : 0)) },
    ],
  },
  {
    id: 2, title: 'Gas & Midstream', subtitle: 'Chapter 2',
    description: 'Every oil well brings gas with it. Flare it, sell it — or process it into something far more valuable.',
    objectives: [
      { id: 'c2_flare', chapter: 2, title: 'Deal with associated gas', target: 1, reward: 100_000,
        description: 'Venting raw gas angers the regulator. Build a Flare Stack or pipe the gas to a Gas Sales Meter.', hint: 'Build → Production → Flare Stack, connected with a gas pipeline.',
        measure: has('flare_stack', 'gas_sales_meter') },
      { id: 'c2_gas_sale', chapter: 2, title: 'Sell gas', target: 20_000, reward: 200_000, unit: 'mcf',
        description: 'Sell 20,000 mcf of gas through a Gas Sales Meter. Raw gas fetches 70% of the dry-gas price.',
        measure: (sn) => soldOf(sn, 'natural_gas', 'dry_gas') },
      { id: 'c2_research_gp', chapter: 2, title: 'Research Gas Processing', target: 1, reward: 150_000,
        description: 'Learn to strip liquids and sulfur from raw gas.', measure: tech('gas_processing') },
      { id: 'c2_gas_plant', chapter: 2, title: 'Build a Gas Processing Plant', target: 1, reward: 400_000,
        description: 'Raw gas in; pipeline-quality dry gas, NGLs and condensate out.', measure: has('gas_plant') },
      { id: 'c2_compressor', chapter: 2, title: 'Boost the pressure', target: 1, reward: 200_000,
        description: 'Research Gas Compression and build a Compressor Station to push gas through long lines.', measure: has('compressor_station') },
      { id: 'c2_dry_gas', chapter: 2, title: 'Pipeline-quality gas', target: 100_000, reward: 500_000, unit: 'mcf',
        description: 'Sell 100,000 mcf of processed dry gas.', measure: (sn) => soldOf(sn, 'dry_gas') },
      { id: 'c2_liquids', chapter: 2, title: 'Liquids rich', target: 2_000, reward: 250_000, unit: 'bbl',
        description: 'Sell 2,000 bbl of NGLs, LPG or condensate.', measure: (sn) => soldOf(sn, 'ngl', 'lpg', 'condensate') },
      { id: 'c2_networth', chapter: 2, title: 'Mid-sized operator', target: 10_000_000, reward: 750_000, unit: '$',
        description: 'Reach a company net worth of $10M.', measure: (sn) => Math.max(0, sn.netWorth) },
    ],
  },
  {
    id: 3, title: 'Downstream', subtitle: 'Chapter 3',
    description: 'Crude is cheap; fuels are not. Build a refinery and sell gasoline, diesel and jet fuel under contract.',
    objectives: [
      { id: 'c3_research', chapter: 3, title: 'Research Crude Distillation', target: 1, reward: 300_000, description: 'Unlock the atmospheric distillation unit.', measure: tech('refining') },
      { id: 'c3_refinery', chapter: 3, title: 'Build a refinery', target: 1, reward: 1_000_000, description: 'Build a Crude Distillation Unit and feed it crude by pipeline.', measure: has('refinery') },
      { id: 'c3_fuels', chapter: 3, title: 'Fuel the region', target: 25_000, reward: 1_000_000, unit: 'bbl', description: 'Sell 25,000 bbl of gasoline, diesel and jet fuel.', measure: (sn) => soldOf(sn, 'gasoline', 'diesel', 'jet_fuel') },
      { id: 'c3_contracts', chapter: 3, title: 'Trusted supplier', target: 3, reward: 750_000, description: 'Fulfil three supply contracts.', measure: (sn) => sn.contractsCompleted },
      { id: 'c3_rail', chapter: 3, title: 'Unit trains', target: 1, reward: 750_000, description: 'Research Rail Logistics and build a Rail Terminal for cheap bulk shipping.', measure: has('rail_terminal') },
      { id: 'c3_fcc', chapter: 3, title: 'Upgrade the barrel', target: 1, reward: 1_500_000, description: 'Build a Fluid Catalytic Cracker to turn heavy residue into gasoline.', measure: has('fcc_unit') },
      { id: 'c3_networth', chapter: 3, title: 'Integrated oil company', target: 40_000_000, reward: 2_000_000, unit: '$', description: 'Reach a net worth of $40M.', measure: (sn) => Math.max(0, sn.netWorth) },
    ],
  },
  {
    id: 4, title: 'Offshore', subtitle: 'Chapter 4',
    description: 'The biggest fields lie under the sea. Jack-ups, platforms and helicopters — and hurricanes.',
    objectives: [
      { id: 'c4_research', chapter: 4, title: 'Research Shallow-Water Offshore', target: 1, reward: 500_000, description: 'Unlock jack-up rigs, platforms and helipads.', measure: tech('offshore_shallow') },
      { id: 'c4_helipad', chapter: 4, title: 'Crew change', target: 1, reward: 500_000, description: 'Build a Helipad so crews can reach offshore installations.', measure: has('helipad') },
      { id: 'c4_jackup', chapter: 4, title: 'Jack it up', target: 1, reward: 2_000_000, description: 'Build a Jack-up Rig over an offshore prospect.', measure: has('jackup_rig', 'semi_sub_rig') },
      { id: 'c4_platform', chapter: 4, title: 'Steel in the sea', target: 1, reward: 3_000_000, description: 'Build a Production Platform to collect offshore wells.', measure: has('production_platform', 'fpso') },
      { id: 'c4_offshore_well', chapter: 4, title: 'First offshore oil', target: 1, reward: 2_000_000, description: 'Bring an offshore well on production.', measure: (sn) => Math.min(1, sn.offshoreProducing) },
      { id: 'c4_offshore_prod', chapter: 4, title: 'Offshore barrels', target: 100_000, reward: 4_000_000, unit: 'bbl', description: 'Produce 100,000 bbl from offshore wells.', measure: (sn) => sn.offshoreCumOil },
      { id: 'c4_export', chapter: 4, title: 'World markets', target: 1, reward: 3_000_000, description: 'Build a Marine Export Terminal and sell at world prices.', measure: has('export_terminal') },
      { id: 'c4_networth', chapter: 4, title: 'Major', target: 100_000_000, reward: 5_000_000, unit: '$', description: 'Reach a net worth of $100M.', measure: (sn) => Math.max(0, sn.netWorth) },
    ],
  },
  {
    id: 5, title: 'Petrochemical Empire', subtitle: 'Chapter 5',
    description: 'Turn molecules into materials. Crackers, polymer plants and an empire worth a quarter of a billion.',
    objectives: [
      { id: 'c5_research', chapter: 5, title: 'Research Steam Cracking', target: 1, reward: 2_000_000, description: 'Unlock the steam cracker.', measure: tech('petrochemicals') },
      { id: 'c5_cracker', chapter: 5, title: '850 °C', target: 1, reward: 5_000_000, description: 'Build a Steam Cracker and crack NGLs into olefins.', measure: has('steam_cracker') },
      { id: 'c5_polymers', chapter: 5, title: 'Pellets', target: 1, reward: 5_000_000, description: 'Build a Polymer Plant.', measure: has('polymer_plant') },
      { id: 'c5_sell_poly', chapter: 5, title: 'Plastics giant', target: 10_000, reward: 5_000_000, unit: 't', description: 'Sell 10,000 t of polyethylene and polypropylene.', measure: (sn) => soldOf(sn, 'polyethylene', 'polypropylene') },
      { id: 'c5_chemicals', chapter: 5, title: 'Gas to chemicals', target: 5_000, reward: 4_000_000, unit: 't', description: 'Sell 5,000 t of ammonia or methanol.', measure: (sn) => soldOf(sn, 'ammonia', 'methanol') },
      { id: 'c5_green', chapter: 5, title: 'Responsible operator', target: 1, reward: 5_000_000, description: 'Operate a Carbon Capture Unit with an environmental score of 75 or better.', measure: (sn) => (builtOf(sn, 'ccs_unit') > 0 && sn.s.environment.score >= 75 ? 1 : 0) },
      { id: 'c5_networth', chapter: 5, title: 'Petrochemical empire', target: 250_000_000, reward: 25_000_000, unit: '$', description: 'Reach a net worth of $250M.', measure: (sn) => Math.max(0, sn.netWorth) },
    ],
  },
];

export const OBJECTIVE_DEFS: Record<string, ObjectiveDef> = Object.fromEntries(CHAPTERS.flatMap((c) => c.objectives).map((o) => [o.id, o]));

export interface TutorialStep {
  objectiveId: string;
  title: string;
  /** Longer instructional text for the tutorial card. */
  text: string;
  /** Panel the UI may highlight/open for this step. */
  panel?: UiPanelId;
  /** Keybind action name (settings.keybinds key) to show as a key cap. */
  key?: string;
}

/** Chapter 1 guided steps, in order. `state.objectives.tutorialStep` indexes this array. */
export const TUTORIAL_STEPS: TutorialStep[] = [
  { objectiveId: 'c1_map', title: 'Welcome, wildcatter', panel: 'map', key: 'map',
    text: 'You run a small oil company with a field office, ten hands and a few million dollars. Walk around with WASD, look with the mouse — then press N to open the map.' },
  { objectiveId: 'c1_lease', title: 'Your mineral rights', panel: 'leases', key: 'map',
    text: 'You may only drill on parcels you lease. The county granted you the nine parcels around camp. Turn on the Leases overlay on the map to see them — stars show how prospective a parcel looks.' },
  { objectiveId: 'c1_seismic', title: 'Look underground', panel: 'seismic',
    text: 'Oil hides in traps: domes, faults and pinch-outs capped by tight rock. Shoot a 2D seismic line across your lease; bright arched reflectors are what you want.' },
  { objectiveId: 'c1_rig', title: 'Raise a derrick', panel: 'build', key: 'build',
    text: 'Open the build menu (B), pick the Land Drilling Rig and place it on your lease above the trap. Construction takes a few hours with your crew.' },
  { objectiveId: 'c1_spud', title: 'Plan and spud', panel: 'wellPlanner',
    text: 'Select the rig and plan a well. Set the target depth below the trap; the planner proposes casing points to protect fresh water and a mud weight. Then spud it!' },
  { objectiveId: 'c1_drill', title: 'Mind the mud', panel: 'wells', key: 'wells',
    text: 'While drilling, keep the mud weight inside the window: above pore pressure (or the well kicks) but below fracture pressure (or you lose returns). Gas shows mean you are close.' },
  { objectiveId: 'c1_complete', title: 'Complete the well', panel: 'wells', key: 'wells',
    text: 'At total depth, complete the well across the pay zone. A wellhead appears and starts filling with oil, gas and water.' },
  { objectiveId: 'c1_tank', title: 'Pipe it to storage', panel: 'build', key: 'pipeMode',
    text: 'Build a Storage Tank near the wellhead and connect them with Crude Pipeline blocks (P for pipe mode). A full wellhead chokes back production.' },
  { objectiveId: 'c1_sell', title: 'Truck it to market', panel: 'market', key: 'market',
    text: 'Build a Truck Loading Rack and pipe crude into it. It sells automatically at the market price (see the Market panel, M). Contracts pay more — check the Contracts board (K).' },
  { objectiveId: 'c1_hire', title: 'Grow the crew', panel: 'workforce', key: 'workforce',
    text: 'The loading rack needs four truckers for full speed and every new facility needs crew. Hire from the candidate pool (H). Watch housing and morale.' },
  { objectiveId: 'c1_research', title: 'Research', panel: 'research', key: 'research',
    text: 'Research unlocks better rigs, gas processing, refining and more. Start a project (T). A Research Lab speeds things up enormously.' },
];

// ---- Tracking -------------------------------------------------------------------------------------

function toObjective(d: ObjectiveDef): Objective {
  return { id: d.id, title: d.title, description: d.description, progress: 0, target: d.target, reward: d.reward, done: false, claimed: false, chapter: d.chapter };
}

function ensureChapter(ctx: GameContext, chapter: number) {
  const s = ctx.state;
  const ch = CHAPTERS.find((c) => c.id === chapter);
  if (!ch) return;
  for (const d of ch.objectives) if (!s.objectives.list.some((o) => o.id === d.id)) s.objectives.list.push(toObjective(d));
}

export function initObjectives(ctx: GameContext, isNew: boolean) {
  const s = ctx.state;
  const o = s.objectives;
  o.list ??= [];
  o.achievements ??= [];
  o.chapter = Math.max(1, Math.min(CHAPTERS.length, o.chapter || 1));
  if (isNew) o.tutorialDone = !s.meta.rules.tutorial;
  for (let c = 1; c <= o.chapter; c++) ensureChapter(ctx, c);
  // Refresh static text from definitions (keeps old saves in sync with data changes).
  for (const obj of o.list) {
    const d = OBJECTIVE_DEFS[obj.id];
    if (d) {
      obj.title = d.title;
      obj.description = d.description;
      obj.target = d.target;
      obj.reward = d.reward;
    }
  }
}

export function evaluateObjectives(ctx: GameContext, netWorth: number) {
  const s = ctx.state;
  const sn = takeSnapshot(ctx, netWorth);
  for (const obj of s.objectives.list) {
    if (obj.done) continue;
    const d = OBJECTIVE_DEFS[obj.id];
    if (!d) continue;
    obj.progress = Math.max(0, Math.min(d.target, d.measure(sn)));
    if (obj.progress >= d.target) {
      obj.done = true;
      obj.progress = d.target;
      ctx.bus.emit('objective:completed', { id: obj.id });
      ctx.notify('success', `Objective complete: ${obj.title}`, obj.reward > 0 ? `Claim your ${fmtMoney(obj.reward)} reward in the Objectives panel.` : undefined);
    }
  }
  // Tutorial pointer = first unfinished chapter-1 step.
  const step = TUTORIAL_STEPS.findIndex((t) => !s.objectives.list.find((o) => o.id === t.objectiveId)?.done);
  s.objectives.tutorialStep = step < 0 ? TUTORIAL_STEPS.length : step;
  if (step < 0 && !s.objectives.tutorialDone) {
    s.objectives.tutorialDone = true;
    ctx.notify('success', 'Tutorial complete', 'You are a real oil company now. The campaign continues with Chapter 2: Gas & Midstream.');
  }
  // Chapter advance.
  const cur = s.objectives.chapter;
  const chapterDone = s.objectives.list.filter((o) => o.chapter === cur).every((o) => o.done);
  if (chapterDone) {
    if (cur < CHAPTERS.length) {
      s.objectives.chapter = cur + 1;
      ensureChapter(ctx, cur + 1);
      const ch = CHAPTERS[cur];
      ctx.notify('success', `${ch.subtitle}: ${ch.title}`, ch.description);
    } else {
      const c = economyState(s).objectives.counters;
      if (!c.campaignComplete) {
        c.campaignComplete = 1;
        ctx.notify('success', 'Campaign complete!', 'You built a petrochemical empire. The basin is yours — keep growing in free play.');
      }
    }
  }
  checkAchievements(ctx, sn);
}

export function bumpCounter(ctx: GameContext, key: string, n = 1) {
  const c = economyState(ctx.state).objectives.counters;
  c[key] = (c[key] ?? 0) + n;
}

export function cmdClaim(cmd: Command<'objective/claim'>, ctx: GameContext): CommandResult {
  const o = ctx.state.objectives.list.find((x) => x.id === cmd.objectiveId);
  if (!o) return { ok: false, error: 'Unknown objective' };
  if (!o.done) return { ok: false, error: 'Objective not complete yet' };
  if (o.claimed) return { ok: false, error: 'Reward already claimed' };
  o.claimed = true;
  if (o.reward > 0) ctx.transact(o.reward, 'misc', `Objective reward: ${o.title}`);
  return { ok: true, data: { reward: o.reward } };
}
