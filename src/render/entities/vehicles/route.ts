// Smooth drivable routes: a centripetal Catmull-Rom spline through waypoints, resampled into a
// dense polyline with cumulative arc length for constant-speed following.
import type { Pt } from './nav';

export interface RouteSample {
  x: number;
  z: number;
  /** Unit tangent. */
  dx: number;
  dz: number;
}

/** Remove consecutive near-duplicate points (Catmull-Rom needs distinct knots). */
export function dedupe(pts: Pt[], eps = 0.05): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > eps) out.push([p[0], p[1]]);
  }
  return out;
}

export class Route {
  readonly xs: Float32Array;
  readonly zs: Float32Array;
  readonly s: Float32Array;
  readonly length: number;
  readonly count: number;

  /** Spline through `points`, sampled roughly every `spacing` blocks. */
  constructor(points: Pt[], spacing = 1) {
    const p = dedupe(points);
    if (p.length === 1) p.push([p[0][0] + 0.01, p[0][1]]);
    const xs: number[] = [];
    const zs: number[] = [];
    const n = p.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = p[Math.max(0, i - 1)];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[Math.min(n - 1, i + 2)];
      // mirror end tangents so the curve does not bulge at the route ends
      const a = i === 0 ? ([2 * p1[0] - p2[0], 2 * p1[1] - p2[1]] as Pt) : p0;
      const d = i + 2 >= n ? ([2 * p2[0] - p1[0], 2 * p2[1] - p1[1]] as Pt) : p3;
      const segLen = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const steps = Math.max(1, Math.ceil(segLen / spacing));
      for (let k = 0; k < steps; k++) {
        const [x, z] = catmullRom(a, p1, p2, d, k / steps);
        xs.push(x);
        zs.push(z);
      }
    }
    xs.push(p[n - 1][0]);
    zs.push(p[n - 1][1]);
    this.count = xs.length;
    this.xs = Float32Array.from(xs);
    this.zs = Float32Array.from(zs);
    this.s = new Float32Array(this.count);
    let acc = 0;
    for (let i = 1; i < this.count; i++) {
      acc += Math.hypot(this.xs[i] - this.xs[i - 1], this.zs[i] - this.zs[i - 1]);
      this.s[i] = acc;
    }
    this.length = acc;
  }

  private seg(s: number): number {
    // binary search for the segment containing arc length s
    let lo = 0;
    let hi = this.count - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (this.s[m] <= s) lo = m;
      else hi = m;
    }
    return lo;
  }

  sample(s: number, out: RouteSample): RouteSample {
    const c = Math.max(0, Math.min(this.length, s));
    const i = Math.min(this.count - 2, this.seg(c));
    const j = i + 1;
    const L = Math.max(1e-6, this.s[j] - this.s[i]);
    const t = Math.max(0, Math.min(1, (c - this.s[i]) / L));
    const dx = this.xs[j] - this.xs[i];
    const dz = this.zs[j] - this.zs[i];
    out.x = this.xs[i] + dx * t;
    out.z = this.zs[i] + dz * t;
    // tangent blended toward the next segment for smooth heading changes
    const len = Math.hypot(dx, dz) || 1;
    let tx = dx / len;
    let tz = dz / len;
    if (j + 1 < this.count) {
      const ex = this.xs[j + 1] - this.xs[j];
      const ez = this.zs[j + 1] - this.zs[j];
      const el = Math.hypot(ex, ez) || 1;
      tx += (ex / el - tx) * t * 0.5;
      tz += (ez / el - tz) * t * 0.5;
    }
    if (i > 0) {
      const ex = this.xs[i] - this.xs[i - 1];
      const ez = this.zs[i] - this.zs[i - 1];
      const el = Math.hypot(ex, ez) || 1;
      tx += (ex / el - tx) * (1 - t) * 0.5;
      tz += (ez / el - tz) * (1 - t) * 0.5;
    }
    const tl = Math.hypot(tx, tz) || 1;
    out.dx = tx / tl;
    out.dz = tz / tl;
    return out;
  }

  /** Heading change (radians) between arc lengths s and s + ahead — used to slow down for bends. */
  turn(s: number, ahead: number): number {
    const a = this.sample(s, _a);
    const ax = a.dx;
    const az = a.dz;
    const b = this.sample(s + ahead, _b);
    return Math.acos(Math.max(-1, Math.min(1, ax * b.dx + az * b.dz)));
  }
}

const _a: RouteSample = { x: 0, z: 0, dx: 1, dz: 0 };
const _b: RouteSample = { x: 0, z: 0, dx: 1, dz: 0 };

/** Centripetal Catmull-Rom point between p1 and p2 at t ∈ [0, 1]. */
function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const knot = (a: Pt, b: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const lerp = (a: Pt, b: Pt, ta: number, tb: number): Pt => {
    const k = (u - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  };
  const a1 = lerp(p0, p1, t0, t1);
  const a2 = lerp(p1, p2, t1, t2);
  const a3 = lerp(p2, p3, t2, t3);
  const b1 = lerp(a1, a2, t0, t2);
  const b2 = lerp(a2, a3, t1, t3);
  return lerp(b1, b2, t1, t2);
}
