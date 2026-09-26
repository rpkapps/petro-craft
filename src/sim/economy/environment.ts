// Environment & regulation: daily score from emissions/flaring/venting/spills/incidents, carbon
// credit sales, fines, violations → operating suspension, and reputation drift.
import type { GameContext, GameState, HazardsState } from '../../core/types';
import {
  AQUIFER_FINE, CARBON_CREDIT_PRICE, ENV_NEUTRAL_SCORE, ENV_SUSPENSION_DAYS, ENV_VIOLATION_COOLDOWN_DAYS, ENV_VIOLATION_SCORE,
  ENV_VIOLATIONS_TO_SUSPEND, SPILL_FINE_MIN, SPILL_FINE_PER_BBL, SPILL_GRACE_DAYS, VENTING_FINE_PER_MCF, VENTING_FINE_THRESHOLD,
} from './constants';
import { adjustReputation } from './contracts';
import { economyState, type EconomyRuntime } from './ext';
import { fmtMoney, fmtQty, isWorking } from './util';

type Incident = HazardsState['incidents'][number];

const incidentKey = (i: Incident) => `${i.day}|${i.kind}|${i.text}`;

/** Incidents logged since the cursor (robust to other systems trimming the log from the front). */
export function takeNewIncidents(s: GameState, cursor: { incidentCursor: string }): Incident[] {
  const list = s.hazards.incidents;
  const out: Incident[] = [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (incidentKey(list[i]) === cursor.incidentCursor) break;
    out.push(list[i]);
  }
  if (list.length) cursor.incidentCursor = incidentKey(list[list.length - 1]);
  return out.reverse();
}

const INCIDENT_PENALTY: Record<Incident['kind'], number> = {
  fire: 2, blowout: 5, explosion: 3, spill: 2, failure: 0, injury: 0.5, leak: 1, lightning: 0, h2s: 2,
};

export const isAquiferIncident = (i: Incident) => /aquifer|groundwater|drinking water/i.test(i.text);

/** Is the company currently suspended from starting new wells? (upstream should check this) */
export function operationsSuspended(s: GameState): boolean {
  return (s.environment.suspendedUntilDay ?? 0) > s.time.day;
}

export function environmentNewDay(ctx: GameContext, rt: EconomyRuntime, day: number) {
  const s = ctx.state;
  const env = s.environment;
  const ext = economyState(s).environment;
  const incidents = takeNewIncidents(s, ext);
  const buildings = rt.index.all(s);
  let operating = 0;
  let renewables = 0;
  for (const b of buildings) {
    if (b.constructionProgress < 1 || b.status === 'destroyed') continue;
    operating++;
    if ((b.type === 'solar_farm' || b.type === 'wind_turbine' || b.type === 'ccs_unit') && isWorking(b)) renewables++;
  }

  // ---- Score ----
  const baseline = 30 + 2 * operating;
  const e = Math.max(0, env.emissionsToday);
  let delta = 0;
  const causes: string[] = [];
  if (e > baseline) {
    const d = Math.min(4, (e / baseline - 1) * 2);
    delta -= d;
    if (d >= 0.5) causes.push('emissions');
  }
  if (env.flaredToday > 0) {
    const d = Math.min(3, env.flaredToday / 20_000);
    delta -= d;
    if (d >= 0.5) causes.push('flaring');
  }
  if (env.ventedToday > 0) {
    const d = Math.min(8, env.ventedToday / 2_000);
    delta -= d;
    if (d >= 0.5) causes.push('gas venting');
  }
  let uncleaned = 0;
  for (const sp of env.spills) uncleaned += Math.max(0, sp.volume - sp.cleaned);
  if (uncleaned > 0) {
    const d = Math.min(10, uncleaned / 200);
    delta -= d;
    if (d >= 0.5) causes.push('spills');
  }
  let aquifer = 0;
  for (const i of incidents) {
    delta -= INCIDENT_PENALTY[i.kind] ?? 0;
    if (isAquiferIncident(i)) {
      aquifer++;
      delta -= 6;
      causes.push('groundwater contamination');
    }
  }
  const clean = env.ventedToday < 100 && uncleaned < 1 && e <= baseline && incidents.every((i) => (INCIDENT_PENALTY[i.kind] ?? 0) < 1);
  if (clean) {
    if (env.score < ENV_NEUTRAL_SCORE) delta += Math.min(2.5, (ENV_NEUTRAL_SCORE - env.score) * 0.08 + 0.3);
    else delta += Math.min(1, env.carbonCredits / 200 + renewables * 0.1) - (renewables === 0 && env.carbonCredits <= 0 ? (env.score - ENV_NEUTRAL_SCORE) * 0.01 : 0);
  }
  env.score = Math.max(0, Math.min(100, env.score + delta));
  ext.lastScoreDelta = delta;

  // ---- Carbon credits ----
  if (env.carbonCredits > 0) {
    const income = env.carbonCredits * CARBON_CREDIT_PRICE;
    ctx.transact(income, 'carbon', `Carbon credits: ${fmtQty(env.carbonCredits)} t CO₂e`);
    ext.carbonSold += env.carbonCredits;
    env.carbonCredits = 0;
  }

  // ---- Fines ----
  const fines: string[] = [];
  let total = 0;
  if (env.ventedToday > VENTING_FINE_THRESHOLD) {
    const f = Math.max(10_000, (env.ventedToday - VENTING_FINE_THRESHOLD) * VENTING_FINE_PER_MCF);
    total += f;
    fines.push(`venting ${fmtQty(env.ventedToday)} mcf (${fmtMoney(f)})`);
  }
  const responseBase = rt.index.count(s, 'spill_response', isWorking) > 0;
  let spillFine = 0;
  for (const sp of env.spills) {
    const u = sp.volume - sp.cleaned;
    if (u > 1 && day - sp.day > SPILL_GRACE_DAYS) spillFine += Math.max(SPILL_FINE_MIN, u * SPILL_FINE_PER_BBL);
  }
  if (spillFine > 0) {
    spillFine *= responseBase ? 0.5 : 1;
    total += spillFine;
    fines.push(`uncleaned spills (${fmtMoney(spillFine)})`);
  }
  if (aquifer > 0) {
    total += aquifer * AQUIFER_FINE;
    fines.push(`groundwater contamination (${fmtMoney(aquifer * AQUIFER_FINE)})`);
  }
  ext.lastFines = total;
  if (total > 0) {
    ctx.transact(-total, 'fines', `Regulator fines: ${fines.join(', ')}`);
    env.finesTotal += total;
    ctx.notify('warning', `Regulator fined you ${fmtMoney(total)}`, `For ${fines.join('; ')}.`);
  }

  // ---- Violations & suspension ----
  if (env.suspendedUntilDay !== undefined && env.suspendedUntilDay === day) {
    ctx.notify('success', 'Suspension lifted', 'The regulator has lifted the drilling suspension. Keep it clean.');
  }
  // Violations only for days with fresh harm (a company that has cleaned up is left to recover).
  if (env.score < ENV_VIOLATION_SCORE && delta < 0 && day - ext.lastViolationDay >= ENV_VIOLATION_COOLDOWN_DAYS && !operationsSuspended(s)) {
    env.violations++;
    ext.lastViolationDay = day;
    if (env.violations >= ENV_VIOLATIONS_TO_SUSPEND) {
      env.violations = 0;
      env.suspendedUntilDay = day + ENV_SUSPENSION_DAYS;
      adjustReputation(s, -8);
      ctx.notify('danger', 'OPERATIONS SUSPENDED', `After repeated violations the regulator has suspended new drilling for ${ENV_SUSPENSION_DAYS} days. Stop venting, clean up spills and cut emissions.`);
    } else {
      ctx.notify('danger', `Regulatory violation ${env.violations}/${ENV_VIOLATIONS_TO_SUSPEND}`, `Environmental score ${Math.round(env.score)} is below ${ENV_VIOLATION_SCORE}${causes.length ? ` (${[...new Set(causes)].join(', ')})` : ''}. At ${ENV_VIOLATIONS_TO_SUSPEND} violations operations are suspended.`);
    }
  } else if (env.score < 45 && delta < -2 && day - ext.lastComplaintDay >= 5) {
    ext.lastComplaintDay = day;
    ctx.notify('warning', 'Community complaints', `Environmental score fell to ${Math.round(env.score)}${causes.length ? ` because of ${[...new Set(causes)].join(', ')}` : ''}.`);
  }

  // ---- Reputation drift (environment + contract record) ----
  const hist = economyState(s).contracts.history.filter((h) => h.day >= day - 60);
  const contractTerm = Math.max(-20, Math.min(20, hist.reduce((a, h) => a + (h.ok ? 3 : -5), 0)));
  const target = 25 + 0.5 * env.score + contractTerm;
  adjustReputation(s, (target - s.company.reputation) * 0.03 - (operationsSuspended(s) ? 1 : 0));

  // ---- Reset daily counters (emissionsTotal is accumulated live by facilities) ----
  env.emissionsToday = 0;
  env.flaredToday = 0;
  env.ventedToday = 0;
}
