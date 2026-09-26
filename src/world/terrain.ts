// Surface terrain model: coastline & continental shelf, climate, biomes and a full-resolution heightmap.
//
// Everything is precomputed once per world into compact typed arrays (≈7 bytes per column), so surface
// queries (surfaceHeight / biomeAt / waterDepth / map colours) are O(1) and chunk generation never
// evaluates terrain noise.
import { SEA_LEVEL, WORLD_HEIGHT } from '../core/constants';
import { clamp, hash4, lerp, makeRng, smoothstep } from '../core/rng';
import { BI } from './biomes';
import { fbm, noise2, ridged, subSeed, type Noise2 } from './noise';

/** Per-column flag bits. */
export const TF = {
  /** Open ocean (offshore) column. */
  OCEAN: 1,
  /** Column is covered by water (ocean, lake, river or swamp pool). */
  WATER: 2,
  RIVER: 4,
  LAKE: 8,
  /** Sandy shore (sea beach or river/lake bank). */
  BEACH: 16,
  /** Coastal cliff zone (strata exposed, no beach). */
  CLIFF: 32,
} as const;

export interface CoastSample {
  /** Signed distance past the coastline (blocks): > 0 offshore, < 0 inland. */
  o: number;
  /** Position within the ocean band: 0 at the coastline … 1 at the map edge. */
  frac: number;
}

/** Map edges: 0 = west (−x), 1 = east (+x), 2 = north (−z), 3 = south (+z). */
export type Edge = 0 | 1 | 2 | 3;

const SHELF_END = 0.64;
const SLOPE_END = 0.8;

function terrace(h: number, step: number): number {
  const k = Math.floor(h / step);
  const f = h / step - k;
  return (k + smoothstep(0.28, 0.72, f)) * step;
}

export class Terrain {
  readonly size: number;
  /** Surface height: first air/water y above solid ground. */
  readonly ground: Uint8Array;
  readonly biome: Uint8Array;
  /** Climate, quantised 0..255. */
  readonly temp: Uint8Array;
  readonly humid: Uint8Array;
  readonly flags: Uint8Array;
  /** Max height difference to the 4 neighbours (clamped 0..255). */
  readonly slope: Uint8Array;
  /** Low-frequency patch noise 0..255 (soil & vegetation variation). */
  readonly patch: Uint8Array;
  readonly edges: Edge[];
  /** Nominal ocean band width (blocks). */
  readonly bandWidth: number;
  /** Unit vector pointing offshore (average of ocean edges). */
  readonly oceanDir: { x: number; z: number };

  private readonly nC1: Noise2;
  private readonly nC2: Noise2;

  readonly seed: number;

  constructor(seed: number, size: number) {
    this.seed = seed;
    this.size = size;
    const n = size * size;
    this.ground = new Uint8Array(n);
    this.biome = new Uint8Array(n);
    this.temp = new Uint8Array(n);
    this.humid = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.slope = new Uint8Array(n);
    this.patch = new Uint8Array(n);

    const rng = makeRng(subSeed(seed, 101));
    const twoEdges = rng() < 0.4;
    const first = Math.floor(rng() * 4) as Edge;
    const edges: Edge[] = [first];
    if (twoEdges) {
      const adj: Edge = first < 2 ? ((2 + Math.floor(rng() * 2)) as Edge) : (Math.floor(rng() * 2) as Edge);
      edges.push(adj);
    }
    this.edges = edges;
    this.bandWidth = size * (twoEdges ? 0.18 : 0.3);
    let ox = 0;
    let oz = 0;
    for (const e of edges) {
      if (e === 0) ox -= 1;
      else if (e === 1) ox += 1;
      else if (e === 2) oz -= 1;
      else oz += 1;
    }
    const ol = Math.hypot(ox, oz) || 1;
    this.oceanDir = { x: ox / ol, z: oz / ol };
    this.nC1 = noise2(seed, 102);
    this.nC2 = noise2(seed, 103);
    this.build(rng());
  }

  /** Signed coastline distance & ocean-band fraction (smooth; no small-scale seabed detail). */
  coast(x: number, z: number, out: CoastSample): CoastSample {
    const W = this.bandWidth * (1 + 0.2 * this.nC1(x / 260, z / 260) + 0.055 * this.nC2(x / 72, z / 72));
    const s1 = this.size - 1;
    let best = -1e9;
    for (let i = 0; i < this.edges.length; i++) {
      const e = this.edges[i];
      const d = e === 0 ? x : e === 1 ? s1 - x : e === 2 ? z : s1 - z;
      const o = W - d;
      if (o > best) best = o;
    }
    out.o = best;
    out.frac = clamp(best / W, 0, 1);
    return out;
  }

  /** Smooth bathymetric profile (water depth in blocks) across the ocean band. */
  static profileDepth(o: number, frac: number): number {
    let d: number;
    if (frac < SHELF_END) d = 1.2 + 13.6 * Math.pow(frac / SHELF_END, 1.2);
    else if (frac < SLOPE_END) d = 14.8 + 20 * smoothstep(SHELF_END, SLOPE_END, frac);
    else d = 34.8 + 18 * smoothstep(SLOPE_END, 1, frac);
    return Math.min(d, 0.4 + Math.max(0, o) * 0.42);
  }

  index(x: number, z: number): number {
    const s = this.size - 1;
    const cx = x < 0 ? 0 : x > s ? s : x | 0;
    const cz = z < 0 ? 0 : z > s ? s : z | 0;
    return cx + cz * this.size;
  }

  waterDepthAt(i: number): number {
    const g = this.ground[i];
    return g <= SEA_LEVEL ? SEA_LEVEL + 1 - g : 0;
  }

  private build(tempAngleSeed: number): void {
    const { size, seed } = this;
    const nWx = noise2(seed, 110);
    const nWz = noise2(seed, 111);
    const nT = noise2(seed, 112);
    const nT2 = noise2(seed, 113);
    const nH = noise2(seed, 114);
    const nH2 = noise2(seed, 115);
    const nCont = noise2(seed, 116);
    const nEro = noise2(seed, 117);
    const nMnt = noise2(seed, 118);
    const nRidge = noise2(seed, 119);
    const nHill = noise2(seed, 120);
    const nDet = noise2(seed, 121);
    const nBad = noise2(seed, 122);
    const nMesa = noise2(seed, 123);
    const nDune = noise2(seed, 124);
    const nRiv = noise2(seed, 125);
    const nLake = noise2(seed, 126);
    const nCliff = noise2(seed, 127);
    const nSea = noise2(seed, 128);
    const nCanyon = noise2(seed, 129);
    const nShoal = noise2(seed, 130);
    const nPatch = noise2(seed, 131);
    const nBirch = noise2(seed, 132);

    const ta = tempAngleSeed * Math.PI * 2;
    const tcx = Math.cos(ta);
    const tcz = Math.sin(ta);
    const cs: CoastSample = { o: 0, frac: 0 };
    const invS = 1 / size;

    // ---- low-frequency fields on a coarse grid (bilinear per column) ----
    const S = 4;
    const gn = Math.floor((size - 1) / S) + 2;
    const NF = 18;
    const F = new Float32Array(gn * gn * NF);
    for (let j = 0; j < gn; j++) {
      for (let i = 0; i < gn; i++) {
        const x = i * S;
        const z = j * S;
        const b = (i + j * gn) * NF;
        this.coast(x, z, cs);
        const wx = x + 38 * nWx(x / 190, z / 190);
        const wz = z + 38 * nWz(x / 190 + 17.3, z / 190 - 9.1);
        const cont = nCont(wx / 420, wz / 420);
        F[b] = cs.o;
        F[b + 1] = cs.frac;
        F[b + 2] = 0.5 + 0.62 * ((x * invS - 0.5) * tcx + (z * invS - 0.5) * tcz) + 0.25 * nT(wx / 330, wz / 330) + 0.06 * nT2(x / 70, z / 70);
        F[b + 3] = 0.5 + 0.36 * nH(wx / 290, wz / 290) + 0.07 * nH2(x / 64, z / 64);
        F[b + 4] = cont;
        F[b + 5] = 0.5 + 0.5 * nEro(wx / 260, wz / 260);
        F[b + 6] = 0.5 + 0.5 * nMnt(wx / 360, wz / 360) + 0.1 * cont;
        F[b + 7] = fbm(nHill, wx / 115, wz / 115, 3);
        F[b + 8] = nBad(wx / 210, wz / 210);
        F[b + 9] = 0.5 + 0.5 * nMesa(wx / 85, wz / 85);
        F[b + 10] = nRiv(wx / 300, wz / 300);
        F[b + 11] = 0.5 + 0.5 * nLake(x / 150, z / 150);
        F[b + 12] = nCliff(x / 110, z / 110);
        F[b + 13] = nCanyon(wx / 210, wz / 210);
        F[b + 14] = nShoal(x / 90, z / 90);
        F[b + 15] = nBirch(x / 120, z / 120);
        F[b + 16] = ridged(nRidge, wx / 150, wz / 150, 4);
        F[b + 17] = 0.5 + 0.5 * nPatch(x / 40, z / 40);
      }
    }
    const v = new Float32Array(NF);

    const ground = this.ground;
    const hseed = subSeed(seed, 140);
    for (let z = 0; z < size; z++) {
      const gz = z / S;
      const j0 = Math.min(Math.floor(gz), gn - 2);
      const fz = gz - j0;
      for (let x = 0; x < size; x++) {
        const i = x + z * size;
        const gx = x / S;
        const i0 = Math.min(Math.floor(gx), gn - 2);
        const fx = gx - i0;
        const w00 = (1 - fx) * (1 - fz);
        const w10 = fx * (1 - fz);
        const w01 = (1 - fx) * fz;
        const w11 = fx * fz;
        const b00 = (i0 + j0 * gn) * NF;
        const b10 = b00 + NF;
        const b01 = b00 + gn * NF;
        const b11 = b01 + NF;
        for (let k = 0; k < NF; k++) v[k] = F[b00 + k] * w00 + F[b10 + k] * w10 + F[b01 + k] * w01 + F[b11 + k] * w11;

        const o = v[0];
        const frac = v[1];
        const inland = -o;
        let T = v[2];
        let H = v[3] + 0.1 * (1 - smoothstep(0, 80, inland));
        const detail = fbm(nDet, x / 26, z / 26, 2);
        const jitter = (hash4(hseed, x, z) / 4294967296 - 0.5) * 0.035;

        let h: number;
        let fl = 0;
        let mountain = 0;
        let desertW = 0;
        let badW = 0;
        let swampW = 0;
        let riverCh = 0;
        let valley = 0;

        if (o > 0) {
          // ---------------- ocean floor ----------------
          let d = Terrain.profileDepth(o, frac);
          const shelfness = 1 - smoothstep(SHELF_END - 0.08, SHELF_END + 0.02, frac);
          // sand ridges & megaripples on the shelf
          d += shelfness * (1.3 * nSea(x / 38, z / 38) + 0.5 * detail) * smoothstep(3, 14, o);
          // submarine canyons cutting the outer shelf & slope
          const can = 1 - smoothstep(0.015, 0.075, Math.abs(v[13]));
          d += can * 9 * smoothstep(0.35, 0.75, frac);
          // shoals / sandbars on the inner shelf
          const sh = smoothstep(0.72, 0.92, v[14]);
          d -= sh * 7 * (1 - smoothstep(0.2, 0.5, frac));
          // abyssal hills
          d += (1 - shelfness) * 1.6 * detail;
          d = clamp(d, 1, 56);
          h = SEA_LEVEL + 0.5 - d;
          fl |= TF.OCEAN;
          H = Math.max(H, 0.5);
        } else {
          // ---------------- land ----------------
          const cont = v[4];
          const erosion = v[5];
          mountain = smoothstep(0.62, 0.86, v[6]) * smoothstep(40, 120, inland);
          const hills = v[7];
          desertW = smoothstep(0.6, 0.7, T) * smoothstep(0.47, 0.37, H);
          badW = desertW * smoothstep(0.05, 0.3, v[8]) * smoothstep(0.64, 0.74, T);
          swampW = smoothstep(0.6, 0.7, H) * smoothstep(0.42, 0.52, T) * (1 - mountain) * smoothstep(0.4, 0.62, erosion);

          const base = 65.8 + 6 * smoothstep(0, 90, inland) + 3.5 * cont;
          const hillAmp = lerp(3, 14, smoothstep(0.2, 0.85, 1 - erosion));
          h = base + hills * hillAmp + detail * 1.4;
          // desert dunes
          if (desertW > 0) h += desertW * (1 - badW) * 3.4 * ridged(nDune, x / 30, z / 30, 2);
          h = Math.max(h, 63.3 + 0.4 * detail);
          // swamps: flat, waterlogged lowland
          h = lerp(h, 62.75 + detail * 1.3 + hills * 0.6, swampW * 0.92);
          // badlands mesas
          if (badW > 0) {
            const mesaN = v[9];
            let mesa = 67 + 24 * smoothstep(0.46, 0.6, mesaN) + 9 * smoothstep(0.74, 0.84, mesaN) + detail * 1.4;
            mesa = terrace(mesa, 4);
            h = lerp(h, Math.max(h, mesa), badW);
          }
          // mountains
          if (mountain > 0) {
            const peak = 82 + 64 * Math.pow(v[16], 1.45) + detail * 3 + hills * 6;
            h = lerp(h, Math.max(h, peak), mountain);
          }
          // rivers
          const ar = Math.abs(v[10]);
          const fade = smoothstep(-4, 10, inland) * (1 - smoothstep(0.2, 0.5, mountain)) * (1 - smoothstep(86, 98, h)) * (1 - badW * 0.6);
          valley = (1 - smoothstep(0.03, 0.12, ar)) * fade;
          riverCh = (1 - smoothstep(0.011, 0.029, ar)) * fade;
          h = lerp(h, Math.min(h, 64.2 + (h - 64.2) * 0.3), valley);
          h = lerp(h, 58.4 + detail * 0.8, riverCh);
          // lakes (sparse)
          const lakeW = smoothstep(0.72, 0.85, v[11]) * smoothstep(12, 40, inland) * (1 - mountain) * (1 - desertW * 0.85);
          if (lakeW > 0) h = lerp(h, 56.3 + detail * 1.2, lakeW);
          // coastal ramp (beaches) or cliffs
          const cliff = smoothstep(0.38, 0.62, v[12]) * (1 - swampW);
          const rampW = lerp(24, 4.5, cliff);
          h = lerp(Math.min(62.35 + 0.3 * detail, h), h, smoothstep(0, rampW, inland));
          if (cliff > 0.5 && inland < 8) fl |= TF.CLIFF;
        }

        h = clamp(h, 3, WORLD_HEIGHT - 8);
        const g = Math.floor(h) + 1;
        ground[i] = g;
        if (g <= SEA_LEVEL) {
          fl |= TF.WATER;
          if (!(fl & TF.OCEAN)) fl |= riverCh > 0.3 ? TF.RIVER : TF.LAKE;
        }

        // climate after altitude
        T -= Math.max(0, h - 84) * 0.0055;
        T = clamp(T, 0, 1);
        H = clamp(H, 0, 1);
        this.temp[i] = Math.round(T * 255);
        this.humid[i] = Math.round(H * 255);
        this.patch[i] = Math.round(clamp(v[17], 0, 1) * 255);

        // ---------------- biome ----------------
        let b: number;
        const Tj = T + jitter;
        const Hj = H + jitter;
        if (fl & TF.OCEAN) b = g <= SEA_LEVEL + 1 - 28 ? BI.DEEP_OCEAN : BI.OCEAN;
        else if (fl & TF.RIVER) b = BI.RIVER;
        else if (g >= 99 + jitter * 160 || (mountain > 0.45 && g >= 90)) b = BI.MOUNTAINS;
        else if (inland < 14 + jitter * 120 && g <= 66 && !(fl & TF.CLIFF) && swampW < 0.5) b = BI.BEACH;
        else if (Tj < 0.2) b = BI.TUNDRA;
        else if (Tj < 0.34) b = BI.TAIGA;
        else if (desertW + jitter > 0.5) b = badW + jitter > 0.5 ? BI.BADLANDS : BI.DESERT;
        else if (swampW + jitter > 0.5) b = BI.SWAMP;
        else if (Hj > 0.52) b = v[15] > 0.35 ? BI.BIRCH : BI.FOREST;
        else b = BI.PLAINS;
        this.biome[i] = b;
        if (b === BI.BEACH || (valley > 0.35 && g <= 65 && !(fl & TF.WATER) && b !== BI.MOUNTAINS)) fl |= TF.BEACH;
        this.flags[i] = fl;
      }
    }

    // slope pass
    const s1 = size - 1;
    for (let z = 0; z < size; z++) {
      for (let x = 0; x < size; x++) {
        const i = x + z * size;
        const g = ground[i];
        const a = ground[x > 0 ? i - 1 : i];
        const b = ground[x < s1 ? i + 1 : i];
        const c = ground[z > 0 ? i - size : i];
        const d = ground[z < s1 ? i + size : i];
        let m = Math.abs(g - a);
        const mb = Math.abs(g - b);
        if (mb > m) m = mb;
        const mc = Math.abs(g - c);
        if (mc > m) m = mc;
        const md = Math.abs(g - d);
        if (md > m) m = md;
        this.slope[i] = m;
      }
    }
  }
}
