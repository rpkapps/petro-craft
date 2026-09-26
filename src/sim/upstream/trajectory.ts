// Well trajectory geometry: vertical, build-and-hold ("J") directional, and horizontal (curve + lateral).
//
// Coordinates are continuous world coordinates. A well at block column (x, z) runs through the block centre
// (x + 0.5, z + 0.5); the block cell containing a point is floor() of each component. The polyline is sampled
// at 1-block measured-depth spacing starting at the surface point; the last point is exactly at TD.
import type { Vec3, WellPlan } from '../../core/types';
import { BUILD_RADIUS } from './tuning';

export interface TrajectoryDesign {
  kind: WellPlan['kind'];
  /** Kickoff y actually used (directional/horizontal). */
  kickoffY: number;
  /** Hold inclination (radians) for directional wells; π/2 for horizontal. */
  inclination: number;
  /** Horizontal displacement reached at targetY (directional) / landing (horizontal). */
  displacement: number;
  /** True when the requested directional offset could not be reached (hold angle capped). */
  offsetShort: boolean;
  /** Build radius in blocks. */
  radius: number;
  /** Segment lengths (blocks MD). */
  vertical: number;
  curve: number;
  hold: number;
  lateral: number;
  length: number;
}

const MAX_HOLD_INC = (85 * Math.PI) / 180;

/** Solve the build-and-hold inclination to reach horizontal offset H after vertical drop D below kickoff. */
function solveHold(H: number, D: number, R: number): { inc: number; short: boolean } {
  const f = (t: number) => (H - R * (1 - Math.cos(t))) * Math.cos(t) - (D - R * Math.sin(t)) * Math.sin(t);
  if (H <= 0.01) return { inc: 0, short: false };
  if (f(MAX_HOLD_INC) > 0) return { inc: MAX_HOLD_INC, short: true };
  let lo = 0;
  let hi = MAX_HOLD_INC;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) lo = mid;
    else hi = mid;
  }
  return { inc: (lo + hi) / 2, short: false };
}

export function designTrajectory(surfaceY: number, plan: WellPlan): TrajectoryDesign {
  const targetY = Math.min(plan.targetY, surfaceY - 2);
  const total = Math.max(1, surfaceY - targetY);
  let R = BUILD_RADIUS;
  if (plan.kind === 'vertical') {
    return { kind: 'vertical', kickoffY: targetY, inclination: 0, displacement: 0, offsetShort: false, radius: R, vertical: total, curve: 0, hold: 0, lateral: 0, length: total };
  }
  if (plan.kind === 'horizontal') {
    // Land at targetY with 90° inclination: kickoff is one build radius above the landing depth.
    R = Math.min(R, Math.max(2, surfaceY - 2 - targetY));
    const kickoffY = targetY + R;
    const vertical = surfaceY - kickoffY;
    const curve = (Math.PI / 2) * R;
    const lateral = Math.max(0, plan.lateralLength ?? 0);
    return { kind: 'horizontal', kickoffY, inclination: Math.PI / 2, displacement: R, offsetShort: false, radius: R, vertical, curve, hold: 0, lateral, length: vertical + curve + lateral };
  }
  // Directional (J profile)
  const defaultKop = surfaceY - Math.max(2, Math.round(total * 0.3));
  let kickoffY = plan.kickoffY ?? defaultKop;
  kickoffY = Math.min(surfaceY - 2, Math.max(targetY + 1, kickoffY));
  const D = kickoffY - targetY;
  const H = Math.max(0, plan.offset ?? 0);
  const r = Math.min(R, D);
  const { inc, short } = solveHold(H, D, r);
  const curve = inc * r;
  const dyCurve = r * Math.sin(inc);
  const hold = inc > 0 ? Math.max(0, (D - dyCurve) / Math.cos(inc)) : D;
  const displacement = r * (1 - Math.cos(inc)) + hold * Math.sin(inc);
  return { kind: 'directional', kickoffY, inclination: inc, displacement, offsetShort: short, radius: r, vertical: surfaceY - kickoffY, curve, hold, lateral: 0, length: surfaceY - kickoffY + curve + hold };
}

/** Position (s = horizontal displacement along azimuth, d = depth below surface) at measured depth md. */
function sdAt(t: TrajectoryDesign, md: number): [number, number] {
  if (md <= t.vertical) return [0, md];
  let m = md - t.vertical;
  if (m <= t.curve) {
    const phi = m / t.radius;
    return [t.radius * (1 - Math.cos(phi)), t.vertical + t.radius * Math.sin(phi)];
  }
  m -= t.curve;
  const s0 = t.radius * (1 - Math.cos(t.inclination));
  const d0 = t.vertical + t.radius * Math.sin(t.inclination);
  if (t.kind === 'horizontal') return [s0 + Math.min(m, t.lateral), d0];
  const hm = Math.min(m, t.hold);
  return [s0 + hm * Math.sin(t.inclination), d0 + hm * Math.cos(t.inclination)];
}

/**
 * Planned trajectory polyline from the surface point (column x,z at y = surfaceY) to TD,
 * sampled every block of measured depth (last point exactly at TD).
 */
export function planTrajectory(x: number, y: number, z: number, plan: WellPlan): Vec3[] {
  const t = designTrajectory(y, plan);
  const az = plan.azimuth ?? 0;
  const ca = Math.cos(az);
  const sa = Math.sin(az);
  const cx = Math.floor(x) + 0.5;
  const cz = Math.floor(z) + 0.5;
  const pts: Vec3[] = [];
  const n = Math.floor(t.length);
  const at = (md: number) => {
    const [s, d] = sdAt(t, md);
    pts.push({ x: cx + s * ca, y: y - d, z: cz + s * sa });
  };
  for (let i = 0; i <= n; i++) at(i);
  if (t.length - n > 1e-6) at(t.length);
  return pts;
}

/** Polyline length (blocks MD). */
export function pathLength(pts: Vec3[]): number {
  if (pts.length < 2) return 0;
  const n = pts.length - 1;
  const a = pts[n - 1];
  const b = pts[n];
  return n - 1 + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/** Interpolated position at measured depth md on a 1-block-spaced polyline. */
export function posAtMd(pts: Vec3[], md: number, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  if (pts.length === 0) return out;
  const n = pts.length - 1;
  if (md <= 0) {
    out.x = pts[0].x; out.y = pts[0].y; out.z = pts[0].z;
    return out;
  }
  let i = Math.floor(md);
  if (i >= n) i = n - 1;
  if (i < 0) i = 0;
  const a = pts[i];
  const b = pts[Math.min(n, i + 1)];
  const segLen = i + 1 < n ? 1 : Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z));
  const f = Math.min(1, Math.max(0, (md - i) / segLen));
  out.x = a.x + (b.x - a.x) * f;
  out.y = a.y + (b.y - a.y) * f;
  out.z = a.z + (b.z - a.z) * f;
  return out;
}

/** Inclination (0 vertical .. π/2 horizontal) of the path at md. */
export function inclinationAt(pts: Vec3[], md: number): number {
  const a = posAtMd(pts, Math.max(0, md - 0.5));
  const b = posAtMd(pts, md + 0.5);
  const h = Math.hypot(b.x - a.x, b.z - a.z);
  const v = Math.abs(a.y - b.y);
  return Math.atan2(h, v);
}
