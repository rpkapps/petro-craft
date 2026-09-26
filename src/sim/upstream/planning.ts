// Well planning: pressure prediction, suggested plans, plan validation, cost/time quotes.
import { BUILDINGS } from '../../content/buildings';
import { SEA_LEVEL } from '../../core/constants';
import { RIG_TYPES } from '../../core/buildingUtil';
import type { GameContext, Vec3, WellPlan } from '../../core/types';
import type { UpstreamRuntime } from './runtime';
import { designTrajectory, planTrajectory } from './trajectory';
import {
  BIT_LIFE_BLOCKS, CASING_HOURS_BASE, CASING_HOURS_PER_BLOCK, CASING_JOINTS_PER_BLOCK, CEMENT_SACKS_PER_BLOCK,
  COMPLETION_BASE_COST, COMPLETION_COST_PER_CONTACT, COMPLETION_HOURS_BASE, COMPLETION_HOURS_PER_CONTACT, HYDROSTATIC_PSI_FT, MAX_LATERAL_BLOCKS,
  MUD_INITIAL, MUD_MAX_PPG, MUD_MIN_PPG, MUD_PER_BLOCK, MUD_PER_HOUR, PIPE_WEAR_PER_BLOCK, RIG_SPECS, BARITE_PER_BLOCK_PER_PPG,
  type RigSpec,
} from './tuning';
import { clamp, estimateSupplyCost, hasFeature, ownsLease, psiToPpg, tvdFt, fmtMoney, depthM } from './util';

export interface PressurePoint { y: number; pore: number; frac: number }

/**
 * Surface (rig floor) y used for a well at a column: sea level + 1 offshore; onshore the level above the pad of
 * a rig standing on the column (or an existing well's surface), else the natural terrain height. (World
 * getSurfaceY is not used: building STRUCTURE blocks would count as ground.)
 */
export function wellSurfaceY(ctx: GameContext, x: number, z: number): number {
  if (ctx.geology.isOffshore(x, z)) return SEA_LEVEL + 1;
  for (const b of Object.values(ctx.state.buildings)) {
    if (!RIG_TYPES.has(b.type)) continue;
    if (x >= b.x && x < b.x + b.size[0] && z >= b.z && z < b.z + b.size[1]) return b.y;
  }
  for (const w of Object.values(ctx.state.wells)) if (w.x === x && w.z === z) return w.surfaceY;
  return ctx.geology.surfaceHeight(x, z);
}

/** Share of the true over/under-pressure the player's prediction captures with no local data (regional trends). */
export const BASE_PRESSURE_KNOWLEDGE = 0.5;

/**
 * How much of the true pressure anomaly the player's prediction captures at a column (0..1), as a function of
 * depth: an offset well within 40 blocks reveals everything down to its TD; a completed 3D survey covering the
 * point or a 2D line within 3 blocks reveals all depths (0.85 within 12 blocks of a 2D line); otherwise regional
 * trends only (BASE_PRESSURE_KNOWLEDGE). Returns a function of y.
 */
export function pressureKnowledge(ctx: GameContext, x: number, z: number): (y: number) => number {
  let survey = BASE_PRESSURE_KNOWLEDGE;
  for (const s of Object.values(ctx.state.surveys)) {
    if (s.status !== 'complete') continue;
    if (s.kind === '3d') {
      if (x >= Math.min(s.x0, s.x1) && x <= Math.max(s.x0, s.x1) && z >= Math.min(s.z0, s.z1) && z <= Math.max(s.z0, s.z1)) survey = 1;
    } else {
      const dx = s.x1 - s.x0;
      const dz = s.z1 - s.z0;
      const L2 = dx * dx + dz * dz || 1;
      const t = clamp(((x - s.x0) * dx + (z - s.z0) * dz) / L2, 0, 1);
      const d = Math.hypot(s.x0 + t * dx - x, s.z0 + t * dz - z);
      if (d <= 3) survey = 1;
      else if (d <= 12) survey = Math.max(survey, 0.85);
    }
  }
  let deepest = Infinity;
  for (const w of Object.values(ctx.state.wells)) {
    if (w.measuredDepth < 3 || Math.hypot(w.x - x, w.z - z) > 40) continue;
    deepest = Math.min(deepest, w.currentY);
  }
  return (y: number) => (y >= deepest - 0.5 ? 1 : survey);
}

/** Pressure-prediction confidence at a column over the whole section (worst depth) — for UI badges. */
export function pressureConfidence(ctx: GameContext, x: number, z: number, targetY = 2): number {
  const k = pressureKnowledge(ctx, x, z);
  return Math.min(k(targetY), k(ctx.geology.surfaceHeight(x, z) - 2));
}

/** Current pore pressure (psi) at a point: geology pore pressure scaled by reservoir depletion. */
export function currentPorePsi(ctx: GameContext, x: number, y: number, z: number, reservoirId?: string, initial?: number): number {
  const p = ctx.geology.porePressure(x, y, z);
  if (!reservoirId) return p;
  const rs = ctx.state.reservoirs[reservoirId];
  const pi = initial ?? ctx.geology.getReservoir(reservoirId)?.initialPressure;
  if (!rs || !pi) return p;
  return p * clamp(rs.pressure / pi, 0.05, 1.5);
}

/** Predicted pore & fracture pressure (ppg) from the rig floor down to y = 2 (one entry per block). */
export function pressureProfile(ctx: GameContext, x: number, z: number): PressurePoint[] {
  const surfaceY = wellSurfaceY(ctx, x, z);
  const know = pressureKnowledge(ctx, x, z);
  const out: PressurePoint[] = [];
  for (let y = surfaceY - 1; y >= 2; y--) {
    const tvd = tvdFt(surfaceY, y);
    if (tvd < 1) continue;
    const props = ctx.geology.properties(x, y, z);
    const truePore = currentPorePsi(ctx, x, y, z, props.reservoirId);
    const hydro = HYDROSTATIC_PSI_FT * tvd;
    // Unknown areas are predicted as normally pressured; knowledge reveals over/under-pressure.
    const pore = hydro + know(y) * (truePore - hydro);
    const frac = ctx.geology.fracturePressure(x, y, z);
    out.push({ y, pore: psiToPpg(pore, tvd), frac: psiToPpg(frac, tvd) });
  }
  return out;
}

/** Rig capabilities after research modifiers. */
export function rigLimits(ctx: GameContext, rigType: string): { spec: RigSpec; maxDepth: number; maxLateral: number } {
  const spec = RIG_SPECS[rigType] ?? RIG_SPECS.drilling_rig_land;
  const maxDepth = Math.round(spec.maxDepth * ctx.modifier('max_depth'));
  const lateralMul = rigType === 'drilling_rig_heavy' || spec.offshore ? 1.4 : 1;
  const maxLateral = Math.round(MAX_LATERAL_BLOCKS * lateralMul * ctx.modifier('max_lateral'));
  return { spec, maxDepth, maxLateral };
}

/** Mud weight required for the open hole between two y levels (max predicted pore + 0.3 ppg). */
export function sectionMudWeight(profile: PressurePoint[], topY: number, bottomY: number): number {
  let m = 8.6;
  for (const p of profile) if (p.y <= topY && p.y >= bottomY) m = Math.max(m, p.pore + 0.3);
  return Math.ceil(clamp(m, MUD_MIN_PPG, MUD_MAX_PPG) * 10 - 1e-6) / 10;
}

/** Default plan: surface casing below the deepest fresh aquifer, intermediate above overpressure, production at TD. */
export function suggestPlan(ctx: GameContext, rt: UpstreamRuntime, x: number, z: number, targetY: number, kind: WellPlan['kind']): WellPlan {
  const surfaceY = wellSurfaceY(ctx, x, z);
  targetY = Math.round(clamp(targetY, 3, surfaceY - 4));
  const profile = pressureProfile(ctx, x, z);
  const pts: number[] = [];
  // Surface casing: below the deepest fresh aquifer (or ~8 blocks / 320 m), well above the target.
  let surf = surfaceY - 8;
  const offshore = ctx.geology.isOffshore(x, z);
  if (offshore) surf = Math.min(surf, ctx.geology.surfaceHeight(x, z) - 6);
  for (const a of rt.freshAquifersAt(x, z)) surf = Math.min(surf, a.bottomY - 2);
  surf = Math.max(surf, targetY + 4);
  if (surf < surfaceY - 1) pts.push(surf);
  // Intermediate casing above the first significantly overpressured interval (> hydrostatic + 1 ppg).
  let over: number | undefined;
  for (const p of profile) {
    if (p.y >= surf || p.y <= targetY) continue;
    if (p.pore > 10.0) {
      over = p.y + 1;
      break;
    }
  }
  if (over !== undefined && over < surf - 3 && over > targetY + 2) pts.push(over);
  pts.push(targetY);
  const lastTop = pts.length > 1 ? pts[pts.length - 2] : surfaceY;
  let mud = sectionMudWeight(profile, lastTop, targetY);
  // Keep a little below the weakest fracture gradient in the last open-hole section when possible.
  let fracMin = Infinity;
  for (const p of profile) if (p.y <= lastTop && p.y >= targetY) fracMin = Math.min(fracMin, p.frac);
  if (Number.isFinite(fracMin)) mud = Math.min(mud, Math.max(8.6, fracMin - 0.3));
  const plan: WellPlan = { kind, targetY, casingPoints: pts, mudWeight: Math.round(mud * 10) / 10 };
  if (kind !== 'vertical') {
    plan.azimuth = 0;
    if (kind === 'directional') {
      plan.offset = 10;
      plan.kickoffY = surfaceY - Math.max(3, Math.round((surfaceY - targetY) * 0.3));
    } else {
      const { maxLateral } = rigLimits(ctx, 'drilling_rig_land');
      plan.lateralLength = Math.min(20, maxLateral);
    }
  }
  return plan;
}

/** Normalise & validate a plan for a rig/location. Returns an error string or the sanitised plan. */
export function validatePlan(ctx: GameContext, rigType: string, x: number, z: number, surfaceY: number, input: WellPlan): { plan?: WellPlan; error?: string } {
  if (!input || typeof input !== 'object') return { error: 'Invalid well plan' };
  const kind = input.kind;
  if (kind !== 'vertical' && kind !== 'directional' && kind !== 'horizontal') return { error: 'Unknown well type' };
  if (kind === 'directional' && !hasFeature(ctx, 'directional_drilling', 'directional')) return { error: 'Directional wells require Directional Drilling research' };
  if (kind === 'horizontal' && !hasFeature(ctx, 'horizontal_drilling', 'horizontal')) return { error: 'Horizontal wells require Horizontal Drilling research' };
  if (!Number.isFinite(input.targetY)) return { error: 'Choose a target depth' };
  const targetY = Math.round(input.targetY);
  if (targetY < 3) return { error: 'Target is below the drillable basement' };
  if (targetY > surfaceY - 4) return { error: 'Target is too shallow (minimum 160 m)' };
  const lim = rigLimits(ctx, rigType);
  const tvdBlocks = surfaceY - targetY;
  if (tvdBlocks > lim.maxDepth) return { error: `Too deep for this rig: ${tvdBlocks * 40} m TVD (max ${lim.maxDepth * 40} m). Research Heavy Rigs or use a heavy rig.` };
  const plan: WellPlan = { kind, targetY, casingPoints: [], mudWeight: clamp(Number(input.mudWeight) || 9.2, MUD_MIN_PPG, MUD_MAX_PPG) };
  if (kind !== 'vertical') {
    plan.azimuth = Number.isFinite(input.azimuth) ? input.azimuth! : 0;
    if (input.kickoffY !== undefined && Number.isFinite(input.kickoffY)) plan.kickoffY = Math.round(input.kickoffY);
  }
  if (kind === 'horizontal') {
    const L = Math.round(Number(input.lateralLength ?? input.offset ?? 0));
    if (!(L >= 3)) return { error: 'Horizontal wells need a lateral of at least 3 blocks (120 m)' };
    if (L > lim.maxLateral) return { error: `Lateral too long: ${L * 40} m (max ${lim.maxLateral * 40} m). Research Extended Reach Drilling.` };
    plan.lateralLength = L;
  }
  if (kind === 'directional') {
    const H = Math.round(Number(input.offset ?? 0));
    if (!(H >= 1)) return { error: 'Directional wells need a horizontal offset' };
    if (H > lim.maxLateral * 1.5) return { error: `Offset too large: ${H * 40} m (max ${Math.round(lim.maxLateral * 1.5) * 40} m)` };
    plan.offset = H;
  }
  const cps = (Array.isArray(input.casingPoints) ? input.casingPoints : [])
    .map((v) => Math.round(Number(v)))
    .filter((v) => Number.isFinite(v) && v < surfaceY - 1 && v >= targetY);
  plan.casingPoints = Array.from(new Set(cps)).sort((a, b) => b - a);
  // Horizontal end point must be inside the world.
  const pts = planTrajectory(x, surfaceY, z, plan);
  const end = pts[pts.length - 1];
  if (!end || !ctx.world.inBounds(Math.floor(end.x), Math.floor(end.y), Math.floor(end.z))) return { error: 'The well path leaves the map' };
  return { plan };
}

export interface WellQuote { cost: number; days: number; warnings: string[] }

/** Cost/time estimate by walking the planned path through the geology. */
export function quoteWell(ctx: GameContext, rt: UpstreamRuntime, x: number, z: number, planIn: WellPlan, rigType: string): WellQuote {
  const warnings: string[] = [];
  const surfaceY = wellSurfaceY(ctx, x, z);
  const spec = RIG_SPECS[rigType] ?? RIG_SPECS.drilling_rig_land;
  const v = validatePlan(ctx, rigType, x, z, surfaceY, planIn);
  if (v.error) warnings.push(v.error);
  const plan = v.plan ?? { ...planIn, casingPoints: planIn.casingPoints ?? [], targetY: clamp(Math.round(planIn.targetY), 3, surfaceY - 4) };
  if (!ownsLease(ctx, x, z, ctx.localPlayerId)) warnings.push('No mineral lease on this parcel — acquire it first (Map → Leases).');
  const offshore = ctx.geology.isOffshore(x, z);
  const def = BUILDINGS[rigType];
  if (offshore !== spec.offshore) warnings.push(offshore ? 'Offshore location: needs a jack-up or semi-submersible rig.' : 'Onshore location: offshore rigs cannot drill here.');
  if (offshore && def?.waterDepth) {
    const wd = ctx.geology.waterDepth(x, z);
    const maxWd = def.waterDepth[1] * ctx.modifier('offshore_depth');
    if (wd < def.waterDepth[0] || wd > maxWd) warnings.push(`Water depth ${wd * 40} m is outside this rig's range (${def.waterDepth[0] * 40}–${Math.round(maxWd) * 40} m).`);
  }
  const design = designTrajectory(surfaceY, plan);
  if (design.offsetShort) warnings.push('Offset not reachable from this kickoff depth — kick off shallower.');
  const pts = planTrajectory(x, surfaceY, z, plan);
  const length = design.length;
  const speed = ctx.modifier('drill_speed');
  const bitLife = BIT_LIFE_BLOCKS * ctx.modifier('bit_life');
  let hours = 0;
  let bits = 1;
  let wear = 0;
  let pipe = 0;
  let barite = 0;
  // Completion estimate uses the planned reservoir-section length (never peeks at the true fluids).
  const hcBlocks = plan.kind === 'horizontal' ? Math.max(3, plan.lateralLength ?? 0) : 3;
  const profile = pressureProfile(ctx, x, z);
  const byY = new Map(profile.map((p) => [p.y, p]));
  let overWarned = false;
  let lossWarned = false;
  const shoes = [surfaceY, ...plan.casingPoints];
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i + 1];
    const bx = Math.floor(p.x);
    const by = Math.floor(p.y);
    const bz = Math.floor(p.z);
    const pr = ctx.geology.properties(bx, by, bz);
    const h = Math.max(0.3, pr.hardness);
    hours += 1 / ((spec.rop * speed) / Math.pow(h, 0.8));
    wear += (100 / (bitLife / Math.pow(h, 1.2)));
    if (wear > 90) {
      bits++;
      wear = 0;
      hours += 1 + (surfaceY - by) * spec.tripHoursPerBlock;
    }
    pipe += PIPE_WEAR_PER_BLOCK * h;
    barite += Math.max(0, plan.mudWeight - 9.5) * BARITE_PER_BLOCK_PER_PPG;
    const pp = byY.get(by);
    if (pp && !overWarned && pp.pore > plan.mudWeight) {
      overWarned = true;
      warnings.push(`Predicted pore pressure ${pp.pore.toFixed(1)} ppg at ${depthM(surfaceY, by)} m exceeds the ${plan.mudWeight.toFixed(1)} ppg mud — kick risk.`);
    }
    if (pp && !lossWarned && pp.frac < plan.mudWeight) {
      const shoe = shoes.filter((s) => s >= by).reduce((a, b) => Math.min(a, b), surfaceY);
      if (shoe > by) {
        lossWarned = true;
        warnings.push(`Mud weight exceeds the fracture gradient (${pp.frac.toFixed(1)} ppg) at ${depthM(surfaceY, by)} m — lost circulation risk. Add intermediate casing.`);
      }
    }
  }
  if (pressureConfidence(ctx, x, z, plan.targetY) < 0.99) warnings.push('Pore-pressure prediction is uncertain here (no seismic or offset wells) — add a safety margin to the mud weight or shoot seismic first.');
  for (const a of rt.freshAquifersAt(x, z)) {
    const covered = plan.casingPoints.some((cp) => cp <= a.bottomY);
    if (!covered && plan.targetY < a.bottomY) warnings.push(`Fresh-water aquifer at ${depthM(surfaceY, a.topY)}–${depthM(surfaceY, a.bottomY)} m: set surface casing below ${depthM(surfaceY, a.bottomY)} m.`);
  }
  // Casing
  let casingBlocks = 0;
  for (const cp of plan.casingPoints) {
    casingBlocks += surfaceY - cp;
    hours += CASING_HOURS_BASE + CASING_HOURS_PER_BLOCK * (surfaceY - cp);
  }
  if (plan.kind === 'horizontal') casingBlocks += design.lateral;
  const casingCost = estimateSupplyCost(ctx, 'casing', casingBlocks * CASING_JOINTS_PER_BLOCK) + estimateSupplyCost(ctx, 'cement', casingBlocks * CEMENT_SACKS_PER_BLOCK * 0.5);
  const mudBbl = MUD_INITIAL + length * MUD_PER_BLOCK + hours * MUD_PER_HOUR;
  const consumables =
    estimateSupplyCost(ctx, 'drill_bit', bits) + estimateSupplyCost(ctx, 'drilling_mud', mudBbl) + estimateSupplyCost(ctx, 'drill_pipe', pipe) + estimateSupplyCost(ctx, 'barite', barite);
  const drillCost = ctx.modifier('drill_cost');
  const days = hours / 24 / 0.95; // allowance for connections/surveys
  const spread = spec.spreadPerDay * days * drillCost;
  const completion = COMPLETION_BASE_COST + COMPLETION_COST_PER_CONTACT * hcBlocks;
  const cost = Math.round((spec.mobilisation * drillCost + spread + consumables + casingCost + completion) / 1000) * 1000;
  const totalDays = days + (COMPLETION_HOURS_BASE + COMPLETION_HOURS_PER_CONTACT * hcBlocks) / 24;
  if (ctx.state.company.money < spec.mobilisation * drillCost) warnings.push(`Spud needs ${fmtMoney(spec.mobilisation * drillCost)} up front.`);
  return { cost, days: Math.round(totalDays * 10) / 10, warnings };
}

/** Trajectory preview helper for the service. */
export function previewTrajectory(x: number, y: number, z: number, plan: WellPlan): Vec3[] {
  return planTrajectory(x, y, z, plan);
}
