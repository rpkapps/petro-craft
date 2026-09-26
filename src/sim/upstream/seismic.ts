// Synthetic seismic: reflectivity from geology impedance → Ricker convolution → coherent & random noise →
// lateral smoothing → AGC. Presentation-only (deterministic hash noise, never ctx.rng()).
import { SEA_LEVEL } from '../../core/constants';
import { hashFloat } from '../../core/rng';
import type { GameContext, SeismicImage, SurveyState, Vec2 } from '../../core/types';
import { acquiredFraction, surveyQuote } from './exploration';
import { clamp, hasFeature } from './util';

const MAX_CACHE = 24;
const MAX_COLUMNS = 6000;
const BOTTOM_Y = 2;
const WATER_IMPEDANCE = 1.5;

interface Column {
  /** Top of rock (first non-rock y) and top of the water column (exclusive). */
  rockTop: number;
  waterTop: number;
  /** Impedance per block y (0 = air). */
  imp: Float32Array;
  /** Fluid indicator per block y (0 none, 1 brine, 2 oil, 3 gas). */
  fluid: Uint8Array;
  /** Reservoir index +1 per block y (for 4D sweep display), 0 = none. */
  res: Uint16Array;
}

function fluidCode(fluid: string, porosity: number): number {
  if (fluid === 'oil') return 2;
  if (fluid === 'gas') return 3;
  if ((fluid === 'brine' || fluid === 'fresh') && porosity > 0.08) return 1;
  return 0;
}

export class SeismicService {
  private cache = new Map<string, SeismicImage>();
  private columns = new Map<number, Column>();
  private resIndex = new Map<string, number>();

  constructor(private ctx: GameContext) {
    ctx.geology.reservoirs.forEach((r, i) => this.resIndex.set(r.id, i + 1));
  }

  quote(kind: '2d' | '3d', x0: number, z0: number, x1: number, z1: number) {
    return surveyQuote(this.ctx, kind, x0, z0, x1, z1);
  }

  private column(x: number, z: number): Column {
    const key = x * 65536 + z;
    const hit = this.columns.get(key);
    if (hit) return hit;
    const g = this.ctx.geology;
    const H = this.ctx.world.height;
    const rockTop = Math.min(H - 1, g.surfaceHeight(x, z));
    const waterTop = g.isOffshore(x, z) ? Math.max(rockTop, SEA_LEVEL + 1) : rockTop;
    const imp = new Float32Array(H);
    const fluid = new Uint8Array(H);
    const res = new Uint16Array(H);
    for (let y = BOTTOM_Y; y < rockTop; y++) {
      const p = g.properties(x, y, z);
      imp[y] = p.impedance > 0 ? p.impedance : 1;
      fluid[y] = fluidCode(p.fluid, p.porosity);
      if (p.reservoirId) res[y] = this.resIndex.get(p.reservoirId) ?? 0;
    }
    for (let y = rockTop; y < waterTop; y++) imp[y] = WATER_IMPEDANCE;
    const c: Column = { rockTop, waterTop, imp, fluid, res };
    if (this.columns.size >= MAX_COLUMNS) this.columns.delete(this.columns.keys().next().value!);
    this.columns.set(key, c);
    return c;
  }

  private remember(key: string, img: SeismicImage): SeismicImage {
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(key, img);
    return img;
  }

  /** Clear caches (e.g. after the geology changes). */
  invalidate(): void {
    this.cache.clear();
    this.columns.clear();
  }

  private fourD(): { on: boolean; bucket: number } {
    const on = hasFeature(this.ctx, 'seismic_4d', 'seismic_4d');
    return { on, bucket: on ? Math.floor(this.ctx.state.time.day / 3) : 0 };
  }

  /** Oil swept by water (below the current water front) shows as brine on 4D. */
  private sweptY(resIdx: number): number {
    const r = this.ctx.geology.reservoirs[resIdx - 1];
    if (!r) return -Infinity;
    return this.ctx.state.reservoirs[r.id]?.waterFrontY ?? -Infinity;
  }

  getSection(s: SurveyState, opts: { inline?: number; crossline?: number; resolution?: number } = {}): SeismicImage {
    const frac = acquiredFraction(s);
    const maxTraces = clamp(Math.round(opts.resolution ?? 256), 16, 512);
    let ax: number, az: number, bx: number, bz: number;
    let lineKey: string;
    if (s.kind === '2d') {
      ax = s.x0; az = s.z0; bx = s.x1; bz = s.z1;
      lineKey = 'L';
    } else {
      const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), z0 = Math.min(s.z0, s.z1), z1 = Math.max(s.z0, s.z1);
      if (opts.crossline !== undefined) {
        const cx = clamp(x0 + Math.round(opts.crossline), x0, x1);
        ax = cx; bx = cx; az = z0; bz = z1;
        lineKey = `X${cx}`;
      } else {
        const iz = clamp(z0 + Math.round(opts.inline ?? (z1 - z0) / 2), z0, z1);
        ax = x0; bx = x1; az = iz; bz = iz;
        lineKey = `I${iz}`;
      }
    }
    const d4 = this.fourD();
    const key = `${s.id}|${s.status}|${Math.floor(frac * 50)}|${lineKey}|${maxTraces}|${s.quality}|${s.fluidIndicators ? 1 : 0}|${d4.bucket}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const len = Math.hypot(bx - ax, bz - az);
    const width = clamp(Math.round(len) + 1, 2, maxTraces);
    const cols: Column[] = [];
    const columns: Vec2[] = [];
    const acquired = new Uint8Array(width);
    let topY = BOTTOM_Y + 8;
    for (let i = 0; i < width; i++) {
      const t = width > 1 ? i / (width - 1) : 0;
      const x = Math.round(ax + (bx - ax) * t);
      const z = Math.round(az + (bz - az) * t);
      columns.push({ x, z });
      const c = this.column(clamp(x, 0, this.ctx.geology.sizeX - 1), clamp(z, 0, this.ctx.geology.sizeZ - 1));
      cols.push(c);
      topY = Math.max(topY, c.waterTop);
      if (s.kind === '2d') acquired[i] = t <= frac + 1e-9 ? 1 : 0;
      else {
        const z0 = Math.min(s.z0, s.z1), z1 = Math.max(s.z0, s.z1);
        acquired[i] = (z - z0) / Math.max(1, z1 - z0) <= frac + 1e-9 ? 1 : 0;
      }
    }
    const spanBlocks = topY - BOTTOM_Y;
    const spb = clamp(150 / spanBlocks, 1, 3);
    const height = Math.round(spanBlocks * spb);
    const q = Math.max(0.3, s.quality);
    const data = new Float32Array(width * height);
    const trace = new Float32Array(height);
    const refl = new Float32Array(height);
    const mask = new Uint8Array(height);
    // Ricker wavelet in samples; peak wavelength shrinks with quality.
    const lambda = clamp(3.2 / q, 1.1, 5) * spb;
    const half = Math.ceil(1.3 * lambda);
    const wav = new Float32Array(2 * half + 1);
    for (let k = -half; k <= half; k++) {
      const a = (Math.PI * k) / lambda;
      wav[k + half] = (1 - 2 * a * a) * Math.exp(-a * a);
    }
    const noiseRand = 0.2 / q;
    const noiseCoh = 0.14 / q;
    const multAmp = 0.3 / q;
    const seed = hashSeed(s.id);
    const dip = (hashFloat(seed, 7) - 0.5) * 0.08;
    for (let i = 0; i < width; i++) {
      if (!acquired[i]) continue;
      const c = cols[i];
      // Reflectivity series (depth-indexed samples, row 0 = topY).
      let prev = 0;
      for (let sI = 0; sI < height; sI++) {
        const y = Math.floor(topY - (sI + 0.5) / spb);
        const imp = y >= BOTTOM_Y ? c.imp[y] : c.imp[BOTTOM_Y];
        mask[sI] = y < c.rockTop ? 1 : 0;
        refl[sI] = prev > 0 && imp > 0 ? (imp - prev) / (imp + prev) : 0;
        prev = imp;
      }
      // Convolution
      let rms = 0;
      for (let sI = 0; sI < height; sI++) {
        let acc = 0;
        const k0 = Math.max(-half, -sI);
        const k1 = Math.min(half, height - 1 - sI);
        for (let k = k0; k <= k1; k++) acc += refl[sI + k] * wav[k + half];
        trace[sI] = acc;
        rms += acc * acc;
      }
      rms = Math.sqrt(rms / height) || 1e-3;
      // Surface-related multiple of the strongest shallow event.
      let mIdx = 0;
      let mAmp = 0;
      const lim = Math.floor(height * 0.35);
      for (let sI = 0; sI < lim; sI++) if (Math.abs(trace[sI]) > mAmp) {
        mAmp = Math.abs(trace[sI]);
        mIdx = sI;
      }
      for (let sI = height - 1; sI >= 0; sI--) {
        let v = trace[sI];
        const src = sI - mIdx;
        if (mIdx > 3 && src >= mIdx) v -= multAmp * trace[src];
        if (mask[sI]) {
          const coh = Math.sin(2 * Math.PI * (sI * 0.085 / spb + i * dip)) * Math.exp(-sI / (height * 0.45));
          const rnd = hashFloat(seed, i, sI) * 2 - 1;
          v += rms * (noiseCoh * coh + noiseRand * rnd);
        } else v *= 0.15;
        data[sI * width + i] = v;
      }
    }
    // Lateral smoothing (more passes at low quality).
    const passes = q < 1.2 ? 2 : 1;
    const tmp = new Float32Array(width);
    for (let p = 0; p < passes; p++)
      for (let sI = 0; sI < height; sI++) {
        const row = sI * width;
        for (let i = 0; i < width; i++) {
          const l = data[row + Math.max(0, i - 1)];
          const r = data[row + Math.min(width - 1, i + 1)];
          tmp[i] = 0.25 * l + 0.5 * data[row + i] + 0.25 * r;
        }
        for (let i = 0; i < width; i++) if (acquired[i]) data[row + i] = tmp[i];
      }
    // AGC per trace (sliding RMS window) → tanh into [-1, 1].
    const W = Math.max(8, Math.round(12 * spb));
    for (let i = 0; i < width; i++) {
      if (!acquired[i]) continue;
      let sum = 0;
      const e2 = new Float32Array(height + 1);
      for (let sI = 0; sI < height; sI++) {
        const v = data[sI * width + i];
        sum += v * v;
        e2[sI + 1] = sum;
      }
      const glob = Math.sqrt(sum / height) || 1e-6;
      for (let sI = 0; sI < height; sI++) {
        const a = Math.max(0, sI - W);
        const b = Math.min(height, sI + W + 1);
        const local = Math.sqrt((e2[b] - e2[a]) / (b - a));
        const g = Math.max(local, glob * 0.25) || 1e-6;
        data[sI * width + i] = Math.tanh((1.1 * data[sI * width + i]) / g) * 0.98;
      }
    }
    let fluid: Uint8Array | undefined;
    if (s.fluidIndicators) {
      fluid = new Uint8Array(width * height);
      const err = clamp(0.35 / q - 0.12, 0.02, 0.3);
      for (let i = 0; i < width; i++) {
        if (!acquired[i]) continue;
        const c = cols[i];
        for (let sI = 0; sI < height; sI++) {
          const y = Math.floor(topY - (sI + 0.5) / spb);
          if (y < BOTTOM_Y || y >= c.rockTop) continue;
          let f = c.fluid[y];
          if (f === 2 && d4.on && c.res[y] && y < this.sweptY(c.res[y])) f = 1;
          if (f >= 2 && hashFloat(seed, i >> 3, sI >> 3, 99) < err) f = f === 2 ? 3 : hashFloat(seed, i >> 3, sI >> 3, 5) < 0.5 ? 2 : 1;
          fluid[sI * width + i] = f;
        }
      }
    }
    return this.remember(key, { width, height, data, fluid, topY, bottomY: BOTTOM_Y, columns });
  }

  getDepthSlice(s: SurveyState, yIn: number): SeismicImage {
    const x0 = Math.min(s.x0, s.x1), x1 = Math.max(s.x0, s.x1), z0 = Math.min(s.z0, s.z1), z1 = Math.max(s.z0, s.z1);
    const y = clamp(Math.round(yIn), BOTTOM_Y + 1, this.ctx.world.height - 2);
    const frac = acquiredFraction(s);
    const d4 = this.fourD();
    const key = `${s.id}|slice|${y}|${s.status}|${Math.floor(frac * 50)}|${s.quality}|${d4.bucket}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, z1 - z0);
    const g = this.ctx.geology;
    const q = Math.max(0.3, s.quality);
    const lambda = clamp(3.2 / q, 1.1, 5);
    const half = Math.min(4, Math.ceil(1.3 * lambda));
    const wav = new Float32Array(2 * half + 1);
    for (let k = -half; k <= half; k++) {
      const a = (Math.PI * k) / lambda;
      wav[k + half] = (1 - 2 * a * a) * Math.exp(-a * a);
    }
    const data = new Float32Array(width * height);
    const fluid = s.fluidIndicators ? new Uint8Array(width * height) : undefined;
    const imp = new Float32Array(2 * half + 2);
    const seed = hashSeed(s.id);
    const err = clamp(0.35 / q - 0.12, 0.02, 0.3);
    let sum = 0;
    let n = 0;
    for (let j = 0; j < height; j++) {
      const z = z0 + j;
      if (j / Math.max(1, height) > frac + 1e-9) continue;
      for (let i = 0; i < width; i++) {
        const x = x0 + i;
        const top = g.surfaceHeight(x, z);
        if (y >= top - 1) continue;
        // Impedance from y+half+1 (shallow) down to y-half (deep).
        for (let k = 0; k < imp.length; k++) {
          const yy = y + half + 1 - k;
          imp[k] = yy >= top ? (g.isOffshore(x, z) ? WATER_IMPEDANCE : 0) : yy < BOTTOM_Y ? imp[Math.max(0, k - 1)] : g.properties(x, yy, z).impedance;
        }
        let acc = 0;
        for (let k = -half; k <= half; k++) {
          const a = imp[half + k];
          const b = imp[half + k + 1];
          const r = a > 0 && b > 0 ? (b - a) / (b + a) : 0;
          acc += r * wav[k + half];
        }
        acc += (hashFloat(seed, x, z, y) * 2 - 1) * 0.02 / q;
        data[j * width + i] = acc;
        sum += acc * acc;
        n++;
        if (fluid) {
          const p = g.properties(x, y, z);
          let f = fluidCode(p.fluid, p.porosity);
          if (f === 2 && d4.on && p.reservoirId && y < (this.ctx.state.reservoirs[p.reservoirId]?.waterFrontY ?? -Infinity)) f = 1;
          if (f >= 2 && hashFloat(seed, x >> 3, z >> 3, 77) < err) f = f === 2 ? 3 : 2;
          fluid[j * width + i] = f;
        }
      }
    }
    const rms = Math.sqrt(sum / Math.max(1, n)) || 1e-6;
    for (let k = 0; k < data.length; k++) data[k] = Math.tanh(data[k] / (1.5 * rms)) * 0.98;
    const columns: Vec2[] = [];
    for (let i = 0; i < width; i++) columns.push({ x: x0 + i, z: z0 });
    return this.remember(key, { width, height, data, fluid, topY: y, bottomY: y, columns });
  }
}

function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Expected survey duration (for UI progress text). */
export function surveyDays(ctx: GameContext, s: SurveyState): number {
  return surveyQuote(ctx, s.kind, s.x0, s.z0, s.x1, s.z1).days;
}
