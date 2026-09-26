// A cheap one-pass summary of the company used to evaluate objectives and achievements.
import type { GameContext, GameState, WellStatus } from '../../core/types';
import { RIG_TYPES } from '../../core/buildingUtil';
import { economyState } from './ext';
import { ownsLeaseAt } from './leases';

const REACHED_TD: WellStatus[] = ['drilled', 'completing', 'fracking', 'producing', 'injecting', 'shut_in', 'dry_hole'];
const SPUDDED_NOT: WellStatus[] = ['planned'];

export interface Snapshot {
  s: GameState;
  counters: Record<string, number>;
  sold: Record<string, number>;
  salesRevenue: number;
  netWorth: number;
  /** Fully constructed (not destroyed) buildings by type. */
  built: Record<string, number>;
  /** Best construction progress of a rig standing on a leased parcel (0..1). */
  rigOnLease: number;
  surveyProgress: number;
  surveysDone: number;
  wellsSpudded: number;
  bestDrillFraction: number;
  wellsReachedTD: number;
  wellsProducing: number;
  offshoreProducing: number;
  offshoreCumOil: number;
  cumOil: number;
  maxOilRate: number;
  dryHoles: number;
  tankBuilt: boolean;
  tankConnected: boolean;
  contractsCompleted: number;
  techsResearched: number;
}

export function takeSnapshot(ctx: GameContext, netWorth: number): Snapshot {
  const s = ctx.state;
  const ext = economyState(s);
  const built: Record<string, number> = {};
  let rigOnLease = 0;
  for (const b of Object.values(s.buildings)) {
    if (b.status === 'destroyed') continue;
    if (b.constructionProgress >= 1) built[b.type] = (built[b.type] ?? 0) + 1;
    if (RIG_TYPES.has(b.type) && ownsLeaseAt(s, b.x + b.size[0] / 2, b.z + b.size[1] / 2)) rigOnLease = Math.max(rigOnLease, Math.min(1, b.constructionProgress));
  }
  let surveyProgress = 0;
  let surveysDone = 0;
  for (const sv of Object.values(s.surveys)) {
    if (sv.status === 'complete') {
      surveysDone++;
      surveyProgress = 1;
    } else surveyProgress = Math.max(surveyProgress, Math.min(0.99, sv.progress));
  }
  let wellsSpudded = 0, bestDrillFraction = 0, wellsReachedTD = 0, wellsProducing = 0, offshoreProducing = 0, offshoreCumOil = 0, cumOil = 0, maxOilRate = 0, dryHoles = 0;
  for (const w of Object.values(s.wells)) {
    if (!SPUDDED_NOT.includes(w.status)) wellsSpudded++;
    if (REACHED_TD.includes(w.status) || (w.status === 'plugged' && w.measuredDepth >= w.plannedDepth * 0.95)) wellsReachedTD++;
    else if (w.plannedDepth > 0 && w.status !== 'planned') bestDrillFraction = Math.max(bestDrillFraction, Math.min(0.99, w.measuredDepth / w.plannedDepth));
    if (w.status === 'producing') {
      wellsProducing++;
      if (w.offshore) offshoreProducing++;
    }
    if (w.status === 'dry_hole') dryHoles++;
    cumOil += Math.max(0, w.cumulative.oil);
    if (w.offshore) offshoreCumOil += Math.max(0, w.cumulative.oil);
    if (w.status === 'producing') maxOilRate = Math.max(maxOilRate, w.rates.oil);
  }
  let tankConnected = false;
  const tankBuilt = (built.oil_tank_small ?? 0) + (built.oil_tank_large ?? 0) > 0;
  if (tankBuilt) {
    for (const n of Object.values(s.networks)) {
      if (n.category !== 'oil') continue;
      let tank = false, head = false;
      for (const id of n.buildings) {
        const t = s.buildings[id]?.type;
        if (t === 'oil_tank_small' || t === 'oil_tank_large') tank = true;
        else if (t === 'wellhead' || t === 'production_platform') head = true;
      }
      if (tank && head) {
        tankConnected = true;
        break;
      }
    }
  }
  return {
    s, counters: ext.objectives.counters, sold: ext.sales.totals, salesRevenue: ext.sales.totalRevenue, netWorth, built, rigOnLease,
    surveyProgress, surveysDone, wellsSpudded, bestDrillFraction, wellsReachedTD, wellsProducing, offshoreProducing, offshoreCumOil,
    cumOil: Math.max(cumOil, s.stats.totalOil), maxOilRate, dryHoles: Math.max(dryHoles, s.stats.dryHoles), tankBuilt, tankConnected,
    contractsCompleted: ext.contracts.completed, techsResearched: s.research.completed.length,
  };
}

export const soldOf = (sn: Snapshot, ...ids: string[]) => ids.reduce((a, id) => a + (sn.sold[id] ?? 0), 0);
export const builtOf = (sn: Snapshot, ...types: string[]) => types.reduce((a, t) => a + (sn.built[t] ?? 0), 0);
