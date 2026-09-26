// Structural geology: fault planes, salt diapirs, anticlinal domes, reef mounds, sand wedges, and the coarse
// horizon grid that stores the (restored, i.e. un-faulted) elevation of every stratigraphic horizon.
//
// Horizon elevations vary smoothly, so they are sampled every GRID_STEP blocks and bilinearly
// interpolated per column. Sharp features (salt stocks, reef mounds, wedges, faults) are evaluated
// analytically per column / voxel on top of the grid.
import { SEA_LEVEL } from '../core/constants';
import type { Fault } from '../core/types';
import { clamp, lerp, smoothstep } from '../core/rng';
import { fbm, noise2, type Noise2 } from './noise';
import { NUM_HORIZONS, STACK_NOMINAL, U, UNITS } from './strata';
import { Terrain, type CoastSample } from './terrain';

/** Elevation at which fault traces are reported (the surface trace of each plane). */
export const REF_Y = 70;
export const GRID_STEP = 4;

// ------------------------------------------------------------------------------------------------
// Feature models
// ------------------------------------------------------------------------------------------------

export interface FaultModel {
  pub: Fault;
  /** Unit normal of the trace. */
  nx: number;
  nz: number;
  /** Point on the trace (at REF_Y). */
  px: number;
  pz: number;
  tanDip: number;
  dipSign: 1 | -1;
  throw: number;
  sealing: boolean;
  /** Bit in the compartment mask (sealing faults only), else 0. */
  bit: number;
  /** Vertical extent of the clay-smear gouge seam at the plane (blocks). */
  gougeW: number;
}

/** y above which a column is in the hanging wall of the fault. */
export function faultCrossY(f: FaultModel, x: number, z: number): number {
  const s = f.nx * (x - f.px) + f.nz * (z - f.pz);
  return REF_Y - f.dipSign * s * f.tanDip;
}

/** Horizontal position (x,z) where the fault plane sits at depth y, closest to (x,z). */
export function faultPlanePoint(f: FaultModel, x: number, z: number, y: number): { x: number; z: number } {
  const s = f.nx * (x - f.px) + f.nz * (z - f.pz);
  const sPlane = (f.dipSign * (REF_Y - y)) / f.tanDip;
  const ds = sPlane - s;
  return { x: x + f.nx * ds, z: z + f.nz * ds };
}

export interface Diapir {
  name: string;
  cx: number;
  cz: number;
  /** Stem radius. */
  r0: number;
  /** Bulb (overhang) radius near the top. */
  rTop: number;
  /** Highest salt y (real coordinates). */
  topY: number;
  bulbH: number;
  /** Anhydrite caprock thickness over the crest. */
  cap: number;
  /** Flank drag uplift amplitude & e-folding width. */
  dragA: number;
  dragW: number;
  /** Arching of strata above the crest. */
  archA: number;
  phase: number;
  /** Horizontal influence radius (for spatial indexing). */
  influence: number;
}

/** Salt stock radius at height y (before angular modulation). */
export function diapirRadius(d: Diapir, y: number): number {
  if (y > d.topY) return 0;
  const b0 = d.topY - d.bulbH;
  if (y >= b0) {
    const t = (y - b0) / d.bulbH;
    return d.rTop * Math.sqrt(Math.max(0, 1 - t * t));
  }
  return lerp(d.r0, d.rTop, smoothstep(b0 - 7, b0, y));
}

/** Vertical displacement of a horizon at elevation `e` at distance r from a diapir centre. */
export function diapirDrag(d: Diapir, r: number, e: number): number {
  const dist = r - d.r0;
  const flank = d.dragA * Math.exp(-Math.max(0, dist) / d.dragW);
  const rimArg = (dist - 3.2 * d.dragW) / (1.7 * d.dragW);
  const rim = -0.32 * d.dragA * Math.exp(-rimArg * rimArg);
  const archArg = r / (d.rTop * 2.3);
  const arch = d.archA * Math.exp(-archArg * archArg) * Math.exp(-Math.max(0, e - d.topY) / 28);
  const w = smoothstep(d.topY - 5, d.topY + 2, e);
  return lerp(flank + rim, arch, w);
}

export interface Dome {
  cx: number;
  cz: number;
  ra: number;
  rb: number;
  cos: number;
  sin: number;
  amp: number;
}

export function domeValue(d: Dome, x: number, z: number): number {
  const dx = x - d.cx;
  const dz = z - d.cz;
  const u = (dx * d.cos + dz * d.sin) / d.ra;
  const v = (-dx * d.sin + dz * d.cos) / d.rb;
  const q = u * u + v * v;
  return q > 9 ? 0 : d.amp * Math.exp(-q);
}

export interface Reef {
  name: string;
  cx: number;
  cz: number;
  r: number;
  h: number;
  phase: number;
}

/** Reef mound height above the platform top at (x,z); 0 outside. */
export function reefMound(rf: Reef, x: number, z: number): number {
  const dx = x - rf.cx;
  const dz = z - rf.cz;
  const d2 = dx * dx + dz * dz;
  const rMax = rf.r * 1.2;
  if (d2 >= rMax * rMax) return 0;
  const th = Math.atan2(dz, dx);
  const rr = rf.r * (1 + 0.13 * Math.sin(3 * th + rf.phase) + 0.07 * Math.sin(5 * th - rf.phase * 1.7));
  const rho2 = d2 / (rr * rr);
  if (rho2 >= 1) return 0;
  return rf.h * Math.pow(1 - rho2, 0.6);
}

export interface Wedge {
  name: string;
  unit: number;
  /** Thick (down-dip) end centre. */
  ox: number;
  oz: number;
  /** Unit vector pointing up-dip (toward the pinch-out). */
  dx: number;
  dz: number;
  L: number;
  W: number;
  T: number;
}

/** Local wedge coordinates. */
export function wedgeLocal(w: Wedge, x: number, z: number, out: { u: number; v: number }): void {
  const rx = x - w.ox;
  const rz = z - w.oz;
  out.u = rx * w.dx + rz * w.dz;
  out.v = -rx * w.dz + rz * w.dx;
}

/** Wedge sand thickness at local (u, v); 0 outside. */
export function wedgeThickness(w: Wedge, u: number, v: number): number {
  if (u < 0 || u > w.L) return 0;
  const f = u / w.L;
  const halfW = w.W * (1 - 0.35 * f);
  const q = v / halfW;
  if (q <= -1 || q >= 1) return 0;
  return w.T * Math.pow(1 - f, 0.7) * Math.sqrt(1 - q * q);
}

/** Base of the wedge sand above the host unit base (restored blocks). */
export function wedgeBaseOffset(w: Wedge, u: number): number {
  return 0.4 + (clamp(u, 0, w.L) / w.L) * (1.1 * w.T + 1.0);
}

export interface Play {
  cx: number;
  cz: number;
  ra: number;
  rb: number;
  cos: number;
  sin: number;
  fluid: 'oil' | 'gas';
  op: number;
}

export function ellipseQ(cx: number, cz: number, ra: number, rb: number, cos: number, sin: number, x: number, z: number): number {
  const dx = x - cx;
  const dz = z - cz;
  const u = (dx * cos + dz * sin) / ra;
  const v = (-dx * sin + dz * cos) / rb;
  return u * u + v * v;
}

export interface OpZone {
  cx: number;
  cz: number;
  ra: number;
  rb: number;
  cos: number;
  sin: number;
  strength: number;
}

export interface Dike {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  w: number;
}

export interface StructuralFeatures {
  domes: Dome[];
  reefs: Reef[];
  wedges: Wedge[];
  plays: Play[];
  opZones: OpZone[];
}

// ------------------------------------------------------------------------------------------------
// Horizon grid
// ------------------------------------------------------------------------------------------------

/** Regional salt basin presence 0..1 (salt is deposited toward the ocean side of the map). */
export class SaltBasin {
  private readonly n: Noise2;
  private readonly cs: CoastSample = { o: 0, frac: 0 };
  private readonly terrain: Terrain;
  constructor(seed: number, terrain: Terrain) {
    this.terrain = terrain;
    this.n = noise2(seed, 301);
  }
  at(x: number, z: number): number {
    this.terrain.coast(x, z, this.cs);
    const ow = clamp(1 + this.cs.o / (this.terrain.size * 0.55), 0, 1);
    return smoothstep(0.44, 0.62, 0.7 * ow + 0.3 * (0.5 + 0.5 * this.n(x / 160, z / 160)));
  }
}

export class HorizonGrid {
  readonly step = GRID_STEP;
  /** Nodes per side. */
  readonly n: number;
  /** Node-major horizon elevations: hz[node * NUM_HORIZONS + k]. */
  readonly hz: Float32Array;
  /** Overpressure strength 0..1 per node. */
  readonly op: Float32Array;
  /** Dolomitisation indicator per node (> 0 → dolomite). */
  readonly dolo: Float32Array;
  /** Salt basin presence per node. */
  readonly salt: Float32Array;

  constructor(size: number) {
    this.n = Math.floor((size - 1) / GRID_STEP) + 2;
    const nn = this.n * this.n;
    this.hz = new Float32Array(nn * NUM_HORIZONS);
    this.op = new Float32Array(nn);
    this.dolo = new Float32Array(nn);
    this.salt = new Float32Array(nn);
  }

  /** Bilinear sample of every horizon into `out` (length NUM_HORIZONS). Also returns node weights via `w`. */
  sampleAll(x: number, z: number, out: Float32Array, w: Float32Array): number {
    const gx = x / GRID_STEP;
    const gz = z / GRID_STEP;
    let i0 = Math.floor(gx);
    let j0 = Math.floor(gz);
    const lim = this.n - 2;
    if (i0 < 0) i0 = 0;
    else if (i0 > lim) i0 = lim;
    if (j0 < 0) j0 = 0;
    else if (j0 > lim) j0 = lim;
    const fx = clamp(gx - i0, 0, 1);
    const fz = clamp(gz - j0, 0, 1);
    const n00 = i0 + j0 * this.n;
    w[0] = (1 - fx) * (1 - fz);
    w[1] = fx * (1 - fz);
    w[2] = (1 - fx) * fz;
    w[3] = fx * fz;
    const a = n00 * NUM_HORIZONS;
    const b = (n00 + 1) * NUM_HORIZONS;
    const c = (n00 + this.n) * NUM_HORIZONS;
    const d = (n00 + this.n + 1) * NUM_HORIZONS;
    const hz = this.hz;
    for (let k = 0; k < NUM_HORIZONS; k++) out[k] = hz[a + k] * w[0] + hz[b + k] * w[1] + hz[c + k] * w[2] + hz[d + k] * w[3];
    return n00;
  }

  /** Bilinear sample of a per-node scalar field using weights from sampleAll. */
  field(arr: Float32Array, n00: number, w: Float32Array): number {
    return arr[n00] * w[0] + arr[n00 + 1] * w[1] + arr[n00 + this.n] * w[2] + arr[n00 + this.n + 1] * w[3];
  }

  /** Single horizon at (x,z). */
  horizonAt(k: number, x: number, z: number): number {
    const gx = clamp(x / GRID_STEP, 0, this.n - 1.0001);
    const gz = clamp(z / GRID_STEP, 0, this.n - 1.0001);
    const i0 = Math.min(Math.floor(gx), this.n - 2);
    const j0 = Math.min(Math.floor(gz), this.n - 2);
    const fx = gx - i0;
    const fz = gz - j0;
    const n00 = i0 + j0 * this.n;
    const hz = this.hz;
    const H = NUM_HORIZONS;
    return (
      hz[n00 * H + k] * (1 - fx) * (1 - fz) + hz[(n00 + 1) * H + k] * fx * (1 - fz) + hz[(n00 + this.n) * H + k] * (1 - fx) * fz + hz[(n00 + this.n + 1) * H + k] * fx * fz
    );
  }
}

/** Builds the horizon grid for the given structural features (domes/reefs/wedges/plays/OP zones). */
/**
 * Regional compensation for down-to-basin fault displacement: far from a fault the hanging-wall block is
 * raised back by the throw (growth-fault thickening), so the stack stays within the world's vertical range
 * while the local offset AT each fault remains the full throw.
 */
export function faultCompensation(faults: readonly FaultModel[], x: number, z: number): number {
  let comp = 0;
  for (const f of faults) {
    const s = f.nx * (x - f.px) + f.nz * (z - f.pz);
    const sPlane = (f.dipSign * (REF_Y - 32)) / f.tanDip;
    comp += f.throw * smoothstep(-70, 70, f.dipSign * (s - sPlane));
  }
  return comp;
}

export function buildHorizonGrid(seed: number, terrain: Terrain, salt: SaltBasin, feats: StructuralFeatures, faults: readonly FaultModel[]): HorizonGrid {
  const size = terrain.size;
  const grid = new HorizonGrid(size);
  const nB = noise2(seed, 310);
  const nFold = noise2(seed, 311);
  const nFold2 = noise2(seed, 312);
  const nThk = noise2(seed, 313);
  const nDolo = noise2(seed, 314);
  const cs: CoastSample = { o: 0, frac: 0 };
  const bandW = terrain.bandWidth;
  const H = NUM_HORIZONS;
  const loc = { u: 0, v: 0 };

  for (let j = 0; j < grid.n; j++) {
    for (let i = 0; i < grid.n; i++) {
      const node = i + j * grid.n;
      const x = Math.min(i * GRID_STEP, size - 1);
      const z = Math.min(j * GRID_STEP, size - 1);
      terrain.coast(x, z, cs);
      const o = cs.o;
      const shelfT = smoothstep(-24, bandW * 0.9, o);
      const base = lerp(9.0, 4.6, shelfT) + 1.4 * nB(x / 130, z / 130);
      // smooth reference surface (land or seabed), continuous across the coastline; the sediment stack is
      // scaled so its top stays ~13 blocks beneath it (keeps reservoirs buried under low coastal plains/shelf)
      const refSurface = o > 0 ? SEA_LEVEL + 2.5 - Terrain.profileDepth(o, cs.frac) : 64 + 8 * smoothstep(0, 120, -o);
      const c = clamp((refSurface - 13 - base) / STACK_NOMINAL, 0.36, 1.05);
      const fold = (5.2 * fbm(nFold, x / 220, z / 220, 2) + 1.5 * nFold2(x / 85, z / 85)) * lerp(0.45, 1, clamp(c, 0, 1));
      let domes = 0;
      for (const d of feats.domes) domes += domeValue(d, x, z);
      const sm = salt.at(x, z);
      grid.salt[node] = sm;

      let reefDrape = 0;
      for (const rf of feats.reefs) {
        const dx = x - rf.cx;
        const dz = z - rf.cz;
        const rho = Math.sqrt(dx * dx + dz * dz) / rf.r;
        if (rho < 1.4) reefDrape = Math.max(reefDrape, reefMound(rf, x, z) + 1.2 * smoothstep(1.35, 0.95, rho));
      }

      let datum = base + fold + faultCompensation(faults, x, z);
      if (datum < 4.5) datum = 4.5 - (4.5 - datum) * 0.25; // keep the stack off the bedrock floor
      let cum = datum + domes;
      const hb = node * H;
      grid.hz[hb] = cum;
      for (let u = 1; u < H; u++) {
        const def = UNITS[u];
        const nom = def.nominal * c;
        let t: number;
        if (u === U.SALT) t = nom * (0.65 + 0.35 * nThk(x / 150 + 91.3, z / 150 - 12.1)) * sm;
        else if (u === U.ANHYDRITE) t = def.nominal * smoothstep(0.3, 0.55, sm);
        else t = Math.max(nom * def.minFrac, nom * (1 + def.variation * nThk(x / 150 + u * 37.1, z / 150 - u * 19.7)));
        if (u === U.LOWER_SHALE) t += reefDrape;
        for (const w of feats.wedges) {
          if (w.unit !== u) continue;
          wedgeLocal(w, x, z, loc);
          const fade = smoothstep(-6, 0, loc.u) * smoothstep(w.L + 6, w.L, loc.u) * smoothstep(w.W + 6, w.W, Math.abs(loc.v));
          t += (w.T + 1.8) * fade;
        }
        cum += Math.max(0, t);
        grid.hz[hb + u] = cum;
      }

      // overpressure strength
      let op = 0;
      if (o > -40) op = Math.max(op, (0.3 + 0.6 * cs.frac) * smoothstep(-40, 12, o));
      for (const z0 of feats.opZones) {
        const q = ellipseQ(z0.cx, z0.cz, z0.ra, z0.rb, z0.cos, z0.sin, x, z);
        if (q < 1.3) op = Math.max(op, z0.strength * (1 - smoothstep(0.55, 1.2, q)));
      }
      for (const p of feats.plays) {
        const q = ellipseQ(p.cx, p.cz, p.ra, p.rb, p.cos, p.sin, x, z);
        if (q < 1.3) op = Math.max(op, p.op * (1 - smoothstep(0.7, 1.2, q)));
      }
      grid.op[node] = clamp(op, 0, 1);
      grid.dolo[node] = nDolo(x / 70, z / 70);
    }
  }
  return grid;
}
