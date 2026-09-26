// Seismic surveys: quotes, acquisition/processing progress and reservoir imaging (knowledge & discovery).
import type { GameContext, Reservoir, SurveyState } from '../../core/types';
import type { Command, CommandResult } from '../../core/commands';
import { surveyName } from './naming';
import { clamp, fmtMoney, hasFeature, fmtVol } from './util';
import { rx } from './wellData';

/** Fraction of survey time spent acquiring (the rest is processing). */
export const ACQUISITION_FRACTION = 0.8;
const MIN_2D_LENGTH = 16;
const MAX_2D_LENGTH = 420;
const MIN_3D_SIDE = 16;
const MAX_3D_AREA = 200 * 200;

export function surveyQuote(ctx: GameContext, kind: '2d' | '3d', x0: number, z0: number, x1: number, z1: number): { cost: number; days: number } {
  const costMul = ctx.modifier('seismic_cost');
  const speed = Math.max(0.1, ctx.modifier('seismic_speed'));
  if (kind === '2d') {
    const L = Math.hypot(x1 - x0, z1 - z0);
    return { cost: Math.round(((60_000 + 1_300 * L) * costMul) / 1000) * 1000, days: Math.round(((0.5 + L / 110) / speed) * 10) / 10 };
  }
  const A = Math.abs(x1 - x0) * Math.abs(z1 - z0);
  return { cost: Math.round(((160_000 + 105 * A) * costMul) / 1000) * 1000, days: Math.round(((1 + A / 4200) / speed) * 10) / 10 };
}

/** Acquired fraction 0..1 of the survey's line/area. */
export function acquiredFraction(s: SurveyState): number {
  if (s.status !== 'in_progress') return 1;
  return clamp(s.progress / ACQUISITION_FRACTION, 0, 1);
}

export function cmdSurveyStart(cmd: Command<'survey/start'>, ctx: GameContext): CommandResult {
  const kind = cmd.kind;
  if (kind !== '2d' && kind !== '3d') return { ok: false, error: 'Unknown survey type' };
  if (kind === '2d' && !hasFeature(ctx, 'seismic_2d', 'survey_2d')) return { ok: false, error: '2D seismic requires the 2D Seismic Surveys technology' };
  if (kind === '3d' && !hasFeature(ctx, 'seismic_3d', 'survey_3d')) return { ok: false, error: '3D seismic requires the 3D Seismic technology (Research → Exploration)' };
  const W = ctx.geology.sizeX;
  const D = ctx.geology.sizeZ;
  const vals = [cmd.x0, cmd.z0, cmd.x1, cmd.z1];
  if (!vals.every((v) => Number.isFinite(v))) return { ok: false, error: 'Invalid survey coordinates' };
  let x0 = clamp(Math.round(cmd.x0), 0, W - 1);
  let z0 = clamp(Math.round(cmd.z0), 0, D - 1);
  let x1 = clamp(Math.round(cmd.x1), 0, W - 1);
  let z1 = clamp(Math.round(cmd.z1), 0, D - 1);
  if (kind === '2d') {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < MIN_2D_LENGTH) return { ok: false, error: `Seismic lines must be at least ${MIN_2D_LENGTH * 40} m long` };
    if (L > MAX_2D_LENGTH) return { ok: false, error: `Seismic lines are limited to ${MAX_2D_LENGTH * 40 / 1000} km` };
  } else {
    [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
    [z0, z1] = [Math.min(z0, z1), Math.max(z0, z1)];
    if (x1 - x0 < MIN_3D_SIDE || z1 - z0 < MIN_3D_SIDE) return { ok: false, error: `3D surveys must be at least ${MIN_3D_SIDE * 40} m on each side` };
    if ((x1 - x0) * (z1 - z0) > MAX_3D_AREA) return { ok: false, error: 'Survey area too large — split it into smaller surveys' };
  }
  const q = surveyQuote(ctx, kind, x0, z0, x1, z1);
  const name = surveyName(ctx, kind, (x0 + x1) / 2, (z0 + z1) / 2);
  if (!ctx.transact(-q.cost, 'survey', `${name}: acquisition & processing`, true)) return { ok: false, error: `Not enough money: the survey costs ${fmtMoney(q.cost)}` };
  const s: SurveyState = {
    id: ctx.newId('sv'), kind, x0, z0, x1, z1, status: 'in_progress', progress: 0,
    quality: Math.round(ctx.modifier('seismic_resolution') * 100) / 100,
    fluidIndicators: hasFeature(ctx, 'avo_analysis', 'seismic_fluid'),
    startedDay: ctx.state.time.day, cost: q.cost, name,
  };
  ctx.state.surveys[s.id] = s;
  ctx.bus.emit('survey:started', { id: s.id });
  ctx.notify('info', `${name} started`, `Crews are shooting ${kind === '2d' ? 'the line' : 'the survey area'}. Expected in ${q.days} days (${fmtMoney(q.cost)}).`, { x: (x0 + x1) / 2, y: ctx.geology.surfaceHeight((x0 + x1) / 2, (z0 + z1) / 2), z: (z0 + z1) / 2 });
  return { ok: true, data: { surveyId: s.id, cost: q.cost, days: q.days } };
}

export function cmdSurveyCancel(cmd: Command<'survey/cancel'>, ctx: GameContext): CommandResult {
  const s = ctx.state.surveys[cmd.surveyId];
  if (!s) return { ok: false, error: 'Survey not found' };
  if (s.status === 'complete') {
    delete ctx.state.surveys[s.id];
    return { ok: true, data: { deleted: true } };
  }
  // Refund the unacquired share of the cost (processing is never refunded).
  const refund = Math.round(s.cost * 0.6 * (1 - acquiredFraction(s)));
  if (refund > 0) ctx.transact(refund, 'survey', `${s.name}: cancellation refund`);
  delete ctx.state.surveys[s.id];
  ctx.notify('info', `${s.name} cancelled`, refund > 0 ? `Refunded ${fmtMoney(refund)}.` : undefined);
  return { ok: true, data: { refund } };
}

/** Advance surveys; on completion image reservoirs. */
export function tickSurveys(ctx: GameContext, days: number): void {
  for (const s of Object.values(ctx.state.surveys)) {
    if (s.status === 'complete') continue;
    const q = surveyQuote(ctx, s.kind, s.x0, s.z0, s.x1, s.z1);
    s.progress = Math.min(1, s.progress + days / Math.max(0.05, q.days));
    if (s.status === 'in_progress' && s.progress >= ACQUISITION_FRACTION) s.status = 'processing';
    if (s.progress >= 1) completeSurvey(ctx, s);
  }
}

/** Fraction (0..1) of a reservoir outline sampled inside a 3D survey rectangle. */
function areaOverlap(r: Reservoir, s: SurveyState): number {
  const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), z0 = Math.min(s.z0, s.z1), z1 = Math.max(s.z0, s.z1);
  let inside = 0;
  let total = 0;
  const N = 10;
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) {
      const u = ((i + 0.5) / N) * 2 - 1;
      const v = ((j + 0.5) / N) * 2 - 1;
      if (u * u + v * v > 1) continue;
      total++;
      const x = r.center.x + u * r.radiusX;
      const z = r.center.z + v * r.radiusZ;
      if (x >= x0 && x <= x1 && z >= z0 && z <= z1) inside++;
    }
  return total ? inside / total : 0;
}

/** How squarely a 2D line crosses a reservoir outline (0 = misses, 1 = through the crest). */
function lineCrossing(r: Reservoir, s: SurveyState): number {
  let best = Infinity;
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = s.x0 + (s.x1 - s.x0) * t;
    const z = s.z0 + (s.z1 - s.z0) * t;
    const d = Math.hypot((x - r.center.x) / Math.max(1, r.radiusX), (z - r.center.z) / Math.max(1, r.radiusZ));
    if (d < best) best = d;
  }
  if (best >= 1.1) return 0;
  return clamp(1.15 - best * 0.6, 0.3, 1);
}

export function completeSurvey(ctx: GameContext, s: SurveyState): void {
  s.status = 'complete';
  s.progress = 1;
  s.completedDay = ctx.state.time.day;
  const qf = clamp(0.55 + 0.35 * s.quality, 0.6, 1.4);
  const leads: string[] = [];
  let imaged = 0;
  for (const r of ctx.geology.reservoirs) {
    const rs = ctx.state.reservoirs[r.id];
    if (!rs) continue;
    let gain = 0;
    let cap = 0;
    if (s.kind === '2d') {
      const c = lineCrossing(r, s);
      if (c > 0) {
        gain = 0.32 * c * qf;
        cap = 0.55;
      }
    } else {
      const f = areaOverlap(r, s);
      if (f > 0) {
        gain = 0.8 * f * qf;
        cap = 0.95;
      }
    }
    if (gain <= 0) continue;
    imaged++;
    rs.knowledge = Math.max(rs.knowledge, Math.min(cap, rs.knowledge + gain));
    if (!rs.discovered && rs.knowledge > 0.3) {
      rs.discovered = true;
      const kind = s.fluidIndicators ? (r.fluid === 'oil' ? 'bright amplitude, likely oil' : 'strong bright spot, likely gas') : r.trap === 'shale_play' ? 'thick organic-rich shale' : `${r.trap.replace('_', ' ')} closure`;
      leads.push(`${r.name} (${kind}, ~${depthOf(ctx, r)} m)`);
    }
  }
  ctx.bus.emit('survey:completed', { id: s.id });
  const at = { x: (s.x0 + s.x1) / 2, y: ctx.geology.surfaceHeight((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2), z: (s.z0 + s.z1) / 2 };
  if (leads.length)
    ctx.notify('success', `${s.name}: ${leads.length} new lead${leads.length > 1 ? 's' : ''}`, `Interpretation shows ${leads.join('; ')}. Volumes stay uncertain until drilled — open the Seismic panel.`, at);
  else ctx.notify('info', `${s.name} processed`, imaged ? 'No new prospects — known structures imaged in more detail.' : 'No prospective structures imaged along this survey.', at);
}

function depthOf(ctx: GameContext, r: Reservoir): number {
  const sy = r.offshore ? 63 : ctx.geology.surfaceHeight(r.center.x, r.center.z);
  return Math.max(0, Math.round((sy - r.topY) * 40 / 10) * 10);
}

/** UI helper: player-facing in-place estimate string for a reservoir. */
export function estimateText(ctx: GameContext, r: Reservoir): string {
  const rs = ctx.state.reservoirs[r.id];
  if (!rs?.discovered) return 'Unknown';
  const e = rx(rs);
  const f = 1 + e.estError * Math.pow(1 - clamp(rs.knowledge, 0, 1), 1.5);
  return r.fluid === 'oil' ? fmtVol(r.oilInPlace * f, 'bbl') : fmtVol(r.gasInPlace * f, 'mcf');
}
